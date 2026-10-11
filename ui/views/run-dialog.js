import { postJson, getJson } from '../api.js';
import { escapeHtml } from '../format.js';
import { icon } from '../icons.js';

// Modal to start an e2e run (spec §4.5): tests are file:line, plus targets/agents and run flags.
export function openRunDialog({ tests, targets = [], agents = [], allTargets = targets, allAgents = agents, rerunOf = null, title = 'Chạy test', repeatEach = null }) {
  document.getElementById('run-dialog')?.remove();
  const box = (name, values, checked) => values
    .map((v) => `<label class="pill"><input type="checkbox" name="${name}" value="${escapeHtml(v)}" ${checked.includes(v) ? 'checked' : ''}>${escapeHtml(v)}</label>`)
    .join('');
  const dlg = document.createElement('dialog');
  dlg.id = 'run-dialog';
  dlg.innerHTML = `<form method="dialog" class="run-form">
    <header><h2>${icon('play', { size: 16 })}${escapeHtml(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Đóng">${icon('close')}</button></header>
    <p class="muted">${tests.length ? `${tests.length} test` : 'Toàn bộ suite'}</p>
    ${tests.length ? `<details><summary>Danh sách test</summary><ul class="mono-list">${tests.map((t) => `<li><code>${escapeHtml(t)}</code></li>`).join('')}</ul></details>` : ''}
    ${allTargets.length ? `<fieldset><legend>Target</legend>${box('target', allTargets, targets)}</fieldset>` : ''}
    ${allAgents.length > 1 ? `<fieldset><legend>Agent</legend>${box('agent', allAgents, agents)}</fieldset>` : ''}
    <div class="row">
      <label>Retries <input type="number" name="retries" min="0" max="10" placeholder="theo config"></label>
      <label>Repeat each <input type="number" name="repeatEach" min="1" max="50" placeholder="1"${Number.isInteger(repeatEach) ? ` value="${repeatEach}"` : ''}></label>
      <label class="pill"><input type="checkbox" name="noCache"> --no-cache</label>
    </div>
    <label class="pill" data-q-wrap hidden><input type="checkbox" name="excludeQuarantined" checked> Bỏ qua <span data-q-count></span> test đang cách ly</label>
    <p class="err" hidden></p>
    <footer><button type="button" data-close>Huỷ</button><button type="submit" class="primary">${icon('play', { size: 14 })}Chạy</button></footer>
  </form>`;
  document.body.append(dlg);
  const form = dlg.querySelector('form');
  const err = dlg.querySelector('.err');
  dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dlg.close()));
  dlg.addEventListener('close', () => dlg.remove());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const body = {
      tests,
      targets: fd.getAll('target'),
      agents: allAgents.length > 1 ? fd.getAll('agent') : agents,
      // blank = the project's own config (e.g. its retries), so only what the user typed is sent
      ...(fd.get('retries') !== '' ? { retries: Number(fd.get('retries')) } : {}),
      ...(fd.get('repeatEach') !== '' ? { repeatEach: Number(fd.get('repeatEach')) } : {}),
      noCache: fd.get('noCache') === 'on',
      ...(fd.get('excludeQuarantined') === 'on' && !dlg.querySelector('[data-q-wrap]').hidden ? { excludeQuarantined: true } : {}),
      ...(rerunOf ? { rerunOf } : {}),
    };
    if (!body.targets.length) delete body.targets;
    if (!body.agents?.length) delete body.agents;
    try {
      await postJson('/api/run', body);
      dlg.close();
      location.hash = '#/live';
    } catch (x) {
      err.hidden = false;
      err.textContent = x.message.startsWith('409') ? 'Đang có một run khác chạy — chờ xong hoặc dừng nó ở trang Live.' : `Không chạy được: ${x.message}`;
    }
  });
  dlg.showModal();
  getJson('/api/quarantine').then((q) => {
    const n = q.list.length - q.expired.length;
    if (!n) return;
    dlg.querySelector('[data-q-count]').textContent = String(n);
    dlg.querySelector('[data-q-wrap]').hidden = false;
  }).catch(() => {});
}
