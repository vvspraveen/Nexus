import * as store from './store.js';
import { search, tokenize, chunk } from './rag.js';
import { chat, chatJSON, textOf, live } from './llm.js';

// Visitors see a short, vendor-neutral notice; the exact provider error goes to the server log for the operator.
function liveError(err) {
  const m = err.message;
  const reason = /credit balance/i.test(m) ? 'AI usage limit reached'
    : /quota|RESOURCE_EXHAUSTED/i.test(m) ? 'AI usage limit reached'
    : /401|403|404|API_KEY_INVALID|PERMISSION_DENIED|not found|authentication|model/i.test(m) ? 'AI service is not configured correctly'
    : /429|rate/i.test(m) ? 'AI service is busy, so retry in a moment'
    : /fetch failed|ENOTFOUND|ECONN/i.test(m) ? 'AI service is unreachable'
    : 'AI service error';
  console.warn('Live call failed, using offline mode:', m);
  return `Live AI unavailable (${reason}). Showing an offline answer instead.`;
}

// Keeps the assistant presenting itself only as the product.
const PERSONA = 'Refer to yourself only as Nexus. Do not name or discuss the underlying AI model, provider or vendor; if asked, say you are Nexus, the company\'s AI work assistant.';

const today = () => new Date().toISOString().slice(0, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sentences = text => text.split(/\n+/)
  .flatMap(line => line.split(/(?<=[.!?])\s+(?=[A-Z])/))
  .map(s => s.replace(/^[-*]\s*/, '').trim()).filter(s => s.length > 20);

function formatSources(hits) {
  return hits.map((h, i) => `[${i + 1}] ${h.docTitle}${h.section ? ' › ' + h.section : ''}\n${h.text}`).join('\n\n');
}

function citations(hits, used) {
  return hits.map((h, i) => ({ n: i + 1, docId: h.docId, docTitle: h.docTitle, section: h.section, text: h.text, used: used.includes(i + 1) }));
}

/* ───────────────────────── 1. Grounded Q&A with conflict detection ───────────────────────── */

export async function ask(question, history = []) {
  const hits = search(store.docs(), question + ' ' + history.slice(-1).map(h => h.q).join(' '), 6);
  store.track('question');
  store.log('question', `Asked: ${question}`);
  if (!hits.length) {
    return { answer: "I couldn't find anything about that in the knowledge base. Try rephrasing, or add the relevant document under **Knowledge**.", confidence: 'low', conflicts: [], followups: [], actions: [], citations: [], mode: live() ? 'live' : 'demo' };
  }

  let out, notice;
  if (live()) try {
    out = await chatJSON({
      system: `You are Nexus, an enterprise knowledge assistant. Today is ${today()}. ${PERSONA}
Answer ONLY from the numbered sources. Cite every factual claim inline like [1] or [2][3].
If the sources don't contain the answer, say so plainly — never invent policy.
Actively look for CONFLICTS: sources that disagree (different numbers, dates, tools, owners). For each, explain which source is most likely authoritative (prefer the most recent / most specific) and why.`,
      prompt: `${history.length ? 'Conversation so far:\n' + history.slice(-3).map(h => `Q: ${h.q}\nA: ${h.a}`).join('\n') + '\n\n' : ''}Sources:\n${formatSources(hits)}\n\nQuestion: ${question}

Return JSON:
{"answer": "concise markdown answer with inline [n] citations; lead with the direct answer",
 "used_sources": [n, ...],
 "confidence": "high" | "medium" | "low",
 "conflicts": [{"summary": "what disagrees", "sources": [n, n], "resolution": "which to trust and why"}],
 "followups": ["3 short follow-up questions the user is likely to ask next"],
 "actions": [{"title": "optional concrete next step for the user, only if clearly useful", "owner": "Me"}]}`,
    });
  } catch (err) { notice = liveError(err); }
  out ||= demoAnswer(question, hits);
  // Model output can vary in shape; make sure the UI always gets strings and lists.
  const list = v => (Array.isArray(v) ? v : []);
  out = { ...out, answer: String(out.answer || ''), conflicts: list(out.conflicts), followups: list(out.followups), actions: list(out.actions), used_sources: list(out.used_sources) };
  if (out.conflicts?.length) store.track('conflicts', out.conflicts.length);
  return { ...out, citations: citations(hits, out.used_sources || []), mode: out && !notice && live() ? 'live' : 'demo', notice };
}

function docDate(title) {
  const m = title.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+(20\d\d)/i);
  return m ? new Date(`${m[1]} 1 ${m[2]}`).getTime() : 0;
}

