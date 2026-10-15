#!/usr/bin/env bash
# e2e-dashboard: cài toàn bộ môi trường bằng một lệnh (macOS / Linux / WSL).
#
#   curl -fsSL https://raw.githubusercontent.com/thangvofastboy/e2e-dashboard/main/install.sh | bash
#   curl -fsSL …/install.sh | bash -s -- --project ~/code/my-app --app-url http://localhost:5173 --app-command "npm run dev"
#
# 8 bước, bước nào đã có thì bỏ qua (chạy lại bao nhiêu lần cũng được):
#   1 hệ điều hành → 2 git → 3 Node (≥ 22.22.3 / ≥ 24.8) → 4 Claude Code CLI → 5 plugin → 6 e2e.config.ts
#   → 7 Quick Setup (e2e + @e2e-dev/web, node_modules, Chromium, reporter, .env) → 8 mở dashboard.
# Windows: dùng install.ps1 (hoặc chạy script này trong WSL, cách e2e khuyên dùng trên Windows).
# Viết cho bash 3.2 (bash mặc định của macOS): mảng rỗng mở bằng ${a[@]+"${a[@]}"} để không vấp set -u.
set -euo pipefail

REPO="thangvofastboy/e2e-dashboard"
PLUGIN_ID="e2e-dashboard@e2e-dashboard"
NVM_VERSION="v0.40.3"
NODE_LINE="22"

usage() {
  cat <<'EOF'
Dùng: install.sh [tuỳ chọn]

  --project DIR          Thư mục project e2e (mặc định: thư mục hiện tại)
  --init                 Chưa có e2e.config.ts thì tạo bằng `e2e init` (không hỏi)
  --gateway ID           Model cho bước agent khi tạo config: vercel | openrouter | openai-compatible |
                         chatgpt | copilot | opencode-console | grok | none (mặc định: hỏi, hoặc vercel)
  --app-url URL          URL app đang test, ghi vào e2e.config.ts
  --app-command "CMD"    Lệnh khởi động app để runner tự chạy (vd. "npm run dev"; "" để bỏ)
  -y, --yes              Không hỏi gì: dùng giá trị mặc định / tham số ở trên
  --no-open              Cài xong không mở dashboard
  --skip-project         Chỉ cài máy + plugin, không đụng vào project
  --dry-run              Chỉ phát hiện hệ điều hành và in các bước sẽ làm, không cài gì
EOF
}

STEPS=("Phát hiện hệ điều hành" "git" "Node.js ≥ 22.22.3 (hoặc ≥ 24.8)" "Claude Code CLI" "Plugin e2e-dashboard" "Cấu hình e2e.config.ts" "Quick Setup: e2e, thư viện, trình duyệt, reporter" "Mở dashboard")
TOTAL=${#STEPS[@]}
RESULT=()   # kết quả từng bước "trạng thái|ghi chú|giây", in ở bảng tổng kết
CUR=0
STARTED=0

if [ -t 1 ]; then B=$'\033[1m'; D=$'\033[2m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; C=$'\033[36m'; N=$'\033[0m'; else B= D= G= Y= R= C= N=; fi
# bắt đầu bước n: in "[n/8] Tên bước"
step() {
  CUR=$1
  STARTED=$SECONDS
  printf '\n%s[%d/%d] %s%s\n' "$B$C" "$CUR" "$TOTAL" "${STEPS[$((CUR - 1))]}" "$N"
}
# kết thúc bước hiện tại: done (đã cài / đã làm) | have (đã có sẵn) | skip | manual (cần làm tay) | fail | plan (dry-run)
finish() { RESULT[$CUR]="$1|$2|$((SECONDS - STARTED))"; }
doing() { printf '  %s→ Đang %s%s\n' "$Y" "$*" "$N"; }
ok() { printf '  %s✓%s %s\n' "$G" "$N" "$*"; }
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$*"; }
info() { printf '  %s%s%s\n' "$D" "$*" "$N"; }
die() {
  printf '  %s✗ %s%s\n' "$R" "$*" "$N" >&2
  if [ "$CUR" -gt 0 ]; then finish fail "$*"; fi
  summary
  exit 1
}
has() { command -v "$1" >/dev/null 2>&1; }
# chạy lệnh (hoặc chỉ in khi --dry-run)
run() {
  printf '  %s$ %s%s\n' "$D" "$*" "$N"
  [ "$DRY_RUN" = 1 ] || "$@"
}
# có terminal để hỏi người dùng không (stdin có thể là script đang pipe từ curl)
can_ask() { [ "$YES" != 1 ] && [ -t 1 ] && { : </dev/tty; } 2>/dev/null; }

summary() {
  printf '\n%sTổng kết%s\n' "$B" "$N"
  local i st msg secs mark
  for ((i = 1; i <= TOTAL; i++)); do
    IFS='|' read -r st msg secs <<<"${RESULT[$i]:-pending||}"
    case "$st" in
      done) mark="$G✓ đã cài   $N" ;;
      have) mark="$G✓ đã có    $N" ;;
      skip) mark="$D- bỏ qua   $N" ;;
      manual) mark="$Y! làm tay  $N" ;;
      fail) mark="$R✗ lỗi      $N" ;;
      plan) mark="$C· sẽ chạy  $N" ;;
      *) mark="$D· chưa chạy$N" ;;
    esac
    [ "$secs" = 0 ] && secs=""
    printf '  %d. %s %s%s%s\n' "$i" "$mark" "${STEPS[$((i - 1))]}" "$D" "${msg:+ — $msg}${secs:+ (${secs}s)}$N"
  done
}

