# e2e-dashboard: cài toàn bộ môi trường bằng một lệnh (Windows, PowerShell 5.1+).
#
#   irm https://raw.githubusercontent.com/thangvofastboy/e2e-dashboard/main/install.ps1 | iex
#   & ([scriptblock]::Create((irm …/install.ps1))) -Project C:\code\my-app -AppUrl http://localhost:5173 -AppCommand "npm run dev"
#
# Chạy không tham số: hỏi trước thư mục project, URL app, lệnh khởi động, model AI + API key, rồi cài một mạch.
# 9 bước, bước nào đã có thì bỏ qua (chạy lại bao nhiêu lần cũng được):
#   1 hệ điều hành → 2 git → 3 Node (≥ 22.22.3 / ≥ 24.8) → 4 Claude Code CLI → 5 plugin → 6 e2e.config.ts
#   → 7 AI cho e2e (model, gói npm, API key / đăng nhập) → 8 Quick Setup (e2e, node_modules, Chromium, reporter, .env)
#   → 9 mở dashboard.
# e2e khuyên chạy trong WSL trên Windows: khi đó dùng install.sh bên trong WSL.
param(
  [string]$Project = (Get-Location).Path,
  [switch]$Init,
  [string]$Ai,
  [string]$ApiKey,
  [string]$AiBaseUrl,
  [string]$AiModel,
  [switch]$AiLogin,
  [string]$Gateway,
  [string]$AppUrl,
  [string]$AppCommand,
  [switch]$Yes,
  [switch]$NoOpen,
  [switch]$SkipProject,
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'

$Repo = 'thangvofastboy/e2e-dashboard'
$PluginId = 'e2e-dashboard@e2e-dashboard'
$Steps = @('Phát hiện hệ điều hành', 'git', 'Node.js >= 22.22.3 (hoặc >= 24.8)', 'Claude Code CLI', 'Plugin e2e-dashboard', 'Cấu hình e2e.config.ts', 'AI cho e2e: model, gói npm, API key / đăng nhập', 'Quick Setup: e2e, thư viện, trình duyệt, reporter', 'Mở dashboard')
# model AI cho bước agent: giống AI_PROVIDERS của server/e2eai.mjs (test kiểm tra khớp)
$AiProviders = [ordered]@{
  'vercel' = @('key', 'AI_GATEWAY_API_KEY', 'Vercel AI Gateway (một key, nhiều model)')
  'anthropic' = @('key', 'ANTHROPIC_API_KEY', 'Anthropic Claude (API key, kể cả credit API của gói Max/Team)')
  'openrouter' = @('key', 'OPENROUTER_API_KEY', 'OpenRouter (API key)')
  'openai' = @('key', 'OPENAI_API_KEY', 'OpenAI (API key)')
  'chatgpt' = @('login', '', 'Gói ChatGPT Plus / Pro (đăng nhập)')
  'copilot' = @('login', '', 'GitHub Copilot (đăng nhập)')
  'opencode-console' = @('login', '', 'OpenCode Console (đăng nhập)')
  'grok' = @('login', '', 'SuperGrok / X Premium+ (đăng nhập)')
  'openai-compatible' = @('local', '', 'Model local / OpenAI-compatible (Ollama, LM Studio…)')
  'none' = @('none', '', 'Không dùng AI (chỉ test bằng locator)')
}
if ($Gateway -and -not $Ai) { $Ai = $Gateway }
if (-not $ApiKey -and $env:E2E_AI_API_KEY) { $ApiKey = $env:E2E_AI_API_KEY }
if ($Ai -and -not $AiProviders.Contains($Ai)) { throw "-Ai phải là một trong: $($AiProviders.Keys -join ', ')" }
$Result = @{}
$script:Cur = 0
$script:Started = Get-Date

function Step([int]$n) {
  $script:Cur = $n
  $script:Started = Get-Date
  Write-Host "`n[$n/$($Steps.Count)] $($Steps[$n - 1])" -ForegroundColor Cyan
}
# done (đã cài / đã làm) | have (đã có) | skip | manual (làm tay) | fail | plan (dry-run)
function Finish([string]$state, [string]$note = '') {
  $Result[$script:Cur] = @{ state = $state; note = $note; secs = [int]((Get-Date) - $script:Started).TotalSeconds }
}
function Doing($t) { Write-Host "  -> Đang $t" -ForegroundColor Yellow }
function Ok($t) { Write-Host "  OK $t" -ForegroundColor Green }
function Warn($t) { Write-Host "  !  $t" -ForegroundColor Yellow }
function Info($t) { Write-Host "  $t" -ForegroundColor DarkGray }
function Summary {
  Write-Host "`nTổng kết" -ForegroundColor White
  $marks = @{ done = @('OK đã cài  ', 'Green'); have = @('OK đã có   ', 'Green'); skip = @('-  bỏ qua   ', 'DarkGray'); manual = @('!  làm tay  ', 'Yellow'); fail = @('x  lỗi      ', 'Red'); plan = @('.  sẽ chạy  ', 'Cyan') }
  for ($i = 1; $i -le $Steps.Count; $i++) {
    $r = $Result[$i]
    $m = if ($r) { $marks[$r.state] } else { @('.  chưa chạy', 'DarkGray') }
    $note = if ($r -and $r.note) { " — $($r.note)" } else { '' }
    $secs = if ($r -and $r.secs -gt 0) { " ($($r.secs)s)" } else { '' }
    Write-Host "  $i. " -NoNewline
    Write-Host $m[0] -ForegroundColor $m[1] -NoNewline
    Write-Host " $($Steps[$i - 1])$note$secs"
  }
}
# throw thay vì exit: chạy qua `irm | iex` thì exit đóng luôn cửa sổ PowerShell của người dùng
function Die($t) {
  Write-Host "  x $t" -ForegroundColor Red
  if ($script:Cur -gt 0) { Finish 'fail' $t }
  Summary
  throw "e2e-dashboard: $t"
}
function Has($c) { [bool](Get-Command $c -ErrorAction SilentlyContinue) }
# chạy lệnh ngoài (hoặc chỉ in khi -DryRun); trả về mã thoát. Out-Host: output của lệnh không lẫn vào giá trị trả về
function Run([string]$exe, [string[]]$argv) {
  Write-Host "  `$ $exe $($argv -join ' ')" -ForegroundColor DarkGray
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
function Can-Ask { (-not $Yes) -and [Environment]::UserInteractive -and -not [Console]::IsInputRedirected }
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
function Plugin-Path {
  try { $list = (& claude plugin list --json) -join "`n" | ConvertFrom-Json } catch { return $null }
  ($list | Where-Object { $_.id -eq $PluginId } | Select-Object -First 1).installPath
}

Write-Host ("e2e-dashboard: cài môi trường" + $(if ($DryRun) { ' (dry-run: không cài gì)' } else { '' })) -ForegroundColor White

# chạy không tham số: hỏi hết thông tin trước, cài sau (Enter = giá trị trong [ ])
function Ask($q, $def = '') { $a = Read-Host $(if ($def) { "  $q [$def]" } else { "  $q" }); if ($a) { $a.Trim() } else { $def } }
function Ask-YN($q, $def = $true) { $a = Read-Host "  $q $(if ($def) { '(Y/n)' } else { '(y/N)' })"; if (-not $a) { $def } else { $a -match '^(y|yes|c|có|co)$' } }
if ($PSBoundParameters.Count -eq 0 -and (Can-Ask)) {
  Write-Host "`nTrả lời vài câu trước khi cài (Enter = giá trị trong [ ])" -ForegroundColor White
  $Project = Ask '1. Thư mục project e2e' $Project
  $guess = Find-Project $Project
  $curUrl = ''; $curCmd = ''; $curAi = ''
  if ($guess) {
    $cfg = Get-ChildItem $guess -File | Where-Object { $_.Name -match '^e2e\.config\.(ts|mts|js|mjs)$' } | Select-Object -First 1
    $src = Get-Content $cfg.FullName -Raw
    Write-Host "     Đã có $($cfg.FullName)" -ForegroundColor DarkGray
    if ($src -match "url\s*:[^'`"]*['`"]([^'`"]*)['`"]") { $curUrl = $Matches[1] }
    if ($src -match "(?m)^\s*command\s*:\s*\{\s*executable:\s*'([^']*)',\s*args:\s*\[([^\]]*)\]") { $curCmd = ("$($Matches[1]) " + ($Matches[2] -replace "[',]", '')).Trim() }
    $curAi = if ($src -notmatch 'agents\s*:') { 'none' } elseif ($src -match 'e2e/oauth/chatgpt') { 'chatgpt' } elseif ($src -match 'e2e/oauth/copilot') { 'copilot' } elseif ($src -match 'e2e/oauth/opencode-console') { 'opencode-console' } elseif ($src -match 'e2e/oauth/grok') { 'grok' } elseif ($src -match '@openrouter/ai-sdk-provider') { 'openrouter' } elseif ($src -match 'createOpenAICompatible') { 'openai-compatible' } elseif ($src -match 'import \{ anthropic \}') { 'anthropic' } elseif ($src -match 'import \{ openai \}') { 'openai' } elseif ($src -match 'import \{ gateway \}') { 'vercel' } else { '' }
  } elseif (Ask-YN "   Chưa có e2e.config.ts ở đó. Tạo mới bằng ``e2e init``?") { $Init = [switch]$true } else { $SkipProject = [switch]$true }
  if (-not $SkipProject) {
    $AppUrl = Ask '2. URL app đang test' $(if ($curUrl) { $curUrl } else { 'http://localhost:3000' })
    $a = Ask '3. Lệnh khởi động app để runner tự chạy (vd. npm run dev; - = không dùng)' $(if ($curCmd) { $curCmd } else { '-' })
    $AppCommand = if ($a -eq '-') { '' } else { $a }
    $appCommandSet = $true
    Write-Host '  4. Model AI cho bước agent của e2e:'
    $ids = @($AiProviders.Keys)
    $def = if ($curAi) { $curAi } else { 'vercel' }
    for ($i = 0; $i -lt $ids.Count; $i++) { Write-Host ("     {0,2}) {1,-18} {2}{3}" -f ($i + 1), $ids[$i], $AiProviders[$ids[$i]][2], $(if ($ids[$i] -eq $def) { '  ← hiện tại / mặc định' } else { '' })) }
    while ($true) {
      $a = Ask '   Chọn số' $def
      if ($a -match '^\d+$' -and [int]$a -ge 1 -and [int]$a -le $ids.Count) { $Ai = $ids[[int]$a - 1]; break }
      if ($AiProviders.Contains($a)) { $Ai = $a; break }
      Write-Host '     Chọn số trong danh sách.'
    }
    switch ($AiProviders[$Ai][0]) {
      'key' {
        Write-Host "     Cần $($AiProviders[$Ai][1]). Key lưu vào .env của project (quyền chỉ bạn đọc được, tự vào .gitignore)." -ForegroundColor DarkGray
        $sec = Read-Host "     Dán $($AiProviders[$Ai][1]) (Enter để bỏ qua)" -AsSecureString
        $ApiKey = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
      }
      'login' { if (Ask-YN "   Đăng nhập $($AiProviders[$Ai][2] -replace ' \(đăng nhập\)$', '') ngay trong lúc cài?") { $AiLogin = [switch]$true } }
      'local' { $AiBaseUrl = Ask '   URL server model' 'http://127.0.0.1:11434/v1'; $AiModel = Ask '   Model id' 'gpt-6-luna' }
    }
  }
  $NoOpen = [switch](-not (Ask-YN '5. Cài xong mở dashboard luôn?'))
  Write-Host "`nSẽ cài với:" -ForegroundColor White
  Write-Host "  Project:          $Project$(if ($Init) { ' (tạo e2e.config.ts mới)' })"
  if (-not $SkipProject) {
    Write-Host "  URL app:          $AppUrl"
    Write-Host "  Lệnh khởi động:   $(if ($AppCommand) { $AppCommand } else { 'không' })"
    Write-Host "  Model AI:         $($AiProviders[$Ai][2])$(if ($ApiKey) { ' · có API key' })$(if ($AiLogin) { ' · đăng nhập khi cài' })"
  }
  Write-Host "  Mở dashboard:     $(if ($NoOpen) { 'không' } else { 'có' })"
  if (-not (Ask-YN 'Bắt đầu cài?')) { Write-Host 'Đã huỷ.'; return }
  $Yes = [switch]$true # đã có đủ câu trả lời: các bước sau không hỏi lại
}
Write-Host 'Các bước sẽ chạy theo thứ tự (bước nào đã có thì bỏ qua):' -ForegroundColor DarkGray
for ($i = 1; $i -le $Steps.Count; $i++) { Write-Host "  $i. $($Steps[$i - 1])" }

# 1. hệ điều hành
Step 1
if ($PSVersionTable.PSEdition -eq 'Core' -and -not $IsWindows) {
  if (-not $DryRun) { Die 'Đây không phải Windows: dùng install.sh.' }
  Warn 'Đây không phải Windows (dry-run vẫn in các bước).'
}
$osv = [Environment]::OSVersion.Version
$osName = if ($osv.Build -ge 22000) { 'Windows 11' } else { 'Windows 10' }
$arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
$osLabel = "$osName ($arch, build $($osv.Build))"
Ok $osLabel
Info "Trình quản lý gói: $(if (Has winget) { 'winget' } else { 'không có (cài App Installer từ Microsoft Store để có winget)' })"
if (Has wsl) { Info 'Có WSL: e2e khuyên chạy trong WSL. Muốn vậy thì mở WSL và chạy install.sh trong đó.' }
Finish 'have' $osLabel

# 2. git
Step 2
if (Has git) { Ok (& git --version); Finish 'have' ((& git --version) -replace '^git version ', '') }
else {
  Doing 'cài git bằng winget'
  if (-not (Winget-Install 'Git.Git')) { Die 'Không tự cài được git: cài tay (https://git-scm.com/downloads) rồi chạy lại.' }
  Finish $(if ($DryRun) { 'plan' } else { 'done' }) 'winget Git.Git'
}

# 3. Node.js
Step 3
if (Node-Ok) { Ok "node $(& node -v)"; Finish 'have' (& node -v) }
else {
  if (-not (Has winget)) { Die 'Không có winget: cài Node 22.22.3+ tay (https://nodejs.org) rồi chạy lại.' }
  $id = 'OpenJS.NodeJS.LTS'
  if (Has node) {
    Warn "node $(& node -v) quá cũ cho e2e (cần >= 22.22.3 hoặc >= 24.8)"
    Doing 'nâng cấp Node LTS bằng winget'
    [void](Run 'winget' @('upgrade', '-e', '--id', $id, '--accept-source-agreements', '--accept-package-agreements')); Refresh-Path
  } else {
    Doing 'cài Node LTS bằng winget'
    if (-not (Winget-Install $id)) { Die 'winget không cài được Node: cài Node 22.22.3+ tay (https://nodejs.org) rồi chạy lại.' }
  }
  if ($DryRun) { Finish 'plan' "winget $id" }
  else {
    if (-not (Node-Ok)) { Die "Node vẫn chưa đạt sau khi cài ($(& node -v)): cài Node 22.22.3+ tay rồi chạy lại." }
    Ok "node $(& node -v)"; Finish 'done' "$(& node -v) qua winget"
  }
}

# 4. Claude Code CLI
Step 4
if (Has claude) { Ok "claude $(& claude --version)"; Finish 'have' ((& claude --version) -split ' ')[0] }
else {
  Doing 'cài @anthropic-ai/claude-code bằng npm'
  if ((Run 'npm.cmd' @('install', '-g', '@anthropic-ai/claude-code')) -ne 0) { Die 'npm install -g @anthropic-ai/claude-code lỗi: xem log ở trên.' }
  if ($DryRun) { Finish 'plan' 'npm -g' }
  else {
    Refresh-Path
    if (-not (Has claude)) { $env:Path += ';' + (& npm.cmd prefix -g) }
    if (-not (Has claude)) { Die 'Đã cài Claude Code nhưng không thấy lệnh claude trên PATH: mở terminal mới rồi chạy lại.' }
    Ok "claude $(& claude --version)"; Finish 'done' 'npm -g'
  }
}

# 5. Plugin
Step 5
$PluginDir = $null
$pluginState = 'done'
if ($env:E2E_DASHBOARD_PLUGIN_DIR) {
  # phát triển / test: dùng bản plugin ở thư mục này thay vì cài từ marketplace
  $PluginDir = $env:E2E_DASHBOARD_PLUGIN_DIR; $pluginState = 'have'
  Info "Dùng plugin ở `$env:E2E_DASHBOARD_PLUGIN_DIR: $PluginDir"
} else {
  if (Has claude) { $PluginDir = Plugin-Path }
  if ($PluginDir) {
    Doing 'cập nhật plugin lên bản mới nhất'
    [void](Run 'claude' @('plugin', 'marketplace', 'update', 'e2e-dashboard'))
    [void](Run 'claude' @('plugin', 'update', $PluginId))
    $pluginState = 'have'
  } else {
    Doing 'thêm marketplace và cài plugin'
    if ((Run 'claude' @('plugin', 'marketplace', 'add', $Repo)) -ne 0) { Die 'Không thêm được marketplace.' }
    if ((Run 'claude' @('plugin', 'install', $PluginId)) -ne 0) { Die 'Không cài được plugin.' }
  }
}
if ($DryRun -and -not $env:E2E_DASHBOARD_PLUGIN_DIR) { Finish 'plan' $PluginId }
else {
  if (-not $env:E2E_DASHBOARD_PLUGIN_DIR) { $PluginDir = Plugin-Path }
  if (-not $PluginDir -or -not (Test-Path (Join-Path $PluginDir 'bin/dashboard.mjs'))) { Die 'Không tìm thấy plugin sau khi cài (claude plugin list --json).' }
  Ok "$PluginId -> $PluginDir"
  $ver = try { (Get-Content (Join-Path $PluginDir '.claude-plugin/plugin.json') -Raw | ConvertFrom-Json).version } catch { '?' }
  Finish $pluginState "v$ver"
}
$Dash = Join-Path $(if ($PluginDir) { $PluginDir } else { '<plugin>' }) 'bin/dashboard.mjs'
# plugin bản cũ chưa có lệnh `config`: tạo config bằng `npx e2e init` trực tiếp
$hasConfigCmd = $DryRun -or ((Test-Path $Dash) -and (Select-String -Path $Dash -Pattern 'configCli' -Quiet))

# 6. e2e.config.ts
Step 6
$Root = $null
$cfgArgs = @()
if ($Ai) { $cfgArgs += @('--gateway', $Ai) }
if ($AppUrl) { $cfgArgs += @('--app-url', $AppUrl) }
if ($PSBoundParameters.ContainsKey('AppCommand') -or $appCommandSet) { $cfgArgs += @('--app-command', $AppCommand) }
if ($SkipProject) { Info 'Bỏ qua (-SkipProject)'; Finish 'skip' '-SkipProject' }
elseif ($Root = Find-Project $Project) {
  Info "Đã có config ở $Root"
  if (-not $hasConfigCmd) { Warn 'Plugin bản này chưa có lệnh config: sửa URL app / lệnh khởi động tay trong e2e.config.ts.'; Finish 'have' $Root }
  else {
    $interactive = Can-Ask
    if ($interactive) { Doing 'xem và sửa URL app / lệnh khởi động (Enter để giữ nguyên)' }
    Push-Location $Root
    try { $code = Run 'node' (@($Dash, 'config') + $(if ($interactive) { @() } else { @('--yes') }) + $cfgArgs) } finally { Pop-Location }
    if ($code -ne 0) { Warn 'Có mục chưa sửa được (xem ở trên).'; Finish 'manual' 'xem lưu ý ở trên' }
    else { Finish $(if ($interactive -or $cfgArgs.Count) { 'done' } else { 'have' }) $(if ($cfgArgs.Count) { 'đã áp tham số' } else { '' }) }
  }
} else {
  $Root = $null
  $create = $Init -or $Yes
  if (-not $create -and (Can-Ask)) { $create = (Read-Host "  Chưa có e2e.config.ts ở $Project. Tạo mới bằng ``e2e init``? [Y/n]") -notmatch '^(n|no)$' }
  if (-not $create) {
    Warn "Không thấy e2e.config.(ts|mts|js|mjs) từ $Project trở lên. Chạy lại với -Init để tạo, hoặc -Project <thư mục>."
    Finish 'manual' 'chưa có config'
  } else {
    Doing 'tạo e2e.config.ts bằng e2e init (web, skill + MCP cho Claude Code)'
    Push-Location $Project
    try {
      if ($hasConfigCmd) { $code = Run 'node' (@($Dash, 'config', '--init') + $(if (Can-Ask) { @() } else { @('--yes') }) + $cfgArgs) }
      else { $code = Run 'npx.cmd' @('--yes', 'e2e', 'init', '--yes', '--engine', 'web', '--gateway', $(if ($Ai) { $Ai } else { 'vercel' }), '--skills', '.claude/skills', '--mcp', '.mcp.json', '--no-install') }
    } finally { Pop-Location }
    if ($code -ne 0) { Die 'Tạo e2e.config.ts lỗi (xem ở trên).' }
    if ($DryRun) { $Root = $Project; Finish 'plan' 'e2e init' }
    else {
      $Root = Find-Project $Project
      if (-not $Root) { Die 'e2e init chạy xong nhưng không thấy e2e.config.ts.' }
      Finish 'done' 'e2e init'
    }
  }
}

# 7. AI cho e2e: model, gói npm của provider, API key (qua biến môi trường, không lên dòng lệnh) / đăng nhập
Step 7
if (-not $Root) { Info 'Bỏ qua: chưa có project e2e'; Finish 'skip' 'chưa có project' }
elseif (-not $DryRun -and -not (Select-String -Path $Dash -Pattern 'aiCli' -Quiet)) { Warn 'Plugin bản này chưa có lệnh ai: chọn model theo https://e2e.tester.army/docs/models'; Finish 'manual' 'plugin cũ' }
else {
  $aiArgs = @($Dash, 'ai')
  if (-not (Can-Ask)) { $aiArgs += '--yes' }
  if ($Ai) { $aiArgs += @('--provider', $Ai) }
  if ($AiBaseUrl) { $aiArgs += @('--base-url', $AiBaseUrl) }
  if ($AiModel) { $aiArgs += @('--model', $AiModel) }
  if ($AiLogin) { $aiArgs += '--login' }
  Doing "cấu hình model AI$(if ($Ai) { " ($Ai)" }), cài gói npm của provider$(if ($ApiKey) { ', lưu API key vào .env' })$(if ($AiLogin) { ', đăng nhập' })"
  $env:E2E_AI_API_KEY = $ApiKey
  Push-Location $Root
  try { $code = Run 'node' $aiArgs } finally { Pop-Location; Remove-Item Env:E2E_AI_API_KEY -ErrorAction SilentlyContinue }
  if ($code -ne 0) { Warn "AI chưa sẵn sàng (xem 'Còn phải làm' ở trên): làm tiếp ở dashboard → Cài đặt hệ thống › Project."; Finish 'manual' "xem 'Còn phải làm' ở trên" }
  else { Finish $(if ($DryRun) { 'plan' } else { 'done' }) $(if ($Ai) { $Ai } else { 'giữ model hiện tại' }) }
}

# 8. Quick Setup
Step 8
if (-not $Root) { Info 'Bỏ qua: chưa có project e2e'; Finish 'skip' 'chưa có project' }
else {
  Doing 'kiểm tra và cài phần còn thiếu của project (từng bước in bên dưới)'
  Push-Location $Root
  try {
    # bước lỗi (vd. gh tuỳ chọn) không chặn việc mở dashboard: Cài đặt hệ thống › Quick Setup làm tiếp được
    if ((Run 'node' @($Dash, 'setup', '--quick', '--yes')) -ne 0) {
      Warn 'Quick Setup còn mục lỗi hoặc cần làm tay (xem ở trên); mở dashboard → Cài đặt hệ thống › Quick Setup để làm tiếp.'
      Finish 'manual' 'xem log ở trên'
    } else { Finish $(if ($DryRun) { 'plan' } else { 'done' }) }
  } finally { Pop-Location }
}

# 9. Mở dashboard
Step 9
if (-not $DryRun) {
  & claude auth status --text *> $null
  if ($LASTEXITCODE -ne 0) { Warn 'Claude Code chưa đăng nhập: gõ `claude` một lần để đăng nhập (tính năng AI của dashboard dùng phiên này).' }
}
if (-not $Root) { Info 'Bỏ qua: chưa có project e2e'; Finish 'skip' }
elseif (-not $NoOpen) {
  Doing 'khởi động dashboard'
  Push-Location $Root
  try { $code = Run 'node' @($Dash) } finally { Pop-Location }
  Finish $(if ($code -ne 0) { 'fail' } elseif ($DryRun) { 'plan' } else { 'done' })
} else {
  Info "Mở sau: trong Claude Code gõ /e2e-dashboard (hoặc: cd `"$Root`"; node `"$Dash`")"
  Finish 'skip' 'không mở'
}

Summary
Write-Host "`nOK Xong. Trong Claude Code đang mở, gõ /reload-plugins để nạp plugin." -ForegroundColor Green
