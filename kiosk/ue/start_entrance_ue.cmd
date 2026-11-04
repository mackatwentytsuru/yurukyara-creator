@echo off
rem Entrance LED level (portrait window) for the HDMI LED. No sound. Edit the 4 values below if needed.
set ENGINE=C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\Win64\UnrealEditor.exe
set ROOT=work\entrance_ue
set RESX=1180
set RESY=1500
set WINX=0
set WINY=0
set UE_PYTHONPATH=%ROOT%\kiosk_ue\py
if "%ENTRANCE_LOG%"=="" set ENTRANCE_LOG=%ROOT%\rt.jsonl
start "" "%ENGINE%" "%ROOT%\HackShow\HackShow.uproject" /Game/_Work_tmp/Entrance/L_Entrance_Interview -game -windowed -ResX=%RESX% -ResY=%RESY% -WinX=%WINX% -WinY=%WINY% -ForceRes -EntranceKiosk -EnablePython -NoSound -nosplash -notraceserver -trace=none -ddc=InstalledNoZenLocalFallback -LocalDataCachePath=work/ue_ddc -abslog=%ROOT%\ue_game.log
