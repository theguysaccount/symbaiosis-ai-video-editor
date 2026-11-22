// Audio analysis: resample to 16 kHz mono, measure loudness, find silences and speech islands.
// Pure functions on typed arrays, with no browser APIs, so the same code runs in the unit tests.

export const RATE = 16000;        // analysis sample rate (also what the speech model expects)
export const HOP = 160;           // one loudness value every 10 ms
export const HOP_S = HOP / RATE;
const WIN = 400;                  // each value measures a 25 ms window
const FLOOR_DB = -100;

/**
 * Streaming sample-rate converter to 16 kHz mono (windowed-sinc, 16 zero crossings).
 * push() takes one block of planar channel data and returns the 16 kHz samples that are
 * complete so far; flush() returns the tail.
 */
export class Resampler {
  constructor(inRate) {
    this.inRate = inRate;
    this.step = inRate / RATE;                       // input samples per output sample
    const cutoff = Math.min(1, RATE / inRate) * 0.94; // fraction of the input Nyquist frequency
    this.half = Math.ceil(16 / cutoff);              // taps on each side of the centre
    this.phases = 64;
    const taps = this.half * 2;
    this.table = new Float32Array(this.phases * taps);
    for (let ph = 0; ph < this.phases; ph++) {
      const frac = ph / this.phases;
      let sum = 0;
      for (let k = 0; k < taps; k++) {
        const x = k - this.half + 1 - frac;          // distance from the output position, in input samples
        const s = x === 0 ? 1 : Math.sin(Math.PI * x * cutoff) / (Math.PI * x * cutoff);
        const w = 0.5 + 0.5 * Math.cos((Math.PI * x) / this.half);  // Hann window
        const v = Math.abs(x) >= this.half ? 0 : s * w * cutoff;
        this.table[ph * taps + k] = v; sum += v;
      }
      for (let k = 0; k < taps; k++) this.table[ph * taps + k] /= sum;   // unity gain at DC
    }
    this.buf = new Float32Array(0);                  // input not yet fully consumed
    this.pos = 0;                                    // next output position, in input samples, relative to buf[0]
    this.primed = false;
  }

  /** @param {Float32Array[]} channels planar blocks of equal length */
  push(channels) {
    const n = channels[0].length, c = channels.length;
    let mono;
    if (c === 1) mono = channels[0];
    else {
      mono = new Float32Array(n);
      for (const ch of channels) for (let i = 0; i < n; i++) mono[i] += ch[i];
      for (let i = 0; i < n; i++) mono[i] /= c;
    }
    if (this.inRate === RATE) return mono.slice();
    if (!this.primed) {                              // pad the start so the first output sits at input time 0
      this.buf = new Float32Array(this.half - 1);
      this.pos = this.half - 1;
      this.primed = true;
    }
    const joined = new Float32Array(this.buf.length + n);
    joined.set(this.buf); joined.set(mono, this.buf.length);
    return this.#run(joined, false);
  }

  flush() {
    if (this.inRate === RATE || !this.primed) return new Float32Array(0);
    const joined = new Float32Array(this.buf.length + this.half);
    joined.set(this.buf);
    return this.#run(joined, true);
  }

  #run(x, last) {
    const taps = this.half * 2, { step, table, phases, half } = this;
    const out = new Float32Array(Math.max(0, Math.ceil((x.length - half - this.pos) / step) + 1));
    let n = 0, pos = this.pos;
    for (;;) {
      const i = Math.floor(pos), start = i - half + 1;
      if (start + taps > x.length) break;
      const ph = Math.min(phases - 1, Math.round((pos - i) * phases)) * taps;
      let s = 0;
      for (let k = 0; k < taps; k++) s += x[start + k] * table[ph + k];
      out[n++] = s;
      pos += step;
    }
    if (!last) {
      const keepFrom = Math.max(0, Math.floor(pos) - half + 1);
      this.buf = x.slice(keepFrom);
      this.pos = pos - keepFrom;
    }
    return out.subarray(0, n);
  }
}

/** Join blocks into one array. */
export function concat(blocks) {
  let n = 0; for (const b of blocks) n += b.length;
  const out = new Float32Array(n);
  let o = 0; for (const b of blocks) { out.set(b, o); o += b.length; }
  return out;
}

/**
 * Loudness in dBFS every 10 ms (RMS of a 25 ms window), after a 110 Hz high-pass so that
 * rumble and hum don't count as sound.
 * @param {Float32Array} pcm 16 kHz mono
 * @returns {Float32Array}
 */
