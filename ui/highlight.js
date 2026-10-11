// Tiny syntax colouring for what the dashboard shows: JSON (config, data), JS/TS (locators, tests),
// shell (bisect, CLI commands), file:line paths and app logs. Every character goes through escapeHtml;
// the only markup added is <span class="hl-…">, so report text can never inject HTML here.
import { escapeHtml } from './format.js';

// every lookbehind is bounded ({0,8}): an unbounded one rescans the text at each position, O(n²) on long input
const RULES = {
  json: /(?<key>"(?:\\.|[^"\\\n])*"(?=\s*:))|(?<str>"(?:\\.|[^"\\\n])*")|(?<num>-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(?<kw>\b(?:true|false|null)\b)|(?<punc>[{}[\],:])/g,
  js: /(?<com>\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(?<str>(["'`])(?:\\.|(?!\3)[^\\\n])*\3)|(?<kw>\b(?:await|async|const|let|var|function|return|if|else|for|of|in|new|import|from|export|default|true|false|null|undefined|this|test|expect|describe)\b)|(?<num>\b\d+(?:\.\d+)?\b)|(?<fn>\b[A-Za-z_$][\w$]*(?=\())/g,
  shell: /(?<com>(?<=^|\s)#[^\n]*)|(?<str>"(?:\\.|[^"\\\n])*"|'[^'\n]*')|(?<cmd>(?<=^\s{0,8}|[;&|]\s{0,8})(?:npx|npm|node|git|gh|claude|cd|rm|cp|mv|curl)\b)|(?<flag>(?<=\s)--?[A-Za-z][\w-]*)|(?<path>[\w./@-]+\.[a-z]{1,5}(?::\d+)?)|(?<num>\b\d+\b)/gm,
  path: /(?<path>[^:\s]+)(?<num>:\d+(?::\d+)?)?/g,
};
const PRETTY_MAX = 200_000;

function paint(text, rx) {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(rx)) {
    if (!m[0]) continue;
    out += escapeHtml(text.slice(last, m.index));
    if (m.groups.path !== undefined && m.groups.num !== undefined && rx === RULES.path) {
      out += `<span class="hl-path">${escapeHtml(m.groups.path)}</span><span class="hl-num">${escapeHtml(m.groups.num)}</span>`;
    } else {
      const kind = Object.keys(m.groups).find((k) => m.groups[k] !== undefined);
      out += `<span class="hl-${kind}">${escapeHtml(m[0])}</span>`;
    }
    last = m.index + m[0].length;
  }
  return out + escapeHtml(text.slice(last));
}

// json | shell | js | path | text
export function detectLang(text) {
  const t = String(text ?? '').trim();
  if (!t) return 'text';
  if (/^[{[]/.test(t)) {
    try {
      JSON.parse(t);
      return 'json';
    } catch {
      // not JSON after all: fall through
    }
  }
  if (/^"[^"\n]+"\s*:/.test(t)) return 'json'; // a config fragment: "retention": { … }
  if (/^(?:\$\s*)?(?:npx|npm|node|git|gh|claude|curl)\s/m.test(t)) return 'shell';
  if (/^[\w./@-]+\.[a-z]{1,5}(?::\d+){1,2}$/i.test(t)) return 'path';
  if (/[A-Za-z_$][\w$]*\(|=>|\b(?:await|const|let)\b/.test(t)) return 'js';
  return 'text';
}

// HTML for `text`; `pretty` re-indents JSON that parses (one-line API payloads become readable).
export function highlight(text, lang = detectLang(text), { pretty = false } = {}) {
  let s = String(text ?? '');
  // digit runs of 16+ (ids, ns timestamps) would be rounded by JSON.parse: show those as written
  if (lang === 'json' && pretty && s.length < PRETTY_MAX && !/\d{16}/.test(s)) {
    try {
      s = JSON.stringify(JSON.parse(s), null, 2);
    } catch {
      // fragment or invalid: colour it as is
    }
  }
  // ponytail: past these sizes an unterminated quote makes the tokenizers quadratic; plain text instead
  if (s.length > PRETTY_MAX * 10 || /[^\n]{5000}/.test(s)) return escapeHtml(s);
  return RULES[lang] ? paint(s, RULES[lang]) : escapeHtml(s);
}

// App and runner logs: each line tinted by level, with URLs, HTTP errors, durations and [tags] picked out.
const LOG_TOKENS = /(?<url>\bhttps?:\/\/[^\s"'<>]+)|(?<bad>(?<=\s)[45]\d\d(?=\s|$))|(?<num>\b\d+(?:\.\d+)?(?:ms|s|m)\b)|(?<tag>^\[[^\]\n]{1,24}\])|(?<ok>[✓✔])|(?<x>[✗✘×])/g;
export function highlightLog(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => {
      const level = /\b(?:error|fail(?:ed|ure)?|exception|uncaught)\b|^\[(?:error|err)\]|[✗✘]/i.test(line) ? ' hl-err'
        : /\bwarn(?:ing)?\b|^\[warn/i.test(line) ? ' hl-warn'
        : /\b(?:passed|success)\b|[✓✔]/i.test(line) ? ' hl-ok' : '';
      return `<span class="ln${level}">${line.length > 5000 ? escapeHtml(line) : paint(line, LOG_TOKENS)}</span>`;
    })
    .join('\n');
}
