import { getJson, postJson } from '../api.js';
import { confirmDialog } from '../confirm.js';
import { pageHead } from '../analysis.js';
import { toast } from '../toast.js';
import { escapeHtml, cap } from '../format.js';
import { icon } from '../icons.js';
import { currentLang, setLang } from '../i18n.js';
import { replaceParams } from '../router.js';
import { fmtBytes } from './settings.js';
import { FONT_SCALES, storedTheme, setTheme, storedFont, setFont } from '../prefs.js';

const STATE = { set: ['good', 'check', 'Đã điền'], placeholder: ['warn', 'alert', 'Còn giá trị mẫu'], empty: ['bad', 'x', 'Trống'], missing: ['bad', 'x', 'Chưa có'] };
const chip = (state) => {
  const [tone, ic, label] = STATE[state];
  return `<span class="chip tone-${tone}">${icon(ic, { size: 12 })}${label}</span>`;
};
const seg = (name, options, current, label = name) =>
  `<div class="opt-group" role="radiogroup" aria-label="${escapeHtml(label)}">${options
    .map(([v, text]) => `<label class="opt"><input type="radio" name="${name}" value="${escapeHtml(v)}"${v === current ? ' checked' : ''}><span>${escapeHtml(text)}</span></label>`)
    .join('')}</div>`;

const sysStat = (label, value, tone = '', sub = '') => `<div class="sys-stat${tone ? ` tone-${tone}` : ''}"><span class="sys-stat-v">${value}</span><span class="sys-stat-l">${escapeHtml(label)}</span>${sub ? `<span class="sys-stat-s muted small">${sub}</span>` : ''}</div>`;
const sysStats = (...tiles) => `<div class="sys-stats">${tiles.join('')}</div>`;
// one setting: title + description on the left, the control on the right
const setRow = (title, desc, control) => `<div class="set-row"><div class="set-text"><strong>${title}</strong>${desc ? `<span class="muted small">${desc}</span>` : ''}</div><div class="set-ctl">${control}</div></div>`;

const SYS_TABS = [
  ['appearance', 'Giao diện', 'sun', 'Theme, cỡ chữ, ngôn ngữ'],
  ['project', 'Project', 'folder', 'Setup và file .env'],
  ['integrations', 'Tích hợp', 'bolt', 'Linear, webhook'],
  ['ai', 'AI & tự sửa lỗi', 'sparkles', 'Model, effort, PR tự động'],
  ['about', 'Hệ thống', 'cpu', 'Phiên bản, dữ liệu, SQLite'],
  ['reset', 'Dọn dẹp', 'recycle', 'Dọn rác, reset dữ liệu'],
];

function appearanceHtml() {
  return `<section class="panel"><h2>${icon('sun', { size: 18 })} Giao diện</h2>
    <p class="muted">Lưu trên trình duyệt này, không ảnh hưởng người khác.</p>
    ${setRow('Theme', 'Sáng, tối hoặc theo hệ điều hành', seg('theme', [['system', 'Theo hệ thống'], ['light', 'Sáng'], ['dark', 'Tối']], storedTheme() ?? 'system', 'Theme'))}
    ${setRow('Cỡ chữ', 'Áp dụng cho toàn bộ dashboard', seg('font', FONT_SCALES, storedFont(), 'Cỡ chữ'))}
    ${setRow('Ngôn ngữ', 'Giao diện tiếng Anh còn ở bản beta', seg('lang', [['vi', 'Tiếng Việt'], ['en', 'English']], currentLang(), 'Ngôn ngữ'))}
  </section>`;
}

