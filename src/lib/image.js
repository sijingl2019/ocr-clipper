// 图像工具：base64 / Blob 转换，以及把滚动截取的帧流式拼接并切成适合 OCR 的切片。

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export function base64ToBlob(b64, type = 'image/png') {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

export async function dataUrlToBitmap(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  return createImageBitmap(blob);
}

// 找出 strip 中"最安静"（水平方向边缘能量最低）的一行，适合作为切割线，避免把文字拦腰切断。
// 能量相同时优先靠下的行（更接近目标切割位置）。
export function quietestRow(imageData) {
  const { width, height, data } = imageData;
  const step = Math.max(1, Math.floor(width / 400)) * 4;
  let best = height - 1;
  let bestScore = Infinity;
  for (let y = height - 1; y >= 0; y--) {
    const row = y * width * 4;
    let score = 0;
    let prev = data[row] + data[row + 1] + data[row + 2];
    for (let x = step; x < width * 4; x += step) {
      const v = data[row + x] + data[row + x + 1] + data[row + x + 2];
      score += Math.abs(v - prev);
      prev = v;
    }
    if (score < bestScore) {
      bestScore = score;
      best = y;
      if (score === 0) break;
    }
  }
  return best;
}

// 流式拼接：add() 加入已裁剪好的帧（ImageBitmap）及其在长图中的 y 坐标；
// 每当累计高度足够，就切出一张切片，并释放已不再需要的帧，避免超长页面占用过多内存。
export class Stitcher {
  constructor(width, sliceHeight) {
    this.width = width;
    this.sliceHeight = Math.max(400, sliceHeight);
    this.frames = [];
    this.emittedY = 0;
    this.slices = [];
  }

  add(bitmap, destY) {
    this.frames.push({ bitmap, y: Math.round(destY), h: bitmap.height });
  }

  get covered() {
    return this.frames.reduce((m, f) => Math.max(m, f.y + f.h), this.emittedY);
  }

  render(y0, h) {
    const canvas = new OffscreenCanvas(this.width, Math.max(1, h));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const f of this.frames) {
      if (f.y + f.h <= y0 || f.y >= y0 + h) continue;
      ctx.drawImage(f.bitmap, 0, f.y - y0);
    }
    return canvas;
  }

  async flush(final = false) {
    for (;;) {
      const covered = this.covered;
      const target = this.emittedY + this.sliceHeight;
      if (this.emittedY >= covered) break;
      let cut;
      if (target >= covered) {
        if (!final) break;
        cut = covered;
      } else {
        const win = Math.round(this.sliceHeight * 0.2);
        const strip = this.render(target - win, win);
        const r = quietestRow(strip.getContext('2d').getImageData(0, 0, strip.width, strip.height));
        cut = target - win + r;
        if (cut <= this.emittedY + this.sliceHeight / 2) cut = target;
      }
      const canvas = this.render(this.emittedY, cut - this.emittedY);
      this.slices.push(await canvas.convertToBlob({ type: 'image/png' }));
      this.emittedY = cut;
      this.frames = this.frames.filter((f) => {
        if (f.y + f.h <= this.emittedY) {
          f.bitmap.close?.();
          return false;
        }
        return true;
      });
    }
    return this.slices;
  }
}

// 生成小缩略图（dataURL），用于结果列表展示
export async function makeThumb(blob, maxW = 160) {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, maxW / bmp.width);
  const h = Math.min(Math.round(bmp.height * scale), 240);
  const c = new OffscreenCanvas(Math.round(bmp.width * scale), h);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, Math.round(bmp.height * scale));
  bmp.close();
  const out = await c.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(out);
  });
}

// 计算图片内容指纹（缩小到 32x32 灰度），用于检测翻页后内容是否真的变化
export async function imageFingerprint(blob) {
  const bmp = await createImageBitmap(blob);
  const c = new OffscreenCanvas(32, 32);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, 32, 32);
  bmp.close();
  const d = ctx.getImageData(0, 0, 32, 32).data;
  let s = '';
  for (let i = 0; i < d.length; i += 4) s += ((d[i] + d[i + 1] + d[i + 2]) / 48) | 0;
  return s;
}

// 画面几乎是纯色（空白 / 只有一个转圈）
export function fpBlank(fp) {
  if (!fp) return true;
  const n = {};
  for (const c of fp) n[c] = (n[c] || 0) + 1;
  return Math.max(...Object.values(n)) / fp.length > 0.97;
}
