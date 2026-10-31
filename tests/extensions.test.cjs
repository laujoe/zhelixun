const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

// A small transactional IndexedDB adapter exercises the browser serialization boundary in Node.
function memoryIndexedDB() {
  const rows = new Map();
  const db = { createObjectStore() {}, transaction() {
    const staged = new Map(rows), tx = { aborted: false, abort() { this.aborted = true; } };
    tx.objectStore = () => ({
      get(id) { return { result: staged.get(id) }; },
      add(entry) { if (staged.has(entry.id)) throw new Error('duplicate'); staged.set(entry.id, entry); },
      delete(id) { staged.delete(id); },
    });
    setTimeout(() => { if (tx.aborted) return tx.onabort?.(); rows.clear(); for (const entry of staged) rows.set(...entry); tx.oncomplete?.(); }, 0);
    return tx;
  } };
  return { open() { const request = {}; setTimeout(() => { request.result = db; request.onupgradeneeded?.(); request.onsuccess(); }, 0); return request; }, rows };
}
function setup() {
  const indexedDB = memoryIndexedDB();
  const sandbox = { indexedDB, Blob, TextEncoder, TextDecoder, Uint8Array, setTimeout, clearTimeout, crypto: crypto.webcrypto, btoa: s => Buffer.from(s, 'binary').toString('base64'), atob: s => Buffer.from(s, 'base64').toString('binary'), ZLXCore: { uid: () => crypto.randomUUID(), copy: value => JSON.parse(JSON.stringify(value)) } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/extensions.js'), 'utf8'), sandbox);
  return { files: sandbox.ZLXExtras.files, indexedDB };
}

test('attachment original bytes survive backup and copy import with fresh IDs and account isolation', async () => {
  const { files } = setup();
  const blob = new Blob(['虚构验收文本\nresearch notes'], { type: 'text/plain' }); blob.name = '研究笔记.txt';
  const attachment = await files.add('account-a', blob);
  await assert.rejects(files.get('account-b', attachment.id));
  const backup = await files.pack('account-a', { format: 'zhelixun-backup-v3', records: [{ id: 'record', data: { attachments: [attachment] } }] });
  assert.equal(backup.format, 'zhelixun-backup-v4');
  assert.equal(Buffer.from(backup.attachments[0].base64, 'base64').toString(), await blob.text());
  let imported;
  const store = { snapshot: () => ({ user: { id: 'account-b' } }), previewImport: text => ({ payload: JSON.parse(text) }), importPreview: preview => { imported = preview.payload.records[0].data.attachments[0]; return { added: 1 }; } };
  await files.restore('account-b', store, { payload: backup, warnings: [] }, 'copy');
  assert.notEqual(imported.id, attachment.id);
  assert.equal(await (await files.get('account-b', imported.id)).blob.text(), await blob.text());
  assert.equal(await (await files.get('account-a', attachment.id)).blob.text(), await blob.text());
});

test('invalid attachment backups and failed record commits do not overwrite existing originals', async () => {
  const { files, indexedDB } = setup();
  const blob = new Blob(['original']); blob.name = 'original.txt';
  const attachment = await files.add('a', blob);
  const backup = await files.pack('a', { records: [{ data: { attachments: [attachment] } }] });
  assert.throws(() => files.validateBackup({ ...backup, attachments: [] }));
  assert.throws(() => files.validateBackup({ ...backup, attachments: [{ ...backup.attachments[0], size: 999 }] }));
  assert.throws(() => files.validateBackup({ ...backup, attachments: [{ ...backup.attachments[0], base64: '<invalid>' }] }));
  const count = indexedDB.rows.size;
  const store = { snapshot: () => ({ user: { id: 'a' } }), previewImport: text => ({ payload: JSON.parse(text) }), importPreview() { throw new Error('QuotaExceeded'); } };
  await assert.rejects(files.restore('a', store, { payload: backup, warnings: [] }, 'merge'), /QuotaExceeded/);
  assert.equal(indexedDB.rows.size, count);
  assert.equal(await (await files.get('a', attachment.id)).blob.text(), 'original');
  await assert.rejects(files.add('a', { size: 10 * 1024 * 1024 + 1 }), /10MB/);
});

test('CSV copy import keeps the selected project through attachment restore', async () => {
  const { files } = setup();
  const sandbox = { console, TextEncoder, TextDecoder, URL, crypto: crypto.webcrypto, setTimeout, clearTimeout, Blob, Response };
  for (const name of ['runtime/legacy-vendor.js', 'core.js']) vm.runInNewContext(fs.readFileSync(require.resolve('../src/' + name), 'utf8'), sandbox);
  const values = new Map();
  const store = sandbox.ZLXCore.createStore({ catalog: [] }, { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) });
  const project = store.startResearch('CSV目标项目');
  const preview = store.previewImport('id,kind,title,content\nsource-note,note,导入笔记,正文', 'csv', project.id);
  await files.restore(store.snapshot().user.id, store, preview, 'copy');
  assert.equal(store.snapshot().records.find(r => r.title === '导入笔记').project_id, project.id);
});

