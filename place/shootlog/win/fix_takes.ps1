# Turn received takes into the shoot format (frames.jsonl, video.mp4, audio.wav, meta.json) for the compositing tools.
# Usage: powershell -ExecutionPolicy Bypass -File fix_takes.ps1 [-Rec work\gaze\rec]
param([string]$Rec = "work\gaze\rec")
$py = "work\gaze\venv\Scripts\python.exe"
if (-not (Test-Path $py)) { $py = "python" }
$ff = & $py -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())" 2>$null
if (-not $ff) { $ff = "ffmpeg" }
$found = 0
foreach ($t in (Get-ChildItem $Rec -Directory -Filter "take_*" -ErrorAction SilentlyContinue)) {
  if (-not (Test-Path "$($t.FullName)\index.jsonl")) { continue }
  if ((Get-Item "$($t.FullName)\index.jsonl").Length -eq 0) { continue }
  if (Test-Path "$($t.FullName)\shoot_form") { continue }
  & $py "$PSScriptRoot\pc_to_frames.py" --rx $t.FullName --out "$($t.FullName)\shoot_form" --ffmpeg $ff
  $found++
}
"fixed takes: $found (output: <take>\shoot_form)"
