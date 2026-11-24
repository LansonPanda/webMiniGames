@echo off
cd /d "%~dp0"
echo ========================================================
echo  [webMiniGames TEST] Push to GitHub "test" branch
echo  (Production "main" branch will NOT be touched)
echo ========================================================
git init
git rebase --abort 2>nul
git remote add origin https://github.com/LansonPanda/webMiniGames.git 2>nul
git remote set-url origin https://github.com/LansonPanda/webMiniGames.git
git add -A
git commit -m "Update webMiniGames (test)"
git push -f origin HEAD:test
echo.
echo Done! Now run ./test_pull_and_start.sh in ~/webMiniGames-test on Termux.
pause
