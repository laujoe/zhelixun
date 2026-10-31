const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const sandbox = { console, TextEncoder, TextDecoder, URL, URLSearchParams, Buffer, crypto: require('node:crypto').webcrypto, setTimeout, clearTimeout, Blob, Response };
sandbox.globalThis = sandbox;
vm.runInNewContext(fs.readFileSync(path.join(root, 'src/runtime/legacy-vendor.js'), 'utf8'), sandbox);
vm.runInNewContext(fs.readFileSync(path.join(root, 'src/core.js'), 'utf8'), sandbox);
const C = sandbox.ZLXCore, runtime = sandbox.ZLXRuntime;
const data = { version: 'test', catalog: JSON.parse(fs.readFileSync(path.join(root, 'src/data/catalog.json'))), descriptions: JSON.parse(fs.readFileSync(path.join(root, 'src/data/descriptions.json'))) };
const plain = value => JSON.parse(JSON.stringify(value));
function storage(seed = {}) { return { values: { ...seed }, fail: false, getItem(key) { return this.values[key] || null; }, setItem(key, val) { if (this.fail) throw new Error('QuotaExceeded'); this.values[key] = val; } }; }
function setup(seed = {}) { const memory = storage(seed); return { store: C.createStore(data, memory), memory }; }

test('fresh pages do not log out other tabs, and reload preserves each tabs account', async () => {
  const { store, memory } = setup();
  const before = memory.getItem(C.STATE_KEY);
  const other = C.createStore(data, memory, { freshSession: true });
  assert.equal(other.snapshot().user, null);
  assert.equal(memory.getItem(C.STATE_KEY), before);
  store.create('note', '原页面仍能保存', {});
  other.reload();
  assert.equal(other.snapshot().user, null);
  await other.register('tab-account', 'long-test-password');
  store.reload();
  assert.equal(store.snapshot().user.id, 'standalone-demo');
  assert.equal(other.snapshot().user.username, 'tab-account');
  other.logout(); store.reload();
  assert.equal(store.snapshot().user.id, 'standalone-demo');
});

test('stage recommendations persist compact catalog references in one atomic write', () => {
  const { store, memory } = setup(), project = store.startResearch('轻量记录');
  let writes = 0;
  const save = memory.setItem.bind(memory);
  memory.setItem = (...args) => { writes++; save(...args); };
  const result = store.recommend('医学临床研究', [], project.id, 'analysis');
  assert.ok(result.candidates.length);
  const record = store.snapshot().records.find(r => r.id === result.id);
  assert.equal(record.data.folder, 'analysis');
  assert.equal(writes, 1);
  assert.deepEqual(Object.keys(record.data.candidates[0].database).sort(), ['id', 'name']);
  const before = store.raw(); memory.fail = true;
  assert.throws(() => store.recommend('医学', [], project.id, 'analysis'), /未保存/);
  assert.equal(store.raw(), before);
});

test('stage favorite editing is atomic and bulk moves retain each stage', () => {
  const { store, memory } = setup(), a = store.startResearch('原项目'), b = store.startResearch('目标项目'), db = data.catalog[0];
  store.setFavorites(db, [null, a.id], 'question');
  store.setFavorites(db, [a.id], 'analysis');
  const before = store.raw(); memory.fail = true;
  assert.throws(() => store.setFavorites(db, [b.id], 'question'), /未保存/);
  assert.equal(store.raw(), before); memory.fail = false;
  const selected = store.snapshot().records.filter(r => r.kind === 'favorite' && r.project_id === a.id);
  store.organizeFavorites(selected.map(r => r.id), 'move', b.id);
  assert.deepEqual(plain(store.snapshot().records.filter(r => r.kind === 'favorite' && r.project_id === b.id).map(r => r.data.folder).sort()), ['analysis', 'question']);
});

test('research stages persist, complete, and survive backup import without model credentials', () => {
  const { store, memory } = setup();
  const project = store.startResearch('阶段验收');
  assert.equal(project.data.researchStage, 'question');
  store.create('note', '对话', { folder: 'question', subtype: 'conversation', messages: [{ role: 'user', content: '我想研究医学' }] }, project.id);
  store.advanceResearch(project.id);
  const reopened = C.createStore(data, memory);
  assert.equal(reopened.snapshot().records.find(r => r.id === project.id).data.researchStage, 'analysis');
  reopened.advanceResearch(project.id); reopened.advanceResearch(project.id);
  assert.equal(reopened.snapshot().records.find(r => r.id === project.id).data.researchComplete, true);
  const backup = reopened.backup(project.id); backup.format = 'zhelixun-backup-v4'; backup.attachments = [];
  const target = setup().store; target.importPreview(target.previewImport(JSON.stringify(backup)), 'copy');
  assert.equal(target.snapshot().records.find(r => r.title === '阶段验收').data.researchComplete, true);
  assert.equal(target.snapshot().records.find(r => r.title === '对话').data.messages[0].content, '我想研究医学');
  assert.ok(!JSON.stringify(backup).includes('apiKey'));
  assert.throws(() => reopened.update(project.id, { data: { researchStage: 'invalid' } }));
});

