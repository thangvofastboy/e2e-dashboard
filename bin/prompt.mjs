// Hỏi người dùng trong terminal: câu hỏi có giá trị mặc định, chọn trong danh sách, nhập ẩn (API key).
// Mỗi câu mở / đóng readline riêng để không giữ stdin (lệnh con như `e2e login` cần stdin sau đó).
import { createInterface } from 'node:readline';

export const canAsk = () => Boolean(process.stdin.isTTY && process.stdout.isTTY);

function prompt(q, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    // nhập ẩn: chỉ in câu hỏi, không in ký tự gõ vào
    if (hidden) rl._writeToOutput = (s) => !muted && process.stdout.write(s);
    rl.question(q, (a) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(a.trim());
    });
    muted = true;
  });
}

export async function ask(q, def = '') {
  return (await prompt(`${q}${def ? ` [${def}]` : ''}: `)) || def;
}
export const askHidden = (q) => prompt(`${q}: `, { hidden: true });
export async function confirm(q, def = true) {
  const a = await prompt(`${q} [${def ? 'Y/n' : 'y/N'}]: `);
  return a ? /^(y|yes|c|có|co)$/i.test(a) : def;
}
// items: [{ id, label }]; trả id được chọn (số thứ tự hoặc id), Enter = def
export async function choose(q, items, def) {
  items.forEach((it, i) => console.log(`  ${String(i + 1).padStart(2)}) ${it.label}${it.id === def ? '  ← hiện tại' : ''}`));
  for (;;) {
    const a = await prompt(`${q}${def ? ` [Enter = giữ ${def}]` : ''}: `);
    if (!a && def) return def;
    const hit = items[Number(a) - 1] ?? items.find((it) => it.id === a);
    if (hit) return hit.id;
    console.log('  Chọn số trong danh sách.');
  }
}
