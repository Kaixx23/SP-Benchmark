// Deep analytics over historical benchmark runs.
// Answers reseller questions: at what time of day does each airport perform,
// which countries/regions work best per supplier, how stable is each supplier
// across days, and which one is the safest to resell.

// ---------------- Time bands ----------------

export const TIME_BANDS = [
  { id: "morning", label: "Morning (06–12)" },
  { id: "afternoon", label: "Afternoon (12–18)" },
  { id: "evening", label: "Evening Peak (18–23)" },
  { id: "night", label: "Late Night (23–06)" },
];

export function bandOfHour(h) {
  if (h >= 6 && h < 12) return "morning";
  if (h >= 12 && h < 18) return "afternoon";
  if (h >= 18 && h < 23) return "evening";
  return "night";
}

// ---------------- Small math helpers ----------------

const r2 = (x) => Math.round(x * 100) / 100;
const mean = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0);
const median = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const stddev = (arr) => {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(mean(arr.map((x) => (x - m) ** 2)));
};

const UNLOCK_OK = {
  chatgpt: (v) => String(v || "").startsWith("Yes"),
  youtube: (v) => String(v || "").startsWith("Yes"),
  netflix: (v) => /^(Full|Yes)/i.test(String(v || "")),
  disney: (v) => String(v || "").startsWith("Yes"),
};

// ---------------- Sample extraction ----------------

// Flattens every stored run into one row per node-test, tagged with local
// hour / time band / date so time-of-day analysis is possible.
export function extractSamples(runs) {
  const samples = [];
  for (const run of runs || []) {
    const t = new Date(run.startedAt || run.finishedAt || Date.now());
    const hour = t.getHours();
    const band = bandOfHour(hour);
    const date = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    for (const n of run.nodes || []) {
      samples.push({
        supplierId: run.supplierId,
        supplierName: run.supplierName,
        runId: run.id,
        time: t.toISOString(),
        date,
        hour,
        band,
        region: n.region || "OTHER",
        delayMs: n.delayMs ?? null,
        speedTested: Boolean(n.speedTested),
        alive: Boolean(n.alive),
        zombie: Boolean(n.zombie),
        avgMBps: n.avgMBps || 0,
        maxMBps: n.maxMBps || 0,
        ttfbMs: n.ttfbMs ?? null,
        unlocks: n.unlocks || null,
      });
    }
  }
  return samples;
}

// ---------------- Aggregation ----------------

export function aggregate(samples) {
  const tested = samples.filter((s) => s.speedTested);
  const alive = tested.filter((s) => s.alive);
  const zombies = tested.filter((s) => s.zombie);
  const pings = samples.filter((s) => s.delayMs != null).map((s) => s.delayMs);
  const speeds = alive.map((s) => s.avgMBps);
  const unlockTested = samples.filter((s) => s.unlocks);
  const rate = (key) =>
    unlockTested.length
      ? Math.round((unlockTested.filter((s) => UNLOCK_OK[key](s.unlocks[key])).length / unlockTested.length) * 100)
      : null;

  return {
    samples: samples.length,
    speedTested: tested.length,
    aliveCount: alive.length,
    zombieCount: zombies.length,
    aliveRate: tested.length ? r2((alive.length / tested.length) * 100) : null,
    zombieRate: tested.length ? r2((zombies.length / tested.length) * 100) : null,
    avgMBps: r2(mean(speeds)),
    medianMBps: r2(median(speeds)),
    peakMBps: r2(speeds.length ? Math.max(...speeds) : 0),
    stdevMBps: r2(stddev(speeds)),
    medianDelayMs: pings.length ? Math.round(median(pings)) : null,
    unlockRates: unlockTested.length
      ? { tested: unlockTested.length, chatgpt: rate("chatgpt"), youtube: rate("youtube"), netflix: rate("netflix"), disney: rate("disney") }
      : null,
  };
}

function groupBy(samples, keyFn) {
  const m = new Map();
  for (const s of samples) {
    const k = keyFn(s);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(s);
  }
  return m;
}

// ---------------- Per-supplier deep report ----------------

