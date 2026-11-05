# 入口の LED のレベルを、縦長の窓で起動する(HDMI の LED に出す前提。窓を LED の画面へ置く)。
#   pwsh -File kiosk/ue/run_entrance.ps1(PowerShell 7。5 の powershell は UTF-8 の注釈を読めない) [-Project <HackShow.uproject>] [-ResX 1180] [-ResY 1500] [-WinX 0] [-WinY 0] [-Log <記録>]
# UE の Python の起動の台本(kiosk/ue/py/init_unreal.py)を UE_PYTHONPATH で渡し、-EntranceKiosk のときだけ受け口が動く。
# 音は出さない(-NoSound)。プロジェクトの設定は変えない。起動した UE の PID を 1 行で返す(止めるときはこの PID だけ)。
param(
  [string]$Project = 'work\ue_show\HackShow\HackShow.uproject',
  [string]$Engine = 'C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\Win64\UnrealEditor.exe',
  [int]$ResX = 1180, [int]$ResY = 1500, [int]$WinX = 0, [int]$WinY = 0,
  [string]$Log = '', [string]$Ddc = ''
)
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$cfg = Get-Content (Join-Path $here 'entrance_config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$env:UE_PYTHONPATH = Join-Path $here 'py'
if ($Log) { $env:ENTRANCE_LOG = $Log }
$level = if ($cfg.variant -eq 'autosetup') { $cfg.autosetup.level } else { $cfg.level }  # 設定の variant で Auto Setup 版 / GLB 版(予備)
$a = @("`"$Project`"", $level, '-game', '-windowed', "-ResX=$ResX", "-ResY=$ResY", "-WinX=$WinX", "-WinY=$WinY", '-ForceRes',
       '-EntranceKiosk', '-EnablePython', '-NoSound', '-nosplash', '-log')
if ($Ddc) { $a += '-ddc=InstalledNoZenLocalFallback'; $a += "-LocalDataCachePath=$Ddc" }
$p = Start-Process -FilePath $Engine -ArgumentList $a -PassThru
$p.Id
