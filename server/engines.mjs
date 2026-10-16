// Engine của một e2e.config.* (đọc từ import): dùng chung cho đọc config (Setup / Projects), Quick Setup và chọn
// trình duyệt, để các trang không hiểu khác nhau. Không import module nào khác: e2econfig ↔ quicksetup đã import nhau.
export function configEngines(source) {
  const src = String(source ?? '');
  return {
    web: /['"]@e2e-dev\/web['"]/.test(src),
    mobile: /['"]@e2e-dev\/mobile['"]/.test(src),
    platforms: [...new Set([...src.matchAll(/\bplatform\s*:\s*['"](ios|android)['"]/g)].map((m) => m[1]))],
  };
}
