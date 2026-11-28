import assert from 'node:assert/strict';
import test from 'node:test';
import { timingSafeEqual } from 'node:crypto';
import worker from '../server/worker.mjs';

const target = 'https://care-compass-pro.sjsan.workers.dev';
const pages = 'https://79san2.github.io';
const settings = { AI: {}, CONSULT_MODEL: 'test', ENABLE_CONSULT: 'true', CONSULT_ACCESS_KEY: 'fixture-for-offline-tests-only' };
const request = (path, options = {}) => new Request(target + path, options);

test('serves the app at the Worker address on normal navigation', async () => {
  const assets = { fetch: req => new Response('asset ' + new URL(req.url).pathname) };
  assert.equal(await (await worker.fetch(request('/'), { ASSETS: assets })).text(), 'asset /');
});

test('connection check reports readiness without running a model', async () => {
  for (const [env, ready] of [[{}, false], [settings, true]]) {
    const response = await worker.fetch(request('/api/status', { headers: { Origin: pages } }), env);
    assert.equal(response.status, ready ? 200 : 503);
    assert.deepEqual(await response.json(), { service: 'care-compass', ready });
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), pages);
  }
});

test('new and previously installed clients can preflight and both require access', async () => {
  for (const origin of [target, pages]) {
    for (const path of ['/', '/api/consult']) {
      const headers = { Origin: origin };
      const preflight = await worker.fetch(request(path, { method: 'OPTIONS', headers }), settings);
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), origin);
      const blocked = await worker.fetch(request(path, { method: 'POST', headers }), settings);
      assert.equal(blocked.status, 401);
      assert.equal(blocked.headers.get('Access-Control-Allow-Origin'), origin);
    }
  }
});

test('unrelated origins cannot use the consultation endpoint', async () => {
  const response = await worker.fetch(request('/api/consult', {
    method: 'POST', headers: { Origin: 'https://example.org' },
  }), settings);
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
});

test('streams each phase before the model finishes and returns only the reviewed answer', async t => {
  // Node lacks the timing-safe Web Crypto extension provided by Workers.
  Object.defineProperty(crypto.subtle, 'timingSafeEqual', {
    value: (a, b) => timingSafeEqual(Buffer.from(a), Buffer.from(b)), configurable: true,
  });
  t.after(() => { delete crypto.subtle.timingSafeEqual; });
  const key = '가상으로만-사용하는-테스트용-문자열-0123456789';
  const headers = { Origin: target, Authorization: 'Compass-UTF8 ' + Buffer.from(key).toString('base64'),
    Accept: 'application/x-ndjson' };
  const post = () => request('/api/consult', { method: 'POST', headers,
    body: JSON.stringify({ question: '옷찢기 지원 어려움' }) });
  const draft = Promise.withResolvers();
  const review = Promise.withResolvers();
  const answers = [draft.promise, review.promise];
  const env = { ...settings, CONSULT_ACCESS_KEY: key, AI: { run: () => answers.shift() } };
  const response = await worker.fetch(post(), env);
  assert.match(response.headers.get('Content-Type'), /ndjson/);
  const reader = response.body.getReader();
  const next = async () => JSON.parse(new TextDecoder().decode((await reader.read()).value));
  assert.deepEqual(await next(), { stage: 'draft' });
  draft.resolve({ response: '모의 초안' });
  assert.deepEqual(await next(), { stage: 'review' });
  review.resolve({ response: '모의 검토본' });
  const final = await next();
  assert.equal(final.status, 200);
  assert.equal(final.data.answer, '모의 검토본');
  assert.ok((await reader.read()).done);

  env.AI = { run() { throw Error('quota exceeded'); } };
  const failed = await worker.fetch(post(), env);
  const events = (await failed.text()).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(events.at(-1).status, 429);
  assert.equal(events.at(-1).data.code, 'USAGE_LIMIT');

  headers.Authorization = 'Compass-UTF8 !';
  assert.equal((await worker.fetch(post(), env)).status, 401);
  headers.Authorization = 'Bearer ' + settings.CONSULT_ACCESS_KEY;
  delete headers.Accept;
  const legacy = await worker.fetch(post(), { ...settings, AI: { run: () => ({response:'모의 답변'}) } });
  assert.match(legacy.headers.get('Content-Type'), /application\/json/);
  assert.equal((await legacy.json()).answer, '모의 답변');
});
