#!/usr/bin/env bash
# ============================================================================
# Linux / Termux Server Auto-Deploy & Start Script
# Repository: https://github.com/LansonPanda/webMiniGames.git
# ============================================================================

command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock || true

REPO_URL="https://github.com/LansonPanda/webMiniGames.git"
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_DIR" || exit 1

echo "========================================================"
echo "🐧 [webMiniGames] 리눅스 서버 자동 백업 · Git 동기화 · 재시작"
echo "========================================================"

DATA_FILES=(
  "users_db.json"
  "market_listings.json"
  "custom_title_requests.json"
  "server_settings.json"
  "custom_maps.json"
  "fishing_top_catches.json"
  "social_data.json"
  "inquiries.json"
  "horse_stats.json"
  "ox_quiz_bank.json"
  "ox_used_quiz_bank.json"
  "economy_ledger.json"
)

# 0. 실행 즉시 현재 상태 전체 데이터 스냅샷 백업 (Git 동기화 전 영구 보관)
BACKUP_ROOT="$HOME/webMiniGames_backups"
BACKUP_STAMP="$(date +%Y-%m-%d-%H-%M-%S)"
PRE_PULL_DIR="$BACKUP_ROOT/pre_pull_${BACKUP_STAMP}"
mkdir -p "$PRE_PULL_DIR"
BAK_COUNT=0
for df in "${DATA_FILES[@]}"; do
  if [ -f "$df" ]; then
    cp "$df" "$PRE_PULL_DIR/$df"
    BAK_COUNT=$((BAK_COUNT + 1))
  fi
done
echo "[0/3] 💾 배포 전 전체 데이터 백업 완료 (${BAK_COUNT}개 파일 → $PRE_PULL_DIR)"
LATEST_GIT_DIR="$BACKUP_ROOT/latest"
if [ -d "$LATEST_GIT_DIR/.git" ]; then
  for df in "${DATA_FILES[@]}"; do
    [ -f "$df" ] && cp "$df" "$LATEST_GIT_DIR/$df"
  done
  (cd "$LATEST_GIT_DIR" && git add -A && (git diff --cached --quiet || (git commit -m "pre-pull backup ${BACKUP_STAMP}" && git push -q origin HEAD))) && echo "[0/3] ☁️ GitHub 비공개 백업 저장소 푸시 완료!" || echo "[0/3] ⚠️ GitHub 백업 푸시 건너뜀(네트워크/인증 확인)"
fi

# 1. 데이터 파일 임시 보존 후 GitHub 최신 코드로 강제 동기화
TMP_BAK_DIR="${TMPDIR:-$HOME}/.webminigames_sync_bak_$$"
mkdir -p "$TMP_BAK_DIR"
for df in "${DATA_FILES[@]}"; do
  [ -f "$df" ] && cp "$df" "$TMP_BAK_DIR/$df"
done

if [ ! -d ".git" ]; then
  echo "[1/3] Git 저장소 연결 및 다운로드..."
  git init
  git remote add origin "$REPO_URL"
fi

git remote set-url origin "$REPO_URL"
echo "[1/3] GitHub 최신 코드 동기화 중..."
git fetch origin
git reset --hard origin/main

for df in "${DATA_FILES[@]}"; do
  [ -f "$TMP_BAK_DIR/$df" ] && mv "$TMP_BAK_DIR/$df" "$df"
done
rm -rf "$TMP_BAK_DIR"

# 2. 패키지 설치
echo "[2/3] npm 패키지 확인..."
npm install --production

# 3. 기존 서버 종료 후 재시작
echo "[3/3] 서버를 재시작합니다..."
if command -v pm2 >/dev/null 2>&1; then
  # 본서버(webMiniGames)만 안전하게 재시작 (테스트 서버 arcade-test에 영향 없음!)
  if pm2 describe webMiniGames >/dev/null 2>&1; then
    PORT=3000 pm2 restart webMiniGames --update-env
  else
    PORT=3000 pm2 start server.js --name "webMiniGames"
  fi
  pm2 save
  echo "✅ PM2 백그라운드 재시작 완료! (로그: pm2 logs webMiniGames)"
else
  pkill -f "node server.js" >/dev/null 2>&1 || true
  sleep 1
  echo "▶ node server.js 실행 중..."
  node server.js
fi
