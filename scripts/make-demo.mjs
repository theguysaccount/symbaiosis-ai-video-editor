// Make the landing-page media from real output of the editor:
//   node scripts/make-demo.mjs <sample-edit.mp4>
// <sample-edit.mp4> is the editor's own export of the sample clip, saved by
//   node scripts/selftest.mjs --only sample --save <sample-edit.mp4>
// Writes, all from this machine's headless Chrome and the site's own Mediabunny:
//   site/assets/demo/sample-edit.mp4  small, silent copy of the export for the hero (432x768)
//   site/assets/demo/before.mp4       small, silent copy of the sample clip (640x360)
//   site/assets/demo/before.jpg, after.jpg  poster frames
//   site/og.png                        1200x630 share card
//   site/apple-touch-icon.png          180x180 icon
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { serve } from "./serve.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const editFile = path.resolve(process.argv[2] || "");
if (!fs.existsSync(editFile)) throw new Error("usage: node scripts/make-demo.mjs <sample-edit.mp4>");
const CHROME = process.env.CHROME || ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => fs.existsSync(p));
const tmp = path.join(ROOT, ".demo-work");
fs.mkdirSync(tmp, { recursive: true });
fs.copyFileSync(editFile, path.join(tmp, "edit.mp4"));
fs.writeFileSync(path.join(tmp, "index.html"), `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="/site/assets/vendor/fonts/montserrat.css">
<body style="margin:0"><script type="module">
import * as MB from "/site/assets/vendor/mediabunny.min.mjs";
const b64 = async (blob) => { const b = new Uint8Array(await blob.arrayBuffer()); let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
async function small(url, w, h, bitrate) {
  const input = new MB.Input({ source: new MB.BlobSource(await (await fetch(url)).blob()), formats: MB.ALL_FORMATS });
  const output = new MB.Output({ format: new MB.Mp4OutputFormat({ fastStart: "in-memory" }), target: new MB.BufferTarget() });
  const c = await MB.Conversion.init({ input, output, video: { width: w, height: h, fit: "contain", codec: "avc", bitrate }, audio: { discard: true } });
  await c.execute();
  return new Blob([output.target.buffer], { type: "video/mp4" });
}
async function frame(url, t, w, h) {
  const v = document.createElement("video"); v.muted = true; v.src = url;
  await new Promise((r) => v.addEventListener("loadeddata", r, { once: true }));
  v.currentTime = t; await new Promise((r) => v.addEventListener("seeked", r, { once: true }));
  const c = document.createElement("canvas"); c.width = w || v.videoWidth; c.height = h || v.videoHeight;
  c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
  return c;
}
window.make = async () => {
  await document.fonts.load("800 64px Montserrat");
  const out = {};
  const after = await small("edit.mp4", 432, 768, 650000);
  out.afterVideo = await b64(after);
  const afterUrl = URL.createObjectURL(after);
  out.beforeVideo = await b64(await small("/site/assets/samples/sample.mp4", 640, 360, 420000));
  const pa = await frame(afterUrl, 2.2, 432, 768);
  out.afterPoster = await b64(await new Promise((r) => pa.toBlob(r, "image/jpeg", 0.82)));
  const pb = await frame("/site/assets/samples/sample.mp4", 1.3, 640, 360);
  out.beforePoster = await b64(await new Promise((r) => pb.toBlob(r, "image/jpeg", 0.82)));
  // Share card: words on the left, a real frame of the export on the right.
  const og = document.createElement("canvas"); og.width = 1200; og.height = 630;
  const x = og.getContext("2d");
  const g = x.createLinearGradient(0, 0, 1200, 630); g.addColorStop(0, "#15121f"); g.addColorStop(1, "#2b1f55");
  x.fillStyle = g; x.fillRect(0, 0, 1200, 630);
  const shot = await frame(afterUrl, 2.2, 0, 0);
  const fh = 560, fw = Math.round(fh * shot.width / shot.height);
  x.save(); x.beginPath(); x.roundRect(1200 - fw - 70, 35, fw, fh, 26); x.clip(); x.drawImage(shot, 1200 - fw - 70, 35, fw, fh); x.restore();
  x.fillStyle = "#fff"; x.font = "800 64px Montserrat"; x.textBaseline = "top";
  ["Cut the pauses", "and ums. Add", "captions. Go", "vertical."].forEach((l, i) => x.fillText(l, 70, 92 + i * 78));
  x.fillStyle = "#ffe14d"; x.font = "800 30px Montserrat"; x.fillText("Free · in your browser · no upload", 70, 440);
  x.fillStyle = "#b9b2d6"; x.font = "800 30px Montserrat"; x.fillText("Symbaiosis", 70, 520);
  out.og = await b64(await new Promise((r) => og.toBlob(r, "image/png")));
  // Icon.
  const img = new Image(); img.src = "/site/favicon.svg"; await img.decode();
  const ic = document.createElement("canvas"); ic.width = 180; ic.height = 180;
  const ix = ic.getContext("2d"); ix.fillStyle = "#5b3df5"; ix.fillRect(0, 0, 180, 180); ix.drawImage(img, 0, 0, 180, 180);
  out.icon = await b64(await new Promise((r) => ic.toBlob(r, "image/png")));
  return out;
};
window.ready = true;
</script>`);

const server = await serve(ROOT, 0, "");
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: process.env.CI ? ["--no-sandbox"] : [] });
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", String(e)));
  await page.goto(`http://127.0.0.1:${server.address().port}/.demo-work/index.html`);
  await page.waitForFunction(() => window.ready);
  const r = await page.evaluate(() => window.make());
  const put = (rel, b) => { const f = path.join(ROOT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.from(b, "base64")); console.log(`${rel}  ${(fs.statSync(f).size / 1e3).toFixed(0)} kB`); };
  put("site/assets/demo/sample-edit.mp4", r.afterVideo);
  put("site/assets/demo/before.mp4", r.beforeVideo);
  put("site/assets/demo/after.jpg", r.afterPoster);
  put("site/assets/demo/before.jpg", r.beforePoster);
  put("site/og.png", r.og);
  put("site/apple-touch-icon.png", r.icon);
} finally {
  await browser.close();
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
