#!/usr/bin/env bash
# e2e-dashboard: cài toàn bộ môi trường bằng một lệnh (macOS / Linux).
#
#   curl -fsSL https://raw.githubusercontent.com/thangvofastboy/e2e-dashboard/main/install.sh | bash
#   curl -fsSL …/install.sh | bash -s -- --project ~/code/my-app --no-open
#
# Lần lượt: git → Node (≥ 22.22.3 hoặc ≥ 24.8, qua nvm, không cần sudo) → Claude Code CLI → plugin
# e2e-dashboard → (trong project có e2e.config.*) Quick Setup: e2e + @e2e-dev/web, node_modules, Chromium,
# reporter, .env → mở dashboard. Phần đã có thì bỏ qua, nên chạy lại bao nhiêu lần cũng được.
# Windows: dùng install.ps1.
set -euo pipefail

REPO="thangvofastboy/e2e-dashboard"
PLUGIN_ID="e2e-dashboard@e2e-dashboard"
NVM_VERSION="v0.40.3"
NODE_LINE="22"

PROJECT="$PWD"
OPEN=1
DRY_RUN=0
SKIP_PROJECT=0

usage() {
  cat <<'EOF'
Dùng: install.sh [--project DIR] [--no-open] [--skip-project] [--dry-run]

  --project DIR    Thư mục project e2e (mặc định: thư mục hiện tại)
  --no-open        Cài xong không mở dashboard
  --skip-project   Chỉ cài máy + plugin, không đụng vào project
  --dry-run        Chỉ in các bước sẽ làm, không cài gì
EOF
}

# cả script nằm trong main(): `curl … | bash` đọc script từ stdin, bash phải đọc hết trước khi chạy
# để lệnh con nào đọc stdin cũng không nuốt mất phần script còn lại
main() {
while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT="${2:?--project cần đường dẫn}"; shift 2 ;;
    --project=*) PROJECT="${1#*=}"; shift ;;
    --no-open) OPEN=0; shift ;;
    --skip-project) SKIP_PROJECT=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Tham số lạ: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [ -t 1 ]; then B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; N=$'\033[0m'; else B= G= Y= R= N=; fi
step() { printf '\n%s▶ %s%s\n' "$B" "$*" "$N"; }
ok() { printf '  %s✓%s %s\n' "$G" "$N" "$*"; }
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$*"; }
die() { printf '%s✗ %s%s\n' "$R" "$*" "$N" >&2; exit 1; }
has() { command -v "$1" >/dev/null 2>&1; }
# chạy lệnh (hoặc chỉ in khi --dry-run)
run() {
  printf '  $ %s\n' "$*"
  [ "$DRY_RUN" = 1 ] || "$@"
}

OS="$(uname -s)"
case "$OS" in
  Linux|Darwin) ;;
  *) die "Hệ điều hành $OS chưa hỗ trợ. Trên Windows dùng install.ps1." ;;
esac

SUDO=""
if [ "$(id -u)" != 0 ]; then
  if has sudo; then SUDO="sudo"; fi
fi

# cài gói hệ thống bằng trình quản lý gói sẵn có; trả 1 nếu không có cái nào
pkg_install() {
  local pkg="$1"
  if [ "$OS" = Darwin ]; then
    has brew || return 1
    run brew install "$pkg"
  elif has apt-get; then
    run $SUDO apt-get update && run $SUDO apt-get install -y "$pkg"
  elif has dnf; then
    run $SUDO dnf install -y "$pkg"
  elif has pacman; then
    run $SUDO pacman -S --noconfirm "$pkg"
  else
    return 1
  fi
}

# e2e bản mới cần Node ≥ 22.22.3 (hoặc ≥ 24.8); dashboard cần ≥ 22
node_ok() {
  has node || return 1
  local v major minor patch
  v="$(node -p 'process.versions.node' 2>/dev/null)" || return 1
  IFS=. read -r major minor patch <<<"$v"
  if [ "$major" -ge 25 ]; then return 0; fi
  if [ "$major" -eq 24 ] && [ "$minor" -ge 8 ]; then return 0; fi
  if [ "$major" -eq 22 ] && { [ "$minor" -gt 22 ] || { [ "$minor" -eq 22 ] && [ "$patch" -ge 3 ]; }; }; then return 0; fi
  return 1
}

load_nvm() {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # nvm.sh dùng biến chưa gán: tạm tắt set -u khi nạp
  if [ -s "$NVM_DIR/nvm.sh" ]; then set +u; . "$NVM_DIR/nvm.sh"; set -u; return 0; fi
  return 1
}

printf '%se2e-dashboard: cài môi trường%s%s\n' "$B" "$N" "$([ "$DRY_RUN" = 1 ] && echo ' (dry-run: không cài gì)')"

# ── 1. git ─────────────────────────────────────────────────────────────
step "git"
if has git; then
  ok "$(git --version)"
else
  pkg_install git || die "Không tự cài được git: cài tay (https://git-scm.com/downloads) rồi chạy lại."
fi

# ── 2. Node.js ─────────────────────────────────────────────────────────
step "Node.js (≥ 22.22.3 hoặc ≥ 24.8)"
if node_ok; then
  ok "node $(node -v)"
