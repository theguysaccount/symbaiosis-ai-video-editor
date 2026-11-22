---
title: SRT vs VTT: which caption file to use where
description: The difference between SRT and WebVTT caption files, which platforms take which, and when to burn captions in instead.
publish: 2026-11-30
tool: auto-caption-video/
cta: Get SRT and VTT files for your video
---
Besides captions burned into the picture, Symbaiosis gives you two caption files with every export: an SRT and a VTT. They hold the same words and timings in slightly different formats.

## What's inside

An **SRT** (SubRip) file is a numbered list of captions:

```
1
00:00:01,200 --> 00:00:03,450
Hey, welcome back.
```

A **VTT** (WebVTT) file starts with the line `WEBVTT`, has no numbers, and uses a full stop before the milliseconds:

```
WEBVTT

00:00:01.200 --> 00:00:03.450
Hey, welcome back.
```

VTT can also carry styling and positioning, but plain VTT and SRT are interchangeable for most uses.

## Which to use

- **YouTube:** either. Upload it under Subtitles; viewers can turn captions on and off, and the text helps search.
- **Facebook and LinkedIn:** SRT.
- **Your own website:** VTT. The HTML `<track>` element only accepts WebVTT.
- **Video editors** (Premiere Pro, DaVinci Resolve, Final Cut via conversion): SRT is the most widely imported.
- **TikTok, Instagram Reels, YouTube Shorts:** burn captions in. Caption files aren't the reliable route for short-form posts, and burned-in captions show for everyone, including people who never switch captions on.

## Burned-in or separate?

Burned-in captions are part of the picture: always visible, styled exactly as you chose, but impossible to turn off or translate. Separate files can be switched on and off, are read by search engines and screen readers, and can be translated. For short-form social video, burn them in. For YouTube and websites, do both: a burned-in style that suits the video, plus a file for accessibility and search.

## Timing after edits

Caption files from Symbaiosis are timed to the **edited** video, after pauses and fillers are cut. Don't use them with the original recording: every caption after the first cut would be early.
