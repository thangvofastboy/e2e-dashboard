import { getJson } from '../api.js';
import { flattenResults } from '../model.js';
import { artifactsOf, mediaSrc } from './run.js';
import { visualCompareHtml, attachVisualCompare, screenshotTriplets } from '../visual.js';
import { pageHead, fmtPoints, fmtSignedMs, fmtUsd } from '../analysis.js';
import { escapeHtml, fmtDuration, fmtTokens, statusBadge } from '../format.js';
import { runHref, compareHref } from '../router.js';
import { icon } from '../icons.js';

export const CHANGES = {
  regressed: { label: 'Mới fail', tone: 'bad', icon: 'x' },
  'still-failing': { label: 'Vẫn fail', tone: 'bad', icon: 'alert' },
  'became-flaky': { label: 'Thành flaky', tone: 'warn', icon: 'shuffle' },
  fixed: { label: 'Đã sửa', tone: 'good', icon: 'check' },
  added: { label: 'Test mới', tone: 'info', icon: 'info' },
  removed: { label: 'Bị bỏ', tone: 'muted', icon: 'ban' },
  skipped: { label: 'Skip thay đổi', tone: 'muted', icon: 'skip' },
  unchanged: { label: 'Không đổi', tone: 'muted', icon: 'check' },
};

const shortRun = (m) => `${new Date(m.startedAt).toLocaleString('vi-VN')}${m.git?.branch ? ` · ${m.git.branch}@${String(m.git.commit ?? '').slice(0, 7)}` : ''}`;

// Screenshots of one result in one run: the failure screenshot first.
function shotsOf(runData, resultId) {
  const r = runData && flattenResults(runData.report).find((x) => x.id === resultId);
  const a = r?.attempts.at(-1);
  if (!a) return [];
  const { screenshots } = artifactsOf(a);
  const fail = a.failure?.screen;
  return [...screenshots].sort((x, y) => (y.id === fail) - (x.id === fail)).map((s) => ({ ...s, src: mediaSrc(runData.meta.runId, s) })).filter((s) => s.src);
}

function visualFor(row, A, B) {
  const left = row.a && shotsOf(A, row.a.resultId);
  const right = row.b && shotsOf(B, row.b.resultId);
  const parts = [];
  const triplets = right ? screenshotTriplets(right) : [];
  for (const t of triplets) parts.push(visualCompareHtml({ left: t.expected.src, right: t.actual.src, diff: t.diff?.src ?? null, leftLabel: 'Ảnh mẫu (expected)', rightLabel: 'Thực tế (actual)', title: `toHaveScreenshot · ${t.name}` }));
  if (left?.length && right?.length) parts.push(visualCompareHtml({ left: left[0].src, right: right[0].src, leftLabel: 'Run A', rightLabel: 'Run B', title: 'Screenshot giữa 2 run' }));
  return parts.join('');
}

function deltaCell(v, fmt, betterWhenLower = true) {
  if (v == null || v === 0) return `<span class="muted">${v === 0 ? '±0' : '—'}</span>`;
  const good = betterWhenLower ? v < 0 : v > 0;
  return `<span class="tone-${good ? 'good' : 'bad'} delta">${icon(v > 0 ? 'up' : 'down', { size: 13 })}${escapeHtml(fmt(v))}</span>`;
}

export function compareRowHtml(r) {
  const ch = CHANGES[r.change];
  const err = r.b?.error ?? r.a?.error;
  return `<tr data-row="${escapeHtml(r.key)}|${escapeHtml(r.repeat)}">
    <td><span class="chip tone-${ch.tone}">${icon(ch.icon, { size: 12 })}${ch.label}</span></td>
    <td><strong>${escapeHtml(r.title)}</strong><div class="muted small">${escapeHtml(r.target)}${r.agent !== 'default' ? ` · ${escapeHtml(r.agent)}` : ''}${err && r.change !== 'fixed' ? ` · <code>${escapeHtml(err.code ?? '')}</code> ${escapeHtml(err.message)}` : ''}</div></td>
    <td>${r.a ? `<a href="${runHref(r._aRun, r.a.resultId)}">${statusBadge(r.a.status)}</a>` : '<span class="muted">—</span>'}</td>
    <td>${r.b ? `<a href="${runHref(r._bRun, r.b.resultId)}">${statusBadge(r.b.status)}</a>` : '<span class="muted">—</span>'}</td>
    <td class="num">${r.a ? fmtDuration(r.a.durationMs) : '—'} → ${r.b ? fmtDuration(r.b.durationMs) : '—'}</td>
    <td class="num">${deltaCell(r.durationDelta, (v) => fmtSignedMs(v, fmtDuration))}</td>
    <td><button type="button" class="icon-btn" data-visual-row aria-label="Xem ảnh">${icon('image', { size: 15 })}</button></td>
  </tr>`;
}

