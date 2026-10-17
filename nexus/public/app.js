const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const api = async (path, opts = {}) => {
  const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...opts, body: opts.body && JSON.stringify(opts.body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
};
const toast = msg => { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2400); };
const thinking = () => '<div class="thinking"><span></span><span></span><span></span></div>';
const COLORS = ['#5b5bf6', '#12a37a', '#e0465e', '#d97706', '#0ea5e9', '#8b5cf6', '#db2777'];
const avatar = name => {
  const initials = (name || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const color = COLORS[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % COLORS.length];
  return `<span class="avatar" style="background:${color}" title="${esc(name)}">${esc(initials)}</span>`;
};

// Tiny markdown: bold, italics, code, bullets, paragraphs, and [n] citation chips.
function md(text, cite = true) {
  let h = esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|\W)_(.+?)_(?=\W|$)/g, '$1<i>$2</i>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  if (cite) h = h.replace(/\[(\d+)\]/g, '<span class="cite" data-n="$1">$1</span>');
  const out = []; let list = false;
  for (const line of h.split('\n')) {
    const li = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)/);
    if (li) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${li[1]}</li>`); continue; }
    if (list) { out.push('</ul>'); list = false; }
    if (line.trim()) out.push(`<p>${line.replace(/^#+\s*/, '')}</p>`);
  }
  if (list) out.push('</ul>');
  return out.join('');
}

/* ───────── Navigation ───────── */
function show(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.view === view));
  ({ tasks: renderTasks, knowledge: renderDocs, impact: renderImpact })[view]?.();
  if (view === 'ask') $('#askInput').focus();
}
document.querySelectorAll('#nav a').forEach(a => a.onclick = () => show(a.dataset.view));
document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); show('ask'); } });

async function refreshCounts() {
  const [m, docs] = await Promise.all([api('/api/metrics'), api('/api/docs')]);
  $('#taskCount').textContent = m.openTasks || '';
  $('#docCount').textContent = docs.filter(d => !d.superseded).length;
  const mins = m.minutesSaved;
  $('#savedValue').textContent = mins >= 60 ? `${(mins / 60).toFixed(1)} hrs` : `${mins} min`;
}

/* ───────── Ask ───────── */
const SUGGESTIONS = [
  { q: "What's the daily meal allowance when travelling?", tag: 'conflict' },
  { q: 'How many PTO days can I carry over?' },
  { q: 'When can a new engineer get production database access?' },
  { q: 'When is Fleet Insights generally available, and what are the risks?' },
  { q: 'Should I submit expenses in Expensify or Ramp?' },
];
$('#suggestions').innerHTML = SUGGESTIONS.map(s => `<button class="chip">${esc(s.q)}${s.tag ? '<span class="tag">⚠ ' + s.tag + '</span>' : ''}</button>`).join('');
$('#suggestions').onclick = e => { const c = e.target.closest('.chip'); if (c) askQuestion(c.firstChild.textContent); };

const history = [];
let sourcesByAnswer = {};
$('#askForm').onsubmit = e => { e.preventDefault(); const q = $('#askInput').value.trim(); if (q) askQuestion(q); };

async function askQuestion(q) {
  $('#askInput').value = '';
  $('#askHero')?.remove();
  const id = 'a' + Date.now();
  const block = document.createElement('div');
  block.innerHTML = `<div class="q">${esc(q)}</div><div class="answer" id="${id}">${thinking()}</div>`;
  $('#thread').appendChild(block);
  block.scrollIntoView({ behavior: 'smooth', block: 'end' });
  try {
    const r = await api('/api/ask', { method: 'POST', body: { question: q, history } });
    r.answer = String(r.answer || ''); r.citations ||= [];
    history.push({ q, a: r.answer.slice(0, 600) });
    sourcesByAnswer[id] = r.citations;
    renderSources(r.citations);
    const conflicts = (r.conflicts || []).map(c => `
      <div class="conflict">
        <div class="conflict-title">⚠ Conflicting sources detected</div>
        <div>${md(c.summary)}</div>
        <div>${md('**Resolution:** ' + c.resolution)}</div>
      </div>`).join('');
    const actions = (r.actions || []).map(a => `<button class="btn sm" data-task="${esc(a.title)}" data-owner="${esc(a.owner || 'Me')}">+ Task: ${esc(a.title)}</button>`).join('');
    $('#' + id).innerHTML = `
      ${r.notice ? `<div class="notice">⚠ ${esc(r.notice)}</div>` : ''}
      ${md(r.answer)}
      ${conflicts}
      <div class="meta">
        <span class="pill ${esc(r.confidence)}">${esc(r.confidence)} confidence</span>
        <span class="pill neutral">${r.citations.filter(c => c.used).length} sources cited</span>
        ${actions}
      </div>
      ${r.followups?.length ? `<div class="chips">${r.followups.map(f => `<button class="chip follow">${esc(f)}</button>`).join('')}</div>` : ''}`;
    const el = $('#' + id);
    el.querySelectorAll('.cite').forEach(c => c.onclick = () => { renderSources(sourcesByAnswer[id]); flashSource(c.dataset.n); });
    el.querySelectorAll('.follow').forEach(c => c.onclick = () => askQuestion(c.textContent));
    el.querySelectorAll('[data-task]').forEach(b => b.onclick = async () => {
      await api('/api/tasks', { method: 'POST', body: { title: b.dataset.task, owner: b.dataset.owner, priority: 'medium', source: 'ask' } });
      b.disabled = true; b.textContent = '✓ Added to tasks'; refreshCounts();
    });
    refreshCounts();
  } catch (err) {
    $('#' + id).innerHTML = `<span style="color:var(--bad)">Error: ${esc(err.message)}</span>`;
  }
}

