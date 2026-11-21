// Benchmark orchestrator: spawns mihomo per airport, switches nodes via the
// REST controller, runs latency + speed + zombie + unlock + entry-ASN tests,
// computes composite scores, and optionally sends a Telegram digest.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

import { fetchAndParseSubscription, buildBenchYaml } from "./parser.mjs";
import { probeNodeSpeed, probeNodeUnlocks, inspectEntryHost } from "./probe.mjs";
import { findMihomo } from "./setup-mihomo.mjs";

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForMihomoApi(apiBase, secret, proc, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  const headers = secret ? { Authorization: `Bearer ${secret}` } : {};
  let exited = false;
  proc.once("exit", () => { exited = true; });

  while (Date.now() < deadline) {
    if (exited) throw new Error("mihomo exited unexpectedly during startup");
    try {
      const res = await fetch(`${apiBase}/version`, { headers, signal: AbortSignal.timeout(1000) });
      if (res.ok) return await res.json();
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("Timed out waiting for mihomo controller API");
}

export async function startMihomoEngine({ proxies, cnDns = true, binPath = null }) {
  const mihomoBin = binPath || findMihomo();
  if (!mihomoBin) {
    throw new Error("mihomo binary not found. Click 'Install mihomo' or run `npm run setup`.");
  }

  const mixedPort = await getFreePort();
  const apiPort = await getFreePort();
  const secret = crypto.randomBytes(8).toString("hex");
  const apiBase = `http://127.0.0.1:${apiPort}`;

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "airport-bench-"));
  const cfgPath = path.join(workDir, "config.yaml");
  const yaml = buildBenchYaml(proxies, { mixedPort, apiPort, apiSecret: secret, cnDns });
  fs.writeFileSync(cfgPath, yaml, "utf8");

  const proc = spawn(mihomoBin, ["-d", workDir, "-f", cfgPath], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let logs = "";
  const appendLog = (d) => { logs = (logs + d.toString("utf8")).slice(-4000); };
  proc.stdout.on("data", appendLog);
  proc.stderr.on("data", appendLog);

  try {
    await waitForMihomoApi(apiBase, secret, proc, 9000);
  } catch (e) {
    try { proc.kill("SIGKILL"); } catch {}
    fs.rmSync(workDir, { recursive: true, force: true });
    throw new Error(`${e.message}${logs ? ` — logs: ${logs.trim().slice(-300)}` : ""}`);
  }

  const headers = { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" };

  return {
    mixedPort,
    async selectNode(name) {
      const res = await fetch(`${apiBase}/proxies/BENCH`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ name }),
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) throw new Error(`mihomo selectNode(${name}) HTTP ${res.status}`);
    },
    async testDelay(name, timeoutMs = 4500) {
      const u = `${apiBase}/proxies/${encodeURIComponent(name)}/delay?timeout=${timeoutMs}&url=${encodeURIComponent("http://www.gstatic.com/generate_204")}`;
      try {
        const res = await fetch(u, { headers, signal: AbortSignal.timeout(timeoutMs + 1000) });
        if (!res.ok) return null;
        const j = await res.json();
        return typeof j.delay === "number" && j.delay > 0 ? j.delay : null;
      } catch {
        return null;
      }
    },
    async stop() {
      try { proc.kill("SIGTERM"); } catch {}
      await new Promise((r) => setTimeout(r, 200));
      try { if (!proc.killed) proc.kill("SIGKILL"); } catch {}
      try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
    },
  };
}

// ---------------- Selection for Quick Triage vs Full Audit ----------------

export function pickNodesToSpeedTest(nodeRows, mode = "triage", perRegion = 2) {
  if (mode === "full") return nodeRows;
  if (mode === "ping") return nodeRows; // ping mode runs tiny zombie-check on all reachable nodes

  // triage: pick top `perRegion` lowest-delay reachable nodes per region
  const byReg = new Map();
  for (const r of nodeRows) {
    if (!byReg.has(r.region)) byReg.set(r.region, []);
    byReg.get(r.region).push(r);
  }
  const picked = [];
  for (const [, list] of byReg) {
    const alive = list
      .filter((x) => x.delayMs != null)
      .sort((a, b) => a.delayMs - b.delayMs);
    if (alive.length) {
      picked.push(...alive.slice(0, perRegion));
    } else {
      // If ping failed on all nodes in region, still test 1 in case ICMP/204 was filtered
      picked.push(list[0]);
    }
  }
  return picked;
}

// ---------------- Composite Scoring ----------------

