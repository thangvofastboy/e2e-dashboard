import { getJson, postJson } from '../api.js';
import { confirmDialog } from '../confirm.js';
import { toast } from '../toast.js';
import { escapeHtml, fmtRelative } from '../format.js';
import { icon } from '../icons.js';
import { runOptionsHtml, runOptionsFrom } from './run-dialog.js';
import { filterTests } from '../test-picker.js';

// Thứ trong tuần theo Date.getDay(): 0 = Chủ nhật. Hiện từ thứ Hai.
const WEEKDAYS = [[1, 'Thứ 2'], [2, 'Thứ 3'], [3, 'Thứ 4'], [4, 'Thứ 5'], [5, 'Thứ 6'], [6, 'Thứ 7'], [0, 'Chủ nhật']];
const ALL_DAYS = WEEKDAYS.map(([d]) => d);

function scheduleDaysText(days) {
  const set = new Set(days);
  if (set.size === 7) return 'Mỗi ngày';
  if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) return 'Thứ Hai – Thứ Sáu';
  return WEEKDAYS.filter(([d]) => set.has(d)).map(([, l]) => l).join(', ');
}

// Tóm tắt option khác mặc định, để đọc lịch không cần mở form (mỗi phần một mục để dịch được).
function scheduleOptionsParts(o = {}) {
  const parts = [o.tests?.length ? `${o.tests.length} test` : 'Toàn bộ suite'];
  if (o.workers) parts.push(`${o.workers} worker`);
  if (o.browser) parts.push(o.browser);
  if (o.retries !== undefined) parts.push(`retries ${o.retries}`);
  if (o.repeatEach) parts.push(`×${o.repeatEach}`);
  if (o.tag?.length) parts.push(`tag ${o.tag.join(',')}`);
  if (o.grep) parts.push(`grep "${o.grep}"`);
  if (o.noCache) parts.push('--no-cache');
  return parts;
}

const projectName = (projects, root) => projects.find((p) => p.root === root)?.name ?? root.split('/').pop();

export function schedulesPanelHtml(data) {
  const rows = data.schedules.map((s) => `<li class="sched${s.enabled ? '' : ' off'}">
      <div class="sched-main"><div class="sched-title"><strong>${escapeHtml(s.name)}</strong><span class="chip">${icon('folder', { size: 12 })}${escapeHtml(projectName(data.projects, s.root))}</span>${s.enabled ? '' : '<span class="chip">Đang tắt</span>'}</div>
        <div class="small">${escapeHtml(s.times.join(', '))} · <span>${escapeHtml(scheduleDaysText(s.days))}</span>${s.next ? ` · <span>Lần tới:</span> ${escapeHtml(new Date(s.next).toLocaleString('vi-VN'))}` : ''}</div>
        <div class="muted small">${scheduleOptionsParts(s.options).map((x) => `<span>${escapeHtml(x)}</span>`).join(' · ')}</div>
        ${s.lastRun ? `<div class="small"><span>Lần gần nhất:</span> ${escapeHtml(fmtRelative(s.lastRun.at))} · ${s.lastRun.ok ? `đã chạy${Number.isInteger(s.lastRun.exitCode) ? ` (exit ${escapeHtml(s.lastRun.exitCode)})` : ''}` : `<span class="tone-bad">không chạy được (${escapeHtml(s.lastRun.error === 'busy' ? 'đang có run khác' : s.lastRun.error)})</span>`}</div>` : ''}</div>
      <div class="sched-tools">
        <button type="button" data-sched-run="${escapeHtml(s.id)}">${icon('play', { size: 14 })}Chạy ngay</button>
        <button type="button" data-sched-edit="${escapeHtml(s.id)}">${icon('settings', { size: 14 })}Sửa</button>
        <button type="button" class="icon-btn" data-sched-del="${escapeHtml(s.id)}" aria-label="Xoá lịch" title="Xoá lịch">${icon('close', { size: 14 })}</button>
      </div></li>`).join('');
  return `${rows ? `<ul class="sched-list">${rows}</ul>` : '<p class="muted">Chưa có lịch nào tạo trên dashboard.</p>'}
    <button type="button" class="primary" data-sched-add>${icon('plus', { size: 14 })}Thêm lịch chạy</button>`;
}

