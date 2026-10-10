import { renderOverview, renderRunsPage } from './views/overview.js';
import { renderRun } from './views/run.js';
import { renderLive } from './views/live.js';
import { renderTests } from './views/tests.js';
import { getJson, isExport, liveStream } from './api.js';
import { attachTooltips } from './charts.js';
import { escapeHtml } from './format.js';
import { parseRoute } from './router.js';
import { icon, ICON_SPRITE } from './icons.js';

const NAV = [['overview', '#/', 'Overview', 'grid'], ['runs', '#/runs', 'Runs', 'list'], ['live', '#/live', 'Live', 'activity'], ['tests', '#/tests', 'Tests', 'flask']];
const VIEWS = { overview: renderOverview, runs: renderRunsPage, run: renderRun, live: renderLive, tests: renderTests };
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
  const nav = NAV.filter(([v]) => !(isExport() && (v === 'live' || v === 'tests')))
    .map(([v, href, label, ic]) => `<a href="${href}" data-nav="${v}" class="n-${v}"><span class="ni">${icon(ic)}</span>${label}${v === 'live' ? '<span class="live-dot" aria-label="đang chạy"></span>' : ''}</a>`)
    .join('');
  document.getElementById('app').innerHTML = `
    <aside class="nav">
      <a class="brand" href="#/"><span class="logo">${icon('flask', { size: 17 })}</span>e2e <span>dashboard</span></a>
      <nav aria-label="Điều hướng">${nav}</nav>
      <div class="nav-foot"><button class="theme-toggle" type="button" aria-label="Chuyển giao diện sáng / tối">${icon('sun')}Sáng / Tối</button><div id="nav-foot"></div></div>
    </aside>
    <main id="main" tabindex="-1"></main>`;
  document.querySelector('.theme-toggle').addEventListener('click', toggleTheme);
  attachTooltips(document.getElementById('main'));
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

async function route() {
  cleanup?.();
  cleanup = null;
  const r = parseRoute(location.hash);
  const active = r.view === 'run' ? 'runs' : r.view;
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === active));
  const main = document.getElementById('main');
  main.innerHTML = '<p class="muted">Đang tải…</p>';
  try {
    const render = VIEWS[r.view];
    if (!render) main.innerHTML = '<p>Không tìm thấy trang. <a href="#/">Về Overview</a></p>';
    else cleanup = (await render(main, r)) ?? null;
  } catch (e) {
    main.innerHTML = `<p class="error">Lỗi: ${escapeHtml(e.message)}</p>`;
  }
}

// Nav badge while a run is live; refresh list pages when it finishes.
function watchLive() {
  liveStream((s) => {
    const liveLink = document.querySelector('[data-nav="live"]');
    liveLink?.classList.toggle('is-running', s.status === 'running');
    if (lastStatus === 'running' && s.status !== 'running') {
      const view = parseRoute(location.hash).view;
      if (view === 'overview' || view === 'runs' || view === 'tests') setTimeout(route, 1500); // give archive() time to finish
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
