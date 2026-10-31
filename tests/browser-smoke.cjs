// Optional UI regression run: requires Playwright on NODE_PATH and an installed browser.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
  const { createServer } = await import('../scripts/server.mjs');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zlx-browser-'));
  const server = createServer({ configDir: path.join(temp, 'models') });
  let browser;
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, ...(process.env.ZLX_BROWSER_PATH ? { executablePath: process.env.ZLX_BROWSER_PATH } : {}) });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route(/^https?:\/\//, route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base);
    await page.getByRole('button', { name: '进入演示空间', exact: true }).click();
    await page.getByRole('button', { name: /开启全新研究/ }).click();
    await page.getByLabel('项目名称', { exact: true }).fill('浏览器回归项目');
    await page.getByRole('button', { name: '开始提出问题', exact: true }).click();
    await page.getByRole('heading', { name: '提出问题', exact: true }).waitFor();
    const second = await context.newPage();
    await second.goto(base);
    await second.getByRole('button', { name: '登录工作台', exact: true }).waitFor();
    assert.ok(await page.getByRole('heading', { name: '提出问题', exact: true }).isVisible(), 'Opening another tab must not log out this page');
    await second.close();
    await page.getByText('本阶段资料 ·', { exact: false }).click();
    await page.getByRole('button', { name: '添加笔记', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('一个清楚、便于再次找到的标题').fill('已修复的笔记弹窗');
    await dialog.getByLabel('正文', { exact: true }).fill('浏览器回归正文');
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('button', { name: /^已修复的笔记弹窗/ }).waitFor();
    await page.getByRole('button', { name: '添加网址', exact: true }).click();
    await dialog.getByPlaceholder('一个清楚、便于再次找到的标题').fill('网址材料');
    await dialog.getByLabel('原始链接', { exact: true }).fill('https://example.com/research');
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByLabel('导入文件', { exact: false }).setInputFiles(path.join(__dirname, 'fixtures/research-note.txt'));
    await page.getByRole('button', { name: /research-note.txt/ }).first().waitFor();
    await page.getByPlaceholder('描述研究主题，小寻帮你在馆藏目录里找数据库…').fill('医学临床研究');
    await page.getByRole('button', { name: '离线寻找数据库', exact: true }).click();
    await page.locator('.resource-card').first().waitFor();
    await page.getByRole('button', { name: /进入分析问题/ }).click();
    await page.getByRole('heading', { name: '分析问题', exact: true }).waitFor();
    await page.getByRole('button', { name: /走向解决/ }).click();
    await page.getByRole('heading', { name: '解决问题', exact: true }).waitFor();
    await page.getByRole('button', { name: /完成本次研究/ }).click();
    await page.getByRole('heading', { name: '研究工作台', exact: true }).waitFor();
    const state = await page.evaluate(() => JSON.parse(localStorage.getItem(ZLXCore.STATE_KEY)));
    const project = state.records.find(r => r.title === '浏览器回归项目');
    assert.equal(project.data.researchComplete, true);
    assert.equal(state.records.find(r => r.title === '已修复的笔记弹窗').data.folder, 'question');
    const recommendation = state.records.find(r => r.project_id === project.id && r.kind === 'recommendation');
    assert.deepEqual(Object.keys(recommendation.data.candidates[0].database).sort(), ['id', 'name']);
    // Test the real IndexedDB implementation by exporting the uploaded original.
    const packed = await page.evaluate(async projectId => {
      const store = ZLXCore.createStore(ZLX_DATA, localStorage);
      return ZLXExtras.files.pack(store.snapshot().user.id, store.backup(projectId));
    }, project.id);
    assert.equal(packed.attachments.length, 1);
    assert.equal(Buffer.from(packed.attachments[0].base64, 'base64').toString(), fs.readFileSync(path.join(__dirname, 'fixtures/research-note.txt'), 'utf8'));
    // A completed project remains completed while the user reviews earlier stages.
    const projectRecord = id => page.evaluate(id => JSON.parse(localStorage.getItem(ZLXCore.STATE_KEY)).records.find(r => r.id === id), id);
    const completedBefore = await projectRecord(project.id);
    await page.locator('.project-banner').getByRole('button', { name: '查看研究过程', exact: true }).click();
    await page.getByRole('button', { name: '提出问题', exact: true }).click();
    await page.getByRole('heading', { name: '提出问题', exact: true }).waitFor();
    await page.getByRole('button', { name: '查看分析问题', exact: true }).click();
    await page.getByRole('heading', { name: '分析问题', exact: true }).waitFor();
    await page.getByRole('button', { name: '查看解决问题', exact: true }).click();
    await page.locator('.explore-exit').click();
    assert.deepEqual(await projectRecord(project.id), completedBefore);
    // Starting a new research still enters the first stage immediately.
    await page.getByRole('button', { name: '新建或继续研究', exact: true }).click();
    await dialog.getByRole('button', { name: '开启全新研究', exact: true }).click();
    await dialog.getByLabel('项目名称', { exact: true }).fill('12');
    await dialog.getByRole('button', { name: '开始提出问题', exact: true }).click();
    await page.getByRole('button', { name: /进入分析问题/ }).click();
    await page.locator('.dock-input').fill('12 的分析阶段草稿');
    await page.locator('.explore-exit').click();
    await page.locator('.project-list button').filter({ hasText: /^12$/ }).click();
    await page.getByRole('heading', { name: '研究工作台', exact: true }).waitFor();
    assert.ok(await page.locator('.project-banner').getByText('进行中 · 分析问题', { exact: true }).isVisible());
    await page.locator('.project-banner').getByRole('button', { name: '继续研究', exact: true }).click();
    await page.getByRole('heading', { name: '分析问题', exact: true }).waitFor();
    assert.equal(await page.locator('.dock-input').inputValue(), '12 的分析阶段草稿');
    await page.locator('.explore-exit').click();
    // Creating a plain project from another platform page opens its workspace.
    await page.getByRole('button', { name: '数据库目录', exact: true }).click();
    await page.getByRole('button', { name: '创建项目', exact: true }).click();
    await dialog.getByPlaceholder('一个清楚、便于再次找到的标题').fill('23');
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('heading', { name: '研究工作台', exact: true }).waitFor();
    const projectCount = () => page.evaluate(() => JSON.parse(localStorage.getItem(ZLXCore.STATE_KEY)).records.filter(r => r.kind === 'project').length);
    const beforeCount = await projectCount();
    await page.locator('.project-banner').getByRole('heading', { name: '23', exact: true }).waitFor();
    await page.locator('.project-banner').getByRole('button', { name: '开始研究', exact: true }).click();
    await page.getByRole('heading', { name: '提出问题', exact: true }).waitFor();
    assert.equal(await projectCount(), beforeCount);
    await page.locator('.explore-exit').click();
    // Overview cards and the sidebar consistently open the project workspace.
    await page.locator('.workspace-toolbar select').selectOption('');
    await page.locator('.project-tile').filter({ has: page.getByRole('heading', { name: '12', exact: true }) }).click();
    await page.getByRole('heading', { name: '研究工作台', exact: true }).waitFor();
    const folder = page.getByRole('group', { name: '按资料阶段筛选', exact: true });
    await folder.getByRole('button', { name: '分析问题', exact: true }).click();
    assert.equal(await folder.getByRole('button', { name: '分析问题', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('heading', { name: '研究工作台', exact: true }).waitFor();
    // The demo project gets the same direct start action, without losing its materials.
    await page.locator('.project-list button').filter({ hasText: '演示项目：医学影像研究' }).click();
    const demoId = await page.locator('.workspace-toolbar select').inputValue();
    const demoBefore = await projectRecord(demoId), demoCount = await projectCount();
    await page.locator('.project-banner').getByRole('button', { name: '开始研究', exact: true }).click();
    await page.getByRole('heading', { name: '提出问题', exact: true }).waitFor();
    assert.equal(await projectCount(), demoCount);
    assert.equal((await projectRecord(demoId)).data.description, demoBefore.data.description);
    await page.locator('.explore-exit').click();
    // The shared picker uses the same continuation rules.
    await page.getByRole('button', { name: '新建或继续研究', exact: true }).click();
    const twelfth = await page.evaluate(() => JSON.parse(localStorage.getItem(ZLXCore.STATE_KEY)).records.find(r => r.kind === 'project' && r.title === '12').id);
    await dialog.getByLabel('研究项目', { exact: true }).selectOption(twelfth);
    await dialog.getByRole('button', { name: '继续研究', exact: true }).click();
    await page.getByRole('heading', { name: '分析问题', exact: true }).waitFor();
    await page.locator('.explore-exit').click();
    console.log('Project entry checks passed: consistent workspace, direct start, numeric titles, continuation and completed review.');
    await page.goto(base + '/dev');
    await page.getByRole('button', { name: '进入演示空间', exact: true }).waitFor();
    await page.goto(pathToFileURL(path.resolve(__dirname, '../浙里寻-独立网页版.html')).href);
    await page.getByRole('button', { name: '进入演示空间', exact: true }).click();
    await page.getByRole('button', { name: /开启全新研究/ }).waitFor();
    // Downloads started by a signed-out account must not finish in a new session.
    await page.goto(base);
    await page.getByRole('button', { name: '进入演示空间', exact: true }).click();
    await page.getByRole('button', { name: /进入研究平台/ }).click();
    await page.getByRole('button', { name: '导出与备份', exact: true }).click();
    let downloadCount = 0;
    page.on('download', () => downloadCount++);
    const normalDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: '生成 DOCX', exact: true }).click();
    const word = await normalDownload; await word.saveAs(path.join(temp, 'research.docx'));
    assert.equal(fs.readFileSync(path.join(temp, 'research.docx')).subarray(0, 2).toString(), 'PK');
    const downloaded = downloadCount;
    await page.evaluate(() => {
      globalThis.ZLXRuntime = { ...ZLXRuntime, exportDocx: () => new Promise(resolve => { globalThis.finishWord = () => resolve(new Blob(['late document'])); }) };
    });
    await page.getByRole('button', { name: '生成 DOCX', exact: true }).click();
    await page.waitForFunction(() => typeof finishWord === 'function');
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await page.getByRole('button', { name: '登录工作台', exact: true }).waitFor();
    await page.evaluate(async () => { finishWord(); await new Promise(resolve => setTimeout(resolve, 100)); });
    assert.equal(downloadCount, downloaded, 'Signed-out DOCX export must not download');
    await page.getByRole('button', { name: '进入演示空间', exact: true }).click();
    await page.getByRole('button', { name: /进入研究平台/ }).click();
    await page.getByRole('button', { name: '研究工作台', exact: true }).click();
    await page.getByRole('button', { name: /research-note.txt/ }).first().click();
    const attachmentDialog = page.getByRole('dialog');
    // Confirm the ordinary attachment download still works before delaying one.
    const attachmentDownload = page.waitForEvent('download');
    await attachmentDialog.getByRole('button', { name: '下载附件：research-note.txt', exact: true }).click();
    const fileDownload = await attachmentDownload; await fileDownload.saveAs(path.join(temp, 'downloaded-note.txt'));
    assert.equal(fs.readFileSync(path.join(temp, 'downloaded-note.txt'), 'utf8'), fs.readFileSync(path.join(__dirname, 'fixtures/research-note.txt'), 'utf8'));
    const attachmentCount = downloadCount;
    await page.evaluate(() => {
      ZLXExtras.files.get = () => new Promise(resolve => { globalThis.finishAttachment = () => resolve({ blob: new Blob(['late attachment']) }); });
    });
    await attachmentDialog.getByRole('button', { name: '下载附件：research-note.txt', exact: true }).click();
    await page.waitForFunction(() => typeof finishAttachment === 'function');
    await attachmentDialog.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await page.getByRole('button', { name: '登录工作台', exact: true }).waitFor();
    await page.evaluate(async () => { finishAttachment(); await new Promise(resolve => setTimeout(resolve, 100)); });
    assert.equal(downloadCount, attachmentCount, 'Signed-out attachment read must not download');
    assert.deepEqual(errors, []);
    console.log('Browser checks passed: built HTML, /dev, file://, independent tabs, material dialogs, IndexedDB backup, offline matching, research completion and account-isolated downloads.');
  } finally {
    await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
