# Opens calib_pattern.html fullscreen on ONE monitor (pixel-exact). ASCII only on purpose (Windows PowerShell 5 + no BOM).
# Usage: pwsh -File open_calib_pattern.ps1 -PatternDir <dir with faces.json + pattern_<face>.png> -Face center -X 0 -Y 0 -Width 5120 -Height 1440 [-Hz 60] [-Port 18791]
# Run it once per monitor (one face each). The user must say OK before you run it (it takes the whole monitor).
# Close: Alt+F4 on that window. Stop the server afterwards: Stop-Process -Id <PID printed below>.
param(
  [Parameter(Mandatory = $true)][string]$PatternDir,
  [Parameter(Mandatory = $true)][string]$Face,
  [Parameter(Mandatory = $true)][int]$X,
  [Parameter(Mandatory = $true)][int]$Y,
  [Parameter(Mandatory = $true)][int]$Width,
  [Parameter(Mandatory = $true)][int]$Height,
  [int]$Hz = 60,
  [int]$Port = 18791
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$stage = Join-Path $env:TEMP "calib_pattern_$Port"
New-Item -ItemType Directory -Force $stage | Out-Null
Copy-Item (Join-Path $here 'calib_pattern.html') $stage -Force
Copy-Item (Join-Path $PatternDir 'faces.json') $stage -Force
Copy-Item (Join-Path $PatternDir 'pattern_*.png') $stage -Force
$profile = Join-Path $env:TEMP "calib_profile_$Port"
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { throw 'chrome.exe not found' }
$srv = Start-Process -FilePath python -ArgumentList '-m', 'http.server', "$Port", '--bind', '127.0.0.1' -WorkingDirectory $stage -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 1
$url = "http://127.0.0.1:$Port/calib_pattern.html?face=$Face&hz=$Hz"
$args2 = @("--user-data-dir=$profile", "--window-position=$X,$Y", "--window-size=$Width,$Height", '--kiosk', '--force-device-scale-factor=1', '--no-first-run', '--no-default-browser-check', "--app=$url")
Start-Process -FilePath $chrome -ArgumentList $args2
Write-Host "opened: $url at $X,$Y ${Width}x${Height}"
Write-Host "server PID: $($srv.Id)  (Stop-Process -Id $($srv.Id) when done). Close the window with Alt+F4. H toggles the HUD, S saves the frame-number log."
