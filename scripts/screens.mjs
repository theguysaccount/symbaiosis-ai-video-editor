// Screenshots of the key screens at desktop and phone sizes, into docs/screens/.
//   node scripts/build.mjs && node scripts/screens.mjs [--url <site>]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { serve } from "./serve.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "docs/screens");
const args = process.argv.slice(2);
const i = args.indexOf("--url");
let server = null, base = i >= 0 ? args[i + 1] : "";
if (!base) { server = await serve(path.join(ROOT, "dist"), 0, "/symbaiosis-ai-video-editor"); base = `http://127.0.0.1:${server.address().port}/symbaiosis-ai-video-editor/`; }
const CHROME = process.env.CHROME || ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome"].find((p) => fs.existsSync(p));
fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 600000, args: ["--autoplay-policy=no-user-gesture-required"] });
const sizes = { desktop: { width: 1366, height: 900, deviceScaleFactor: 1 }, phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } };
try {
  for (const [name, vp] of Object.entries(sizes)) {
    const page = await browser.newPage();
    await page.emulate({ viewport: vp, userAgent: name === "phone" ? "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36" : (await browser.userAgent()) });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await page.goto(base, { waitUntil: "networkidle0" });
    await page.screenshot({ path: path.join(OUT, `home-${name}.png`) });
    await page.click("#sample");
    await page.waitForFunction(() => window.__symbaiosis?.state?.done, { timeout: 300000, polling: 500 });
    await page.evaluate(() => { const v = document.getElementById("video"); v.currentTime = 6.0; });
    await new Promise((r) => setTimeout(r, 800));
    await page.evaluate(() => document.getElementById("tool").scrollIntoView());
    await page.screenshot({ path: path.join(OUT, `editor-${name}.png`) });
    await page.click("#tab-captions");
    await page.evaluate(() => document.getElementById("tool").scrollIntoView());
    await page.screenshot({ path: path.join(OUT, `captions-${name}.png`) });
    await page.evaluate(() => { const f = document.getElementById("settings").elements; f.quality.value = "720"; document.getElementById("settings").dispatchEvent(new Event("change")); });
    await page.click("#export");
    await page.waitForFunction(() => !document.getElementById("result").hidden, { timeout: 600000, polling: 500 });
    await page.evaluate(async () => { const v = document.getElementById("out"); v.currentTime = 2.2; await new Promise((r) => v.addEventListener("seeked", r, { once: true })); document.getElementById("result").scrollIntoView(); });
    await page.screenshot({ path: path.join(OUT, `result-${name}.png`) });
    for (const p of ["remove-silence-from-video/", "guides/how-much-pause-to-leave-between-cuts/"]) {
      await page.goto(base + p, { waitUntil: "networkidle0" });
      await page.screenshot({ path: path.join(OUT, `${p.split("/").filter(Boolean).pop()}-${name}.png`) });
    }
    await page.close();
    console.log(`${name}: done`);
  }
} finally {
  await browser.close();
  server?.close();
}
