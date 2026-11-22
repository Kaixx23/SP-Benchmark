import test from "node:test";
import assert from "node:assert/strict";

import {
  bandOfHour,
  extractSamples,
  aggregate,
  analyzeSupplier,
  buildDeepReport,
} from "../analysis.mjs";

// ---------------- helpers to build synthetic runs ----------------

// Build a local-time ISO string for a given hour of a given day
function at(day, hour) {
  const d = new Date(2026, 10, day, hour, 15, 0); // Nov 2026, local time
  return d.toISOString();
}

function mkNode({ region = "HK", alive = true, zombie = false, speed = 20, delay = 80, unlocks = null, tested = true }) {
  return {
    name: `${region} node`,
    type: "vless",
    server: `${region.toLowerCase()}.example.com`,
    port: 443,
    region,
    carrier: "IEPL",
    entry: { host: "x", ip: "1.2.3.4", asn: "AS1", org: "", country: "" },
    delayMs: alive || zombie ? delay : null,
    speedTested: tested,
    alive,
    zombie,
    avgMBps: alive ? speed : 0,
    maxMBps: alive ? speed * 1.3 : 0,
    ttfbMs: 200,
    bytes: alive ? speed * 1e6 : 0,
    unlocks,
    error: null,
  };
}

function mkRun({ id, supplierId, supplierName, day, hour, nodes, score = 70 }) {
  return {
    id,
    supplierId,
    supplierName,
    isPrimary: false,
    priceMonthly: null,
    currency: "RMB",
    startedAt: at(day, hour),
    finishedAt: at(day, hour),
    summary: {
      mode: "triage",
      score,
      grade: "A",
      avgSpeedMBps: aggregate(extractSamples([{ startedAt: at(day, hour), supplierId, supplierName, id, nodes }])).avgMBps,
      peakSpeedMBps: 0,
      aliveCount: nodes.filter((n) => n.alive).length,
      speedTestedCount: nodes.filter((n) => n.speedTested).length,
      zombieCount: nodes.filter((n) => n.zombie).length,
      medianDelayMs: 80,
      entryDiversity: { uniqueIps: 5, topIpSharePct: 30, singleEntryWarning: false, asns: [] },
      unlockRates: {},
      quota: null,
    },
    nodes,
  };
}

// ---------------- bandOfHour ----------------

test("bandOfHour maps hours to the right time bands including edges", () => {
  assert.equal(bandOfHour(6), "morning");
  assert.equal(bandOfHour(11), "morning");
  assert.equal(bandOfHour(12), "afternoon");
  assert.equal(bandOfHour(17), "afternoon");
  assert.equal(bandOfHour(18), "evening");
  assert.equal(bandOfHour(22), "evening");
  assert.equal(bandOfHour(23), "night");
  assert.equal(bandOfHour(0), "night");
  assert.equal(bandOfHour(5), "night");
});

// ---------------- extractSamples / aggregate ----------------

test("extractSamples flattens runs into per-node samples tagged with hour/band/region", () => {
  const run = mkRun({
    id: "r1", supplierId: "s1", supplierName: "A", day: 1, hour: 21,
    nodes: [mkNode({ region: "HK", speed: 30 }), mkNode({ region: "JP", speed: 10 })],
  });
  const samples = extractSamples([run]);
  assert.equal(samples.length, 2);
  assert.equal(samples[0].band, "evening");
  assert.equal(samples[0].hour, 21);
  assert.equal(samples[0].region, "HK");
  assert.equal(samples[1].avgMBps, 10);
});

test("aggregate computes alive/zombie rates and speed stats over alive nodes only", () => {
  const run = mkRun({
    id: "r1", supplierId: "s1", supplierName: "A", day: 1, hour: 10,
    nodes: [
      mkNode({ speed: 40 }),
      mkNode({ speed: 20 }),
      mkNode({ alive: false, zombie: true, speed: 0 }),
      mkNode({ alive: false, zombie: false, speed: 0 }),
    ],
  });
  const agg = aggregate(extractSamples([run]));
  assert.equal(agg.speedTested, 4);
  assert.equal(agg.aliveCount, 2);
  assert.equal(agg.zombieCount, 1);
  assert.equal(agg.aliveRate, 50);
  assert.equal(agg.zombieRate, 25);
  assert.equal(agg.avgMBps, 30); // mean of 40, 20 — dead nodes excluded
  assert.equal(agg.peakMBps, 40);
});