export async function renderCompare(main, route) {
  const [cmp, A, B, metas] = await Promise.all([
    getJson(`/api/compare?a=${encodeURIComponent(route.a)}&b=${encodeURIComponent(route.b)}`),
    getJson(`/api/runs/${encodeURIComponent(route.a)}`).catch(() => null),
    getJson(`/api/runs/${encodeURIComponent(route.b)}`).catch(() => null),
    getJson('/api/runs').catch(() => []),
  ]);
  let show = 'changed';
  const pick = (id, name) => `<select data-pick="${name}">${metas.map((m) => `<option value="${escapeHtml(m.runId)}" ${m.runId === id ? 'selected' : ''}>${escapeHtml(shortRun(m))} · ${escapeHtml(m.status)}</option>`).join('')}</select>`;
  const draw = () => {
    const rows = cmp.rows.map((r) => ({ ...r, _aRun: cmp.base.runId, _bRun: cmp.head.runId })).filter((r) => show === 'all' || r.change !== 'unchanged');
    const chips = Object.entries(cmp.counts).filter(([, n]) => n).map(([k, n]) => `<span class="chip tone-${CHANGES[k].tone}">${icon(CHANGES[k].icon, { size: 12 })}${CHANGES[k].label}: ${n}</span>`).join(' ');
    const d = cmp.deltas;
    main.innerHTML = `${pageHead('So sánh 2 run', 'columns', 'A là run gốc (cũ hơn), B là run cần xem.', `<button type="button" data-swap>${icon('shuffle', { size: 14 })}Đổi A ↔ B</button>`)}
      <section class="cmp-head">
        <div class="panel"><div class="muted small">Run A</div>${pick(cmp.base.runId, 'a')}<div><a href="${runHref(cmp.base.runId)}">${statusBadge(cmp.base.status)}</a> ${fmtDuration(cmp.base.durationMs)}</div></div>
        <div class="panel"><div class="muted small">Run B</div>${pick(cmp.head.runId, 'b')}<div><a href="${runHref(cmp.head.runId)}">${statusBadge(cmp.head.status)}</a> ${fmtDuration(cmp.head.durationMs)}</div></div>
        <div class="panel cmp-deltas"><div><span class="muted">Pass rate</span> ${deltaCell(d.passRate, fmtPoints, false)}</div><div><span class="muted">Thời gian</span> ${deltaCell(d.durationMs, (v) => fmtSignedMs(v, fmtDuration))}</div><div><span class="muted">Token</span> ${deltaCell(d.tokens, (v) => `${v > 0 ? '+' : '−'}${fmtTokens(Math.abs(v))}`)}</div>${d.costUsd != null ? `<div><span class="muted">Chi phí</span> ${deltaCell(d.costUsd, (v) => `${v > 0 ? '+' : '−'}${fmtUsd(Math.abs(v))}`)}</div>` : ''}</div>
      </section>
      <div class="filters">${chips}<label class="pill"><input type="checkbox" data-show-all ${show === 'all' ? 'checked' : ''}> Hiện cả test không đổi</label></div>
      ${rows.length ? `<table class="table cmp"><thead><tr><th>Thay đổi</th><th>Test</th><th>A</th><th>B</th><th class="num">Thời gian</th><th class="num">Δ</th><th></th></tr></thead><tbody>${rows.map(compareRowHtml).join('')}</tbody></table>` : '<p class="muted">Hai run giống nhau.</p>'}`;
    main.querySelector('[data-show-all]').addEventListener('change', (e) => {
      show = e.target.checked ? 'all' : 'changed';
      draw();
    });
    main.querySelector('[data-swap]').addEventListener('click', () => (location.hash = compareHref(cmp.head.runId, cmp.base.runId)));
    main.querySelectorAll('[data-pick]').forEach((s) =>
      s.addEventListener('change', () => {
        const a = main.querySelector('[data-pick="a"]').value;
        const b = main.querySelector('[data-pick="b"]').value;
        location.hash = compareHref(a, b);
      }));
    main.querySelectorAll('[data-visual-row]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const tr = btn.closest('tr');
        if (tr.nextElementSibling?.classList.contains('visual-row')) return tr.nextElementSibling.remove();
        const [key, repeat] = [tr.dataset.row.slice(0, tr.dataset.row.lastIndexOf('|')), tr.dataset.row.split('|').pop()];
        const row = cmp.rows.find((r) => r.key === key && String(r.repeat) === repeat);
        const html = visualFor(row, A, B) || '<p class="muted">Không có screenshot để so (artifact chỉ được lưu cho test không pass, hoặc mọi screenshot khi bật <code>"screenshots": "all"</code> trong config).</p>';
        tr.insertAdjacentHTML('afterend', `<tr class="visual-row"><td colspan="7">${html}</td></tr>`);
        attachVisualCompare(tr.nextElementSibling);
      }));
  };
  draw();
}
