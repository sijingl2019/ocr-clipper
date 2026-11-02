// 与本机 host（host/host.js）的 Native Messaging 通讯。
// 请求: { id, type, ...payload }
// 响应: { id, ok, result | error }；大于 1MB 的响应会被拆成 { id, chunk, seq, last } 分片发送。

export const HOST_NAME = 'com.ocrclipper.host';

let port = null;
let nextId = 1;
const pending = new Map(); // id -> { resolve, reject, chunks }

function connect() {
  if (port) return port;
  port = chrome.runtime.connectNative(HOST_NAME);
  port.onMessage.addListener(onMessage);
  port.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError?.message || '本机 host 已断开';
    port = null;
    for (const p of pending.values()) p.reject(new Error(hostHint(err)));
    pending.clear();
  });
  return port;
}

function hostHint(msg) {
  const id = chrome.runtime.id;
  if (/forbidden/i.test(msg)) {
    return `${msg}。本机 host 未授权当前扩展（ID: ${id}）。请重新运行安装脚本并加入该 ID：Windows: install-windows.ps1 -ExtensionId ${id}；macOS/Linux: sh install.sh ${id}`;
  }
  if (/not found|not exist|Specified native messaging host/i.test(msg)) {
    return `${msg}。请先安装本机 host：Windows: install-windows.ps1 -ExtensionId ${id}；macOS/Linux: sh install.sh ${id}，然后重新加载扩展。`;
  }
  return msg;
}

function onMessage(msg) {
  const p = pending.get(msg.id);
  if (!p) return;
  if ('chunk' in msg) {
    p.chunks.push(msg.chunk);
    if (!msg.last) return;
    try {
      msg = JSON.parse(p.chunks.join(''));
    } catch (e) {
      pending.delete(msg.id);
      p.reject(new Error('host 响应解析失败: ' + e.message));
      return;
    }
  }
  pending.delete(msg.id);
  if (msg.ok) p.resolve(msg.result);
  else p.reject(new Error(msg.error || 'host 返回错误'));
}

export function callHost(type, payload = {}, { signal } = {}) {
  return new Promise((resolve, reject) => {
    let p;
    try {
      p = connect();
    } catch (e) {
      reject(new Error(hostHint(e.message)));
      return;
    }
    const id = nextId++;
    pending.set(id, { resolve, reject, chunks: [] });
    if (signal) {
      if (signal.aborted) {
        pending.delete(id);
        reject(new DOMException('已取消', 'AbortError'));
        return;
      }
      signal.addEventListener(
        'abort',
        () => {
          if (!pending.has(id)) return;
          pending.delete(id);
          try {
            port?.postMessage({ id: nextId++, type: 'cancel', target: id });
          } catch {}
          reject(new DOMException('已取消', 'AbortError'));
        },
        { once: true }
      );
    }
    p.postMessage({ id, type, ...payload });
  });
}

export const pingHost = () => callHost('ping');
