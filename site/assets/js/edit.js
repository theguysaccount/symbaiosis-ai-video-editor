// The edit: which parts of the recording stay, how source time maps to output time, and the
// caption cues. Pure functions on plain data, so the same code runs in the page and in the tests.
//
// Vocabulary
//   atom      a word (from the speech model) or a "sound" (audio the model wrote no word for)
//   removed   an atom that will be cut: a filler word, a word the editor cut, or a sound
//   segment   a stretch of the source that is kept, {start, end, outStart}, in seconds

import { quietestNear } from "./analysis.js";

export const PACING = {
  tight: { minSilence: 0.35, pad: 0.06, label: "Tight" },
  natural: { minSilence: 0.5, pad: 0.1, label: "Natural" },
  relaxed: { minSilence: 0.8, pad: 0.18, label: "Relaxed" },
};

// Hesitation sounds, by language. Only sounds that are never a real word in that language:
// "like", "so" and "you know" carry meaning too often to cut automatically. Matched on the
// whole word, case-insensitive, with punctuation removed and repeated letters allowed ("ummm").
const FILLER_PATTERNS = {
  en: /^(u+m+|u+h+|u+h+m+|e+r+m*|a+h+|e+h+|h+m+|m+h?m+|u+h?m+)$/,
  de: /^(ä+h+m*|ö+h+m*|h+m+|e+h?m+)$/,
  fr: /^(e+u+h+|h+e+u+|h+u+m+|h+m+)$/,
  es: /^(e+h+|e+m+|m+h?m+|e+h?m+)$/,
  it: /^(e+h+m*|m+h?m+|u+h?m+)$/,
  nl: /^(e+h+m*|u+h+m*|h+m+)$/,
  pt: /^(h+u+m+|a+h+n+|h+m+)$/,
};
const GENERIC_FILLER = /^(u+m+|u+h+|e+r+m+|h+m+|m+h?m+)$/;

/** Strip everything but letters and digits, lowercase. */
export const bare = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

export function isFiller(text, language = "en") {
  const b = bare(text);
  if (!b) return false;
  return (FILLER_PATTERNS[language] || GENERIC_FILLER).test(b);
}

/**
 * Decide what stays.
 * @param {object} p
 * @param {number} p.duration                       length of the source in seconds
 * @param {Array<{text:string,start:number,end:number}>} p.words   aligned words, in order
 * @param {Array<{start:number,end:number}>} p.sounds              audible stretches with no word
 * @param {{minSilence:number,pad:number}} p.pacing
 * @param {boolean} [p.cutFillers=true]
 * @param {boolean} [p.cutSounds=false]
 * @param {string} [p.language="en"]
 * @param {{words?:Record<number,"cut"|"keep">, sounds?:Record<number,"cut"|"keep">, gaps?:Record<string,"keep">}} [p.overrides]
 * @param {Float32Array|null} [p.db]                loudness every 10 ms, to put cuts in the quietest spot
 * @returns {{segments:Array<{start:number,end:number,outStart:number}>, cuts:Array<{start:number,end:number}>, outDuration:number, removedWords:Set<number>, removedSounds:Set<number>, gaps:Array<{key:string,start:number,end:number,cut:boolean,kept:boolean}>}}
 */
