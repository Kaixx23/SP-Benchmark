// Subscription fetcher, parser, region/carrier tagger, and mihomo YAML builder.
// Pure Node.js >=20 (zero external dependencies).

const safeDecode = (s) => {
  try { return decodeURIComponent(s); } catch { return s; }
};

const stripBrackets = (s) => String(s || "").replace(/^\[/, "").replace(/\]$/, "");

export function tryDecodeB64(raw) {
  const cleaned = String(raw || "").replace(/\s+/g, "");
  if (!cleaned) return raw;
  try {
    let norm = cleaned.replace(/-/g, "+").replace(/_/g, "/");
    while (norm.length % 4) norm += "=";
    const buf = Buffer.from(norm, "base64").toString("utf8");
    if (buf.includes("://") || buf.includes("STATUS=") || /^proxies\s*:/m.test(buf)) {
      return buf;
    }
  } catch {}
  return raw;
}

export function isInfoNode(name) {
  const n = String(name || "").trim();
  if (!n) return false;
  return /^(剩余流量|距离下次重置|套餐到期|到期时间|流量到期|到期|流量|过期时间|官网|网址|更新订阅|通知|公告|Remaining|Reset in|Expires)/i.test(n)
    || /(剩余流量|套餐到期|官网地址|最新网址|请勿泄露)/i.test(n);
}

const REGION_PATTERNS = [
  ["HK", /(香港|Hong\s*Kong|\bHK\b|🇭🇰)/i],
  ["JP", /(日本|Japan|Tokyo|Osaka|\bJP\b|🇯🇵)/i],
  ["SG", /(新加坡|狮城|Singapore|\bSG\b|🇸🇬)/i],
  ["TW", /(台湾|台灣|Taiwan|Taipei|\bTW\b|🇹🇼)/i],
  ["KR", /(韩国|韓國|Korea|Seoul|\bKR\b|🇰🇷)/i],
  ["US", /(美国|美國|United\s*States|USA|Los\s*Angeles|San\s*Jose|Seattle|\bUS\b|🇺🇸)/i],
  ["GB", /(英国|英國|United\s*Kingdom|\bUK\b|\bGB\b|London|🇬🇧)/i],
  ["DE", /(德国|德國|Germany|Frankfurt|\bDE\b|🇩🇪)/i],
  ["FR", /(法国|法國|France|Paris|\bFR\b|🇫🇷)/i],
  ["CA", /(加拿大|Canada|Toronto|Vancouver|\bCA\b|🇨🇦)/i],
  ["AU", /(澳大利亚|澳洲|Australia|Sydney|\bAU\b|🇦🇺)/i],
];

export function detectRegion(name) {
  const s = String(name || "");
  for (const [code, re] of REGION_PATTERNS) {
    if (re.test(s)) return code;
  }
  return "OTHER";
}

export function detectCarrier(name) {
  const s = String(name || "");
  if (/IEPL|IPLC|专线|內网/i.test(s)) return "IEPL";
  if (/电信|Telecom/i.test(s)) return "Telecom";
  if (/移联|移动|CMI|Mobile/i.test(s)) return "Mobile";
  if (/联通|Unicom/i.test(s)) return "Unicom";
  if (/家宽|原生|住宅|Home/i.test(s)) return "Native";
  return "Standard";
}

export function parseUserInfoHeader(headerVal) {
  if (!headerVal) return null;
  const map = {};
  for (const part of String(headerVal).split(";")) {
    const [k, v] = part.split("=").map((x) => x.trim());
    if (k && v !== undefined && !Number.isNaN(Number(v))) map[k.toLowerCase()] = Number(v);
  }
  if (!Object.keys(map).length) return null;
  const gb = (b) => Math.round((b / (1024 ** 3)) * 100) / 100;
  const up = gb(map.upload || 0);
  const down = gb(map.download || 0);
  const total = gb(map.total || 0);
  const used = Math.round((up + down) * 100) / 100;
  const left = Math.max(0, Math.round((total - used) * 100) / 100);
  let expires = "";
  if (map.expire && map.expire > 0) {
    const ms = map.expire > 1e12 ? map.expire : map.expire * 1000;
    expires = new Date(ms).toISOString().slice(0, 10);
  }
  return { upGb: up, downGb: down, usedGb: used, totalGb: total, leftGb: left, expires };
}

