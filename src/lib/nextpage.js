// 自动翻页：规则匹配 → 智能体判断（截图 + 候选元素列表）→ 点击 → 等待页面变化。
// 一旦智能体选中了某个按钮，会记住它的特征，后续页面直接复用，不再重复询问智能体。
import { exec, captureViewportBlob } from './capture.js';
import {
  pageCandidates,
  pageClickCandidate,
  pageClickSelector,
  pageElementCenter,
  pageRevealCandidate,
  pageSignature,
} from './inject.js';
import { askNextButton } from './agent.js';
import { imageFingerprint } from './image.js';
import { trustedClick, pressKey } from './cdp.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sameSig = (a, b) => a && b && a.url === b.url && a.hash === b.hash && a.len === b.len;

function fpDiff(a, b) {
  if (!a || !b || a.length !== b.length) return 1;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d / a.length;
}

export class NextPager {
  constructor(tab, settings, { log = () => {}, signal } = {}) {
    this.tab = tab;
    this.settings = settings;
    this.log = log;
    this.signal = signal;
    this.learned = null;
    this.trustedOnly = false;
  }

  async safeSig() {
    try {
      return await exec(this.tab.id, pageSignature);
    } catch {
      return null; // 页面正在跳转
    }
  }

  async fingerprint() {
    try {
      return await imageFingerprint(await captureViewportBlob(this.tab.windowId));
    } catch {
      return null;
    }
  }

  // 等待页面内容变化（URL / 文本 / 视觉指纹任一变化即认为翻页成功）
  async waitChange(beforeSig, beforeFp) {
    const deadline = Date.now() + this.settings.pageChangeTimeoutMs;
    let changed = false;
    let lastFpCheck = Date.now();
    while (Date.now() < deadline) {
      if (this.signal?.aborted) throw new DOMException('已取消', 'AbortError');
      await sleep(400);
      const sig = await this.safeSig();
      if (sig && !sameSig(sig, beforeSig) && sig.ready !== 'loading') {
        changed = true;
        break;
      }
      // canvas 渲染的阅读器（如微信读书）翻页时 DOM 文本不变，定期比对视口画面
      if (beforeFp && Date.now() - lastFpCheck > 1200) {
        lastFpCheck = Date.now();
        if (fpDiff(await this.fingerprint(), beforeFp) > 0.05) {
          changed = true;
          break;
        }
      }
    }
    if (!changed && beforeFp && Date.now() - lastFpCheck > 300) {
      const fp = await this.fingerprint();
      changed = fpDiff(fp, beforeFp) > 0.05;
    }
    if (changed) {
      await this.waitTabComplete();
      await sleep(this.settings.settleMs);
    }
    return changed;
  }

  async waitTabComplete() {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const t = await chrome.tabs.get(this.tab.id);
      if (t.status === 'complete') return;
      await sleep(300);
    }
  }

  matchLearned(candidates) {
    if (!this.learned) return null;
    const L = this.learned;
    return (
      candidates.find((c) => c.tag === L.tag && c.text === L.text && c.label === L.label) ||
      candidates.find((c) => c.text && c.text === L.text) ||
      null
    );
  }

  // 执行一次翻页，返回 true 表示进入了新页面，false 表示已到末页 / 无法翻页
  // forceTrusted：跳过合成 click，直接用可信鼠标事件（用于"翻页后内容未变"的重试）
  async next({ forceTrusted = false } = {}) {
    const s = this.settings;
    const beforeSig = await this.safeSig();
    const beforeFp = await this.fingerprint();

    if (s.nextStrategy === 'key') {
      this.log(`按键翻页：${s.nextKey}`);
      await pressKey(this.tab.id, s.nextKey);
      return this.waitChange(beforeSig, beforeFp);
    }

    if (s.nextStrategy === 'selector') {
      const ok = await exec(this.tab.id, pageClickSelector, [s.nextSelector]);
      if (!ok) {
        this.log(`未找到选择器 ${s.nextSelector}，结束`);
        return false;
      }
      return this.waitChange(beforeSig, beforeFp);
    }

    const info = await exec(this.tab.id, pageCandidates);
    let choice = null;
    let cand = this.matchLearned(info.candidates);
    if (cand) {
      choice = { id: cand.id };
      this.log(`复用已识别的下一页按钮「${cand.text || cand.label}」`);
    }
    if (!choice && s.nextStrategy === 'auto') {
      const best = [...info.candidates].sort((a, b) => b.score - a.score)[0];
      if (best && best.score >= 6) {
        choice = { id: best.id };
        cand = best;
        this.log(`规则识别下一页按钮「${best.text || best.label}」`);
      } else if (info.linkNext) {
        this.log(`使用 <link rel=next>：${info.linkNext}`);
        await chrome.tabs.update(this.tab.id, { url: info.linkNext });
        return this.waitChange(beforeSig, null);
      }
    }
    if (!choice) {
      this.log('请求智能体判断下一页按钮位置…');
      const shot = await captureViewportBlob(this.tab.windowId);
      choice = await askNextButton(s, shot, info, { signal: this.signal });
      if (!choice) {
        this.log('智能体判断：没有下一页');
        return false;
      }
      if ('id' in choice) {
        cand = info.candidates.find((c) => c.id === choice.id);
        if (!cand) throw new Error(`智能体返回的编号 ${choice.id} 不存在`);
        this.log(`智能体选择「${cand.text || cand.label}」`);
      } else {
        this.log(`智能体给出坐标 (${choice.x}, ${choice.y})`);
      }
    }

    if ('id' in choice) {
      // 先把按钮滚动到视口内并等待稳定，再记录"翻页前"状态；
      // 否则滚动本身造成的画面变化会被误判为翻页成功
      await exec(this.tab.id, pageRevealCandidate, [choice.id]);
      await sleep(400);
      const sig0 = await this.safeSig();
      const fp0 = await this.fingerprint();
      const learned = { tag: cand.tag, text: cand.text, label: cand.label };

      if (!this.trustedOnly && !forceTrusted) {
        await exec(this.tab.id, pageClickCandidate, [choice.id]);
        if (await this.waitChange(sig0, fp0)) {
          this.learned = learned;
          return true;
        }
        // 合成 click 无效：本次运行之后都直接使用可信鼠标事件
        this.log('普通点击无效，改用模拟真实鼠标点击');
        this.trustedOnly = true;
      }
      const pt = await exec(this.tab.id, pageElementCenter, [choice.id]);
      if (pt) {
        await trustedClick(this.tab.id, pt.x, pt.y);
        if (await this.waitChange(sig0, fp0)) {
          this.learned = learned;
          return true;
        }
      }
      this.learned = null;
      return false;
    }
    await trustedClick(this.tab.id, choice.x, choice.y);
    return this.waitChange(beforeSig, beforeFp);
  }
}
