// `/e2e-dashboard doctor`: chuyển dữ liệu .e2e-dashboard từ bố cục cũ sang bố cục mới (v0.8.8) và kiểm tra nhanh.
//   runs/<ISO>_<id>/              → runs/YYYY/MM/DD/<giờ>_<id>/
//   settings.json, triage.json …  → state/
//   live.json, server.log …       → runtime/
// rồi dựng lại chỉ mục SQLite. Dashboard vẫn đọc được bố cục cũ, nên không chạy doctor cũng không mất gì.
// --dry-run: chỉ liệt kê việc sẽ làm. Không bao giờ đi theo symlink, không ghi đè file đã có ở chỗ mới.
import { readdir, rename, mkdir, stat, rm, lstat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { DATA_DIR, isLink, isLegacyRunName, nestedFromLegacy, dataPath, legacyDataPath, STATE_FILES, RUNTIME_FILES } from '../reporter/e2e-dashboard.reporter.mjs';
import { syncIndex, closeIndex, indexPath, indexEnabled } from './runindex.mjs';

export async function doctor(root, { dryRun = false, reporter = null } = {}) {
  const data = join(root, DATA_DIR);
  const lines = [];
  const warn = [];
  if (!existsSync(data)) return { lines: ['Chưa có thư mục .e2e-dashboard: không có gì để chuyển.'], warn, changed: 0 };
  if (isLink(data)) return { lines: [], warn: ['.e2e-dashboard là symlink: bỏ qua để an toàn.'], changed: 0 };
  let changed = 0;
  const move = async (from, to, label) => {
    if (isLink(from)) return void warn.push(`Bỏ qua symlink: ${label}`);
    if (existsSync(to)) return void warn.push(`Đã có ở chỗ mới, giữ nguyên bản cũ: ${label}`);
    for (let d = dirname(to); d.startsWith(data) && d !== data; d = dirname(d)) if (isLink(d)) return void warn.push(`Bỏ qua (thư mục đích là symlink): ${label}`);
    changed++;
    if (dryRun) return;
    await mkdir(dirname(to), { recursive: true });
    await rename(from, to);
  };

  // 1. run kiểu cũ → theo ngày
  const runs = join(data, 'runs');
  let legacy = 0;
  if (existsSync(runs) && !isLink(runs)) {
    for (const e of await readdir(runs, { withFileTypes: true })) {
      if (e.name.startsWith('.tmp-')) {
        const st = await stat(join(runs, e.name)).catch(() => null);
        if (st && Date.now() - st.mtimeMs > 600_000) {
          changed++;
          if (!dryRun) await rm(join(runs, e.name), { recursive: true, force: true });
        }
        continue;
      }
      if (!isLegacyRunName(e.name)) continue;
      if (!e.isDirectory()) {
        warn.push(`Bỏ qua (không phải thư mục thật): runs/${e.name}`);
        continue;
      }
      legacy++;
      await move(join(runs, e.name), join(runs, nestedFromLegacy(e.name)), `runs/${e.name}`);
    }
  }
  if (legacy) lines.push(`${dryRun ? 'Sẽ chuyển' : 'Đã chuyển'} ${legacy} run sang runs/YYYY/MM/DD/.`);

  // 2. file trạng thái / file tạm ở gốc → state/, runtime/
  let files = 0;
  for (const name of [...STATE_FILES, ...RUNTIME_FILES]) {
    const from = legacyDataPath(root, name);
    if (!(await lstat(from).catch(() => null))) continue;
    files++;
    await move(from, dataPath(root, name), name);
  }
  if (files) lines.push(`${dryRun ? 'Sẽ chuyển' : 'Đã chuyển'} ${files} file trạng thái vào state/ và runtime/.`);

  // 3. chỉ mục SQLite
  if (!(await indexEnabled(root))) lines.push('Chỉ mục SQLite đang tắt (bật ở Cài đặt hệ thống): bỏ qua bước dựng chỉ mục.');
  else if (!dryRun) {
    closeIndex(root);
    await rm(indexPath(root), { force: true });
    await rm(`${indexPath(root)}-wal`, { force: true });
    await rm(`${indexPath(root)}-shm`, { force: true });
    const r = await syncIndex(root);
    if (r) lines.push(`Đã dựng lại chỉ mục SQLite: ${r.total} run.`);
  } else lines.push('Sẽ dựng lại chỉ mục SQLite.');

  // 4. reporter trong project cũ thì vẫn ghi run kiểu cũ
  if (reporter && reporter.installed && reporter.version !== reporter.latest) warn.push(`Reporter trong project là v${reporter.version} (mới nhất v${reporter.latest}): chạy /e2e-dashboard setup để run mới ghi theo bố cục mới.`);
  if (reporter && !reporter.installed) warn.push('Project chưa cài reporter: chạy /e2e-dashboard setup.');

  if (!lines.length && !warn.length) lines.push('Dữ liệu đã theo bố cục mới, không có gì để chuyển.');
  return { lines, warn, changed };
}
