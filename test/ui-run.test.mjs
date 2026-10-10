import { test } from 'node:test';
import assert from 'node:assert/strict';
import { artifactsOf, mediaSrc, eventLine, cacheText } from '../ui/views/run.js';

const art = (id, kind, extra) => ({ id, kind, mediaType: 'x', redaction: 'complete', producer: { kind: 'attempt' }, ...extra });

test('artifactsOf collects attempt + step artifacts and prefers a local video', () => {
  const attempt = {
    artifacts: [art('v1', 'video', { url: 'https://cdn/v.mp4' }), art('v2', 'video', { path: 'a/v.webm' }), art('s1', 'screenshot', { path: 'a/1.png' })],
    steps: [{ artifacts: [art('s2', 'screenshot', { path: 'a/2.png' })] }],
  };
  const { video, screenshots } = artifactsOf(attempt);
  assert.equal(video.id, 'v2');
  assert.deepEqual(screenshots.map((s) => s.id), ['s1', 's2']);
  assert.deepEqual(artifactsOf({}), { video: null, screenshots: [] });
});

test('mediaSrc uses the archived file, else the hosted url', () => {
  assert.equal(mediaSrc('r1', { path: 'a b/v.webm' }), '/files/runs/r1/artifacts/a%20b/v.webm');
  assert.equal(mediaSrc('r1', { url: 'https://cdn/v.mp4' }), 'https://cdn/v.mp4');
  assert.equal(mediaSrc('r1', {}), null);
});

test('eventLine renders each event kind and escapes app text', () => {
  assert.match(eventLine({ kind: 'model', reasoning: 'close <modal>', inputTokens: 100, outputTokens: 20, durationMs: 2840 }), /💭 close &lt;modal&gt;.*100\/20 tok/);
  assert.match(eventLine({ kind: 'engine', name: 'tap', detail: 'tap button "Close"' }), /⚙ tap button &quot;Close&quot;/);
  assert.match(eventLine({ kind: 'navigation', detail: 'navigated to /cart' }), /↪ navigated to \/cart/);
  assert.match(eventLine({ kind: 'poll', detail: 'x3' }), /⟳ x3/);
  assert.match(eventLine({ kind: 'weird', name: 'n' }), /weird n/);
});

test('cacheText summarises replay', () => {
  assert.equal(cacheText(undefined), '');
  assert.equal(cacheText({ mode: 'missed', reason: 'gap', replayedActions: 0, totalActions: 2 }), 'cache missed (gap) · replay 0/2');
  assert.equal(cacheText({ mode: 'replayed', replayedActions: 2, totalActions: 2 }), 'cache replayed · replay 2/2');
});

test('eventLine escapes token counts from a tampered report', () => {
  assert.doesNotMatch(eventLine({ kind: 'model', inputTokens: '<img src=x onerror=alert(1)>', outputTokens: '<b>' }), /<img|<b>/);
});