function demoAnswer(question, hits) {
  const q = new Set(tokenize(question));
  const top = hits[0].score;
  const cands = [];
  const pool = [];
  hits.forEach((h, i) => {
    if (h.score < top * 0.35) return;
    // The document's own title line is a label, not an answer.
    for (const s of sentences(h.text)) if (s !== h.docTitle) pool.push({ s, n: i + 1, h, toks: new Set(tokenize(s)) });
  });
  // Weight question words by rarity: "owner" in one line beats "organization" that appears in every line.
  const weight = t => Math.log(1 + pool.length / (1 + pool.filter(p => p.toks.has(t)).length));
  // Words from the document's title say WHICH doc, not WHICH line answers, so they count much less.
  for (const p of pool) {
    const titleToks = new Set(tokenize(p.h.docTitle));
    const overlap = [...q].filter(t => p.toks.has(t)).reduce((sum, t) => sum + weight(t) * (titleToks.has(t) ? 0.2 : 1), 0);
    if (overlap) cands.push({ ...p, s: p.s.replace(/\[([^\]]+)\]/g, '$1'), score: overlap + 0.5 * p.h.score / top });
  }
  cands.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const c of cands) {
    if (picked.length >= 3) break;
    if (picked.length && c.score < picked[0].score * 0.5) break; // keep only lines that are nearly as relevant as the best
    if (!picked.some(p => p.s === c.s)) picked.push(c);
  }
  if (!picked.length) picked.push({ s: sentences(hits[0].text)[0] || hits[0].text.slice(0, 200), n: 1, h: hits[0] });

  // Conflict heuristic: two picked sentences from different docs quoting different amounts for overlapping terms.
  const conflicts = [];
  for (let i = 0; i < picked.length; i++) for (let j = i + 1; j < picked.length; j++) {
    const a = picked[i], b = picked[j];
    const ma = a.s.match(/\$\d[\d,]*/g), mb = b.s.match(/\$\d[\d,]*/g);
    const shared = tokenize(a.s).filter(t => tokenize(b.s).includes(t) && q.has(t));
    if (a.h.docId !== b.h.docId && ma && mb && ma[0] !== mb[0] && shared.length) {
      const [newer, older] = docDate(a.h.docTitle) >= docDate(b.h.docTitle) ? [a, b] : [b, a];
      conflicts.push({
        summary: `“${older.h.docTitle}” says ${older.s.match(/\$\d[\d,]*/)[0]}, but “${newer.h.docTitle}” says ${newer.s.match(/\$\d[\d,]*/)[0]}.`,
        sources: [older.n, newer.n],
        resolution: `Trust [${newer.n}] — it is the more recent document. Consider updating “${older.h.docTitle}” so they agree.`,
      });
    }
  }
  const lead = conflicts.length
    ? `**Heads up — the sources disagree.** Most recent guidance: ${picked.find(p => p.n === conflicts[0].sources[1]).s} [${conflicts[0].sources[1]}]\n\n`
    : '';
  const body = picked.map(p => `- ${p.s} [${p.n}]`).join('\n');
  return {
    answer: lead + (lead ? 'Everything relevant I found:\n' : '') + body,
    used_sources: [...new Set(picked.map(p => p.n))],
    confidence: picked.length >= 2 && hits[0].score > 3 ? 'high' : hits[0].score > 1.5 ? 'medium' : 'low',
    conflicts,
    followups: [`Who owns “${hits[0].docTitle}”?`, `Summarize “${hits[0].docTitle}”`, 'What changed recently?'],
    actions: conflicts.length ? [{ title: `Reconcile conflicting guidance in “${picked.find(p => p.n === conflicts[0].sources[0]).h.docTitle}”`, owner: 'Me' }] : [],
  };
}

