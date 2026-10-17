// Section-aware chunking + BM25 retrieval. No external services, so search works offline.
const STOP = new Set('a an and are as at be by can do does for from has have how i if in is it its of on or our should the their there this to was we what when where which who why will with you your me my about into than then them they us been being after before per up any all not no'.split(' '));

export const tokenize = s => (s.toLowerCase().match(/[a-z0-9$.]+/g) || [])
  .map(t => t.replace(/\.+$/, ''))
  .filter(t => t && !STOP.has(t))
  .map(stem);

function stem(t) {
  if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.length > 4 && t.endsWith('ing')) return t.slice(0, -3);
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

// Headings in plain-text docs: "# Title", "3. Account Provisioning", "4.2 MFA", "Section 5: Reviews", "DEPROVISIONING".
// Short, no trailing period, few words — so numbered list items like "1. Users must enrol MFA." aren't mistaken for headings.
function heading(line) {
  const l = line.trim();
  const md = l.match(/^#{1,6}\s+(.+)/);
  if (md) return md[1].trim();
  if (l.length > 70 || /[.;,]$/.test(l) || l.split(/\s+/).length > 8) return null;
  if (/^(?:section\s+)?\d+(?:\.\d+)*[.):]?\s+[A-Z]/i.test(l)) return l;
  if (/^[A-Z][A-Z0-9 &/()-]{3,}:?$/.test(l)) return l.replace(/:$/, '');
  return null;
}

export function chunk(doc, maxLen = 700) {
  const out = [];
  let section = '';
  let buf = [];
  const flush = () => {
    const text = buf.join('\n').trim();
    if (text) out.push({ docId: doc.id, docTitle: doc.title, section, text });
    buf = [];
  };
  // Very long lines (no line breaks in the source) are split into sentences first.
  const lines = doc.content.split('\n').flatMap(l => l.length > maxLen ? l.split(/(?<=[.!?])\s+/) : [l]);
  for (const line of lines) {
    const h = heading(line);
    if (h) { if (h !== doc.title) { flush(); section = h; } continue; } // the doc's own title isn't content
    if (buf.length && buf.join('\n').length + line.length > maxLen) flush();
    buf.push(line);
  }
  flush();
  return out;
}

export function search(docs, query, k = 6) {
  const chunks = docs.flatMap(d => chunk(d));
  if (!chunks.length) return [];
  // Doc title and section heading count as part of each chunk — they carry a lot of meaning.
  const toks = chunks.map(c => tokenize(`${c.docTitle} ${c.section} ${c.text}`));
  const N = chunks.length;
  const avgdl = toks.reduce((s, t) => s + t.length, 0) / N;
  const df = new Map();
  for (const t of toks) for (const w of new Set(t)) df.set(w, (df.get(w) || 0) + 1);
  const q = [...new Set(tokenize(query))];
  const k1 = 1.4, b = 0.75;
  const scored = chunks.map((c, i) => {
    const tf = new Map();
    for (const w of toks[i]) tf.set(w, (tf.get(w) || 0) + 1);
    let score = 0;
    for (const w of q) {
      const f = tf.get(w);
      if (!f) continue;
      const idf = Math.log(1 + (N - df.get(w) + 0.5) / (df.get(w) + 0.5));
      score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * toks[i].length / avgdl));
    }
    return { ...c, score };
  });
  return scored.filter(c => c.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
}
