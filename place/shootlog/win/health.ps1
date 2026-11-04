$boot = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
"boot: $boot   now: $(Get-Date)"
$since = (Get-Date).AddHours(-24)
$w = Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Microsoft-Windows-WHEA-Logger'; StartTime=$since} -ErrorAction SilentlyContinue
"WHEA events (24h): " + ($w | Measure-Object).Count
$w | Group-Object Id | ForEach-Object { "  WHEA id {0}: {1}" -f $_.Name, $_.Count }
$wb = Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Microsoft-Windows-WHEA-Logger'; StartTime=$boot} -ErrorAction SilentlyContinue
"WHEA since boot: " + ($wb | Measure-Object).Count
$bug = Get-WinEvent -FilterHashtable @{LogName='System'; Id=1001,41; StartTime=$since} -ErrorAction SilentlyContinue
"bugcheck/kernel-power events (24h): " + ($bug | Measure-Object).Count
$gpu = Get-CimInstance Win32_VideoController | Select-Object -First 1
"GPU: $($gpu.Name) driver $($gpu.DriverVersion)"
$ns = Get-Command nvidia-smi -ErrorAction SilentlyContinue
if ($ns) { & nvidia-smi --query-gpu=temperature.gpu,utilization.gpu,memory.used,memory.total --format=csv,noheader }
"C: $([int]((Get-PSDrive C).Free/1GB)) GB  D: $([int]((Get-PSDrive D).Free/1GB)) GB"
$os = Get-CimInstance Win32_OperatingSystem
"RAM free: $([int]($os.FreePhysicalMemory/1MB)) GB of $([int]($os.TotalVisibleMemorySize/1MB)) GB"
"Resolume running: " + [bool](Get-Process -Name 'Arena*','Resolume*' -ErrorAction SilentlyContinue)
