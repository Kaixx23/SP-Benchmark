// Local Web Server + SSE live progress + daily evening-peak scheduler.
// Start on Windows/Mac/Linux: `node server.mjs`

import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BenchStore, maskUrl } from "./store.mjs";
import { benchmarkSupplier, sendTelegramDigest, sendTelegramStabilityReport } from "./runner.mjs";
import { buildStabilityReport, formatStabilityMarkdown, formatRunsCsv } from "./report.mjs";
import { getMihomoStatus, installMihomo } from "./setup-mihomo.mjs";
import { renderUiHtml } from "./ui.js";

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
    if (!supplierId && Number(st.intervalMinutes) > 0) {
      store.updateSettings({ lastIntervalRunAt: new Date().toISOString() });
    }
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
        let nextIntervalRunAt = null;
        if (Number(st.intervalMinutes) > 0) {
          const baseMs = st.lastIntervalRunAt ? Date.parse(st.lastIntervalRunAt) : Date.now();
          if (!Number.isNaN(baseMs)) {
            nextIntervalRunAt = new Date(baseMs + Number(st.intervalMinutes) * 60 * 1000).toISOString();
          }
        }
        sendJson(res, 200, {
          suppliers,
          latestRuns,
          totalRunsCount: store.listRuns().length,
          running,
          nextIntervalRunAt,
          mihomo: getMihomoStatus(),
          settings: {
            ...st,
            telegramBotToken: st.telegramBotToken ? "••••" + st.telegramBotToken.slice(-6) : "",
          },
        });
        return;
      }

      if (req.method === "GET" && pathname === "/api/report") {
        const hours = Number(u.searchParams.get("hours") ?? 24);
        const report = buildStabilityReport({
          suppliers: store.listSuppliers(),
          runs: store.listRuns(),
          hours: Number.isNaN(hours) ? 24 : hours,
        });
        sendJson(res, 200, {
          report,
          markdown: formatStabilityMarkdown(report),
        });
        return;
      }

      if (req.method === "GET" && pathname === "/api/report.md") {
        const hours = Number(u.searchParams.get("hours") ?? 24);
        const report = buildStabilityReport({
          suppliers: store.listSuppliers(),
          runs: store.listRuns(),
          hours: Number.isNaN(hours) ? 24 : hours,
        });
        const md = formatStabilityMarkdown(report);
        const dateTag = new Date().toISOString().slice(0, 10);
        res.writeHead(200, {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="vpn-stability-report-${dateTag}.md"`,
        });
        res.end(md);
        return;
      }

      if (req.method === "GET" && pathname === "/api/report.csv") {
        const hours = Number(u.searchParams.get("hours") ?? 24);
        const csv = formatRunsCsv(store.listRuns(), Number.isNaN(hours) ? 24 : hours);
        const dateTag = new Date().toISOString().slice(0, 10);
        res.writeHead(200, {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="vpn-runs-${dateTag}.csv"`,
        });
        res.end(csv);
        return;
      }

      if (req.method === "POST" && pathname === "/api/send-report-telegram") {
        const body = await readJsonBody(req);
        const st = store.getSettings();
        if (!st.telegramBotToken || !st.telegramChatId) {
          return sendJson(res, 400, { error: "Set Telegram Bot Token and Chat ID in Settings first" });
        }
        const hours = Number(body.hours ?? 24);
        const report = buildStabilityReport({
          suppliers: store.listSuppliers(),
          runs: store.listRuns(),
          hours: Number.isNaN(hours) ? 24 : hours,
        });
        const r = await sendTelegramStabilityReport({
          botToken: st.telegramBotToken,
          chatId: st.telegramChatId,
          report,
        });
        if (!r.sent) return sendJson(res, 502, { error: `Telegram returned HTTP ${r.status}` });
        sendJson(res, 200, { sent: true });
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
        if (body.intervalMinutes !== undefined) {
          const iv = Math.max(0, Math.round(Number(body.intervalMinutes) || 0));
          patch.intervalMinutes = iv;
          if (iv > 0 && !cur.lastIntervalRunAt && !body.runImmediately) {
            patch.lastIntervalRunAt = new Date().toISOString();
          }
        }
        if (body.scheduleMode !== undefined && ["triage", "ping", "full"].includes(body.scheduleMode)) {
          patch.scheduleMode = body.scheduleMode;
        }
        if (body.schedulePayloadMb !== undefined) {
          const pmb = Number(body.schedulePayloadMb);
          if (pmb > 0 && pmb <= 200) patch.schedulePayloadMb = pmb;
        }
        if (body.speedUrl !== undefined && body.speedUrl.trim()) patch.speedUrl = body.speedUrl.trim();
        if (body.telegramChatId !== undefined) patch.telegramChatId = String(body.telegramChatId).trim();
        if (body.telegramBotToken !== undefined && !String(body.telegramBotToken).startsWith("••••")) {
          patch.telegramBotToken = String(body.telegramBotToken).trim();
        } else {
          patch.telegramBotToken = cur.telegramBotToken;
        }
        const updated = store.updateSettings(patch);
        let startedImmediate = false;
        if (body.runImmediately && updated.intervalMinutes > 0 && !running && store.listSuppliers().length > 0) {
          await startRun({
            mode: updated.scheduleMode || "triage",
            payloadMb: updated.schedulePayloadMb || 10,
            cnDns: updated.cnDns !== false,
          }).catch(() => {});
          startedImmediate = true;
        }
        sendJson(res, 200, {
          ok: true,
          scheduleTime: updated.scheduleTime,
          intervalMinutes: updated.intervalMinutes,
          startedImmediate,
        });
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

  // Periodic scheduler: supports both recurring interval runs (e.g. every 60 min)
  // and daily fixed-time runs (e.g. "21:30" local PC time).
  function checkSchedule(now = new Date()) {
    if (running || store.listSuppliers().length === 0) return false;
    const st = store.getSettings();
    const schedMode = st.scheduleMode || "triage";
    const schedPayload = Number(st.schedulePayloadMb || 10);

    // 1) Recurring interval scheduler (hourly / N-minute stability sampling)
    const ivMin = Number(st.intervalMinutes || 0);
    if (ivMin > 0) {
      const lastMs = st.lastIntervalRunAt ? Date.parse(st.lastIntervalRunAt) : 0;
      const due = !lastMs || Number.isNaN(lastMs) || (now.getTime() - lastMs >= ivMin * 60 * 1000);
      if (due) {
        store.updateSettings({ lastIntervalRunAt: now.toISOString() });
        startRun({ mode: schedMode, payloadMb: schedPayload, cnDns: st.cnDns !== false }).catch(() => {});
        return true;
      }
    }

    // 2) Daily fixed-time scheduler (e.g. 21:30 evening peak)
    if (st.scheduleTime) {
      const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      if (hhmm === st.scheduleTime && st.lastScheduledDate !== today) {
        store.updateSettings({ lastScheduledDate: today });
        startRun({ mode: schedMode, payloadMb: schedPayload, cnDns: st.cnDns !== false }).catch(() => {});
        return true;
      }
    }
    return false;
  }

  const schedTimer = setInterval(() => checkSchedule(new Date()), 20000);
  schedTimer.unref();

  return { server, startRun, checkSchedule, stopTimer: () => clearInterval(schedTimer) };
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
