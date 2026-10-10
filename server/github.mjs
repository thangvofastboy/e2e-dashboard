// Post a run comparison as a comment on the branch's open pull request, through the GitHub CLI the
// user is already signed in to (`gh`). argv only, body on stdin: report text never reaches a shell.
import { execFile as nodeExecFile } from 'node:child_process';

const CHANGE_LABEL = { regressed: '🔴 Mới fail', 'still-failing': '🟠 Vẫn fail', 'became-flaky': '🟡 Thành flaky', fixed: '🟢 Đã sửa', added: '🆕 Test mới', removed: '➖ Bị bỏ' };
const md = (s, n = 200) => String(s ?? '').replace(/[\\`*_[\]<>|]/g, '\\$&').replace(/\s+/g, ' ').slice(0, n);
const fmtMs = (ms) => (ms == null ? '—' : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}s`);

export function prCommentMarkdown(cmp, { project = '' } = {}) {
  const rows = cmp.rows.filter((r) => CHANGE_LABEL[r.change]);
  const pr = (m) => `${md(m.git?.branch ?? '?', 80)}@${String(m.git?.commit ?? '').slice(0, 7)}`;
  const d = cmp.deltas;
  const lines = [
    `### 🧪 e2e${project ? ` · ${md(project, 80)}` : ''}: ${pr(cmp.base)} → ${pr(cmp.head)}`,
    '',
    `| | A (${md(cmp.base.status, 20)}) | B (${md(cmp.head.status, 20)}) |`,
    '|---|---|---|',
    `| Thời gian | ${fmtMs(cmp.base.durationMs)} | ${fmtMs(cmp.head.durationMs)} |`,
    `| Pass rate | | ${d.passRate == null ? '—' : `${d.passRate >= 0 ? '+' : ''}${Math.round(d.passRate * 100)} điểm`} |`,
    '',
  ];
  if (!rows.length) lines.push('Không có test nào đổi kết quả.');
  else {
    lines.push('| Thay đổi | Test | Lỗi |', '|---|---|---|');
    for (const r of rows.slice(0, 40)) {
      const e = r.b?.error && r.change !== 'fixed' ? `\`${String(r.b.error.code ?? '').replace(/`/g, '')}\` ${md(r.b.error.message, 140)}` : '';
      lines.push(`| ${CHANGE_LABEL[r.change]} | ${md(r.title)} \\[${md(r.target, 40)}\\] | ${e} |`);
    }
    if (rows.length > 40) lines.push('', `…và ${rows.length - 40} test khác.`);
  }
  lines.push('', '<sub>Tạo từ e2e-dashboard</sub>');
  return lines.join('\n');
}

const BRANCH = /^(?!-)[\w./-]{1,200}$/;

export function createGithub({ projectRoot, execImpl = nodeExecFile }) {
  const gh = (args, input) => new Promise((ok, fail) => {
    const child = execImpl('gh', args, { cwd: projectRoot, timeout: 30_000 }, (err, stdout, stderr) =>
      err ? fail(new Error(err.code === 'ENOENT' ? 'Không tìm thấy GitHub CLI (gh). Cài gh rồi chạy gh auth login.' : String(stderr || err.message).trim().slice(0, 500))) : ok(String(stdout)));
    if (input != null) child?.stdin?.end(input);
  });
  return {
    async findPr(branch) {
      if (!BRANCH.test(branch ?? '')) return null;
      const out = await gh(['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number,url,title', '--limit', '1']);
      const list = JSON.parse(out || '[]');
      return list[0] ?? null;
    },
    async comment(number, body) {
      if (!Number.isInteger(number) || number < 1) throw new Error('invalid PR number');
      const out = await gh(['pr', 'comment', String(number), '--body-file', '-'], body);
      return out.trim();
    },
  };
}
