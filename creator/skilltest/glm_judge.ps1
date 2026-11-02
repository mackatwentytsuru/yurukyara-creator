# 2 つ目の別の AI(GLM 5.3-flash、画像を読める)で、絵の判定をする。
# 使い方: pwsh -NoProfile -File glm_judge.ps1 -Dir <絵と問いのあるフォルダ> -PromptFile <問いの md> -Out <答えの txt>
param([string]$Dir, [string]$PromptFile, [string]$Out)
$empty = Join-Path $env:TEMP 'glm_empty_cfg'
New-Item -ItemType Directory -Force $empty | Out-Null
Remove-Item Env:CLAUDE_CODE_ENTRYPOINT, Env:CLAUDE_CODE_CHILD_SESSION, Env:CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH -ErrorAction SilentlyContinue
$env:CLAUDE_CONFIG_DIR = $empty
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Set-Location $Dir
$p = Get-Content $PromptFile -Raw -Encoding UTF8
$p | & claude-glm -p --model glm-5.3-flash --allowedTools "Read" --output-format text 2>&1 | Out-File -FilePath $Out -Encoding UTF8
