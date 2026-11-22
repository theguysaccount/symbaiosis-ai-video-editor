---
title: Why captions drift out of sync after editing, and how to avoid it
description: The common causes of captions that run early or late after cutting a video, and a workflow that keeps them locked to the words.
publish: 2027-01-04
tool: auto-caption-video/
cta: Caption after cutting, in one step
---
Captions that run half a second early are worse than no captions: viewers read a word before they hear it and the mismatch is distracting. Most sync problems come from the order in which things were done.

## Cause 1: captions made before the cut

If you transcribe the original recording and then cut pauses, every caption after the first cut is early by the length of everything removed before it. By the end of a minute-long clip with ten cuts, captions can be several seconds ahead.

**Fix:** generate captions after cutting, from the edited timeline. Symbaiosis does both in one pass: it transcribes the original, works out the cuts, then shifts every word to its time in the edited video. The burned-in captions and the SRT/VTT files both use the edited timing.

## Cause 2: frame-rate mismatches

A caption file timed for a 29.97 fps video and played against a 30 fps export drifts by about a tenth of a percent, roughly 0.1 seconds per 100 seconds. Timings in seconds, as SRT and VTT use, avoid this as long as the video's duration doesn't change after the captions are made.

## Cause 3: word timings that ignore pauses

Speech models time words from their attention patterns. Inside a sentence that's accurate; around pauses it drifts, so a word after a pause appears to start during the silence. Captions based on raw model timings show up early after every pause. Symbaiosis lines each word up with the actual sound, so a word after a pause starts when the voice does.

## Cause 4: editing the video again afterwards

If you trim the exported video in another editor, its caption files no longer match. Make all cuts first, then export captions last, or burn the captions in, which keeps them in sync with whatever you do to the picture afterwards.

## A workflow that stays in sync

1. Cut pauses, fillers and flubbed takes.
2. Fix any misheard words.
3. Export the video with captions burned in, plus the SRT/VTT files.
4. If you trim again later, re-export the captions from the new edit.
