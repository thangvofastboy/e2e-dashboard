// Tự cập nhật plugin: bật / tắt auto-update của marketplace e2e-dashboard trong settings.json của Claude Code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { autoUpdateStatus, setAutoUpdate, settingsPath } from '../server/autoupdate.mjs';

const envWith = (content) => {
  const dir = mkdtempSync(join(tmpdir(), 'e2ed-claude-'));
  if (content !== undefined) writeFileSync(join(dir, 'settings.json'), content);
  return { CLAUDE_CONFIG_DIR: dir };
};

test('chưa có settings.json: bật tạo file với extraKnownMarketplaces.e2e-dashboard (source github + autoUpdate)', async () => {
  const env = envWith();
  assert.deepEqual(await autoUpdateStatus(env), { path: settingsPath(env), enabled: false, off: false, error: null });
  const r = await setAutoUpdate(true, env);
  assert.equal(r.changed, true);
  assert.deepEqual(JSON.parse(readFileSync(r.path, 'utf8')), { extraKnownMarketplaces: { 'e2e-dashboard': { source: { source: 'github', repo: 'thangvofastboy/e2e-dashboard' }, autoUpdate: true } } });
  assert.equal((await setAutoUpdate(true, env)).changed, false); // bật lại: không ghi
  assert.equal((await autoUpdateStatus(env)).enabled, true);
});

test('giữ nguyên các khoá khác; tắt thì ghi autoUpdate: false (lần sau không nhắc bật lại)', async () => {
  const env = envWith(JSON.stringify({ model: 'opus', extraKnownMarketplaces: { other: { source: { source: 'github', repo: 'a/b' } }, 'e2e-dashboard': { source: { source: 'git', url: 'https://x/y.git' } } } }));
  await setAutoUpdate(true, env);
  const s = JSON.parse(readFileSync(settingsPath(env), 'utf8'));
  assert.equal(s.model, 'opus');
  assert.deepEqual(s.extraKnownMarketplaces.other, { source: { source: 'github', repo: 'a/b' } });
  assert.deepEqual(s.extraKnownMarketplaces['e2e-dashboard'], { source: { source: 'git', url: 'https://x/y.git' }, autoUpdate: true }); // source người dùng đặt: giữ
  await setAutoUpdate(false, env);
  assert.deepEqual(await autoUpdateStatus(env), { path: settingsPath(env), enabled: false, off: true, error: null });
});

test('settings.json hỏng: không ghi đè, báo lỗi kèm cách thêm tay', async () => {
  const env = envWith('{ "model": "opus", // comment\n}');
  assert.match((await autoUpdateStatus(env)).error, /Không đọc được/);
  await assert.rejects(setAutoUpdate(true, env), /Không sửa .* thêm tay/);
  assert.equal(readFileSync(settingsPath(env), 'utf8'), '{ "model": "opus", // comment\n}');
});