export function planEdit({ duration, words = [], sounds = [], pacing = PACING.natural, cutFillers = true, cutSounds = false, language = "en", overrides = {}, db = null }) {
  const ow = overrides.words || {}, os = overrides.sounds || {}, og = overrides.gaps || {};
  const removedWords = new Set(), removedSounds = new Set();
  const atoms = [];
  words.forEach((w, i) => {
    // A "loose" word sits where nothing is audible (the model guessed it into a silence): it
    // neither holds time nor gets cut.
    if (w.loose) return;
    const removed = ow[i] ? ow[i] === "cut" : cutFillers && isFiller(w.text, language);
    if (removed) removedWords.add(i);
    atoms.push({ kind: "word", i, start: w.start, end: w.end, removed });
  });
  sounds.forEach((s, n) => {
    const i = s.id ?? n;                            // a stable id survives re-transcription
    const removed = os[i] ? os[i] === "cut" : cutSounds;
    if (removed) removedSounds.add(i);
    atoms.push({ kind: "sound", i, start: s.start, end: s.end, removed });
  });
  atoms.sort((a, b) => a.start - b.start || a.end - b.end);
  const kept = atoms.filter((a) => !a.removed);
  const pad = pacing.pad, minSilence = pacing.minSilence;
  const snap = (t, lo, hi) => Math.min(hi, Math.max(lo, db ? quietestNear(db, t, 0.04) : t));
  const cuts = [], gaps = [];

  if (!atoms.length) {
    // Nothing audible was found (no speech, or no sound track): keep everything.
    return finish(duration, [], new Set(), new Set(), []);
  }

  // 1. Removed atoms are cut whole, but never into a kept neighbour.
  for (let a = 0; a < atoms.length; a++) {
    const r = atoms[a];
    if (!r.removed) continue;
    let lo = 0, hi = duration;
    for (let b = a - 1; b >= 0; b--) if (!atoms[b].removed) { lo = atoms[b].end; break; }
    for (let b = a + 1; b < atoms.length; b++) if (!atoms[b].removed) { hi = atoms[b].start; break; }
    const s = snap(r.start, lo, r.end), e = snap(r.end, r.start, hi);
    if (e > s) cuts.push({ start: s, end: e });
  }

  // 2. Pauses: before the first kept atom, between kept atoms, after the last one.
  //    A pause longer than minSilence, or one that held a removed atom, shrinks to 2 x pad
  //    (pad after the word before it, pad before the word after it). Keeping a pause never
  //    reaches into a removed atom.
  const removedBetween = (s, e) => atoms.filter((x) => x.removed && x.end > s && x.start < e);
  const bounds = [{ end: 0, lead: true }, ...kept, { start: duration, trail: true }];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const a = bounds[k], b = bounds[k + 1];
    const s = a.lead ? 0 : a.end, e = b.trail ? duration : b.start;
    const len = e - s;
    if (len <= 0.001) continue;
    const inside = removedBetween(s, e);
    const key = a.lead ? "lead" : b.trail ? "trail" : `${a.kind[0]}${a.i}-${b.kind[0]}${b.i}`;
    const userKeep = og[key] === "keep";
    let keepAfter = a.lead ? 0 : pad, keepBefore = b.trail ? 0 : pad;
    const long = a.lead || b.trail ? len > pad + 0.05 : len >= minSilence;
    const shrink = !userKeep && (long || inside.length > 0);
    if (shrink) {
      if (inside.length) {
        keepAfter = Math.min(keepAfter, Math.max(0, inside[0].start - s));
        keepBefore = Math.min(keepBefore, Math.max(0, e - inside.at(-1).end));
      }
      const cs = s + Math.min(keepAfter, len / 2), ce = e - Math.min(keepBefore, len / 2);
      if (ce - cs > 0.02) cuts.push({ start: cs, end: ce });
    }
    if (len >= minSilence || inside.length) gaps.push({ key, start: s, end: e, cut: shrink, kept: userKeep });
  }
  return finish(duration, cuts, removedWords, removedSounds, gaps);
}

function finish(duration, cuts, removedWords, removedSounds, gaps) {
  // Union of cuts, then drop kept slivers too short to be seen (under 80 ms).
  cuts.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const c of cuts) {
    const s = Math.max(0, c.start), e = Math.min(duration, c.end);
    if (e - s < 0.02) continue;
    const last = merged.at(-1);
    if (last && s <= last.end + 0.08) last.end = Math.max(last.end, e);
    else merged.push({ start: s, end: e });
  }
  if (merged.length && merged[0].start < 0.08) merged[0].start = 0;
  if (merged.length && duration - merged.at(-1).end < 0.08) merged.at(-1).end = duration;
  const segments = [];
  let t = 0, out = 0;
  for (const c of merged) {
    if (c.start > t) { segments.push({ start: t, end: c.start, outStart: out }); out += c.start - t; }
    t = c.end;
  }
  if (duration > t) { segments.push({ start: t, end: duration, outStart: out }); out += duration - t; }
  return { segments, cuts: merged, outDuration: out, removedWords, removedSounds, gaps };
}

/** Index of the segment that contains source time t, or -1. */
export function segmentAt(segments, t) {
  let lo = 0, hi = segments.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (t < segments[m].start) hi = m - 1;
    else if (t >= segments[m].end) lo = m + 1;
    else return m;
  }
  return -1;
}

/** Source time to output time. Times inside a cut collapse to the start of the next kept part. */
export function toOutput(segments, t) {
  let lo = 0, hi = segments.length - 1, ans = segments.length;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (segments[m].end > t) { ans = m; hi = m - 1; } else lo = m + 1; }
  if (ans === segments.length) return segments.length ? segments.at(-1).outStart + (segments.at(-1).end - segments.at(-1).start) : 0;
  const s = segments[ans];
  return s.outStart + Math.max(0, t - s.start);
}

