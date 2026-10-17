// Tiny JSON-file store: documents, tasks, emails, metrics.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = path.resolve('data');
const SEED_DIR = path.join(DATA_DIR, 'seed');
const STORE_FILE = path.join(DATA_DIR, 'store.json');

// Minutes of manual work each action replaces (conservative estimates used in the Impact view).
export const MINUTES_SAVED = { question: 12, meeting: 30, agentRun: 45, task: 3, email: 8 };

const empty = () => ({
  docs: [], tasks: [], emails: [],
  metrics: { question: 0, meeting: 0, agentRun: 0, task: 0, email: 0, conflicts: 0 },
  activity: [],
});

let state = empty();

export const id = () => crypto.randomUUID().slice(0, 8);

function titleFrom(content, fallback) {
  const h = content.match(/^#\s+(.+)$/m);
  return h ? h[1].trim() : fallback;
}

const cleanTitle = t => t.replace(/^#+\s*/, '').trim();
const titleKey = t => cleanTitle(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function load() {
  if (fs.existsSync(STORE_FILE)) {
    try { state = { ...empty(), ...JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')) }; } catch { state = empty(); }
  }
  // Seed docs are always (re)loaded from disk so edits to the seed folder show up.
  state.docs = state.docs.filter(d => !d.seed).map(d => ({ ...d, title: cleanTitle(d.title) }));
  for (const file of fs.readdirSync(SEED_DIR).filter(f => /\.(md|txt)$/.test(f)).sort()) {
    const content = fs.readFileSync(path.join(SEED_DIR, file), 'utf8');
    state.docs.push({ id: 'seed-' + file.replace(/\.\w+$/, ''), title: titleFrom(content, file), content, seed: true, addedAt: 0 });
  }
}

function save() {
  const { docs, ...rest } = state;
  fs.writeFileSync(STORE_FILE, JSON.stringify({ ...rest, docs: docs.filter(d => !d.seed) }, null, 2));
}

// A newer document with the same title replaces the older one (a new version of the same guide).
// Search, answers and Autopilot only see the latest version; the Knowledge page shows all of them.
function latestIds() {
  const latest = new Map();
  for (const d of state.docs) {
    const cur = latest.get(titleKey(d.title));
    if (!cur || d.addedAt >= cur.addedAt) latest.set(titleKey(d.title), d);
  }
  return new Set([...latest.values()].map(d => d.id));
}
export const docs = () => { const keep = latestIds(); return state.docs.filter(d => keep.has(d.id)); };
export const allDocs = () => {
  const keep = latestIds();
  return state.docs.map(d => ({ ...d, superseded: !keep.has(d.id) })).sort((a, b) => a.superseded - b.superseded || b.addedAt - a.addedAt);
};
export const tasks = () => state.tasks;
export const emails = () => state.emails;

export function addDoc(title, content) {
  const doc = { id: id(), title: cleanTitle(title?.trim() || titleFrom(content, 'Untitled document')), content, seed: false, addedAt: Date.now() };
  state.docs.push(doc);
  const replaces = state.docs.some(d => d !== doc && titleKey(d.title) === titleKey(doc.title));
  log('doc', `${replaces ? 'New version of' : 'Added document'} “${doc.title}”`);
  save();
  return doc;
}

export function removeDoc(docId) {
  state.docs = state.docs.filter(d => d.id !== docId);
  save();
}

export function addTask({ title, owner = 'Unassigned', due = '', priority = 'medium', source = 'manual', context = '' }) {
  const task = { id: id(), title, owner, due, priority, source, context, status: 'todo', createdAt: Date.now() };
  state.tasks.unshift(task);
  track('task');
  log('task', `Task created: ${title} → ${owner}`);
  save();
  return task;
}

export function updateTask(taskId, patch) {
  const t = state.tasks.find(t => t.id === taskId);
  if (t) Object.assign(t, patch);
  save();
  return t;
}

export function addEmail({ to, subject, body, source = 'manual' }) {
  const email = { id: id(), to, subject, body, source, createdAt: Date.now() };
  state.emails.unshift(email);
  track('email');
  log('email', `Email drafted: ${subject}`);
  save();
  return email;
}

export function track(metric, n = 1) {
  state.metrics[metric] = (state.metrics[metric] || 0) + n;
  save();
}

export function log(kind, text) {
  state.activity.unshift({ kind, text, at: Date.now() });
  state.activity = state.activity.slice(0, 50);
}

export function metrics() {
  const m = state.metrics;
  const minutes = Object.entries(MINUTES_SAVED).reduce((s, [k, v]) => s + (m[k] || 0) * v, 0);
  return { ...m, minutesSaved: minutes, docs: state.docs.length, openTasks: state.tasks.filter(t => t.status !== 'done').length, activity: state.activity.slice(0, 15), rates: MINUTES_SAVED };
}

export function reset() {
  state = empty();
  save();
  load();
}
