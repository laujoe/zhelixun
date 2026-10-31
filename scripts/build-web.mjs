import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// A public-file allowlist, independent of local model configuration and user data.
export function buildWeb(root, data, scripts) {
  const out = path.join(root, 'dist/web');
  // This directory is generated only. Rebuild from scratch so removed assets
  // or accidentally copied local files cannot survive a public-site build.
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const names = [];
  const write = (name, content) => { fs.mkdirSync(path.dirname(path.join(out, name)), { recursive: true }); fs.writeFileSync(path.join(out, name), content); names.push(name); };
  const css = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');
  for (const name of new Set([...css.matchAll(/\/style\/([a-z_]+\.(?:jpg|png))/g)].map(m => m[1]))) write('style/' + name, fs.readFileSync(path.join(root, 'style', name)));
  write('app.css', css.replaceAll('/style/', './style/'));
  for (const file of scripts) write(path.basename(file), fs.readFileSync(path.join(root, file)));
  write('data.js', 'globalThis.ZLX_STATIC=true;globalThis.ZLX_DATA=' + JSON.stringify(data) + ';');
  const icon = fs.readFileSync(path.join(root, 'style/penguin_icon.png'));
  write('icon.png', icon);
  write('icon.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><image width="512" height="512" href="data:image/png;base64,' + icon.toString('base64') + '"/></svg>');
  write('manifest.webmanifest', JSON.stringify({ name: '浙里寻研究空间', short_name: '浙里寻', lang: 'zh-CN', start_url: './', scope: './', display: 'standalone', background_color: '#12172f', theme_color: '#25204c', icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' }, { src: 'icon.png', sizes: '256x256', type: 'image/png' }] }, null, 2));
  const scriptNames = scripts.map(file => path.basename(file)); scriptNames.splice(1, 0, 'data.js'); scriptNames.push('install.js');
  write('index.html', '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#25204c"><meta name="description" content="浙里寻：研究资料保存在本机，通过 JSON 备份接续。"><title>浙里寻 · 研究空间</title><link rel="icon" href="./icon.png"><link rel="apple-touch-icon" href="./icon.png"><link rel="manifest" href="./manifest.webmanifest"><link rel="stylesheet" href="./app.css"></head><body><div id="root"></div>' + scriptNames.map(name => '<script src="./' + name + '"></script>').join('') + '</body></html>');
  write('install.js', fs.readFileSync(path.join(root, 'scripts/web-install.js')));
  const workerSource = fs.readFileSync(path.join(root, 'scripts/web-worker.js'), 'utf8');
  const version = createHash('sha256').update(workerSource);
  for (const name of names) version.update(name + '\0').update(fs.readFileSync(path.join(out, name)));
  const worker = 'const VERSION=' + JSON.stringify(version.digest('hex').slice(0, 16)) + ';\nconst FILES=' + JSON.stringify(names) + ';\n' + workerSource;
  write('sw.js', worker);
  write('使用说明.txt', '这里只包含公开程序文件，可上传到支持 HTTPS 的静态托管服务。无需应用服务器、数据库、验证码或 API 密钥。\n手机用系统浏览器打开网址，可按浏览器菜单添加到主屏幕。首次访问需联网；离线缓存完成后方可离线打开。学校资源仍需要联网及官方授权。\n研究资料保存在各设备浏览器，不自动同步。换设备请导出完整项目 JSON，再传送并导入。\n长期使用固定网址；更新前先保存记录并导出备份。不要上传源码根目录、.local 或个人 JSON 备份。\n只发布本目录构建清单中的文件；无需上传此说明和构建清单。\n');
  fs.writeFileSync(path.join(out, '构建清单.json'), JSON.stringify(Object.fromEntries(names.map(name => [name, createHash('sha256').update(fs.readFileSync(path.join(out, name))).digest('hex')])), null, 2));
  return [...names, '构建清单.json'].map(name => 'dist/web/' + name);
}