test('stage favorites remain independent after reload and backup import', () => {
  const { store, memory } = setup();
  const project = store.startResearch('分阶段收藏');
  const db = store.snapshot().catalog[0];
  for (const stage of ['question', 'analysis', 'solution']) store.setFavorite(db, project.id, true, stage);
  store.setFavorite(db, project.id, true, 'analysis');
  const reopened = C.createStore(data, memory);
  const favorites = reopened.snapshot().records.filter(r => r.kind === 'favorite' && r.project_id === project.id);
  assert.equal(favorites.length, 3);
  const target = setup().store;
  target.importPreview(target.previewImport(JSON.stringify(reopened.backup(project.id))), 'copy');
  assert.equal(target.snapshot().records.filter(r => r.kind === 'favorite' && r.title === db.name).length, 3);
  reopened.setFavorite(db, project.id, false, 'analysis');
  assert.equal(reopened.snapshot().records.filter(r => r.kind === 'favorite' && r.project_id === project.id).length, 2);
});

test('catalog retains all 394 stable resources and rejects malformed/unsafe URLs', () => {
  assert.equal(data.catalog.length, 394); assert.equal(new Set(data.catalog.map(d => d.id)).size, 394);
  assert.equal(C.safeUrl('javascript:alert(1)'), null); assert.equal(C.safeUrl('https://a:b@example.com'), null);
  assert.equal(C.safeUrl('https://example.com/%EF%BC%88%E6%97%A0%E6%B3%95%E4%BD%BF%E7%94%A8%EF%BC%89'), null);
  const db = { url: 'javascript:bad', access: { directUrl: 'https://x.com/（暂停使用）', officialEntryUrl: 'https://libdb.zju.edu.cn/s/lib/libtb/turning/12' } };
  assert.equal(C.resourceUrl(db), db.access.officialEntryUrl);
});
test('migration copies v1 state without modifying the original save key', () => {
  const seed = runtime.createLegacyState(); seed.records.push({ id: 'custom-old', user_id: seed.session, kind: 'note', title: '旧版材料', data: { content: '保留正文', unknown: { x: 1 } }, project_id: null });
  const original = JSON.stringify(seed), { store, memory } = setup({ [C.LEGACY_KEY]: original });
  assert.equal(store.snapshot().migrated, true); assert.equal(memory.values[C.LEGACY_KEY], original);
  assert.equal(store.snapshot().records.find(r => r.id === 'custom-old').data.unknown.x, 1);
  store.create('note', '新版记录', {}); assert.equal(memory.values[C.LEGACY_KEY], original);
  assert.equal(JSON.parse(memory.values[C.STATE_KEY]).schemaVersion, 3);
});
test('short questions work; 501 and 2999 codepoint questions persist in full; 3000 rejects atomically', () => {
  const { store } = setup();
  for (const query of ['医学', '医学' + '研'.repeat(499), '医学' + '😀'.repeat(2997)]) {
    const result = store.recommend(query, [], null), record = store.snapshot().records.find(r => r.id === result.id);
    assert.equal(record.data.query, query); assert.ok(C.chars(record.title) <= 60);
  }
  const count = store.snapshot().records.length;
  assert.throws(() => store.recommend('😀'.repeat(3000), [], null), /3000/);
  assert.equal(store.snapshot().records.length, count);
  const blank = store.recommend('  ', [], null); assert.equal(blank.candidates.length, 0); assert.equal(store.snapshot().records.length, count);
});
test('tag parser deduplicates Chinese/English separators; personal tags retain official tags', () => {
  assert.deepEqual(plain(C.parseTags('经济，管理,经济\n 金融  ')), ['经济', '管理', '金融']);
  assert.throws(() => C.parseTags(Array.from({ length: 21 }, (_, i) => `标签${i}`)), /20/);
  assert.throws(() => C.parseTags('甲'.repeat(61)), /60/);
  const { store } = setup(), db = store.snapshot().catalog[0]; store.setTags(db.id, ['个人主题']);
  const next = store.snapshot().catalog[0]; assert.ok(next.tags.includes('个人主题')); assert.deepEqual(plain(next.officialTags), plain(db.officialTags));
  db.officialTags.forEach(t => assert.ok(next.tags.includes(t)));
});
test('favorite relationships are scoped by project ID, atomic and idempotent', () => {
  const { store, memory } = setup(), db = data.catalog[0], a = store.create('project', '同名项目'), b = store.create('project', '同名项目');
  store.setFavorites(db, [null, a.id, b.id]); store.setFavorite(db, a.id, true);
  assert.equal(store.snapshot().records.filter(r => r.kind === 'favorite').length, 3);
  const snapshot = store.raw(); memory.fail = true; assert.throws(() => store.setFavorites(db, [a.id]), /未保存/); assert.equal(store.raw(), snapshot); memory.fail = false;
  store.setFavorite(db, a.id, false); assert.equal(store.snapshot().records.filter(r => r.kind === 'favorite').length, 2);
  assert.equal(C.filterCatalog(store.snapshot().catalog, { project: b.id }, store.snapshot().records.filter(r => r.kind === 'favorite')).length, 1);
  assert.equal(C.filterCatalog(store.snapshot().catalog, { project: a.id }, store.snapshot().records.filter(r => r.kind === 'favorite')).length, 0);
});
test('project-filtered exports contain only selected research and CSV neutralizes formulas', () => {
  const { store } = setup(), a = store.create('project', '甲'), b = store.create('project', '乙');
  const note = store.create('note', '=SUM(A1:A2)', { content: '第一行\n第二行,含逗号', unknown: true }, a.id); store.create('note', '不应导出', { content: '乙项目' }, b.id);
  const selected = C.filterRecords(store.snapshot().records, a.id); assert.equal(selected.length, 2);
  const csv = C.exportCsv(selected); assert.ok(csv.startsWith('\uFEFF')); assert.ok(csv.includes("'=SUM")); assert.ok(!csv.includes('不应导出'));
  const preview = store.previewImport(csv, 'csv', a.id); assert.equal(preview.counts.records, 1); assert.equal(preview.payload.records[0].data.content, note.data.content);
  assert.deepEqual(plain(store.backup(a.id).records.map(r => r.id).sort()), [a.id, note.id].sort());
});
test('copy import remaps projects and material references while merge import is repeatable', () => {
  const { store } = setup(), p = store.create('project', '项目'), m = store.create('material', '原始文献', { url: 'https://example.org', arbitrary: [1, 2] }, p.id), n = store.create('citation', '证据', { linkedId: m.id, nodes: [{ id: 'node', recordId: m.id }], linkedIds: [m.id] }, p.id);
  store.setTags(data.catalog[0].id, ['研究主题']); store.setFavorite(data.catalog[0], p.id, true);
  const backup = store.backup(p.id), before = store.snapshot().records.length;
  const report = store.importPreview(store.previewImport(JSON.stringify(backup)), 'copy'); assert.equal(report.added, 4);
  const copied = store.snapshot().records.filter(r => r.title === '证据' && r.id !== n.id)[0];
  assert.notEqual(copied.project_id, p.id); assert.notEqual(copied.data.linkedId, m.id); assert.equal(copied.data.nodes[0].recordId, copied.data.linkedId); assert.equal(copied.data.linkedIds[0], copied.data.linkedId);
  const count = store.snapshot().records.length;
  store.importPreview(store.previewImport(JSON.stringify(backup)), 'merge'); store.importPreview(store.previewImport(JSON.stringify(backup)), 'merge'); assert.equal(store.snapshot().records.length, count); assert.equal(count, before + 4);
});
test('imported foreign IDs merge repeatedly and missing IDs remain unique', () => {
  const { store } = setup(); const payload = { format: 'zhelixun-backup-v1', records: [{ id: 'foreign-1', kind: 'note', title: '外部记录', data: { content: '内容' } }] };
  store.importPreview(store.previewImport(JSON.stringify(payload))); const count = store.snapshot().records.length;
  assert.equal(store.previewImport(JSON.stringify(payload)).conflicts, 1); store.importPreview(store.previewImport(JSON.stringify(payload))); assert.equal(store.snapshot().records.length, count);
  const missing = { ...payload, records: [{ kind: 'note', title: '一', data: {} }, { kind: 'note', title: '二', data: {} }] };
  store.importPreview(store.previewImport(JSON.stringify(missing))); const rows = store.snapshot().records.filter(r => ['一', '二'].includes(r.title)); assert.notEqual(rows[0].id, rows[1].id);
});
test('invalid or quota-failing imports leave no partial mutation', () => {
  const { store, memory } = setup(), before = store.raw();
  assert.throws(() => store.previewImport('{bad json'), /JSON/);
  assert.throws(() => store.previewImport(JSON.stringify({ format: 'zhelixun-backup-v3', records: [{ id: '1', kind: 'note', title: '有效', data: {} }, { id: '2', kind: 'bad', title: '错误', data: {} }] })), /类型/);
  const p = store.previewImport(JSON.stringify({ format: 'zhelixun-backup-v3', records: [{ id: '1', kind: 'note', title: '有效', data: {} }] })); memory.fail = true;
  assert.throws(() => store.importPreview(p), /未保存/); assert.equal(store.raw(), before);
});
test('delete/restore preserves project contents; snapshot restore itself has an undo point', () => {
  const { store } = setup(), p = store.create('project', '待删除'), note = store.create('note', '保留材料', { content: '正文' }, p.id);
  const removed = store.remove(p.id); assert.ok(!store.snapshot().records.some(r => r.id === note.id)); store.restore(removed); assert.equal(store.snapshot().records.find(r => r.id === note.id).project_id, p.id);
  store.importPreview(store.previewImport(JSON.stringify({ format: 'zhelixun-backup-v3', records: [{ id: 'imported', kind: 'note', title: '新导入', data: {} }] })));
  const point = store.snapshot().trash.find(t => t.type === 'snapshot'); store.restore(point.id); assert.ok(!store.snapshot().records.some(r => r.title === '新导入'));
  const undo = store.snapshot().trash.find(t => t.type === 'snapshot'); assert.ok(undo); store.restore(undo.id); assert.ok(store.snapshot().records.some(r => r.title === '新导入'));
});
test('local dates, task deadlines, visit retry and orphan imports have explicit semantics', () => {
  assert.equal(C.localDate('2026-10-15'), '2026-10-15');
  const { store } = setup(), task = store.create('task', '任务', { status: 'inbox', dueDate: '2026-10-20' }); assert.equal(task.data.dueDate, '2026-10-20');
  assert.throws(() => store.create('task', '错误日期', { dueDate: 'tomorrow' }), /日期/);
  const v1 = store.recordVisit(data.catalog[0], null, '', 'visit-once'), v2 = store.recordVisit(data.catalog[0], null, '', 'visit-once'); assert.equal(v1.id, v2.id);
  const report = store.importPreview(store.previewImport(JSON.stringify({ format: 'zhelixun-backup-v3', records: [{ id: 'orphan', kind: 'note', title: '无项目', project_id: 'missing', data: { linkedId: 'missing-record' } }] })));
  assert.ok(report.warnings.length >= 2); assert.equal(store.snapshot().records.find(r => r.id === 'orphan').project_id, null);
});
test('description index participates in catalog and question search', () => {
  const catalog = C.decorateCatalog({ ...data, descriptions: { [data.catalog[0].id]: { summary: '临床诊疗与医学图谱', description: 'Access Medicine 提供临床诊断内容。', keywords: ['临床诊断'] } } });
  assert.ok(C.filterCatalog(catalog, { query: '临床诊疗' }).some(d => d.id === data.catalog[0].id));
  const result = C.matchResources('Access Medicine', catalog); assert.equal(result.candidates[0].database.id, data.catalog[0].id);
  assert.ok(C.matchResources('中英文医学', catalog).tags.includes('中文')); assert.ok(C.matchResources('中英文医学', catalog).tags.includes('外文'));
});
test('corrupt storage is not overwritten and unavailable storage remains explicit', () => {
  const memory = storage({ [C.STATE_KEY]: '{bad' }); assert.throws(() => C.createStore(data, memory), /损坏/); assert.equal(memory.values[C.STATE_KEY], '{bad');
  const temporary = C.createStore(data, { getItem() { throw new Error('blocked'); } }); assert.equal(temporary.snapshot().persistent, false); temporary.create('note', '临时记录', {}); assert.ok(temporary.snapshot().records.some(r => r.title === '临时记录'));
});

