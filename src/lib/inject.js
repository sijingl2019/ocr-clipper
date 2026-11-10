// 注入到目标网页中执行的函数。每个函数都必须自包含（chrome.scripting.executeScript 会序列化函数体）。

// 找到页面的主滚动容器：优先 window；若 window 不可滚动，则找可见面积最大的可滚动元素
// （很多在线阅读器把正文放在内部滚动的 div 里）。返回测量信息并给容器打上标记。
export function pageMeasure() {
  const vw = document.documentElement.clientWidth || innerWidth;
  const vh = innerHeight;
  const root = document.scrollingElement || document.documentElement;
  let el = null;
  if (root.scrollHeight - root.clientHeight < 8) {
    let bestArea = 0;
    for (const e of document.querySelectorAll('body *')) {
      if (e.scrollHeight - e.clientHeight < 40 || e.clientHeight < 100) continue;
      const oy = getComputedStyle(e).overflowY;
      if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') continue;
      const r = e.getBoundingClientRect();
      const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
      const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
      if (w * h > bestArea) {
        bestArea = w * h;
        el = e;
      }
    }
  }
  document.querySelectorAll('[data-ocrclipper-scroll]').forEach((e) => e.removeAttribute('data-ocrclipper-scroll'));
  let rect;
  if (el) {
    el.setAttribute('data-ocrclipper-scroll', '1');
    const r = el.getBoundingClientRect();
    const left = Math.max(0, r.left);
    const top = Math.max(0, r.top);
    rect = { x: left, y: top, w: Math.min(r.left + el.clientWidth, vw) - left, h: Math.min(r.top + el.clientHeight, vh) - top };
  } else {
    rect = { x: 0, y: 0, w: vw, h: vh };
  }
  const s = el || root;
  return {
    inner: !!el,
    rect,
    scrollTop: s.scrollTop,
    scrollHeight: s.scrollHeight,
    clientHeight: el ? el.clientHeight : vh,
    innerWidth,
    innerHeight,
    viewportWidth: vw,
    dpr: devicePixelRatio,
    screenX,
    screenY,
    outerWidth,
    outerHeight,
    url: location.href,
    title: document.title,
  };
}

export function pageScrollTo(y) {
  const el = document.querySelector('[data-ocrclipper-scroll]') || document.scrollingElement || document.documentElement;
  el.scrollTop = y;
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve({ top: el.scrollTop, height: el.scrollHeight })))
  );
}

// 隐藏 / 恢复 position: fixed / sticky 元素，避免滚动拼接时页眉重复出现
export function pageToggleFixed(hide) {
  if (hide) {
    for (const e of document.querySelectorAll('body *')) {
      const p = getComputedStyle(e).position;
      if ((p === 'fixed' || p === 'sticky') && !e.hasAttribute('data-ocrclipper-hidden')) {
        e.setAttribute('data-ocrclipper-hidden', e.style.visibility || '');
        e.style.visibility = 'hidden';
      }
    }
  } else {
    for (const e of document.querySelectorAll('[data-ocrclipper-hidden]')) {
      e.style.visibility = e.getAttribute('data-ocrclipper-hidden');
      e.removeAttribute('data-ocrclipper-hidden');
    }
  }
  return true;
}

// 页面内容签名：用于判断翻页是否生效
export function pageSignature() {
  const el = document.querySelector('[data-ocrclipper-scroll]') || document.body;
  const text = document.title + '\n' + (el?.innerText || '').slice(0, 20000);
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return { url: location.href, hash: h, len: text.length, ready: document.readyState };
}

// 视口内是否有可见的加载指示（转圈 / 骨架屏 / aria-busy）
export function pageBusy() {
  if (document.readyState === 'loading') return true;
  const sel = '[aria-busy="true"],[class*="loading" i],[class*="spinner" i],[class*="skeleton" i]';
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
    const s = getComputedStyle(el);
    if (s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0.05) return true;
  }
  return false;
}

