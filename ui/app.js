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
import { renderLocators } from './views/locators.js';
import { renderModels } from './views/models.js';
import { renderLint } from './views/lint.js';
import { openSearch, bindSearchShortcut } from './views/search.js';
import { renderTest } from './views/test.js';
import { renderAppErrors } from './views/app-errors.js';
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
import { getJson, isExport, liveStream } from './api.js';
import { attachTooltips } from './charts.js';
import { escapeHtml } from './format.js';
import { parseRoute } from './router.js';
import { icon, ICON_SPRITE } from './icons.js';

// [view, href, label, icon]; groups after the first get a heading. Analysis pages need the server.
const NAV = [
  [null, [['overview', '#/', 'Overview', 'grid'], ['runs', '#/runs', 'Runs', 'list'], ['live', '#/live', 'Live', 'activity'], ['tests', '#/tests', 'Tests', 'flask']]],
  ['Theo dõi', [['trends', '#/trends', 'Xu hướng', 'activity'], ['triage', '#/triage', 'Triage lỗi', 'ticket'], ['groups', '#/groups', 'Module / team', 'layers'], ['release', '#/release', 'Phát hành', 'upload'], ['traceability', '#/traceability', 'Truy vết', 'route'], ['lifecycle', '#/lifecycle', 'Vòng đời test', 'recycle']]],
  ['Phân tích', [['flaky', '#/flaky', 'Flaky', 'shuffle'], ['errors', '#/errors', 'Nhóm lỗi', 'layers'], ['cost', '#/cost', 'Chi phí & cache', 'coins'], ['routes', '#/routes', 'Bản đồ route', 'route'], ['branches', '#/branches', 'Branch', 'branch'], ['models', '#/models', 'Model & ngân sách', 'cpu'], ['locators', '#/locators', 'Gợi ý locator', 'crosshair'], ['lint', '#/lint', 'Lint agent', 'lint'], ['app-errors', '#/app-errors', 'Lỗi app', 'terminal'], ['coverage', '#/coverage', 'Coverage', 'crosshair'], ['environment', '#/environment', 'Môi trường', 'cpu']]],
  ['Tích hợp', [['projects', '#/projects', 'Projects', 'folder'], ['digest', '#/digest', 'Digest tuần', 'newspaper'], ['report', '#/report', 'Báo cáo', 'file'], ['settings', '#/settings', 'Tự động & lưu trữ', 'gauge']]],
];
const EXPORT_VIEWS = new Set(['overview', 'runs', 'run']);
const VIEWS = {
  overview: renderOverview, runs: renderRunsPage, run: renderRun, live: renderLive, tests: renderTests,
  flaky: renderFlaky, compare: renderCompare, errors: renderErrors, cost: renderCost, routes: renderRoutes,
  branches: renderBranches, projects: renderProjects, digest: renderDigest, locators: renderLocators, models: renderModels, lint: renderLint,
  test: renderTest, 'app-errors': renderAppErrors, settings: renderSettings, coverage: renderCoverage, environment: renderEnvironment, report: renderReport,
  trends: renderTrends, triage: renderTriage, groups: renderGroups, release: renderRelease, traceability: renderTraceability, lifecycle: renderLifecycle,
};
const TITLES = { overview: 'Overview', runs: 'Runs', run: 'Run', live: 'Live', tests: 'Tests', test: 'Test', compare: 'So sánh', flaky: 'Flaky', errors: 'Nhóm lỗi', cost: 'Chi phí', routes: 'Route', branches: 'Branch', projects: 'Projects', digest: 'Digest', locators: 'Locator', models: 'Model', lint: 'Lint', 'app-errors': 'Lỗi app', settings: 'Cài đặt', coverage: 'Coverage', environment: 'Môi trường', report: 'Báo cáo', trends: 'Xu hướng', triage: 'Triage', groups: 'Module / team', release: 'Phát hành', traceability: 'Truy vết', lifecycle: 'Vòng đời test' };

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
      <div class="nav-foot"><div class="foot-btns"><button class="theme-toggle" type="button" aria-label="Chuyển giao diện sáng / tối">${icon('sun')}Sáng / Tối</button>${isExport() ? '' : `<button type="button" class="icon-btn" data-keys title="Phím tắt (?)" aria-label="Phím tắt">${icon('bolt', { size: 15 })}</button>`}<button type="button" class="icon-btn lang-btn" data-lang title="Tiếng Việt / English" aria-label="Ngôn ngữ">${currentLang() === 'en' ? 'VI' : 'EN'}</button></div><div id="nav-foot"></div></div>
      </div>
    </aside>
    <main id="main" tabindex="-1"></main>`;
  document.querySelector('.theme-toggle').addEventListener('click', toggleTheme);
  document.querySelector('[data-search]')?.addEventListener('click', openSearch);
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
      if (['overview', 'runs', 'tests', 'flaky', 'errors', 'cost'].includes(view)) setTimeout(route, 1500); // give archive() time to finish
    }
    lastStatus = s.status;
  });
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
}

if (isExport() && !location.hash) location.hash = `#/run/${encodeURIComponent(globalThis.__E2ED_EXPORT__.runId)}`;
initI18n(); // before shell(): the VI/EN button label reads the stored language
// created after initI18n's observer, so English translation sees whole strings before boldNumbers splits them;
// the tooltip and the run pill change on every mouse move / snapshot and never hold anything to enhance
new MutationObserver((ms) => {
  if (ms.every((m) => m.target.closest?.('#chart-tip, #run-pill'))) return;
  enhance(document.body);
}).observe(document.body, { childList: true, subtree: true });
shell();
footer();
watchLive();
window.addEventListener('hashchange', route);
window.addEventListener('hashchange', syncPill);
route();