export function loudness(pcm) {
  const frames = Math.max(0, Math.ceil(pcm.length / HOP));
  const db = new Float32Array(frames);
  const a = 1 / (1 + (2 * Math.PI * 110) / RATE);
  // Squared, high-passed signal as a running sum for constant-time windows.
  const acc = new Float64Array(pcm.length + 1);
  let y = 0, prev = 0;
  for (let i = 0; i < pcm.length; i++) {
    y = a * (y + pcm[i] - prev); prev = pcm[i];
    acc[i + 1] = acc[i] + y * y;
  }
  for (let f = 0; f < frames; f++) {
    const mid = f * HOP + HOP / 2;
    const lo = Math.max(0, Math.round(mid - WIN / 2)), hi = Math.min(pcm.length, Math.round(mid + WIN / 2));
    const ms = hi > lo ? (acc[hi] - acc[lo]) / (hi - lo) : 0;
    db[f] = ms > 1e-10 ? Math.max(FLOOR_DB, 10 * Math.log10(ms)) : FLOOR_DB;
  }
  return db;
}

/**
 * Work out where "silence" ends and "sound" begins for this recording.
 * The room-noise level is the lowest well-populated peak of the loudness histogram; anything
 * within `margin` dB of it is silence. The threshold is never allowed within 15 dB of the loud
 * speech level, so continuous speech with no real pauses is not mistaken for silence.
 * @returns {{noiseDb:number, speechDb:number, thresholdDb:number, confident:boolean}}
 */
export function levels(db, { margin = 8 } = {}) {
  if (!db.length) return { noiseDb: FLOOR_DB, speechDb: FLOOR_DB, thresholdDb: FLOOR_DB, confident: false };
  const sorted = Float32Array.from(db).sort();
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const speechDb = pct(0.95);
  // Histogram in 1 dB bins from -100 to 0, smoothed over 3 bins.
  const bins = new Float64Array(101);
  for (const v of db) bins[Math.max(0, Math.min(100, Math.round(v + 100)))]++;
  const smooth = new Float64Array(101);
  for (let i = 0; i <= 100; i++) smooth[i] = ((bins[i - 1] || 0) + bins[i] + (bins[i + 1] || 0)) / 3;
  // The lowest local peak that holds a real share of the recording (at least 3% within +-2 dB
  // and at least 0.3 s of it), so stray quiet frames don't qualify. Digital silence (below
  // -95 dB) is only used when there is no room tone to go by.
  const need = Math.max(0.03 * db.length, Math.min(30, db.length * 0.5));
  let noiseDb = null, digital = null;
  for (let i = 0; i <= 100 && noiseDb === null; i++) {
    if (!smooth[i] || smooth[i] < (smooth[i - 1] || 0) || smooth[i] < (smooth[i + 1] || 0)) continue;
    let share = 0; for (let j = Math.max(0, i - 2); j <= Math.min(100, i + 2); j++) share += bins[j];
    if (share < need) continue;
    if (i - 100 <= -95) digital ??= i - 100;
    else if (i - 100 <= speechDb - 15) noiseDb = i - 100;
    else break;
  }
  noiseDb ??= digital ?? pct(0.05);
  noiseDb = Math.min(noiseDb, speechDb);
  const thresholdDb = Math.max(noiseDb + 4, Math.min(noiseDb + margin, speechDb - 15));
  return { noiseDb, speechDb, thresholdDb, confident: speechDb - noiseDb >= 18 };
}

/**
 * Runs of quiet (`below` true) or sound (`below` false), as [{start,end}] in seconds.
 * `bridge` joins runs separated by a shorter gap of the other kind (seconds).
 */
function runs(db, thresholdDb, below, bridge) {
  const out = [];
  let from = -1;
  for (let f = 0; f <= db.length; f++) {
    const hit = f < db.length && (db[f] < thresholdDb) === below;
    if (hit && from < 0) from = f;
    else if (!hit && from >= 0) { out.push({ start: from * HOP_S, end: f * HOP_S }); from = -1; }
  }
  if (!bridge) return out;
  const merged = [];
  for (const r of out) {
    const last = merged.at(-1);
    if (last && r.start - last.end < bridge) last.end = r.end;
    else merged.push({ ...r });
  }
  return merged;
}

/**
 * Speech islands: stretches of sound, ignoring dips shorter than `bridge` (stop consonants,
 * the tiny gaps inside words) and blips shorter than `minLength` (clicks).
 */