/* ───────────────────────── 2. Meeting intelligence ───────────────────────── */

export async function meeting(transcript) {
  if (!String(transcript || '').trim()) throw new Error('Transcript is empty');
  store.track('meeting');
  // Pull related knowledge so we can catch decisions that make existing docs stale.
  const hits = search(store.docs(), transcript.slice(0, 4000), 5);
  let out, notice;
  if (live()) try {
    out = await chatJSON({
      system: `You are Nexus Meeting Intelligence. Today is ${today()}. ${PERSONA} Extract what matters from meeting transcripts with precision. Owners must be people who appear in the transcript. Convert relative dates ("by Friday") to explicit dates when the meeting date is known.`,
      prompt: `Transcript:\n"""\n${transcript}\n"""\n\nRelated company documents:\n${formatSources(hits)}

Return JSON:
{"title": "short meeting title",
 "summary": "3-4 sentence executive summary",
 "decisions": [{"text": "decision made"}],
 "actions": [{"title": "verb-first action", "owner": "full name", "due": "date or empty", "priority": "high|medium|low"}],
 "risks": [{"text": "risk", "severity": "high|medium|low"}],
 "open_questions": ["unresolved question"],
 "doc_updates": [{"doc": "title of a related document above that is now outdated or contradicted by this meeting", "suggestion": "what should change"}],
 "followup_email": {"to": "attendees", "subject": "...", "body": "plain-text recap email with decisions and owners"}}`,
      maxTokens: 3000,
    });
  } catch (err) { notice = liveError(err); }
  out ||= demoMeeting(transcript, hits);
  store.log('meeting', `Meeting analysed: ${out.title}`);
  return { ...out, mode: !notice && live() ? 'live' : 'demo', notice };
}

