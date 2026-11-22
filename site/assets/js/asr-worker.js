// Speech recognition in a Web Worker: Whisper (OpenAI) through Transformers.js and ONNX Runtime
// Web, on the WebAssembly CPU backend. The model, the runtime and this script are all served by
// this site, and the audio arrives from the page as raw samples. Nothing is sent anywhere.
//
// Messages in:   {type:"load", model, cacheKey}
//                {type:"transcribe", id, audio: Float32Array (16 kHz mono, at most 30 s), language, hint}
// Messages out:  {type:"progress", file, loaded, total}   while model files download
//                {type:"ready", model, threads, ms}
//                {type:"result", id, words:[{text,start,end}], heardUntil, ms}
//                {type:"error", id, message}
import { pipeline, env, LogLevel } from "../vendor/transformers.min.js";
import { piecesToWords, lastMarker, SPACELESS } from "./asr-decode.js";

const here = (p) => new URL(p, import.meta.url).href;
env.allowRemoteModels = false;                 // never fall back to huggingface.co
env.allowLocalModels = true;
// A path, not a full URL: Transformers.js only looks for "local" files when this isn't an http(s) URL.
env.localModelPath = new URL("../models/", import.meta.url).pathname;
env.logLevel = LogLevel.ERROR;
// Without cross-origin isolation (GitHub Pages can't send those headers) there is no
// SharedArrayBuffer, so ONNX Runtime runs on one thread. If the page is ever served isolated,
// it uses up to four.
const threads = self.crossOriginIsolated ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)) : 1;
env.backends.onnx.wasm.numThreads = threads;
env.backends.onnx.wasm.wasmPaths = { mjs: here("../vendor/ort/ort-wasm-simd-threaded.mjs"), wasm: here("../vendor/ort/ort-wasm-simd-threaded.wasm") };

const SAMPLE_RATE = 16000, MAX_SAMPLES = SAMPLE_RATE * 30, MAX_NEW_TOKENS = 224;
let asr = null, loaded = "", queue = Promise.resolve();

async function load({ model, cacheKey }) {
  if (loaded === model && asr) { postMessage({ type: "ready", model, threads, ms: 0 }); return; }
  if (cacheKey) env.cacheKey = cacheKey;
  if (asr) { try { await asr.dispose(); } catch { /* the old model is dropped either way */ } asr = null; loaded = ""; }
  const t0 = performance.now();
  asr = await pipeline("automatic-speech-recognition", model, {
    dtype: "q8", device: "wasm",
    progress_callback: (p) => { if (p.status === "progress" && p.total) postMessage({ type: "progress", file: p.file, loaded: p.loaded, total: p.total }); },
  });
  loaded = model;
  postMessage({ type: "ready", model, threads, ms: Math.round(performance.now() - t0) });
}

// The tokens every transcription starts with, optionally after a "previous text" hint.
// Whisper was trained on tidy transcripts and tends to leave "um" and "uh" out. A hint that
// contains them makes it write them down, which is what the filler cutter needs.
function startTokens(language, hint) {
  const model = asr.model, cfg = model.generation_config;
  const opts = { return_timestamps: true, ...(cfg.is_multilingual ? { language, task: "transcribe" } : {}) };
  const start = model._retrieve_init_tokens(model._prepare_generation_config(null, opts)).map(Number);
  const prev = cfg.prev_sot_token_id;
  if (!hint || typeof prev !== "number") return start;
  const ids = asr.tokenizer(" " + hint.trim(), { add_special_tokens: false }).input_ids.tolist()[0].map(Number);
  return [prev, ...ids.slice(-60), ...start];
}

async function run(audio, language, hint) {
  const model = asr.model, tok = asr.tokenizer, cfg = model.generation_config;
  const { input_features } = await asr.processor(audio);
  const init = startTokens(language, hint);
  const out = await model.generate({
    inputs: input_features,
    decoder_input_ids: init,
    return_timestamps: true,
    return_token_timestamps: true,
    // One pass over one window of at most 30 s. Setting max_new_tokens selects that path, and
    // num_frames (encoder frames, 50 per second) keeps the word timing inside the real audio
    // instead of the zero padding after it.
    max_new_tokens: MAX_NEW_TOKENS,
    num_frames: Math.max(1, Math.floor(audio.length / 320)),
    ...(cfg.is_multilingual ? { language, task: "transcribe" } : {}),
  });
  const ids = out.sequences.tolist()[0].map(Number);
  const shown = Array.from(out.token_timestamps.data);
  const tsBegin = tok.timestamp_begin;
  const eos = Array.isArray(cfg.eos_token_id) ? cfg.eos_token_id[0] : cfg.eos_token_id;
  const pieces = [];
  let pending = [], first = -1;
  for (let j = init.length; j < ids.length; j++) {
    const id = ids[j];
    if (id >= tsBegin) { pending = []; pieces.push({ kind: "time", time: (id - tsBegin) * 0.02 }); continue; }
    if (id >= eos) continue;                     // end-of-text and other control tokens
    if (!pending.length) first = j;
    pending.push(id);
    const text = tok.decode(pending, { skip_special_tokens: true, clean_up_tokenization_spaces: false });
    if (text.includes("�")) continue;       // half of a multi-byte character: wait for the rest
    // Transformers.js 4.3 reports, for each token, the moment the *next* token begins (its
    // alignment rows are the positions that predict the following token). So a token starts where
    // the one before it is "shown", and ends where it is shown itself.
    pieces.push({ kind: "text", text, start: shown[first - 1], end: shown[j] });
    pending = [];
  }
  return pieces;
}

async function transcribe({ id, audio, language = "en", hint = "" }) {
  const t0 = performance.now();
  if (audio.length > MAX_SAMPLES) audio = audio.subarray(0, MAX_SAMPLES);
  let pieces;
  try {
    pieces = await run(audio, language, hint);
  } catch (e) {
    if (!hint) throw e;
    pieces = await run(audio, language, "");     // the hint is an optimisation; never fail because of it
  }
  const duration = audio.length / SAMPLE_RATE;
  const words = piecesToWords(pieces, { spaceless: SPACELESS.has(language), duration });
  postMessage({ type: "result", id, words, heardUntil: Math.min(duration, lastMarker(pieces)), ms: Math.round(performance.now() - t0) });
}

self.onmessage = (e) => {
  const msg = e.data;
  queue = queue.then(async () => {
    try {
      if (msg.type === "load") await load(msg);
      else if (msg.type === "transcribe") await transcribe(msg);
    } catch (err) {
      postMessage({ type: "error", id: msg.id ?? null, message: String(err?.message || err) });
    }
  });
};
