// 精简的 Markdown → (X)HTML 转换器，覆盖 OCR 输出常见语法：
// 标题、段落、列表、引用、表格、代码块、分隔线、粗体、斜体、行内代码。输出为合法 XHTML（EPUB 要求）。

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(s) {
  const codes = [];
  let t = escapeHtml(s).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  t = t
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
}

const CJK = /[　-〿㐀-鿿豈-﫿＀-￯]/;

// 段落内的软换行：中日韩文字之间直接相连，西文之间补一个空格
export function joinSoftLines(lines) {
  let s = '';
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    if (!s) s = l;
    else s += CJK.test(s.at(-1)) || CJK.test(l[0]) ? l : ' ' + l;
  }
  return s;
}

const isTableSep =(l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const splitRow = (l) =>
  l
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

export function markdownToHtml(md) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    let m;
    if ((m = line.match(/^```/))) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }
    if ((m = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))) {
      const n = m[1].length;
      out.push(`<h${n}>${inline(m[2])}</h${n}>`);
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push('<hr/>');
      i++;
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]));
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>` +
          rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('') +
          '</tbody></table>'
      );
      continue;
    }
    if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${markdownToHtml(buf.join('\n'))}</blockquote>`);
      continue;
    }
    if ((m = line.match(/^\s*([-*+]|\d+[.)])\s+/))) {
      const ordered = /\d/.test(m[1]);
      const re = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
      const items = [];
      while (i < lines.length && re.test(lines[i])) items.push(lines[i++].match(re)[1]);
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${tag}>`);
      continue;
    }
    const buf = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6}\s|```|\s*>|\s*([-*+]|\d+[.)])\s+)/.test(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]))
    )
      buf.push(lines[i++]);
    out.push(`<p>${inline(joinSoftLines(buf))}</p>`);
  }
  return out.join('\n');
}

// Markdown → 纯文本
export function markdownToText(md) {
  return String(md || '')
    .replace(/\r\n?/g, '\n')
    .replace(/^```.*$/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*\|?\s*:?-{2,}[-|:\s]*$/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
