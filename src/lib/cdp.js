// 通过 chrome.debugger（Chrome DevTools Protocol）发送"可信"的鼠标 / 键盘事件，
// 适用于只响应真实输入的阅读器（例如 canvas 渲染、拦截合成事件的页面），并用于打印 PDF。

const attached = new Set();

export async function attach(tabId) {
  if (attached.has(tabId)) return;
  await chrome.debugger.attach({ tabId }, '1.3');
  attached.add(tabId);
}

export async function detach(tabId) {
  if (!attached.has(tabId)) return;
  attached.delete(tabId);
  try {
    await chrome.debugger.detach({ tabId });
  } catch {}
}

chrome.debugger?.onDetach.addListener(({ tabId }) => attached.delete(tabId));

export const send = (tabId, method, params = {}) => chrome.debugger.sendCommand({ tabId }, method, params);

export async function trustedClick(tabId, x, y) {
  await attach(tabId);
  const base = { x, y, button: 'left', clickCount: 1 };
  await send(tabId, 'Input.dispatchMouseEvent', { ...base, type: 'mouseMoved' });
  await send(tabId, 'Input.dispatchMouseEvent', { ...base, type: 'mousePressed' });
  await send(tabId, 'Input.dispatchMouseEvent', { ...base, type: 'mouseReleased' });
}

const KEY_CODES = { ArrowRight: 39, ArrowLeft: 37, ArrowDown: 40, PageDown: 34, Space: 32, ' ': 32, Enter: 13, n: 78, j: 74 };

export async function pressKey(tabId, key) {
  await attach(tabId);
  const code = KEY_CODES[key] ?? key.toUpperCase().charCodeAt(0);
  const k = key === 'Space' ? ' ' : key;
  const p = { key: k, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code };
  await send(tabId, 'Input.dispatchKeyEvent', { ...p, type: 'rawKeyDown' });
  if (k.length === 1) await send(tabId, 'Input.dispatchKeyEvent', { ...p, type: 'char', text: k });
  await send(tabId, 'Input.dispatchKeyEvent', { ...p, type: 'keyUp' });
}

// 把指定标签页打印为 PDF，返回 base64
export async function printToPDF(tabId) {
  await attach(tabId);
  try {
    const { data } = await send(tabId, 'Page.printToPDF', {
      printBackground: true,
      preferCSSPageSize: true,
      marginTop: 0.6,
      marginBottom: 0.6,
      marginLeft: 0.6,
      marginRight: 0.6,
    });
    return data;
  } finally {
    await detach(tabId);
  }
}