// Gắn sự kiện cho panel; `refresh` vẽ lại trang sau khi lưu/xoá.
export function bindSchedules(root, data, refresh) {
  const find = (id) => data.schedules.find((s) => s.id === id);
  root.querySelector('[data-sched-add]')?.addEventListener('click', () => openScheduleDialog(data, null, refresh));
  root.querySelectorAll('[data-sched-edit]').forEach((b) => b.addEventListener('click', () => openScheduleDialog(data, find(b.dataset.schedEdit), refresh)));
  root.querySelectorAll('[data-sched-run]').forEach((b) => b.addEventListener('click', async () => {
    const s = find(b.dataset.schedRun);
    const ok = await postJson('/api/schedules/run', { id: s.id }).then(() => true, (x) => toast(x.message.startsWith('409') ? 'Đang có một run khác chạy ở project này' : x.message, 'bad'));
    if (!ok) return;
    if (s.root === data.current) location.hash = '#/live';
    else toast(`Đã chạy lịch "${s.name}" ở project ${projectName(data.projects, s.root)}`);
  }));
  root.querySelectorAll('[data-sched-del]').forEach((b) => b.addEventListener('click', async () => {
    const s = find(b.dataset.schedDel);
    if (!(await confirmDialog({ title: 'Xoá lịch chạy', message: `Xoá lịch "${s.name}"? Run đã chạy vẫn còn trong lịch sử.`, confirmLabel: 'Xoá lịch' }))) return;
    const ok = await postJson('/api/schedules/delete', { id: s.id }).then(() => true, (x) => toast(x.message, 'bad'));
    if (ok) refresh();
  }));
}

