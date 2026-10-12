import { getJson, postJson } from '../api.js';
import { pageHead } from '../analysis.js';
import { toast } from '../toast.js';
import { escapeHtml, cap } from '../format.js';
import { icon } from '../icons.js';
import { currentLang, setLang } from '../i18n.js';
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

function appearanceHtml() {
  return `<section class="panel"><h2>${icon('sun', { size: 15 })} Giao diện</h2>
    <p class="muted small">Lưu trên trình duyệt này, không ảnh hưởng người khác.</p>
    <div class="form-row"><span class="form-label">Theme</span>${seg('theme', [['system', 'Theo hệ thống'], ['light', 'Sáng'], ['dark', 'Tối']], storedTheme() ?? 'system', 'Theme')}</div>
    <div class="form-row"><span class="form-label">Cỡ chữ</span>${seg('font', FONT_SCALES, storedFont(), 'Cỡ chữ')}</div>
    <div class="form-row"><span class="form-label">Ngôn ngữ</span>${seg('lang', [['vi', 'Tiếng Việt'], ['en', 'English']], currentLang(), 'Ngôn ngữ')}</div>
  </section>`;
}

function envHtml(env) {
  const files = env.files.map((f) => `<button type="button" class="env-tab" data-env-open="${escapeHtml(f.name)}">${icon('file', { size: 14 })}${escapeHtml(f.name)}
      <span class="muted small">${f.exists ? `${f.bytes} B` : 'Chưa có'}</span>${f.tracked ? '<span class="chip tone-bad">Đang bị git track</span>' : f.ignored === false ? '<span class="chip tone-bad">Chưa gitignore</span>' : ''}</button>`).join('');
  const rows = env.keys.map((k) => `<tr><td><code>${escapeHtml(k.key)}</code></td><td>${chip(k.state)}</td><td class="muted small">${k.from ? escapeHtml(k.from) : '—'}${k.inExample ? '' : ' · không có trong .env.example'}</td></tr>`).join('');
  return `<section class="panel env-panel"><h2>${icon('lock', { size: 15 })} Biến môi trường của project</h2>
    <p class="muted small">Mở file để xem và sửa trực tiếp; bấm Lưu là ghi vào file. <code>.env.local</code> đè <code>.env</code>. File chứa secret được tự thêm vào <code>.gitignore</code>.</p>
    <div class="env-tabs">${files}</div>
    <div class="env-editor" hidden>
      <div class="env-editor-head"><strong data-env-name></strong> <span class="muted small" data-env-note></span>
        <span class="env-actions"><button type="button" data-env-save>${icon('check', { size: 14 })}Lưu</button><button type="button" data-env-close>${icon('close', { size: 14 })}Đóng</button></span></div>
      <textarea class="env-text" spellcheck="false" autocomplete="off" aria-label="Nội dung file env"></textarea>
    </div>
    ${rows ? `<div class="table-wrap env-keys"><table class="table compact"><thead><tr><th>Key</th><th>Trạng thái</th><th>Lấy từ</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">Chưa có key nào (.env / .env.local / .env.example đều trống).</p>'}
  </section>`;
}

function userHtml(u) {
  const hooks = u.webhooks.map((w, i) => `<li><code>${escapeHtml(w.host)}</code> <span class="muted small">${escapeHtml(w.events.join(', '))}</span> <button type="button" class="small-btn" data-hook-del="${i}">${icon('close', { size: 13 })}Xoá</button></li>`).join('');
  return `<section class="panel"><h2>${icon('bolt', { size: 15 })} Key & tích hợp của dashboard</h2>
    <p class="muted small">Lưu ở <code>${escapeHtml(u.path)}</code> (của bạn, không nằm trong repo). Giá trị đã lưu chỉ hiện 4 ký tự cuối.</p>
    <div class="form-row"><span class="form-label">Linear API key</span><span>${u.linear.apiKey ? `<code>${escapeHtml(u.linear.apiKey)}</code>` : '<span class="muted">Chưa đặt</span>'}${u.linear.fromEnv ? ' <span class="chip tone-info">Đang dùng LINEAR_API_KEY từ env</span>' : ''}</span></div>
    <form class="form-row" data-linear-key><input type="password" name="key" placeholder="lin_api_…" autocomplete="off" aria-label="Linear API key mới"><button type="submit">${icon('check', { size: 14 })}Lưu key</button>${u.linear.apiKey ? `<button type="button" data-linear-clear>${icon('close', { size: 14 })}Xoá key</button>` : ''}</form>
    <form class="form-row" data-linear-team><span class="form-label">Linear team</span><input name="team" value="${escapeHtml(u.linear.team)}" placeholder="ENG" aria-label="Linear team"><button type="submit">${icon('check', { size: 14 })}Lưu</button></form>
    <h3 class="small">Webhook (Slack / Discord / JSON)</h3>
    ${hooks ? `<ul class="hook-list">${hooks}</ul>` : '<p class="muted small">Chưa có webhook.</p>'}
    <form class="form-row" data-hook-add><input type="url" name="url" placeholder="https://hooks.slack.com/…" required aria-label="URL webhook">
      ${u.events.map((e) => `<label class="small"><input type="checkbox" name="ev" value="${escapeHtml(e)}" checked> ${escapeHtml(e)}</label>`).join('')}
      <button type="submit">${icon('send', { size: 14 })}Thêm webhook</button></form>
  </section>`;
}

function setupHtml(items) {
  const rows = items.map((x) => `<li class="setup-item"><span class="tone-${x.ok ? 'good' : x.optional ? 'muted' : 'bad'}">${icon(x.ok ? 'check' : x.optional ? 'info' : 'x', { size: 15 })}</span>
      <span><strong>${escapeHtml(x.label)}</strong><br><span class="muted small">${escapeHtml(x.detail)}</span></span></li>`).join('');
  const needs = items.some((x) => !x.ok && x.fix === 'setup');
  return `<section class="panel"><h2>${icon('flask', { size: 15 })} Thiết lập project</h2>
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
      ${x.status === 'awaiting-review' ? `<details class="heal-diff" open><summary class="small">Diff AI đề xuất (branch <code>${escapeHtml(x.branch)}</code>)${x.diffClipped ? ' · đã cắt bớt' : ''}</summary>
        <pre class="small">${escapeHtml(x.diff ?? x.diffStat ?? '')}</pre>
        <div class="form-row"><button type="button" class="primary" data-heal-approve="${escapeHtml(x.fingerprint)}">${icon('check', { size: 14 })}Chạy test & tạo PR</button>
        <button type="button" class="btn-stop" data-heal-reject="${escapeHtml(x.fingerprint)}">${icon('x', { size: 14 })}Bỏ bản sửa</button></div></details>` : ''}
      ${x.note ? `<p class="small tone-bad">${escapeHtml(x.note)}</p>` : ''}</li>`;
  }).join('');
  return `<section class="panel"><h2>${icon('sparkles', { size: 15 })} AI</h2>
    <p class="muted small">Dùng cho mọi tính năng AI của dashboard (phân tích lỗi, tóm tắt run, triage, tự sửa lỗi…) qua <code>claude</code> trên máy này. Để trống = mặc định của Claude Code.</p>
    <form class="form-row" data-ai-model><span class="form-label">Model</span>
      <input name="model" list="ai-models" value="${escapeHtml(aiCfg.model)}" placeholder="mặc định" aria-label="Model AI" autocomplete="off">
      <datalist id="ai-models"><option value="fable"><option value="opus"><option value="sonnet"><option value="haiku"><option value="claude-opus-5-5"><option value="claude-sonnet-5-5"><option value="claude-haiku-5-5"></datalist>
      <button type="submit">${icon('check', { size: 14 })}Lưu</button></form>
    <div class="form-row"><span class="form-label">Effort</span>${seg('effort', [['', 'Mặc định'], ...aiCfg.efforts.map((e) => [e, e === 'xhigh' ? 'XHigh' : cap(e)])], aiCfg.effort, 'Effort')}</div>
    <p class="muted small">Effort cao hơn: suy luận kỹ hơn nhưng chậm và tốn token hơn. Gợi ý: <code>medium</code> cho tóm tắt / triage, <code>high</code> trở lên cho tự sửa lỗi.</p>
    <form data-ai-form class="form-row"><label class="small"><input type="checkbox" name="autoSummary"${aiCfg.autoSummary ? ' checked' : ''}> Tự tóm tắt run có test fail bằng AI (hiện ở trang Live và Run)</label></form>
    <h3 class="small">Tự sửa lỗi dashboard</h3>
    <p class="muted small">Lỗi server (API 500, crash) và lỗi giao diện được ghi lại. Khi bật: AI local (<code>claude</code>) đọc code để xem có phải lỗi của e2e-dashboard không; nếu phải, AI sửa trên branch riêng (git worktree tạm, không đụng thư mục làm việc của bạn, AI không chạy được lệnh) rồi <strong>dừng chờ bạn duyệt diff</strong>. Chỉ khi bạn bấm "Chạy test & tạo PR" dashboard mới chạy <code>npm test</code>, push và mở <strong>PR draft</strong>. Mỗi lỗi một PR.</p>
    <form data-heal-form>
      <div class="form-row"><label class="small"><input type="checkbox" name="enabled"${cfg.enabled ? ' checked' : ''}> Bật tự phân tích, sửa và tạo PR</label></div>
      <div class="form-row"><span class="form-label">Repo e2e-dashboard</span><input name="repo" value="${escapeHtml(cfg.repo)}" placeholder="/home/…/e2e-dashboard" aria-label="Đường dẫn repo e2e-dashboard" style="flex:1"></div>
      <div class="form-row"><span class="form-label">PR tối đa / ngày</span><input type="number" name="maxPerDay" min="1" max="20" value="${escapeHtml(cfg.maxPerDay)}" aria-label="PR tối đa mỗi ngày"><button type="submit">${icon('check', { size: 14 })}Lưu</button></div>
    </form>
    ${rows ? `<ul class="heal-list">${rows}</ul>` : '<p class="muted small">Chưa ghi nhận lỗi nào.</p>'}
  </section>`;
}

function infoHtml(d) {
  return `<section class="panel"><h2>${icon('cpu', { size: 15 })} Hệ thống</h2>
    <table class="table compact keys"><tbody>
      <tr><td>Dashboard</td><td>v${escapeHtml(d.version)}</td></tr>
      <tr><td>Node.js</td><td>${escapeHtml(d.node)}</td></tr>
      <tr><td>Hệ điều hành</td><td>${escapeHtml(d.platform)}</td></tr>
      <tr><td>Project</td><td><code>${escapeHtml(d.projectRoot)}</code></td></tr>
      <tr><td>Dữ liệu dashboard</td><td><code>${escapeHtml(d.dataDir)}</code></td></tr>
    </tbody></table>
    <form class="form-row" data-sqlite><label class="small"><input type="checkbox" name="sqlite"${d.sqlite ? ' checked' : ''}${!d.sqlite && !d.sqliteSupport.ok ? ' disabled' : ''}> Dùng chỉ mục SQLite (nhanh hơn khi lịch sử lớn; mặc định tắt)</label></form>
    ${d.sqliteSupport.ok ? '' : `<p class="small tone-warn">${icon('alert', { size: 13 })} ${escapeHtml(d.sqliteSupport.reason)}</p>`}
    <p class="small"><a href="#/settings">${icon('gauge', { size: 13 })} Số worker, watch, lịch chạy, dung lượng → Tự động & lưu trữ</a></p>
  </section>`;
}

export async function renderSystem(main) {
  let d = await getJson('/api/system');
  let heal = await getJson('/api/selfheal').catch(() => ({ errors: [] }));
  let editing = null; // file env đang mở
  const draw = () => {
    main.innerHTML = `${pageHead('Cài đặt hệ thống', 'settings', 'Giao diện, biến môi trường của project, key của dashboard và tình trạng setup.')}
      <div class="system-grid">${appearanceHtml()}${setupHtml(d.setup)}${envHtml(d.env)}${userHtml(d.user)}${healHtml(heal, d.user.selfHeal, d.user.ai)}${infoHtml(d)}</div>`;
  };
  const reload = async () => {
    [d, heal] = await Promise.all([getJson('/api/system'), getJson('/api/selfheal').catch(() => heal)]);
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

  main.addEventListener('change', (e) => {
    const t = e.target;
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
  main.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.dataset.envOpen) {
        const ta = editor().querySelector('textarea');
        if (editing && ta.value !== ta.dataset.saved && !confirm(`Bỏ thay đổi chưa lưu của ${editing}?`)) return;
        await openEnv(b.dataset.envOpen);
      } else if ('envSave' in b.dataset) await saveEnv();
      else if ('envClose' in b.dataset) {
        const ta = editor().querySelector('textarea');
        if (ta.value !== ta.dataset.saved && !confirm(`Bỏ thay đổi chưa lưu của ${editing}?`)) return;
        editing = null;
        ta.value = ''; // không giữ secret trong DOM khi đã đóng
        editor().hidden = true;
        main.querySelectorAll('[data-env-open]').forEach((x) => x.removeAttribute('aria-pressed'));
      } else if ('linearClear' in b.dataset) {
        await postJson('/api/system/user', { linearApiKey: null });
        toast('Đã xoá Linear API key');
        await reload();
      } else if (b.dataset.hookDel) {
        await postJson('/api/system/user', { removeWebhook: Number(b.dataset.hookDel) });
        toast('Đã xoá webhook');
        await reload();
      } else if (b.dataset.healRetry) {
        await postJson('/api/selfheal/retry', { fingerprint: b.dataset.healRetry });
        toast('Đã đưa vào hàng chờ phân tích');
        await reload();
      } else if (b.dataset.healApprove) {
        if (!confirm('Chạy npm test với bản sửa này trong repo e2e-dashboard, rồi push branch và mở PR draft. Bạn đã đọc diff?')) return;
        b.disabled = true;
        const r = await postJson('/api/selfheal/approve', { fingerprint: b.dataset.healApprove });
        toast(r.ok ? 'Đang chạy test, xong sẽ mở PR draft' : 'Bản sửa không còn chờ duyệt');
        await reload();
      } else if (b.dataset.healReject) {
        if (!confirm('Bỏ bản sửa này và xoá branch local?')) return;
        b.disabled = true;
        await postJson('/api/selfheal/reject', { fingerprint: b.dataset.healReject });
        toast('Đã bỏ bản sửa');
        await reload();
      } else if ('doctor' in b.dataset) {
        if (!confirm('Chạy doctor: chuyển dữ liệu .e2e-dashboard sang bố cục mới (runs theo ngày, state/, runtime/) và dựng lại chỉ mục. Không xoá run nào. Tiếp tục?')) return;
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
