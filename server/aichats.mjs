// Lịch sử chat AI lưu trên máy: .e2e-dashboard/state/ai-chats.json. Mỗi chat = một session claude (id = sessionId),
// gồm cả "Hỏi AI" lẫn các phân tích AI (phân tích lỗi, gợi ý locator…), để mở lại và hỏi tiếp bằng followup.
import { RUN_ID, RESULT_ID } from '../reporter/e2e-dashboard.reporter.mjs';
import { readState, writeState, serial } from './jsonstate.mjs';

const FILE = 'state/ai-chats.json';
export const MAX_CHATS = 100;
export const MAX_MSGS = 200;
const MAX_TEXT = 50_000;
// tổng dung lượng file: mỗi câu trả lời đọc + ghi lại cả file, nên giữ nhỏ; quá thì bỏ chat cũ nhất
export const MAX_FILE_CHARS = 5_000_000;
const ID = /^[\w-]{1,100}$/;
const ACTION = /^[a-z-]{1,40}$/;

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

// kiểm tra dữ liệu client gửi lên (ranh giới tin cậy): sai thì 400, không ghi gì
export function validEntry(e) {
  if (!e || typeof e !== 'object' || !ID.test(String(e.id ?? ''))) throw bad('invalid chat id');
  if (typeof e.title !== 'string' || !e.title.trim()) throw bad('invalid title');
  if (!Array.isArray(e.msgs) || !e.msgs.length || e.msgs.length > 20) throw bad('invalid msgs');
  const msgs = e.msgs.map((m) => {
    if (!m || !['user', 'ai'].includes(m.role) || typeof m.text !== 'string') throw bad('invalid msg');
    const out = { role: m.role, text: m.text.slice(0, MAX_TEXT) };
    if (typeof m.error === 'string' && m.error) out.error = m.error.slice(0, 2000);
    return out;
  });
  const s = e.source ?? {};
  const source = {
    action: ACTION.test(String(s.action ?? '')) ? s.action : 'ask',
    runId: RUN_ID.test(String(s.runId ?? '')) ? s.runId : null,
    resultId: RESULT_ID.test(String(s.resultId ?? '')) ? s.resultId : null,
  };
  const sessionId = ID.test(String(e.sessionId ?? '')) ? e.sessionId : e.id; // session mới nhất để hỏi tiếp (resume có thể đổi id)
  return { id: e.id, sessionId, title: e.title.trim().slice(0, 200), source, msgs };
}

const load = async (root) => {
  const d = await readState(root, FILE, null);
  return Array.isArray(d?.chats) ? d.chats : [];
};

// danh sách gọn (không kèm tin nhắn), mới nhất trước
export async function listChats(root) {
  return (await load(root)).map(({ msgs, ...c }) => ({ ...c, count: msgs?.length ?? 0 }));
}

export async function getChat(root, id) {
  if (!ID.test(String(id))) return null;
  return (await load(root)).find((c) => c.id === id) ?? null;
}

// thêm tin nhắn vào chat theo id (chưa có thì tạo); giữ MAX_CHATS chat mới nhất, MAX_MSGS tin cuối mỗi chat
export function appendChat(root, entry, now = Date.now()) {
  const e = validEntry(entry);
  return serial(`ai-chats:${root}`, async () => {
    const chats = await load(root);
    const at = new Date(now).toISOString();
    let c = chats.find((x) => x.id === e.id);
    if (!c) {
      c = { id: e.id, sessionId: e.sessionId, title: e.title, source: e.source, createdAt: at, msgs: [] };
      chats.push(c);
    }
    c.msgs = [...c.msgs, ...e.msgs].slice(-MAX_MSGS);
    c.sessionId = e.sessionId;
    c.updatedAt = at;
    chats.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    const keep = chats.slice(0, MAX_CHATS);
    let size = JSON.stringify(keep).length;
    while (keep.length > 1 && size > MAX_FILE_CHARS) size -= JSON.stringify(keep.pop()).length + 1; // chat mới nhất luôn giữ
    await writeState(root, FILE, { chats: keep });
    const { msgs, ...meta } = c;
    return { ...meta, count: msgs.length };
  });
}

export function deleteChat(root, id) {
  if (!ID.test(String(id))) throw bad('invalid chat id');
  return serial(`ai-chats:${root}`, async () => {
    const chats = await load(root);
    const left = chats.filter((c) => c.id !== id);
    if (left.length !== chats.length) await writeState(root, FILE, { chats: left });
    return { removed: chats.length - left.length };
  });
}
