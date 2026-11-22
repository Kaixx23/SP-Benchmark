// Local Web Server + SSE live progress + daily evening-peak scheduler.
// Start on Windows/Mac/Linux: `node server.mjs`

import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BenchStore, maskUrl } from "./store.mjs";
import { benchmarkSupplier, sendTelegramDigest } from "./runner.mjs";
import { getMihomoStatus, installMihomo } from "./setup-mihomo.mjs";
import { renderUiHtml } from "./ui.js";
import { renderReportHtml } from "./report-ui.js";
import { buildDeepReport } from "./analysis.mjs";

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 2 * 1024 * 1024) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const txt = Buffer.concat(chunks).toString("utf8").trim();
      if (!txt) return resolve({});
      try { resolve(JSON.parse(txt)); } catch { reject(new Error("Invalid JSON body")); }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

export function parseBulkLines(text, markFirstPrimary = false) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const parsed = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes("|")) {
      const parts = line.split("|").map((p) => p.trim());
      const urlPart = parts.find((p) => /^https?:\/\//i.test(p));
      if (!urlPart) continue;
      const nonUrl = parts.filter((p) => p !== urlPart);
      const name = nonUrl[0] || "";
      const price = nonUrl[1] && !Number.isNaN(Number(nonUrl[1])) ? Number(nonUrl[1]) : null;
      parsed.push({ name, url: urlPart, priceMonthly: price, isPrimary: markFirstPrimary && parsed.length === 0 });
    } else if (/^https?:\/\//i.test(line)) {
      parsed.push({ name: "", url: line, priceMonthly: null, isPrimary: markFirstPrimary && parsed.length === 0 });
    }
  }
  return parsed;
}

