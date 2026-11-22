# LAUNCH

## What's live

- https://theguysaccount.github.io/symbaiosis-ai-video-editor/ (GitHub Pages, deployed by `.github/workflows/pages.yml`)
- Search: sitemap.xml (listed in the account's root robots.txt, rebuilt daily by the `theguysaccount.github.io` repo), IndexNow on every deploy, canonical URLs, JSON-LD (WebApplication, FAQPage, HowTo, Article, BreadcrumbList), Open Graph card.

## Moving to a custom domain (for the "domain rollout" session or Jack)

Nothing here changes DNS. The site's address is the repository variable `SITE_URL`; the exact records and commands are in OPERATIONS.md, key 1. In short: point the domain at GitHub Pages, set the Pages custom domain, set `SITE_URL=https://DOMAIN`, run "Deploy site".

## First 1,000 users: machine channels (running)

- **Search pages that match real queries:** "remove silence from video", "auto caption video free", "remove um and uh from video", "convert landscape video to vertical", each with the editor on the page, plus guides that answer the follow-up questions. One new guide a week until 4 January 2027.
- **IndexNow** on every deploy (Bing, Yandex, Seznam, Naver); Google through the sitemap in the account's root robots.txt.
- **GitHub discovery:** public repo with description and topics (video-editor, whisper, captions, webcodecs, remove-silence, transformers-js, in-browser, privacy).
- **Share loop in the product:** "Share this free tool" on the result screen; optional end card naming the tool; every exported caption file and video is something people post.

## Human channels: drafts only, nothing sent

These need a person and an account, so they're Jack's call. Drafted, not posted:

- **Show HN:** "Show HN: Symbaiosis – cut pauses and ums, caption and go vertical, all in the browser (no upload)". First comment: how it works (WebCodecs, Whisper tiny.en on one WebAssembly thread because GitHub Pages can't be cross-origin isolated, words aligned to measured sound), what it doesn't do, link to the source.
- **r/NewTubers, r/PartneredYoutube, r/videoediting (where self-promotion threads allow):** "I made a free editor that cuts dead air and ums from talking videos in your browser. No upload, no watermark. Looking for feedback on the pacing presets."
- **Product Hunt tagline:** "Your talking video, tightened and captioned, without uploading it."

## 14-day calendar (machine side)

| Day | What happens on its own |
|---|---|
| 0 | Launch deploy; IndexNow submission; root robots.txt rebuild lists the sitemap |
| 1 (Mon 23 Nov) | Scheduled deploy (Mon/Thu): rebuild, full self-test, IndexNow |
| 3 (Wed 25 Nov) | Live self-test #1 + staleness check |
| 8 (Mon 30 Nov) | Guide "SRT vs VTT" goes live with the Monday deploy |
| 15 (Mon 7 Dec) | Guide "Landscape to vertical" goes live |
| every Wed/Sat | Live self-test; library-update summary in the run |
