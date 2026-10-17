import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as store from './lib/store.js';
import { ask, meeting, autopilot } from './lib/features.js';
import { live, provider, MODEL } from './lib/llm.js';

const PORT = process.env.PORT || 3000;
const PUBLIC = path.resolve('public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

store.load();

// Optional shared passcode for public deployments: the browser shows a sign-in prompt
// (any username, password = NEXUS_PASSCODE). Unset locally, so nothing changes in development.
const PASSCODE = process.env.NEXUS_PASSCODE;
function authorized(req) {
  if (!PASSCODE) return true;
  const [scheme, encoded] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Basic' || !encoded) return false;
  const given = Buffer.from(Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':'));
  const want = Buffer.from(PASSCODE);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

async function body(req) {
  let raw = '';
  for await (const c of req) { raw += c; if (raw.length > 5e6) throw new Error('Payload too large'); }
  return raw ? JSON.parse(raw) : {};
}

const routes = {
  'GET /api/status': () => ({ mode: live() ? 'live' : 'demo' }),
  'GET /api/docs': () => store.allDocs().map(({ content, ...d }) => ({ ...d, words: content.split(/\s+/).length, preview: content.replace(/^#.*$/m, '').trim().slice(0, 160) })),
  'GET /api/doc': (_, q) => store.allDocs().find(d => d.id === q.get('id')) || null,
  'POST /api/docs': b => store.addDoc(b.title, b.content),
  'DELETE /api/docs': (_, q) => (store.removeDoc(q.get('id')), { ok: true }),
  'GET /api/tasks': () => store.tasks(),
  'POST /api/tasks': b => (Array.isArray(b.tasks) ? b.tasks : [b]).map(t => store.addTask(t)),
  'PATCH /api/tasks': b => store.updateTask(b.id, b.patch),
  'GET /api/emails': () => store.emails(),
  'POST /api/emails': b => store.addEmail(b),
  'GET /api/metrics': () => store.metrics(),
  'GET /api/sample-meeting': () => ({ transcript: fs.readFileSync('data/sample-meeting.txt', 'utf8') }),
  'POST /api/ask': b => ask(b.question, b.history || []),
  'POST /api/meeting': b => meeting(b.transcript),
  'POST /api/reset': () => (store.reset(), { ok: true }),
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!authorized(req)) {
    res.writeHead(401, { 'www-authenticate': 'Basic realm="Nexus", charset="UTF-8"', 'content-type': 'text/plain' });
    return res.end('Passcode required');
  }
  try {
    if (url.pathname === '/api/autopilot' && req.method === 'POST') {
      const { goal } = await body(req);
      res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache' });
      const emit = e => res.write(JSON.stringify(e) + '\n');
      try { await autopilot(goal, emit); } catch (err) { emit({ type: 'error', text: err.message }); }
      return res.end();
    }
    const handler = routes[`${req.method} ${url.pathname}`];
    if (handler) return json(res, 200, await handler(req.method === 'GET' || req.method === 'DELETE' ? {} : await body(req), url.searchParams));

    const file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
    if (file.startsWith(PUBLIC) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      return fs.createReadStream(file).pipe(res);
    }
    json(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(err);
    json(res, 500, { error: err.message });
  }
}).listen(PORT, () => {
  console.log(`\n  Nexus running → http://localhost:${PORT}`);
  console.log(`  Mode: ${live() ? `LIVE (${provider()} · ${MODEL})` : 'OFFLINE (set GEMINI_API_KEY for full AI)'}\n`);
});