test('all finalized descriptions have matching IDs, 400–500 characters and dated sources', () => {
  assert.equal(Object.keys(data.descriptions).length, 394);
  for (const db of data.catalog) {
    const d = data.descriptions[db.id]; assert.ok(d); assert.ok(C.chars(d.description.replace(/\s/g, '')) >= 400 && C.chars(d.description.replace(/\s/g, '')) <= 500, db.id);
    assert.ok(d.summary.length > 20); assert.ok(d.sources.length); assert.equal(d.verifiedAt, '2026-10-15'); d.sources.forEach(s => assert.ok(C.safeUrl(s.url)));
  }
});
test('all 394 accordion descriptions preserve the matching source text without repeated sections', () => {
  const originals = JSON.parse(fs.readFileSync(path.join(root, 'src/data/source/descriptions.json')));
  const catalog = C.decorateCatalog(data);
  for (const source of originals) {
    const db = catalog.find(row => row.id === source.id), detail = db.detail;
    assert.equal(detail.catalogId, db.id);
    assert.equal(detail.name, db.name);
    assert.equal(detail.name, source.name);
    assert.deepEqual(detail.sections.map(section => section.id), ['content', 'research', 'access']);
    assert.equal(detail.sections.map(section => section.text).join('\n\n'), source.description.trim(), db.id);
    assert.equal(detail.description, source.description);
    assert.ok(detail.sections.every(section => section.title && section.text));
    assert.ok(detail.sources.some(s => source.sources.some(original => original.url === s.url)), db.id);
  }
});
test('updated language and subject metadata is normalized while source detail is preserved', () => {
  const catalog = C.decorateCatalog(data), bio = catalog.find(d => d.id === 'zju-962'), access = catalog.find(d => d.id === 'zju-1128');
  assert.equal(bio.language, '外文'); assert.ok(!bio.tags.includes('中文')); assert.ok(access.subjects.includes('医药'));
  assert.deepEqual([...new Set(catalog.map(d => d.language))].sort(), ['中文', '中外文', '外文', '多语种'].sort());
  assert.ok(C.matchResources('临床医学研究', catalog).candidates.slice(0, 3).every(c => c.database.subjects.includes('医药')));
  assert.ok(C.matchResources('仅中文 医学', catalog).candidates.every(c => c.database.language === '中文'));
});
test('bulk favorites preserve other scopes and recover without duplicate relationships', () => {
  const { store } = setup(), p = store.create('project', '整理目标'), db = data.catalog[0]; store.setFavorites(db, [null]);
  const personal = store.snapshot().records.find(r => r.kind === 'favorite'); store.organizeFavorites([personal.id], 'copy', p.id);
  assert.equal(store.snapshot().records.filter(r => r.kind === 'favorite').length, 2);
  store.organizeFavorites([personal.id], 'move', p.id); assert.equal(store.snapshot().records.filter(r => r.kind === 'favorite').length, 1);
  const deleted = store.snapshot().trash.at(-1); store.restore(deleted.id); assert.equal(store.snapshot().records.filter(r => r.kind === 'favorite').length, 2);
});
test('a stale browser tab cannot overwrite a newer saved state', () => {
  const memory = storage(), a = C.createStore(data, memory), b = C.createStore(data, memory); a.create('note', '另一个页面的新内容', {});
  assert.throws(() => b.create('note', '旧页面写入', {}), /另一页面/);
  b.reload(); b.create('note', '重读后写入', {}); assert.ok(b.snapshot().records.some(r => r.title === '另一个页面的新内容'));
});
test('legacy accounts remain accessible and separate data by local user', async () => {
  const { store } = setup(); await store.register('测试账号', 'test-only-passphrase'); const record = store.create('note', '账号专属内容', {});
  store.demo(); assert.ok(!store.snapshot().records.some(r => r.id === record.id)); await store.login('测试账号', 'test-only-passphrase'); assert.ok(store.snapshot().records.some(r => r.id === record.id));
  await assert.rejects(store.login('测试账号', 'wrong password'), /密码/); assert.throws(() => store.create('task', '日期测试', { dueDate: '2026-02-31' }), /日期/);
});

