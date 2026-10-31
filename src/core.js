/* Domain rules shared by the interface and the regression suite. No DOM dependencies. */
(() => {
  'use strict';
  const STATE_KEY = 'zhelixun-standalone-v3';
  const LEGACY_KEY = 'zhelixun-standalone-v1';
  const KINDS = new Set(['project', 'task', 'activity', 'search', 'material', 'note', 'citation', 'graph', 'favorite', 'recommendation', 'loan']);
  const KIND_NAMES = { project: '研究项目', task: '研究任务', activity: '资源访问', search: '检索记录', material: '研究材料', note: '研究笔记', citation: '引用证据', graph: '研究图表', favorite: '数据库收藏', recommendation: '选库记录', loan: '借阅记录' };
  const FOLDERS = [{ id: 'question', name: '提出问题', hint: '研究背景、问题与目标' }, { id: 'analysis', name: '分析问题', hint: '文献、数据与分析笔记' }, { id: 'solution', name: '解决问题', hint: '论点、证据与研究成果' }];
  const STATUSES = [{ id: 'inbox', name: '待完成' }, { id: 'done', name: '已完成' }];
  const SINGLE_REFS = new Set(['linkedId', 'materialId', 'noteId', 'citationId', 'argumentId', 'recordId', 'sourceRecordId']);
  const MULTI_REFS = new Set(['linkedIds', 'materialIds', 'noteIds', 'citationIds', 'recordIds', 'sourceRecordIds']);
  const copy = value => JSON.parse(JSON.stringify(value));
  const chars = value => Array.from(String(value ?? '')).length;
  const short = (value, size = 60) => Array.from(String(value ?? '')).slice(0, size).join('');
  const now = () => new Date().toISOString();
  const uid = () => crypto.randomUUID();
  const unique = values => [...new Set(values.filter(Boolean))];
  function getResearchState(project, records = []) {
    const data = project?.data || {}, validStage = value => FOLDERS.some(f => f.id === value);
    let stage = validStage(data.researchStage) ? data.researchStage : null;
    if (!stage && project?.id) {
      const history = records.filter(r => r.project_id === project.id && validStage(r.data?.folder) &&
        (r.kind === 'recommendation' || r.data?.subtype === 'conversation'));
      const timestamp = r => {
        const updated = Date.parse(r.updated_at), created = Date.parse(r.created_at);
        return Number.isFinite(updated) ? updated : Number.isFinite(created) ? created : 0;
      };
      // Stable input order breaks timestamp ties without changing stored records.
      stage = history.reduce((latest, r) => !latest || timestamp(r) >= timestamp(latest) ? r : latest, null)?.data.folder || null;
    }
    const status = data.researchComplete === true ? 'completed' : stage ? 'in-progress' : 'not-started';
    stage ||= status === 'completed' ? 'solution' : 'question';
    const stageName = FOLDERS.find(f => f.id === stage).name;
    return { status, stage, stageName,
      label: status === 'completed' ? '已完成研究' : status === 'in-progress' ? `进行中 · ${stageName}` : '未开始研究',
      action: status === 'completed' ? '查看研究过程' : status === 'in-progress' ? '继续研究' : '开始研究' };
  }
  const stable = value => JSON.stringify((function sort(v) {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => [k, sort(v[k])]));
    return v;
  })(value));
  const sameRecord = (a, b) => stable({ kind: a.kind, title: a.title, project_id: a.project_id || null, data: a.data }) === stable({ kind: b.kind, title: b.title, project_id: b.project_id || null, data: b.data });
  const safeUrl = value => {
    try {
      const url = new URL(String(value).trim());
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
      if (/（[^）]*(?:无法使用|暂停|停用)[^）]*）/.test(decodeURIComponent(url.href))) return null;
      return url.href;
    } catch { return null; }
  };
  const resourceUrl = db => [db.access?.directUrl, db.access?.officialEntryUrl, db.url, db.source_url].map(safeUrl).find(Boolean) || 'https://libdb.zju.edu.cn/';
  const officialUrl = db => safeUrl(db.access?.sourceUrl || db.source_url) || 'https://libdb.zju.edu.cn/';
  const localDate = value => {
    if (!value) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const date = new Date(value);
    if (Number.isNaN(+date)) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const validDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
  function parseTags(value) {
    const list = Array.isArray(value) ? value : String(value).split(/[,，\n]/);
    const result = unique(list.map(tag => String(tag).trim()));
    if (result.length > 20) throw new Error('最多保留 20 个标签，请合并或删除重复含义的标签。');
    const long = result.find(tag => chars(tag) > 60);
    if (long) throw new Error(`标签“${short(long, 12)}…”超过 60 字。`);
    return result;
  }
  function filterRecords(records, scope = '', kind = '', keyword = '', from = '', to = '') {
    const needle = keyword.trim().toLocaleLowerCase();
    return records.filter(record => {
      if (scope === 'unassigned' ? record.project_id || record.kind === 'project' : scope && record.project_id !== scope && record.id !== scope) return false;
      if (kind && record.kind !== kind) return false;
      if (needle && !`${record.title} ${JSON.stringify(record.data)}`.toLocaleLowerCase().includes(needle)) return false;
      const date = localDate(record.created_at);
      return (!from || date >= from) && (!to || date <= to);
    });
  }
  function decorateCatalog(data, personalTags = {}) {
    return data.catalog.map(db => {
      const detail = data.descriptions?.[db.id] || null;
      const languageNote = detail?.language || db.language;
      const language = /^(外文|英文|英语|日文等|德语)/.test(languageNote) ? '外文' : /^(中外文|中英文|日文、汉文)/.test(languageNote) ? '中外文' : /多语|多语言|语种各异|少数民族|中文等/.test(languageNote) ? '多语种' : /中文/.test(languageNote) ? '中文' : languageNote;
      const officialTags = [...(db.officialTags || db.tags || []).filter(tag => !detail?.language || !['中文', '外文', '中文文献', '外文文献'].includes(tag)), ...(detail?.language ? [language] : [])];
      const subjectRules = [[/医|药|护理|生理/, '医药'], [/计算机|信息|硬件/, '计算机/网络'], [/化学|化工|材料/, '化学/化工/材料'], [/农|食品|林业/, '农业/食品'], [/物理|力学|光学/, '物理/力学'], [/环境|能源/, '环境/能源'], [/土木|建筑|水利/, '土木/建筑'], [/地球|天文/, '地球科学/天文学'], [/经济|金融|商科|经管/, '经济'], [/管理|商科|经管|旅游|酒店/, '管理'], [/人文|历史|文学|外语|英语/, '人文'], [/社科|社会科学|政治|传媒|职业/, '社科'], [/生物|生命/, '生物'], [/电子|电气/, '电子电气'], [/数学|统计/, '数学'], [/机械|汽车/, '机械'], [/工程|工学|航空|航天/, '工程'], [/法学|法律|仲裁/, '法学'], [/艺术|设计/, '艺术'], [/心理/, '心理学']];
      const subjects = detail?.contentSubjects?.length ? unique(detail.contentSubjects.flatMap(s => { const mapped = subjectRules.filter(([re]) => re.test(s)).map(([, name]) => name); return mapped.length ? mapped : ['综合']; })) : db.subjects;
      return { ...db, subjects, language, languageNote, detail, officialTags, personalTags: personalTags[db.id] || [], access: { ...db.access, ...Object.fromEntries(Object.entries(detail?.access || {}).filter(([, value]) => value !== undefined && value !== null && value !== '')) },
        tags: unique([...officialTags, ...subjects, ...(personalTags[db.id] || []), ...(detail?.keywords || [])]),
        summary: detail?.summary || '',
      };
    });
  }
  function filterCatalog(catalog, filters, favorites = []) {
    const q = (filters.query || '').trim().toLocaleLowerCase();
    const favored = new Set(favorites.filter(f => !filters.project || (filters.project === 'personal' ? !f.project_id : f.project_id === filters.project)).map(f => f.data.catalogId));
    const result = catalog.filter(db => {
      const text = [db.name, ...(db.aliases || []), db.provider || '', db.summary, db.detail?.description || '', ...db.tags].join(' ').toLocaleLowerCase();
      return (!q || text.includes(q)) && (!filters.subject || db.subjects.includes(filters.subject)) &&
        (!filters.type || db.types.includes(filters.type)) && (!filters.language || db.language === filters.language) &&
        (!(filters.saved || filters.project) || favored.has(db.id));
    });
    if (filters.sort === 'name-desc') result.sort((a, b) => b.name.localeCompare(a.name, 'zh-CN'));
    else if (filters.sort === 'recent') {
      const dates = new Map(favorites.map(f => [f.data.catalogId, f.created_at]));
      result.sort((a, b) => (dates.get(b.id) || '').localeCompare(dates.get(a.id) || '') || a.name.localeCompare(b.name));
    } else result.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
    return result;
  }
  function matchResources(query, catalog, explicitTags = []) {
    if (chars(query) >= 3000) throw new Error('研究问题必须少于 3000 字，请缩短后重试。');
    const text = String(query).trim();
    if (!text && !explicitTags.length) return { mode: 'offline', tags: [], candidates: [], message: '请描述研究主题，或先选择研究标签。' };
    const inherited = ZLXRuntime.matchLegacy(text, catalog, explicitTags);
    const primary = [
      [/医学|医疗|诊断|临床|医药/, '医药'], [/机器学习|人工智能|深度学习|算法|计算机/, '计算机/网络'],
      [/历史|古籍|地方志|方志|考古|人文/, '人文'], [/经济|金融|统计数据/, '经济'], [/管理|企业|商业/, '管理'],
      [/环境|绿色|能源|碳排/, '环境/能源'], [/数学|几何|代数/, '数学'], [/物理|量子|力学/, '物理/力学'],
    ].filter(([re]) => re.test(text)).map(([, tag]) => tag);
    const tags = unique([...inherited.tags, ...explicitTags, ...primary,
      ...(/中英文|中外文/.test(text) ? ['中文', '外文'] : []),
      ...(/医学|医疗|诊断|临床|医药/.test(text) ? ['医药'] : []),
      ...(/机器学习|人工智能|深度学习|算法|计算机/.test(text) ? ['计算机/网络'] : []),
      ...(/历史|古籍|地方志|方志|考古|人文/.test(text) ? ['人文'] : []),
      ...(/环境|绿色|能源|碳排/.test(text) ? ['环境/能源'] : []),
    ]).slice(0, 20);
    const generic = new Set(['中文', '外文', '国际期刊', '中文文献', '外文文献', '期刊/会议论文', '学位论文', '图书', '中文图书']);
    const domain = tags.filter(t => !generic.has(t));
    const words = unique((text.toLocaleLowerCase().match(/[a-z][a-z0-9+.-]{1,}|[\u4e00-\u9fff]{2,}/g) || []).filter(x => x.length < 32));
    const onlyChinese = /(?:只要|仅|只需|只看|限于)中文/.test(text), onlyForeign = /(?:只要|仅|只需|只看|限于)(?:外文|英文)/.test(text);
    const excludedTypes = [['图书', /(?:不要|排除|不需要)图书/], ['学位论文', /(?:不要|排除|不需要)学位论文/], ['视频', /(?:不要|排除|不需要)视频/]].filter(([, re]) => re.test(text)).map(([type]) => type);
    const candidates = catalog.filter(db => (!onlyChinese || db.language === '中文') && (!onlyForeign || db.language === '外文') && !excludedTypes.some(type => db.types.length === 1 && db.types.includes(type))).map(db => {
      const matchedTags = tags.filter(tag => db.tags.includes(tag) || db.subjects.includes(tag) || db.types.includes(tag));
      const nameHit = text.length >= 2 && db.name.toLocaleLowerCase().includes(text.toLocaleLowerCase());
      const wordsHit = words.filter(word => db.name.toLocaleLowerCase().includes(word));
      const content = [db.summary, db.detail?.description || '', ...(db.detail?.keywords || [])].join(' ').toLocaleLowerCase();
      const descriptionHits = unique([...words.filter(word => content.includes(word)), ...(db.detail?.keywords || []).filter(word => chars(word) >= 2 && text.includes(word))]);
      const domainHits = matchedTags.filter(tag => domain.includes(tag));
      const primaryHits = primary.filter(tag => matchedTags.includes(tag));
      const score = primaryHits.length * 32 + domainHits.length * 12 + matchedTags.length * 2 + wordsHit.length * 20 + descriptionHits.length * 4 + (nameHit ? 60 : 0);
      const reason = unique([...(nameHit || wordsHit.length ? ['名称与问题关键词相符'] : []), ...(domainHits.length ? [`学科与主题：${domainHits.join('、')}`] : []), ...(descriptionHits.length ? [`内容提及：${descriptionHits.join('、')}`] : []), ...(!domainHits.length && matchedTags.length ? [`目录标签：${matchedTags.join('、')}`] : [])]).join('；');
      return { database: db, matchedTags, score, reason, relevant: !domain.length || domainHits.length || nameHit || wordsHit.length || descriptionHits.length };
    }).filter(x => x.score > 0 && x.relevant).sort((a, b) => b.score - a.score || a.database.name.localeCompare(b.database.name, 'en')).slice(0, 8);
    return { mode: 'offline', query: text, tags, candidates, message: candidates.length ? '根据目录主题、资源名称和已核验说明进行离线匹配。全文权限以原平台为准。' : '未找到合适候选。可调整学科、材料类型或直接检索数据库目录。' };
  }
  async function passwordHash(password, salt) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 120000, hash: 'SHA-256' }, key, 256);
    return [...new Uint8Array(bits)].map(n => n.toString(16).padStart(2, '0')).join('');
  }
  function normalizeStudentNumber(value) {
    const number = String(value ?? '').trim();
    if (!/^[A-Za-z0-9]{1,32}$/.test(number)) throw new Error('学号需为 1–32 位字母或数字，前导零会完整保留。');
    return number;
  }
  function validateRecord(record) {
    if (!KINDS.has(record.kind)) throw new Error(`不支持的记录类型：${record.kind || '未填写'}`);
    if (typeof record.title !== 'string' || !record.title.trim() || chars(record.title) > 500) throw new Error('请填写有效标题（最多 500 字）。');
    if (!record.data || typeof record.data !== 'object' || Array.isArray(record.data)) throw new Error(`“${record.title}”的记录内容格式不正确。`);
    if (record.data.researchStage && !FOLDERS.some(f => f.id === record.data.researchStage)) throw new Error('研究阶段不正确。');
    if (record.data.attachments && (!Array.isArray(record.data.attachments) || record.data.attachments.some(a => !a || typeof a.id !== 'string' || typeof a.name !== 'string' || !Number.isInteger(a.size) || a.size < 0 || a.size > 10 * 1024 * 1024))) throw new Error('附件信息格式错误。');
    if (record.data.subtype === 'conversation' && (!Array.isArray(record.data.messages) || record.data.messages.some(m => !m || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string'))) throw new Error('对话记录格式不正确。');
    if (record.kind === 'task' && record.data.dueDate && !validDay(record.data.dueDate)) throw new Error('截止日期格式不正确。');
    if (record.data.eventDate && !validDay(record.data.eventDate)) throw new Error('活动日期格式不正确。');
  }
  function createStore(publicData, storage, { freshSession = false } = {}) {
    let state, persistent = true, migrated = false;
    let raw;
    try { raw = storage.getItem(STATE_KEY); }
    catch { persistent = false; }
    if (raw) {
      try { state = JSON.parse(raw); } catch { throw new Error('本地数据文件损坏。原始数据仍保留，请先导出原始数据，再恢复备份。'); }
    } else {
      let old;
      if (persistent) { try { old = storage.getItem(LEGACY_KEY); } catch { persistent = false; } }
      if (old) {
        try { state = JSON.parse(old); migrated = true; } catch { throw new Error('旧版数据无法解析，已停止自动迁移；旧版文件和数据未被改写。'); }
      } else state = ZLXRuntime.createLegacyState();
    }
    if (state.version !== 1 || !Array.isArray(state.users) || !Array.isArray(state.records)) throw new Error('本地数据结构不正确，请使用 JSON 备份恢复。');
    state = { ...state, schemaVersion: 3, tags: state.tags || {}, trash: state.trash || [], imports: state.imports || [] };
    // Each page signs in independently; opening a page must not log out other tabs.
    if (freshSession) state.session = null;
    state.records = state.records.map(r => r.kind === 'activity' && r.data?.date && !r.data.eventDate ? { ...r, data: { ...r.data, eventDate: localDate(r.data.date) } } : r);
    let lastSaved = raw || null, saveError = '', savedAt = null, revision = 0;
    const listeners = new Set();
    const volatileDrafts = new Map();
    const failedSave = message => { saveError = message; listeners.forEach(fn => fn()); throw new Error(message); };
    const save = next => {
      if (persistent) {
        let value;
        try { value = storage.getItem(STATE_KEY); }
        catch { return failedSave('浏览器无法读取保存状态，本次修改未保存。请先下载备份。'); }
        if (value !== lastSaved) return failedSave('另一页面已更新研究空间。本次修改未覆盖新数据，请在账号设置重新读取本地数据后重试。');
        try { const encoded = JSON.stringify(next); storage.setItem(STATE_KEY, encoded); lastSaved = encoded; }
        catch { return failedSave('浏览器存储空间不足或保存被禁用，本次修改未保存。请先下载备份。'); }
      }
      state = next; revision++; saveError = ''; savedAt = persistent ? now() : null;
      listeners.forEach(fn => fn());
    };
    if (!raw && persistent) {
      try { const encoded = JSON.stringify(state); storage.setItem(STATE_KEY, encoded); lastSaved = encoded; }
      catch { persistent = false; }
    }
    const user = () => state.users.find(u => u.id === state.session) || null;
    const requireUser = () => { if (!user()) throw new Error('请先进入研究空间。'); return user(); };
    const records = () => state.records.filter(r => r.user_id === requireUser().id);
    const validateProject = id => { if (id && !records().some(r => r.kind === 'project' && r.id === id)) throw new Error('所属研究项目不存在。'); };
    const canonicalId = id => publicData.catalog.find(db => db.id === id || db.aliases?.includes(id))?.id || id;
    const mutate = fn => { const next = copy(state); const result = fn(next); save(next); return result; };
    const snapshot = () => ({ user: user() ? { id: user().id, username: user().username, studentNumber: user().studentNumber || null, isDemo: user().id === 'standalone-demo' } : null, records: user() ? copy(records()) : [], catalog: decorateCatalog(publicData, user() ? state.tags[user().id] || {} : {}), persistent, saveError, savedAt, backup: user() ? state.backups?.[user().id] || null : null, migrated, trash: user() ? copy(state.trash.filter(t => t.user_id === user().id)) : [] });
    const create = (kind, title, data = {}, projectId = null) => {
      requireUser(); validateProject(projectId);
      title = String(title).trim();
      if (kind === 'project') {
        const base = title, names = new Set(records().filter(r => r.kind === 'project').map(r => r.title));
        let suffix = 1;
        while (names.has(title)) title = `${base} ${suffix++}`;
      }
      const record = { id: uid(), kind, title, data: copy(data), project_id: kind === 'project' ? null : projectId || null, user_id: user().id, created_at: now(), updated_at: now() };
      validateRecord(record);
      mutate(next => next.records.push(record));
      return copy(record);
    };
    const update = (id, changes) => {
      const old = records().find(r => r.id === id);
      if (!old) throw new Error('记录不存在，可能已在其他页面删除。');
      const record = { ...old, title: changes.title === undefined ? old.title : String(changes.title).trim(), data: changes.data === undefined ? old.data : copy(changes.data), project_id: changes.project_id === undefined ? old.project_id : changes.project_id || null, updated_at: now() };
      if (record.kind === 'project') record.project_id = null;
      validateRecord(record); validateProject(record.project_id);
      mutate(next => { next.records[next.records.findIndex(r => r.id === id)] = record; });
      return copy(record);
    };
    const backup = (scope = '') => {
      const selected = filterRecords(records(), scope);
      const ids = new Set(selected.flatMap(r => [r.data.catalogId, ...(r.data.candidates || []).map(c => c.database?.id)]).filter(Boolean));
      return { format: 'zhelixun-backup-v3', exportedAt: now(), scope: scope || 'all', catalogVersion: publicData.version,
        records: copy(selected).map(({ user_id, ...r }) => r),
        personalTags: Object.entries(state.tags[user().id] || {}).filter(([id]) => !scope || ids.has(id)).map(([catalogId, tags]) => ({ catalogId, tags })),
      };
    };
    function previewImport(text, format = 'json', projectId = null) {
      requireUser(); validateProject(projectId);
      if (new TextEncoder().encode(text).length > 100 * 1024 * 1024) throw new Error('文件超过 100 MB，请拆分后导入。');
      let payload, warnings = [];
      if (format === 'csv') {
        let rows;
        try { rows = ZLXRuntime.parseCsv(text, { columns: true, bom: true, skip_empty_lines: true }); }
        catch { throw new Error('CSV 无法解析，请检查引号、列名与文件编码。'); }
        payload = { format: 'zhelixun-backup-v3', records: rows.map((row, index) => {
          let content;
          try { content = row.data_json ? JSON.parse(row.data_json) : { query: row.query || '', source: row.source || '', content: row.content || '', filters: row.filters || '', resultCount: row.resultCount || '', url: row.url || '', ...(row.linkedId ? { linkedId: row.linkedId } : {}) }; }
          catch { throw new Error(`第 ${index + 2} 行 data_json 不是有效 JSON。`); }
          return { id: row.id || `csv-${index}`, kind: row.kind || row.type || 'search', title: row.title, data: content, project_id: projectId, created_at: row.date || row.created_at, updated_at: row.updated_at };
        }), personalTags: [] };
        warnings.push('CSV 不重建项目；所有记录将归入本次指定项目，未指定时归入未分组。完整恢复请使用 JSON。');
      } else {
        try { payload = JSON.parse(text); } catch { throw new Error('文件不是有效的 JSON 备份。'); }
        if (!['zhelixun-backup-v1', 'zhelixun-backup-v2', 'zhelixun-backup-v3', 'zhelixun-backup-v4'].includes(payload.format)) throw new Error('不支持的备份格式，请选择浙里寻导出的 JSON 文件。');
      }
      if (!Array.isArray(payload.records) || payload.records.length > 10000) throw new Error('记录列表格式错误或超过 10000 条。');
      const ids = new Set();
      payload.records = payload.records.filter(r => { if (r.kind?.startsWith('wps_')) { warnings.push('旧 WPS 状态不属于研究记录，已跳过。'); return false; } return true; });
      for (const record of payload.records) {
        validateRecord(record);
        if (!record.id) record.id = uid();
        if (record.id && (typeof record.id !== 'string' || ids.has(record.id))) throw new Error('备份中存在重复或无效 ID。');
        if (record.id) ids.add(record.id);
      }
      const tags = payload.personalTags || [];
      if (!Array.isArray(tags) || tags.length > 10000) throw new Error('个人标签格式不正确。');
      tags.forEach(t => { if (typeof t.catalogId !== 'string' || !Array.isArray(t.tags)) throw new Error('个人标签格式不正确。'); parseTags(t.tags); });
      const mine = records(), mapping = new Map(payload.records.map(r => [r.id, mine.find(m => m.id === r.id || m.importSourceId === r.id)?.id || r.id]));
      const normalized = (v, key = '') => {
        if (SINGLE_REFS.has(key) && typeof v === 'string') return mapping.get(v) || v;
        if (MULTI_REFS.has(key) && Array.isArray(v)) return v.map(id => normalized(id, 'linkedId'));
        if (key === 'catalogId') return canonicalId(v);
        if (Array.isArray(v)) return v.map(x => normalized(x));
        return v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalized(x, k)])) : v;
      };
      const changes = payload.records.map(r => {
        const existing = mine.find(m => m.id === r.id || m.importSourceId === r.id);
        const source = { ...r, project_id: r.project_id ? mapping.get(r.project_id) || r.project_id : null, data: normalized(r.data) };
        return { id: r.id, title: r.title, status: !existing ? 'new' : sameRecord(source, existing) ? 'same' : 'changed' };
      });
      return { payload: copy(payload), warnings: unique(warnings), revision, format, projectId, changes, counts: { records: payload.records.length, projects: payload.records.filter(r => r.kind === 'project').length, tags: tags.length, added: changes.filter(r => r.status === 'new').length, unchanged: changes.filter(r => r.status === 'same').length, changed: changes.filter(r => r.status === 'changed').length }, conflicts: changes.filter(r => r.status !== 'new').length };
    }
    const assertImportCurrent = preview => { if (preview.revision !== undefined && preview.revision !== revision) throw new Error('研究数据在预览后已变化，请重新选择备份核对后再导入。'); };
    function importPreview(preview, mode = 'safe') {
      requireUser();
      assertImportCurrent(preview);
      if (!['safe', 'merge', 'copy'].includes(mode)) throw new Error('请选择有效的导入方式。');
      // Revalidate at commit; a preview cannot authorize a partial or malformed write.
      const checked = previewImport(JSON.stringify(preview.payload));
      if (mode === 'safe') mode = checked.counts.changed ? 'copy' : 'merge';
      const incoming = checked.payload.records, warnings = [...preview.warnings];
      const next = copy(state), myRecords = records(), myIds = new Set(myRecords.map(r => r.id));
      const mapping = new Map(incoming.map(r => {
        const existing = myRecords.find(m => m.id === r.id || m.importSourceId === r.id);
        return [r.id, mode === 'merge' ? existing?.id || (!state.records.some(m => m.id === r.id) ? r.id : uid()) : uid()];
      }));
      const incomingProjects = new Set(incoming.filter(r => r.kind === 'project').map(r => r.id));
      const rewrite = (value, key = '') => {
        if (SINGLE_REFS.has(key) && typeof value === 'string') {
          if (mapping.has(value)) return mapping.get(value);
          if (mode === 'merge' && myIds.has(value)) return value;
          warnings.push(`关联 ${value} 未包含在备份中，已保留原 ID 供核对。`); return value;
        }
        if (MULTI_REFS.has(key) && Array.isArray(value)) return value.map(id => rewrite(id, 'linkedId'));
        if (key === 'catalogId' && typeof value === 'string') return canonicalId(value);
        if (Array.isArray(value)) return value.map(v => rewrite(v));
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v, k)]));
        return value;
      };
      let added = 0, updated = 0, skipped = 0;
      for (const source of incoming) {
        let project = null;
        if (source.project_id) {
          if (incomingProjects.has(source.project_id)) project = mapping.get(source.project_id);
          else if ((mode === 'merge' || preview.format === 'csv') && myRecords.some(r => r.id === source.project_id && r.kind === 'project')) project = source.project_id;
          else warnings.push(`“${source.title}”的项目不在备份中，已归入未分组。`);
        }
        const record = { ...source, id: mapping.get(source.id) || uid(), importSourceId: mode === 'merge' ? source.id : undefined, user_id: user().id, project_id: source.kind === 'project' ? null : project, data: rewrite(source.data), created_at: Number.isNaN(Date.parse(source.created_at)) ? now() : source.created_at, updated_at: Number.isNaN(Date.parse(source.updated_at)) ? now() : source.updated_at };
        const index = next.records.findIndex(r => r.id === record.id && r.user_id === user().id);
        if (index >= 0 && mode !== 'copy' && sameRecord(record, next.records[index])) { skipped++; continue; }
        if (index >= 0) { next.records[index] = record; updated++; }
        else { next.records.push(record); added++; }
      }
      next.tags[user().id] ||= {};
      for (const t of checked.payload.personalTags || []) {
        const id = canonicalId(t.catalogId);
        const local = next.tags[user().id][id] || [];
        const merged = unique([...local, ...parseTags(t.tags)]);
        next.tags[user().id][id] = merged.length > 20 ? local : merged;
        if (merged.length > 20) warnings.push('数据库 ' + id + ' 合并后超过 20 个标签，已保留本机标签；传入标签仍在原备份中。');
        if (!publicData.catalog.some(db => db.id === id)) warnings.push(`数据库 ${id} 暂未找到，标签已保留待后续目录匹配。`);
      }
      const relationships = new Set();
      next.records = next.records.filter(r => {
        if (r.kind !== 'favorite' || r.user_id !== user().id) return true;
        const key = `${canonicalId(r.data.catalogId)}|${r.project_id || ''}|${r.data.folder || ''}`;
        if (relationships.has(key)) return false;
        relationships.add(key); r.data.catalogId = canonicalId(r.data.catalogId); return true;
      });
      if (!added && !updated && stable(next.tags[user().id] || {}) === stable(state.tags[user().id] || {})) return { added, updated, skipped, mode, warnings: unique(warnings) };
      next.imports.push({ id: uid(), at: now(), mode, added, updated });
      // One recovery point, stored in the same atomic write, covers an entire import.
      next.trash.push({ id: uid(), user_id: user().id, title: '导入前的数据快照', at: now(), type: 'snapshot', records: copy(myRecords), tags: copy(state.tags[user().id] || {}) });
      save(next);
      return { added, updated, skipped, mode, warnings: unique(warnings) };
    }
    return {
      snapshot, subscribe: fn => (listeners.add(fn), () => listeners.delete(fn)), backup, create, update, previewImport, importPreview, assertImportCurrent,
      recordBackup(info) { requireUser(); mutate(next => { next.backups ||= {}; next.backups[user().id] = { at: now(), ...info }; }); },
      readDraft(key, owner) {
        if (requireUser().id !== owner) throw new Error('账号已切换，草稿未读取。');
        const id = 'zlx-draft:' + JSON.stringify([owner, key]);
        if (volatileDrafts.has(id)) return copy(volatileDrafts.get(id));
        const value = storage.getItem(id);
        return value ? JSON.parse(value) : null;
      },
      writeDraft(key, value, owner) {
        if (requireUser().id !== owner) throw new Error('账号已切换，草稿未写入。');
        const id = 'zlx-draft:' + JSON.stringify([owner, key]), draft = value === null ? null : { value, at: now() };
        try { storage.setItem(id, JSON.stringify(draft)); volatileDrafts.delete(id); }
        catch {
          const error = '草稿尚未保存，关闭页面会丢失输入。请先复制文字或保存研究记录。';
          volatileDrafts.set(id, draft ? { ...draft, error } : null); throw new Error(error);
        }
      },
      hasUnsavedDrafts() { return [...volatileDrafts.values()].some(draft => draft?.error); },
      startResearch(title) { return create('project', title, { researchStage: 'question', researchComplete: false }); },
      beginResearch(id) {
        const project = records().find(r => r.id === id && r.kind === 'project');
        if (!project) throw new Error('所属研究项目不存在。');
        const research = getResearchState(project, records());
        if (research.status === 'completed' || FOLDERS.some(f => f.id === project.data.researchStage)) return copy(project);
        return update(id, { data: { ...project.data, researchStage: research.stage, researchComplete: false } });
      },
      advanceResearch(id) {
        const project = records().find(r => r.id === id && r.kind === 'project');
        if (!project) throw new Error('所属研究项目不存在。');
        if (project.data.researchComplete === true) return copy(project);
        const index = FOLDERS.findIndex(f => f.id === getResearchState(project, records()).stage);
        return update(id, { data: { ...project.data, researchStage: FOLDERS[Math.min(index + 1, 2)].id, researchComplete: index === 2 } });
      },
      raw: () => JSON.stringify(state, null, 2),
      async login(identifier, password, method = 'username') {
        if (!['username', 'student'].includes(method)) throw new Error('请选择用户名或学号登录。');
        const field = method === 'student' ? 'studentNumber' : 'username';
        const account = state.users.find(u => u[field] && u[field] === String(identifier).trim());
        if (!account?.hash || await passwordHash(password, account.salt) !== account.hash) throw new Error(`${method === 'student' ? '学号' : '用户名'}或密码不正确。`);
        mutate(next => { next.session = account.id; });
      },
      async register(username, password, studentNumber = '') {
        username = username.trim();
        if (!/^[\p{L}\p{N}_.-]{2,32}$/u.test(username) || chars(password) < 10 || chars(password) > 200) throw new Error('用户名需要 2–32 个有效字符，密码需要 10–200 位。');
        const number = String(studentNumber).trim() ? normalizeStudentNumber(studentNumber) : null;
        const checkUnique = users => {
          if (users.some(u => u.username === username)) throw new Error('此浏览器中已存在同名账号，请使用原密码登录。');
          if (number && users.some(u => u.studentNumber === number)) throw new Error('此学号已绑定其他账号，请使用学号登录。');
        };
        checkUnique(state.users);
        const salt = uid(), hash = await passwordHash(password, salt), id = uid();
        mutate(next => { checkUnique(next.users); next.users.push({ id, username, salt, hash, studentNumber: number }); next.session = id; });
      },
      async bindStudentNumber(studentNumber, password) {
        const account = requireUser(), number = normalizeStudentNumber(studentNumber);
        if (!account.hash) throw new Error('演示空间不能绑定学号，请先注册或登录个人账号。');
        if (await passwordHash(password, account.salt) !== account.hash) throw new Error('当前密码不正确，学号未绑定。');
        mutate(next => {
          if (next.session !== account.id) throw new Error('当前账号已切换，请重新进入账号设置后操作。');
          const target = next.users.find(u => u.id === account.id);
          if (target.studentNumber) throw new Error('当前账号已经绑定学号，不支持重复绑定或修改。');
          if (next.users.some(u => u.id !== account.id && u.studentNumber === number)) throw new Error('此学号已绑定其他账号。');
          target.studentNumber = number;
        });
      },
      demo() { mutate(next => { next.session = 'standalone-demo'; }); },
      logout() { mutate(next => { next.session = null; }); },
      setTags(id, tags) { requireUser(); const normalized = parseTags(tags); mutate(next => { next.tags[user().id] ||= {}; next.tags[user().id][canonicalId(id)] = normalized; }); },
      setFavorites(db, scopes, folder) {
        requireUser(); scopes.forEach(validateProject); const id = canonicalId(db.id);
        if (folder !== undefined && !FOLDERS.some(f => f.id === folder)) throw new Error('请选择有效的研究阶段。');
        mutate(next => {
          const existing = next.records.filter(r => r.user_id === user().id && r.kind === 'favorite' && canonicalId(r.data.catalogId) === id && (folder === undefined || !r.project_id || r.data.folder === folder));
          next.records = next.records.filter(r => !existing.some(e => e.id === r.id) || scopes.includes(r.project_id));
          for (const project of scopes) if (!existing.some(r => r.project_id === project)) next.records.push({ id: uid(), kind: 'favorite', title: db.name, data: { catalogId: id, url: resourceUrl(db), ...(project && folder ? { folder } : {}) }, project_id: project, user_id: user().id, created_at: now(), updated_at: now() });
        });
      },
      organizeFavorites(ids, action, projectId = null) {
        requireUser(); validateProject(projectId);
        const selected = records().filter(r => r.kind === 'favorite' && ids.includes(r.id));
        if (!selected.length) throw new Error('请先选择要整理的收藏。');
        if (!['copy', 'move', 'remove'].includes(action)) throw new Error('不支持的整理方式。');
        mutate(next => {
          if (action !== 'copy') {
            const selectedIds = new Set(selected.map(r => r.id));
            next.records = next.records.filter(r => !selectedIds.has(r.id));
            next.trash.push({ id: uid(), user_id: user().id, title: '批量整理前的收藏', at: now(), type: 'deleted', records: copy(selected) });
          }
          if (action !== 'remove') for (const old of selected) if (!next.records.some(r => r.user_id === user().id && r.kind === 'favorite' && r.data.catalogId === old.data.catalogId && r.project_id === projectId && (r.data.folder || '') === (old.data.folder || ''))) next.records.push({ ...copy(old), id: uid(), project_id: projectId, created_at: now(), updated_at: now() });
        });
      },
      setFavorite(db, projectId, selected, folder = '') {
        validateProject(projectId); const id = canonicalId(db.id);
        if (folder && !FOLDERS.some(f => f.id === folder)) throw new Error('请选择有效的研究阶段。');
        const existing = records().find(r => r.kind === 'favorite' && canonicalId(r.data.catalogId) === id && r.project_id === (projectId || null) && (!folder || r.data.folder === folder));
        if (selected && !existing) create('favorite', db.name, { catalogId: id, url: resourceUrl(db), ...(folder ? { folder } : {}) }, projectId);
        if (!selected && existing) mutate(next => { next.records = next.records.filter(r => r.id !== existing.id); });
      },
      recommend(query, tags, projectId, folder = '') {
        validateProject(projectId);
        if (folder && !FOLDERS.some(f => f.id === folder)) throw new Error('请选择有效的研究阶段。');
        const result = matchResources(query, snapshot().catalog, tags);
        if (!String(query).trim() && !tags.length) return result;
        const record = create('recommendation', short(String(query).trim() || tags.join('、'), 60), { ...result, query, ...(folder ? { folder } : {}), catalogUpdatedAt: publicData.catalog[0]?.updated_at, candidates: result.candidates.map(c => ({ ...c, database: { id: c.database.id, name: c.database.name }, relevant: undefined })) }, projectId);
        return { ...result, id: record.id };
      },
      recordVisit(db, projectId, query = '', eventId = uid()) {
        const existing = records().find(r => r.kind === 'activity' && r.data.eventId === eventId);
        if (existing) return existing;
        return create('activity', `访问 ${short(db.name, 100)}`, { catalogId: db.id, url: resourceUrl(db), query, eventId, action: '发起资源访问' }, projectId);
      },
      remove(id) {
        const record = records().find(r => r.id === id);
        if (!record) throw new Error('记录不存在。');
        const removed = records().filter(r => r.id === id || (record.kind === 'project' && r.project_id === id));
        const trashId = uid();
        mutate(next => { const ids = new Set(removed.map(r => r.id)); next.records = next.records.filter(r => !ids.has(r.id)); next.trash.push({ id: trashId, user_id: user().id, title: record.title, type: 'deleted', at: now(), records: removed }); });
        return trashId;
      },
      restore(id) {
        const entry = state.trash.find(t => t.id === id && t.user_id === user().id);
        if (!entry) throw new Error('回收记录不存在。');
        mutate(next => {
          if (entry.type === 'snapshot') {
            next.trash.push({ id: uid(), user_id: user().id, title: '恢复前的数据快照', at: now(), type: 'snapshot', records: copy(records()), tags: copy(state.tags[user().id] || {}) });
            next.records = next.records.filter(r => r.user_id !== user().id); next.tags[user().id] = copy(entry.tags);
          }
          const ids = new Set(next.records.map(r => r.id));
          const projects = new Set([...next.records, ...entry.records].filter(r => r.kind === 'project').map(r => r.id));
          next.records.push(...entry.records.filter(r => !ids.has(r.id)).map(r => ({ ...r, project_id: r.project_id && !projects.has(r.project_id) ? null : r.project_id })));
          const seen = new Set();
          next.records = next.records.filter(r => { if (r.kind !== 'favorite') return true; const key = `${r.user_id}|${r.data.catalogId}|${r.project_id || ''}|${r.data.folder || ''}`; if (seen.has(key)) return false; seen.add(key); return true; });
          next.trash = next.trash.filter(t => t.id !== id);
        });
      },
      reload() {
        const value = storage.getItem(STATE_KEY);
        if (!value) return;
        const next = JSON.parse(value);
        if (next.schemaVersion !== 3 || !Array.isArray(next.records) || !Array.isArray(next.users)) throw new Error('另一页面写入的数据格式有误，请先备份。');
        state = { ...next, session: state.session }; lastSaved = value; revision++; listeners.forEach(fn => fn());
      },
    };
  }
  function exportCsv(records) {
    const safe = value => { const s = String(value ?? ''); return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; };
    const quote = value => `"${safe(value).replaceAll('"', '""')}"`;
    const columns = ['id', 'kind', 'title', 'project_id', 'created_at', 'updated_at', 'query', 'source', 'content', 'filters', 'resultCount', 'url', 'linkedId', 'data_json'];
    const rows = records.filter(r => r.kind !== 'project').map(r => [r.id, r.kind, r.title, r.project_id, r.created_at, r.updated_at, r.data.query, r.data.source, r.data.content, r.data.filters, r.data.resultCount, r.data.url, r.data.linkedId, JSON.stringify(r.data)]);
    return '\uFEFF' + [columns, ...rows].map(row => row.map(quote).join(',')).join('\r\n');
  }
  globalThis.ZLXCore = { STATE_KEY, LEGACY_KEY, KIND_NAMES, FOLDERS, STATUSES, copy, chars, short, now, uid, safeUrl, resourceUrl, officialUrl, localDate, parseTags, filterRecords, filterCatalog, decorateCatalog, matchResources, getResearchState, createStore, exportCsv };
})();
