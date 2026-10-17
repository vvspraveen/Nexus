// Minimal Google Gemini client over plain fetch (no SDKs):
//   gemini — Gemini API with GEMINI_API_KEY (Google AI Studio). Works locally and on Cloud Run.
//   vertex — Gemini on Vertex AI using the Cloud Run service account (no API key). Set AI_PROVIDER=vertex.
// Callers use one message shape (system + messages with text / tool_use / tool_result blocks);
// this module translates it to Gemini's contents / functionCall / functionResponse format.

const PROVIDER = (process.env.AI_PROVIDER || (process.env.GEMINI_API_KEY ? 'gemini' : 'offline')).toLowerCase();
const DEFAULT_MODEL = { gemini: 'gemini-3.8-flash', vertex: 'gemini-3.8-flash' };

export const provider = () => (process.env.NEXUS_DEMO === '1' ? 'offline' : PROVIDER);
export const live = () => provider() !== 'offline';
export const MODEL = process.env.NEXUS_MODEL || DEFAULT_MODEL[PROVIDER] || '';

export async function chat({ system, messages, tools, maxTokens = 2048, json = false }) {
  return gemini({ system, messages, tools, maxTokens, json });
}

export const textOf = msg => msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n');

// Ask for JSON and parse it, tolerating code fences or stray prose around the object.
export async function chatJSON({ system, prompt, maxTokens = 2048 }) {
  const msg = await chat({
    system: system + '\n\nRespond with a single valid JSON object only — no markdown fences, no commentary.',
    messages: [{ role: 'user', content: prompt }],
    maxTokens,
    json: true,
  });
  const text = textOf(msg);
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('Model did not return JSON');
  return JSON.parse(text.slice(start, end + 1));
}

/* ───────── Gemini (Gemini API or Vertex AI — same request format) ───────── */

async function geminiEndpoint() {
  if (provider() === 'vertex') {
    const md = p => fetch(`http://metadata.google.internal/computeMetadata/v1/${p}`, { headers: { 'Metadata-Flavor': 'Google' } });
    const project = process.env.GOOGLE_CLOUD_PROJECT || await (await md('project/project-id')).text();
    const { access_token } = await (await md('instance/service-accounts/default/token')).json();
    const loc = process.env.VERTEX_LOCATION || 'global';
    const host = loc === 'global' ? 'aiplatform.googleapis.com' : `${loc}-aiplatform.googleapis.com`;
    return { url: `https://${host}/v1/projects/${project}/locations/${loc}/publishers/google/models/${MODEL}:generateContent`, headers: { authorization: `Bearer ${access_token}` } };
  }
  const base = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com';
  return { url: `${base}/v1beta/models/${MODEL}:generateContent`, headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY } };
}

function toGeminiContents(messages) {
  const calls = {}; // tool_use id -> { name, geminiId } so tool results can be matched back to their call
  return messages.map(m => {
    if (typeof m.content === 'string') return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] };
    if (m.role === 'assistant') {
      for (const b of m.content) if (b.type === 'tool_use') calls[b.id] = { name: b.name, geminiId: b.geminiId };
      // Send the model's own parts back unchanged: they carry thought signatures Gemini needs between tool calls.
      const raw = m.content.find(b => b.type === 'raw_parts');
      if (raw) return { role: 'model', parts: raw.parts };
      return { role: 'model', parts: m.content.flatMap(b => b.type === 'text' ? [{ text: b.text }] : b.type === 'tool_use' ? [{ functionCall: { name: b.name, args: b.input } }] : []) };
    }
    return {
      role: 'user',
      parts: m.content.map(b => b.type === 'tool_result'
        ? { functionResponse: { name: calls[b.tool_use_id]?.name, ...(calls[b.tool_use_id]?.geminiId ? { id: calls[b.tool_use_id].geminiId } : {}), response: { result: b.content } } }
        : { text: b.text }),
    };
  });
}

const toGeminiTools = tools => [{
  functionDeclarations: tools.map(t => ({
    name: t.name,
    description: t.description,
    // Gemini rejects an object schema with no properties, so tools without inputs omit it.
    ...(Object.keys(t.input_schema?.properties || {}).length ? { parameters: t.input_schema } : {}),
  })),
}];

async function gemini({ system, messages, tools, maxTokens, json }) {
  const { url, headers } = await geminiEndpoint();
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: toGeminiContents(messages),
    ...(tools ? { tools: toGeminiTools(tools) } : {}),
    // Thinking tokens count toward the output limit, so leave generous headroom.
    generationConfig: { maxOutputTokens: Math.max(maxTokens * 4, 8192), ...(json ? { responseMimeType: 'application/json' } : {}) },
  };
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`AI API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts;
  if (!parts) throw new Error(`AI API returned no content: ${JSON.stringify(data.promptFeedback || data.candidates?.[0]?.finishReason || {}).slice(0, 200)}`);
  const content = [];
  parts.forEach((p, i) => {
    if (p.text && !p.thought) content.push({ type: 'text', text: p.text });
    if (p.functionCall) content.push({ type: 'tool_use', id: p.functionCall.id || `call_${Date.now()}_${i}`, geminiId: p.functionCall.id, name: p.functionCall.name, input: p.functionCall.args || {} });
  });
  content.push({ type: 'raw_parts', parts });
  return { content, stop_reason: content.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn' };
}
