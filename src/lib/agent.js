// 调用本机智能体（claude / codex / hermes / 自定义），由 host 负责落盘图片、替换占位符并执行命令。
import { callHost } from './native.js';
import { blobToBase64 } from './image.js';

export async function runAgent(settings, prompt, imageBlob, { signal } = {}) {
  const agent = settings.agents[settings.agent];
  if (!agent?.command) throw new Error(`智能体「${settings.agent}」未配置命令`);
  const res = await callHost(
    'runAgent',
    {
      agent: { command: agent.command, args: agent.args, stdin: agent.stdin },
      prompt,
      image: imageBlob ? await blobToBase64(imageBlob) : null,
      timeoutSec: settings.agentTimeoutSec,
    },
    { signal }
  );
  return res.text;
}

// 去掉智能体输出中可能包裹的 ```markdown 代码块与常见的客套前缀
export function cleanOcrOutput(text) {
  let t = String(text || '').trim();
  const fence = t.match(/^```(?:markdown|md|text)?\s*\n([\s\S]*?)\n```\s*$/i);
  if (fence) t = fence[1].trim();
  t = t.replace(/^(以下是|下面是|识别结果|Here is|Here's)[^\n]*[:：]\s*\n/i, '');
  return t.trim();
}

export async function ocrImage(settings, blob, opts) {
  return cleanOcrOutput(await runAgent(settings, settings.ocrPrompt, blob, opts));
}

// 从输出中解析第一个 JSON 对象
export function parseJsonLoose(text) {
  const s = String(text || '');
  for (let i = s.indexOf('{'); i !== -1; i = s.indexOf('{', i + 1)) {
    let depth = 0;
    for (let j = i; j < s.length; j++) {
      if (s[j] === '{') depth++;
      else if (s[j] === '}' && --depth === 0) {
        try {
          return JSON.parse(s.slice(i, j + 1));
        } catch {
          break;
        }
      }
    }
  }
  return null;
}

export function formatCandidates(candidates) {
  return candidates
    .map((c) => {
      const label = [c.text, c.label && c.label !== c.text ? `aria:${c.label}` : '', c.rel ? `rel=${c.rel}` : '']
        .filter(Boolean)
        .join(' ');
      const r = c.rect;
      return `[${c.id}] <${c.tag}> "${label}" @ (${r.x},${r.y},${r.w},${r.h})${c.inView === false ? ' [视口外，需滚动]' : ''}`;
    })
    .join('\n');
}

// 让智能体判断下一页按钮。返回 {id} | {x,y} | null
export async function askNextButton(settings, viewportBlob, info, opts) {
  const prompt = settings.nextPrompt
    .replaceAll('{viewport}', `${info.viewport.w}x${info.viewport.h}`)
    .replaceAll('{scale}', String(info.dpr))
    .replaceAll('{candidates}', formatCandidates(info.candidates) || '（无）');
  const out = await runAgent(settings, prompt, viewportBlob, opts);
  const json = parseJsonLoose(out);
  if (!json) throw new Error('智能体未返回有效 JSON：' + String(out).slice(0, 200));
  if (typeof json.id === 'number') return { id: json.id };
  if (typeof json.x === 'number' && typeof json.y === 'number') return { x: json.x, y: json.y };
  return null;
}
