# Opens one PNG fullscreen (kiosk) on ONE monitor, pixel-exact. ASCII only on purpose (Windows PowerShell 5 + no BOM).
# Usage: pwsh -File open_image_fullscreen.ps1 -Image <png> -X 0 -Y 0 -Width 5120 -Height 1440 [-Port 18792]
# The user must say OK before you run it (it takes the whole monitor). Close: Alt+F4 on that window, then Stop-Process -Id <PID printed below>.
param(
  [Parameter(Mandatory = $true)][string]$Image,
  [Parameter(Mandatory = $true)][int]$X,
  [Parameter(Mandatory = $true)][int]$Y,
  [Parameter(Mandatory = $true)][int]$Width,
  [Parameter(Mandatory = $true)][int]$Height,
  [int]$Port = 18792
)
$ErrorActionPreference = 'Stop'
$stage = Join-Path $env:TEMP "img_fullscreen_$Port"
New-Item -ItemType Directory -Force $stage | Out-Null
Copy-Item $Image (Join-Path $stage 'chart.png') -Force
$html = '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#000;overflow:hidden}img{display:block;width:100vw;height:100vh;image-rendering:pixelated}</style><img src="chart.png">'
Set-Content -Path (Join-Path $stage 'index.html') -Value $html -Encoding ASCII
$profile = Join-Path $env:TEMP "img_profile_$Port"
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { throw 'chrome.exe not found' }
$srv = Start-Process -FilePath python -ArgumentList '-m', 'http.server', "$Port", '--bind', '127.0.0.1' -WorkingDirectory $stage -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 1
$args2 = @("--user-data-dir=$profile", "--window-position=$X,$Y", "--window-size=$Width,$Height", '--kiosk', '--force-device-scale-factor=1', '--no-first-run', '--no-default-browser-check', "--app=http://127.0.0.1:$Port/index.html")
Start-Process -FilePath $chrome -ArgumentList $args2
Write-Host "opened at $X,$Y ${Width}x${Height}; server PID $($srv.Id)"
