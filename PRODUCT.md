# PRODUCT

**User.** Short-form creators, vloggers, educators and small teams who record themselves talking and publish to TikTok, Reels, Shorts and YouTube.

**Painful job.** Turning a raw talking recording into a postable clip: cutting dead air and "um"s by hand, captioning word by word, and reframing wide footage to vertical. Today that means CapCut, Descript or Premiere, an account, an upload, and often a watermark or a paywall on export.

**Promise.** Drop a video; get it back tightened, captioned and vertical in a couple of minutes. Free, no account, no watermark, and the video never leaves your device.

**Wedge.** Privacy and zero friction. No other free editor in this category does the whole job on the device: nothing to upload means nothing to wait for, nothing to leak, and nothing for us to pay for, so it can stay free with no limits.

**Why now.** WebCodecs (fast hardware video encoding in every major browser, including Safari 26 audio), Whisper-class speech models small enough to run in WebAssembly, and Mediabunny (a complete media toolkit in the browser) all matured in 2024 to 2026.

**Activation metric.** `export_done`: a visitor exported an edited video. Counted with the cookieless counter once its key is set (OPERATIONS.md key 2); also `analysis_done`, `sample_start`, `file_added`. Funnel: page view → file added or sample → analysis done → export done.

**First revenue event.** A creator pays for something the browser can't do for free: generative effects on a GPU (the "flaming basketball" from the notes), long or batch exports, or auto-reframing. That product lives on other hosting with Stripe; the free site links to it from one slot (`PRO_URL`). Optional sponsor link (`SUPPORT_URL`).

**v1 deliberately won't do.** Upload or store anything; accounts; a multi-clip timeline, transitions, music or stock footage; the generative object effect; speaker labels; anything that needs a server. Pages is non-commercial, so no checkout here.
