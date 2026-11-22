// Deep Analysis Report page (zero external CDN dependencies; works offline on LAN).
// Served at GET /report — renders /api/report data into a reseller decision report.

export function renderReportHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Deep Analysis Report — Airport Bench</title>
<style>
:root{
  --bg:#090f1d; --panel:#111a2e; --panel2:#0d1526; --line:rgba(148,163,184,.16);
  --text:#e6edf7; --dim:#8da0bd; --blue:#60a5fa; --indigo:#6366f1;
  --green:#34d399; --amber:#fbbf24; --red:#f87171; --pink:#f472b6;
}
*{box-sizing:border-box}
body{
  margin:0; padding:20px 16px 80px; color:var(--text); background:var(--bg);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;
  background-image:radial-gradient(900px 420px at 50% -120px,rgba(59,130,246,.22),transparent);
}
.wrap{max-width:1320px;margin:0 auto}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin-bottom:16px}
h1{margin:0;font-size:21px;font-weight:800}
.sub{font-size:12px;color:var(--dim);margin-top:3px}
a.btn,button{cursor:pointer;border:1px solid var(--line);background:#18243f;color:var(--text);padding:8px 13px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;display:inline-block}
a.btn:hover,button:hover{background:#213154}
.card{background:linear-gradient(180deg,#131e36,#0f172a);border:1px solid var(--line);border-radius:16px;padding:16px;margin-bottom:16px}
.card h2{margin:0 0 4px;font-size:16px;font-weight:800}
.card .h-sub{font-size:12px;color:var(--dim);margin-bottom:12px}
.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:14px;background:var(--panel)}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:9px 11px;text-align:left;border-bottom:1px solid var(--line);white-space:nowrap}
th{font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--dim);background:rgba(9,15,29,.55);font-weight:700}
tr:last-child td{border-bottom:none}
tr:hover td{background:rgba(255,255,255,.02)}
.badge{display:inline-block;padding:2px 7px;border-radius:6px;font-size:11px;font-weight:700}
.b-primary{background:rgba(52,211,153,.15);color:var(--green);border:1px solid rgba(52,211,153,.35)}
.b-warn{background:rgba(251,191,36,.15);color:var(--amber);border:1px solid rgba(251,191,36,.35)}
.b-bad{background:rgba(248,113,113,.15);color:var(--red);border:1px solid rgba(248,113,113,.35)}
.b-info{background:rgba(96,165,250,.15);color:var(--blue);border:1px solid rgba(96,165,250,.3)}
.muted{color:var(--dim);font-size:12px}
.rank-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px}
.rank-card{border:1px solid var(--line);border-radius:14px;padding:14px 16px;background:var(--panel2);position:relative}
.rank-card.top{border-color:rgba(52,211,153,.5);box-shadow:0 0 24px rgba(52,211,153,.08)}
.rank-no{position:absolute;top:-11px;left:14px;background:#18243f;border:1px solid var(--line);border-radius:8px;padding:2px 9px;font-size:12px;font-weight:800}
.rank-card.top .rank-no{background:linear-gradient(90deg,#059669,#10b981);border:0;color:#fff}
.score-big{font-size:30px;font-weight:800;line-height:1}
.verdict{font-size:12px;font-weight:800;padding:3px 9px;border-radius:7px;display:inline-block;margin-top:4px}
.v-resell{background:rgba(52,211,153,.18);color:var(--green)}
.v-strong{background:rgba(96,165,250,.18);color:var(--blue)}
.v-backup{background:rgba(251,191,36,.18);color:var(--amber)}
.v-avoid{background:rgba(248,113,113,.18);color:var(--red)}
ul.pts{margin:8px 0 0;padding-left:18px;font-size:12.5px;line-height:1.65}
ul.pts li.risk{color:#fca5a5}
ul.pts li.note{color:var(--dim)}
.heat{display:inline-flex;align-items:center;justify-content:center;min-width:72px;padding:4px 8px;border-radius:7px;font-weight:700;font-size:12px}
.hcell{text-align:center !important}
.hour-grid{display:grid;grid-template-columns:repeat(24,1fr);gap:3px;margin-top:6px}
.hour-cell{height:34px;border-radius:5px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:9px;background:var(--panel2);border:1px solid var(--line);color:var(--dim)}
.hour-cell b{font-size:10px;color:var(--text)}
.conf{padding:10px 14px;border-radius:12px;margin-bottom:16px;font-size:13px;border:1px solid}
.conf.high{border-color:rgba(52,211,153,.4);background:rgba(52,211,153,.08)}
.conf.medium{border-color:rgba(251,191,36,.4);background:rgba(251,191,36,.08)}
.conf.low{border-color:rgba(248,113,113,.4);background:rgba(248,113,113,.08)}
.conf ul{margin:6px 0 0;padding-left:18px}
.bd-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.bd-chip{font-size:10.5px;background:var(--panel);border:1px solid var(--line);padding:2px 7px;border-radius:6px;color:var(--dim)}
h3.sec{margin:18px 0 8px;font-size:14px}
details{border:1px solid var(--line);border-radius:12px;margin-bottom:10px;background:var(--panel2)}
details summary{cursor:pointer;padding:11px 14px;font-weight:700;font-size:13.5px;list-style:none;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}
details[open] summary{border-bottom:1px solid var(--line)}
.det-body{padding:12px 14px}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div>
      <h1>📊 Deep Analysis Report</h1>
      <div class="sub" id="genSub">Loading all historical benchmark runs…</div>
    </div>
    <div style="display:flex;gap:8px">
      <a class="btn" href="/">← Back to Dashboard</a>
      <button onclick="load()">↻ Refresh</button>
      <button onclick="window.print()">🖨 Print / PDF</button>
    </div>
  </header>
  <div id="content"><div class="muted">Loading…</div></div>
</div>

<script>
const BAND_LABELS = { morning:"Morning 06–12", afternoon:"Afternoon 12–18", evening:"Evening Peak 18–23", night:"Late Night 23–06" };
const BANDS = ["morning","afternoon","evening","night"];
let R = null;

function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}

// green→red heat color for speed values (MB/s), scaled to maxSpeed
function heat(v, max){
  if(v == null || !max) return 'background:var(--panel2);color:var(--dim)';
  const r = Math.max(0, Math.min(1, v / max));
  const hue = Math.round(r * 130); // 0=red → 130=green
  return \`background:hsla(\${hue},70%,45%,.\${r<0.08?'08':'22'});color:\${r<0.08?'var(--dim)':'var(--text)'};border:1px solid hsla(\${hue},70%,55%,.35)\`;
}
function fmtS(v){ return v==null?"—":(v?v.toFixed(1):"0.0"); }
function fmtPct(v){ return v==null?"—":Math.round(v)+"%"; }
function verdictCls(v){
  return v==="Resell-ready"?"v-resell":v==="Strong candidate"?"v-strong":v==="Backup only"?"v-backup":"v-avoid";
}
function globalMaxSpeed(){
  let m = 0;
  for(const sup of R.suppliers){
    for(const b of BANDS){ m = Math.max(m, sup.byBand[b].avgMBps||0); }
    for(const k in sup.byRegion){ m = Math.max(m, sup.byRegion[k].avgMBps||0); }
  }
  return m || 1;
}

function renderCoverage(){
  const c = R.coverage;
  const label = c.confidence==="high"?"HIGH confidence — enough data to decide":c.confidence==="medium"?"MEDIUM confidence — usable, but collect more time-of-day data":"LOW confidence — do NOT commit money yet, collect more data first";
  const advice = c.advice.length? \`<ul>\${c.advice.map(a=>\`<li>\${esc(a)}</li>\`).join("")}</ul>\` : "";
  const bands = c.bandsCovered.map(b=>BAND_LABELS[b]).join(", ") || "none";
  return \`<div class="conf \${c.confidence}">
    <b>Data coverage: \${c.totalRuns} runs · \${c.totalSamples} node tests · \${c.daysCovered} day(s) · time bands: \${esc(bands)}</b>
    <div style="margin-top:4px">\${label}</div>\${advice}
  </div>\`;
}

function renderRecommendation(){
  const cards = R.recommendation.map(rec=>{
    const bd = rec.breakdown;
    const price = rec.priceMonthly!=null ? \`\${rec.priceMonthly} \${esc(rec.currency)}/mo\` : "price not set";
    const lis = [
      ...rec.strengths.map(s=>\`<li>✅ \${esc(s)}</li>\`),
      ...rec.risks.map(s=>\`<li class="risk">⚠️ \${esc(s)}</li>\`),
      ...rec.notes.map(s=>\`<li class="note">ℹ️ \${esc(s)}</li>\`),
    ].join("");
    return \`<div class="rank-card \${rec.rank===1?'top':''}">
      <div class="rank-no">#\${rec.rank}\${rec.rank===1?" · RECOMMENDED":""}</div>
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-top:6px">
        <div>
          <b style="font-size:15px">\${esc(rec.supplierName)}</b>
          \${rec.isPrimary?' <span class="badge b-primary">PRIMARY</span>':''}
          <div class="muted">\${price}</div>
        </div>
        <div style="text-align:right">
          <div class="score-big">\${rec.score}</div>
          <div class="verdict \${verdictCls(rec.verdict)}">\${esc(rec.verdict)}</div>
        </div>
      </div>
      <div class="bd-row">
        <span class="bd-chip">Evening \${bd.eveningSpeed}/30</span>
        <span class="bd-chip">Reliability \${bd.reliability}/25</span>
        <span class="bd-chip">Unlocks \${bd.unlocks}/15</span>
        <span class="bd-chip">Latency \${bd.latency}/10</span>
        <span class="bd-chip">Diversity \${bd.diversity}/10</span>
        <span class="bd-chip">Value \${bd.value}/10</span>
      </div>
      <ul class="pts">\${lis || '<li class="note">No notable signals yet — run more tests.</li>'}</ul>
    </div>\`;
  }).join("");
  const untested = R.untested.length
    ? \`<div class="muted" style="margin-top:10px">Not yet tested (excluded from ranking): \${R.untested.map(u=>esc(u.supplierName)).join(", ")}</div>\`
    : "";
  return \`<div class="card">
    <h2>🏆 Resale Verdict — Ranked</h2>
    <div class="h-sub">Weighted for reselling: evening-peak speed 30 · reliability &amp; consistency 25 · AI/streaming unlocks 15 · latency 10 · entry diversity 10 · value for money 10</div>
    <div class="rank-grid">\${cards}</div>\${untested}
  </div>\`;
}

function renderHeadToHead(){
  const rows = R.suppliers.map(s=>{
    const u = s.overall.unlockRates||{};
    const div = s.entryDiversity;
    return \`<tr>
      <td><b>\${esc(s.supplierName)}</b>\${s.isPrimary?' <span class="badge b-primary">P</span>':''}<div class="muted">\${s.runsCount} runs · \${s.daysCovered} day(s)</div></td>
      <td><b>\${s.resale.score}</b> <span class="muted">\${esc(s.resale.verdict)}</span></td>
      <td><b>\${fmtS(s.overall.avgMBps)}</b> / \${fmtS(s.overall.medianMBps)} <span class="muted">MB/s</span></td>
      <td>\${fmtS(s.overall.peakMBps)} <span class="muted">MB/s</span></td>
      <td>\${fmtPct(s.overall.aliveRate)} <span class="muted">alive</span>\${s.overall.zombieRate?\` · <span style="color:var(--red)">\${fmtPct(s.overall.zombieRate)} zombie</span>\`:""}</td>
      <td>\${s.overall.medianDelayMs!=null?s.overall.medianDelayMs+" ms":"—"}</td>
      <td>\${s.cv!=null?Math.round(s.cv*100)+"%":"—"}</td>
      <td class="muted">GPT \${fmtPct(u.chatgpt)} · NF \${fmtPct(u.netflix)} · YT \${fmtPct(u.youtube)} · D+ \${fmtPct(u.disney)}</td>
      <td>\${div? (div.singleEntryWarning? \`<span class="badge b-warn">⚠ \${div.uniqueIps} IPs</span>\` : \`<span class="badge b-info">\${div.uniqueIps} IPs</span>\`) : "—"}</td>
      <td>\${s.resale.rmbPerMBps!=null? s.resale.rmbPerMBps+" "+esc(s.currency)+" / MBps" : "—"}</td>
    </tr>\`;
  }).join("");
  return \`<div class="card">
    <h2>⚔️ Head-to-Head (all history combined)</h2>
    <div class="h-sub">Speeds average only ALIVE node tests. CV = run-to-run speed variation (lower = more stable service).</div>
    <div class="table-wrap"><table>
      <thead><tr><th>Supplier</th><th>Resale Score</th><th>Avg / Median</th><th>Peak</th><th>Alive / Zombie</th><th>Median Ping</th><th>Variation</th><th>Unlocks</th><th>Entry IPs</th><th>Cost per MB/s</th></tr></thead>
      <tbody>\${rows}</tbody>
    </table></div>
  </div>\`;
}

function renderTimeBands(){
  const max = globalMaxSpeed();
  const head = BANDS.map(b=>\`<th class="hcell">\${BAND_LABELS[b]}</th>\`).join("");
  const rows = R.suppliers.map(s=>{
    const cells = BANDS.map(b=>{
      const a = s.byBand[b];
      if(!a.samples) return '<td class="hcell"><span class="muted">no data</span></td>';
      return \`<td class="hcell"><span class="heat" style="\${heat(a.avgMBps,max)}">\${fmtS(a.avgMBps)} MB/s</span><div class="muted">\${fmtPct(a.aliveRate)} alive · \${a.medianDelayMs!=null?a.medianDelayMs+"ms":"—"} · n=\${a.speedTested}</div></td>\`;
    }).join("");
    const bestH = s.bestHour? \`best \${String(s.bestHour.hour).padStart(2,"0")}:00 (\${fmtS(s.bestHour.avgMBps)})\` : "";
    const worstH = s.worstHour? \` · worst \${String(s.worstHour.hour).padStart(2,"0")}:00 (\${fmtS(s.worstHour.avgMBps)})\` : "";
    return \`<tr><td><b>\${esc(s.supplierName)}</b><div class="muted">\${bestH}\${worstH}</div></td>\${cells}</tr>\`;
  }).join("");

  const hourBlocks = R.suppliers.map(s=>{
    const cells = s.byHour.map(h=>{
      if(!h.samples) return \`<div class="hour-cell" title="\${h.hour}:00 — no data">\${h.hour}</div>\`;
      return \`<div class="hour-cell" style="\${heat(h.avgMBps,max)}" title="\${h.hour}:00 — \${fmtS(h.avgMBps)} MB/s avg, \${fmtPct(h.aliveRate)} alive, \${h.samples} samples"><b>\${fmtS(h.avgMBps)}</b>\${h.hour}h</div>\`;
    }).join("");
    return \`<h3 class="sec">\${esc(s.supplierName)} — 24h speed profile (MB/s, hover for detail)</h3><div class="hour-grid">\${cells}</div>\`;
  }).join("");

  return \`<div class="card">
    <h2>⏰ Time-of-Day Performance</h2>
    <div class="h-sub">When does each airport actually perform? Evening Peak (18–23) is what your resale customers will feel. Cells are colored vs the fastest observed speed (\${fmtS(max)} MB/s).</div>
    <div class="table-wrap"><table><thead><tr><th>Supplier</th>\${head}</tr></thead><tbody>\${rows}</tbody></table></div>
    \${hourBlocks}
  </div>\`;
}

function renderRegions(){
  const max = globalMaxSpeed();
  const regions = Object.keys(R.regionMatrix);
  if(!regions.length) return "";
  const supHead = R.suppliers.map(s=>\`<th class="hcell">\${esc(s.supplierName)}</th>\`).join("");
  const rows = regions.map(reg=>{
    const rm = R.regionMatrix[reg];
    const cells = R.suppliers.map(s=>{
      const c = rm.bySupplier[s.supplierId];
      if(!c || !c.samples) return '<td class="hcell"><span class="muted">—</span></td>';
      const isWin = rm.winner && rm.winner.supplierId===s.supplierId;
      return \`<td class="hcell">\${isWin?"👑 ":""}<span class="heat" style="\${heat(c.avgMBps,max)}">\${fmtS(c.avgMBps)}</span><div class="muted">\${fmtPct(c.aliveRate)} alive\${c.bestBand?" · best: "+BAND_LABELS[c.bestBand].split(" ")[0]:""}</div></td>\`;
    }).join("");
    return \`<tr><td><b>\${esc(reg)}</b></td>\${cells}</tr>\`;
  }).join("");

  const bandHead = BANDS.map(b=>\`<th class="hcell">\${BAND_LABELS[b]}</th>\`).join("");
  const rbRows = regions.map(reg=>{
    const rb = R.regionBand[reg];
    const cells = BANDS.map(b=>{
      const c = rb[b];
      if(!c || !c.samples) return '<td class="hcell"><span class="muted">—</span></td>';
      const best = rb.bestBand===b;
      return \`<td class="hcell">\${best?"⭐ ":""}<span class="heat" style="\${heat(c.avgMBps,max)}">\${fmtS(c.avgMBps)}</span><div class="muted">\${fmtPct(c.aliveRate)} alive · n=\${c.samples}</div></td>\`;
    }).join("");
    return \`<tr><td><b>\${esc(reg)}</b></td>\${cells}</tr>\`;
  }).join("");

  return \`<div class="card">
    <h2>🌍 Country / Region Analysis</h2>
    <div class="h-sub">👑 = fastest supplier for that region. Avg MB/s over alive nodes, all history.</div>
    <div class="table-wrap"><table><thead><tr><th>Region</th>\${supHead}</tr></thead><tbody>\${rows}</tbody></table></div>
    <h3 class="sec">Region × Time of Day (all suppliers combined) — ⭐ = best time window for that country</h3>
    <div class="table-wrap"><table><thead><tr><th>Region</th>\${bandHead}</tr></thead><tbody>\${rbRows}</tbody></table></div>
  </div>\`;
}

function renderDeepDives(){
  const max = globalMaxSpeed();
  const blocks = R.suppliers.map(s=>{
    const regRows = Object.entries(s.byRegion).sort((a,b)=>(b[1].avgMBps||0)-(a[1].avgMBps||0)).map(([reg,v])=>{
      const u = v.unlockRates||{};
      const bandCells = BANDS.map(b=>{
        const c = v.bands[b];
        if(!c || !c.samples) return '<td class="hcell"><span class="muted">—</span></td>';
        return \`<td class="hcell"><span class="heat" style="\${heat(c.avgMBps,max)}">\${fmtS(c.avgMBps)}</span></td>\`;
      }).join("");
      return \`<tr>
        <td><b>\${esc(reg)}</b>\${v.bestBand?\`<div class="muted">best: \${BAND_LABELS[v.bestBand]}</div>\`:""}</td>
        <td>\${fmtS(v.avgMBps)} <span class="muted">MB/s</span></td>
        <td>\${fmtS(v.peakMBps)}</td>
        <td>\${fmtPct(v.aliveRate)}\${v.zombieRate?\` <span style="color:var(--red)">(\${fmtPct(v.zombieRate)} 🧟)</span>\`:""}</td>
        <td>\${v.medianDelayMs!=null?v.medianDelayMs+" ms":"—"}</td>
        \${bandCells}
        <td class="muted">GPT \${fmtPct(u.chatgpt)} · NF \${fmtPct(u.netflix)} · YT \${fmtPct(u.youtube)}</td>
      </tr>\`;
    }).join("");

    const trendRows = [...s.trend].reverse().slice(0,15).map(t=>\`<tr>
      <td>\${new Date(t.time).toLocaleString()}</td>
      <td>\${BAND_LABELS[t.band]}</td>
      <td>\${esc(t.mode||"—")}</td>
      <td><b>\${t.score??"—"}</b> (\${esc(t.grade||"—")})</td>
      <td>\${fmtS(t.avgSpeedMBps)} / \${fmtS(t.peakSpeedMBps)} <span class="muted">MB/s</span></td>
      <td>\${t.aliveCount}/\${t.speedTestedCount}\${t.zombieCount?\` <span style="color:var(--red)">🧟\${t.zombieCount}</span>\`:""}</td>
      <td>\${t.medianDelayMs!=null?t.medianDelayMs+" ms":"—"}</td>
    </tr>\`).join("");

    const flags = s.flags.length
      ? \`<ul class="pts">\${s.flags.map(f=>\`<li class="\${f.severity==='info'?'note':'risk'}">\${f.severity==='info'?'ℹ️':'⚠️'} \${esc(f.text)}</li>\`).join("")}</ul>\`
      : '<div class="muted">No risk flags detected.</div>';

    return \`<details>
      <summary><span>\${esc(s.supplierName)} — \${s.resale.score} (\${esc(s.resale.verdict)})</span><span class="muted">\${s.runsCount} runs · last \${s.lastTested?new Date(s.lastTested).toLocaleString():"—"}</span></summary>
      <div class="det-body">
        <h3 class="sec" style="margin-top:0">Risk flags</h3>
        \${flags}
        <h3 class="sec">Regions — avg speed by time band (MB/s)</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>Region</th><th>Avg</th><th>Peak</th><th>Alive</th><th>Ping</th><th>Morning</th><th>Afternoon</th><th>Evening</th><th>Night</th><th>Unlocks</th></tr></thead>
          <tbody>\${regRows}</tbody>
        </table></div>
        <h3 class="sec">Run history (latest 15)</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>When</th><th>Time Band</th><th>Mode</th><th>Score</th><th>Avg / Peak</th><th>Alive</th><th>Ping</th></tr></thead>
          <tbody>\${trendRows}</tbody>
        </table></div>
      </div>
    </details>\`;
  }).join("");
  return \`<div class="card"><h2>🔬 Per-Supplier Deep Dive</h2><div class="h-sub">Click a supplier to expand its full region × time breakdown, risk flags and run history.</div>\${blocks}</div>\`;
}

function renderMethodology(){
  return \`<div class="card">
    <h2>📖 How to read this report</h2>
    <ul class="pts" style="margin-top:4px">
      <li><b>Evening Peak (18:00–23:00)</b> is weighted heaviest — it's when mainland cross-border congestion is worst and when resale customers will judge you. A supplier that only shines at 3 AM is useless for resale.</li>
      <li><b>Alive rate</b> counts nodes that actually transferred data; <b>zombies</b> ping fine but move 0 bytes — airports pad node lists with these.</li>
      <li><b>Variation (CV)</b> compares average speed across runs: under 25% is stable, over 50% means the service is a lottery.</li>
      <li><b>Entry diversity</b>: if most nodes share one entry IP, one GFW block or carrier QoS throttle takes the whole airport down — a real resale risk.</li>
      <li><b>Cost per MB/s</b> uses evening-peak speed when available, so a cheap but congested airport doesn't look falsely good.</li>
      <li>Decide only on <b>HIGH confidence</b> data: 3+ days, 3+ time bands, including several evening runs (set the daily 21:30 auto-run in Settings).</li>
    </ul>
  </div>\`;
}

async function load(){
  const r = await fetch("/api/report");
  R = await r.json();
  document.getElementById("genSub").textContent =
    "Generated " + new Date(R.generatedAt).toLocaleString() + " · " + R.coverage.totalRuns + " runs analyzed · " + R.suppliers.length + " supplier(s)";
  if(!R.suppliers.length){
    document.getElementById("content").innerHTML = '<div class="card"><h2>No benchmark data yet</h2><div class="h-sub">Run at least one benchmark from the dashboard, ideally at different times of day, then come back.</div></div>';
    return;
  }
  document.getElementById("content").innerHTML =
    renderCoverage() +
    renderRecommendation() +
    renderHeadToHead() +
    renderTimeBands() +
    renderRegions() +
    renderDeepDives() +
    renderMethodology();
}
load();
</script>
</body>
</html>`;
}
