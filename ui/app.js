import { renderOverview, renderRunsPage } from './views/overview.js';
import { renderRun } from './views/run.js';
import { renderLive } from './views/live.js';
import { renderTests } from './views/tests.js';
import { getJson, isExport, liveStream } from './api.js';
import { attachTooltips } from './charts.js';
import { escapeHtml } from './format.js';
import { parseRoute } from './router.js';

const NAV = [['overview', '#/', 'Overview'], ['runs', '#/runs', 'Runs'], ['live', '#/live', 'Live'], ['tests', '#/tests', 'Tests']];
const VIEWS = { overview: renderOverview, runs: renderRunsPage, run: renderRun, live: renderLive, tests: renderTests };
let cleanup = null;
let lastStatus = null;

function shell() {
  const nav = NAV.filter(([v]) => !(isExport() && v === 'live'))
    .map(([v, href, label]) => `<a href="${href}" data-nav="${v}">${label}</a>`)
    .join('');
  document.getElementById('app').innerHTML = `
    <aside class="nav">
      <a class="brand" href="#/">e2e <span>dashboard</span></a>
      <nav>${nav}</nav>
      <div class="nav-foot" id="nav-foot"></div>
    </aside>
    <main id="main" tabindex="-1"></main>`;
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
  el.innerHTML = `<div class="muted">${escapeHtml(info.project)} · v${escapeHtml(info.version)}</div>${hint}`;
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

shell();
footer();
watchLive();
window.addEventListener('hashchange', route);
route();
