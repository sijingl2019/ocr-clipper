// host 的纯函数部分（便于单元测试）
'use strict';

const PLACEHOLDER_RE = /\{(image|prompt|prompt_file|out_file|workdir)\}/g;

function substitute(template, vars) {
  return String(template).replace(PLACEHOLDER_RE, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
}

// Native Messaging 帧：4 字节小端长度 + UTF-8 JSON
function encodeMessage(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  return Buffer.concat([head, body]);
}

// 从累积缓冲区中解析出完整消息，返回 { messages, rest }
function decodeMessages(buf) {
  const messages = [];
  let off = 0;
  while (buf.length - off >= 4) {
    const len = buf.readUInt32LE(off);
    if (buf.length - off - 4 < len) break;
    messages.push(JSON.parse(buf.slice(off + 4, off + 4 + len).toString('utf8')));
    off += 4 + len;
  }
  return { messages, rest: buf.slice(off) };
}

// host → Chrome 单条消息上限 1MB，超过时拆分为多个分片
const CHUNK_CHARS = 256 * 1024;
function splitResponse(resp) {
  const json = JSON.stringify(resp);
  if (json.length <= CHUNK_CHARS) return [resp];
  const out = [];
  for (let i = 0, seq = 0; i < json.length; i += CHUNK_CHARS, seq++) {
    out.push({ id: resp.id, chunk: json.slice(i, i + CHUNK_CHARS), seq, last: i + CHUNK_CHARS >= json.length });
  }
  return out;
}

// 解析 npm 生成的 .cmd 包装脚本，找到真正的目标（.exe 或 .js），以便绕过 cmd.exe 直接启动
function parseCmdShim(content, shimDir) {
  const re = /"%dp0%\\([^"]+?\.(?:exe|js|cjs|mjs))"/gi;
  let m;
  let last = null;
  while ((m = re.exec(content))) last = m[1];
  if (!last) return null;
  const path = require('path');
  return path.join(shimDir, last);
}

// cmd.exe 参数转义（参考 cross-spawn）
const META = /([()\][%!^"`<>&|;, *?])/g;
function escapeCmdArg(arg, doubleEscape) {
  let a = String(arg).replace(/\r?\n/g, ' ');
  a = a.replace(/(\\*)"/g, '$1$1\\"');
  a = a.replace(/(\\*)$/, '$1$1');
  a = `"${a}"`;
  a = a.replace(META, '^$1');
  if (doubleEscape) a = a.replace(META, '^$1');
  return a;
}

function tail(s, n = 1500) {
  s = String(s || '');
  return s.length > n ? '…' + s.slice(-n) : s;
}

module.exports = { substitute, encodeMessage, decodeMessages, splitResponse, parseCmdShim, escapeCmdArg, tail, CHUNK_CHARS };
