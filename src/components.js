/* Shared, accessible controls and resource presentation across every page. */
(() => {
  'use strict';
  const { React: R, icons } = ZLXRuntime;
  const { createElement: h, useState, useEffect, useRef, useId, useContext } = R;
  const C = ZLXCore, Context = R.createContext(null), useApp = () => useContext(Context);
  function useDraft(key, initial) {
    const { store, snap } = useApp(), owner = snap.user.id;
    key = JSON.stringify([owner, key]);
    const read = () => {
      const fallback = typeof initial === 'function' ? initial() : initial;
      try { const saved = store.readDraft(key, owner); return { key, value: saved?.value ?? fallback, restored: !!saved, error: saved?.error || '' }; }
      catch { return { key, value: fallback, restored: false, error: '无法读取本机草稿，请及时保存或复制输入。' }; }
    };
    const [entry, setEntry] = useState(read), current = useRef(entry);
    if (entry.key !== key) { const next = read(); current.current = next; setEntry(next); }
    else current.current = entry;
    const update = next => {
      const value = typeof next === 'function' ? next(current.current.value) : next;
      let error = '';
      try { store.writeDraft(key, value, owner); } catch (e) { error = e.message; }
      current.current = { key, value, restored: false, error }; setEntry(current.current);
    };
    const clear = () => { try { store.writeDraft(key, null, owner); setEntry(old => ({ ...old, restored: false, error: '' })); return true; } catch (e) { setEntry(old => ({ ...old, error: e.message })); return false; } };
    return [current.current.value, update, current.current.error, current.current.restored, clear];
  }
  const DraftStatus = ({ error, restored }) => h('p', { className: error ? 'error-text' : 'small muted draft-status', role: error ? 'alert' : 'status' }, error || (restored ? '已恢复上次草稿。草稿仅保存在当前浏览器。' : '输入会保留为本机草稿；正式保存后才进入项目备份。'));
  // Small inline additions keep the existing icon family and offline bundle.
  // Star: Lucide 0.468.0, ISC; https://github.com/lucide-icons/lucide/blob/0.468.0/icons/star.svg
  const extraIcons = {
    Star: [['path', { d: 'M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z' }]],
    Tag: [['path', { d: 'M3 3h8l10 10-8 8L3 11Z' }], ['circle', { cx: 7.5, cy: 7.5, r: 1 }]],
    MoreHorizontal: [5, 12, 19].map(cx => ['circle', { cx, cy: 12, r: 1.3, fill: 'currentColor', stroke: 'none' }]),
  };
  const Icon = ({ name, size = 18, strokeWidth = 1.7, ...props }) => icons[name]
    ? h(icons[name], { size, strokeWidth, 'aria-hidden': true, ...props })
    : extraIcons[name] ? h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, ...props }, extraIcons[name].map(([tag, attrs], i) => h(tag, { ...attrs, key: i }))) : null;
  function Button({ children, icon, variant = '', className = '', ...props }) {
    return h('button', { type: 'button', ...props, className: `button ${variant} ${className}` }, icon && h(Icon, { name: icon }), h('span', { className: 'button-label' }, children));
  }
  function Link({ href, children, icon = 'ExternalLink', className = '', ...props }) {
    const url = C.safeUrl(href);
    return url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', ...props, className: `link ${className}` }, h(Icon, { name: icon, size: 16 }), h('span', { className: 'button-label' }, children)) : h('span', { className: 'muted' }, children, '（地址待核对）');
  }
  function Field({ label, children, hint, className = '' }) {
    const id = useId(), labelId = id + '-label', hintId = id + '-hint';
    const control = R.isValidElement(children) && ['input', 'textarea', 'select', AutoTextarea].includes(children.type)
      ? R.cloneElement(children, { 'aria-labelledby': labelId, 'aria-describedby': [children.props['aria-describedby'], hint ? hintId : ''].filter(Boolean).join(' ') || undefined }) : children;
    return h('label', { className: `field ${className}` }, h('span', { id: labelId, className: 'field-label' }, label), control, hint && h('small', { id: hintId }, hint));
  }
  function AutoTextarea({ value, className = '', ...props }) {
    const ref = useRef(null);
    useEffect(() => { if (ref.current) { ref.current.style.height = 'auto'; ref.current.style.height = Math.min(380, Math.max(110, ref.current.scrollHeight + 2)) + 'px'; } }, [value]);
    return h('textarea', { ...props, ref, value, className: `auto-textarea ${className}` });
  }
  const Empty = ({ title, children, action }) => h('div', { className: 'empty' }, h(Icon, { name: 'BookOpen', size: 30 }), h('h3', null, title), h('p', null, children), action);
  const ErrorText = ({ children }) => children ? h('p', { role: 'alert', className: 'error-text' }, children) : null;
  function Tags({ values = [], onRemove }) { return h('div', { className: 'tags' }, values.map((tag, i) => h('span', { className: 'tag', key: `${tag}-${i}` }, tag, onRemove && h('button', { type: 'button', onClick: () => onRemove(tag), 'aria-label': `移除标签 ${tag}` }, h(Icon, { name: 'X', size: 13 }), '移除')))); }
  function Modal({ title, children, onClose, wide = false, className = '' }) {
    const ref = useRef(null), titleId = useId();
    useEffect(() => { const dialog = ref.current, previous = document.activeElement, overflow = document.documentElement.style.overflow; document.documentElement.style.overflow = 'hidden'; dialog.showModal(); dialog.querySelector('input:not([type=checkbox]),textarea')?.focus(); return () => { dialog.close(); document.documentElement.style.overflow = overflow; const menu = document.querySelector('.menu-button'); const target = previous?.isConnected && !previous.closest('[inert],[hidden]') ? previous : menu?.getClientRects().length ? menu : document.querySelector('#main'); target?.focus({ preventScroll: true }); }; }, []);
    return h('dialog', { ref, 'aria-labelledby': titleId, className: `modal ${wide ? 'wide' : ''} ${className}`, onCancel: e => { e.preventDefault(); onClose(); }, onClick: e => { if (e.target === ref.current) { const b = ref.current.getBoundingClientRect(); if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) onClose(); } } },
      h('div', { className: 'modal-header' }, h('h2', { id: titleId }, title), h(Button, { icon: 'X', onClick: onClose, 'aria-label': '关闭弹窗', className: 'compact-action' }, '关闭')), h('div', { className: 'modal-content' }, children));
  }
  function ScopeSelect({ value, onChange, all = true, personal = false, label = '研究项目', disabled = false }) {
    const { snap } = useApp();
    return h(Field, { label }, h('select', { value: value || '', disabled, onChange: e => onChange(e.target.value) }, h('option', { value: '' }, all ? '全部项目' : '未分组'), personal && h('option', { value: 'personal' }, '我的个人收藏'), snap.records.filter(r => r.kind === 'project').map(r => h('option', { key: r.id, value: r.id }, r.title))));
  }
  function ResourceMore({ children }) {
    const ref = useRef(null), panelId = useId(), [open, setOpen] = useState(false);
    useEffect(() => {
      if (!open) return;
      const disclosure = ref.current;
      const panel = disclosure.querySelector('.resource-access-options');
      const close = () => { disclosure.open = false; };
      const scroll = event => { if (event.target === document || event.target === window || !panel.contains(event.target)) close(); };
      const outside = event => { if (!disclosure.contains(event.target)) close(); };
      const escape = event => { if (event.key === 'Escape') { event.preventDefault(); close(); disclosure.querySelector('summary').focus(); } };
      document.addEventListener('pointerdown', outside, true);
      document.addEventListener('focusin', outside);
      document.addEventListener('keydown', escape);
      window.addEventListener('resize', close);
      window.addEventListener('wheel', scroll, { capture: true, passive: true });
      window.addEventListener('touchmove', scroll, { capture: true, passive: true });
      return () => {
        document.removeEventListener('pointerdown', outside, true);
        document.removeEventListener('focusin', outside);
        document.removeEventListener('keydown', escape);
        window.removeEventListener('resize', close);
        window.removeEventListener('wheel', scroll, true);
        window.removeEventListener('touchmove', scroll, true);
      };
    }, [open]);
    const toggle = event => {
      const disclosure = event.currentTarget;
      if (disclosure.open) {
        const anchor = disclosure.getBoundingClientRect();
        const panel = disclosure.querySelector('.resource-access-options');
        panel.style.maxHeight = '';
        const needed = panel.getBoundingClientRect().height;
        const below = Math.max(0, innerHeight - anchor.bottom - 14), above = Math.max(0, anchor.top - 14);
        const placeBelow = below >= needed || (above < needed && below >= above);
        disclosure.dataset.side = placeBelow ? 'below' : 'above';
        panel.style.maxHeight = `${Math.floor(placeBelow ? below : above)}px`;
      }
      setOpen(disclosure.open);
    };
    return h('details', { ref, className: 'resource-more', onToggle: toggle },
      h('summary', { 'aria-label': '更多资源操作', 'aria-controls': panelId }, h(Icon, { name: 'MoreHorizontal', size: 14 }), h('span', null, '更多')),
      R.cloneElement(children, { id: panelId, onClick: event => { if (event.target.closest('a,button')) ref.current.open = false; } }));
  }
  function ResourceLinks({ db, projectId, onShowDetail, children }) {
    const { store, scope, notify } = useApp();
    const project = projectId === undefined ? (scope === 'unassigned' ? null : scope || null) : projectId;
    const visit = e => { try { store.recordVisit(db, project); } catch (error) { e.preventDefault(); notify(error.message, 'error'); } };
    const options = h('div', { className: 'resource-access-options' },
      h('a', { href: C.resourceUrl(db), className: 'button quiet current-page-link', onClick: visit, 'aria-label': '在当前页打开' }, h(Icon, { name: 'ArrowRight' }), h('span', { className: 'button-label' }, '当前页打开')),
      h(Link, { href: C.officialUrl(db), icon: 'CircleHelp', className: 'button quiet official-link' }, '官方访问说明'),
      h(Button, { icon: 'Link2', variant: 'quiet', onClick: async () => { try { await navigator.clipboard.writeText(C.resourceUrl(db)); notify('资源链接已复制，可在系统浏览器打开。'); } catch { notify('请长按或右键“打开资源”，选择复制链接地址。', 'error'); } } }, '复制链接'));
    return h('div', { className: `resource-links ${onShowDetail ? 'resource-card-links' : 'resource-detail-links'}`, 'aria-label': '资源访问入口' },
      h('div', { className: 'resource-primary-actions' },
        onShowDetail && h(Button, { icon: 'FileText', className: 'description-button', onClick: onShowDetail, 'aria-haspopup': 'dialog' }, '数据库说明'),
        h(Link, { href: C.resourceUrl(db), className: 'button primary resource-open-link', onClick: visit, title: '在新标签页打开资源' }, '打开资源')),
      onShowDetail ? h('div', { className: 'resource-secondary-actions' }, children, h(ResourceMore, null, options)) : options);
  }
  function ResourceMiniActions({ db, projectId, folder }) {
    const { snap, store, notify, openModal } = useApp();
    const count = snap.records.filter(r => r.kind === 'favorite' && r.data.catalogId === db.id && (!folder || r.project_id === projectId && r.data.folder === folder)).length;
    const favorite = () => {
      if (!folder) return openModal({ type: 'favorite', db });
      try { store.setFavorite(db, projectId, !count, folder); notify(count ? '已取消本阶段收藏' : `已收藏到${C.FOLDERS.find(f => f.id === folder).name}`); } catch (e) { notify(e.message, 'error'); }
    };
    return h('div', { className: 'resource-mini-actions' },
      h(Button, { icon: 'Star', className: count ? 'mini-action is-saved' : 'mini-action', onClick: favorite, title: folder ? '收藏到当前项目的本研究阶段' : '编辑收藏归属', 'aria-label': folder ? (count ? '取消本阶段收藏' : '收藏到本研究阶段') : '编辑收藏归属', 'aria-pressed': !!count }, count ? '已收藏' : '收藏'),
      h(Button, { icon: 'Tag', className: 'mini-action', onClick: () => openModal({ type: 'tags', db }), title: '编辑个人检索标签', 'aria-label': '编辑个人标签' }, '标签'));
  }
  function ResourceCard({ db, reason, number, projectId, folder }) {
    const { snap, openModal } = useApp();
    db = snap.catalog.find(item => item.id === db.id) || db;
    const showDetail = () => openModal({ type: 'resource', db, projectId });
    return h('article', { className: 'resource-card', 'data-resource': db.id, style: number ? { '--reveal-order': Math.min(number - 1, 11) } : undefined },
      h('div', { className: 'resource-heading' }, h('div', { className: 'resource-identity' }, h('p', { className: 'eyebrow' }, [...new Set([db.language, ...(db.types || []).slice(0, 2)])].filter(Boolean).join(' · ')), h('h3', null, h('button', { className: 'title-button', onClick: showDetail }, db.name)))),
      h('p', { className: `resource-summary ${db.summary ? '' : 'muted'}` }, db.summary || `内容简介待补全。目录收录范围：${db.subjects.join('、')}；资源类型：${db.types.join('、')}。`),
      reason && h('p', { className: 'match-reason' }, h('strong', null, '匹配理由 '), reason),
      h(Tags, { values: [...new Set([...(db.subjects || []), ...(db.officialTags || []).filter(t => !['外文文献', '中文文献'].includes(t))])].slice(0, 5) }),
      db.personalTags?.length > 0 && h('div', { className: 'tags personal-tags', 'aria-label': '个人标签' }, db.personalTags.map(tag => h('button', { key: tag, type: 'button', className: 'personal-tag', onClick: () => openModal({ type: 'tags', db, tag }), 'aria-label': `编辑或删除个人标签：${tag}` }, h(Icon, { name: 'SlidersHorizontal', size: 13 }), tag))),
      h('div', { className: 'resource-actions' },
        h(ResourceLinks, { db, projectId, onShowDetail: showDetail }, h(ResourceMiniActions, { db, projectId, folder }))));
  }
  function FavoriteEditor({ db, onClose }) {
    const { snap, store, notify } = useApp();
    const [folder, setFolder] = useState('question');
    const selectedScopes = stage => snap.records.filter(r => r.kind === 'favorite' && r.data.catalogId === db.id && (!r.project_id || r.data.folder === stage)).map(r => r.project_id);
    const [selected, setSelected] = useState(selectedScopes('question'));
    const [error, setError] = useState('');
    return h('form', { onSubmit: e => { e.preventDefault(); try { store.setFavorites(db, selected, folder); notify('收藏归属已更新'); onClose(); } catch (e) { setError(e.message); } } }, h('p', { className: 'muted' }, db.name, '。选择研究阶段及项目；其他阶段的收藏会保留。'), h(Field, { label: '收藏到研究阶段' }, h('select', { value: folder, onChange: e => { setFolder(e.target.value); setSelected(selectedScopes(e.target.value)); } }, C.FOLDERS.map(f => h('option', { key: f.id, value: f.id }, f.name)))),
      h('div', { className: 'check-list' }, [{ id: null, title: '我的个人收藏' }, ...snap.records.filter(r => r.kind === 'project')].map(r => h('label', { key: r.id || 'personal', className: 'check-row' }, h('input', { type: 'checkbox', checked: selected.includes(r.id), onChange: e => setSelected(e.target.checked ? [...selected, r.id] : selected.filter(id => id !== r.id)) }), h('span', null, r.title)))), h(ErrorText, null, error), h('div', { className: 'form-actions' }, h(Button, { icon: "X", onClick: onClose }, '取消'), h(Button, { icon: "Check", type: 'submit', variant: 'primary' }, '保存收藏')));
  }
  function TagEditor({ db, tag, tags, onSave, onClose }) {
    const { store, notify } = useApp();
    const [value, setValue] = useState(tag ?? (db ? db.personalTags || [] : tags || []).join('，')), [error, setError] = useState('');
    const save = remove => {
      try {
        let next = remove ? [] : C.parseTags(value);
        if (tag && !remove && !next.length) throw new Error('请输入标签，或点击删除标签。');
        if (db) {
          const current = store.snapshot().catalog.find(item => item.id === db.id)?.personalTags || [];
          if (tag) next = C.parseTags([...current.filter(item => item !== tag), ...next]);
          store.setTags(db.id, next);
        } else onSave(next);
        notify(remove ? '标签已删除' : '标签已保存'); onClose();
      } catch (e) { setError(e.message); }
    };
    return h('form', { onSubmit: e => { e.preventDefault(); save(false); } }, db && h('div', { className: 'stack' }, h('p', null, db.name), h('span', { className: 'small muted' }, '官方标签（保留且只读）'), h(Tags, { values: db.officialTags })), h(Field, { label: tag ? '编辑个人标签' : db ? '个人检索标签' : '本次匹配标签', hint: '用中文逗号、英文逗号或换行分隔。最多 20 个标签，每个最多 60 字。' }, h(AutoTextarea, { value, onChange: e => setValue(e.target.value), className: 'tag-textarea', autoFocus: true })), h(ErrorText, null, error), h('div', { className: 'form-actions' }, tag && h(Button, { icon: "Trash2", variant: 'danger', onClick: () => save(true) }, '删除标签'), h(Button, { icon: "X", onClick: onClose }, '取消'), h(Button, { icon: "Check", type: 'submit', variant: 'primary' }, '保存标签')));
  }
  function ResourceDetail({ db, projectId }) {
    const detail = db.detail;
    const sections = detail?.sections?.length ? detail.sections : [{ id: 'content', title: '资源内容', text: detail?.description || '内容简介尚未补全，可通过官方访问说明确认收录内容。' }];
    const sectionHeader = (number, title) => h('summary', null, h('span', { className: 'description-section-number', 'aria-hidden': true }, String(number).padStart(2, '0')), h('span', { className: 'description-section-title' }, title), h(Icon, { name: 'ChevronDown', size: 14 }));
    return h('div', { className: 'resource-detail' },
      h('div', { className: 'description-meta' }, h('p', { className: 'eyebrow' }, [detail?.resourceKind || db.types.join('、'), db.languageNote || db.language].filter(Boolean).join(' · ')), h(ResourceMiniActions, { db })),
      h('div', { className: 'description-sections' }, sections.map((section, i) => h('details', { key: section.id, className: 'description-section', open: i === 0 }, sectionHeader(i + 1, section.title), h('div', { className: 'description-section-body reading' }, section.text.split(/\n+/).map((text, j) => h('p', { key: j }, text))))),
        detail?.sources?.length > 0 && h('details', { className: 'description-section source-section' }, sectionHeader(sections.length + 1, '来源与核查'), h('div', { className: 'description-section-body' },
          detail.sources.map((source, i) => h('div', { key: i, className: 'description-source' }, h(Link, { href: typeof source === 'string' ? source : source.url }, typeof source === 'string' ? `官方来源 ${i + 1}` : source.title || `官方来源 ${i + 1}`), source.sourceUpdatedAt && h('span', { className: 'small muted' }, `来源更新：${C.localDate(source.sourceUpdatedAt)}`))),
          detail.verifiedAt && h('p', { className: 'description-verification' }, `内容核查：${C.localDate(detail.verifiedAt)} · ${detail.verification?.official_description || '见来源'}。登录与全文权限未逐库实测。`)))),
      h('div', { className: 'description-footer' }, h(ResourceLinks, { db, projectId })));
  }
  const LABELS = { query: '原始问题 / 检索式', content: '正文', description: '说明', source: '来源', url: '原始链接', filters: '筛选条件', resultCount: '结果数量', folder: '研究阶段', status: '任务状态', dueDate: '截止日期', priority: '优先级', linkedId: '关联材料', action: '记录事件', mode: '匹配模式', tags: '匹配标签', page: '页码 / 定位', argument: '研究论点', evidence: '证据片段', eventDate: '活动日期', catalogUpdatedAt: '目录快照', catalogId: '数据库', graphType: '图表类型' };
  function displayValue(key, value, records, catalog) {
    if (key === 'folder') return C.FOLDERS.find(f => f.id === value)?.name || value;
    if (key === 'status') return C.STATUSES.find(s => s.id === (value === 'research' ? 'inbox' : value))?.name || value;
    if (key === 'priority') return { high: '高', normal: '普通', low: '低' }[value] || value;
    if (key === 'linkedId') return records.find(r => r.id === value)?.title || `${value}（关联待核对）`;
    if (key === 'catalogId') return catalog.find(db => db.id === value)?.name || `${value}（目录待核对）`;
    if (key === 'mode' && value === 'offline') return '离线匹配';
    if (Array.isArray(value) && value.every(v => typeof v !== 'object')) return value.join('、');
    return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
  }
  function Graph({ record }) {
    const nodes = record.data.nodes || [], mind = record.data.graphType === 'mind', width = 820;
    const chunks = text => { const chars = Array.from(String(text || '未命名节点')), result = []; for (let i = 0; i < chars.length; i += mind ? 16 : 34) result.push(chars.slice(i, i + (mind ? 16 : 34)).join('')); return result.length ? result : ['未命名节点']; };
    let offset = 20;
    const boxes = nodes.map((n, i) => { const lines = chunks(n.label), height = lines.length * 25 + 36, b = { ...n, lines, height, x: mind ? i ? 430 : 30 : 40, y: offset, width: mind ? 350 : 740 }; if (!mind || i > 0) offset += height + 35; return b; });
    const height = Math.max(180, offset + 20, boxes[0]?.height + 40 || 0);
    if (mind && boxes[0]) boxes[0].y = (height - boxes[0].height) / 2;
    return h('svg', { xmlns: 'http://www.w3.org/2000/svg', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': record.title, className: 'graph-svg' }, h('title', null, record.title), boxes.map((b, i) => h('g', { key: b.id || i }, i > 0 && h('path', { d: mind ? `M380 ${boxes[0].y + boxes[0].height / 2} C405 ${boxes[0].y + boxes[0].height / 2},405 ${b.y + b.height / 2},430 ${b.y + b.height / 2}` : `M410 ${boxes[i - 1].y + boxes[i - 1].height} V${b.y}`, fill: 'none', stroke: '#758578', strokeWidth: 2 }), h('rect', { x: b.x, y: b.y, width: b.width, height: b.height, rx: 8, fill: i === 0 ? '#264d7f' : '#edf3f0', stroke: '#c4cec3' }), h('text', { x: b.x + b.width / 2, y: b.y + 34, textAnchor: 'middle', fontFamily: 'sans-serif', fontSize: 18, fill: i === 0 ? '#fff' : '#233949' }, b.lines.map((line, j) => h('tspan', { key: j, x: b.x + b.width / 2, dy: j ? 25 : 0 }, line))))));
  }
  function download(content, name, type = 'text/plain;charset=utf-8') {
    const blob = content instanceof Blob ? content : new Blob([content], { type }), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_'); a.style.display = 'none'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  function RecordViewer({ record, onClose }) {
    const { snap, store, openModal, notify, replay, navigate, setScope } = useApp(), [tab, setTab] = useState('read'), [wrap, setWrap] = useState(true), ref = useRef(null);
    const project = snap.records.find(r => r.id === record.project_id);
    return h('div', { className: 'stack' }, h('div', { className: 'segmented', 'aria-label': '详情视图' }, h(Button, { icon: "BookOpen", variant: tab === 'read' ? 'selected' : '', onClick: () => setTab('read') }, '阅读视图'), h(Button, { icon: "FileText", variant: tab === 'code' ? 'selected' : '', onClick: () => setTab('code') }, '代码视图')),
      (record.data.attachments || []).map(file => h(Button, { key: file.id, icon: 'ArrowDownToLine', onClick: async () => { try { const owner = snap.user.id, entry = await ZLXExtras.files.get(owner, file.id); if (store.snapshot().user?.id !== owner) throw new Error('账号已切换，已取消下载。'); download(entry.blob, file.name); } catch (e) { notify(e.message, 'error'); } } }, `下载附件：${file.name}`)),
      h('p', { className: 'small muted' }, `${C.KIND_NAMES[record.kind] || record.kind} · ${project?.title || '未分组'} · ${C.localDate(record.updated_at || record.created_at)}`),
      tab === 'read' ? h('div', { className: 'reading', ref }, record.kind === 'graph' && h(R.Fragment, null, h(Graph, { record }), h('ol', { className: 'graph-labels' }, (record.data.nodes || []).map((n, i) => h('li', { key: n.id || i }, n.label)))), Object.entries(record.data).filter(([key, val]) => !['candidates', 'nodes', 'eventId', 'attachments', 'messages', 'subtype'].includes(key) && val !== null && val !== '' && val !== undefined).map(([key, value]) => h('section', { key, className: 'reading-field' }, h('h3', null, LABELS[key] || key), key === 'url' || (key === 'source' && C.safeUrl(value)) ? h(Link, { href: value }, String(value)) : h('p', { className: 'preserve-text' }, displayValue(key, value, snap.records, snap.catalog)))), record.data.candidates?.length > 0 && h('section', null, h('h3', null, '候选资源与理由'), record.data.candidates.map((c, i) => h('div', { className: 'reading-field', key: i }, h('strong', null, c.database?.name), h('p', null, c.reason || '原记录未保存理由'), h(Button, { icon: "BookOpen", onClick: () => { const db = snap.catalog.find(d => d.id === c.database?.id); if (db) openModal({ type: 'resource', db }); else notify('当前目录中未找到此资源', 'error'); } }, '查看资源'))))) : h('div', null, h('div', { className: 'toolbar' }, h('label', { className: 'check-inline' }, h('input', { type: 'checkbox', checked: wrap, onChange: e => setWrap(e.target.checked) }), '自动换行'), h(Button, { icon: 'Clipboard', onClick: async () => { try { await navigator.clipboard.writeText(JSON.stringify(record, null, 2)); notify('记录 JSON 已复制'); } catch { notify('浏览器未允许复制，请选中代码手动复制。', 'error'); } } }, '复制 JSON')), h('pre', { className: wrap ? 'code wrap' : 'code', tabIndex: 0 }, JSON.stringify(record, null, 2))),
      h('div', { className: 'form-actions' }, record.kind === 'graph' && h(Button, { icon: 'ArrowDownToLine', onClick: () => { const svg = ref.current?.querySelector('svg'); if (svg) download(new XMLSerializer().serializeToString(svg), `${record.title}.svg`, 'image/svg+xml'); else { setTab('read'); notify('已切到图形预览，请再次导出 SVG。'); } } }, '导出 SVG'), record.kind === 'recommendation' && h(Button, { icon: 'RefreshCw', onClick: () => { replay(record); setScope(record.project_id || ''); onClose(); navigate('home'); } }, '重放选库条件'), record.kind === 'search' && h(Button, { icon: 'Clipboard', onClick: async () => { try { await navigator.clipboard.writeText(record.data.query || record.title); notify('检索式已复制'); } catch { notify('浏览器未允许复制，可在阅读视图选择文字复制。', 'error'); } } }, '复制检索式'), h(Button, { icon: "X", onClick: onClose }, '关闭'), h(Button, { icon: "FileText", variant: 'primary', onClick: () => openModal({ type: 'edit', record }) }, '编辑记录')));
  }
  function RecordEditor({ record, kind = 'note', projectId, folder, status, initialData = {}, onClose }) {
    const { store, snap, notify, openProject } = useApp();
    kind = record?.kind || kind;
    const [form, setForm, draftError, restored, clearDraft] = useDraft(JSON.stringify(['editor', record?.id || kind, projectId || '', folder || '']), () => {
      const data = { folder: folder || '', ...(kind === 'task' ? { priority: 'normal', dueDate: '' } : {}), ...initialData, ...record?.data, ...(kind === 'task' ? { status: (record?.data?.status || initialData.status || status) === 'done' ? 'done' : 'inbox' } : {}) };
      return { title: record?.title || '', data, project: record?.project_id || projectId || '', nodes: data.nodes || [{ id: C.uid(), label: '' }], baseUpdatedAt: record?.updated_at || null };
    });
    const { title, data, project, nodes } = form, [error, setError] = useState('');
    const setPart = (key, next) => setForm(old => ({ ...old, [key]: typeof next === 'function' ? next(old[key]) : next }));
    const setTitle = next => setPart('title', next), setData = next => setPart('data', next), setProject = next => setPart('project', next), setNodes = next => setPart('nodes', next);
    const field = (key, label, multiline = false, type = 'text') => h(Field, { label, key }, multiline ? h(AutoTextarea, { value: data[key] ?? '', onChange: e => setData({ ...data, [key]: e.target.value }) }) : h('input', { type, name: key, value: data[key] ?? '', onInput: type === 'date' ? e => { const value = e.target.value; setData(prev => ({ ...prev, [key]: value })); } : undefined, onChange: e => { const value = e.target.value; setData(prev => ({ ...prev, [key]: value })); } }));
    const options = (key, label, values) => h(Field, { label, key }, h('select', { value: data[key] || '', onChange: e => setData({ ...data, [key]: e.target.value }) }, values.map(([v, l]) => h('option', { value: v, key: v }, l))));
    return h('form', { className: 'stack', onSubmit: e => { e.preventDefault(); try { if (record && store.snapshot().records.find(r => r.id === record.id)?.updated_at !== form.baseUpdatedAt) throw new Error('原记录已更新，草稿已保留。请复制当前输入并重新打开记录核对，避免覆盖新内容。'); if (data.url && !C.safeUrl(data.url)) throw new Error('原始链接需要使用有效的 http 或 https 地址。'); const payload = { ...data }; for (const input of e.currentTarget.querySelectorAll('input[type=date][name]')) payload[input.name] = input.value; if (kind === 'graph') { if (!nodes.length || nodes.some(n => !String(n.label).trim())) throw new Error('请填写每个图表节点的内容。'); payload.nodes = nodes.map(n => ({ ...n, label: n.label.trim() })); payload.graphType ||= 'mind'; } const saved = record ? store.update(record.id, { title, data: payload, project_id: project }) : store.create(kind, title, payload, project); if (kind === 'project' && !record) openProject(saved.id); clearDraft(); notify(snap.persistent ? '已保存到本地研究空间' : '仅保留在临时会话，请下载备份'); onClose(); } catch (e) { setError(e.message); } } },
      h(Field, { label: `${C.KIND_NAMES[kind]}标题` }, h('input', { value: title, onChange: e => setTitle(e.target.value), autoFocus: true, required: true, placeholder: '一个清楚、便于再次找到的标题' })),
      kind !== 'project' && h(ScopeSelect, { value: project, onChange: setProject, all: false, label: '所属项目' }),
      ['material', 'note', 'citation', 'search', 'graph', 'favorite'].includes(kind) && options('folder', '研究阶段', [['', '待归档'], ...C.FOLDERS.map(f => [f.id, f.name])]),
      kind === 'project' && field('description', '项目说明', true),
      ['note', 'material', 'loan'].includes(kind) && field('content', kind === 'material' ? '摘要与内容' : '正文', true),
      ['material', 'citation', 'search', 'activity', 'loan'].includes(kind) && field('source', '数据库 / 来源名称'),
      ['material', 'citation', 'search', 'activity', 'favorite'].includes(kind) && field('url', '原始链接'),
      ['search', 'recommendation'].includes(kind) && field('query', kind === 'search' ? '检索式' : '完整研究问题', true),
      kind === 'search' && h('div', { className: 'form-grid' }, field('filters', '筛选条件'), field('resultCount', '结果数量', false, 'number')),
      kind === 'citation' && h(R.Fragment, null, field('argument', '研究论点', true), field('content', '引用证据', true), field('page', '页码 / 定位信息')),
      kind === 'task' && h(R.Fragment, null, field('description', '任务说明', true), h('div', { className: 'form-grid' }, options('status', '任务状态', C.STATUSES.map(s => [s.id, s.name])), options('priority', '优先级', [['normal', '普通'], ['high', '高'], ['low', '低']]), field('dueDate', '截止日期', false, 'date'))),
      kind === 'activity' && field('eventDate', '计划活动日期（可不填）', false, 'date'),
      ['note', 'citation', 'task'].includes(kind) && options('linkedId', '关联材料', [['', '无关联'], ...snap.records.filter(r => r.id !== record?.id && ['material', 'note', 'citation'].includes(r.kind) && (!project || r.project_id === project)).map(r => [r.id, r.title])]),
      kind === 'graph' && h('div', { className: 'stack' }, options('graphType', '图表形式', [['mind', '思维导图：首个节点为主题'], ['flow', '研究流程：按节点顺序连接']]), nodes.map((node, i) => h('div', { key: node.id, className: 'node-editor' }, h(Field, { label: `节点 ${i + 1}` }, h('textarea', { value: node.label, onChange: e => setNodes(nodes.map(n => n.id === node.id ? { ...n, label: e.target.value } : n)), rows: 2 })), h('div', { className: 'inline-actions' }, h(Button, { icon: "Upload", disabled: !i, onClick: () => { const next = [...nodes]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; setNodes(next); } }, '上移'), h(Button, { icon: "Trash2", onClick: () => setNodes(nodes.filter(n => n.id !== node.id)) }, '删除节点')))), h(Button, { icon: 'Plus', onClick: () => setNodes([...nodes, { id: C.uid(), label: '' }]) }, '添加节点')),
      h(DraftStatus, { error: draftError, restored }), h(ErrorText, null, error), h('div', { className: 'form-actions' }, h(Button, { icon: "Trash2", onClick: () => { if (clearDraft()) onClose(); } }, '丢弃草稿'), h(Button, { icon: "X", onClick: onClose }, '取消'), h(Button, { icon: "Check", type: 'submit', variant: 'primary' }, '保存')));
  }
  function RecordRow({ record, showProject = false }) {
    const { snap, openModal } = useApp();
    const project = snap.records.find(r => r.id === record.project_id);
    return h('article', { className: 'record-row' }, h('button', { className: 'record-main', onClick: () => openModal({ type: 'record', record }) }, h(Icon, { name: record.kind === 'task' ? 'Check' : 'FileText' }), h('span', { className: 'record-copy' }, h('strong', null, record.title), h('span', { className: 'small muted' }, [C.KIND_NAMES[record.kind], showProject ? project?.title || '未分组' : null, C.localDate(record.created_at)].filter(Boolean).join(' · ')))), h(Button, { icon: 'Trash2', className: 'compact-action', 'aria-label': `删除 ${record.title}`, onClick: () => openModal({ type: 'delete', record }) }, '删除'));
  }
  globalThis.ZLXUI = { h, R, Context, useApp, useDraft, DraftStatus, Icon, Button, Link, Field, AutoTextarea, Empty, ErrorText, Tags, Modal, ScopeSelect, ResourceCard, FavoriteEditor, TagEditor, ResourceDetail, RecordViewer, RecordEditor, RecordRow, Graph, download };
})();