export function parseStatusLine(statusLine) {
  const m = String(statusLine || "").match(/↑:([\d.]+)GB,↓:([\d.]+)GB,TOT:([\d.]+)GB.*?Expires:([\d-]+)/);
  if (!m) return null;
  const up = parseFloat(m[1]), down = parseFloat(m[2]), total = parseFloat(m[3]);
  const used = Math.round((up + down) * 100) / 100;
  return {
    upGb: up,
    downGb: down,
    usedGb: used,
    totalGb: total,
    leftGb: Math.max(0, Math.round((total - used) * 100) / 100),
    expires: m[4],
  };
}

// ---------------- Share-link parsers ----------------

export function parseVless(link) {
  const i = link.indexOf("#");
  const uri = i >= 0 ? link.slice(0, i) : link;
  const frag = i >= 0 ? link.slice(i + 1) : "";
  const m = uri.match(/^vless:\/\/([^@]+)@(\[[^\]]+\]|[^:@]+):(\d+)(?:\?(.*))?$/i);
  if (!m) return null;
  const q = new URLSearchParams(m[4] || "");
  const g = (k) => q.get(k) || "";
  return {
    type: "vless",
    name: safeDecode(frag) || `${stripBrackets(m[2])}:${m[3]}`,
    server: stripBrackets(m[2]),
    port: parseInt(m[3], 10),
    uuid: m[1],
    network: g("type") || "tcp",
    security: g("security"),
    sni: g("sni"),
    fp: g("fp") || "chrome",
    pbk: g("pbk"),
    sid: g("sid"),
    flow: g("flow"),
    path: g("path"),
    host: g("host"),
    serviceName: g("serviceName") || g("servicename"),
    insecure: g("allowInsecure") === "1" || g("insecure") === "1",
    alpn: g("alpn") ? g("alpn").split(",").filter(Boolean) : undefined,
  };
}

export function parseTrojan(link) {
  const i = link.indexOf("#");
  const uri = i >= 0 ? link.slice(0, i) : link;
  const frag = i >= 0 ? link.slice(i + 1) : "";
  const m = uri.match(/^trojan:\/\/([^@]+)@(\[[^\]]+\]|[^:@]+):(\d+)(?:\?(.*))?$/i);
  if (!m) return null;
  const q = new URLSearchParams(m[4] || "");
  const g = (k) => q.get(k) || "";
  return {
    type: "trojan",
    name: safeDecode(frag) || `${stripBrackets(m[2])}:${m[3]}`,
    server: stripBrackets(m[2]),
    port: parseInt(m[3], 10),
    password: safeDecode(m[1]),
    network: g("type") || "tcp",
    sni: g("sni") || g("peer"),
    fp: g("fp") || "chrome",
    path: g("path"),
    host: g("host"),
    serviceName: g("serviceName") || g("servicename"),
    insecure: g("allowInsecure") === "1" || g("insecure") === "1",
  };
}

export function parseVmess(link) {
  let j;
  try {
    let b = link.slice(8).split("#")[0].replace(/-/g, "+").replace(/_/g, "/");
    while (b.length % 4) b += "=";
    j = JSON.parse(Buffer.from(b, "base64").toString("utf8"));
  } catch { return null; }
  if (!j || !j.add || !j.id) return null;
  const port = parseInt(j.port, 10);
  if (!port) return null;
  let net = String(j.net || "tcp").toLowerCase();
  let path = String(j.path || "");
  let host = Array.isArray(j.host) ? String(j.host[0] || "") : String(j.host || "");
  if (net === "tcp" && j.header && String(j.header.type || "").toLowerCase() === "http") {
    net = "http";
    const req = j.header.request || {};
    path = String((Array.isArray(req.path) ? req.path[0] : req.path) || "/");
    const h = req.headers && req.headers.Host;
    host = String((Array.isArray(h) ? h[0] : h) || host);
  }
  return {
    type: "vmess",
    name: String(j.ps || j.remarks || `${j.add}:${port}`),
    server: stripBrackets(j.add),
    port,
    uuid: String(j.id),
    alterId: parseInt(j.aid ?? j.alterId ?? 0, 10) || 0,
    cipher: String(j.scy || "auto"),
    network: net,
    tls: String(j.tls || "").toLowerCase() === "tls",
    sni: String(j.sni || ""),
    fp: String(j.fp || ""),
    path,
    host,
    serviceName: String(j.serviceName || ""),
    insecure: String(j.insecure || j.allowInsecure || "") === "1",
  };
}

