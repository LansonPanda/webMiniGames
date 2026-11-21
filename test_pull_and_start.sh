#!/usr/bin/env bash
# ============================================================================
# Linux / Termux TEST Server Auto-Deploy & Start Script (Branch: test, Port: 3001)
# Repository: https://github.com/LansonPanda/webMiniGames.git
# 본서버(webMiniGames, 포트 3000)와 완전히 독립 실행됩니다.
# ============================================================================

command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock || true

REPO_URL="https://github.com/LansonPanda/webMiniGames.git"
BRANCH="test"
TEST_PORT="${PORT:-3001}"
PM2_NAME="arcade-test"
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_DIR" || exit 1

echo "========================================================"
echo "🧪 [webMiniGames TEST] 테스트 서버(branch: ${BRANCH}, port: ${TEST_PORT}) 동기화 · 재시작"
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

# 0. 테스트 서버 로컬 스냅샷 백업 (본서버 백업 저장소와 완전 분리)
BACKUP_ROOT="$HOME/webMiniGames_test_backups"
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
echo "[0/3] 💾 테스트 데이터 백업 완료 (${BAK_COUNT}개 파일 → $PRE_PULL_DIR)"

# 1. 데이터 파일 임시 보존 후 origin/test 브랜치로 강제 동기화
TMP_BAK_DIR="${TMPDIR:-$HOME}/.webminigames_test_sync_bak_$$"
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
echo "[1/3] GitHub '${BRANCH}' 브랜치 최신 코드 동기화 중..."
git fetch origin
if git rev-parse --verify "origin/${BRANCH}" >/dev/null 2>&1; then
  git checkout -B "${BRANCH}" "origin/${BRANCH}"
  git reset --hard "origin/${BRANCH}"
else
  echo "⚠️ 원격에 '${BRANCH}' 브랜치가 아직 없어 'origin/main' 기준으로 초기화합니다."
  git checkout -B "${BRANCH}" "origin/main"
  git reset --hard "origin/main"
fi

for df in "${DATA_FILES[@]}"; do
  [ -f "$TMP_BAK_DIR/$df" ] && mv "$TMP_BAK_DIR/$df" "$df"
done
rm -rf "$TMP_BAK_DIR"

# 2. 패키지 설치
echo "[2/3] npm 패키지 확인..."
npm install --production

# 3. 테스트 서버만 독립 재시작 (본서버 webMiniGames에 영향 없음!)
echo "[3/3] 테스트 서버(${PM2_NAME}, 포트 ${TEST_PORT})를 재시작합니다..."
if command -v pm2 >/dev/null 2>&1; then
  if pm2 describe "${PM2_NAME}" >/dev/null 2>&1; then
    PORT="${TEST_PORT}" pm2 restart "${PM2_NAME}" --update-env
  else
    PORT="${TEST_PORT}" pm2 start server.js --name "${PM2_NAME}"
  fi
  pm2 save
  echo "✅ 테스트 서버 PM2 재시작 완료! (포트: ${TEST_PORT}, 로그: pm2 logs ${PM2_NAME})"
else
  echo "▶ PORT=${TEST_PORT} node server.js 실행 중..."
  PORT="${TEST_PORT}" node server.js
fi
