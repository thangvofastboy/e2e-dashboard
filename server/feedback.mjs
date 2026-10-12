// Feedback about the dashboard itself, sent as an issue on the project's GitHub repository through the local gh CLI.
// Nothing is sent until the user submits the form AND ticks the "public" confirmation: the server refuses without it.
import { spawn } from 'node:child_process';

export const FEEDBACK_REPO = 'thangvofastboy/e2e-dashboard';
const TYPES = { bug: ['bug', 'Lỗi'], idea: ['enhancement', 'Ý tưởng'], question: ['question', 'Câu hỏi'] };
// tokens and keys that must never end up in a public issue
const SECRET = /(ghp_|gho_|ghs_|github_pat_|lin_api_|sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY)/;
const WINDOW_MS = 10 * 60_000;
const MAX_PER_WINDOW = 5;
const attempts = [];

const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n);

export function validateFeedback(b = {}) {
  if (!Object.hasOwn(TYPES, b.type)) throw new Error('loại phản hồi phải là bug, idea hoặc question');
  const title = clean(b.title, 120);
  if (title.length < 5) throw new Error('tiêu đề cần ít nhất 5 ký tự');
  const body = clean(b.body, 4000);
  if (body.length < 10) throw new Error('nội dung cần ít nhất 10 ký tự');
  if (SECRET.test(`${title}\n${body}`)) throw new Error('nội dung có vẻ chứa token hoặc khoá bí mật — xoá đi rồi gửi lại');
  if (b.confirm !== true) throw new Error('cần xác nhận: nội dung sẽ được đăng công khai trên GitHub');
  return { type: b.type, title, body, includeEnv: b.includeEnv !== false };
}

// The issue as it will be posted: the same text the form previews.
export function buildIssue(f, env = {}) {
  const [label, text] = TYPES[f.type];
  const footer = f.includeEnv ? `\n---\nDashboard v${env.version ?? '?'} · Node ${env.node ?? '?'} · ${env.platform ?? '?'}\n` : '\n---\n';
  return { title: `[${text}] ${f.title}`, labels: ['feedback', label], body: `${f.body}\n${footer}\n_Gửi từ form phản hồi của e2e-dashboard._\n` };
}

// Attempts (not only successes) in the window: a loop of submits cannot spam the repository.
export function rateOk(now = Date.now()) {
  while (attempts.length && now - attempts[0] > WINDOW_MS) attempts.shift();
  if (attempts.length >= MAX_PER_WINDOW) return false;
  attempts.push(now);
  return true;
}

// `gh issue create` with the body on stdin (never in argv). A missing label is retried once without labels.
export function createIssue(issue, { spawnImpl = spawn, repo = FEEDBACK_REPO } = {}) {
  const run = (labels) => new Promise((ok, fail) => {
    const args = ['issue', 'create', '--repo', repo, '--title', issue.title, '--body-file', '-', ...labels.flatMap((l) => ['--label', l])];
    const p = spawnImpl('gh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => fail(new Error(e.code === 'ENOENT' ? 'Không tìm thấy GitHub CLI (gh). Cài gh và chạy gh auth login.' : e.message)));
    p.on('close', (code) => {
      if (code !== 0) return fail(Object.assign(new Error(String(err || 'gh issue create lỗi').trim().slice(0, 300)), { stderr: String(err) }));
      ok({ url: out.trim().split('\n').pop() });
    });
    p.stdin.end(issue.body);
  });
  return run(issue.labels).catch((e) => (/label/i.test(e.stderr ?? e.message) ? run([]) : Promise.reject(e)));
}
