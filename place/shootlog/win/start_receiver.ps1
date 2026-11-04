# Start the shoot receiver on a Windows PC (no window tricks). Double-click friendly: powershell -ExecutionPolicy Bypass -File start_receiver.ps1
# Writes takes to $Out\take_001... (one per connection). Stop with Ctrl+C or close the window.
param([int]$Hours = 5, [string]$Out = "work\gaze\rec", [int]$Port = 9100)
$py = "work\gaze\venv\Scripts\python.exe"
if (-not (Test-Path $py)) { $py = "python" }
$ips = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch '^(127|169)' } | ForEach-Object { $_.IPAddress }
"Receiver IPs (type one into the iPad): " + ($ips -join ", ") + "   port $Port"
"Recording to: $Out"
$free = [int]((Get-PSDrive ($Out.Substring(0, 1))).Free / 1GB)
"Free space on the recording drive: $free GB"
& $py "$PSScriptRoot\pc_stream_receiver.py" --out $Out --port $Port --seconds ($Hours * 3600) --split-takes
