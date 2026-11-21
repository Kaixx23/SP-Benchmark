# ⚡ SP-Benchmark (Airport Bench)

A local Windows / macOS / Linux web app for comparing multiple VPN airport subscriptions side-by-side using a real **`mihomo` (Clash Meta)** core.

Built to run directly on your own network (e.g., a Windows PC on China Mobile / Telecom / Unicom) so tests measure **real mainland-China → airport entry speeds**, catch **fake-alive zombie nodes** (`40ms` ping / `0 B/s` transfer), inspect **entry IP/ASN diversity**, and verify **ChatGPT / Netflix / YouTube / Disney+** unlocks.

Zero external npm dependencies (pure Node.js >= 20). Ready to move into its own Git repository.

---

## Quick Start on Windows

1. Install **Node.js 20+** from [nodejs.org](https://nodejs.org/).
2. Double-click **`start-windows.bat`** (or run in PowerShell / Command Prompt):
   ```powershell
   npm run setup   # finds existing Clash Verge/FlClash mihomo.exe or downloads it into ./bin/
   npm start       # opens http://127.0.0.1:8788 (and prints your LAN URL for your phone)
   ```
   > If GitHub is slow in China during `setup`, run:
   > `node setup-mihomo.mjs --mirror=https://ghfast.top/`
   > or click **Install mihomo.exe** inside the web UI (or copy any `mihomo.exe` into `bin\mihomo.exe`).

3. Open **`http://127.0.0.1:8788`** (or the **Phone LAN** URL printed in the terminal from your iPhone on the same Wi-Fi/hotspot).
4. Paste your current supplier + candidate airport subscription links (one per line):
   ```text
   chuixuecloud | https://your-current-supplier/sub?token=... | 20
   Candidate A  | https://other-airport/sub?token=...        | 15
   ```
5. Pick a test depth:
   - **Quick Triage:** Pings every node, then runs speed + unlock tests on the **top 2 fastest-ping nodes per region** (low quota burn, great for hourly or nightly 21:30 CST checks).
   - **Full Extensive Audit:** Speed-tests & unlock-tests **every** real node (MiaoKo-style node matrix).
   - **Ping + Zombie Check:** Ultra-light 512 KB sanity transfer per node to catch dead tunnels.

---

## Hourly Auto-Testing & Daily Stability Report

1. Click **⚙ Settings & Hourly Schedule** (or **⏱ Hourly Auto-Test**) in the web UI.
2. Set **Recurring Auto-Test Interval** to **Every 1 hour** (with **Quick Triage** + **10 MB** payload to keep quota usage low).
3. Anytime during or after the day, click **📊 Daily Stability Report** to view:
   - **Overall Winner & Stability Score (0–100)** combining mean throughput, P10 floor speed, uptime %, and low volatility
   - **Daytime vs. Evening Peak (20:00–24:00) Drop-off %**
   - **24-Hour Speed Heatmap** across every hour of the day
   - One-click **`.MD` Markdown report**, **`.CSV` spreadsheet export**, and **Telegram summary**

---

## Running Tests

```bash
npm test
```
