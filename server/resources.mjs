// Tài nguyên máy và tài nguyên app đang dùng (trang Live, Hệ thống): GET /api/resources.
import { cpus, loadavg, totalmem, freemem } from 'node:os';
import { statfs } from 'node:fs/promises';
import { execFile } from 'node:child_process';

const MB = 1024 * 1024;
const round1 = (n) => Math.round(n * 10) / 10;
const sum = (t) => Object.values(t ?? {}).reduce((a, b) => a + (Number(b) || 0), 0);

// % CPU cả máy từ hai mẫu os.cpus(): phần không idle trên tổng thời gian trôi qua
export function cpuPercent(a, b) {
  let busy = 0;
  let total = 0;
  b.forEach((c, i) => {
    const d = sum(c.times) - sum(a[i]?.times);
    total += d;
    busy += d - ((c.times?.idle ?? 0) - (a[i]?.times?.idle ?? 0));
  });
  return total > 0 ? round1((busy / total) * 100) : 0;
}

export async function machineResources(root, { sampleMs = 200 } = {}) {
  const first = cpus();
  await new Promise((r) => setTimeout(r, sampleMs));
  const second = cpus();
  const disk = await statfs(root).catch(() => null);
  return {
    cores: second.length,
    cpuModel: second[0]?.model?.trim() ?? '',
    cpuPct: cpuPercent(first, second),
    loadavg: loadavg().map(round1),
    memTotal: totalmem(),
    memFree: freemem(),
    diskTotal: disk ? disk.blocks * disk.bsize : null,
    diskFree: disk ? disk.bavail * disk.bsize : null,
  };
}

// output `ps -A -o pid=,pgid=,rss=,%cpu=`: cộng các tiến trình cùng nhóm với runner (gồm cả trình duyệt); dòng lạ bỏ qua
export function parsePs(out, pgid) {
  let rss = 0;
  let cpu = 0;
  let count = 0;
  for (const line of String(out).split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s*$/.exec(line);
    if (!m || Number(m[2]) !== pgid) continue;
    rss += Number(m[3]); // KB
    cpu += Number(m[4]);
    count++;
  }
  return { rssMb: round1(rss / 1024), cpuPct: round1(cpu), count };
}

const runPs = () => new Promise((ok, fail) => execFile('ps', ['-A', '-o', 'pid=,pgid=,rss=,%cpu='], { timeout: 3000, maxBuffer: 4 * MB }, (e, out) => (e ? fail(e) : ok(out))));

// runner chạy detached (nhóm tiến trình riêng, pgid = pid). Windows / không có ps: không đo được
export async function runnerResources(pid, { platform = process.platform, exec = runPs } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (platform === 'win32') return { unavailable: 'không đo được' };
  try {
    return parsePs(await exec(), pid);
  } catch {
    return { unavailable: 'không đo được' };
  }
}

// tiến trình dashboard: %CPU từ process.cpuUsage giữa hai lần gọi
let lastCpu = { usage: process.cpuUsage(), at: process.hrtime.bigint() };
export function dashboardResources() {
  const now = { usage: process.cpuUsage(), at: process.hrtime.bigint() };
  const us = now.usage.user + now.usage.system - lastCpu.usage.user - lastCpu.usage.system;
  const elapsedUs = Number(now.at - lastCpu.at) / 1000;
  lastCpu = now;
  return { rssMb: round1(process.memoryUsage().rss / MB), cpuPct: elapsedUs > 0 ? round1((us / elapsedUs) * 100) : 0 };
}