test('student registration preserves leading zeros and supports explicit login methods', async () => {
  const { store } = setup(), password = 'test-only-student-passphrase';
  await store.register('学号用户', password, '00123ABC');
  const user = store.snapshot().user, record = store.create('note', '学号账号的材料', { content: '仅限此账号' });
  assert.equal(user.studentNumber, '00123ABC'); assert.equal(user.isDemo, false);
  assert.ok(!('hash' in user)); assert.ok(!('salt' in user));
  store.logout(); await store.login('00123ABC', password, 'student');
  assert.equal(store.snapshot().user.id, user.id); assert.ok(store.snapshot().records.some(r => r.id === record.id));
  await assert.rejects(store.login('123ABC', password, 'student'), /密码/);
  await assert.rejects(store.login('00123ABC', password), /密码/);
  await store.register('00123ABC', password);
  const other = store.snapshot().user.id; assert.notEqual(other, user.id);
  await store.login('00123ABC', password, 'student'); assert.equal(store.snapshot().user.id, user.id);
  await store.login('00123ABC', password, 'username'); assert.equal(store.snapshot().user.id, other);
  assert.ok(!store.snapshot().records.some(r => r.id === record.id));
});
test('binding a legacy account keeps identity, hash, research and legacy storage unchanged', async () => {
  const source = setup(); await source.store.register('旧账号绑定', 'legacy-only-passphrase');
  const note = source.store.create('note', '旧账号研究', { content: '原文' }), legacy = JSON.parse(source.store.raw());
  delete legacy.schemaVersion; const old = JSON.stringify(legacy), user = legacy.users.find(u => u.id === legacy.session);
  const { store, memory } = setup({ [C.LEGACY_KEY]: old });
  await store.bindStudentNumber('0000088', 'legacy-only-passphrase');
  assert.equal(store.snapshot().user.studentNumber, '0000088'); assert.equal(store.snapshot().user.id, user.id);
  assert.ok(store.snapshot().records.some(r => r.id === note.id)); assert.equal(memory.values[C.LEGACY_KEY], old);
  assert.equal(JSON.parse(store.raw()).users.find(u => u.id === user.id).hash, user.hash);
  store.logout(); await store.login('0000088', 'legacy-only-passphrase', 'student'); assert.equal(store.snapshot().user.id, user.id);
  store.logout(); await store.login('旧账号绑定', 'legacy-only-passphrase'); assert.equal(store.snapshot().user.id, user.id);
  assert.ok(!JSON.stringify(store.backup()).includes('legacy-only-passphrase'));
  assert.ok(!JSON.stringify(store.backup()).includes(user.hash));
});
test('invalid, duplicate, unauthorized and unsaved student bindings are atomic', async () => {
  const { store, memory } = setup(), password = 'binding-only-passphrase';
  await assert.rejects(store.bindStudentNumber('001', password), /演示/);
  await store.register('绑定用户甲', password, '00001');
  await assert.rejects(store.bindStudentNumber('00002', password), /已经绑定/);
  await store.register('绑定用户乙', password); const before = store.raw();
  for (const number of ['空 格', '', 'A'.repeat(33)]) await assert.rejects(store.bindStudentNumber(number, password), /学号/);
  await assert.rejects(store.bindStudentNumber('00002', 'wrong-password'), /密码/);
  await assert.rejects(store.bindStudentNumber('00001', password), /其他账号/);
  assert.equal(store.raw(), before);
  memory.fail = true; await assert.rejects(store.bindStudentNumber('00002', password), /未保存/); memory.fail = false;
  assert.equal(store.raw(), before);
  const pending = store.bindStudentNumber('00002', password); store.demo();
  await assert.rejects(pending, /账号已切换/); assert.equal(store.snapshot().user.isDemo, true);
  await store.login('绑定用户乙', password); assert.equal(store.snapshot().user.studentNumber, null);
});
test('concurrent registration cannot create duplicate usernames or student identifiers', async () => {
  const { store } = setup();
  const sameNames = await Promise.allSettled([store.register('并发账号', 'concurrency-test-pass'), store.register('并发账号', 'concurrency-test-pass')]);
  assert.equal(sameNames.filter(r => r.status === 'fulfilled').length, 1);
  const sameStudents = await Promise.allSettled([store.register('并发学号甲', 'concurrency-test-pass', '001919'), store.register('并发学号乙', 'concurrency-test-pass', '001919')]);
  assert.equal(sameStudents.filter(r => r.status === 'fulfilled').length, 1);
  const users = JSON.parse(store.raw()).users;
  assert.equal(users.filter(u => u.username === '并发账号').length, 1); assert.equal(users.filter(u => u.studentNumber === '001919').length, 1);
});

