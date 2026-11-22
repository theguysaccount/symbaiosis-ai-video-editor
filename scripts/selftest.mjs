// End-to-end self-test in headless Chrome: the real editor, on the real pages.
//   node scripts/selftest.mjs                     # serves dist/ locally under /symbaiosis-ai-video-editor/
//   node scripts/selftest.mjs --url https://theguysaccount.github.io/symbaiosis-ai-video-editor/
//   options: --report <file.json>  --save <file.mp4> (keep the sample export)  --only pages|sample|upload
//            --max-age-days <n>    (live runs: fail if build.json is older than this)
// Checks: every page in the sitemap loads with its SEO tags, a strict CSP and no console errors;
// the sample clip is transcribed on the device, its pauses and filler words are cut by about the
// amount its own timeline (sample-truth.json) predicts, and the export is a playable vertical video
// with captions burned in; the upload path works at phone size; and no request leaves the site.
// Expectations come from the sample's truth file and the sitemap, never from launch-day numbers.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { serve } from "./serve.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (k, d = "") => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const CHROME = process.env.CHROME || [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium-browser", "/usr/bin/chromium",
].find((p) => fs.existsSync(p));
const only = opt("--only");
const report = { started: new Date().toISOString(), checks: [], ok: true };
const check = (name, pass, detail = "") => {
  report.checks.push({ name, pass: !!pass, detail: String(detail) });
  if (!pass) report.ok = false;
  console.log(`${pass ? "ok  " : "FAIL"} ${name}${detail !== "" ? ` (${detail})` : ""}`);
};

let server = null;
let base = opt("--url");
if (!base) {
  server = await serve(path.join(ROOT, "dist"), 0, "/symbaiosis-ai-video-editor");
  base = `http://127.0.0.1:${server.address().port}/symbaiosis-ai-video-editor/`;
}
if (!base.endsWith("/")) base += "/";
const origin = new URL(base).origin;
console.log(`self-test against ${base} with ${CHROME}`);

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, protocolTimeout: 900000,
  args: ["--autoplay-policy=no-user-gesture-required", "--enable-unsafe-swiftshader", ...(process.env.CI ? ["--no-sandbox"] : [])],
});

