import { escapeHtml } from './format.js';

function safeHref(url) {
  if (/[\u0000-\u001f\u007f]/.test(url)) return null; // browsers strip these, revealing a hidden scheme
  if (/^https?:\/\//i.test(url) || /^[/#]/.test(url)) return url;
  return /^[a-z][a-z0-9+.-]*:/i.test(url) ? null : url; // relative path without a scheme
}

function inline(text) {
  // code và thẻ <a> giữ chỗ bằng \u0000n\u0000: */** trong URL không bị biến thành <em> làm hỏng href.
  // NUL trong văn bản gốc bị bỏ trước, để không giả được chỗ giữ (sẽ chèn lặp code khác hoặc "undefined").
  const held = [];
  const hold = (html) => `\u0000${held.push(html) - 1}\u0000`;
  let s = escapeHtml(String(text).replace(/\u0000/g, '')).replace(/`([^`]+)`/g, (_m, c) => hold(`<code>${c}</code>`));
  s = s
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, href) => {
      const ok = safeHref(href.replace(/&amp;/g, '&'));
      return ok ? `${hold(`<a href="${escapeHtml(ok)}" rel="noopener noreferrer" target="_blank">`)}${label}${hold('</a>')}` : label;
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i) => held[i]);
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
    const fence = /^(\s*)```\s*([\w+-]*)/.exec(line);
    if (fence) {
      flushPara();
      flushList();
      const code = [];
      const indent = fence[1].length; // fences inside list items come indented
      while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i].slice(Math.min(indent, lines[i].length - lines[i].trimStart().length)));
      out.push(`<pre><code${fence[2] ? ` class="language-${escapeHtml(fence[2].toLowerCase())}"` : ''}>${escapeHtml(code.join('\n'))}\n</code></pre>`);
      continue;
    }
    // bảng pipe: dòng đầu là tiêu đề, dòng sau phải là |---|:-:|; `\|` là ký tự | trong ô
    if (/^\s*\|/.test(line) && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[i + 1] ?? '')) {
      flushPara();
      flushList();
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => inline(c.trim().replace(/\\\|/g, '|')));
      const head = cells(line);
      const body = [];
      for (i += 2; i < lines.length && /^\s*\|/.test(lines[i]); i++) body.push(cells(lines[i]));
      i--;
      out.push(`<table class="table md-table"><thead><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
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