function openScheduleDialog(data, sched, refresh) {
  document.getElementById('sched-dialog')?.remove();
  const s = sched ?? { name: '', root: data.current, times: ['02:00'], days: [1, 2, 3, 4, 5], enabled: true, options: {} };
  const o = s.options ?? {};
  const dlg = document.createElement('dialog');
  dlg.id = 'sched-dialog';
  dlg.innerHTML = `<form method="dialog" class="run-form">
    <header><h2>${icon('clock', { size: 16 })}${sched ? 'Sửa lịch chạy' : 'Thêm lịch chạy'}</h2><button type="button" class="icon-btn" data-close aria-label="Đóng">${icon('close')}</button></header>
    <div class="run-grid">
      <label class="fld"><span class="fld-l">Tên lịch</span><input name="name" required maxlength="80" placeholder="Chạy đêm"><small class="fld-hint">Hiện trong danh sách lịch và thông báo.</small></label>
      <label class="fld"><span class="fld-l">Project</span><select name="root">${data.projects.map((p) => `<option value="${escapeHtml(p.root)}">${escapeHtml(p.name)}</option>`).join('')}</select><small class="fld-hint">Thêm project ở trang Projects. Dashboard nào đang mở cũng chạy hộ.</small></label>
    </div>
    <fieldset><legend>Giờ chạy trong ngày</legend><div class="sched-times" data-times></div>
      <span class="sched-add-time"><input type="time" data-time-new value="09:00" aria-label="Giờ mới"><button type="button" data-time-add>${icon('plus', { size: 14 })}Thêm giờ</button></span></fieldset>
    <fieldset><legend>Thứ trong tuần</legend>${WEEKDAYS.map(([d, l]) => `<label class="pill"><input type="checkbox" name="day" value="${d}" ${s.days.includes(d) ? 'checked' : ''}>${l}</label>`).join('')}
      <button type="button" class="link-btn" data-days="all">Mỗi ngày</button><button type="button" class="link-btn" data-days="work">Thứ 2–6</button></fieldset>
    <fieldset><legend>Test sẽ chạy</legend>
      <label class="pill"><input type="radio" name="scope" value="all" ${o.tests?.length ? '' : 'checked'}>Toàn bộ suite</label>
      <label class="pill"><input type="radio" name="scope" value="pick" ${o.tests?.length ? 'checked' : ''}>Chọn test</label>
      <div class="sched-pick" data-pick hidden>
        <div class="sched-pick-head"><input type="search" data-filter placeholder="Lọc theo tên hoặc file" aria-label="Lọc test"><button type="button" class="link-btn" data-pick-all>Chọn hết</button><button type="button" class="link-btn" data-pick-none>Bỏ chọn</button><span class="muted small" data-pick-count></span></div>
        <ul class="sched-tests" data-tests><li class="muted small">Đang tải danh sách test…</li></ul>
        <label class="fld"><span class="fld-l">Thêm test bằng tay</span><textarea name="extra" rows="2" spellcheck="false" placeholder="tests/login.e2e.ts&#10;tests/cart.e2e.ts:42"></textarea><small class="fld-hint">Mỗi dòng một file hoặc file:dòng, cho test chưa có trong lịch sử run.</small></label>
      </div></fieldset>
    ${runOptionsHtml({ updateSnapshots: false, browserDefault: true, browserHint: 'Mặc định: trình duyệt đặt ở Settings của project.', workersHint: 'Số test chạy song song. Để trống = mặc định ở Settings của project, hoặc tự động.' })}
    <label class="pill switch"><input type="checkbox" name="excludeQuarantined" ${o.excludeQuarantined === false ? '' : 'checked'}><span class="track"></span><span>Bỏ qua test đang cách ly</span></label>
    <label class="pill switch"><input type="checkbox" name="enabled" ${s.enabled ? 'checked' : ''}><span class="track"></span><span>Bật lịch</span></label>
    <p class="err" hidden></p>
    <footer><button type="button" data-close>Huỷ</button><button type="submit" class="primary">${icon('check', { size: 14 })}Lưu lịch</button></footer>
  </form>`;
  document.body.append(dlg);
  const form = dlg.querySelector('form');
  const err = dlg.querySelector('.err');
  const el = form.elements;
  el.name.value = s.name;
  el.root.value = s.root;
  if (s.root && el.root.value !== s.root) {
    // project đã gỡ khỏi Projects: không để ô chọn lặng lẽ nhảy sang project khác (lưu là chuyển lịch sang đó)
    el.root.add(new Option(`${s.root} (đã gỡ khỏi Projects)`, s.root));
    el.root.value = s.root;
    err.hidden = false;
    err.textContent = 'Project của lịch này đã bị gỡ khỏi Projects: chọn project khác hoặc thêm lại project rồi lưu.';
  }
  // điền lại option đã lưu khi sửa
  for (const k of ['retries', 'repeatEach', 'workers', 'maxFailures']) if (o[k] !== undefined) el[k].value = String(o[k]);
  for (const k of ['grep', 'shard', 'tagMode', 'trace', 'video']) if (o[k] !== undefined) el[k].value = o[k];
  el.browser.value = o.browser ?? '';
  for (const k of ['tag', 'excludeTag']) if (o[k]) el[k].value = o[k].join(',');
  for (const k of ['noCache', 'strictCache', 'lastFailed', 'aiTrace', 'headed']) if (o[k]) el[k].checked = true;

  const times = new Set(s.times);
  const drawTimes = () => {
    dlg.querySelector('[data-times]').innerHTML = [...times].sort().map((t) => `<span class="chip">${escapeHtml(t)}<button type="button" class="icon-btn" data-time-del="${t}" aria-label="Bỏ giờ ${t}">${icon('close', { size: 12 })}</button></span>`).join('') || '<span class="muted small">Chưa có giờ nào</span>';
    dlg.querySelectorAll('[data-time-del]').forEach((b) => b.addEventListener('click', () => { times.delete(b.dataset.timeDel); drawTimes(); }));
  };
  drawTimes();
  dlg.querySelector('[data-time-add]').addEventListener('click', () => {
    const v = dlg.querySelector('[data-time-new]').value;
    if (/^\d{2}:\d{2}$/.test(v)) times.add(v);
    drawTimes();
  });
  dlg.querySelectorAll('[data-days]').forEach((b) => b.addEventListener('click', () => {
    const on = b.dataset.days === 'all' ? ALL_DAYS : [1, 2, 3, 4, 5];
    form.querySelectorAll('[name=day]').forEach((c) => { c.checked = on.includes(Number(c.value)); });
  }));

  // chọn test: danh sách lấy từ lịch sử run của project đang chọn
  const picked = new Set(o.tests ?? []);
  let known = [];
  const pick = dlg.querySelector('[data-pick]');
  const list = dlg.querySelector('[data-tests]');
  const count = dlg.querySelector('[data-pick-count]');
  const visible = () => {
    // cùng cách lọc với ô chọn test khác: không phân biệt dấu ("gio hang" khớp "Giỏ hàng")
    return filterTests(known, dlg.querySelector('[data-filter]').value);
  };
  const countPicked = () => { count.textContent = `Đã chọn ${picked.size} test`; };
  const drawTests = () => {
    const rows = visible();
    list.innerHTML = rows.length
      ? rows.map((t) => `<li><label><input type="checkbox" value="${escapeHtml(t.spec)}" ${picked.has(t.spec) ? 'checked' : ''}><span>${escapeHtml(t.title)}</span><code class="muted small">${escapeHtml(t.spec)}</code></label></li>`).join('')
      : `<li class="muted small">${known.length ? 'Không có test khớp bộ lọc' : 'Project chưa có run nào: thêm test bằng tay bên dưới hoặc chạy toàn bộ suite.'}</li>`;
    list.querySelectorAll('input').forEach((c) => c.addEventListener('change', () => { if (c.checked) picked.add(c.value); else picked.delete(c.value); countPicked(); }));
    countPicked();
  };
  const loadTests = async () => {
    list.innerHTML = '<li class="muted small">Đang tải danh sách test…</li>';
    const rows = await getJson(`/api/tests?unrun=1&root=${encodeURIComponent(el.root.value)}`).catch(() => []);
    const bySpec = new Map();
    for (const r of rows) {
      const spec = r.line ? `${r.file}:${r.line}` : r.file;
      if (spec && !bySpec.has(spec)) bySpec.set(spec, { spec, file: spec, title: r.title }); // file: để filterTests lọc theo đường dẫn
    }
    known = [...bySpec.values()].sort((a, b) => a.spec.localeCompare(b.spec, undefined, { numeric: true }));
    // test đã lưu nhưng không còn trong lịch sử: đưa vào ô gõ tay để không mất
    const extra = [...picked].filter((t) => !bySpec.has(t));
    if (extra.length && !el.extra.value) el.extra.value = extra.join('\n');
    extra.forEach((t) => picked.delete(t));
    drawTests();
  };
  const showPick = () => { pick.hidden = form.querySelector('[name=scope]:checked').value !== 'pick'; };
  form.querySelectorAll('[name=scope]').forEach((r) => r.addEventListener('change', showPick));
  showPick();
  el.root.addEventListener('change', () => { picked.clear(); el.extra.value = ''; loadTests(); });
  dlg.querySelector('[data-filter]').addEventListener('input', drawTests);
  dlg.querySelector('[data-pick-all]').addEventListener('click', () => { visible().forEach((t) => picked.add(t.spec)); drawTests(); });
  dlg.querySelector('[data-pick-none]').addEventListener('click', () => { picked.clear(); drawTests(); });
  loadTests();

  dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dlg.close()));
  dlg.addEventListener('close', () => dlg.remove());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const options = runOptionsFrom(fd);
    if (!fd.get('browser')) delete options.browser; // theo Settings của project
    if (!options.noCache) delete options.noCache;
    if (fd.get('scope') === 'pick') {
      const extra = String(fd.get('extra') ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
      options.tests = [...new Set([...picked, ...extra])];
      if (!options.tests.length) {
        err.hidden = false;
        err.textContent = 'Chọn ít nhất một test, hoặc chọn Toàn bộ suite.';
        return;
      }
    }
    options.excludeQuarantined = fd.get('excludeQuarantined') === 'on';
    const body = { ...(sched ? { id: sched.id } : {}), name: fd.get('name'), root: fd.get('root'), times: [...times], days: fd.getAll('day').map(Number), enabled: fd.get('enabled') === 'on', options };
    try {
      await postJson('/api/schedules/save', body);
      dlg.close();
      toast(sched ? 'Đã lưu lịch chạy' : 'Đã thêm lịch chạy');
      refresh();
    } catch (x) {
      err.hidden = false;
      err.textContent = `Không lưu được: ${x.message.replace(/^400: /, '')}`;
    }
  });
  dlg.showModal();
}
