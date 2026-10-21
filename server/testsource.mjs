import { readFile, writeFile, stat } from 'node:fs/promises';
import { safeJoin, realInside, isLink } from '../reporter/e2e-dashboard.reporter.mjs';

// Xem / sửa file test ngay trên trang Tests. Chỉ nhận file mà danh sách Tests đang quét được (`files`: Map của
// discoverTests), không đi qua symlink. Ghi kèm `mtime` lúc mở: file đã đổi trên đĩa (editor khác, git) thì 409.
const MAX = 500_000;
const fail = (status, error) => Object.assign(new Error(error), { status });

function resolveTest(root, rel, files) {
  const full = typeof rel === 'string' && files.has(rel) ? safeJoin(root, rel) : null;
  if (!full || isLink(full) || !realInside(root, full)) throw fail(404, `Không có file test ${rel}`);
  return full;
}

export async function readTestSource(root, rel, files) {
  const full = resolveTest(root, rel, files);
  const st = await stat(full);
  if (st.size > MAX) throw fail(413, `${rel} quá lớn để sửa trên dashboard`);
  return { file: rel, content: await readFile(full, 'utf8'), mtime: st.mtimeMs };
}

export async function writeTestSource(root, rel, content, mtime, files) {
  const full = resolveTest(root, rel, files);
  if (typeof content !== 'string' || !content.trim() || content.length > MAX) throw fail(400, 'Nội dung file không hợp lệ (rỗng hoặc quá lớn)');
  if ((await stat(full)).mtimeMs !== mtime) throw fail(409, `${rel} đã đổi trên đĩa từ lúc mở: mở lại để xem bản mới`);
  await writeFile(full, content);
  return { file: rel, mtime: (await stat(full)).mtimeMs };
}
