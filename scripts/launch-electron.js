import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "..", "desktop");
const candidates = [
  process.env.ELECTRON_PATH,
  "/usr/lib/electron42/electron",
  "/usr/lib/electron/electron",
  "/usr/bin/electron",
  join(desktop, "..", "node_modules", "electron", "dist", "electron"),
  join(desktop, "node_modules", "electron", "dist", "electron"),
].filter(Boolean);

const bin = candidates.find((p) => existsSync(p));
if (!bin) {
  console.error("No Electron binary found. On Arch: sudo pacman -S electron42");
  console.error("Or run: npm install-scripts approve electron && node node_modules/electron/install.js");
  process.exit(1);
}

const child = spawn(bin, [desktop, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code) => process.exit(code ?? 0));
