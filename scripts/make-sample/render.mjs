// Step 2 of making the sample clip: animate a simple cartoon speaker over the narration from
// voice.mjs and encode it to MP4 (H.264 + AAC) in headless Chrome with this site's own Mediabunny.
//   node scripts/make-sample/render.mjs <dir-with-voice.wav-and-truth.json> <out.mp4>
// The picture is drawn from code, so the clip contains no person, no stock footage and nothing
// anyone else owns. Its mouth moves with the loudness of the voice, which makes cuts easy to see.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { serve } from "../serve.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dir = path.resolve(process.argv[2] || "sample-out");
const outFile = path.resolve(process.argv[3] || path.join(dir, "sample.mp4"));
const CHROME = process.env.CHROME || ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => fs.existsSync(p));

const html = `<!doctype html><meta charset="utf-8"><body><script type="module">
import * as MB from "/site/assets/vendor/mediabunny.min.mjs";
window.render = async (wavB64) => {
  const W = 1280, H = 720, FPS = 30;
  const bytes = Uint8Array.from(atob(wavB64), (c) => c.charCodeAt(0));
  const ac = new OfflineAudioContext(1, 1, 48000);
  const audio = await ac.decodeAudioData(bytes.buffer);
  const pcm = audio.getChannelData(0), sr = audio.sampleRate;
  const frames = Math.ceil(audio.duration * FPS);
  // Loudness per video frame, smoothed, for the mouth.
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const a = Math.floor((f / FPS) * sr), b = Math.min(pcm.length, Math.floor(((f + 1) / FPS) * sr));
    let s = 0; for (let i = a; i < b; i++) s += pcm[i] * pcm[i];
    env[f] = Math.sqrt(s / Math.max(1, b - a));
  }
  const peak = Math.max(...env) || 1;
  let sm = 0;
  for (let f = 0; f < frames; f++) { const v = Math.min(1, env[f] / (peak * 0.55)); sm += (v - sm) * (v > sm ? 0.7 : 0.35); env[f] = sm; }

  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const out = new MB.Output({ format: new MB.Mp4OutputFormat({ fastStart: "in-memory" }), target: new MB.BufferTarget() });
  const vs = new MB.CanvasSource(canvas, { codec: "avc", quality: new MB.Quality({ bitrate: 1_400_000 }), keyFrameInterval: 2 });
  out.addVideoTrack(vs, { frameRate: FPS });
  const as = new MB.AudioBufferSource({ codec: "aac", quality: new MB.Quality({ bitrate: 128000 }) });
  out.addAudioTrack(as);
  await out.start();

  const blobs = [[0.18, 0.25, 220, "#7b61ff"], [0.82, 0.3, 260, "#ff7ab6"], [0.7, 0.85, 200, "#4dd8ff"], [0.25, 0.8, 180, "#ffd84d"]];
  for (let f = 0; f < frames; f++) {
    const t = f / FPS;
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#1b1730"); g.addColorStop(1, "#2a1f4d");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.globalAlpha = 0.28; ctx.filter = "blur(40px)";
    for (const [x, y, r, c] of blobs) {
      ctx.fillStyle = c; ctx.beginPath();
      ctx.arc(W * x + Math.sin(t * 0.4 + x * 9) * 40, H * y + Math.cos(t * 0.33 + y * 7) * 30, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    // The speaker: head bobs a little while talking.
    const m = env[f];
    const cx = W / 2, cy = H * 0.5 + Math.sin(t * 2.1) * 4 - m * 6;
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath(); ctx.ellipse(cx, H * 0.86, 150, 18, 0, 0, Math.PI * 2); ctx.fill();
    const hg = ctx.createRadialGradient(cx - 50, cy - 60, 20, cx, cy, 190);
    hg.addColorStop(0, "#9d8bff"); hg.addColorStop(1, "#5b3df5");
    ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(cx, cy, 170, 0, Math.PI * 2); ctx.fill();
    const blink = (t % 4.2) > 4.05 ? 0.15 : 1;
    ctx.fillStyle = "#fff";
    for (const dx of [-58, 58]) { ctx.beginPath(); ctx.ellipse(cx + dx, cy - 35, 24, 30 * blink, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = "#16151d";
    for (const dx of [-54, 62]) { ctx.beginPath(); ctx.ellipse(cx + dx, cy - 30, 11, 14 * blink, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = "#16151d";
    ctx.beginPath(); ctx.ellipse(cx, cy + 62, 46 + m * 10, 6 + m * 38, 0, 0, Math.PI * 2); ctx.fill();
    if (m > 0.15) { ctx.fillStyle = "#ff6f91"; ctx.beginPath(); ctx.ellipse(cx, cy + 62 + m * 18, 24, m * 14, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = "700 22px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("SAMPLE CLIP · computer voice", W / 2, 52);
    ctx.textAlign = "left";
    await vs.add(t, 1 / FPS);
  }
  vs.close();
  await as.add(audio);
  as.close();
  await out.finalize();
  const buf = new Uint8Array(out.target.buffer);
  let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { b64: btoa(s), frames, duration: audio.duration };
};
window.ready = true;
</script>`;

const site = path.join(ROOT, ".sample-render");
fs.mkdirSync(site, { recursive: true });
fs.writeFileSync(path.join(site, "index.html"), html);
const server = await serve(ROOT, 0, "");
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: process.env.CI ? ["--no-sandbox"] : [] });
try {
  const page = await browser.newPage();
  page.on("console", (m) => console.log("[page]", m.text()));
  page.on("pageerror", (e) => console.log("[pageerror]", String(e)));
  await page.goto(base + ".sample-render/index.html");
  await page.waitForFunction(() => window.ready);
  const wav = fs.readFileSync(path.join(dir, "voice.wav")).toString("base64");
  const r = await page.evaluate((b) => window.render(b), wav);
  fs.writeFileSync(outFile, Buffer.from(r.b64, "base64"));
  console.log(`${outFile}: ${(fs.statSync(outFile).size / 1e6).toFixed(2)} MB, ${r.frames} frames, ${r.duration.toFixed(2)} s`);
} finally {
  await browser.close();
  server.close();
  fs.rmSync(site, { recursive: true, force: true });
}