// 收集视口内可见的可点击元素作为"下一页"候选，并给每个打上编号。
// 同时用规则计算一个启发式得分。
export function pageCandidates() {
  const NEXT_RE = /^(下一页|下一章|下一节|下页|后一页|下一篇|继续阅读|next( page| chapter)?|older posts?|›|»|→|>|>>|＞)$/i;
  const NEXT_LOOSE = /下一页|下一章|下一节|下页|next|›|»|→/i;
  const PREV_RE = /上一页|上一章|上页|前一页|prev|previous|‹|«|←/i;
  const vw = innerWidth;
  const vh = innerHeight;
  document.querySelectorAll('[data-ocrclipper-cand]').forEach((e) => e.removeAttribute('data-ocrclipper-cand'));
  const sel = 'a[href], button, [role=button], [role=link], input[type=button], input[type=submit], [onclick], [class*=next i], [id*=next i], [aria-label]';
  const seen = new Set();
  const out = [];
  for (const e of document.querySelectorAll(sel)) {
    if (seen.has(e) || out.length >= 150) continue;
    seen.add(e);
    const r = e.getBoundingClientRect();
    // 不限制纵向位置：滚动阅读模式下"下一章"常在页面底部、视口之外
    if (r.width < 4 || r.height < 4 || r.right < 0 || r.left > vw) continue;
    const cs = getComputedStyle(e);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
    const text = (e.innerText || e.value || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    const label = (e.getAttribute('aria-label') || e.getAttribute('title') || '').trim().slice(0, 40);
    const cls = `${e.className && typeof e.className === 'string' ? e.className : ''} ${e.id || ''}`;
    const rel = (e.getAttribute('rel') || '').toLowerCase();
    let score = 0;
    if (rel.split(/\s+/).includes('next')) score += 10;
    if (NEXT_RE.test(text) || NEXT_RE.test(label)) score += 8;
    else if (NEXT_LOOSE.test(text) || NEXT_LOOSE.test(label)) score += 4;
    if (/(^|[\s_-])next([\s_-]|$)|pagenext|next-?page|btn-?next/i.test(cls)) score += 3;
    if (PREV_RE.test(text) || PREV_RE.test(label) || /prev/i.test(cls)) score -= 10;
    if (e.disabled || e.getAttribute('aria-disabled') === 'true' || /disabled/i.test(cls)) score -= 20;
    if (!text && !label && score <= 0) continue;
    const id = out.length;
    e.setAttribute('data-ocrclipper-cand', String(id));
    out.push({
      id,
      tag: e.tagName.toLowerCase(),
      text,
      label,
      rel,
      cls: cls.trim().slice(0, 60),
      href: e.getAttribute('href') || '',
      score,
      inView: r.bottom > 0 && r.top < vh,
      rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    });
  }
  const linkNext = document.querySelector('link[rel=next]')?.href || '';
  return { candidates: out, linkNext, viewport: { w: vw, h: vh }, dpr: devicePixelRatio };
}

// 把候选按钮滚动到视口中（与点击分开，便于在滚动之后再记录"翻页前"的状态）
export function pageRevealCandidate(id) {
  const e = document.querySelector(`[data-ocrclipper-cand="${id}"]`);
  if (!e) return false;
  const r = e.getBoundingClientRect();
  if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) {
    e.scrollIntoView({ block: 'center', inline: 'center' });
  }
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))));
}

export function pageClickCandidate(id) {
  const e = document.querySelector(`[data-ocrclipper-cand="${id}"]`);
  if (!e) return false;
  e.click();
  return true;
}

export function pageClickSelector(selector) {
  const e = document.querySelector(selector);
  if (!e) return false;
  e.click();
  return true;
}

export function pageElementCenter(id) {
  const e = document.querySelector(`[data-ocrclipper-cand="${id}"]`);
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
