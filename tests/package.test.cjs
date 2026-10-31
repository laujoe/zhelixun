const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

test('submission includes complete public inputs, excludes unlisted files, and detects changed content', async t => {
  const { submissionFiles, collectSubmission, verifySubmission } = await import('../scripts/package.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zlx-package-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.resolve(__dirname, '..');
  for (const name of submissionFiles) {
    const target = path.join(root, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(source, name), target);
  }
  // Synthetic files only; never read actual credentials or browser profiles.
  for (const name of ['.env', '.local/models/test.json', 'src/private-note.json', 'tests/screenshot.png', 'dist/web/old.js', 'style/unused.png']) {
    const target = path.join(root, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, 'synthetic-private-marker');
  }
  const entries = collectSubmission(root);
  assert.equal(entries.length, submissionFiles.length + 1);
  assert.equal(entries.some(entry => entry.data.includes('synthetic-private-marker') && entry.name !== 'tests/package.test.cjs'), false);
  const manifest = entries.find(entry => entry.name === '文件校验清单.json'); fs.writeFileSync(path.join(root, manifest.name), manifest.data);
  assert.equal(verifySubmission(root), submissionFiles.length);
  fs.appendFileSync(path.join(root, 'README.md'), '\nChanged after packaging.');
  assert.throws(() => verifySubmission(root), /校验失败：README.md/);
  fs.rmSync(path.join(root, 'src/core.js'));
  assert.throws(() => collectSubmission(root), /ENOENT/);
});

test('submission refuses symlinked public files instead of following them', { skip: process.platform === 'win32' }, async t => {
  const { collectSubmission } = await import('../scripts/package.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zlx-package-link-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'private.txt'), 'synthetic secret');
  fs.symlinkSync('private.txt', path.join(root, '.gitignore'));
  assert.throws(() => collectSubmission(root), /不允许符号链接/);
});

test('static cache version changes when only worker logic changes, and stale public files are removed', async t => {
  const { buildWeb } = await import('../scripts/build-web.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zlx-web-build-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['src', 'style', 'scripts']) fs.mkdirSync(path.join(root, name));
  fs.writeFileSync(path.join(root, 'src/styles.css'), 'body{color:black}');
  fs.writeFileSync(path.join(root, 'style/penguin_icon.png'), 'test-icon');
  fs.writeFileSync(path.join(root, 'scripts/web-install.js'), '// test installer');
  fs.writeFileSync(path.join(root, 'scripts/web-worker.js'), '// worker before update');
  buildWeb(root, { version: 'test' }, []);
  const readVersion = () => fs.readFileSync(path.join(root, 'dist/web/sw.js'), 'utf8').match(/const VERSION="([^"]+)";/)[1];
  const first = readVersion();
  fs.writeFileSync(path.join(root, 'dist/web/private-note.txt'), 'must not publish');
  fs.writeFileSync(path.join(root, 'scripts/web-worker.js'), '// worker after update');
  buildWeb(root, { version: 'test' }, []);
  assert.notEqual(readVersion(), first);
  assert.equal(fs.existsSync(path.join(root, 'dist/web/private-note.txt')), false);
});

test('offline HTML embeds each original image once and reconstructs the exact resolved CSS', async () => {
  const vm = require('node:vm');
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, '浙里寻-独立网页版.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1], appended = [];
  vm.runInNewContext(script, { document: { createElement: tag => ({ tag }), head: { append: element => appended.push(element) } } });
  let expected = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');
  const variables = new Map();
  expected = expected.replace(/(--[\w-]+)\s*:\s*(url\(['"]?\/style\/[^)]+\))\s*;/g, (_, name, value) => { variables.set(name, value); return ''; });
  expected = expected.replace(/var\((--[\w-]+)\)/g, (original, name) => variables.get(name) || original);
  expected = expected.replace(/\/style\/([a-z_]+\.(jpg|png))/g, (_, name, ext) => `data:image/${ext === 'png' ? 'png' : 'jpeg'};base64,${fs.readFileSync(path.join(root, 'style', name)).toString('base64')}`);
  assert.equal(appended.find(element => element.tag === 'style').textContent, expected);
  const icon = fs.readFileSync(path.join(root, 'style/penguin_icon.png')).toString('base64');
  assert.equal(appended.find(element => element.tag === 'link').href, 'data:image/png;base64,' + icon);
  const { submissionFiles } = await import('../scripts/package.mjs');
  for (const name of submissionFiles.filter(name => name.startsWith('style/'))) {
    const data = fs.readFileSync(path.join(root, name)).toString('base64');
    assert.equal(html.split(data).length - 1, 1, name + ' is embedded once without changing its bytes');
  }
});

test('an update already installing when registration resolves still asks before reloading', async () => {
  const vm = require('node:vm'), notices = [], handlers = new Map();
  let installed, activate = '', reloads = 0;
  const worker = { state: 'installing', addEventListener: (name, fn) => { if (name === 'statechange') installed = fn; } };
  const registration = { installing: worker, waiting: null, addEventListener() {} };
  const serviceWorker = { controller: {}, register: async () => registration, addEventListener: (name, fn) => handlers.set(name, fn) };
  const element = tag => ({ tag, children: [], setAttribute() {}, append(...children) { this.children.push(...children); }, remove() {}, get textContent() { return this.text || this.children.map(child => child.textContent || '').join(''); }, set textContent(value) { this.text = value; } });
  const document = {
    createElement: element,
    createElementNS: (_, tag) => element(tag),
    body: { append: node => notices.push(node) },
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../scripts/web-install.js'), 'utf8'), { navigator: { serviceWorker }, document, window: { isSecureContext: true }, location: { reload() { reloads++; } } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof installed, 'function', 'An existing installing worker must also be watched');
  worker.state = 'installed'; registration.waiting = { postMessage: value => { activate = value; } }; installed();
  assert.equal(notices.length, 1); assert.equal(reloads, 0); assert.equal(activate, '');
  notices[0].children.find(node => node.textContent === '已保存，更新页面').onclick();
  assert.equal(activate, 'activate-after-save'); assert.equal(reloads, 0);
  handlers.get('controllerchange')(); assert.equal(reloads, 1);
});
