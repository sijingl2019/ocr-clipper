// 截屏：
//   interactive  调用本机截屏工具（系统截屏 / PixPin / Snipaste / 自定义），由用户框选
//   browser      chrome.tabs.captureVisibleTab，静默，支持滚动拼接
//   system       由本机 host 静默截取浏览器视口所在的屏幕区域，支持滚动拼接
import { pageMeasure, pageScrollTo, pageToggleFixed } from './inject.js';
import { callHost } from './native.js';
import { Stitcher, base64ToBlob, dataUrlToBitmap } from './image.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function exec(tabId, func, args = []) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return res?.result;
}

export function resolveMethod(settings, mode) {
  if (mode === 'continuous') {
    if (settings.continuousCapture === 'browser') return 'browser';
    if (settings.continuousCapture === 'system-region') return 'system';
  }
  return settings.screenshotTool === 'browser' ? 'browser' : 'interactive';
}

let lastVisibleCapture = 0;
// captureVisibleTab 每秒最多调用 2 次
export async function captureVisible(windowId) {
  const wait = lastVisibleCapture + 600 - Date.now();
  if (wait > 0) await sleep(wait);
  lastVisibleCapture = Date.now();
  return chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
}

export async function captureViewportBlob(windowId) {
  const url = await captureVisible(windowId);
  return (await fetch(url)).blob();
}

async function makeGrabber(method, tab, m) {
  if (method === 'browser') {
    return async (rect) => {
      const bmp = await dataUrlToBitmap(await captureVisible(tab.windowId));
      const scale = bmp.width / m.innerWidth;
      const crop = await createImageBitmap(bmp, rect.x * scale, rect.y * scale, rect.w * scale, rect.h * scale);
      bmp.close();
      return { bitmap: crop, scale };
    };
  }
  // system：把视口坐标换算成屏幕坐标（DIP），由 host 按平台换算为物理像素后截取
  const zoom = await chrome.tabs.getZoom(tab.id);
  const border = Math.max(0, (m.outerWidth - m.innerWidth * zoom) / 2);
  const left = m.screenX + border;
  const top = m.screenY + m.outerHeight - m.innerHeight * zoom - border;
  const dsf = m.dpr / zoom;
  return async (rect) => {
    const res = await callHost('captureRegion', {
      x: left + rect.x * zoom,
      y: top + rect.y * zoom,
      w: rect.w * zoom,
      h: rect.h * zoom,
      scale: dsf,
    });
    const bitmap = await createImageBitmap(base64ToBlob(res.png));
    return { bitmap, scale: bitmap.width / rect.w };
  };
}

// 截取当前页面，返回 OCR 切片（PNG Blob 数组）
export async function capturePage(tab, settings, { mode, log = () => {}, signal } = {}) {
  const method = resolveMethod(settings, mode);
  if (method === 'interactive') {
    const name = settings.screenshotTool;
    log(`请使用「${settings.tools[name]?.label || name}」框选截图区域（完成后复制到剪贴板 / 确认）…`);
    const res = await callHost(
      'screenshot',
      { name, tool: settings.tools[name], timeoutSec: settings.screenshotTimeoutSec },
      { signal }
    );
    const bitmap = await createImageBitmap(base64ToBlob(res.png));
    const st = new Stitcher(bitmap.width, settings.sliceHeightPx);
    st.add(bitmap, 0);
    return { slices: await st.flush(true), method };
  }

  const m = await exec(tab.id, pageMeasure);
  const grab = await makeGrabber(method, tab, m);
  const canScroll = settings.scrollCapture && m.scrollHeight > m.clientHeight + 4;

  if (!canScroll) {
    const { bitmap } = await grab(m.rect);
    const st = new Stitcher(bitmap.width, settings.sliceHeightPx);
    st.add(bitmap, 0);
    return { slices: await st.flush(true), method };
  }

  const origTop = m.scrollTop;
  let st = null;
  let y = 0;
  let hidden = false;
  let frames = 0;
  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
      const { top, height } = await exec(tab.id, pageScrollTo, [y]);
      await sleep(frames === 0 ? 500 : 350); // 等待懒加载图片 / 文本渲染
      if (frames === 1 && settings.hideFixedAfterFirst && !hidden) {
        await exec(tab.id, pageToggleFixed, [true]);
        hidden = true;
      }
      const { bitmap, scale } = await grab(m.rect);
      if (!st) st = new Stitcher(bitmap.width, settings.sliceHeightPx);
      st.add(bitmap, top * scale);
      await st.flush(false);
      frames++;
      const limit = Math.min(height, settings.maxScrollCssPx);
      log(`滚动截屏 ${frames} 帧（${Math.round(top + m.clientHeight)}/${Math.round(limit)}px）`);
      if (top + m.clientHeight >= limit - 1 || (frames > 1 && top < y - 1)) break;
      y = top + m.clientHeight;
    }
  } finally {
    if (hidden) await exec(tab.id, pageToggleFixed, [false]).catch(() => {});
    await exec(tab.id, pageScrollTo, [origTop]).catch(() => {});
  }
  return { slices: await st.flush(true), method };
}
