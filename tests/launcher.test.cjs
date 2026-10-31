const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');

test('launcher builds and reuses its own service, restarts changed code, and stops only its own process', { timeout: 30000 }, async t => {
  const { launch } = await import('../scripts/launcher.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '浙里寻 启动测试 '));
  const source = path.resolve(__dirname, '..');
  for (const directory of ['scripts', 'src', 'style']) fs.cpSync(path.join(source, directory), path.join(root, directory), { recursive: true, filter: entry => path.basename(entry) !== '.DS_Store' });
  fs.copyFileSync(path.join(source, 'package.json'), path.join(root, 'package.json'));
  const probe = http.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const options = { root, port, openBrowser: false };
  t.after(async () => {
    try { await launch('stop', options); } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  const first = await launch('start', options).catch(error => { const log = path.join(root, '.local/server.log'); if (fs.existsSync(log)) console.error(fs.readFileSync(log, 'utf8')); throw error; });
  assert.ok(fs.existsSync(path.join(root, '浙里寻-独立网页版.html')));
  const again = await launch('start', options);
  assert.equal(first.pid, again.pid);
  fs.appendFileSync(path.join(root, 'src/core.js'), '\n// Test source change\n');
  const updated = await launch('start', options);
  assert.notEqual(updated.instanceId, first.instanceId);
  const state = path.join(root, '.local/server.json'), saved = fs.readFileSync(state, 'utf8');
  fs.writeFileSync(state, JSON.stringify({ pid: updated.pid, instanceId: 'stale-instance' }));
  await assert.rejects(launch('stop', options), /不是从当前文件夹/);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/health`)).status, 200);
  fs.writeFileSync(state, saved);
  await launch('stop', options);
  assert.equal(fs.existsSync(state), false);
  const foreign = http.createServer((req, res) => { res.end('unrelated service'); });
  foreign.listen(port, '127.0.0.1'); await once(foreign, 'listening');
  try {
    await assert.rejects(launch('start', options), /其他程序/);
    await assert.rejects(launch('stop', options), /不是从当前文件夹/);
    assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), 'unrelated service');
  } finally { foreign.closeAllConnections(); await new Promise(resolve => foreign.close(resolve)); }
});