function renderSources(cites) {
  $('#sourceList').innerHTML = cites.length ? cites.map(c => `
    <div class="source ${c.used ? '' : 'unused'}" id="src-${c.n}" data-doc="${esc(c.docId)}">
      <div class="source-head"><span class="cite">${c.n}</span><span>${esc(c.docTitle)}</span></div>
      ${c.section && c.section !== c.docTitle ? `<div class="source-sec">${esc(c.section)}</div>` : ''}
      <div class="source-text">${esc(c.text)}</div>
    </div>`).join('') : '<div class="muted small">No sources matched.</div>';
  $('#sourceList').querySelectorAll('.source').forEach(s => s.onclick = () => openDoc(s.dataset.doc));
}
function flashSource(n) {
  const s = $('#src-' + n); if (!s) return;
  s.scrollIntoView({ behavior: 'smooth', block: 'center' });
  s.classList.add('flash'); setTimeout(() => s.classList.remove('flash'), 1400);
}

/* ───────── Meetings ───────── */
$('#loadSample').onclick = async () => { $('#transcript').value = (await api('/api/sample-meeting')).transcript; };
$('#analyze').onclick = async () => {
  const transcript = $('#transcript').value.trim();
  if (!transcript) return toast('Paste a transcript or load the sample first');
  const btn = $('#analyze'); btn.disabled = true; btn.textContent = 'Analyzing…';
  $('#meetingOut').innerHTML = `<div class="card" style="margin-top:18px">${thinking()} <span class="muted">Extracting decisions, owners and risks, and cross-checking your knowledge base…</span></div>`;
  try { renderMeeting(await api('/api/meeting', { method: 'POST', body: { transcript } })); refreshCounts(); }
  catch (err) { $('#meetingOut').innerHTML = `<div class="card" style="margin-top:18px;color:var(--bad)">Error: ${esc(err.message)}</div>`; }
  finally { btn.disabled = false; btn.textContent = 'Analyze meeting'; }
};

