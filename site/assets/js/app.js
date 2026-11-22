// The editor: open a video, find pauses and filler words, transcribe, preview the edit, export.
// Everything runs on this device. The only network requests are for this site's own files
// (the page, the speech model and the libraries), never for the video.
import { supported, probe, decodeAudio16k, exportVideo } from "./media.js";
import { loudness, levels, findIslands, speechChunks, RATE } from "./analysis.js";
import { alignWords } from "./align.js";
import { PACING, planEdit, keptWords, captionCues, cueAt, subtitleCues, toSrt, toVtt, transcriptText, toOutput, toSource, segmentAt, isFiller } from "./edit.js";
import { outputSize, originalSize, drawPicture, drawCaption } from "./render.js";
import { track } from "./track.js";

const $ = (id) => document.getElementById(id);
const tool = $("tool");
if (tool) init();

function init() {
  const el = {
    drop: $("drop"), file: $("file"), pick: $("pick"), sample: $("sample"), language: $("language"), work: $("work"),
    canvas: $("preview"), video: $("video"), play: $("play"), scrub: $("scrub"), clock: $("clock"), stats: $("stats"),
    status: $("status"), progress: $("progress"), form: $("settings"), transcript: $("transcript"),
    cutSel: $("cut-sel"), keepSel: $("keep-sel"), editSel: $("edit-sel"), undo: $("undo"),
    exportBtn: $("export"), cancel: $("cancel"), restart: $("restart"), result: $("result"), out: $("out"),
    download: $("download"), srt: $("srt"), vtt: $("vtt"), copy: $("copy"), back: $("back"), share: $("share"),
    meta: $("result-meta"), focusRow: $("focus-row"), fitRow: $("fit-row"),
  };
  const ctx = el.canvas.getContext("2d", { alpha: false });
  const preset = tool.dataset.preset || "default";
  const S = fresh();
  let worker = null, workerReady = null, msgId = 0;
  const waiting = new Map();

  function fresh() {
    return {
      file: null, info: null, pcm: null, db: null, islands: [], raw: [], words: [], sounds: [], heard: 0, done: false,
      overrides: { words: {}, sounds: {}, gaps: {} }, texts: {}, history: [], plan: null, sel: null, run: 0,
      exporting: null, urls: [], language: "en",
    };
  }

  document.fonts?.load?.("800 64px Montserrat").then(() => draw()).catch(() => {});

  // ---------- presets from the landing page ----------
  if (preset === "silence") setRadio("pacing", "tight");
  if (preset === "captions") showTab("captions");
  if (preset === "vertical") showTab("format");

  if (!supported()) {
    $("unsupported").hidden = false;
    el.pick.disabled = el.sample.disabled = true;
  }

  // ---------- choosing a file ----------
  document.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => el.file.click()));
  document.querySelectorAll("[data-sample]").forEach((b) => b.addEventListener("click", () => loadSample()));
  el.pick.addEventListener("click", () => el.file.click());
  el.sample.addEventListener("click", () => loadSample());
  el.file.addEventListener("change", () => { const f = el.file.files?.[0]; if (f) { track("file_added"); start(f); } el.file.value = ""; });
  for (const t of [el.drop, tool]) {
    t.addEventListener("dragover", (e) => { e.preventDefault(); el.drop.classList.add("over"); });
    t.addEventListener("dragleave", () => el.drop.classList.remove("over"));
    t.addEventListener("drop", (e) => {
      e.preventDefault(); el.drop.classList.remove("over");
      const f = [...(e.dataTransfer?.files || [])].find((x) => /^video\//.test(x.type) || /\.(mp4|mov|m4v|webm|mkv)$/i.test(x.name));
      if (f) { track("file_added"); start(f); }
    });
  }

  async function loadSample() {
    track("sample_start");
    setStatus("Loading the sample clip…");
    showWork();
    try {
      const res = await fetch(new URL("../samples/sample.mp4", import.meta.url));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      el.language.value = "en";
      start(new File([blob], "symbaiosis-sample.mp4", { type: "video/mp4" }));
    } catch (e) {
      fail(`Couldn't load the sample clip (${e.message}). Check your connection and try again.`);
    }
  }

  function showWork() {
    const was = el.work.hidden;
    el.drop.hidden = true; el.result.hidden = true; el.work.hidden = false;
    tool.classList.add("working");
    if (was) tool.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }

  // ---------- analysis ----------
  async function start(file) {
    cleanup();
    Object.assign(S, fresh());
    const run = ++S.run;
    S.file = file;
    S.language = el.language.value || "en";
    showWork();
    renderTranscript();
    el.exportBtn.disabled = true;
    setStatus("Reading the video…", 0);
    try {
      const info = await probe(file);
      if (run !== S.run) return;
      S.info = info;
      if (info.duration > 3600) throw new Error("This video is longer than an hour. Trim it into shorter parts first.");
      const url = URL.createObjectURL(file);
      S.urls.push(url);
      el.video.src = url;
      el.video.load();
      sizePreview();
      if (!info.audio) {
        replan();
        setStatus(info.hasAudio ? "This browser can't decode the sound in this file, so pauses and captions can't be found. You can still reframe and export it." : "This video has no sound, so there's nothing to trim or caption. You can still reframe and export it.");
        el.form.elements.captions.checked = false;
        el.exportBtn.disabled = false;
        return;
      }
      setStatus("Listening for pauses…", 0);
      const pcm = await decodeAudio16k(info, { onProgress: (p) => run === S.run && setProgress(p) });
      if (run !== S.run) return;
      S.pcm = pcm;
      S.db = loudness(pcm);
      const lv = levels(S.db);
      S.islands = findIslands(S.db, lv.thresholdDb);
      S.sounds = S.islands.map((s, id) => ({ ...s, id, pending: true }));
      replan();
      if (!S.islands.length) {
        el.exportBtn.disabled = false;
        setStatus("No speech found: the sound is silent or very quiet. Nothing to cut, but you can reframe and export.");
        S.done = true;
        return;
      }
      await transcribe(run);
    } catch (e) {
      if (run === S.run) fail(e.message || String(e));
    }
  }

  function getWorker() {
    if (worker) return worker;
    worker = new Worker(new URL("./asr-worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === "progress") onModelProgress(m);
      else if (m.type === "ready") waiting.get("ready")?.resolve(m);
      else if (m.type === "result") { waiting.get(m.id)?.resolve(m); waiting.delete(m.id); }
      else if (m.type === "error") {
        const w = waiting.get(m.id ?? "ready");
        if (w) { w.reject(new Error(m.message)); waiting.delete(m.id ?? "ready"); }
      }
    };
    worker.onerror = (e) => { for (const w of waiting.values()) w.reject(new Error(e.message || "The speech model stopped.")); waiting.clear(); worker = null; workerReady = null; };
    return worker;
  }

  const files = new Map();
  function onModelProgress(m) {
    files.set(m.file, m);
    let loaded = 0, total = 0;
    for (const f of files.values()) { loaded += f.loaded; total += f.total; }
    if (total) setStatus(`Downloading the speech model: ${(loaded / 1e6).toFixed(0)} of ${(total / 1e6).toFixed(0)} MB. Only the first time; it stays in your browser.`, loaded / total);
  }

  function loadModel(model) {
    getWorker();
    workerReady ??= new Promise((resolve, reject) => {
      waiting.set("ready", { resolve, reject });
      worker.postMessage({ type: "load", model, cacheKey: "symbaiosis-models-v1" });
    }).finally(() => waiting.delete("ready"));
    return workerReady;
  }

  function ask(audio, language, hint) {
    const id = ++msgId;
    return new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      worker.postMessage({ type: "transcribe", id, audio, language, hint });
    });
  }

  const HINTS = {
    en: "Um, uh, so, er, like, you know, hmm.",
    de: "Äh, ähm, also, hm.", fr: "Euh, ben, alors, hum.", es: "Eh, em, pues, mmm.",
    it: "Ehm, eh, allora, mmm.", nl: "Eh, ehm, uhm, nou.", pt: "Hum, ahn, então.",
  };

  async function transcribe(run) {
    const model = S.language === "en" ? "whisper-tiny.en" : "whisper-base";
    setStatus("Pauses found. Loading the speech model for captions and filler words…", 0);
    files.clear();
    try {
      workerReady = null;
      await loadModel(model);
    } catch (e) {
      if (run !== S.run) return;
      setStatus(`The speech model couldn't load (${e.message}). Pauses are cut and you can export; captions and filler words need the model, so try reloading the page.`);
      el.form.elements.captions.checked = false;
      el.exportBtn.disabled = false;
      S.done = true;
      replan();
      return;
    }
    if (run !== S.run) return;
    const chunks = speechChunks(S.islands, S.info.duration, S.db);
    const total = chunks.reduce((s, c) => s + (c.end - c.start), 0);
    let doneSec = 0;
    const t0 = performance.now();
    for (const c of chunks) {
      if (run !== S.run) return;
      setStatus(`Transcribing: ${fmt(doneSec)} of ${fmt(total)} of speech…`, doneSec / total);
      const audio = S.pcm.slice(Math.floor(c.start * RATE), Math.ceil(c.end * RATE));
      let r;
      try { r = await ask(audio, S.language, HINTS[S.language] || ""); } catch (e) {
        if (run === S.run) { setStatus(`Transcription stopped (${e.message}). You can still export what was found.`); el.exportBtn.disabled = false; S.done = true; replan(); }
        return;
      }
      if (run !== S.run) return;
      for (const w of r.words) S.raw.push({ text: w.text, start: w.start + c.start, end: w.end + c.start });
      S.heard = c.end;
      doneSec += c.end - c.start;
      realign();
      replan();
    }
    S.done = true;
    replan();
    el.exportBtn.disabled = false;
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    setStatus(`Ready. Transcribed ${fmt(total)} of speech in ${secs} s, on this device. Review the cuts, then export.`, 1);
    el.progress.hidden = true;
    track("analysis_done");
  }

  function realign() {
    const { words, sounds } = alignWords(S.raw, S.islands);
    S.words = words.map((w, i) => ({ ...w, text: S.texts[i] ?? w.text }));
    // An island the model has already listened to and found no word in is a "sound"; islands not
    // yet transcribed are pending and always kept. Ids are island indexes, so they stay stable.
    S.sounds = sounds.map((s) => ({ start: s.start, end: s.end, id: s.index, pending: s.start >= S.heard }));
  }

  // ---------- the plan ----------
  function settings() {
    const f = el.form.elements;
    return {
      pacing: f.pacing.value, fillers: f.fillers.checked, sounds: f.sounds.checked, captions: f.captions.checked,
      style: f.style.value, position: f.position.value, size: f.size.value, words: Number(f.words.value),
      highlight: f.highlight.value, upper: f.upper.checked, nopunct: f.nopunct.checked,
      format: f.format.value, fit: f.fit.value, focus: Number(f.focus.value) / 100, punch: f.punch.checked,
      quality: Number(f.quality.value), endcard: f.endcard.checked,
    };
  }

  function replan() {
    const o = settings();
    if (!S.info) return;
    const pending = {};
    for (const s of S.sounds) if (s.pending) pending[s.id] = "keep";
    // "Keep all" never shortens a pause, but still removes cut words and fillers.
    const pacing = o.pacing === "off" ? { minSilence: Infinity, pad: Infinity } : PACING[o.pacing] || PACING.natural;
    S.plan = planEdit({
      duration: S.info.duration, words: S.words, sounds: S.sounds, pacing, cutFillers: o.fillers, cutSounds: o.sounds,
      language: S.language, overrides: { ...S.overrides, sounds: { ...S.overrides.sounds, ...pending } }, db: S.db,
    });
    S.cues = o.captions ? captionCues(keptWords(S.words, S.plan), cueShape(o)) : [];
    // Rebuilding the transcript is the slow part; skip it when only the look changed.
    const key = JSON.stringify([o.pacing, o.fillers, o.sounds, S.words.length, S.sounds.length, S.overrides, S.texts, S.done, S.sel]);
    if (key !== lastKey) { lastKey = key; renderTranscript(); }
    renderStats();
    sizePreview();
    draw();
  }
  let lastKey = "";

  function cueShape(o) {
    const wide = o.format === "original" ? S.info && S.info.width > S.info.height * 1.2 : false;
    const chars = { 1: 14, 3: 18, 6: 32 }[o.words] || 18;
    return { maxWords: o.words, maxChars: wide ? chars * 1.6 : chars };
  }

  function renderStats() {
    const p = S.plan;
    if (!p) { el.stats.textContent = ""; return; }
    const fillers = [...p.removedWords].filter((i) => S.words[i] && isFiller(S.words[i].text, S.language) && !S.overrides.words[i]).length;
    const userCut = Object.values(S.overrides.words).filter((v) => v === "cut").length;
    const pauses = p.gaps.filter((g) => g.cut).length;
    const parts = [];
    if (pauses) parts.push(`${pauses} pause${pauses === 1 ? "" : "s"}`);
    if (fillers) parts.push(`${fillers} filler word${fillers === 1 ? "" : "s"}`);
    if (userCut) parts.push(`${userCut} word${userCut === 1 ? "" : "s"} you cut`);
    el.stats.textContent = `${fmt(S.info.duration)} → ${fmt(p.outDuration)}${parts.length ? ` · cut ${parts.join(", ")}` : ""}`;
  }

  // ---------- transcript ----------
  function renderTranscript() {
    const box = el.transcript;
    box.textContent = "";
    if (!S.plan || (!S.words.length && !S.sounds.length)) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = S.info ? (S.done ? "No words were found." : "The transcript appears here as the speech is recognised.") : "";
      box.append(p);
      return;
    }
    const items = [];
    S.words.forEach((w, i) => items.push({ t: w.start, kind: "w", i }));
    for (const s of S.sounds) if (!s.pending && s.end - s.start >= 0.12) items.push({ t: s.start, kind: "s", s });
    for (const g of S.plan.gaps) if (g.end - g.start >= 0.3) items.push({ t: g.start + 1e-3, kind: "g", g });
    items.sort((a, b) => a.t - b.t);
    const frag = document.createDocumentFragment();
    const sel = selRange();
    for (const it of items) {
      const b = document.createElement("button");
      b.type = "button";
      if (it.kind === "w") {
        const w = S.words[it.i];
        b.className = "w";
        b.dataset.i = it.i;
        b.textContent = w.text;
        if (S.plan.removedWords.has(it.i)) b.classList.add("cut");
        if (isFiller(w.text, S.language)) b.classList.add("filler");
        if (w.loose) b.classList.add("loose");
        if (sel && it.i >= sel[0] && it.i <= sel[1]) b.classList.add("sel");
        b.setAttribute("aria-pressed", S.plan.removedWords.has(it.i) ? "true" : "false");
      } else if (it.kind === "s") {
        b.className = "chip snd" + (S.plan.removedSounds.has(it.s.id) ? " cut" : "");
        b.dataset.sound = it.s.id;
        b.textContent = `♪ ${(it.s.end - it.s.start).toFixed(1)}s`;
        b.title = "A sound with no words (a breath, a click, or a word the model missed). Tap to cut or keep it.";
      } else {
        b.className = "chip gap" + (it.g.cut ? " cut" : "") + (it.g.kept ? " kept" : "");
        b.dataset.gap = it.g.key;
        b.textContent = `⏸ ${(it.g.end - it.g.start).toFixed(1)}s`;
        b.title = it.g.cut ? "This pause is shortened. Tap to keep it whole." : "Kept. Tap to shorten it again.";
      }
      frag.append(b);
    }
    box.append(frag);
    updateTools();
  }

  function selRange() {
    if (!S.sel) return null;
    return [Math.min(S.sel.a, S.sel.b), Math.max(S.sel.a, S.sel.b)];
  }

  function updateTools() {
    const r = selRange();
    el.cutSel.disabled = el.keepSel.disabled = !r;
    el.editSel.disabled = !r || r[0] !== r[1];
    el.undo.disabled = !S.history.length;
  }

  function remember() {
    S.history.push(JSON.stringify({ overrides: S.overrides, texts: S.texts }));
    if (S.history.length > 100) S.history.shift();
  }

  let dragging = false;
  el.transcript.addEventListener("pointerdown", (e) => {
    const b = e.target.closest("button.w");
    if (!b) return;
    const i = Number(b.dataset.i);
    if (e.shiftKey && S.sel) S.sel.b = i; else S.sel = { a: i, b: i };
    dragging = e.pointerType === "mouse";
    paintSel();
  });
  el.transcript.addEventListener("pointerover", (e) => {
    if (!dragging) return;
    const b = e.target.closest("button.w");
    if (b && S.sel) { S.sel.b = Number(b.dataset.i); paintSel(); }
  });
  window.addEventListener("pointerup", () => { dragging = false; });
  el.transcript.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.classList.contains("w")) {
      const w = S.words[Number(b.dataset.i)];
      if (w && el.video.paused) seekSource(w.start);
    } else if (b.dataset.gap) {
      remember();
      if (S.overrides.gaps[b.dataset.gap]) delete S.overrides.gaps[b.dataset.gap];
      else S.overrides.gaps[b.dataset.gap] = "keep";
      replan();
    } else if (b.dataset.sound) {
      remember();
      const id = Number(b.dataset.sound);
      S.overrides.sounds[id] = S.plan.removedSounds.has(id) ? "keep" : "cut";
      replan();
    }
  });
  el.transcript.addEventListener("keydown", (e) => {
    if ((e.key === "Delete" || e.key === "Backspace") && S.sel) { e.preventDefault(); mark("cut"); }
  });
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !el.work.hidden && document.activeElement?.tagName !== "INPUT") { e.preventDefault(); undo(); }
  });

  function paintSel() {
    const r = selRange();
    for (const b of el.transcript.querySelectorAll("button.w")) {
      const i = Number(b.dataset.i);
      b.classList.toggle("sel", !!r && i >= r[0] && i <= r[1]);
    }
    updateTools();
  }

  function mark(how) {
    const r = selRange();
    if (!r) return;
    remember();
    for (let i = r[0]; i <= r[1]; i++) S.overrides.words[i] = how;
    replan();
  }
  el.cutSel.addEventListener("click", () => mark("cut"));
  el.keepSel.addEventListener("click", () => mark("keep"));
  el.undo.addEventListener("click", undo);
  function undo() {
    const last = S.history.pop();
    if (!last) return;
    const { overrides, texts } = JSON.parse(last);
    S.overrides = overrides; S.texts = texts;
    S.words = S.words.map((w, i) => ({ ...w, text: S.texts[i] ?? S.raw[i]?.text ?? w.text }));
    replan();
  }
  el.editSel.addEventListener("click", () => {
    const r = selRange();
    if (!r || r[0] !== r[1]) return;
    const i = r[0];
    const b = el.transcript.querySelector(`button.w[data-i="${i}"]`);
    if (!b) return;
    const input = document.createElement("input");
    input.className = "word-edit";
    input.value = S.words[i].text.trim();
    input.setAttribute("aria-label", "Correct this word");
    b.replaceWith(input);
    input.focus(); input.select();
    let done = false;
    const save = (keep) => {
      if (done) return; done = true;
      const v = input.value.trim();
      if (keep && v && v !== S.words[i].text.trim()) { remember(); S.texts[i] = v; S.words[i] = { ...S.words[i], text: v }; }
      replan();
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") save(true); if (e.key === "Escape") save(false); });
    input.addEventListener("blur", () => save(true));
  });

  // ---------- tabs and settings ----------
  for (const t of ["edit", "captions", "format"]) $(`tab-${t}`).addEventListener("click", () => showTab(t));
  function showTab(name) {
    for (const t of ["edit", "captions", "format"]) {
      $(`tab-${t}`).setAttribute("aria-selected", t === name ? "true" : "false");
      $(`pane-${t}`).hidden = t !== name;
    }
  }
  el.form.addEventListener("input", () => replan());
  el.form.addEventListener("change", () => replan());
  function setRadio(name, value) { const r = el.form.querySelector(`input[name="${name}"][value="${value}"]`); if (r) r.checked = true; }

  // ---------- preview ----------
  function frameSize() {
    const o = settings();
    if (!S.info) return outputSize("9:16", 1080);
    return o.format === "original" ? originalSize(S.info.width, S.info.height, 1080) : outputSize(o.format, 1080);
  }

  function sizePreview() {
    const { w, h } = frameSize();
    const k = Math.min(1, 960 / Math.max(w, h));
    const cw = Math.round(w * k), ch = Math.round(h * k);
    if (el.canvas.width !== cw || el.canvas.height !== ch) { el.canvas.width = cw; el.canvas.height = ch; }
    el.canvas.style.aspectRatio = `${w} / ${h}`;
    const o = settings();
    const srcWide = S.info ? S.info.width / S.info.height : 16 / 9;
    const differs = Math.abs(srcWide - w / h) > 0.02;
    el.fitRow.hidden = !differs;
    el.focusRow.hidden = !differs || o.fit !== "fill" || srcWide < w / h;
  }

  function zoomAt(tOut) {
    if (!settings().punch || !S.plan) return 1;
    let k = 0;
    const segs = S.plan.segments;
    for (let i = 0; i < segs.length; i++) if (segs[i].outStart <= tOut + 1e-6) k = i;
    return k % 2 ? 1.12 : 1;
  }

  function draw() {
    if (!S.info || !S.plan) return;
    const o = settings();
    const v = el.video;
    const tSrc = v.currentTime || 0;
    const tOut = toOutput(S.plan.segments, tSrc);
    const ready = v.readyState >= 2;
    drawPicture(ctx, ready ? v : null, v.videoWidth, v.videoHeight, { fit: o.fit, focusX: o.focus, zoom: zoomAt(tOut) });
    if (o.captions && S.cues?.length) drawCaption(ctx, cueAt(S.cues, tOut), tOut, captionOpts(o));
    el.clock.textContent = `${fmt(tOut)} / ${fmt(S.plan.outDuration)}`;
    if (!scrubbing) el.scrub.value = String(Math.round((tOut / Math.max(0.001, S.plan.outDuration)) * 1000));
  }

  function captionOpts(o) {
    return { style: o.style, position: o.position, size: o.size, upper: o.upper, hidePunctuation: o.nopunct, highlight: o.highlight };
  }

  let raf = 0, jumpTimer = 0;
  function loop() {
    cancelAnimationFrame(raf);
    const v = el.video;
    const step = () => {
      if (v.paused || v.ended) { draw(); return; }
      skipCuts();
      draw();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  // While playing, jump over cut parts. A timer fires just before the end of the current kept
  // part so the jump lands close to the cut; the frame loop catches anything it misses.
  function skipCuts() {
    const v = el.video, segs = S.plan?.segments || [];
    const t = v.currentTime;
    let i = segmentAt(segs, t);
    if (i < 0) {
      const next = segs.find((s) => s.start > t);
      if (!next) { v.pause(); seekSource(segs.length ? segs[0].start : 0); return; }
      v.currentTime = next.start;
      i = segs.indexOf(next);
    }
    clearTimeout(jumpTimer);
    const left = (segs[i].end - v.currentTime) / (v.playbackRate || 1);
    if (left < 1.5) jumpTimer = setTimeout(() => { if (!v.paused && segmentAt(segs, v.currentTime) === i) { const n = segs[i + 1]; if (n) v.currentTime = n.start; else v.pause(); } }, Math.max(0, left * 1000 - 15));
  }

  el.play.addEventListener("click", async () => {
    const v = el.video;
    if (!S.plan) return;
    if (v.paused) {
      if (segmentAt(S.plan.segments, v.currentTime) < 0 || v.ended) seekSource(S.plan.segments[0]?.start || 0);
      try { await v.play(); } catch { /* autoplay policy: the user can press again */ }
    } else v.pause();
  });
  el.video.addEventListener("play", () => { el.play.textContent = "❚❚"; el.play.setAttribute("aria-label", "Pause"); loop(); });
  el.video.addEventListener("pause", () => { el.play.textContent = "▶"; el.play.setAttribute("aria-label", "Play the edit"); clearTimeout(jumpTimer); draw(); });
  el.video.addEventListener("seeked", draw);
  el.video.addEventListener("loadeddata", draw);
  el.video.addEventListener("error", () => { if (S.info) setStatus("This browser can't play this file for the preview, but the export can still work."); });
  let scrubbing = false;
  el.scrub.addEventListener("input", () => {
    scrubbing = true;
    if (!S.plan) return;
    seekSource(toSource(S.plan.segments, (Number(el.scrub.value) / 1000) * S.plan.outDuration));
  });
  el.scrub.addEventListener("change", () => { scrubbing = false; });
  function seekSource(t) { el.video.currentTime = Math.max(0, Math.min(t, (S.info?.duration || 0) - 0.01)); draw(); }

  // ---------- export ----------
  el.exportBtn.addEventListener("click", async () => {
    if (!S.info || !S.plan || S.exporting) return;
    const o = settings();
    el.video.pause();
    const ac = new AbortController();
    S.exporting = ac;
    el.exportBtn.disabled = true; el.cancel.hidden = false; el.restart.disabled = true;
    tool.classList.add("busy");
    el.progress.hidden = false;
    setStatus("Exporting: 0%", 0);
    const t0 = performance.now();
    try {
      await document.fonts?.load?.("800 64px Montserrat");
      const size = o.format === "original" ? originalSize(S.info.width, S.info.height, o.quality) : outputSize(o.format, o.quality);
      const kept = keptWords(S.words, S.plan);
      const cues = o.captions ? captionCues(kept, cueShape(o)) : [];
      const r = await exportVideo({
        info: S.info, segments: S.plan.segments, outDuration: S.plan.outDuration, size,
        frame: { fit: o.fit, focusX: o.focus, punchIn: o.punch }, cues, captionStyle: captionOpts(o),
        endCardHost: o.endcard ? location.host + location.pathname.replace(/\/[^/]*$/, "/").replace(/\/$/, "") : null,
        signal: ac.signal,
        onProgress: (p) => setStatus(`Exporting: ${Math.round(p * 100)}%`, p),
      });
      showResult(r, kept, (performance.now() - t0) / 1000);
      track("export_done");
    } catch (e) {
      if (e.name === "AbortError" || ac.signal.aborted) setStatus("Export cancelled.");
      else setStatus(`Export failed: ${e.message || e}. Try 720p, or a shorter clip.`, null, true);
    } finally {
      S.exporting = null;
      el.exportBtn.disabled = false; el.cancel.hidden = true; el.restart.disabled = false;
      tool.classList.remove("busy");
    }
  });
  el.cancel.addEventListener("click", () => S.exporting?.abort());

  function showResult(r, kept, secs) {
    const base = (S.file?.name || "video").replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-").slice(0, 60) || "video";
    const url = URL.createObjectURL(r.blob);
    S.urls.push(url);
    el.out.src = url;
    el.download.href = url;
    el.download.download = `${base}-edit.${r.ext}`;
    el.download.textContent = `Download ${r.ext.toUpperCase()} (${(r.blob.size / 1e6).toFixed(1)} MB)`;
    const subs = subtitleCues(kept);
    const srt = URL.createObjectURL(new Blob([toSrt(subs)], { type: "text/plain" }));
    const vtt = URL.createObjectURL(new Blob([toVtt(subs)], { type: "text/vtt" }));
    S.urls.push(srt, vtt);
    el.srt.href = srt; el.srt.download = `${base}-edit.srt`;
    el.vtt.href = vtt; el.vtt.download = `${base}-edit.vtt`;
    el.srt.parentElement.hidden = !kept.length;
    el.copy.onclick = async () => {
      try { await navigator.clipboard.writeText(transcriptText(kept)); el.copy.textContent = "Copied"; } catch { el.copy.textContent = "Couldn't copy"; }
      setTimeout(() => { el.copy.textContent = "Copy transcript"; }, 1600);
    };
    const codec = `${r.videoCodec === "avc" ? "H.264" : r.videoCodec.toUpperCase()}${r.audioCodec ? ` + ${r.audioCodec === "aac" ? "AAC" : r.audioCodec.toUpperCase()}` : ""}`;
    el.meta.textContent = `${r.width}×${r.height}, ${fmt(r.duration)}, ${r.fps} fps, ${codec}. Made in ${secs.toFixed(0)} s. Cut from ${fmt(S.info.duration)}.`;
    el.meta.dataset.duration = String(r.duration);
    el.meta.dataset.width = String(r.width);
    el.meta.dataset.height = String(r.height);
    el.work.hidden = true;
    el.result.hidden = false;
    el.result.scrollIntoView({ behavior: "smooth", block: "start" });
    setStatus("Done.", 1);
  }

  el.back.addEventListener("click", () => { el.result.hidden = true; el.work.hidden = false; });
  el.share.addEventListener("click", async () => {
    const url = document.querySelector('link[rel="canonical"]')?.href || location.href;
    const data = { title: "Symbaiosis: free in-browser video editor", text: "Cuts pauses and ums, adds captions, exports vertical. Runs in the browser; the video never leaves your device.", url };
    try {
      if (navigator.share) await navigator.share(data);
      else { await navigator.clipboard.writeText(url); el.share.textContent = "Link copied"; setTimeout(() => { el.share.textContent = "Share this free tool"; }, 1600); }
    } catch { /* the visitor closed the share sheet */ }
  });
  el.restart.addEventListener("click", () => {
    cleanup();
    Object.assign(S, fresh());
    el.work.hidden = true; el.result.hidden = true; el.drop.hidden = false;
    tool.classList.remove("working");
    el.progress.hidden = false;
  });

  function cleanup() {
    S.run++;
    S.exporting?.abort();
    el.video.pause();
    el.video.removeAttribute("src");
    el.video.load();
    for (const u of S.urls) URL.revokeObjectURL(u);
    S.urls = [];
    S.info?.input?.dispose?.();
  }

  // ---------- status ----------
  function setStatus(text, progress = null, error = false) {
    el.status.textContent = text;
    el.status.classList.toggle("error", !!error);
    if (progress === null) el.progress.removeAttribute("value");
    else { el.progress.hidden = false; el.progress.value = Math.max(0, Math.min(1, progress)); }
    tool.dataset.status = text;
  }
  function setProgress(p) { el.progress.value = p; }
  function fail(msg) { setStatus(msg, 0, true); el.progress.hidden = true; }

  // Expose state for the automated self-test (read-only use).
  window.__symbaiosis = { state: S, settings, replan };
}

function fmt(t) {
  if (!Number.isFinite(t)) return "0:00";
  const s = Math.max(0, t);
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${m}:${r < 10 ? "0" : ""}${r.toFixed(1)}`;
}
