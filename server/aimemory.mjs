// "AI ghi nhớ dự án": mỗi lần người dùng cập nhật bối cảnh dự án (thư mục test, các thư mục khác + mô tả, prompt),
// dashboard cho Claude đọc các thư mục đó rồi viết một bản ghi nhớ ngắn về hệ thống. Bản ghi nhớ được gửi kèm mọi
// lần gọi AI sau đó (projectBlock trong ai.mjs), nên AI "nhớ" hệ thống mà không phải đọc lại mỗi lần.
// Lưu ở .e2e-dashboard/state/ai-memory.json: { text, updatedAt, hash, error }. Trạng thái "đang đọc" giữ trong bộ nhớ.
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { readState, writeState } from './jsonstate.mjs';
import { readSettings, detectTestDir } from './settings.mjs';
import { findConfig } from '../bin/project.mjs';

const FILE = 'ai-memory.json';
export const MEMORY_MAX = 6000; // ký tự: bản ghi nhớ đi kèm mọi lần gọi AI nên phải gọn

// thư mục test thực dùng: đã đặt, không thì đoán từ e2e.config / tests, e2e, test
export async function effectiveTestDir(root, settings) {
  if (settings?.testDir) return { path: settings.testDir, detected: false };
  const cfg = findConfig(root);
  const src = cfg ? await readFile(cfg, 'utf8').catch(() => '') : '';
  const d = detectTestDir(root, src);
  return { path: d, detected: Boolean(d) };
}

// thông tin người dùng nhập: đổi là bản ghi nhớ cũ "cần đọc lại"
export function contextHash({ testDir = '', sources = [], prompt = '' } = {}) {
  const norm = { testDir, sources: sources.map((s) => [s.path, s.description ?? '']), prompt };
  return createHash('sha256').update(JSON.stringify(norm)).digest('hex').slice(0, 16);
}

export async function readMemory(root) {
  const m = await readState(root, FILE, null);
  return m && typeof m === 'object' ? { text: typeof m.text === 'string' ? m.text.slice(0, MEMORY_MAX) : '', updatedAt: m.updatedAt ?? null, hash: m.hash ?? null, error: m.error ?? null, failedAt: m.failedAt ?? null } : null;
}

export function learnPrompt({ testDir, sources, prompt }) {
  const dirs = sources.map((s) => `- ${s.path}${s.description ? `: ${s.description}` : ''}`).join('\n');
  return [
    'Bạn đang chuẩn bị "bản ghi nhớ về hệ thống" cho một dashboard kiểm thử e2e. Bản ghi nhớ sẽ được gửi kèm mọi lần dashboard nhờ bạn phân tích lỗi test, viết bug report, viết test mới, nên phải đúng, gọn và hữu ích.',
    'Hãy đọc (Read / Grep / Glob, chỉ đọc) các thư mục dưới đây. Đọc có chọn lọc: README, cấu hình, router / route, các module chính, vài file test tiêu biểu. Không đọc node_modules, file build, file bí mật (.env…).',
    testDir ? `Thư mục chứa test e2e: ${testDir}` : 'Chưa biết thư mục test: tự tìm file *.e2e.ts trong project.',
    dirs ? `Các thư mục khác của hệ thống (người dùng mô tả):\n${dirs}` : '',
    prompt ? `Người dùng viết thêm về hệ thống:\n${prompt}` : '',
    `Viết bản ghi nhớ bằng tiếng Việt, Markdown, tối đa khoảng 600 từ (không quá ${MEMORY_MAX} ký tự), gồm các mục:
## Hệ thống làm gì
## Các phần và thư mục (mỗi thư mục: vai trò, công nghệ, file quan trọng)
## Luồng nghiệp vụ chính (để hiểu test đang kiểm tra gì)
## Test e2e (cách tổ chức, quy ước đặt tên / tag, helper dùng chung, dữ liệu test, URL app)
## Thuật ngữ miền
## Lưu ý khi phân tích test fail (chỗ hay hỏng, phụ thuộc ngoài, dữ liệu dễ đổi)
Chỉ ghi điều đọc được từ mã nguồn hoặc người dùng viết; chỗ không chắc thì ghi "chưa rõ". Chỉ trả về bản ghi nhớ, không lời dẫn.`,
  ].filter(Boolean).join('\n\n');
}

// aiFor(root): AI dùng để đọc project đó (cwd = root, --add-dir các thư mục). Một lần đọc cho mỗi project tại một thời điểm.
export function createLearner({ aiFor, now = () => new Date() }) {
  const running = new Map(); // root → { startedAt, promise }

  async function inputs(root) {
    const st = await readSettings(root);
    const td = await effectiveTestDir(root, st);
    return { testDir: td.path, testDirDetected: td.detected, sources: st.sources, prompt: st.prompt };
  }

  async function status(root) {
    const key = resolve(root);
    const [mem, inp] = await Promise.all([readMemory(root), inputs(root)]);
    const hash = contextHash(inp);
    const run = running.get(key);
    const state = run ? 'learning' : mem?.error && !mem?.text ? 'error' : !mem?.text ? 'none' : mem.hash === hash ? 'ready' : 'stale';
    return { state, updatedAt: mem?.updatedAt ?? null, startedAt: run?.startedAt ?? null, error: mem?.error ?? null, failedAt: mem?.failedAt ?? null, text: mem?.text ?? '', inputs: inp };
  }

  // chạy nền; gọi lại khi đang đọc thì trả lần đang chạy (không chạy song song hai lần cho một project)
  function learn(root) {
    const key = resolve(root);
    if (running.has(key)) return running.get(key).promise;
    const startedAt = now().toISOString();
    const promise = (async () => {
      const inp = await inputs(root);
      const hash = contextHash(inp);
      let text = '';
      let error = null;
      await aiFor(key).run({
        prompt: learnPrompt(inp),
        onEvent: (e) => {
          if (e.type === 'text') text += e.text;
          else if (e.type === 'done') {
            if (e.isError) error = String(e.result ?? 'AI trả lỗi');
            else if (typeof e.result === 'string' && e.result.trim()) text = e.result;
          } else if (e.type === 'error') error = e.message;
        },
      });
      text = text.trim().slice(0, MEMORY_MAX);
      const prev = await readMemory(root);
      // lỗi thì giữ bản ghi nhớ cũ (vẫn hơn không có), chỉ ghi lại lỗi
      const next = error || !text ? { ...(prev ?? {}), error: error ?? 'AI không trả về nội dung', failedAt: now().toISOString() } : { text, updatedAt: now().toISOString(), hash, error: null };
      await writeState(root, FILE, next);
      return next;
    })().finally(() => running.delete(key));
    running.set(key, { startedAt, promise });
    return promise;
  }

  return { learn, status, isLearning: (root) => running.has(resolve(root)) };
}
