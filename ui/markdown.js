import { escapeHtml } from './format.js';

function safeHref(url) {
  if (/^https?:\/\//i.test(url) || /^[/#]/.test(url)) return url;
  return /^[a-z][a-z0-9+.-]*:/i.test(url) ? null : url; // relative path without a scheme
}

function inline(text) {
  const codes = [];
  let s = escapeHtml(text).replace(/`([^`]+)`/g, (_m, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, href) => {
      const ok = safeHref(href.replace(/&amp;/g, '&'));
      return ok ? `<a href="${escapeHtml(ok)}" rel="noopener noreferrer" target="_blank">${label}</a>` : label;
    });
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i) => `<code>${codes[i]}</code>`);
}

export function renderMarkdown(src) {
  const out = [];
  const lines = String(src ?? '').replace(/\r\n/g, '\n').split('\n');
  let para = [];
  let list = null; // { tag, items }
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('```')) {
      flushPara();
      flushList();
      const code = [];
      while (++i < lines.length && !lines[i].startsWith('```')) code.push(lines[i]);
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}\n</code></pre>`);
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      flushList();
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
    } else if (ul || ol) {
      flushPara();
      const tag = ul ? 'ul' : 'ol';
      if (list?.tag !== tag) flushList();
      list ??= { tag, items: [] };
      list.items.push((ul ?? ol)[1]);
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return out.join('\n');
}
