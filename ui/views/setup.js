// Trang "1 Click Setup" (#/setup): mọi thứ để project chạy được e2e trên dashboard ở một chỗ.
// 1) kế hoạch cài theo hệ điều hành (bước tự cài theo thứ tự + Cài tất cả, mục làm tay, mục đã có);
// 2) model AI cho bước agent (provider, API key) và e2e.config.ts (URL app, lệnh khởi động app).
// Popup lúc mở dashboard dùng chung phần danh sách bước (ui/setup-steps.js).
import { getJson, postJson } from '../api.js';
import { confirmDialog } from '../confirm.js';
import { pageHead } from '../analysis.js';
import { toast } from '../toast.js';
import { escapeHtml } from '../format.js';
import { icon } from '../icons.js';
import { setupNeeds, stepsHtml, bindSteps } from '../setup-steps.js';
import { appFieldsHtml, readAppFields } from '../project-context.js';

const stat = (label, value, tone = '', sub = '') => `<div class="sys-stat${tone ? ` tone-${tone}` : ''}"><span class="sys-stat-v">${value}</span><span class="sys-stat-l">${escapeHtml(label)}</span>${sub ? `<span class="sys-stat-s muted small">${sub}</span>` : ''}</div>`;

// e2e.config.ts: xem nhanh và sửa URL app / bundleId (mobile) / lệnh khởi động (server chỉ sửa đúng các giá trị này)
export function e2eConfigHtml(c) {
  if (!c) return '';
  if (!c.exists) return `<section class="panel"><h2>${icon('file', { size: 18 })} e2e.config.ts</h2><p class="muted">Không tìm thấy e2e.config.*. Tạo bằng <code>/e2e-dashboard config --init</code> trong terminal.</p></section>`;
  const row = (k, v, tone = '') => `<li class="setup-item"><span class="tone-${tone || 'muted'}">${icon(tone === 'good' ? 'check' : 'info', { size: 15 })}</span><span><strong>${escapeHtml(k)}</strong><br><span class="muted small">${escapeHtml(v)}</span></span></li>`;
  return `<section class="panel"><h2>${icon('file', { size: 18 })} Cấu hình ${escapeHtml(c.file)}</h2>
    <ul class="setup-list">
      ${row('Engine', `${c.engine ?? 'không rõ'} · ${c.targets} target`)}
      ${row('Model cho bước agent', c.model ?? 'Không (chỉ test bằng locator)', c.model ? 'good' : '')}
      ${row('Reporter dashboard', c.reporter ? 'Đã gắn' : 'Chưa gắn: bấm Cài tất cả ở trên', c.reporter ? 'good' : '')}
      ${c.engine === 'mobile' && c.appUrl == null && !c.browserEnv ? '' : row('Chọn trình duyệt khi chạy', c.browserEnv ? 'Có (E2E_BROWSER)' : 'Chưa: bấm Cài tất cả ở trên', c.browserEnv ? 'good' : '')}
    </ul>
    ${aiPanelHtml(c)}
    <form data-e2e-config>
      ${appFieldsHtml(c, (label, control, hint) => `<div class="form-row"><span class="form-label">${escapeHtml(label)}</span>${control}<small class="fld-hint">${hint}</small></div>`)}
      <p><button type="submit" class="primary">${icon('check', { size: 14 })}Lưu vào ${escapeHtml(c.file)}</button> <span class="muted small" data-e2e-config-msg></span></p>
    </form>
  </section>`;
}