else
  if has node; then warn "node $(node -v) quá cũ cho e2e: cài Node $NODE_LINE qua nvm (không đụng tới bản hệ thống)"; fi
  if ! load_nvm; then
    has curl || die "Cần curl để tải nvm."
    printf '  $ curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/%s/install.sh | bash\n' "$NVM_VERSION"
    if [ "$DRY_RUN" != 1 ]; then
      curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/$NVM_VERSION/install.sh" | bash
      load_nvm || die "Cài nvm xong nhưng không nạp được \$NVM_DIR/nvm.sh."
    fi
  fi
  if [ "$DRY_RUN" = 1 ]; then
    printf '  $ nvm install %s && nvm alias default %s\n' "$NODE_LINE" "$NODE_LINE"
  else
    set +u
    nvm install "$NODE_LINE"
    nvm alias default "$NODE_LINE" >/dev/null
    nvm use "$NODE_LINE" >/dev/null
    set -u
    node_ok || die "Đã cài Node qua nvm nhưng phiên bản vẫn chưa đạt: $(node -v)"
    ok "node $(node -v) (nvm; terminal mới tự dùng bản này)"
  fi
fi

# ── 3. Claude Code CLI ────────────────────────────────────────────────
step "Claude Code CLI"
if has claude; then
  ok "claude $(claude --version 2>/dev/null | head -n1)"
else
  if ! run npm install -g @anthropic-ai/claude-code </dev/null; then
    die "npm install -g lỗi (thường do quyền): chạy lại script sau khi cài Node bằng nvm, hoặc cài Claude Code theo hướng dẫn chính thức."
  fi
  if [ "$DRY_RUN" != 1 ]; then
    hash -r
    has claude || die "Đã cài @anthropic-ai/claude-code nhưng không thấy lệnh claude trên PATH ($(npm prefix -g)/bin)."
    ok "claude $(claude --version 2>/dev/null | head -n1)"
  fi
fi

# ── 4. Plugin e2e-dashboard ───────────────────────────────────────────
step "Plugin e2e-dashboard"
plugin_path() {
  claude plugin list --json </dev/null 2>/dev/null | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try { const p = JSON.parse(s).find((x) => x.id === process.argv[1]); if (p?.installPath) console.log(p.installPath); } catch {}
    });' "$PLUGIN_ID"
}
PLUGIN_DIR=""
if has claude; then PLUGIN_DIR="$(plugin_path)"; fi
if [ -n "$PLUGIN_DIR" ]; then
  # đã cài: lấy bản mới nhất (marketplace ghim theo tag phát hành)
  run claude plugin marketplace update e2e-dashboard </dev/null >/dev/null 2>&1 || true
  run claude plugin update "$PLUGIN_ID" </dev/null >/dev/null 2>&1 || true
else
  run claude plugin marketplace add "$REPO" </dev/null
  run claude plugin install "$PLUGIN_ID" </dev/null
fi
if [ "$DRY_RUN" != 1 ]; then
  PLUGIN_DIR="$(plugin_path)"
  [ -n "$PLUGIN_DIR" ] && [ -f "$PLUGIN_DIR/bin/dashboard.mjs" ] || die "Không tìm thấy plugin sau khi cài (claude plugin list --json)."
  ok "$PLUGIN_ID → $PLUGIN_DIR"
fi
DASH="${PLUGIN_DIR:-<plugin>}/bin/dashboard.mjs"

# ── 5. Project: e2e, thư viện, trình duyệt, reporter, .env ────────────
find_project() {
  local d
  d="$(cd "$1" 2>/dev/null && pwd)" || return 1
  while :; do
    for n in e2e.config.ts e2e.config.mts e2e.config.js e2e.config.mjs; do
      [ -f "$d/$n" ] && { echo "$d"; return 0; }
    done
    [ "$d" = / ] && return 1
    d="$(dirname "$d")"
  done
}

ROOT=""
if [ "$SKIP_PROJECT" = 1 ]; then
  step "Project: bỏ qua (--skip-project)"
elif ROOT="$(find_project "$PROJECT")"; then
  step "Project $ROOT: Quick Setup"
  # bước lỗi (vd. gh tuỳ chọn) không chặn việc mở dashboard: trang Cài đặt hệ thống › Quick Setup làm tiếp được
  (cd "$ROOT" && run node "$DASH" setup --quick --yes </dev/null) || warn "Quick Setup còn mục lỗi hoặc cần làm tay (xem ở trên); mở dashboard → Cài đặt hệ thống › Quick Setup để làm tiếp."
else
  step "Project"
  warn "Không thấy e2e.config.(ts|mts|js|mjs) từ $PROJECT trở lên: chưa cài phần của project."
  warn "Tạo project e2e trước (vd. nhờ Claude Code dựng e2e.config.ts), rồi chạy lại với --project <thư mục>."
fi

# ── 6. Đăng nhập Claude + mở dashboard ────────────────────────────────
step "Hoàn tất"
if [ "$DRY_RUN" != 1 ] && ! claude auth status --text >/dev/null 2>&1; then
  warn "Claude Code chưa đăng nhập: gõ \`claude\` một lần để đăng nhập (tính năng AI của dashboard dùng phiên này)."
fi
if [ -n "$ROOT" ] && [ "$OPEN" = 1 ]; then
  (cd "$ROOT" && run node "$DASH" </dev/null)
elif [ -n "$ROOT" ]; then
  ok "Mở dashboard: trong Claude Code gõ /e2e-dashboard (hoặc: cd \"$ROOT\" && node \"$DASH\")"
fi
ok "Xong. Trong Claude Code đang mở, gõ /reload-plugins để nạp plugin."
}

main "$@"
