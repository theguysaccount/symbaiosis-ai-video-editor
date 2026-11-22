// Unit tests for the editing logic: audio analysis, word alignment, the edit plan, captions and
// caption files. Pure functions, so they run in Node with no browser.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Resampler, concat, loudness, levels, findIslands, findSilences, speechChunks, quietestNear, RATE, HOP_S } from "../site/assets/js/analysis.js";
import { alignWords } from "../site/assets/js/align.js";
import { piecesToWords, lastMarker } from "../site/assets/js/asr-decode.js";
import { PACING, planEdit, isFiller, segmentAt, toOutput, toSource, keptWords, captionCues, cueAt, subtitleCues, toSrt, toVtt, transcriptText } from "../site/assets/js/edit.js";

const tone = (rate, secs, hz, amp) => Float32Array.from({ length: Math.round(rate * secs) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));
const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
const crossings = (a) => { let n = 0; for (let i = 1; i < a.length; i++) if ((a[i - 1] < 0) !== (a[i] < 0)) n++; return n; };

test("resampler: 48 kHz and 44.1 kHz to 16 kHz keep length, pitch and level", () => {
  for (const rate of [48000, 44100]) {
    const x = tone(rate, 1, 1000, 0.5);
    const r = new Resampler(rate);
    const y = concat([r.push([x]), r.flush()]);
    assert.ok(Math.abs(y.length - RATE) <= 3, `${rate}: length ${y.length}`);
    const mid = y.subarray(400, y.length - 400);
    assert.ok(Math.abs(crossings(mid) / (mid.length / RATE) - 2000) < 20, `${rate}: pitch`);
    assert.ok(Math.abs(rms(mid) / (0.5 / Math.SQRT2) - 1) < 0.03, `${rate}: level ${rms(mid)}`);
  }
});

test("resampler: streaming in odd-sized blocks equals one block, stereo is mixed to mono", () => {
  const L = tone(48000, 0.5, 440, 0.4), R = tone(48000, 0.5, 440, 0.2);
  const one = new Resampler(48000);
  const a = concat([one.push([L, R]), one.flush()]);
  const many = new Resampler(48000);
  const parts = [];
  for (let i = 0, k = 0; i < L.length; k++) { const n = [997, 31, 4096, 1][k % 4]; parts.push(many.push([L.subarray(i, i + n), R.subarray(i, i + n)])); i += n; }
  parts.push(many.flush());
  const b = concat(parts);
  assert.equal(a.length, b.length);
  let worst = 0; for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  assert.ok(worst < 1e-4, `max difference ${worst}`);
  assert.ok(Math.abs(rms(a.subarray(500, a.length - 500)) / (0.3 / Math.SQRT2) - 1) < 0.03);
});

test("loudness and levels: finds the noise floor and a threshold between noise and speech", () => {
  // 1 s of quiet noise, 1 s of loud tone, 1 s of quiet noise, at 16 kHz.
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296 - 0.5);
  const pcm = new Float32Array(RATE * 3);
  for (let i = 0; i < pcm.length; i++) pcm[i] = rnd() * 0.003 + (i >= RATE && i < 2 * RATE ? 0.4 * Math.sin((2 * Math.PI * 300 * i) / RATE) : 0);
  const db = loudness(pcm);
  assert.equal(db.length, Math.ceil(pcm.length / 160));
  const lv = levels(db);
  assert.ok(lv.noiseDb < -50 && lv.noiseDb > -70, `noise ${lv.noiseDb}`);
  assert.ok(lv.thresholdDb > lv.noiseDb && lv.thresholdDb < lv.speechDb - 10, JSON.stringify(lv));
  assert.ok(lv.confident);
  const islands = findIslands(db, lv.thresholdDb);
  assert.equal(islands.length, 1);
  assert.ok(Math.abs(islands[0].start - 1) < 0.03 && Math.abs(islands[0].end - 2) < 0.03, JSON.stringify(islands));
  const sil = findSilences(db, lv.thresholdDb, { minLength: 0.5 });
  assert.equal(sil.length, 2);
  assert.ok(Math.abs(quietestNear(db, 1.5, 0.05) - 1.5) <= 0.06);
});

test("levels: digital silence alone doesn't hide the room tone", () => {
  const db = Float32Array.from({ length: 1000 }, (_, i) => (i < 200 ? -100 : i < 500 ? -62 + (i % 3) : i < 800 ? -20 : -61));
  const lv = levels(db);
  assert.ok(lv.noiseDb >= -64 && lv.noiseDb <= -58, JSON.stringify(lv));
});

