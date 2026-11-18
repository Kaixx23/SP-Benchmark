// Finds an existing mihomo (Clash Meta) binary or downloads the official release
// into ./bin/mihomo(.exe). Works on Windows, macOS, and Linux with zero npm deps.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BIN_DIR = path.join(HERE, "bin");
export const IS_WIN = process.platform === "win32";
export const DEFAULT_BIN_NAME = IS_WIN ? "mihomo.exe" : "mihomo";

function candidatePaths() {
  const list = [];
  if (process.env.MIHOMO_PATH) list.push(process.env.MIHOMO_PATH);
  list.push(path.join(BIN_DIR, DEFAULT_BIN_NAME));

  if (IS_WIN) {
    const local = process.env.LOCALAPPDATA || "";
    const prog = process.env.ProgramFiles || "C:\\Program Files";
    const roots = [
      path.join(local, "Programs", "Clash Verge"),
      path.join(local, "Programs", "clash-verge"),
      path.join(local, "Programs", "Clash Nyanpasu"),
      path.join(local, "Programs", "FlClash"),
      path.join(prog, "Clash Verge"),
    ];
    for (const r of roots) {
      list.push(path.join(r, "mihomo.exe"));
      list.push(path.join(r, "verge-mihomo.exe"));
      list.push(path.join(r, "resources", "sidecar", "verge-mihomo.exe"));
      list.push(path.join(r, "resources", "sidecar", "mihomo.exe"));
      list.push(path.join(r, "resources", "mihomo.exe"));
    }
  }
  return list;
}

export function findMihomo() {
  for (const p of candidatePaths()) {
    if (p && fs.existsSync(p)) return p;
  }
  // Check PATH
  const cmd = IS_WIN ? "where" : "which";
  for (const name of IS_WIN ? ["mihomo.exe", "verge-mihomo.exe"] : ["mihomo", "clash-meta"]) {
    try {
      const out = execFileSync(cmd, [name], { stdio: ["ignore", "pipe", "ignore"] }).toString("utf8").trim();
      const first = out.split(/\r?\n/)[0]?.trim();
      if (first && fs.existsSync(first)) return first;
    } catch {}
  }
  return null;
}

export function getMihomoStatus() {
  const bin = findMihomo();
  if (!bin) return { installed: false, path: null, version: null };
  try {
    const res = spawnSync(bin, ["-v"], { encoding: "utf8", timeout: 4000 });
    const text = (res.stdout || res.stderr || "").trim().split(/\r?\n/)[0] || "";
    return { installed: true, path: bin, version: text };
  } catch {
    return { installed: true, path: bin, version: "unknown" };
  }
}

function assetPatternForPlatform() {
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  if (IS_WIN) {
    return arch === "arm64"
      ? /^mihomo-windows-arm64-v.*\.zip$/i
      : /^mihomo-windows-amd64-compatible-v.*\.zip$/i;
  }
  if (process.platform === "darwin") {
    return arch === "arm64"
      ? /^mihomo-darwin-arm64-v.*\.gz$/i
      : /^mihomo-darwin-amd64-compatible-v.*\.gz$/i;
  }
  return arch === "arm64"
    ? /^mihomo-linux-arm64-v.*\.gz$/i
    : /^mihomo-linux-amd64-compatible-v.*\.gz$/i;
}

export async function installMihomo({ mirrorPrefix = "", onLog = () => {} } = {}) {
  fs.mkdirSync(BIN_DIR, { recursive: true });
  onLog("Fetching latest MetaCubeX/mihomo release metadata from GitHub...");

  const relRes = await fetch("https://api.github.com/repos/MetaCubeX/mihomo/releases/latest", {
    headers: { "User-Agent": "airport-bench/1.0" },
    signal: AbortSignal.timeout(15000),
  });
  if (!relRes.ok) throw new Error(`GitHub API returned HTTP ${relRes.status}`);
  const rel = await relRes.json();

  const pat = assetPatternForPlatform();
  let asset = (rel.assets || []).find((a) => pat.test(a.name));
  // Fallback for windows-amd64 without `-compatible`
  if (!asset && IS_WIN) {
    asset = (rel.assets || []).find((a) => /^mihomo-windows-amd64-v.*\.zip$/i.test(a.name));
  }
  if (!asset) throw new Error(`No matching mihomo release asset for ${process.platform}/${process.arch}`);

  const dlUrl = mirrorPrefix
    ? mirrorPrefix.replace(/\/+$/, "") + "/" + asset.browser_download_url
    : asset.browser_download_url;

  onLog(`Downloading ${asset.name} (${(asset.size / (1024 * 1024)).toFixed(1)} MB)...`);
  const dlRes = await fetch(dlUrl, { signal: AbortSignal.timeout(120000) });
  if (!dlRes.ok) throw new Error(`Download failed: HTTP ${dlRes.status}`);
  const buf = Buffer.from(await dlRes.arrayBuffer());

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mihomo-dl-"));
  const archivePath = path.join(tmpDir, asset.name);
  fs.writeFileSync(archivePath, buf);

  const targetPath = path.join(BIN_DIR, DEFAULT_BIN_NAME);
  try {
    if (asset.name.endsWith(".zip")) {
      const extractDir = path.join(tmpDir, "out");
      fs.mkdirSync(extractDir, { recursive: true });
      if (IS_WIN) {
        execFileSync("powershell", [
          "-NoProfile", "-Command",
          `Expand-Archive -Path '${archivePath.replace(/'/g, "''")}' -DestinationPath '${extractDir.replace(/'/g, "''")}' -Force`,
        ]);
      } else {
        execFileSync("unzip", ["-o", archivePath, "-d", extractDir]);
      }
      const exe = fs.readdirSync(extractDir).find((f) => /mihomo.*\.exe$/i.test(f));
      if (!exe) throw new Error("Extracted zip did not contain mihomo.exe");
      fs.copyFileSync(path.join(extractDir, exe), targetPath);
    } else if (asset.name.endsWith(".gz")) {
      const { gunzipSync } = await import("node:zlib");
      fs.writeFileSync(targetPath, gunzipSync(buf));
      fs.chmodSync(targetPath, 0o755);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  onLog(`Installed to ${targetPath}`);
  return getMihomoStatus();
}

// CLI execution: `node setup-mihomo.mjs [--mirror=https://...]`
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const existing = getMihomoStatus();
  if (existing.installed) {
    console.log(`✅ mihomo already available: ${existing.path} (${existing.version})`);
    process.exit(0);
  }
  const mirrorArg = process.argv.find((a) => a.startsWith("--mirror="));
  const mirrorPrefix = mirrorArg ? mirrorArg.slice("--mirror=".length) : "";
  try {
    const st = await installMihomo({ mirrorPrefix, onLog: (m) => console.log("  " + m) });
    console.log(`✅ Ready: ${st.path} (${st.version})`);
  } catch (e) {
    console.error(`❌ Setup failed: ${e.message}`);
    console.error("Tip: If GitHub is slow in China, pass --mirror=https://ghfast.top/ or copy mihomo.exe into ./bin/mihomo.exe");
    process.exit(1);
  }
}
