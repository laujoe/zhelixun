import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestName = '文件校验清单.json';
// Exact public files only. Never recurse through the working directory.
// Add intentional new source files here when the project grows.
export const submissionFiles = Object.freeze([
  '.gitignore', 'README.md', 'package.json',
  '浙里寻-独立网页版.html', '离线打开浙里寻.command', '离线打开浙里寻.cmd',
  'src/app.js', 'src/components.js', 'src/core.js', 'src/extensions.js', 'src/research.js', 'src/styles.css',
  'src/runtime/legacy-vendor.js', 'src/runtime/ORIGIN.txt',
  'src/data/catalog.json', 'src/data/catalog-audit.csv', 'src/data/platforms.json',
  'src/data/descriptions.json', 'src/data/descriptions-manifest.json', 'src/data/source/descriptions.json',
  'style/choose_background_final.png', 'style/reg_background.jpg', 'style/nebula_reference.jpg',
  'style/penguin_icon.png', 'style/question_background.jpg',
  'scripts/build.mjs', 'scripts/build-web.mjs', 'scripts/import-descriptions.mjs',
  'scripts/package.mjs', 'scripts/server.mjs', 'scripts/launcher.mjs', 'scripts/macos.sh',
  'scripts/start.ps1', 'scripts/stop.ps1', 'scripts/web-install.js', 'scripts/web-worker.js',
  'scripts/launchers/启动浙里寻.command', 'scripts/launchers/停止浙里寻.command',
  'scripts/launchers/启动浙里寻.cmd', 'scripts/launchers/停止浙里寻.cmd',
  'tests/core.test.cjs', 'tests/extensions.test.cjs', 'tests/launcher.test.cjs', 'tests/server.test.cjs',
  'tests/package.test.cjs', 'tests/browser-smoke.cjs', 'tests/lightweight-browser.cjs',
  'tests/fixtures/mock-model.mjs', 'tests/fixtures/research-note.txt',
  'docs/使用指南.md', 'docs/开发与验证.md', 'docs/提交说明.md', 'docs/第三方许可摘录.txt',
  'docs/development/DESIGN.md', 'docs/development/UX-CONTRACT.md',
  'docs/development/研究项目入口修复策划案.md',
].sort());
const sha256 = data => createHash('sha256').update(data).digest('hex');
const modeFor = name => name.endsWith('.command') || name === 'scripts/macos.sh' ? 0o755 : 0o644;

function readPublicFile(root, name) {
  if (path.isAbsolute(name) || name.split('/').some(part => !part || part === '..' || part === '.') || name.includes('\\')) throw new Error('非法提交路径。');
  let file = root;
  for (const part of name.split('/')) {
    file = path.join(file, part);
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error(`提交文件不允许符号链接：${name}`);
  }
  if (!fs.statSync(file).isFile()) throw new Error(`不是普通文件：${name}`);
  return fs.readFileSync(file);
}

export function collectSubmission(root) {
  const entries = submissionFiles.map(name => ({ name, data: readPublicFile(root, name), mode: modeFor(name) }));
  const hashes = Object.fromEntries(entries.map(entry => [entry.name, sha256(entry.data)]));
  entries.push({ name: manifestName, data: Buffer.from(JSON.stringify(hashes, null, 2) + '\n'), mode: 0o644 });
  return entries;
}

export function verifySubmission(root) {
  const hashes = JSON.parse(readPublicFile(root, manifestName));
  const names = Object.keys(hashes).sort();
  if (JSON.stringify(names) !== JSON.stringify(submissionFiles)) throw new Error('校验清单的文件范围与提交清单不一致。');
  for (const name of names) {
    if (sha256(readPublicFile(root, name)) !== hashes[name]) throw new Error(`校验失败：${name}`);
  }
  return names.length;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Standard ZIP/DEFLATE, UTF-8 filenames, fixed timestamps and normalized modes.
// No owner IDs, absolute paths, extended attributes, resource forks or comments.
export function createZip(entries, folder) {
  if (!/^[\p{L}\p{N}._-]+$/u.test(folder) || entries.length > 65535) throw new Error('非法压缩包目录或文件数量。');
  const local = [], central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(folder + '/' + entry.name), data = entry.data;
    const compressed = deflateRawSync(data, { level: 9 }), crc = crc32(data);
    if (name.length > 65535 || data.length >= 0xffffffff || compressed.length >= 0xffffffff) throw new Error('文件超过 ZIP 大小限制。');
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6); header.writeUInt16LE(8, 8);
    header.writeUInt16LE(0x2821, 12); // 2000-01-01, 00:00:00
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, compressed);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(0x0314, 4);
    directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8); directory.writeUInt16LE(8, 10);
    directory.writeUInt16LE(0x2821, 14); directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(((0o100000 | entry.mode) * 65536) >>> 0, 38);
    directory.writeUInt32LE(offset, 42); central.push(directory, name);
    offset += header.length + name.length + compressed.length;
    if (offset >= 0xffffffff) throw new Error('压缩包超过 ZIP 大小限制。');
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

function main() {
  if (process.argv.includes('--verify')) {
    if (!fs.existsSync(path.join(projectRoot, manifestName))) throw new Error('请在新解压的比赛包目录运行 npm run verify；源码工作目录使用 npm run package 生成提交包。');
    console.log(`SHA-256 校验通过：${verifySubmission(projectRoot)} 个文件。`);
    return;
  }
  const build = spawnSync(process.execPath, [path.join(projectRoot, 'scripts/build.mjs')], { cwd: projectRoot, stdio: 'inherit' });
  if (build.error || build.status !== 0) throw new Error('构建失败，未生成提交包。');
  const version = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'))).version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('版本格式不正确。');
  const folder = `浙里寻-比赛源码-v${version}`, out = path.join(projectRoot, 'dist/submission');
  const entries = collectSubmission(projectRoot), bytes = createZip(entries, folder);
  fs.mkdirSync(out, { recursive: true });
  const name = folder + '.zip', target = path.join(out, name), temporary = target + '.tmp';
  fs.writeFileSync(temporary, bytes); fs.renameSync(temporary, target);
  fs.writeFileSync(path.join(out, name + '.sha256'), sha256(bytes) + '  ' + name + '\n');
  fs.writeFileSync(path.join(projectRoot, manifestName), entries.find(entry => entry.name === manifestName).data);
  console.log(`已生成 dist/submission/${name}（${entries.length} 个文件，${(bytes.length / 1048576).toFixed(2)} MB）。`);
  console.log('可直接提交该 ZIP；源码根目录的本机配置和开发归档不会进入压缩包。');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