test('safe import keeps the complete conflicting project and unions personal tags without overwriting local edits', () => {
  const { store } = setup(), db = data.catalog[0], project = store.startResearch('安全接续');
  const note = store.create('note', '原笔记', { content: '设备A', folder: 'question' }, project.id);
  store.setTags(db.id, ['本机标签']);
  const payload = store.backup(project.id); payload.personalTags = [{ catalogId: db.id, tags: ['传入标签'] }];
  payload.records.find(r => r.id === note.id).data.content = '设备B';
  const preview = store.previewImport(JSON.stringify(payload));
  assert.equal(preview.counts.changed, 1);
  const result = store.importPreview(preview);
  assert.equal(result.mode, 'copy'); assert.equal(result.updated, 0);
  const rows = store.snapshot().records;
  assert.equal(rows.find(r => r.id === note.id).data.content, '设备A');
  const imported = rows.find(r => r.title === '原笔记' && r.id !== note.id);
  assert.equal(imported.data.content, '设备B'); assert.notEqual(imported.project_id, project.id);
  assert.deepEqual(plain(store.snapshot().catalog.find(d => d.id === db.id).personalTags), ['本机标签', '传入标签']);
});

test('identical imports skip records and do not accumulate recovery points; explicit updates require a fresh preview', () => {
  const { store } = setup(), p = store.startResearch('接续'); store.create('note', '笔记', { content: '正文' }, p.id);
  const payload = store.backup(p.id), before = store.raw();
  const report = store.importPreview(store.previewImport(JSON.stringify(payload)));
  assert.equal(report.skipped, 2); assert.equal(store.raw(), before);
  const preview = store.previewImport(JSON.stringify(payload));
  store.create('note', '刚写的资料', {}, p.id);
  assert.throws(() => store.importPreview(preview, 'merge'), /预览后已变化/);
  payload.records.find(r => r.kind === 'note').data.content = '主动更新';
  store.importPreview(store.previewImport(JSON.stringify(payload)), 'merge');
  assert.equal(store.snapshot().records.find(r => r.title === '笔记').data.content, '主动更新');
  assert.ok(store.snapshot().records.find(r => r.title === '刚写的资料'));
});

