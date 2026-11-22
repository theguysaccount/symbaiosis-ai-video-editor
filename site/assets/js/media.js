// Reading and writing video on the device, with Mediabunny and the browser's own WebCodecs
// encoders and decoders. The file is read straight from disk; nothing is uploaded.
import * as MB from "../vendor/mediabunny.min.mjs";
import { Resampler, concat, RATE } from "./analysis.js";
import { drawPicture, drawCaption, drawEndCard } from "./render.js";
import { cueAt, toSource } from "./edit.js";

export const supported = () => typeof VideoDecoder !== "undefined" && typeof VideoEncoder !== "undefined" && typeof AudioDecoder !== "undefined";

/** Open a file and read what the editor needs to know about it. */
export async function probe(file) {
  const input = new MB.Input({ source: new MB.BlobSource(file), formats: MB.ALL_FORMATS });
  if (!(await input.canRead())) { input.dispose(); throw new Error("This file isn't a video format the browser can read. Try an MP4, MOV or WebM."); }
  const video = await input.getPrimaryVideoTrack();
  const audio = await input.getPrimaryAudioTrack();
  if (!video) { input.dispose(); throw new Error("This file has no picture. Choose a video file."); }
  if (!(await video.canDecode())) { input.dispose(); throw new Error(`This browser can't decode ${(await video.getCodec()) || "this"} video. Try Chrome or Edge, or export the video as H.264 MP4 first.`); }
  const audioOk = !!audio && (await audio.canDecode());
  const duration = await input.computeDuration([video, ...(audio ? [audio] : [])]);
  let fps = 30;
  try { fps = (await video.computeFrameRateMetrics({ targetPacketCount: 240 })).bestGuessFrameRate || 30; } catch { /* keep 30 */ }
  return {
    input, video, audio: audioOk ? audio : null, duration,
    width: await video.getDisplayWidth(), height: await video.getDisplayHeight(),
    fps: Math.min(60, Math.max(15, Math.round(fps))),
    hasAudio: !!audio, audioDecodable: audioOk,
    sampleRate: audioOk ? await audio.getSampleRate() : 0,
    channels: audioOk ? await audio.getNumberOfChannels() : 0,
    videoCodec: await video.getCodec(), audioCodec: audio ? await audio.getCodec() : null,
  };
}

/** Decode the sound track to 16 kHz mono for analysis. onProgress(fraction). */
export async function decodeAudio16k(info, { onProgress = () => {}, signal } = {}) {
  const sink = new MB.AudioSampleSink(info.audio);
  const rs = new Resampler(info.sampleRate);
  const blocks = [];
  let written = 0;                                  // input-rate frames placed so far
  for await (const sample of sink.samples()) {
    if (signal?.aborted) { sample.close(); throw new DOMException("Cancelled", "AbortError"); }
    const n = sample.numberOfFrames, c = sample.numberOfChannels, sr = sample.sampleRate;
    let chans = [];
    for (let ch = 0; ch < c; ch++) {
      const a = new Float32Array(n);
      sample.copyTo(a, { planeIndex: ch, format: "f32-planar" });
      chans.push(a);
    }
    // Keep the sound on the picture's clock: fill gaps with silence, drop overlaps.
    const at = Math.round(sample.timestamp * sr);
    if (at > written + 1) {
      const gap = Math.min(at - written, sr * 600);
      blocks.push(rs.push(Array.from({ length: c }, () => new Float32Array(gap))));
      written += gap;
    }
    const skip = Math.max(0, written - at);
    if (skip < n) {
      if (skip) chans = chans.map((a) => a.subarray(skip));
      blocks.push(rs.push(chans));
      written += n - skip;
    }
    onProgress(Math.min(1, sample.timestamp / Math.max(0.001, info.duration)));
    sample.close();
  }
  blocks.push(rs.flush());
  let pcm = concat(blocks);
  // Pad or trim to the video's length so analysis and picture line up.
  const want = Math.round(info.duration * RATE);
  if (pcm.length < want) { const p = new Float32Array(want); p.set(pcm); pcm = p; }
  else if (pcm.length > want) pcm = pcm.subarray(0, want);
  onProgress(1);
  return pcm;
}