test("speech chunks: no piece is longer than the model's window, none overlap, all sound is covered", () => {
  const islands = [];
  for (let t = 0.5; t < 95; t += 2.3) islands.push({ start: t, end: t + 1.6 });
  islands.push({ start: 100, end: 160 });               // one stretch of sound longer than a window
  const db = new Float32Array(Math.ceil(170 / HOP_S)).fill(-20);
  const chunks = speechChunks(islands, 170, db);
  for (const c of chunks) assert.ok(c.end - c.start <= 28.01, `chunk ${c.start}-${c.end}`);
  for (let i = 1; i < chunks.length; i++) assert.ok(chunks[i].start >= chunks[i - 1].end - 1e-9, "overlap");
  for (const is of islands) {
    let covered = 0;
    for (const c of chunks) covered += Math.max(0, Math.min(c.end, is.end) - Math.max(c.start, is.start));
    assert.ok(covered >= is.end - is.start - 1e-6, `island ${is.start} not covered`);
  }
});

test("asr pieces: tokens join into words, punctuation sticks, spaceless languages split per piece", () => {
  const p = [
    { kind: "text", text: " Hey", start: 0.1, end: 0.3 }, { kind: "text", text: ",", start: 0.3, end: 0.31 },
    { kind: "text", text: " wel", start: 0.4, end: 0.5 }, { kind: "text", text: "come", start: 0.5, end: 0.7 },
    { kind: "time", time: 0.8 }, { kind: "text", text: " back", start: 0.9, end: 1.2 }, { kind: "text", text: ".", start: 1.2, end: 1.21 },
  ];
  const w = piecesToWords(p, { duration: 2 });
  assert.deepEqual(w.map((x) => x.text), ["Hey,", "welcome", "back."]);
  assert.equal(w[1].start, 0.4); assert.equal(w[1].end, 0.7);
  assert.equal(lastMarker(p), 0.8);
  const zh = piecesToWords([{ kind: "text", text: "你", start: 0, end: 0.2 }, { kind: "text", text: "好", start: 0.2, end: 0.4 }], { spaceless: true });
  assert.equal(zh.length, 2);
});

test("align: words drifted into silence are pulled onto the sound; wordless sounds are reported", () => {
  const islands = [{ start: 1, end: 2 }, { start: 3, end: 3.4 }, { start: 5, end: 6 }];
  const words = [
    { text: "hello", start: 0.6, end: 1.5 },     // starts in the silence before the island
    { text: "there", start: 1.5, end: 2.4 },     // ends in the silence after it
    { text: "world", start: 4.6, end: 5.9 },
  ];
  const { words: out, sounds } = alignWords(words, islands);
  assert.equal(out[0].start, 1);
  assert.equal(out[1].end, 2);
  assert.equal(out[2].start, 5);
  assert.deepEqual(sounds.map((s) => s.index), [1]);
  const far = alignWords([{ text: "ghost", start: 9, end: 9.5 }], islands).words;
  assert.ok(far[0].loose);
});

test("fillers: hesitation sounds only, in several languages", () => {
  for (const w of ["um", "Um,", "uh.", "ummm", "Uhm", "er", "erm", "hmm", "Ah,"]) assert.ok(isFiller(w), w);
  for (const w of ["umbrella", "her", "a", "uh-oh", "so", "like", "the", "hum"]) assert.ok(!isFiller(w), w);
  assert.ok(isFiller("Äh", "de") && isFiller("euh", "fr") && !isFiller("este", "es"));
});

// A small spoken timeline: word, start, end.
const W = (list) => list.map(([text, start, end]) => ({ text, start, end }));
const speech = W([["So", 0.5, 0.8], ["um", 1.6, 2.0], ["this", 2.9, 3.1], ["is", 3.1, 3.25], ["it.", 3.25, 3.6], ["Okay", 4.0, 4.4]]);
const islandsOf = (words) => words.map((w) => ({ start: w.start, end: w.end }));

test("plan: long pauses shrink to 2 x pad, fillers go with their pause, short pauses stay", () => {
  const p = planEdit({ duration: 5, words: speech, pacing: PACING.natural });
  assert.ok(p.removedWords.has(1), "um is cut");
  // Kept: So | this is it. | Okay. Gaps: lead 0.5, So->this 2.1 (held "um"), it.->Okay 0.4 (< 0.5, kept), tail 0.6.
  const kept = (0.8 - 0.5) + (3.6 - 2.9) + (4.4 - 4.0);
  const want = kept + 0.1 /* lead pad */ + 0.2 + 0.4 + 0.1 /* tail pad */;
  assert.ok(Math.abs(p.outDuration - want) < 0.02, `${p.outDuration} vs ${want}`);
  for (const w of keptWords(speech, p)) assert.ok(segmentAt(p.segments, (speech[w.i].start + speech[w.i].end) / 2) >= 0);
  // Output time and source time are inverse inside kept parts.
  for (const s of p.segments) for (const t of [s.start, (s.start + s.end) / 2]) assert.ok(Math.abs(toSource(p.segments, toOutput(p.segments, t)) - t) < 1e-9);
  let sum = 0; for (const s of p.segments) { assert.ok(Math.abs(s.outStart - sum) < 1e-9); sum += s.end - s.start; }
  assert.ok(Math.abs(sum - p.outDuration) < 1e-9);
});