export function createBenchServer({ store = new BenchStore(), benchFn = benchmarkSupplier } = {}) {
  const sseClients = new Set();
  let activeController = null;
  let running = false;

  const broadcast = (payload) => {
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of sseClients) {
      try { res.write(data); } catch { sseClients.delete(res); }
    }
  };

  async function startRun({ supplierId = null, mode = "triage", payloadMb = 25, cnDns = true } = {}) {
    if (running) throw new Error("A benchmark is already running");
    const suppliers = store.listSuppliers();
    const targets = supplierId ? suppliers.filter((s) => s.id === supplierId) : suppliers;
    if (!targets.length) throw new Error("No suppliers to test");

    running = true;
    activeController = new AbortController();
    const st = store.getSettings();
    const completedRuns = [];
    let runError = null;

    (async () => {
      try {
        for (const sup of targets) {
          if (activeController.signal.aborted) break;
          try {
            const run = await benchFn(sup, {
              mode,
              payloadMb,
              cnDns,
              speedUrl: st.speedUrl,
              signal: activeController.signal,
              onProgress: (data) => broadcast({ type: "progress", data }),
            });
            store.addRun(run);
            completedRuns.push(run);
            broadcast({ type: "supplier_done", supplierId: sup.id, runId: run.id });
          } catch (e) {
            runError = e.message || String(e);
            broadcast({ type: "progress", data: { phase: "error", supplierName: sup.name, message: `Failed: ${runError}` } });
          }
        }
        if (completedRuns.length && st.telegramBotToken && st.telegramChatId) {
          await sendTelegramDigest({
            botToken: st.telegramBotToken,
            chatId: st.telegramChatId,
            runs: completedRuns,
          }).catch(() => {});
        }
      } finally {
        running = false;
        activeController = null;
        broadcast({ type: "run_finished", error: runError, count: completedRuns.length });
      }
    })();

    return { started: true, targets: targets.length };
  }

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url || "/", "http://127.0.0.1");
    const pathname = u.pathname;

    try {
      if (req.method === "GET" && pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderUiHtml());
        return;
      }

      if (req.method === "GET" && pathname === "/report") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderReportHtml());
        return;
      }

      if (req.method === "GET" && pathname === "/api/report") {
        sendJson(res, 200, buildDeepReport(store.listRuns(), store.listSuppliers()));
        return;
      }

      if (req.method === "GET" && pathname === "/api/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        res.write(`data: ${JSON.stringify({ type: "hello" })}\n\n`);
        sseClients.add(res);
        req.on("close", () => sseClients.delete(res));
        return;
      }

      if (req.method === "GET" && pathname === "/api/state") {
        const suppliers = store.listSuppliers().map((s) => ({
          id: s.id,
          name: s.name,
          maskedUrl: maskUrl(s.url),
          priceMonthly: s.priceMonthly,
          currency: s.currency,
          isPrimary: s.isPrimary,
          notes: s.notes,
        }));
        const latestRuns = store.latestRunBySupplier();
        const st = store.getSettings();
        sendJson(res, 200, {
          suppliers,
          latestRuns,
          running,
          mihomo: getMihomoStatus(),
          settings: {
            ...st,
            telegramBotToken: st.telegramBotToken ? "••••" + st.telegramBotToken.slice(-6) : "",
          },
        });
        return;
      }

      if (req.method === "POST" && pathname === "/api/suppliers/bulk") {
        const body = await readJsonBody(req);
        const items = parseBulkLines(body.text, Boolean(body.markFirstPrimary));
        if (!items.length) return sendJson(res, 400, { error: "No valid http(s) URLs found" });
        const added = items.map((it) => store.upsertSupplier(it));
        sendJson(res, 200, { added: added.map((a) => ({ id: a.id, name: a.name })) });
        return;
      }

      const primMatch = pathname.match(/^\/api\/suppliers\/([^/]+)\/primary$/);
      if (req.method === "POST" && primMatch) {
        const sup = store.listSuppliers().find((s) => s.id === primMatch[1]);
        if (!sup) return sendJson(res, 404, { error: "Supplier not found" });
        store.upsertSupplier({ ...sup, isPrimary: true });
        sendJson(res, 200, { ok: true });
        return;
      }

      const delMatch = pathname.match(/^\/api\/suppliers\/([^/]+)$/);
      if (req.method === "DELETE" && delMatch) {
        store.removeSupplier(delMatch[1]);
        sendJson(res, 200, { ok: true });
        return;
      }

      const runsMatch = pathname.match(/^\/api\/runs\/([^/]+)$/);
      if (req.method === "GET" && runsMatch) {
        sendJson(res, 200, { runs: store.listRuns(runsMatch[1]) });
        return;
      }

      if (req.method === "POST" && pathname === "/api/run") {
        const body = await readJsonBody(req);
        const info = await startRun({
          supplierId: body.supplierId || null,
          mode: body.mode || "triage",
          payloadMb: Number(body.payloadMb || 25),
          cnDns: body.cnDns !== false,
        });
        sendJson(res, 200, info);
        return;
      }

      if (req.method === "POST" && pathname === "/api/stop") {
        if (activeController) activeController.abort();
        sendJson(res, 200, { stopped: true });
        return;
      }

      if (req.method === "POST" && pathname === "/api/setup-mihomo") {
        const body = await readJsonBody(req);
        const st = await installMihomo({
          mirrorPrefix: body.mirrorPrefix || "",
          onLog: (msg) => broadcast({ type: "progress", data: { phase: "setup", supplierName: "mihomo", message: msg } }),
        });
        sendJson(res, 200, st);
        return;
      }

      if (req.method === "POST" && pathname === "/api/settings") {
        const body = await readJsonBody(req);
        const cur = store.getSettings();
        const patch = {};
        if (body.scheduleTime !== undefined) patch.scheduleTime = String(body.scheduleTime).trim();
        if (body.speedUrl !== undefined && body.speedUrl.trim()) patch.speedUrl = body.speedUrl.trim();
        if (body.telegramChatId !== undefined) patch.telegramChatId = String(body.telegramChatId).trim();
        if (body.telegramBotToken !== undefined && !String(body.telegramBotToken).startsWith("••••")) {
          patch.telegramBotToken = String(body.telegramBotToken).trim();
        } else {
          patch.telegramBotToken = cur.telegramBotToken;
        }
        const updated = store.updateSettings(patch);
        sendJson(res, 200, { ok: true, scheduleTime: updated.scheduleTime });
        return;
      }

      if (req.method === "POST" && pathname === "/api/test-telegram") {
        const st = store.getSettings();
        const latest = Object.values(store.latestRunBySupplier());
        if (!st.telegramBotToken || !st.telegramChatId) {
          return sendJson(res, 400, { error: "Set Telegram Bot Token and Chat ID first" });
        }
        const fakeRuns = latest.length
          ? latest
          : [{ supplierName: "Airport Bench Test", isPrimary: true, summary: { score: 90, grade: "S", avgSpeedMBps: 88.5, peakSpeedMBps: 112, aliveCount: 10, speedTestedCount: 10, medianDelayMs: 65, unlockRates: { chatgpt: 90 } } }];
        const r = await sendTelegramDigest({ botToken: st.telegramBotToken, chatId: st.telegramChatId, runs: fakeRuns });
        if (!r.sent) return sendJson(res, 502, { error: `Telegram returned HTTP ${r.status}` });
        sendJson(res, 200, { sent: true });
        return;
      }

      sendJson(res, 404, { error: "Not found" });
    } catch (e) {
      sendJson(res, 500, { error: e.message || String(e) });
    }
  });

  // Daily scheduler loop (checks every 30s if local HH:MM matches scheduleTime)
  const schedTimer = setInterval(() => {
    const st = store.getSettings();
    if (!st.scheduleTime || running) return;
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    if (hhmm === st.scheduleTime && st.lastScheduledDate !== today && store.listSuppliers().length > 0) {
      store.updateSettings({ lastScheduledDate: today });
      startRun({ mode: "triage", payloadMb: st.payloadMb || 25, cnDns: st.cnDns !== false }).catch(() => {});
    }
  }, 30000);
  schedTimer.unref();

  return { server, startRun, stopTimer: () => clearInterval(schedTimer) };
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list || []) {
      if (iface.family === "IPv4" && !iface.internal) out.push(iface.address);
    }
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const PORT = Number(process.env.PORT || 8788);
  const { server } = createBenchServer();
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`\n  ⚡ Airport Bench running!`);
    console.log(`     PC browser : http://127.0.0.1:${PORT}`);
    for (const ip of lanAddresses()) {
      console.log(`     Phone LAN  : http://${ip}:${PORT}`);
    }
    const m = getMihomoStatus();
    console.log(m.installed
      ? `     mihomo     : ${m.path} (${m.version})\n`
      : `     mihomo     : NOT FOUND (click "Install mihomo.exe" in the web UI or run: npm run setup)\n`);
  });
}
