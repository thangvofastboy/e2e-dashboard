import './_home.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerProject } from '../server/projects.mjs';
import { validateSchedule, saveSchedule, readSchedules, deleteSchedule, slotsBetween, nextFire, claimSlot, createScheduleRunner } from '../server/schedules.mjs';
import { writeCiConfig } from '../server/cisync.mjs';

const tmp = (p = 'e2ed-') => mkdtempSync(join(tmpdir(), p));
const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).getTime();
const base = (root, over = {}) => ({ name: 'Đêm', root, times: ['02:00'], days: [1, 2, 3, 4, 5], options: { workers: 4, tests: ['a.e2e.ts:3'] }, ...over });

test('validateSchedule: needs a registered project, HH:MM times, weekdays and valid run options', () => {
  const r = '/p';
  assert.equal(validateSchedule(base(r), [r]).enabled, true);
  assert.throws(() => validateSchedule(base('/other'), [r]), /Project chưa có/);
  assert.throws(() => validateSchedule(base(r, { times: ['25:00'] }), [r]), /HH:MM/);
  assert.throws(() => validateSchedule(base(r, { days: [] }), [r]), /thứ/);
  assert.throws(() => validateSchedule(base(r, { options: { workers: 0 } }), [r]), /invalid workers/);
  assert.throws(() => validateSchedule(base(r, { options: { tests: ['--evil'] } }), [r]), /invalid tests/);
  assert.equal(validateSchedule(base(r, { options: { updateSnapshots: true } }), [r]).options.updateSnapshots, undefined);
});

test('slotsBetween / nextFire follow local times on the chosen weekdays only', () => {
  const s = { enabled: true, times: ['02:00', '13:30'], days: [1] }; // thứ Hai
  // 2026-10-12 là thứ Hai
  assert.deepEqual(slotsBetween(s, at(2026, 10, 12, 0, 0), at(2026, 10, 12, 23, 0)), [at(2026, 10, 12, 2, 0), at(2026, 10, 12, 13, 30)]);
  assert.deepEqual(slotsBetween(s, at(2026, 10, 13, 0, 0), at(2026, 10, 18, 23, 0)), []);
  assert.equal(nextFire(s, at(2026, 10, 12, 14, 0)), new Date(at(2026, 10, 19, 2, 0)).toISOString());
  assert.equal(nextFire({ ...s, enabled: false }), null);
});

test('saveSchedule upserts by id, deleteSchedule removes; claimSlot wins once per slot', async () => {
  const env = { E2E_DASHBOARD_HOME: tmp('e2ed-home-') };
  const root = tmp();
  await registerProject(root, env);
  const s = await saveSchedule(base(root), env);
  await saveSchedule({ ...base(root, { name: 'Trưa' }), id: s.id }, env);
  assert.deepEqual((await readSchedules(env)).map((x) => x.name), ['Trưa']);
  assert.equal(await claimSlot(s.id, 123, env), true);
  assert.equal(await claimSlot(s.id, 123, env), false);
  assert.equal(await deleteSchedule(s.id, env), true);
  assert.equal((await readSchedules(env)).length, 0);
});

test('schedule runner fires a due slot once and records the result', async () => {
  const env = { E2E_DASHBOARD_HOME: tmp('e2ed-home-') };
  const root = tmp();
  await registerProject(root, env);
  const s = await saveSchedule(base(root, { days: [0, 1, 2, 3, 4, 5, 6] }), env);
  let t = at(2026, 10, 12, 1, 59);
  const started = [];
  const mk = () => createScheduleRunner({ env, now: () => t, start: (x) => (started.push(x.id), { ok: true }), setIntervalImpl: () => null, clearIntervalImpl: () => {} });
  const a = mk();
  const b = mk(); // dashboard thứ hai cùng máy
  t = at(2026, 10, 12, 2, 0);
  await a.tick();
  await b.tick();
  assert.deepEqual(started, [s.id]);
  const saved = (await readSchedules(env))[0];
  assert.equal(saved.lastRun.ok, true);
  t = at(2026, 10, 12, 2, 1);
  await a.tick();
  assert.equal(started.length, 1);
});

test('writeCiConfig keeps other config keys and rejects bad fields', async () => {
  const root = tmp();
  mkdirSync(join(root, '.e2e-dashboard'));
  writeFileSync(join(root, '.e2e-dashboard/config.json'), JSON.stringify({ port: 4500 }));
  const c = await writeCiConfig(root, { workflow: 'e2e.yml', artifact: 'e2e-report', branch: 'main', intervalMinutes: 15 });
  assert.equal(c.intervalMinutes, 15);
  const saved = JSON.parse(readFileSync(join(root, '.e2e-dashboard/config.json'), 'utf8'));
  assert.equal(saved.port, 4500);
  assert.equal(saved.ci.github.workflow, 'e2e.yml');
  await assert.rejects(writeCiConfig(root, { workflow: '' }), /Workflow/);
  await assert.rejects(writeCiConfig(root, { workflow: 'e2e.yml', branch: 'a b;rm' }), /branch/);
  await assert.rejects(writeCiConfig(root, { workflow: 'e2e.yml', intervalMinutes: 1 }), /Chu kỳ/);
});