async function open(url, { mobile = false } = {}) {
  const page = await browser.newPage();
  const errors = [], offsite = [];
  page.on("console", (m) => { if (m.type() === "error" && !/favicon/.test(m.text())) errors.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
  page.on("request", (r) => { const u = r.url(); if (!u.startsWith(origin) && !u.startsWith("blob:") && !u.startsWith("data:")) offsite.push(u); });
  // Requests made by the speech worker are seen through the worker target.
  page.on("workercreated", (w) => { try { w.client?.on?.("Network.requestWillBeSent", (e) => { const u = e.request.url; if (!u.startsWith(origin) && !u.startsWith("blob:") && !u.startsWith("data:")) offsite.push(u); }); } catch { /* best effort */ } });
  if (mobile) await page.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36" });
  else await page.setViewport({ width: 1280, height: 900 });
  const res = await page.goto(url, { waitUntil: "load", timeout: 90000 });
  return { page, errors, offsite, status: res?.status() };
}

const truth = JSON.parse(fs.readFileSync(path.join(ROOT, "site/assets/samples/sample-truth.json"), "utf8"));
const bare = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
const FILLER = /^(u+m+|u+h+|u+h+m+|e+r+m*|a+h+|e+h+|h+m+|m+h?m+)$/;

/** What the edit should come to, from the sample's own timeline and the editor's pacing rule. */
function expectedDuration({ minSilence, pad, cutFillers }) {
  const kept = truth.phrases.filter((p) => !(cutFillers && p.filler));
  let total = 0;
  kept.forEach((p, i) => {
    total += p.end - p.start;
    const next = kept[i + 1];
    if (!next) return;
    const gap = next.start - p.end;
    const heldFiller = truth.phrases.some((q) => q.filler && cutFillers && q.start >= p.end && q.end <= next.start);
    total += gap >= minSilence || heldFiller ? Math.min(gap, 2 * pad) : gap;
  });
  return total + 2 * Math.min(pad, 0.1);           // a little room is kept before the first and after the last word
}

async function waitReady(page, label, timeout = 600000) {
  const t0 = Date.now();
  await page.waitForFunction(() => {
    const s = window.__symbaiosis?.state;
    return (s && s.done) || /went wrong|failed|couldn't|can't|stopped/i.test(document.getElementById("status")?.textContent || "");
  }, { timeout, polling: 500 });
  const status = await page.$eval("#status", (e) => e.textContent);
  const done = await page.evaluate(() => !!window.__symbaiosis?.state?.done);
  check(`${label}: analysis finished`, done && !/couldn't|failed|stopped/i.test(status), `${((Date.now() - t0) / 1000).toFixed(1)} s · ${status.slice(0, 160)}`);
  return done;
}

async function exportAndRead(page, label, save = "") {
  const t0 = Date.now();
  await page.click("#export");
  await page.waitForFunction(() => !document.getElementById("result").hidden || /Export failed/.test(document.getElementById("status").textContent), { timeout: 900000, polling: 500 });
  const failed = await page.$eval("#status", (e) => (/Export failed/.test(e.textContent) ? e.textContent : ""));
  check(`${label}: export finished`, !failed, failed || `${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (failed) return null;
  const info = await page.evaluate(async () => {
    const v = document.getElementById("out");
    if (v.readyState < 1) await new Promise((r) => v.addEventListener("loadedmetadata", r, { once: true }));
    if (!Number.isFinite(v.duration)) { v.currentTime = 1e9; await new Promise((r) => v.addEventListener("durationchange", r, { once: true })); }
    const a = document.getElementById("download");
    const b = await (await fetch(a.href)).blob();
    return { duration: v.duration, width: v.videoWidth, height: v.videoHeight, size: b.size, type: b.type, name: a.download, meta: document.getElementById("result-meta").textContent, srt: !!document.getElementById("srt").href };
  });
  if (save) {
    const b64 = await page.evaluate(async () => {
      const b = new Uint8Array(await (await fetch(document.getElementById("download").href)).arrayBuffer());
      let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
      return btoa(s);
    });
    fs.mkdirSync(path.dirname(path.resolve(save)), { recursive: true });
    fs.writeFileSync(save, Buffer.from(b64, "base64"));
  }
  return info;
}

try {
  // 1. Pages from the sitemap: status, SEO tags, CSP, structured data, no errors, nothing off-site.
  if (!only || only === "pages") {
    const sm = await (await fetch(base + "sitemap.xml")).text();
    const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    check("sitemap lists pages", locs.length >= 5, `${locs.length} URLs`);
    // The sitemap holds canonical URLs (the configured base); map them onto the address under test.
    const siteRoot = (await (await fetch(base + "build.json", { cache: "no-store" })).json()).base.replace(/\/$/, "") + "/";
    for (const loc of locs) {
      const p = loc.startsWith(siteRoot) ? loc.slice(siteRoot.length) : new URL(loc).pathname.replace(/^\//, "");
      const url = base + p;
      const { page, errors, offsite, status } = await open(url);
      const seo = await page.evaluate(() => ({
        title: document.title,
        canonical: document.querySelector("link[rel=canonical]")?.href || "",
        desc: document.querySelector("meta[name=description]")?.content || "",
        og: document.querySelector('meta[property="og:image"]')?.content || "",
        csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || "",
        h1: document.querySelector("h1")?.textContent || "",
        ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => { try { return JSON.parse(s.textContent)["@type"]; } catch { return "BAD"; } }),
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      }));
      check(`page /${p}: loads`, status === 200, `HTTP ${status}`);
      check(`page /${p}: title, description, h1, canonical, og:image`, seo.title && seo.desc.length > 50 && seo.h1 && seo.canonical === loc && seo.og, seo.title.slice(0, 70));
      check(`page /${p}: CSP allows connecting only to this site`, /connect-src 'self' blob: data:(;|$| https:\/\/[^\s;]+\.goatcounter\.com)/.test(seo.csp), seo.csp.match(/connect-src[^;]*/)?.[0]);
      check(`page /${p}: structured data parses`, !seo.ld.includes("BAD"), seo.ld.join(", ") || "none");
      check(`page /${p}: no console errors`, !errors.length, errors.join(" | "));
      check(`page /${p}: no off-site requests`, !offsite.length, offsite.join(" "));
      await page.close();
    }
    for (const f of ["robots.txt", "feed.xml", "build.json", "manifest.webmanifest", "og.png", "assets/samples/sample.mp4", "assets/models/manifest.json"]) {
      const r = await fetch(base + f, { method: "HEAD" });
      check(`/${f} is served`, r.ok, `HTTP ${r.status}`);
    }
    if (opt("--max-age-days")) {
      const b = await (await fetch(base + "build.json", { cache: "no-store" })).json();
      const age = (Date.now() - Date.parse(b.built)) / 86400000;
      check("live build is fresh", age <= Number(opt("--max-age-days")), `built ${b.built} (${age.toFixed(1)} days ago), commit ${String(b.commit).slice(0, 7)}`);
      report.build = b;
    }
  }

  // 2. The sample clip, end to end, on a desktop-sized screen.
  if (!only || only === "sample") {
    const { page, errors, offsite } = await open(base);
    const unsupported = await page.$eval("#unsupported", (e) => !e.hidden);
    check("sample: browser has WebCodecs", !unsupported);
    await page.click("#sample");
    if (await waitReady(page, "sample")) {
      const s = await page.evaluate(() => {
        const st = window.__symbaiosis.state;
        return { words: st.words.map((w) => w.text), removed: [...st.plan.removedWords], out: st.plan.outDuration, dur: st.info.duration, gaps: st.plan.gaps.filter((g) => g.cut).length, cues: st.cues.length };
      });
      const heard = new Set(s.words.map(bare));
      const said = truth.phrases.filter((p) => !p.filler).flatMap((p) => p.text.split(/\s+/)).map(bare).filter(Boolean);
      const recall = said.filter((w) => heard.has(w)).length / said.length;
      check("sample: transcript matches what was said (word recall >= 75%)", recall >= 0.75, `${(recall * 100).toFixed(0)}% of ${said.length} words`);
      const fillersSaid = truth.phrases.filter((p) => p.filler).length;
      const fillersCut = s.removed.filter((i) => FILLER.test(bare(s.words[i]))).length;
      check("sample: filler words found and cut", fillersCut >= fillersSaid - 1, `${fillersCut} cut, ${fillersSaid} in the script`);
      const want = expectedDuration({ minSilence: 0.5, pad: 0.1, cutFillers: true });
      check("sample: edit length matches the script's timeline (+-1.5 s)", Math.abs(s.out - want) <= 1.5, `${s.dur.toFixed(2)} s -> ${s.out.toFixed(2)} s, expected about ${want.toFixed(2)} s`);
      check("sample: pauses were shortened", s.gaps >= truth.pauses.filter((p) => p.end - p.start >= 0.5).length - 3, `${s.gaps} pauses cut`);
      check("sample: captions were built", s.cues >= 5, `${s.cues} captions`);
      // Export 720p vertical with captions.
      await page.evaluate(() => {
        const f = document.getElementById("settings").elements;
        f.quality.value = "720"; f.format.value = "9:16";
        document.getElementById("settings").dispatchEvent(new Event("change"));
      });
      const r = await exportAndRead(page, "sample", opt("--save"));
      if (r) {
        check("sample: export is 720x1280", r.width === 720 && r.height === 1280, `${r.width}x${r.height}`);
        check("sample: export length matches the edit (+-0.3 s)", Math.abs(r.duration - s.out) <= 0.3, `${r.duration.toFixed(2)} s vs ${s.out.toFixed(2)} s`);
        check("sample: export is a real video file", r.size > 150000 && /video\/(mp4|webm)/.test(r.type), `${r.type}, ${(r.size / 1e6).toFixed(2)} MB, ${r.meta}`);
        check("sample: caption files offered", r.srt);
        // Captions burned in: bright text pixels in the caption band while a word is spoken.
        const lit = await page.evaluate(async () => {
          const st = window.__symbaiosis.state;
          const cue = st.cues[Math.floor(st.cues.length / 2)];
          const v = document.createElement("video");
          v.muted = true; v.src = document.getElementById("out").src;
          await new Promise((r) => v.addEventListener("loadeddata", r, { once: true }));
          v.currentTime = (cue.start + cue.end) / 2;
          await new Promise((r) => v.addEventListener("seeked", r, { once: true }));
          const c = document.createElement("canvas"); c.width = v.videoWidth; c.height = v.videoHeight;
          const x = c.getContext("2d"); x.drawImage(v, 0, 0);
          const y0 = Math.round(c.height * 0.6), y1 = Math.round(c.height * 0.8);
          const d = x.getImageData(0, y0, c.width, y1 - y0).data;
          let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 225 && d[i + 1] > 210 && d[i + 2] > 60) n++;
          return n / (d.length / 4);
        });
        check("sample: captions are burned into the picture", lit > 0.004, `${(lit * 100).toFixed(2)}% bright pixels in the caption band`);
        report.sample = { ...r, edit: s.out };
      }
    }
    check("sample: no console errors", !errors.length, errors.join(" | "));
    check("sample: no off-site requests", !offsite.length, offsite.join(" "));
    await page.close();
  }

  // 3. A visitor's own file at phone size: tight pacing, no captions, original shape.
  if (!only || only === "upload") {
    const { page, errors, offsite } = await open(base + "remove-silence-from-video/", { mobile: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check("upload: no sideways scrolling on a phone", !overflow);
    const input = await page.$("#file");
    await input.uploadFile(path.join(ROOT, "site/assets/samples/sample.mp4"));
    if (await waitReady(page, "upload")) {
      const preset = await page.evaluate(() => document.getElementById("settings").elements.pacing.value);
      check("upload: the remove-silence page starts on tight pacing", preset === "tight", preset);
      await page.evaluate(() => {
        const f = document.getElementById("settings").elements;
        f.captions.checked = false; f.format.value = "original"; f.quality.value = "720";
        document.getElementById("settings").dispatchEvent(new Event("change"));
      });
      const out = await page.evaluate(() => window.__symbaiosis.state.plan.outDuration);
      const want = expectedDuration({ minSilence: 0.35, pad: 0.06, cutFillers: true });
      check("upload: tight edit length matches the script's timeline (+-1.5 s)", Math.abs(out - want) <= 1.5, `${out.toFixed(2)} s, expected about ${want.toFixed(2)} s`);
      const r = await exportAndRead(page, "upload");
      if (r) {
        check("upload: original shape kept (1280x720)", r.width === 1280 && r.height === 720, `${r.width}x${r.height}`);
        check("upload: export length matches the edit (+-0.3 s)", Math.abs(r.duration - out) <= 0.3, `${r.duration.toFixed(2)} s vs ${out.toFixed(2)} s`);
      }
    }
    check("upload: no console errors", !errors.length, errors.join(" | "));
    check("upload: no off-site requests", !offsite.length, offsite.join(" "));
    await page.close();
  }
} catch (e) {
  check("self-test ran to the end", false, String((e && e.stack) || e).slice(0, 800));
} finally {
  await browser.close();
  server?.close();
  report.finished = new Date().toISOString();
  if (opt("--report")) fs.writeFileSync(opt("--report"), JSON.stringify(report, null, 2));
  console.log(report.ok ? "SELF-TEST PASSED" : "SELF-TEST FAILED");
  process.exitCode = report.ok ? 0 : 1;
}
