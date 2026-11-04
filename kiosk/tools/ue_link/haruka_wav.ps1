# Windows の日本語の声(System.Speech。手元だけ・無料)で、文を 24 kHz・16 bit・mono の WAV に書く。音は出さない(ファイルへ書くだけ)。
#   powershell -NoProfile -File haruka_wav.ps1 -TextFile <utf8 の文> -Out <wav>
param([string]$TextFile, [string]$Out, [int]$Rate = 1)
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$v = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq 'ja-JP' } | Select-Object -First 1
if (-not $v) { Write-Error 'no ja-JP voice'; exit 2 }
$s.SelectVoice($v.VoiceInfo.Name)
$s.Rate = $Rate
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(24000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToWaveFile($Out, $fmt)
$s.Speak([IO.File]::ReadAllText($TextFile, [Text.Encoding]::UTF8))
$s.SetOutputToNull()
$s.Dispose()
Write-Output $v.VoiceInfo.Name
