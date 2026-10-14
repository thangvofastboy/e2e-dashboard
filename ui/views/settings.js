import { getJson, postJson } from '../api.js';
import { confirmDialog } from '../confirm.js';
import { pageHead } from '../analysis.js';
import { toast } from '../toast.js';
import { escapeHtml, fmtRelative, statusBadge } from '../format.js';
import { runHref } from '../router.js';
import { icon } from '../icons.js';

export const fmtBytes = (b) => (b < 1024 ? `${b} B` : b < 1024 ** 2 ? `${(b / 1024).toFixed(0)} KB` : b < 1024 ** 3 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${(b / 1024 ** 3).toFixed(2)} GB`);

// Dọn rác: chọn run theo khoảng thời gian (và trạng thái), xem trước số run + dung lượng, rồi mới xoá. Run ghim không bị chọn.
function cleanupPanelHtml() {
  return `<section class="panel cleanup"><h2>${icon('close', { size: 15 })} Dọn rác</h2>
    <form data-cleanup>
      <div class="form-row"><span class="form-label">Nhanh</span>
        <span class="seg-btns">${[7, 30, 90].map((d) => `<button type="button" data-older="${d}">Cũ hơn ${d} ngày</button>`).join('')}</span></div>
      <div class="form-row"><span class="form-label">Từ ngày</span><input type="date" name="from" aria-label="Từ ngày">
        <span>đến</span><input type="date" name="to" aria-label="Đến ngày"></div>
      <div class="form-row"><span class="form-label">Trạng thái</span><select name="status" aria-label="Trạng thái run"><option value="all">Tất cả</option><option value="passed">Chỉ run pass</option><option value="failed">Chỉ run fail</option></select>
        <button type="submit">${icon('eye', { size: 14 })}Xem trước</button></div>
    </form>
    <div data-cleanup-out></div>
    <p class="muted small">Run đã ghim không bao giờ bị xoá. Xoá là xoá hẳn thư mục run (report, ảnh, video, trace, phân tích AI).</p></section>`;
}

const BROWSER_NAMES = { chromium: 'Chromium', firefox: 'Firefox', webkit: 'WebKit (Safari)' };
// trình duyệt mặc định khi chạy test (dashboard truyền E2E_BROWSER cho e2e run)
function browserFormHtml(p) {
  const inst = p.browsers?.installed ?? {};
  const missing = Object.keys(BROWSER_NAMES).filter((b) => inst[b] === false);
  return `<form class="row" data-browser><label>Trình duyệt mặc định <select name="browser" aria-label="Trình duyệt mặc định">${Object.entries(BROWSER_NAMES)
    .map(([b, label]) => `<option value="${b}"${p.browser === b ? ' selected' : ''}>${label}${inst[b] === false ? ' (chưa cài)' : ''}</option>`).join('')}</select></label></form>
    ${p.browsers && !p.browsers.configReadsBrowser ? `<p class="small tone-warn">${icon('alert', { size: 13 })} <code>e2e.config</code> chưa đọc <code>E2E_BROWSER</code> nên mọi run vẫn dùng trình duyệt trong config. Chạy <code>/e2e-dashboard setup</code> (hoặc thêm <code>browser: process.env.E2E_BROWSER ?? 'chromium'</code> vào <code>web({...})</code>).</p>` : ''}
    ${missing.length ? `<p class="muted small">Cài thêm trình duyệt: <code>npx @e2e-dev/web install ${missing.join(' ')}</code></p>` : ''}`;
}

// Tab dọc giống Cài đặt hệ thống: mọi panel vẫn có trong DOM, chỉ ẩn bằng hidden nên các listener không đổi.
const SET_TABS = [
  ['run', 'Chạy & lịch', 'gauge', 'Workers, watch, lịch chạy'],
  ['notify', 'Thông báo & CI', 'send', 'Webhook, cảnh báo, đồng bộ CI'],
  ['storage', 'Lưu trữ', 'download', 'Dung lượng, dọn rác, run nặng'],
];

export async function renderSettings(main) {
  const [auto, storage, ci, alerts, prefs] = await Promise.all([getJson('/api/automation'), getJson('/api/storage'), getJson('/api/ci').catch(() => null), getJson('/api/alerts').catch(() => null), getJson('/api/settings').catch(() => null)]);
  const s = auto.schedule;
  const kinds = [['video', 'Video'], ['image', 'Ảnh'], ['report', 'report.json'], ['trace', 'Trace'], ['other', 'Khác']];
  const biggest = [...storage.runs].sort((a, b) => b.bytes - a.bytes).slice(0, 8);
  main.innerHTML = `${pageHead('Tự động & lưu trữ', 'gauge', 'Chế độ watch, lịch chạy, webhook và dung lượng lịch sử.')}
    <div class="sys">
      <nav class="sys-nav" role="tablist" aria-orientation="vertical" aria-label="Nhóm cài đặt tự động và lưu trữ">${SET_TABS.map(([k, label, ic, sub], i) => `<button type="button" role="tab" id="set-tab-${k}" data-set-tab="${k}" aria-selected="${i === 0}" aria-controls="set-pane-${k}" tabindex="${i === 0 ? 0 : -1}"><span class="sys-nav-ic">${icon(ic, { size: 20 })}</span><span class="sys-nav-t"><strong>${label}</strong><span class="small">${sub}</span></span></button>`).join('')}</nav>
      <div class="sys-body">
        <div class="sys-pane" role="tabpanel" id="set-pane-run" aria-labelledby="set-tab-run">
          <div class="settings-grid">
      ${prefs ? workersPanelHtml(prefs) : ''}
      ${prefs ? `<section class="panel"><h2>${icon('eye', { size: 15 })} Trình duyệt có giao diện</h2>
        <label class="pill switch"><input type="checkbox" data-headed ${prefs.headed ? 'checked' : ''}><span class="track"></span><span>Mở trình duyệt khi chạy (headed)</span></label>
        <p class="muted small">Mặc định cho mọi run bấm từ dashboard, đổi được từng lần ở hộp Chạy test. Cần màn hình: máy chủ không có màn hình (CI) thì runner báo lỗi.</p></section>` : ''}
      <section class="panel"><h2>${icon('eye', { size: 15 })} Chế độ watch</h2>
        <p class="muted small">Lưu một file <code>*.e2e.ts</code> là dashboard tự chạy lại đúng file đó (bỏ qua test đang cách ly), xem ở trang Live.</p>
        <label class="pill switch"><input type="checkbox" data-watch ${auto.watch.enabled ? 'checked' : ''}><span class="track"></span><span>Bật watch</span></label>
        ${auto.watch.last ? `<p class="muted small">Lần gần nhất: ${escapeHtml(auto.watch.last.files.join(', '))} · ${auto.watch.last.ok ? 'đã chạy' : `không chạy được (${escapeHtml(auto.watch.last.error ?? '')})`}</p>` : ''}</section>
      <section class="panel"><h2>${icon('clock', { size: 15 })} Lịch chạy</h2>
        ${s?.times?.length ? `<p>Hằng ngày lúc <strong>${s.times.map(escapeHtml).join(', ')}</strong> · lần tới ${escapeHtml(new Date(s.next).toLocaleString('vi-VN'))}</p>` : '<p class="muted">Chưa đặt lịch.</p>'}
        <details class="cfg"><summary class="small">${icon('file', { size: 13 })}Cách cấu hình</summary><p class="muted small">Đặt trong <code>.e2e-dashboard/config.json</code>: <code>"schedule": { "daily": ["02:00"], "tests": [] }</code>. Chỉ chạy khi dashboard đang mở; kết quả gửi qua thông báo desktop và webhook.</p></details></section>
          </div>
        </div>
        <div class="sys-pane" role="tabpanel" id="set-pane-notify" aria-labelledby="set-tab-notify" hidden>
          <div class="settings-grid">
      <section class="panel"><h2>${icon('send', { size: 15 })} Webhook (Slack / Discord)</h2>
        ${auto.webhooks.length ? `<ul>${auto.webhooks.map((w) => `<li><code>${escapeHtml(w.host)}</code> <span class="muted small">${escapeHtml(w.events.join(', '))}</span></li>`).join('')}</ul><button type="button" data-hook-test>${icon('send', { size: 14 })}Gửi thử</button>` : '<p class="muted">Chưa có webhook.</p>'}
        <details class="cfg"><summary class="small">${icon('file', { size: 13 })}Cách cấu hình</summary><p class="muted small">Thêm vào <code>~/.e2e-dashboard/config.json</code> (không đặt trong repo): <code>"webhooks": [{ "url": "https://hooks.slack.com/…", "events": ["run-failed", "digest"] }]</code>. Digest tuần: <code>/e2e-dashboard digest --send</code>.</p></details></section>
      ${alerts ? alertsPanelHtml(alerts) : ''}
      ${ci ? ciPanelHtml(ci) : ''}
          </div>
        </div>
        <div class="sys-pane" role="tabpanel" id="set-pane-storage" aria-labelledby="set-tab-storage" hidden>
          <div class="settings-grid">
      <section class="panel"><h2>${icon('download', { size: 15 })} Dung lượng: ${escapeHtml(fmtBytes(storage.bytes))}</h2>
        <ul class="hbar">${kinds.map(([k, label]) => `<li><span class="hb-label">${label}</span><span class="hb-track"><span class="hb-fill tone-info" style="width:${storage.bytes ? Math.round((storage.totals[k] / storage.bytes) * 100) : 0}%"></span></span><span class="hb-val">${escapeHtml(fmtBytes(storage.totals[k]))}</span></li>`).join('')}</ul>
        <form class="row" data-prune><label>Xoá video của run cũ hơn <input type="number" name="days" min="0" max="3650" value="7"> ngày</label><button type="submit">${icon('close', { size: 14 })}Xoá video</button></form>
        <p class="muted small">Giữ run fail lâu hơn: <code>"retention": { "keep": 50, "keepFailed": 200 }</code>. Run đã ghim không bao giờ bị xoá.</p></section>
      ${cleanupPanelHtml()}
          </div>
                    <section class="panel fill-me"><h2>Run nặng nhất</h2><table class="table"><thead><tr><th>Run</th><th>Bắt đầu</th><th class="num">Dung lượng</th><th class="num">Video</th><th></th></tr></thead><tbody>${biggest.map((r) => `<tr><td><a href="${runHref(r.runId)}">${statusBadge(r.status)}</a></td><td>${escapeHtml(fmtRelative(r.startedAt))}</td><td class="num">${escapeHtml(fmtBytes(r.bytes))}</td><td class="num">${escapeHtml(fmtBytes(r.video))}</td>
      <td>${r.pinned ? `<span class="muted small">Đã ghim</span>` : `<button type="button" class="small-btn" data-del="${escapeHtml(r.runId)}">${icon('close', { size: 13 })}Xoá run</button>`}</td></tr>`).join('')}</tbody></table></section>
        </div>
      </div>
    </div>`;
  main.querySelectorAll('[data-set-tab]').forEach((b) => b.addEventListener('click', () => {
    main.querySelectorAll('[data-set-tab]').forEach((x) => {
      const on = x === b;
      x.setAttribute('aria-selected', String(on));
      x.tabIndex = on ? 0 : -1;
    });
    main.querySelectorAll('.sys-pane').forEach((p) => (p.hidden = p.id !== `set-pane-${b.dataset.setTab}`));
  }));
  main.querySelector('[data-browser]')?.addEventListener('change', async (e) => {
    const r = await postJson('/api/settings', { browser: e.target.value }).catch((x) => ({ error: x.message }));
    if (r.error) toast(r.error, 'bad');
    else toast(`Trình duyệt mặc định: ${BROWSER_NAMES[r.browser]}`);
  });
  main.querySelector('[data-headed]')?.addEventListener('change', async (e) => {
    const r = await postJson('/api/settings', { headed: e.target.checked }).catch((x) => ({ error: x.message }));
    if (r.error) {
      toast(r.error, 'bad');
      e.target.checked = !e.target.checked;
    } else toast(r.headed ? 'Mặc định chạy có giao diện (headed)' : 'Mặc định chạy ẩn (headless)');
  });
  const wf = main.querySelector('[data-workers]');
  wf?.auto.addEventListener('change', () => {
    wf.workers.disabled = wf.auto.checked;
  });
  wf?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const workers = wf.auto.checked ? null : Number(wf.workers.value);
    const r = await postJson('/api/settings', { workers }).catch((x) => ({ error: x.message }));
    if (r.error) toast(r.error.includes('invalid') ? 'Số worker phải từ 1 đến 1024.' : r.error, 'bad');
    else toast(r.workers ? `Mặc định chạy ${r.workers} worker` : `Mặc định tự động theo máy (${r.autoWorkers} worker)`);
  });
  main.querySelector('[data-watch]').addEventListener('change', async (e) => {
    const r = await postJson('/api/watch', { enabled: e.target.checked }).catch((x) => ({ error: x.message }));
    if (r.error || !r.ok) {
      toast(r.error ?? 'Không bật được watch trên hệ thống này.', 'bad');
      e.target.checked = false;
    } else toast(r.enabled ? 'Đã bật watch' : 'Đã tắt watch');
  });
  main.querySelector('[data-ci-sync]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; // e.target may be the inner <svg>; currentTarget is null after await
    btn.disabled = true;
    const r = await postJson('/api/ci/sync', {}).catch((x) => ({ error: x.message }));
    btn.disabled = false;
    if (r.error) toast(r.error, 'bad');
    else toast(r.imported ? `Đã nhập ${r.imported} run từ CI` : 'Không có run CI mới');
    renderSettings(main);
  });
  main.querySelector('[data-hook-test]')?.addEventListener('click', async () => {
    const r = await postJson('/api/webhook/test', {}).catch((x) => ({ error: x.message }));
    if (r.error) toast(r.error, 'bad');
    else toast(r.sent.map((x) => `${x.host}: ${x.ok ? 'OK' : x.status ?? x.error}`).join(' · '), r.sent.every((x) => x.ok) ? 'good' : 'warn');
  });
  main.querySelector('[data-prune]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const days = Number(new FormData(e.target).get('days'));
    if (!(await confirmDialog({ title: 'Xoá video', message: `Xoá video của mọi run (trừ run đã ghim) cũ hơn ${days} ngày?`, confirmLabel: 'Xoá video' }))) return;
    const r = await postJson('/api/storage/prune', { days }).catch((x) => ({ error: x.message }));
    if (r.error) toast(r.error, 'bad');
    else {
      toast(`Đã xoá ${r.files} video, giải phóng ${fmtBytes(r.freed)}`);
      renderSettings(main);
    }
  });
  // dọn rác: xem trước rồi xác nhận
  const cf = main.querySelector('[data-cleanup]');
  const out = main.querySelector('[data-cleanup-out]');
  let query = null;
  const previewCleanup = async (q) => {
    query = q;
    const params = new URLSearchParams(Object.entries(q).filter(([, v]) => v != null && v !== ''));
    try {
      const r = await getJson(`/api/storage/cleanup?${params}`);
      const rows = r.runs.slice(0, 50).map((x) => `<tr><td><a href="${runHref(x.runId)}">${escapeHtml(x.runId.slice(-8))}</a></td><td>${escapeHtml(new Date(x.startedAt).toLocaleString('vi-VN'))}</td><td>${statusBadge(x.status)}</td><td class="num">${escapeHtml(fmtBytes(x.bytes))}</td></tr>`).join('');
      out.innerHTML = r.runs.length
        ? `<p><strong>${r.runs.length} run</strong> · ${escapeHtml(fmtBytes(r.bytes))}${r.pinnedSkipped ? ` · <span class="muted">bỏ qua ${r.pinnedSkipped} run ghim</span>` : ''}
            <button type="button" data-cleanup-go>${icon('close', { size: 14 })}Xoá ${r.runs.length} run</button></p>
          <div class="table-wrap cleanup-list"><table class="table compact"><thead><tr><th>Run</th><th>Bắt đầu</th><th>Trạng thái</th><th class="num">Dung lượng</th></tr></thead><tbody>${rows}</tbody></table></div>${r.runs.length > 50 ? `<p class="muted small">…và ${r.runs.length - 50} run khác</p>` : ''}`
        : `<p class="muted">Không có run nào khớp${r.pinnedSkipped ? ` (bỏ qua ${r.pinnedSkipped} run ghim)` : ''}.</p>`;
    } catch (x) {
      out.innerHTML = '';
      toast(x.message, 'bad');
    }
  };
  cf.addEventListener('click', (e) => {
    const b = e.target.closest('[data-older]');
    if (b) previewCleanup({ olderThanDays: Number(b.dataset.older), status: cf.status.value });
  });
  cf.addEventListener('submit', (e) => {
    e.preventDefault();
    previewCleanup({ from: cf.from.value, to: cf.to.value, status: cf.status.value });
  });
  out.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-cleanup-go]');
    if (!b || !query) return;
    if (!(await confirmDialog({ title: 'Xoá run theo bộ lọc', message: `${b.textContent.trim()}? Không hoàn tác được.`, confirmLabel: 'Xoá' }))) return;
    b.setAttribute('aria-busy', 'true');
    try {
      const r = await postJson('/api/storage/cleanup', { ...query, olderThanDays: query.olderThanDays ?? null });
      toast(`Đã xoá ${r.deleted} run, giải phóng ${fmtBytes(r.bytes)}`);
      renderSettings(main);
    } catch (x) {
      b.removeAttribute('aria-busy');
      toast(x.message, 'bad');
    }
  });
  main.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: 'Xoá run', message: 'Xoá hẳn run này khỏi lịch sử?', confirmLabel: 'Xoá' }))) return;
      const r = await postJson(`/api/runs/${encodeURIComponent(b.dataset.del)}/delete`, {}).catch((x) => ({ error: x.message }));
      if (r.error) toast(r.error, 'bad');
      else {
        toast('Đã xoá run');
        renderSettings(main);
      }
    }));
}

// Số worker mặc định cho run do dashboard khởi động (nút Chạy, lịch, watch). Tự động = để e2e chọn:
// workers trong e2e.config, không có thì một nửa số core.
export function workersPanelHtml(p) {
  const isAuto = p.workers == null;
  return `<section class="panel"><h2>${icon('cpu', { size: 15 })} Chạy test: worker và trình duyệt</h2>
    <form class="row" data-workers>
      <label class="pill switch"><input type="checkbox" name="auto" ${isAuto ? 'checked' : ''}><span class="track"></span><span>Tự động theo máy (${escapeHtml(p.autoWorkers)} worker)</span></label>
      <label>Số worker <input type="number" name="workers" min="1" max="1024" required value="${escapeHtml(p.workers ?? p.autoWorkers)}" ${isAuto ? 'disabled' : ''}></label><small class="fld-hint">Số test chạy song song cho run bấm từ dashboard. Mặc định: tự động theo số lõi CPU của máy.</small>
      <button type="submit">${icon('check', { size: 14 })}Lưu</button>
    </form>
    <p class="muted small">Áp dụng cho run bấm từ dashboard, lịch chạy và watch; đổi riêng từng lần trong hộp thoại <em>Chạy test</em>. Tự động: dùng <code>workers</code> trong <code>e2e.config</code>, không có thì một nửa số core. Nhiều worker chạy nhanh hơn nhưng các test dùng chung tài khoản hoặc dữ liệu có thể đụng nhau.</p>
    ${browserFormHtml(p)}</section>`;
}

export function alertsPanelHtml(a) {
  return `<section class="panel"><h2>${icon('bolt', { size: 15 })} Cảnh báo</h2>
    ${a.active.length ? a.active.map((x) => `<div class="banner tone-bad">${icon('alert', { size: 14 })}${escapeHtml(x.title)} <span class="muted small">từ ${escapeHtml(fmtRelative(x.at))}</span></div>`).join('') : '<p class="tone-good">Không có cảnh báo nào đang bật.</p>'}
    <p class="small"><strong>Luật${a.configured ? '' : ' (mặc định)'}:</strong></p><ul class="small">${a.rules.map((r) => `<li>${escapeHtml(r.description)}</li>`).join('') || '<li class="muted">Đã tắt ("alerts": [])</li>'}</ul>
    ${a.log.length ? `<details><summary class="small">Lịch sử (${a.log.length})</summary><ul class="small">${a.log.map((l) => `<li>${escapeHtml(new Date(l.at).toLocaleString('vi-VN'))} · ${l.kind === 'fired' ? '🚨' : '✅'} ${escapeHtml(l.title)}</li>`).join('')}</ul></details>` : ''}
    <details class="cfg"><summary class="small">${icon('file', { size: 13 })}Cách cấu hình</summary><p class="muted small">Đặt trong <code>.e2e-dashboard/config.json</code>, vd. <code>"alerts": [{ "type": "consecutive-failures", "count": 3 }, { "type": "pass-rate-below", "value": 0.9, "scope": "module:checkout" }, { "type": "flaky-increase", "factor": 2 }, { "type": "red-for", "hours": 4, "branch": "main" }]</code>. Gửi qua thông báo desktop và webhook (sự kiện <code>alert</code>), tag owner theo CODEOWNERS.</p></details></section>`;
}

export function ciPanelHtml(c) {
  const st = c.state;
  return `<section class="panel"><h2>${icon('upload', { size: 15 })} Đồng bộ từ CI</h2>
    ${c.config ? `<p>GitHub Actions <code>${escapeHtml(c.config.workflow)}</code>${c.config.branch ? ` · branch <code>${escapeHtml(c.config.branch)}</code>` : ''} · mỗi ${escapeHtml(c.config.intervalMinutes)} phút</p>
      <p class="small">${st.lastSync ? `Lần cuối ${escapeHtml(fmtRelative(st.lastSync))}: ${st.lastError ? `<span class="tone-bad">${escapeHtml(st.lastError)}</span>` : `nhập ${escapeHtml(st.lastImported)} run`}` : 'Chưa đồng bộ lần nào.'}</p>
      ${st.recent.length ? `<ul class="small">${st.recent.map((r) => `<li>#${escapeHtml(r.id)} ${escapeHtml(r.branch ?? '')} ${escapeHtml(r.conclusion ?? '')}: ${escapeHtml(r.archived)} report${r.reason ? ` <span class="muted">(${escapeHtml(r.reason)})</span>` : ''}</li>`).join('')}</ul>` : ''}
      <button type="button" data-ci-sync>${icon('recycle', { size: 14 })}Đồng bộ ngay</button>`
    : '<p class="muted">Chưa bật.</p>'}
    <details class="cfg"><summary class="small">${icon('file', { size: 13 })}Cách cấu hình</summary><p class="muted small">Tự kéo report e2e từ các run CI mới (cần <code>gh auth login</code>): <code>"ci": { "github": { "workflow": "e2e.yml", "artifact": "e2e-report", "branch": "main", "intervalMinutes": 30 } }</code> trong <code>.e2e-dashboard/config.json</code>.</p></details></section>`;
}
