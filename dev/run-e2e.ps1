# dev/run-e2e.ps1 · headless Edge + CDP 端到端验收的一键脚本（开发期工具）
# 用法：pwsh -File dev/run-e2e.ps1
# 可选环境变量：$env:WQ_EDGE（浏览器 exe 的完整路径）、$env:WQ_NODE（node.exe 的完整路径）
#              不设置时脚本自己探测常见安装位置与 PATH，因此本文件不含任何机器专属路径。
# 说明：受限环境里 Node 不能 spawn 被管道的子进程（EPERM），所以浏览器由 PowerShell 启动，
#       Node 只做 CDP 驱动（dev/e2e.mjs）。profile 建在系统临时目录，跑完即删。

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$app  = Join-Path $root 'app'
# 浏览器：$env:WQ_EDGE → 常见安装位置（Edge / Chrome，64 位与 32 位、用户级）→ 报错退出
$edge = $env:WQ_EDGE
if (-not ($edge -and (Test-Path -LiteralPath $edge))) {
  $pf    = $env:ProgramFiles
  $pf86  = ${env:ProgramFiles(x86)}
  $local = $env:LOCALAPPDATA
  $candidates = @()
  foreach ($base in @($pf, $pf86, $local)) {
    if ($base) { $candidates += (Join-Path $base 'Microsoft\Edge\Application\msedge.exe') }
  }
  foreach ($base in @($pf, $pf86)) {
    if ($base) { $candidates += (Join-Path $base 'Google\Chrome\Application\chrome.exe') }
  }
  $edge = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $edge) {
  throw '未找到 Edge/Chrome 可执行文件。请先设置 $env:WQ_EDGE = "<浏览器 exe 的完整路径>"。'
}

$port = 9333
$profile = Join-Path $env:TEMP 'wq-edge-profile-e2e'

# Node：$env:WQ_NODE → PATH 上的 node → 报错退出
$node = $env:WQ_NODE
if (-not ($node -and (Test-Path -LiteralPath $node))) {
  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  $node = if ($nodeCmd) { $nodeCmd.Source } else { $null }
}
if (-not $node) {
  throw '未找到 node。请先设置 $env:WQ_NODE = "<node.exe 的完整路径>"。'
}

if (Test-Path $profile) { Remove-Item $profile -Recurse -Force -ErrorAction SilentlyContinue }

$args = @(
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--no-default-browser-check', '--allow-file-access-from-files',
  "--remote-debugging-port=$port", "--user-data-dir=$profile",
  '--window-size=390,844', 'about:blank'
)
$proc = Start-Process -FilePath $edge -ArgumentList $args -PassThru -WindowStyle Hidden
Write-Host "Edge 已启动 (PID $($proc.Id))，调试端口 $port"

# 等调试端口可用
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
  try { $null = Invoke-RestMethod "http://127.0.0.1:$port/json/version" -TimeoutSec 2; $ready = $true; break } catch { Start-Sleep -Milliseconds 400 }
}
if (-not $ready) { Write-Error '调试端口未就绪'; Stop-Process -Id $proc.Id -Force; exit 1 }

Push-Location $root
try {
  & $node 'dev/e2e.mjs' $port
  $code = $LASTEXITCODE
} finally {
  Pop-Location
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  Get-Process msedge -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $edge } | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 500
  Remove-Item $profile -Recurse -Force -ErrorAction SilentlyContinue
}
exit $code
