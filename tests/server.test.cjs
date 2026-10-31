const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

test('model config validates destination and recommendations reject invented IDs', async () => {
  const { validateConfig, validRecommendations } = await import('../scripts/server.mjs');
  for (const baseUrl of ['http://example.com', 'file:///tmp/model', 'https://user:pass@example.com', 'https://example.com?key=secret']) assert.throws(() => validateConfig({ baseUrl, model: 'test' }));
  assert.equal(validateConfig({ baseUrl: 'http://localhost:9000/v1/', model: 'local', enabled: false }).baseUrl, 'http://localhost:9000/v1');
  assert.equal(validateConfig({ baseUrl: 'https://other.example/v1', model: 'other', apiKey: '' }, { baseUrl: 'https://api.deepseek.com', apiKey: 'never-forward-me' }).apiKey, '');
  const candidates = [{ database: { id: 'real', name: '真实目录' }, reason: '主题匹配' }];
  assert.deepEqual(validRecommendations([{ id: 'invented' }, { id: 'real', reason: '模型依据' }, { id: 'real' }], candidates), [{ database: { id: 'real', name: '真实目录' }, reason: '模型依据' }]);
});

test('local server isolates profiles, protects keys, persists only opted-in keys, and validates model results', async t => {
  const { createServer } = await import('../scripts/server.mjs');
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zlx-model-test-'));
  t.after(() => fs.rmSync(configDir, { recursive: true, force: true }));
  const calls = [];
  const fetcher = async (url, options) => {
    const request = JSON.parse(options.body); calls.push({ url, options, request });
    if (request.messages[0].content.includes('提取')) return Response.json({ choices: [{ message: { content: '医学 临床研究' } }] });
    if (request.messages[0].content.includes('浙里寻研究助手')) return Response.json({ choices: [{ message: { content: JSON.stringify({ reply: '先界定研究对象。', recommendations: [{ id: 'invented', reason: '不得显示' }] }) } }] });
    return Response.json({ choices: [{ message: { content: '连接成功' } }] });
  };
  let server, base;
  const start = async () => { server = createServer({ configDir, fetcher }); server.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`; };
  const stop = async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
  await start(); t.after(async () => { if (server.listening) await stop(); });
  const a = 'a'.repeat(64), b = 'b'.repeat(64);
  const api = async (token, endpoint, method = 'GET', body) => {
    const response = await fetch(base + '/api/' + endpoint, { method, headers: { Origin: base, 'Content-Type': 'application/json', 'X-ZLX-Profile': token }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await api(a, 'config')).body.enabled, false);
  const config = { enabled: true, baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash', apiKey: 'test-memory-key', remember: false };
  const saved = await api(a, 'config', 'PUT', config);
  assert.equal(saved.body.hasKey, true); assert.equal('apiKey' in saved.body, false);
  assert.equal((await api(b, 'config')).body.hasKey, false);
  assert.ok(!fs.readFileSync(path.join(configDir, fs.readdirSync(configDir)[0]), 'utf8').includes(config.apiKey));
  assert.equal((await api(a, 'test', 'POST', {})).status, 200);
  assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer test-memory-key');
  const result = await api(a, 'chat', 'POST', { stage: 'question', query: '医学临床研究', messages: [{ role: 'user', content: '医学临床研究' }], materials: [{ title: '笔记', content: '样本范围' }] });
  assert.equal(result.status, 200); assert.equal(result.body.reply, '先界定研究对象。'); assert.deepEqual(result.body.candidates, []);
  assert.ok(calls.at(-1).request.messages[0].content.includes('样本范围'));
  const cross = await fetch(base + '/api/config', { headers: { Origin: 'https://attacker.example', 'X-ZLX-Profile': a } }); assert.equal(cross.status, 403);
  assert.equal((await fetch(base + '/.local/models')).status, 404);
  assert.equal((await fetch(base + '/api/config')).status, 403);
  await stop(); await start();
  assert.equal((await api(a, 'config')).body.hasKey, false);
  await api(a, 'config', 'PUT', { ...config, apiKey: 'test-remembered-key', remember: true });
  await stop(); await start();
  assert.equal((await api(a, 'config')).body.hasKey, true);
  await api(a, 'config', 'PUT', { ...config, apiKey: '', enabled: false, remember: true });
  assert.equal((await api(a, 'chat', 'POST', {})).status, 400);
  await api(a, 'config', 'DELETE');
  assert.equal((await api(a, 'config')).body.hasKey, false);
  assert.equal(fs.readdirSync(configDir).length, 0);
});

test('provider errors never expose upstream secrets; disabling cancels in-flight calls', async t => {
  const { createServer } = await import('../scripts/server.mjs');
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zlx-cancel-test-'));
  let blocking = false, started;
  const ready = new Promise(resolve => { started = resolve; });
  const server = createServer({ configDir, fetcher: async (url, options) => {
    if (!blocking) return Response.json({ error: 'secret-in-provider-response' }, { status: 401 });
    started(); return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(configDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`, headers = { 'Content-Type': 'application/json', 'X-ZLX-Profile': 'c'.repeat(64) };
  const config = { enabled: true, baseUrl: 'https://api.deepseek.com', model: 'test', apiKey: 'secret', remember: false };
  await fetch(base + '/api/config', { method: 'PUT', headers, body: JSON.stringify(config) });
  const rejected = await fetch(base + '/api/test', { method: 'POST', headers, body: '{}' });
  assert.ok(!(await rejected.text()).includes('secret'));
  blocking = true;
  const pending = fetch(base + '/api/test', { method: 'POST', headers, body: '{}' });
  await ready;
  await fetch(base + '/api/config', { method: 'PUT', headers, body: JSON.stringify({ ...config, enabled: false }) });
  assert.equal((await pending).status, 400);
});