# ── hệ điều hành ──────────────────────────────────────────────────────
OS_KIND=""; OS_NAME=""; OS_FAMILY=""; ARCH=""; WSL=0; MUSL=0; PM=""; SUDO=""
detect_os() {
  OS_KIND="$(uname -s)"
  ARCH="$(uname -m)"
  case "$ARCH" in x86_64|amd64) ARCH=x64 ;; aarch64|arm64) ARCH=arm64 ;; esac
  case "$OS_KIND" in
    Darwin)
      OS_FAMILY=darwin
      OS_NAME="macOS $(sw_vers -productVersion 2>/dev/null || echo '?') ($([ "$ARCH" = arm64 ] && echo 'Apple Silicon' || echo Intel))"
      # Homebrew đã cài nhưng shell chưa nạp shellenv
      if ! has brew; then
        for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do
          if [ -x "$b" ]; then eval "$("$b" shellenv)"; break; fi
        done
      fi
      if has brew; then PM=brew; fi
      ;;
    Linux)
      local id="" like="" pretty="" cands p
      if [ -r /etc/os-release ]; then
        id="$(. /etc/os-release; echo "${ID:-}")"
        like="$(. /etc/os-release; echo "${ID_LIKE:-}")"
        pretty="$(. /etc/os-release; echo "${PRETTY_NAME:-${NAME:-Linux} ${VERSION_ID:-}}")"
      fi
      case " $id $like " in
        *" debian "*|*" ubuntu "*|*" linuxmint "*|*" pop "*|*" raspbian "*) OS_FAMILY=debian ;;
        *" rhel "*|*" fedora "*|*" centos "*|*" rocky "*|*" almalinux "*|*" amzn "*) OS_FAMILY=rhel ;;
        *" arch "*|*" manjaro "*|*" endeavouros "*) OS_FAMILY=arch ;;
        *" suse "*|*" opensuse "*|*" sles "*|*" opensuse-"*) OS_FAMILY=suse ;;
        *" alpine "*) OS_FAMILY=alpine ;;
        *) OS_FAMILY=unknown ;;
      esac
      if grep -qi microsoft /proc/version 2>/dev/null || [ -n "${WSL_DISTRO_NAME:-}" ]; then WSL=1; fi
      if [ "$OS_FAMILY" = alpine ] || ls /lib/ld-musl-* >/dev/null 2>&1; then MUSL=1; fi
      OS_NAME="${pretty:-Linux} ($ARCH$([ "$WSL" = 1 ] && echo ', WSL' || true)$([ "$MUSL" = 1 ] && echo ', musl' || true))"
      case "$OS_FAMILY" in
        debian) cands="apt-get" ;; rhel) cands="dnf yum" ;; arch) cands="pacman" ;; suse) cands="zypper" ;; alpine) cands="apk" ;;
        *) cands="apt-get dnf yum pacman zypper apk" ;;
      esac
      for p in $cands; do
        if has "$p"; then PM="$p"; break; fi
      done
      ;;
    *) die "Hệ điều hành $OS_KIND chưa hỗ trợ. Trên Windows dùng install.ps1 hoặc chạy script này trong WSL." ;;
  esac
  if [ "$(id -u)" != 0 ] && has sudo; then SUDO="sudo"; fi
}

