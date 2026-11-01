#!/usr/bin/env node
// OCR Clipper 本机 Native Messaging host
//   - runAgent      运行本机智能体 CLI（claude / codex / hermes / 自定义）
//   - screenshot    调用系统截屏 / PixPin / Snipaste / 自定义截图工具，读取剪贴板或输出文件
//   - captureRegion 静默截取屏幕指定区域
//   - detect / ping / cancel
// 注意：stdout 专用于协议通讯，日志写入临时目录下的 ocr-clipper-host.log。
'use strict';

const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { substitute, encodeMessage, decodeMessages, splitResponse, parseCmdShim, escapeCmdArg, tail } = require('./lib.cjs');

const VERSION = '0.1.0';
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const SCRIPTS = path.join(__dirname, 'scripts');
const LOG_FILE = path.join(os.tmpdir(), 'ocr-clipper-host.log');

function log(...a) {
  try {
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${a.join(' ')}\n`);
  } catch {}
}

// ---------------- 协议 ----------------
let inbuf = Buffer.alloc(0);
process.stdin.on('data', (d) => {
  inbuf = Buffer.concat([inbuf, d]);
  const { messages, rest } = decodeMessages(inbuf);
  inbuf = rest;
  for (const m of messages) handle(m);
});
process.stdin.on('end', () => {
  for (const c of running.values()) killTree(c);
  process.exit(0);
});

function reply(resp) {
  for (const part of splitResponse(resp)) process.stdout.write(encodeMessage(part));
}

const running = new Map(); // request id -> child process

async function handle(msg) {
  const { id, type } = msg;
  try {
    let result;
    switch (type) {
      case 'ping':
        result = { version: VERSION, platform: process.platform, node: process.version, log: LOG_FILE };
        break;
      case 'detect':
        result = await detect(msg);
        break;
      case 'runAgent':
        result = await runAgent(id, msg);
        break;
      case 'screenshot':
        result = await screenshot(id, msg);
        break;
      case 'captureRegion':
        result = await captureRegion(id, msg);
        break;
      case 'cancel': {
        const c = running.get(msg.target);
        if (c) killTree(c);
        result = { cancelled: !!c };
        break;
      }
      default:
        throw new Error(`未知请求类型 ${type}`);
    }
    reply({ id, ok: true, result });
  } catch (e) {
    log('error', type, e.stack || e.message);
    reply({ id, ok: false, error: e.message });
  }
}

// ---------------- 进程工具 ----------------
function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (IS_WIN) execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
  else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
}

const whichCache = new Map();
function which(cmd) {
  if (!cmd) return Promise.resolve(null);
  if (path.isAbsolute(cmd) || cmd.includes('/') || cmd.includes('\\')) return Promise.resolve(fs.existsSync(cmd) ? cmd : null);
  if (whichCache.has(cmd)) return Promise.resolve(whichCache.get(cmd));
  return new Promise((resolve) => {
    execFile(IS_WIN ? 'where.exe' : 'which', [cmd], { windowsHide: true }, (err, stdout) => {
      let found = null;
      if (!err) {
        const lines = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        // Windows 下优先 .exe，其次 .cmd/.bat；忽略无扩展名的 sh 脚本和 .ps1
        found = IS_WIN
          ? lines.find((l) => /\.exe$/i.test(l)) || lines.find((l) => /\.(cmd|bat)$/i.test(l)) || null
          : lines[0] || null;
      }
      whichCache.set(cmd, found);
      resolve(found);
    });
  });
}

// 解析出可以直接 spawn 的 [file, argsPrefix, needsCmd]
async function resolveLaunch(command) {
  const full = await which(command);
  if (!full) throw new Error(`找不到命令「${command}」，请在设置中填写完整路径`);
  if (IS_WIN && /\.(cmd|bat)$/i.test(full)) {
    try {
      const target = parseCmdShim(await fsp.readFile(full, 'utf8'), path.dirname(full));
      if (target && fs.existsSync(target)) {
        if (/\.exe$/i.test(target)) return { file: target, prefix: [] };
        return { file: process.execPath, prefix: [target] };
      }
    } catch {}
    return { file: full, prefix: [], viaCmd: true };
  }
  return { file: full, prefix: [] };
}

function run(reqId, command, args, { cwd, stdin, timeoutSec = 300, env } = {}) {
  return resolveLaunch(command).then(
    (launch) =>
      new Promise((resolve, reject) => {
        let file = launch.file;
        let argv = [...launch.prefix, ...args];
        const opts = { cwd, windowsHide: true, env: { ...process.env, ...env }, detached: !IS_WIN };
        if (launch.viaCmd) {
          const line = [escapeCmdArg(file, false), ...argv.map((a) => escapeCmdArg(a, true))].join(' ');
          argv = ['/d', '/s', '/c', `"${line}"`];
          file = process.env.ComSpec || 'cmd.exe';
          opts.windowsVerbatimArguments = true;
        }
        log('spawn', file, JSON.stringify(argv).slice(0, 500));
        const child = spawn(file, argv, opts);
        if (reqId != null) running.set(reqId, child);
        let out = '';
        let err = '';
        child.stdout.on('data', (d) => (out += d));
        child.stderr.on('data', (d) => (err += d));
        const timer = setTimeout(() => {
          killTree(child);
          reject(new Error(`命令超时（${timeoutSec}s）：${command}\n${tail(err)}`));
        }, timeoutSec * 1000);
        child.on('error', (e) => {
          clearTimeout(timer);
          running.delete(reqId);
          reject(new Error(`启动失败：${command}：${e.message}`));
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          running.delete(reqId);
          resolve({ code, stdout: out, stderr: err });
        });
        if (stdin != null && stdin !== '') child.stdin.end(stdin);
        else child.stdin.end();
      })
  );
}

// ---------------- 智能体 ----------------
async function runAgent(reqId, { agent, prompt, image, timeoutSec }) {
  const workdir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ocr-clipper-'));
  try {
    const vars = { workdir, out_file: path.join(workdir, 'out.txt'), prompt_file: path.join(workdir, 'prompt.txt') };
    if (image) {
      vars.image = path.join(workdir, 'page.png');
      await fsp.writeFile(vars.image, Buffer.from(image, 'base64'));
    }
    vars.prompt = substitute(prompt || '', vars);
    await fsp.writeFile(vars.prompt_file, vars.prompt, 'utf8');
    const args = (agent.args || []).map((a) => substitute(a, vars));
    const stdin = agent.stdin ? substitute(agent.stdin, vars) : null;
    const t0 = Date.now();
    const { code, stdout, stderr } = await run(reqId, agent.command, args, { cwd: workdir, stdin, timeoutSec });
    log('agent done', agent.command, `code=${code}`, `${Date.now() - t0}ms`);
    let text = '';
    try {
      text = await fsp.readFile(vars.out_file, 'utf8');
    } catch {}
    if (!text.trim()) text = stdout;
    if (code !== 0 && !text.trim()) throw new Error(`智能体退出码 ${code}：${tail(stderr || stdout)}`);
    return { text: text.trim(), code, ms: Date.now() - t0 };
  } finally {
    fsp.rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------- 截图工具 ----------------
const KNOWN_PATHS = {
  pixpin: [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'PixPin', 'PixPin.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PixPin', 'PixPin.exe'),
    '/Applications/PixPin.app/Contents/MacOS/PixPin',
  ],
  snipaste: [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Snipaste', 'Snipaste.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Snipaste', 'Snipaste.exe'),
    path.join(os.homedir(), 'scoop', 'apps', 'snipaste', 'current', 'Snipaste.exe'),
    'D:\\Snipaste\\Snipaste.exe',
    '/Applications/Snipaste.app/Contents/MacOS/Snipaste',
  ],
};

async function toolCommand(name, tool) {
  if (tool.command) return tool.command;
  const hit = (KNOWN_PATHS[name] || []).find((p) => p && fs.existsSync(p));
  if (hit) return hit;
  return (await which(name === 'snipaste' ? 'Snipaste' : name)) || '';
}

function ps(script, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', path.join(SCRIPTS, script), ...args],
      { windowsHide: true }
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += d;
      opts.onStdout?.(String(d));
    });
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out, err }));
    opts.onChild?.(child);
  });
}

function isProcessRunning(exeName) {
  return new Promise((resolve) => {
    execFile('tasklist', ['/FI', `IMAGENAME eq ${exeName}`, '/NH'], { windowsHide: true }, (e, out) =>
      resolve(!e && out.toLowerCase().includes(exeName.toLowerCase()))
    );
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Windows：先启动剪贴板监听脚本（记录当前剪贴板序号），再唤起截图工具，等待剪贴板出现新图片
async function winClipboardCapture(reqId, outFile, timeoutSec, trigger) {
  let child;
  let triggered = false;
  let triggerErr = null;
  const done = ps('wait-clipboard.ps1', ['-Out', outFile, '-TimeoutSec', String(timeoutSec)], {
    onChild: (c) => {
      child = c;
      running.set(reqId, c);
    },
    onStdout: (s) => {
      if (!triggered && s.includes('READY')) {
        triggered = true;
        trigger().catch((e) => {
          triggerErr = e;
          killTree(child);
        });
      }
    },
  });
  const { code, out, err } = await done;
  running.delete(reqId);
  if (triggerErr) throw triggerErr;
  if (code !== 0) throw new Error(code === 2 ? '等待截图超时（未在剪贴板中检测到新图片）' : `剪贴板读取失败：${tail(err || out)}`);
}

async function screenshot(reqId, { name, tool, timeoutSec = 120 }) {
  const workdir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ocr-clipper-shot-'));
  const outFile = path.join(workdir, 'shot.png');
  try {
    const trig = tool.trigger || 'system';
    if (trig === 'system') {
      if (IS_WIN) {
        // 模拟 Win+Shift+S 唤起系统截图覆盖层（部分系统上 ms-screenclip: 协议无响应），失败时再尝试协议方式
        await winClipboardCapture(reqId, outFile, timeoutSec, async () => {
          const r = await ps('send-chord.ps1', ['-Keys', 'LWIN+SHIFT+S']);
          if (r.code !== 0) spawn('explorer.exe', ['ms-screenclip:'], { windowsHide: true, detached: true }).unref();
        });
      } else if (IS_MAC) {
        await run(reqId, 'screencapture', ['-i', '-x', outFile], { timeoutSec });
      } else {
        const tries = [
          ['gnome-screenshot', ['-a', '-f', outFile]],
          ['spectacle', ['-r', '-b', '-n', '-o', outFile]],
          ['scrot', ['-s', outFile]],
        ];
        let ok = false;
        for (const [cmd, args] of tries) {
          if (!(await which(cmd))) continue;
          await run(reqId, cmd, args, { timeoutSec });
          ok = true;
          break;
        }
        if (!ok) throw new Error('未找到 gnome-screenshot / spectacle / scrot');
      }
    } else if (trig === 'hotkey') {
      if (!IS_WIN) throw new Error('快捷键唤起目前仅支持 Windows，请改用"运行命令"方式');
      const cmd = await toolCommand(name, tool);
      if (cmd && fs.existsSync(cmd) && !(await isProcessRunning(path.basename(cmd)))) {
        log('starting', cmd);
        spawn(cmd, [], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
        await sleep(3000);
      }
      await winClipboardCapture(reqId, outFile, timeoutSec, async () => {
        const r = await ps('send-keys.ps1', ['-Keys', tool.hotkey || '{F1}']);
        if (r.code !== 0) throw new Error(`发送快捷键失败：${tail(r.err)}`);
      });
    } else if (trig === 'command') {
      const cmd = await toolCommand(name, tool);
      if (!cmd) throw new Error(`未找到「${tool.label || name}」，请在设置中填写其可执行文件路径`);
      const args = (tool.args || []).map((a) => substitute(a, { out_file: outFile, workdir }));
      if (tool.output === 'file') {
        const r = await run(reqId, cmd, args, { timeoutSec });
        // 部分工具会立即返回、稍后才写文件
        for (let i = 0; i < timeoutSec * 4 && !fs.existsSync(outFile); i++) await sleep(250);
        if (!fs.existsSync(outFile)) throw new Error(`截图工具未生成文件：${tail(r.stderr)}`);
      } else if (IS_WIN) {
        await winClipboardCapture(reqId, outFile, timeoutSec, async () => {
          spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
        });
      } else {
        await run(reqId, cmd, args, { timeoutSec });
        await unixClipboardToFile(outFile, timeoutSec);
      }
    } else {
      throw new Error(`不支持的唤起方式 ${trig}`);
    }
    if (!fs.existsSync(outFile)) throw new Error('截图已取消');
    const buf = await fsp.readFile(outFile);
    return { png: buf.toString('base64'), width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } finally {
    fsp.rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}

async function unixClipboardToFile(outFile, timeoutSec) {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    try {
      if (IS_MAC) {
        await run(null, 'osascript', [
          '-e', `set f to open for access POSIX file "${outFile}" with write permission`,
          '-e', 'write (the clipboard as «class PNGf») to f',
          '-e', 'close access f',
        ], { timeoutSec: 10 });
      } else {
        const { stdout, code } = await run(null, 'sh', ['-c', `xclip -selection clipboard -t image/png -o > "${outFile}"`], { timeoutSec: 10 });
        if (code !== 0) throw new Error(stdout);
      }
      if (fs.existsSync(outFile) && fs.statSync(outFile).size > 0) return;
    } catch {}
    await sleep(500);
  }
}

// ---------------- 静默区域截图 ----------------
// 坐标为屏幕 DIP（CSS 像素 × 缩放），Windows / Linux 乘以 scale 得到物理像素，macOS 直接使用点坐标
async function captureRegion(reqId, { x, y, w, h, scale = 1 }) {
  const workdir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ocr-clipper-region-'));
  const outFile = path.join(workdir, 'region.png');
  try {
    if (IS_MAC) {
      await run(reqId, 'screencapture', ['-x', '-R', [x, y, w, h].map(Math.round).join(','), outFile], { timeoutSec: 30 });
    } else {
      const [px, py, pw, ph] = [x, y, w, h].map((v) => Math.round(v * scale));
      if (IS_WIN) {
        const r = await ps('capture-region.ps1', ['-X', px, '-Y', py, '-W', pw, '-H', ph, '-Out', outFile].map(String));
        if (r.code !== 0) throw new Error(`截屏失败：${tail(r.err || r.out)}`);
      } else if (await which('grim')) {
        await run(reqId, 'grim', ['-g', `${px},${py} ${pw}x${ph}`, outFile], { timeoutSec: 30 });
      } else {
        await run(reqId, 'import', ['-window', 'root', '-crop', `${pw}x${ph}+${px}+${py}`, outFile], { timeoutSec: 30 });
      }
    }
    if (!fs.existsSync(outFile)) throw new Error('区域截图失败');
    return { png: (await fsp.readFile(outFile)).toString('base64') };
  } finally {
    fsp.rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------- 检测 ----------------
async function detect({ agents = {}, tools = {} }) {
  const out = { agents: {}, tools: {} };
  for (const [k, cmd] of Object.entries(agents)) out.agents[k] = cmd ? (await which(cmd)) || null : null;
  for (const [k, t] of Object.entries(tools)) {
    if (t.trigger === 'system' || t.trigger === 'browser') out.tools[k] = 'built-in';
    else out.tools[k] = (await toolCommand(k, t)) || null;
  }
  return out;
}

log('host started', VERSION, process.version);
