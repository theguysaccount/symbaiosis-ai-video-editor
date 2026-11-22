# STATE

- **Started from:** three short notes (Aug 2022 to Apr 2023: the names Humends, Humesh, Symbaiosis; "an editor with all the tools in one"; "fat trimming AI" for vlogs). No code, designs or users existed. The Apple Notes were reference only and weren't copied.
- **Works (v1, verified 2026-11-22):** in-browser silence and filler cutting, Whisper captions on the device, transcript editing, 9:16/4:5/1:1/original export as H.264 + AAC MP4, SRT/VTT files, sample clip, five landing pages, privacy and how-it-works pages, guides published weekly by date.
- **Tested:** 20 unit and build tests; headless-Chrome self-test of every page, the sample clip end to end (100% word recall, 4 of 4 fillers cut, edit length within 0.05 s of the script's prediction) and the phone upload path.
- **Schedules proven:** the first schedule-triggered runs passed on 2026-11-22 (Deploy site, which rebuilt the live site, and Live self-test).
- **Domain:** none yet. The domain rollout (2026-11-22) found no name in the portfolio that fits; OPERATIONS.md key 1 has the steps once one is chosen.
- **Not verified here:** Safari and Firefox (no way to drive them on this Mac), real phones, very long or 4K inputs.
- **Not built:** the generative object effect (needs paid GPU hosting; OPERATIONS.md key 3), auto-reframing to follow a face, multi-clip timelines.
- **Worth reusing elsewhere:** `edit.js` (cut plan and time mapping), `align.js` (Whisper words onto real sound), the single-threaded Transformers.js setup with no third-party requests, and `scripts/make-sample/` (synthetic test video with exact ground truth).