test("aggregate computes unlock pass rates", () => {
  const nodes = [
    mkNode({ unlocks: { chatgpt: "Yes", netflix: "Full", youtube: "Yes (US)", disney: "No" } }),
    mkNode({ unlocks: { chatgpt: "No", netflix: "Originals Only", youtube: "Yes", disney: "No" } }),
  ];
  const agg = aggregate(extractSamples([mkRun({ id: "r", supplierId: "s", supplierName: "A", day: 1, hour: 9, nodes })]));
  assert.equal(agg.unlockRates.chatgpt, 50);
  assert.equal(agg.unlockRates.netflix, 50);
  assert.equal(agg.unlockRates.youtube, 100);
  assert.equal(agg.unlockRates.disney, 0);
});

// ---------------- analyzeSupplier ----------------

test("analyzeSupplier splits performance by time band and finds best region/band", () => {
  const sup = { id: "s1", name: "FastAir", isPrimary: false, priceMonthly: 20, currency: "RMB" };
  const runs = [
    // morning: HK fast
    mkRun({ id: "r1", supplierId: "s1", supplierName: "FastAir", day: 1, hour: 9, nodes: [mkNode({ region: "HK", speed: 50 }), mkNode({ region: "JP", speed: 30 })] }),
    // evening: congested
    mkRun({ id: "r2", supplierId: "s1", supplierName: "FastAir", day: 1, hour: 21, nodes: [mkNode({ region: "HK", speed: 10 }), mkNode({ region: "JP", speed: 5 })] }),
  ];
  const rep = analyzeSupplier(sup, runs);

  assert.equal(rep.runsCount, 2);
  assert.equal(rep.byBand.morning.avgMBps, 40);
  assert.equal(rep.byBand.evening.avgMBps, 7.5);
  assert.equal(rep.byBand.afternoon.samples, 0);
  assert.deepEqual(rep.bandsCovered, ["morning", "evening"]);

  // Region analysis: HK avg = (50+10)/2 = 30, best band for HK = morning
  assert.equal(rep.byRegion.HK.avgMBps, 30);
  assert.equal(rep.byRegion.HK.bestBand, "morning");
  assert.equal(rep.byRegion.JP.bestBand, "morning");

  // 24h profile has data at hours 9 and 21 only
  assert.equal(rep.byHour[9].avgMBps, 40);
  assert.equal(rep.byHour[21].avgMBps, 7.5);
  assert.equal(rep.bestHour.hour, 9);
  assert.equal(rep.worstHour.hour, 21);
});

test("analyzeSupplier flags evening collapse when peak-hour speed drops hard vs off-peak", () => {
  const sup = { id: "s1", name: "DayOnly", isPrimary: false, priceMonthly: null, currency: "RMB" };
  const runs = [
    mkRun({ id: "r1", supplierId: "s1", supplierName: "DayOnly", day: 1, hour: 10, nodes: [mkNode({ speed: 60 }), mkNode({ speed: 50 })] }),
    mkRun({ id: "r2", supplierId: "s1", supplierName: "DayOnly", day: 1, hour: 21, nodes: [mkNode({ speed: 8 }), mkNode({ speed: 6 })] }),
  ];
  const rep = analyzeSupplier(sup, runs);
  assert.ok(rep.flags.some((f) => f.id === "evening_collapse"), "expected evening_collapse flag");
});

test("analyzeSupplier notes missing evening data instead of collapse", () => {
  const sup = { id: "s1", name: "MorningTester", isPrimary: false };
  const runs = [
    mkRun({ id: "r1", supplierId: "s1", supplierName: "MorningTester", day: 1, hour: 10, nodes: [mkNode({ speed: 30 })] }),
  ];
  const rep = analyzeSupplier(sup, runs);
  assert.ok(rep.flags.some((f) => f.id === "no_evening_data"));
  assert.ok(!rep.flags.some((f) => f.id === "evening_collapse"));
});

test("analyzeSupplier flags high zombie rate", () => {
  const sup = { id: "s1", name: "ZombieLand", isPrimary: false };
  const runs = [
    mkRun({
      id: "r1", supplierId: "s1", supplierName: "ZombieLand", day: 1, hour: 20,
      nodes: [mkNode({ speed: 20 }), mkNode({ alive: false, zombie: true }), mkNode({ alive: false, zombie: true }), mkNode({ speed: 25 })],
    }),
  ];
  const rep = analyzeSupplier(sup, runs);
  assert.ok(rep.flags.some((f) => f.id === "high_zombie"));
});

// ---------------- buildDeepReport ----------------