export function summarizeRun({ supplier, subInfo, nodeResults, mode }) {
  const total = nodeResults.length;
  const speedTested = nodeResults.filter((n) => n.speedTested);
  const aliveNodes = speedTested.filter((n) => n.alive);
  const zombieNodes = speedTested.filter((n) => n.delayMs != null && n.zombie);
  const deadNodes = speedTested.filter((n) => n.delayMs == null && !n.alive);
  const pingAlive = nodeResults.filter((n) => n.delayMs != null);

  const avgSpeeds = aliveNodes.map((n) => n.avgMBps).sort((a, b) => a - b);
  const maxSpeeds = aliveNodes.map((n) => n.maxMBps).sort((a, b) => a - b);
  const delays = pingAlive.map((n) => n.delayMs).sort((a, b) => a - b);

  const mean = (arr) => (arr.length ? Math.round((arr.reduce((s, x) => s + x, 0) / arr.length) * 100) / 100 : 0);
  const median = (arr) => (arr.length ? arr[Math.floor(arr.length / 2)] : 0);

  const avgSpeedMBps = mean(avgSpeeds);
  const medianSpeedMBps = median(avgSpeeds);
  const peakSpeedMBps = maxSpeeds.length ? maxSpeeds[maxSpeeds.length - 1] : 0;
  const medianDelayMs = median(delays) || null;

  // Best speed per region
  const bestByRegion = {};
  for (const n of aliveNodes) {
    const prev = bestByRegion[n.region];
    if (!prev || n.avgMBps > prev.avgMBps) {
      bestByRegion[n.region] = { name: n.name, avgMBps: n.avgMBps, maxMBps: n.maxMBps, delayMs: n.delayMs };
    }
  }

  // Unlock pass rates (over nodes where unlocks were checked)
  const unlockTested = nodeResults.filter((n) => n.unlocks);
  const rate = (fn) => (unlockTested.length ? Math.round((unlockTested.filter(fn).length / unlockTested.length) * 100) : null);
  const chatgptRate = rate((n) => String(n.unlocks.chatgpt || "").startsWith("Yes"));
  const youtubeRate = rate((n) => String(n.unlocks.youtube || "").startsWith("Yes"));
  const netflixRate = rate((n) => /^(Full|Yes)/i.test(String(n.unlocks.netflix || "")));
  const disneyRate = rate((n) => String(n.unlocks.disney || "").startsWith("Yes"));

  // Entry diversity
  const ipCounts = {};
  const asnSet = new Set();
  for (const n of nodeResults) {
    const ip = n.entry?.ip || n.server;
    ipCounts[ip] = (ipCounts[ip] || 0) + 1;
    if (n.entry?.asn) asnSet.add(`${n.entry.asn}${n.entry.org ? " " + n.entry.org : ""}`);
  }
  const uniqueEntryIps = Object.keys(ipCounts).length;
  const topIpCount = Math.max(0, ...Object.values(ipCounts));
  const topIpShare = total ? Math.round((topIpCount / total) * 100) : 0;
  const singleEntryWarning = total >= 4 && topIpShare >= 70;

  // Composite Score (0 - 100)
  // 1) Speed (35 pts): 60 MB/s avg = full 35 pts, scaled smoothly
  const speedPts = Math.min(35, (avgSpeedMBps / 60) * 35);
  // 2) Alive / Non-zombie rate (25 pts)
  const aliveRatio = speedTested.length ? aliveNodes.length / speedTested.length : (total ? pingAlive.length / total : 0);
  const alivePts = aliveRatio * 25;
  // 3) Latency (15 pts): <= 60ms = 15, >= 400ms = 0
  const delayPts = medianDelayMs == null
    ? 0
    : Math.max(0, Math.min(15, ((400 - medianDelayMs) / 340) * 15));
  // 4) AI + Streaming Unlocks (15 pts)
  const unlockAvg = [chatgptRate, netflixRate, youtubeRate].filter((v) => v != null);
  const unlockPts = unlockAvg.length ? (unlockAvg.reduce((a, b) => a + b, 0) / unlockAvg.length / 100) * 15 : 7.5;
  // 5) Entry Diversity (10 pts)
  const diversityRatio = total ? Math.min(1, uniqueEntryIps / Math.min(total, 8)) : 0;
  const diversityPts = diversityRatio * 10;

  const score = Math.round(speedPts + alivePts + delayPts + unlockPts + diversityPts);
  const grade = score >= 85 ? "S" : score >= 72 ? "A" : score >= 55 ? "B" : score >= 40 ? "C" : "D";

  return {
    mode,
    totalNodes: total,
    pingAliveCount: pingAlive.length,
    speedTestedCount: speedTested.length,
    aliveCount: aliveNodes.length,
    zombieCount: zombieNodes.length,
    deadCount: deadNodes.length,
    avgSpeedMBps,
    medianSpeedMBps,
    peakSpeedMBps,
    medianDelayMs,
    bestByRegion,
    unlockRates: {
      tested: unlockTested.length,
      chatgpt: chatgptRate,
      youtube: youtubeRate,
      netflix: netflixRate,
      disney: disneyRate,
    },
    entryDiversity: {
      uniqueIps: uniqueEntryIps,
      topIpSharePct: topIpShare,
      singleEntryWarning,
      asns: [...asnSet].slice(0, 8),
    },
    subFetchMs: subInfo.fetchMs || 0,
    subFormat: subInfo.format,
    quota: subInfo.quota || null,
    score,
    grade,
  };
}