// AI cho bước agent: provider (sửa e2e.config), API key vào .env; gói npm cài bằng Cài tất cả, đăng nhập chỉ báo lệnh
export function aiPanelHtml(c) {
  const ai = c.ai;
  if (!ai || !c.providers) return '';
  const opts = c.providers.map((p) => `<option value="${escapeHtml(p.id)}"${p.id === ai.provider ? ' selected' : ''}>${escapeHtml(p.label)}</option>`).join('');
  const status = [];
  if (ai.packages.length) status.push(ai.missing.length ? `<span class="tone-warn">Thiếu gói ${escapeHtml(ai.missing.join(', '))}</span>: bấm Cài tất cả ở trên (<code>${escapeHtml(ai.installDisplay)}</code>)` : `<span class="tone-good">Đủ gói</span> ${escapeHtml(ai.packages.join(', '))}`);
  if (ai.env && ai.kind === 'key') status.push(ai.keyState === 'set' ? `<span class="tone-good">${escapeHtml(ai.env)} đã có</span> (${escapeHtml(ai.keySource)})` : `<span class="tone-warn">Chưa có ${escapeHtml(ai.env)}</span>${ai.keyUrl ? `: tạo key ở <a href="${escapeHtml(ai.keyUrl)}" target="_blank" rel="noreferrer">${escapeHtml(ai.keyUrl)}</a>` : ''}`);
  if (ai.kind === 'cli') status.push(`${ai.claude ? '<span class="tone-good">Có lệnh claude</span>' : '<span class="tone-warn">Không thấy lệnh claude</span>'}: đăng nhập một lần bằng <code>claude</code>${ai.adapterMissing ? ' · <span class="tone-warn">thiếu e2e-dashboard.claude-code.mjs</span>: bấm Cài tất cả' : ''}`);
  if (ai.kind === 'login') status.push(ai.loggedIn ? '<span class="tone-good">Đã đăng nhập</span> trên máy này' : `<span class="tone-warn">Chưa đăng nhập</span>: chạy trong terminal <code>${escapeHtml(ai.loginDisplay)}</code> <button type="button" class="icon-btn" data-copy="${escapeHtml(ai.loginDisplay)}" aria-label="Copy lệnh">${icon('copy', { size: 13 })}</button>`);
  // cảnh báo của model thử nghiệm: khung banner theo màu theme (sáng / tối)
  const warn = ai.warning?.length ? `<div class="banner tone-warn ai-warn" role="note" data-nums>${icon('alert', { size: 15 })}<ul>${ai.warning.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul></div>` : '';
  return `<form data-ai-config>
      <div class="form-row"><span class="form-label">Model AI (bước agent)</span><select name="provider" aria-label="Model AI cho bước agent">${ai.provider === 'custom' ? '<option value="" selected>Model tuỳ chỉnh (giữ nguyên)</option>' : ''}${opts}</select>
        <small class="fld-hint">Đổi thì dashboard sửa <code>agents</code> và import trong ${escapeHtml(c.file)}. Gói npm của model cài bằng Cài tất cả.</small></div>
      <div class="form-row" data-ai-key${ai.env && ai.kind === 'key' ? '' : ' hidden'}><span class="form-label">API key</span><input type="password" name="apiKey" autocomplete="off" placeholder="${escapeHtml(ai.keyState === 'set' ? 'Đã có: để trống để giữ nguyên' : `Dán ${ai.env ?? 'API key'}`)}" aria-label="API key">
        <small class="fld-hint">Lưu vào <code>.env</code> (quyền 600, tự vào .gitignore); config được thêm dòng đọc .env.</small></div>
      <div class="form-row" data-ai-local${ai.provider === 'openai-compatible' ? '' : ' hidden'}><span class="form-label">Server model</span><input type="url" name="baseURL" placeholder="http://127.0.0.1:11434/v1" aria-label="URL server model"><input type="text" name="modelId" placeholder="model id" aria-label="Model id" spellcheck="false"></div>
      ${status.length ? `<ul class="ai-model-status small">${status.map((x) => `<li>${x}</li>`).join('')}</ul>` : ''}${warn}
      <p><button type="submit">${icon('sparkles', { size: 14 })}Lưu model AI</button> <span class="muted small" data-ai-msg></span></p>
    </form>`;
}