test('failed saves expose the error without changing records and account-scoped drafts do not enter backups', async () => {
  const { store, memory } = setup(), owner = store.snapshot().user.id;
  store.writeDraft('note/project-a/question', { title: '草稿私有标记' }, owner);
  assert.equal(store.readDraft('note/project-a/question', owner).value.title, '草稿私有标记');
  assert.ok(!JSON.stringify(store.backup()).includes('草稿私有标记'));
  const before = store.raw(); memory.fail = true;
  assert.throws(() => store.create('note', '失败记录', {}), /未保存/);
  assert.ok(store.snapshot().saveError); assert.equal(store.raw(), before);
  assert.throws(() => store.writeDraft('x', '未保存输入', owner), /草稿尚未保存/);
  assert.equal(store.readDraft('x', owner).value, '未保存输入'); assert.equal(store.hasUnsavedDrafts(), true);
  memory.fail = false; await store.register('draft-account', 'long-test-password');
  assert.equal(store.readDraft('note/project-a/question', store.snapshot().user.id), null);
  assert.throws(() => store.writeDraft('x', '旧页面写入', owner), /账号已切换/);
  assert.equal(store.snapshot().saveError, '');
});

test('research state is derived without writes and ordinary stage materials do not imply a started research', () => {
  const { store } = setup();
  const project = store.create('project', '12', { folders: ['question', 'analysis', 'solution'], description: 'Keep me' });
  store.create('note', '普通资料', { folder: 'solution', content: '不是研究对话' }, project.id);
  const before = store.raw();
  assert.equal(C.getResearchState(project, store.snapshot().records).status, 'not-started');
  assert.equal(C.getResearchState(project, store.snapshot().records).action, '开始研究');
  assert.equal(store.raw(), before);
  const evidence = [
    { project_id: project.id, kind: 'recommendation', data: { folder: 'analysis' }, created_at: '2026-01-02' },
    { project_id: project.id, kind: 'note', data: { subtype: 'conversation', folder: 'question' }, updated_at: '2026-01-03' },
    { project_id: 'another-project', kind: 'recommendation', data: { folder: 'solution' }, updated_at: '2026-12-31' }
  ];
  const encoded = JSON.stringify(evidence);
  assert.equal(C.getResearchState(project, evidence).stage, 'question');
  assert.equal(C.getResearchState(project, evidence).status, 'in-progress');
  assert.equal(JSON.stringify(evidence), encoded);
  assert.equal(C.getResearchState({ ...project, data: { researchStage: 'analysis' } }, evidence).stage, 'analysis');
  const undated = evidence.slice(0, 2).map(r => ({ ...r, created_at: 'invalid', updated_at: 'invalid' }));
  assert.equal(C.getResearchState(project, undated).stage, 'question');
});