export function analyzeSupplier(supplier, runs) {
  const sorted = [...runs].sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));
  const samples = extractSamples(sorted);
  const latest = sorted[sorted.length - 1] || null;

  const overall = aggregate(samples);

  // Per-run trend (chronological)
  const trend = sorted.map((r) => {
    const t = new Date(r.startedAt || r.finishedAt);
    return {
      runId: r.id,
      time: r.finishedAt || r.startedAt,
      hour: t.getHours(),
      band: bandOfHour(t.getHours()),
      mode: r.summary?.mode,
      score: r.summary?.score ?? null,
      grade: r.summary?.grade ?? null,
      avgSpeedMBps: r.summary?.avgSpeedMBps ?? 0,
      peakSpeedMBps: r.summary?.peakSpeedMBps ?? 0,
      aliveCount: r.summary?.aliveCount ?? 0,
      speedTestedCount: r.summary?.speedTestedCount ?? 0,
      zombieCount: r.summary?.zombieCount ?? 0,
      medianDelayMs: r.summary?.medianDelayMs ?? null,
    };
  });

  // Consistency: coefficient of variation of per-run avg speed
  const runSpeeds = trend.map((t) => t.avgSpeedMBps).filter((v) => v > 0);
  const cv = runSpeeds.length >= 2 && mean(runSpeeds) > 0 ? r2(stddev(runSpeeds) / mean(runSpeeds)) : null;

  // Time bands
  const byBand = {};
  for (const b of TIME_BANDS) {
    const bandSamples = samples.filter((s) => s.band === b.id);
    byBand[b.id] = aggregate(bandSamples);
  }

  // 24-hour profile
  const byHour = [];
  const hourMap = groupBy(samples, (s) => s.hour);
  for (let h = 0; h < 24; h++) {
    const hs = hourMap.get(h) || [];
    if (!hs.length) {
      byHour.push({ hour: h, samples: 0, avgMBps: 0, aliveRate: null });
      continue;
    }
    const agg = aggregate(hs);
    byHour.push({ hour: h, samples: hs.length, avgMBps: agg.avgMBps, aliveRate: agg.aliveRate });
  }
  const hoursWithSpeed = byHour.filter((h) => h.samples > 0 && h.avgMBps > 0);
  const bestHour = hoursWithSpeed.length ? hoursWithSpeed.reduce((a, b) => (b.avgMBps > a.avgMBps ? b : a)) : null;
  const worstHour = hoursWithSpeed.length ? hoursWithSpeed.reduce((a, b) => (b.avgMBps < a.avgMBps ? b : a)) : null;

  // Regions (countries)
  const byRegion = {};
  for (const [region, regSamples] of groupBy(samples, (s) => s.region)) {
    const agg = aggregate(regSamples);
    const bands = {};
    for (const b of TIME_BANDS) {
      const bs = regSamples.filter((s) => s.band === b.id);
      const ba = aggregate(bs);
      bands[b.id] = { samples: bs.length, avgMBps: ba.avgMBps, aliveRate: ba.aliveRate, medianDelayMs: ba.medianDelayMs };
    }
    const bandEntries = TIME_BANDS.map((b) => ({ id: b.id, ...bands[b.id] })).filter((x) => x.samples > 0 && x.avgMBps > 0);
    const bestBand = bandEntries.length ? bandEntries.reduce((a, b) => (b.avgMBps > a.avgMBps ? b : a)).id : null;
    byRegion[region] = { ...agg, bands, bestBand };
  }

  // Flags / risks
  const flags = [];
  const evening = byBand.evening;
  const offPeakSpeeds = ["morning", "afternoon", "night"]
    .map((id) => byBand[id])
    .filter((b) => b.aliveCount >= 2 && b.avgMBps > 0);
  const bestOffPeak = offPeakSpeeds.length ? Math.max(...offPeakSpeeds.map((b) => b.avgMBps)) : 0;
  if (evening.aliveCount >= 2 && bestOffPeak > 0 && evening.avgMBps < bestOffPeak * 0.6) {
    flags.push({
      id: "evening_collapse",
      severity: "high",
      text: `Evening-peak speed collapses to ${evening.avgMBps} MB/s vs ${r2(bestOffPeak)} MB/s off-peak (−${Math.round((1 - evening.avgMBps / bestOffPeak) * 100)}%). Customers will complain at night.`,
    });
  }
  if (evening.samples === 0) {
    flags.push({
      id: "no_evening_data",
      severity: "info",
      text: "No evening-peak (18:00–23:00) test data yet. Schedule a daily 21:30 auto-run before deciding — evening is when resale customers actually use it.",
    });
  }
  if (overall.zombieRate != null && overall.zombieRate >= 10) {
    flags.push({ id: "high_zombie", severity: "high", text: `${overall.zombieRate}% of tested nodes are zombies (ping OK but 0 transfer).` });
  }
  if (cv != null && cv >= 0.5) {
    flags.push({ id: "unstable", severity: "medium", text: `Speed varies wildly between runs (CV ${Math.round(cv * 100)}%). Inconsistent service is risky for paying customers.` });
  }
  const div = latest?.summary?.entryDiversity;
  if (div?.singleEntryWarning) {
    flags.push({ id: "single_entry", severity: "medium", text: `${div.topIpSharePct}% of nodes share one entry IP — a single GFW block or carrier QoS throttle kills the whole airport.` });
  }
  const quota = latest?.summary?.quota;
  if (quota && quota.leftGb != null && quota.leftGb < 20) {
    flags.push({ id: "low_quota", severity: "info", text: `Only ${quota.leftGb} GB quota remaining on this subscription.` });
  }
  const deadRegions = Object.entries(byRegion)
    .filter(([, v]) => v.speedTested >= 2 && v.aliveCount === 0)
    .map(([k]) => k);
  if (deadRegions.length) {
    flags.push({ id: "dead_regions", severity: "medium", text: `Regions with zero working nodes: ${deadRegions.join(", ")}.` });
  }

  return {
    supplierId: supplier.id,
    supplierName: supplier.name,
    isPrimary: Boolean(supplier.isPrimary),
    priceMonthly: supplier.priceMonthly ?? null,
    currency: supplier.currency || "RMB",
    runsCount: sorted.length,
    firstTested: sorted[0]?.startedAt || null,
    lastTested: latest?.finishedAt || null,
    daysCovered: new Set(samples.map((s) => s.date)).size,
    bandsCovered: TIME_BANDS.filter((b) => byBand[b.id].samples > 0).map((b) => b.id),
    overall,
    cv,
    byBand,
    byHour,
    bestHour: bestHour ? { hour: bestHour.hour, avgMBps: bestHour.avgMBps } : null,
    worstHour: worstHour ? { hour: worstHour.hour, avgMBps: worstHour.avgMBps } : null,
    byRegion,
    trend,
    entryDiversity: div || null,
    quota: quota || null,
    flags,
  };
}

