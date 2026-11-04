# サブ機で、ログイン中の人の画面のセッション(Interactive)で ue_run.ps1 の render を 1 回だけ動かす。
# SSH のセッションでは GPU が使えない(DXGI_ERROR_NOT_CURRENTLY_AVAILABLE)ため。タスクは終わったら消す。画面の撮影はしない。
# Resolume が動いていたら始めない。動いている間に Resolume が起動したら、自分の UE だけを止めて終わる(会場の営業が先)。
param([string]$Pass, [string]$Level = "L_Comp", [string]$Cfg = "Cfg_Comp", [string]$Tag = "run", [int]$TimeoutSec = 2400)
$ErrorActionPreference = "Stop"
$root = "work\hackshow_sim"
$result = "$root\logs\result_$Tag.txt"
Remove-Item $result, "$root\logs\pid_$Tag.txt" -ErrorAction SilentlyContinue
if (Get-Process -Name "Resolume*" -ErrorAction SilentlyContinue) { "RESOLUME_RUNNING"; exit 4 }
$name = "hackshow_sim_$Tag"
$inner = "-NoProfile -ExecutionPolicy Bypass -Command `"& '$root\scripts\ue_run.ps1' -Mode render -Pass $Pass -Level $Level -Cfg $Cfg -Tag $Tag -TimeoutSec $TimeoutSec *> '$result'`""
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $inner
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Seconds ($TimeoutSec + 120))
Register-ScheduledTask -TaskName $name -Action $action -Principal $principal -Settings $settings -Force | Out-Null
$t0 = Get-Date
Start-ScheduledTask -TaskName $name
$state = "start"
try {
    while ($true) {
        Start-Sleep -Seconds 5
        if (Get-Process -Name "Resolume*" -ErrorAction SilentlyContinue) {
            $pidFile = "$root\logs\pid_$Tag.txt"
            if (Test-Path $pidFile) { $id = [int](Get-Content $pidFile); Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
            "RESOLUME_STARTED_STOPPED_MINE"; $state = "resolume"; break
        }
        $info = Get-ScheduledTask -TaskName $name
        if ($info.State -ne "Running" -and ((Get-Date) - $t0).TotalSeconds -gt 10) { break }
        if (((Get-Date) - $t0).TotalSeconds -gt $TimeoutSec + 60) { $state = "timeout"; break }
    }
} finally {
    Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
}
if (Test-Path $result) { Get-Content $result | Select-Object -Last 6 }
"TASK_STATE $state SEC $([int]((Get-Date) - $t0).TotalSeconds)"
if ($state -eq "resolume") { exit 5 }
