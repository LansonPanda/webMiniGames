# PowerShell Git Auto Push Script for https://github.com/LansonPanda/webMiniGames.git
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location -Path $PSScriptRoot

$RepoUrl = "https://github.com/LansonPanda/webMiniGames.git"

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "🚀 [webMiniGames] GitHub 자동 업로드 (PowerShell)" -ForegroundColor Cyan
Write-Host "저장소: $RepoUrl" -ForegroundColor Gray
Write-Host "========================================================"

if (-not (Test-Path ".git")) {
    Write-Host "[1/4] Git 저장소 초기화 중..." -ForegroundColor Yellow
    git init
    git branch -M main
}

$existingOrigin = git remote get-url origin 2>$null
if (-not $existingOrigin) {
    Write-Host "[2/4] 원격 저장소 등록 중..." -ForegroundColor Yellow
    git remote add origin $RepoUrl
} else {
    git remote set-url origin $RepoUrl
}

Write-Host "[3/4] 변경된 파일 스테이징(git add .)..." -ForegroundColor Yellow
git add .

$msg = Read-Host "커밋 메시지를 입력하세요 (Enter 입력 시 자동 날짜 메시지)"
if ([string]::IsNullOrWhiteSpace($msg)) {
    $nowStr = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $msg = "Update webMiniGames ($nowStr)"
}

git commit -m "$msg"

Write-Host "[4/4] GitHub(main)로 푸시 중..." -ForegroundColor Yellow
git branch -M main
git push -u origin main

if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠️ 원격 저장소와 동기화(pull --rebase) 후 다시 푸시합니다..." -ForegroundColor Magenta
    git pull origin main --rebase
    git push -u origin main
}

Write-Host "✅ GitHub 업로드 완료!" -ForegroundColor Green
