import { getJson, postJson } from '../api.js';
import { pageHead } from '../analysis.js';
import { toast } from '../toast.js';
import { escapeHtml, fmtRelative, statusBadge } from '../format.js';
import { runHref } from '../router.js';
import { icon } from '../icons.js';

export const fmtBytes = (b) => (b < 1024 ? `${b} B` : b < 1024 ** 2 ? `${(b / 1024).toFixed(0)} KB` : b < 1024 ** 3 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${(b / 1024 ** 3).toFixed(2)} GB`);

export async function renderSettings(main) {
  const [auto, storage] = await Promise.all([getJson('/api/automation'), getJson('/api/storage')]);
  const s = auto.schedule;
  const kinds = [['video', 'Video'], ['image', 'Ảnh'], ['report', 'report.json'], ['trace', 'Trace'], ['other', 'Khác']];
  const biggest = [...storage.runs].sort((a, b) => b.bytes - a.bytes).slice(0, 8);
  main.innerHTML = `${pageHead('Tự động & lưu trữ', 'gauge', 'Chế độ watch, lịch chạy, webhook và dung lượng lịch sử.')}
    <div class="two-col">
      <section class="panel"><h2>${icon('eye', { size: 15 })} Chế độ watch</h2>
        <p class="muted small">Lưu một file <code>*.e2e.ts</code> là dashboard tự chạy lại đúng file đó (bỏ qua test đang cách ly), xem ở trang Live.</p>
        <label class="pill"><input type="checkbox" data-watch ${auto.watch.enabled ? 'checked' : ''}> Bật watch</label>
        ${auto.watch.last ? `<p class="muted small">Lần gần nhất: ${escapeHtml(auto.watch.last.files.join(', '))} · ${auto.watch.last.ok ? 'đã chạy' : `không chạy được (${escapeHtml(auto.watch.last.error ?? '')})`}</p>` : ''}</section>
      <section class="panel"><h2>${icon('clock', { size: 15 })} Lịch chạy</h2>
        ${s?.times?.length ? `<p>Hằng ngày lúc <strong>${s.times.map(escapeHtml).join(', ')}</strong> · lần tới ${escapeHtml(new Date(s.next).toLocaleString('vi-VN'))}</p>` : '<p class="muted">Chưa đặt lịch.</p>'}
        <p class="muted small">Đặt trong <code>.e2e-dashboard/config.json</code>: <code>"schedule": { "daily": ["02:00"], "tests": [] }</code>. Chỉ chạy khi dashboard đang mở; kết quả gửi qua thông báo desktop và webhook.</p></section>
      <section class="panel"><h2>${icon('send', { size: 15 })} Webhook (Slack / Discord)</h2>
        ${auto.webhooks.length ? `<ul>${auto.webhooks.map((w) => `<li><code>${escapeHtml(w.host)}</code> <span class="muted small">${escapeHtml(w.events.join(', '))}</span></li>`).join('')}</ul><button type="button" data-hook-test>${icon('send', { size: 14 })}Gửi thử</button>` : '<p class="muted">Chưa có webhook.</p>'}
        <p class="muted small">Thêm vào <code>~/.e2e-dashboard/config.json</code> (không đặt trong repo): <code>"webhooks": [{ "url": "https://hooks.slack.com/…", "events": ["run-failed", "digest"] }]</code>. Digest tuần: <code>/e2e-dashboard digest --send</code>.</p></section>
      <section class="panel"><h2>${icon('download', { size: 15 })} Dung lượng: ${escapeHtml(fmtBytes(storage.bytes))}</h2>
        <ul class="hbar">${kinds.map(([k, label]) => `<li><span class="hb-label">${label}</span><span class="hb-track"><span class="hb-fill tone-info" style="width:${storage.bytes ? Math.round((storage.totals[k] / storage.bytes) * 100) : 0}%"></span></span><span class="hb-val">${escapeHtml(fmtBytes(storage.totals[k]))}</span></li>`).join('')}</ul>
        <form class="row" data-prune><label>Xoá video của run cũ hơn <input type="number" name="days" min="0" max="3650" value="7"> ngày</label><button type="submit">${icon('close', { size: 14 })}Xoá video</button></form>
        <p class="muted small">Giữ run fail lâu hơn: <code>"retention": { "keep": 50, "keepFailed": 200 }</code>. Run đã ghim không bao giờ bị xoá.</p></section>
    </div>
    <section><h2>Run nặng nhất</h2><table class="table"><thead><tr><th>Run</th><th>Bắt đầu</th><th class="num">Dung lượng</th><th class="num">Video</th><th></th></tr></thead><tbody>${biggest.map((r) => `<tr><td><a href="${runHref(r.runId)}">${statusBadge(r.status)}</a></td><td>${escapeHtml(fmtRelative(r.startedAt))}</td><td class="num">${escapeHtml(fmtBytes(r.bytes))}</td><td class="num">${escapeHtml(fmtBytes(r.video))}</td>
      <td>${r.pinned ? `<span class="muted small">đã ghim</span>` : `<button type="button" class="small-btn" data-del="${escapeHtml(r.runId)}">${icon('close', { size: 13 })}Xoá run</button>`}</td></tr>`).join('')}</tbody></table></section>`;
  main.querySelector('[data-watch]').addEventListener('change', async (e) => {
    const r = await postJson('/api/watch', { enabled: e.target.checked }).catch((x) => ({ error: x.message }));
    if (r.error || !r.ok) {
      toast(r.error ?? 'Không bật được watch trên hệ thống này.', 'bad');
      e.target.checked = false;
    } else toast(r.enabled ? 'Đã bật watch' : 'Đã tắt watch');
  });
  main.querySelector('[data-hook-test]')?.addEventListener('click', async () => {
    const r = await postJson('/api/webhook/test', {}).catch((x) => ({ error: x.message }));
    if (r.error) toast(r.error, 'bad');
    else toast(r.sent.map((x) => `${x.host}: ${x.ok ? 'OK' : x.status ?? x.error}`).join(' · '), r.sent.every((x) => x.ok) ? 'good' : 'warn');
  });
  main.querySelector('[data-prune]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const days = Number(new FormData(e.target).get('days'));
    if (!confirm(`Xoá video của mọi run (trừ run đã ghim) cũ hơn ${days} ngày?`)) return;
    const r = await postJson('/api/storage/prune', { days }).catch((x) => ({ error: x.message }));
    if (r.error) toast(r.error, 'bad');
    else {
      toast(`Đã xoá ${r.files} video, giải phóng ${fmtBytes(r.freed)}`);
      renderSettings(main);
    }
  });
  main.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Xoá hẳn run này khỏi lịch sử?')) return;
      const r = await postJson(`/api/runs/${encodeURIComponent(b.dataset.del)}/delete`, {}).catch((x) => ({ error: x.message }));
      if (r.error) toast(r.error, 'bad');
      else {
        toast('Đã xoá run');
        renderSettings(main);
      }
    }));
}
