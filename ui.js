// Single-page Web UI for Airport Bench (zero external CDN dependencies; works offline on LAN).

export function renderUiHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Airport Bench — Multi-VPN Speed &amp; Unlock Lab</title>
<style>
:root{
  --bg:#090f1d; --panel:#111a2e; --panel2:#0d1526; --line:rgba(148,163,184,.16);
  --text:#e6edf7; --dim:#8da0bd; --blue:#60a5fa; --indigo:#6366f1;
  --green:#34d399; --amber:#fbbf24; --red:#f87171; --pink:#f472b6;
}
*{box-sizing:border-box}
body{
  margin:0; padding:20px 16px 60px; color:var(--text); background:var(--bg);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;
  background-image:radial-gradient(900px 420px at 50% -120px,rgba(59,130,246,.22),transparent);
}
.wrap{max-width:1320px;margin:0 auto}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin-bottom:18px}
.brand{display:flex;align-items:center;gap:12px}
.brand h1{margin:0;font-size:21px;font-weight:800;letter-spacing:.2px}
.brand .sub{font-size:12px;color:var(--dim);margin-top:2px}
.hdr-right{display:flex;flex-wrap:wrap;gap:8px;align-items:center}

.pill{display:inline-flex;align-items:center;gap:7px;padding:7px 12px;border-radius:999px;font-size:12px;font-weight:600;border:1px solid var(--line);background:var(--panel)}
.dot{width:8px;height:8px;border-radius:50%;background:var(--dim)}
.pill.ok .dot{background:var(--green);box-shadow:0 0 8px var(--green)}
.pill.warn .dot{background:var(--amber);box-shadow:0 0 8px var(--amber)}
.pill.err .dot{background:var(--red)}

