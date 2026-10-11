import { getJson } from '../api.js';
import { runCountPicker, analysisCount, pageHead, emptyBox, meter, fmtUsd, toneFor } from '../analysis.js';
import { escapeHtml, fmtDuration, fmtTokens } from '../format.js';
import { icon } from '../icons.js';

export function modelRowHtml(m) {
  return `<tr><td><strong>${escapeHtml(m.model)}</strong> <span class="muted small">${escapeHtml(m.provider ?? '')}</span><div class="muted small">${m.apis.slice(0, 3).map((a) => `${escapeHtml(a.api)} ×${escapeHtml(a.steps)}`).join(' · ')}</div></td>
    <td class="num">${escapeHtml(m.steps)}</td><td>${meter(m.passRate, toneFor(m.passRate))}</td>
    <td class="num">${fmtTokens(m.tokensPerStep)}</td><td class="num">${fmtDuration(m.avgDurationMs)}</td>
    <td class="num">${m.costPerStep == null ? '—' : escapeHtml(fmtUsd(m.costPerStep))}</td><td class="num">${m.costUsd == null ? '—' : escapeHtml(fmtUsd(m.costUsd))}</td>
    <td class="num">${m.cacheShare == null ? '—' : `${Math.round(m.cacheShare * 100)}%`}</td></tr>`;
}

export async function renderModels(main) {
  const picker = runCountPicker(() => renderModels(main));
  const d = await getJson(`/api/models?n=${analysisCount()}`);
  const head = pageHead('Model & ngân sách', 'cpu', 'So sánh các model agent đã dùng (từ <code>step.model</code> của report): tỉ lệ step pass, token, thời gian, chi phí mỗi step. Ngân sách theo model: <code>"budget": { "perModel": { "anthropic/claude-sonnet-4.5": 5 } }</code> (USD trong các run đã chọn).', picker.html);
  const over = d.over.map((o) => `<div class="banner tone-bad">${icon('alert', { size: 15 })}${escapeHtml(o.id)} đã tốn ${escapeHtml(fmtUsd(o.cost))}, vượt ngân sách ${escapeHtml(fmtUsd(o.limit))}.</div>`).join('');
  const hints = d.hints.map((h) => `<div class="banner tone-info">${icon('bulb', { size: 15 })}${escapeHtml(h)}</div>`).join('');
  main.innerHTML = d.models.length
    ? `${head}${over}${hints}<table class="table"><thead><tr><th>Model</th><th class="num">Step</th><th>Step pass</th><th class="num">Token / step</th><th class="num">TG / step</th><th class="num">$ / step</th><th class="num">Tổng $</th><th class="num">Prompt cache</th></tr></thead><tbody>${d.models.map(modelRowHtml).join('')}</tbody></table>`
    : `${head}${emptyBox('Chưa có dữ liệu model', 'Report của các run đã chọn không có step.model (cần e2e có ghi model cho step agent).')}`;
  picker.bind(main);
}
