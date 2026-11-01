import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const lib = require('../host/lib.cjs');
const HOST = join(dirname(fileURLToPath(import.meta.url)), '..', 'host', 'host.cjs');

test('占位符替换只替换已知变量', () => {
  assert.equal(lib.substitute('{image} {prompt} {foo} {"id": 1}', { image: 'a.png', prompt: 'p' }), 'a.png p {foo} {"id": 1}');
});

test('消息编解码与半包处理', () => {
  const a = lib.encodeMessage({ id: 1, text: '中文' });
  const b = lib.encodeMessage({ id: 2 });
  const all = Buffer.concat([a, b]);
  const r1 = lib.decodeMessages(all.slice(0, a.length + 3));
  assert.deepEqual(r1.messages, [{ id: 1, text: '中文' }]);
  const r2 = lib.decodeMessages(Buffer.concat([r1.rest, all.slice(a.length + 3)]));
  assert.deepEqual(r2.messages, [{ id: 2 }]);
});

test('大响应分片后可还原', () => {
  const resp = { id: 9, ok: true, result: { png: 'x'.repeat(lib.CHUNK_CHARS * 2 + 10) } };
  const parts = lib.splitResponse(resp);
  assert.equal(parts.length, 3);
  assert.ok(parts.at(-1).last);
  assert.deepEqual(JSON.parse(parts.map((p) => p.chunk).join('')), resp);
  for (const p of parts) assert.ok(JSON.stringify(p).length < 1024 * 1024);
});

test('解析 npm .cmd 包装脚本', () => {
  const claude = '"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*';
  assert.match(lib.parseCmdShim(claude, 'C:\\npm'), /claude-code[\\/]bin[\\/]claude\.exe$/);
  const codex = 'SET "_prog=%dp0%\\node.exe"\n"%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*';
  assert.match(lib.parseCmdShim(codex, 'C:\\npm'), /codex\.js$/);
});

test('cmd 参数转义', () => {
  assert.equal(lib.escapeCmdArg('a b', false), '^"a^ b^"');
  assert.equal(lib.escapeCmdArg('x\ny', false), '^"x^ y^"');
});

function talk(messages) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOST]);
    let buf = Buffer.alloc(0);
    const got = [];
    child.stdout.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      const r = lib.decodeMessages(buf);
      buf = r.rest;
      got.push(...r.messages);
      if (got.length >= messages.length) {
        child.stdin.end();
        resolve(got);
      }
    });
    child.on('error', reject);
    for (const m of messages) child.stdin.write(lib.encodeMessage(m));
    setTimeout(() => {
      child.kill();
      reject(new Error('timeout'));
    }, 20000);
  });
}

test('host: ping 与 runAgent（以 node 作为假智能体）', async () => {
  const fakeAgent = {
    command: process.execPath,
    // 假智能体：读取 stdin 中的提示词，确认图片文件存在，然后写入 {out_file}
    args: [
      '-e',
      "const fs=require('fs');let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{fs.writeFileSync(process.argv[1],'OCR:'+fs.statSync(process.argv[2]).size+':'+s)})",
      '{out_file}',
      '{image}',
    ],
    stdin: '识别 {image}',
  };
  const png = Buffer.from([137, 80, 78, 71]).toString('base64');
  const [pong, res, bad] = await talk([
    { id: 1, type: 'ping' },
    { id: 2, type: 'runAgent', agent: fakeAgent, prompt: 'P', image: png, timeoutSec: 20 },
    { id: 3, type: 'nope' },
  ]).then((all) => [1, 2, 3].map((id) => all.find((m) => m.id === id)));
  assert.equal(pong.ok, true);
  assert.equal(pong.result.platform, process.platform);
  assert.equal(res.ok, true, res.error);
  assert.match(res.result.text, /^OCR:4:识别 .*page\.png$/);
  assert.equal(bad.ok, false);
});
