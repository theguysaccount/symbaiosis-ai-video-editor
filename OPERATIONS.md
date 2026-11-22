# OPERATIONS

Symbaiosis runs with no human and no server. Every recurring task is a GitHub Actions job in this repository. The site is a static GitHub Pages deployment at https://theguysaccount.github.io/symbaiosis-ai-video-editor/. Videos are processed in visitors' browsers, so traffic costs nothing and nothing can leak from a server.

**The site's address is one setting:** the repository variable `SITE_URL`. Empty means the GitHub Pages address above. Every job (build, canonical URLs, sitemap, IndexNow, live checks, staleness check) reads it.

## Automated jobs

| Job | File | When (UTC) | What it does | How it fails safe |
|---|---|---|---|---|
| Deploy site | `.github/workflows/pages.yml` | every push to `main`; Mondays 06:23 and Thursdays 06:41; by hand | `npm test` (20 unit and build tests), build `dist/` as of today's date, headless-Chrome self-test of the build (every page, the sample clip end to end, the phone upload path), deploy to Pages (a second attempt if the first stalls), wait until the live `build.json` shows this commit, check every live page, IndexNow | Any failed step before `deploy` stops the run and the last good deployment stays live. Re-running is always safe: it rebuilds `main`. |
| Weekly guide release | the scheduled runs of `pages.yml` | Mondays and Thursdays | Guides whose `publish:` date has passed go live, with a fresh sitemap and feed. A skipped run is caught up by the next one, because publication is by date, not by run. | Same as Deploy. |
| IndexNow | last step of `pages.yml` | after every deploy | Submits every page URL with the key file at `/<key>.txt` | `\|\| true`: a refused submission is logged, never fails the run; the next deploy submits again. |
| Live self-test | `.github/workflows/selftest.yml` | Wednesdays 07:47 and Saturdays 08:53; by hand | Staleness check first: if the live `build.json` is over 8 days old (scheduled deploys didn't run), it starts "Deploy site". Then the full self-test against the live site; a summary of library updates waiting. | Read-only. On failure it opens (or comments on) an issue labelled `self-test` and GitHub emails the account owner; the next pass closes it. |
| Keep-alive | `keepalive` job in both scheduled workflows (`scripts/keepalive.sh`) | with each scheduled run | Re-enables every workflow (skips any disabled by hand) and, after 45 days with no commit, pushes an empty commit, so GitHub's 60-day rule never switches the schedules off | Each step tolerates failure. Pushes made with the workflow token trigger no workflow. |
| Pull-request tests | `.github/workflows/test.yml` | pull requests | The same tests as Deploy, without deploying | n/a |

GitHub fires schedules on this account hours late and sometimes not at all. No job depends on its time: deploys publish by date, the self-test runs twice a week, and the staleness check repairs a missed deploy.

Everything the site needs is in the repository: libraries in `site/assets/vendor/`, speech models in `site/assets/models/`, the sample in `site/assets/samples/`. No build or visitor depends on a CDN or on Hugging Face. CI installs only `puppeteer-core` from npm.

## What to watch

1. **Issues labelled `self-test`.** An open one means the live site failed a check; the issue lists the failed checks and links the run.
2. **Failed-run emails** from GitHub to the account owner.
3. **The Actions tab:** the Monday and Thursday deploys should be green. If one is red, the site is still live on the previous build.
4. **The library-update summary** in each self-test run (Mediabunny, Transformers.js, ONNX Runtime).
5. **Counts**, once switched on (key 2). Activation is `event/export_done`. Watch `export_done ÷ (file_added + sample_start)`.

## When the live self-test fails

- **"analysis finished" failed:** the speech model didn't load or run. Open the report artifact for the console errors. Likely causes: a Chrome change to WebAssembly or workers, or a model file that didn't deploy (`node scripts/fetch-models.mjs --check` locally).
- **"export finished" or the export size/length checks failed:** a WebCodecs or Mediabunny regression in Chrome. Try `node scripts/selftest.mjs --only sample --url <site>` locally with the newest Chrome; if it fails there too, update Mediabunny (below).
- **"no off-site requests" failed:** something on the page reached another origin. That breaks the privacy promise: find the URL in the report and remove it.
- **"live build is fresh" failed:** deploys haven't run for over 16 days. Check the Actions tab; the staleness check should already have started one.
- **Page checks with HTTP errors:** GitHub Pages may be down (githubstatus.com) or the Pages source changed. Re-run "Deploy site".

## Updating the libraries and models

1. Change a version under `"vendor"` in `package.json`, then `node scripts/vendor.mjs` (installs exactly those versions without saving or running install scripts, copies the browser files, rewrites `NOTICE.md`).
2. Models: change a `revision` in `scripts/fetch-models.mjs`, delete that model's folder in `site/assets/models/`, run `node scripts/fetch-models.mjs`.
3. `npm test && npm run build && node scripts/selftest.mjs`, then commit. The deploy re-runs every check before going live.

## Keys Jack can turn later

None of these is needed for the site to work.

### 1. Custom domain (the "domain rollout" session handles this)

Nothing in this repo changes DNS. Jack's 2026-08-30 portfolio had no domain matching this idea, so a name has to be chosen. Steps for a domain `DOMAIN`:
1. DNS at the registrar. Apex: four A records `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`, and optionally AAAA `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`; `www` CNAME `theguysaccount.github.io.`. Subdomain instead: one CNAME to `theguysaccount.github.io.`.
2. `~/.local/bin/gh api -X PUT repos/theguysaccount/symbaiosis-ai-video-editor/pages -f cname=DOMAIN`; when the certificate is issued, `~/.local/bin/gh api -X PUT repos/theguysaccount/symbaiosis-ai-video-editor/pages -F https_enforced=true`.
3. `~/.local/bin/gh variable set SITE_URL -R theguysaccount/symbaiosis-ai-video-editor -b https://DOMAIN`
4. `~/.local/bin/gh workflow run pages.yml -R theguysaccount/symbaiosis-ai-video-editor`. Everything follows `SITE_URL`; GitHub redirects the github.io URLs. Then verify the domain in Google Search Console (DNS TXT) and submit `https://DOMAIN/sitemap.xml`.

### 2. Counts (privacy-friendly analytics)

1. Create a free GoatCounter account (needs a person), for example the code `symbaiosis`. Leave "collect IP addresses" off.
2. `~/.local/bin/gh variable set GOATCOUNTER_URL -R theguysaccount/symbaiosis-ai-video-editor -b https://symbaiosis.goatcounter.com/count`, then run "Deploy site".
3. The build adds that one origin to the CSP and updates the privacy page. Events: `file_added`, `sample_start`, `analysis_done`, `export_done`. Never the video, its name or its words; skipped under Do Not Track and Global Privacy Control.

### 3. Money: the paid tier slot

Pages is non-commercial, so the free editor stays free here. The paid product lives elsewhere:
1. Build "Symbaiosis Pro" on other hosting (Vercel, Cloudflare, Fly) with GPU inference for the generative object effect from the original idea (select an object, apply an effect such as fire, export vertical), plus long-video and batch export. Charge per clip or monthly with Stripe (Jack's account; test mode until he approves live keys).
2. `~/.local/bin/gh variable set PRO_URL -R theguysaccount/symbaiosis-ai-video-editor -b https://<pro url>`, then run "Deploy site". A box appears under the editor: "Need longer videos, batch exports or AI effects? See Symbaiosis Pro."
3. Optional: `SUPPORT_URL` (GitHub Sponsors, Ko-fi) adds "Support this free tool" to the footer.

### 4. New guides without a human

Actions has no AI key, so ten guides were written up front: four live at launch, then one each Monday until 4 January 2027. To keep going, a scheduled Claude routine, monthly, with this repo checked out:
- Read `content/guides/` and, if available, Search Console queries for the site.
- Write two new guides that answer real questions about cutting, captioning or reframing talking videos. No thin or duplicate pages; check every fact; no claims about platform rules that can't be cited.
- Give them `publish:` dates on the next two Mondays, run `npm test`, commit and push. The scheduled deploy publishes them.

### 5. Faster transcription (optional)

Multi-threaded WebAssembly needs the headers `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, which GitHub Pages can't send. Hosting the same `dist/` on Cloudflare Pages with a `_headers` file would enable them; the worker already uses up to four threads when `crossOriginIsolated` is true. Needs a Cloudflare account (a person).

## Local commands

```bash
npm ci && npm test                                                        # unit and build tests
npm run build && node scripts/selftest.mjs                                # build + headless end-to-end
node scripts/selftest.mjs --url https://theguysaccount.github.io/symbaiosis-ai-video-editor/   # live check
node scripts/fetch-models.mjs --check                                     # models match the manifest
npm install --no-save kokoro-js@1.2.1 && node scripts/make-sample/voice.mjs out && node scripts/make-sample/render.mjs out site/assets/samples/sample.mp4   # rebuild the sample
node scripts/selftest.mjs --only sample --save out/edit.mp4 && node scripts/make-demo.mjs out/edit.mp4                                                    # rebuild the demo media
```