/** Output time to source time. */
export function toSource(segments, tOut) {
  if (!segments.length) return 0;
  let lo = 0, hi = segments.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (segments[m].outStart <= tOut) lo = m; else hi = m - 1; }
  const s = segments[lo];
  return Math.min(s.end, s.start + Math.max(0, tOut - s.outStart));
}

/** The kept words with their output times. */
export function keptWords(words, plan) {
  const out = [];
  words.forEach((w, i) => {
    if (plan.removedWords.has(i)) return;
    const mid = (w.start + w.end) / 2;
    if (segmentAt(plan.segments, mid) < 0) return;          // fell inside a cut
    const start = toOutput(plan.segments, w.start), end = toOutput(plan.segments, w.end);
    out.push({ i, text: w.text, start, end: Math.max(end, start + 0.02) });
  });
  return out;
}

/**
 * Group words into on-screen captions.
 * @param {Array<{text:string,start:number,end:number}>} words in output time
 * @param {{maxWords?:number, maxChars?:number, gap?:number, hold?:number}} [o]
 * @returns {Array<{start:number,end:number,words:Array<{text:string,start:number,end:number}>}>}
 */
export function captionCues(words, { maxWords = 3, maxChars = 18, gap = 0.5, hold = 0.35 } = {}) {
  const cues = [];
  let cur = null;
  for (const w of words) {
    const text = w.text.trim();
    if (!text) continue;
    const chars = cur ? cur.words.reduce((n, x) => n + x.text.length + 1, 0) + text.length : text.length;
    const brk = !cur || cur.words.length >= maxWords || (cur.words.length && chars > maxChars) || w.start - cur.end > gap || /[.!?…]$/.test(cur.words.at(-1).text);
    if (brk) { if (cur) cues.push(cur); cur = { start: w.start, end: w.end, words: [] }; }
    cur.words.push({ text, start: w.start, end: w.end });
    cur.end = w.end;
  }
  if (cur) cues.push(cur);
  // Hold each caption until the next one begins when the gap is short, so text doesn't flicker.
  for (let i = 0; i < cues.length; i++) {
    const next = cues[i + 1], held = cues[i].end + hold;
    cues[i].end = !next ? held : next.start - cues[i].end <= hold ? next.start : Math.min(held, next.start);
  }
  return cues;
}

/** The caption showing at output time t, or null. */
export function cueAt(cues, t) {
  let lo = 0, hi = cues.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (t < cues[m].start) hi = m - 1;
    else if (t >= cues[m].end) lo = m + 1;
    else return cues[m];
  }
  return null;
}

/** Subtitle-file cues: up to two lines of `maxChars`, at most `maxDur` seconds, split at sentence ends. */
export function subtitleCues(words, { maxChars = 42, maxLines = 2, maxDur = 6, gap = 1 } = {}) {
  const cues = [];
  let cur = null;
  const flush = () => { if (cur) cues.push(cur); cur = null; };
  for (const w of words) {
    const text = w.text.trim();
    if (!text) continue;
    if (cur) {
      const trial = wrap([...cur.words.map((x) => x.text), text], maxChars);
      if (trial.length > maxLines || w.end - cur.start > maxDur || w.start - cur.end > gap || /[.!?…]$/.test(cur.words.at(-1).text)) flush();
    }
    if (!cur) cur = { start: w.start, end: w.end, words: [] };
    cur.words.push({ text, start: w.start, end: w.end });
    cur.end = w.end;
  }
  flush();
  return cues.map((c, i) => ({ start: c.start, end: Math.max(c.end, Math.min(c.start + 1, cues[i + 1]?.start ?? Infinity)), lines: wrap(c.words.map((x) => x.text), maxChars) }));
}

function wrap(tokens, maxChars) {
  const lines = [];
  let line = "";
  for (const t of tokens) {
    if (line && line.length + 1 + t.length > maxChars) { lines.push(line); line = t; }
    else line = line ? `${line} ${t}` : t;
  }
  if (line) lines.push(line);
  return lines;
}

const stamp = (t, sep) => {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${sep}${String(ms % 1000).padStart(3, "0")}`;
};

export function toSrt(cues) {
  return cues.map((c, i) => `${i + 1}\n${stamp(c.start, ",")} --> ${stamp(c.end, ",")}\n${c.lines.join("\n")}\n`).join("\n");
}

export function toVtt(cues) {
  return "WEBVTT\n\n" + cues.map((c) => `${stamp(c.start, ".")} --> ${stamp(c.end, ".")}\n${c.lines.join("\n")}\n`).join("\n");
}

/** Plain transcript of the kept words. */
export function transcriptText(words) {
  return words.map((w) => w.text.trim()).filter(Boolean).join(" ").replace(/\s+([,.!?;:…])/g, "$1");
}
