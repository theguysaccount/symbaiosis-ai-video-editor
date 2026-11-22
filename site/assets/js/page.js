// Runs on every page: counts the page view (only when counts are switched on) and plays the
// before/after demo videos when they scroll into view, unless the visitor prefers reduced motion.
import { pageview } from "./track.js";

pageview();

const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
for (const v of document.querySelectorAll("video[data-autoplay]")) {
  if (still) { v.controls = true; continue; }
  const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) v.play().catch(() => { v.controls = true; }); else v.pause(); });
  io.observe(v);
}
