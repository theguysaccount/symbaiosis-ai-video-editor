---
title: How to cut "um" and "uh" from a video without making it obvious
description: Why filler words are hard for software to catch, how to remove them cleanly, and which ones you should leave in.
publish: 2026-11-22
tool: remove-filler-words/
cta: Find the ums in your video
---
Filler words are normal in speech and mostly invisible in conversation, but on video they stand out, especially once captions spell them out. Removing them makes a speaker sound more confident. Removing them badly makes the video sound chopped.

## Why software misses them

Speech-recognition models learn from transcripts that people wrote, and people tidy fillers away when they transcribe. So models learn to skip "um" and "uh" too. Symbaiosis counters that by giving the model a short prompt full of hesitation sounds before it starts, which makes it write them down, and then double-checks the audio: any sound the model wrote no word for appears as a ♪ chip. Those are usually breaths, lip clicks or a swallowed "um".

## What to cut, and what to keep

Cut the pure hesitation sounds: **um, uh, er, erm, ah, hmm**. They carry no meaning, so removing them never changes what you said.

Be careful with discourse words: **like, so, you know, I mean, basically**. They're often fillers, but just as often they're doing a job ("it looks like rain", "so that's why"). Symbaiosis never cuts these automatically. Select the ones you want gone in the transcript and cut them yourself.

## Cutting cleanly

- **Take the pause with the filler.** "And... um... then" should become "and then", not "and... then". The editor removes the filler and the silence around it together, leaving one short natural gap.
- **Cut at the quietest moment.** When a filler runs straight into a word ("uh-so"), there's no silence to cut in. The editor places the cut at the lowest point of loudness between the two.
- **Fade the edges.** A few milliseconds of fade at each cut prevents clicks. It's automatic.
- **Watch the picture.** The cut is clean for the ear but the speaker's head may jump. Punch-in zoom on every other section hides that.

## Check the transcript before exporting

Fillers are underlined and crossed out. Read through once: if you hear a cut that changes your meaning, tap the crossed-out word to keep it. If one slipped through, tap it and press Cut. Undo reverses the last change.
