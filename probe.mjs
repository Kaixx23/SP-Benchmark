// Pure Node.js HTTP-CONNECT proxy client for speed, TTFB, zombie detection,
// streaming/AI unlock probes, and entry IP/ASN diversity analysis.

import net from "node:net";
import tls from "node:tls";
import dns from "node:dns/promises";

export function httpConnectFetch({
  proxyHost = "127.0.0.1",
  proxyPort,
  url,
  method = "GET",
  headers = {},
  maxBytes = 25 * 1024 * 1024,
  collectBodyMax = 0,
  timeoutMs = 10000,
}) {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const targetHost = parsed.hostname;
    const targetPort = Number(parsed.port) || (isHttps ? 443 : 80);
    const path = (parsed.pathname || "/") + (parsed.search || "");

    const tStart = performance.now();
    let settled = false;
    let rawSocket = null;
    let streamSocket = null;

    let status = 0;
    let respHeaders = {};
    let headerParsed = false;
    let headerBuf = Buffer.alloc(0);
    let isChunked = false;
    let chunkPending = Buffer.alloc(0);
    let chunkRemaining = -1; // -1 = reading chunk-size line; >=0 = reading chunk data bytes
    let chunkSkipCrlf = false;

    let bytes = 0;
    let ttfbMs = null;
    let tlsMs = null;
    let bodyChunks = [];
    let bodyCollected = 0;

    // 500ms sliding bucket for peak speed (Max MB/s)
    let bucketStart = performance.now();
    let bucketBytes = 0;
    let maxMBps = 0;

    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { streamSocket?.destroy(); } catch {}
      try { rawSocket?.destroy(); } catch {}

      const totalMs = Math.max(1, performance.now() - tStart);
      const dataMs = ttfbMs != null ? Math.max(1, performance.now() - (tStart + ttfbMs)) : totalMs;
      const avgMBps = bytes > 0 ? (bytes / (1024 * 1024)) / (dataMs / 1000) : 0;

      // Flush final partial bucket if >= 150ms
      const finalWin = performance.now() - bucketStart;
      if (finalWin >= 150 && bucketBytes > 0) {
        const mbps = (bucketBytes / (1024 * 1024)) / (finalWin / 1000);
        if (mbps > maxMBps) maxMBps = mbps;
      }
      if (avgMBps > maxMBps) maxMBps = avgMBps;

      resolve({
        status,
        headers: respHeaders,
        bodyText: collectBodyMax > 0 ? Buffer.concat(bodyChunks).toString("utf8") : "",
        bytes,
        elapsedMs: Math.round(totalMs),
        ttfbMs: ttfbMs != null ? Math.round(ttfbMs) : null,
        tlsMs: tlsMs != null ? Math.round(tlsMs) : null,
        avgMBps: Math.round(avgMBps * 100) / 100,
        maxMBps: Math.round(maxMBps * 100) / 100,
        error,
      });
    };

    const timer = setTimeout(() => {
      // If we already got data and hit the time cap, return partial speed cleanly
      if (bytes > 0 && status >= 200 && status < 400) finish(null);
      else finish("timeout");
    }, timeoutMs);

    rawSocket = net.connect(proxyPort, proxyHost);
    rawSocket.setNoDelay(true);
    rawSocket.on("error", (e) => finish(e.message || "proxy socket error"));

    let connectBuf = Buffer.alloc(0);
    let tunnelReady = false;

    const onConnectData = (chunk) => {
      if (settled || tunnelReady) return;
      connectBuf = Buffer.concat([connectBuf, chunk]);
      const idx = connectBuf.indexOf("\r\n\r\n");
      if (idx < 0) return;

      const head = connectBuf.slice(0, idx).toString("utf8");
      const leftover = connectBuf.slice(idx + 4);
      const statusLine = head.split("\r\n")[0] || "";
      if (!/^HTTP\/1\.[01]\s+200\b/i.test(statusLine)) {
        return finish(`CONNECT rejected: ${statusLine}`);
      }

      tunnelReady = true;
      rawSocket.removeListener("data", onConnectData);

      const startHttp = (sock) => {
        streamSocket = sock;
        sock.on("error", (e) => {
          if (bytes > 0 && status >= 200 && status < 400) finish(null);
          else finish(e.message || "tls/http error");
        });
        sock.on("close", () => finish(status ? null : "connection closed early"));
        sock.on("end", () => finish(null));

        const onHttpData = (data) => {
          if (settled) return;
          if (!headerParsed) {
            headerBuf = Buffer.concat([headerBuf, data]);
            const hEnd = headerBuf.indexOf("\r\n\r\n");
            if (hEnd < 0) return;
            const rawHead = headerBuf.slice(0, hEnd).toString("utf8");
            const firstPayload = headerBuf.slice(hEnd + 4);
            headerBuf = Buffer.alloc(0);

            const lines = rawHead.split("\r\n");
            const m = (lines[0] || "").match(/^HTTP\/\d\.\d\s+(\d{3})/);
            status = m ? parseInt(m[1], 10) : 0;
            for (let i = 1; i < lines.length; i++) {
              const c = lines[i].indexOf(":");
              if (c > 0) {
                const k = lines[i].slice(0, c).trim().toLowerCase();
                const v = lines[i].slice(c + 1).trim();
                respHeaders[k] = v;
              }
            }
            headerParsed = true;
            isChunked = String(respHeaders["transfer-encoding"] || "").toLowerCase().includes("chunked");
            ttfbMs = performance.now() - tStart;
            bucketStart = performance.now();

            if (firstPayload.length > 0) handleRawBody(firstPayload);
          } else {
            handleRawBody(data);
          }
        };

        const handleRawBody = (buf) => {
          if (!isChunked) {
            handleBodyChunk(buf);
            return;
          }
          chunkPending = Buffer.concat([chunkPending, buf]);
          while (chunkPending.length > 0 && !settled) {
            if (chunkSkipCrlf) {
              if (chunkPending.length < 2) break;
              chunkPending = chunkPending.slice(2);
              chunkSkipCrlf = false;
              continue;
            }
            if (chunkRemaining < 0) {
              const lineEnd = chunkPending.indexOf("\r\n");
              if (lineEnd < 0) break;
              const sizeLine = chunkPending.slice(0, lineEnd).toString("ascii").split(";")[0].trim();
              chunkPending = chunkPending.slice(lineEnd + 2);
              const sz = parseInt(sizeLine, 16);
              if (Number.isNaN(sz)) {
                finish("invalid chunked encoding");
                return;
              }
              if (sz === 0) {
                finish(null);
                return;
              }
              chunkRemaining = sz;
            } else {
              const take = Math.min(chunkRemaining, chunkPending.length);
              if (take > 0) {
                const payload = chunkPending.slice(0, take);
                chunkPending = chunkPending.slice(take);
                chunkRemaining -= take;
                handleBodyChunk(payload);
              }
              if (chunkRemaining === 0) {
                chunkRemaining = -1;
                chunkSkipCrlf = true;
              }
            }
          }
        };

        const handleBodyChunk = (chunkBuf) => {
          if (settled) return;
          bytes += chunkBuf.length;
          bucketBytes += chunkBuf.length;

          if (collectBodyMax > 0 && bodyCollected < collectBodyMax) {
            const take = chunkBuf.slice(0, collectBodyMax - bodyCollected);
            bodyChunks.push(take);
            bodyCollected += take.length;
          }

          const now = performance.now();
          const win = now - bucketStart;
          if (win >= 500) {
            const mbps = (bucketBytes / (1024 * 1024)) / (win / 1000);
            if (mbps > maxMBps) maxMBps = mbps;
            bucketStart = now;
            bucketBytes = 0;
          }

          if (bytes >= maxBytes) {
            finish(null);
          }
        };

        sock.on("data", onHttpData);

        const reqHeaders = {
          Host: parsed.host,
          "User-Agent": "curl/8.5.0",
          Accept: "*/*",
          "Accept-Encoding": "identity",
          Connection: "close",
          ...headers,
        };
        const reqText =
          `${method} ${path} HTTP/1.1\r\n` +
          Object.entries(reqHeaders).map(([k, v]) => `${k}: ${v}`).join("\r\n") +
          "\r\n\r\n";
        sock.write(reqText);
      };

      if (isHttps) {
        const tTls0 = performance.now();
        const tlsSock = tls.connect({
          socket: rawSocket,
          servername: targetHost,
          rejectUnauthorized: true,
        });
        tlsSock.once("secureConnect", () => {
          tlsMs = performance.now() - tTls0;
          startHttp(tlsSock);
        });
        tlsSock.on("error", (e) => finish(`TLS error: ${e.message}`));
        if (leftover.length) tlsSock.unshift(leftover);
      } else {
        startHttp(rawSocket);
        if (leftover.length) rawSocket.emit("data", leftover);
      }
    };

    rawSocket.on("connect", () => {
      rawSocket.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n\r\n`);
    });
    rawSocket.on("data", onConnectData);
  });
}

// ---------------- Speed & Zombie probe ----------------

export async function probeNodeSpeed({
  proxyPort,
  speedUrl = "https://speed.cloudflare.com/__down?bytes=25000000",
  maxBytes = 25 * 1024 * 1024,
  timeoutMs = 9000,
}) {
  const res = await httpConnectFetch({
    proxyPort,
    url: speedUrl,
    maxBytes,
    timeoutMs,
  });

  const ok = !res.error && res.status >= 200 && res.status < 400 && res.bytes >= 32 * 1024;
  const zombie = !ok || res.avgMBps < 0.02; // < ~20 KB/s or 0 B/s
  return {
    ok: ok && !zombie,
    zombie,
    status: res.status,
    bytes: res.bytes,
    avgMBps: res.avgMBps,
    maxMBps: res.maxMBps,
    ttfbMs: res.ttfbMs,
    tlsMs: res.tlsMs,
    elapsedMs: res.elapsedMs,
    error: res.error,
  };
}

// ---------------- Streaming & AI Unlocks ----------------

export async function probeNodeUnlocks({ proxyPort, timeoutMs = 6000 }) {
  const out = {
    exitCountry: "",
    exitIp: "",
    chatgpt: "unknown",
    youtube: "unknown",
    netflix: "unknown",
    disney: "unknown",
  };

  // 1. Exit trace + ChatGPT trace
  const [cfTrace, gptRes, ytRes, nfNonOrig, nfOrig, dpRes] = await Promise.all([
    httpConnectFetch({
      proxyPort,
      url: "https://www.cloudflare.com/cdn-cgi/trace",
      maxBytes: 4096,
      collectBodyMax: 4096,
      timeoutMs,
    }),
    httpConnectFetch({
      proxyPort,
      url: "https://chatgpt.com/cdn-cgi/trace",
      maxBytes: 4096,
      collectBodyMax: 4096,
      timeoutMs,
    }),
    httpConnectFetch({
      proxyPort,
      url: "https://www.youtube.com/premium",
      maxBytes: 128 * 1024,
      collectBodyMax: 128 * 1024,
      timeoutMs,
      headers: { "Accept-Language": "en-US,en;q=0.9" },
    }),
    httpConnectFetch({
      proxyPort,
      url: "https://www.netflix.com/title/81280792",
      maxBytes: 32 * 1024,
      collectBodyMax: 16 * 1024,
      timeoutMs,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36" },
    }),
    httpConnectFetch({
      proxyPort,
      url: "https://www.netflix.com/title/80018499",
      maxBytes: 16 * 1024,
      collectBodyMax: 4096,
      timeoutMs,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36" },
    }),
    httpConnectFetch({
      proxyPort,
      url: "https://www.disneyplus.com/",
      maxBytes: 32 * 1024,
      collectBodyMax: 8192,
      timeoutMs,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36" },
    }),
  ]);

  const parseTrace = (txt) => {
    const map = {};
    for (const line of String(txt || "").split(/\r?\n/)) {
      const i = line.indexOf("=");
      if (i > 0) map[line.slice(0, i)] = line.slice(i + 1).trim();
    }
    return map;
  };

  if (cfTrace.status === 200) {
    const t = parseTrace(cfTrace.bodyText);
    out.exitCountry = t.loc || "";
    out.exitIp = t.ip || "";
  }

  // ChatGPT: unsupported in CN, HK, MO, RU, BY, IR, KP, SY
  const gptBlockedLocs = new Set(["CN", "HK", "MO", "RU", "BY", "IR", "KP", "SY"]);
  if (gptRes.status === 200) {
    const t = parseTrace(gptRes.bodyText);
    const loc = t.loc || out.exitCountry;
    if (loc && gptBlockedLocs.has(loc.toUpperCase())) out.chatgpt = `Blocked(${loc})`;
    else if (loc) out.chatgpt = `Yes(${loc})`;
    else out.chatgpt = "Yes";
  } else if (gptRes.status === 403 || gptRes.status === 451) {
    out.chatgpt = "Blocked";
  } else if (gptRes.error) {
    out.chatgpt = "Fail";
  }

  // YouTube
  if (ytRes.status === 200) {
    const m = ytRes.bodyText.match(/"countryCode":"([A-Z]{2})"/);
    out.youtube = m ? `Yes(${m[1]})` : (out.exitCountry ? `Yes(${out.exitCountry})` : "Yes");
  } else if (ytRes.status >= 300 && ytRes.status < 400) {
    out.youtube = out.exitCountry ? `Yes(${out.exitCountry})` : "Yes";
  } else if (ytRes.error) {
    out.youtube = "Fail";
  }

  // Netflix: 200 on 81280792 -> Full; 404 on 81280792 + 200 on 80018499 -> Originals
  if (nfNonOrig.status === 200) {
    const locHdr = nfNonOrig.headers["x-originating-url"] || "";
    const rm = locHdr.match(/netflix\.com\/([a-z]{2}(?:-[a-z]{2})?)\//i);
    const region = rm ? rm[1].toUpperCase() : out.exitCountry;
    out.netflix = region ? `Full(${region})` : "Full";
  } else if (nfNonOrig.status === 404 && nfOrig.status === 200) {
    out.netflix = "Originals";
  } else if (nfNonOrig.status === 403 || nfOrig.status === 403) {
    out.netflix = "Blocked";
  } else if (nfNonOrig.status === 301 || nfNonOrig.status === 302) {
    const loc = nfNonOrig.headers.location || "";
    const rm = loc.match(/netflix\.com\/([a-z]{2})\//i);
    out.netflix = rm ? `Full(${rm[1].toUpperCase()})` : "Yes";
  } else if (nfNonOrig.error) {
    out.netflix = "Fail";
  }

  // Disney+
  if (dpRes.status === 200) {
    out.disney = out.exitCountry ? `Yes(${out.exitCountry})` : "Yes";
  } else if (dpRes.status === 301 || dpRes.status === 302) {
    const loc = String(dpRes.headers.location || "");
    if (/unavailable|blocked|sorry/i.test(loc)) out.disney = "Blocked";
    else out.disney = out.exitCountry ? `Yes(${out.exitCountry})` : "Yes";
  } else if (dpRes.status === 403 || dpRes.status === 451) {
    out.disney = "Blocked";
  } else if (dpRes.error) {
    out.disney = "Fail";
  }

  return out;
}

// ---------------- Entry Server DNS + ASN Diversity ----------------

const asnCache = new Map();

export async function inspectEntryHost(host, lookupAsn = true) {
  let ip = host;
  if (!net.isIP(host)) {
    try {
      const res = await dns.lookup(host, { family: 4 });
      ip = res.address;
    } catch {
      try {
        const res = await dns.lookup(host);
        ip = res.address;
      } catch {
        ip = host;
      }
    }
  }

  if (asnCache.has(ip)) return asnCache.get(ip);

  const info = { host, ip, asn: "", org: "", country: "" };
  if (lookupAsn && net.isIP(ip)) {
    try {
      const r = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,countryCode,as,org,isp`, {
        signal: AbortSignal.timeout(2500),
      });
      if (r.ok) {
        const j = await r.json();
        if (j && j.status === "success") {
          info.country = j.countryCode || "";
          info.org = j.org || j.isp || "";
          const asMatch = String(j.as || "").match(/^(AS\d+)/i);
          info.asn = asMatch ? asMatch[1].toUpperCase() : "";
        }
      }
    } catch {
      // Offline or rate-limited: degrade gracefully without failing benchmark
    }
  }
  asnCache.set(ip, info);
  return info;
}