test('starting an existing numeric-title project preserves its identity and contents and is idempotent', () => {
  const { store, memory } = setup();
  const project = store.create('project', '23', { description: '原有说明', extra: { keep: true } });
  const note = store.create('note', '原有资料', { content: '不得丢失', folder: 'analysis' }, project.id);
  const count = store.snapshot().records.length;
  let writes = 0; const save = memory.setItem.bind(memory);
  memory.setItem = (...args) => { writes++; save(...args); };
  const started = store.beginResearch(project.id);
  assert.equal(started.id, project.id); assert.equal(started.title, '23');
  assert.equal(started.data.researchStage, 'question'); assert.equal(started.data.researchComplete, false);
  assert.deepEqual(plain(started.data.extra), { keep: true }); assert.equal(started.data.description, '原有说明');
  assert.equal(store.snapshot().records.length, count);
  assert.deepEqual(plain(store.snapshot().records.find(r => r.id === note.id)), plain(note));
  const afterStart = store.raw(); store.beginResearch(project.id); store.beginResearch(project.id);
  assert.equal(writes, 1); assert.equal(store.raw(), afterStart);
});

test('legacy research evidence is recovered only when explicitly entering the existing project', () => {
  const { store } = setup(), project = store.create('project', '旧研究', { description: '旧数据' });
  const conversation = store.create('note', '分析对话', { subtype: 'conversation', folder: 'analysis', messages: [{ role: 'user', content: '保留原对话' }] }, project.id);
  const before = store.raw();
  assert.equal(C.getResearchState(project, store.snapshot().records).action, '继续研究');
  assert.equal(store.raw(), before);
  const started = store.beginResearch(project.id);
  assert.equal(started.data.researchStage, 'analysis'); assert.equal(started.data.description, '旧数据');
  assert.deepEqual(plain(store.snapshot().records.find(r => r.id === conversation.id)), plain(conversation));
});