test('switching account while attachments are staged cancels import and removes staged bytes', async () => {
  const { files, indexedDB } = setup();
  const blob = new Blob(['original']); blob.name = 'original.txt';
  const attachment = await files.add('a', blob);
  const payload = await files.pack('a', { records: [{ data: { attachments: [attachment] } }] });
  let reads = 0;
  const store = { snapshot: () => ({ user: { id: reads++ ? 'b' : 'a' } }), importPreview() { assert.fail('Must not commit to another account'); } };
  await assert.rejects(files.restore('a', store, { payload }, 'merge'), /账号已切换/);
  assert.equal(indexedDB.rows.size, 1);
  assert.equal(await (await files.get('a', attachment.id)).blob.text(), 'original');
});

function realStore() {
  const sandbox = { TextEncoder, TextDecoder, URL, crypto: crypto.webcrypto, setTimeout, clearTimeout, Blob, Response };
  for (const name of ['runtime/legacy-vendor.js', 'core.js']) vm.runInNewContext(fs.readFileSync(require.resolve('../src/' + name), 'utf8'), sandbox);
  const values = new Map();
  return sandbox.ZLXCore.createStore({ catalog: [] }, { getItem: k => values.get(k) || null, setItem: (k, v) => values.set(k, v) });
}

test('attachment comparison verifies bytes, skips a repeated transfer and keeps changed originals as a separate project', async () => {
  const { files, indexedDB } = setup(), source = realStore(), target = realStore();
  await source.register('source', 'long-test-password'); await target.register('target', 'long-test-password');
  const owner = source.snapshot().user.id, receiver = target.snapshot().user.id;
  const project = source.startResearch('附件接续');
  const blob = new Blob(['version-a'], { type: 'text/plain' }); blob.name = '资料.txt';
  const ref = await files.add(owner, blob);
  source.create('material', '原件', { folder: 'question', attachments: [ref] }, project.id);
  const backup = await files.pack(owner, source.backup(project.id));
  let preview = await files.inspect(receiver, target, JSON.stringify(backup));
  await files.restore(receiver, target, preview);
  const size = indexedDB.rows.size, records = target.snapshot().records.length;
  preview = await files.inspect(receiver, target, JSON.stringify(backup));
  assert.equal(preview.counts.changed, 0); assert.equal(preview.counts.unchanged, 2);
  const result = await files.restore(receiver, target, preview);
  assert.equal(result.skipped, 2); assert.equal(indexedDB.rows.size, size); assert.equal(target.snapshot().records.length, records);
  backup.attachments[0].base64 = Buffer.from('version-b').toString('base64');
  preview = await files.inspect(receiver, target, JSON.stringify(backup));
  assert.equal(preview.counts.changed, 1, 'Same filename and size must not hide changed bytes');
  const copied = await files.restore(receiver, target, preview);
  assert.equal(copied.mode, 'copy'); assert.equal(copied.updated, 0);
  const attachments = target.snapshot().records.filter(r => r.title === '原件');
  assert.equal(attachments.length, 2);
  const texts = await Promise.all(attachments.map(async r => (await files.get(receiver, r.data.attachments[0].id)).blob.text()));
  assert.deepEqual(texts.sort(), ['version-a', 'version-b']);
});

test('changed bytes with the original attachment ID are reported before safe import', async () => {
  const { files } = setup(), store = realStore();
  const owner = store.snapshot().user.id, project = store.startResearch('同 ID 原件冲突');
  const blob = new Blob(['version-a'], { type: 'text/plain' }); blob.name = '资料.txt';
  const ref = await files.add(owner, blob);
  store.create('material', '资料', { attachments: [ref] }, project.id);
  const backup = await files.pack(owner, store.backup(project.id));
  backup.attachments[0].base64 = Buffer.from('version-b').toString('base64');
  const preview = await files.inspect(owner, store, JSON.stringify(backup));
  assert.equal(preview.counts.changed, 1, 'Changed bytes must be visible even when the attachment ID and metadata are identical');
  const result = await files.restore(owner, store, preview);
  assert.equal(result.mode, 'copy'); assert.equal(result.updated, 0);
  const records = store.snapshot().records.filter(r => r.title === '资料');
  assert.equal(records.length, 2);
  const values = await Promise.all(records.map(async r => (await files.get(owner, r.data.attachments[0].id)).blob.text()));
  assert.deepEqual(values.sort(), ['version-a', 'version-b']);
});

test('identical local originals keep their own IDs during repeated backup import', async () => {
  const { files } = setup(), store = realStore();
  const owner = store.snapshot().user.id, project = store.startResearch('相同附件');
  for (const title of ['第一份资料', '第二份资料']) {
    const blob = new Blob(['identical bytes'], { type: 'text/plain' }); blob.name = '资料.txt';
    const ref = await files.add(owner, blob);
    store.create('material', title, { attachments: [ref] }, project.id);
  }
  const backup = await files.pack(owner, store.backup(project.id));
  const preview = await files.inspect(owner, store, JSON.stringify(backup));
  assert.equal(preview.counts.changed, 0); assert.equal(preview.counts.unchanged, 3);
  const result = await files.restore(owner, store, preview);
  assert.equal(result.skipped, 3); assert.equal(result.added, 0); assert.equal(result.updated, 0);
});