function envHtml(env) {
  const files = env.files.map((f) => `<button type="button" class="env-tab" data-env-open="${escapeHtml(f.name)}"><span class="env-tab-name">${icon('file', { size: 18 })}${escapeHtml(f.name)}</span>
      <span class="muted small">${f.exists ? `${f.bytes} B` : 'Chưa có · Lưu sẽ tạo file'}</span>${f.tracked ? '<span class="chip tone-bad">Đang bị git track</span>' : f.ignored === false ? '<span class="chip tone-bad">Chưa gitignore</span>' : f.exists ? '<span class="chip tone-good">Đã gitignore</span>' : ''}</button>`).join('');
  const rows = env.keys.map((k) => `<tr><td><code>${escapeHtml(k.key)}</code></td><td>${chip(k.state)}</td><td class="muted small">${k.from ? escapeHtml(k.from) : '—'}${k.inExample ? '' : ' · không có trong .env.example'}</td></tr>`).join('');
  const by = (st) => env.keys.filter((k) => k.state === st).length;
  return `<section class="panel env-panel"><h2>${icon('lock', { size: 18 })} Biến môi trường của project</h2>
    ${sysStats(sysStat('Tổng key', env.keys.length), sysStat('Đã điền', by('set'), 'good'), sysStat('Còn giá trị mẫu', by('placeholder'), by('placeholder') ? 'warn' : ''), sysStat('Trống / chưa có', by('empty') + by('missing'), by('empty') + by('missing') ? 'bad' : ''))}
    <p class="muted">Mở file để xem và sửa trực tiếp; bấm Lưu là ghi vào file. <code>.env.local</code> đè <code>.env</code>. File chứa secret được tự thêm vào <code>.gitignore</code>.</p>
    <div class="env-tabs">${files}</div>
    <div class="env-editor" hidden>
      <div class="env-editor-head"><strong data-env-name></strong> <span class="muted small" data-env-note></span>
        <span class="env-actions"><button type="button" data-env-save>${icon('check', { size: 14 })}Lưu</button><button type="button" data-env-close>${icon('close', { size: 14 })}Đóng</button></span></div>
      <textarea class="env-text" spellcheck="false" autocomplete="off" aria-label="Nội dung file env"></textarea>
    </div>
    ${rows ? `<div class="table-wrap env-keys"><table class="table"><thead><tr><th>Key</th><th>Trạng thái</th><th>Lấy từ</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">Chưa có key nào (.env / .env.local / .env.example đều trống).</p>'}
  </section>`;
}

function userHtml(u) {
  const hooks = u.webhooks.map((w, i) => `<li><code>${escapeHtml(w.host)}</code> <span class="muted small">${escapeHtml(w.events.join(', '))}</span> <button type="button" class="small-btn" data-hook-del="${i}">${icon('close', { size: 13 })}Xoá</button></li>`).join('');
  return `<section class="panel"><h2>${icon('bolt', { size: 18 })} Key & tích hợp của dashboard</h2>
    ${sysStats(sysStat('Linear key', u.linear.apiKey ? 'Đã đặt' : 'Chưa đặt', u.linear.apiKey ? 'good' : 'muted', u.linear.fromEnv ? 'từ biến môi trường' : ''), sysStat('Linear team', escapeHtml(u.linear.team || '—')), sysStat('Webhook', u.webhooks.length, u.webhooks.length ? 'good' : 'muted'))}
    <p class="muted">Lưu ở <code>${escapeHtml(u.path)}</code> (của bạn, không nằm trong repo). Giá trị đã lưu chỉ hiện 4 ký tự cuối.</p>
    <div class="form-row"><span class="form-label">Linear API key</span><span>${u.linear.apiKey ? `<code>${escapeHtml(u.linear.apiKey)}</code>` : '<span class="muted">Chưa đặt</span>'}${u.linear.fromEnv ? ' <span class="chip tone-info">Đang dùng LINEAR_API_KEY từ env</span>' : ''}</span></div>
    <form class="form-row" data-linear-key><input type="password" name="key" placeholder="lin_api_…" autocomplete="off" aria-label="Linear API key mới"><button type="submit">${icon('check', { size: 14 })}Lưu key</button>${u.linear.apiKey ? `<button type="button" data-linear-clear>${icon('close', { size: 14 })}Xoá key</button>` : ''}<small class="fld-hint">Tạo ở Linear → Settings → API (dạng <code>lin_api_…</code>). Mặc định: chưa đặt; nếu có biến môi trường <code>LINEAR_API_KEY</code> thì dùng biến đó.</small></form>
    <form class="form-row" data-linear-team><span class="form-label">Linear team</span><input name="team" value="${escapeHtml(u.linear.team)}" placeholder="ENG" aria-label="Linear team"><button type="submit">${icon('check', { size: 14 })}Lưu</button><small class="fld-hint">Khoá team nhận issue, ví dụ <code>ENG</code>. Mặc định: để trống, dùng được khi tài khoản chỉ có một team; nhiều team thì phải đặt.</small></form>
    <h3>Webhook (Slack / Discord / JSON)</h3>
    ${hooks ? `<ul class="hook-list">${hooks}</ul>` : '<p class="muted small">Chưa có webhook.</p>'}
    <form class="form-row" data-hook-add><input type="url" name="url" placeholder="https://hooks.slack.com/…" required aria-label="URL webhook">
      ${u.events.map((e) => `<label class="switch small"><input type="checkbox" name="ev" value="${escapeHtml(e)}" checked><span class="track"></span><span>${escapeHtml(e)}</span></label>`).join('')}
      <button type="submit">${icon('send', { size: 14 })}Thêm webhook</button></form>
  </section>`;
}

function setupHtml(items) {
  const rows = items.map((x) => `<li class="setup-item"><span class="tone-${x.ok ? 'good' : x.optional ? 'muted' : 'bad'}">${icon(x.ok ? 'check' : x.optional ? 'info' : 'x', { size: 15 })}</span>
      <span><strong>${escapeHtml(x.label)}</strong><br><span class="muted small">${escapeHtml(x.detail)}</span></span></li>`).join('');
  const needs = items.some((x) => !x.ok && x.fix === 'setup');
  const ok = items.filter((x) => x.ok).length;
  return `<section class="panel"><h2>${icon('flask', { size: 18 })} Thiết lập project</h2>
    ${sysStats(sysStat('Mục đạt', `${ok}/${items.length}`, ok === items.length ? 'good' : 'warn'), sysStat('Cần sửa', items.filter((x) => !x.ok && !x.optional).length, items.some((x) => !x.ok && !x.optional) ? 'bad' : 'good'), sysStat('Tuỳ chọn chưa bật', items.filter((x) => !x.ok && x.optional).length, 'muted'))}
    <ul class="setup-list">${rows}</ul>
    <p><button type="button" class="${needs ? 'primary' : ''}" data-setup>${icon('rerun', { size: 14 })}Chạy setup</button> <span class="muted small">Cài / cập nhật reporter, gắn vào e2e.config, tạo .env từ .env.example, thêm .env vào .gitignore.</span></p>
    <p><button type="button" data-doctor>${icon('recycle', { size: 14 })}Chạy doctor</button> <span class="muted small">Chuyển dữ liệu cũ sang bố cục mới (runs/YYYY/MM/DD, state/, runtime/) và dựng lại chỉ mục SQLite.</span></p>
    <pre class="log" data-setup-out hidden></pre>
  </section>`;
}

const HEAL = {
  new: ['muted', 'Mới'], analyzing: ['info', 'AI đang phân tích'], 'not-dashboard': ['muted', 'Không phải lỗi dashboard'], fixing: ['info', 'AI đang sửa'],
  'awaiting-review': ['warn', 'Chờ bạn duyệt'], testing: ['info', 'Đang chạy test & tạo PR'], rejected: ['muted', 'Đã bỏ bản sửa'],
  'pr-open': ['good', 'Đã mở PR'], 'fix-failed': ['bad', 'Sửa không thành'], limit: ['warn', 'Chạm giới hạn PR/ngày'], error: ['bad', 'Lỗi khi xử lý'],
};
function healHtml(h, cfg, aiCfg) {
  const rows = h.errors.slice(0, 20).map((x) => {
    const [tone, label] = HEAL[x.status] ?? ['muted', x.status];
    return `<li class="heal-item"><div><span class="chip tone-${tone}">${escapeHtml(label)}</span> <span class="muted small">${escapeHtml(x.sample?.source === 'ui' ? 'UI' : cap(x.sample?.source ?? ''))} · ${escapeHtml(x.count)} lần · ${escapeHtml(String(x.lastSeen ?? '').slice(0, 16).replace('T', ' '))}</span>
      ${x.prUrl ? ` <a class="button" href="${escapeHtml(x.prUrl)}" target="_blank" rel="noreferrer">${icon('external', { size: 13 })}Xem PR</a>` : ''}
      ${['awaiting-review', 'testing'].includes(x.status) ? '' : `<button type="button" class="small-btn" data-heal-retry="${escapeHtml(x.fingerprint)}">${icon('recycle', { size: 13 })}Phân tích lại</button>`}</div>
      <code class="heal-msg">${escapeHtml(x.sample?.message ?? '')}</code>
      ${x.verdict ? `<p class="small">${icon('sparkles', { size: 13 })} ${escapeHtml(x.verdict.summary)} <span class="muted">(${escapeHtml(x.verdict.verdict)}, ${Math.round(x.verdict.confidence * 100)}%)</span></p>` : ''}
      ${x.status === 'awaiting-review' ? `<details class="heal-diff" open><summary class="small">Diff AI đề xuất (branch <code>${escapeHtml(x.branch)}</code>)</summary>
        <pre class="small">${escapeHtml(x.diff ?? x.diffStat ?? '')}</pre>
        <div class="form-row"><button type="button" class="primary" data-heal-approve="${escapeHtml(x.fingerprint)}">${icon('check', { size: 14 })}Chạy test & tạo PR</button>
        <button type="button" class="btn-stop" data-heal-reject="${escapeHtml(x.fingerprint)}">${icon('x', { size: 14 })}Bỏ bản sửa</button></div></details>` : ''}
      ${x.note ? `<p class="small tone-bad">${escapeHtml(x.note)}</p>` : ''}</li>`;
  }).join('');
  const n = (st) => h.errors.filter((x) => x.status === st).length;
  return `<section class="panel"><h2>${icon('sparkles', { size: 18 })} AI</h2>
    ${sysStats(sysStat('Model', escapeHtml(aiCfg.model || 'mặc định')), sysStat('Effort', escapeHtml(aiCfg.effort || 'mặc định')), sysStat('Tự sửa lỗi', cfg.enabled ? 'Bật' : 'Tắt', cfg.enabled ? 'good' : 'muted'), sysStat('Lỗi đã ghi', h.errors.length), sysStat('Chờ duyệt', n('awaiting-review'), n('awaiting-review') ? 'warn' : ''), sysStat('PR đã mở', n('pr-open'), n('pr-open') ? 'good' : ''))}
    <p class="muted">Dùng cho mọi tính năng AI của dashboard (phân tích lỗi, tóm tắt run, triage, tự sửa lỗi…) qua <code>claude</code> trên máy này. Để trống = mặc định của Claude Code.</p>
    <form class="form-row" data-ai-model><span class="form-label">Model</span>
      <input name="model" list="ai-models" value="${escapeHtml(aiCfg.model)}" placeholder="mặc định" aria-label="Model AI" autocomplete="off">
      <datalist id="ai-models"><option value="fable"><option value="opus"><option value="sonnet"><option value="haiku"><option value="claude-opus-5-5"><option value="claude-sonnet-5-5"><option value="claude-haiku-5-5"></datalist>
      <button type="submit">${icon('check', { size: 14 })}Lưu</button><small class="fld-hint">Model Claude dùng cho mọi tính năng AI, ví dụ <code>sonnet</code> hoặc <code>opus</code>. Mặc định: để trống = model mặc định của Claude Code.</small></form>
    <div class="form-row"><span class="form-label">Effort</span>${seg('effort', [['', 'Mặc định'], ...aiCfg.efforts.map((e) => [e, e === 'xhigh' ? 'XHigh' : cap(e)])], aiCfg.effort, 'Effort')}</div>
    <p class="muted small">Effort cao hơn: suy luận kỹ hơn nhưng chậm và tốn token hơn. Gợi ý: <code>medium</code> cho tóm tắt / triage, <code>high</code> trở lên cho tự sửa lỗi.</p>
    <form data-ai-form class="form-row"><label class="switch small"><input type="checkbox" name="autoSummary"${aiCfg.autoSummary ? ' checked' : ''}><span class="track"></span><span>Tự tóm tắt run có test fail bằng AI (hiện ở trang Live và Run)</span></label></form>
    <form data-ai-form class="form-row"><label class="switch small"><input type="checkbox" name="autoBugLog"${aiCfg.autoBugLog ? ' checked' : ''}><span class="track"></span><span>Tự log bug: test fail do app → AI soạn và tạo issue Linear; test đã là known bug mà fail khác lỗi cũ → comment lỗi mới vào issue đó (cần LINEAR_API_KEY; mặc định tắt)</span></label></form>
    <h3>Tự sửa lỗi dashboard</h3>
    <p class="muted small">Lỗi server (API 500, crash) và lỗi giao diện được ghi lại. Khi bật: AI local (<code>claude</code>) đọc code để xem có phải lỗi của e2e-dashboard không; nếu phải, AI sửa trên branch riêng (git worktree tạm, không đụng thư mục làm việc của bạn, AI không chạy được lệnh) rồi <strong>dừng chờ bạn duyệt diff</strong>. Chỉ khi bạn bấm "Chạy test & tạo PR" dashboard mới chạy <code>npm test</code>, push và mở <strong>PR draft</strong>. Mỗi lỗi một PR.</p>
    <form data-heal-form>
      <div class="form-row"><label class="switch small"><input type="checkbox" name="enabled"${cfg.enabled ? ' checked' : ''}><span class="track"></span><span>Bật tự phân tích, sửa và tạo PR</span></label></div>
      <div class="form-row"><span class="form-label">Repo e2e-dashboard</span><input name="repo" value="${escapeHtml(cfg.repo)}" placeholder="/home/…/e2e-dashboard" aria-label="Đường dẫn repo e2e-dashboard" style="flex:1"><small class="fld-hint">Đường dẫn thư mục git của e2e-dashboard để AI sửa trên branch riêng. Mặc định: để trống (tự sửa lỗi chưa dùng được cho tới khi điền).</small></div>
      <div class="form-row"><span class="form-label">PR tối đa / ngày</span><input type="number" name="maxPerDay" min="1" max="20" value="${escapeHtml(cfg.maxPerDay)}" aria-label="PR tối đa mỗi ngày"><button type="submit">${icon('check', { size: 14 })}Lưu</button><small class="fld-hint">Giới hạn số lần AI sửa và tạo PR trong 24 giờ. Mặc định: 3, tối đa 20.</small></div>
    </form>
    ${rows ? `<h3>Lỗi đã ghi nhận</h3><ul class="heal-list">${rows}</ul>` : '<p class="muted">Chưa ghi nhận lỗi nào.</p>'}
  </section>`;
}

// Dọn rác: mỗi nhóm có số mục và dung lượng; chỉ nhóm được chọn mới bị xoá, sau khi xác nhận.
function junkHtml(j) {
  if (!j) return '';
  const rows = j.categories.map((c) => `<label class="set-row reset-row"><span class="set-text"><strong>${escapeHtml(c.label)} <span class="muted small">${c.count} mục · ${fmtBytes(c.bytes)}</span></strong><span class="muted small">${escapeHtml(c.desc)}</span></span><span class="set-ctl"><span class="switch"><input type="checkbox" name="junkCat" value="${escapeHtml(c.id)}"${c.count ? ' checked' : ' disabled'}><span class="track"></span><span class="sr-only">${escapeHtml(c.label)}</span></span></span></label>`).join('');
  const found = j.categories.filter((c) => c.count).length;
  return `<section class="panel"><h2>${icon('recycle', { size: 18 })} Dọn rác</h2>
    <p class="muted">Xoá những thứ dashboard hoặc một lần chạy bị ngắt để lại mà không ai dùng nữa. Không đụng tới run, cài đặt hay mã của project.</p>
    ${sysStats(sysStat('Có thể giải phóng', fmtBytes(j.bytes), j.bytes ? 'warn' : 'good'), sysStat('Nhóm có rác', `${found}/${j.categories.length}`, found ? 'warn' : 'good'))}
    <form data-junk-form>${rows}
      <div class="form-row"><button type="button" class="btn-stop" data-junk-open${found ? '' : ' disabled'}>${icon('recycle', { size: 14 })}Dọn rác…</button><button type="button" data-junk-rescan>${icon('rerun', { size: 14 })}Quét lại</button>${found ? '' : '<span class="muted small">Không có rác.</span>'}</div>
    </form></section>`;
}

// Vùng nguy hiểm: xoá cài đặt và/hoặc dữ liệu. Mỗi mục nói rõ sẽ mất gì; xoá thật chỉ sau popup và gõ RESET.
function resetHtml(p) {
  if (!p) return `<section class="panel"><h2>${icon('recycle', { size: 18 })} Reset</h2><p class="muted">Không tải được thông tin reset.</p></section>`;
  if (p.blocked) return `<section class="panel"><h2>${icon('recycle', { size: 18 })} Reset</h2><p class="small tone-bad">${icon('alert', { size: 14 })} <code>.e2e-dashboard</code> là symlink nên dashboard từ chối xoá.</p></section>`;
  const names = (items) => items.map((x) => `<code>${escapeHtml(x.name)}</code>`).join(', ') || 'không có gì';
  const toggle = (scope, title, desc, off = false) => `<label class="set-row reset-row"><span class="set-text"><strong>${title}</strong><span class="muted small">${desc}</span></span><span class="set-ctl"><span class="switch"><input type="checkbox" name="resetScope" value="${scope}"${off ? ' disabled' : ''}><span class="track"></span><span class="sr-only">${title}</span></span></span></label>`;
  return `<section class="panel danger-zone"><h2>${icon('alert', { size: 18 })} Reset All</h2>
    <p class="muted">Xoá những gì bạn chọn. <strong>Không hoàn tác và không có bản sao lưu.</strong> Code và file test của project không bị đụng tới.</p>
    ${sysStats(sysStat('Run đã lưu', p.data.runs, p.data.runs ? 'warn' : 'muted'), sysStat('Dung lượng dữ liệu', fmtBytes(p.data.bytes)), sysStat('Dung lượng cài đặt', fmtBytes(p.settings.bytes)), sysStat('Cấu hình chung', p.global.exists ? 'Có' : 'Chưa có', p.global.exists ? 'warn' : 'muted'))}
    <form data-reset-form>
      ${toggle('settings', 'Reset cài đặt', `Xoá ${names(p.settings.items.filter((x) => x.kind === 'file'))} và cài đặt giao diện đã lưu trên trình duyệt này (theme, cỡ chữ, ngôn ngữ).`)}
      ${toggle('data', 'Reset dữ liệu', `Xoá <strong>${p.data.runs} run đã lưu</strong> (cả run đã ghim và baseline), triage, ghi chú QC, test thủ công, xu hướng dài hạn, báo cáo đã xuất và chỉ mục.`)}
      ${toggle('global', 'Cả cấu hình chung của máy', p.global.exists ? `Xoá <code>${escapeHtml(p.global.file)}</code>: Linear API key, webhook, model AI, tự sửa lỗi. <strong>Ảnh hưởng mọi project trên máy này.</strong>` : 'Chưa có file cấu hình chung.', !p.global.exists)}
      <div class="form-row"><button type="button" class="btn-stop" data-reset-open disabled>${icon('recycle', { size: 14 })}Reset…</button><span class="muted small">Bạn sẽ được hỏi xác nhận lần nữa trước khi xoá.</span></div>
    </form></section>`;
}

function openResetDialog(p, scopes, onDone) {
  document.getElementById('reset-dialog')?.remove();
  const lines = [];
  if (scopes.includes('settings')) lines.push('Cài đặt dashboard của project và cài đặt giao diện trên trình duyệt này');
  if (scopes.includes('data')) lines.push(`<strong>${p.data.runs} run đã lưu</strong> (kể cả run đã ghim / baseline), triage, ghi chú QC, test thủ công, xu hướng dài hạn, báo cáo đã xuất, chỉ mục`);
  if (scopes.includes('global')) lines.push('<strong>Cấu hình chung của máy</strong>: Linear API key, webhook, model AI (ảnh hưởng mọi project)');
  const dlg = document.createElement('dialog');
  dlg.id = 'reset-dialog';
  dlg.innerHTML = `<form method="dialog" class="run-form reset-form">
    <header><h2>${icon('alert', { size: 18 })}Xác nhận Reset</h2><button type="button" class="icon-btn" data-close aria-label="Đóng">${icon('close')}</button></header>
    <div class="banner tone-bad">${icon('alert', { size: 15 })}<span>Hành động này <strong>không thể hoàn tác</strong> và không có bản sao lưu.</span></div>
    <p>Sẽ xoá vĩnh viễn:</p><ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul>
    <label class="fb-field"><span>Gõ <code>RESET</code> để xác nhận</span><input data-reset-input autocomplete="off" spellcheck="false" aria-label="Gõ RESET để xác nhận"></label>
    <p class="err" hidden></p>
    <footer><button type="button" data-close>Huỷ</button><button type="button" class="btn-stop" data-reset-go disabled>${icon('recycle', { size: 14 })}Xoá vĩnh viễn</button></footer></form>`;
  document.body.append(dlg);
  const input = dlg.querySelector('[data-reset-input]');
  const go = dlg.querySelector('[data-reset-go]');
  const err = dlg.querySelector('.err');
  dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dlg.close()));
  dlg.addEventListener('close', () => dlg.remove());
  input.addEventListener('input', () => { go.disabled = input.value !== 'RESET'; });
  go.addEventListener('click', async () => {
    go.setAttribute('aria-busy', 'true');
    err.hidden = true;
    try {
      const r = await postJson('/api/reset', { scopes, confirm: input.value });
      try { // cài đặt trình duyệt: theme, cỡ chữ, ngôn ngữ, menu; bản nháp Linear thuộc về dữ liệu
        for (const k of Object.keys(localStorage)) if ((scopes.includes('settings') && k.startsWith('e2ed-')) || (scopes.includes('data') && k.startsWith('e2ed-linear-'))) localStorage.removeItem(k);
      } catch {
        // storage bị chặn: không có gì để xoá
      }
      dlg.close();
      onDone(r);
    } catch (x) {
      go.removeAttribute('aria-busy');
      err.hidden = false;
      err.textContent = x.message.replace(/^\d{3}: /, '');
    }
  });
  dlg.showModal();
  input.focus();
}

function infoHtml(d) {
  return `<section class="panel"><h2>${icon('cpu', { size: 18 })} Hệ thống</h2>
    ${sysStats(sysStat('Dashboard', `v${escapeHtml(d.version)}`), sysStat('Node.js', escapeHtml(d.node)), sysStat('Hệ điều hành', escapeHtml(d.platform)), sysStat('Chỉ mục SQLite', d.sqlite ? 'Bật' : 'Tắt', d.sqlite ? 'good' : 'muted'))}
    <table class="table keys"><tbody>
      <tr><td>Dashboard</td><td>v${escapeHtml(d.version)}</td></tr>
      <tr><td>Node.js</td><td>${escapeHtml(d.node)}</td></tr>
      <tr><td>Hệ điều hành</td><td>${escapeHtml(d.platform)}</td></tr>
      <tr><td>Project</td><td><code>${escapeHtml(d.projectRoot)}</code></td></tr>
      <tr><td>Dữ liệu dashboard</td><td><code>${escapeHtml(d.dataDir)}</code></td></tr>
    </tbody></table>
    <form class="form-row" data-sqlite><label class="switch small"><input type="checkbox" name="sqlite"${d.sqlite ? ' checked' : ''}${!d.sqlite && !d.sqliteSupport.ok ? ' disabled' : ''}><span class="track"></span><span>Dùng chỉ mục SQLite (nhanh hơn khi lịch sử lớn; mặc định tắt)</label></form>
    ${d.sqliteSupport.ok ? '' : `<p class="small tone-warn">${icon('alert', { size: 13 })} ${escapeHtml(d.sqliteSupport.reason)}</p>`}
    <p class="small"><a href="#/settings">${icon('gauge', { size: 13 })} Số worker, watch, lịch chạy, dung lượng → Tự động & lưu trữ</a></p>
  </section>`;
}

export async function renderSystem(main) {
  let d = await getJson('/api/system');
  let heal = await getJson('/api/selfheal').catch(() => ({ errors: [] }));
  let resetInfo = await getJson('/api/reset/preview').catch(() => null);
  let junkInfo = await getJson('/api/junk').catch(() => null);
  let editing = null; // file env đang mở
  const urlTab = () => new URLSearchParams(location.hash.split('?')[1] ?? '').get('tab');
  let tab = SYS_TABS.some(([k]) => k === urlTab()) ? urlTab() : 'appearance';
  const badge = (k) => {
    const todo = k === 'project' ? d.setup.filter((x) => !x.ok && !x.optional).length + d.env.keys.filter((x) => x.state !== 'set').length : k === 'ai' ? heal.errors.filter((x) => x.status === 'awaiting-review').length : 0;
    return todo ? `<span class="sys-badge" title="Cần xem">${todo}</span>` : '';
  };
  const draw = () => {
    const panes = { appearance: appearanceHtml(), project: setupHtml(d.setup) + envHtml(d.env), integrations: userHtml(d.user), ai: healHtml(heal, d.user.selfHeal, d.user.ai), about: infoHtml(d), reset: junkHtml(junkInfo) + resetHtml(resetInfo) };
    main.innerHTML = `${pageHead('Cài đặt hệ thống', 'settings', 'Giao diện, biến môi trường của project, key của dashboard và tình trạng setup.')}
      <div class="sys">
        <div class="sys-nav" role="tablist" aria-orientation="vertical" aria-label="Nhóm cài đặt">${SYS_TABS.map(([k, label, ic, sub]) => `<button type="button" role="tab" id="sys-tab-${k}" data-sys-tab="${k}" aria-selected="${k === tab}" aria-controls="sys-pane-${k}" tabindex="${k === tab ? 0 : -1}"><span class="sys-nav-ic">${icon(ic, { size: 20 })}</span><span class="sys-nav-t"><strong>${label}</strong><span class="small">${sub}</span></span>${badge(k)}</button>`).join('')}</div>
        <div class="sys-body">${SYS_TABS.map(([k]) => `<div class="sys-pane" role="tabpanel" id="sys-pane-${k}" aria-labelledby="sys-tab-${k}"${k === tab ? '' : ' hidden'}>${panes[k]}</div>`).join('')}</div>
      </div>`;
  };
  const showTab = (k, focus = false) => {
    tab = k;
    main.querySelectorAll('[data-sys-tab]').forEach((b) => {
      b.setAttribute('aria-selected', String(b.dataset.sysTab === k));
      b.tabIndex = b.dataset.sysTab === k ? 0 : -1;
      if (focus && b.dataset.sysTab === k) b.focus();
    });
    main.querySelectorAll('.sys-pane').forEach((p) => (p.hidden = p.id !== `sys-pane-${k}`));
    replaceParams({ tab: k === 'appearance' ? '' : k });
  };
  const reload = async () => {
    [d, heal, junkInfo] = await Promise.all([getJson('/api/system'), getJson('/api/selfheal').catch(() => heal), getJson('/api/junk').catch(() => junkInfo)]);
    const ta = main.querySelector('.env-text');
    const keep = editing && ta ? { name: editing, value: ta.value, saved: ta.dataset.saved } : null;
    draw();
    if (!keep) return void (editing = null);
    const ed = editor();
    ed.hidden = false;
    ed.querySelector('[data-env-name]').textContent = keep.name;
    const t2 = ed.querySelector('textarea');
    t2.value = keep.value;
    t2.dataset.saved = keep.saved;
    main.querySelectorAll('[data-env-open]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.envOpen === keep.name)));
  };
  draw();

  const editor = () => main.querySelector('.env-editor');
  async function openEnv(name) {
    const f = await getJson(`/api/system/envfile?name=${encodeURIComponent(name)}`);
    editing = name;
    const ed = editor();
    ed.hidden = false;
    ed.querySelector('[data-env-name]').textContent = name;
    ed.querySelector('[data-env-note]').textContent = f.exists ? '' : 'Chưa có: Lưu sẽ tạo file';
    const ta = ed.querySelector('textarea');
    ta.value = f.content;
    ta.dataset.saved = f.content;
    main.querySelectorAll('[data-env-open]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.envOpen === name)));
    ta.focus();
  }
  async function saveEnv() {
    const ta = editor().querySelector('textarea');
    const r = await postJson('/api/system/envfile', { name: editing, content: ta.value });
    toast(`Đã lưu ${editing}${r.addedToGitignore ? ' và thêm vào .gitignore' : ''}`);
    const name = editing;
    await reload();
    await openEnv(name);
  }

  main.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.name === 'junkCat') {
      main.querySelector('[data-junk-open]').disabled = !main.querySelector('[name=junkCat]:checked');
      return;
    }
    if (t.name === 'resetScope') {
      main.querySelector('[data-reset-open]').disabled = !main.querySelector('[name=resetScope]:checked');
      return;
    }
    if (t.name === 'sqlite') {
      postJson('/api/settings', { sqlite: t.checked })
        .then(() => toast(t.checked ? 'Đã bật chỉ mục SQLite (đang dựng nền)' : 'Đã tắt chỉ mục SQLite'))
        .catch((x) => {
          t.checked = !t.checked; // server từ chối (Node không đủ): trả lại trạng thái cũ
          toast(x.message.replace(/^\d{3}: /, ''), 'bad');
        });
      return;
    }
    if (t.name === 'effort') {
      postJson('/api/system/user', { aiEffort: t.value }).then(() => toast(`Effort: ${t.value || 'mặc định'}`)).catch((x) => toast(x.message, 'bad'));
      return;
    }
    if (t.name === 'autoBugLog') {
      if (t.checked && !(await confirmDialog({ title: 'Bật tự log bug', message: 'Sau mỗi run có test fail do app, dashboard sẽ tự tạo issue trên Linear (hoặc comment vào issue của known bug) mà không hỏi lại. Chỉ nên bật khi đã đặt LINEAR_API_KEY và team đúng.', confirmLabel: 'Bật tự log bug', danger: false }))) {
        t.checked = false;
        return;
      }
      postJson('/api/system/user', { autoBugLog: t.checked }).then(() => toast(t.checked ? 'Đã bật tự log bug lên Linear' : 'Đã tắt tự log bug')).catch((x) => toast(x.message, 'bad'));
      return;
    }
    if (t.name === 'autoSummary') {
      postJson('/api/system/user', { autoSummary: t.checked }).then(() => toast(t.checked ? 'Đã bật tự tóm tắt run' : 'Đã tắt tự tóm tắt run')).catch((x) => toast(x.message, 'bad'));
      return;
    }
    if (t.name === 'theme') setTheme(t.value === 'system' ? null : t.value);
    else if (t.name === 'font') setFont(t.value);
    else if (t.name === 'lang') setLang(t.value);
  });
  main.addEventListener('keydown', (e) => {
    if (e.target.matches('.env-text') && (e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault(); // Ctrl+S lưu file env đang mở
      saveEnv().catch((x) => toast(x.message, 'bad'));
    }
  });
  main.addEventListener('keydown', (e) => {
    const t = e.target.closest?.('[data-sys-tab]');
    if (!t || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const keys = SYS_TABS.map(([k]) => k);
    const i = keys.indexOf(t.dataset.sysTab);
    showTab(e.key === 'Home' ? keys[0] : e.key === 'End' ? keys.at(-1) : keys[(i + (e.key === 'ArrowDown' ? 1 : -1) + keys.length) % keys.length], true);
  });
  main.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.sysTab) return showTab(b.dataset.sysTab);
    try {
      if (b.dataset.envOpen) {
        const ta = editor().querySelector('textarea');
        if (editing && ta.value !== ta.dataset.saved && !(await confirmDialog({ title: 'Bỏ thay đổi chưa lưu', message: `Bỏ thay đổi chưa lưu của ${editing}?`, confirmLabel: 'Bỏ thay đổi' }))) return;
        await openEnv(b.dataset.envOpen);
      } else if ('envSave' in b.dataset) await saveEnv();
      else if ('envClose' in b.dataset) {
        const ta = editor().querySelector('textarea');
        if (ta.value !== ta.dataset.saved && !(await confirmDialog({ title: 'Bỏ thay đổi chưa lưu', message: `Bỏ thay đổi chưa lưu của ${editing}?`, confirmLabel: 'Bỏ thay đổi' }))) return;
        editing = null;
        ta.value = ''; // không giữ secret trong DOM khi đã đóng
        editor().hidden = true;
        main.querySelectorAll('[data-env-open]').forEach((x) => x.removeAttribute('aria-pressed'));
      } else if ('linearClear' in b.dataset) {
        if (!(await confirmDialog({ title: 'Xoá Linear API key', message: 'Xoá Linear API key đã lưu? Gửi issue và tự log bug sẽ ngừng hoạt động cho tới khi bạn đặt lại key.', confirmLabel: 'Xoá key' }))) return;
        await postJson('/api/system/user', { linearApiKey: null });
        toast('Đã xoá Linear API key');
        await reload();
      } else if (b.dataset.hookDel) {
        if (!(await confirmDialog({ title: 'Xoá webhook', message: 'Xoá webhook này? Thông báo sẽ không còn được gửi tới đó.', confirmLabel: 'Xoá webhook' }))) return;
        await postJson('/api/system/user', { removeWebhook: Number(b.dataset.hookDel) });
        toast('Đã xoá webhook');
        await reload();
      } else if (b.dataset.healRetry) {
        await postJson('/api/selfheal/retry', { fingerprint: b.dataset.healRetry });
        toast('Đã đưa vào hàng chờ phân tích');
        await reload();
      } else if (b.dataset.healApprove) {
        if (!(await confirmDialog({ title: 'Chạy test và tạo PR', message: 'Chạy npm test với bản sửa này trong repo e2e-dashboard, rồi push branch và mở PR draft. Bạn đã đọc diff?', confirmLabel: 'Chạy test & tạo PR' }))) return;
        b.disabled = true;
        const r = await postJson('/api/selfheal/approve', { fingerprint: b.dataset.healApprove });
        toast(r.ok ? 'Đang chạy test, xong sẽ mở PR draft' : 'Bản sửa không còn chờ duyệt');
        await reload();
      } else if (b.dataset.healReject) {
        if (!(await confirmDialog({ title: 'Bỏ bản sửa', message: 'Bỏ bản sửa này và xoá branch local?', confirmLabel: 'Bỏ bản sửa' }))) return;
        b.disabled = true;
        await postJson('/api/selfheal/reject', { fingerprint: b.dataset.healReject });
        toast('Đã bỏ bản sửa');
        await reload();
      } else if ('junkRescan' in b.dataset) {
        await reload();
        toast('Đã quét lại');
      } else if ('junkOpen' in b.dataset) {
        const cats = [...main.querySelectorAll('[name=junkCat]:checked')].map((x) => x.value);
        const lines = junkInfo.categories.filter((c) => cats.includes(c.id)).map((c) => `${c.label}: ${c.count} mục, ${fmtBytes(c.bytes)}`);
        if (!lines.length) return;
        if (!(await confirmDialog({ title: 'Dọn rác', message: 'Xoá vĩnh viễn các mục sau? Không ảnh hưởng run, cài đặt hay mã của project.', items: lines, confirmLabel: 'Dọn rác' }))) return;
        const r = await postJson('/api/junk/clean', { categories: cats });
        toast(`Đã giải phóng ${fmtBytes(r.freed)}`);
        await reload();
      } else if ('resetOpen' in b.dataset) {
        const scopes = [...main.querySelectorAll('[name=resetScope]:checked')].map((x) => x.value);
        if (!scopes.length) return;
        openResetDialog(await getJson('/api/reset/preview'), scopes, (r) => {
          toast(`Đã xoá ${r.removed.length} mục${r.skipped.length ? `, bỏ qua ${r.skipped.length} symlink` : ''}`);
          setTimeout(() => location.reload(), 600);
        });
      } else if ('doctor' in b.dataset) {
        if (!(await confirmDialog({ title: 'Chạy doctor', message: 'Chạy doctor: chuyển dữ liệu .e2e-dashboard sang bố cục mới (runs theo ngày, state/, runtime/) và dựng lại chỉ mục. Không xoá run nào. Tiếp tục?', confirmLabel: 'Chạy doctor' }))) return;
        b.setAttribute('aria-busy', 'true');
        const r = await postJson('/api/system/doctor', {});
        await reload();
        const out = main.querySelector('[data-setup-out]');
        out.hidden = false;
        out.textContent = [...r.lines, ...r.warn.map((w) => `Lưu ý: ${w}`)].join('\n');
      } else if ('setup' in b.dataset) {
        b.setAttribute('aria-busy', 'true');
        const r = await postJson('/api/system/setup', {});
        await reload();
        const out = main.querySelector('[data-setup-out]');
        out.hidden = false;
        out.textContent = r.lines.join('\n');
      }
    } catch (x) {
      b.removeAttribute('aria-busy');
      toast(x.message, 'bad');
    }
  });
  main.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      if (f.matches('[data-linear-key]')) {
        await postJson('/api/system/user', { linearApiKey: f.key.value.trim() });
        toast('Đã lưu Linear API key');
      } else if (f.matches('[data-linear-team]')) {
        await postJson('/api/system/user', { linearTeam: f.team.value.trim() });
        toast('Đã lưu Linear team');
      } else if (f.matches('[data-ai-model]')) {
        await postJson('/api/system/user', { aiModel: f.model.value.trim() });
        toast(`Model: ${f.model.value.trim() || 'mặc định'}`);
      } else if (f.matches('[data-heal-form]')) {
        if (f.enabled.checked && !d.user.selfHeal.enabled && !(await confirmDialog({ title: 'Bật tự sửa lỗi', message: 'AI sẽ đọc code của e2e-dashboard và sửa trên branch riêng khi gặp lỗi. Dừng chờ bạn duyệt diff; chỉ khi bạn bấm "Chạy test & tạo PR" mới push và mở PR draft.', confirmLabel: 'Bật tự sửa lỗi', danger: false }))) return;
        await postJson('/api/system/user', { selfHeal: { enabled: f.enabled.checked, repo: f.repo.value.trim(), maxPerDay: Number(f.maxPerDay.value) } });
        toast(f.enabled.checked ? 'Đã bật tự sửa lỗi' : 'Đã lưu');
      } else if (f.matches('[data-hook-add]')) {
        await postJson('/api/system/user', { addWebhook: { url: f.url.value.trim(), events: [...f.querySelectorAll('[name=ev]:checked')].map((x) => x.value) } });
        toast('Đã thêm webhook');
      } else return;
      await reload();
    } catch (x) {
      toast(x.message, 'bad');
    }
  });
}