export function parseSs(link) {
  const i = link.indexOf("#");
  const uri = i >= 0 ? link.slice(0, i) : link;
  const frag = i >= 0 ? link.slice(i + 1) : "";
  const body = uri.slice(5);
  const decodeB64 = (s) => {
    let norm = s.replace(/-/g, "+").replace(/_/g, "/");
    while (norm.length % 4) norm += "=";
    return Buffer.from(norm, "base64").toString("utf8");
  };
  let method = "", password = "", server = "", port = 0;
  if (body.includes("@")) {
    const [userinfo, rest] = body.split("@");
    const hostPort = rest.split("?")[0];
    const hp = hostPort.match(/^(\[[^\]]+\]|[^:]+):(\d+)/);
    if (!hp) return null;
    server = stripBrackets(hp[1]);
    port = parseInt(hp[2], 10);
    const decodedUser = userinfo.includes(":") ? safeDecode(userinfo) : decodeB64(userinfo);
    const colon = decodedUser.indexOf(":");
    if (colon < 0) return null;
    method = decodedUser.slice(0, colon);
    password = decodedUser.slice(colon + 1);
  } else {
    const full = decodeB64(body.split("?")[0]);
    const m = full.match(/^([^:]+):(.*)@(\[[^\]]+\]|[^:]+):(\d+)$/);
    if (!m) return null;
    method = m[1];
    password = m[2];
    server = stripBrackets(m[3]);
    port = parseInt(m[4], 10);
  }
  if (!server || !port || !method) return null;
  return {
    type: "ss",
    name: safeDecode(frag) || `${server}:${port}`,
    server,
    port,
    cipher: method,
    password,
  };
}

export function parseHysteria2(link) {
  const i = link.indexOf("#");
  const uri = i >= 0 ? link.slice(0, i) : link;
  const frag = i >= 0 ? link.slice(i + 1) : "";
  const m = uri.match(/^(?:hysteria2|hy2):\/\/([^@]+)@(\[[^\]]+\]|[^:@]+):(\d+)(?:\?(.*))?$/i);
  if (!m) return null;
  const q = new URLSearchParams(m[4] || "");
  const g = (k) => q.get(k) || "";
  return {
    type: "hysteria2",
    name: safeDecode(frag) || `${stripBrackets(m[2])}:${m[3]}`,
    server: stripBrackets(m[2]),
    port: parseInt(m[3], 10),
    password: safeDecode(m[1]),
    sni: g("sni"),
    obfs: g("obfs"),
    "obfs-password": g("obfs-password"),
    insecure: g("insecure") === "1" || g("allowInsecure") === "1",
    ports: g("mport") || undefined,
  };
}

export function parseTuic(link) {
  const i = link.indexOf("#");
  const uri = i >= 0 ? link.slice(0, i) : link;
  const frag = i >= 0 ? link.slice(i + 1) : "";
  const m = uri.match(/^tuic:\/\/([^:]+):([^@]+)@(\[[^\]]+\]|[^:@]+):(\d+)(?:\?(.*))?$/i);
  if (!m) return null;
  const q = new URLSearchParams(m[5] || "");
  const g = (k) => q.get(k) || "";
  return {
    type: "tuic",
    name: safeDecode(frag) || `${stripBrackets(m[3])}:${m[4]}`,
    server: stripBrackets(m[3]),
    port: parseInt(m[4], 10),
    uuid: m[1],
    password: safeDecode(m[2]),
    sni: g("sni"),
    "congestion-controller": g("congestion_control") || "bbr",
    "udp-relay-mode": g("udp_relay_mode") || "native",
    "skip-cert-verify": g("allow_insecure") === "1" || g("insecure") === "1",
  };
}

