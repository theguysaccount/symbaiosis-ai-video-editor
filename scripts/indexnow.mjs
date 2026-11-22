// Tell IndexNow search engines (Bing, Yandex, Seznam, Naver and others) which pages exist.
//   BASE_URL=https://theguysaccount.github.io/symbaiosis-ai-video-editor node scripts/indexnow.mjs dist-urls.txt
// The key file (<key>.txt) is published at the site root by build.mjs; a key at a sub-path covers
// the URLs under that path. A failed submission is reported but never fails the workflow: the
// site is already live, and the next deploy submits again.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const key = fs.readFileSync(path.join(ROOT, "site/indexnow-key.txt"), "utf8").trim();
const base = (process.env.BASE_URL || "").replace(/\/$/, "");
if (!base) throw new Error("BASE_URL is required");
const file = process.argv[2] || path.join(ROOT, "dist-urls.txt");
const host = new URL(base).host;
const urls = fs.readFileSync(file, "utf8").split("\n").filter((u) => u && new URL(u).host === host).slice(0, 10000);
const body = { host, key, keyLocation: `${base}/${key}.txt`, urlList: urls };

// A new key answers 403 until the engine has fetched the key file, so 403, 429 and 5xx are retried.
for (let attempt = 0; attempt < 4; attempt++) {
  if (attempt) await new Promise((r) => setTimeout(r, 45000 * attempt));
  try {
    const res = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(body),
    });
    console.log(`IndexNow: ${res.status} ${res.statusText} for ${urls.length} URLs`);
    if ([200, 202].includes(res.status)) break;
    console.log((await res.text()).slice(0, 300));
    if (!(res.status === 403 || res.status === 429 || res.status >= 500)) break;
  } catch (e) {
    console.log(`IndexNow: ${e.message}`);
  }
}