button,.btn{
  cursor:pointer;border:1px solid var(--line);background:#18243f;color:var(--text);
  padding:8px 13px;border-radius:10px;font-size:13px;font-weight:600;transition:.15s;
}
button:hover{background:#213154}
button:disabled{opacity:.45;cursor:not-allowed}
.btn-primary{background:linear-gradient(90deg,#2563eb,#4f46e5);border:0;color:#fff}
.btn-primary:hover{filter:brightness(1.08)}
.btn-green{background:linear-gradient(90deg,#059669,#10b981);border:0;color:#fff}
.btn-danger{background:#3b1822;border-color:rgba(248,113,113,.35);color:#fca5a5}
.btn-sm{padding:5px 9px;font-size:12px;border-radius:8px}

.grid-top{display:grid;grid-template-columns:1.25fr 1fr;gap:14px;margin-bottom:16px}
@media(max-width:920px){.grid-top{grid-template-columns:1fr}}

.card{background:linear-gradient(180deg,#131e36,#0f172a);border:1px solid var(--line);border-radius:16px;padding:16px}
.card h2{margin:0 0 8px;font-size:15px;font-weight:700;display:flex;align-items:center;justify-content:space-between}
.hint{font-size:12px;color:var(--dim);line-height:1.5;margin-bottom:10px}
textarea,input,select{
  width:100%;background:var(--panel2);color:var(--text);border:1px solid var(--line);
  border-radius:10px;padding:9px 11px;font-size:13px;outline:none;font-family:inherit;
}
textarea{min-height:92px;resize:vertical;font-family:ui-monospace,Consolas,monospace;font-size:12px;line-height:1.5}
.row-flex{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px}
.field-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:8px}
@media(max-width:600px){.field-grid{grid-template-columns:1fr}}
label.lbl{display:block;font-size:11px;color:var(--dim);margin-bottom:4px;font-weight:600}

.progress-box{
  margin-bottom:16px;padding:13px 16px;border-radius:14px;border:1px solid rgba(96,165,250,.35);
  background:linear-gradient(90deg,rgba(37,99,235,.14),rgba(16,185,129,.1));display:none;
}
.progress-box.active{display:block}
.pbar-wrap{height:7px;background:#0a1120;border-radius:99px;overflow:hidden;margin-top:8px}
.pbar{height:100%;width:0%;background:linear-gradient(90deg,#3b82f6,#34d399);transition:width .25s}

.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:14px;background:var(--panel)}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:10px 11px;text-align:left;border-bottom:1px solid var(--line);white-space:nowrap}
th{font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--dim);background:rgba(9,15,29,.55);font-weight:700}
tr:last-child td{border-bottom:none}
tr:hover td{background:rgba(255,255,255,.02)}

.badge{display:inline-block;padding:2px 7px;border-radius:6px;font-size:11px;font-weight:700}
.b-primary{background:rgba(52,211,153,.15);color:var(--green);border:1px solid rgba(52,211,153,.35)}
.b-warn{background:rgba(251,191,36,.15);color:var(--amber);border:1px solid rgba(251,191,36,.35)}
.b-bad{background:rgba(248,113,113,.15);color:var(--red);border:1px solid rgba(248,113,113,.35)}
.b-info{background:rgba(96,165,250,.15);color:var(--blue);border:1px solid rgba(96,165,250,.3)}

.grade{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;font-weight:800;font-size:13px}
.g-S{background:linear-gradient(135deg,#059669,#34d399);color:#032016}
.g-A{background:rgba(52,211,153,.2);color:var(--green);border:1px solid rgba(52,211,153,.4)}
.g-B{background:rgba(96,165,250,.2);color:var(--blue);border:1px solid rgba(96,165,250,.4)}
.g-C{background:rgba(251,191,36,.2);color:var(--amber);border:1px solid rgba(251,191,36,.4)}
.g-D{background:rgba(248,113,113,.2);color:var(--red);border:1px solid rgba(248,113,113,.4)}

.speed-bar{width:95px;height:8px;background:#0a1120;border-radius:4px;overflow:hidden;display:inline-block;vertical-align:middle;margin-right:6px}
.speed-fill{height:100%;background:linear-gradient(90deg,#ec4899,#34d399)}

.reg-chips{display:flex;flex-wrap:wrap;gap:4px;max-width:290px;white-space:normal}
.chip{font-size:11px;background:var(--panel2);border:1px solid var(--line);padding:2px 6px;border-radius:6px}

.modal-bg{position:fixed;inset:0;background:rgba(3,7,18,.78);backdrop-filter:blur(4px);display:none;align-items:center;justify-content:center;padding:16px;z-index:50}
.modal-bg.open{display:flex}
.modal{background:#0f172a;border:1px solid var(--line);border-radius:16px;max-width:1180px;width:100%;max-height:88vh;display:flex;flex-direction:column;overflow:hidden}
.modal-hdr{padding:14px 18px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:12px}
.modal-body{padding:16px 18px;overflow:auto}
.toast{position:fixed;bottom:18px;right:18px;background:#1e293b;border:1px solid var(--line);color:var(--text);padding:10px 14px;border-radius:10px;font-size:13px;display:none;z-index:80}
.toast.show{display:block}
.muted{color:var(--dim);font-size:12px}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="brand">
      <div>
        <h1>⚡ Airport Bench</h1>
        <div class="sub">Paste multiple VPN airport links → test real speed, zombies, entry diversity &amp; AI/streaming unlocks locally on Windows</div>
      </div>
    </div>
    <div class="hdr-right">
      <div id="mihomoPill" class="pill warn"><span class="dot"></span><span id="mihomoText">Checking mihomo…</span></div>
      <button id="installBtn" class="btn-primary btn-sm" style="display:none" onclick="installMihomo()">⬇ Install mihomo.exe</button>
      <a class="btn btn-sm" href="/report" style="text-decoration:none;display:inline-flex;align-items:center">📊 Deep Report</a>
      <button class="btn-sm" onclick="openSettings()">⚙ Settings &amp; Schedule</button>
    </div>
  </header>

  <div class="grid-top">
    <div class="card">
      <h2>1. Add / Paste VPN Airport Links <span class="muted">stored locally only</span></h2>
      <div class="hint">
        Paste one or more subscription URLs (one per line). Optional format: <code>Name | https://sub-url | monthlyPrice</code>
      </div>
      <textarea id="bulkInput" placeholder="chuixuecloud | https://example.com/api/v1/client/subscribe?token=... | 20&#10;Backup Airport A | https://other-airport.com/link/... | 15&#10;https://another-trial.cc/sub?..."></textarea>
      <div class="row-flex">
        <label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--dim);cursor:pointer">
          <input type="checkbox" id="markFirstPrimary" style="width:auto"> Mark first added as Current Primary baseline
        </label>
        <div style="flex:1"></div>
        <button onclick="addBulk(false)">+ Save Links</button>
        <button class="btn-primary" onclick="addBulk(true)">+ Save &amp; Test All</button>
      </div>
    </div>

    <div class="card">
      <h2>2. Benchmark Controls <span id="schedBadge" class="muted"></span></h2>
      <div class="field-grid">
        <div>
          <label class="lbl">Test Depth</label>
          <select id="modeSel">
            <option value="triage">Quick Triage (Top 2/region)</option>
            <option value="full">Full Extensive Audit (All nodes)</option>
            <option value="ping">Ping + Zombie Check (Tiny quota)</option>
          </select>
        </div>
        <div>
          <label class="lbl">Speed Payload / Node</label>
          <select id="payloadSel">
            <option value="10">10 MB (Low quota burn)</option>
            <option value="25" selected>25 MB (Balanced)</option>
            <option value="50">50 MB (Heavy throughput)</option>
          </select>
        </div>
        <div>
          <label class="lbl">DNS Mode</label>
          <select id="dnsSel">
            <option value="cn" selected>China (223.5.5.5 + 1.1.1.1)</option>
            <option value="global">Global (1.1.1.1 + 8.8.8.8)</option>
          </select>
        </div>
      </div>
      <div class="hint" style="margin-top:10px">
        💡 Tip: Run <b>Quick Triage</b> at evening peak (<b>20:30–23:00 CST</b>) so you catch congested routes without burning trial GBs, then run <b>Full Audit</b> on your top 2 finalists.
      </div>
      <div class="row-flex">
        <button id="runAllBtn" class="btn-green" onclick="runBenchmark(null)">🚀 Test All Airports</button>
        <button id="stopBtn" class="btn-danger" style="display:none" onclick="stopBenchmark()">⏹ Stop</button>
        <button class="btn-sm" onclick="refreshState()">↻ Refresh</button>
      </div>
    </div>
  </div>

  <div id="progressBox" class="progress-box">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
      <strong id="progTitle">Running benchmark…</strong>
      <span id="progMeta" class="muted"></span>
    </div>
    <div class="pbar-wrap"><div id="progBar" class="pbar"></div></div>
  </div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Rank / Supplier</th>
          <th>Score</th>
          <th>Avg / Peak Speed</th>
          <th>vs Primary</th>
          <th>Alive / Zombie</th>
          <th>Ping</th>
          <th>Best Regional Speeds</th>
          <th>Unlocks (GPT / NF / YT)</th>
          <th>Entry Diversity</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody id="leaderRows">
        <tr><td colspan="10" class="muted" style="text-align:center;padding:28px">No suppliers added yet. Paste your current supplier + candidate airport links above to start comparing.</td></tr>
      </tbody>
    </table>
  </div>
</div>

<!-- Node Drill-Down & History Modal -->
<div id="detailModal" class="modal-bg" onclick="if(event.target===this)closeDetail()">
  <div class="modal">
    <div class="modal-hdr">
      <div>
        <strong id="detailTitle" style="font-size:16px">Supplier Details</strong>
        <div id="detailSub" class="muted"></div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <select id="nodeSort" style="width:auto;padding:5px 9px;font-size:12px" onchange="renderDetailTable()">
          <option value="speed">Sort: Fastest Speed</option>
          <option value="delay">Sort: Lowest Ping</option>
          <option value="region">Sort: Region</option>
          <option value="orig">Sort: Original Order</option>
        </select>
        <button class="btn-sm" onclick="closeDetail()">Close</button>
      </div>
    </div>
    <div class="modal-body" id="detailBody"></div>
  </div>
</div>

<!-- Settings Modal -->
<div id="settingsModal" class="modal-bg" onclick="if(event.target===this)closeSettings()">
  <div class="modal" style="max-width:560px">
    <div class="modal-hdr">
      <strong>⚙ Benchmark &amp; Evening Schedule Settings</strong>
      <button class="btn-sm" onclick="closeSettings()">Close</button>
    </div>
    <div class="modal-body">
      <label class="lbl">Daily Auto-Test Time (Local PC Time, e.g. 21:30 for evening peak — leave blank to disable)</label>
      <input id="setSched" placeholder="21:30">
      <div style="height:10px"></div>
      <label class="lbl">Speed Test Payload URL</label>
      <input id="setSpeedUrl" placeholder="https://speed.cloudflare.com/__down?bytes=25000000">
      <div style="height:10px"></div>
      <label class="lbl">Telegram Bot Token (optional — sends daily leaderboard summary)</label>
      <input id="setTgToken" placeholder="123456:ABC-DEF...">
      <div style="height:10px"></div>
      <label class="lbl">Telegram Chat ID (optional)</label>
      <input id="setTgChat" placeholder="123456789">
      <div style="height:10px"></div>
      <label class="lbl">GitHub Mirror Prefix for mihomo download inside China (optional, e.g. https://ghfast.top/)</label>
      <input id="setMirror" placeholder="Leave blank for direct github.com">
      <div class="row-flex" style="margin-top:16px">
        <button class="btn-primary" onclick="saveSettings()">Save Settings</button>
        <button onclick="testTelegram()">Test Telegram</button>
      </div>
    </div>
  </div>
</div>

<div id="toast" class="toast"></div>

<script>
let STATE = { suppliers: [], latestRuns: {}, mihomo: {}, running: false, settings: {} };
let CURRENT_DETAIL_SUPPLIER = null;

function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function toast(msg){const t=document.getElementById("toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),3200);}

async function api(path, opts){
  const r = await fetch(path, opts);
  const j = await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(j.error || ("HTTP "+r.status));
  return j;
}

async function refreshState(){
  STATE = await api("/api/state");
  renderHeader();
  renderLeaderboard();
}

function renderHeader(){
  const m = STATE.mihomo || {};
  const pill = document.getElementById("mihomoPill");
  const txt = document.getElementById("mihomoText");
  const inst = document.getElementById("installBtn");
  if(m.installed){
    pill.className = "pill ok";
    txt.textContent = "mihomo ready" + (m.version ? " · " + m.version.slice(0,32) : "");
    inst.style.display = "none";
  } else {
    pill.className = "pill warn";
    txt.textContent = "mihomo.exe missing";
    inst.style.display = "inline-block";
  }
  const st = STATE.settings || {};
  document.getElementById("schedBadge").textContent = st.scheduleTime ? ("Auto-run daily at " + st.scheduleTime) : "Manual / Scheduled";
  document.getElementById("runAllBtn").disabled = STATE.running || !STATE.suppliers.length;
  document.getElementById("stopBtn").style.display = STATE.running ? "inline-block" : "none";
}

function fmtSpeed(v){ return v ? v.toFixed(1) + " MB/s" : "0 MB/s"; }

function renderLeaderboard(){
  const tb = document.getElementById("leaderRows");
  if(!STATE.suppliers.length){
    tb.innerHTML = '<tr><td colspan="10" class="muted" style="text-align:center;padding:28px">No suppliers added yet. Paste your current supplier + candidate airport links above.</td></tr>';
    return;
  }

  const primary = STATE.suppliers.find(s=>s.isPrimary);
  const primaryRun = primary ? STATE.latestRuns[primary.id] : null;

  const rows = [...STATE.suppliers].sort((a,b)=>{
    const ra = STATE.latestRuns[a.id]?.summary?.score ?? -1;
    const rb = STATE.latestRuns[b.id]?.summary?.score ?? -1;
    return rb - ra;
  });

  tb.innerHTML = rows.map((sup, idx)=>{
    const run = STATE.latestRuns[sup.id];
    const s = run?.summary;
    const priceTag = sup.priceMonthly != null ? \` · \${sup.priceMonthly} \${esc(sup.currency||"RMB")}/mo\` : "";
    const quotaTag = s?.quota ? \` · \${s.quota.leftGb}GB left\` : "";
    const primBadge = sup.isPrimary ? ' <span class="badge b-primary">PRIMARY</span>' : "";

    if(!s){
      return \`<tr>
        <td><b>#\${idx+1} \${esc(sup.name)}</b>\${primBadge}<div class="muted">\${esc(sup.maskedUrl)}\${priceTag}</div></td>
        <td colspan="8" class="muted">Not tested yet</td>
        <td>
          <button class="btn-sm btn-primary" onclick="runBenchmark('\${sup.id}')" \${STATE.running?"disabled":""}>Test</button>
          <button class="btn-sm" onclick="setPrimary('\${sup.id}')">Primary</button>
          <button class="btn-sm btn-danger" onclick="delSupplier('\${sup.id}')">Del</button>
        </td>
      </tr>\`;
    }

    let deltaHtml = '<span class="muted">—</span>';
    if(primaryRun && !sup.isPrimary){
      const d = s.avgSpeedMBps - primaryRun.summary.avgSpeedMBps;
      const cls = d >= 0 ? "var(--green)" : "var(--red)";
      deltaHtml = \`<span style="color:\${cls};font-weight:700">\${d>=0?"+":""}\${d.toFixed(1)} MB/s</span>\`;
    } else if (sup.isPrimary){
      deltaHtml = '<span class="muted">Baseline</span>';
    }

    const regs = Object.entries(s.bestByRegion || {})
      .sort((a,b)=>b[1].avgMBps - a[1].avgMBps)
      .slice(0,4)
      .map(([reg,info])=>\`<span class="chip">\${esc(reg)} \${info.avgMBps.toFixed(0)}MB/s</span>\`)
      .join("");

    const u = s.unlockRates || {};
    const unlockTxt = u.tested
      ? \`GPT \${u.chatgpt??"-"}% · NF \${u.netflix??"-"}% · YT \${u.youtube??"-"}%\`
      : '<span class="muted">Skipped</span>';

    const div = s.entryDiversity || {};
    const divHtml = div.singleEntryWarning
      ? \`<span class="badge b-warn" title="Most nodes share 1 IP/CDN">⚠ \${div.uniqueIps} IPs (\${div.topIpSharePct}% same)</span>\`
      : \`<span class="badge b-info">\${div.uniqueIps} entry IPs</span>\`;

    const barPct = Math.min(100, Math.round((s.avgSpeedMBps / 100) * 100));

    return \`<tr>
      <td><b>#\${idx+1} \${esc(sup.name)}</b>\${primBadge}<div class="muted">\${esc(sup.maskedUrl)}\${priceTag}\${quotaTag}</div></td>
      <td><span class="grade g-\${s.grade}">\${s.grade}</span> <b style="margin-left:5px">\${s.score}</b></td>
      <td>
        <div><span class="speed-bar"><span class="speed-fill" style="width:\${barPct}%"></span></span><b>\${s.avgSpeedMBps.toFixed(1)}</b> MB/s</div>
        <div class="muted">Peak \${s.peakSpeedMBps.toFixed(1)} MB/s</div>
      </td>
      <td>\${deltaHtml}</td>
      <td>
        <b>\${s.aliveCount}/\${s.speedTestedCount}</b> <span class="muted">(\${s.totalNodes} total)</span>
        \${s.zombieCount ? \`<div><span class="badge b-bad">\${s.zombieCount} zombie</span></div>\` : ""}
      </td>
      <td>\${s.medianDelayMs != null ? s.medianDelayMs + " ms" : "-"}</td>
      <td><div class="reg-chips">\${regs || '<span class="muted">None</span>'}</div></td>
      <td>\${unlockTxt}</td>
      <td>\${divHtml}</td>
      <td>
        <button class="btn-sm btn-primary" onclick="runBenchmark('\${sup.id}')" \${STATE.running?"disabled":""}>Re-test</button>
        <button class="btn-sm" onclick="openDetail('\${sup.id}')">Nodes (\${s.totalNodes})</button>
        <button class="btn-sm" onclick="setPrimary('\${sup.id}')">Primary</button>
        <button class="btn-sm btn-danger" onclick="delSupplier('\${sup.id}')">Del</button>
      </td>
    </tr>\`;
  }).join("");
}

async function addBulk(andTest){
  const text = document.getElementById("bulkInput").value.trim();
  if(!text) return toast("Paste at least one subscription URL");
  const markFirstPrimary = document.getElementById("markFirstPrimary").checked;
  const res = await api("/api/suppliers/bulk", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ text, markFirstPrimary }),
  });
  document.getElementById("bulkInput").value = "";
  toast(\`Saved \${res.added.length} supplier(s)\`);
  await refreshState();
  if(andTest && res.added.length) runBenchmark(null);
}

async function setPrimary(id){
  await api(\`/api/suppliers/\${id}/primary\`, { method:"POST" });
  toast("Updated Primary baseline");
  await refreshState();
}

async function delSupplier(id){
  if(!confirm("Remove this supplier and its run history?")) return;
  await api(\`/api/suppliers/\${id}\`, { method:"DELETE" });
  await refreshState();
}

async function runBenchmark(supplierId){
  const mode = document.getElementById("modeSel").value;
  const payloadMb = Number(document.getElementById("payloadSel").value);
  const cnDns = document.getElementById("dnsSel").value === "cn";
  try {
    await api("/api/run", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ supplierId, mode, payloadMb, cnDns }),
    });
    document.getElementById("progressBox").classList.add("active");
    await refreshState();
  } catch(e){
    toast("Error: " + e.message);
  }
}

async function stopBenchmark(){
  await api("/api/stop", { method:"POST" });
  toast("Stopping benchmark…");
}

async function installMihomo(){
  const mirrorPrefix = document.getElementById("setMirror").value.trim();
  toast("Downloading mihomo.exe from GitHub…");
  document.getElementById("installBtn").disabled = true;
  try {
    await api("/api/setup-mihomo", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ mirrorPrefix }),
    });
    toast("mihomo ready!");
    await refreshState();
  } catch(e){
    toast("Install failed: " + e.message);
  } finally {
    document.getElementById("installBtn").disabled = false;
  }
}

async function openDetail(supplierId){
  CURRENT_DETAIL_SUPPLIER = supplierId;
  const sup = STATE.suppliers.find(s=>s.id===supplierId);
  const run = STATE.latestRuns[supplierId];
  const hist = await api(\`/api/runs/\${supplierId}\`);
  STATE._detailRuns = hist.runs || (run ? [run] : []);
  document.getElementById("detailTitle").textContent = (sup?.name || "Supplier") + " — Node & History Report";
  const s = run?.summary;
  document.getElementById("detailSub").textContent = s
    ? \`Last tested \${new Date(run.finishedAt).toLocaleString()} · Mode: \${s.mode} · Entry ASNs: \${(s.entryDiversity?.asns||[]).join(", ") || "N/A"}\`
    : "No runs yet";
  renderDetailTable();
  document.getElementById("detailModal").classList.add("open");
}

function closeDetail(){ document.getElementById("detailModal").classList.remove("open"); }

function renderDetailTable(){
  const runs = STATE._detailRuns || [];
  const run = runs[0];
  const body = document.getElementById("detailBody");
  if(!run){ body.innerHTML = '<div class="muted">No test data yet.</div>'; return; }

  const sortMode = document.getElementById("nodeSort").value;
  let nodes = [...(run.nodes || [])];
  if(sortMode === "speed") nodes.sort((a,b)=>(b.avgMBps||0)-(a.avgMBps||0));
  else if(sortMode === "delay") nodes.sort((a,b)=>(a.delayMs??99999)-(b.delayMs??99999));
  else if(sortMode === "region") nodes.sort((a,b)=>a.region.localeCompare(b.region));

  const nodeRows = nodes.map((n,i)=>{
    const u = n.unlocks || {};
    const statusBadge = !n.speedTested
      ? (n.delayMs != null ? '<span class="badge b-info">Ping OK</span>' : '<span class="badge b-bad">No Ping</span>')
      : (n.alive ? '<span class="badge b-primary">Alive</span>' : (n.zombie ? '<span class="badge b-bad">Zombie</span>' : '<span class="badge b-bad">Dead</span>'));
    const barW = Math.min(100, Math.round(((n.avgMBps||0)/100)*100));
    return \`<tr>
      <td>\${i+1}</td>
      <td><b>\${esc(n.region)}</b></td>
      <td>\${esc(n.name)} <span class="muted">(\${esc(n.type)})</span></td>
      <td>\${statusBadge}</td>
      <td>\${n.delayMs != null ? n.delayMs + " ms" : "—"}</td>
      <td>\${n.ttfbMs != null ? n.ttfbMs + " ms" : "—"}</td>
      <td><span class="speed-bar"><span class="speed-fill" style="width:\${barW}%"></span></span><b>\${(n.avgMBps||0).toFixed(2)}</b> MB/s</td>
      <td>\${(n.maxMBps||0).toFixed(2)} MB/s</td>
      <td>\${esc(u.chatgpt || "—")}</td>
      <td>\${esc(u.netflix || "—")}</td>
      <td>\${esc(u.youtube || "—")}</td>
      <td>\${esc(u.disney || "—")}</td>
      <td class="muted">\${esc(n.entry?.ip || n.server)} \${esc(n.entry?.asn || "")}</td>
    </tr>\`;
  }).join("");

  const histHtml = runs.slice(0,10).map(r=>\`<tr>
    <td>\${new Date(r.finishedAt).toLocaleString()}</td>
    <td>\${esc(r.summary.mode)}</td>
    <td><b>\${r.summary.score}</b> (\${r.summary.grade})</td>
    <td>\${r.summary.avgSpeedMBps} MB/s (Peak \${r.summary.peakSpeedMBps})</td>
    <td>\${r.summary.aliveCount}/\${r.summary.speedTestedCount} (Zombie \${r.summary.zombieCount})</td>
    <td>\${r.summary.medianDelayMs ?? "-"} ms</td>
  </tr>\`).join("");

  body.innerHTML = \`
    <h3 style="margin:0 0 8px;font-size:14px">Node Matrix (\${nodes.length} nodes)</h3>
    <div class="table-wrap" style="margin-bottom:18px">
      <table>
        <thead><tr>
          <th>#</th><th>Region</th><th>Node</th><th>Status</th><th>Ping</th><th>TTFB</th>
          <th>Avg Speed</th><th>Max Speed</th><th>ChatGPT</th><th>Netflix</th><th>YouTube</th><th>Disney+</th><th>Entry IP / ASN</th>
        </tr></thead>
        <tbody>\${nodeRows}</tbody>
      </table>
    </div>
    <h3 style="margin:0 0 8px;font-size:14px">Historical Runs (compare daytime vs evening peak)</h3>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Finished</th><th>Mode</th><th>Score</th><th>Avg / Peak</th><th>Alive</th><th>Median Ping</th></tr></thead>
        <tbody>\${histHtml}</tbody>
      </table>
    </div>
  \`;
}

function openSettings(){
  const st = STATE.settings || {};
  document.getElementById("setSched").value = st.scheduleTime || "";
  document.getElementById("setSpeedUrl").value = st.speedUrl || "";
  document.getElementById("setTgToken").value = st.telegramBotToken || "";
  document.getElementById("setTgChat").value = st.telegramChatId || "";
  document.getElementById("settingsModal").classList.add("open");
}
function closeSettings(){ document.getElementById("settingsModal").classList.remove("open"); }

async function saveSettings(){
  await api("/api/settings", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({
      scheduleTime: document.getElementById("setSched").value.trim(),
      speedUrl: document.getElementById("setSpeedUrl").value.trim(),
      telegramBotToken: document.getElementById("setTgToken").value.trim(),
      telegramChatId: document.getElementById("setTgChat").value.trim(),
    }),
  });
  closeSettings();
  toast("Settings saved");
  await refreshState();
}

async function testTelegram(){
  try {
    await api("/api/test-telegram", { method:"POST" });
    toast("Telegram message sent!");
  } catch(e){
    toast("Telegram failed: " + e.message);
  }
}

// Live SSE progress stream
function connectEvents(){
  const es = new EventSource("/api/events");
  es.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      const box = document.getElementById("progressBox");
      if(msg.type === "progress"){
        box.classList.add("active");
        const p = msg.data;
        document.getElementById("progTitle").textContent = \`[\${p.supplierName || ""}] \${p.message || p.phase}\`;
        if(p.done && p.total){
          const pct = Math.round((p.done / p.total) * 100);
          document.getElementById("progBar").style.width = pct + "%";
          document.getElementById("progMeta").textContent = p.phase === "node_done"
            ? \`\${p.nodeName}: \${(p.avgMBps||0).toFixed(1)} MB/s\`
            : \`\${p.done}/\${p.total}\`;
        }
      } else if(msg.type === "supplier_done" || msg.type === "run_finished"){
        refreshState();
        if(msg.type === "run_finished"){
          box.classList.remove("active");
          document.getElementById("progBar").style.width = "0%";
          toast(msg.error ? ("Run stopped: " + msg.error) : "Benchmark completed!");
        }
      }
    } catch {}
  };
}

refreshState();
connectEvents();
</script>
</body>
</html>`;
}
