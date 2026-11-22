// Step 1 of making the sample clip: synthesise the narration with Kokoro (an Apache-2.0 open
// text-to-speech model) and lay the phrases out on a timeline with pauses of known length.
//   npm install --no-save kokoro-js@1.2.1      (not a dependency of the site; only this script needs it)
//   node scripts/make-sample/voice.mjs <out-dir>
// Writes <out-dir>/voice.wav (48 kHz mono) and <out-dir>/truth.json (where every phrase, pause
// and filler word is). A computer voice is used on purpose: no person's voice or face is involved,
// and the output is free to publish.
import fs from "node:fs";
import path from "node:path";

const outDir = path.resolve(process.argv[2] || "sample-out");
fs.mkdirSync(outDir, { recursive: true });

// text, then the pause after it in seconds. `filler` marks the words the editor should cut.
export const SCRIPT = [
  { text: "Hey, welcome back.", gap: 0.55 },
  { text: "So,", gap: 0.12 },
  { text: "um,", gap: 1.3, filler: true },
  { text: "this is a sample clip for the editor.", gap: 1.8 },
  { text: "I recorded it in one take, and,", gap: 0.18 },
  { text: "uh,", gap: 0.22, filler: true },
  { text: "I left all the pauses in on purpose.", gap: 2.4 },
  { text: "Um,", gap: 1.1, filler: true },
  { text: "the editor finds the silences, cuts the filler words, and adds captions.", gap: 1.5 },
  { text: "Then it exports a vertical video,", gap: 0.9 },
  { text: "uh,", gap: 0.28, filler: true },
  { text: "without uploading anything.", gap: 2.0 },
  { text: "Pretty neat, right?", gap: 0.9 },
];
const LEAD_IN = 0.8;
const VOICE = process.env.VOICE || "af_heart";
const RATE_IN = 24000, RATE_OUT = 48000;

const { KokoroTTS } = await import("kokoro-js");
const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "cpu" });

// Trim the quiet head and tail the model adds, so the pauses on the timeline are exactly the
// ones written above. 5 ms windows; "quiet" is 40 dB below the phrase's own peak window.
function trim(a) {
  const w = Math.round(RATE_IN * 0.005);
  const rms = [];
  for (let i = 0; i + w <= a.length; i += w) { let s = 0; for (let j = i; j < i + w; j++) s += a[j] * a[j]; rms.push(Math.sqrt(s / w)); }
  const thr = Math.max(...rms) * 0.01;
  let lo = rms.findIndex((v) => v > thr), hi = rms.length - 1 - [...rms].reverse().findIndex((v) => v > thr);
  lo = Math.max(0, lo - 2); hi = Math.min(rms.length - 1, hi + 4);
  const out = a.slice(lo * w, (hi + 1) * w);
  const f = Math.round(RATE_IN * 0.004);                       // 4 ms fades: no clicks at the edges
  for (let i = 0; i < f; i++) { out[i] *= i / f; out[out.length - 1 - i] *= i / f; }
  return out;
}

// 24 kHz to 48 kHz: keep every sample and put a windowed-sinc interpolated one between each pair.
function upsample2(a) {
  const out = new Float32Array(a.length * 2), R = 12;
  for (let n = 0; n < a.length; n++) {
    out[2 * n] = a[n];
    let s = 0;
    for (let k = -R + 1; k <= R; k++) {
      const x = k - 0.5, i = n + k;
      if (i < 0 || i >= a.length) continue;
      s += a[i] * (Math.sin(Math.PI * x) / (Math.PI * x)) * (0.5 + 0.5 * Math.cos((Math.PI * x) / R));
    }
    out[2 * n + 1] = s;
  }
  return out;
}

const parts = [], truth = { sampleRate: RATE_OUT, voice: `Kokoro-82M v1.0 (${VOICE})`, phrases: [], pauses: [] };
let t = LEAD_IN;
truth.pauses.push({ start: 0, end: LEAD_IN });
for (const [i, p] of SCRIPT.entries()) {
  const raw = (await tts.generate(p.text, { voice: VOICE, speed: 1 })).audio;
  const a = trim(raw);
  const dur = a.length / RATE_IN;
  parts.push({ at: t, audio: a });
  truth.phrases.push({ text: p.text, start: +t.toFixed(3), end: +(t + dur).toFixed(3), filler: !!p.filler });
  console.log(`${t.toFixed(2).padStart(6)}  ${dur.toFixed(2)} s  ${p.text}`);
  t += dur;
  truth.pauses.push({ start: +t.toFixed(3), end: +(t + p.gap).toFixed(3), afterPhrase: i });
  t += p.gap;
}
truth.duration = +t.toFixed(3);

const mix = new Float32Array(Math.round(t * RATE_IN));
for (const p of parts) mix.set(p.audio, Math.round(p.at * RATE_IN));
let up = upsample2(mix);
// Normalise speech peaks to about -3 dBFS, then add a quiet room tone (about -62 dBFS) so the
// pauses are not digital silence: real recordings never are, and the detector must cope.
let peak = 0; for (const v of up) peak = Math.max(peak, Math.abs(v));
const g = 0.7 / peak;
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
let lp = 0;
for (let i = 0; i < up.length; i++) {
  const white = (rnd() + rnd() + rnd() - 1.5) * 0.0016;
  lp += 0.25 * (white - lp);                                    // gentle low-pass: room tone, not hiss
  up[i] = up[i] * g + lp;
}

const pcm = Buffer.alloc(up.length * 2);
for (let i = 0; i < up.length; i++) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(up[i] * 32767))), i * 2);
const head = Buffer.alloc(44);
head.write("RIFF", 0); head.writeUInt32LE(36 + pcm.length, 4); head.write("WAVEfmt ", 8); head.writeUInt32LE(16, 16);
head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(RATE_OUT, 24); head.writeUInt32LE(RATE_OUT * 2, 28);
head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write("data", 36); head.writeUInt32LE(pcm.length, 40);
fs.writeFileSync(path.join(outDir, "voice.wav"), Buffer.concat([head, pcm]));
fs.writeFileSync(path.join(outDir, "truth.json"), JSON.stringify(truth, null, 1) + "\n");
console.log(`voice.wav: ${truth.duration} s; ${truth.phrases.filter((p) => p.filler).length} filler words; ${truth.pauses.length} pauses`);