test("plan: overrides keep a filler, cut a word, keep a pause; 'keep all' only cuts what's asked", () => {
  const keepUm = planEdit({ duration: 5, words: speech, pacing: PACING.natural, overrides: { words: { 1: "keep" } } });
  assert.ok(!keepUm.removedWords.has(1));
  const cutOkay = planEdit({ duration: 5, words: speech, pacing: PACING.natural, overrides: { words: { 5: "cut" } } });
  assert.ok(cutOkay.removedWords.has(5));
  assert.ok(cutOkay.outDuration < planEdit({ duration: 5, words: speech, pacing: PACING.natural }).outDuration);
  const base = planEdit({ duration: 5, words: speech, pacing: PACING.natural });
  const g = base.gaps.find((x) => x.cut && !/lead|trail/.test(x.key));
  const kept = planEdit({ duration: 5, words: speech, pacing: PACING.natural, overrides: { gaps: { [g.key]: "keep" } } });
  assert.ok(kept.outDuration > base.outDuration);
  const all = planEdit({ duration: 5, words: speech, pacing: { minSilence: Infinity, pad: Infinity } });
  assert.ok(Math.abs(all.outDuration - (5 - (2.0 - 1.6))) < 0.05, `keep all: ${all.outDuration}`);
  const none = planEdit({ duration: 5, words: [], sounds: [], pacing: PACING.natural });
  assert.equal(none.outDuration, 5);
});

test("plan: sounds with no words are kept unless asked, and protect their time", () => {
  const sounds = [{ start: 2.2, end: 2.5, id: 7 }];
  const p = planEdit({ duration: 5, words: speech, sounds, pacing: PACING.natural });
  assert.ok(!p.removedSounds.has(7));
  const cut = planEdit({ duration: 5, words: speech, sounds, pacing: PACING.natural, cutSounds: true });
  assert.ok(cut.removedSounds.has(7) && cut.outDuration < p.outDuration);
});

test("plan: the sample clip's own timeline gives the expected edit length", () => {
  const truth = JSON.parse(fs.readFileSync(new URL("../site/assets/samples/sample-truth.json", import.meta.url), "utf8"));
  // Spread each phrase's words evenly over the phrase, as a perfect recogniser would.
  const words = truth.phrases.flatMap((p) => {
    const parts = p.text.split(/\s+/);
    const d = (p.end - p.start) / parts.length;
    return parts.map((t, i) => ({ text: t, start: p.start + i * d, end: p.start + (i + 1) * d }));
  });
  const p = planEdit({ duration: truth.duration, words, pacing: PACING.natural });
  const kept = truth.phrases.filter((x) => !x.filler);
  let want = 0.2;                                     // lead and tail pads
  kept.forEach((x, i) => {
    want += x.end - x.start;
    const n = kept[i + 1];
    if (!n) return;
    const gap = n.start - x.end;
    const held = truth.phrases.some((q) => q.filler && q.start >= x.end && q.end <= n.start);
    want += gap >= 0.5 || held ? Math.min(gap, 0.2) : gap;
  });
  assert.ok(Math.abs(p.outDuration - want) < 0.05, `${p.outDuration} vs ${want}`);
  assert.equal(p.removedWords.size, truth.phrases.filter((x) => x.filler).length);
  void islandsOf;
});

test("captions: word limits, sentence breaks, no overlaps, and the active cue", () => {
  const words = W([["One", 0, 0.3], ["two", 0.3, 0.6], ["three", 0.6, 0.9], ["four.", 0.9, 1.2], ["Five", 1.3, 1.6], ["six", 3, 3.3]]);
  const cues = captionCues(words, { maxWords: 3, maxChars: 30 });
  assert.deepEqual(cues.map((c) => c.words.map((w) => w.text).join(" ")), ["One two three", "four.", "Five", "six"]);
  for (let i = 1; i < cues.length; i++) assert.ok(cues[i].start >= cues[i - 1].end - 1e-9, "overlap");
  assert.equal(cueAt(cues, 0.5).words[0].text, "One");
  assert.equal(cueAt(cues, 2.5), null);
  assert.equal(captionCues(words, { maxWords: 1 }).length, 6);
});

test("caption files: SRT and VTT timing formats", () => {
  const words = W([["Hello", 0, 0.5], ["world.", 0.5, 1.25], ["Again", 61.5, 62]]);
  const subs = subtitleCues(words);
  assert.equal(subs.length, 2);
  const srt = toSrt(subs), vtt = toVtt(subs);
  assert.match(srt, /^1\n00:00:00,000 --> 00:00:01,250\nHello world\.\n/);
  assert.match(srt, /\n2\n00:01:01,500 --> 00:01:02,500\nAgain\n/);
  assert.match(vtt, /^WEBVTT\n\n00:00:00\.000 --> 00:00:01\.250\n/);
  assert.equal(transcriptText(W([["Hi", 0, 1], [",", 1, 1], ["you", 1, 2]])), "Hi, you");
});
