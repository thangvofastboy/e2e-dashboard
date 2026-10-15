# e2e-dashboard: cài toàn bộ môi trường bằng một lệnh (Windows, PowerShell 5.1+).
#
#   irm https://raw.githubusercontent.com/thangvofastboy/e2e-dashboard/main/install.ps1 | iex
#   & ([scriptblock]::Create((irm …/install.ps1))) -Project C:\code\my-app -NoOpen
#
# Lần lượt: git → Node LTS (winget) → Claude Code CLI → plugin e2e-dashboard → (trong project có e2e.config.*)
# Quick Setup: e2e + @e2e-dev/web, node_modules, Chromium, reporter, .env → mở dashboard.
# Phần đã có thì bỏ qua, nên chạy lại bao nhiêu lần cũng được. macOS / Linux: dùng install.sh.
param(
  [string]$Project = (Get-Location).Path,
  [switch]$NoOpen,
  [switch]$SkipProject,
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'

$Repo = 'thangvofastboy/e2e-dashboard'
$PluginId = 'e2e-dashboard@e2e-dashboard'

function Step($t) { Write-Host "`n> $t" -ForegroundColor Cyan }
function Ok($t) { Write-Host "  OK $t" -ForegroundColor Green }
function Warn($t) { Write-Host "  !  $t" -ForegroundColor Yellow }
# throw thay vì exit: chạy qua `irm | iex` thì exit đóng luôn cửa sổ PowerShell của người dùng
function Die($t) { throw "e2e-dashboard: $t" }
function Has($c) { [bool](Get-Command $c -ErrorAction SilentlyContinue) }
# chạy lệnh ngoài (hoặc chỉ in khi -DryRun); trả về mã thoát. Out-Host: output của lệnh không lẫn vào giá trị trả về
function Run([string]$exe, [string[]]$argv) {
  Write-Host "  `$ $exe $($argv -join ' ')"
  if ($DryRun) { return 0 }
  & $exe @argv | Out-Host
  return $LASTEXITCODE
}
# winget cài xong không cập nhật PATH của phiên đang chạy: đọc lại từ registry
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Winget-Install($id) {
  if (-not (Has winget)) { return $false }
  $code = Run 'winget' @('install', '-e', '--id', $id, '--accept-source-agreements', '--accept-package-agreements')
  Refresh-Path
  return ($code -eq 0)
}
# e2e bản mới cần Node >= 22.22.3 (hoặc >= 24.8); dashboard cần >= 22
function Node-Ok {
  if (-not (Has node)) { return $false }
  try { $v = [version](& node -p 'process.versions.node') } catch { return $false }
  return ($v.Major -ge 25) -or ($v.Major -eq 24 -and $v.Minor -ge 8) -or ($v.Major -eq 22 -and $v -ge [version]'22.22.3')
}

Write-Host ("e2e-dashboard: cài môi trường" + $(if ($DryRun) { ' (dry-run: không cài gì)' } else { '' })) -ForegroundColor White

# 1. git
Step 'git'
if (Has git) { Ok (& git --version) }
elseif (-not (Winget-Install 'Git.Git')) { Die 'Không tự cài được git: cài tay (https://git-scm.com/downloads) rồi chạy lại.' }

# 2. Node.js
Step 'Node.js (>= 22.22.3 hoặc >= 24.8)'
if (Node-Ok) { Ok "node $(& node -v)" }
else {
  if (Has node) { Warn "node $(& node -v) quá cũ cho e2e: cài Node LTS bằng winget" }
  if (-not (Has winget)) { Die 'Không có winget: cài Node 22.22.3+ tay (https://nodejs.org) rồi chạy lại.' }
  $id = 'OpenJS.NodeJS.LTS'
  if (Has node) { [void](Run 'winget' @('upgrade', '-e', '--id', $id, '--accept-source-agreements', '--accept-package-agreements')); Refresh-Path }
  elseif (-not (Winget-Install $id)) { Die 'winget không cài được Node: cài Node 22.22.3+ tay (https://nodejs.org) rồi chạy lại.' }
  if (-not $DryRun) {
    if (-not (Node-Ok)) { Die "Node vẫn chưa đạt sau khi cài ($(& node -v)): cài Node 22.22.3+ tay rồi chạy lại." }
    Ok "node $(& node -v)"
  }
}

# 3. Claude Code CLI
Step 'Claude Code CLI'
if (Has claude) { Ok "claude $(& claude --version)" }
else {
  if ((Run 'npm.cmd' @('install', '-g', '@anthropic-ai/claude-code')) -ne 0) { Die 'npm install -g @anthropic-ai/claude-code lỗi: xem log ở trên.' }
  if (-not $DryRun) {
    Refresh-Path
    if (-not (Has claude)) { $env:Path += ';' + (& npm.cmd prefix -g) }
    if (-not (Has claude)) { Die 'Đã cài Claude Code nhưng không thấy lệnh claude trên PATH: mở terminal mới rồi chạy lại.' }
    Ok "claude $(& claude --version)"
  }
}

# 4. Plugin e2e-dashboard
Step 'Plugin e2e-dashboard'
function Plugin-Path {
  try { $list = (& claude plugin list --json) -join "`n" | ConvertFrom-Json } catch { return $null }
  ($list | Where-Object { $_.id -eq $PluginId } | Select-Object -First 1).installPath
}
$PluginDir = $(if (Has claude) { Plugin-Path } else { $null })
if ($PluginDir) {
  # đã cài: lấy bản mới nhất (marketplace ghim theo tag phát hành)
  [void](Run 'claude' @('plugin', 'marketplace', 'update', 'e2e-dashboard'))
  [void](Run 'claude' @('plugin', 'update', $PluginId))
} else {
  if ((Run 'claude' @('plugin', 'marketplace', 'add', $Repo)) -ne 0) { Die 'Không thêm được marketplace.' }
  if ((Run 'claude' @('plugin', 'install', $PluginId)) -ne 0) { Die 'Không cài được plugin.' }
}
if (-not $DryRun) {
  $PluginDir = Plugin-Path
  if (-not $PluginDir -or -not (Test-Path (Join-Path $PluginDir 'bin/dashboard.mjs'))) { Die 'Không tìm thấy plugin sau khi cài (claude plugin list --json).' }
  Ok "$PluginId -> $PluginDir"
}
$Dash = Join-Path $(if ($PluginDir) { $PluginDir } else { '<plugin>' }) 'bin/dashboard.mjs'

# 5. Project: e2e, thư viện, trình duyệt, reporter, .env
function Find-Project($start) {
  $d = (Resolve-Path $start -ErrorAction SilentlyContinue).Path
  while ($d) {
    foreach ($n in 'e2e.config.ts', 'e2e.config.mts', 'e2e.config.js', 'e2e.config.mjs') { if (Test-Path (Join-Path $d $n)) { return $d } }
    $p = Split-Path $d -Parent
    if (-not $p -or $p -eq $d) { return $null }
    $d = $p
  }
  return $null
}
$Root = $null
if ($SkipProject) { Step 'Project: bỏ qua (-SkipProject)' }
elseif ($Root = Find-Project $Project) {
  Step "Project ${Root}: Quick Setup"
  Push-Location $Root
  try {
    # bước lỗi (vd. gh tuỳ chọn) không chặn việc mở dashboard: Cài đặt hệ thống › Quick Setup làm tiếp được
    if ((Run 'node' @($Dash, 'setup', '--quick', '--yes')) -ne 0) { Warn 'Quick Setup còn mục lỗi hoặc cần làm tay (xem ở trên); mở dashboard → Cài đặt hệ thống › Quick Setup để làm tiếp.' }
  } finally { Pop-Location }
} else {
  Step 'Project'
  Warn "Không thấy e2e.config.(ts|mts|js|mjs) từ $Project trở lên: chưa cài phần của project."
  Warn 'Tạo project e2e trước (vd. nhờ Claude Code dựng e2e.config.ts), rồi chạy lại với -Project <thư mục>.'
}

# 6. Đăng nhập Claude + mở dashboard
Step 'Hoàn tất'
if (-not $DryRun) {
  & claude auth status --text *> $null
  if ($LASTEXITCODE -ne 0) { Warn 'Claude Code chưa đăng nhập: gõ `claude` một lần để đăng nhập (tính năng AI của dashboard dùng phiên này).' }
}
if ($Root -and -not $NoOpen) {
  Push-Location $Root
  try { [void](Run 'node' @($Dash)) } finally { Pop-Location }
} elseif ($Root) {
  Ok "Mở dashboard: trong Claude Code gõ /e2e-dashboard (hoặc: cd `"$Root`"; node `"$Dash`")"
}
Ok 'Xong. Trong Claude Code đang mở, gõ /reload-plugins để nạp plugin.'
