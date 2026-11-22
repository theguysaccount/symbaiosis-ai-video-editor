// Draw one output frame: the source picture framed for the chosen shape, then the caption.
// The same function draws the live preview (from a <video> element) and the exported file
// (from decoded frames), so what you see is what you get.

export const FORMATS = {
  "9:16": { w: 1080, h: 1920, label: "Vertical 9:16", hint: "TikTok, Reels, Shorts" },
  "4:5": { w: 1080, h: 1350, label: "Portrait 4:5", hint: "Instagram feed" },
  "1:1": { w: 1080, h: 1080, label: "Square 1:1", hint: "Feeds" },
  "16:9": { w: 1920, h: 1080, label: "Wide 16:9", hint: "YouTube" },
};

export const CAPTION_STYLES = {
  pop: { label: "Bold pop" },
  box: { label: "Boxed" },
  clean: { label: "Clean" },
};

export const HIGHLIGHTS = { yellow: "#FFE14D", green: "#5CF2A0", cyan: "#4DD8FF", pink: "#FF6FB5", none: "" };

/** Output size for a format and quality (1080 or 720 on the short side), rounded to even numbers. */
export function outputSize(format, quality = 1080) {
  const f = FORMATS[format] || FORMATS["9:16"];
  const k = quality / Math.min(f.w, f.h);
  return { w: Math.round((f.w * k) / 2) * 2, h: Math.round((f.h * k) / 2) * 2 };
}

/** For "original" shape: the source's own aspect, short side = quality. */
export function originalSize(srcW, srcH, quality = 1080) {
  const k = Math.min(1, quality / Math.min(srcW, srcH));
  return { w: Math.max(2, Math.round((srcW * k) / 2) * 2), h: Math.max(2, Math.round((srcH * k) / 2) * 2) };
}

let blurCanvas = null;
function tiny(src, sw, sh) {
  // A blurred, darkened backdrop without ctx.filter (which older Safari lacks): shrink hard, then stretch.
  const w = 24, h = Math.max(2, Math.round((24 * sh) / sw));
  if (!blurCanvas) blurCanvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
  blurCanvas.width = w; blurCanvas.height = h;
  const c = blurCanvas.getContext("2d");
  c.imageSmoothingQuality = "high";
  c.drawImage(src, 0, 0, w, h);
  return blurCanvas;
}

/**
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} ctx
 * @param {CanvasImageSource|null} src  frame to draw (null draws black)
 * @param {number} sw source display width   @param {number} sh source display height
 * @param {{fit:"fill"|"blur", focusX:number, zoom:number}} frame
 */
export function drawPicture(ctx, src, sw, sh, frame) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  if (!src || !sw || !sh) return;
  const zoom = Math.max(1, frame.zoom || 1);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (frame.fit === "blur" && Math.abs(sw / sh - W / H) > 0.01) {
    const bg = tiny(src, sw, sh);
    const cover = Math.max(W / sw, H / sh);
    const bw = sw * cover, bh = sh * cover;
    ctx.drawImage(bg, (W - bw) / 2, (H - bh) / 2, bw, bh);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, 0, W, H);
    const fit = Math.min(W / sw, H / sh) * zoom;
    const dw = sw * fit, dh = sh * fit;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
    ctx.restore();
    return;
  }
  // Fill: crop the source to the output shape. focusX picks which part of a wide picture to keep.
  const scale = Math.max(W / sw, H / sh) * zoom;
  const vw = W / scale, vh = H / scale;
  const fx = Math.min(1, Math.max(0, frame.focusX ?? 0.5)), fy = Math.min(1, Math.max(0, frame.focusY ?? 0.5));
  const x0 = (sw - vw) * fx, y0 = (sh - vh) * fy;
  ctx.drawImage(src, x0, y0, vw, vh, 0, 0, W, H);
}

