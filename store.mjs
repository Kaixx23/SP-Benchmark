// Atomic JSON file store for suppliers, historical benchmark runs, and settings.
// Kept inside ./data/ (gitignored) so subscription tokens are never committed.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DATA_FILE = path.join(HERE, "data", "bench-store.json");

function defaultStore() {
  return {
    suppliers: [],
    runs: [],
    settings: {
      speedUrl: "https://speed.cloudflare.com/__down?bytes=25000000",
      payloadMb: 25,
      cnDns: true,
      scheduleTime: "",       // e.g. "21:30" (local PC time) for automatic evening-peak run
      lastScheduledDate: "",  // YYYY-MM-DD
      telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
      telegramChatId: process.env.TELEGRAM_CHAT_ID || "",
    },
  };
}

export class BenchStore {
  constructor(filePath = DEFAULT_DATA_FILE) {
    this.filePath = filePath;
    this.state = defaultStore();
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
        this.state = {
          suppliers: Array.isArray(raw.suppliers) ? raw.suppliers : [],
          runs: Array.isArray(raw.runs) ? raw.runs : [],
          settings: { ...defaultStore().settings, ...(raw.settings || {}) },
        };
      }
    } catch {
      this.state = defaultStore();
    }
    return this.state;
  }

  save() {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), "utf8");
    fs.renameSync(tmp, this.filePath);
  }

  listSuppliers() {
    return this.state.suppliers;
  }

  upsertSupplier({ id, name, url, priceMonthly = null, currency = "RMB", isPrimary = false, notes = "" }) {
    const cleanUrl = String(url || "").trim();
    if (!/^https?:\/\//i.test(cleanUrl)) throw new Error("Subscription URL must start with http:// or https://");
    const cleanName = String(name || "").trim() || new URL(cleanUrl).hostname;

    if (isPrimary) {
      for (const s of this.state.suppliers) s.isPrimary = false;
    }

    let existing = id
      ? this.state.suppliers.find((s) => s.id === id)
      : this.state.suppliers.find((s) => s.url === cleanUrl);

    if (existing) {
      existing.name = cleanName;
      existing.url = cleanUrl;
      existing.priceMonthly = priceMonthly !== null && priceMonthly !== "" ? Number(priceMonthly) : existing.priceMonthly;
      existing.currency = currency || existing.currency || "RMB";
      if (isPrimary !== undefined) existing.isPrimary = Boolean(isPrimary);
      if (notes !== undefined) existing.notes = String(notes);
      existing.updatedAt = new Date().toISOString();
    } else {
      existing = {
        id: crypto.randomBytes(6).toString("hex"),
        name: cleanName,
        url: cleanUrl,
        priceMonthly: priceMonthly !== null && priceMonthly !== "" ? Number(priceMonthly) : null,
        currency: currency || "RMB",
        isPrimary: Boolean(isPrimary),
        notes: String(notes || ""),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.state.suppliers.push(existing);
    }
    this.save();
    return existing;
  }

  removeSupplier(id) {
    this.state.suppliers = this.state.suppliers.filter((s) => s.id !== id);
    this.state.runs = this.state.runs.filter((r) => r.supplierId !== id);
    this.save();
  }

  addRun(run) {
    this.state.runs.unshift(run);
    // Keep last 500 runs so the Deep Analysis Report has enough time-of-day
    // history (several weeks of multi-supplier daily runs) while the JSON
    // file stays fast and compact.
    if (this.state.runs.length > 500) this.state.runs = this.state.runs.slice(0, 500);
    this.save();
    return run;
  }

  listRuns(supplierId = null) {
    return supplierId ? this.state.runs.filter((r) => r.supplierId === supplierId) : this.state.runs;
  }

  latestRunBySupplier() {
    const map = {};
    for (const r of this.state.runs) {
      if (!map[r.supplierId]) map[r.supplierId] = r;
    }
    return map;
  }

  updateSettings(patch) {
    this.state.settings = { ...this.state.settings, ...patch };
    this.save();
    return this.state.settings;
  }

  getSettings() {
    return this.state.settings;
  }
}

export function maskUrl(u) {
  try {
    const p = new URL(u);
    const segs = p.pathname.split("/").filter(Boolean);
    const tail = segs.length ? `/${segs[0]}/…` : "/";
    return `${p.protocol}//${p.host}${tail}${p.search ? "?…" : ""}`;
  } catch {
    return "***";
  }
}
