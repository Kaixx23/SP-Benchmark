// Aggregates historical benchmark runs into an extensive multi-hour / daily
// VPN stability & winner report (mean/floor speed, variance, daytime vs evening
// peak drop-off, uptime, zombie rate, hourly timeline, and Markdown/CSV export).

function round1(n) {
  return Math.round(n * 10) / 10;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return 0;
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

function isEveningPeakLocal(isoStr) {
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return false;
  const hr = d.getHours();
  return hr >= 20 && hr <= 23;
}

function hourBucketKey(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  const h = String(dateObj.getHours()).padStart(2, "0");
  return `${y}-${m}-${d} ${h}:00`;
}

export function buildStabilityReport({ suppliers = [], runs = [], hours = 24, now = new Date() } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const cutoffMs = hours > 0 ? nowMs - hours * 3600 * 1000 : 0;

  const windowRuns = runs.filter((r) => {
    const t = Date.parse(r.finishedAt || r.startedAt || "");
    return !Number.isNaN(t) && (cutoffMs === 0 || t >= cutoffMs) && r.summary;
  });

  // Build supplier map (include any supplier present in store or in windowRuns)
  const supMap = new Map();
  for (const s of suppliers) {
    supMap.set(s.id, {
      id: s.id,
      name: s.name,
      isPrimary: Boolean(s.isPrimary),
      priceMonthly: s.priceMonthly ?? null,
      currency: s.currency || "RMB",
    });
  }
  for (const r of windowRuns) {
    if (!supMap.has(r.supplierId)) {
      supMap.set(r.supplierId, {
        id: r.supplierId,
        name: r.supplierName || r.supplierId,
        isPrimary: Boolean(r.isPrimary),
        priceMonthly: r.priceMonthly ?? null,
        currency: r.currency || "RMB",
      });
    }
  }

  // Last up-to-24 hourly slots for timeline visualization
  const timelineHoursCount = Math.min(hours > 0 ? hours : 24, 24);
  const timelineSlots = [];
  const endHour = new Date(nowMs);
  endHour.setMinutes(0, 0, 0);
  for (let i = timelineHoursCount - 1; i >= 0; i--) {
    const slotDate = new Date(endHour.getTime() - i * 3600 * 1000);
    timelineSlots.push({
      key: hourBucketKey(slotDate),
      label: `${String(slotDate.getHours()).padStart(2, "0")}:00`,
      isPeak: slotDate.getHours() >= 20 && slotDate.getHours() <= 23,
    });
  }

  const rankings = [];

  for (const sup of supMap.values()) {
    const sRuns = windowRuns
      .filter((r) => r.supplierId === sup.id)
      .sort((a, b) => Date.parse(a.finishedAt) - Date.parse(b.finishedAt));

    if (!sRuns.length) {
      rankings.push({
        ...sup,
        runCount: 0,
        stabilityScore: null,
        stabilityGrade: "—",
        uptimePct: null,
        nodeAliveRatePct: null,
        meanSpeedMBps: 0,
        p10SpeedMBps: 0,
        minSpeedMBps: 0,
        maxSpeedMBps: 0,
        peakSpeedMBps: 0,
        speedStdDev: 0,
        speedCvPct: null,
        daytimeAvgMBps: null,
        eveningPeakAvgMBps: null,
        peakDropPct: null,
        totalZombies: 0,
        zombieRatePct: 0,
        meanDelayMs: null,
        delayJitterMs: null,
        unlocks: { chatgpt: null, netflix: null, youtube: null, disney: null },
        valueScoreMBpsPerUnit: null,
        hourlyTimeline: timelineSlots.map((sl) => ({ key: sl.key, label: sl.label, avgMBps: null, score: null, alive: null })),
      });
      continue;
    }

    const speeds = sRuns.map((r) => Number(r.summary.avgSpeedMBps || 0));
    const sortedSpeeds = [...speeds].sort((a, b) => a - b);
    const peaks = sRuns.map((r) => Number(r.summary.peakSpeedMBps || 0));
    const scores = sRuns.map((r) => Number(r.summary.score || 0));

    const aliveRuns = sRuns.filter((r) => (r.summary.aliveCount || 0) > 0 || (r.summary.mode === "ping" && (r.summary.pingAliveCount || 0) > 0));
    const uptimePct = round1((aliveRuns.length / sRuns.length) * 100);

    let testedNodesSum = 0;
    let aliveNodesSum = 0;
    let zombieNodesSum = 0;
    for (const r of sRuns) {
      testedNodesSum += Number(r.summary.speedTestedCount || 0);
      aliveNodesSum += Number(r.summary.aliveCount || 0);
      zombieNodesSum += Number(r.summary.zombieCount || 0);
    }
    const nodeAliveRatePct = testedNodesSum > 0 ? round1((aliveNodesSum / testedNodesSum) * 100) : uptimePct;
    const zombieRatePct = testedNodesSum > 0 ? round1((zombieNodesSum / testedNodesSum) * 100) : 0;

    const meanSpd = round2(mean(speeds));
    const stdSpd = round2(stddev(speeds));
    const cvPct = meanSpd > 0 ? round1((stdSpd / meanSpd) * 100) : 100;
    const p10Spd = round2(percentile(sortedSpeeds, 0.1));
    const minSpd = round2(sortedSpeeds[0]);
    const maxSpd = round2(sortedSpeeds[sortedSpeeds.length - 1]);
    const maxPeak = round2(Math.max(0, ...peaks));

    const peakRuns = sRuns.filter((r) => isEveningPeakLocal(r.finishedAt));
    const dayRuns = sRuns.filter((r) => !isEveningPeakLocal(r.finishedAt));
    const daytimeAvgMBps = dayRuns.length ? round2(mean(dayRuns.map((r) => Number(r.summary.avgSpeedMBps || 0)))) : null;
    const eveningPeakAvgMBps = peakRuns.length ? round2(mean(peakRuns.map((r) => Number(r.summary.avgSpeedMBps || 0)))) : null;
    let peakDropPct = null;
    if (daytimeAvgMBps != null && daytimeAvgMBps > 0 && eveningPeakAvgMBps != null) {
      peakDropPct = round1(((eveningPeakAvgMBps - daytimeAvgMBps) / daytimeAvgMBps) * 100);
    }

    const delays = sRuns.map((r) => r.summary.medianDelayMs).filter((d) => typeof d === "number" && d > 0);
    const meanDelayMs = delays.length ? Math.round(mean(delays)) : null;
    const delayJitterMs = delays.length >= 2 ? Math.round(stddev(delays)) : 0;

    const avgUnlock = (key) => {
      const vals = sRuns.map((r) => r.summary.unlockRates?.[key]).filter((v) => typeof v === "number");
      return vals.length ? Math.round(mean(vals)) : null;
    };
    const unlocks = {
      chatgpt: avgUnlock("chatgpt"),
      netflix: avgUnlock("netflix"),
      youtube: avgUnlock("youtube"),
      disney: avgUnlock("disney"),
    };

    // Stability Score (0 - 100):
    // 1) Mean Throughput (30 pts): 55 MB/s mean = 30 pts
    const speedPts = Math.min(30, (meanSpd / 55) * 30);
    // 2) Floor / Evening-Peak Resilience (25 pts): uses lower of eveningPeakAvgMBps (if available) and p10Spd
    const effectiveFloor = eveningPeakAvgMBps != null ? Math.min(eveningPeakAvgMBps, p10Spd || eveningPeakAvgMBps) : p10Spd;
    const floorPts = Math.min(25, (effectiveFloor / 40) * 25);
    // 3) Uptime & Node Health (25 pts): 60% run uptime + 40% node alive ratio, minus zombie penalty
    const healthPts = Math.max(0, (uptimePct / 100) * 15 + (nodeAliveRatePct / 100) * 10 - Math.min(6, (zombieRatePct / 100) * 12));
    // 4) Consistency + Latency + Unlocks (20 pts):
    //    - Low CV% (0% CV = 10 pts, >=80% CV = 0 pts)
    //    - Ping (<=60ms = 5 pts, >=400ms = 0 pts)
    //    - Unlocks (5 pts)
    const consistencyPts = sRuns.length >= 2
      ? Math.max(0, Math.min(10, ((80 - cvPct) / 80) * 10))
      : 6; // neutral partial credit when only 1 run exists so far
    const delayPts = meanDelayMs == null ? 0 : Math.max(0, Math.min(5, ((400 - meanDelayMs) / 340) * 5));
    const unlockVals = [unlocks.chatgpt, unlocks.netflix, unlocks.youtube].filter((v) => v != null);
    const unlockPts = unlockVals.length ? (mean(unlockVals) / 100) * 5 : 2.5;

    const stabilityScore = Math.round(speedPts + floorPts + healthPts + consistencyPts + delayPts + unlockPts);
    const stabilityGrade = stabilityScore >= 85
      ? "S"
      : stabilityScore >= 72
        ? "A"
        : stabilityScore >= 55
          ? "B"
          : stabilityScore >= 40
            ? "C"
            : "D";

    // Map runs into hourly buckets
    const bucketMap = new Map();
    for (const r of sRuns) {
      const k = hourBucketKey(new Date(r.finishedAt));
      if (!bucketMap.has(k)) bucketMap.set(k, []);
      bucketMap.get(k).push(r);
    }
    const hourlyTimeline = timelineSlots.map((sl) => {
      const br = bucketMap.get(sl.key);
      if (!br || !br.length) {
        return { key: sl.key, label: sl.label, isPeak: sl.isPeak, avgMBps: null, score: null, alive: null };
      }
      const bAvg = round1(mean(br.map((x) => Number(x.summary.avgSpeedMBps || 0))));
      const bScore = Math.round(mean(br.map((x) => Number(x.summary.score || 0))));
      const bAlive = br.some((x) => (x.summary.aliveCount || 0) > 0);
      return { key: sl.key, label: sl.label, isPeak: sl.isPeak, avgMBps: bAvg, score: bScore, alive: bAlive };
    });

    const valueScoreMBpsPerUnit = sup.priceMonthly && sup.priceMonthly > 0
      ? round2(meanSpd / sup.priceMonthly)
      : null;

    rankings.push({
      ...sup,
      runCount: sRuns.length,
      meanBaseScore: Math.round(mean(scores)),
      stabilityScore,
      stabilityGrade,
      uptimePct,
      nodeAliveRatePct,
      meanSpeedMBps: meanSpd,
      p10SpeedMBps: p10Spd,
      minSpeedMBps: minSpd,
      maxSpeedMBps: maxSpd,
      peakSpeedMBps: maxPeak,
      speedStdDev: stdSpd,
      speedCvPct: cvPct,
      daytimeAvgMBps,
      eveningPeakAvgMBps,
      peakDropPct,
      totalZombies: zombieNodesSum,
      zombieRatePct,
      meanDelayMs,
      delayJitterMs,
      unlocks,
      valueScoreMBpsPerUnit,
      firstRunAt: sRuns[0].finishedAt,
      lastRunAt: sRuns[sRuns.length - 1].finishedAt,
      hourlyTimeline,
    });
  }

  rankings.sort((a, b) => (b.stabilityScore ?? -1) - (a.stabilityScore ?? -1));

  const testedRankings = rankings.filter((r) => r.runCount > 0);
  const winner = testedRankings[0] || null;
  const runnerUp = testedRankings[1] || null;
  const bestValue = [...testedRankings]
    .filter((r) => r.valueScoreMBpsPerUnit != null)
    .sort((a, b) => b.valueScoreMBpsPerUnit - a.valueScoreMBpsPerUnit)[0] || null;

  let verdict = "No benchmark runs recorded in this time window yet. Run a test or enable Hourly Auto-Test in Settings.";
  if (winner) {
    const parts = [
      `${winner.name} ranks #1 overall with Stability Score ${winner.stabilityScore}/100 (${winner.stabilityGrade}) across ${winner.runCount} run(s)`,
      `averaging ${winner.meanSpeedMBps} MB/s (P10 floor ${winner.p10SpeedMBps} MB/s, ${winner.uptimePct}% uptime)`,
    ];
    if (winner.eveningPeakAvgMBps != null) {
      const dropStr = winner.peakDropPct != null
        ? ` (${winner.peakDropPct >= 0 ? "+" : ""}${winner.peakDropPct}% vs daytime)`
        : "";
      parts.push(`and ${winner.eveningPeakAvgMBps} MB/s during 20:00–24:00 evening peak${dropStr}`);
    }
    if (runnerUp) {
      const diff = round1(winner.meanSpeedMBps - runnerUp.meanSpeedMBps);
      parts.push(`ahead of #2 ${runnerUp.name} (${runnerUp.stabilityScore}/100, ${diff >= 0 ? "+" : ""}${diff} MB/s mean diff)`);
    }
    verdict = parts.join(", ") + ".";
  }

  return {
    generatedAt: new Date(nowMs).toISOString(),
    windowHours: hours,
    totalRunsInWindow: windowRuns.length,
    timelineSlots,
    winner: winner ? { id: winner.id, name: winner.name, stabilityScore: winner.stabilityScore, stabilityGrade: winner.stabilityGrade } : null,
    bestValue: bestValue ? { id: bestValue.id, name: bestValue.name, valueScoreMBpsPerUnit: bestValue.valueScoreMBpsPerUnit, currency: bestValue.currency } : null,
    verdict,
    rankings,
  };
}

export function formatStabilityMarkdown(report) {
  const lines = [
    `# 📊 VPN Stability & Daily Winner Report`,
    ``,
    `- **Generated:** ${new Date(report.generatedAt).toLocaleString()}`,
    `- **Window:** ${report.windowHours > 0 ? `Last ${report.windowHours} hours` : "All recorded history"}`,
    `- **Total Runs Analyzed:** ${report.totalRunsInWindow}`,
    ``,
    `## 🏆 Executive Verdict`,
    ``,
    `> ${report.verdict}`,
    ``,
  ];

  if (report.bestValue) {
    lines.push(`- **Best Value for Money:** **${report.bestValue.name}** (${report.bestValue.valueScoreMBpsPerUnit} MB/s per ${report.bestValue.currency}/mo)`);
    lines.push(``);
  }

  lines.push(`## 📈 Overall Stability Leaderboard`);
  lines.push(``);
  lines.push(`| Rank | VPN Supplier | Stability | Runs | Uptime | Mean Speed | Floor (P10) | Evening Peak (20-24h) | Jitter (CV%) | Alive % | Zombies | Avg Ping | Unlocks (GPT/NF/YT) |`);
  lines.push(`|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|`);

  report.rankings.forEach((r, idx) => {
    if (!r.runCount) {
      lines.push(`| ${idx + 1} | ${r.name}${r.isPrimary ? " ⭐" : ""} | — | 0 | — | — | — | — | — | — | — | — | — |`);
      return;
    }
    const peakCell = r.eveningPeakAvgMBps != null
      ? `${r.eveningPeakAvgMBps} MB/s${r.peakDropPct != null ? ` (${r.peakDropPct >= 0 ? "+" : ""}${r.peakDropPct}%)` : ""}`
      : "No peak run";
    const u = r.unlocks || {};
    const unlockCell = [
      u.chatgpt != null ? `${u.chatgpt}%` : "-",
      u.netflix != null ? `${u.netflix}%` : "-",
      u.youtube != null ? `${u.youtube}%` : "-",
    ].join(" / ");
    lines.push(
      `| ${idx + 1} | **${r.name}**${r.isPrimary ? " ⭐" : ""} | **${r.stabilityScore}** (${r.stabilityGrade}) | ${r.runCount} | ${r.uptimePct}% | **${r.meanSpeedMBps} MB/s** | ${r.p10SpeedMBps} MB/s | ${peakCell} | ±${r.speedStdDev} (${r.speedCvPct}%) | ${r.nodeAliveRatePct}% | ${r.totalZombies} | ${r.meanDelayMs ?? "-"} ms | ${unlockCell} |`
    );
  });

  lines.push(``);
  lines.push(`## 🕒 Hour-by-Hour Speed Matrix (MB/s)`);
  lines.push(``);

  const tested = report.rankings.filter((r) => r.runCount > 0);
  if (!tested.length) {
    lines.push(`_No hourly data recorded yet._`);
  } else {
    const activeSlots = report.timelineSlots.filter((sl, idx) =>
      tested.some((r) => r.hourlyTimeline[idx]?.avgMBps != null)
    );
    if (!activeSlots.length) {
      lines.push(`_Runs occurred outside the last 24-hour hourly grid._`);
    } else {
      const hdr = ["Hour", ...tested.map((r) => r.name)];
      lines.push(`| ${hdr.join(" | ")} |`);
      lines.push(`|${hdr.map((_, i) => (i === 0 ? "---" : "---:")).join("|")}|`);
      for (const sl of activeSlots) {
        const slotIdx = report.timelineSlots.findIndex((x) => x.key === sl.key);
        const cells = tested.map((r) => {
          const c = r.hourlyTimeline[slotIdx];
          return c && c.avgMBps != null ? `${c.avgMBps}` : "—";
        });
        lines.push(`| ${sl.key}${sl.isPeak ? " 🔥" : ""} | ${cells.join(" | ")} |`);
      }
    }
  }

  lines.push(``);
  return lines.join("\n");
}

export function formatRunsCsv(runs = [], hours = 24, now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const cutoffMs = hours > 0 ? nowMs - hours * 3600 * 1000 : 0;
  const filtered = runs.filter((r) => {
    const t = Date.parse(r.finishedAt || r.startedAt || "");
    return !Number.isNaN(t) && (cutoffMs === 0 || t >= cutoffMs) && r.summary;
  });

  const csvEsc = (v) => {
    const s = String(v ?? "");
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const header = [
    "finishedAt",
    "supplierName",
    "isPrimary",
    "mode",
    "score",
    "grade",
    "avgSpeedMBps",
    "medianSpeedMBps",
    "peakSpeedMBps",
    "medianDelayMs",
    "aliveCount",
    "speedTestedCount",
    "zombieCount",
    "totalNodes",
    "chatgptUnlockPct",
    "netflixUnlockPct",
    "youtubeUnlockPct",
  ];

  const rows = [header.join(",")];
  for (const r of filtered) {
    const s = r.summary;
    rows.push([
      r.finishedAt,
      r.supplierName,
      r.isPrimary ? "true" : "false",
      s.mode,
      s.score,
      s.grade,
      s.avgSpeedMBps,
      s.medianSpeedMBps,
      s.peakSpeedMBps,
      s.medianDelayMs ?? "",
      s.aliveCount,
      s.speedTestedCount,
      s.zombieCount,
      s.totalNodes,
      s.unlockRates?.chatgpt ?? "",
      s.unlockRates?.netflix ?? "",
      s.unlockRates?.youtube ?? "",
    ].map(csvEsc).join(","));
  }
  return rows.join("\n") + "\n";
}