// ---------------- Main Airport Runner ----------------

export async function benchmarkSupplier(supplier, opts = {}) {
  const mode = opts.mode || "triage"; // "triage" | "full" | "ping"
  const payloadMb = Number(opts.payloadMb || 25);
  const maxBytes = mode === "ping" ? 512 * 1024 : payloadMb * 1024 * 1024;
  const speedTimeoutMs = mode === "ping" ? 4500 : (opts.speedTimeoutMs || 8500);
  const defaultCfUrl = "https://speed.cloudflare.com/__down?bytes=25000000";
  const resolvedCustomUrl = opts.speedUrl && opts.speedUrl !== defaultCfUrl ? opts.speedUrl : "";
  const speedUrl = mode === "ping"
    ? "https://speed.cloudflare.com/__down?bytes=524288"
    : (resolvedCustomUrl || `https://speed.cloudflare.com/__down?bytes=${maxBytes}`);
  const cnDns = opts.cnDns !== false;
  const onProgress = opts.onProgress || (() => {});
  const signal = opts.signal;
  const engineFactory = opts.engineFactory || startMihomoEngine;
  const fetchSub = opts.fetchSub || fetchAndParseSubscription;
  const speedProbeFn = opts.speedProbeFn || probeNodeSpeed;
  const unlockProbeFn = opts.unlockProbeFn || probeNodeUnlocks;
  const entryInspectFn = opts.entryInspectFn || inspectEntryHost;

  const startedAt = new Date().toISOString();
  onProgress({ phase: "fetch", supplierId: supplier.id, supplierName: supplier.name, message: "Fetching subscription..." });

  const sub = await fetchSub(supplier.url);
  if (!sub.proxies.length) {
    throw new Error("Subscription returned 0 usable proxy nodes");
  }

  // Entry DNS + ASN lookup (deduped by host)
  onProgress({ phase: "dns", supplierId: supplier.id, supplierName: supplier.name, message: `Inspecting ${sub.proxies.length} entry servers...` });
  const uniqueHosts = [...new Set(sub.proxies.map((p) => p.server))];
  const entryMap = new Map();
  await Promise.all(uniqueHosts.map(async (h) => {
    entryMap.set(h, await entryInspectFn(h, opts.lookupAsn !== false));
  }));

  onProgress({ phase: "mihomo", supplierId: supplier.id, supplierName: supplier.name, message: "Starting mihomo engine..." });
  const engine = await engineFactory({ proxies: sub.proxies, cnDns });

  const nodeResults = sub.proxies.map((p) => ({
    name: p.name,
    type: p.type,
    server: p.server,
    port: p.port,
    region: p.region,
    carrier: p.carrier,
    entry: entryMap.get(p.server) || { host: p.server, ip: p.server, asn: "", org: "", country: "" },
    delayMs: null,
    speedTested: false,
    alive: false,
    zombie: false,
    avgMBps: 0,
    maxMBps: 0,
    ttfbMs: null,
    bytes: 0,
    unlocks: null,
    error: null,
  }));

  try {
    // Stage 1: Delay probe for all nodes (fast parallel batches of 5)
    for (let i = 0; i < nodeResults.length; i += 5) {
      if (signal?.aborted) throw new Error("Benchmark cancelled by user");
      const batch = nodeResults.slice(i, i + 5);
      await Promise.all(batch.map(async (row) => {
        row.delayMs = await engine.testDelay(row.name);
      }));
      onProgress({
        phase: "delay",
        supplierId: supplier.id,
        supplierName: supplier.name,
        done: Math.min(i + 5, nodeResults.length),
        total: nodeResults.length,
        message: `Ping check ${Math.min(i + 5, nodeResults.length)}/${nodeResults.length}`,
      });
    }

    // Stage 2: Select nodes for real download speed + unlock checks
    const targets = pickNodesToSpeedTest(nodeResults, mode, opts.perRegion || 2);
    for (let i = 0; i < targets.length; i++) {
      if (signal?.aborted) throw new Error("Benchmark cancelled by user");
      const row = targets[i];
      row.speedTested = true;

      onProgress({
        phase: "speed",
        supplierId: supplier.id,
        supplierName: supplier.name,
        nodeName: row.name,
        done: i + 1,
        total: targets.length,
        message: `Testing ${row.name} (${i + 1}/${targets.length})`,
      });

      await engine.selectNode(row.name);

      const sp = await speedProbeFn({
        proxyPort: engine.mixedPort,
        speedUrl,
        maxBytes,
        timeoutMs: speedTimeoutMs,
      });

      row.alive = sp.ok;
      row.zombie = sp.zombie;
      row.avgMBps = sp.avgMBps;
      row.maxMBps = sp.maxMBps;
      row.ttfbMs = sp.ttfbMs;
      row.bytes = sp.bytes;
      row.error = sp.error;

      // Run unlock probes on live nodes when mode is full or triage
      if (mode !== "ping" && row.alive) {
        row.unlocks = await unlockProbeFn({ proxyPort: engine.mixedPort, timeoutMs: 5500 });
      }

      onProgress({
        phase: "node_done",
        supplierId: supplier.id,
        supplierName: supplier.name,
        nodeName: row.name,
        avgMBps: row.avgMBps,
        maxMBps: row.maxMBps,
        alive: row.alive,
        zombie: row.zombie,
        done: i + 1,
        total: targets.length,
      });
    }
  } finally {
    await engine.stop();
  }

  const summary = summarizeRun({ supplier, subInfo: sub, nodeResults, mode });

  return {
    id: crypto.randomBytes(6).toString("hex"),
    supplierId: supplier.id,
    supplierName: supplier.name,
    isPrimary: Boolean(supplier.isPrimary),
    priceMonthly: supplier.priceMonthly ?? null,
    currency: supplier.currency || "RMB",
    startedAt,
    finishedAt: new Date().toISOString(),
    summary,
    nodes: nodeResults,
  };
}

