@echo off
chcp 65001 > nul
cd /d repo
python machine_lock.py run --machine pc1 --kind ue --who "place-scout" --job "scout s:bbe7ba1b" --minutes 60 --wait 3600 -- python place\shootlog\scout\scout.py --minutes 60
pause
