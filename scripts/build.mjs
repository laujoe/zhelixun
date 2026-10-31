import fs from 'node:fs';
import { buildWeb } from './build-web.mjs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const data = {
  catalog: JSON.parse(read('src/data/catalog.json')),
  platforms: JSON.parse(read('src/data/platforms.json')),
  auditCsv: read('src/data/catalog-audit.csv'),
  descriptions: {},
  version: JSON.parse(read('package.json')).version,
};
// Embed public catalog data and descriptions; browser storage is never read.
const descriptionsFile = path.join(root, 'src/data/descriptions.json');
if (fs.existsSync(descriptionsFile)) data.descriptions = JSON.parse(fs.readFileSync(descriptionsFile, 'utf8'));
const safeScript = value => value.replace(/<\/script/gi, '<\\/script');
// Large data URLs exceed browser custom-property limits. Resolve image variables
// to ordinary background declarations before embedding the original image bytes.
let css = read('src/styles.css');
const imageVariables = new Map();
css = css.replace(/(--[\w-]+)\s*:\s*(url\(['"]?\/style\/[^)]+\))\s*;/g, (_, name, value) => {
  imageVariables.set(name, value);
  return '';
});
css = css.replace(/var\((--[\w-]+)\)/g, (original, name) => imageVariables.get(name) || original);
// Store each image once in the HTML. Reconstruct the same resolved CSS in the
// head before the application runs, avoiding large CSS custom-property values.
const assets = Object.fromEntries([...new Set([...css.matchAll(/\/style\/([a-z_]+\.(?:jpg|png))/g)].map(match => match[1]).concat('penguin_icon.png'))].map(name => [name, `data:image/${name.endsWith('.png') ? 'png' : 'jpeg'};base64,${fs.readFileSync(path.join(root, 'style', name)).toString('base64')}`]));
const styleBootstrap = `(() => {
  const assets = ${safeScript(JSON.stringify(assets))};
  const style = document.createElement('style');
  style.textContent = ${safeScript(JSON.stringify(css))}.replace(/\\/style\\/([a-z_]+\\.(?:jpg|png))/g, (_, name) => assets[name]);
  document.head.append(style);
  const icon = document.createElement('link'); icon.rel = 'icon'; icon.href = assets['penguin_icon.png']; document.head.append(icon);
})();`;
new vm.Script(styleBootstrap, { filename: 'offline-style-bootstrap.js' });
const files = ['src/runtime/legacy-vendor.js', 'src/core.js', 'src/extensions.js', 'src/components.js', 'src/research.js', 'src/app.js'];
const scripts = files.map(file => {
  const code = read(file);
  new vm.Script(code, { filename: file });
  return `<script>\n${safeScript(code)}\n</script>`;
});
scripts.splice(1, 0, `<script>globalThis.ZLX_DATA=${safeScript(JSON.stringify(data))};</script>`);
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="description" content="浙里寻：发现数据库、整理研究项目，离线使用，本地保存。">
<title>浙里寻 · 研究空间</title>
<script>${styleBootstrap}</script></head><body><div id="root"></div>
${scripts.join('\n')}
</body></html>`;
const out = path.join(root, '浙里寻-独立网页版.html');
fs.writeFileSync(out, html);
buildWeb(root, data, files);
console.log(`已构建 ${path.basename(out)}，${data.catalog.length} 条资源，${Object.keys(data.descriptions).length} 条详细说明。`);