function demoMeeting(transcript, hits) {
  const lines = transcript.split('\n').map(l => l.trim()).filter(Boolean);
  const title = lines[0].length < 90 && !lines[0].includes(':') ? lines[0] : (lines[0].split(/[—-]/)[0] || 'Meeting').trim();
  const attendeesLine = lines.find(l => /^attendees:/i.test(l)) || '';
  const attendees = attendeesLine.replace(/^attendees:/i, '').split(',').map(s => s.trim()).filter(Boolean);
  const fullName = first => attendees.find(a => a.split(' ')[0].toLowerCase() === first.toLowerCase()) || first;
  const turns = lines.map(l => l.match(/^([A-Z][\w.]+(?: [A-Z][\w.]+)?):\s*(.+)$/)).filter(m => m && !/^attendees$/i.test(m[1])).map(m => ({ who: fullName(m[1]), text: m[2] }));
  const dueRe = /\b(?:by|on|before)\s+((?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday)|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+\d{1,2}(?:st|nd|rd|th)?)/i;

  const decisions = [], actions = [], risks = [], open = [];
  turns.forEach((t, i) => {
    for (const s of t.text.split(/(?<=[.!?])\s+/)) {
      if (/\b(agreed|decided|let's go with|we will)\b|\bdecision:/i.test(s) && !/\b(haven't|not|un)\s*decided\b/i.test(s) && s.length > 35)
        decisions.push({ text: cap(s.replace(/^decision:\s*/i, '').replace(/^we agreed to\s*/i, 'Agreed to ')) });
      if (/\b(risk|concern|blocker|slip)/i.test(s)) risks.push({ text: `${s} (${t.who})`, severity: /blocker|slip/i.test(s) ? 'high' : 'medium' });
      const due = (s.match(dueRe) || [])[1] || '';
      const self = s.match(/\bI(?:'ll| will)\s+(.+?)[.!]?$/i);
      const ask = s.match(/^(?:\w+,\s*)?(?:([A-Z]\w+),\s+(?:can you|please(?: also)?)\s+(.+?)[.?!]?$)/);
      const similar = owner => actions.findIndex(a => a.owner === owner && tokenize(a.title).filter(w => tokenize(s).includes(w)).length >= 2);
      if (self && !/^(?:just|think)/i.test(self[1])) {
        const dup = similar(t.who);
        if (dup >= 0) actions.splice(dup, 1); // the owner's own commitment is the better phrasing
        actions.push({ title: cap(self[1].replace(dueRe, '').trim()), owner: t.who, due, priority: /proposal|blocker|test/i.test(s) ? 'high' : 'medium' });
      } else if (ask) {
        if (similar(fullName(ask[1])) < 0) actions.push({ title: cap(ask[2].replace(dueRe, '').replace(/\bme\b/, t.who.split(' ')[0]).trim()), owner: fullName(ask[1]), due, priority: 'medium' });
      }
      if (/haven't decided|park (that|this)|tbd|not sure yet/i.test(s) && turns[i - 1]?.text.includes('?') && !open.includes(turns[i - 1].text)) open.push(turns[i - 1].text);
    }
  });
  const summary = `${title}. ${decisions.length} decision${decisions.length === 1 ? '' : 's'} made, ${actions.length} action items assigned across ${new Set(actions.map(a => a.owner)).size} people, and ${risks.length} risk${risks.length === 1 ? '' : 's'} flagged.` +
    (decisions[0] ? ` Key decision: ${decisions[0].text}` : '');
  const docUpdates = [];
  const related = store.docs().filter(doc => hits.some(x => x.docId === doc.id && x.score >= hits[0].score * 0.5));
  for (const d of decisions) {
    // Scheduling decisions ("we will hold a review on…") can't make a document outdated.
    if (/\b(hold|schedule|meet)\b.*\b(review|meeting|sync|call)\b/i.test(d.text)) continue;
    const h = search(related, d.text, 1)[0];
    // One flag per document section, so two decisions touching different sections are both reported.
    if (h && h.score > 2.5 && !docUpdates.some(u => u.doc === h.docTitle && u.section === h.section))
      docUpdates.push({ doc: h.docTitle, section: h.section, suggestion: `Section “${h.section || 'main'}” may be outdated given: ${d.text}` });
  }
  const body = `Hi all,\n\nThanks for joining ${title}. Quick recap:\n\nDecisions\n${decisions.map(d => '• ' + d.text).join('\n') || '• None'}\n\nAction items\n${actions.map(a => `• ${a.title} — ${a.owner}${a.due ? ' (by ' + a.due + ')' : ''}`).join('\n')}\n\nOpen questions\n${open.map(q => '• ' + q).join('\n') || '• None'}\n\nThanks!`;
  return { title, summary, decisions, actions, risks, open_questions: open, doc_updates: docUpdates, followup_email: { to: attendees.join(', ') || 'Attendees', subject: `Recap & actions: ${title}`, body } };
}

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

/* ───────────────────────── 3. Autopilot agent (tool use) ───────────────────────── */

const TOOLS = [
  { name: 'search_knowledge', description: 'Search the company knowledge base (policies, guides, roadmaps). Returns the most relevant passages with document titles.', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'create_task', description: 'Create a task on the team task board.', input_schema: { type: 'object', properties: { title: { type: 'string' }, owner: { type: 'string' }, due: { type: 'string', description: 'YYYY-MM-DD or short phrase' }, priority: { type: 'string', enum: ['high', 'medium', 'low'] }, context: { type: 'string', description: 'Why this task exists / which policy requires it' } }, required: ['title', 'owner'] } },
  { name: 'draft_email', description: 'Draft an email for the user to review and send.', input_schema: { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } }, required: ['to', 'subject', 'body'] } },
  { name: 'list_tasks', description: 'List existing open tasks, to avoid creating duplicates.', input_schema: { type: 'object', properties: {} } },
];

function runTool(name, input) {
  switch (name) {
    case 'search_knowledge': {
      const hits = search(store.docs(), input.query, 4);
      return hits.length ? hits.map(h => `[${h.docTitle}${h.section ? ' › ' + h.section : ''}] ${h.text}`).join('\n\n') : 'No results.';
    }
    case 'create_task': {
      const t = store.addTask({ ...input, source: 'autopilot' });
      return `Created task ${t.id}: “${t.title}” → ${t.owner}${t.due ? ' (due ' + t.due + ')' : ''}`;
    }
    case 'draft_email': {
      const e = store.addEmail({ ...input, source: 'autopilot' });
      return `Draft saved (${e.id}) to ${e.to}: “${e.subject}”`;
    }
    case 'list_tasks':
      return store.tasks().filter(t => t.status !== 'done').map(t => `- ${t.title} (${t.owner})`).join('\n') || 'No open tasks.';
    default:
      return `Unknown tool ${name}`;
  }
}

export async function autopilot(goal, emit) {
  store.track('agentRun');
  store.log('agent', `Autopilot: ${goal}`);
  if (!live()) return demoAgent(goal, emit);
  try { await liveAgent(goal, emit); }
  catch (err) {
    emit({ type: 'error', text: liveError(err) });
    await demoAgent(goal, emit);
  }
}

async function liveAgent(goal, emit) {
  const system = `You are Nexus Autopilot, an AI operations agent inside a company workspace. Today is ${today()}. ${PERSONA}
Turn the user's goal into completed work:
1. ALWAYS search the knowledge base first (several targeted searches if needed) so every action follows company policy.
2. Create concrete, verb-first tasks with a named owner, a real due date, and context citing the policy that requires it.
3. Draft any emails a human would otherwise have to write.
4. Finish with a short markdown summary: what you did, which policies you applied, and anything that needs a human decision.
Before each tool call, write one short sentence explaining what you're about to do.`;
  const messages = [{ role: 'user', content: goal }];
  let actions = 0;
  for (let turn = 0; turn < 12; turn++) {
    const msg = await chat({ system, messages, tools: TOOLS, maxTokens: 3000 });
    messages.push({ role: 'assistant', content: msg.content });
    const results = [];
    for (const block of msg.content) {
      if (block.type === 'text' && block.text.trim()) emit({ type: msg.stop_reason === 'tool_use' ? 'thought' : 'final', text: block.text });
      if (block.type === 'tool_use') {
        emit({ type: 'tool', name: block.name, input: block.input });
        const output = runTool(block.name, block.input);
        if (block.name === 'create_task' || block.name === 'draft_email') actions++;
        emit({ type: 'result', name: block.name, output });
        results.push({ type: 'tool_result', tool_use_id: block.id, content: output });
      }
    }
    if (msg.stop_reason !== 'tool_use') {
      if (!msg.content.some(b => b.type === 'text' && b.text.trim())) emit({ type: 'final', text: `**Done.** I completed ${actions} action${actions === 1 ? '' : 's'}. Review them under **Tasks**.` });
      return;
    }
    messages.push({ role: 'user', content: results });
  }
  emit({ type: 'final', text: 'Stopped after reaching the step limit.' });
}

async function demoAgent(goal, emit) {
  const step = async (type, data, ms = 500) => { await sleep(ms); emit({ type, ...data }); };
  const person = (goal.match(/\b(?:[Ff]or|[Oo]nboard|[Ww]elcome|[Hh]elp)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/) || [])[1];
  await step('thought', { text: 'First I’ll check the knowledge base for the relevant policy so every step follows company process.' });
  await step('tool', { name: 'search_knowledge', input: { query: goal } });
  const hits = search(store.docs(), goal, 4);
  await step('result', { name: 'search_knowledge', output: runTool('search_knowledge', { query: goal }) }, 700);
  const steps = [];
  // A procedure usually spans its whole document: walk every section of the best match,
  // plus only strong matches from other documents.
  const topDoc = hits[0] && store.docs().find(d => d.id === hits[0].docId);
  const pool = [...(topDoc ? chunk(topDoc) : []), ...hits.filter(h => h.docId !== hits[0].docId && h.score > hits[0].score * 0.6)];
  for (const h of pool) {
    for (const s of sentences(h.text)) for (const item of atomicSteps(s)) if (steps.length < 8) steps.push({ ...item, h });
  }
  if (steps.length) await step('thought', { text: `Found ${steps.length} required steps in “${hits[0].docTitle}”. Creating one task per step, with owners.` });
  for (const { title, actor, src, h, due, priority } of steps) {
    const owner = /\bIT\b/.test(actor) ? 'IT Ops' : /manager/i.test(actor) ? 'Hiring manager' : person || 'Me';
    const input = { title, owner, due: due || '', priority: priority || (/must|require|before|never/i.test(src) ? 'high' : 'medium'), context: `Required by ${h.docTitle}${h.section ? ' › ' + h.section : ''}` };
    await step('tool', { name: 'create_task', input }, 300);
    await step('result', { name: 'create_task', output: runTool('create_task', input) }, 200);
  }
  const email = {
    to: person || 'team',
    subject: person ? `Welcome aboard, ${person.split(' ')[0]}!` : `Plan: ${goal.slice(0, 60)}`,
    body: `Hi ${person ? person.split(' ')[0] : 'team'},\n\nHere's the plan, based on “${hits[0]?.docTitle || 'our guidelines'}”:\n\n${steps.map(x => `• ${x.title} (${x.h.section || x.h.docTitle})`).join('\n')}\n\nShout if anything is unclear.\n\nBest`,
  };
  await step('thought', { text: 'Drafting the communication so nobody has to write it by hand.' });
  await step('tool', { name: 'draft_email', input: email });
  await step('result', { name: 'draft_email', output: runTool('draft_email', email) }, 300);
  await step('final', { text: `**Done.** I created **${steps.length} tasks** and **1 email draft**, all grounded in “${hits[0]?.docTitle || 'the knowledge base'}”.\n\n**Needs a human:** review the email draft and confirm task owners.` });
}

// Policy prose → atomic, verb-first steps. Handles "IT must provision A, B and C", lists of verbs,
// passives ("incidents must be reported in X" → "Report incidents in X"), dated milestones and risks.
const VERBS = 'provision|assign|attend|complete|set up|ship|shadow|read|meet|agree|submit|book|request|review|schedule|send|install|configure|sign|report|use|launch|announce|prepare|resolve|train';
const unpast = v => v.replace(/ied$/, 'y').replace(/([^aeiou])\1ed$/, '$1').replace(/ed$/, '').replace(/(us|ar)$/, '$1e');
function atomicSteps(sentence) {
  const s = sentence.replace(/\.$/, '');
  const milestone = s.match(/^((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.? \d{1,2}):\s*(.+)/i);
  if (milestone) return [{ title: `Deliver: ${milestone[2]}`, due: milestone[1], actor: '', src: s }];
  if (/\b(risk|behind schedule|not yet resolved|blocker)\b/i.test(s)) return [{ title: `Mitigate risk: ${s}`, actor: '', src: s, priority: 'high' }];
  const passive = s.match(/^(.+?) (?:must|should) (never )?be (\w+ed) (.+)$/i);
  if (passive) {
    const rest = passive[4].replace(/ or (\w+ed)\b/g, (_, v) => ' or ' + unpast(v));
    return [{ title: cap(`${passive[2] ? 'never ' : ''}${unpast(passive[3])} ${passive[1].toLowerCase()} ${rest}`), actor: passive[1], src: s }];
  }
  const ensure = s.match(/^(.+?) must (have|use|not) (.+)$/i);
  if (ensure && ensure[2] !== 'not') return [{ title: `Ensure ${ensure[1].toLowerCase()} ${ensure[2]} ${ensure[3]}`, actor: ensure[1], src: s }];
  const m = s.match(new RegExp(`^(.*?)\\b(?:must |should |will |to )?(${VERBS})s?\\b(?! of| are| is| must)(.*)$`, 'i'));
  if (!m) return [];
  return (m[2] + m[3]).split(new RegExp(`,\\s*(?:and\\s+)?(?=(?:${VERBS})\\b)`, 'i'))
    .map(t => ({ title: cap(t.trim().replace(/\btheir\b/g, 'your')), actor: m[1], src: s }))
    .filter(t => t.title.length > 8);
}
