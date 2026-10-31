(() => {
  'use strict';
  const { h, R, useApp, useDraft, DraftStatus, Icon, Button, Field, AutoTextarea, ErrorText, ResourceCard, RecordRow, Empty, Modal, download } = ZLXUI;
  const { useState, useEffect, useRef } = R, C = ZLXCore, X = ZLXExtras;
  function ModelSettings() {
    const { snap, modelConfig, setModelConfig, modelError } = useApp();
    const [form, setForm] = useState(null), [key, setKey] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
    useEffect(() => { if (modelConfig) setForm(modelConfig); }, [modelConfig]);
    const update = (name, value) => { setForm({ ...form, [name]: value, ...(name === 'baseUrl' ? { hasKey: false } : {}) }); if (name === 'baseUrl') setKey(''); setMessage(''); };
    const save = async test => {
      if (busy) return; setBusy(true); setError(''); setMessage('');
      try {
        const config = await X.request(snap.user.id, 'config', 'PUT', { ...form, apiKey: key }); setModelConfig(config); setKey(''); setForm(config);
        if (test) { const response = await X.request(snap.user.id, 'test', 'POST', {}); setMessage(response.message); }
        else setMessage(config.enabled ? '已保存。在线调用使用所选服务及你的账户额度。' : '在线模型已关闭，继续使用离线功能。');
      } catch (e) { setError(e.message); } finally { setBusy(false); }
    };
    const toggle = async enabled => {
      if (enabled) { update('enabled', true); return; }
      setBusy(true); setError(''); X.cancel(snap.user.id);
      try { const config = await X.request(snap.user.id, 'config', 'PUT', { ...modelConfig, enabled: false }); setModelConfig(config); setForm(config); setKey(''); setMessage('在线模型已关闭。'); } catch (e) { setError(e.message); } finally { setBusy(false); }
    };
    return h('section', { className: 'panel model-settings' }, h('p', { className: 'eyebrow' }, 'YOUR MODEL · YOUR CHOICE'), h('h2', null, '在线模型'),
      h('p', { className: 'muted' }, '可选接入。不开启也能离线选库、整理材料和推进研究。仅发送对话及你勾选的文本资料，调用使用你的账户额度。'),
      !X.available() ? h('p', { className: 'notice' }, '此入口使用离线选库，无需安装 Node。需要在线模型时，在电脑安装 Node 后使用“启动浙里寻”入口打开本机服务；手机静态网页不连接电脑的模型配置。') : !form ? h('p', { role: 'status' }, modelError || '正在读取模型设置…') : h('div', { className: 'stack' },
        h('label', { className: 'check-inline' }, h('input', { type: 'checkbox', checked: form.enabled, disabled: busy, onChange: e => toggle(e.target.checked) }), '接入在线模型'),
        form.enabled && h(R.Fragment, null,
          h(Field, { label: '服务预设' }, h('select', { value: form.baseUrl === 'https://api.deepseek.com' ? 'deepseek' : 'custom', onChange: e => { setForm({ ...form, baseUrl: e.target.value === 'deepseek' ? 'https://api.deepseek.com' : '', model: e.target.value === 'deepseek' ? 'deepseek-v4-flash' : '' }); setKey(''); } }, h('option', { value: 'deepseek' }, 'DeepSeek 官方'), h('option', { value: 'custom' }, '自定义兼容接口'))),
          h(Field, { label: 'API 基础地址', hint: '填写基础地址，如 https://api.deepseek.com 或 https://example.com/v1；无需添加 /chat/completions。' }, h('input', { value: form.baseUrl, onChange: e => update('baseUrl', e.target.value), placeholder: 'https://api.deepseek.com', autoComplete: 'off' })),
          h(Field, { label: '模型名称' }, h('input', { value: form.model, onChange: e => update('model', e.target.value), placeholder: 'deepseek-v4-flash', maxLength: 200 })),
          form.baseUrl === 'https://api.deepseek.com' && h('p', { className: 'small muted' }, 'deepseek-v4-flash 是兼容调用名，官方目前由 V4.1 Flash 提供服务。模型名称可修改。'),
          h(Field, { label: 'API Key', hint: form.hasKey ? '已配置密钥。留空保留当前密钥；清除配置可删除。' : '填写自己的密钥；无需认证的本机模型可留空。' }, h('input', { type: 'password', value: key, onChange: e => setKey(e.target.value), placeholder: form.hasKey ? '已配置，密钥不会回传' : '输入 API Key', autoComplete: 'off' })),
          h('label', { className: 'check-inline' }, h('input', { type: 'checkbox', checked: form.remember, onChange: e => update('remember', e.target.checked) }), '在本机记住密钥'), h('p', { className: 'small muted' }, '默认密钥仅保留在服务内存。选择记住后保存在本机 .local 目录，请勿分享该目录。'),
          h('div', { className: 'inline-actions' }, h(Button, { icon: "RefreshCw", disabled: busy, onClick: () => save(true) }, busy ? '处理中…' : '保存并测试连接'), h(Button, { icon: "Check", variant: 'primary', disabled: busy, onClick: () => save(false) }, '保存配置'))),
        h(Button, { icon: "Trash2", disabled: busy, onClick: async () => { setBusy(true); setError(''); try { X.cancel(snap.user.id); const config = await X.request(snap.user.id, 'config', 'DELETE'); setModelConfig(config); setForm(config); setKey(''); setMessage('配置及已记住的密钥已清除。'); } catch (e) { setError(e.message); } finally { setBusy(false); } } }, '清除配置')),
      message && h('p', { className: 'notice success', role: 'status' }, message), h(ErrorText, null, error || modelError));
  }
  function NewResearchDialog({ onClose, onCreate, onContinue }) {
    const { snap, scope } = useApp(), projects = snap.records.filter(r => r.kind === 'project');
    const [mode, setMode] = useState(onContinue && projects.length ? 'existing' : 'new'), [projectId, setProjectId] = useState(projects.some(p => p.id === scope) ? scope : projects[0]?.id || '');
    const [name, setName] = useState(''), [error, setError] = useState('');
    const selected = projects.find(p => p.id === projectId), research = C.getResearchState(selected, snap.records);
    const close = onClose;
    return h(Modal, { title: onContinue ? '新建或继续研究' : '为这次探索命名', onClose: close, className: 'gateway-naming' },
      h('form', { className: 'new-research-form stack', noValidate: true, onSubmit: e => {
        e.preventDefault(); setError('');
        if (mode === 'existing') { if (!projects.some(p => p.id === projectId)) { setError('请选择一个已有项目。'); e.currentTarget.querySelector('select')?.focus(); return; } try { onContinue(projectId); } catch (e) { setError(e.message); } return; }
        if (!name.trim()) { setError('请输入项目名称。'); e.currentTarget.querySelector('input')?.focus(); return; }
        try { onCreate(name); } catch (e) { setError(e.message); }
      } },
      onContinue && h('div', { className: 'segmented', role: 'group', 'aria-label': '探索方式' }, [['existing', '继续已有项目'], ['new', '开启全新研究']].map(([id, label]) => h(Button, { icon: id === 'existing' ? 'FolderOpen' : 'Plus', key: id, variant: mode === id ? 'selected' : '', 'aria-pressed': mode === id, disabled: id === 'existing' && !projects.length, onClick: () => { setMode(id); setError(''); } }, label))),
      mode === 'existing' ? h(Field, { label: '研究项目', hint: research.status === 'completed' ? '查看已有研究内容，浏览阶段不会改变完成状态。' : research.status === 'in-progress' ? '接着项目原有的研究阶段和资料继续。' : '在这个项目中开始提出问题，已有资料会保留。' }, h('select', { value: projectId, autoFocus: true, onChange: e => { setProjectId(e.target.value); setError(''); }, 'aria-invalid': !!error, 'aria-describedby': error ? 'research-name-error' : undefined }, projects.map(p => h('option', { key: p.id, value: p.id }, p.title)))) : h(Field, { label: '项目名称' }, h('input', { value: name, onChange: e => setName(e.target.value), maxLength: 500, 'aria-invalid': !!error, 'aria-describedby': error ? 'research-name-error' : undefined, placeholder: '例如：城市记忆与地方志研究' })),
      mode === 'existing' && selected && h('p', { className: 'project-research-status', role: 'status' }, research.label),
      onContinue && !projects.length && h('p', { className: 'small muted' }, '还没有研究项目，先为这次探索起个名字。'),
      error && h('p', { id: 'research-name-error', className: 'error-text', role: 'alert' }, error), h('div', { className: 'inline-actions' }, h(Button, { icon: "X", onClick: close }, '取消'), h(Button, { icon: "ArrowRight", type: 'submit', variant: 'primary' }, mode === 'existing' ? research.action : '开始提出问题'))));
  }
  function Gateway({ onEnterPlatform, onCreate }) {
    const [creating, setCreating] = useState(false);
    const close = () => { setCreating(false); requestAnimationFrame(() => document.querySelector('.planet-new')?.focus()); };
    return h('main', { className: 'space-gateway' }, h('div', { className: 'space-brand' }, h('span', { className: 'brand-mark', 'aria-hidden': true }), '浙里寻 · 研究航程'), h('header', { className: 'gateway-heading' }, h('p', { className: 'eyebrow' }, 'EVERY QUESTION IS A NEW WORLD'), h('h1', null, '下一站，探索什么？'), h('p', null, '带着好奇出发，让知识成为你的星图。')),
      h('div', { className: 'planet-choices', hidden: creating }, h('button', { className: 'planet-choice planet-new', onClick: () => setCreating(true) }, h('span', { className: 'planet-orb', 'aria-hidden': true }), h('span', { className: 'planet-caption' }, h('strong', null, '开启全新研究'), h('small', null, h(Icon, { name: 'Plus', size: 16 }), '从一个问题出发，逐步分析与解决'))), h('button', { className: 'planet-choice planet-continue', onClick: onEnterPlatform }, h('span', { className: 'planet-orb', 'aria-hidden': true }), h('span', { className: 'planet-caption' }, h('strong', null, '进入研究平台'), h('small', null, h(Icon, { name: 'FolderOpen', size: 16 }), '查找数据库，管理项目与资料')))),
      creating && h(NewResearchDialog, { onClose: close, onCreate }));
  }
  async function onlineRecommend({ userId, store, query, projectId, tags, signal }) {
    if (C.chars(query) >= 3000 || !query.trim()) throw new Error('请填写少于3000字的研究问题。');
    const result = await X.request(userId, 'chat', 'POST', { query, messages: [{ role: 'user', content: `${query}${tags.length ? '\n筛选标签：' + tags.join('、') : ''}` }] }, signal);
    if (store.snapshot().user?.id !== userId) throw new Error('当前账号已切换，回复未写入其他账号。');
    result.query = query; result.message = result.reply;
    const record = store.create('recommendation', C.short(query, 60), result, projectId);
    return { ...result, id: record.id };
  }
  function Journey({ active, onExit }) {
    const { snap, store, scope, openModal, notify, navigate, modelConfig } = useApp();
    const project = snap.records.find(r => r.kind === 'project' && r.id === scope);
    const research = C.getResearchState(project, snap.records), completed = research.status === 'completed';
    const [reviewStage, setReviewStage] = useState(null);
    const stage = completed ? reviewStage || research.stage : research.stage;
    useEffect(() => { setReviewStage(null); }, [scope, snap.user.id]);
    const [text, setText, draftError, restored, clearDraft] = useDraft(JSON.stringify(['journey', scope, stage]), '');
    const [selected, setSelected] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState(''), [resources, setResources] = useState([]), [mode, setMode] = useState('offline');
    const abort = useRef(null), account = snap.user.id;
    const stageInfo = C.FOLDERS.find(f => f.id === stage) || C.FOLDERS[0];
    const stageIndex = C.FOLDERS.findIndex(f => f.id === stage);
    const greetings = { question: '你好呀，我是小寻 ✦ 想研究点什么？把主题、已有线索和想找的材料告诉我吧。', analysis: '我们到分析站啦。把文献线索、数据或者想法发给我，一起梳理分析的路径。', solution: '最后一站！说说你目前的论点和证据，我们把解决方案一起收尾。' };
    useEffect(() => { setMode(modelConfig?.enabled ? 'online' : 'offline'); }, [modelConfig?.enabled]);
    useEffect(() => { if (!active) abort.current?.abort(); return () => abort.current?.abort(); }, [active, scope, stage, account]);
    useEffect(() => { setResources([]); setError(''); setSelected([]); }, [scope, stage]);
    if (!project) return h('main', { className: 'explore explore-question', 'aria-label': '研究探索' },
      h('div', { className: 'explore-body explore-empty' }, h(Empty, { title: '先选择一个研究项目', action: h(Button, { icon: "FolderOpen", variant: 'primary', onClick: () => navigate('workspace') }, '打开研究工作台') }, '在研究工作台选择已有项目，或新建一个研究项目。')));
    const records = snap.records.filter(r => r.project_id === scope && r.data.folder === stage);
    const conversation = records.find(r => r.data.subtype === 'conversation'), messages = conversation?.data.messages || [];
    const materials = records.filter(r => r.data.subtype !== 'conversation');
    const latestResources = resources.length ? resources : records.filter(r => r.kind === 'recommendation').at(-1)?.data.candidates || [];
    const lastReply = [...messages].reverse().find(m => m.role === 'assistant')?.content || '';
    const saveMessages = next => {
      if (store.snapshot().user?.id !== account) throw new Error('当前账号已切换，回复未写入其他账号。');
      const old = store.snapshot().records.find(r => r.project_id === scope && r.data.folder === stage && r.data.subtype === 'conversation');
      const data = { folder: stage, subtype: 'conversation', messages: next, content: next.map(m => `${m.role === 'user' ? '我' : '研究助手'}：${m.content}`).join('\n\n') };
      return old ? store.update(old.id, { data }) : store.create('note', `${C.FOLDERS.find(f => f.id === stage).name} · 模型对话`, data, scope);
    };
    const send = async e => {
      e.preventDefault(); if (busy) return; setError('');
      if (!text.trim()) return setError('请先写下研究问题或想法。');
      if (C.chars(text) >= 3000) return setError('每次输入需少于3000字。');
      setBusy(true); abort.current = new AbortController();
      try {
        if (mode === 'offline') { const result = store.recommend(text, [], scope, stage); setResources(result.candidates); notify('已完成离线选库。'); return; }
        const next = messages.at(-1)?.role === 'user' && messages.at(-1).content === text ? messages : [...messages, { role: 'user', content: text }];
        saveMessages(next);
        const history = snap.records.filter(r => r.project_id === scope && r.data.subtype === 'conversation' && C.FOLDERS.findIndex(f => f.id === r.data.folder) < stageIndex).sort((a, b) => C.FOLDERS.findIndex(f => f.id === a.data.folder) - C.FOLDERS.findIndex(f => f.id === b.data.folder)).flatMap(r => r.data.messages || []);
        const response = await X.request(account, 'chat', 'POST', { stage, query: text, messages: [...history, ...next].slice(-40), materials: materials.filter(r => selected.includes(r.id)).map(r => ({ title: r.title, content: r.data.content || '' })) }, abort.current.signal);
        const currentConversation = store.snapshot().records.find(r => r.project_id === scope && r.data.folder === stage && r.data.subtype === 'conversation');
        if (JSON.stringify(currentConversation?.data.messages) !== JSON.stringify(next)) throw new Error('对话已在其他页面更新，回复未覆盖新内容，请重新发送。');
        saveMessages([...next, { role: 'assistant', content: response.reply }]);
        store.create('recommendation', C.short(text, 60), { ...response, query: text, folder: stage }, scope);
        setResources(response.candidates); setText(''); clearDraft();
      } catch (e) { setError(e.message); } finally { setBusy(false); }
    };
    const upload = async e => {
      const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
      let attachment;
      try {
        attachment = await X.files.add(account, file); let content = '';
        if (/\.(txt|md|markdown)$/i.test(file.name)) { try { content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()).slice(0, 100000); } catch { throw new Error('文本文件不是有效 UTF-8，请转换编码后再导入。'); } }
        if (store.snapshot().user?.id !== account) throw new Error('当前账号已切换，文件未写入其他账号。');
        store.create('material', file.name, { folder: stage, content, attachments: [attachment] }, scope); notify('文件原件已保存在当前浏览器。');
      } catch (e) { if (attachment) await X.files.remove(attachment.id).catch(() => {}); setError(e.message); }
    };
    const advance = () => { if (completed) { if (stageIndex < C.FOLDERS.length - 1) setReviewStage(C.FOLDERS[stageIndex + 1].id); else onExit(); return; } try { const updated = store.advanceResearch(scope); if (updated.data.researchComplete) onExit(); } catch (e) { setError(e.message); } };
    const switchStage = id => { if (id === stage) return; if (completed) { setReviewStage(id); return; } try { store.update(project.id, { data: { ...project.data, researchStage: id } }); } catch (e) { setError(e.message); } };
    const bubbleText = lastReply || (latestResources.length ? `我在馆藏目录里找到了 ${latestResources.length} 个数据库，就在上面的对话里，看看合不合用。` : greetings[stage]);
    return h('main', { className: `explore explore-${stage}`, 'aria-label': `研究探索 · ${stageInfo.name}` },
      h('div', { className: 'explore-stars', 'aria-hidden': true }),
      h('header', { className: 'explore-header' },
        h('div', { className: 'explore-title' }, h('span', { className: 'brand-mark', 'aria-hidden': true }), h('div', null, h('strong', null, project.title), h('small', null, completed ? '已完成研究 · 查看研究过程' : '浙里寻 · 研究航程'))),
        h('nav', { className: 'explore-steps', 'aria-label': '研究阶段' }, C.FOLDERS.map((f, i) => h('button', { key: f.id, type: 'button', className: stage === f.id ? 'now' : completed || i < stageIndex ? 'done' : '', 'aria-current': stage === f.id ? 'step' : undefined, disabled: busy, onClick: () => switchStage(f.id) }, h(Icon, { name: ({ question: 'CircleHelp', analysis: 'Search', solution: 'Lightbulb' })[f.id], size: 15 }), f.name))),
        h(Button, { icon: "ArrowLeft", variant: 'quiet', className: 'explore-exit', onClick: onExit }, '返回项目工作台')),
      h('div', { className: 'explore-body' },
        h('div', { className: 'explore-stagehead', key: `head-${stage}` }, h('p', { className: 'eyebrow' }, 'RESEARCH EXPEDITION'), h('h1', null, stageInfo.name), h('p', null, stageInfo.hint)),
        h('div', { className: 'explore-log', role: 'log', 'aria-label': '当前阶段对话', key: `log-${stage}` },
          messages.length ? messages.map((m, i) => h('div', { key: i, className: `explore-msg ${m.role === 'user' ? 'user' : 'assistant'}` },
            m.role === 'assistant' && h('span', { className: 'mascot-avatar', 'aria-hidden': true }),
            h('div', { className: 'msg-bubble preserve-text' }, m.content))) : null,
          latestResources.length ? h('div', { className: 'explore-msg assistant', key: 'resources' }, h('span', { className: 'mascot-avatar', 'aria-hidden': true }),
            h('div', { className: 'msg-bubble result-bubble' }, h('strong', { className: 'result-title' }, `小寻找到了 ${latestResources.length} 个数据库`),
              h('div', { className: 'resource-list' }, latestResources.map((c, i) => { const db = snap.catalog.find(d => d.id === c.database.id); return db && h('div', { key: db.id, className: 'result-item' }, h(ResourceCard, { db, reason: c.reason, number: i + 1, projectId: scope, folder: stage })); })))) : null),
        h('details', { className: 'explore-materials' }, h('summary', null, `本阶段资料 · ${materials.length}`),
          h('div', { className: 'stack materials-inner' },
            h('div', { className: 'inline-actions' }, h(Button, { icon: "FileText", onClick: () => openModal({ type: 'edit', kind: 'note', projectId: scope, folder: stage }) }, '添加笔记'), h(Button, { icon: "Link2", onClick: () => openModal({ type: 'edit', kind: 'material', projectId: scope, folder: stage }) }, '添加网址'), !modelConfig?.enabled && h(Button, { icon: "Settings", variant: 'quiet', onClick: () => navigate('settings') }, '接入在线模型')),
            h(Field, { label: '导入文件', hint: '单文件≤10MB；TXT / Markdown 可选择作为对话资料。' }, h('input', { type: 'file', disabled: busy, onChange: upload })),
            materials.length ? materials.map(record => h('div', { key: record.id, className: 'stage-material' }, h(RecordRow, { record }), ['note', 'material'].includes(record.kind) && record.data.content && h('label', { className: 'check-inline materials-check' }, h('input', { type: 'checkbox', checked: selected.includes(record.id), disabled: busy, onChange: e => setSelected(e.target.checked ? [...selected, record.id] : selected.filter(id => id !== record.id)) }), '加入模型上下文'))) : h('p', { className: 'small materials-hint' }, '把材料、笔记与网址收进这一阶段。'))),
        h('div', { className: 'explore-advance' }, h(Button, { icon: completed && stage === 'solution' ? 'FolderOpen' : stage === 'solution' ? 'Check' : 'ArrowRight', variant: 'primary', className: 'advance-button', disabled: busy, onClick: advance }, (completed ? { question: '查看分析问题', analysis: '查看解决问题', solution: '返回项目工作台' } : { question: '问题选的差不多啦，进入分析问题', analysis: '问题分析的差不多啦，走向解决', solution: '问题有思路啦！完成本次研究' })[stage]))),
      h('footer', { className: 'explore-dock' },
        h('span', { className: 'dock-mascot', 'aria-hidden': true }),
        h('div', { className: 'dock-main' },
          busy && h('p', { className: 'dock-status', role: 'status' }, '小寻正在翻阅星图…'),
          h(ErrorText, null, error), h(DraftStatus, { error: draftError, restored }),
          h('form', { className: 'dock-form', onSubmit: send },
            h(AutoTextarea, { value: text, onChange: e => setText(e.target.value), disabled: busy, placeholder: mode === 'online' ? '发给小寻：我想研究…' : '描述研究主题，小寻帮你在馆藏目录里找数据库…', className: 'dock-input' }),
            h('div', { className: 'dock-actions' },
              h('select', { value: mode, disabled: busy, 'aria-label': '工作方式', onChange: e => setMode(e.target.value) }, modelConfig?.enabled && h('option', { value: 'online' }, '在线模型对话与选库'), h('option', { value: 'offline' }, '离线选库')),
              h(Button, { icon: mode === 'online' ? 'ArrowRight' : 'Search', type: 'submit', variant: 'primary', disabled: busy }, busy ? '正在研究…' : mode === 'online' ? '发送给小寻' : '离线寻找数据库'),
              busy && h(Button, { icon: "X", type: 'button', onClick: () => abort.current?.abort() }, '取消请求'),
              error && mode === 'online' && h(Button, { icon: "BookOpen", type: 'button', onClick: () => { setMode('offline'); setError(''); } }, '改用离线选库'))),
          h('p', { className: 'small dock-note' }, '延续此前阶段对话，最多发送最近40条；勾选资料每项发送前10000字符，最多20项。文件原件不会自动发送。'))));
  }
  globalThis.ZLXResearch = { ModelSettings, Gateway, NewResearchDialog, Journey, onlineRecommend };
})();