function renderMeeting(m) {
  // Normalise model output so a missing or differently-shaped field never breaks the view.
  for (const k of ['decisions', 'actions', 'risks', 'open_questions', 'doc_updates']) m[k] = Array.isArray(m[k]) ? m[k] : [];
  m.decisions = m.decisions.map(d => typeof d === 'string' ? { text: d } : d);
  m.risks = m.risks.map(r => typeof r === 'string' ? { text: r, severity: 'medium' } : r);
  m.actions = m.actions.map(a => ({ owner: 'Unassigned', priority: 'medium', ...a }));
  m.followup_email = { to: 'Attendees', subject: 'Meeting recap', body: '', ...(m.followup_email || {}) };
  const sev = s => `<span class="pill ${s === 'high' ? 'high-sev' : s === 'low' ? 'low-sev' : 'medium'}">${esc(s)}</span>`;
  $('#meetingOut').innerHTML = `
  ${m.notice ? `<div class="notice" style="margin-top:18px">⚠ ${esc(m.notice)}</div>` : ''}
  <div class="m-grid">
    <div class="card wide summary"><h3>${esc(m.title)}</h3>${md(m.summary, false)}
      <div class="meta"><span class="pill neutral">${m.decisions.length} decisions</span><span class="pill neutral">${m.actions.length} actions</span><span class="pill neutral">${m.risks.length} risks</span><span class="pill neutral">${m.open_questions.length} open questions</span></div>
    </div>
    <div class="card wide">
      <div class="row" style="margin-bottom:8px"><div class="panel-title" style="margin:0">Action items</div><span class="spacer"></span><button class="btn primary sm" id="pushTasks">Push ${m.actions.length} to task board →</button></div>
      <table class="actions-table"><thead><tr><th></th><th>Action</th><th>Owner</th><th>Due</th><th>Priority</th></tr></thead><tbody>
      ${m.actions.map((a, i) => `<tr><td><input type="checkbox" checked data-i="${i}" style="width:auto"></td><td>${esc(a.title)}</td><td><span class="row">${avatar(a.owner)}${esc(a.owner)}</span></td><td>${esc(a.due || '—')}</td><td>${sev(a.priority)}</td></tr>`).join('')}
      </tbody></table>
    </div>
    <div class="card"><div class="panel-title">Decisions</div><ul class="list">${m.decisions.map(d => `<li><span class="bullet">✓</span>${esc(d.text)}</li>`).join('') || '<li class="muted">None recorded</li>'}</ul></div>
    <div class="card"><div class="panel-title">Risks</div><ul class="list">${m.risks.map(r => `<li><span class="bullet" style="background:var(--bad-soft);color:var(--bad)">!</span><span style="flex:1">${esc(r.text)}</span>${sev(r.severity)}</li>`).join('') || '<li class="muted">None flagged</li>'}</ul></div>
    <div class="card"><div class="panel-title">Open questions</div><ul class="list">${m.open_questions.map(q => `<li><span class="bullet">?</span>${esc(q)}</li>`).join('') || '<li class="muted">None</li>'}</ul></div>
    <div class="card drift"><div class="panel-title">🔄 Knowledge drift detected</div>
      ${m.doc_updates?.length ? `<ul class="list">${m.doc_updates.map(u => `<li><span class="bullet">▤</span><div><b>${esc(u.doc)}</b><div class="muted small">${esc(u.suggestion)}</div></div></li>`).join('')}</ul>` : '<div class="muted small">No documents are contradicted by this meeting.</div>'}
    </div>
    <div class="card wide"><div class="row"><div class="panel-title" style="margin:0">Follow-up email draft</div><span class="spacer"></span><button class="btn sm" id="copyEmail">Copy</button><button class="btn sm" id="saveEmail">Save draft</button></div>
      <div class="muted small" style="margin-top:8px">To: ${esc(m.followup_email.to)} · <b>${esc(m.followup_email.subject)}</b></div>
      <pre class="email">${esc(m.followup_email.body)}</pre>
    </div>
  </div>`;
  $('#pushTasks').onclick = async e => {
    const picked = [...document.querySelectorAll('#meetingOut input[type=checkbox]:checked')].map(c => ({ ...m.actions[c.dataset.i], source: 'meeting', context: m.title }));
    if (!picked.length) return toast('Select at least one action');
    await api('/api/tasks', { method: 'POST', body: { tasks: picked } });
    e.target.disabled = true; e.target.textContent = `✓ ${picked.length} tasks created`;
    toast(`${picked.length} tasks added to the board`); refreshCounts();
  };
  $('#copyEmail').onclick = () => { navigator.clipboard.writeText(`Subject: ${m.followup_email.subject}\n\n${m.followup_email.body}`); toast('Email copied'); };
  $('#saveEmail').onclick = async e => { await api('/api/emails', { method: 'POST', body: { ...m.followup_email, source: 'meeting' } }); e.target.disabled = true; e.target.textContent = '✓ Saved'; refreshCounts(); };
}

/* ───────── Autopilot ───────── */
const GOALS = [
  'Onboard Priya Shah as a backend engineer starting Monday',
  'Plan my team trip to London next month within policy',
  'Prepare the Fleet Insights private beta launch',
  'Respond to a suspected phishing incident on my laptop',
];
$('#goalChips').innerHTML = GOALS.map(g => `<button class="chip">${esc(g)}</button>`).join('');
$('#goalChips').onclick = e => { const c = e.target.closest('.chip'); if (c) { $('#goalInput').value = c.textContent; runGoal(c.textContent); } };
$('#goalForm').onsubmit = e => { e.preventDefault(); const g = $('#goalInput').value.trim(); if (g) runGoal(g); };

