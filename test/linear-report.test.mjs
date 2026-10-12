import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueDraft, stepLine, issueImages, acceptDescription, placeImages, createLinear } from '../server/linear.mjs';

const report = {
  run: {
    results: [{
      id: 'a'.repeat(64), testId: 'cart', targetId: 'web', titlePath: ['Giỏ hàng', 'thêm giày'], status: 'failed', source: { file: 'tests/cart.e2e.ts', line: 7 },
      attempts: [{
        durationMs: 900,
        failure: { url: 'https://shop.test/cart?step=2', screen: 'shot-1' },
        artifacts: [{ id: 'shot-1', kind: 'screenshot', path: 'web/fail.png' }, { path: 'web/cart-actual.png' }, { path: 'web/cart-diff.png' }, { path: 'web/cart-expected.png' }],
        steps: [
          { api: 'agent.act', label: 'thêm đôi giày size 42 vào giỏ', status: 'passed' },
          { api: 'agent.act', label: 'mở giỏ hàng', status: 'passed' },
          { api: 'agent.assert', label: 'giỏ có 2 sản phẩm', status: 'failed' },
          { api: 'agent.act', label: 'không chạy tới', status: 'skipped' },
        ],
        error: { code: 'ASSERTION_FAILED', message: 'expected "2 items", got "1 item"', details: { expected: '2 items', observed: '1 item' } },
      }],
    }],
  },
};
const meta = { runId: '018f0f5c-7b2a-7abc-8abc-000000000777', startedAt: '2026-10-12T06:00:00Z', git: { branch: 'main', commit: 'abcdef1234' } };

test('issue reads like a bug report: intro, numbered repro steps up to the failing one, expected / actual, images, tech details last', () => {
  const d = issueDraft({ meta, report, resultId: 'a'.repeat(64) });
  const t = d.description;
  assert.match(t, /^Test \*\*Giỏ hàng › thêm giày\*\* đang fail trên `main@abcdef1`.*tới bước “giỏ có 2 sản phẩm”/);
  assert.match(t, /## Các bước tái hiện\n1\. Mở app tại https:\/\/shop\.test \(đăng nhập nếu cần\)\n2\. Thêm đôi giày size 42 vào giỏ\n3\. Mở giỏ hàng\n4\. Kiểm tra: giỏ có 2 sản phẩm ← lỗi ở bước này\n\n/);
  assert.doesNotMatch(t, /không chạy tới/);
  assert.match(t, /## Mong đợi\n2 items\n\n## Thực tế\n1 item/);
  assert.match(t, /## Hình ảnh\n!\[Màn hình lúc lỗi\]\(e2ed-image:0\)\n!\[Thực tế\]\(e2ed-image:1\)\n!\[Khác biệt so với ảnh mẫu\]\(e2ed-image:2\)/);
  assert.ok(t.indexOf('## Chi tiết kỹ thuật') > t.indexOf('## Hình ảnh'));
  assert.deepEqual(d.images.map((x) => x.path), ['artifacts/web/fail.png', 'artifacts/web/cart-actual.png', 'artifacts/web/cart-diff.png']);
  assert.match(d.title, /^\[e2e\] Giỏ hàng › thêm giày \[web\]: lỗi ở bước “giỏ có 2 sản phẩm”$/);
  assert.equal(stepLine({ api: 'page.goto', label: '/login' }), 'Mở /login');
  assert.equal(issueImages({ run: { results: [] } }, { attempts: [] }).length, 0);
});

test('edited text needs the fingerprint line; images become uploaded links or a note', () => {
  const d = issueDraft({ meta, report, resultId: 'a'.repeat(64) });
  assert.equal(acceptDescription(d, 'không có fingerprint'), d.description);
  const edited = `Viết lại\n${d.description.split('\n').at(-1)}`;
  assert.equal(acceptDescription(d, edited), edited);
  const placed = placeImages(d.description, ['https://uploads.linear.app/1.png', undefined, 'https://uploads.linear.app/3.png'], d.images);
  assert.match(placed, /!\[Màn hình lúc lỗi\]\(https:\/\/uploads\.linear\.app\/1\.png\)/);
  assert.match(placed, /_\(Thực tế: không tải lên được, xem artifacts\/web\/cart-actual\.png trong thư mục run\)_/);
  assert.doesNotMatch(placed, /e2ed-image:/);
});

test('uploadImage asks Linear for a signed URL, PUTs the bytes with its headers, returns the asset URL', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes('graphql')) return new Response(JSON.stringify({ data: { fileUpload: { success: true, uploadFile: { uploadUrl: 'https://upload.test/put', assetUrl: 'https://uploads.linear.app/x.png', headers: [{ key: 'x-goog-meta', value: '1' }] } } } }));
    return new Response('', { status: 200 });
  };
  const url = await createLinear({ apiKey: 'lin_api_xxxxxxxxxx', team: 'ENG', fetchImpl }).uploadImage(Buffer.from('png'), 'fail.png', 'image/png');
  assert.equal(url, 'https://uploads.linear.app/x.png');
  assert.equal(calls[1].opts.method, 'PUT');
  assert.equal(calls[1].opts.headers['x-goog-meta'], '1');
  assert.equal(calls[1].opts.headers['content-type'], 'image/png');
  assert.match(JSON.parse(calls[0].opts.body).query, /fileUpload/);
});

test('edited title is cleaned like the generated one', async () => {
  const { acceptTitle } = await import('../server/linear.mjs');
  const d = issueDraft({ meta, report, resultId: 'a'.repeat(64) });
  assert.equal(acceptTitle(d, '  Giỏ hàng thiếu 1 sản phẩm\nsau khi thêm  '), 'Giỏ hàng thiếu 1 sản phẩm sau khi thêm');
  assert.doesNotMatch(acceptTitle(d, '<img src=x> e2ed-aaaaaaaaaaaa'), /<img|e2ed-[0-9a-f]{12}/);
  assert.equal(acceptTitle(d, '   '), d.title);
  assert.equal(acceptTitle(d, 42), d.title);
  assert.equal(acceptTitle(d, 'x'.repeat(500)).length, 240);
});