let aacReady = null;
async function pickAudioCodec(container, sampleRate, numberOfChannels) {
  if (container === "webm") return (await MB.canEncodeAudio("opus", { sampleRate, numberOfChannels })) ? "opus" : null;
  if (await MB.canEncodeAudio("aac", { sampleRate, numberOfChannels })) return "aac";
  // Browsers without a native AAC encoder (Firefox, Chrome on Linux): load the WebAssembly one,
  // served from this site, only when it's needed.
  aacReady ??= import("../vendor/mediabunny-aac-encoder.min.mjs").then((m) => { m.registerAacEncoder(); return true; }).catch(() => false);
  if ((await aacReady) && (await MB.canEncodeAudio("aac", { sampleRate, numberOfChannels }))) return "aac";
  return (await MB.canEncodeAudio("opus", { sampleRate, numberOfChannels })) ? "opus" : null;
}

/**
 * Render and encode the edited video.
 * @param {object} p
 * @param {ReturnType<typeof probe> extends Promise<infer T> ? T : never} p.info
 * @param {Array<{start:number,end:number,outStart:number}>} p.segments  kept parts of the source
 * @param {number} p.outDuration
 * @param {{w:number,h:number}} p.size
 * @param {{fit:string,focusX:number,punchIn:boolean}} p.frame
 * @param {Array} p.cues   caption cues in output time (empty for none)
 * @param {object} p.captionStyle
 * @param {string|null} p.endCardHost  host name for the optional end card, or null
 */
