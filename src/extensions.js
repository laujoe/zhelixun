/* Browser-only model profiles and attachment storage. Research JSON never contains model settings. */
(() => {
  'use strict';
  const C = ZLXCore;
  const LIMIT = 10 * 1024 * 1024;
  const available = () => !globalThis.ZLX_STATIC && location.protocol === 'http:' && location.hostname === '127.0.0.1';
  const controllers = new Map();
  function profile(userId) {
    const key = `zlx-model-profile:${userId}`;
    let token = localStorage.getItem(key);
    if (!token) { token = [...crypto.getRandomValues(new Uint8Array(32))].map(x => x.toString(16).padStart(2, '0')).join(''); localStorage.setItem(key, token); }
    return token;
  }
  function cancel(userId) { for (const controller of controllers.get(userId) || []) controller.abort(); }
  async function request(userId, endpoint, method = 'GET', value, signal) {
    if (!available()) throw new Error('在线模型需要本地服务。请在 scripts/launchers 文件夹使用对应系统的“启动浙里寻”入口。');
    const controller = new AbortController();
    if (!controllers.has(userId)) controllers.set(userId, new Set()); controllers.get(userId).add(controller);
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timeout = setTimeout(abort, 95000);
    try {
      const response = await fetch(`/api/${endpoint}`, { method, headers: { 'Content-Type': 'application/json', 'X-ZLX-Profile': profile(userId) }, ...(value === undefined ? {} : { body: JSON.stringify(value) }), signal: controller.signal });
      let data; try { data = await response.json(); } catch { throw new Error('本地服务版本不匹配，请重新启动浙里寻。'); }
      if (!response.ok) throw new Error(data.error || `请求失败：${response.status}`);
      return data;
    } catch (e) { if (controller.signal.aborted) throw new Error('请求已取消或超时，可手动重试。'); throw e; }
    finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); controllers.get(userId)?.delete(controller); }
  }
  let dbPromise;
  function database() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) return reject(new Error('当前浏览器不支持附件存储。'));
      const req = indexedDB.open('zhelixun-attachments-v1', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('files', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(new Error('无法打开附件存储，请允许浏览器本地存储。'));
    }).catch(e => { dbPromise = null; throw e; });
    return dbPromise;
  }
  async function transaction(mode, callback) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', mode), store = tx.objectStore('files'); let result;
      try { result = callback(store); } catch (e) { tx.abort(); return reject(e); }
      tx.oncomplete = () => resolve(result?.result); tx.onerror = tx.onabort = () => reject(new Error('附件保存失败，可能存储空间不足或被禁用。'));
    });
  }
  async function get(userId, id) {
    const entry = await transaction('readonly', store => store.get(id));
    if (!entry || entry.userId !== userId) throw new Error('附件不存在或不属于当前账号，请从完整备份恢复。');
    return entry;
  }
  async function add(userId, file) {
    if (file.size > LIMIT) throw new Error('单个附件不能超过10MB。');
    const id = C.uid();
    await transaction('readwrite', store => store.add({ id, userId, blob: file }));
    return { id, name: file.name, size: file.size, type: file.type || 'application/octet-stream' };
  }
  const remove = id => transaction('readwrite', store => store.delete(id));
  async function encode(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer()); let text = '';
    for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(text);
  }
  function decode(entry) {
    if (!entry || typeof entry.id !== 'string' || !entry.id || typeof entry.base64 !== 'string' || entry.base64.length > Math.ceil(LIMIT / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry.base64)) throw new Error('备份中的附件格式错误或超过10MB。');
    const raw = atob(entry.base64), bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
    if (bytes.length > LIMIT || bytes.length !== entry.size) throw new Error('备份附件大小不一致。');
    return new Blob([bytes], { type: String(entry.type || 'application/octet-stream') });
  }
  const refs = records => [...new Map(records.flatMap(r => r.data.attachments || []).map(a => [a.id, a])).values()];
  async function pack(userId, backup) {
    const attachments = [];
    for (const ref of refs(backup.records)) { const entry = await get(userId, ref.id); attachments.push({ ...ref, base64: await encode(entry.blob) }); }
    const result = { ...backup, format: 'zhelixun-backup-v4', attachments };
    if (new TextEncoder().encode(JSON.stringify(result)).length > 100 * 1024 * 1024) throw new Error('备份超过100MB，请按项目或筛选范围分别备份。');
    return result;
  }
  function validateBackup(payload) {
    const entries = payload.attachments || [];
    if (!Array.isArray(entries)) throw new Error('附件列表格式错误。');
    const ids = new Set();
    for (const entry of entries) { if (ids.has(entry.id)) throw new Error('备份包含重复附件ID。'); ids.add(entry.id); decode(entry); }
    const needed = refs(payload.records || []);
    if (needed.some(ref => !ids.has(ref.id))) throw new Error('备份缺少附件原件，请使用包含附件的完整JSON。');
    for (const ref of needed) { const entry = entries.find(e => e.id === ref.id); if (entry.size !== ref.size || entry.name !== ref.name || entry.type !== ref.type) throw new Error('附件信息与原件清单不一致，请重新导出完整备份。'); }
    return entries;
  }
  const digest = async blob => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(n => n.toString(16).padStart(2, '0')).join('');
  async function prepare(userId, store, preview) {
    const payload = C.copy(preview.payload), entries = validateBackup(payload);
    const local = refs(store.snapshot().records || []), mapping = new Map(), reused = new Set(), hashes = new Map();
    for (const entry of entries) {
      const hash = await digest(decode(entry));
      // Prefer the original matching ID when several local files have equal bytes.
      const candidates = local.filter(r => r.name === entry.name && r.size === entry.size && r.type === entry.type).sort((a, b) => Number(b.id === entry.id) - Number(a.id === entry.id));
      for (const ref of candidates) {
        if (!hashes.has(ref.id)) { try { hashes.set(ref.id, await digest((await get(userId, ref.id)).blob)); } catch { hashes.set(ref.id, null); } }
        if (hashes.get(ref.id) === hash) { mapping.set(entry.id, ref.id); reused.add(ref.id); break; }
      }
      // An ID alone cannot stand for different bytes in an import preview.
      // Give changed/missing originals a new identity before comparing records.
      if (!mapping.has(entry.id) && local.some(ref => ref.id === entry.id)) mapping.set(entry.id, C.uid());
    }
    for (const record of payload.records) if (record.data.attachments) record.data.attachments = record.data.attachments.map(ref => ({ ...ref, id: mapping.get(ref.id) || ref.id }));
    payload.attachments = [...new Map(entries.map(e => { const item = { ...e, id: mapping.get(e.id) || e.id }; return [item.id, item]; })).values()];
    if (store.snapshot().user?.id !== userId) throw new Error('当前账号已切换，请在目标账号重新选择备份。');
    const checked = store.previewImport(JSON.stringify(payload), 'json', preview.projectId);
    return { preview: { ...checked, format: preview.format, projectId: preview.projectId, warnings: [...new Set([...(preview.warnings || []), ...(checked.warnings || [])])] }, reused };
  }
  async function inspect(userId, store, text, format = 'json', projectId = null) {
    return (await prepare(userId, store, store.previewImport(text, format, projectId))).preview;
  }
  async function restore(userId, store, preview, mode = 'safe') {
    const originalPreview = preview;
    const checkAccount = () => { store.assertImportCurrent?.(originalPreview); if (store.snapshot().user?.id !== userId) throw new Error('当前账号已切换，导入已取消，请在目标账号重新选择备份。'); };
    checkAccount();
    const prepared = await prepare(userId, store, preview); preview = prepared.preview; checkAccount();
    if (mode === 'safe') mode = preview.counts?.changed ? 'copy' : 'merge';
    const entries = validateBackup(preview.payload), payload = C.copy(preview.payload), added = [];
    const mapping = new Map(entries.map(e => [e.id, mode !== 'copy' && prepared.reused.has(e.id) ? e.id : C.uid()]));
    try {
      if (entries.length) await transaction('readwrite', files => { for (const entry of entries) { const id = mapping.get(entry.id); if (prepared.reused.has(id) && mode !== 'copy') continue; added.push(id); files.add({ id, userId, blob: decode(entry) }); } });
      for (const record of payload.records) if (record.data.attachments) record.data.attachments = record.data.attachments.map(ref => ({ ...ref, id: mapping.get(ref.id) }));
      // Blobs are staged under new IDs; the existing atomic record write is the commit point.
      delete payload.attachments;
      checkAccount();
      const checked = store.previewImport(JSON.stringify(payload), 'json', preview.projectId);
      return store.importPreview({ ...checked, format: preview.format, projectId: preview.projectId, warnings: preview.warnings }, mode);
    } catch (e) { for (const id of added) await remove(id).catch(() => {}); throw e; }
  }
  globalThis.ZLXExtras = { available, request, cancel, files: { add, get, remove, pack, inspect, restore, validateBackup } };
})();
