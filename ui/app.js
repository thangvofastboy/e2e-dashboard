import { renderOverview, renderRunsPage } from './views/overview.js';
import { highlight, detectLang, highlightLog } from './highlight.js';
import { renderRun } from './views/run.js';
import { renderLive } from './views/live.js';
import { renderTests } from './views/tests.js';
import { renderFlaky } from './views/flaky.js';
import { renderCompare } from './views/compare.js';
import { renderErrors } from './views/errors.js';
import { renderCost } from './views/cost.js';
import { renderRoutes } from './views/routes.js';
import { renderBranches } from './views/branches.js';
import { renderProjects } from './views/projects.js';
import { renderDigest } from './views/digest.js';
import { LOGO_SVG, MARK_SVG } from './logo.js';
import { renderLocators } from './views/locators.js';
import { renderModels } from './views/models.js';
import { renderLint } from './views/lint.js';
import { openSearch, bindSearchShortcut } from './views/search.js';
import { bindDownloads } from './download.js';
import { renderTest } from './views/test.js';
import { renderAppErrors } from './views/app-errors.js';
import { renderSystem } from './views/system.js';
import { renderFeedback } from './views/feedback.js';
import { renderManual } from './views/manual.js';
import { renderLinearIssues } from './views/linear-issues.js';
import { renderVerify } from './views/verify.js';
import { viewsButton, openViews } from './saved-views.js';
import { renderBuild } from './views/build.js';
import { renderTestQuality } from './views/test-quality.js';
import { renderQcTemplates } from './views/qc-templates.js';
import { renderSettings } from './views/settings.js';
import { openAskPanel } from './views/ai-panel.js';
import { bindShortcuts, setPageKeys, shortcutHelp } from './shortcuts.js';
import { renderCoverage } from './views/coverage.js';
import { renderEnvironment } from './views/environment.js';
import { renderReport } from './views/report.js';
import { renderTrends } from './views/trends.js';
import { renderTriage } from './views/triage.js';
import { renderGroups } from './views/groups.js';
import { renderRelease } from './views/release.js';
import { renderTraceability } from './views/traceability.js';
import { renderLifecycle } from './views/lifecycle.js';
import { initI18n, setLang, currentLang, translate } from './i18n.js';
import { openModal } from './analysis.js';
import { renderMarkdown } from './markdown.js';
import { getJson, postJson, isExport, liveStream } from './api.js';
import { attachTooltips } from './charts.js';
import { escapeHtml } from './format.js';
import { applyPrefs, setTheme, applyHiddenNav } from './prefs.js';
import { iconOnly, storedIconOnly } from './icon-only.js';
import { parseRoute } from './router.js';
import { icon, ICON_SPRITE } from './icons.js';

// [view, href, label, icon]; groups after the first get a heading. Analysis pages need the server.
const NAV = [
  [null, [['overview', '#/', 'Overview', 'grid'], ['runs', '#/runs', 'Runs', 'list'], ['live', '#/live', 'Live', 'activity'], ['tests', '#/tests', 'Tests', 'flask']]],
  ['Theo dõi', [['trends', '#/trends', 'Xu hướng', 'activity'], ['triage', '#/triage', 'Triage lỗi', 'ticket'], ['groups', '#/groups', 'Module / team', 'layers'], ['release', '#/release', 'Phát hành', 'upload'], ['traceability', '#/traceability', 'Truy vết', 'route'], ['lifecycle', '#/lifecycle', 'Vòng đời test', 'recycle'], ['manual', '#/manual', 'Test thủ công', 'flask'], ['linear-issues', '#/linear-issues', 'Issue Linear', 'ticket'],['verify', '#/verify', 'QC xác nhận', 'check'], ['build', '#/build', 'Ma trận build', 'grid']]],
  ['Phân tích', [['flaky', '#/flaky', 'Flaky', 'shuffle'], ['quality', '#/quality', 'Chất lượng test', 'check'], ['errors', '#/errors', 'Nhóm lỗi', 'layers'], ['cost', '#/cost', 'Chi phí & cache', 'coins'], ['routes', '#/routes', 'Bản đồ route', 'route'], ['branches', '#/branches', 'Branch', 'branch'], ['models', '#/models', 'Model & ngân sách', 'cpu'], ['locators', '#/locators', 'Gợi ý locator', 'crosshair'], ['lint', '#/lint', 'Lint agent', 'lint'], ['app-errors', '#/app-errors', 'Lỗi app', 'terminal'], ['coverage', '#/coverage', 'Coverage', 'crosshair'], ['environment', '#/environment', 'Môi trường', 'cpu']]],
  ['Tích hợp', [['projects', '#/projects', 'Projects', 'folder'], ['qc-templates', '#/qc-templates', 'Mẫu prompt QC', 'file'], ['digest', '#/digest', 'Digest tuần', 'newspaper'], ['report', '#/report', 'Báo cáo', 'file'], ['settings', '#/settings', 'Tự động & lưu trữ', 'gauge'], ['system', '#/system', 'Cài đặt hệ thống', 'settings'], ['feedback', '#/feedback', 'Gửi phản hồi', 'send']]],
];
const EXPORT_VIEWS = new Set(['overview', 'runs', 'run']);
const VIEWS = {
  overview: renderOverview, runs: renderRunsPage, run: renderRun, live: renderLive, tests: renderTests,
  flaky: renderFlaky, compare: renderCompare, errors: renderErrors, cost: renderCost, routes: renderRoutes,
  branches: renderBranches, projects: renderProjects, digest: renderDigest, locators: renderLocators, models: renderModels, lint: renderLint,
  test: renderTest, 'app-errors': renderAppErrors, settings: renderSettings, coverage: renderCoverage, environment: renderEnvironment, report: renderReport,
  system: renderSystem, 'qc-templates': renderQcTemplates, quality: renderTestQuality, feedback: renderFeedback, manual: renderManual, 'linear-issues': renderLinearIssues, verify: renderVerify, build: renderBuild, trends: renderTrends, triage: renderTriage, groups: renderGroups, release: renderRelease, traceability: renderTraceability, lifecycle: renderLifecycle,
};
const TITLES = { verify: 'QC xác nhận', 'qc-templates': 'Mẫu prompt QC', quality: 'Chất lượng test', feedback: 'Gửi phản hồi', manual: 'Test thủ công', 'linear-issues': 'Issue Linear', build: 'Ma trận build', overview: 'Overview', runs: 'Runs', run: 'Run', live: 'Live', tests: 'Tests', test: 'Test', compare: 'So sánh', flaky: 'Flaky', errors: 'Nhóm lỗi', cost: 'Chi phí', routes: 'Route', branches: 'Branch', projects: 'Projects', digest: 'Digest', locators: 'Locator', models: 'Model', lint: 'Lint', 'app-errors': 'Lỗi app', settings: 'Cài đặt', coverage: 'Coverage', environment: 'Môi trường', report: 'Báo cáo', trends: 'Xu hướng', triage: 'Triage', groups: 'Module / team', release: 'Phát hành', traceability: 'Truy vết', lifecycle: 'Vòng đời test', system: 'Cài đặt hệ thống' };

