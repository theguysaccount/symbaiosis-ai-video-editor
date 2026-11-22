// Minimal static file server for local development and the end-to-end test.
//   node scripts/serve.mjs [dir=dist] [port=4327] [--base /symbaiosis-ai-video-editor]
// --base serves the directory under a path prefix, the way GitHub Pages serves a project site.
// Like GitHub Pages, it sends no cross-origin isolation headers and it answers byte-range requests.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".mp4": "video/mp4",
  ".webm": "video/webm", ".wav": "audio/wav", ".wasm": "application/wasm", ".onnx": "application/octet-stream",
  ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".srt": "text/plain; charset=utf-8",
};

export function serve(dir, port = 0, base = "") {
  const root = path.resolve(dir);
  base = base.replace(/\/$/, "");
  const server = http.createServer((req, res) => {
    let p;
    try { p = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch { res.writeHead(400); return res.end(); }
    if (base) {
      if (p === base) { res.writeHead(301, { Location: base + "/" }); return res.end(); }
      if (!p.startsWith(base + "/")) { res.writeHead(404); return res.end("not found"); }
      p = p.slice(base.length);
    }
    let file = path.join(root, p);
    if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
    try {
      if (fs.statSync(file).isDirectory()) {
        if (!p.endsWith("/")) { res.writeHead(301, { Location: base + p + "/" }); return res.end(); }
        file = path.join(file, "index.html");
      }
      const size = fs.statSync(file).size;
      const head = { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store", "Accept-Ranges": "bytes" };
      const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
      if (m && (m[1] || m[2])) {
        const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
        const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
        if (start > end || start >= size) { res.writeHead(416, { "Content-Range": `bytes */${size}` }); return res.end(); }
        res.writeHead(206, { ...head, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
        return fs.createReadStream(file, { start, end }).pipe(res);
      }
      res.writeHead(200, { ...head, "Content-Length": size });
      if (req.method === "HEAD") return res.end();
      fs.createReadStream(file).pipe(res);
    } catch {
      const nf = path.join(root, "404.html");
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end(fs.existsSync(nf) ? fs.readFileSync(nf) : "not found");
    }
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const bi = args.indexOf("--base");
  const base = bi >= 0 ? args.splice(bi, 2)[1] : "";
  const [dir = "dist", port = "4327"] = args;
  const server = await serve(dir, Number(port), base);
  console.log(`serving ${dir} at http://127.0.0.1:${server.address().port}${base}/`);
}
