// Build tests: the site builds for any base URL and date, every page in the sitemap exists with
// its tags, internal links resolve, guides publish by date, and the vendored files and models are
// the ones recorded in the manifests. Expected values come from the content files, not fixed counts.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { frontMatter } from "../scripts/lib/markdown.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const today = new Date().toISOString().slice(0, 10);
const guides = fs.readdirSync(path.join(ROOT, "content/guides")).filter((f) => f.endsWith(".md"))
  .map((f) => ({ slug: f.replace(/\.md$/, ""), ...frontMatter(fs.readFileSync(path.join(ROOT, "content/guides", f), "utf8")).meta }));

function build(base, date) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "symb-build-"));
  const urls = path.join(out, "urls.txt");
  execFileSync(process.execPath, ["scripts/build.mjs"], { cwd: ROOT, env: { ...process.env, BASE_URL: base, BUILD_DATE: date, OUT_DIR: path.join(out, "dist"), URLS_OUT: urls, GOATCOUNTER_URL: "", PRO_URL: "", SUPPORT_URL: "" }, stdio: "pipe" });
  return { dir: path.join(out, "dist"), urls: fs.readFileSync(urls, "utf8").trim().split("\n"), cleanup: () => fs.rmSync(out, { recursive: true, force: true }) };
}

function htmlFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "assets") out.push(...htmlFiles(p)); }
    else if (e.name.endsWith(".html")) out.push(p);
  }
  return out;
}

test("every sitemap page exists, carries its tags, and has no unfilled placeholders", () => {
  const base = "https://example.test/sub";
  const b = build(base, today);
  try {
    const sm = fs.readFileSync(path.join(b.dir, "sitemap.xml"), "utf8");
    const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    assert.deepEqual(locs, b.urls);
    for (const loc of locs) {
      const rel = loc.slice(base.length);
      const file = path.join(b.dir, rel, "index.html");
      assert.ok(fs.existsSync(file), `missing ${rel}`);
      const html = fs.readFileSync(file, "utf8");
      assert.ok(html.includes(`<link rel="canonical" href="${loc}">`), `canonical on ${rel}`);
      assert.match(html, /<title>[^<]{10,}<\/title>/);
      assert.match(html, /<meta name="description" content="[^"]{50,}">/);
      assert.match(html, /<meta http-equiv="Content-Security-Policy" content="[^"]*connect-src 'self' blob: data:;/);
      assert.ok(!/\{\{\w+\}\}/.test(html), `placeholder left on ${rel}`);
      for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(m[1]);
    }
    assert.match(fs.readFileSync(path.join(b.dir, "robots.txt"), "utf8"), new RegExp(`Sitemap: ${base}/sitemap.xml`));
    const key = fs.readFileSync(path.join(ROOT, "site/indexnow-key.txt"), "utf8").trim();
    assert.equal(fs.readFileSync(path.join(b.dir, `${key}.txt`), "utf8"), key);
    const info = JSON.parse(fs.readFileSync(path.join(b.dir, "build.json"), "utf8"));
    assert.equal(info.base, base);
    assert.ok(!Number.isNaN(Date.parse(info.built)));
  } finally { b.cleanup(); }
});

test("internal links and assets resolve to files in the build", () => {
  const b = build("https://example.test/sub", today);
  try {
    const missing = [];
    for (const file of htmlFiles(b.dir)) {
      const html = fs.readFileSync(file, "utf8");
      for (const m of html.matchAll(/(?:href|src|poster)="([^"]+)"/g)) {
        let u = m[1].replace(/[?#].*$/, "");
        if (!u || /^(https?:|mailto:|data:|#)/.test(m[1])) {
          if (u.startsWith("https://example.test/sub/")) u = path.join(b.dir, u.slice("https://example.test/sub/".length));
          else continue;
        } else u = path.resolve(path.dirname(file), u);
        const target = fs.existsSync(u) && fs.statSync(u).isDirectory() ? path.join(u, "index.html") : u;
        if (!fs.existsSync(target)) missing.push(`${path.relative(b.dir, file)} -> ${m[1]}`);
      }
    }
    assert.deepEqual(missing, []);
  } finally { b.cleanup(); }
});

test("guides publish on their date: none before, all after, and only published ones are listed", () => {
  const dates = guides.map((g) => g.publish).sort();
  const before = new Date(Date.parse(dates[0]) - 86400000).toISOString().slice(0, 10);
  const early = build("https://example.test", before);
  try {
    assert.ok(!fs.existsSync(path.join(early.dir, "guides", guides[0].slug)), "a guide was published early");
    assert.ok(fs.existsSync(path.join(early.dir, "guides/index.html")));
  } finally { early.cleanup(); }
  const late = build("https://example.test", "2999-01-01");
  try {
    for (const g of guides) assert.ok(fs.existsSync(path.join(late.dir, "guides", g.slug, "index.html")), g.slug);
    // The address is one setting: no page, published now or later, names a github.io host.
    for (const f of htmlFiles(late.dir)) assert.ok(!/github\.io/.test(fs.readFileSync(f, "utf8")), path.relative(late.dir, f));
  } finally { late.cleanup(); }
  const now = build("https://example.test", today);
  try {
    const live = guides.filter((g) => g.publish <= today);
    const sm = fs.readFileSync(path.join(now.dir, "sitemap.xml"), "utf8");
    const feed = fs.readFileSync(path.join(now.dir, "feed.xml"), "utf8");
    for (const g of guides) {
      const listed = sm.includes(`/guides/${g.slug}/`);
      assert.equal(listed, g.publish <= today, `${g.slug} sitemap`);
      assert.equal(feed.includes(`/guides/${g.slug}/`), g.publish <= today, `${g.slug} feed`);
    }
    assert.equal(JSON.parse(fs.readFileSync(path.join(now.dir, "build.json"), "utf8")).guides, live.length);
  } finally { now.cleanup(); }
});

test("guides have the fields the build needs and valid dates", () => {
  for (const g of guides) {
    assert.ok(g.title && g.description && g.description.length >= 50, g.slug);
    assert.match(g.publish, /^\d{4}-\d{2}-\d{2}$/, g.slug);
  }
});

test("vendored libraries are present and the AAC encoder imports the local Mediabunny", () => {
  const v = path.join(ROOT, "site/assets/vendor");
  for (const f of ["mediabunny.min.mjs", "mediabunny-aac-encoder.min.mjs", "transformers.min.js", "ort/ort-wasm-simd-threaded.mjs", "ort/ort-wasm-simd-threaded.wasm", "fonts/montserrat.css", "NOTICE.md"]) assert.ok(fs.existsSync(path.join(v, f)), f);
  const aac = fs.readFileSync(path.join(v, "mediabunny-aac-encoder.min.mjs"), "utf8");
  assert.ok(aac.includes('from"./mediabunny.min.mjs"') && !aac.includes('from"mediabunny"'));
  // Nothing in the page's own code points at another origin.
  for (const f of fs.readdirSync(path.join(ROOT, "site/assets/js"))) {
    const src = fs.readFileSync(path.join(ROOT, "site/assets/js", f), "utf8");
    assert.ok(!/https?:\/\/(?!127\.0\.0\.1)/.test(src.replace(/\/\/.*$/gm, "")), `${f} mentions an external URL`);
  }
});

test("speech models match their manifest (sizes and SHA-256)", () => {
  const out = execFileSync(process.execPath, ["scripts/fetch-models.mjs", "--check"], { cwd: ROOT, stdio: "pipe" }).toString();
  assert.match(out, /models match the manifest/);
});