function shape(text, o) {
  let t = text;
  if (o.hidePunctuation) t = t.replace(/[.,;:…"“”]+/g, "").replace(/^[¿¡'‘]+|['’]+$/g, "");
  if (o.upper) t = t.toLocaleUpperCase();
  return t;
}

/**
 * Lay a caption out in lines that fit the frame. Exported for tests.
 * @returns {{font:string, size:number, lines:Array<Array<{text:string,width:number,start:number,end:number}>>, lineHeight:number, space:number}}
 */
export function layoutCaption(ctx, cue, o) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const size = Math.round(Math.min(W, H) * 0.085 * ({ s: 0.8, m: 1, l: 1.25 }[o.size] || 1));
  const font = `800 ${size}px Montserrat, "Arial Black", "Helvetica Neue", Arial, sans-serif`;
  ctx.font = font;
  const space = ctx.measureText(" ").width;
  const maxW = W * 0.86;
  const lines = [[]];
  let lineW = 0;
  for (const w of cue.words) {
    const text = shape(w.text, o);
    if (!text) continue;
    const width = ctx.measureText(text).width;
    if (lines.at(-1).length && lineW + space + width > maxW) { lines.push([]); lineW = 0; }
    lines.at(-1).push({ text, width, start: w.start, end: w.end });
    lineW += (lines.at(-1).length > 1 ? space : 0) + width;
  }
  return { font, size, lines: lines.filter((l) => l.length), lineHeight: size * 1.18, space };
}

/**
 * Draw a caption cue at output time t.
 * @param {{style:"pop"|"box"|"clean", position:"top"|"middle"|"lower", size:"s"|"m"|"l", upper:boolean, hidePunctuation:boolean, highlight:string}} o
 */
export function drawCaption(ctx, cue, t, o) {
  if (!cue) return;
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const L = layoutCaption(ctx, cue, o);
  if (!L.lines.length) return;
  const tall = H > W * 1.2;
  const cy = H * ({ top: tall ? 0.22 : 0.16, middle: 0.5, lower: tall ? 0.7 : 0.82 }[o.position] || 0.7);
  const block = L.lines.length * L.lineHeight;
  let y = cy - block / 2 + L.lineHeight / 2;
  const hl = HIGHLIGHTS[o.highlight] ?? HIGHLIGHTS.yellow;
  ctx.save();
  ctx.font = L.font;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.lineJoin = "round";
  for (const line of L.lines) {
    const lw = line.reduce((s, w) => s + w.width, 0) + L.space * (line.length - 1);
    let x = (W - lw) / 2;
    if (o.style === "box") {
      const padX = L.size * 0.32, padY = L.size * 0.12;
      ctx.fillStyle = "rgba(0,0,0,0.78)";
      roundRect(ctx, x - padX, y - L.lineHeight / 2 - padY / 2, lw + padX * 2, L.lineHeight + padY, L.size * 0.22);
      ctx.fill();
    }
    for (const w of line) {
      const active = hl && t >= w.start && t < w.end + 0.04;
      const pop = active && o.style === "pop";
      ctx.save();
      if (pop) {                                   // the spoken word grows a little
        ctx.translate(x + w.width / 2, y);
        ctx.scale(1.08, 1.08);
        ctx.translate(-(x + w.width / 2), -y);
      }
      if (o.style === "pop") {
        ctx.lineWidth = L.size * 0.17;
        ctx.strokeStyle = "#000";
        ctx.strokeText(w.text, x, y);
      } else if (o.style === "clean") {
        ctx.shadowColor = "rgba(0,0,0,0.85)";
        ctx.shadowBlur = L.size * 0.25;
        ctx.shadowOffsetY = L.size * 0.04;
      }
      ctx.fillStyle = active ? hl : "#fff";
      ctx.fillText(w.text, x, y);
      ctx.restore();
      x += w.width + L.space;
    }
    y += L.lineHeight;
  }
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Optional end card: one plain frame naming the tool (off unless the editor ticks the box). */
export function drawEndCard(ctx, host) {
  const W = ctx.canvas.width, H = ctx.canvas.height, s = Math.min(W, H);
  ctx.fillStyle = "#0d1016";
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  ctx.font = `800 ${Math.round(s * 0.07)}px Montserrat, Arial, sans-serif`;
  ctx.fillText("Edited with Symbaiosis", W / 2, H / 2 - s * 0.05);
  ctx.fillStyle = "#9fb3c8";
  ctx.font = `800 ${Math.round(s * 0.04)}px Montserrat, Arial, sans-serif`;
  ctx.fillText(host, W / 2, H / 2 + s * 0.05);
}
