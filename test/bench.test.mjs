import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  parseSubscriptionPayload,
  buildBenchYaml,
} from "../parser.mjs";
import { httpConnectFetch, probeNodeSpeed, probeNodeUnlocks } from "../probe.mjs";
import { BenchStore, maskUrl } from "../store.mjs";
import { benchmarkSupplier, pickNodesToSpeedTest } from "../runner.mjs";
import { createBenchServer, parseBulkLines } from "../server.mjs";

const enc = (s) => encodeURIComponent(s);

test("parseSubscriptionPayload parses mixed protocols, filters info nodes, deduplicates, and reads quota", () => {
  const vmessObj = {
    v: "2", ps: "🇸🇬新加坡·电信01", add: "sg.example.com", port: 443,
    id: "22222222-2222-4222-8222-222222222222", aid: 0, net: "ws", tls: "tls", host: "sg.example.com", path: "/ws",
  };
  const ssUser = Buffer.from("aes-256-gcm:secretpass").toString("base64");
  const rawList = [
    "STATUS=↑:5.00GB,↓:15.00GB,TOT:200GB Expires:2026-12-31",
    `vless://11111111-1111-4111-8111-111111111111@hk1.example.com:443?encryption=none&security=reality&sni=apple.com&fp=chrome&pbk=PUB&sid=11&type=tcp#${enc("剩余流量：180 GB")}`,
    `vless://11111111-1111-4111-8111-111111111111@jp1.example.com:443?encryption=none&security=reality&sni=apple.com&fp=chrome&pbk=PUB&sid=11&type=tcp#${enc("🇯🇵日本·移联01")}`,
    `vless://11111111-1111-4111-8111-111111111111@jp2.example.com:443?encryption=none&security=reality&sni=apple.com&fp=chrome&pbk=PUB&sid=11&type=tcp#${enc("🇯🇵日本·移联01")}`,
    `vmess://${Buffer.from(JSON.stringify(vmessObj)).toString("base64")}`,
    `trojan://trpass@hk1.example.com:443?sni=hk1.example.com#${enc("🇭🇰香港·电信01")}`,
    `ss://${ssUser}@us1.example.com:8388#${enc("🇺🇸美国·电信01")}`,
    `hysteria2://hypass@kr1.example.com:443?sni=kr1.example.com#${enc("🇰🇷韩国·移联01")}`,
    `tuic://33333333-3333-4333-8333-333333333333:tupass@gb1.example.com:443?sni=gb1.example.com#${enc("🇬🇧英国·电信01")}`,
  ].join("\n");

  const b64 = "\uFEFF" + Buffer.from(rawList, "utf8").toString("base64");
  const parsed = parseSubscriptionPayload(b64);

  assert.equal(parsed.format, "share-links");
  assert.equal(parsed.infoNodes.length, 1);
  assert.equal(parsed.proxies.length, 7);
  assert.deepEqual(
    parsed.proxies.map((p) => p.name),
    ["🇯🇵日本·移联01", "🇯🇵日本·移联01 #2", "🇸🇬新加坡·电信01", "🇭🇰香港·电信01", "🇺🇸美国·电信01", "🇰🇷韩国·移联01", "🇬🇧英国·电信01"]
  );
  assert.equal(parsed.proxies[0].region, "JP");
  assert.equal(parsed.proxies[0].carrier, "Mobile");
  assert.equal(parsed.proxies[3].region, "HK");
  assert.equal(parsed.proxies[3].carrier, "Telecom");
  assert.equal(parsed.quota.totalGb, 200);
  assert.equal(parsed.quota.leftGb, 180);
  assert.equal(parsed.quota.expires, "2026-12-31");

  const yaml = buildBenchYaml(parsed.proxies, { mixedPort: 17890, apiPort: 19090, apiSecret: "sec" });
  assert.match(yaml, /mode: rule/);
  assert.match(yaml, /- MATCH,BENCH/);
  assert.match(yaml, /external-controller: 127\.0\.0\.1:19090/);
  assert.doesNotMatch(yaml, /geoip:\s*true/);
});

test("parseSubscriptionPayload parses Clash YAML block & flow proxies and Subscription-Userinfo header", () => {
  const yaml = `
mixed-port: 7890
proxies:
  - name: "套餐到期：2027-01-01"
    type: vless
    server: info.example.com
    port: 443
    uuid: 1111
  - { name: "🇯🇵 Tokyo IEPL", type: trojan, server: jp.example.com, port: 443, password: abc }
  - name: "🇭🇰 Hong Kong 01"
    type: ss
    server: hk.example.com
    port: 8888
    cipher: aes-128-gcm
    password: xyz
proxy-groups:
  - name: Auto
    type: url-test
`;
  const parsed = parseSubscriptionPayload(yaml, {
    "subscription-userinfo": "upload=1073741824; download=2147483648; total=107374182400; expire=1798761600",
  });
  assert.equal(parsed.format, "clash-yaml");
  assert.equal(parsed.infoNodes.length, 1);
  assert.equal(parsed.proxies.length, 2);
  assert.equal(parsed.proxies[0].region, "JP");
  assert.equal(parsed.proxies[0].carrier, "IEPL");
  assert.equal(parsed.quota.totalGb, 100);
  assert.equal(parsed.quota.usedGb, 3);
});