// ---------------- Telegram Notification ----------------

export async function sendTelegramDigest({ botToken, chatId, runs }) {
  if (!botToken || !chatId || !runs.length) return { sent: false, reason: "missing config or runs" };
  const sorted = [...runs].sort((a, b) => b.summary.score - a.summary.score);
  const lines = [
    `📊 Airport Bench Report (${new Date().toLocaleString("zh-CN", { hour12: false })})`,
    "",
  ];
  for (const r of sorted) {
    const s = r.summary;
    const tag = r.isPrimary ? " ⭐PRIMARY" : "";
    const gpt = s.unlockRates.chatgpt != null ? ` | GPT ${s.unlockRates.chatgpt}%` : "";
    lines.push(
      `• ${r.supplierName}${tag} — Score ${s.score} (${s.grade})\n` +
      `  Avg ${s.avgSpeedMBps} MB/s (Peak ${s.peakSpeedMBps}) | Alive ${s.aliveCount}/${s.speedTestedCount} | Ping ${s.medianDelayMs ?? "-"}ms${gpt}`
    );
  }
  const text = lines.join("\n");
  const res = await fetch(`https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
    signal: AbortSignal.timeout(10000),
  });
  return { sent: res.ok, status: res.status };
}

export async function sendTelegramStabilityReport({ botToken, chatId, report }) {
  if (!botToken || !chatId || !report) return { sent: false, reason: "missing config or report" };
  const tested = (report.rankings || []).filter((r) => r.runCount > 0);
  const lines = [
    `🏆 Daily VPN Stability Report (${report.windowHours > 0 ? `Last ${report.windowHours}h` : "All History"})`,
    `${report.verdict}`,
    "",
  ];
  tested.forEach((r, idx) => {
    const tag = r.isPrimary ? " ⭐PRIMARY" : "";
    const peak = r.eveningPeakAvgMBps != null
      ? ` | PeakHr ${r.eveningPeakAvgMBps}MB/s${r.peakDropPct != null ? ` (${r.peakDropPct >= 0 ? "+" : ""}${r.peakDropPct}%)` : ""}`
      : "";
    lines.push(
      `#${idx + 1} ${r.name}${tag} — Stability ${r.stabilityScore}/100 (${r.stabilityGrade})\n` +
      `   Mean ${r.meanSpeedMBps} MB/s (Floor ${r.p10SpeedMBps}) | Uptime ${r.uptimePct}% (${r.runCount} runs)${peak}`
    );
  });
  const text = lines.join("\n").slice(0, 4000);
  const res = await fetch(`https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
    signal: AbortSignal.timeout(10000),
  });
  return { sent: res.ok, status: res.status };
}
