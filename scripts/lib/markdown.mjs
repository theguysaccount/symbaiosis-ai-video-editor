// A small Markdown subset for the guides: ## and ### headings, paragraphs, - and 1. lists,
// > quotes, **bold**, *italic*, `code`, [links](url), ``` fenced code, | pipe | tables |, and raw
// HTML blocks (lines starting with "<").

export function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** "---\nkey: value\n---\nbody" → {meta, body} */
export function frontMatter(src) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  if (!m) return { meta: {}, body: src };
  const meta = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"(.*)"$/, "$1");
  }
  return { meta, body: src.slice(m[0].length) };
}

export function inline(s) {
  const out = [];
  let rest = escapeHtml(s);
  // Code spans first so their contents aren't formatted.
  rest = rest.replace(/`([^`]+)`/g, (_, c) => { out.push(`<code>${c}</code>`); return `\u0000${out.length - 1}\u0000`; });
  rest = rest
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${u.replace(/"/g, "%22")}"${/^https?:/.test(u) ? ' rel="noopener"' : ""}>${t}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>");
  return rest.replace(/\u0000(\d+)\u0000/g, (_, i) => out[+i]);
}

export function markdown(src) {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if (/^```/.test(line)) {
      const block = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) block.push(lines[i++]);
      i++;
      html.push(`<pre><code>${escapeHtml(block.join("\n"))}</code></pre>`);
    } else if (/^\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      html.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
    } else if ((m = /^(#{2,4})\s+(.*)$/.exec(line))) {
      const level = m[1].length;
      const id = m[2].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      html.push(`<h${level} id="${id}">${inline(m[2])}</h${level}>`);
      i++;
    } else if (/^\s*</.test(line)) {
      const block = [];
      while (i < lines.length && lines[i].trim()) block.push(lines[i++]);
      html.push(block.join("\n"));
    } else if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      const ordered = /^\d+\.\s+/.test(line);
      const re = ordered ? /^\d+\.\s+/ : /^[-*]\s+/;
      const items = [];
      while (i < lines.length && (re.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        if (re.test(lines[i])) items.push(lines[i].replace(re, ""));
        else items[items.length - 1] += " " + lines[i].trim();
        i++;
      }
      const tag = ordered ? "ol" : "ul";
      html.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</${tag}>`);
    } else if (/^>\s?/.test(line)) {
      const block = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) block.push(lines[i++].replace(/^>\s?/, ""));
      html.push(`<blockquote><p>${inline(block.join(" "))}</p></blockquote>`);
    } else {
      const block = [];
      while (i < lines.length && lines[i].trim() && !/^(#{2,4}\s|[-*]\s|\d+\.\s|>|\s*<|```|\|)/.test(lines[i])) block.push(lines[i++].trim());
      html.push(`<p>${inline(block.join(" "))}</p>`);
    }
  }
  return html.join("\n");
}
