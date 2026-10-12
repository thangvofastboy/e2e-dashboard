// Khoanh vùng hành động trong ảnh: sau một thao tác, vẽ khung đỏ quanh element vừa tác động rồi chụp ảnh,
// rồi gỡ khung ngay (khung không nằm lại trên trang). Ảnh là artifact của attempt, dashboard hiện ở tab "Video & ảnh".
// Tắt bằng E2E_MARK=0. Không có khung hoặc chụp lỗi (vd. sau secret fill) thì bỏ qua, không làm fail test.
import type { Browser } from '@e2e-dev/web';

type Box = { x: number; y: number; width: number; height: number };

const slug = (s: string) => s.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'action';

export async function markAction(
  app: { screenshot(label?: string): Promise<string> },
  browser: Browser,
  target: { boundingBox(): Promise<Box | null> },
  label: string,
): Promise<void> {
  if (process.env.E2E_MARK === '0') return;
  const box = await target.boundingBox().catch(() => null);
  if (!box) return; // element không có khung (display: none, đã biến mất): không có gì để khoanh
  await browser
    .evaluate((b: Box) => {
      const el = document.createElement('div');
      el.id = 'e2e-action-mark';
      el.style.cssText = `position:fixed;z-index:2147483647;pointer-events:none;border:3px solid #ef4444;border-radius:4px;box-shadow:0 0 0 2px rgba(255,255,255,.85);left:${b.x - 3}px;top:${b.y - 3}px;width:${b.width + 6}px;height:${b.height + 6}px`;
      document.body.appendChild(el);
    }, box)
    .catch(() => {});
  try {
    await app.screenshot(slug(label));
  } catch {
    // ảnh không chụp được vẫn để test chạy tiếp
  } finally {
    await browser.evaluate(() => document.getElementById('e2e-action-mark')?.remove()).catch(() => {});
  }
}