export function parseShareLink(link) {
  const l = String(link || "").trim();
  if (/^vless:\/\//i.test(l)) return parseVless(l);
  if (/^trojan:\/\//i.test(l)) return parseTrojan(l);
  if (/^vmess:\/\//i.test(l)) return parseVmess(l);
  if (/^ss:\/\//i.test(l)) return parseSs(l);
  if (/^(hysteria2|hy2):\/\//i.test(l)) return parseHysteria2(l);
  if (/^tuic:\/\//i.test(l)) return parseTuic(l);
  return null;
}

// ---------------- Lightweight Clash YAML `proxies:` extractor ----------------
// Suppliers often return Clash YAML directly when queried with a Clash UA.
// Extracting `proxies:` as raw YAML blocks or flow objects avoids needing js-yaml
// and preserves exotic mihomo fields (reality-opts, plugin-opts, smux, etc.).

function unquoteYaml(v) {
  const s = String(v || "").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

export function extractClashProxies(yamlText) {
  const lines = String(yamlText || "").split(/\r\n|\r|\n/);
  const start = lines.findIndex((l) => /^proxies\s*:\s*(#.*)?$/.test(l));
  if (start < 0) return [];

  const blocks = [];
  let cur = null;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || /^\s*#/.test(line)) continue;
    // Top-level key ends the `proxies:` section
    if (/^[A-Za-z0-9_-]+\s*:/.test(line)) break;

    const itemStart = line.match(/^\s*-\s+(.*)$/);
    if (itemStart) {
      if (cur) blocks.push(cur);
      cur = [line];
    } else if (cur) {
      cur.push(line);
    }
  }
  if (cur) blocks.push(cur);

  const proxies = [];
  for (const blk of blocks) {
    const raw = blk.join("\n");
    const first = blk[0].replace(/^\s*-\s+/, "").trim();
    let name = "", type = "", server = "", port = 0;

    if (first.startsWith("{")) {
      // Inline flow object: - { name: "...", type: vless, server: ... }
      const nm = raw.match(/(?:^|[,{\s])name\s*:\s*("([^"\\]|\\.)*"|'[^']*'|[^,}\n]+)/);
      const tp = raw.match(/(?:^|[,{\s])type\s*:\s*("([^"\\]|\\.)*"|'[^']*'|[^,}\n]+)/);
      const sv = raw.match(/(?:^|[,{\s])server\s*:\s*("([^"\\]|\\.)*"|'[^']*'|[^,}\n]+)/);
      const pt = raw.match(/(?:^|[,{\s])port\s*:\s*(\d+)/);
      if (nm) name = unquoteYaml(nm[1]);
      if (tp) type = unquoteYaml(tp[1]);
      if (sv) server = unquoteYaml(sv[1]);
      if (pt) port = parseInt(pt[1], 10);
    } else {
      for (const l of blk) {
        const clean = l.replace(/^\s*-\s+/, "").trim();
        const kv = clean.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
        if (!kv) continue;
        const k = kv[1], v = unquoteYaml(kv[2]);
        if (k === "name" && !name) name = v;
        else if (k === "type" && !type) type = v;
        else if (k === "server" && !server) server = v;
        else if (k === "port" && !port) port = parseInt(v, 10) || 0;
      }
    }
    if (!name || !type || !server) continue;
    proxies.push({
      type: type.toLowerCase(),
      name,
      server: stripBrackets(server),
      port,
      rawYamlBlock: raw,
    });
  }
  return proxies;
}

// ---------------- Unified subscription fetcher ----------------

export function parseSubscriptionPayload(rawText, headers = {}) {
  const cleaned = String(rawText || "").replace(/^\uFEFF/, "").trim();
  const decoded = tryDecodeB64(cleaned);

  const headerQuota = parseUserInfoHeader(
    headers["subscription-userinfo"] || headers["Subscription-Userinfo"] || ""
  );

  let proxies = [];
  let statusLine = "";
  let format = "unknown";

  if (/^proxies\s*:/m.test(decoded)) {
    format = "clash-yaml";
    proxies = extractClashProxies(decoded);
  } else {
    const lines = decoded.split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);
    statusLine = lines.find((l) => l.startsWith("STATUS=")) || "";
    const links = lines.filter((l) => /^[a-z0-9+.-]+:\/\//i.test(l));
    if (links.length) {
      format = "share-links";
      for (const link of links) {
        const parsed = parseShareLink(link);
        if (parsed) proxies.push(parsed);
      }
    }
  }

  // Deduplicate display names (mihomo fatally rejects duplicate proxy names)
  const seen = new Set();
  const normalized = [];
  const infoNodes = [];

  for (const p of proxies) {
    if (isInfoNode(p.name)) {
      infoNodes.push(p.name);
      continue;
    }
    let uniqueName = String(p.name || `${p.server}:${p.port}`).replace(/[\r\n]+/g, " ").trim();
    if (seen.has(uniqueName)) {
      let k = 2;
      while (seen.has(`${uniqueName} #${k}`)) k++;
      uniqueName = `${uniqueName} #${k}`;
    }
    seen.add(uniqueName);
    normalized.push({
      ...p,
      name: uniqueName,
      region: detectRegion(uniqueName),
      carrier: detectCarrier(uniqueName),
    });
  }

  const quota = headerQuota || parseStatusLine(statusLine);
  return {
    format,
    quota,
    infoNodes,
    proxies: normalized,
  };
}

export async function fetchAndParseSubscription(url, timeoutMs = 12000) {
  const uas = [
    "clash-verge/v1.7.7",
    "ClashMetaForAndroid/2.10.2",
    "Shadowrocket/2.2.32",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
  ];
  const t0 = Date.now();
  let lastErr = "no response";
  for (const ua of uas) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": ua },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      const hdrs = Object.fromEntries(res.headers.entries());
      const parsed = parseSubscriptionPayload(text, hdrs);
      if (parsed.proxies.length > 0) {
        return {
          ...parsed,
          fetchMs: Date.now() - t0,
          httpStatus: res.status,
          usedUa: ua,
        };
      }
      lastErr = `HTTP ${res.status} with 0 usable proxies (${text.slice(0, 80).replace(/\s+/g, " ")})`;
    } catch (e) {
      lastErr = e.message || String(e);
    }
  }
  throw new Error(`Failed to fetch subscription: ${lastErr}`);
}

// ---------------- mihomo YAML generator for benchmarking ----------------

const yq = (s) => '"' + String(s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';

function normNet(n, proto) {
  const v = String(n || "tcp").toLowerCase();
  const ok = proto === "trojan" ? ["tcp", "ws", "grpc"] : ["tcp", "ws", "grpc", "h2", "http"];
  return ok.includes(v) ? v : "tcp";
}

function serializeProxyBlock(p) {
  if (p.rawYamlBlock) {
    // Ensure its `name:` matches the deduplicated `p.name`
    const replaced = p.rawYamlBlock.replace(
      /(name\s*:\s*)("([^"\\]|\\.)*"|'[^']*'|[^,}\n]+)/,
      `$1${yq(p.name)}`
    );
    return replaced;
  }

  const L = [];
  L.push(`- name: ${yq(p.name)}`);
  L.push(`  type: ${p.type}`);
  L.push(`  server: ${yq(p.server)}`);
  L.push(`  port: ${p.port}`);

  if (p.type === "vless") {
    L.push(`  uuid: ${yq(p.uuid)}`);
    L.push("  udp: true");
    if (p.flow) L.push(`  flow: ${yq(p.flow)}`);
    const net = normNet(p.network, "vless");
    L.push(`  network: ${net}`);
    if (p.security === "tls" || p.security === "reality") {
      L.push("  tls: true");
      L.push(`  servername: ${yq(p.sni || p.host || p.server)}`);
      if (p.insecure) L.push("  skip-cert-verify: true");
      if (p.fp) L.push(`  client-fingerprint: ${yq(p.fp)}`);
      if (p.security === "reality") {
        L.push("  reality-opts:");
        L.push(`    public-key: ${yq(p.pbk || "")}`);
        if (p.sid) L.push(`    short-id: ${yq(p.sid)}`);
      }
    }
    emitTransportOpts(L, net, p);
  } else if (p.type === "vmess") {
    L.push(`  uuid: ${yq(p.uuid)}`);
    L.push(`  alterId: ${p.alterId || 0}`);
    L.push(`  cipher: ${yq(p.cipher || "auto")}`);
    L.push("  udp: true");
    const net = normNet(p.network, "vmess");
    L.push(`  network: ${net}`);
    if (p.tls) {
      L.push("  tls: true");
      if (p.sni || p.host) L.push(`  servername: ${yq(p.sni || p.host)}`);
      if (p.insecure) L.push("  skip-cert-verify: true");
      if (p.fp) L.push(`  client-fingerprint: ${yq(p.fp)}`);
    }
    emitTransportOpts(L, net, p);
  } else if (p.type === "trojan") {
    L.push(`  password: ${yq(p.password)}`);
    L.push("  udp: true");
    if (p.sni) L.push(`  sni: ${yq(p.sni)}`);
    if (p.insecure) L.push("  skip-cert-verify: true");
    if (p.fp) L.push(`  client-fingerprint: ${yq(p.fp)}`);
    const net = normNet(p.network, "trojan");
    L.push(`  network: ${net}`);
    emitTransportOpts(L, net, p);
  } else if (p.type === "ss") {
    L.push(`  cipher: ${yq(p.cipher)}`);
    L.push(`  password: ${yq(p.password)}`);
    L.push("  udp: true");
  } else if (p.type === "hysteria2") {
    L.push(`  password: ${yq(p.password)}`);
    if (p.sni) L.push(`  sni: ${yq(p.sni)}`);
    if (p.insecure) L.push("  skip-cert-verify: true");
    if (p.obfs) L.push(`  obfs: ${yq(p.obfs)}`);
    if (p["obfs-password"]) L.push(`  obfs-password: ${yq(p["obfs-password"])}`);
  } else if (p.type === "tuic") {
    L.push(`  uuid: ${yq(p.uuid)}`);
    L.push(`  password: ${yq(p.password)}`);
    if (p.sni) L.push(`  sni: ${yq(p.sni)}`);
    if (p["congestion-controller"]) L.push(`  congestion-controller: ${yq(p["congestion-controller"])}`);
    if (p["udp-relay-mode"]) L.push(`  udp-relay-mode: ${yq(p["udp-relay-mode"])}`);
    if (p["skip-cert-verify"]) L.push("  skip-cert-verify: true");
  }
  return L.join("\n");
}

function emitTransportOpts(L, net, p) {
  if (net === "ws") {
    L.push("  ws-opts:");
    L.push(`    path: ${yq(p.path || "/")}`);
    if (p.host) {
      L.push("    headers:");
      L.push(`      Host: ${yq(p.host)}`);
    }
  } else if (net === "grpc") {
    L.push("  grpc-opts:");
    L.push(`    grpc-service-name: ${yq(p.serviceName || "")}`);
  } else if (net === "h2") {
    L.push("  h2-opts:");
    L.push(`    path: ${yq(p.path || "/")}`);
    if (p.host) L.push(`    host: [${yq(p.host)}]`);
  } else if (net === "http") {
    L.push("  http-opts:");
    L.push(`    path: [${yq(p.path || "/")}]`);
    if (p.host) {
      L.push("    headers:");
      L.push(`      Host: [${yq(p.host)}]`);
    }
  }
}

export function buildBenchYaml(proxies, opts = {}) {
  const mixedPort = opts.mixedPort || 17890;
  const apiPort = opts.apiPort || 19090;
  const apiSecret = opts.apiSecret || "";
  const cnDns = opts.cnDns !== false;

  const L = [];
  L.push(`mixed-port: ${mixedPort}`);
  L.push("bind-address: 127.0.0.1");
  L.push("allow-lan: false");
  L.push("mode: rule");
  L.push("log-level: warning");
  L.push("ipv6: true");
  L.push("unified-delay: true");
  L.push("tcp-concurrent: true");
  L.push(`external-controller: 127.0.0.1:${apiPort}`);
  if (apiSecret) L.push(`secret: ${yq(apiSecret)}`);
  L.push("profile:");
  L.push("  store-selected: false");

  // Geo-free DNS configuration so mihomo starts instantly without blocking on geoip.metadb
  L.push("dns:");
  L.push("  enable: true");
  L.push("  ipv6: true");
  L.push("  enhanced-mode: fake-ip");
  L.push("  fake-ip-range: 198.18.0.1/16");
  if (cnDns) {
    // Fast inside China for resolving airport entry domains, with global fallback
    L.push("  default-nameserver: [223.5.5.5, 119.29.29.29, 1.1.1.1]");
    L.push("  proxy-server-nameserver: [223.5.5.5, 119.29.29.29, 1.1.1.1]");
    L.push("  nameserver: [223.5.5.5, 1.1.1.1, 8.8.8.8]");
  } else {
    L.push("  default-nameserver: [1.1.1.1, 8.8.8.8]");
    L.push("  proxy-server-nameserver: [1.1.1.1, 8.8.8.8]");
    L.push("  nameserver: [1.1.1.1, 8.8.8.8]");
  }

  L.push("proxies:");
  for (const p of proxies) {
    L.push(serializeProxyBlock(p));
  }

  L.push("proxy-groups:");
  L.push("- name: BENCH");
  L.push("  type: select");
  L.push("  proxies:");
  for (const p of proxies) L.push(`  - ${yq(p.name)}`);

  L.push("rules:");
  L.push("- MATCH,BENCH");
  return L.join("\n") + "\n";
}
