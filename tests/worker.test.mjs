import assert from 'node:assert/strict';
import test from 'node:test';
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