export async function renderSetup(main) {
  let plan, cfg;
  let busy = false;
  const load = async () => {
    [plan, cfg] = await Promise.all([getJson('/api/system/quick-setup'), getJson('/api/system/e2e-config').catch(() => null)]);
  };
  const draw = () => {
    const { auto, manual } = setupNeeds(plan);
    const items = plan.items.filter((x) => !x.info);
    const ok = items.filter((x) => x.ok).length;
    const ready = !auto.length && !manual.length;
    main.innerHTML = `${pageHead('1 Click Setup', 'zap', 'Kiểm tra máy và project, rồi cài mọi thứ còn thiếu để chạy e2e trên dashboard bằng một nút: thư viện, gói AI, trình duyệt, reporter, .env, model AI và e2e.config.ts.', `<button type="button" data-recheck>${icon('recycle', { size: 14 })}Kiểm tra lại</button>`)}
      <div class="sys-stats">
        ${stat('Hệ điều hành', escapeHtml(plan.os?.name ?? '?'), '', escapeHtml(plan.os?.label ?? ''))}
        ${stat('Đã có', `${ok}/${items.length}`, ok === items.length ? 'good' : 'warn')}
        ${stat('Sẽ tự cài', auto.length, auto.length ? 'warn' : 'good')}
        ${stat('Cần làm tay', manual.length, manual.length ? 'bad' : 'good')}
      </div>
      <div class="setup-page">
      <section class="panel" data-setup-steps>
        <h2>${icon('download', { size: 18 })} Các bước cài đặt</h2>
        ${ready ? `<p class="tone-good">${icon('check', { size: 14 })} Project đã sẵn sàng chạy e2e, không cần cài gì.</p>` : `<p class="muted small">Cài theo thứ tự dưới đây; cách cài chọn theo ${escapeHtml(plan.os?.label ?? 'hệ điều hành')}. Đang có run chạy thì dừng run trước khi cài.</p>`}
        ${stepsHtml(plan, { showOk: true })}
      </section>
      ${e2eConfigHtml(cfg)}
      </div>`;
    bindSteps(main.querySelector('[data-setup-steps]'), plan, {
      onBusy: (on) => {
        busy = on;
        main.querySelector('[data-recheck]').disabled = on;
      },
      onFinish: async () => {
        await reload(false);
      },
    });
  };
  // keepLog: giữ log + dòng tiến độ của lần cài vừa xong sau khi vẽ lại
  const reload = async (fresh = true) => {
    const old = main.querySelector('[data-setup-steps]');
    const keep = !fresh && old ? { log: old.querySelector('[data-log]')?.textContent, progress: old.querySelector('[data-progress]')?.textContent } : null;
    await load();
    draw();
    if (keep?.log) {
      const box = main.querySelector('[data-setup-steps]');
      box.querySelector('.sp-log').hidden = false;
      box.querySelector('[data-log]').textContent = keep.log;
      box.querySelector('[data-progress]').textContent = keep.progress ?? '';
    }
  };
  await load();
  draw();

  main.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || !main.contains(b)) return;
    if ('recheck' in b.dataset && !busy) {
      b.setAttribute('aria-busy', 'true');
      await reload().catch((x) => toast(x.message, 'bad'));
    } else if ('copy' in b.dataset && !b.closest('[data-setup-steps]')) {
      navigator.clipboard?.writeText(b.dataset.copy).then(() => toast('Đã copy lệnh'), () => {});
    }
  });
  main.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name !== 'provider' || !t.closest('[data-ai-config]')) return;
    // hiện ô API key / server model theo loại provider vừa chọn
    const p = cfg?.providers?.find((x) => x.id === t.value);
    const f = t.form;
    f.querySelector('[data-ai-key]').hidden = p?.kind !== 'key';
    f.querySelector('[data-ai-local]').hidden = p?.kind !== 'local';
    if (p?.env) f.apiKey.placeholder = `Dán ${p.env}`;
  });
  main.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.matches('[data-ai-config]')) {
      const msg = f.querySelector('[data-ai-msg]');
      if (!f.provider.value) return;
      const chosen = cfg?.providers?.find((x) => x.id === f.provider.value);
      if (chosen?.experimental && f.provider.value !== cfg?.ai?.provider && !(await confirmDialog({ title: 'Dùng Claude Code CLI cho bước agent (thử nghiệm)?', message: 'Chạy agent.act / agent.assert bằng đăng nhập của Claude Code CLI thay cho API key. Lưu ý:', items: chosen.warning, confirmLabel: 'Vẫn dùng claude-code' }))) return;
      try {
        const r = await postJson('/api/system/ai', { provider: f.provider.value, apiKey: f.apiKey.value.trim() || undefined, baseURL: f.baseURL.value.trim() || undefined, modelId: f.modelId.value.trim() || undefined });
        toast(r.changed || r.keySaved ? `Đã lưu model AI${r.keySaved ? ' và API key' : ''}${r.missing.length ? ': bấm Cài tất cả để cài gói' : ''}` : 'Không có gì thay đổi', 'good');
        await reload();
      } catch (x) {
        msg.textContent = x.message.replace(/^\d{3}: /, '');
      }
    } else if (f.matches('[data-e2e-config]')) {
      const msg = f.querySelector('[data-e2e-config-msg]');
      try {
        const r = await postJson('/api/system/e2e-config', readAppFields(f));
        msg.textContent = r.problems.join(' · ');
        toast(r.problems.length ? 'Có mục chưa lưu được, xem lưu ý' : r.changed.length ? `Đã lưu: ${r.changed.join(', ')}` : 'Không có gì thay đổi', r.problems.length ? 'bad' : 'good');
        if (!r.problems.length) await reload();
      } catch (x) {
        msg.textContent = x.message.replace(/^\d{3}: /, '');
      }
    }
  });
}
