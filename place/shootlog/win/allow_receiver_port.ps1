# RUN ONLY IF the iPad cannot reach the receiver on the venue Wi-Fi (firewall blocks inbound). Run as Administrator (right-click -> Run with PowerShell as administrator).
# Adds ONE inbound rule: TCP 9100 (the shoot receiver), only from the local subnet. Remove later with:
#   Remove-NetFirewallRule -DisplayName "shoot receiver 9100"
New-NetFirewallRule -DisplayName "shoot receiver 9100" -Direction Inbound -Protocol TCP -LocalPort 9100 -RemoteAddress LocalSubnet -Profile Any -Action Allow
"Done. Now press the connection test on the iPad again."
