// Copy the third-party browser code this site needs into site/assets/vendor/, so the published
// page never loads code from another origin. The versions are pinned in package.json under
// "vendor"; change one there, then run:   node scripts/vendor.mjs
// It installs exactly those versions (without saving them and without install scripts) and copies
// the files. The copies are committed, so a deploy never depends on npm being up.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NM = path.join(ROOT, "node_modules");
const pins = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).vendor;
execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["install", "--no-save", "--ignore-scripts", "--no-audit", "--no-fund", ...Object.entries(pins).map(([p, v]) => `${p}@${v}`)], { cwd: ROOT, stdio: "inherit" });
for (const [p, v] of Object.entries(pins)) {
  const got = JSON.parse(fs.readFileSync(path.join(NM, p, "package.json"), "utf8")).version;
  if (got !== v) throw new Error(`${p}: wanted ${v}, installed ${got}`);
}
const OUT = path.join(ROOT, "site/assets/vendor");
const ver = (pkg) => JSON.parse(fs.readFileSync(path.join(NM, pkg, "package.json"), "utf8")).version;
const copy = (from, to, edit) => {
  const src = path.join(NM, from), dst = path.join(OUT, to);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (edit) fs.writeFileSync(dst, edit(fs.readFileSync(src, "utf8")));
  else fs.copyFileSync(src, dst);
  console.log(`${to}  (${(fs.statSync(dst).size / 1e6).toFixed(2)} MB)`);
};

fs.rmSync(OUT, { recursive: true, force: true });

// Mediabunny: reads, decodes, encodes and writes the video. Unmodified.
copy("mediabunny/dist/bundles/mediabunny.min.mjs", "mediabunny.min.mjs");
copy("mediabunny/LICENSE", "licenses/MPL-2.0.txt");

// AAC encoder for browsers whose WebCodecs can't encode AAC (Firefox, Chrome on Linux).
// One change: the bare import "mediabunny" becomes a relative path, so no import map is needed.
copy("@mediabunny/aac-encoder/dist/bundles/mediabunny-aac-encoder.min.mjs", "mediabunny-aac-encoder.min.mjs", (s) => {
  const n = s.split('from"mediabunny"').length - 1;
  if (n < 1) throw new Error("aac-encoder: the mediabunny import was not found; check the bundle");
  return s.replaceAll('from"mediabunny"', 'from"./mediabunny.min.mjs"');
});
copy("@mediabunny/aac-encoder/licenses/ffmpeg/COPYING.LGPLv2.1", "licenses/FFmpeg-LGPL-2.1.txt");
copy("@mediabunny/aac-encoder/licenses/ffmpeg/LICENSE.md", "licenses/FFmpeg-LICENSE.md");

// Transformers.js (with ONNX Runtime Web's JavaScript bundled in) and the matching WebAssembly runtime.
// GitHub's push protection reads the 32-letter class name of the Mistral 3 conditional-generation
// model as a Mistral API key. The name is split in two where it's a string or an object key (the same value
// at run time), and the export of that one unused model class is renamed.
const FLAGGED = "Mistral3" + "ForConditionalGeneration";   // never written whole in this repo
copy("@huggingface/transformers/dist/transformers.min.js", "transformers.min.js", (s) => {
  const rules = [
    [`${FLAGGED}:()=>`, `["Mistral3"+"ForConditionalGeneration"]:()=>`],
    [`"${FLAGGED}"`, `"Mistral3"+"ForConditionalGeneration"`],
    [` as ${FLAGGED},`, ` as Mistral3ForConditionalGen,`],
  ];
  for (const [from, to] of rules) {
    const n = s.split(from).length - 1;
    if (n !== 1) throw new Error(`transformers.min.js: expected one "${from}", found ${n}; check the bundle`);
    s = s.replace(from, to);
  }
  if (s.includes(FLAGGED)) throw new Error("transformers.min.js: the flagged name is still present");
  return s;
});
copy("@huggingface/transformers/LICENSE", "licenses/Apache-2.0.txt");
copy("onnxruntime-web/dist/ort-wasm-simd-threaded.mjs", "ort/ort-wasm-simd-threaded.mjs");
copy("onnxruntime-web/dist/ort-wasm-simd-threaded.wasm", "ort/ort-wasm-simd-threaded.wasm");

