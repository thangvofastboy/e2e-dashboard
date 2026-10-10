import { renderOverview, renderRunsPage } from './views/overview.js';
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
import { renderLocators } from './views/locators.js';
import { renderModels } from './views/models.js';
import { renderLint } from './views/lint.js';
import { openSearch, bindSearchShortcut } from './views/search.js';
import { renderTest } from './views/test.js';
import { renderAppErrors } from './views/app-errors.js';
import { renderSettings } from './views/settings.js';
import { openAskPanel } from './views/ai-panel.js';
import { bindShortcuts, setPageKeys, shortcutHelp } from './shortcuts.js';
import { getJson, isExport, liveStream } from './api.js';
import { attachTooltips } from './charts.js';
import { escapeHtml } from './format.js';
import { parseRoute } from './router.js';
import { icon, ICON_SPRITE } from './icons.js';

// [view, href, label, icon]; groups after the first get a heading. Analysis pages need the server.
const NAV = [
  [null, [['overview', '#/', 'Overview', 'grid'], ['runs', '#/runs', 'Runs', 'list'], ['live', '#/live', 'Live', 'activity'], ['tests', '#/tests', 'Tests', 'flask']]],
  ['Phân tích', [['flaky', '#/flaky', 'Flaky', 'shuffle'], ['errors', '#/errors', 'Nhóm lỗi', 'layers'], ['cost', '#/cost', 'Chi phí & cache', 'coins'], ['routes', '#/routes', 'Bản đồ route', 'route'], ['branches', '#/branches', 'Branch', 'branch'], ['models', '#/models', 'Model & ngân sách', 'cpu'], ['locators', '#/locators', 'Gợi ý locator', 'crosshair'], ['lint', '#/lint', 'Lint agent', 'lint'], ['app-errors', '#/app-errors', 'Lỗi app', 'terminal']]],
  ['Tích hợp', [['projects', '#/projects', 'Projects', 'folder'], ['digest', '#/digest', 'Digest tuần', 'newspaper'], ['settings', '#/settings', 'Tự động & lưu trữ', 'gauge']]],
];
const EXPORT_VIEWS = new Set(['overview', 'runs', 'run']);
const VIEWS = {
  overview: renderOverview, runs: renderRunsPage, run: renderRun, live: renderLive, tests: renderTests,
  flaky: renderFlaky, compare: renderCompare, errors: renderErrors, cost: renderCost, routes: renderRoutes,
  branches: renderBranches, projects: renderProjects, digest: renderDigest, locators: renderLocators, models: renderModels, lint: renderLint,
  test: renderTest, 'app-errors': renderAppErrors, settings: renderSettings,
};
const TITLES = { overview: 'Overview', runs: 'Runs', run: 'Run', live: 'Live', tests: 'Tests', test: 'Test', compare: 'So sánh', flaky: 'Flaky', errors: 'Nhóm lỗi', cost: 'Chi phí', routes: 'Route', branches: 'Branch', projects: 'Projects', digest: 'Digest', locators: 'Locator', models: 'Model', lint: 'Lint', 'app-errors': 'Lỗi app', settings: 'Cài đặt' };

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

// Theme: follows the OS until the viewer picks one; the choice is a per-viewer convenience.
function storedTheme() {
  try {
    return localStorage.getItem('e2ed-theme');
  } catch {
    return null;
  }
}

function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try {
    localStorage.setItem('e2ed-theme', next);
  } catch {
    // storage blocked: the toggle still works for this page view
  }
}

function shell() {
  applyTheme(storedTheme());
  document.body.insertAdjacentHTML('afterbegin', ICON_SPRITE);
  const link = ([v, href, label, ic]) => `<a href="${href}" data-nav="${v}" class="n-${v}"><span class="ni">${icon(ic)}</span>${label}${v === 'live' ? '<span class="live-dot" aria-label="đang chạy"></span>' : ''}</a>`;
  const folded = foldedGroups();
  const nav = NAV.map(([group, items]) => {
    const shown = items.filter(([v]) => !isExport() || EXPORT_VIEWS.has(v));
    if (!shown.length) return '';
    if (!group) return shown.map(link).join('');
    return `<details class="nav-sec" data-group="${group}" ${folded.has(group) ? '' : 'open'}><summary class="nav-group">${group}</summary>${shown.map(link).join('')}</details>`;
  }).join('');
  document.getElementById('app').innerHTML = `
    <aside class="nav">
      <div class="nav-top"><a class="brand" href="#/"><span class="logo">${icon('flask', { size: 17 })}</span>e2e <span>dashboard</span></a>
        <button type="button" class="icon-btn nav-toggle" aria-expanded="false" aria-controls="nav-body" aria-label="Mở menu">${icon('list', { size: 18 })}</button></div>
      <div class="nav-body" id="nav-body">
      ${isExport() ? '' : `<div class="nav-tools"><button type="button" class="nav-search" data-search>${icon('search', { size: 15 })}Tìm kiếm <kbd>Ctrl K</kbd></button><button type="button" class="nav-ask btn-ai" data-ask title="Hỏi AI về bộ test">${icon('sparkles', { size: 15 })}Hỏi AI</button></div>`}
      <nav aria-label="Điều hướng">${nav}</nav>
      <div class="nav-foot"><div class="foot-btns"><button class="theme-toggle" type="button" aria-label="Chuyển giao diện sáng / tối">${icon('sun')}Sáng / Tối</button>${isExport() ? '' : `<button type="button" class="icon-btn" data-keys title="Phím tắt (?)" aria-label="Phím tắt">${icon('bolt', { size: 15 })}</button>`}</div><div id="nav-foot"></div></div>
      </div>
    </aside>
    <main id="main" tabindex="-1"></main>`;
  document.querySelector('.theme-toggle').addEventListener('click', toggleTheme);
  document.querySelector('[data-search]')?.addEventListener('click', openSearch);
  document.querySelector('[data-ask]')?.addEventListener('click', openAskPanel);
  document.querySelector('[data-keys]')?.addEventListener('click', shortcutHelp);
  const toggle = document.querySelector('.nav-toggle');
  toggle.addEventListener('click', () => {
    const open = document.body.classList.toggle('nav-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  document.querySelectorAll('.nav-sec').forEach((d) =>
    d.addEventListener('toggle', () => {
      const f = foldedGroups();
      if (d.open) f.delete(d.dataset.group);
      else f.add(d.dataset.group);
      saveFolded(f);
    }));
  if (!isExport()) {
    bindSearchShortcut();
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
  el.innerHTML = `<div class="muted">${escapeHtml(info.project)} · v${escapeHtml(info.version)}</div>${hint}${skipped}`;
}

let routeSeq = 0;

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
function watchLive() {
  liveStream((s) => {
    const liveLink = document.querySelector('[data-nav="live"]');
    liveLink?.classList.toggle('is-running', s.status === 'running');
    if (lastStatus === 'running' && s.status !== 'running') {
      const view = parseRoute(location.hash).view;
      if (['overview', 'runs', 'tests', 'flaky', 'errors', 'cost'].includes(view)) setTimeout(route, 1500); // give archive() time to finish
    }
    lastStatus = s.status;
  });
}

if (isExport() && !location.hash) location.hash = `#/run/${encodeURIComponent(globalThis.__E2ED_EXPORT__.runId)}`;
shell();
footer();
watchLive();
window.addEventListener('hashchange', route);
route();
