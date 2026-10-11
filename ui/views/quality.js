// SLO (error budget) and quality gate panels, shown on the Overview and in the report.
import { escapeHtml } from '../format.js';
import { icon } from '../icons.js';
import { meter, fmtPct } from '../analysis.js';

export function sloPanel(slo, gate = null) {
  if (!slo || !slo.executed) return '';
  const tone = slo.remaining == null ? 'muted' : slo.remaining > 0.5 ? 'good' : slo.remaining > 0 ? 'warn' : 'bad';
  const burn = slo.burnRate == null ? '' : slo.burnRate > 1 ? `<span class="tone-bad delta">đốt ×${escapeHtml(slo.burnRate.toFixed(1))}: hết budget trước khi hết kỳ</span>` : `<span class="muted small">tốc độ đốt ×${escapeHtml(slo.burnRate.toFixed(1))}</span>`;
  const g = gate
    ? `<div class="gate tone-${gate.pass ? 'good' : 'bad'}"><strong>${icon(gate.pass ? 'check' : 'x', { size: 15 })} Cổng chất lượng: ${gate.pass ? 'PASS' : 'FAIL'}</strong>
        <ul>${gate.checks.map((c) => `<li class="tone-${c.pass ? 'good' : 'bad'}">${icon(c.pass ? 'check' : 'x', { size: 12 })} ${escapeHtml(c.detail)}${c.tests?.length ? `: ${escapeHtml(c.tests.slice(0, 3).join('; '))}` : ''}</li>`).join('')}</ul>
        <p class="muted small">Dùng trong CI / trước khi push: <code>/e2e-dashboard gate</code> (trả mã lỗi khi FAIL).</p></div>`
    : '';
  return `<section class="panel slo tone-${tone}"><div><h2>${icon('gauge', { size: 15 })} SLO: pass rate ≥ ${escapeHtml(fmtPct(slo.target))} trong ${escapeHtml(slo.days)} ngày</h2>
      <p>Thực tế <strong>${escapeHtml(fmtPct(slo.actual))}</strong> · ${escapeHtml(slo.failed)}/${escapeHtml(slo.executed)} kết quả fail · budget cho phép ${escapeHtml(slo.allowedFailures)} lần fail</p>
      <div>Budget còn lại ${meter(slo.remaining ?? 0, tone, fmtPct(slo.remaining))} ${burn}</div>
      <p class="muted small">Đổi mục tiêu: <code>"slo": { "passRate": 0.98, "days": 14 }</code> trong config.</p></div>${g}</section>`;
}
