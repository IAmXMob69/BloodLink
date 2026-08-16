import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const electron = process.argv.includes("--electron");
const kids = [];

function run(cmd, args, cwd, extra = {}) {
  const child = spawn(cmd, args, { cwd, stdio: "inherit", ...extra });
  kids.push(child);
  return child;
}

function shutdown() {
  for (const c of kids) {
    try {
      c.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
}

process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});
process.on("SIGTERM", shutdown);

run("node", ["src/index.js"], join(root, "server"), {
  env: { ...process.env, HEARTH_PORT: process.env.HEARTH_PORT || "3928" },
});
run("npx", ["vite"], join(root, "client"));

if (electron) {
  setTimeout(() => {
    run("npx", ["electron", ".", "--dev"], join(root, "desktop"), {
      env: { ...process.env, HEARTH_DEV: "1", HEARTH_DEV_URL: "http://127.0.0.1:5173" },
    });
  }, 1500);
}
