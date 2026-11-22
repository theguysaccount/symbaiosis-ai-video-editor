# Symbaiosis: free AI video editor that runs in your browser

**Live:** https://theguysaccount.github.io/symbaiosis-ai-video-editor/

Drop in a talking video. Symbaiosis finds the pauses and the filler words ("um", "uh"), transcribes the speech with an AI model running on your own device, burns in word-by-word captions, and exports a vertical MP4 for TikTok, Reels and Shorts. You review every cut in the transcript before export. **Your video never leaves your device**: there is no server, and the page's Content Security Policy forbids it from sending data anywhere else.

- **Silence cutting:** loudness every 10 ms, noise floor learned from the recording, pauses shortened (not deleted) to tight, natural or relaxed pacing, cuts placed at the quietest moment with 6 ms fades.
- **Filler words:** Whisper (OpenAI) on WebAssembly, prompted to write down hesitations; words aligned to the real sound; tap any word to cut or keep it.
- **Captions:** bold pop, boxed or clean; 1, 3 or 6 words at a time; highlight colour; SRT and VTT files timed to the edit.
- **Export:** 9:16, 4:5, 1:1 or original shape; crop with a position slider or fit over blurred edges; optional punch-in zoom; H.264 + AAC MP4 through WebCodecs and Mediabunny.

## Run it locally

Requires Node 20+ and Google Chrome (for the tests).

```bash
npm ci                     # installs puppeteer-core for the browser tests
npm run build              # builds dist/ for http://127.0.0.1:4327/symbaiosis-ai-video-editor
npm run serve              # serves dist/ at that address
```

## Test

```bash
npm test                                   # unit and build tests (Node only)
npm run build && node scripts/selftest.mjs # headless Chrome: every page, the sample clip end to end, the phone upload path
node scripts/selftest.mjs --url https://theguysaccount.github.io/symbaiosis-ai-video-editor/   # the live site
```

The self-test's expectations come from the sample clip's own script (`site/assets/samples/sample-truth.json`) and the sitemap, so they hold as content changes.

## Deploy

Every push to `main` runs `.github/workflows/pages.yml`: tests, build, headless end-to-end test, deploy to GitHub Pages, a check that the new build is the one being served, and IndexNow. If any test fails, nothing is deployed. The site's address is one setting: the repository variable `SITE_URL` (empty means the GitHub Pages address). See [OPERATIONS.md](OPERATIONS.md) for every scheduled job and the keys a human can turn (custom domain, counts, money).

## Layout

| Path | What |
|---|---|
| `site/assets/js/` | the editor: `app.js` (interface), `media.js` (Mediabunny read/encode), `analysis.js` (resampling, loudness, silences), `asr-worker.js` + `asr-decode.js` (Whisper in a worker), `align.js` (words onto sound), `edit.js` (cut plan, time mapping, captions, SRT/VTT), `render.js` (framing and caption drawing) |
| `site/pages/`, `site/partials/tool.html` | landing pages (JSON front matter) and the editor markup |
| `content/guides/` | guides, published on their `publish:` date by the scheduled deploy |
| `site/assets/vendor/` | Mediabunny, its AAC encoder, Transformers.js, ONNX Runtime Web, Montserrat; see `NOTICE.md` |
| `site/assets/models/` | Whisper tiny.en and base (8-bit ONNX), pinned revisions; `manifest.json` has sizes and SHA-256 |
| `site/assets/samples/` | the sample clip (computer voice, cartoon speaker) and its script with exact timings |
| `scripts/` | build, serve, self-test, IndexNow, keep-alive, vendoring, model download, sample and demo makers |

## Licences

The editor's code is MIT. Vendored libraries and models keep their own licences (MPL-2.0, Apache-2.0, MIT, LGPL-2.1, OFL-1.1), listed in `site/assets/vendor/NOTICE.md` and `site/assets/models/manifest.json`.
