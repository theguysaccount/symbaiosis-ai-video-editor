// Build the static site into dist/: landing pages around the editor, guides published by date,
// sitemap, robots.txt, Atom feed, IndexNow key file, build.json (for the staleness check) and
// dist-urls.txt (for IndexNow after deploy).
//
//   BASE_URL=https://theguysaccount.github.io/symbaiosis-ai-video-editor node scripts/build.mjs
//
// BASE_URL is the one setting that decides the site's address: canonical links, the sitemap,
// share cards and IndexNow all follow it. The deploy sets it from the repository variable
// SITE_URL, or the GitHub Pages address when SITE_URL is empty (see OPERATIONS.md, key 1).
// Optional settings (empty by default; see .env.example):
//   GOATCOUNTER_URL  https://<code>.goatcounter.com/count   cookieless counts, off when empty
//   SUPPORT_URL      a donation or sponsor link              footer "Support this free tool"
//   PRO_URL          the paid version on other hosting       the money slot under the editor
//   BUILD_DATE       YYYY-MM-DD                              guides dated after this stay unpublished
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { markdown, frontMatter, escapeHtml as esc } from "./lib/markdown.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = path.join(ROOT, "site");
const OUT = path.resolve(ROOT, process.env.OUT_DIR || "dist");
const BASE = (process.env.BASE_URL || "http://127.0.0.1:4327/symbaiosis-ai-video-editor").replace(/\/$/, "");
const COUNTER = (process.env.GOATCOUNTER_URL || "").trim();
const SUPPORT = (process.env.SUPPORT_URL || "").trim();
const PRO = (process.env.PRO_URL || "").trim();
const TODAY = process.env.BUILD_DATE || new Date().toISOString().slice(0, 10);
const NAME = "Symbaiosis";
const REPO = "https://github.com/theguysaccount/symbaiosis-ai-video-editor";
const HOST = BASE.replace(/^https?:\/\//, "");
const KEY = fs.readFileSync(path.join(SITE, "indexnow-key.txt"), "utf8").trim();
const ASSET_V = Date.now().toString(36);

for (const u of [COUNTER, SUPPORT, PRO]) if (u && !/^https:\/\/[^\s"'<>]+$/.test(u)) throw new Error(`Not an https URL: ${u}`);
if (!/^https?:\/\/[^\s"'<>]+$/.test(BASE)) throw new Error(`BASE_URL must be an http(s) URL: ${BASE}`);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.cpSync(path.join(SITE, "assets"), path.join(OUT, "assets"), { recursive: true });
for (const f of ["favicon.svg", "apple-touch-icon.png", "og.png", "manifest.webmanifest"]) {
  if (fs.existsSync(path.join(SITE, f))) fs.copyFileSync(path.join(SITE, f), path.join(OUT, f));
}

const toolPartial = fs.readFileSync(path.join(SITE, "partials", "tool.html"), "utf8");
const pages = [];   // {path, title, lastmod, priority}

// ---------- layout ----------
function csp() {
  const counter = COUNTER ? " " + new URL(COUNTER).origin : "";
  return [
    "default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", "style-src 'self'",
    "img-src 'self' blob: data:", "media-src 'self' blob:", `connect-src 'self' blob: data:${counter}`,
    "worker-src 'self' blob:", "font-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'",
  ].join("; ");
}

const rel = (p, depth) => (depth ? "../".repeat(depth) : "./") + p;
const NAV = [["", "Editor"], ["remove-silence-from-video/", "Remove silence"], ["auto-caption-video/", "Auto captions"], ["guides/", "Guides"], ["privacy/", "Privacy"]];

function layout({ urlPath, title, description, body, jsonld = [], tool = false, ogType = "website", current = "", noindex = false }) {
  const depth = urlPath.split("/").filter(Boolean).length;
  const canonical = BASE + urlPath;
  const a = (p) => rel(p, depth);
  return `<!doctype html>
<html lang="en"${COUNTER ? ` data-counter="${esc(COUNTER)}"` : ""}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${csp()}">
<meta name="referrer" content="strict-origin-when-cross-origin">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${canonical}">`}
<meta property="og:type" content="${ogType}">
<meta property="og:site_name" content="${NAME}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${BASE}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="A wide video turned into a vertical clip with bold captions, next to the words Cut the pauses and ums">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#f7f6fb" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0f0e15" media="(prefers-color-scheme: dark)">
<link rel="icon" href="${a("favicon.svg")}" type="image/svg+xml">
<link rel="apple-touch-icon" href="${a("apple-touch-icon.png")}">
<link rel="manifest" href="${a("manifest.webmanifest")}">
<link rel="alternate" type="application/atom+xml" title="${NAME} guides" href="${BASE}/feed.xml">
<link rel="stylesheet" href="${a("assets/vendor/fonts/montserrat.css")}">
<link rel="stylesheet" href="${a("assets/css/app.css")}?v=${ASSET_V}">
${tool ? `<link rel="modulepreload" href="${a("assets/js/app.js")}?v=${ASSET_V}">` : ""}
${jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, "\\u003c")}</script>`).join("\n")}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div class="wrap">
<header class="site">
  <a class="brand" href="${a("")}" aria-label="${NAME} home"><svg viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="3" width="26" height="26" rx="7" fill="currentColor"/><path d="M8 12h4M14 12h10M8 17h7M18 17h6M8 22h11" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><path d="M14.5 10.5l4 3" stroke="#ffe14d" stroke-width="2.6" stroke-linecap="round"/></svg>${NAME}</a>
  <nav class="top" aria-label="Main">${NAV.map(([p, l]) => `<a href="${a(p)}"${current === p ? ' aria-current="page"' : ""}>${l}</a>`).join("")}</nav>
</header>
<main id="main">
${body}
</main>
<footer class="site">
  <nav aria-label="Footer">${NAV.map(([p, l]) => `<a href="${a(p)}">${l}</a>`).join("")}<a href="${a("remove-filler-words/")}">Remove filler words</a><a href="${a("vertical-video-converter/")}">Vertical video converter</a><a href="${a("how-it-works/")}">How it works</a><a href="${REPO}">Source code</a>${SUPPORT ? `<a href="${esc(SUPPORT)}" rel="noopener">Support this free tool</a>` : ""}</nav>
  <p>${NAME} runs entirely in your browser. Your video, its sound and its words never leave your device. Free, no account, no watermark, open source (MIT).</p>
</footer>
</div>
<script type="module" src="${a("assets/js/page.js")}?v=${ASSET_V}"></script>
${tool ? `<script type="module" src="${a("assets/js/app.js")}?v=${ASSET_V}"></script>` : ""}
</body>
</html>
`;
}

function write(urlPath, html, { priority = 0.6, lastmod = TODAY, title = "" } = {}) {
  const file = path.join(OUT, urlPath, urlPath.endsWith(".html") ? "" : "index.html");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
  if (!urlPath.endsWith(".html")) pages.push({ path: urlPath, priority, lastmod, title });
}

function faqLd(html) {
  const items = [...html.matchAll(/<details>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g)];
  if (!items.length) return null;
  const text = (h) => h.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  return { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: items.map((m) => ({ "@type": "Question", name: text(m[1]), acceptedAnswer: { "@type": "Answer", text: text(m[2]) } })) };
}

const appLd = (urlPath, name, description) => ({
  "@context": "https://schema.org", "@type": "WebApplication", name, url: BASE + urlPath, description,
  applicationCategory: "MultimediaApplication", operatingSystem: "Any (runs in a web browser)",
  browserRequirements: "Requires WebCodecs and WebAssembly (recent Chrome, Edge, Safari or Firefox)",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" }, isAccessibleForFree: true,
});

const crumbs = (items) => ({
  "@context": "https://schema.org", "@type": "BreadcrumbList",
  itemListElement: items.map(([name, p], i) => ({ "@type": "ListItem", position: i + 1, name, item: BASE + p })),
});

// ---------- landing pages (site/pages/*.html: JSON front matter in a leading comment) ----------
const guideList = loadGuides();
const published = guideList.filter((g) => g.publish <= TODAY);

for (const f of fs.readdirSync(path.join(SITE, "pages")).filter((f) => f.endsWith(".html")).sort()) {
  const src = fs.readFileSync(path.join(SITE, "pages", f), "utf8").replace(/\{\{base\}\}/g, BASE);
  const m = /^<!--(\{[\s\S]*?\})-->\s*/.exec(src);
  if (!m) throw new Error(`${f}: missing front matter`);
  const meta = JSON.parse(m[1]);
  const depth = meta.path.split("/").filter(Boolean).length;
  const content = src.slice(m[0].length)
    .replace(/\{\{guides\}\}/g, () => guideCards(published.slice(0, 6), meta.path))
    .replace(/\{\{root\}\}/g, rel("", depth))
    .replace(/\{\{counterNote\}\}/g, COUNTER ? " (and an anonymous visit counter, which never receives your video, its name or its words)" : "")
    .replace(/\{\{counterPolicy\}\}/g, COUNTER
      ? "This site counts visits and a few anonymous events, such as \u201ca video was exported\u201d, with GoatCounter, which sets no cookies. The counter receives the page address and the event name, never the video, its file name, its words or anything you type. Counting is skipped when your browser sends Do Not Track or Global Privacy Control."
      : "This site doesn't count visits at the moment. If counting is switched on later, it will be cookieless, it will never receive your video, its file name, its words or anything you type, and it will be skipped when your browser sends Do Not Track or Global Privacy Control.");
  const tool = !!meta.preset;
  const demo = `<figure class="demo">
    <div class="before"><span>Before: 31 s, wide</span><video src="${rel("assets/demo/before.mp4", depth)}" poster="${rel("assets/demo/before.jpg", depth)}" muted loop playsinline preload="none" data-autoplay aria-label="The sample clip before editing: a cartoon speaker with long pauses and filler words"></video></div>
    <div class="after"><span>After: cut and captioned</span><video src="${rel("assets/demo/sample-edit.mp4", depth)}" poster="${rel("assets/demo/after.jpg", depth)}" muted loop playsinline preload="none" data-autoplay aria-label="The same clip after editing: vertical, pauses and ums removed, bold captions"></video></div>
    <figcaption>Made with this editor from the sample clip (computer voice, nothing uploaded).</figcaption>
  </figure>`;
  const hero = meta.h1 ? `<section class="hero">
  <div>
    ${meta.crumb ? `<p class="crumbs"><a href="${rel("", depth)}">${NAME}</a> › ${esc(meta.crumb)}</p>` : ""}
    <h1>${meta.h1}</h1>
    <p class="lede">${meta.lede}</p>
    ${tool ? `<div class="hero-cta"><button class="btn primary big" type="button" data-pick>Choose a video</button><button class="btn ghost" type="button" data-sample>Try the sample clip</button></div>` : ""}
    <ul class="proof"><li>Runs on your device</li><li>No upload, no account</li><li>No watermark</li></ul>
  </div>
  ${meta.demo === false ? "" : demo}
</section>` : "";
  const toolHtml = tool ? toolPartial.replace("{{preset}}", meta.preset).replace("{{dropTitle}}", esc(meta.dropTitle || "Drop a talking video: we'll find the pauses and ums")) : "";
  const slot = tool && PRO ? `<aside class="slot"><b>Need longer videos, batch exports or AI effects?</b> <a href="${esc(PRO)}" rel="noopener">See ${NAME} Pro</a>.</aside>` : "";
  const body = `${hero}\n${toolHtml}\n${slot}\n${content}`;
  const jsonld = [];
  if (tool) jsonld.push(appLd(meta.path, meta.appName || NAME, meta.description));
  const faq = faqLd(content); if (faq) jsonld.push(faq);
  if (meta.crumb) jsonld.push(crumbs([[NAME, "/"], [meta.crumb, meta.path]]));
  if (meta.howto) jsonld.push({ "@context": "https://schema.org", "@type": "HowTo", name: meta.howto.name, step: meta.howto.steps.map((s, i) => ({ "@type": "HowToStep", position: i + 1, name: s })) });
  write(meta.path, layout({ urlPath: meta.path, title: meta.title, description: meta.description, body, jsonld, tool, current: meta.nav ?? meta.path.slice(1) }), { priority: meta.priority ?? 0.8, title: meta.title });
}

// ---------- guides ----------
function loadGuides() {
  const dir = path.join(ROOT, "content", "guides");
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => {
    const { meta, body } = frontMatter(fs.readFileSync(path.join(dir, f), "utf8"));
    for (const k of ["title", "description", "publish"]) if (!meta[k]) throw new Error(`${f}: missing ${k}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.publish)) throw new Error(`${f}: publish must be YYYY-MM-DD`);
    return { ...meta, slug: f.replace(/\.md$/, ""), body };
  }).sort((a, b) => (a.publish === b.publish ? a.slug.localeCompare(b.slug) : a.publish < b.publish ? 1 : -1));
}

function guideCards(list, fromPath) {
  const depth = fromPath.split("/").filter(Boolean).length;
  return `<ul class="cards">${list.map((g) => `<li><a href="${rel(`guides/${g.slug}/`, depth)}"><b>${esc(g.title)}</b><span>${esc(g.description)}</span></a></li>`).join("")}</ul>`;
}

for (const g of published) {
  const urlPath = `/guides/${g.slug}/`;
  const others = published.filter((x) => x.slug !== g.slug).slice(0, 4);
  const html = markdown(g.body).replace(/\{\{root\}\}/g, "../../");
  const body = `<article class="prose">
<p class="crumbs"><a href="../../">${NAME}</a> › <a href="../">Guides</a></p>
<h1>${esc(g.title)}</h1>
<p class="meta">Published ${g.publish}${g.updated ? ` · updated ${g.updated}` : ""}</p>
${html}
<aside class="slot"><b>Try it on your own clip.</b> <a href="../../${g.tool || ""}">${esc(g.cta || "Open the free editor")}</a>. It runs in your browser, and your video never leaves your device.</aside>
</article>
${others.length ? `<section class="band"><h2>More guides</h2>${guideCards(others, urlPath)}</section>` : ""}`;
  const jsonld = [
    { "@context": "https://schema.org", "@type": "Article", headline: g.title, description: g.description, datePublished: g.publish, dateModified: g.updated || g.publish, mainEntityOfPage: BASE + urlPath, image: `${BASE}/og.png`, author: { "@type": "Organization", name: NAME, url: BASE + "/" }, publisher: { "@type": "Organization", name: NAME, url: BASE + "/" } },
    crumbs([[NAME, "/"], ["Guides", "/guides/"], [g.title, urlPath]]),
  ];
  const faq = faqLd(html); if (faq) jsonld.push(faq);
  write(urlPath, layout({ urlPath, title: `${g.title} · ${NAME}`, description: g.description, body, jsonld, ogType: "article", current: "guides/" }), { priority: 0.6, lastmod: g.updated || g.publish, title: g.title });
}

write("/guides/", layout({
  urlPath: "/guides/", title: `Guides: cutting pauses, captions and vertical video · ${NAME}`,
  description: "Practical guides for editing talking videos: removing silences and filler words, captions that people read, vertical exports for Shorts, Reels and TikTok, and caption files.",
  body: `<section class="prose"><p class="crumbs"><a href="../">${NAME}</a> › Guides</p><h1>Guides</h1><p class="lede">How to cut dead air without making it obvious, caption so people keep watching, and export for every platform.</p></section>${guideCards(published, "/guides/")}`,
  jsonld: [crumbs([[NAME, "/"], ["Guides", "/guides/"]])], current: "guides/",
}), { priority: 0.5 });

// ---------- 404, sitemap, robots, feed, IndexNow, build.json ----------
write("404.html", layout({
  urlPath: "/404/", title: `Page not found · ${NAME}`, description: "This page doesn't exist.", noindex: true,
  body: `<section class="prose"><h1>That page isn't here.</h1><p><a href="${BASE}/">Open the editor</a> or read the <a href="${BASE}/guides/">guides</a>.</p></section>`,
}).replace(/(href|src)="(?:\.\.\/)+/g, `$1="${BASE}/`).replace(/(href|src)="\.\/(?!\/)/g, `$1="${BASE}/`));

const urls = pages.map((p) => BASE + p.path);
fs.writeFileSync(path.join(OUT, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((p) => `  <url><loc>${BASE}${p.path}</loc><lastmod>${p.lastmod}</lastmod><priority>${p.priority.toFixed(1)}</priority></url>`).join("\n")}
</urlset>
`);
fs.writeFileSync(path.join(OUT, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${BASE}/sitemap.xml\n`);
fs.writeFileSync(path.join(OUT, `${KEY}.txt`), KEY);
fs.writeFileSync(path.join(OUT, "feed.xml"), `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${NAME} guides</title>
  <link href="${BASE}/guides/"/>
  <link rel="self" href="${BASE}/feed.xml"/>
  <id>${BASE}/guides/</id>
  <updated>${(published[0]?.updated || published[0]?.publish || TODAY)}T00:00:00Z</updated>
${published.map((g) => `  <entry><title>${esc(g.title)}</title><link href="${BASE}/guides/${g.slug}/"/><id>${BASE}/guides/${g.slug}/</id><updated>${g.updated || g.publish}T00:00:00Z</updated><summary>${esc(g.description)}</summary></entry>`).join("\n")}
</feed>
`);
let commit = process.env.GITHUB_SHA || "";
try { commit ||= execSync("git rev-parse HEAD", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { /* not a git checkout */ }
fs.writeFileSync(path.join(OUT, "build.json"), JSON.stringify({ built: new Date().toISOString(), date: TODAY, commit, guides: published.length, scheduled: guideList.length - published.length, base: BASE }, null, 1) + "\n");
fs.writeFileSync(path.resolve(ROOT, process.env.URLS_OUT || "dist-urls.txt"), urls.join("\n") + "\n");
console.log(`built ${pages.length} pages into ${path.relative(ROOT, OUT)} for ${BASE} (${published.length} guides live, ${guideList.length - published.length} scheduled)`);