const TOOL_ICONS = { search_knowledge: '⌕', create_task: '☑', draft_email: '✉', list_tasks: '≡' };
async function runGoal(goal) {
  const trace = $('#trace');
  const btn = $('#goalForm button'); btn.disabled = true;
  trace.innerHTML = '';
  const add = (cls, icon, html) => { const d = document.createElement('div'); d.className = 'step ' + cls; d.innerHTML = `<div class="step-ic">${icon}</div><div class="step-body">${html}</div>`; trace.appendChild(d); d.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };
  add('thought', '…', `<span class="muted">Planning: “${esc(goal)}”</span>`);
  try {
    const res = await fetch('/api/autopilot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goal }) });
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const ev = JSON.parse(buf.slice(0, nl)); buf = buf.slice(nl + 1);
        if (ev.type === 'thought') add('thought', '💭', esc(ev.text));
        if (ev.type === 'tool') add('tool', TOOL_ICONS[ev.name] || '⚙', `<div class="tool-name">${esc(ev.name)}</div><div class="tool-args">${esc(formatArgs(ev.input))}</div>`);
        if (ev.type === 'result') add('result', '✓', `<details><summary>${esc(ev.output.split('\n')[0].slice(0, 120))}${ev.output.length > 120 || ev.output.includes('\n') ? '…' : ''}</summary><div class="tool-args">${esc(ev.output)}</div></details>`);
        if (ev.type === 'final') add('final', '✦', md(ev.text, false) + `<div class="meta"><button class="btn sm" onclick="document.querySelector('[data-view=tasks]').click()">View tasks →</button></div>`);
        if (ev.type === 'error') add('error', '!', `<span style="color:var(--bad)">${esc(ev.text)}</span>`);
      }
    }
  } catch (err) { add('error', '!', esc(err.message)); }
  btn.disabled = false; refreshCounts();
}
const formatArgs = o => Object.entries(o || {}).map(([k, v]) => `${k}: ${typeof v === 'string' && v.length > 240 ? v.slice(0, 240) + '…' : typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n');

/* ───────── Tasks ───────── */
const COLS = [['todo', 'To do'], ['doing', 'In progress'], ['done', 'Done']];
const NEXT = { todo: 'doing', doing: 'done', done: 'todo' };
async function renderTasks() {
  const [tasks, emails] = await Promise.all([api('/api/tasks'), api('/api/emails')]);
  $('#board').innerHTML = COLS.map(([k, label]) => {
    const ts = tasks.filter(t => t.status === k);
    return `<div class="col"><div class="col-head"><span>${label}</span><span>${ts.length}</span></div>
      ${ts.map(t => `<div class="task ${k}" data-id="${t.id}" data-status="${k}">
        <div class="task-title">${esc(t.title)}</div>
        ${t.context ? `<div class="task-ctx">${esc(t.context)}</div>` : ''}
        <div class="task-meta">${avatar(t.owner)}<span>${esc(t.owner)}</span>${t.due ? `<span>· ${esc(t.due)}</span>` : ''}<span class="spacer"></span>
        <span class="pill ${t.priority === 'high' ? 'high-sev' : t.priority === 'low' ? 'low-sev' : 'medium'}">${esc(t.priority)}</span><span class="src">${esc(t.source)}</span></div>
      </div>`).join('') || '<div class="empty">Nothing here yet</div>'}</div>`;
  }).join('');
  $('#board').querySelectorAll('.task').forEach(el => el.onclick = async () => {
    await api('/api/tasks', { method: 'PATCH', body: { id: el.dataset.id, patch: { status: NEXT[el.dataset.status] } } });
    renderTasks(); refreshCounts();
  });
  $('#emails').innerHTML = emails.map(e => `<div class="card email-card"><div class="to">To: ${esc(e.to)} · <span class="src">${esc(e.source)}</span></div><div class="subj">${esc(e.subject)}</div><pre class="email">${esc(e.body)}</pre></div>`).join('') || '<div class="empty card">Email drafts from meetings and Autopilot appear here.</div>';
}

/* ───────── Knowledge ───────── */
async function renderDocs() {
  const docs = await api('/api/docs');
  $('#docGrid').innerHTML = docs.map(d => `<div class="card doc ${d.superseded ? 'superseded' : ''}" data-id="${d.id}">
      ${d.superseded ? '<span class="pill neutral" style="align-self:flex-start;margin-bottom:8px">Replaced by newer version · not searched</span>' : ''}
      <div class="doc-title">${esc(d.title)}</div><div class="doc-prev">${esc(d.preview)}…</div>
      <div class="doc-foot"><span>${d.words} words · ${d.seed ? 'sample' : 'uploaded ' + new Date(d.addedAt).toLocaleDateString()}</span>${d.seed ? '' : `<button class="btn sm ghost" data-del="${d.id}">Remove</button>`}</div></div>`).join('');
  $('#docGrid').querySelectorAll('.doc').forEach(el => el.onclick = e => {
    if (e.target.dataset.del) { e.stopPropagation(); api('/api/docs?id=' + e.target.dataset.del, { method: 'DELETE' }).then(() => { renderDocs(); refreshCounts(); }); return; }
    openDoc(el.dataset.id);
  });
}
async function openDoc(id) {
  const d = await api('/api/doc?id=' + encodeURIComponent(id));
  if (!d) return;
  $('#modalBody').innerHTML = `<div class="row"><h2 style="font-size:20px">${esc(d.title)}</h2><span class="spacer"></span><button class="btn sm" onclick="document.getElementById('modal').close()">Close</button></div><pre>${esc(d.content)}</pre>`;
  $('#modal').showModal();
}
$('#addDocBtn').onclick = () => {
  $('#modalBody').innerHTML = `
    <h2 style="font-size:20px;margin-bottom:14px">Add document</h2>
    <input id="docTitle" placeholder="Title (optional — taken from the first # heading)" style="margin-bottom:10px">
    <textarea id="docContent" rows="12" placeholder="Paste text or markdown…"></textarea>
    <div class="row" style="margin-top:12px"><label class="btn ghost">Upload .md / .txt<input type="file" id="docFile" accept=".md,.txt,.markdown,.csv" multiple hidden></label><span class="spacer"></span>
    <button class="btn" onclick="document.getElementById('modal').close()">Cancel</button><button class="btn primary" id="saveDoc">Add to knowledge</button></div>`;
  $('#modal').showModal();
  $('#docFile').onchange = async e => {
    for (const f of e.target.files) await api('/api/docs', { method: 'POST', body: { title: f.name.replace(/\.\w+$/, ''), content: await f.text() } });
    $('#modal').close(); toast(`${e.target.files.length} document(s) indexed`); renderDocs(); refreshCounts();
  };
  $('#saveDoc').onclick = async () => {
    const content = $('#docContent').value.trim(); if (!content) return toast('Add some content first');
    await api('/api/docs', { method: 'POST', body: { title: $('#docTitle').value, content } });
    $('#modal').close(); toast('Document indexed and searchable'); renderDocs(); refreshCounts();
  };
};
$('#modal').onclick = e => { if (e.target.id === 'modal') e.target.close(); };

/* ───────── Impact ───────── */
async function renderImpact() {
  const m = await api('/api/metrics');
  const hrs = (m.minutesSaved / 60).toFixed(1);
  $('#kpis').innerHTML = [
    ['hero-kpi', `${hrs}h`, 'Hours saved'],
    ['', m.question, 'Questions answered'],
    ['', m.meeting, 'Meetings processed'],
    ['', m.task + m.email, 'Tasks & emails automated'],
    ['', m.conflicts, 'Conflicts caught'],
  ].map(([c, v, l]) => `<div class="card kpi ${c}"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');
  const rows = [['Knowledge Q&A', 'question'], ['Meeting intelligence', 'meeting'], ['Autopilot runs', 'agentRun'], ['Tasks created', 'task'], ['Emails drafted', 'email']]
    .map(([l, k]) => ({ l, mins: (m[k] || 0) * m.rates[k], n: m[k] || 0, rate: m.rates[k] }));
  const max = Math.max(1, ...rows.map(r => r.mins));
  $('#bars').innerHTML = rows.map(r => `<div class="bar-row"><span>${r.l}</span><div class="bar"><div style="width:${(r.mins / max) * 100}%"></div></div><span class="n">${r.mins} min</span></div>`).join('') +
    `<div class="muted small" style="margin-top:14px">Assumptions: ${rows.map(r => `${r.l.toLowerCase()} ≈ ${r.rate} min`).join(' · ')}.
     At this rate, a 200-person company saves <b>${Math.round(m.minutesSaved / 60 * 200 * 22).toLocaleString()} hours/month</b> if each person has a session like this every working day.</div>`;
  $('#activity').innerHTML = m.activity.map(a => `<div><time>${new Date(a.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time><span>${esc(a.text)}</span></div>`).join('') || '<div class="muted">No activity yet. Try asking a question.</div>';
}
$('#resetBtn').onclick = async () => { if (!confirm('Clear tasks, emails, uploaded docs and metrics?')) return; await api('/api/reset', { method: 'POST' }); renderImpact(); refreshCounts(); toast('Demo data reset'); };

/* ───────── Boot ───────── */
api('/api/status').then(s => {
  $('#mode').className = 'mode ' + s.mode;
  $('#modeText').textContent = s.mode === 'live' ? 'Live AI' : 'Offline mode';
});
refreshCounts();
$('#askInput').focus();
