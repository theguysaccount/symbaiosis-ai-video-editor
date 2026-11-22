// Pin the speech model's words to where the sound actually is.
//
// Whisper's word times come from its attention weights. Inside a run of speech they are good to
// about a tenth of a second, but around pauses they drift: a word after a pause "starts" somewhere
// in the silence, a word before one "ends" late, and now and then a filler is placed entirely in
// the gap next to it. The loudness analysis knows exactly where sound starts and stops, so each
// word is assigned to a speech island and laid out inside it. Islands that end up with no word
// are reported separately: breaths, clicks, and the "um"s the model didn't write down.
// Pure functions; no browser APIs.

const lettersOf = (w) => Math.max(1, w.text.replace(/[^\p{L}\p{N}]/gu, "").length);

/**
 * @param {Array<{text:string,start:number,end:number}>} words in order, times in seconds
 * @param {Array<{start:number,end:number}>} islands in order, not overlapping
 * @param {{reach?: number}} [options] how far (seconds) a word may be from an island and still belong to it
 * @returns {{words: Array<{text:string,start:number,end:number,loose?:boolean}>, sounds: Array<{start:number,end:number}>}}
 */
export function alignWords(words, islands, { reach = 0.7 } = {}) {
  const out = words.map((w) => ({ ...w }));
  if (!islands.length || !out.length) return { words: out, sounds: islands.map((x, index) => ({ ...x, index })) };

  // 1. Home island for each word, judged by where the word ends (the reliable edge).
  let k = 0;
  const home = out.map((w) => {
    const t = Math.max(w.start, w.end - 0.02);
    while (k < islands.length - 1 && islands[k].end <= t && islands[k + 1].start <= t) k++;
    const inside = (i) => i >= 0 && i < islands.length && islands[i].start <= t && t < islands[i].end;
    if (inside(k)) return k;
    if (inside(k + 1)) return k + 1;
    // Between islands (or before the first / after the last): the nearer edge wins.
    let best = -1, bestD = reach;
    for (const i of [k, k + 1]) {
      if (i < 0 || i >= islands.length) continue;
      const d = t < islands[i].start ? islands[i].start - t : t - islands[i].end;
      if (d <= bestD) { bestD = d; best = i; }
    }
    return best;
  });
  // Words are in order, so their islands must be too.
  let floor = -1;
  for (let i = 0; i < home.length; i++) {
    if (home[i] < 0) continue;
    if (home[i] < floor) home[i] = floor;
    floor = home[i];
  }

  // 2. Lay the words of each island out between its edges.
  const used = new Set();
  for (let i = 0; i < out.length;) {
    if (home[i] < 0) { out[i].loose = true; i++; continue; }
    let j = i; while (j + 1 < out.length && home[j + 1] === home[i]) j++;
    layout(out.slice(i, j + 1), islands[home[i]]);
    used.add(home[i]);
    i = j + 1;
  }
  // Loose words (nothing audible near them) keep their times but may not run backwards.
  let t = 0;
  for (const w of out) { if (w.loose) { w.start = Math.max(w.start, t); w.end = Math.max(w.end, w.start + 0.02); } t = Math.max(t, w.end); }

  return { words: out, sounds: islands.map((x, index) => ({ ...x, index })).filter((x) => !used.has(x.index)) };
}

// Words share the island [a,b] end to end. The boundary between two neighbours is where the
// model says the first one ends, unless that is outside the island or leaves someone no room;
// then the boundary falls back to a split in proportion to the words' lengths in letters.
function layout(group, { start: a, end: b }) {
  const n = group.length;
  if (n === 1) { group[0].start = a; group[0].end = b; return; }
  const total = group.reduce((s, w) => s + lettersOf(w), 0);
  const byLetters = [a];
  let acc = 0;
  for (let i = 0; i < n - 1; i++) { acc += lettersOf(group[i]); byLetters.push(a + ((b - a) * acc) / total); }
  byLetters.push(b);
  const minDur = Math.min(0.06, ((b - a) / n) * 0.5);
  const bound = [a];
  for (let i = 1; i < n; i++) {
    const t = group[i - 1].end;
    bound.push(t > a + 0.01 && t < b - 0.01 ? t : byLetters[i]);
  }
  bound.push(b);
  let ok = true;
  for (let i = 1; i <= n; i++) if (bound[i] - bound[i - 1] < minDur) ok = false;
  if (!ok) {
    // Repair in two sweeps; if that still leaves a word squeezed, use the letter split outright.
    for (let i = 1; i < n; i++) bound[i] = Math.max(bound[i], bound[i - 1] + minDur);
    for (let i = n - 1; i >= 1; i--) bound[i] = Math.min(bound[i], bound[i + 1] - minDur);
    for (let i = 1; i <= n; i++) if (bound[i] - bound[i - 1] < minDur * 0.99) { bound.splice(0, bound.length, ...byLetters); break; }
  }
  for (let i = 0; i < n; i++) { group[i].start = bound[i]; group[i].end = bound[i + 1]; }
}
