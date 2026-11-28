import { consult } from '../engine/consult.mjs';
import evidence from '../knowledge/evidence.json' with { type: 'json' };
import policy from '../knowledge/consultation-policy.json' with { type: 'json' };

const pagesOrigin = 'https://79san2.github.io';
const modelOutputError = 'Unsupported model response';
const progressType = 'application/x-ndjson';

function accessToken(header) {
  if (header.startsWith('Bearer ')) return header.slice(7);
  if (!header.startsWith('Compass-UTF8 ')) return null;
  try {
    const bytes = Uint8Array.from(atob(header.slice(13)), char => char.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch { return null; }
}

function failure(err, stage) {
  const message = String(err?.message ?? '');
  const limited = Number(err?.status ?? err?.statusCode) === 429 ||
    /quota|rate limit|neuron limit|daily limit|too many requests/i.test(message);
  let code = 'SERVER_GENERATION';
  if (stage === 'access') code = 'SERVER_AUTH';
  else if (message === modelOutputError || /empty/i.test(message)) code = 'MODEL_OUTPUT';
  else if (/근거|citation/i.test(message)) code = 'EVIDENCE_CHECK';
  if (limited) code = 'USAGE_LIMIT';
  console.warn('consultation_failed', { stage, code });
  return { status: limited ? 429 : 502, data: { error: 'Consultation failed', code } };
}

function progressResponse(run, headers) {
  const encoder = new TextEncoder();
  let stopped = false;
  let timer;
  const stream = new ReadableStream({
    start(controller) {
      const write = event => {
        if (!stopped) controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      };
      // Keep the response active without exposing any draft or model reasoning.
      timer = setInterval(() => write({ pending: true }), 15000);
      const progress = stage => {
        if (stopped) throw Error('Request cancelled');
        write({ stage });
      };
      run(progress).then(write).catch(err => {
        if (!stopped) write(failure(err, 'draft'));
      }).finally(() => {
        clearInterval(timer);
        if (!stopped) controller.close();
      });
    },
    cancel() { stopped = true; clearInterval(timer); },
  });
  return new Response(stream, { headers: {
    ...headers, 'Content-Type': progressType + '; charset=utf-8', 'Cache-Control': 'no-store, no-transform',
  } });
}

function answerText(output) {
  const finalParts = Array.isArray(output?.output)
    ? output.output.filter(item => item?.type === 'message' && item.role === 'assistant')
      .flatMap(item => Array.isArray(item.content) ? item.content : [])
      .filter(part => part?.type === 'output_text' && typeof part.text === 'string')
      .map(part => part.text).join('\n')
    : '';
  const final = [output?.response, output?.output_text, output?.choices?.[0]?.message?.content, finalParts]
    .find(value => typeof value === 'string' && value.trim());
  if (!final) throw Error(modelOutputError);
  return final;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const health = url.pathname === '/api/status';
    const readsAsset = ['GET', 'HEAD'].includes(req.method) && !health && !url.pathname.startsWith('/api/');
    if (readsAsset) return env.ASSETS.fetch(req);

    const origin = req.headers.get('Origin');
    const allowed = origin === pagesOrigin || origin === url.origin;
    const headers = {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Vary': 'Origin, Accept',
    };
    if (allowed) headers['Access-Control-Allow-Origin'] = origin;
    const reply = (data, status = 200) => Response.json(data, { status, headers });
    if (origin && !allowed) return reply({ error: 'Forbidden' }, 403);
    // Older installations still submit their requests to the Worker root.
    if (!health && !['/', '/api/consult'].includes(url.pathname)) return reply({ error: 'Not found' }, 404);
    if (req.method === 'OPTIONS' && allowed) return new Response(null, { status: 204, headers });
    const keys = [env.CONSULT_ACCESS_KEY, ...Array.from({ length: 5 }, (_, i) => env['TEAM_ACCESS_KEY_' + (i + 1)])]
      .filter(key => typeof key === 'string' && key.length >= 24);
    const ready = Boolean(env.AI && env.CONSULT_MODEL && env.ENABLE_CONSULT === 'true' && keys.length);
    if (health && req.method === 'GET') return reply({ service: 'care-compass', ready }, ready ? 200 : 503);
    if (health || req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
    if (!allowed) return reply({ error: 'Forbidden' }, 403);
    if (!ready) return reply({ error: 'Consultation unavailable' }, 503);

    try {
      const supplied = accessToken(req.headers.get('Authorization') || '');
      if (!supplied) return reply({ error: 'Unauthorized' }, 401);
      const encoder = new TextEncoder();
      const digest = value => crypto.subtle.digest('SHA-256', encoder.encode(value));
      const tokenHash = await digest(supplied);
      let authorized = false;
      for (const key of keys) {
        const expectedHash = await digest(key);
        authorized = crypto.subtle.timingSafeEqual(tokenHash, expectedHash) || authorized;
      }
      if (!authorized) return reply({ error: 'Unauthorized' }, 401);

      const raw = await req.text();
      if (raw.length > 24000) return reply({ error: 'Too large' }, 413);
      let body;
      try { body = JSON.parse(raw); } catch { return reply({ error: 'Invalid JSON' }, 400); }
      if (typeof body?.question !== 'string' || !body.question.trim() || body.question.length > 4000) {
        return reply({ error: 'Invalid question' }, 400);
      }
      const history = Array.isArray(body.history) ? body.history
        .filter(x => x && ['user', 'assistant'].includes(x.role) && typeof x.content === 'string')
        .slice(-6).map(x => ({ role: x.role, content: x.content.slice(0, 2000) })) : [];
      const localReferences = Array.isArray(body.localReferences) ? body.localReferences
        .filter(x => x && typeof x.title === 'string' && typeof x.excerpt === 'string')
        .slice(0, 2).map(x => ({ title: x.title.slice(0, 200), excerpt: x.excerpt.slice(0, 1500) })) : [];
      async function run(onStage) {
        let stage = 'draft';
        let passes = 0;
        try {
          const data = await consult({
            question: body.question, history, localReferences, evidence, policy,
            generate: async messages => {
              stage = ++passes === 1 ? 'draft' : 'review';
              onStage(stage);
              const output = await env.AI.run(env.CONSULT_MODEL, {
                messages, max_tokens: env.CONSULT_MODEL.includes('gpt-oss') ? 6000 : 3000,
              });
              return answerText(output);
            },
          });
          return { status: 200, data };
        } catch (err) { return failure(err, stage); }
      }
      if (req.headers.get('Accept')?.includes(progressType)) return progressResponse(run, headers);
      const { data, status } = await run(() => {});
      return reply(data, status);
    } catch (err) {
      const { data, status } = failure(err, 'access');
      return reply(data, status);
    }
  },
};
