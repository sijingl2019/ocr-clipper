// 采集流程：截屏 → 入库 → 交给 OCR 队列（与翻页并行）→ 自动翻页 → 循环。
import { capturePage } from './capture.js';
import { NextPager } from './nextpage.js';
import { ocrImage } from './agent.js';
import { addPage, getPage, updatePage } from './db.js';
import { imageFingerprint, makeThumb } from './image.js';
import { detach } from './cdp.js';

export async function ocrPage(settings, id, { signal, onUpdate = () => {} } = {}) {
  const page = await getPage(id);
  if (!page) return;
  await updatePage(id, { status: 'ocr', error: '', texts: [] });
  onUpdate(id);
  try {
    const texts = [];
    for (const blob of page.slices) {
      texts.push(await ocrImage(settings, blob, { signal }));
      await updatePage(id, { texts: [...texts] });
      onUpdate(id);
    }
    await updatePage(id, { status: 'done', texts });
  } catch (e) {
    await updatePage(id, { status: 'error', error: e.message });
    if (e.name === 'AbortError') throw e;
  } finally {
    onUpdate(id);
  }
}

class OcrQueue {
  constructor(settings, concurrency, signal, onUpdate) {
    this.settings = settings;
    this.limit = Math.max(1, concurrency | 0);
    this.signal = signal;
    this.onUpdate = onUpdate;
    this.queue = [];
    this.active = 0;
    this.idle = [];
  }
  push(id) {
    this.queue.push(id);
    this.pump();
  }
  pump() {
    while (this.active < this.limit && this.queue.length && !this.signal.aborted) {
      const id = this.queue.shift();
      this.active++;
      ocrPage(this.settings, id, { signal: this.signal, onUpdate: this.onUpdate })
        .catch(() => {})
        .finally(() => {
          this.active--;
          this.pump();
          if (!this.active && !this.queue.length) this.idle.splice(0).forEach((r) => r());
        });
    }
  }
  drain() {
    if ((!this.active && !this.queue.length) || this.signal.aborted) return Promise.resolve();
    return new Promise((r) => this.idle.push(r));
  }
}

function fpSimilar(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d / a.length < 0.01;
}

export class Runner {
  constructor({ log, onPages, onPageUpdate, onState }) {
    this.log = log;
    this.onPages = onPages;
    this.onPageUpdate = onPageUpdate;
    this.onState = onState;
    this.controller = null;
  }

  get running() {
    return !!this.controller;
  }

  stop() {
    this.controller?.abort();
  }

  async start(settings, tab) {
    if (this.controller) return;
    const controller = (this.controller = new AbortController());
    const { signal } = controller;
    const mode = settings.mode;
    const maxPages = mode === 'single' ? 1 : Math.max(1, settings.maxPages | 0);
    const queue = new OcrQueue(settings, settings.ocrConcurrency, signal, this.onPageUpdate);
    const pager = new NextPager(tab, settings, { log: this.log, signal });
    this.onState(true);
    let prevFp = null;
    let retried = false;
    try {
      for (let i = 0; i < maxPages; i++) {
        const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
        if (active?.id !== tab.id) throw new Error('目标标签页已不在前台，请切回该标签页后重新开始');
        const cur = await chrome.tabs.get(tab.id);
        this.log(`第 ${i + 1} 页：截屏中…`);
        const { slices } = await capturePage(cur, settings, { mode, log: this.log, signal });
        if (!slices.length) throw new Error('截图为空');
        const fp = await imageFingerprint(slices[0]);
        if (fpSimilar(fp, prevFp)) {
          // 可能是翻页没有真正生效（例如页面只响应真实点击），用可信点击重试一次
          if (!retried) {
            retried = true;
            this.log('页面内容与上一页相同，可能翻页未生效，重试翻页…');
            if (await pager.next({ forceTrusted: true })) {
              i--;
              continue;
            }
          }
          this.log('页面内容与上一页相同，判定为已到末页');
          break;
        }
        retried = false;
        prevFp = fp;
        const page = await addPage({ url: cur.url, title: cur.title, slices, thumb: await makeThumb(slices[0]) });
        this.log(`第 ${i + 1} 页：已截取 ${slices.length} 张切片，加入 OCR 队列`);
        this.onPages();
        queue.push(page.id);
        if (i === maxPages - 1) break;
        if (!(await pager.next())) {
          this.log('没有下一页了');
          break;
        }
      }
      this.log('截屏完成，等待 OCR 完成…');
      await queue.drain();
      this.log(signal.aborted ? '已停止' : '全部完成');
    } catch (e) {
      this.log(e.name === 'AbortError' ? '已停止' : `出错：${e.message}`, e.name !== 'AbortError');
    } finally {
      await detach(tab.id);
      this.controller = null;
      this.onState(false);
    }
  }
}
