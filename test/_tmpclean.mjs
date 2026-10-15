// Nạp trước bởi `npm test` (node --import): xoá mọi thư mục tạm mà test tạo bằng mkdtempSync / fs.promises.mkdtemp khi tiến trình thoát.
// Trước đây các test tạo thư mục trong thư mục tạm của hệ điều hành (tmpfs = nằm trong RAM trên nhiều máy) và không bao giờ xoá:
// mỗi lần `npm test` rò rỉ khoảng 60 MB, vài trăm lần chạy là đầy 16 GB RAM.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

const base = resolve(tmpdir());
const made = new Set();
const track = (p) => {
  if (typeof p === 'string' && resolve(p).startsWith(base + sep)) made.add(p);
  return p;
};

const mkdtempSync = fs.mkdtempSync;
fs.mkdtempSync = (...args) => track(mkdtempSync(...args));
const mkdtemp = fs.promises.mkdtemp;
fs.promises.mkdtemp = async (...args) => track(await mkdtemp(...args));
syncBuiltinESMExports(); // các `import { mkdtempSync } from 'node:fs'` thấy bản đã bọc

process.on('exit', () => {
  for (const dir of made) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // đang bị dùng hoặc đã mất: bỏ qua, không làm test fail
    }
  }
});

// Test không bao giờ được gọi Linear thật: máy dev có thể có API key trong ~/.e2e-dashboard/config.json, một test quên
// cô lập HOME sẽ tạo issue thật (đã xảy ra với autobug.test). Mọi request tới api.linear.app đều bị từ chối.
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = String(input?.url ?? input);
  if (/^https?:\/\/api\.linear\.app\b/i.test(url)) return Promise.reject(new Error(`test chặn request Linear thật: ${url}`));
  return realFetch(input, init);
};
