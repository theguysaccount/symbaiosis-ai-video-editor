// Turn Whisper's token stream into timed words. Pure functions, shared by the worker and the tests.
//
// Each text token arrives as a "piece" {kind:"text", text, start, end}; Whisper's own segment
// markers arrive as {kind:"time", time}. In Whisper's vocabulary a token that begins a new word
// starts with a space, so words are rebuilt by joining pieces until the next leading space.

const PUNCT = /^[\p{P}\p{S}\s]+$/u;
// Languages written without spaces between words: every piece is its own unit.
export const SPACELESS = new Set(["zh", "ja", "th", "lo", "my", "km", "yue"]);

/**
 * @param {Array<{kind:"text",text:string,start:number,end:number}|{kind:"time",time:number}>} pieces
 * @param {{spaceless?: boolean, duration?: number}} [options]
 * @returns {Array<{text:string,start:number,end:number}>} words in order, times in seconds
 */
export function piecesToWords(pieces, { spaceless = false, duration = Infinity } = {}) {
  const words = [];
  let cur = null, lead = "", closed = true;
  const push = () => { if (cur) { words.push(cur); cur = null; } };
  for (const p of pieces) {
    if (p.kind === "time") { push(); closed = true; continue; }
    const raw = p.text;
    if (!raw || !raw.trim()) continue;
    if (PUNCT.test(raw)) {
      // Punctuation belongs to the word before it and never stretches that word's timing.
      // Opening punctuation (¿ " “ ( and friends) waits for the word after it.
      if (cur && !/^\s/.test(raw)) cur.text += raw.trim();
      else if (cur && /^[.,!?;:…。、！？]+$/u.test(raw.trim())) cur.text += raw.trim();
      else lead += raw.trim();
      continue;
    }
    const startsWord = spaceless || closed || !cur || /^\s/.test(raw);
    if (startsWord) {
      push();
      cur = { text: lead + raw.trim(), start: p.start, end: Math.max(p.start, p.end) };
      lead = "";
    } else {
      cur.text += raw.trim();
      cur.end = Math.max(cur.end, p.end);
    }
    closed = false;
  }
  push();
  // Keep times finite, inside the audio, in order, and every word at least 20 ms long.
  let floor = 0;
  for (const w of words) {
    if (!Number.isFinite(w.start)) w.start = floor;
    if (!Number.isFinite(w.end)) w.end = w.start;
    w.start = Math.min(Math.max(w.start, floor, 0), duration);
    w.end = Math.min(Math.max(w.end, w.start + 0.02), Math.max(duration, w.start + 0.02));
    floor = w.start;
  }
  return words;
}

/** The last segment-end time Whisper wrote, or 0. Used to notice when it stopped early. */
export function lastMarker(pieces) {
  let t = 0;
  for (const p of pieces) if (p.kind === "time") t = Math.max(t, p.time);
  return t;
}