export function findIslands(db, thresholdDb, { bridge = 0.1, minLength = 0.06 } = {}) {
  return runs(db, thresholdDb, false, bridge).filter((r) => r.end - r.start >= minLength);
}

/** Silences: the gaps between islands, plus the lead-in and tail, lasting at least `minLength`. */
export function findSilences(db, thresholdDb, { minLength = 0.25, bridge = 0.1, minIsland = 0.06 } = {}) {
  const total = db.length * HOP_S;
  const islands = findIslands(db, thresholdDb, { bridge, minLength: minIsland });
  const out = [];
  let t = 0;
  for (const is of islands) { if (is.start - t >= minLength) out.push({ start: t, end: is.start }); t = is.end; }
  if (total - t >= minLength) out.push({ start: t, end: total });
  return out;
}

/** Peak loudness (dB) inside [start,end). */
export function peakDb(db, start, end) {
  let m = FLOOR_DB;
  for (let f = Math.max(0, Math.floor(start / HOP_S)); f < Math.min(db.length, Math.ceil(end / HOP_S)); f++) if (db[f] > m) m = db[f];
  return m;
}

/**
 * The quietest moment within +-`radius` seconds of `t`: the best place to put a cut.
 * Ties go to the moment nearest `t`.
 */
export function quietestNear(db, t, radius = 0.08) {
  const c = Math.round(t / HOP_S);
  const lo = Math.max(0, c - Math.round(radius / HOP_S)), hi = Math.min(db.length - 1, c + Math.round(radius / HOP_S));
  let best = Math.min(Math.max(c, 0), Math.max(0, db.length - 1)), bestDb = Infinity;
  for (let f = lo; f <= hi; f++) {
    const v = db[f] + Math.abs(f - c) * 0.05;       // gentle preference for staying close
    if (v < bestDb) { bestDb = v; best = f; }
  }
  return (best + 0.5) * HOP_S;
}

/** The quietest 50 ms inside [from,to], as a time in seconds. */
export function quietestIn(db, from, to) {
  const lo = Math.max(0, Math.round(from / HOP_S)), hi = Math.min(db.length - 1, Math.round(to / HOP_S));
  let best = lo, bestDb = Infinity;
  for (let f = lo; f <= hi; f++) {
    let v = 0, n = 0;
    for (let j = Math.max(0, f - 2); j <= Math.min(db.length - 1, f + 2); j++) { v += db[j]; n++; }
    if (v / n < bestDb) { bestDb = v / n; best = f; }
  }
  return (best + 0.5) * HOP_S;
}

/**
 * Split the recording into pieces of at most `maxLength` seconds for the speech model.
 * Pieces break in silences, long quiet stretches are skipped entirely, and a stretch of sound
 * longer than one piece is split at its quietest moment.
 * @param {Array<{start:number,end:number}>} islands from findIslands
 * @param {number} total length of the recording in seconds
 * @param {Float32Array} [db] loudness, used to choose where to split over-long islands
 * @returns {Array<{start:number,end:number}>} in order
 */
export function speechChunks(islands, total, db = null, { maxLength = 28, pad = 0.25, joinGap = 3 } = {}) {
  const span = maxLength - 2 * pad;
  const pieces = [];
  for (const is of islands) {
    let s = is.start, hard = false;
    while (is.end - s > span) {
      const cut = db ? quietestIn(db, s + span - 6, s + span - 0.2) : s + span;
      pieces.push({ start: s, end: cut, hardStart: hard, hardEnd: true });
      s = cut; hard = true;
    }
    pieces.push({ start: s, end: is.end, hardStart: hard, hardEnd: false });
  }
  const chunks = [];
  let cur = null;
  for (const p of pieces) {
    if (cur && (p.hardStart || cur.hardEnd || p.end - cur.start > span || p.start - cur.end > joinGap)) { chunks.push(cur); cur = null; }
    if (!cur) cur = { ...p };
    else { cur.end = p.end; cur.hardEnd = p.hardEnd; }
  }
  if (cur) chunks.push(cur);
  // Pad with a little silence on each side, except where an island was split mid-sound, and
  // never so far that two pieces overlap (a word would be heard twice).
  return chunks.map((c, i) => {
    const before = i ? (c.start - chunks[i - 1].end) / 2 : pad, after = i + 1 < chunks.length ? (chunks[i + 1].start - c.end) / 2 : pad;
    return {
      start: c.hardStart ? c.start : Math.max(0, c.start - Math.min(pad, before)),
      end: c.hardEnd ? c.end : Math.min(total, c.end + Math.min(pad, after)),
    };
  });
}