export async function exportVideo({ info, segments, outDuration, size, frame, cues, captionStyle, endCardHost = null, onProgress = () => {}, signal }) {
  const { w: W, h: H } = size;
  const fps = info.fps;
  const videoCodec = await MB.getFirstEncodableVideoCodec(["avc", "vp9", "av1", "vp8"], { width: W, height: H });
  if (!videoCodec) throw new Error("This browser can't encode video. Try a recent Chrome, Edge, Safari or Firefox.");
  const container = videoCodec === "avc" ? "mp4" : "webm";
  const outCh = Math.min(2, info.channels || 0), sr = info.sampleRate || 48000;
  const audioCodec = info.audio && outCh ? await pickAudioCodec(container, sr, outCh) : null;

  const output = new MB.Output({
    format: container === "mp4" ? new MB.Mp4OutputFormat({ fastStart: "in-memory" }) : new MB.WebMOutputFormat(),
    target: new MB.BufferTarget(),
  });
  const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(W, H) : Object.assign(document.createElement("canvas"), { width: W, height: H });
  const ctx = canvas.getContext("2d", { alpha: false });
  const bitrate = Math.round(W * H * Math.min(fps, 30) * 0.1 * (fps > 30 ? 1.35 : 1));
  const videoSource = new MB.CanvasSource(canvas, { codec: videoCodec, quality: new MB.Quality({ bitrate }), keyFrameInterval: 2 });
  output.addVideoTrack(videoSource, { frameRate: fps });
  let audioSource = null;
  if (audioCodec) {
    audioSource = new MB.AudioSampleSource({ codec: audioCodec, quality: new MB.Quality({ bitrate: 160000 }) });
    output.addAudioTrack(audioSource);
  }
  await output.start();
  const abort = () => output.cancel().catch(() => {});
  signal?.addEventListener("abort", abort, { once: true });

  const endCard = endCardHost ? 1.5 : 0;
  const frames = Math.max(1, Math.round(outDuration * fps));
  const endFrames = Math.round(endCard * fps);
  const total = frames + endFrames;
  let done = 0;
  const check = () => { if (signal?.aborted) throw new DOMException("Cancelled", "AbortError"); };

  // Punch-in: every other kept part is drawn 12% closer, which hides the jump at each cut.
  const zoomAt = (tOut) => {
    if (!frame.punchIn) return 1;
    let k = 0;
    for (let i = 0; i < segments.length; i++) if (segments[i].outStart <= tOut + 1e-6) k = i;
    return k % 2 ? 1.12 : 1;
  };

  async function videoLoop() {
    // Frames arrive upright (rotation applied). Very large sources are scaled to 2160 on the short side.
    const short = Math.min(info.width, info.height), k = short > 2160 ? 2160 / short : 1;
    const sink = new MB.CanvasSink(info.video, { poolSize: 2, ...(k < 1 ? { width: Math.round(info.width * k), height: Math.round(info.height * k), fit: "fill" } : {}) });
    function* times() { for (let f = 0; f < frames; f++) yield toSource(segments, f / fps) + 1e-4; }
    let f = 0, last = null;
    for await (const wrapped of sink.canvasesAtTimestamps(times())) {
      check();
      const tOut = f / fps;
      const src = wrapped?.canvas || last;
      if (wrapped) last = wrapped.canvas;
      drawPicture(ctx, src, src?.width || 0, src?.height || 0, { fit: frame.fit, focusX: frame.focusX, zoom: zoomAt(tOut) });
      if (cues.length) drawCaption(ctx, cueAt(cues, tOut), tOut, captionStyle);
      await videoSource.add(tOut, 1 / fps);
      f++; done++;
      if (f % 5 === 0) onProgress(done / total);
      if (f >= frames) break;
    }
    for (; f < frames; f++) { check(); await videoSource.add(f / fps, 1 / fps); done++; }   // source ran out early: hold
    for (let e = 0; e < endFrames; e++) {
      check();
      drawEndCard(ctx, endCardHost);
      await videoSource.add((frames + e) / fps, 1 / fps);
      done++;
    }
    videoSource.close();
  }

  async function audioLoop() {
    if (!audioSource) return;
    const sink = new MB.AudioSampleSink(info.audio);
    const fade = Math.round(sr * 0.006);           // 6 ms fades at every cut: no clicks
    let outFrames = 0;
    const emit = async (planes, n) => {
      const data = new Float32Array(n * outCh);
      for (let c = 0; c < outCh; c++) data.set(planes[c].subarray(0, n), c * n);
      const s = new MB.AudioSample({ data, format: "f32-planar", numberOfChannels: outCh, sampleRate: sr, timestamp: outFrames / sr });
      await audioSource.add(s);
      s.close();
      outFrames += n;
    };
    for (const seg of segments) {
      check();
      const want = Math.round((seg.outStart + (seg.end - seg.start)) * sr) - outFrames;   // frames this part should add
      if (want <= 0) continue;
      const parts = [];
      let got = 0;
      for await (const sample of sink.samples(seg.start, seg.end)) {
        check();
        const n = sample.numberOfFrames, c = sample.numberOfChannels, ssr = sample.sampleRate;
        const from = Math.max(0, Math.round((seg.start - sample.timestamp) * ssr));
        const to = Math.min(n, Math.round((seg.end - sample.timestamp) * ssr));
        if (to > from && ssr === sr) {
          const planes = [];
          for (let ch = 0; ch < c; ch++) {
            const a = new Float32Array(n);
            sample.copyTo(a, { planeIndex: ch, format: "f32-planar" });
            planes.push(a.subarray(from, to));
          }
          parts.push(mixTo(planes, outCh));
          got += to - from;
        }
        sample.close();
        if (got >= want) break;
      }
      // Exactly `want` frames per part (pad with silence or trim), so sound and picture stay in step.
      const planes = Array.from({ length: outCh }, () => new Float32Array(want));
      let o = 0;
      for (const p of parts) {
        const take = Math.min(p[0].length, want - o);
        for (let c = 0; c < outCh; c++) planes[c].set(p[c].subarray(0, take), o);
        o += take;
        if (o >= want) break;
      }
      const f = Math.min(fade, want >> 1);
      for (let c = 0; c < outCh; c++) for (let i = 0; i < f; i++) { const g = i / f; planes[c][i] *= g; planes[c][want - 1 - i] *= g; }
      for (let i = 0; i < want; i += sr) await emit(planes.map((p) => p.subarray(i, Math.min(want, i + sr))), Math.min(sr, want - i));
    }
    const tail = Math.round((frames / fps + endCard) * sr) - outFrames;   // silence under the end card
    for (let i = 0; i < tail; i += sr) await emit(Array.from({ length: outCh }, () => new Float32Array(Math.min(sr, tail - i))), Math.min(sr, tail - i));
    audioSource.close();
  }

  try {
    await Promise.all([videoLoop(), audioLoop()]);
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
  onProgress(1);
  const mime = container === "mp4" ? "video/mp4" : "video/webm";
  return { blob: new Blob([output.target.buffer], { type: mime }), mime, ext: container, videoCodec, audioCodec, width: W, height: H, fps, duration: (frames + endFrames) / fps };
}

// Mono, stereo or more channels in; outCh (1 or 2) out.
function mixTo(planes, outCh) {
  const c = planes.length, n = planes[0].length;
  if (c === outCh) return planes;
  if (outCh === 1) {
    const m = new Float32Array(n);
    for (const p of planes) for (let i = 0; i < n; i++) m[i] += p[i] / c;
    return [m];
  }
  if (c === 1) return [planes[0], planes[0]];
  // More than two channels: front left and right, plus half of the centre if there is one.
  const L = Float32Array.from(planes[0]), R = Float32Array.from(planes[1]);
  if (c >= 3) for (let i = 0; i < n; i++) { L[i] += planes[2][i] * 0.5; R[i] += planes[2][i] * 0.5; }
  return [L, R];
}
