# LED simulator launcher: opens led_sim.html fullscreen on the 5120x1440 monitor at (0,0).
# Uses a dedicated Chrome profile; does not touch the Chrome windows/tabs that are already open.
$ErrorActionPreference = 'Stop'
$dir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 18790
$url  = "http://localhost:$port/led_sim.html?pitch_mm=0.234"
$profile = Join-Path $env:TEMP 'led_sim_profile'

$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { throw 'chrome.exe not found' }

$srv = Start-Process -FilePath python -ArgumentList '-m','http.server',"$port" `
  -WorkingDirectory $dir -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 1

$chromeArgs = @(
  "--user-data-dir=$profile", '--window-position=0,0', '--window-size=5120,1440',
  '--kiosk', '--no-first-run', '--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required', "--app=$url"
)
Start-Process -FilePath $chrome -ArgumentList $chromeArgs

Write-Host "開いた: $url"
Write-Host '閉じ方: Alt+F4 か Ctrl+W で窓を閉じる(Esc はページを黒に戻すだけで、窓は閉じない)'
Write-Host "サーバーの止め方: Stop-Process -Id $($srv.Id)   (python http.server の PID)"
