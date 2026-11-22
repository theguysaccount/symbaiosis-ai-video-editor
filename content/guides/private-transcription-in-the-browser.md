---
title: Transcribe video privately with speech recognition in your browser
description: How on-device speech recognition works, what it costs in download size and speed, and when it beats cloud transcription.
publish: 2026-12-28
tool: auto-caption-video/
cta: Transcribe a video on your device
---
Most transcription services upload your audio to a server, transcribe it there and send text back. That's fast and accurate, but your recording sits on someone else's computer. For interviews, client work, unreleased content or anything personal, that's a real cost. Browsers can now run good speech models locally instead.

## How it works

Symbaiosis uses Whisper, an open speech-recognition model released by OpenAI. A compact, 8-bit version of it runs inside the page with WebAssembly, in a background worker so the page stays responsive. The model is downloaded once (43 MB for English, 80 MB for 18 other languages), kept in your browser's cache, and then works offline.

## What you trade

- **Download, once.** The model has to reach your browser before the first transcription. After that it loads from the cache in seconds.
- **Speed depends on your device.** On a recent laptop, the English model transcribes faster than real time. Phones are slower; a minute of speech can take a minute or more.
- **Accuracy is good, not perfect.** Small models make more mistakes than the largest cloud models, especially with names, jargon, strong accents and noisy audio. A quick read-through fixes them.

## When local transcription is the right call

- The recording is confidential: interviews, legal or medical conversations, internal meetings.
- You're on a slow or metered connection: uploading a large video takes longer than transcribing it locally.
- You need captions, not a verbatim legal transcript.

## When a cloud service is better

- You need speaker labels for a multi-person recording.
- The audio is very poor and accuracy matters more than privacy.
- You're transcribing hours of material at once.

## Checking that nothing is uploaded

Open your browser's developer tools, go to the Network tab and run a transcription: you'll see the page's own files and the model files load, and nothing sent out. The page's Content Security Policy also forbids it from connecting to any other site.