function twoSupplierFixture() {
  const suppliers = [
    { id: "s1", name: "GoodAir", isPrimary: true, priceMonthly: 20, currency: "RMB" },
    { id: "s2", name: "CheapAir", isPrimary: false, priceMonthly: 10, currency: "RMB" },
  ];
  const gUnlock = { chatgpt: "Yes", netflix: "Full", youtube: "Yes", disney: "Yes" };
  const runs = [
    // GoodAir: strong in the evening, stable
    mkRun({ id: "g1", supplierId: "s1", supplierName: "GoodAir", day: 1, hour: 21, nodes: [mkNode({ region: "HK", speed: 42, unlocks: gUnlock }), mkNode({ region: "JP", speed: 38, unlocks: gUnlock })] }),
    mkRun({ id: "g2", supplierId: "s1", supplierName: "GoodAir", day: 2, hour: 21, nodes: [mkNode({ region: "HK", speed: 40, unlocks: gUnlock }), mkNode({ region: "JP", speed: 36, unlocks: gUnlock })] }),
    mkRun({ id: "g3", supplierId: "s1", supplierName: "GoodAir", day: 2, hour: 10, nodes: [mkNode({ region: "HK", speed: 45, unlocks: gUnlock }), mkNode({ region: "JP", speed: 41, unlocks: gUnlock })] }),
    // CheapAir: fast at 10am, dies in the evening, zombies
    mkRun({ id: "c1", supplierId: "s2", supplierName: "CheapAir", day: 1, hour: 10, nodes: [mkNode({ region: "HK", speed: 50 }), mkNode({ region: "SG", speed: 44 })] }),
    mkRun({ id: "c2", supplierId: "s2", supplierName: "CheapAir", day: 1, hour: 21, nodes: [mkNode({ region: "HK", speed: 4 }), mkNode({ region: "SG", alive: false, zombie: true })] }),
    mkRun({ id: "c3", supplierId: "s2", supplierName: "CheapAir", day: 2, hour: 21, nodes: [mkNode({ region: "HK", speed: 5 }), mkNode({ region: "SG", alive: false, zombie: true })] }),
  ];
  return { suppliers, runs };
}

test("buildDeepReport ranks the evening-stable supplier above the evening-collapsing one", () => {
  const { suppliers, runs } = twoSupplierFixture();
  const report = buildDeepReport(runs, suppliers);

  assert.equal(report.suppliers.length, 2);
  assert.equal(report.recommendation[0].supplierName, "GoodAir");
  assert.ok(report.recommendation[0].score > report.recommendation[1].score);

  // CheapAir must carry the evening_collapse risk in its narrative
  const cheap = report.recommendation.find((r) => r.supplierName === "CheapAir");
  assert.ok(cheap.risks.some((t) => /Evening-peak speed collapses/.test(t)));
});

test("buildDeepReport computes region winners and region×band matrices", () => {
  const { suppliers, runs } = twoSupplierFixture();
  const report = buildDeepReport(runs, suppliers);

  // HK winner: GoodAir avg (42+40+45)/3 ≈ 42.33 vs CheapAir (50+4+5)/3 ≈ 19.67
  assert.equal(report.regionMatrix.HK.winner.supplierName, "GoodAir");
  // SG only exists on CheapAir
  assert.equal(report.regionMatrix.SG.winner.supplierName, "CheapAir");
  // HK across all suppliers is best in the morning (45 and 50 samples)
  assert.equal(report.regionBand.HK.bestBand, "morning");
  // band matrix carries per-supplier evening numbers
  assert.ok(report.bandMatrix.evening.s1.avgMBps > 30);
  assert.ok(report.bandMatrix.evening.s2.avgMBps < 10);
});

test("buildDeepReport lists untested suppliers separately and reports coverage", () => {
  const { suppliers, runs } = twoSupplierFixture();
  suppliers.push({ id: "s3", name: "NeverTested", isPrimary: false });
  const report = buildDeepReport(runs, suppliers);

  assert.equal(report.untested.length, 1);
  assert.equal(report.untested[0].supplierName, "NeverTested");
  assert.equal(report.coverage.totalRuns, 6);
  assert.ok(report.coverage.bandsCovered.includes("evening"));
  assert.ok(["low", "medium", "high"].includes(report.coverage.confidence));
});

test("buildDeepReport value scoring favors better price per evening MB/s", () => {
  const { suppliers, runs } = twoSupplierFixture();
  const report = buildDeepReport(runs, suppliers);
  const good = report.suppliers.find((s) => s.supplierName === "GoodAir");
  const cheap = report.suppliers.find((s) => s.supplierName === "CheapAir");
  // GoodAir: 20 RMB / ~39 MB/s evening ≈ 0.51; CheapAir: 10 RMB / ~4.5 MB/s evening ≈ 2.2
  assert.ok(good.resale.rmbPerMBps < cheap.resale.rmbPerMBps);
  assert.ok(good.resale.breakdown.value > cheap.resale.breakdown.value);
});

test("buildDeepReport handles empty data gracefully", () => {
  const report = buildDeepReport([], []);
  assert.equal(report.suppliers.length, 0);
  assert.equal(report.coverage.totalRuns, 0);
  assert.equal(report.coverage.confidence, "low");
});
