// Generates synthetic demo data into ./data/bench-store.json so you can
// preview the Deep Analysis Report (/report) without burning subscription quota.
//
//   node demo-seed.mjs            # only writes if no store exists yet
//   node demo-seed.mjs --force    # overwrite existing store (CAREFUL: wipes real history)

import fs from "node:fs";
import crypto from "node:crypto";
import { BenchStore, DEFAULT_DATA_FILE } from "./store.mjs";

const force = process.argv.includes("--force");
if (fs.existsSync(DEFAULT_DATA_FILE) && !force) {
  console.error(`Refusing to overwrite existing ${DEFAULT_DATA_FILE} — pass --force to wipe it with demo data.`);
  process.exit(1);
}
if (fs.existsSync(DEFAULT_DATA_FILE)) fs.rmSync(DEFAULT_DATA_FILE);

const store = new BenchStore();

const rid = () => crypto.randomBytes(6).toString("hex");
const rnd = (min, max) => min + Math.random() * (max - min);

const suppliers = [
  store.upsertSupplier({ name: "chuixuecloud", url: "https://chuixue.example.com/sub?token=demo1", priceMonthly: 20, isPrimary: true }),
  store.upsertSupplier({ name: "Candidate A — StarGate", url: "https://stargate.example.com/sub?token=demo2", priceMonthly: 28 }),
  store.upsertSupplier({ name: "Candidate B — CheapJet", url: "https://cheapjet.example.com/sub?token=demo3", priceMonthly: 12 }),
];

// Per-supplier personality: [regions], evening multiplier, base speed, zombie rate
const PROFILES = {
  [suppliers[0].id]: { regions: ["HK", "JP", "SG", "TW", "US"], evening: 0.75, base: 28, zombie: 0.05, unlock: 0.85 },
  [suppliers[1].id]: { regions: ["HK", "JP", "SG", "KR", "US"], evening: 0.92, base: 38, zombie: 0.02, unlock: 0.95 },
  [suppliers[2].id]: { regions: ["HK", "SG", "US"], evening: 0.25, base: 45, zombie: 0.22, unlock: 0.55 },
};

function mkNodes(sup, hour) {
  const p = PROFILES[sup.id];
  const evening = hour >= 18 && hour < 23;
  const nodes = [];
  for (const region of p.regions) {
    for (let i = 1; i <= 2; i++) {
      const zomb = Math.random() < p.zombie;
      const dead = !zomb && Math.random() < 0.04;
      const regionBoost = region === "HK" ? 1.25 : region === "JP" || region === "SG" ? 1.05 : region === "US" ? 0.55 : 0.9;
      const mult = (evening ? p.evening : 1) * regionBoost * rnd(0.8, 1.2);
      const speed = dead || zomb ? 0 : Math.max(0.5, p.base * mult);
      const delay = dead ? null : Math.round((region === "US" ? 190 : region === "HK" ? 45 : 75) * rnd(0.8, 1.6) * (evening ? 1.4 : 1));
      const ok = Math.random() < p.unlock;
      nodes.push({
        name: `${region}-IEPL-${i < 10 ? "0" + i : i}`,
        type: "vless",
        server: `${region.toLowerCase()}${i}.entry${(i % 3) + 1}.example.net`,
        port: 443,
        region,
        carrier: "IEPL",
        entry: { host: `entry${(i % 3) + 1}`, ip: `203.0.113.${(i % 3) + 1}`, asn: "AS9929", org: "CUG", country: "CN" },
        delayMs: delay,
        speedTested: true,
        alive: !dead && !zomb,
        zombie: zomb,
        avgMBps: Math.round(speed * 100) / 100,
        maxMBps: Math.round(speed * 1.35 * 100) / 100,
        ttfbMs: delay ? delay + 120 : null,
        bytes: Math.round(speed * 1e6),
        unlocks: dead || zomb ? null : {
          chatgpt: ok ? "Yes" : "No",
          netflix: ok ? (Math.random() < 0.7 ? "Full" : "Originals Only") : "No",
          youtube: ok ? `Yes (${region})` : "No",
          disney: ok && Math.random() < 0.6 ? "Yes" : "No",
        },
      });
    }
  }
  return nodes;
}

function summarize(nodes) {
  const alive = nodes.filter((n) => n.alive);
  const speeds = alive.map((n) => n.avgMBps).sort((a, b) => a - b);
  const avg = speeds.length ? Math.round((speeds.reduce((s, x) => s + x, 0) / speeds.length) * 100) / 100 : 0;
  const delays = nodes.filter((n) => n.delayMs != null).map((n) => n.delayMs).sort((a, b) => a - b);
  return {
    mode: "triage",
    totalNodes: nodes.length,
    pingAliveCount: delays.length,
    speedTestedCount: nodes.length,
    aliveCount: alive.length,
    zombieCount: nodes.filter((n) => n.zombie).length,
    deadCount: nodes.filter((n) => !n.alive && !n.zombie).length,
    avgSpeedMBps: avg,
    medianSpeedMBps: speeds.length ? speeds[Math.floor(speeds.length / 2)] : 0,
    peakSpeedMBps: speeds.length ? speeds[speeds.length - 1] : 0,
    medianDelayMs: delays.length ? delays[Math.floor(delays.length / 2)] : null,
    bestByRegion: {},
    unlockRates: { tested: alive.length, chatgpt: 80, youtube: 85, netflix: 60, disney: 40 },
    entryDiversity: { uniqueIps: 3, topIpSharePct: 40, singleEntryWarning: false, asns: ["AS9929 CUG"] },
    subFetchMs: 300,
    subFormat: "base64",
    quota: { leftGb: 142 },
    score: Math.min(95, Math.round(avg * 2)),
    grade: avg > 35 ? "S" : avg > 25 ? "A" : avg > 12 ? "B" : "C",
  };
}

// 4 days × test slots at 09:00 / 14:00 / 21:00 (+ one 01:00 night run)
const now = new Date();
for (let dayOffset = 4; dayOffset >= 1; dayOffset--) {
  for (const hour of [9, 14, 21, ...(dayOffset === 2 ? [1] : [])]) {
    for (const sup of suppliers) {
      const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOffset, hour, 5 + Math.floor(rnd(0, 20)));
      const nodes = mkNodes(sup, hour);
      store.addRun({
        id: rid(),
        supplierId: sup.id,
        supplierName: sup.name,
        isPrimary: sup.isPrimary,
        priceMonthly: sup.priceMonthly,
        currency: sup.currency,
        startedAt: t.toISOString(),
        finishedAt: new Date(t.getTime() + 6 * 60000).toISOString(),
        summary: summarize(nodes),
        nodes,
      });
    }
  }
}

console.log(`Seeded ${store.listRuns().length} demo runs for ${suppliers.length} suppliers into ${DEFAULT_DATA_FILE}`);
console.log("Start the app (npm start) and open /report to preview the Deep Analysis Report.");
console.log("Delete ./data/bench-store.json (or re-run with --force) to reset.");