# cài gói hệ thống bằng trình quản lý gói đúng với hệ điều hành; trả 1 nếu không có
pkg_install() {
  local pkg="$1"
  case "$PM" in
    brew) run brew install "$pkg" ;;
    apt-get) run $SUDO apt-get update && run $SUDO apt-get install -y "$pkg" ;;
    dnf) run $SUDO dnf install -y "$pkg" ;;
    yum) run $SUDO yum install -y "$pkg" ;;
    pacman) run $SUDO pacman -S --noconfirm "$pkg" ;;
    zypper) run $SUDO zypper --non-interactive install "$pkg" ;;
    apk) run $SUDO apk add "$pkg" ;;
    *) return 1 ;;
  esac
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

find_project() {
  local d n
  d="$(cd "$1" 2>/dev/null && pwd)" || return 1
  while :; do
    for n in e2e.config.ts e2e.config.mts e2e.config.js e2e.config.mjs; do
      if [ -f "$d/$n" ]; then echo "$d"; return 0; fi
    done
    [ "$d" = / ] && return 1
    d="$(dirname "$d")"
  done
}

plugin_path() {
  claude plugin list --json </dev/null 2>/dev/null | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try { const p = JSON.parse(s).find((x) => x.id === process.argv[1]); if (p?.installPath) console.log(p.installPath); } catch {}
    });' "$PLUGIN_ID"
}

