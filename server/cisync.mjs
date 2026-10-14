// CI auto-sync (M7): every N minutes while the dashboard runs, list the latest completed GitHub Actions
// runs of one workflow (gh, argv only) and import the e2e report artifact of those not imported yet.
// Opt-in: "ci": { "github": { "workflow": "e2e.yml", "artifact": "e2e-report", "branch": "main", "intervalMinutes": 30 } }.
import { execFile } from 'node:child_process';
import { importFromGithub } from './share.mjs';
import { readState, writeState, serial } from './jsonstate.mjs';

const FILE = 'ci-sync.json';

export function ciConfig(cfg) {
  const g = cfg?.ci?.github;
  if (!g || typeof g !== 'object' || typeof g.workflow !== 'string' || !/^[\w.\- /]{1,120}$/.test(g.workflow)) return null;
  const iv = Number(g.intervalMinutes);
  return {
    workflow: g.workflow,
    artifact: typeof g.artifact === 'string' && /^[\w. -]{1,100}$/.test(g.artifact) ? g.artifact : null,
    branch: typeof g.branch === 'string' && /^[\w./-]{1,200}$/.test(g.branch) ? g.branch : null,
    intervalMinutes: Number.isFinite(iv) && iv >= 5 && iv <= 24 * 60 ? iv : 30,
    limit: 10,
  };
}

export async function readCiState(root) {
  const s = await readState(root, FILE, null);
  const obj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (!obj(s) || !obj(s.imported)) return { imported: {}, lastSync: null, lastError: null, lastImported: 0 };
  if (!obj(s.failed)) delete s.failed; // failed: 5 / "x" thì state.failed[id] = … ném lỗi (ESM strict)
  return s;
}

export function listCiRuns(root, c, { execImpl = execFile } = {}) {
  const args = ['run', 'list', '--workflow', c.workflow, '--status', 'completed', '--limit', String(c.limit), '--json', 'databaseId,headBranch,conclusion,createdAt,displayTitle,headSha', ...(c.branch ? ['--branch', c.branch] : [])];
  return new Promise((ok, fail) =>
    execImpl('gh', args, { cwd: root, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 }, (err, out, stderr) => {
      if (err) return fail(new Error(err.code === 'ENOENT' ? 'Không tìm thấy GitHub CLI (gh). Cài gh và chạy gh auth login.' : String(stderr || err.message).trim().slice(0, 300)));
      try {
        const list = JSON.parse(String(out));
        ok(Array.isArray(list) ? list.filter((r) => Number.isInteger(r?.databaseId)) : []);
      } catch {
        fail(new Error('gh trả về dữ liệu lạ'));
      }
    }));
}

export function syncCi(root, c, { execImpl = execFile, importImpl = importFromGithub, now = () => new Date().toISOString() } = {}) {
  return serial(`${root}:ci`, async () => {
    const state = await readCiState(root);
    let imported = 0;
    const results = [];
    try {
      const runs = await listCiRuns(root, c, { execImpl });
      for (const r of runs.filter((x) => !state.imported[x.databaseId]).slice(0, 5)) {
        let res;
        try {
          res = await importImpl(root, String(r.databaseId), { artifact: c.artifact, execImpl });
        } catch (e) {
          // a network blip or an artifact not uploaded yet: retry on the next syncs, give up after 3
          state.failed ??= {};
          state.failed[r.databaseId] = (state.failed[r.databaseId] ?? 0) + 1;
          if (state.failed[r.databaseId] < 3) {
            results.push({ id: r.databaseId, archived: 0, reason: e.message.slice(0, 200), retry: true });
            await writeState(root, FILE, state);
            continue;
          }
          res = [{ status: 'skipped', reason: e.message.slice(0, 200) }];
        }
        if (state.failed) delete state.failed[r.databaseId];
        const ok = res.filter((x) => x.status === 'archived').length;
        imported += ok;
        state.imported[r.databaseId] = { at: now(), branch: r.headBranch ?? null, conclusion: r.conclusion ?? null, reports: res.length, archived: ok, reason: res.find((x) => x.reason)?.reason ?? null };
        results.push({ id: r.databaseId, ...state.imported[r.databaseId] });
        await writeState(root, FILE, state); // a killed sync (slash-command timeout) keeps what it already imported
      }
      state.lastError = null;
    } catch (e) {
      state.lastError = e.message;
    }
    const ids = Object.keys(state.imported).sort((a, b) => Number(b) - Number(a));
    for (const id of ids.slice(500)) delete state.imported[id];
    state.lastSync = now();
    state.lastImported = imported;
    await writeState(root, FILE, state);
    return { imported, results, error: state.lastError };
  });
}

export function createCiSync({ root, config, sync = (c) => syncCi(root, c), setIntervalImpl = setInterval, clearIntervalImpl = clearInterval }) {
  if (!config) return { state: () => null, close: () => {}, now: async () => ({ error: 'not-configured' }) };
  let nextAt = Date.now() + 15_000;
  const tick = () => {
    nextAt = Date.now() + config.intervalMinutes * 60_000;
    return sync(config).catch((e) => ({ error: e.message }));
  };
  const first = setTimeout(tick, 15_000);
  first.unref?.();
  const timer = setIntervalImpl(tick, config.intervalMinutes * 60_000);
  timer?.unref?.();
  return { state: () => ({ ...config, nextAt: new Date(nextAt).toISOString() }), close: () => { clearTimeout(first); clearIntervalImpl(timer); }, now: tick };
}