test('opening or advancing a completed research never changes its stage, completion, or timestamps', () => {
  const { store } = setup();
  for (const stage of [undefined, 'question', 'analysis', 'solution']) {
    const project = store.create('project', '已完成项目', { researchComplete: true, ...(stage ? { researchStage: stage } : {}) });
    const before = store.raw();
    assert.equal(C.getResearchState(project, store.snapshot().records).action, '查看研究过程');
    assert.equal(C.getResearchState(project, store.snapshot().records).stage, stage || 'solution');
    store.beginResearch(project.id); store.advanceResearch(project.id);
    assert.equal(store.raw(), before);
  }
});

test('existing-project initialization fails atomically on storage errors and invalid targets', async () => {
  const { store, memory } = setup(), project = store.create('project', '原账号项目');
  const note = store.create('note', '非项目记录');
  const before = store.raw(); memory.fail = true;
  assert.throws(() => store.beginResearch(project.id), /未保存/);
  assert.equal(store.raw(), before); memory.fail = false;
  assert.throws(() => store.beginResearch(note.id), /不存在/);
  assert.throws(() => store.beginResearch('deleted-project'), /不存在/);
  assert.equal(store.raw(), before);
  await store.register('research-entry-other-account', 'long-test-password');
  const other = store.raw();
  assert.throws(() => store.beginResearch(project.id), /不存在/);
  assert.equal(store.raw(), other);
});

test('project research state and original relationships survive backup import and re-entry', () => {
  const { store } = setup();
  const idle = store.create('project', '尚未开始'), active = store.startResearch('12'), done = store.startResearch('23');
  store.advanceResearch(active.id);
  for (let i = 0; i < 3; i++) store.advanceResearch(done.id);
  store.create('note', '进行中的分析对话', { folder: 'analysis', subtype: 'conversation', messages: [{ role: 'user', content: '下一步继续' }] }, active.id);
  const target = setup().store;
  target.importPreview(target.previewImport(JSON.stringify(store.backup())), 'copy');
  const snapshot = target.snapshot(), projects = snapshot.records.filter(r => r.kind === 'project');
  for (const [title, status] of [['尚未开始', 'not-started'], ['12', 'in-progress'], ['23', 'completed']]) {
    const project = projects.find(p => p.title === title);
    assert.equal(C.getResearchState(project, snapshot.records).status, status);
  }
  const imported = projects.find(p => p.title === '12'), before = target.raw();
  target.beginResearch(imported.id);
  assert.equal(target.raw(), before);
  assert.equal(target.snapshot().records.find(r => r.title === '进行中的分析对话').project_id, imported.id);
  assert.equal(target.snapshot().records.find(r => r.id === imported.id).data.researchStage, 'analysis');
});