// ---------------- Reseller scoring ----------------

// Weighted for resale: evening-peak throughput matters most, then reliability
// and consistency, unlocks, latency, entry diversity, and value for money.
export function scoreForResale(rep, valuePts = 5) {
  const breakdown = {};

  // 1) Evening-peak speed (30 pts). Falls back to overall speed at 80% credit
  //    when no evening data exists yet.
  const ev = rep.byBand?.evening;
  let evSpeed = ev && ev.aliveCount > 0 ? ev.avgMBps : null;
  if (evSpeed != null) {
    breakdown.eveningSpeed = r2(Math.min(30, (evSpeed / 50) * 30));
  } else {
    breakdown.eveningSpeed = r2(Math.min(24, (rep.overall.avgMBps / 50) * 24));
  }

  // 2) Reliability (25 pts): alive-rate (15) + run-to-run consistency (10)
  const aliveRate = rep.overall.aliveRate != null ? rep.overall.aliveRate / 100 : 0;
  const consistency = rep.cv == null ? 0.5 : Math.max(0, 1 - Math.min(1, rep.cv));
  breakdown.reliability = r2(aliveRate * 15 + consistency * 10);

  // 3) Unlocks (15 pts): ChatGPT + Netflix + YouTube average
  const u = rep.overall.unlockRates;
  const uVals = u ? [u.chatgpt, u.netflix, u.youtube].filter((v) => v != null) : [];
  breakdown.unlocks = r2(uVals.length ? (mean(uVals) / 100) * 15 : 7.5);

  // 4) Latency (10 pts): 60ms => 10, 400ms => 0
  const d = rep.overall.medianDelayMs;
  breakdown.latency = d == null ? 0 : r2(Math.max(0, Math.min(10, ((400 - d) / 340) * 10)));

  // 5) Entry diversity (10 pts)
  const div = rep.entryDiversity;
  if (div) {
    const ratio = div.singleEntryWarning ? 0.25 : Math.min(1, (div.uniqueIps || 1) / 8);
    breakdown.diversity = r2(ratio * 10);
  } else {
    breakdown.diversity = 5;
  }

  // 6) Value for money (10 pts) — computed cross-supplier, passed in
  breakdown.value = r2(valuePts);

  const score = Math.round(Object.values(breakdown).reduce((a, b) => a + b, 0));
  const verdict =
    score >= 75 ? "Resell-ready" : score >= 60 ? "Strong candidate" : score >= 45 ? "Backup only" : "Avoid";
  return { score, verdict, breakdown };
}