// Which nav groups are folded: a per-viewer convenience, so storage failures are fine.
function foldedGroups() {
  try {
    return new Set(JSON.parse(localStorage.getItem('e2ed-nav-folded') ?? '[]'));
  } catch {
    return new Set();
  }
}

function saveFolded(set) {
  try {
    localStorage.setItem('e2ed-nav-folded', JSON.stringify([...set]));
  } catch {
    // storage blocked
  }
}
let cleanup = null;
let lastStatus = null;

// Theme: follows the OS until the viewer picks one; the choice is a per-viewer convenience (ui/prefs.js).
function toggleTheme() {
  const current = document.documentElement.dataset.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  setTheme(current === 'dark' ? 'light' : 'dark');
}

function shell() {
  applyPrefs();
  document.documentElement.classList.toggle('icon-only', storedIconOnly()); // nút chỉ hiện icon (Cài đặt › Giao diện)
  document.body.insertAdjacentHTML('afterbegin', ICON_SPRITE);
  // title: khi menu thu gọn chỉ còn icon, rê chuột vẫn thấy tên trang
  const link = ([v, href, label, ic]) => `<a href="${href}" data-nav="${v}" class="n-${v}" title="${label}"><span class="ni">${icon(ic)}</span><span class="nl">${label}</span>${v === 'live' ? '<span class="live-dot" aria-label="đang chạy"></span>' : ''}</a>`;
  const folded = foldedGroups();
  const nav = NAV.map(([group, items]) => {
    const shown = items.filter(([v]) => !isExport() || EXPORT_VIEWS.has(v));
    if (!shown.length) return '';
    if (!group) return shown.map(link).join('');
    return `<details class="nav-sec" data-group="${group}" ${folded.has(group) ? '' : 'open'}><summary class="nav-group">${group}</summary>${shown.map(link).join('')}</details>`;
  }).join('');
  document.querySelector('link[rel="icon"]')?.setAttribute('href', `data:image/svg+xml,${encodeURIComponent(MARK_SVG)}`);
  document.getElementById('app').innerHTML = `
    <aside class="nav">
      <div class="nav-top"><a class="brand" href="#/"><span class="logo">${LOGO_SVG}</span><span class="brand-text">e2e <span>dashboard</span></span></a>
        <button type="button" class="icon-btn nav-collapse" aria-pressed="false" aria-label="Thu gọn menu" title="Thu gọn menu">${icon('columns', { size: 16 })}</button>
        <button type="button" class="icon-btn nav-toggle" aria-expanded="false" aria-controls="nav-body" aria-label="Mở menu">${icon('list', { size: 18 })}</button></div>
      <div class="nav-body" id="nav-body">
      ${isExport() ? '' : `<div class="nav-tools"><button type="button" class="nav-search" data-search title="Tìm kiếm (Ctrl K)">${icon('search', { size: 15 })}<span class="nl">Tìm kiếm</span> <kbd>Ctrl K</kbd></button></div>`}
      <nav aria-label="Điều hướng">${nav}</nav>
      <div class="nav-foot"><div class="foot-btns"><button class="theme-toggle" type="button" aria-label="Chuyển giao diện sáng / tối" title="Sáng / Tối">${icon('sun')}<span class="nl">Sáng / Tối</span></button>${isExport() ? '' : `<button type="button" class="icon-btn" data-keys title="Phím tắt (?)" aria-label="Phím tắt">${icon('bolt', { size: 15 })}</button>`}<button type="button" class="icon-btn lang-btn" data-lang title="Tiếng Việt / English" aria-label="Ngôn ngữ">${currentLang() === 'en' ? 'VI' : 'EN'}</button></div><div id="nav-foot"></div></div>
      </div>
    </aside>
    <main id="main" tabindex="-1"></main>`;
  applyHiddenNav(); // mục menu đã ẩn ở Cài đặt hệ thống → Giao diện
  document.querySelector('.theme-toggle').addEventListener('click', toggleTheme);
  // thu gọn menu trái (desktop): chỉ còn icon; nhớ lựa chọn trên trình duyệt này
  const collapse = document.querySelector('.nav-collapse');
  const setCollapsed = (on) => {
    document.body.classList.toggle('nav-collapsed', on);
    // dải icon: mọi nhóm mở (nhóm gập thì các trang của nó biến mất); mở rộng lại thì trả trạng thái gập đã lưu
    const folded = foldedGroups();
    for (const sec of document.querySelectorAll('.nav-sec')) sec.open = on || !folded.has(sec.dataset.group);
    collapse.setAttribute('aria-pressed', String(on));
    const label = on ? 'Mở rộng menu' : 'Thu gọn menu';
    collapse.setAttribute('aria-label', label);
    collapse.title = label;
  };
  let collapsedPref = false;
  try {
    collapsedPref = localStorage.getItem('e2ed-nav-collapsed') === '1';
  } catch {
    // storage bị chặn
  }
  setCollapsed(collapsedPref);
  collapse.addEventListener('click', () => {
    const on = !document.body.classList.contains('nav-collapsed');
    setCollapsed(on);
    try {
      localStorage.setItem('e2ed-nav-collapsed', on ? '1' : '0');
    } catch {
      // storage bị chặn: chỉ trong lần mở này
    }
  });
  document.querySelector('[data-search]')?.addEventListener('click', openSearch);
  // Hỏi AI: nút tròn nổi góc phải dưới (ẩn khi khung AI đang mở, xem style.css .ai-fab); bản export chỉ đọc nên không có
  if (!isExport()) document.body.insertAdjacentHTML('beforeend', `<button type="button" class="ai-fab" data-ask title="Hỏi AI về bộ test" aria-label="Hỏi AI về bộ test">${icon('sparkles', { size: 22 })}</button>`);
  document.querySelector('[data-ask]')?.addEventListener('click', openAskPanel);
  document.querySelector('[data-keys]')?.addEventListener('click', shortcutHelp);
  document.querySelector('[data-lang]').addEventListener('click', () => setLang(currentLang() === 'en' ? 'vi' : 'en'));
  const toggle = document.querySelector('.nav-toggle');
  toggle.addEventListener('click', () => {
    const open = document.body.classList.toggle('nav-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  document.querySelectorAll('.nav-sec').forEach((d) =>
    d.addEventListener('toggle', () => {
      if (document.body.classList.contains('nav-collapsed')) return; // dải icon tự mở mọi nhóm: không ghi đè trạng thái gập đã lưu
      const f = foldedGroups();
      if (d.open) f.delete(d.dataset.group);
      else f.add(d.dataset.group);
      saveFolded(f);
    }));
  // a "Thêm" menu closes on any click outside it, and on Escape
  document.addEventListener('click', (e) => document.querySelectorAll('details.more[open]').forEach((d) => !d.contains(e.target) && d.removeAttribute('open')));
  document.addEventListener('keydown', (e) => e.key === 'Escape' && document.querySelectorAll('details.more[open]').forEach((d) => d.removeAttribute('open')));
  if (!isExport()) {
    bindSearchShortcut();
bindDownloads();
    bindShortcuts({ onSearch: openSearch });
  }
}

async function footer() {
  const el = document.getElementById('nav-foot');
  if (isExport()) {
    el.innerHTML = `Bản export · ${escapeHtml(new Date(globalThis.__E2ED_EXPORT__.exportedAt).toLocaleString('vi-VN'))}`;
    return;
  }
  const info = await getJson('/api/info').catch(() => null);
  if (!info) return;
  const r = info.reporter;
  const hint = !r.installed
    ? '<p class="hint">Chưa cài reporter — chạy <code>/e2e-dashboard setup</code> để xem live.</p>'
    : r.version !== r.latest
      ? `<p class="hint">Reporter trong project là ${escapeHtml(r.version)}, bản mới là ${escapeHtml(r.latest)} — chạy lại <code>/e2e-dashboard setup</code>.</p>`
      : '';
  const skipped = info.lastArchive?.status === 'skipped' && info.lastArchive.reason !== 'no-report'
    ? `<p class="hint">Report gần nhất không được lưu: ${escapeHtml(info.lastArchive.reason)}.</p>`
    : '';
  el.innerHTML = `<div class="muted">${escapeHtml(info.project)} · v${escapeHtml(info.version)} · <a href="#" data-whatsnew>Có gì mới</a></div>${hint}${skipped}`;
  el.querySelector('[data-whatsnew]').addEventListener('click', (e) => {
    e.preventDefault();
    whatsNew(info.version, true);
  });
  whatsNew(info.version, false);
}

let routeSeq = 0;

// "What's new": once after each update (per viewer), or on demand from the footer link.
async function whatsNew(version, force) {
  let seen = null;
  try {
    seen = localStorage.getItem('e2ed-seen-version');
    localStorage.setItem('e2ed-seen-version', version);
  } catch {
    if (!force) return; // no storage: never nag on every load
  }
  if (!force && (!seen || seen === version)) return; // first visit or nothing new
  const { entries } = await getJson('/api/changelog').catch(() => ({ entries: [] }));
  const fresh = force ? entries.slice(0, 3) : entries.filter((e) => cmpVersion(e.version, seen) > 0);
  if (!fresh.length) return;
  openModal('whatsnew-dialog', 'Có gì mới', 'sparkles', `<div class="md whatsnew">${fresh.map((e) => `<h2>v${escapeHtml(e.version)}${e.date ? ` <span class="muted small">${escapeHtml(e.date)}</span>` : ''}</h2>${renderMarkdown(e.body)}`).join('')}</div>`);
}

function cmpVersion(a, b) {
  const x = String(a).split('.').map(Number);
  const y = String(b ?? '0.0.0').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
}

async function route() {
  cleanup?.();
  cleanup = null;
  const seq = ++routeSeq;
  const r = parseRoute(location.hash);
  const active = r.view === 'run' || r.view === 'compare' ? 'runs' : r.view === 'test' ? 'tests' : r.view;
  document.querySelectorAll('[data-nav]').forEach((a) => {
    a.classList.toggle('active', a.dataset.nav === active);
    if (a.dataset.nav === active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const sec = document.querySelector(`[data-nav="${active}"]`)?.closest('.nav-sec');
  if (sec) sec.open = true; // never hide the page you are on
  document.body.classList.remove('nav-open');
  document.title = `${TITLES[r.view] ?? 'e2e'} · e2e dashboard`;
  setPageKeys({});
  // a fresh <main> per navigation: a slower page still loading writes into its own detached element,
  // never over the page the viewer moved to
  const main = document.getElementById('main').cloneNode(false);
  main.dataset.view = r.view; // chú giải + nút phóng to theo trang (enhance)
  document.getElementById('main').replaceWith(main);
  attachTooltips(main);
  main.innerHTML = '<div class="skeleton" aria-busy="true" aria-label="Đang tải"><i class="sk-h"></i><i class="sk-row"></i><i class="sk-row"></i><i class="sk-block"></i></div>';
  try {
    const render = isExport() && !EXPORT_VIEWS.has(r.view) ? null : VIEWS[r.view];
    if (!render) main.innerHTML = '<p>Không tìm thấy trang. <a href="#/">Về Overview</a></p>';
    else {
      const done = (await render(main, r)) ?? null;
      if (seq === routeSeq) {
        cleanup = done;
        main.querySelector('h1')?.setAttribute('tabindex', '-1');
        if (document.activeElement === document.body || !main.contains(document.activeElement)) (main.querySelector('h1') ?? main).focus({ preventScroll: true });
      } else done?.(); // left before it finished loading
    }
  } catch (e) {
    if (seq === routeSeq) {
      main.innerHTML = `<div class="empty-state"><h2>${icon('alert', { size: 18 })} Không tải được trang</h2><p class="error">${escapeHtml(e.message)}</p><p><button type="button" class="primary" data-retry>${icon('recycle', { size: 14 })}Thử lại</button></p></div>`;
      main.querySelector('[data-retry]').addEventListener('click', route);
    }
  }
}

// Nav badge while a run is live; refresh list pages when it finishes.
// "Đang chạy 3/9", visible from every page but Live (the sidebar is folded away on mobile)
let lastSnap = null;
function syncPill() {
  if (isExport()) return;
  let pill = document.getElementById('run-pill');
  if (!pill) {
    pill = Object.assign(document.createElement('a'), { id: 'run-pill', href: '#/live', hidden: true });
    document.body.append(pill);
  }
  const s = lastSnap;
  pill.hidden = s?.status !== 'running' || parseRoute(location.hash).view === 'live';
  document.documentElement.toggleAttribute('data-pill', !pill.hidden); // style.css leaves room under the page for it
  if (s) pill.innerHTML = `<span class="pill-dot"></span>${translate('Đang chạy')}${Number(s.total) > 0 ? ` <b>${Number(s.done) || 0}/${Number(s.total)}</b>` : ''}`;
}

function watchLive() {
  liveStream((s) => {
    const running = s.status === 'running';
    const liveLink = document.querySelector('[data-nav="live"]');
    liveLink?.classList.toggle('is-running', running);
    lastSnap = s;
    syncPill();
    if (lastStatus === 'running' && s.status !== 'running') {
      const view = parseRoute(location.hash).view;
      // give archive() time to finish; người xem đã sang trang khác trong lúc chờ thì không vẽ lại trang đó (mất chữ đang gõ)
      if (['overview', 'runs', 'tests', 'flaky', 'errors', 'cost'].includes(view)) setTimeout(() => parseRoute(location.hash).view === view && route(), 1500);
    }
    lastStatus = s.status;
  }, { lite: true });
}

// Views render HTML strings; this pass fixes up what CSS alone cannot:
// - SVG charts scale with their card, so --k keeps axis text about 11px on screen at any width
// - wide tables scroll inside a wrapper instead of stretching the page
const chartSize = new ResizeObserver((entries) => {
  for (const e of entries) {
    if (!e.target.isConnected) chartSize.unobserve(e.target); // removed with its page: do not keep it alive
    else if (e.contentRect.width) e.target.style.setProperty('--k', String(Math.min(2.2, Math.max(0.6, 600 / e.contentRect.width))));
  }
});
// Report-style tables: numbers right-aligned in bold, and the columns that judge quality coloured —
// pass rate by threshold (≥95% good, ≥80% warn, else bad), fail/flaky counts red/amber when above 0.
const NUM_CELL = /^[+−-]?\d[\d.,]*\s*(?:%|ms|s|m\d+s|h\d+m|KB|MB|GB|B|k|M|tok)?$/;
function scoreTable(t) {
  t.dataset.scored = '';
  const heads = [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim().toLowerCase());
  const judge = heads.map((h) => (/pass/.test(h) ? 'rate' : /fail|lỗi|error/.test(h) ? 'bad' : /flaky|bất thường/.test(h) ? 'warn' : null));
  const numeric = heads.map(() => ({ num: 0, other: 0 }));
  for (const tr of t.querySelectorAll('tbody tr')) {
    [...tr.children].forEach((td, i) => {
      const text = td.textContent.trim();
      if (!text) return;
      if (td.querySelector('a, button, select, input, .chip, .cnt') || !NUM_CELL.test(text)) return void (numeric[i] && numeric[i].other++);
      const v = Number.parseFloat(text.replace(',', '.').replace('−', '-'));
      if (!td.querySelector('.meter')) td.classList.add('num'); // meters stay left-aligned under their header
      if (numeric[i]) numeric[i][td.querySelector('.meter') ? 'other' : 'num']++;
      if (judge[i] === 'rate' && text.endsWith('%')) td.classList.add(v >= 95 ? 'v-good' : v >= 80 ? 'v-warn' : 'v-bad');
      else if (judge[i] === 'bad' && text.endsWith('%')) td.classList.add(v >= 20 ? 'v-bad' : v > 0 ? 'v-warn' : 'v-zero'); // a fail rate, not a count
      else if (judge[i] === 'bad' || judge[i] === 'warn') td.classList.add(v > 0 ? `v-${judge[i]}` : 'v-zero');
    });
  }
  t.querySelectorAll('thead th').forEach((th, i) => numeric[i]?.num && !numeric[i].other && th.classList.add('num'));
}
// "2 test fail chưa ai nhận" → the 2 in bold: the number is what the eye looks for (text nodes only, no HTML)
function boldNumbers(el) {
  el.dataset.nums = '';
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) if (/\d/.test(walker.currentNode.nodeValue) && !walker.currentNode.parentElement.closest('b, strong, code, a')) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const parts = n.nodeValue.split(/([+−-]?\s?\d[\d.,]*%?)/);
    if (parts.length < 2) continue;
    const span = document.createElement('span'); // one flex item, as the text node was
    span.append(...parts.map((p, i) => (i % 2 ? Object.assign(document.createElement('b'), { textContent: p }) : p)));
    n.replaceWith(span);
  }
}

// Bảng / danh sách dài: chỉ hiện `page` mục đầu + nút "Hiện thêm" / "Hiện tất cả", để trang không dài nhiều màn hình.
// Filter trong view render lại phần tử mới nên trạng thái mở rộng tự reset.
// Dòng view chèn thêm sau này (vd. .visual-row ở compare.js) ẩn/hiện theo mục đứng ngay trước nó.
function pageItems(el, items, page) {
  el.dataset.paged = '';
  if (items.length <= page + 5) return; // dư vài mục thì hiện luôn, khỏi bấm
  let shown = page;
  const index = new Map(items.map((r, i) => [r, i]));
  const current = () => (el.tBodies ? [...el.tBodies].flatMap((b) => [...b.rows]) : [...el.children]);
  const bar = document.createElement('div');
  bar.className = 'table-more';
  const sync = () => {
    let hide = false;
    for (const r of current()) {
      if (index.has(r)) hide = index.get(r) >= shown;
      r.classList.toggle('row-hidden', hide);
    }
    const left = items.length - shown;
    bar.innerHTML = left > 0
      ? `<span class="muted small">${shown}/${items.length}</span><button type="button" data-more>Hiện thêm ${Math.min(page, left)}</button><button type="button" data-all>Hiện tất cả</button>`
      : `<span class="muted small">${items.length}</span><button type="button" data-less>Thu gọn</button>`;
  };
  bar.addEventListener('click', (e) => {
    if (e.target.closest('[data-more]')) shown += page;
    else if (e.target.closest('[data-all]')) shown = items.length;
    else if (e.target.closest('[data-less]')) {
      shown = page;
      el.scrollIntoView({ block: 'start' });
    } else return;
    sync();
  });
  sync();
  (el.closest('.table-wrap') ?? el).after(bar);
}

const FENCE_LANG = { json: 'json', js: 'js', javascript: 'js', ts: 'js', typescript: 'js', tsx: 'js', jsx: 'js', sh: 'shell', bash: 'shell', shell: 'shell', console: 'shell', zsh: 'shell' };
function enhance(root) {
  // colour code, JSON, commands and logs wherever a view put them (highlight.js escapes everything)
  for (const pre of root.querySelectorAll('pre.log:not([data-hl])')) {
    pre.dataset.hl = '';
    pre.innerHTML = highlightLog(pre.textContent);
  }
  for (const code of root.querySelectorAll('pre > code:not([data-hl])')) {
    code.dataset.hl = '';
    const text = code.textContent;
    code.innerHTML = highlight(text, FENCE_LANG[/language-([\w+-]+)/.exec(code.className)?.[1]] ?? detectLang(text), { pretty: true });
  }
  for (const code of root.querySelectorAll(':not(pre) > code:not([data-hl])')) {
    code.dataset.hl = '';
    const lang = detectLang(code.textContent);
    if (lang !== 'text') code.innerHTML = highlight(code.textContent, lang);
  }
  for (const svg of root.querySelectorAll('svg.chart:not([data-fit])')) {
    svg.dataset.fit = '';
    chartSize.observe(svg);
  }
  for (const t of root.querySelectorAll('table.table:not([data-scored])')) scoreTable(t);
  for (const b of root.querySelectorAll('.banner:not([data-nums]), .kpi-sub:not([data-nums])')) boldNumbers(b);
  for (const t of root.querySelectorAll('table.table:not(.keys)')) {
    if (t.parentElement?.classList.contains('table-wrap')) continue;
    const w = document.createElement('div');
    w.className = 'table-wrap auto-wrap';
    t.replaceWith(w);
    w.append(t);
  }
  for (const t of root.querySelectorAll('table.table:not([data-paged])')) pageItems(t, [...t.tBodies].flatMap((b) => [...b.rows]), 25);
  for (const u of root.querySelectorAll('ul.life-list:not([data-paged]), ul.eg-tests:not([data-paged])')) pageItems(u, [...u.children], 10);
  markFill(document.getElementById('main'));
  pageExtras(document.getElementById('main'));
}

// Chú giải từng trang (ⓘ cạnh tiêu đề) và từng chart (ⓘ cạnh tên chart): rê chuột hoặc Tab tới để đọc.
const PAGE_HELP = {
  overview: 'Tổng quan sức khoẻ bộ test: điểm health 0–100, KPI của run gần nhất so với trung bình, xu hướng theo run và test chậm nhất. Bấm vào một run để xem chi tiết.',
  runs: 'Mọi run đã lưu, mới nhất trước. Lọc theo nguồn (terminal, CI, dashboard), tích 2 run để so sánh, xuất CSV.',
  run: 'Chi tiết một run: kết quả từng test, step, ảnh / video / trace lúc fail, nhóm lỗi và bất thường so với lịch sử.',
  live: 'Run đang chạy theo thời gian thực: mỗi hàng của gantt là một làn chạy song song; bấm một đoạn để xem step của test đó. Banner đỏ là lỗi gốc cần sửa trước.',
  tests: 'Từng test với lịch sử 10 run gần nhất, pass rate và thời gian trung bình. Lọc theo tên, tag, target; bấm tên test để xem chi tiết.',
  test: 'Lịch sử một test: pass rate, thời gian và token theo run, các lần fail và step ở run gần nhất. Có thể chạy lại riêng test này.',
  compare: 'So sánh hai run: test đổi kết quả, chậm đi / nhanh lên, lỗi mới.',
  trends: 'Số liệu dài hạn (30–365 ngày): pass rate theo ngày, lịch 12 tháng, test fail lâu nhất, thời gian đỏ và MTTR theo tuần, sự kiện (deploy, release…).',
  triage: 'Xử lý test fail: đặt trạng thái Mới → Đang xem → Đã biết → Đã sửa / Bỏ qua, người phụ trách, ghi chú. Fail lại đúng lỗi cũ thì giữ trạng thái.',
  groups: 'Kết quả gom theo module / team (theo thư mục hoặc CODEOWNERS): pass rate, flaky, test đang fail của từng nhóm.',
  release: 'Đánh giá một bản phát hành: test fail / flaky mới so với bản trước, có nên phát hành hay không.',
  traceability: 'Truy vết yêu cầu (story / ticket) tới test: yêu cầu nào đã có test, test nào đang fail.',
  lifecycle: 'Vòng đời test: test mới, bị bỏ, đổi tên, luôn fail; số test theo ngày và tuổi của từng test.',
  'qc-templates': 'Mẫu prompt để AI viết bug report, báo cáo hoặc mô tả Linear từ dữ liệu của test hoặc run.',
  quality: 'Chấm điểm từng test, tìm test trùng và đề nghị tách / gộp; Claude Code làm phần sửa mã.',
  verify: 'Bug đã biết có vẻ đã sửa chờ bạn xác nhận; waiver có hạn cho lỗi chưa sửa kịp; nhật ký ai đổi gì.',
  manual: 'Ca QC chạy tay, ghi kết quả từng lần; thống kê gộp với test tự động.',
  'linear-issues': 'Issue Linear được giao cho bạn: AI đề xuất testcase, bạn sửa rồi Gen file e2e.',
  build: 'Cùng một test qua các build (branch@commit); hàng đổi kết quả được đánh dấu.',
  feedback: 'Góp ý hoặc báo lỗi về e2e-dashboard, đăng thành issue trên GitHub của dự án.',
  flaky: 'Test lúc pass lúc fail: điểm flaky càng cao càng thất thường. Cách ly tạm một test để không làm đỏ cả suite.',
  errors: 'Các test fail cùng một dạng lỗi được gom thành nhóm: sửa một nguyên nhân là xanh nhiều test.',
  cost: 'Token và chi phí model theo run, tỉ lệ replay cache của agent.act (cao = nhanh và rẻ), lý do không replay được, step / test tốn nhất.',
  routes: 'Bản đồ các trang app mà test đã đi qua và các bước chuyển giữa chúng.',
  branches: 'So sánh kết quả giữa các branch: branch nào đỏ hơn main, test nào chỉ fail trên một branch.',
  models: 'Token theo model và vai trò, so với ngân sách đặt trong config.',
  locators: 'Gợi ý chuyển bước agent.act hay đổi / chậm thành locator cố định để chạy nhanh và ổn định hơn.',
  lint: 'Các bước agent mô tả mơ hồ hoặc dễ hỏng, kèm luật và cách viết lại.',
  'app-errors': 'Lỗi phía app (console, request lỗi) ghi nhận trong lúc test chạy, gom theo chữ ký lỗi.',
  coverage: 'Trang nào của app chưa có test: so route trong source với route test đã đi qua. Bấm "Viết test" để nhờ AI viết.',
  environment: 'Kết quả theo môi trường (trình duyệt, OS, máy chạy): lỗi chỉ xảy ra ở một môi trường.',
  projects: 'Mọi project đã mở dashboard trên máy này, kèm tình trạng gần nhất.',
  digest: 'Tóm tắt tuần để gửi team: số run, pass rate, test mới fail, flaky.',
  report: 'Báo cáo in được (In / Lưu PDF) và xuất CSV; đặt lịch gửi báo cáo tuần / tháng.',
  system: 'Cài đặt chung: theme, cỡ chữ, ngôn ngữ; xem và sửa trực tiếp .env / .env.local của project; Linear API key, webhook; kiểm tra và chạy setup.',
  settings: 'Số worker khi chạy test, chế độ watch, lịch chạy, webhook, cảnh báo, dung lượng lịch sử và đồng bộ từ CI.',
};
const CHART_HELP = {
  'Pass rate theo run': 'Tỉ lệ test pass ở mỗi run (flaky tính là pass, skip không tính). Cờ trên trục là sự kiện deploy / release.',
  'Run gần nhất': 'Phân bổ kết quả của run mới nhất; số lớn là pass rate.',
  'Kết quả theo run': 'Số test pass / flaky / fail / skip của từng run, cũ → mới.',
  'Thời gian chạy': 'Tổng thời gian mỗi run. Tăng đột ngột thường do test treo hoặc cache không replay.',
  'Token theo run': 'Token model dùng mỗi run (vào + ra). Giảm khi replay cache tốt.',
  'Test chậm nhất (trung bình)': 'Thời gian trung bình của các test chậm nhất trong 10 run gần nhất.',
  'Test × 10 run gần nhất (cũ → mới)': 'Mỗi ô là kết quả một test ở một run; hàng nhiều ô đỏ / vàng là test cần xem.',
  'Kết quả cache của agent.act': 'agent.act chạy lại từ cache (nhanh, không gọi model) hay phải gọi model.',
  'Vì sao không replay được': 'Lý do bước agent.act không dùng được cache, nhiều nhất trước.',
  'Thời gian theo giai đoạn': 'Tỉ lệ thời gian dành cho setup, beforeEach, afterEach và thân test.',
};
const helpBtn = (text) => `<button type="button" class="icon-btn help-tip" data-tip="${escapeHtml(text)}" aria-label="Chú giải" aria-description="${escapeHtml(text)}">${icon('info', { size: 14 })}</button>`;
const fsBtn = (page) => `<button type="button" class="icon-btn fs-btn${page ? ' fs-page' : ''}" data-tip="${page ? 'Cả trang toàn màn hình' : 'Phóng to toàn màn hình'} (Esc để thoát)" aria-label="Phóng to toàn màn hình">${icon('expand', { size: 14 })}</button>`;
const MAXABLE = '.charts > figure, #main > section.panel, #main > .fill, .two-col > .panel, .ov-top > .health-score, .run-summary';
function pageExtras(main) {
  if (!main || isExport()) return;
  iconOnly(main); // chữ của nút có icon → .btn-label (ẩn khi bật "Nút chỉ hiện icon"), hover hiện data-tip
  const h1 = main.querySelector('h1');
  // trang chưa có mô tả hiển thị: dùng chú giải của trang làm mô tả ngay dưới tiêu đề
  if (h1 && PAGE_HELP[main.dataset.view] && !main.querySelector('.page-head p, .page-desc')) h1.insertAdjacentHTML('afterend', `<p class="page-desc">${escapeHtml(PAGE_HELP[main.dataset.view])}</p>`);
  if (h1 && !h1.querySelector('.help-tip, .fs-page, .views-btn')) {
    if (PAGE_HELP[main.dataset.view]) h1.insertAdjacentHTML('beforeend', helpBtn(PAGE_HELP[main.dataset.view]));
    h1.insertAdjacentHTML('beforeend', viewsButton());
    if (document.fullscreenEnabled) h1.insertAdjacentHTML('beforeend', fsBtn(true));
  }
  for (const cap of main.querySelectorAll('figcaption:not([data-help])')) {
    cap.dataset.help = '';
    const text = CHART_HELP[cap.textContent.trim()];
    if (text) cap.insertAdjacentHTML('beforeend', helpBtn(text));
  }
  // Live dựng lại DOM mỗi snapshot: phóng to từng khối sẽ bị thoát ngay, chỉ dùng nút cả trang
  if (!document.fullscreenEnabled || main.dataset.view === 'live') return;
  for (const el of main.querySelectorAll(MAXABLE)) if (!el.querySelector(':scope > .fs-btn')) el.insertAdjacentHTML('beforeend', fsBtn(false));
}
// phần tử fullscreen che mọi thứ ngoài nó: mang toast và tooltip vào trong, thoát thì trả về body
document.addEventListener('fullscreenchange', () => {
  const host = document.fullscreenElement ?? document.body;
  for (const id of ['toasts', 'chart-tip']) {
    const el = document.getElementById(id);
    if (el && el.parentElement !== host) host.append(el);
  }
});
document.addEventListener('click', (e) => {
  if (e.target.closest('.views-btn')) return openViews();
  const b = e.target.closest('.fs-btn');
  if (!b) return;
  const el = b.classList.contains('fs-page') ? document.getElementById('main') : b.parentElement;
  if (document.fullscreenElement === el) document.exitFullscreen();
  else el.requestFullscreen?.().catch(() => {});
});

// Trang vừa một màn hình: khối dữ liệu chính (bảng, danh sách…) giãn lấp phần còn lại và cuộn bên trong (style.css .fill)
const FILL = '.table-wrap, .err-groups, section.locs, section.projects, .empty-state, article.digest, section.fill-me, #main > section.panel:last-child';
function markFill(main) {
  if (!main || main.querySelector(':scope > .fill')) return;
  (main.querySelector(':scope > .fill-me') ?? [...main.children].filter((e) => e.matches(FILL)).at(-1))?.classList.add('fill');
}

if (isExport() && !location.hash) location.hash = `#/run/${encodeURIComponent(globalThis.__E2ED_EXPORT__.runId)}`;
initI18n(); // before shell(): the VI/EN button label reads the stored language
// created after initI18n's observer, so English translation sees whole strings before boldNumbers splits them;
// the tooltip and the run pill change on every mouse move / snapshot and never hold anything to enhance
new MutationObserver((ms) => {
  if (ms.every((m) => m.target.closest?.('#chart-tip, #run-pill'))) return;
  enhance(document.body);
  // nút sinh ra sau lần vẽ trang (Live, kết quả AI, nút Copy trả lại nội dung): cũng chỉ hiện icon; nút đã bọc thì không đổi DOM nữa
  const main = document.getElementById('main');
  if (main && !isExport()) iconOnly(main);
}).observe(document.body, { childList: true, subtree: true });
// Lỗi JS của giao diện → server ghi lại cho tự sửa lỗi (trang Cài đặt hệ thống). Mỗi lỗi gửi một lần / lần tải trang, tối đa 5.
const sentErrors = new Set();
function reportUiError(err, fallback) {
  if (isExport()) return;
  const message = String(err?.message ?? fallback ?? err ?? '').slice(0, 1000);
  // "401: …" / "500: …" là lỗi HTTP: server đã ghi phía nó, mất kết nối thì không phải lỗi code
  if (!message || /^\d{3}: /.test(message) || /Failed to fetch|NetworkError|Load failed/.test(message) || sentErrors.has(message) || sentErrors.size >= 5) return;
  sentErrors.add(message);
  postJson('/api/app-error', { message, stack: String(err?.stack ?? '').slice(0, 3000), route: location.hash.split('?')[0] }).catch(() => {});
}
window.addEventListener('error', (e) => reportUiError(e.error, e.message));
window.addEventListener('unhandledrejection', (e) => reportUiError(e.reason));
shell();
footer();
watchLive();
window.addEventListener('hashchange', route);
window.addEventListener('hashchange', syncPill);
route();
