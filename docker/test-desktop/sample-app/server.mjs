// App mẫu tối giản (không cần cài gói) để e2e có chỗ chạy test: http://localhost:5173
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const port = Number(process.env.PORT ?? 5173);
createServer(async (req, res) => {
  if (req.url === '/api/health') return res.end(JSON.stringify({ ok: true }));
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(await readFile(new URL('./index.html', import.meta.url)));
}).listen(port, () => console.log(`sample-app: http://localhost:${port}`));
