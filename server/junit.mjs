// `junit.xml` (the e2e `junit` reporter: one suite per file, one case per test-target pair) as a report-1 document,
// for CI runs that only kept the XML. Much less than a real report.json (no steps, artifacts or model data), but enough
// for history, flaky, error groups and compare. No XML dependency: a small parser for the subset JUnit uses.
import { createHash } from 'node:crypto';

const MAX_XML = 10 * 1024 * 1024; // parse thành cây nút: bộ nhớ gấp nhiều lần kích thước file
const sha = (s) => createHash('sha256').update(s).digest('hex');
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
  if (e[0] !== '#') return ENT[e.toLowerCase()];
  const cp = e[1].toLowerCase() === 'x' ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
  return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
});

// { name, attrs, children, text } tree. Comments, declarations, doctype and CDATA handled; depth capped.
export function parseXml(xml) {
  if (typeof xml !== 'string' || xml.length > MAX_XML) throw new Error('junit.xml quá lớn');
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const top = stack.at(-1);
    if (m[1] !== undefined) top.text += m[1];
    else if (m[6] !== undefined) top.text += decode(m[6]);
    else if (m[3]) {
      if (m[2]) {
        if (stack.length > 1 && top.name === m[3]) stack.pop();
        continue;
      }
      const attrs = {};
      for (const a of m[4].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decode(a[2] ?? a[3]);
      const node = { name: m[3], attrs, children: [], text: '' };
      top.children.push(node);
      if (!m[5]) {
        if (stack.length > 24) throw new Error('junit.xml lồng quá sâu');
        stack.push(node);
      }
    }
  }
  return root;
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const find = (n, name) => n.children.filter((c) => c.name === name);
const uuidFrom = (h) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;

// `Title > Path [web]` or `Title [web] [agent]`; the e2e reporter writes the agent only when it is not "default"
function splitName(name) {
  const tail = [];
  let rest = name;
  for (let m = /\s\[([^\]]{1,80})\]$/.exec(rest); m && tail.length < 2; m = /\s\[([^\]]{1,80})\]$/.exec(rest)) {
    tail.unshift(m[1]);
    rest = rest.slice(0, m.index);
  }
  return { titlePath: rest.split(' > ').map((s) => s.trim()).filter(Boolean), targetId: tail[0] ?? 'default', agent: tail[1] ?? 'default' };
}

export function junitToReport(xml, { startedAt = null } = {}) {
  const tree = parseXml(xml);
  const top = tree.children.find((n) => n.name === 'testsuites' || n.name === 'testsuite');
  if (!top) throw new Error('Không phải junit.xml');
  const suites = top.name === 'testsuite' ? [top] : find(top, 'testsuite');
  const results = [];
  const errors = [];
  let startMs = Date.parse(suites.map((s) => s.attrs.timestamp).filter(Boolean).sort()[0] ?? '');
  if (!Number.isFinite(startMs)) startMs = Date.parse(startedAt ?? '') || Date.now();
  let totalMs = 0;
  for (const suite of suites) {
    for (const tc of find(suite, 'testcase')) {
      const durationMs = Math.round(num(tc.attrs.time) * 1000);
      totalMs += durationMs;
      const bad = tc.children.find((c) => c.name === 'failure' || c.name === 'error');
      if (suite.attrs.name === 'run' || tc.attrs.classname === 'run') {
        // run-level error (APP_UNREACHABLE…): a case of its own in the `run` suite
        errors.push({ code: bad?.attrs.type ?? tc.attrs.name ?? 'ERROR', category: 'infrastructure', message: String(bad?.attrs.message ?? tc.attrs.name ?? '').slice(0, 1000) });
        continue;
      }
      const skipped = tc.children.find((c) => c.name === 'skipped');
      const flaky = find(tc, 'system-out').some((c) => /^\s*flaky:/.test(c.text));
      const status = bad ? 'failed' : skipped ? 'skipped' : flaky ? 'flaky' : 'passed';
      const file = String(tc.attrs.classname ?? suite.attrs.name ?? 'unknown');
      const { titlePath, targetId, agent } = splitName(String(tc.attrs.name ?? ''));
      const testId = `${file}::${encodeURIComponent(titlePath.join(' > '))}`;
      const id = sha(`${file}\0${tc.attrs.name}\0${results.length}`);
      const error = bad
        // <failure> = a product verdict, <error> = anything that prevented one (e2e junit reporter); type = the e2e error code
        ? { code: bad.attrs.type || 'ERROR', category: bad.name === 'failure' ? 'test' : 'infrastructure', message: String(bad.attrs.message ?? bad.text ?? '').slice(0, 2000), ...(bad.text.trim() ? { details: { observed: bad.text.trim().slice(0, 4000) } } : {}) }
        : undefined;
      results.push({
        id, testId, kind: 'test', tags: [], declarationIndex: results.length, titlePath, file, source: { file, line: 1, column: 1 }, targetId, platform: 'web', agent, repeat: 0, selected: true, status,
        attempts: [{ id: `${id}:0`, index: 0, status: status === 'flaky' ? 'passed' : status, startedAt: new Date(startMs).toISOString(), durationMs, steps: [], artifacts: [], ...(error ? { error } : {}), ...(skipped ? { skip: { reason: String(skipped.attrs.message ?? '') } } : {}) }],
      });
    }
  }
  if (!results.length && !errors.length) throw new Error('junit.xml không có testcase nào');
  const count = (s) => results.filter((r) => r.status === s).length;
  const summary = { discovered: results.length, selected: results.length, executed: results.length - count('skipped'), passed: count('passed'), failed: count('failed'), interrupted: 0, flaky: count('flaky'), skipped: count('skipped') };
  const failed = summary.failed > 0 || errors.length > 0;
  const targets = [...new Set(results.map((r) => r.targetId))].map((id, index) => ({ id, index, platform: 'web' }));
  return {
    schemaVersion: 'report-1',
    run: {
      id: uuidFrom(sha(xml)), runner: { name: 'e2e', version: 'junit-import' }, status: failed ? 'failed' : 'passed', exitCode: failed ? 1 : 0,
      startedAt: new Date(startMs).toISOString(), finishedAt: new Date(startMs + totalMs).toISOString(),
      targets, serialGroups: [], results, errors, summary, imported: 'junit',
    },
  };
}
