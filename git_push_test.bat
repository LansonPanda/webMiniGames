@echo off
chcp 65001 >nul
echo ========================================================
echo  [webMiniGames TEST] GitHub 'test' 브랜치 원클릭 푸시
echo  (본서버 main 브랜치는 건드리지 않습니다!)
echo ========================================================
cd /d "%~dp0"
git add -A
set /p MSG="테스트 커밋 메시지 (엔터 시 자동 입력): "
if "%MSG%"=="" set MSG=test update v1.6.0
git commit -m "%MSG%"
git push -f origin HEAD:test
echo.
echo ✅ GitHub 'test' 브랜치 푸시 완료!
echo 👉 이제 Termux의 ~/webMiniGames-test 에서 ./test_pull_and_start.sh 를 실행하세요.
pause
