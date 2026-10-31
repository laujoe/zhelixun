import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { projectIdentity } from './server.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function launch(action, { root = projectRoot, port = 4173, openBrowser = true } = {}) {
  if (!['start', 'stop'].includes(action)) throw new Error('请选择 start 或 stop。');
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('请安装 Node.js 22 或更新版本。');
  const url = `http://127.0.0.1:${port}`, local = path.join(root, '.local');
  const stateFile = path.join(local, 'server.json'), lockFile = path.join(local, 'launcher.lock');
  const identity = projectIdentity(root);
  fs.mkdirSync(local, { recursive: true });
  const alive = pid => {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; }
  };
  let lock;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { lock = fs.openSync(lockFile, 'wx'); fs.writeFileSync(lock, String(process.pid)); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const pid = Number(fs.readFileSync(lockFile, 'utf8'));
      if (!pid || alive(pid)) throw new Error('另一个启动或停止操作正在进行，请稍后再试。');
      fs.rmSync(lockFile);
    }
  }
  if (lock === undefined) throw new Error('无法取得启动锁，请稍后再试。');
  const health = async () => {
    try {
      const response = await fetch(`${url}/api/health`, { headers: { Connection: 'close' }, signal: AbortSignal.timeout(1200), redirect: 'error' });
      const text = await response.text();
      try { return JSON.parse(text); } catch { return { app: 'unknown' }; }
    } catch (e) {
      if (e.cause?.code === 'ECONNREFUSED') return null;
      throw new Error(`${port} 端口上的服务未正常响应，请检查原终端或关闭占用该端口的程序后重试。`);
    }
  };
  const readState = () => { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return null; } };
  const stopManaged = async running => {
    const saved = readState();
    if (running.app !== 'zhelixun' || running.rootId !== identity.rootId || !saved || saved.instanceId !== running.instanceId || saved.pid !== running.pid || !alive(saved.pid)) {
      throw new Error('此服务不是从当前文件夹一键启动的，未停止。请在原文件夹使用停止入口，或在原终端按 Ctrl+C。');
    }
    process.kill(saved.pid, 'SIGTERM');
    for (let i = 0; i < 50; i++) {
      await pause(100);
      const current = await health();
      if (!current || current.instanceId !== running.instanceId) { fs.rmSync(stateFile, { force: true }); return; }
    }
    throw new Error('停止超时，请在原终端检查服务状态。');
  };
  const open = () => {
    if (!openBrowser) return;
    const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
    const result = spawnSync(command, [url], { stdio: 'ignore' });
    if (result.error || result.status !== 0) console.log(`请手动在浏览器打开 ${url}`);
  };
  try {
    let running = await health();
    if (action === 'stop') {
      if (!running) { fs.rmSync(stateFile, { force: true }); console.log('浙里寻本地服务未运行。'); return; }
      await stopManaged(running); console.log('浙里寻本地服务已停止。'); return;
    }
    if (running && (running.app !== 'zhelixun' || running.rootId !== identity.rootId)) throw new Error(`${port} 端口被其他程序或另一份浙里寻占用。请先从原位置停止服务，再启动当前文件夹。`);
    const build = spawnSync(process.execPath, [path.join(root, 'scripts/build.mjs')], { cwd: root, stdio: 'inherit' });
    if (build.error || build.status !== 0) throw new Error('网页构建失败，请查看上方错误。');
    if (running && running.sourceHash !== identity.sourceHash) { await stopManaged(running); running = null; }
    if (running) { open(); console.log(`浙里寻已在运行：${url}`); return running; }
    const instanceId = randomUUID(), log = fs.openSync(path.join(local, 'server.log'), 'a', 0o600);
    let child;
    try {
      child = spawn(process.execPath, [path.join(root, 'scripts/server.mjs')], {
        cwd: root, detached: true, windowsHide: true, stdio: ['ignore', log, log],
        env: { ...process.env, ZLX_PORT: String(port), ZLX_INSTANCE_ID: instanceId },
      });
    } finally { fs.closeSync(log); }
    let spawnError;
    child.on('error', error => { spawnError = error; }); child.unref();
    try { for (let attempt = 0; attempt < 60; attempt++) {
      await pause(150);
      if (spawnError || child.exitCode !== null) throw new Error('本地服务启动失败，请查看 .local/server.log。');
      running = await health();
      if (running?.instanceId === instanceId && running.rootId === identity.rootId && running.pid === child.pid) {
        fs.writeFileSync(stateFile, JSON.stringify({ pid: child.pid, instanceId }), { mode: 0o600 });
        open(); console.log(`浙里寻已启动：${url}`); return running;
      }
      if (running) throw new Error(`${port} 端口被其他程序抢先占用，请查看 .local/server.log。`);
    }
    throw new Error('本地服务启动超时，请查看 .local/server.log。');
    } catch (error) { if (child.exitCode === null && child.pid) child.kill(); throw error; }
  } finally { fs.closeSync(lock); fs.rmSync(lockFile, { force: true }); }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  launch(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
}
