@echo off
cd /d "%~dp0"
git init
git rebase --abort 2>nul
git checkout -B main
git remote add origin https://github.com/LansonPanda/webMiniGames.git 2>nul
git remote set-url origin https://github.com/LansonPanda/webMiniGames.git
git add -A
git commit -m "Update webMiniGames"
git push -u origin main --force
pause