# cả phần chạy nằm trong main(): `curl … | bash` đọc script từ stdin, bash phải đọc hết trước khi chạy
# để lệnh con nào đọc stdin cũng không nuốt mất phần script còn lại
main() {
  PROJECT="$PWD"; OPEN=1; DRY_RUN=0; SKIP_PROJECT=0; YES=0; INIT=0; GATEWAY=""; APP_URL=""; APP_CMD=""; APP_CMD_SET=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --project) PROJECT="${2:?--project cần đường dẫn}"; shift 2 ;;
      --project=*) PROJECT="${1#*=}"; shift ;;
      --gateway) GATEWAY="${2:?--gateway cần giá trị}"; shift 2 ;;
      --gateway=*) GATEWAY="${1#*=}"; shift ;;
      --app-url) APP_URL="${2:?--app-url cần URL}"; shift 2 ;;
      --app-url=*) APP_URL="${1#*=}"; shift ;;
      --app-command) [ $# -ge 2 ] || { echo "--app-command cần lệnh" >&2; exit 2; }; APP_CMD="$2"; APP_CMD_SET=1; shift 2 ;;
      --app-command=*) APP_CMD="${1#*=}"; APP_CMD_SET=1; shift ;;
      --init) INIT=1; shift ;;
      -y|--yes) YES=1; shift ;;
      --no-open) OPEN=0; shift ;;
      --skip-project) SKIP_PROJECT=1; shift ;;
      --dry-run) DRY_RUN=1; shift ;;
      -h|--help) usage; exit 0 ;;
      *) echo "Tham số lạ: $1" >&2; usage >&2; exit 2 ;;
    esac
  done

  printf '%se2e-dashboard: cài môi trường%s%s\n' "$B" "$N" "$([ "$DRY_RUN" = 1 ] && echo ' (dry-run: không cài gì)')"
  printf '%sCác bước sẽ chạy theo thứ tự (bước nào đã có thì bỏ qua):%s\n' "$D" "$N"
  local i
  for ((i = 1; i <= TOTAL; i++)); do printf '  %d. %s\n' "$i" "${STEPS[$((i - 1))]}"; done

  # ── 1. hệ điều hành ──
  step 1
  detect_os
  ok "$OS_NAME"
  info "Trình quản lý gói: ${PM:-không có}$([ -n "$SUDO" ] && echo ' (qua sudo)')"
  if [ "$WSL" = 1 ]; then
    info "Đang trong WSL: cài vào Linux của WSL (cách e2e khuyên dùng trên Windows)."
    case "$PROJECT" in /mnt/*) warn "Project nằm trên ổ Windows ($PROJECT): npm install và test chạy chậm; nên để project trong ~ của WSL." ;; esac
  fi
  if [ "$MUSL" = 1 ]; then info "musl (Alpine): Node cài bằng apk, không dùng nvm."; fi
  finish have "$OS_NAME"

  # ── 2. git ──
  step 2
  if has git; then
    ok "$(git --version)"
    finish have "$(git --version | awk '{print $3}')"
  else
    if [ "$OS_FAMILY" = darwin ] && [ -z "$PM" ]; then
      doing "cài Command Line Tools của Xcode (có git)"
      run xcode-select --install || true
      die "Hoàn tất hộp thoại cài Command Line Tools rồi chạy lại script."
    fi
    doing "cài git bằng ${PM:-?}"
    pkg_install git || die "Không có trình quản lý gói cho $OS_NAME: cài git tay (https://git-scm.com/downloads) rồi chạy lại."
    finish "$([ "$DRY_RUN" = 1 ] && echo plan || echo done)" "qua $PM"
  fi

  # ── 3. Node.js ──
  step 3
  if node_ok; then
    ok "node $(node -v)"
    finish have "$(node -v)"
  elif [ "$MUSL" = 1 ]; then
    doing "cài Node bằng apk (nvm không hỗ trợ musl)"
    run $SUDO apk add nodejs npm
    if [ "$DRY_RUN" != 1 ] && ! node_ok; then die "Node của Alpine ($(node -v 2>/dev/null || echo 'không có')) chưa đạt 22.22.3: dùng Alpine mới hơn hoặc image node:22-alpine."; fi
    finish "$([ "$DRY_RUN" = 1 ] && echo plan || echo done)" "apk"
  else
    if has node; then warn "node $(node -v) quá cũ cho e2e (cần ≥ 22.22.3 hoặc ≥ 24.8)"; fi
    doing "cài Node $NODE_LINE qua nvm (không cần sudo, không đụng Node hệ thống)"
    if ! load_nvm; then
      has curl || die "Cần curl để tải nvm."
      printf '  %s$ curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/%s/install.sh | bash%s\n' "$D" "$NVM_VERSION" "$N"
      if [ "$DRY_RUN" != 1 ]; then
        curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/$NVM_VERSION/install.sh" | bash
        load_nvm || die "Cài nvm xong nhưng không nạp được \$NVM_DIR/nvm.sh."
      fi
    fi
    if [ "$DRY_RUN" = 1 ]; then
      printf '  %s$ nvm install %s && nvm alias default %s%s\n' "$D" "$NODE_LINE" "$NODE_LINE" "$N"
      finish plan "nvm install $NODE_LINE"
    else
      set +u
      nvm install "$NODE_LINE"
      nvm alias default "$NODE_LINE" >/dev/null
      nvm use "$NODE_LINE" >/dev/null
      set -u
      node_ok || die "Đã cài Node qua nvm nhưng phiên bản vẫn chưa đạt: $(node -v)"
      ok "node $(node -v) (nvm; terminal mới tự dùng bản này)"
      finish done "$(node -v) qua nvm"
    fi
  fi

  # ── 4. Claude Code CLI ──
  step 4
  if has claude; then
    ok "claude $(claude --version 2>/dev/null | head -n1)"
    finish have "$(claude --version 2>/dev/null | head -n1 | awk '{print $1}')"
  else
    doing "cài @anthropic-ai/claude-code bằng npm"
    run npm install -g @anthropic-ai/claude-code </dev/null \
      || die "npm install -g lỗi (thường do quyền ghi thư mục global): cài Node bằng nvm rồi chạy lại."
    if [ "$DRY_RUN" = 1 ]; then
      finish plan "npm -g"
    else
      hash -r
      has claude || die "Đã cài @anthropic-ai/claude-code nhưng không thấy lệnh claude trên PATH ($(npm prefix -g)/bin)."
      ok "claude $(claude --version 2>/dev/null | head -n1)"
      finish done "npm -g"
    fi
  fi

  # ── 5. Plugin ──
  step 5
  PLUGIN_DIR=""
  local plugin_state=done
  if [ -n "${E2E_DASHBOARD_PLUGIN_DIR:-}" ]; then
    # phát triển / test: dùng bản plugin ở thư mục này thay vì cài từ marketplace
    PLUGIN_DIR="$E2E_DASHBOARD_PLUGIN_DIR"
    info "Dùng plugin ở \$E2E_DASHBOARD_PLUGIN_DIR: $PLUGIN_DIR"
    plugin_state=have
  elif has claude; then PLUGIN_DIR="$(plugin_path)"; fi
  if [ -n "${E2E_DASHBOARD_PLUGIN_DIR:-}" ]; then
    :
  elif [ -n "$PLUGIN_DIR" ]; then
    doing "cập nhật plugin lên bản mới nhất"
    run claude plugin marketplace update e2e-dashboard </dev/null || true
    run claude plugin update "$PLUGIN_ID" </dev/null || true
    plugin_state=have
  else
    doing "thêm marketplace và cài plugin"
    run claude plugin marketplace add "$REPO" </dev/null
    run claude plugin install "$PLUGIN_ID" </dev/null
  fi
  if [ "$DRY_RUN" = 1 ] && [ -z "${E2E_DASHBOARD_PLUGIN_DIR:-}" ]; then
    finish plan "$PLUGIN_ID"
  else
    if [ -z "${E2E_DASHBOARD_PLUGIN_DIR:-}" ]; then PLUGIN_DIR="$(plugin_path)"; fi
    { [ -n "$PLUGIN_DIR" ] && [ -f "$PLUGIN_DIR/bin/dashboard.mjs" ]; } || die "Không tìm thấy plugin sau khi cài (claude plugin list --json)."
    ok "$PLUGIN_ID → $PLUGIN_DIR"
    finish "$plugin_state" "v$(node -p "require(process.argv[1]).version" "$PLUGIN_DIR/.claude-plugin/plugin.json" 2>/dev/null || echo '?')"
  fi
  DASH="${PLUGIN_DIR:-<plugin>}/bin/dashboard.mjs"
  # plugin bản cũ chưa có lệnh `config`: tạo config bằng `npx e2e init` trực tiếp, không sửa URL / lệnh
  local has_config_cmd=1
  if [ "$DRY_RUN" != 1 ] && ! grep -q 'configCli' "$DASH" 2>/dev/null; then has_config_cmd=0; fi

  # ── 6. e2e.config.ts ──
  step 6
  ROOT=""
  local args=()
  if [ -n "$GATEWAY" ]; then args+=(--gateway "$GATEWAY"); fi
  if [ -n "$APP_URL" ]; then args+=(--app-url "$APP_URL"); fi
  if [ "$APP_CMD_SET" = 1 ]; then args+=(--app-command "$APP_CMD"); fi
  if [ "$SKIP_PROJECT" = 1 ]; then
    info "Bỏ qua (--skip-project)"
    finish skip "--skip-project"
  elif ROOT="$(find_project "$PROJECT")"; then
    info "Đã có config ở $ROOT"
    if [ "$has_config_cmd" = 0 ]; then
      warn "Plugin bản này chưa có lệnh config: sửa URL app / lệnh khởi động tay trong e2e.config.ts."
      finish have "$ROOT"
    elif can_ask; then
      doing "xem và sửa URL app / lệnh khởi động (Enter để giữ nguyên)"
      if (cd "$ROOT" && run node "$DASH" config ${args[@]+"${args[@]}"} </dev/tty); then finish done "đã xem / sửa"; else warn "Có mục chưa sửa được (xem ở trên)."; finish manual "xem lưu ý ở trên"; fi
    else
      if (cd "$ROOT" && run node "$DASH" config --yes ${args[@]+"${args[@]}"} </dev/null); then
        finish "$([ ${#args[@]} -gt 0 ] && echo done || echo have)" "$([ ${#args[@]} -gt 0 ] && echo 'đã áp tham số' || echo 'giữ nguyên')"
      else
        warn "Có mục chưa sửa được (xem ở trên)."
        finish manual "xem lưu ý ở trên"
      fi
    fi
  else
    ROOT=""
    local create=0 a
    if [ "$INIT" = 1 ] || [ "$YES" = 1 ]; then
      create=1
    elif can_ask; then
      printf '  Chưa có e2e.config.ts ở %s. Tạo mới bằng `e2e init`? [Y/n] ' "$PROJECT"
      read -r a </dev/tty || a=n
      case "$a" in n|N|no|No|NO) create=0 ;; *) create=1 ;; esac
    fi
    if [ "$create" = 0 ]; then
      warn "Không thấy e2e.config.(ts|mts|js|mjs) từ $PROJECT trở lên. Chạy lại với --init để tạo, hoặc --project <thư mục>."
      finish manual "chưa có config"
    else
      doing "tạo e2e.config.ts bằng e2e init (web, skill + MCP cho Claude Code)"
      if [ "$has_config_cmd" = 1 ]; then
        if can_ask; then
          (cd "$PROJECT" && run node "$DASH" config --init ${args[@]+"${args[@]}"} </dev/tty) || die "Tạo e2e.config.ts lỗi (xem ở trên)."
        else
          (cd "$PROJECT" && run node "$DASH" config --init --yes ${args[@]+"${args[@]}"} </dev/null) || die "Tạo e2e.config.ts lỗi (xem ở trên)."
        fi
      else
        (cd "$PROJECT" && run npx --yes e2e init --yes --engine web --gateway "${GATEWAY:-vercel}" --skills .claude/skills --mcp .mcp.json --no-install </dev/null) || die "e2e init lỗi (xem ở trên)."
      fi
      if [ "$DRY_RUN" = 1 ]; then
        ROOT="$PROJECT"
        finish plan "e2e init"
      else
        ROOT="$(find_project "$PROJECT")" || die "e2e init chạy xong nhưng không thấy e2e.config.ts."
        finish done "e2e init"
      fi
    fi
  fi

  # ── 7. Quick Setup ──
  step 7
  if [ -z "$ROOT" ]; then
    info "Bỏ qua: chưa có project e2e"
    finish skip "chưa có project"
  else
    doing "kiểm tra và cài phần còn thiếu của project (từng bước in bên dưới)"
    # bước lỗi (vd. gh tuỳ chọn) không chặn việc mở dashboard: Cài đặt hệ thống › Quick Setup làm tiếp được
    if (cd "$ROOT" && run node "$DASH" setup --quick --yes </dev/null); then
      finish "$([ "$DRY_RUN" = 1 ] && echo plan || echo done)" ""
    else
      warn "Quick Setup còn mục lỗi hoặc cần làm tay (xem ở trên); mở dashboard → Cài đặt hệ thống › Quick Setup để làm tiếp."
      finish manual "xem log ở trên"
    fi
  fi

  # ── 8. Mở dashboard ──
  step 8
  if [ "$DRY_RUN" != 1 ] && ! claude auth status --text >/dev/null 2>&1; then
    warn "Claude Code chưa đăng nhập: gõ \`claude\` một lần để đăng nhập (tính năng AI của dashboard dùng phiên này)."
  fi
  if [ -z "$ROOT" ]; then
    info "Bỏ qua: chưa có project e2e"
    finish skip ""
  elif [ "$OPEN" = 1 ]; then
    doing "khởi động dashboard"
    if (cd "$ROOT" && run node "$DASH" </dev/null); then finish "$([ "$DRY_RUN" = 1 ] && echo plan || echo done)" ""; else finish fail "xem log ở trên"; fi
  else
    info "Mở sau: trong Claude Code gõ /e2e-dashboard (hoặc: cd \"$ROOT\" && node \"$DASH\")"
    finish skip "--no-open"
  fi

  summary
  printf '\n%s✓ Xong.%s Trong Claude Code đang mở, gõ /reload-plugins để nạp plugin.\n' "$G" "$N"
}

main "$@"