// ---------------- Full cross-supplier report ----------------

export function buildDeepReport(runs, suppliers) {
  const runsBySupplier = groupBy(runs || [], (r) => r.supplierId);
  const reports = [];
  const untested = [];

  for (const sup of suppliers || []) {
    const supRuns = runsBySupplier.get(sup.id) || [];
    if (!supRuns.length) {
      untested.push({ supplierId: sup.id, supplierName: sup.name });
      continue;
    }
    reports.push(analyzeSupplier(sup, supRuns));
  }

  // Value for money across suppliers (RMB per MB/s of evening/overall speed)
  const ratios = reports.map((rep) => {
    const speed = rep.byBand?.evening?.aliveCount > 0 ? rep.byBand.evening.avgMBps : rep.overall.avgMBps;
    if (rep.priceMonthly == null || !speed) return null;
    return rep.priceMonthly / speed;
  });
  const validRatios = ratios.filter((x) => x != null && Number.isFinite(x));
  const bestRatio = validRatios.length ? Math.min(...validRatios) : null;

  for (let i = 0; i < reports.length; i++) {
    const ratio = ratios[i];
    let valuePts = 5;
    if (ratio != null && bestRatio != null && ratio > 0) {
      valuePts = Math.max(2, Math.min(10, 10 * (bestRatio / ratio)));
    }
    const { score, verdict, breakdown } = scoreForResale(reports[i], valuePts);
    reports[i].resale = {
      score,
      verdict,
      breakdown,
      rmbPerMBps: ratio != null && Number.isFinite(ratio) ? r2(ratio) : null,
    };
  }

  reports.sort((a, b) => b.resale.score - a.resale.score);

  // Cross-supplier matrices
  const allSamples = extractSamples(runs || []);
  const bandMatrix = {};
  for (const b of TIME_BANDS) {
    bandMatrix[b.id] = {};
    for (const rep of reports) {
      const agg = rep.byBand[b.id];
      bandMatrix[b.id][rep.supplierId] = { avgMBps: agg.avgMBps, aliveRate: agg.aliveRate, samples: agg.samples };
    }
  }

  const regionSet = [...new Set(allSamples.map((s) => s.region))].sort();
  const regionMatrix = {};
  for (const region of regionSet) {
    regionMatrix[region] = { bySupplier: {}, winner: null };
    let best = null;
    for (const rep of reports) {
      const r = rep.byRegion[region];
      if (!r) continue;
      regionMatrix[region].bySupplier[rep.supplierId] = {
        avgMBps: r.avgMBps,
        aliveRate: r.aliveRate,
        samples: r.samples,
        bestBand: r.bestBand,
      };
      if (r.aliveCount > 0 && (!best || r.avgMBps > best.avgMBps)) {
        best = { supplierId: rep.supplierId, supplierName: rep.supplierName, avgMBps: r.avgMBps };
      }
    }
    regionMatrix[region].winner = best;
  }

  // Region × time band combined (all suppliers): "what country works best when"
  const regionBand = {};
  for (const region of regionSet) {
    regionBand[region] = {};
    const regSamples = allSamples.filter((s) => s.region === region);
    let best = null;
    for (const b of TIME_BANDS) {
      const agg = aggregate(regSamples.filter((s) => s.band === b.id));
      regionBand[region][b.id] = { avgMBps: agg.avgMBps, aliveRate: agg.aliveRate, samples: agg.samples };
      if (agg.aliveCount > 0 && (!best || agg.avgMBps > best.avgMBps)) best = { band: b.id, avgMBps: agg.avgMBps };
    }
    regionBand[region].bestBand = best ? best.band : null;
  }

  // Recommendation narrative
  const recommendation = reports.map((rep, idx) => {
    const strengths = [];
    const risks = rep.flags.filter((f) => f.severity !== "info").map((f) => f.text);
    const notes = rep.flags.filter((f) => f.severity === "info").map((f) => f.text);

    const ev = rep.byBand.evening;
    if (ev.aliveCount > 0) strengths.push(`Evening-peak avg ${ev.avgMBps} MB/s over ${ev.aliveCount} live node tests`);
    if (rep.overall.aliveRate != null && rep.overall.aliveRate >= 90) strengths.push(`${rep.overall.aliveRate}% node alive rate`);
    if (rep.cv != null && rep.cv <= 0.25) strengths.push(`Very consistent across ${rep.runsCount} runs (CV ${Math.round(rep.cv * 100)}%)`);
    const u = rep.overall.unlockRates;
    if (u?.chatgpt != null && u.chatgpt >= 80) strengths.push(`ChatGPT unlock ${u.chatgpt}%`);
    if (u?.netflix != null && u.netflix >= 70) strengths.push(`Netflix unlock ${u.netflix}%`);
    const topRegions = Object.entries(rep.byRegion)
      .filter(([, v]) => v.aliveCount > 0)
      .sort((a, b) => b[1].avgMBps - a[1].avgMBps)
      .slice(0, 3)
      .map(([k, v]) => `${k} ${v.avgMBps} MB/s`);
    if (topRegions.length) strengths.push(`Best regions: ${topRegions.join(", ")}`);
    if (rep.resale.rmbPerMBps != null) strengths.push(`Value: ${rep.resale.rmbPerMBps} ${rep.currency}/mo per MB/s`);

    return {
      rank: idx + 1,
      supplierId: rep.supplierId,
      supplierName: rep.supplierName,
      isPrimary: rep.isPrimary,
      score: rep.resale.score,
      verdict: rep.resale.verdict,
      breakdown: rep.resale.breakdown,
      priceMonthly: rep.priceMonthly,
      currency: rep.currency,
      strengths,
      risks,
      notes,
    };
  });

  // Data coverage / confidence
  const allDates = new Set(allSamples.map((s) => s.date));
  const bandsCovered = TIME_BANDS.filter((b) => allSamples.some((s) => s.band === b.id)).map((b) => b.id);
  const totalRuns = (runs || []).length;
  const confidence = totalRuns >= 6 && bandsCovered.length >= 3 && allDates.size >= 3
    ? "high"
    : totalRuns >= 3 && bandsCovered.length >= 2
      ? "medium"
      : "low";
  const coverageAdvice = [];
  if (!bandsCovered.includes("evening")) coverageAdvice.push("No evening-peak (18–23) data yet — set the daily auto-run to 21:30 and collect at least 3 evenings before committing.");
  if (allDates.size < 3) coverageAdvice.push(`Data spans only ${allDates.size} day(s). Test across 3+ different days to catch weekend vs weekday congestion.`);
  if (bandsCovered.length < 3) coverageAdvice.push("Fewer than 3 time-of-day bands covered — run a morning and an afternoon test too, so the time analysis is meaningful.");

  return {
    generatedAt: new Date().toISOString(),
    timeBands: TIME_BANDS,
    coverage: {
      totalRuns,
      totalSamples: allSamples.length,
      daysCovered: allDates.size,
      bandsCovered,
      confidence,
      advice: coverageAdvice,
    },
    suppliers: reports,
    untested,
    bandMatrix,
    regionMatrix,
    regionBand,
    recommendation,
  };
}
