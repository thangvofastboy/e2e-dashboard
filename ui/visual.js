// Visual diff of two screenshots (M2): side by side, a slider over both, or the changed pixels in red,
// computed in the browser with a canvas (no library, works in the export too: images are data: URLs).
import { escapeHtml } from './format.js';
import { icon } from './icons.js';

// RGBA buffers of the same size → changed-pixel mask drawn over a faded copy of `a`.
export function pixelDiff(a, b, width, height, { threshold = 40 } = {}) {
  const out = new Uint8ClampedArray(width * height * 4);
  let changed = 0;
  for (let i = 0; i < width * height * 4; i += 4) {
    const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) + Math.abs(a[i + 3] - b[i + 3]);
    if (d > threshold) {
      changed++;
      out[i] = 230;
      out[i + 1] = 30;
      out[i + 2] = 50;
      out[i + 3] = 255;
    } else {
      const g = Math.round((a[i] * 0.3 + a[i + 1] * 0.59 + a[i + 2] * 0.11) * 0.35 + 165); // faded grey: context only
      out[i] = g;
      out[i + 1] = g;
      out[i + 2] = g;
      out[i + 3] = 255;
    }
  }
  return { data: out, changed, total: width * height };
}

// e2e's toHaveScreenshot writes <name>-expected / -actual / -diff images next to each other.
export function screenshotTriplets(shots) {
  const by = new Map();
  for (const s of shots) {
    const m = /^(.*)-(expected|actual|diff)\.(png|jpe?g|webp)$/i.exec(s.path ?? '');
    if (!m) continue;
    if (!by.has(m[1])) by.set(m[1], { name: m[1].split('/').pop() });
    by.get(m[1])[m[2].toLowerCase()] = s;
  }
  return [...by.values()].filter((t) => t.expected && t.actual);
}

let visualSeq = 0;

export function visualCompareHtml({ left, right, diff = null, leftLabel = 'Trước', rightLabel = 'Sau', title = '' }) {
  if (!left || !right) return '';
  const id = `vc${++visualSeq}`;
  return `<div class="visual" id="${id}" data-visual data-left="${escapeHtml(left)}" data-right="${escapeHtml(right)}"${diff ? ` data-diff="${escapeHtml(diff)}"` : ''}>
    <div class="visual-bar">${title ? `<strong>${escapeHtml(title)}</strong>` : ''}
      <span class="seg-btns" role="group" aria-label="Kiểu so sánh">
        <button type="button" data-vmode="side" aria-pressed="true">${icon('columns', { size: 14 })}Cạnh nhau</button>
        <button type="button" data-vmode="slider" aria-pressed="false">${icon('arrow', { size: 14 })}Thanh trượt</button>
        <button type="button" data-vmode="diff" aria-pressed="false">${icon('eye', { size: 14 })}Khác biệt</button>
      </span><span class="muted small" data-vstat></span></div>
    <div class="visual-body" data-vbody>
      <figure><figcaption>${escapeHtml(leftLabel)}</figcaption><img src="${escapeHtml(left)}" alt="${escapeHtml(leftLabel)}" loading="lazy"></figure>
      <figure><figcaption>${escapeHtml(rightLabel)}</figcaption><img src="${escapeHtml(right)}" alt="${escapeHtml(rightLabel)}" loading="lazy"></figure>
    </div></div>`;
}

const loadImage = (src) => new Promise((ok, fail) => {
  const img = new Image();
  img.onload = () => ok(img);
  img.onerror = () => fail(new Error('không tải được ảnh'));
  img.src = src;
});

async function diffCanvas(left, right) {
  const [a, b] = await Promise.all([loadImage(left), loadImage(right)]);
  const w = Math.max(a.naturalWidth, b.naturalWidth);
  const h = Math.max(a.naturalHeight, b.naturalHeight);
  const pixels = (img) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, w, h).data;
  };
  const d = pixelDiff(pixels(a), pixels(b), w, h);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d').putImageData(new ImageData(d.data, w, h), 0, 0);
  return { canvas: out, changed: d.changed, total: d.total, sizeDiffers: a.naturalWidth !== b.naturalWidth || a.naturalHeight !== b.naturalHeight };
}

export function attachVisualCompare(root) {
  root.querySelectorAll('[data-visual]').forEach((box) => {
    const body = box.querySelector('[data-vbody]');
    const stat = box.querySelector('[data-vstat]');
    const { left, right, diff } = box.dataset;
    const side = body.innerHTML;
    box.querySelectorAll('[data-vmode]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        box.querySelectorAll('[data-vmode]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
        const mode = btn.dataset.vmode;
        if (mode === 'side') {
          body.className = 'visual-body';
          body.innerHTML = side;
          return;
        }
        if (mode === 'slider') {
          body.className = 'visual-body slider';
          body.innerHTML = `<div class="vs-stage"><img src="${escapeHtml(left)}" alt="trước"><div class="vs-top" style="width:50%"><img src="${escapeHtml(right)}" alt="sau"></div></div>
            <input type="range" min="0" max="100" value="50" aria-label="Vị trí thanh trượt">`;
          const top = body.querySelector('.vs-top');
          const stage = body.querySelector('.vs-stage');
          const fit = () => (top.firstElementChild.style.width = `${stage.clientWidth}px`);
          body.querySelector('img').addEventListener('load', fit);
          fit();
          body.querySelector('input').addEventListener('input', (e) => (top.style.width = `${e.target.value}%`));
          return;
        }
        body.className = 'visual-body diff';
        body.innerHTML = '<p class="muted">Đang so từng pixel…</p>';
        try {
          const r = await diffCanvas(left, right);
          body.innerHTML = '';
          body.append(r.canvas);
          stat.textContent = `${r.changed.toLocaleString('vi-VN')} pixel khác (${((r.changed / r.total) * 100).toFixed(2)}%)${r.sizeDiffers ? ' · kích thước ảnh khác nhau' : ''}`;
          if (diff) body.insertAdjacentHTML('beforeend', `<p class="muted small">Ảnh diff do e2e tạo: <a href="${escapeHtml(diff)}" target="_blank" rel="noopener">mở</a></p>`);
        } catch (e) {
          body.innerHTML = diff ? `<img src="${escapeHtml(diff)}" alt="diff">` : `<p class="error">${escapeHtml(e.message)}</p>`;
        }
      }));
  });
}
