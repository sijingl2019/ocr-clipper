// 把各页 OCR 结果整理成"书"：跨页断句合并、按标题 / 按页划分章节。纯函数，便于测试。

const END_PUNCT = /[。！？!?.…：:；;」』”"’）)\]】》>—~]$/;
const CJK = /[　-〿㐀-鿿豈-﫿＀-￯]/;

// 判断上一页末行与下一页首行是否属于同一段落（被翻页截断）
export function shouldJoin(prevText, nextText) {
  const a = prevText.trimEnd().split('\n').at(-1) || '';
  const b = nextText.trimStart().split('\n')[0] || '';
  if (!a || !b) return false;
  const structural = /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||```)/;
  if (structural.test(a) || structural.test(b)) return false;
  return !END_PUNCT.test(a.trim());
}

function joinPair(a, b) {
  const x = a.trimEnd();
  const y = b.trimStart();
  return CJK.test(x.at(-1)) || CJK.test(y[0]) ? x + y : `${x} ${y}`;
}

// pages: [{ text, images?: any[] }]
// 返回 { md, images }：md 中用独占一行的 @@IMG:n@@ 标记图片位置
export function combinePages(pages, { mergeAcrossPages = true, includeImages = false } = {}) {
  let md = '';
  const images = [];
  let lastHeading = '';
  for (const p of pages) {
    let text = (p.text || '').trim();
    // 阅读器每页顶部重复的页眉（如"第一章"）会被识别成标题：与上一个标题相同则去掉
    const lead = text.match(/^#{1,6}\s+(.+?)\s*(?:\n|$)/);
    if (lead && lead[1] === lastHeading) text = text.slice(lead[0].length).trim();
    const headings = [...text.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)];
    if (headings.length) lastHeading = headings.at(-1)[1];
    if (includeImages && p.images?.length) {
      const marks = p.images.map((img) => `@@IMG:${images.push(img) - 1}@@`).join('\n\n');
      md += (md ? '\n\n' : '') + marks;
    }
    if (!text) continue;
    if (!md) md = text;
    else if (mergeAcrossPages && !includeImages && shouldJoin(md, text)) md = joinPair(md, text);
    else md += '\n\n' + text;
  }
  return { md, images };
}

// 把合并后的 markdown 按标题切成章节
export function splitChapters(md, { mode = 'heading', pageTexts = [], fallbackTitle = '正文' } = {}) {
  if (mode === 'single') return [{ title: fallbackTitle, md }];
  if (mode === 'page') {
    return pageTexts.map((t, i) => ({ title: firstHeading(t) || `第 ${i + 1} 页`, md: t }));
  }
  const lines = md.split('\n');
  const level = lines.some((l) => /^#\s/.test(l)) ? 1 : lines.some((l) => /^##\s/.test(l)) ? 2 : 0;
  if (!level) return [{ title: fallbackTitle, md }];
  const re = new RegExp(`^#{${level}}\\s+(.*)$`);
  const chapters = [];
  let cur = null;
  let inFence = false;
  for (const l of lines) {
    if (/^```/.test(l)) inFence = !inFence;
    const m = !inFence && l.match(re);
    if (m) {
      cur = { title: m[1].replace(/#+\s*$/, '').trim() || fallbackTitle, lines: [l] };
      chapters.push(cur);
    } else {
      if (!cur) {
        if (!l.trim()) continue;
        cur = { title: '前言', lines: [] };
        chapters.push(cur);
      }
      cur.lines.push(l);
    }
  }
  return chapters.map((c) => ({ title: c.title, md: c.lines.join('\n').trim() }));
}

export function firstHeading(md) {
  return (String(md).match(/^#{1,6}\s+(.+)$/m) || [])[1]?.trim() || '';
}