test("httpConnectFetch & probeNodeSpeed measure real throughput and catch 0-byte zombie nodes", async () => {
  let mode = "fast";

  // Target HTTP server
  const targetSrv = http.createServer((req, res) => {
    if (mode === "zombie") {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.end(); // 0 bytes!
      return;
    }
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    const chunk = Buffer.alloc(64 * 1024, 65);
    for (let i = 0; i < 16; i++) res.write(chunk); // 1 MB
    res.end();
  });
  await new Promise((r) => targetSrv.listen(0, "127.0.0.1", r));
  const targetPort = targetSrv.address().port;

  // Minimal HTTP CONNECT proxy
  const proxySrv = http.createServer();
  proxySrv.on("connect", (req, clientSocket, head) => {
    const [host, port] = req.url.split(":");
    const upstream = net.connect(Number(port), host, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head && head.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on("error", () => clientSocket.destroy());
    clientSocket.on("error", () => upstream.destroy());
  });
  await new Promise((r) => proxySrv.listen(0, "127.0.0.1", r));
  const proxyPort = proxySrv.address().port;

  try {
    const fast = await probeNodeSpeed({
      proxyPort,
      speedUrl: `http://127.0.0.1:${targetPort}/down`,
      maxBytes: 2 * 1024 * 1024,
      timeoutMs: 3000,
    });
    assert.equal(fast.ok, true);
    assert.equal(fast.zombie, false);
    assert.equal(fast.bytes, 1024 * 1024);
    assert.ok(fast.avgMBps > 0);

    mode = "zombie";
    const zombie = await probeNodeSpeed({
      proxyPort,
      speedUrl: `http://127.0.0.1:${targetPort}/down`,
      maxBytes: 2 * 1024 * 1024,
      timeoutMs: 3000,
    });
    assert.equal(zombie.ok, false);
    assert.equal(zombie.zombie, true);
    assert.equal(zombie.bytes, 0);
  } finally {
    proxySrv.close();
    targetSrv.close();
  }
});

test("benchmarkSupplier + BenchStore + createBenchServer end-to-end flow", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-store-"));
  const store = new BenchStore(path.join(tmpDir, "store.json"));

  const bulk = parseBulkLines(
    "chuixuecloud | https://sub.example.com/1?token=secret | 20\nhttps://other.example.com/2?token=abc",
    true
  );
  assert.equal(bulk.length, 2);
  assert.equal(bulk[0].isPrimary, true);
  assert.equal(bulk[1].isPrimary, false);

  const s1 = store.upsertSupplier(bulk[0]);
  const s2 = store.upsertSupplier(bulk[1]);

  let currentNode = "";
  const mockEngine = async ({ proxies }) => ({
    mixedPort: 17890,
    async selectNode(name) { currentNode = name; },
    async testDelay(name) { return name.includes("Dead") ? null : (name.includes("02") ? 41 : 95); },
    async stop() {},
  });

  const run1 = await benchmarkSupplier(s1, {
    mode: "triage",
    lookupAsn: false,
    fetchSub: async () => parseSubscriptionPayload([
      `vless://11111111-1111-4111-8111-111111111111@cf.example.com:443#${enc("🇯🇵日本·电信01")}`,
      `vless://11111111-1111-4111-8111-111111111111@cf.example.com:443#${enc("🇯🇵日本·电信02")}`,
      `vless://11111111-1111-4111-8111-111111111111@cf.example.com:443#${enc("🇭🇰香港·电信01")}`,
      `vless://11111111-1111-4111-8111-111111111111@cf.example.com:443#${enc("🇺🇸美国·Dead")}`,
    ].join("\n")),
    entryInspectFn: async (host) => ({ host, ip: "104.16.1.1", asn: "AS13335", org: "CLOUDFLARENET", country: "US" }),
    engineFactory: mockEngine,
    speedProbeFn: async () => {
      if (currentNode.includes("02")) return { ok: false, zombie: true, avgMBps: 0, maxMBps: 0, ttfbMs: 45, bytes: 0, error: null };
      if (currentNode.includes("Dead")) return { ok: false, zombie: true, avgMBps: 0, maxMBps: 0, ttfbMs: null, bytes: 0, error: "timeout" };
      return { ok: true, zombie: false, avgMBps: 85.4, maxMBps: 109.2, ttfbMs: 180, bytes: 25 * 1024 * 1024, error: null };
    },
    unlockProbeFn: async () => ({
      exitCountry: currentNode.includes("香港") ? "HK" : "JP",
      chatgpt: currentNode.includes("香港") ? "Blocked(HK)" : "Yes(JP)",
      youtube: "Yes(JP)",
      netflix: "Full(JP)",
      disney: "Yes(JP)",
    }),
  });

  store.addRun(run1);
  assert.equal(run1.summary.entryDiversity.singleEntryWarning, true);
  assert.equal(run1.summary.zombieCount, 1);
  assert.equal(run1.summary.deadCount, 1);
  assert.equal(run1.summary.aliveCount, 2);
  assert.ok(run1.summary.score > 0 && run1.summary.score <= 100);
  assert.equal(maskUrl(s1.url), "https://sub.example.com/1/…?…");

  // Server API test
  const { server, stopTimer } = createBenchServer({ store });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const html = await fetch(base + "/").then((r) => r.text());
    assert.match(html, /Airport Bench/);

    const st = await fetch(base + "/api/state").then((r) => r.json());
    assert.equal(st.suppliers.length, 2);
    assert.equal(st.suppliers[0].maskedUrl.includes("secret"), false);
    assert.equal(st.latestRuns[s1.id].summary.aliveCount, 2);

    const hist = await fetch(base + `/api/runs/${s2.id}`).then((r) => r.json());
    assert.deepEqual(hist.runs, []);
  } finally {
    stopTimer();
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
