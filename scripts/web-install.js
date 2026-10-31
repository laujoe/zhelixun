(() => {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  let reloadRequested = false, notice;
  const labelAction = (button, label, path) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key, value] of Object.entries({ width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': true })) svg.setAttribute(key, value);
    const mark = document.createElementNS('http://www.w3.org/2000/svg', 'path'); mark.setAttribute('d', path); svg.append(mark);
    const text = document.createElement('span'); text.className = 'button-label'; text.textContent = label;
    button.append(svg, text);
  };
  const show = registration => {
    if (notice || !registration.waiting) return;
    notice = document.createElement('section'); notice.className = 'update-notice'; notice.setAttribute('role', 'status');
    const text = document.createElement('p'); text.textContent = '新版已准备好。请先保存正在编辑的记录，再更新页面。';
    const update = document.createElement('button'); update.className = 'button primary'; labelAction(update, '已保存，更新页面', 'M20 7v5h-5 M4 17v-5h5 M6.1 7a7 7 0 0 1 11.55-2.6L20 7 M4 17l2.35 2.6A7 7 0 0 0 17.9 17');
    update.onclick = () => { reloadRequested = true; if (registration.waiting) registration.waiting.postMessage('activate-after-save'); else location.reload(); };
    const later = document.createElement('button'); later.className = 'button'; labelAction(later, '稍后', 'm6 6 12 12 M6 18 18 6'); later.onclick = () => { notice.remove(); notice = null; };
    notice.append(text, update, later); document.body.append(notice);
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloadRequested) location.reload(); });
  const watchInstalling = registration => {
    const worker = registration.installing;
    if (!worker) return;
    const check = () => { if (worker.state === 'installed' && navigator.serviceWorker.controller) show(registration); };
    worker.addEventListener('statechange', check); check();
  };
  navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' }).then(registration => {
    show(registration); watchInstalling(registration);
    registration.addEventListener('updatefound', () => watchInstalling(registration));
  }).catch(() => { /* Ordinary webpage use remains available if caching is blocked. */ });
})();
