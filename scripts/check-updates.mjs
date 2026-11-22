// List newer versions of the vendored libraries (package.json "vendor") as Markdown, for the
// self-test's job summary. Informational only: always exits 0. Upgrade steps: OPERATIONS.md,
// "Updating the libraries and models".
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pins = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).vendor || {};
const lines = [];
for (const [name, have] of Object.entries(pins)) {
  try {
    const res = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2F")}/latest`, { signal: AbortSignal.timeout(15000) });
    const latest = res.ok ? (await res.json()).version : null;
    if (latest && latest !== have) lines.push(`- ${name}: ${have} in use, ${latest} available`);
  } catch { lines.push(`- ${name}: couldn't check`); }
}
console.log(lines.length ? `### Library updates waiting\n${lines.join("\n")}\n\nUpgrade steps: OPERATIONS.md, "Updating the libraries and models".` : "### Libraries\nAll vendored libraries are on their latest versions.");
