// AI hỗ trợ QC: bằng chứng + prompt của 4 action (req-coverage, explore-charter, test-data, bug-dupe)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt } from '../server/ai.mjs';
import { reqCoverageEvidence, charterEvidence, testDataEvidence, bugDupeEvidence } from '../server/aiextra.mjs';

test('mỗi action có bằng chứng và prompt riêng, giữ nội dung người dùng dán', () => {
  const cases = {
    'req-coverage': [reqCoverageEvidence('AC1: đăng nhập bằng email', [{ key: 'k1', title: 'login', file: 'a.e2e.ts' }]), /k1 · login/, /## Độ phủ/],
    'explore-charter': [charterEvidence('main', ['src/pay.ts']), /src\/pay\.ts/, /## Checklist edge case/],
    'test-data': [testDataEvidence('email bắt buộc'), /email bắt buộc/, /```json/],
    'bug-dupe': [bugDupeEvidence('lỗi 500 khi thanh toán', [{ code: 'E1', message: 'payment_intent missing', tests: ['t'], count: 2, lastSeen: '2026-10-01' }]), /E1: payment_intent missing/, /## Kết luận/],
  };
  for (const [action, [evidence, data, frame]] of Object.entries(cases)) {
    const p = buildPrompt(action, { evidence });
    assert.match(p, data, action);
    assert.match(p, frame, action);
  }
  assert.match(bugDupeEvidence('x', []).join('\n'), /\(chưa có\)/);
});
