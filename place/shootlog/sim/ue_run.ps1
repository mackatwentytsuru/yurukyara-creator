# サブ機で UE を 1 回動かす台本。build = シーケンスを組む(-nullrhi)、render = 1 パスを MRQ で撮る。
# 使い方: ue_run.ps1 -Mode build -Config <json> / ue_run.ps1 -Mode render -Pass Comp_PlateWith -Level L_Comp -Cfg Cfg_Comp
param([string]$Mode, [string]$Config = "", [string]$Pass = "", [string]$Level = "L_Comp", [string]$Cfg = "Cfg_Comp", [int]$TimeoutSec = 1800, [string]$Tag = "run")
$ErrorActionPreference = "Stop"
$root = "work\hackshow_sim"
$ue = "C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\Win64\UnrealEditor-Cmd.exe"
$proj = "$root\proj\HackShow\HackShow.uproject"
$log = "$root\logs\ue_$Tag.log"
$common = @("-ddc=InstalledNoZenLocalFallback", "-LocalDataCachePath=work/ue_ddc", "-notraceserver", "-trace=none", "-abslog=$log")
if ($Mode -eq "build") {
    $env:COMP_CONFIG = $Config
    $env:SIM_ROOT = "work/hackshow_sim"
    Remove-Item "$root\logs\build_comp_report.txt" -ErrorAction SilentlyContinue
    $ueArgs = @($proj, "-run=pythonscript", "-script=work/hackshow_sim/repo/ue_comp_sim.py", "-unattended", "-nosplash", "-nullrhi") + $common
} else {
    $ueArgs = @($proj, "/Game/Show/$Level", "-game", "-LevelSequence=/Game/Show/Seq/$Pass.$Pass", "-MoviePipelineConfig=/Game/Show/RenderConfig/$Cfg.$Cfg",
              "-RenderOffScreen", "-windowed", "-resx=640", "-resy=360", "-log", "-Unattended", "-nosound") + $common
}
$t0 = Get-Date
$p = Start-Process -FilePath $ue -ArgumentList $ueArgs -PassThru -NoNewWindow
$null = $p.Handle
"$($p.Id)" | Out-File "$root\logs\pid_$Tag.txt"
if (-not $p.WaitForExit($TimeoutSec * 1000)) { Stop-Process -Id $p.Id -Force; "TIMEOUT" ; exit 3 }
$sec = [int]((Get-Date) - $t0).TotalSeconds
"EXIT $($p.ExitCode) SEC $sec"
if ($Mode -eq "build") {
    $rep = "$root\logs\build_comp_report.txt"
    if (Select-String -Path $rep -Pattern "BUILD_OK" -Quiet -ErrorAction SilentlyContinue) { "BUILD_OK" } else { "BUILD_FAILED"; Get-Content $rep -ErrorAction SilentlyContinue | Select-Object -First 40 }
}