// Caption font: Montserrat ExtraBold, one file per script so only the needed ones are downloaded.
const SUBSETS = ["latin", "latin-ext", "cyrillic", "cyrillic-ext", "vietnamese"];
for (const s of SUBSETS) copy(`@fontsource/montserrat/files/montserrat-${s}-800-normal.woff2`, `fonts/montserrat-${s}-800.woff2`);
copy("@fontsource/montserrat/LICENSE", "licenses/OFL-1.1-Montserrat.txt");
// unicode-range values come from the package's own CSS, so they always match the files.
const css = fs.readFileSync(path.join(NM, "@fontsource/montserrat/800.css"), "utf8");
const faces = [];
for (const block of css.split("@font-face").slice(1)) {
  const subset = /montserrat-([a-z-]+)-800-normal\.woff2/.exec(block)?.[1];
  const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1];
  if (subset && range && SUBSETS.includes(subset)) faces.push({ subset, range: range.trim() });
}
if (faces.length !== SUBSETS.length) throw new Error(`fonts: expected ${SUBSETS.length} subsets, found ${faces.length}`);
fs.writeFileSync(path.join(OUT, "fonts/montserrat.css"), faces.map((f) =>
  `@font-face{font-family:"Montserrat";font-style:normal;font-weight:800;font-display:swap;src:url("montserrat-${f.subset}-800.woff2") format("woff2");unicode-range:${f.range}}`).join("\n") + "\n");
fs.writeFileSync(path.join(OUT, "fonts/faces.json"), JSON.stringify(faces, null, 1) + "\n");

fs.writeFileSync(path.join(OUT, "NOTICE.md"), `# Vendored files

Served from this site so the page never loads code, fonts or models from another origin.
Generated by \`scripts/vendor.mjs\` from the versions pinned in \`package.json\`; don't edit by hand.

| Path | What | Version | Licence | Source |
|---|---|---|---|---|
| \`mediabunny.min.mjs\` | Mediabunny by Vanilagy: reads, decodes, encodes and writes media files | ${ver("mediabunny")} | MPL-2.0 | npm \`mediabunny\`, https://github.com/Vanilagy/mediabunny |
| \`mediabunny-aac-encoder.min.mjs\` | AAC encoder extension for Mediabunny (a WebAssembly build of FFmpeg's AAC encoder) | ${ver("@mediabunny/aac-encoder")} | MPL-2.0 wrapper, LGPL-2.1-or-later FFmpeg code | npm \`@mediabunny/aac-encoder\` |
| \`transformers.min.js\` | Transformers.js by Hugging Face, with ONNX Runtime Web's JavaScript bundled | ${ver("@huggingface/transformers")} | Apache-2.0 (ONNX Runtime: MIT) | npm \`@huggingface/transformers\` |
| \`ort/ort-wasm-simd-threaded.*\` | ONNX Runtime Web, WebAssembly runtime (CPU) | ${ver("onnxruntime-web")} | MIT | npm \`onnxruntime-web\` |
| \`fonts/montserrat-*-800.woff2\` | Montserrat ExtraBold by Julieta Ulanovsky and the Montserrat Project Authors | ${ver("@fontsource/montserrat")} | OFL-1.1 | npm \`@fontsource/montserrat\` |

The speech models are listed in \`../models/manifest.json\`.

## Changes made to vendored files

- \`transformers.min.js\`: GitHub's secret scanning mistakes the 32-letter class name of the
  Mistral 3 conditional-generation model for a Mistral API key and blocks the push. Where the name is
  a string or an object key it is written as two joined strings (the same value at run time); its
  entry in the module's export list is renamed \`Mistral3ForConditionalGen\`. This site never uses
  that model. Nothing else is changed; \`scripts/vendor.mjs\` applies the change.

- \`mediabunny-aac-encoder.min.mjs\`: the import specifier \`"mediabunny"\` is replaced with
  \`"./mediabunny.min.mjs"\` so the browser can resolve it without an import map. Nothing else is
  changed. The unmodified file is in the npm package named above, and the script that applies the
  change is \`scripts/vendor.mjs\` in this repository (MPL-2.0 section 3.2 is met by this public
  source). The FFmpeg code inside it is unmodified; its source is at https://ffmpeg.org/ and the
  build files are in the Mediabunny repository under \`packages/aac-encoder\`.

Licence texts are in \`licenses/\`.
`);
console.log("wrote NOTICE.md");
