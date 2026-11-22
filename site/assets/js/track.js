// Privacy-respecting counts, off unless the site is built with a GoatCounter endpoint
// (repository variable GOATCOUNTER_URL). Sends only an event name and the page path: never the
// video, its name, its words or anything typed. Skipped under Do Not Track or Global Privacy Control.
const endpoint = document.documentElement.dataset.counter || "";
const off = !endpoint || navigator.doNotTrack === "1" || navigator.globalPrivacyControl === true;

function send(params) {
  if (off) return;
  const q = new URLSearchParams({ ...params, rnd: Math.random().toString(36).slice(2) });
  try { fetch(`${endpoint}?${q}`, { mode: "no-cors", credentials: "omit", keepalive: true }); } catch { /* counts are best effort */ }
}

export function pageview() {
  send({ p: location.pathname, t: document.title, r: document.referrer.startsWith(location.origin) ? "" : document.referrer });
}

/** Activation is "export_done": a visitor exported an edited video. */
export function track(name) {
  send({ p: `event/${name}`, t: name, e: "true" });
}
