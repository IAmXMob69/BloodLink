import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const uploads = join(root, "server", "data", "uploads");
mkdirSync(uploads, { recursive: true });
const keep = join(uploads, ".gitkeep");
if (!existsSync(keep)) writeFileSync(keep, "");
