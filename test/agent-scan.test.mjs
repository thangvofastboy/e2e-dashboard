import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentScan } from '../server/insights.mjs';
import { noAgentBox } from '../ui/analysis.js';

test('agentScan tells "no agent steps" apart from "all good"', () => {
  const step = (kind, api) => ({ kind, api, label: 'x' });
  const withSteps = (steps) => ({ meta: {}, report: { run: { results: [{ id: 'r', attempts: [{ steps }] }] } } });
  const s = agentScan([withSteps([step('app', 'app.open'), step('assertion', 'expect.toBeVisible')])]);
  assert.deepEqual(agentScan([withSteps([step('agent', 'agent.act'), step('app', 'app.open')])]), { runs: 1, steps: 2, agentSteps: 1, actSteps: 1 });
  assert.deepEqual(s, { runs: 1, steps: 2, agentSteps: 0, actSteps: 0 });
  const html = noAgentBox({ runs: 2, steps: 18, agentSteps: 0, actSteps: 0 }, 'kiểm tra');
  assert.match(html, /Đã quét 2 run \(18 step\): 0 step/);
  assert.match(html, /không có <code>agent\.act<\/code>/);
});
