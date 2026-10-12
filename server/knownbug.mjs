// Known bug fails again with a different error: that is a new bug on the same test, so its content goes to the
// known issue as a comment (once per distinct error). The error shapes already reported are kept in the QC note (`seen`).
import { errorSignature, resultError, testKey } from './analytics.mjs';
import { bugReport, setNote } from './qc.mjs';

const CLOSED = ['completed', 'canceled'];

export const signatureOf = (report, result) => errorSignature(resultError(report, result))?.id ?? 'no-error';

const commentBody = (run, result) =>
  `**Lỗi mới khi chạy lại test này** (run \`${run.meta.runId}\`)\n\n${bugReport({ meta: run.meta, report: run.report, resultId: result.id }) ?? ''}`.slice(0, 6000);

// status: not-known | same-bug | commented | issue-missing | issue-closed. Throws on a Linear error.
export async function commentIfNewBug({ projectRoot, run, result, linear, notes }) {
  const note = notes[testKey(result)];
  if (!note?.known) return { status: 'not-known' };
  const sig = signatureOf(run.report, result);
  if ((note.seen ?? []).includes(sig)) return { status: 'same-bug', issue: note.known };
  const issue = await linear.get(note.known);
  if (!issue) return { status: 'issue-missing', issue: note.known };
  if (CLOSED.includes(issue.state?.type)) return { status: 'issue-closed', issue: note.known };
  await linear.comment(issue.id, commentBody(run, result));
  await setNote(projectRoot, testKey(result), { seen: [sig] });
  return { status: 'commented', issue: note.known };
}
