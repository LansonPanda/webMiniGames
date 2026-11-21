/**
 * ============================================================================
 * 통합 실시간 멀티플레이어 아케이드 서버 (server.js)
 * ============================================================================
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const os = require('os');

const {
  requestHandler: oxQuizRequestHandler,
  setServerHooks,
  removeParticipantFromAllOxRooms,
  getOxRoomsSummary,
  getOxRoomsJoinedBy,
  deleteOxRoomByCode,
  setOxIdleTimeoutMinutes,
  getOxBankStats
} = require('./routes/ox-quiz');
const { setupMinigamesSocket } = require('./routes/minigames');
const { setupHorseRacingSocket } = require('./routes/horse-racing');
const setupBlackjackSocket = require('./routes/blackjack');
const { setupFishingModule } = require('./routes/fishing');
const { setupFishingRaidModule } = require('./routes/fishing-raid');
const { setupSocialModule } = require('./routes/social');
const { setupAdminConsoleModule } = require('./routes/admin-console');
let minigameHooks = null;
let blackjackHooks = null;
let fishingHooks = null;
let horseHooks = null;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

/********************************************************************
 * 1. OX 서바이벌 퀴즈 전용 엔드포인트 라우팅 (/events, /sync, /ai-quiz, /refill-bank, /ox-rooms)
 ********************************************************************/
app.use((req, res, next) => {
  const urlPath = req.path;
  if (
    urlPath === '/events' ||
    urlPath === '/sync' ||
    urlPath === '/ai-quiz' ||
    urlPath === '/refill-bank' ||
    urlPath === '/ox-rooms'
  ) {
    return Promise.resolve(oxQuizRequestHandler(req, res)).catch((err) => {
      console.error('[OX Handler Error]', err);
      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: '서버 내부 처리 오류가 발생했습니다.' });
      }
    });
  }
  next();
});

app.use(express.json());

/********************************************************************
 * 2. 무패스워드 로그인 & 8자리 세이브 코드 + 게임별 누적 전적 DB (users_db.json)
 ********************************************************************/
const DB_FILE = path.join(__dirname, 'users_db.json');
const GAMES_REGISTRY_FILE = path.join(__dirname, 'games_registry.json');
const CUSTOM_MAPS_FILE = path.join(__dirname, 'custom_maps.json');

function loadCustomMapsDB() {
  try {
    if (fs.existsSync(CUSTOM_MAPS_FILE)) {
      const data = JSON.parse(fs.readFileSync(CUSTOM_MAPS_FILE, 'utf8'));
      if (Array.isArray(data)) return data;
    }
  } catch (err) {
    console.error('Failed to read custom_maps.json:', err.message);
  }
  return [];
}

function saveCustomMapsDB(maps) {
  try {
    fs.writeFileSync(CUSTOM_MAPS_FILE, JSON.stringify(maps, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write custom_maps.json:', err.message);
  }
}

let customMapsDB = loadCustomMapsDB();

function getTodayKstString() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

const DAILY_MISSIONS = [
  { id: 'play_3', title: '아무 게임 3판 플레이', desc: '모든 게임 합산 3판 참여하기', target: 3, progressKey: 'plays', reward: 100000, icon: '🎮' },
  { id: 'play_7', title: '아무 게임 7판 플레이', desc: '모든 게임 합산 7판 참여하기', target: 7, progressKey: 'plays', reward: 200000, icon: '🔥' },
  { id: 'minigame_win_2', title: '1:1 미니게임 2승 달성', desc: '흑과백·러시안룰렛·다이스21 중 2승', target: 2, progressKey: 'minigameWins', reward: 150000, icon: '⚔️' },
  { id: 'minigame_win_5', title: '1:1 미니게임 5승 달성', desc: '흑과백·러시안룰렛·다이스21 중 5승', target: 5, progressKey: 'minigameWins', reward: 250000, icon: '🥊' },
  { id: 'main_win_1', title: '메인 게임 1회 우승/적중', desc: '마블·OX 등 메인 게임 1회 승리', target: 1, progressKey: 'mainWins', reward: 200000, icon: '🏆' },
  { id: 'fish_rare_5', title: '희귀+ 물고기 5마리 낚기', desc: '낚시터에서 희귀(RARE) 등급 이상 5마리 포획', target: 5, progressKey: 'fishingRarePlus', reward: 150000, icon: '🎣' },
  { id: 'fish_hero_2', title: '영웅+ 물고기 2마리 낚기', desc: '낚시터에서 영웅(HERO) 등급 이상 2마리 포획', target: 2, progressKey: 'fishingHeroPlus', reward: 300000, icon: '🐟' }
];

const SHOP_CATALOG = [
  // 🏷️ 칭호 (입문 3,000 스타 ~ 1억 스타)
  { id: 'title_rookie', category: 'title', name: '[초심자]', value: '[초심자]', price: 3000, desc: '부담 없이 장착하는 입문자용 기본 칭호' },
  { id: 'title_gambler', category: 'title', name: '[승부사]', value: '[승부사]', price: 10000, desc: '[1만 스타] 판의 흐름을 읽는 승부사 칭호' },
  { id: 'title_tajja', category: 'title', name: '[타짜]', value: '[타짜]', price: 100000, desc: '[10만 스타] 손보다 눈이 빠른 정통 타짜 칭호' },
  { id: 'title_tycoon', category: 'title', name: '[백만장자]', value: '[백만장자]', price: 1000000, desc: '[100만 스타] 100만 스타 자산가의 상징 칭호' },
  { id: 'title_magnate', category: 'title', name: '[천만재벌]', value: '[천만재벌]', price: 10000000, desc: '[1,000만 스타] 아케이드 경제를 움직이는 거물 칭호' },
  { id: 'title_emperor', category: 'title', name: '[👑억만장자 황제]', value: '[👑억만장자 황제]', price: 100000000, desc: '[1억 스타] 1억 스타 정점에 도달한 전설의 황제 칭호' },
  { id: 'title_sea_god', category: 'title', name: '[🌊 해신]', value: '[🌊 해신]', price: 0, exclusive: true, desc: '[도감 27종 올클리어 전용] 바다를 정복한 해신 칭호' },
  { id: 'custom_title_ticket', category: 'title', name: '✨ 커스텀 칭호 제작권', value: 'CUSTOM_TICKET', price: 5000000, isCustomTitleTicket: true, desc: '[500만 스타] 최대 8글자 나만의 칭호 신청 (관리자 승인 후 장착 · 거절 시 전액 환불)' },
  { id: 'fishing_rod_lv0', category: 'rod', name: '🎣 0강 기본 낚싯대', value: 'rod_lv0', price: 50000, isRepeatableRod: true, desc: '[5만 스타] 힐링 낚시터용 0강 나무 낚싯대 (파괴/판매 시 재구매 가능)' },
  { id: 'fishing_rod_lv7', category: 'rod', name: '🎣 +7강 낚싯대', value: 'rod_lv7', rodLevel: 7, price: 10600000, isRepeatableRod: true, desc: '[1,060만 스타] +7강 강화 완료 낚싯대 (평균 강화비 +20% · 파괴/판매 시 재구매 가능)' },
  { id: 'rod_skin_bamboo', category: 'rodSkin', name: '🎋 대나무 명인 낚싯대 스킨', value: 'rod_bamboo', price: 10000000, desc: '[1,000만 스타] 황금 마디 + 반딧불이 잎사귀가 날리는 명인 대나무 스킨 (영구 귀속)' },
  { id: 'rod_skin_sakura', category: 'rodSkin', name: '🌸 벚꽃 에디션 낚싯대 스킨', value: 'rod_sakura', price: 20000000, desc: '[2,000만 스타] 흩날리는 벚꽃 꽃잎 이펙트 + 로즈골드 벚꽃 스킨 (영구 귀속)' },
  { id: 'rod_skin_cyber', category: 'rodSkin', name: '⚡ 사이버 플라즈마 낚싯대 스킨', value: 'rod_cyber', price: 35000000, desc: '[3,500만 스타] 홀로그램 링 + 전격 아크가 흐르는 플라즈마 스킨 (영구 귀속)' },
  { id: 'rod_skin_dragon', category: 'rodSkin', name: '🐉 황금 용신 낚싯대 스킨', value: 'rod_dragon', price: 50000000, desc: '[5,000만 스타] 황금 용 오라 파동 + 불꽃 용린 이펙트 스킨 (영구 귀속)' },
  { id: 'rod_skin_ice', category: 'rodSkin', name: '❄️ 프로스트 빙결 낚싯대 스킨', value: 'rod_ice', price: 15000000, desc: '[1,500만 스타] 빙결 크리스탈 + 눈꽃 결정 이펙트 스킨 (영구 귀속)' },
  { id: 'rod_skin_inferno', category: 'rodSkin', name: '🔥 지옥불 인페르노 낚싯대 스킨', value: 'rod_inferno', price: 25000000, desc: '[2,500만 스타] 용암 불꽃 + 타오르는 화염 엠버 스킨 (영구 귀속)' },
  { id: 'rod_skin_phantom', category: 'rodSkin', name: '👻 팬텀 고스트 낚싯대 스킨', value: 'rod_phantom', price: 40000000, desc: '[4,000만 스타] 영혼의 비취 오라 + 도깨비불 이펙트 스킨 (영구 귀속)' },
  { id: 'rod_skin_galaxy', category: 'rodSkin', name: '🪐 블랙홀 은하수 낚싯대 스킨', value: 'rod_galaxy', price: 80000000, desc: '[8,000만 스타] 블랙홀 궤도 링 + 은하수 별빛 스킨 (영구 귀속)' },
  { id: 'rod_skin_abyss', category: 'rodSkin', name: '🔱 심연의 포세이돈 스킨', value: 'rod_abyss', price: 25000000, exclusive: true, desc: '[낚시 전용 초희귀] 낚시로만 획득 가능 · 낚싯대 영구 귀속' },
  { id: 'rod_skin_celestial', category: 'rodSkin', name: '🌌 성운의 창세 스킨', value: 'rod_celestial', price: 60000000, exclusive: true, desc: '[낚시 전용 초희귀] 낚시로만 획득 가능 · 낚싯대 영구 귀속' },
  // 🫧 심해 보스 각성 재료 (보스 레이드 드롭 전용 · 거래소 거래 가능)
  { id: 'mat_abyss_essence', category: 'material', name: '🫧 심해의 정수', value: 'mat_abyss_essence', price: 50000, exclusive: true, desc: '[보스 공통 재료] 모든 심해 보스 처치 시 획득 (+11강 낚싯대 각성 재료)' },
  { id: 'mat_kraken_ink', category: 'material', name: '🐙 크라켄 먹물', value: 'mat_kraken_ink', price: 150000, exclusive: true, desc: '[크라켄 전용 재료] 심해의 대왕 크라켄 처치 시 획득' },
  { id: 'mat_megalodon_tooth', category: 'material', name: '🦈 메갈로돈 이빨', value: 'mat_megalodon_tooth', price: 200000, exclusive: true, desc: '[메갈로돈 전용 재료] 고대 메갈로돈 처치 시 획득' },
  { id: 'mat_leviathan_scale', category: 'material', name: '🐉 레비아탄 용린', value: 'mat_leviathan_scale', price: 350000, exclusive: true, desc: '[레비아탄 전용 재료] 심연의 레비아탄 처치 시 획득' },
  { id: 'mat_cthulhu_eye', category: 'material', name: '👁️ 크툴루의 눈동자', value: 'mat_cthulhu_eye', price: 800000, exclusive: true, desc: '[크툴루 전용 재료] 태초의 심해신 크툴루 처치 시 확정 획득' },
  { id: 'rod_protect_ticket', category: 'consumable', name: '🛡️ 대장간 파괴 방지권', value: 'rod_protect_ticket', price: 600000, isConsumable: true, desc: '[60만 스타] +7강 이상 낚싯대 강화 시 파괴 1회 방어 (중복 보유 가능)' },
  { id: 'title_whale', category: 'title', name: '[🐋 심해의 거물]', value: '[🐋 심해의 거물]', price: 5000000, desc: '[500만 스타] 심해의 흐름을 지배하는 거물 칭호' },
  { id: 'title_overlord', category: 'title', name: '[⚡ 아케이드 패왕]', value: '[⚡ 아케이드 패왕]', price: 25000000, desc: '[2,500만 스타] 모든 미니게임을 제패한 패왕 칭호' },
  { id: 'title_myth', category: 'title', name: '[🌠 살아있는 신화]', value: '[🌠 살아있는 신화]', price: 50000000, desc: '[5,000만 스타] 아케이드의 살아있는 신화 칭호' },

  // 🎨 닉네임 컬러 (일반 30만 스타 / 빛남 100만 스타 / 무지개 1,000만 스타)
  { id: 'color_mint', category: 'color', name: '에메랄드 민트', value: '#34d399', price: 300000, desc: '[일반 30만 스타] 산뜻한 에메랄드 민트 닉네임 색상' },
  { id: 'color_gold', category: 'color', name: '골든 앰버', value: '#facc15', price: 300000, desc: '[일반 30만 스타] 따뜻한 황금빛 닉네임 색상' },
  { id: 'color_rose', category: 'color', name: '크림슨 로즈', value: '#fb7185', price: 300000, desc: '[일반 30만 스타] 선명한 크림슨 로즈 닉네임 색상' },
  { id: 'color_sky', category: 'color', name: '스카이 애저', value: '#38bdf8', price: 300000, desc: '[일반 30만 스타] 시원한 스카이 블루 닉네임 색상' },
  { id: 'color_orange', category: 'color', name: '코랄 선셋', value: '#fb923c', price: 300000, desc: '[일반 30만 스타] 화사한 코랄 오렌지 닉네임 색상' },
  { id: 'color_lavender', category: 'color', name: '라일락 퍼플', value: '#a78bfa', price: 300000, desc: '[일반 30만 스타] 부드러운 라일락 퍼플 닉네임 색상' },
  { id: 'color_lime', category: 'color', name: '라임 네온', value: '#a3e635', price: 300000, desc: '[일반 30만 스타] 상큼한 라임 그린 닉네임 색상' },
  { id: 'color_silver', category: 'color', name: '퓨어 실버', value: '#e2e8f0', price: 300000, desc: '[일반 30만 스타] 깔끔한 퓨어 실버 닉네임 색상' },
  { id: 'color_glow_cyan', category: 'color', name: '✨ 네온 시안 글로우', value: 'glow:#22d3ee', price: 1000000, desc: '[빛남 100만 스타] 은은하게 빛나는 네온 시안 텍스트 효과' },
  { id: 'color_glow_purple', category: 'color', name: '✨ 로얄 퍼플 글로우', value: 'glow:#c084fc', price: 1000000, desc: '[빛남 100만 스타] 신비롭게 빛나는 로얄 퍼플 텍스트 효과' },
  { id: 'color_glow_gold', category: 'color', name: '✨ 황금 오라 글로우', value: 'glow:#fde047', price: 1000000, desc: '[빛남 100만 스타] 눈부시게 빛나는 황금빛 텍스트 효과' },
  { id: 'color_glow_ruby', category: 'color', name: '✨ 루비 플레임 글로우', value: 'glow:#f43f5e', price: 1000000, desc: '[빛남 100만 스타] 강렬하게 빛나는 루비 레드 텍스트 효과' },
  { id: 'color_glow_emerald', category: 'color', name: '✨ 에메랄드 글로우', value: 'glow:#34d399', price: 1000000, desc: '[빛남 100만 스타] 영롱하게 빛나는 에메랄드 텍스트 효과' },
  { id: 'color_glow_orange', category: 'color', name: '✨ 선셋 오렌지 글로우', value: 'glow:#fb923c', price: 1000000, desc: '[빛남 100만 스타] 따뜻하게 빛나는 오렌지 텍스트 효과' },
  { id: 'color_rainbow', category: 'color', name: '🌈 프리즘 레인보우', value: 'rainbow', price: 10000000, desc: '[무지개 1,000만 스타] 7색 무지개 그라데이션 닉네임' },
  { id: 'color_rainbow_aurora', category: 'color', name: '🌌 오로라 레인보우', value: 'rainbow_aurora', price: 10000000, desc: '[무지개 1,000만 스타] 신비로운 오로라빛 그라데이션 닉네임' },
  { id: 'color_indigo', category: 'color', name: '딥 인디고', value: '#818cf8', price: 300000, desc: '[일반 30만 스타] 차분하고 세련된 딥 인디고 색상' },
  { id: 'color_teal', category: 'color', name: '오션 틸', value: '#2dd4bf', price: 300000, desc: '[일반 30만 스타] 청량한 바다빛 오션 틸 색상' },
  { id: 'color_pink', category: 'color', name: '체리 블라썸', value: '#f472b6', price: 300000, desc: '[일반 30만 스타] 화사한 체리 블라썸 핑크 색상' },
  { id: 'color_crimson', category: 'color', name: '스칼렛 레드', value: '#ef4444', price: 300000, desc: '[일반 30만 스타] 강렬한 스칼렛 레드 색상' },
  { id: 'color_lemon', category: 'color', name: '레몬 옐로우', value: '#fde047', price: 300000, desc: '[일반 30만 스타] 상큼하게 빛나는 레몬 옐로우 색상' },
  { id: 'color_ice', category: 'color', name: '아이스 블루', value: '#7dd3fc', price: 300000, desc: '[일반 30만 스타] 맑고 투명한 아이스 블루 색상' },
  { id: 'color_glow_pink', category: 'color', name: '✨ 네온 핑크 글로우', value: 'glow:#f472b6', price: 1000000, desc: '[빛남 100만 스타] 화려하게 빛나는 네온 핑크 효과' },
  { id: 'color_glow_blue', category: 'color', name: '✨ 딥블루 글로우', value: 'glow:#38bdf8', price: 1000000, desc: '[빛남 100만 스타] 시원하게 빛나는 딥블루 텍스트 효과' },
  { id: 'color_grad_sunset', category: 'color', name: '🌅 선셋 플레임 그라데이션', value: 'grad:#f97316,#f43f5e,#c084fc', price: 5000000, desc: '[고액 500만 스타] 노을빛 오렌지~로즈~퍼플 3색 그라데이션' },
  { id: 'color_grad_ocean', category: 'color', name: '🌊 심해 오션 그라데이션', value: 'grad:#22d3ee,#3b82f6,#818cf8', price: 5000000, desc: '[고액 500만 스타] 시안~코발트~인디고 심해 그라데이션' },
  { id: 'color_grad_gold', category: 'color', name: '👑 임페리얼 골드 그라데이션', value: 'grad:#fef08a,#f59e0b,#ea580c', price: 15000000, desc: '[고액 1,500만 스타] 눈부신 황금 제왕 그라데이션' },
  { id: 'color_grad_neon', category: 'color', name: '⚡ 사이버 네온 그라데이션', value: 'grad:#34d399,#22d3ee,#e879f9', price: 20000000, desc: '[고액 2,000만 스타] 형광 민트~시안~마젠타 네온 그라데이션' },
  { id: 'color_grad_void', category: 'color', name: '🌌 보이드 아케이드 그라데이션', value: 'grad:#f43f5e,#a855f7,#22d3ee', price: 30000000, desc: '[고액 3,000만 스타] 최상위 우주 보이드 3색 그라데이션' },

  // 🔮 마블 구슬 스킨 (5만 스타 기본색 ~ 30만 스타 링 ~ 50만 스타 빛남 ~ 150~500만 스타 궤적 ~ 1,000만~1억 스타 스페셜)
  { id: 'skin_color_red', category: 'marbleSkin', name: '❤️ 루비 레드 구슬', value: 'color_red', price: 50000, desc: '[5만 스타] 링·꼬리 없는 깔끔한 루비 레드 색상 구슬' },
  { id: 'skin_color_emerald', category: 'marbleSkin', name: '💚 에메랄드 구슬', value: 'color_emerald', price: 50000, desc: '[5만 스타] 링·꼬리 없는 깔끔한 에메랄드 색상 구슬' },
  { id: 'skin_color_purple', category: 'marbleSkin', name: '💜 바이올렛 구슬', value: 'color_purple', price: 50000, desc: '[5만 스타] 링·꼬리 없는 깔끔한 바이올렛 색상 구슬' },
  { id: 'skin_color_gold', category: 'marbleSkin', name: '💛 골든 옐로우 구슬', value: 'color_gold', price: 50000, desc: '[5만 스타] 링·꼬리 없는 깔끔한 골든 옐로우 구슬' },
  { id: 'skin_color_orange', category: 'marbleSkin', name: '🧡 탠저린 오렌지 구슬', value: 'color_orange', price: 50000, desc: '[5만 스타] 링·꼬리 없는 깔끔한 오렌지 색상 구슬' },
  { id: 'skin_color_pink', category: 'marbleSkin', name: '🩷 로즈 핑크 구슬', value: 'color_pink', price: 50000, desc: '[5만 스타] 링·꼬리 없는 깔끔한 로즈 핑크 색상 구슬' },
  { id: 'skin_color_mint', category: 'marbleSkin', name: '🩵 민트 아쿠아 구슬', value: 'color_mint', price: 50000, desc: '[5만 스타] 링·꼬리 없는 깔끔한 민트 색상 구슬' },
  { id: 'skin_color_white', category: 'marbleSkin', name: '🤍 스노우 화이트 구슬', value: 'color_white', price: 50000, desc: '[5만 스타] 링·꼬리 없는 깔끔한 순백색 구슬' },
  { id: 'skin_ring_cyan', category: 'marbleSkin', name: '💠 시안 링 구슬', value: 'ring_cyan', price: 300000, desc: '[30만 스타] 선명한 시안 링이 둘러진 구슬' },
  { id: 'skin_ring_gold', category: 'marbleSkin', name: '⭕ 스타 링 구슬', value: 'ring_gold', price: 300000, desc: '[30만 스타] 고급스러운 황금 링이 둘러진 구슬' },
  { id: 'skin_ring_red', category: 'marbleSkin', name: '🔴 루비 링 구슬', value: 'ring_red', price: 300000, desc: '[30만 스타] 강렬한 루비 레드 링이 둘러진 구슬' },
  { id: 'skin_ring_purple', category: 'marbleSkin', name: '🟣 퍼플 링 구슬', value: 'ring_purple', price: 300000, desc: '[30만 스타] 영롱한 바이올렛 링이 둘러진 구슬' },
  { id: 'skin_ring_emerald', category: 'marbleSkin', name: '🟢 에메랄드 링 구슬', value: 'ring_emerald', price: 300000, desc: '[30만 스타] 산뜻한 에메랄드 링이 둘러진 구슬' },
  { id: 'skin_ring_white', category: 'marbleSkin', name: '⚪ 실버 링 구슬', value: 'ring_white', price: 300000, desc: '[30만 스타] 깔끔한 실버 화이트 링이 둘러진 구슬' },
  { id: 'skin_glow_aqua', category: 'marbleSkin', name: '✨ 아쿠아 글로우 구슬', value: 'glow_aqua', price: 500000, desc: '[50만 스타] 부드럽게 빛나는 아쿠아 발광 구슬' },
  { id: 'skin_glow_rose', category: 'marbleSkin', name: '🌸 로즈 글로우 구슬', value: 'glow_rose', price: 500000, desc: '[50만 스타] 은은하게 빛나는 로즈 핑크 발광 구슬' },
  { id: 'skin_glow_gold', category: 'marbleSkin', name: '✨ 스타 글로우 구슬', value: 'glow_gold', price: 500000, desc: '[50만 스타] 황금빛으로 빛나는 스타 발광 구슬' },
  { id: 'skin_glow_purple', category: 'marbleSkin', name: '✨ 퍼플 글로우 구슬', value: 'glow_purple', price: 500000, desc: '[50만 스타] 보랏빛으로 빛나는 네온 퍼플 발광 구슬' },
  { id: 'skin_glow_lime', category: 'marbleSkin', name: '✨ 라임 글로우 구슬', value: 'glow_lime', price: 500000, desc: '[50만 스타] 생동감 있게 빛나는 라임 발광 구슬' },
  { id: 'skin_trail_flame', category: 'marbleSkin', name: '🔥 블레이즈 궤적 구슬', value: 'trail_flame', price: 1500000, desc: '[150만 스타] 화염 링 + 발광 + 불꽃 꼬리 궤적' },
  { id: 'skin_trail_aqua', category: 'marbleSkin', name: '🌊 아쿠아 웨이브 궤적', value: 'trail_aqua', price: 2000000, desc: '[200만 스타] 시안 링 + 발광 + 시원한 물결 궤적' },
  { id: 'skin_trail_neon', category: 'marbleSkin', name: '⚡ 사이버 네온 궤적', value: 'trail_neon', price: 3000000, desc: '[300만 스타] 회전 플라즈마 링 + 네온 발광 + 전격 궤적' },
  { id: 'skin_trail_emerald', category: 'marbleSkin', name: '🍃 에메랄드 유성 궤적', value: 'trail_emerald', price: 4000000, desc: '[400만 스타] 에메랄드 링 + 발광 + 비취 유성 궤적' },
  { id: 'skin_trail_gold', category: 'marbleSkin', name: '🌟 황금 유성 궤적', value: 'trail_gold', price: 5000000, desc: '[500만 스타] 황금 링 + 별빛 발광 + 스타 유성 궤적' },
  { id: 'skin_crown', category: 'marbleSkin', name: '👑 제왕의 왕관 구슬', value: 'crown', price: 10000000, desc: '[1,000만 스타] 황금 왕관 + 로얄 궤적 + 4각 다이아 오라' },
  { id: 'skin_prism', category: 'marbleSkin', name: '🌈 프리즘 스펙트럼', value: 'prism', price: 30000000, desc: '[3,000만 스타] 무지개 회전 오라 + 프리즘 꼬리 궤적' },
  { id: 'skin_galaxy', category: 'marbleSkin', name: '🌌 갤럭시 엠페러 구슬', value: 'galaxy', price: 100000000, desc: '[1억 스타] 무지개 홀로그램 + 회전 위성 + 황제 왕관 + 궤적' },
  // 🎨 이미지/아트 패턴 구슬 스킨 (80만 ~ 2,000만 스타)
  { id: 'skin_art_soccer', category: 'marbleSkin', name: '⚽ 챔피언 축구공', value: 'art_soccer', price: 800000, desc: '[80만 스타] 오각형 패턴이 그려진 클래식 축구공 구슬' },
  { id: 'skin_art_basketball', category: 'marbleSkin', name: '🏀 코트 농구공', value: 'art_basketball', price: 800000, desc: '[80만 스타] 시그니처 라인이 선명한 농구공 구슬' },
  { id: 'skin_art_8ball', category: 'marbleSkin', name: '🎱 럭키 8번공', value: 'art_8ball', price: 1000000, desc: '[100만 스타] 행운의 숫자 8이 새겨진 블랙 당구공 구슬' },
  { id: 'skin_art_watermelon', category: 'marbleSkin', name: '🍉 한여름 수박', value: 'art_watermelon', price: 1200000, desc: '[120만 스타] 줄무늬가 탱글탱글한 시원한 수박 구슬' },
  { id: 'skin_art_pokeball', category: 'marbleSkin', name: '🔴 몬스터 캡슐', value: 'art_pokeball', price: 1500000, desc: '[150만 스타] 레드·화이트 반반 몬스터 캡슐 디자인 구슬' },
  { id: 'skin_art_earth', category: 'marbleSkin', name: '🌍 푸른 지구본', value: 'art_earth', price: 2500000, desc: '[250만 스타] 푸른 바다와 초록 대륙이 그려진 지구본 구슬' },
  { id: 'skin_art_donut', category: 'marbleSkin', name: '🍩 딸기 도넛', value: 'art_donut', price: 2500000, desc: '[250만 스타] 달콤한 핑크 글레이즈와 스프링클 도넛 구슬' },
  { id: 'skin_art_eye', category: 'marbleSkin', name: '👁️ 심연의 마안', value: 'art_eye', price: 8000000, desc: '[800만 스타] 붉은 홍채가 빛나는 카리스마 마안 구슬' },
  { id: 'skin_art_saturn', category: 'marbleSkin', name: '🪐 골든 토성', value: 'art_saturn', price: 12000000, desc: '[1,200만 스타] 황금 고리가 감싸는 신비로운 토성 행성 구슬' },
  { id: 'skin_art_taegeuk', category: 'marbleSkin', name: '☯️ 태극 소용돌이', value: 'art_taegeuk', price: 20000000, desc: '[2,000만 스타] 청·홍 태극 문양이 회전하는 한국미 구슬' },
  // === 🐾 낚시터 동반 펫 (fishingPet) ===
  { id: 'pet_cat', category: 'fishingPet', name: '🐱 행운의 치즈냥이', value: 'pet_cat', price: 2500000, desc: '[250만 스타] 낚시터 자리 옆에서 꼬리를 살랑이는 귀여운 치즈냥이 펫' },
  { id: 'pet_dolphin', category: 'fishingPet', name: '🐬 아기 돌고래', value: 'pet_dolphin', price: 4500000, desc: '[450만 스타] 낚시터 수면 위를 통통 튀어 오르는 아기 돌고래 펫' },
  { id: 'pet_jellyfish', category: 'fishingPet', name: '🪼 심해 빛 해파리', value: 'pet_jellyfish', price: 8000000, desc: '[800만 스타] 네온 시안빛으로 은은하게 발광하며 떠다니는 심해 해파리 펫' },
  { id: 'pet_dragon', category: 'fishingPet', name: '🐉 미니 황금 용', value: 'pet_dragon', price: 20000000, desc: '[2,000만 스타] 황금빛 기운을 두르고 낚시터 주위를 맴도는 전설의 아기 용 펫' },
  // === ✨ 낚싯대 이펙트 오라 (rodEffect) ===
  { id: 'reff_sakura', category: 'rodEffect', name: '🌸 벚꽃 만개 오라', value: 'reff_sakura', price: 3500000, desc: '[350만 스타] 낚시터 캐릭터와 낚싯대 주변에 분홍 벚꽃잎이 흩날리는 이펙트' },
  { id: 'reff_lightning', category: 'rodEffect', name: '⚡ 뇌신 번개 오라', value: 'reff_lightning', price: 7000000, desc: '[700만 스타] 푸른 전기 스파크가 낚싯대를 감싸며 번쩍이는 뇌신 이펙트' },
  { id: 'reff_aurora', category: 'rodEffect', name: '🌌 은하수 오로라', value: 'reff_aurora', price: 15000000, desc: '[1,500만 스타] 보라·시안빛 오로라와 별가루가 반짝이는 프리미엄 오라' },
  { id: 'reff_golddragon', category: 'rodEffect', name: '👑 황금 용왕 오라', value: 'reff_golddragon', price: 30000000, desc: '[3,000만 스타] 최상위 명품! 황금빛 광채와 별빛 링이 캐릭터를 감싸는 최고급 오라' },
  // === 🏷️ 엔드게임 명품 칭호 ===
  { id: 'title_deep_emperor', category: 'title', name: '🌊 [심해 황제]', value: '[🌊 심해 황제]', price: 12000000, desc: '[1,200만 스타] 깊은 바다를 정복한 최상위 낚시꾼의 명품 칭호' },
  { id: 'title_celestial_lord', category: 'title', name: '🌌 [성운의 지배자]', value: '[🌌 성운의 지배자]', price: 25000000, desc: '[2,500만 스타] 서버 최정상 부호와 전설들을 위한 최고급 명품 칭호' }
];

function getEffectiveShopCatalog() {
  const overrides = (typeof globalServerSettings !== 'undefined' && globalServerSettings.shopPriceOverrides) || {};
  return SHOP_CATALOG.map((item) => {
    const ov = overrides[item.id];
    if (typeof ov === 'number' && !Number.isNaN(ov) && ov >= 0) {
      return { ...item, price: Math.floor(ov) };
    }
    return { ...item };
  });
}

function createDefaultGameData() {
  return {
    lastNicknameChangeAt: 0,
    stats: {
      marble: { plays: 0, firstPlaceWins: 0, targetWins: 0, bestRank: null },
      ox: { plays: 0, firstPlaceWins: 0, correctCount: 0, totalAnswered: 0 },
      minigames: { plays: 0, wins: 0 },
      horse: { plays: 0, wins: 0 },
      blackjack: { plays: 0, wins: 0 }
    },
    economy: {
      lastDailyDate: getTodayKstString(),
      attendanceClaimed: false,
      bailoutCount: 0,
      dailyProgress: { plays: 0, minigameWins: 0, mainWins: 0 },
      dailyMinigameBet: { 'black-white': 0, 'russian-roulette': 0, 'dice-21': 0 },
      claimedMissions: {}
    },
    cosmetics: {
      ownedTitles: [],
      customTitles: [],
      equippedTitle: '',
      ownedColors: [],
      equippedColor: '',
      ownedMarbleSkins: [],
      equippedMarbleSkin: '',
      ownedFishingPets: [],
      equippedFishingPet: '',
      ownedRodEffects: [],
      equippedRodEffect: '',
      ownedFishingPets: [],
      equippedFishingPet: '',
      ownedRodEffects: [],
      equippedRodEffect: '',
      ownedRodSkins: [],
      ownedMaterials: [],
      itemCounts: {}
    },
    fishing: (() => {
      const initRodId = 'rod_init_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      return {
        rodLevel: 0,
        rodFailBonus: 0,
        rodSkinLevel: null,
        rods: [{ id: initRodId, level: 0, failBonus: 0, skinLevel: null }],
        equippedRodId: initRodId,
        dailyBaitUsed: 0,
        dailyBaitBought: 0,
        extraBait: 30,
        lastBaitDate: '',
        dex: {},
        totalCaught: 0,
        totalGoldEarned: 0
      };
    })()
  };
}

function isUserAdmin(user) {
  if (!user) return false;
  if (String(user.nickname || '').trim() === '랜선판다') return true;
  return Boolean(user.isAdmin);
}

function isUserAdmin(user) {
  if (!user) return false;
  if (String(user.nickname || '').trim() === '랜선판다') return true;
  return Boolean(user.isAdmin);
}

function ensureUserStatsStructure(user) {
  if (!user) return user;
  user.isAdult = Boolean(user.isAdult);
  user.isAdmin = isUserAdmin(user);
  user.isAdmin = isUserAdmin(user);
  if (typeof user.gold !== 'number' || Number.isNaN(user.gold)) {
    user.gold = 3000;
  }
  user.gold = Math.max(0, Math.floor(user.gold));
  if (!user.game_data || typeof user.game_data !== 'object') {
    user.game_data = createDefaultGameData();
  }
  if (!user.game_data.stats) {
    user.game_data.stats = createDefaultGameData().stats;
  }
  if (!user.game_data.stats.marble) {
    user.game_data.stats.marble = { plays: 0, firstPlaceWins: 0, targetWins: 0, bestRank: null };
  }
  if (!user.game_data.stats.ox) {
    user.game_data.stats.ox = { plays: 0, firstPlaceWins: 0, correctCount: 0, totalAnswered: 0 };
  }
  if (!user.game_data.stats.minigames) {
    user.game_data.stats.minigames = { plays: 0, wins: 0 };
  }
  if (!user.game_data.stats.horse) {
    user.game_data.stats.horse = { plays: 0, wins: 0 };
  }
  if (!user.game_data.stats.blackjack) {
    user.game_data.stats.blackjack = { plays: 0, wins: 0 };
  }
  const today = getTodayKstString();
  if (!user.game_data.economy || typeof user.game_data.economy !== 'object') {
    user.game_data.economy = {
      lastDailyDate: today,
      attendanceClaimed: false,
      bailoutCount: 0,
      dailyProgress: { plays: 0, minigameWins: 0, mainWins: 0 },
      claimedMissions: {}
    };
  }
  if (user.game_data.economy.lastDailyDate !== today) {
    user.game_data.economy.lastDailyDate = today;
    user.game_data.economy.attendanceClaimed = false;
    user.game_data.economy.bailoutCount = 0;
    user.game_data.economy.dailyProgress = { plays: 0, minigameWins: 0, mainWins: 0 };
    user.game_data.economy.dailyMinigameBet = { 'black-white': 0, 'russian-roulette': 0, 'dice-21': 0 };
    user.game_data.economy.claimedMissions = {};
  }
  if (!user.game_data.economy.dailyMinigameBet || typeof user.game_data.economy.dailyMinigameBet !== 'object') {
    user.game_data.economy.dailyMinigameBet = { 'black-white': 0, 'russian-roulette': 0, 'dice-21': 0 };
  }
  if (!user.game_data.economy.dailyProgress) {
    user.game_data.economy.dailyProgress = { plays: 0, minigameWins: 0, mainWins: 0 };
  }
  if (!user.game_data.economy.claimedMissions) {
    user.game_data.economy.claimedMissions = {};
  }
  if (!user.game_data.cosmetics || typeof user.game_data.cosmetics !== 'object') {
    user.game_data.cosmetics = {
      ownedTitles: [],
      customTitles: [],
      equippedTitle: '',
      ownedColors: [],
      equippedColor: '',
      ownedMarbleSkins: [],
      equippedMarbleSkin: '',
      ownedFishingPets: [],
      equippedFishingPet: '',
      ownedRodEffects: [],
      equippedRodEffect: ''
    };
  }
  if (!Array.isArray(user.game_data.cosmetics.ownedTitles)) user.game_data.cosmetics.ownedTitles = [];
  if (!Array.isArray(user.game_data.cosmetics.customTitles)) user.game_data.cosmetics.customTitles = [];
  if (user.game_data.cosmetics.ownedTitles.includes('[🌊 해신]')) {
    user.game_data.cosmetics.ownedTitles = user.game_data.cosmetics.ownedTitles.map((t) => (t === '[🌊 해신]' ? 'title_sea_god' : t));
  }
  if (user.game_data.fishing && user.game_data.fishing.dex && typeof user.game_data.fishing.dex === 'object') {
    const dexCnt = Object.keys(user.game_data.fishing.dex).filter((k) => (user.game_data.fishing.dex[k]?.count || 0) > 0).length;
    if (dexCnt >= 27 && !user.game_data.cosmetics.ownedTitles.includes('title_sea_god')) {
      user.game_data.cosmetics.ownedTitles.push('title_sea_god');
    }
  }
  if (!Array.isArray(user.game_data.cosmetics.ownedColors)) user.game_data.cosmetics.ownedColors = [];
  if (!Array.isArray(user.game_data.cosmetics.ownedMarbleSkins)) user.game_data.cosmetics.ownedMarbleSkins = [];
  if (!Array.isArray(user.game_data.cosmetics.ownedFishingPets)) user.game_data.cosmetics.ownedFishingPets = [];
  if (!Array.isArray(user.game_data.cosmetics.ownedRodEffects)) user.game_data.cosmetics.ownedRodEffects = [];
  if (typeof user.game_data.cosmetics.equippedFishingPet !== 'string') user.game_data.cosmetics.equippedFishingPet = '';
  if (typeof user.game_data.cosmetics.equippedRodEffect !== 'string') user.game_data.cosmetics.equippedRodEffect = '';
  if (!Array.isArray(user.game_data.cosmetics.ownedRodSkins)) user.game_data.cosmetics.ownedRodSkins = [];
  if (!Array.isArray(user.game_data.cosmetics.ownedMaterials)) user.game_data.cosmetics.ownedMaterials = [];
  if (user.game_data.fishing && Array.isArray(user.game_data.fishing.rods)) {
    user.game_data.fishing.rods = user.game_data.fishing.rods.filter((r) => r && typeof r === 'object');
    user.game_data.fishing.rods.forEach((r) => {
      if ((r.level || 0) >= 11 && !r.craftedBy) {
        r.craftedBy = user.nickname;
        if (!r.craftedAt) r.craftedAt = user.updated_at || new Date().toISOString();
      }
    });
  }
  if (user.game_data.cosmetics.ownedMarbleSkins.length > 0) {
    const validSkinIds = new Set(SHOP_CATALOG.filter((x) => x.category === 'marbleSkin').map((x) => x.id));
    const migrated = [];
    for (const sk of user.game_data.cosmetics.ownedMarbleSkins) {
      const fixed = (!String(sk).startsWith('skin_') && validSkinIds.has('skin_' + sk)) ? ('skin_' + sk) : sk;
      if (!migrated.includes(fixed)) migrated.push(fixed);
    }
    user.game_data.cosmetics.ownedMarbleSkins = migrated;
  }
  if (!user.game_data.cosmetics.itemCounts || typeof user.game_data.cosmetics.itemCounts !== 'object') {
    user.game_data.cosmetics.itemCounts = {};
  }
  const counts = user.game_data.cosmetics.itemCounts;
  for (const id of [...user.game_data.cosmetics.ownedTitles, ...user.game_data.cosmetics.ownedColors, ...user.game_data.cosmetics.ownedMarbleSkins]) {
    if (!counts[id] || counts[id] < 1) counts[id] = 1;
  }
  if (!user.game_data.fishing || typeof user.game_data.fishing !== 'object') {
    const initRodId = 'rod_init_' + (user.id || Date.now());
    user.game_data.fishing = {
      rodLevel: 0,
      rodFailBonus: 0,
      rodSkinLevel: null,
      rods: [{ id: initRodId, level: 0, failBonus: 0, skinLevel: null }],
      equippedRodId: initRodId,
      dailyBaitUsed: 0,
      dailyBaitBought: 0,
      extraBait: 0,
      lastBaitDate: '',
      dex: {},
      totalCaught: 0,
      totalGoldEarned: 0
    };
  } else {
    const f = user.game_data.fishing;
    if (!Array.isArray(f.rods)) {
      const initRodId = 'rod_init_' + (user.id || Date.now());
      f.rods = [{
        id: initRodId,
        level: Math.max(0, Math.floor(Number(f.rodLevel) || 0)),
        failBonus: Number(f.rodFailBonus) || 0,
        skinLevel: (typeof f.rodSkinLevel === 'number') ? f.rodSkinLevel : null
      }];
      f.equippedRodId = initRodId;
    }
    if (f.rods.length > 0 && (f.equippedRodId === undefined || (!f.equippedRodId && (f.totalCaught || 0) === 0))) {
      f.equippedRodId = f.rods[0].id;
    }
    const eqRod = f.rods.find((r) => r.id === f.equippedRodId) || null;
    if (eqRod) {
      f.rodLevel = eqRod.level || 0;
      f.rodFailBonus = eqRod.failBonus || 0;
      f.rodSkinLevel = (typeof eqRod.skinLevel === 'number') ? eqRod.skinLevel : null;
    } else {
      f.rodLevel = 0;
      f.rodFailBonus = 0;
      f.rodSkinLevel = null;
    }
  }
  return user;
}

function addCosmeticItem(user, category, itemId, qty = 1) {
  ensureUserStatsStructure(user);
  const cos = user.game_data.cosmetics;
  const n = Math.max(1, Math.floor(Number(qty) || 1));
  cos.itemCounts[itemId] = Math.max(0, Math.floor(Number(cos.itemCounts[itemId]) || 0)) + n;
  if (category === 'consumable') return cos.itemCounts[itemId];
  const ownedList = category === 'title' ? cos.ownedTitles : category === 'color' ? cos.ownedColors : category === 'rodSkin' ? cos.ownedRodSkins : category === 'material' ? cos.ownedMaterials : category === 'fishingPet' ? cos.ownedFishingPets : category === 'rodEffect' ? cos.ownedRodEffects : cos.ownedMarbleSkins;
  if (!ownedList.includes(itemId)) ownedList.push(itemId);
  return cos.itemCounts[itemId];
}

function removeCosmeticItem(user, category, itemId, qty = 1) {
  ensureUserStatsStructure(user);
  const cos = user.game_data.cosmetics;
  const n = Math.max(1, Math.floor(Number(qty) || 1));
  const cur = Math.max(0, Math.floor(Number(cos.itemCounts[itemId]) || 0));
  if (cur < n) return false;
  const next = cur - n;
  if (next <= 0) {
    delete cos.itemCounts[itemId];
    if (category === 'title') {
      cos.ownedTitles = cos.ownedTitles.filter((x) => x !== itemId);
      const it = SHOP_CATALOG.find((x) => x.id === itemId);
      if (it && cos.equippedTitle === it.value) cos.equippedTitle = '';
    } else if (category === 'color') {
      cos.ownedColors = cos.ownedColors.filter((x) => x !== itemId);
      const it = SHOP_CATALOG.find((x) => x.id === itemId);
      if (it && cos.equippedColor === it.value) cos.equippedColor = '';
    } else if (category === 'rodSkin') {
      cos.ownedRodSkins = (cos.ownedRodSkins || []).filter((x) => x !== itemId);
    } else if (category === 'material') {
      cos.ownedMaterials = (cos.ownedMaterials || []).filter((x) => x !== itemId);
    } else if (category === 'marbleSkin') {
      cos.ownedMarbleSkins = cos.ownedMarbleSkins.filter((x) => x !== itemId);
      const it = SHOP_CATALOG.find((x) => x.id === itemId);
      if (it && cos.equippedMarbleSkin === it.value) cos.equippedMarbleSkin = '';
    } else if (category === 'fishingPet') {
      cos.ownedFishingPets = (cos.ownedFishingPets || []).filter((x) => x !== itemId);
      const it = SHOP_CATALOG.find((x) => x.id === itemId);
      if (it && cos.equippedFishingPet === it.value) cos.equippedFishingPet = '';
    } else if (category === 'rodEffect') {
      cos.ownedRodEffects = (cos.ownedRodEffects || []).filter((x) => x !== itemId);
      const it = SHOP_CATALOG.find((x) => x.id === itemId);
      if (it && cos.equippedRodEffect === it.value) cos.equippedRodEffect = '';
    }
  } else {
    cos.itemCounts[itemId] = next;
  }
  return true;
}

function loadUsersDB() {
  const bakFile = DB_FILE + '.bak';
  for (const target of [DB_FILE, bakFile]) {
    try {
      if (fs.existsSync(target)) {
        const raw = fs.readFileSync(target, 'utf8').trim();
        if (raw) {
          const data = JSON.parse(raw);
          if (Array.isArray(data)) {
            return data.filter((u) => u && typeof u === 'object').map(ensureUserStatsStructure);
          }
        }
      }
    } catch (err) {
      console.error(`Failed to read ${path.basename(target)}:`, err.message);
    }
  }
  if (fs.existsSync(DB_FILE)) {
    try { fs.copyFileSync(DB_FILE, DB_FILE + '.corrupt.' + Date.now()); } catch (_) {}
  }
  const initial = [
    ensureUserStatsStructure({
      id: 'usr_sample_panda',
      nickname: '판다',
      save_code: 'A3F9K2X1',
      game_data: createDefaultGameData(),
      updated_at: new Date().toISOString()
    })
  ];
  saveUsersDB(initial);
  return initial;
}

function saveUsersDB(users) {
  try {
    const tmpFile = DB_FILE + '.tmp';
    const bakFile = DB_FILE + '.bak';
    const json = JSON.stringify(users, null, 2);
    if (fs.existsSync(DB_FILE)) {
      try {
        const cur = fs.readFileSync(DB_FILE, 'utf8').trim();
        if (cur.startsWith('[') && cur.endsWith(']')) fs.writeFileSync(bakFile, cur, 'utf8');
      } catch (_) {}
    }
    fs.writeFileSync(tmpFile, json, 'utf8');
    fs.renameSync(tmpFile, DB_FILE);

  } catch (err) {
    console.error('Failed to write users_db.json:', err.message);
  }
}

let usersDB = loadUsersDB();

const LINUX_BACKUP_DIR = path.join(os.homedir(), 'webMiniGames_backups');
const BACKUP_INTERVAL_MS = 30 * 60 * 1000; // 30분마다 백업
const BACKUP_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7일(일주일) 보관 후 삭제

function runUsersDbLinuxBackup() {
  try {
    if (!Array.isArray(usersDB) || usersDB.length === 0) return;
    if (!fs.existsSync(LINUX_BACKUP_DIR)) fs.mkdirSync(LINUX_BACKUP_DIR, { recursive: true });
    const kstNow = new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace(/[:T]/g, '-').slice(0, 16);
    const snapDir = path.join(LINUX_BACKUP_DIR, `backup_${kstNow}`);
    if (!fs.existsSync(snapDir)) fs.mkdirSync(snapDir, { recursive: true });

    fs.writeFileSync(path.join(snapDir, 'users_db.json'), JSON.stringify(usersDB, null, 2), 'utf8');
    const extraFiles = [
      'market_listings.json',
      'custom_title_requests.json',
      'server_settings.json',
      'custom_maps.json',
      'fishing_top_catches.json',
      'social_data.json',
      'inquiries.json',
      'horse_stats.json',
      'ox_quiz_bank.json',
      'ox_used_quiz_bank.json',
      'economy_ledger.json'
    ];
    const latestDir = path.join(LINUX_BACKUP_DIR, 'latest');
    if (!fs.existsSync(latestDir)) fs.mkdirSync(latestDir, { recursive: true });
    fs.writeFileSync(path.join(latestDir, 'users_db.json'), JSON.stringify(usersDB, null, 2), 'utf8');
    for (const ef of extraFiles) {
      const srcPath = path.join(__dirname, ef);
      if (fs.existsSync(srcPath)) {
        try { fs.copyFileSync(srcPath, path.join(snapDir, ef)); } catch (_) {}
        try { fs.copyFileSync(srcPath, path.join(latestDir, ef)); } catch (_) {}
      }
    }
    // GitHub Private 백업 저장소가 연결되어 있으면 비동기 자동 푸시 (서버 블로킹 없음)
    if (fs.existsSync(path.join(latestDir, '.git'))) {
      const { exec } = require('child_process');
      const commitMsg = `auto backup ${kstNow} KST`;
      exec(
        `git add -A && (git diff --cached --quiet || (git commit -m "${commitMsg}" && git push -q origin HEAD))`,
        { cwd: latestDir, timeout: 25000 },
        (gitErr) => {
          if (gitErr) console.error('[GitHub Backup] push failed:', gitErr.message);
        }
      );
    }

    const cutoff = Date.now() - BACKUP_RETENTION_MS;
    for (const entry of fs.readdirSync(LINUX_BACKUP_DIR)) {
      if (entry === 'latest') continue;
      const fp = path.join(LINUX_BACKUP_DIR, entry);
      try {
        const st = fs.statSync(fp);
        if (st.mtimeMs < cutoff) {
          fs.rmSync(fp, { recursive: true, force: true });
        }
      } catch (_) {}
    }
  } catch (err) {
    console.error('Failed to run 30m full backup:', err.message);
  }
}
setTimeout(runUsersDbLinuxBackup, 5000);
setInterval(runUsersDbLinuxBackup, BACKUP_INTERVAL_MS);

const CUSTOM_TITLES_FILE = path.join(__dirname, 'custom_title_requests.json');
function loadCustomTitleRequests() {
  try {
    if (fs.existsSync(CUSTOM_TITLES_FILE)) {
      const data = JSON.parse(fs.readFileSync(CUSTOM_TITLES_FILE, 'utf8'));
      if (Array.isArray(data)) return data;
    }
  } catch (_) {}
  return [];
}
function saveCustomTitleRequests(list) {
  try {
    fs.writeFileSync(CUSTOM_TITLES_FILE, JSON.stringify(list, null, 2), 'utf8');
  } catch (_) {}
}
let customTitleRequests = loadCustomTitleRequests();

const MARKET_FILE = path.join(__dirname, 'market_listings.json');
function loadMarketListings() {
  try {
    if (fs.existsSync(MARKET_FILE)) {
      const data = JSON.parse(fs.readFileSync(MARKET_FILE, 'utf8'));
      if (Array.isArray(data)) return data;
    }
  } catch (_) {}
  return [];
}
function saveMarketListings(list) {
  try {
    fs.writeFileSync(MARKET_FILE, JSON.stringify(list, null, 2), 'utf8');
  } catch (_) {}
}
let marketListings = loadMarketListings();

function generateSaveCode8() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function findUserByNickname(nick) {
  if (!nick) return null;
  const lower = String(nick).trim().toLowerCase();
  const matches = usersDB.filter((u) => String(u.nickname || '').trim().toLowerCase() === lower);
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  // 동일 닉네임 레코드가 여러 개일 경우 스킨/칭호 장착 여부 및 최신 업데이트 순으로 우선 선택
  matches.sort((a, b) => {
    const aHasCos = Boolean(a.game_data?.cosmetics?.equippedMarbleSkin || a.game_data?.cosmetics?.equippedTitle || a.game_data?.cosmetics?.equippedColor);
    const bHasCos = Boolean(b.game_data?.cosmetics?.equippedMarbleSkin || b.game_data?.cosmetics?.equippedTitle || b.game_data?.cosmetics?.equippedColor);
    if (aHasCos !== bHasCos) return bHasCos ? 1 : -1;
    return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
  });
  return matches[0];
}

const _rateBuckets = new Map();
function checkRateLimit(key, maxReqs, windowMs) {
  const now = Date.now();
  let arr = _rateBuckets.get(key);
  if (!arr) { arr = []; _rateBuckets.set(key, arr); }
  while (arr.length && now - arr[0] > windowMs) arr.shift();
  if (arr.length >= maxReqs) return false;
  arr.push(now);
  if (_rateBuckets.size > 2000) {
    for (const [k, v] of _rateBuckets.entries()) {
      if (!v.length || now - v[v.length - 1] > 120000) _rateBuckets.delete(k);
    }
  }
  return true;
}
function rateLimitMiddleware(scope, maxReqs, windowMs) {
  return (req, res, next) => {
    const ip = String(req.headers['x-forwarded-for'] || req.ip || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    if (!checkRateLimit(`${scope}:${ip}`, maxReqs, windowMs)) {
      return res.status(429).json({ ok: false, error: '요청이 너무 빠릅니다. 잠시 후 다시 시도해주세요.' });
    }
    next();
  };
}

function findUserByValidCode(saveCode) {
  const cleanCode = String(saveCode || '').trim().toUpperCase();
  if (!cleanCode) return null;
  const byCode = usersDB.find((u) => String(u.save_code || '').toUpperCase() === cleanCode);
  return byCode ? ensureUserStatsStructure(byCode) : null;
}

function findUserByCodeOrNick(saveCode, nickname) {
  const cleanCode = String(saveCode || '').trim().toUpperCase();
  const cleanNick = String(nickname || '').trim().slice(0, 16);
  if (cleanCode) {
    const byCode = usersDB.find((u) => String(u.save_code || '').toUpperCase() === cleanCode);
    if (byCode) return ensureUserStatsStructure(byCode);
  }
  if (cleanNick) {
    const byNick = findUserByNickname(cleanNick);
    if (byNick) return ensureUserStatsStructure(byNick);
  }
  if (cleanCode.length === 8 && cleanNick) {
    const restored = ensureUserStatsStructure({
      id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      nickname: cleanNick,
      save_code: cleanCode,
      gold: 3000,
      game_data: createDefaultGameData(),
      updated_at: new Date().toISOString()
    });
    usersDB.push(restored);
    saveUsersDB(usersDB);
    return restored;
  }
  return null;
}

function getUserGold(nickname) {
  const u = findUserByNickname(nickname);
  if (!u) return 3000;
  ensureUserStatsStructure(u);
  return u.gold;
}

function canAffordGold(nickname, amount) {
  const fee = Math.max(0, Math.floor(Number(amount) || 0));
  if (fee <= 0) return true;
  return getUserGold(nickname) >= fee;
}


// ================= 📈 실시간 재화 흐름 원장 (Economy Ledger) =================
const ECONOMY_LEDGER_FILE = path.join(__dirname, 'economy_ledger.json');
const FLOW_LABELS = {
  in_attendance: { dir: 'in', label: '🎁 매일 출석 보상' },
  in_mission: { dir: 'in', label: '🎯 일일 미션 보상' },
  in_bailout: { dir: 'in', label: '🛟 파산 지원금' },
  in_fishing_catch: { dir: 'in', label: '🐟 낚시 어종 판매' },
  in_fishing_chest: { dir: 'in', label: '🧰 보물상자 수익' },
  in_fishing_lottery: { dir: 'in', label: '🎫 황금 복권 당첨' },
  in_fishing_boss: { dir: 'in', label: '⚔️ 보스 레이드 보상' },
  in_fishing_tournament: { dir: 'in', label: '🏆 낚시 대회 상금' },
  in_fishing_dex: { dir: 'in', label: '📖 도감 달성 보상' },
  in_shop_sell: { dir: 'in', label: '💰 창고 상점 판매(65%)' },
  in_game_payout: { dir: 'in', label: '🏆 미니게임·경마·블랙잭·마블·OX 수익' },
  out_shop_buy: { dir: 'out', label: '🛒 스타 상점 구매' },
  out_rod_upgrade: { dir: 'out', label: '⚒️ 낚싯대 강화·각성' },
  out_bait_buy: { dir: 'out', label: '🪱 낚시 미끼 구매' },
  out_summon: { dir: 'out', label: '🌈 날씨·보스 유료 소환' },
  out_market_tax: { dir: 'out', label: '⚖️ 거래소 수수료(5%) 소각' },
  out_p2p_tax: { dir: 'out', label: '🤝 1:1 직거래 수수료(5%) 소각' },
  out_custom_title: { dir: 'out', label: '✨ 커스텀 칭호 제작' },
  out_game_entry: { dir: 'out', label: '🎮 미니게임·경마·블랙잭·마블 참가/배팅' }
};

function loadEconomyLedger() {
  try {
    if (fs.existsSync(ECONOMY_LEDGER_FILE)) {
      const p = JSON.parse(fs.readFileSync(ECONOMY_LEDGER_FILE, 'utf8'));
      if (p && typeof p === 'object') {
        return {
          total: (p.total && typeof p.total === 'object') ? p.total : {},
          byDate: (p.byDate && typeof p.byDate === 'object') ? p.byDate : {}
        };
      }
    }
  } catch (_) {}
  return { total: {}, byDate: {} };
}

let economyLedger = loadEconomyLedger();
let ledgerSaveTimer = null;
function scheduleSaveEconomyLedger() {
  if (ledgerSaveTimer) return;
  ledgerSaveTimer = setTimeout(() => {
    ledgerSaveTimer = null;
    try {
      // 최근 30일치 일별 데이터 유지
      const keys = Object.keys(economyLedger.byDate).sort();
      if (keys.length > 30) {
        for (const k of keys.slice(0, keys.length - 30)) delete economyLedger.byDate[k];
      }
      const tmp = ECONOMY_LEDGER_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(economyLedger, null, 2), 'utf8');
      fs.renameSync(tmp, ECONOMY_LEDGER_FILE);
    } catch (_) {}
  }, 1500);
}

function recordEconomyFlow(category, amount) {
  const amt = Math.floor(Math.abs(Number(amount) || 0));
  if (amt <= 0 || !FLOW_LABELS[category]) return;
  const today = getTodayKstString();
  economyLedger.total[category] = (economyLedger.total[category] || 0) + amt;
  if (!economyLedger.byDate[today]) economyLedger.byDate[today] = {};
  economyLedger.byDate[today][category] = (economyLedger.byDate[today][category] || 0) + amt;
  scheduleSaveEconomyLedger();
}

function mapReasonToFlowCategory(delta, reason) {
  const r = String(reason || '');
  if (r === 'market_sale' || r === 'custom_title_refund' || r === 'p2p_trade') return null;
  if (delta > 0) {
    if (r === 'fishing_catch') return 'in_fishing_catch';
    if (r === 'fishing_raid_reward') return 'in_boss_raid';
    if (r === 'fishing_chest_star') return 'in_fishing_chest';
    if (r === 'fishing_lottery') return 'in_fishing_lottery';
    if (r === 'fishing_boss_raid') return 'in_fishing_boss';
    if (r === 'fishing_tournament_prize' || r === 'fishing_tournament_participation') return 'in_fishing_tournament';
    if (r === 'fishing_dex_milestone') return 'in_fishing_dex';
    return 'in_game_payout';
  }
  if (delta < 0) {
    if (r === 'fishing_buy_bait') return 'out_bait_buy';
    if (r === 'fishing_raid_entry') return 'out_game_entry';
    if (r === 'fishing_rod_upgrade' || r === 'fishing_rod_awaken') return 'out_rod_upgrade';
    if (r === 'fishing_summon_weather' || r === 'fishing_summon_boss') return 'out_summon';
    return 'out_game_entry';
  }
  return null;
}

function addUserGold(nickname, delta, reason = '') {
  const u = findUserByNickname(nickname);
  if (!u) return 0;
  ensureUserStatsStructure(u);
  const dNum = Number(delta || 0);
  const next = Math.max(0, Math.floor(u.gold + dNum));
  const actualDelta = next - u.gold;
  u.gold = next;
  const flowCat = mapReasonToFlowCategory(actualDelta, reason);
  if (flowCat && actualDelta !== 0) recordEconomyFlow(flowCat, Math.abs(actualDelta));
  u.updated_at = new Date().toISOString();
  saveUsersDB(usersDB);
  io.emit('gold_updated', { nickname: u.nickname, gold: u.gold, reason });
  return u.gold;
}

function recordDailyActivity(nickname, { play = 0, minigameWin = 0, mainWin = 0, fishingRarePlus = 0, fishingHeroPlus = 0 } = {}) {
  const u = findUserByNickname(nickname);
  if (!u) return;
  ensureUserStatsStructure(u);
  const dp = u.game_data.economy.dailyProgress;
  if (play > 0) dp.plays = (dp.plays || 0) + play;
  if (minigameWin > 0) dp.minigameWins = (dp.minigameWins || 0) + minigameWin;
  if (mainWin > 0) dp.mainWins = (dp.mainWins || 0) + mainWin;
  if (fishingRarePlus > 0) dp.fishingRarePlus = (dp.fishingRarePlus || 0) + fishingRarePlus;
  if (fishingHeroPlus > 0) dp.fishingHeroPlus = (dp.fishingHeroPlus || 0) + fishingHeroPlus;
  u.updated_at = new Date().toISOString();
  saveUsersDB(usersDB);
}

function getUserCosmetics(nickname) {
  const u = findUserByNickname(nickname);
  if (!u) return { title: '', color: '', marbleSkin: '' };
  ensureUserStatsStructure(u);
  const c = u.game_data.cosmetics || {};
  return {
    title: c.equippedTitle || '',
    color: c.equippedColor || '',
    marbleSkin: c.equippedMarbleSkin || '',
    fishingPet: c.equippedFishingPet || '',
    rodEffect: c.equippedRodEffect || ''
  };
}

function distributePoolPayout(prizePool, payoutMode, orderedNicknames = []) {
  const pool = Math.max(0, Math.floor(Number(prizePool) || 0));
  const cleanNicks = (orderedNicknames || []).filter((n) => n && !String(n).startsWith('🤖'));
  if (pool <= 0 || cleanNicks.length === 0) return [];
  const payouts = [];
  if (payoutMode === 'TOP3_SPLIT' && cleanNicks.length >= 3) {
    const p1 = Math.floor(pool * 0.60);
    const p2 = Math.floor(pool * 0.25);
    const p3 = Math.max(0, pool - p1 - p2);
    const shares = [p1, p2, p3];
    for (let i = 0; i < 3; i++) {
      if (cleanNicks[i] && shares[i] > 0) {
        const newBal = addUserGold(cleanNicks[i], shares[i], `rank_${i + 1}_payout`);
        payouts.push({ rank: i + 1, nickname: cleanNicks[i], amount: shares[i], goldAfter: newBal });
      }
    }
  } else {
    const winnerNick = cleanNicks[0];
    const newBal = addUserGold(winnerNick, pool, 'winner_takes_all');
    payouts.push({ rank: 1, nickname: winnerNick, amount: pool, goldAfter: newBal });
  }
  return payouts;
}

function getMinigameDailyBetUsed(nickname, gameType) {
  const u = findUserByNickname(nickname);
  if (!u) return 0;
  ensureUserStatsStructure(u);
  return Math.max(0, Number(u.game_data.economy.dailyMinigameBet[gameType] || 0));
}

function addMinigameDailyBet(nickname, gameType, amount) {
  const u = findUserByNickname(nickname);
  if (!u) return 0;
  ensureUserStatsStructure(u);
  const add = Math.max(0, Math.floor(Number(amount) || 0));
  u.game_data.economy.dailyMinigameBet[gameType] = Math.max(0, Number(u.game_data.economy.dailyMinigameBet[gameType] || 0)) + add;
  saveUsersDB(usersDB);
  return u.game_data.economy.dailyMinigameBet[gameType];
}

const SERVER_ROD_DAILY_LIMITS = [300, 315, 330, 350, 370, 390, 410, 430, 450, 470, 485, 500];
const SERVER_AWAKENING_EXTRA_CASTS = { 1: 100, 2: 200, 3: 350 };
function getServerRodDailyBaitLimit(level, awakening = 0) {
  const lv = Math.max(0, Math.min(11, Math.floor(Number(level) || 0)));
  const base = SERVER_ROD_DAILY_LIMITS[lv] || 300;
  const aw = Math.max(0, Math.min(3, Math.floor(Number(awakening) || 0)));
  return base + (SERVER_AWAKENING_EXTRA_CASTS[aw] || 0);
}

function pushUserNotification(userOrNick, payload = {}, persist = false) {
  const u = (userOrNick && typeof userOrNick === 'object')
    ? userOrNick
    : findUserByNickname(userOrNick);
  if (!u) return null;
  ensureUserStatsStructure(u);
  if (!Array.isArray(u.game_data.notifications)) u.game_data.notifications = [];
  const entry = {
    id: 'ntf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    type: String(payload.type || 'info'),
    icon: String(payload.icon || '🔔'),
    title: String(payload.title || '알림'),
    message: String(payload.message || ''),
    createdAt: new Date().toISOString(),
    read: false
  };
  u.game_data.notifications.unshift(entry);
  if (u.game_data.notifications.length > 50) {
    u.game_data.notifications = u.game_data.notifications.slice(0, 50);
  }
  const unreadCount = u.game_data.notifications.filter((x) => !x.read).length;
  if (persist) {
    u.updated_at = new Date().toISOString();
    saveUsersDB(usersDB);
  }
  try {
    if (u.id) {
      io.to('user:' + u.id).emit('personal_notification', {
        userId: u.id,
        nickname: u.nickname,
        notification: entry,
        unreadCount
      });
    }
  } catch (_) {}
  return entry;
}

const economyHooks = {
  getUserGold,
  canAffordGold,
  addUserGold,
  getMinigameDailyBetUsed,
  addMinigameDailyBet,
  recordDailyActivity,
  getUserCosmetics,
  pushUserNotification,
  distributePoolPayout,
  addCosmeticItem
};

function buildEconomyStatusResponse(user, attendanceJustGranted = false) {
  ensureUserStatsStructure(user);
  const eco = user.game_data.economy;
  const disabledSet = new Set((typeof globalServerSettings !== 'undefined' && globalServerSettings.disabledGames) ? globalServerSettings.disabledGames : []);
  const anyMinigameActive = ['black-white', 'russian-roulette', 'dice-21'].some((id) => !disabledSet.has(id));
  const anyMainActive = ['marble', 'ox-quiz'].some((id) => !disabledSet.has(id)) || (Boolean(user.isAdult) && ['horse-racing', 'blackjack'].some((id) => !disabledSet.has(id)));
  const anyGameActive = anyMinigameActive || anyMainActive || !disabledSet.has('fishing');
  const activeMissions = DAILY_MISSIONS.filter((m) => {
    if (m.progressKey === 'minigameWins') return anyMinigameActive;
    if (m.progressKey === 'mainWins') return anyMainActive;
    return anyGameActive;
  });
  const missions = activeMissions.map((m) => {
    const cur = Number(eco.dailyProgress[m.progressKey] || 0);
    const claimed = Boolean(eco.claimedMissions[m.id]);
    return {
      ...m,
      current: Math.min(m.target, cur),
      rawCurrent: cur,
      completed: cur >= m.target,
      claimed
    };
  });
  return {
    ok: true,
    nickname: user.nickname,
    gold: user.gold,
    attendanceJustGranted,
    attendanceReward: attendanceJustGranted ? 100000 : 0,
    missions,
    bailout: {
      available: user.gold < 50000 && (eco.bailoutCount || 0) < 3,
      bailoutCount: eco.bailoutCount || 0,
      maxBailout: 3,
      reward: 50000
    },
    cosmetics: {
      ...user.game_data.cosmetics,
      pendingCustomTitles: customTitleRequests.filter((r) => String(r.save_code || '').toUpperCase() === String(user.save_code || '').toUpperCase() && r.status === 'PENDING')
    },
    fishingRods: (() => {
      const today = getTodayKstString();
      const rawRods = (user.game_data.fishing && Array.isArray(user.game_data.fishing.rods)) ? user.game_data.fishing.rods : [];
      const rods = rawRods.map((r) => {
        const limit = getServerRodDailyBaitLimit(r.level || 0, r.awakening || 0);
        const used = (r.lastBaitDate === today) ? Math.max(0, Math.floor(Number(r.dailyBaitUsed) || 0)) : 0;
        const remaining = Math.max(0, limit - used);
        return {
          ...r,
          dailyBaitLimit: limit,
          dailyBaitUsed: used,
          dailyBaitRemaining: remaining
        };
      });
      return {
        rods,
        equippedRodId: (user.game_data.fishing && user.game_data.fishing.equippedRodId) || ''
      };
    })(),
    unreadNotifications: Array.isArray(user.game_data.notifications)
      ? user.game_data.notifications.filter((n) => !n.read).length
      : 0,
    shopCatalog: getEffectiveShopCatalog(),
    fishingBait: (() => {
      const today = getTodayKstString();
      const f = user.game_data.fishing || {};
      const boughtToday = f.lastBaitDate === today ? (f.dailyBaitBought || 0) : 0;
      const usedToday = f.lastBaitDate === today ? (f.dailyBaitUsed || 0) : 0;
      return {
        price: (typeof globalServerSettings.fishingBaitPrice === 'number' && !Number.isNaN(globalServerSettings.fishingBaitPrice) && globalServerSettings.fishingBaitPrice >= 0) ? Math.floor(globalServerSettings.fishingBaitPrice) : 10000,
        dailyBuyLimit: 100,
        boughtToday,
        freeRemaining: Math.max(0, 100 - usedToday),
        extraBait: f.extraBait || 0
      };
    })()
  };
}

app.get('/api/economy/status', (req, res) => {
  const { save_code, nickname } = req.query || {};
  const user = findUserByValidCode(save_code || req.headers['x-save-code']);
  if (!user) return res.status(404).json({ ok: false, error: '유저를 찾을 수 없습니다.' });
  ensureUserStatsStructure(user);
  let attendanceJustGranted = false;
  if (!user.game_data.economy.attendanceClaimed) {
    user.game_data.economy.attendanceClaimed = true;
    user.gold += 100000;
    recordEconomyFlow('in_attendance', 100000);
    attendanceJustGranted = true;
    user.updated_at = new Date().toISOString();
    saveUsersDB(usersDB);
  }
  return res.json(buildEconomyStatusResponse(user, attendanceJustGranted));
});

app.get('/api/notifications', (req, res) => {
  const { save_code, nickname } = req.query || {};
  const user = findUserByValidCode(save_code || req.headers['x-save-code']);
  if (!user) return res.status(404).json({ ok: false, error: '유저를 찾을 수 없습니다.' });
  ensureUserStatsStructure(user);
  const list = Array.isArray(user.game_data.notifications) ? user.game_data.notifications : [];
  const unreadCount = list.filter((x) => !x.read).length;
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ ok: true, notifications: list, unreadCount });
});

app.post('/api/notifications/read', (req, res) => {
  const { save_code, nickname, id } = req.body || {};
  const user = findUserByValidCode(save_code || req.headers['x-save-code']);
  if (!user) return res.status(404).json({ ok: false, error: '유저를 찾을 수 없습니다.' });
  ensureUserStatsStructure(user);
  if (!Array.isArray(user.game_data.notifications)) user.game_data.notifications = [];
  if (id) {
    const target = user.game_data.notifications.find((x) => x.id === id);
    if (target) target.read = true;
  } else {
    user.game_data.notifications.forEach((x) => { x.read = true; });
  }
  user.updated_at = new Date().toISOString();
  saveUsersDB(usersDB);
  const unreadCount = user.game_data.notifications.filter((x) => !x.read).length;
  return res.json({ ok: true, notifications: user.game_data.notifications, unreadCount });
});

app.post('/api/notifications/clear', (req, res) => {
  const { save_code, nickname } = req.body || {};
  const user = findUserByValidCode(save_code || req.headers['x-save-code']);
  if (!user) return res.status(404).json({ ok: false, error: '유저를 찾을 수 없습니다.' });
  ensureUserStatsStructure(user);
  user.game_data.notifications = [];
  user.updated_at = new Date().toISOString();
  saveUsersDB(usersDB);
  return res.json({ ok: true, notifications: [], unreadCount: 0 });
});

// ================= 📩 관리자 문의(고객센터) API =================
const INQUIRIES_FILE = path.join(__dirname, 'inquiries.json');
function loadInquiries() {
  try {
    if (fs.existsSync(INQUIRIES_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(INQUIRIES_FILE, 'utf8'));
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (_) {}
  return [];
}
function saveInquiries(list) {
  try {
    const tmp = INQUIRIES_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
    fs.renameSync(tmp, INQUIRIES_FILE);
  } catch (err) {
    console.error('Failed to save inquiries.json:', err.message);
  }
}
let userInquiries = loadInquiries();

app.get('/api/inquiries/mine', (req, res) => {
  const { save_code, nickname } = req.query || {};
  const user = findUserByValidCode(save_code || req.headers['x-save-code']);
  if (!user) return res.status(404).json({ ok: false, error: '유저 정보를 찾을 수 없습니다.' });
  const myCode = String(user.save_code || '').toUpperCase();
  const mine = userInquiries.filter((q) => String(q.save_code || '').toUpperCase() === myCode);
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ ok: true, inquiries: mine });
});

app.post('/api/inquiries', rateLimitMiddleware('inquiry', 10, 60000), (req, res) => {
  const { save_code, nickname, category, title, content } = req.body || {};
  const user = findUserByValidCode(save_code || req.headers['x-save-code']);
  if (!user) return res.status(404).json({ ok: false, error: '유저 정보를 찾을 수 없습니다.' });
  const cleanTitle = String(title || '').trim().slice(0, 80);
  const cleanContent = String(content || '').trim().slice(0, 1000);
  const cleanCat = String(category || '기타').trim().slice(0, 20);
  if (!cleanTitle || !cleanContent) {
    return res.status(400).json({ ok: false, error: '문의 제목과 내용을 모두 입력해주세요.' });
  }
  const entry = {
    id: 'inq_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    userId: user.id,
    save_code: user.save_code,
    nickname: user.nickname,
    category: cleanCat,
    title: cleanTitle,
    content: cleanContent,
    status: 'OPEN',
    answer: '',
    answeredBy: '',
    answeredAt: '',
    createdAt: new Date().toISOString()
  };
  userInquiries.unshift(entry);
  if (userInquiries.length > 300) userInquiries = userInquiries.slice(0, 300);
  saveInquiries(userInquiries);

  // 관리자 계정들에게 개인 알림 발송
  usersDB.forEach((u) => {
    if (u && (u.isAdmin || String(u.nickname || '').trim() === '랜선판다') && u.id !== user.id) {
      pushUserNotification(u, {
        type: 'admin_inquiry',
        icon: '📩',
        title: `새 문의 [${cleanCat}]`,
        message: `${user.nickname}님: ${cleanTitle}`
      }, false);
    }
  });
  saveUsersDB(usersDB);
  io.emit('inquiries_updated', { at: Date.now() });
  return res.json({ ok: true, inquiry: entry, message: '📩 관리자 문의가 접수되었습니다! 답변이 등록되면 개인 알림으로 알려드려요.' });
});

app.get('/api/admin/inquiries', (req, res) => {
  if (!isAdminAuthorized(req)) return res.status(403).json({ ok: false, error: '관리자 권한이 필요합니다.' });
  const openCount = userInquiries.filter((q) => q.status !== 'ANSWERED').length;
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ ok: true, inquiries: userInquiries, openCount });
});

app.post('/api/admin/inquiries/reply', (req, res) => {
  if (!isAdminAuthorized(req)) return res.status(403).json({ ok: false, error: '관리자 권한이 필요합니다.' });
  const { inquiryId, answer } = req.body || {};
  const cleanAns = String(answer || '').trim().slice(0, 1000);
  if (!cleanAns) return res.status(400).json({ ok: false, error: '답변 내용을 입력해주세요.' });
  const target = userInquiries.find((q) => q.id === inquiryId);
  if (!target) return res.status(404).json({ ok: false, error: '문의를 찾을 수 없습니다.' });

  const adminCode = String(req.headers['x-admin-save-code'] || '').trim().toUpperCase();
  const adminUser = adminCode ? usersDB.find((u) => String(u.save_code || '').toUpperCase() === adminCode) : null;
  target.status = 'ANSWERED';
  target.answer = cleanAns;
  target.answeredBy = adminUser ? adminUser.nickname : '관리자';
  target.answeredAt = new Date().toISOString();
  saveInquiries(userInquiries);

  const author = usersDB.find((u) => String(u.save_code || '').toUpperCase() === String(target.save_code || '').toUpperCase());
  if (author) {
    pushUserNotification(author, {
      type: 'inquiry_reply',
      icon: '📩',
      title: '관리자 문의 답변 도착',
      message: `[${target.title}] 문의에 관리자 답변이 등록되었습니다. 로비 [📩 문의하기]에서 확인하세요.`
    }, true);
  }
  io.emit('inquiries_updated', { at: Date.now() });
  return res.json({ ok: true, inquiry: target, message: '✅ 문의 답변이 등록되었습니다!' });
});

app.post('/api/admin/inquiries/delete', (req, res) => {
  if (!isAdminAuthorized(req)) return res.status(403).json({ ok: false, error: '관리자 권한이 필요합니다.' });
  const { inquiryId } = req.body || {};
  const before = userInquiries.length;
  userInquiries = userInquiries.filter((q) => q.id !== inquiryId);
  if (userInquiries.length !== before) saveInquiries(userInquiries);
  io.emit('inquiries_updated', { at: Date.now() });
  return res.json({ ok: true, message: '문의가 삭제되었습니다.' });
});

app.post('/api/economy/claim-mission', (req, res) => {
  const { save_code, nickname, missionId } = req.body || {};
  const user = findUserByValidCode(save_code || req.headers['x-save-code']);
  if (!user) return res.status(404).json({ ok: false, error: '유저를 찾을 수 없습니다.' });
  ensureUserStatsStructure(user);
  const m = DAILY_MISSIONS.find((x) => x.id === missionId);
  if (!m) return res.status(400).json({ ok: false, error: '존재하지 않는 미션입니다.' });
  const eco = user.game_data.economy;
  if (eco.claimedMissions[m.id]) {
    return res.status(400).json({ ok: false, error: '이미 오늘 보상을 수령한 미션입니다.' });
  }
  const cur = Number(eco.dailyProgress[m.progressKey] || 0);
  if (cur < m.target) {
    return res.status(400).json({ ok: false, error: `아직 미션 조건을 달성하지 못했습니다. (${cur}/${m.target})` });
  }
  eco.claimedMissions[m.id] = true;
  user.gold += m.reward;
  recordEconomyFlow('in_mission', m.reward);
  user.updated_at = new Date().toISOString();
  saveUsersDB(usersDB);
  io.emit('gold_updated', { nickname: user.nickname, gold: user.gold, reason: 'mission_claim' });
  return res.json({
    ...buildEconomyStatusResponse(user, false),
    message: `🎉 [${m.title}] 미션 보상 +${m.reward.toLocaleString()} 스타 수령 완료!`
  });
});

app.post('/api/economy/bailout', (req, res) => {
  const { save_code, nickname } = req.body || {};
  const user = findUserByValidCode(save_code || req.headers['x-save-code']);
  if (!user) return res.status(404).json({ ok: false, error: '유저를 찾을 수 없습니다.' });
  ensureUserStatsStructure(user);
  const eco = user.game_data.economy;
  if (user.gold >= 50000) {
    return res.status(400).json({ ok: false, error: '파산 지원금은 보유 스타가 50,000 스타 미만일 때만 신청할 수 있습니다.' });
  }
  if ((eco.bailoutCount || 0) >= 3) {
    return res.status(400).json({ ok: false, error: '오늘의 파산 지원금 횟수(일일 최대 3회)를 모두 사용했습니다.' });
  }
  eco.bailoutCount = (eco.bailoutCount || 0) + 1;
  user.gold += 50000;
  recordEconomyFlow('in_bailout', 50000);
  user.updated_at = new Date().toISOString();
  saveUsersDB(usersDB);
  io.emit('gold_updated', { nickname: user.nickname, gold: user.gold, reason: 'bailout' });
  return res.json({
    ...buildEconomyStatusResponse(user, false),
    message: `🛟 파산 지원금 +50,000 스타가 지급되었습니다! (오늘 ${eco.bailoutCount}/3회)`
  });
});

app.post('/api/economy/shop/buy', (req, res) => {
  const { save_code, nickname, itemId } = req.body || {};
  const user = findUserByValidCode(save_code || req.headers['x-save-code']);
  if (!user) return res.status(404).json({ ok: false, error: '유저를 찾을 수 없습니다.' });
  ensureUserStatsStructure(user);
  const item = getEffectiveShopCatalog().find((x) => x.id === itemId);
  if (!item) return res.status(400).json({ ok: false, error: '존재하지 않는 상품입니다.' });
  if (item.exclusive) return res.status(400).json({ ok: false, error: '상점에서 구매할 수 없는 전용 업적 아이템입니다.' });
  if (item.isCustomTitleTicket) return res.status(400).json({ ok: false, error: '커스텀 칭호 입력란에 칭호를 적은 뒤 신청 버튼을 눌러주세요.' });
  if (user.gold < item.price) {
    return res.status(400).json({ ok: false, error: `스타가 부족합니다. (필요: ${item.price.toLocaleString()} 스타 / 보유: ${user.gold.toLocaleString()} 스타)` });
  }
  const cos = user.game_data.cosmetics;
  if (item.isConsumable || item.category === 'consumable') {
    user.gold -= item.price;
    recordEconomyFlow('out_shop_buy', item.price);
    const cnt = addCosmeticItem(user, 'consumable', item.id, 1);
    user.updated_at = new Date().toISOString();
    saveUsersDB(usersDB);
    io.emit('gold_updated', { nickname: user.nickname, gold: user.gold, reason: 'shop_buy_consumable' });
    return res.json({
      ...buildEconomyStatusResponse(user, false),
      message: `🛡️ [${item.name}] 구매 완료! (현재 보유 ${cnt}장)`
    });
  }
  if (item.isRepeatableRod || item.category === 'rod') {
    user.gold -= item.price;
    recordEconomyFlow('out_shop_buy', item.price);
    const initLv = Math.max(0, Math.floor(Number(item.rodLevel) || 0));
    const newRod = { id: 'rod_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), level: initLv, failBonus: 0, skinLevel: null };
    user.game_data.fishing.rods.push(newRod);
    if (!user.game_data.fishing.equippedRodId) {
      user.game_data.fishing.equippedRodId = newRod.id;
      user.game_data.fishing.rodLevel = initLv;
      user.game_data.fishing.rodFailBonus = 0;
      user.game_data.fishing.rodSkinLevel = null;
    }
    user.updated_at = new Date().toISOString();
    saveUsersDB(usersDB);
    io.emit('gold_updated', { nickname: user.nickname, gold: user.gold, reason: 'shop_buy_rod' });
    return res.json({
      ...buildEconomyStatusResponse(user, false),
      message: `🎣 [${item.name}] 구매 완료! (보유 낚싯대 ${user.game_data.fishing.rods.length}개)`
    });
  }
  if (item.category === 'rodSkin') {
    user.gold -= item.price;
    recordEconomyFlow('out_shop_buy', item.price);
    const rsCnt = addCosmeticItem(user, 'rodSkin', item.id, 1);
    user.updated_at = new Date().toISOString();
    saveUsersDB(usersDB);
    io.emit('gold_updated', { nickname: user.nickname, gold: user.gold, reason: 'shop_buy_rod_skin' });
    return res.json({
      ...buildEconomyStatusResponse(user, false),
      message: `🎨 [${item.name}] 구매 완료! (창고에서 낚싯대에 영구 귀속 가능 · 보유 ${rsCnt}개)`
    });
  }
  const ownedList = item.category === 'title'
    ? cos.ownedTitles
    : item.category === 'color'
    ? cos.ownedColors
    : cos.ownedMarbleSkins;
  if (ownedList.includes(item.id)) {
    return res.status(400).json({ ok: false, error: '이미 보유 중인 아이템입니다. (추가 구매/거래는 거래소를 이용해 주세요.)' });
  }
  user.gold -= item.price;
  recordEconomyFlow('out_shop_buy', item.price);
  addCosmeticItem(user, item.category, item.id, 1);
  if (item.category === 'title') cos.equippedTitle = item.value;
  else if (item.category === 'color') cos.equippedColor = item.value;
  else if (item.category === 'marbleSkin') cos.equippedMarbleSkin = item.value;
  else if (item.category === 'fishingPet') cos.equippedFishingPet = item.value;
  else if (item.category === 'rodEffect') cos.equippedRodEffect = item.value;
  user.updated_at = new Date().toISOString();
  saveUsersDB(usersDB);
  // 마블 참가 중이면 즉시 반영
  participants.forEach((p) => {
    if (p.name.toLowerCase() === user.nickname.toLowerCase()) {
      p.cosmetics = getUserCosmetics(user.nickname);
      if (p.roomId) emitRoomParticipants(p.roomId);
    }
  });
  io.emit('gold_updated', { nickname: user.nickname, gold: user.gold, reason: 'shop_buy' });
  return res.json({
    ...buildEconomyStatusResponse(user, false),
    message: `🛍️ [${item.name}] 구매 및 장착 완료!`
  });
});

app.post('/api/economy/shop/sell', (req, res) => {
  const { save_code, nickname, itemType, itemId } = req.body || {};
  const user = findUserByValidCode(save_code || req.headers['x-save-code']);
  if (!user) return res.status(404).json({ ok: false, error: '유저 정보를 찾을 수 없습니다.' });
  ensureUserStatsStructure(user);

  let sellPrice = 0;
  let itemName = '';

  if (itemType === 'rod') {
    const f = user.game_data.fishing;
    const rIdx = (f.rods || []).findIndex((r) => r.id === itemId);
    if (rIdx === -1) return res.status(400).json({ ok: false, error: '보유 중인 낚싯대가 아닙니다.' });
    const [removedRod] = f.rods.splice(rIdx, 1);
    if (f.equippedRodId === removedRod.id) {
      f.equippedRodId = '';
      f.rodLevel = 0;
      f.rodFailBonus = 0;
      f.rodSkinLevel = null;
    }
    const baseRodItem = getEffectiveShopCatalog().find((x) => x.id === 'fishing_rod_lv0');
    const basePrice = baseRodItem ? Number(baseRodItem.price || 50000) : 50000;
    sellPrice = Math.floor(basePrice * 0.65);
    itemName = `🎣 +${removedRod.level || 0}강 낚싯대`;
  } else if (itemType === 'consumable') {
    const catItem = getEffectiveShopCatalog().find((x) => x.id === itemId && x.category === 'consumable');
    if (!catItem) return res.status(400).json({ ok: false, error: '판매할 수 없는 소모품입니다.' });
    const curCnt = Math.max(0, Math.floor(Number(user.game_data.cosmetics.itemCounts?.[itemId] || 0)));
    if (curCnt <= 0) return res.status(400).json({ ok: false, error: '보유 수량이 부족합니다.' });
    user.game_data.cosmetics.itemCounts[itemId] = curCnt - 1;
    if (user.game_data.cosmetics.itemCounts[itemId] <= 0) delete user.game_data.cosmetics.itemCounts[itemId];
    sellPrice = Math.floor(Number(catItem.price || 0) * 0.65);
    itemName = catItem.name;
  } else if (['title', 'color', 'marbleSkin', 'rodSkin'].includes(itemType)) {
    const catItem = getEffectiveShopCatalog().find((x) => x.id === itemId && x.category === itemType);
    if (!catItem) return res.status(400).json({ ok: false, error: '상점에 판매할 수 없는 아이템입니다.' });
    if (catItem.exclusive && itemType !== 'rodSkin') return res.status(400).json({ ok: false, error: '전용 업적 아이템은 판매할 수 없습니다.' });
    const ok = removeCosmeticItem(user, itemType, itemId, 1);
    if (!ok) return res.status(400).json({ ok: false, error: '보유 수량이 부족합니다.' });
    sellPrice = Math.floor(Number(catItem.price || 0) * 0.65);
    itemName = catItem.name;
  } else {
    return res.status(400).json({ ok: false, error: '잘못된 아이템 유형입니다.' });
  }

  user.gold = (user.gold || 0) + sellPrice;
  recordEconomyFlow('in_shop_sell', sellPrice);
  user.updated_at = new Date().toISOString();
  saveUsersDB(usersDB);
  io.emit('gold_updated', { nickname: user.nickname, gold: user.gold, reason: 'shop_sell' });
  return res.json({
    ...buildEconomyStatusResponse(user, false),
    sellPrice,
    message: `💰 [${itemName}]을(를) 상점에 판매했습니다! (+${sellPrice.toLocaleString()} 스타 · 65%)`
  });
});

app.post('/api/economy/custom-title/request', (req, res) => {
  const { save_code, nickname, titleText } = req.body || {};
  const user = findUserByValidCode(save_code || req.headers['x-save-code']);
  if (!user) return res.status(404).json({ ok: false, error: '유저 정보를 찾을 수 없습니다.' });
  ensureUserStatsStructure(user);
  let clean = String(titleText || '').trim().replace(/^\[+|\]+$/g, '').trim();
  const charCount = Array.from(clean).length;
  if (charCount < 1 || charCount > 8) {
    return res.status(400).json({ ok: false, error: '커스텀 칭호는 1~8글자 사이로 입력해주세요.' });
  }
  const ticketItem = getEffectiveShopCatalog().find((x) => x.id === 'custom_title_ticket');
  const price = ticketItem ? Number(ticketItem.price || 0) : 5000000;
  if (user.gold < price) {
    return res.status(400).json({ ok: false, error: `스타가 부족합니다. (필요: ${price.toLocaleString()} 스타 / 보유: ${user.gold.toLocaleString()} 스타)` });
  }
  user.gold -= price;
  user.updated_at = new Date().toISOString();
  saveUsersDB(usersDB);

  const reqObj = {
    id: 'custom_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    userId: user.id,
    nickname: user.nickname,
    save_code: user.save_code,
    titleText: clean,
    formattedValue: `[${clean}]`,
    price,
    status: 'PENDING',
    createdAt: new Date().toISOString()
  };
  customTitleRequests.unshift(reqObj);
  saveCustomTitleRequests(customTitleRequests);
  io.emit('gold_updated', { nickname: user.nickname, gold: user.gold, reason: 'custom_title_request' });

  return res.json({
    ...buildEconomyStatusResponse(user, false),
    message: `✨ 커스텀 칭호 [${clean}] 신청 완료! 관리자 승인 후 내정보에서 장착할 수 있습니다.`
  });
});

// ================= 거래소(Marketplace) API (판매 수수료 5% 세금) =================
const MARKET_TTL_MS = 3 * 24 * 60 * 60 * 1000;

function returnListingToSeller(listing) {
  const seller = usersDB.find((u) => u.id === listing.sellerId || String(u.save_code || '').toUpperCase() === String(listing.sellerCode || '').toUpperCase());
  if (!seller) return;
  ensureUserStatsStructure(seller);
  if (listing.itemType === 'rod') {
    const f = seller.game_data.fishing;
    const retRod = {
      id: 'rod_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      level: (listing.rodData && listing.rodData.level) || 0,
      failBonus: (listing.rodData && listing.rodData.failBonus) || 0,
      skinLevel: (listing.rodData && typeof listing.rodData.skinLevel === 'number') ? listing.rodData.skinLevel : null,
      boundSkin: (listing.rodData && listing.rodData.boundSkin) || null,
      awakening: (listing.rodData && Number(listing.rodData.awakening)) || 0,
      craftedBy: (listing.rodData && listing.rodData.craftedBy) || '',
      craftedAt: (listing.rodData && listing.rodData.craftedAt) || ''
    };
    f.rods.push(retRod);
    if (!f.equippedRodId) {
      f.equippedRodId = retRod.id;
      f.rodLevel = retRod.level;
      f.rodFailBonus = retRod.failBonus;
      f.rodSkinLevel = retRod.skinLevel;
    }
  } else {
    addCosmeticItem(seller, listing.itemType, listing.itemId, 1);
  }
  pushUserNotification(seller, {
    type: 'market_expired',
    icon: '⏰',
    title: '거래소 등록 만료',
    message: `[${listing.itemName}]의 3일 등록 기간이 만료되어 창고로 반환되었습니다.`
  }, false);
  seller.updated_at = new Date().toISOString();
}

function pruneExpiredMarketListings() {
  const now = Date.now();
  let changed = false;
  const kept = [];
  for (const l of marketListings) {
    const exp = l.expiresAt ? new Date(l.expiresAt).getTime() : (new Date(l.createdAt).getTime() + MARKET_TTL_MS);
    if (now >= exp) {
      returnListingToSeller(l);
      changed = true;
    } else {
      if (!l.expiresAt) l.expiresAt = new Date(exp).toISOString();
      kept.push(l);
    }
  }
  if (changed) {
    marketListings = kept;
    saveMarketListings(marketListings);
    saveUsersDB(usersDB);
    io.emit('market_updated', { listings: marketListings });
  }
}
setInterval(pruneExpiredMarketListings, 60000);

app.get('/api/economy/market', (req, res) => {
  pruneExpiredMarketListings();
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ ok: true, listings: marketListings });
});

app.post('/api/economy/market/list', (req, res) => {
  if (adminConsoleHooks && adminConsoleHooks.isTradeFrozen()) return res.status(403).json({ ok: false, error: '🔒 관리자에 의해 거래소가 일시 정지되었습니다.' });
  const { save_code, nickname, itemType, itemId, price } = req.body || {};
  const user = findUserByValidCode(save_code || req.headers['x-save-code']);
  if (!user) return res.status(404).json({ ok: false, error: '유저 정보를 찾을 수 없습니다.' });
  ensureUserStatsStructure(user);

  const cleanPrice = Math.floor(Number(price) || 0);
  if (cleanPrice < 1000 || cleanPrice > 1000000000) {
    return res.status(400).json({ ok: false, error: '판매 가격은 1,000 ~ 1,000,000,000 스타 사이로 입력해주세요.' });
  }

  let listingName = '';
  let listingValue = '';
  let rodData = null;

  if (itemType === 'rod') {
    const f = user.game_data.fishing;
    const rIdx = (f.rods || []).findIndex((r) => r.id === itemId);
    if (rIdx === -1) return res.status(400).json({ ok: false, error: '보유 중인 낚싯대가 아닙니다.' });
    const [removedRod] = f.rods.splice(rIdx, 1);
    if (f.equippedRodId === removedRod.id) {
      f.equippedRodId = '';
      f.rodLevel = 0;
      f.rodFailBonus = 0;
      f.rodSkinLevel = null;
    }
    const bSkin = removedRod.boundSkin || null;
    const awLv = Math.max(0, Math.floor(Number(removedRod.awakening) || 0));
    const awTag = awLv > 0 ? `[⚡${awLv}각성] ` : '';
    const crTag = removedRod.craftedBy ? ` (제작:${removedRod.craftedBy})` : '';
    listingName = `${awTag}🎣 +${removedRod.level || 0}강 낚싯대${bSkin ? ' [' + bSkin.name + ']' : ''}${crTag}`;
    listingValue = `rod_lv_${removedRod.level || 0}`;
    rodData = {
      level: removedRod.level || 0,
      failBonus: removedRod.failBonus || 0,
      skinLevel: (typeof removedRod.skinLevel === 'number') ? removedRod.skinLevel : null,
      boundSkin: bSkin,
      awakening: awLv,
      craftedBy: removedRod.craftedBy || '',
      craftedAt: removedRod.craftedAt || ''
    };
  } else if (['title', 'color', 'marbleSkin', 'rodSkin', 'material'].includes(itemType)) {
    const catItem = SHOP_CATALOG.find((x) => x.id === itemId && x.category === itemType);
    if (!catItem) return res.status(400).json({ ok: false, error: '거래소에 등록할 수 없는 아이템입니다.' });
    if (catItem.exclusive && itemType !== 'rodSkin' && itemType !== 'material') return res.status(400).json({ ok: false, error: '전용 업적 아이템은 거래할 수 없습니다.' });
    const ok = removeCosmeticItem(user, itemType, itemId, 1);
    if (!ok) return res.status(400).json({ ok: false, error: '보유 수량이 부족합니다.' });
    listingName = catItem.name;
    listingValue = catItem.value;
  } else {
    return res.status(400).json({ ok: false, error: '잘못된 아이템 유형입니다.' });
  }

  const listing = {
    id: 'mkt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    sellerId: user.id,
    sellerNickname: user.nickname,
    sellerCode: user.save_code,
    itemType,
    itemId,
    itemName: listingName,
    itemValue: listingValue,
    rodData,
    price: cleanPrice,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + MARKET_TTL_MS).toISOString()
  };
  marketListings.unshift(listing);
  saveMarketListings(marketListings);
  user.updated_at = new Date().toISOString();
  saveUsersDB(usersDB);
  io.emit('market_updated', { listings: marketListings });

  return res.json({
    ...buildEconomyStatusResponse(user, false),
    listings: marketListings,
    message: `⚖️ [${listingName}]이(가) ${cleanPrice.toLocaleString()} 스타에 거래소 등록되었습니다!`
  });
});

app.post('/api/economy/market/buy', (req, res) => {
  if (adminConsoleHooks && adminConsoleHooks.isTradeFrozen()) return res.status(403).json({ ok: false, error: '🔒 관리자에 의해 거래소가 일시 정지되었습니다.' });
  const { save_code, nickname, listingId } = req.body || {};
  const buyer = findUserByValidCode(save_code || req.headers['x-save-code']);
  if (!buyer) return res.status(404).json({ ok: false, error: '유저 정보를 찾을 수 없습니다.' });
  ensureUserStatsStructure(buyer);

  const lIdx = marketListings.findIndex((x) => x.id === listingId);
  if (lIdx === -1) return res.status(404).json({ ok: false, error: '이미 판매되었거나 취소된 매물입니다.' });
  const listing = marketListings[lIdx];

  if (String(listing.sellerCode || '').toUpperCase() === String(buyer.save_code || '').toUpperCase()) {
    return res.status(400).json({ ok: false, error: '자신이 등록한 매물은 구매할 수 없습니다.' });
  }
  if (buyer.gold < listing.price) {
    return res.status(400).json({ ok: false, error: `스타가 부족합니다. (필요: ${listing.price.toLocaleString()} 스타)` });
  }

  // 구매자 스타 차감 & 판매자 5% 수수료 제외 정산
  buyer.gold -= listing.price;
  const tax = Math.floor(listing.price * 0.05);
  if (tax > 0) recordEconomyFlow('out_market_tax', tax);
  const sellerProceeds = listing.price - tax;
  addUserGold(listing.sellerNickname, sellerProceeds, 'market_sale');

  if (listing.itemType === 'rod' && listing.rodData) {
    const boughtRod = {
      id: 'rod_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      level: listing.rodData.level || 0,
      failBonus: listing.rodData.failBonus || 0,
      skinLevel: (typeof listing.rodData.skinLevel === 'number') ? listing.rodData.skinLevel : null,
      boundSkin: listing.rodData.boundSkin || null,
      awakening: Number(listing.rodData.awakening) || 0,
      craftedBy: listing.rodData.craftedBy || '',
      craftedAt: listing.rodData.craftedAt || ''
    };
    buyer.game_data.fishing.rods.push(boughtRod);
    if (!buyer.game_data.fishing.equippedRodId) {
      buyer.game_data.fishing.equippedRodId = boughtRod.id;
      buyer.game_data.fishing.rodLevel = boughtRod.level;
      buyer.game_data.fishing.rodFailBonus = boughtRod.failBonus;
      buyer.game_data.fishing.rodSkinLevel = boughtRod.skinLevel;
    }
  } else {
    addCosmeticItem(buyer, listing.itemType, listing.itemId, 1);
  }

  const sellerUser = usersDB.find((u) => u.id === listing.sellerId || String(u.save_code || '').toUpperCase() === String(listing.sellerCode || '').toUpperCase()) || findUserByNickname(listing.sellerNickname);
  if (sellerUser) {
    pushUserNotification(sellerUser, {
      type: 'market_sold',
      icon: '💰',
      title: '거래소 판매 완료',
      message: `[${listing.itemName}]이(가) ${buyer.nickname}님에게 ${listing.price.toLocaleString()} 스타에 판매되었습니다. (수수료 5% 제외 +${sellerProceeds.toLocaleString()} 스타 지급)`
    }, false);
  }
  pushUserNotification(buyer, {
    type: 'market_bought',
    icon: '⚖️',
    title: '거래소 구매 완료',
    message: `[${listing.itemName}]을(를) ${listing.sellerNickname}님에게 ${listing.price.toLocaleString()} 스타에 구매했습니다.`
  }, false);

  marketListings.splice(lIdx, 1);
  saveMarketListings(marketListings);
  buyer.updated_at = new Date().toISOString();
  saveUsersDB(usersDB);
  io.emit('gold_updated', { nickname: buyer.nickname, gold: buyer.gold, reason: 'market_buy' });
  io.emit('market_updated', { listings: marketListings });

  return res.json({
    ...buildEconomyStatusResponse(buyer, false),
    listings: marketListings,
    message: `⚖️ [${listing.itemName}] 구매 완료! (-${listing.price.toLocaleString()} 스타 · 판매자 수수료 5% 제외 ${sellerProceeds.toLocaleString()} 스타 지급)`
  });
});

app.post('/api/economy/market/cancel', (req, res) => {
  const { save_code, nickname, listingId } = req.body || {};
  const seller = findUserByValidCode(save_code || req.headers['x-save-code']);
  if (!seller) return res.status(404).json({ ok: false, error: '유저 정보를 찾을 수 없습니다.' });
  ensureUserStatsStructure(seller);

  const lIdx = marketListings.findIndex((x) => x.id === listingId);
  if (lIdx === -1) return res.status(404).json({ ok: false, error: '매물을 찾을 수 없습니다.' });
  const listing = marketListings[lIdx];
  if (String(listing.sellerCode || '').toUpperCase() !== String(seller.save_code || '').toUpperCase()) {
    return res.status(403).json({ ok: false, error: '본인이 등록한 매물만 취소할 수 있습니다.' });
  }

  if (listing.itemType === 'rod' && listing.rodData) {
    const retRod = {
      id: 'rod_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      level: listing.rodData.level || 0,
      failBonus: listing.rodData.failBonus || 0,
      skinLevel: (typeof listing.rodData.skinLevel === 'number') ? listing.rodData.skinLevel : null,
      boundSkin: listing.rodData.boundSkin || null,
      awakening: Number(listing.rodData.awakening) || 0,
      craftedBy: listing.rodData.craftedBy || '',
      craftedAt: listing.rodData.craftedAt || ''
    };
    seller.game_data.fishing.rods.push(retRod);
    if (!seller.game_data.fishing.equippedRodId) {
      seller.game_data.fishing.equippedRodId = retRod.id;
      seller.game_data.fishing.rodLevel = retRod.level;
      seller.game_data.fishing.rodFailBonus = retRod.failBonus;
      seller.game_data.fishing.rodSkinLevel = retRod.skinLevel;
    }
  } else {
    addCosmeticItem(seller, listing.itemType, listing.itemId, 1);
  }

  marketListings.splice(lIdx, 1);
  saveMarketListings(marketListings);
  seller.updated_at = new Date().toISOString();
  saveUsersDB(usersDB);
  io.emit('market_updated', { listings: marketListings });

  return res.json({
    ...buildEconomyStatusResponse(seller, false),
    listings: marketListings,
    message: `↩️ [${listing.itemName}] 등록이 취소되어 창고로 반환되었습니다.`
  });
});

app.post('/api/economy/shop/equip', (req, res) => {
  const { save_code, nickname, category, itemId } = req.body || {};
  const user = findUserByValidCode(save_code || req.headers['x-save-code']);
  if (!user) return res.status(404).json({ ok: false, error: '유저를 찾을 수 없습니다.' });
  ensureUserStatsStructure(user);
  const cos = user.game_data.cosmetics;
  if (!itemId) {
    if (category === 'title') cos.equippedTitle = '';
    else if (category === 'color') cos.equippedColor = '';
    else if (category === 'marbleSkin') cos.equippedMarbleSkin = '';
    else if (category === 'fishingPet') cos.equippedFishingPet = '';
    else if (category === 'rodEffect') cos.equippedRodEffect = '';
  } else {
    const customTitleObj = category === 'title'
      ? (cos.customTitles || []).find((ct) => ct.id === itemId)
      : null;
    if (customTitleObj) {
      cos.equippedTitle = customTitleObj.value;
    } else {
      const item = SHOP_CATALOG.find((x) => x.id === itemId && x.category === category);
      if (!item) return res.status(400).json({ ok: false, error: '잘못된 아이템입니다.' });
      const ownedList = category === 'title' ? cos.ownedTitles : category === 'color' ? cos.ownedColors : category === 'fishingPet' ? cos.ownedFishingPets : category === 'rodEffect' ? cos.ownedRodEffects : cos.ownedMarbleSkins;
      if (!ownedList.includes(item.id)) return res.status(400).json({ ok: false, error: '보유하지 않은 아이템입니다.' });
      if (category === 'title') cos.equippedTitle = item.value;
      else if (category === 'color') cos.equippedColor = item.value;
      else if (category === 'marbleSkin') cos.equippedMarbleSkin = item.value;
      else if (category === 'fishingPet') cos.equippedFishingPet = item.value;
      else if (category === 'rodEffect') cos.equippedRodEffect = item.value;
    }
  }
  user.updated_at = new Date().toISOString();
  saveUsersDB(usersDB);
  participants.forEach((p) => {
    if (p.name.toLowerCase() === user.nickname.toLowerCase()) {
      p.cosmetics = getUserCosmetics(user.nickname);
      if (p.roomId) emitRoomParticipants(p.roomId);
    }
  });
  return res.json({
    ...buildEconomyStatusResponse(user, false),
    message: '✨ 장착 설정이 변경되었습니다.'
  });
});

app.get('/api/economy/leaderboard', (req, res) => {
  const ranked = usersDB
    .map((u) => {
      ensureUserStatsStructure(u);
      return {
        nickname: u.nickname,
        gold: u.gold,
        cosmetics: getUserCosmetics(u.nickname)
      };
    })
    .sort((a, b) => b.gold - a.gold)
    .slice(0, 10)
    .map((item, idx) => ({ rank: idx + 1, ...item }));
  return res.json({ ok: true, leaderboard: ranked });
});

// 0. 서버 현재 버전 조회 API (GET /api/version)
// HTTP(:3000) -> HTTPS 1-Click 자동 계정 이관 브릿지 페이지
app.get('/migrate-https', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>계정 자동 이관 중...</title>
  <style>
    body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#070b14;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,"Noto Sans KR",sans-serif;padding:20px;box-sizing:border-box;}
    .card{max-width:420px;width:100%;background:#0f1629;border:1px solid #263356;border-radius:20px;padding:26px 22px;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,0.5);}
    h2{margin:0 0 10px;font-size:18px;color:#fde68a;}
    p{margin:0 0 18px;font-size:13px;line-height:1.55;color:#94a3b8;}
    a.btn{display:inline-block;padding:11px 18px;border-radius:12px;background:#5851f6;color:#fff;font-weight:800;font-size:13px;text-decoration:none;}
  </style>
</head>
<body>
  <div class="card" id="box">
    <h2>🔄 기존 계정을 HTTPS로 옮기는 중...</h2>
    <p>잠시만 기다려 주세요. 자동으로 로그인됩니다.</p>
  </div>
  <script>
    (function () {
      var host = location.hostname;
      var targetBase = 'https://' + host + '/';
      var code = '';
      try {
        code = localStorage.getItem('arcade_auth_save_code') || localStorage.getItem('marble_auth_save_code') || '';
        if (!code) {
          var raw = localStorage.getItem('arcade_auth_profile') || localStorage.getItem('marble_auth_profile');
          if (raw) {
            var p = JSON.parse(raw);
            if (p && p.save_code) code = String(p.save_code);
          }
        }
      } catch (_) {}
      code = String(code || '').trim().toUpperCase();
      if (code) {
        location.replace(targetBase + '#migrate=' + encodeURIComponent(code));
      } else {
        var box = document.getElementById('box');
        box.innerHTML =
          '<h2>ℹ️ 이 브라우저에 저장된 기존 계정이 없습니다</h2>' +
          '<p>기존 HTTP 주소로 접속했던 브라우저가 아니거나 캐시가 초기화된 상태입니다.<br>세이브 코드를 알고 계시면 HTTPS 화면의 [☁️ 연동]에서 복구하거나, 관리자에게 닉네임으로 코드를 문의해 주세요.</p>' +
          '<a class="btn" href="' + targetBase + '">← HTTPS 메인으로 돌아가기</a>';
      }
    })();
  </script>
</body>
</html>`);
});

app.get('/api/version', (req, res) => {
  let ver = '1.0.0';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    if (pkg && pkg.version) ver = pkg.version;
  } catch (_) {}
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ version: 'v' + ver });
});

// ① 최초 접속 및 닉네임 생성 API (POST /api/auth/register)
app.post('/api/auth/register', rateLimitMiddleware('auth_reg', 15, 60000), (req, res) => {
  const rawName = String(req.body?.nickname || '').trim().slice(0, 16);
  if (!rawName) {
    return res.status(400).json({ error: '닉네임을 입력해주세요.' });
  }

  const exists = globalServerSettings.enforceNoDupName && usersDB.some((u) => u.nickname.toLowerCase() === rawName.toLowerCase());
  if (exists) {
    return res.status(409).json({ error: '이미 사용 중인 닉네임입니다.' });
  }

  let saveCode = generateSaveCode8();
  while (usersDB.some((u) => u.save_code === saveCode)) {
    saveCode = generateSaveCode8();
  }

  const newUser = ensureUserStatsStructure({
    id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    nickname: rawName,
    save_code: saveCode,
    game_data: createDefaultGameData(),
    updated_at: new Date().toISOString()
  });

  usersDB.push(newUser);
  saveUsersDB(usersDB);

  return res.json({ user: newUser });
});

// ② 다른 기기에서 8자리 세이브 코드로 불러오기 API (POST /api/sync/load)
app.post('/api/sync/load', rateLimitMiddleware('sync_load', 25, 60000), (req, res) => {
  const code = String(req.body?.save_code || '').trim().toUpperCase();
  if (code.length !== 8) {
    return res.status(400).json({ error: '8자리 세이브 코드를 정확히 입력해주세요.' });
  }

  const foundUser = usersDB.find((u) =>
    (code && u.save_code.toUpperCase() === code) ||
    (req.body?.user_id && u.id === req.body.user_id)
  );
  if (!foundUser) {
    return res.status(404).json({ error: '일치하는 세이브 코드를 찾을 수 없습니다.' });
  }

  ensureUserStatsStructure(foundUser);
  foundUser.updated_at = new Date().toISOString();
  saveUsersDB(usersDB);

  return res.json({ user: foundUser });
});

// ③ 내정보 & 누적 전적 실시간 조회 API (GET /api/user/profile)
app.get('/api/user/profile', (req, res) => {
  const code = String(req.query?.save_code || '').trim().toUpperCase();
  const foundUser = usersDB.find((u) => u.save_code.toUpperCase() === code);
  if (!foundUser) {
    return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
  }
  ensureUserStatsStructure(foundUser);
  return res.json({ user: foundUser });
});

// ④ 닉네임 변경 API (하루 1회 제한 - POST /api/auth/change-nickname)
app.post('/api/auth/auto-restore', rateLimitMiddleware('auto_restore', 25, 60000), (req, res) => {
  const { id, nickname, save_code, game_data } = req.body || {};
  const cleanCode = String(save_code || '').trim().toUpperCase();
  const cleanNick = String(nickname || '').trim().slice(0, 16);
  if (!cleanCode || cleanCode.length !== 8 || !cleanNick) {
    return res.status(400).json({ error: '유효하지 않은 프로필입니다.' });
  }
  let existing = usersDB.find((u) => u.save_code.toUpperCase() === cleanCode);
  if (existing) {
    ensureUserStatsStructure(existing);
    return res.json({ ok: true, restored: false, user: existing });
  }
  const restoredUser = ensureUserStatsStructure({
    id: id || `usr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    nickname: cleanNick,
    save_code: cleanCode,
    game_data: (game_data && typeof game_data === 'object') ? game_data : createDefaultGameData(),
    updated_at: new Date().toISOString()
  });
  usersDB.push(restoredUser);
  saveUsersDB(usersDB);
  return res.json({ ok: true, restored: true, user: restoredUser });
});

app.post('/api/auth/change-nickname', rateLimitMiddleware('change_nick', 10, 60000), (req, res) => {
  const code = String(req.body?.save_code || '').trim().toUpperCase();
  const newName = String(req.body?.new_nickname || '').trim().slice(0, 16);
  if (!newName) {
    return res.status(400).json({ error: '새 닉네임을 입력해주세요.' });
  }

  const foundUser = usersDB.find((u) => u.save_code.toUpperCase() === code);
  if (!foundUser) {
    return res.status(404).json({ error: '계정을 찾을 수 없습니다.' });
  }
  ensureUserStatsStructure(foundUser);

  if (foundUser.nickname.toLowerCase() === newName.toLowerCase()) {
    return res.status(400).json({ error: '현재 닉네임과 동일합니다.' });
  }

  // 하루(24시간) 1회 변경 제한 체크
  const lastChanged = Number(foundUser.game_data.lastNicknameChangeAt || 0);
  const now = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  if (lastChanged > 0 && now - lastChanged < ONE_DAY_MS) {
    const remainHours = Math.ceil((ONE_DAY_MS - (now - lastChanged)) / (60 * 60 * 1000));
    return res.status(429).json({
      error: `닉네임은 하루에 1회만 변경할 수 있습니다. (${remainHours}시간 후 가능)`
    });
  }

  // 중복 닉네임 체크
  const dup = globalServerSettings.enforceNoDupName && usersDB.some(
    (u) => u.id !== foundUser.id && u.nickname.toLowerCase() === newName.toLowerCase()
  );
  if (dup) {
    return res.status(409).json({ error: '이미 사용 중인 닉네임입니다.' });
  }

  const oldName = foundUser.nickname;
  foundUser.nickname = newName;
  foundUser.game_data.lastNicknameChangeAt = now;
  foundUser.updated_at = new Date().toISOString();
  saveUsersDB(usersDB);

  // 현재 마블 방에 참여 중인 구슬 이름도 함께 갱신
  const touchedRooms = new Set();
  participants.forEach((p) => {
    if (p.name === oldName) { p.name = newName; if (p.roomId) touchedRooms.add(p.roomId); }
  });
  touchedRooms.forEach((rid) => emitRoomParticipants(rid));

  return res.json({ user: foundUser });
});

function buildGamesRegistryWithCounts() {
  let registry = [];
  try {
    if (fs.existsSync(GAMES_REGISTRY_FILE)) {
      registry = JSON.parse(fs.readFileSync(GAMES_REGISTRY_FILE, 'utf8'));
    }
  } catch (_) {}

  const gamesDir = path.join(__dirname, 'public', 'games');
  if (fs.existsSync(gamesDir)) {
    const folders = fs.readdirSync(gamesDir, { withFileTypes: true });
    folders.forEach((dirent) => {
      if (dirent.isDirectory()) {
        const folderName = dirent.name;
        const indexHtml = path.join(gamesDir, folderName, 'index.html');
        if (fs.existsSync(indexHtml) && !registry.some((g) => g.id === folderName)) {
          registry.push({
            id: folderName,
            title: folderName.toUpperCase(),
            badge: 'LIVE',
            icon: '🎮',
            path: `/games/${folderName}/`
          });
        }
      }
    });
  }

  const disabledSet = new Set(globalServerSettings.disabledGames || []);
  const mRooms = typeof getMarbleRoomsSummary === 'function' ? getMarbleRoomsSummary() : [];
  const oxRooms = typeof getOxRoomsSummary === 'function' ? getOxRoomsSummary() : [];
  const mgRooms = (typeof minigameHooks !== 'undefined' && minigameHooks && minigameHooks.getMinigameRoomsSummary) ? minigameHooks.getMinigameRoomsSummary() : [];
  const hrRooms = (typeof horseHooks !== 'undefined' && horseHooks && horseHooks.getHorseRoomsSummary) ? horseHooks.getHorseRoomsSummary() : [];
  const bjRooms = (typeof blackjackHooks !== 'undefined' && blackjackHooks && blackjackHooks.getBlackjackRoomsSummary) ? blackjackHooks.getBlackjackRoomsSummary() : [];

  return registry.map((g) => {
    let roomCount = 0;
    let playerCount = 0;
    if (g.id === 'marble') {
      roomCount = mRooms.length;
      playerCount = mRooms.reduce((acc, r) => acc + (Number(r.count) || 0), 0);
    } else if (g.id === 'ox-quiz') {
      roomCount = oxRooms.length;
      playerCount = oxRooms.reduce((acc, r) => acc + (Number(r.count) || 0), 0);
    } else if (g.id === 'fishing') {
      roomCount = 1;
      playerCount = (typeof fishingHooks !== 'undefined' && fishingHooks && fishingHooks.getPlayerCount) ? fishingHooks.getPlayerCount() : 0;
    } else if (g.id === 'fishing-raid') {
      const frRooms = (typeof fishingRaidHooks !== 'undefined' && fishingRaidHooks && fishingRaidHooks.getRoomsSummary) ? fishingRaidHooks.getRoomsSummary() : [];
      roomCount = frRooms.length;
      playerCount = frRooms.reduce((acc, r) => acc + (Number(r.memberCount) || 0), 0);
    } else if (g.id === 'horse-racing') {
      roomCount = hrRooms.length;
      playerCount = hrRooms.reduce((acc, r) => acc + (Number(r.playerCount ?? r.count) || 0), 0);
    } else if (g.id === 'blackjack') {
      roomCount = bjRooms.length;
      playerCount = bjRooms.reduce((acc, r) => acc + (Number(r.playerCount ?? r.count) || 0), 0);
    } else if (g.category === 'minigame') {
      const sub = mgRooms.filter((r) => r.gameType === g.id);
      roomCount = sub.length;
      playerCount = sub.reduce((acc, r) => acc + (Number(r.playerCount ?? r.count) || 0), 0);
    }
    return { ...g, disabled: disabledSet.has(g.id), roomCount, playerCount };
  });
}

function broadcastGamesSummary() {
  try {
    if (typeof io !== 'undefined' && io) {
      io.emit('games_summary_updated', buildGamesRegistryWithCounts());
    }
  } catch (_) {}
}

// ⑤ 등록된 게임 목록 조회 API (GET /api/games)
app.get('/api/games', (req, res) => {
  const enriched = buildGamesRegistryWithCounts();
  return res.json({ games: enriched, disabledGames: globalServerSettings.disabledGames || [] });
});

/********************************************************************
 * 3. 마블 드롭 서바이벌 실시간 SOCKET.IO 서버 & 타 게임 동시 입장 차단
 ********************************************************************/
// 전역 서버 설정 (관리자 권한 계정에서만 제어)
const SERVER_SETTINGS_FILE = path.join(__dirname, 'server_settings.json');
const DEFAULT_GLOBAL_SETTINGS = {
  idleRoomTimeoutMinutes: 15,
  enforceOneRoomPerAccount: true,
  enforceNoDupName: true,
  disabledGames: [],
  fishingBaitLimitEnabled: true,
  fishingDailyBaitLimit: 100,
  fishingMaxDailyBaitBuy: 100,
  fishingBaitPrice: 10000,
  shopPriceOverrides: {}
};
function loadGlobalServerSettings() {
  try {
    if (fs.existsSync(SERVER_SETTINGS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SERVER_SETTINGS_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        return {
          ...DEFAULT_GLOBAL_SETTINGS,
          ...parsed,
          disabledGames: Array.isArray(parsed.disabledGames) ? parsed.disabledGames : [],
          fishingBaitLimitEnabled: parsed.fishingBaitLimitEnabled !== false,
          fishingDailyBaitLimit: Math.max(1, Math.min(10000, Math.floor(Number(parsed.fishingDailyBaitLimit) || 100))),
          fishingMaxDailyBaitBuy: Math.max(1, Math.min(10000, Math.floor(Number(parsed.fishingMaxDailyBaitBuy) || 100))),
          fishingBaitPrice: (typeof parsed.fishingBaitPrice === 'number' && !Number.isNaN(parsed.fishingBaitPrice) && parsed.fishingBaitPrice >= 0) ? Math.floor(parsed.fishingBaitPrice) : 10000,
          shopPriceOverrides: (parsed.shopPriceOverrides && typeof parsed.shopPriceOverrides === 'object') ? parsed.shopPriceOverrides : {}
        };
      }
    }
  } catch (_) {}
  return { ...DEFAULT_GLOBAL_SETTINGS };
}
function saveGlobalServerSettings(settingsObj) {
  try {
    fs.writeFileSync(SERVER_SETTINGS_FILE, JSON.stringify(settingsObj, null, 2), 'utf8');
  } catch (_) {}
}
const globalServerSettings = loadGlobalServerSettings();

// 기본 메인 방 없이 빈 배열로 시작 (방장이 방을 만들어야 생성됨)
let rooms = [];
let deletedMarbleRooms = []; // [{ roomId, title, reason, deletedAt }]
let participants = []; // { id, roomId, name, color, socketId, clientId, joinedAt }
let gameState = 'LOBBY';
let currentSeed = Date.now();
let currentMapId = 'pinball_chaos';
let currentSpeed = 1.2;
let winnerTarget = 'FIRST';
let customTargetRank = 1;
let rankings = [];

const COLORS = [
  '#38bdf8', '#fb7185', '#facc15', '#4ade80', '#a78bfa',
  '#f97316', '#2dd4bf', '#f472b6', '#60a5fa', '#a3e635',
  '#e879f9', '#fbbf24', '#34d399', '#818cf8', '#f87171'
];

function getRandomColor(index) {
  return COLORS[index % COLORS.length];
}

function ensureMarbleRoomState(rm) {
  if (!rm) return null;
  if (!rm.status) rm.status = 'LOBBY';
  if (!rm.seed) rm.seed = Date.now();
  if (!rm.mapId) rm.mapId = 'pinball_chaos';
  if (!rm.speed) rm.speed = 1.2;
  if (!rm.winnerTarget) rm.winnerTarget = 'FIRST';
  if (!rm.skillMode) rm.skillMode = 'NONE';
  if (!rm.activeRaceSkill) rm.activeRaceSkill = 'NONE';
  if (!rm.customTargetRank) rm.customTargetRank = 1;
  if (typeof rm.onlyScreenOn !== 'boolean') rm.onlyScreenOn = false;
  if (!Array.isArray(rm.rankings)) rm.rankings = [];
  if (!rm.hostNickname) rm.hostNickname = '';
  rm.maxPlayers = Math.max(0, Math.min(100, Number(rm.maxPlayers || 0)));
  if (typeof rm.password !== 'string') rm.password = '';
  rm.entryFee = Math.max(0, Math.min(1000000000, Math.floor(Number(rm.entryFee) || 0)));
  rm.roomFundingMode = rm.roomFundingMode === 'HOST_EVENT' ? 'HOST_EVENT' : 'ENTRY_FEE';
  rm.payoutMode = rm.payoutMode === 'TOP3_SPLIT' ? 'TOP3_SPLIT' : 'WINNER_TAKES_ALL';
  if (typeof rm.prizePool !== 'number') rm.prizePool = 0;
  if (!Array.isArray(rm.lastPayouts)) rm.lastPayouts = [];
  return rm;
}

function isAdminAuthorized(req) {
  const saveCode = String(req.headers['x-admin-save-code'] || req.body?.adminSaveCode || req.query?.adminSaveCode || '').trim().toUpperCase();
  if (saveCode) {
    const adminUser = usersDB.find((u) => String(u.save_code || '').toUpperCase() === saveCode);
    if (adminUser && isUserAdmin(adminUser)) return true;
  }
  const envSecret = String(process.env.ADMIN_SECRET || '').trim();
  if (envSecret.length >= 8) {
    const pw = String(req.headers['x-admin-password'] || req.body?.adminPassword || req.query?.adminPassword || '');
    if (pw && pw === envSecret) return true;
  }
  return false;
}

function getRoomSpectators(roomId) {
  if (!roomId) return [];
  const roomSockets = io.sockets.adapter.rooms.get(roomId);
  if (!roomSockets || roomSockets.size === 0) return [];
  const activePartClientIds = new Set();
  const activePartNicks = new Set();
  participants.forEach((p) => {
    if (p.roomId === roomId) {
      if (p.clientId) activePartClientIds.add(String(p.clientId));
      if (p.name) activePartNicks.add(String(p.name).trim().toLowerCase());
    }
  });
  const seen = new Set();
  const specs = [];
  for (const sid of roomSockets) {
    const s = io.sockets.sockets.get(sid);
    if (!s) continue;
    const cid = String(s.data?.marbleClientId || '').trim();
    const nick = String(s.data?.marbleNickname || s.data?.nickname || '').trim();
    if (!nick) continue;
    const nickLow = nick.toLowerCase();
    if ((cid && activePartClientIds.has(cid)) || activePartNicks.has(nickLow)) continue;
    const dedupKey = cid || nickLow;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    specs.push({
      clientId: cid || sid,
      name: nick,
      cosmetics: getUserCosmetics(nick)
    });
  }
  return specs;
}

function emitRoomParticipants(roomId) {
  if (!roomId) return;
  const list = participants.filter((p) => p.roomId === roomId).map((p) => {
    if (p.name) p.cosmetics = getUserCosmetics(p.name);
    return p;
  });
  io.to(roomId).emit('participants_updated', list);
  io.to(roomId).emit('room_spectators_updated', { roomId, spectators: getRoomSpectators(roomId) });
}

function pushDeletedMarbleRoom(entry) {
  if (entry && entry.id) marbleRoomChats.delete(entry.id);
  deletedMarbleRooms.push(entry);
  if (deletedMarbleRooms.length > 50) {
    deletedMarbleRooms = deletedMarbleRooms.slice(-50);
  }
}

function getMarbleRoomsSummary() {
  return rooms.map((rm) => ({
    ...rm,
    password: '',
    hasPassword: Boolean(rm.password)
  }));
}

function getMarbleRoom(roomId, hostClientId = null) {
  if (roomId) {
    const found = rooms.find((r) => r.id === roomId);
    if (found) return ensureMarbleRoomState(found);
  }
  if (hostClientId) {
    const byHost = rooms.find((r) => r.hostClientId === hostClientId);
    if (byHost) return ensureMarbleRoomState(byHost);
  }
  return null;
}

function updateRoomCounts() {
  rooms.forEach((rm) => {
    ensureMarbleRoomState(rm);
    rm.count = participants.filter((p) => p.roomId === rm.id).length;
  });
  broadcastGamesSummary();
}

// 타 게임 / 타 방 동시 입장 원천 차단 및 OX 퀴즈 전적 자동 누적 훅 연결
setServerHooks({
  removeUserEverywhere: ({ clientId, nickname, exceptGame }) => {
    removeUserEverywhereUnified(clientId, nickname, exceptGame, null);
    if (false && exceptGame !== 'marble') {
      const before = participants.length;
      participants = participants.filter(
        (p) => p.clientId !== clientId && (!nickname || p.name.toLowerCase() !== String(nickname).toLowerCase())
      );
      if (participants.length !== before) {
        updateRoomCounts();
        io.emit('participants_updated', participants);
        io.emit('rooms_updated', getMarbleRoomsSummary());
      }
    }
  },
  findUserExistingRoom: findUserExistingRoomGlobal,
  economyHooks,
  recordOxStats: ({ currentAlive, survivors, winnerNickname, finalChampionNickname, correctAns, activeQId }) => {
    let changed = false;
    (currentAlive || []).forEach((p) => {
      const u = findUserByNickname(p.nickname);
      if (!u) return;
      ensureUserStatsStructure(u);
      u.game_data.stats.ox.totalAnswered = (u.game_data.stats.ox.totalAnswered || 0) + 1;
      if (p.choice === correctAns && Number(p.questionId) === Number(activeQId)) {
        u.game_data.stats.ox.correctCount = (u.game_data.stats.ox.correctCount || 0) + 1;
      }
      changed = true;
    });
    const winName = finalChampionNickname || winnerNickname;
    if (winName) {
      const winUser = findUserByNickname(winName);
      if (winUser) {
        ensureUserStatsStructure(winUser);
        winUser.game_data.stats.ox.firstPlaceWins = (winUser.game_data.stats.ox.firstPlaceWins || 0) + 1;
        recordDailyActivity(winName, { mainWin: 1 });
        changed = true;
      }
    }
    if (changed) saveUsersDB(usersDB);
  }
});

// 실시간 온라인 유저 추적 (하트비트 45초 TTL)
const onlineUsersMap = new Map();
function getOnlineUsersList() {
  const now = Date.now();
  const list = [];
  for (const [code, info] of onlineUsersMap.entries()) {
    if (now - info.lastSeenAt > 45000) {
      onlineUsersMap.delete(code);
    } else {
      list.push(info);
    }
  }
  return list.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

function broadcastOnlinePresence() {
  try {
    const list = getOnlineUsersList();
    if (typeof io !== 'undefined' && io) {
      io.emit('online_presence_updated', { count: list.length, onlineUsers: list });
    }
  } catch (_) {}
}

app.post('/api/auth/heartbeat', (req, res) => {
  const { save_code, clientId, nickname, page } = req.body || {};
  const cleanCode = String(save_code || '').trim().toUpperCase();
  const key = cleanCode.length === 8 ? cleanCode : (clientId ? 'CID_' + String(clientId).trim().slice(0, 32) : '');
  let changed = false;
  if (key) {
    const nextNick = String(nickname || '방문자').trim().slice(0, 16);
    const nextPage = String(page || '로비').trim().slice(0, 24);
    const prev = onlineUsersMap.get(key);
    if (!prev || prev.nickname !== nextNick || prev.page !== nextPage) changed = true;
    onlineUsersMap.set(key, {
      save_code: cleanCode.length === 8 ? cleanCode : key,
      nickname: nextNick,
      page: nextPage,
      lastSeenAt: Date.now()
    });
  }
  const list = getOnlineUsersList();
  if (changed) broadcastOnlinePresence();
  return res.json({ ok: true, count: list.length });
});

app.post('/api/auth/offline', (req, res) => {
  const { save_code, clientId } = req.body || {};
  const cleanCode = String(save_code || '').trim().toUpperCase();
  let removed = false;
  if (cleanCode && onlineUsersMap.delete(cleanCode)) removed = true;
  if (clientId && onlineUsersMap.delete('CID_' + String(clientId).trim().slice(0, 32))) removed = true;
  if (removed) broadcastOnlinePresence();
  return res.json({ ok: true });
});

app.get('/api/online-count', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const list = getOnlineUsersList();
  return res.json({ ok: true, count: list.length });
});

// 전역 서버 관리자 전용 API (인게임 기능 제외, 순수 전역 서버 설정/방 모니터링)
app.get('/api/admin/overview', (req, res) => {
  if (!isAdminAuthorized(req)) return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
  updateRoomCounts();
  const onlineUsers = getOnlineUsersList();
  const onlineByCode = new Map(onlineUsers.map((o) => [o.save_code, o]));
  return res.json({
    settings: globalServerSettings,
    marbleRooms: getMarbleRoomsSummary(),
    oxRooms: getOxRoomsSummary(),
    minigameRooms: minigameHooks.getMinigameRoomsSummary(),
    horseRooms: horseHooks.getHorseRoomsSummary(),
    blackjackRooms: blackjackHooks.getBlackjackRoomsSummary(),
    oxBankStats: getOxBankStats(),
    shopCatalog: getEffectiveShopCatalog(),
    customTitleRequests: customTitleRequests.slice(0, 50),
    onlineUsers,
    totalUsers: usersDB.length,
    users: usersDB.map((u) => {
      const onlineInfo = onlineByCode.get(String(u.save_code || '').toUpperCase());
      ensureUserStatsStructure(u);
      return {
        id: u.id,
        nickname: u.nickname,
        save_code: u.save_code,
        gold: u.gold,
        isAdult: Boolean(u.isAdult),
        isAdmin: isUserAdmin(u),
        updated_at: u.updated_at,
        game_data: u.game_data,
        isOnline: Boolean(onlineInfo),
        onlinePage: onlineInfo ? onlineInfo.page : null
      };
    })
  });
});

app.post('/api/admin/megaphone', (req, res) => {
  if (!isAdminAuthorized(req)) return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
  const msg = String(req.body?.message || '').trim();
  if (!msg || msg.length > 120) {
    return res.status(400).json({ ok: false, error: '확성기 메시지는 1~120자 사이로 입력해주세요.' });
  }
  const payload = {
    id: 'mega_' + Date.now(),
    type: 'megaphone',
    text: `📣 [전체 확성기] ${msg}`,
    at: Date.now()
  };
  io.emit('global_announcement', payload);
  return res.json({ ok: true, announcement: payload, message: '📣 전체 확성기 공지를 발송했습니다!' });
});

app.post('/api/admin/custom-title/review', (req, res) => {
  if (!isAdminAuthorized(req)) return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
  const { requestId, action } = req.body || {};
  const targetReq = customTitleRequests.find((r) => r.id === requestId && r.status === 'PENDING');
  if (!targetReq) return res.status(404).json({ ok: false, error: '대기 중인 칭호 신청을 찾을 수 없습니다.' });

  const user = usersDB.find((u) => u.id === targetReq.userId || String(u.save_code || '').toUpperCase() === String(targetReq.save_code || '').toUpperCase());
  if (action === 'approve') {
    targetReq.status = 'APPROVED';
    targetReq.reviewedAt = new Date().toISOString();
    if (user) {
      ensureUserStatsStructure(user);
      if (!user.game_data.cosmetics.customTitles.some((x) => x.id === targetReq.id)) {
        user.game_data.cosmetics.customTitles.push({
          id: targetReq.id,
          name: targetReq.formattedValue,
          value: targetReq.formattedValue
        });
      }
      if (!user.game_data.cosmetics.ownedTitles.includes(targetReq.id)) {
        user.game_data.cosmetics.ownedTitles.push(targetReq.id);
      }
      user.updated_at = new Date().toISOString();
      saveUsersDB(usersDB);
      pushUserNotification(user, {
        type: 'custom_title',
        icon: '✨',
        title: '커스텀 칭호 승인',
        message: `신청하신 커스텀 칭호 ${targetReq.formattedValue}이(가) 승인되었습니다! 내 창고에서 장착할 수 있어요.`
      }, true);
      io.emit('gold_updated', { nickname: user.nickname, gold: user.gold, reason: 'custom_title_approved' });
    }
    saveCustomTitleRequests(customTitleRequests);
    return res.json({ ok: true, request: targetReq, message: `✅ '${targetReq.nickname}'님의 칭호 ${targetReq.formattedValue} 승인 완료!` });
  } else {
    targetReq.status = 'REJECTED';
    targetReq.reviewedAt = new Date().toISOString();
    if (user) {
      addUserGold(user.nickname, targetReq.price || 0, 'custom_title_refund');
      pushUserNotification(user, {
        type: 'custom_title',
        icon: '↩️',
        title: '커스텀 칭호 거절·환불',
        message: `신청하신 커스텀 칭호(${targetReq.formattedValue})가 거절되어 ${Number(targetReq.price || 0).toLocaleString()} 스타가 환불되었습니다.`
      }, true);
    }
    saveCustomTitleRequests(customTitleRequests);
    return res.json({ ok: true, request: targetReq, message: `❌ '${targetReq.nickname}'님의 칭호 신청을 거절하고 ${Number(targetReq.price || 0).toLocaleString()} 스타를 환불했습니다.` });
  }
});

app.post('/api/admin/delete-user', (req, res) => {
  if (!isAdminAuthorized(req)) return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
  const { userId, save_code } = req.body || {};
  const before = usersDB.length;
  usersDB = usersDB.filter((u) => !(
    (userId && u.id === userId) ||
    (save_code && u.save_code.toUpperCase() === String(save_code).toUpperCase())
  ));
  if (usersDB.length !== before) {
    saveUsersDB(usersDB);
  }
  return res.json({ ok: true, deleted: before - usersDB.length, totalUsers: usersDB.length });
});

app.post('/api/admin/update-user', (req, res) => {
  if (!isAdminAuthorized(req)) return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
  const { userId, nickname, save_code, gold, isAdult, isAdmin, stats, equippedTitle, equippedColor, equippedMarbleSkin } = req.body || {};
  const target = usersDB.find((u) => u.id === userId);
  if (!target) return res.status(404).json({ error: '수정할 계정을 찾을 수 없습니다.' });
  ensureUserStatsStructure(target);

  const oldName = target.nickname;
  if (typeof nickname === 'string' && nickname.trim()) {
    const cleanNick = nickname.trim().slice(0, 16);
    const dupNick = usersDB.some((u) => u.id !== target.id && u.nickname.toLowerCase() === cleanNick.toLowerCase());
    if (dupNick) return res.status(409).json({ error: '이미 다른 계정이 사용 중인 닉네임입니다.' });
    target.nickname = cleanNick;
  }

  if (typeof save_code === 'string' && save_code.trim()) {
    const cleanCode = save_code.trim().toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(cleanCode)) {
      return res.status(400).json({ error: '연동번호(세이브 코드)는 영문/숫자 8자리여야 합니다.' });
    }
    const dupCode = usersDB.some((u) => u.id !== target.id && String(u.save_code || '').toUpperCase() === cleanCode);
    if (dupCode) return res.status(409).json({ error: '이미 다른 계정이 사용 중인 연동번호입니다.' });
    target.save_code = cleanCode;
  }

  if (typeof gold !== 'undefined' && !Number.isNaN(Number(gold))) {
    target.gold = Math.max(0, Math.floor(Number(gold)));
  }
  if (typeof isAdult === 'boolean') {
    target.isAdult = isAdult;
  }
  if (typeof isAdmin === 'boolean') {
    target.isAdmin = String(target.nickname || '').trim() === '랜선판다' ? true : isAdmin;
  } else {
    target.isAdmin = isUserAdmin(target);
  }

  if (stats && typeof stats === 'object') {
    const st = target.game_data.stats;
    if (stats.marble) {
      st.marble.plays = Math.max(0, Math.floor(Number(stats.marble.plays ?? st.marble.plays) || 0));
      st.marble.firstPlaceWins = Math.max(0, Math.floor(Number(stats.marble.firstPlaceWins ?? st.marble.firstPlaceWins) || 0));
    }
    if (stats.ox) {
      st.ox.firstPlaceWins = Math.max(0, Math.floor(Number(stats.ox.firstPlaceWins ?? st.ox.firstPlaceWins) || 0));
      st.ox.correctCount = Math.max(0, Math.floor(Number(stats.ox.correctCount ?? st.ox.correctCount) || 0));
    }
    if (stats.minigames) {
      st.minigames.plays = Math.max(0, Math.floor(Number(stats.minigames.plays ?? st.minigames.plays) || 0));
      st.minigames.wins = Math.max(0, Math.floor(Number(stats.minigames.wins ?? st.minigames.wins) || 0));
    }
    if (stats.horse) {
      st.horse.plays = Math.max(0, Math.floor(Number(stats.horse.plays ?? st.horse.plays) || 0));
      st.horse.wins = Math.max(0, Math.floor(Number(stats.horse.wins ?? st.horse.wins) || 0));
    }
    if (stats.blackjack) {
      st.blackjack.plays = Math.max(0, Math.floor(Number(stats.blackjack.plays ?? st.blackjack.plays) || 0));
      st.blackjack.wins = Math.max(0, Math.floor(Number(stats.blackjack.wins ?? st.blackjack.wins) || 0));
    }
  }

  if (typeof equippedTitle === 'string') target.game_data.cosmetics.equippedTitle = equippedTitle;
  if (typeof equippedColor === 'string') target.game_data.cosmetics.equippedColor = equippedColor;
  if (typeof equippedMarbleSkin === 'string') target.game_data.cosmetics.equippedMarbleSkin = equippedMarbleSkin;

  target.updated_at = new Date().toISOString();
  saveUsersDB(usersDB);

  // 닉네임이나 치장이 바뀌었으면 마블 참가자 목록에도 즉시 반영
  const touchedRooms = new Set();
  participants.forEach((p) => {
    if (p.name.toLowerCase() === oldName.toLowerCase() || p.name.toLowerCase() === target.nickname.toLowerCase()) {
      p.name = target.nickname;
      p.cosmetics = getUserCosmetics(target.nickname);
      if (p.cosmetics.color) p.color = p.cosmetics.color;
      if (p.roomId) touchedRooms.add(p.roomId);
    }
  });
  touchedRooms.forEach((rid) => emitRoomParticipants(rid));
  io.emit('gold_updated', { nickname: target.nickname, gold: target.gold, reason: 'admin_edit' });

  return res.json({ ok: true, user: target });
});

app.get('/api/marble/custom-maps', (req, res) => {
  return res.json({ ok: true, maps: customMapsDB });
});

function handleSaveCustomMap(req, res) {
  const { adminPassword, clientId, nickname, id, name, mapLength, pegs, spinners, sliders, walls } = req.body || {};
  const isAdmin = isAdminAuthorized(req);
  const cleanName = String(name || '').trim().slice(0, 28);
  if (!cleanName) {
    return res.status(400).json({ error: '맵 이름을 입력해주세요.' });
  }
  const sanitizeList = (arr, maxLen) => (Array.isArray(arr) ? arr.slice(0, maxLen) : []);
  let mapId = (id && String(id).startsWith('custom_')) ? String(id) : `custom_${Date.now()}`;
  const existingIdx = customMapsDB.findIndex((m) => m.id === mapId);
  const existing = existingIdx >= 0 ? customMapsDB[existingIdx] : null;
  if (existing && !isAdmin && existing.creatorClientId && existing.creatorClientId !== clientId) {
    mapId = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
  }
  const cleanNick = String(nickname || (isAdmin ? '관리자' : '유저')).trim().slice(0, 16);
  const mapObj = {
    id: mapId,
    name: cleanName,
    creatorClientId: existing && existing.creatorClientId && mapId === existing.id ? existing.creatorClientId : (clientId || null),
    creatorNickname: existing && existing.creatorNickname && mapId === existing.id ? existing.creatorNickname : cleanNick,
    mapLength: Math.max(2000, Math.min(12000, Number(mapLength) || 5400)),
    pegs: sanitizeList(pegs, 400).map((p) => ({
      x: Number(p.x) || 500,
      y: Number(p.y) || 500,
      r: Math.max(6, Math.min(36, Number(p.r) || 10)),
      type: p.type === 'bumper' ? 'bumper' : 'peg',
      color: String(p.color || (p.type === 'bumper' ? '#f43f5e' : '#38bdf8'))
    })),
    spinners: sanitizeList(spinners, 40).map((sp) => ({
      x: Number(sp.x) || 500,
      y: Number(sp.y) || 800,
      length: Math.max(50, Math.min(220, Number(sp.length) || 115)),
      angle: Number(sp.angle) || 0,
      speed: Number(sp.speed) || 0.032,
      blades: Math.max(2, Math.min(6, Number(sp.blades) || 4)),
      color: String(sp.color || '#facc15')
    })),
    sliders: sanitizeList(sliders, 40).map((sl) => ({
      x: Number(sl.x) || 500,
      y: Number(sl.y) || 1000,
      width: Math.max(60, Math.min(260, Number(sl.width) || 130)),
      height: Math.max(12, Math.min(36, Number(sl.height) || 18)),
      minX: Math.max(80, Number(sl.minX) || 160),
      maxX: Math.min(920, Number(sl.maxX) || 840),
      vx: Number(sl.vx) || 3.0,
      color: String(sl.color || '#a855f7')
    })),
    walls: sanitizeList(walls, 120).map((w) => ({
      x1: Number(w.x1) || 200,
      y1: Number(w.y1) || 600,
      x2: Number(w.x2) || 400,
      y2: Number(w.y2) || 700,
      thickness: Math.max(6, Math.min(24, Number(w.thickness) || 10)),
      color: String(w.color || '#0ea5e9')
    })),
    updatedAt: new Date().toISOString()
  };

  const finalIdx = customMapsDB.findIndex((m) => m.id === mapId);
  if (finalIdx >= 0) customMapsDB[finalIdx] = mapObj;
  else customMapsDB.unshift(mapObj);
  saveCustomMapsDB(customMapsDB);
  io.emit('custom_maps_updated', customMapsDB);
  return res.json({ ok: true, map: mapObj, maps: customMapsDB });
}

function handleDeleteCustomMap(req, res) {
  const { adminPassword, clientId, id } = req.body || {};
  const isAdmin = isAdminAuthorized(req);
  const target = customMapsDB.find((m) => m.id === id);
  if (!target) return res.status(404).json({ error: '맵을 찾을 수 없습니다.' });
  if (!isAdmin && (!target.creatorClientId || target.creatorClientId !== clientId)) {
    return res.status(403).json({ error: '본인이 만든 맵만 삭제할 수 있습니다.' });
  }
  customMapsDB = customMapsDB.filter((m) => m.id !== id);
  saveCustomMapsDB(customMapsDB);
  rooms.forEach((rm) => {
    if (rm.mapId === id) rm.mapId = 'pinball_chaos';
  });
  io.emit('custom_maps_updated', customMapsDB);
  io.emit('rooms_updated', getMarbleRoomsSummary());
  return res.json({ ok: true, maps: customMapsDB });
}

app.post('/api/marble/custom-maps', handleSaveCustomMap);
app.post('/api/marble/custom-maps/delete', handleDeleteCustomMap);
app.post('/api/admin/custom-maps', handleSaveCustomMap);
app.post('/api/admin/custom-maps/delete', handleDeleteCustomMap);

app.get('/api/admin/economy-analytics', (req, res) => {
  if (!isAdminAuthorized(req)) return res.status(403).json({ ok: false, error: '관리자 권한이 필요합니다.' });
  const today = getTodayKstString();
  const golds = [];
  let totalGold = 0;
  // 강화 단계별 기대 제작비 기준 낚싯대 추정 자산가치 (0강 5만, 7강 상점가 1,060만 기준)
  const ROD_EST_VALUE = [50000, 160000, 580000, 1180000, 2150000, 3650000, 6100000, 10600000, 17500000, 28000000, 45000000, 75000000];
  let totalRods = 0;
  let totalAwakenedRods = 0;
  let totalRodAssetValue = 0;
  let highRodCount = 0;
  let totalProtectTickets = 0;
  let totalChests = 0;
  let totalLottery = 0;
  let totalExtraBait = 0;
  const rodDist = {};
  for (let lv = 0; lv <= 11; lv++) rodDist[lv] = 0;

  const userSummaries = [];
  for (const u of usersDB) {
    if (!u) continue;
    const g = Math.max(0, Math.floor(Number(u.gold) || 0));
    golds.push(g);
    totalGold += g;
    const f = u.game_data?.fishing || {};
    const rods = Array.isArray(f.rods) ? f.rods : [];
    let maxRodLv = -1;
    let maxAw = 0;
    for (const r of rods) {
      totalRods++;
      const lv = Math.max(0, Math.min(11, Math.floor(Number(r.level) || 0)));
      rodDist[lv] = (rodDist[lv] || 0) + 1;
      if (lv > maxRodLv) maxRodLv = lv;
      const aw = Math.max(0, Math.floor(Number(r.awakening) || 0));
      if (aw > 0) totalAwakenedRods++;
      if (aw > maxAw) maxAw = aw;
      if (lv >= 9) highRodCount++;
      totalRodAssetValue += (ROD_EST_VALUE[lv] || 50000) + aw * 3000000;
    }
    const counts = u.game_data?.cosmetics?.itemCounts || {};
    totalProtectTickets += Math.max(0, Math.floor(Number(counts.rod_protect_ticket) || 0));
    totalChests += Math.max(0, Math.floor(Number(f.treasureChests) || 0));
    totalLottery += Math.max(0, Math.floor(Number(f.lotteryTickets) || 0));
    totalExtraBait += Math.max(0, Math.floor(Number(f.extraBait) || 0));
    userSummaries.push({
      nickname: u.nickname,
      gold: g,
      maxRodLv,
      maxAw,
      rodCount: rods.length,
      fishingEarned: Math.max(0, Math.floor(Number(f.totalGoldEarned) || 0))
    });
  }

  golds.sort((a, b) => a - b);
  const userCount = golds.length;
  const avgGold = userCount > 0 ? Math.round(totalGold / userCount) : 0;
  const medianGold = userCount > 0
    ? (userCount % 2 === 1 ? golds[Math.floor(userCount / 2)] : Math.round((golds[userCount / 2 - 1] + golds[userCount / 2]) / 2))
    : 0;

  userSummaries.sort((a, b) => b.gold - a.gold);
  const top10Count = Math.max(1, Math.ceil(userCount * 0.1));
  const top10Gold = userSummaries.slice(0, top10Count).reduce((acc, x) => acc + x.gold, 0);
  const top10SharePct = totalGold > 0 ? +((top10Gold / totalGold) * 100).toFixed(1) : 0;

  const topRich = userSummaries.slice(0, 10).map((u, idx) => ({
    rank: idx + 1,
    ...u,
    sharePct: totalGold > 0 ? +((u.gold / totalGold) * 100).toFixed(1) : 0
  }));

  const marketCount = Array.isArray(marketListings) ? marketListings.length : 0;
  const marketValue = Array.isArray(marketListings)
    ? marketListings.reduce((acc, m) => acc + Math.max(0, Math.floor(Number(m.price) || 0)), 0)
    : 0;

  function buildFlowSummary(bucket) {
    const src = bucket || {};
    const inflows = [];
    const outflows = [];
    let inTotal = 0;
    let outTotal = 0;
    for (const [key, meta] of Object.entries(FLOW_LABELS)) {
      const amt = Math.max(0, Math.floor(Number(src[key]) || 0));
      if (meta.dir === 'in') {
        inTotal += amt;
        inflows.push({ key, label: meta.label, amount: amt });
      } else {
        outTotal += amt;
        outflows.push({ key, label: meta.label, amount: amt });
      }
    }
    inflows.sort((a, b) => b.amount - a.amount);
    outflows.sort((a, b) => b.amount - a.amount);
    const sinkRatioPct = inTotal > 0 ? +((outTotal / inTotal) * 100).toFixed(1) : (outTotal > 0 ? 100 : 0);
    return { inTotal, outTotal, netFlow: inTotal - outTotal, sinkRatioPct, inflows, outflows };
  }

  const todayFlow = buildFlowSummary(economyLedger.byDate[today]);
  const totalFlow = buildFlowSummary(economyLedger.total);

  // 최근 7일 추이
  const dailyTrend = [];
  for (let dOff = 6; dOff >= 0; dOff--) {
    const dtStr = new Date(Date.now() + 9 * 3600 * 1000 - dOff * 86400 * 1000).toISOString().slice(0, 10);
    const b = buildFlowSummary(economyLedger.byDate[dtStr]);
    dailyTrend.push({ date: dtStr, inTotal: b.inTotal, outTotal: b.outTotal, netFlow: b.netFlow, sinkRatioPct: b.sinkRatioPct });
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.json({
    ok: true,
    today,
    snapshot: {
      userCount,
      totalGold,
      avgGold,
      medianGold,
      top10SharePct,
      totalRods,
      totalAwakenedRods,
      highRodCount,
      totalRodAssetValue,
      totalCombinedWealth: totalGold + totalRodAssetValue,
      rodAssetSharePct: (totalGold + totalRodAssetValue) > 0
        ? Math.round((totalRodAssetValue / (totalGold + totalRodAssetValue)) * 1000) / 10
        : 0,
      totalProtectTickets,
      totalChests,
      totalLottery,
      totalExtraBait,
      marketCount,
      marketValue,
      rodDist
    },
    todayFlow,
    totalFlow,
    dailyTrend,
    topRich
  });
});

app.post('/api/admin/settings', (req, res) => {
  if (!isAdminAuthorized(req)) return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
  const { idleRoomTimeoutMinutes, enforceOneRoomPerAccount, enforceNoDupName, fishingBaitLimitEnabled, fishingDailyBaitLimit, fishingMaxDailyBaitBuy, fishingBaitPrice, shopPriceOverrides } = req.body || {};
  if (typeof idleRoomTimeoutMinutes !== 'undefined') {
    const mins = Math.max(1, Math.min(180, Number(idleRoomTimeoutMinutes) || 15));
    globalServerSettings.idleRoomTimeoutMinutes = mins;
    setOxIdleTimeoutMinutes(mins);
  }
  if (typeof enforceOneRoomPerAccount === 'boolean') {
    globalServerSettings.enforceOneRoomPerAccount = enforceOneRoomPerAccount;
  }
  if (typeof enforceNoDupName === 'boolean') {
    globalServerSettings.enforceNoDupName = enforceNoDupName;
  }
  if (Array.isArray(req.body?.disabledGames)) {
    globalServerSettings.disabledGames = req.body.disabledGames.map((x) => String(x || '').trim()).filter(Boolean);
  }
  if (typeof fishingBaitLimitEnabled === 'boolean') {
    globalServerSettings.fishingBaitLimitEnabled = fishingBaitLimitEnabled;
  }
  if (typeof fishingDailyBaitLimit !== 'undefined' && !Number.isNaN(Number(fishingDailyBaitLimit))) {
    globalServerSettings.fishingDailyBaitLimit = Math.max(1, Math.min(10000, Math.floor(Number(fishingDailyBaitLimit))));
  }
  if (typeof fishingMaxDailyBaitBuy !== 'undefined' && !Number.isNaN(Number(fishingMaxDailyBaitBuy))) {
    globalServerSettings.fishingMaxDailyBaitBuy = Math.max(1, Math.min(10000, Math.floor(Number(fishingMaxDailyBaitBuy))));
  }
  if (typeof fishingBaitPrice !== 'undefined' && !Number.isNaN(Number(fishingBaitPrice)) && Number(fishingBaitPrice) >= 0) {
    globalServerSettings.fishingBaitPrice = Math.min(10000000, Math.floor(Number(fishingBaitPrice)));
  }
  if (typeof req.body?.marbleMapLength !== 'undefined' && [3600, 5400, 7500].includes(Number(req.body.marbleMapLength))) {
    globalServerSettings.marbleMapLength = Number(req.body.marbleMapLength);
  }
  if (typeof req.body?.marbleGameSpeed !== 'undefined' && !Number.isNaN(Number(req.body.marbleGameSpeed))) {
    globalServerSettings.marbleGameSpeed = Math.max(0.5, Math.min(2.6, Number(req.body.marbleGameSpeed)));
  }
  if (typeof req.body?.marbleGravity !== 'undefined' && !Number.isNaN(Number(req.body.marbleGravity))) {
    globalServerSettings.marbleGravity = Math.max(0.3, Math.min(1.5, Number(req.body.marbleGravity)));
  }
  if (typeof req.body?.marbleBounce !== 'undefined' && !Number.isNaN(Number(req.body.marbleBounce))) {
    globalServerSettings.marbleBounce = Math.max(0.35, Math.min(0.95, Number(req.body.marbleBounce)));
  }
  if (typeof req.body?.marbleCameraZoom !== 'undefined' && !Number.isNaN(Number(req.body.marbleCameraZoom))) {
    globalServerSettings.marbleCameraZoom = Math.max(0.75, Math.min(1.35, Number(req.body.marbleCameraZoom)));
  }
  if (typeof req.body?.marbleStrictOnePerDevice === 'boolean') {
    globalServerSettings.marbleStrictOnePerDevice = req.body.marbleStrictOnePerDevice;
  }
  if (typeof req.body?.marbleSlowMoEnabled === 'boolean') {
    globalServerSettings.marbleSlowMoEnabled = req.body.marbleSlowMoEnabled;
  }
  if (shopPriceOverrides && typeof shopPriceOverrides === 'object') {
    const nextOv = { ...(globalServerSettings.shopPriceOverrides || {}) };
    Object.keys(shopPriceOverrides).forEach((k) => {
      const v = shopPriceOverrides[k];
      if (v === null || v === '') delete nextOv[k];
      else if (!Number.isNaN(Number(v)) && Number(v) >= 0) nextOv[k] = Math.floor(Number(v));
    });
    globalServerSettings.shopPriceOverrides = nextOv;
  }
  saveGlobalServerSettings(globalServerSettings);
  broadcastGamesSummary();
  io.emit('fishing_settings_updated', {
    limitEnabled: globalServerSettings.fishingBaitLimitEnabled !== false,
    dailyLimit: Math.max(1, Math.floor(Number(globalServerSettings.fishingDailyBaitLimit) || 100)),
    maxDailyBaitBuy: Math.max(1, Math.floor(Number(globalServerSettings.fishingMaxDailyBaitBuy) || 100)),
    baitPrice: (typeof globalServerSettings.fishingBaitPrice === 'number' && !Number.isNaN(globalServerSettings.fishingBaitPrice) && globalServerSettings.fishingBaitPrice >= 0)
      ? Math.floor(globalServerSettings.fishingBaitPrice)
      : 10000
  });
  return res.json({ ok: true, settings: globalServerSettings });
});

app.post('/api/admin/delete-room', (req, res) => {
  if (!isAdminAuthorized(req)) return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
  const { gameType, roomId } = req.body || {};
  if (gameType === 'marble' && roomId) {
    const targetRm = rooms.find((r) => r.id === roomId);
    const title = targetRm ? targetRm.title : '해당';
    rooms = rooms.filter((r) => r.id !== roomId);
    participants = participants.filter((p) => p.roomId !== roomId);
    pushDeletedMarbleRoom({
      roomId,
      title,
      reason: '전역 관리자가 방을 삭제했습니다.',
      deletedAt: Date.now()
    });
    if (deletedMarbleRooms.length > 50) deletedMarbleRooms = deletedMarbleRooms.slice(-50);
    updateRoomCounts();
    io.emit('room_deleted', { roomId, title });
    io.emit('participants_updated', participants);
    io.emit('rooms_updated', getMarbleRoomsSummary());
  } else if (gameType === 'ox' && roomId) {
    deleteOxRoomByCode(roomId, '전역 관리자가 방을 삭제했습니다.');
  } else if (gameType === 'minigame' && roomId) {
    minigameHooks.deleteMinigameRoomById(roomId);
  } else if (gameType === 'horse' && roomId) {
    horseHooks.deleteHorseRoomById(roomId);
  } else if (gameType === 'blackjack' && roomId) {
    blackjackHooks.deleteBlackjackRoomById(roomId);
  }
  return res.json({
    ok: true,
    marbleRooms: rooms,
    oxRooms: getOxRoomsSummary()
  });
});

// 내 생성 방 목록 조회 및 본인 방 삭제 API
function isSameRoomOwner(r, cid, nick) {
  if (cid && r.hostClientId && r.hostClientId === cid) return true;
  if (nick && r.hostNickname && String(r.hostNickname).trim().toLowerCase() === String(nick).trim().toLowerCase()) return true;
  return false;
}

function getUserCreatedRooms(cid, nick) {
  if (!cid && !nick) return [];
  const list = [];
  (getMarbleRoomsSummary() || []).forEach((r) => {
    if (isSameRoomOwner(r, cid, nick)) {
      list.push({ gameType: 'marble', gameLabel: '마블 드롭 서바이벌', icon: '🔮', path: '/games/marble/', roomId: r.id, title: r.title, count: r.count || 0 });
    }
  });
  (getOxRoomsSummary() || []).forEach((r) => {
    if (isSameRoomOwner(r, cid, nick)) {
      list.push({ gameType: 'ox', gameLabel: 'OX 서바이벌 퀴즈', icon: '⭕', path: '/games/ox-quiz/', roomId: r.roomCode || r.code, title: r.title, count: r.participantCount || r.count || 0 });
    }
  });
  if (typeof horseHooks !== 'undefined' && horseHooks?.getHorseRoomsSummary) {
    (horseHooks.getHorseRoomsSummary() || []).forEach((r) => {
      if (isSameRoomOwner(r, cid, nick)) {
        list.push({ gameType: 'horse', gameLabel: '로얄 경마', icon: '🏇', path: '/games/horse-racing/', roomId: r.id, title: r.title, count: r.count || 0 });
      }
    });
  }
  if (typeof blackjackHooks !== 'undefined' && blackjackHooks?.getBlackjackRoomsSummary) {
    (blackjackHooks.getBlackjackRoomsSummary() || []).forEach((r) => {
      if (isSameRoomOwner(r, cid, nick)) {
        list.push({ gameType: 'blackjack', gameLabel: '로얄 블랙잭', icon: '🃏', path: '/games/blackjack/', roomId: r.id, title: r.title, count: r.count || 0 });
      }
    });
  }
  const mgMeta = {
    'black-white': { label: '흑과 백', icon: '🎭', path: '/games/black-white/' },
    'russian-roulette': { label: '러시안 룰렛', icon: '🔫', path: '/games/russian-roulette/' },
    'dice-21': { label: '다이스 21', icon: '🎲', path: '/games/dice-21/' }
  };
  if (typeof minigameHooks !== 'undefined' && minigameHooks?.getMinigameRoomsSummary) {
    (minigameHooks.getMinigameRoomsSummary() || []).forEach((r) => {
      if (isSameRoomOwner(r, cid, nick)) {
        const m = mgMeta[r.gameType] || { label: '미니게임', icon: '🕹️', path: '/' };
        list.push({ gameType: 'minigame', subType: r.gameType, gameLabel: m.label, icon: m.icon, path: m.path, roomId: r.id, title: r.title, count: r.count || 0 });
      }
    });
  }
  return list;
}

function findUserExistingRoomGlobal(cid, nick, targetGame = null, targetRoomId = null) {
  if (!globalServerSettings.enforceOneRoomPerAccount || (!cid && !nick)) return null;
  const created = getUserCreatedRooms(cid, nick).filter((r) => !(targetGame && r.gameType === targetGame && String(r.roomId) === String(targetRoomId)));
  if (created.length > 0) return { ...created[0], role: 'host' };
  const joined = getUserJoinedRooms(cid, nick).filter((r) => !(targetGame && r.gameType === targetGame && String(r.roomId) === String(targetRoomId)));
  if (joined.length > 0) return { ...joined[0], role: 'player' };
  return null;
}

function getUserJoinedRooms(cid, nick) {
  if (!cid && !nick) return [];
  const list = [];
  const nLow = String(nick || '').trim().toLowerCase();
  const seen = new Set();
  getUserCreatedRooms(cid, nick).forEach((cr) => seen.add(`${cr.gameType}:${cr.roomId}`));

  participants.forEach((p) => {
    if ((cid && p.clientId === cid) || (nLow && p.name && p.name.toLowerCase() === nLow)) {
      const rm = getMarbleRoom(p.roomId);
      if (rm && !seen.has(`marble:${rm.id}`)) {
        seen.add(`marble:${rm.id}`);
        list.push({ gameType: 'marble', gameLabel: '마블 드롭 서바이벌', icon: '🔮', path: '/games/marble/', roomId: rm.id, title: rm.title, count: rm.count || 0 });
      }
    }
  });
  if (typeof getOxRoomsJoinedBy === 'function') {
    getOxRoomsJoinedBy(cid, nick).forEach((r) => {
      if (!seen.has(`ox:${r.roomCode}`)) {
        seen.add(`ox:${r.roomCode}`);
        list.push({ gameType: 'ox', gameLabel: 'OX 서바이벌 퀴즈', icon: '⭕', path: '/games/ox-quiz/', roomId: r.roomCode, title: r.title, count: r.count || 0 });
      }
    });
  }
  if (typeof horseHooks !== 'undefined' && horseHooks?.getHorseRoomsJoinedBy) {
    horseHooks.getHorseRoomsJoinedBy(cid, nick).forEach((r) => {
      if (!seen.has(`horse:${r.id}`)) {
        seen.add(`horse:${r.id}`);
        list.push({ gameType: 'horse', gameLabel: '로얄 경마', icon: '🏇', path: '/games/horse-racing/', roomId: r.id, title: r.title, count: r.count || 0 });
      }
    });
  }
  if (typeof blackjackHooks !== 'undefined' && blackjackHooks?.getBlackjackRoomsJoinedBy) {
    blackjackHooks.getBlackjackRoomsJoinedBy(cid, nick).forEach((r) => {
      if (!seen.has(`blackjack:${r.id}`)) {
        seen.add(`blackjack:${r.id}`);
        list.push({ gameType: 'blackjack', gameLabel: '로얄 블랙잭', icon: '🃏', path: '/games/blackjack/', roomId: r.id, title: r.title, count: r.count || 0 });
      }
    });
  }
  const mgMeta = {
    'black-white': { label: '흑과 백', icon: '🎭', path: '/games/black-white/' },
    'russian-roulette': { label: '러시안 룰렛', icon: '🔫', path: '/games/russian-roulette/' },
    'dice-21': { label: '다이스 21', icon: '🎲', path: '/games/dice-21/' }
  };
  if (typeof minigameHooks !== 'undefined' && minigameHooks?.getMinigameRoomsJoinedBy) {
    minigameHooks.getMinigameRoomsJoinedBy(cid, nick).forEach((r) => {
      if (!seen.has(`minigame:${r.id}`)) {
        seen.add(`minigame:${r.id}`);
        const m = mgMeta[r.gameType] || { label: '미니게임', icon: '🕹️', path: '/' };
        list.push({ gameType: 'minigame', subType: r.gameType, gameLabel: m.label, icon: m.icon, path: m.path, roomId: r.id, title: r.title, count: r.count || 0 });
      }
    });
  }
  return list;
}

function removeUserEverywhereUnified(clientId, nickname, exceptGame = null, exceptRoomId = null) {
  if (exceptGame !== 'marble') {
    const nLow = String(nickname || '').trim().toLowerCase();
    const before = participants.length;
    participants = participants.filter((p) => {
      return !((clientId && p.clientId === clientId) || (nLow && p.name && p.name.toLowerCase() === nLow));
    });
    if (participants.length !== before) {
      updateRoomCounts();
      io.emit('participants_updated', participants);
      io.emit('rooms_updated', getMarbleRoomsSummary());
    }
  }
  if (exceptGame !== 'ox') {
    try { removeParticipantFromAllOxRooms(clientId, nickname, null); } catch (_) {}
  }
  if (typeof minigameHooks !== 'undefined' && minigameHooks?.removeUserFromMinigames) {
    try { minigameHooks.removeUserFromMinigames(clientId, nickname, exceptGame === 'minigame' ? exceptRoomId : null); } catch (_) {}
  }
  if (typeof horseHooks !== 'undefined' && horseHooks?.removeUserFromHorse) {
    try { horseHooks.removeUserFromHorse(clientId, nickname, exceptGame === 'horse' ? exceptRoomId : null); } catch (_) {}
  }
  if (typeof blackjackHooks !== 'undefined' && blackjackHooks?.removeUserFromBlackjack) {
    try { blackjackHooks.removeUserFromBlackjack(clientId, nickname, exceptGame === 'blackjack' ? exceptRoomId : null); } catch (_) {}
  }
}

app.get('/api/user/my-rooms', (req, res) => {
  const cid = String(req.query.clientId || '').trim();
  const nick = String(req.query.nickname || '').trim();
  return res.json({
    rooms: getUserCreatedRooms(cid, nick),
    joinedRooms: getUserJoinedRooms(cid, nick)
  });
});

app.post('/api/user/leave-joined-room', (req, res) => {
  const { clientId, nickname, gameType, roomId } = req.body || {};
  const cid = String(clientId || '').trim();
  const nLow = String(nickname || '').trim().toLowerCase();
  if (!cid && !nLow) return res.status(400).json({ ok: false });

  if (gameType === 'marble') {
    const before = participants.length;
    participants = participants.filter((p) => !(p.roomId === roomId && ((cid && p.clientId === cid) || (nLow && p.name.toLowerCase() === nLow))));
    if (participants.length !== before) {
      updateRoomCounts();
      io.emit('participants_updated', participants);
      io.emit('rooms_updated', getMarbleRoomsSummary());
    }
    return res.json({ ok: true });
  }
  if (gameType === 'ox') {
    removeParticipantFromAllOxRooms(cid, nickname, null);
    return res.json({ ok: true });
  }
  if (gameType === 'minigame' && minigameHooks?.removeUserFromMinigames) {
    minigameHooks.removeUserFromMinigames(cid, nickname, null);
    return res.json({ ok: true });
  }
  if (gameType === 'horse' && horseHooks?.removeUserFromHorse) {
    horseHooks.removeUserFromHorse(cid, nickname, null);
    return res.json({ ok: true });
  }
  if (gameType === 'blackjack' && blackjackHooks?.removeUserFromBlackjack) {
    blackjackHooks.removeUserFromBlackjack(cid, nickname, null);
    return res.json({ ok: true });
  }
  return res.json({ ok: true });
});

app.post('/api/user/delete-my-room', (req, res) => {
  const { clientId, nickname, gameType, roomId } = req.body || {};
  const cid = String(clientId || '').trim();
  if (!cid || !gameType || !roomId) return res.status(400).json({ ok: false, error: '잘못된 요청입니다.' });

  if (gameType === 'marble') {
    const targetRm = rooms.find((r) => r.id === roomId && isSameRoomOwner(r, cid, nickname));
    if (!targetRm) return res.status(403).json({ ok: false, error: '본인이 만든 방만 삭제할 수 있습니다.' });
    const title = targetRm.title || '해당';
    rooms = rooms.filter((r) => r.id !== roomId);
    participants = participants.filter((p) => p.roomId !== roomId);
    pushDeletedMarbleRoom({ roomId, title, reason: '방장이 방을 삭제했습니다.', deletedAt: Date.now() });
    updateRoomCounts();
    io.emit('room_deleted', { roomId, title });
    io.emit('participants_updated', participants);
    io.emit('rooms_updated', getMarbleRoomsSummary());
    return res.json({ ok: true });
  }
  if (gameType === 'ox') {
    const targetOx = (getOxRoomsSummary() || []).find((r) => (r.roomCode || r.code) === roomId && isSameRoomOwner(r, cid, nickname));
    if (!targetOx) return res.status(403).json({ ok: false, error: '본인이 만든 방만 삭제할 수 있습니다.' });
    deleteOxRoomByCode(roomId, '방장이 방을 삭제했습니다.');
    return res.json({ ok: true });
  }
  if (gameType === 'minigame') {
    const targetMg = (minigameHooks.getMinigameRoomsSummary() || []).find((r) => r.id === roomId && isSameRoomOwner(r, cid, nickname));
    if (!targetMg) return res.status(403).json({ ok: false, error: '본인이 만든 방만 삭제할 수 있습니다.' });
    minigameHooks.deleteMinigameRoomById(roomId);
    return res.json({ ok: true });
  }
  if (gameType === 'horse') {
    const targetHr = (horseHooks.getHorseRoomsSummary() || []).find((r) => r.id === roomId && isSameRoomOwner(r, cid, nickname));
    if (!targetHr) return res.status(403).json({ ok: false, error: '본인이 만든 방만 삭제할 수 있습니다.' });
    horseHooks.deleteHorseRoomById(roomId);
    return res.json({ ok: true });
  }
  if (gameType === 'blackjack') {
    const targetBj = (blackjackHooks.getBlackjackRoomsSummary() || []).find((r) => r.id === roomId && isSameRoomOwner(r, cid, nickname));
    if (!targetBj) return res.status(403).json({ ok: false, error: '본인이 만든 방만 삭제할 수 있습니다.' });
    blackjackHooks.deleteBlackjackRoomById(roomId);
    return res.json({ ok: true });
  }
  return res.status(400).json({ ok: false, error: '지원하지 않는 게임 타입입니다.' });
});

// 30초마다 장시간 미사용 마블 방(게임 미시작 또는 방장 미접속 N분 이상) 자동 삭제
setInterval(() => {
  const now = Date.now();
  const timeoutMs = globalServerSettings.idleRoomTimeoutMinutes * 60 * 1000;
  const toDelete = rooms.filter((rm) => {
    const idleFromActivity = now - Number(rm.lastActivityAt || rm.createdAt || now);
    const idleFromHost = now - Number(rm.hostLastSeenAt || rm.createdAt || now);
    return idleFromActivity >= timeoutMs || idleFromHost >= timeoutMs;
  });
  if (toDelete.length > 0) {
    toDelete.forEach((rm) => {
      rooms = rooms.filter((r) => r.id !== rm.id);
      participants = participants.filter((p) => p.roomId !== rm.id);
      pushDeletedMarbleRoom({
        roomId: rm.id,
        title: rm.title,
        reason: `장시간 미사용(${globalServerSettings.idleRoomTimeoutMinutes}분 이상)으로 자동 삭제되었습니다.`,
        deletedAt: now
      });
      io.emit('room_deleted', { roomId: rm.id, title: rm.title });
    });
    if (deletedMarbleRooms.length > 50) deletedMarbleRooms = deletedMarbleRooms.slice(-50);
    updateRoomCounts();
    io.emit('participants_updated', participants);
    io.emit('rooms_updated', getMarbleRoomsSummary());
  }
}, 30000);

app.use('/games/:gameId', (req, res, next) => {
  const gid = String(req.params.gameId || '').trim();
  if ((globalServerSettings.disabledGames || []).includes(gid)) {
    return res.status(403).send(`<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>입장 제한</title><style>body{background:#070b14;color:#f8fafc;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:16px;text-align:center}.card{max-width:360px;background:#111625;border:1px solid #2b3861;border-radius:20px;padding:24px}a{display:inline-block;margin-top:16px;padding:10px 18px;border-radius:12px;background:#5851f6;color:#fff;text-decoration:none;font-weight:800;font-size:13px}</style></head><body><div class="card"><div style="font-size:36px">🔒</div><h2 style="margin:10px 0 6px;font-size:18px">현재 입장 제한 중입니다</h2><p style="font-size:13px;color:#94a3b8;margin:0">관리자에 의해 이 게임의 입장이 일시 중단되었습니다.</p><a href="/">🏠 메인 로비로 돌아가기</a></div></body></html>`);
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    }
  }
}));
app.get('/marble', (req, res) => res.redirect('/games/marble/'));
app.get('/ox-quiz', (req, res) => res.redirect('/games/ox-quiz/'));
app.get('/ox', (req, res) => res.redirect('/games/ox-quiz/'));

minigameHooks = setupMinigamesSocket(io, {
  usersDB,
  saveUsersDB,
  ensureUserStatsStructure,
  globalServerSettings,
  economyHooks,
  findUserExistingRoom: findUserExistingRoomGlobal,
  removeUserFromOtherGames: (cid, nick, exGame, exId) => removeUserEverywhereUnified(cid, nick, exGame, exId)
});
blackjackHooks = setupBlackjackSocket(io, {
  usersDB,
  saveUsersDB,
  globalServerSettings,
  economyHooks,
  findUserExistingRoom: findUserExistingRoomGlobal,
  removeUserFromOtherGames: (clientId, nickname, excludeRoomId) => {
    removeUserEverywhereUnified(clientId, nickname, 'blackjack', excludeRoomId);
  }
});

horseHooks = setupHorseRacingSocket(io, {
  usersDB,
  saveUsersDB,
  ensureUserStatsStructure,
  globalServerSettings,
  economyHooks,
  findUserExistingRoom: findUserExistingRoomGlobal,
  removeUserFromOtherGames: (cid, nick, exGame, exId) => removeUserEverywhereUnified(cid, nick, exGame, exId)
});

let adminConsoleHooks = null;
let fishingRaidHooks = null;

fishingHooks = setupFishingModule(app, io, {
  getHotTimeMultiplier: () => (adminConsoleHooks ? adminConsoleHooks.getHotTimeMultiplier() : 1),
  isUserChatMuted: (nick) => (adminConsoleHooks ? adminConsoleHooks.isUserChatMuted(nick) : null),
  broadcastGlobalAnnouncement: (payload) => {
    io.emit('global_announcement', { id: 'ann_' + Date.now(), at: Date.now(), ...payload });
  },
  usersDB,
  saveUsersDB,
  findUserByValidCode,
  findUserByNickname,
  ensureUserStatsStructure,
  economyHooks,
  getTodayKstString,
  onPlazaChange: broadcastGamesSummary,
  isAdminAuthorized,
  getFishingSettings: () => ({
    limitEnabled: globalServerSettings.fishingBaitLimitEnabled !== false,
    dailyLimit: Math.max(1, Math.floor(Number(globalServerSettings.fishingDailyBaitLimit) || 100)),
    maxDailyBaitBuy: Math.max(1, Math.floor(Number(globalServerSettings.fishingMaxDailyBaitBuy) || 100)),
    baitPrice: (typeof globalServerSettings.fishingBaitPrice === 'number' && !Number.isNaN(globalServerSettings.fishingBaitPrice) && globalServerSettings.fishingBaitPrice >= 0)
      ? Math.floor(globalServerSettings.fishingBaitPrice)
      : 10000
  })
});

fishingRaidHooks = setupFishingRaidModule(app, io, {
  usersDB,
  saveUsersDB,
  findUserByValidCode,
  findUserByNickname,
  ensureUserStatsStructure,
  economyHooks,
  getTodayKstString,
  onRoomsChange: broadcastGamesSummary
});

setupSocialModule(app, io, {
  usersDB,
  saveUsersDB,
  findUserByValidCode,
  findUserByNickname,
  ensureUserStatsStructure,
  getUserCosmetics,
  getOnlineUsersList,
  getEffectiveShopCatalog,
  addCosmeticItem,
  removeCosmeticItem,
  pushUserNotification,
  recordEconomyFlow,
  getTodayKstString,
  getServerRodDailyBaitLimit,
  isUserChatMuted: (nick) => (adminConsoleHooks ? adminConsoleHooks.isUserChatMuted(nick) : null),
  isTradeFrozen: () => (adminConsoleHooks ? adminConsoleHooks.isTradeFrozen() : false),
  pushAuditLog: (cat, txt) => { if (adminConsoleHooks) adminConsoleHooks.pushAuditLog(cat, txt); }
});

adminConsoleHooks = setupAdminConsoleModule(app, io, {
  usersDB,
  saveUsersDB,
  findUserByValidCode,
  findUserByNickname,
  ensureUserStatsStructure,
  isAdminAuthorized,
  addUserGold,
  pushUserNotification,
  recordEconomyFlow,
  getTodayKstString,
  getOnlineUsersList,
  getMarbleRoomsSummary,
  deleteMarbleRoomByQuery: (q) => {
    const low = String(q || '').trim().toLowerCase();
    const idx = rooms.findIndex((r) => String(r.id).toLowerCase() === low || String(r.title || '').toLowerCase().includes(low));
    if (idx === -1) return { ok: false, error: `'${q}' 마블 방을 찾을 수 없습니다.` };
    const rm = rooms[idx];
    rooms.splice(idx, 1);
    participants = participants.filter((p) => p.roomId !== rm.id);
    pushDeletedMarbleRoom({ id: rm.id, roomId: rm.id, title: rm.title, reason: '관리자 명령어 삭제', deletedAt: Date.now() });
    io.to(rm.id).emit('room_deleted', { roomId: rm.id, title: rm.title, reason: '관리자에 의해 방이 삭제되었습니다.' });
    updateRoomCounts();
    io.emit('rooms_updated', getMarbleRoomsSummary());
    return { ok: true, id: rm.id, title: rm.title };
  },
  kickUserFromMarbleRooms: (nick) => {
    const low = String(nick || '').trim().toLowerCase();
    const touched = new Set();
    let kicked = 0;
    participants = participants.filter((p) => {
      if (String(p.name || '').trim().toLowerCase() === low) {
        if (p.roomId) touched.add(p.roomId);
        kicked++;
        return false;
      }
      return true;
    });
    if (kicked > 0) {
      updateRoomCounts();
      touched.forEach((rid) => emitRoomParticipants(rid));
      io.emit('rooms_updated', getMarbleRoomsSummary());
    }
    return kicked;
  },
  getInquiriesList: () => (typeof inquiriesDB !== 'undefined' && Array.isArray(inquiriesDB) ? inquiriesDB : []),
  getEconomySummaryToday: () => {
    const today = getTodayKstString();
    const dayObj = (economyLedger && economyLedger.daily && economyLedger.daily[today]) ? economyLedger.daily[today] : null;
    const inflow = dayObj ? Object.values(dayObj.inflow || {}).reduce((a, b) => a + Number(b || 0), 0) : 0;
    const outflow = dayObj ? Object.values(dayObj.outflow || {}).reduce((a, b) => a + Number(b || 0), 0) : 0;
    const totalGold = usersDB.reduce((s, u) => s + Math.max(0, Number(u.gold || 0)), 0);
    return { inflow, outflow, net: inflow - outflow, totalGold };
  },
  getEffectiveShopCatalog,
  addCosmeticItem,
  removeCosmeticItem,
  getFishingHooks: () => fishingHooks,
  rootDir: __dirname
});

const marbleRoomChats = new Map();
const MAX_MARBLE_ROOM_CHAT = 60;

io.on('connection', (socket) => {
  try {
    if (adminConsoleHooks) socket.emit('admin_banner_state', adminConsoleHooks.getPublicBannerState());
  } catch (_) {}
  socket.on('register_user_room', ({ save_code } = {}, cb) => {
    const u = findUserByValidCode(save_code);
    if (!u || !u.id) {
      if (cb) cb({ ok: false, error: '인증 코드가 유효하지 않습니다.' });
      return;
    }
    for (const r of socket.rooms) {
      if (String(r).startsWith('user:') && r !== 'user:' + u.id) socket.leave(r);
    }
    socket.join('user:' + u.id);
    socket.data.userId = u.id;
    socket.data.nickname = u.nickname;
    if (cb) cb({ ok: true, userId: u.id, nickname: u.nickname });
  });
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    if (pkg && pkg.version) socket.emit('server_version', { version: 'v' + pkg.version });
    const curOnline = getOnlineUsersList();
    socket.emit('online_presence_updated', { count: curOnline.length, onlineUsers: curOnline });
    socket.emit('games_summary_updated', buildGamesRegistryWithCounts());
  } catch (_) {}
  socket.on('auth_register', ({ nickname }, cb) => {
    const rawName = String(nickname || '').trim().slice(0, 16);
    if (!rawName) return cb && cb({ error: 'EMPTY' });
    const exists = globalServerSettings.enforceNoDupName && usersDB.some((u) => u.nickname.toLowerCase() === rawName.toLowerCase());
    if (exists) return cb && cb({ error: 'DUPLICATE' });

    let saveCode = generateSaveCode8();
    while (usersDB.some((u) => u.save_code === saveCode)) {
      saveCode = generateSaveCode8();
    }
    const newUser = ensureUserStatsStructure({
      id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      nickname: rawName,
      save_code: saveCode,
      game_data: createDefaultGameData(),
      updated_at: new Date().toISOString()
    });
    usersDB.push(newUser);
    saveUsersDB(usersDB);
    if (cb) cb({ user: newUser });
  });

  socket.on('sync_load', ({ save_code }, cb) => {
    const code = String(save_code || '').trim().toUpperCase();
    const foundUser = usersDB.find((u) => u.save_code.toUpperCase() === code);
    if (!foundUser) return cb && cb({ error: 'NOT_FOUND' });
    ensureUserStatsStructure(foundUser);
    foundUser.updated_at = new Date().toISOString();
    saveUsersDB(usersDB);
    if (cb) cb({ user: foundUser });
  });

  updateRoomCounts();
  socket.emit('sync_state', {
    rooms: getMarbleRoomsSummary(),
    deletedRooms: deletedMarbleRooms,
    customMaps: customMapsDB,
    participants,
    gameState,
    currentSeed,
    currentMapId,
    currentSpeed,
    winnerTarget,
    customTargetRank,
    rankings
  });
  socket.emit('rooms_updated', getMarbleRoomsSummary());

  // 새 방 만들기 (계정당 방 1개만 생성 가능, 방별 독립 상태 보유)
  socket.on('create_room', ({ roomId, title, clientId, hostNickname, hostSaveCode, maxPlayers, password, entryFee, roomFundingMode, payoutMode } = {}, cb) => {
    if (globalServerSettings.enforceOneRoomPerAccount && clientId) {
      const existing = findUserExistingRoomGlobal(clientId, hostNickname);
      if (existing) {
        const roleTxt = existing.role === 'player' ? '입장 중인' : '생성한';
        const msg = `이미 ${roleTxt} 방 [${existing.title}] (${existing.gameLabel})이 있습니다. 기존 방에서 나가거나 삭제한 후 이용해주세요.`;
        socket.emit('room_create_error', { error: msg });
        if (cb) cb({ ok: false, error: msg });
        return;
      }
    }
    const rawPw = String(password || '').trim();
    if (rawPw && !/^\d{4}$/.test(rawPw)) {
      socket.emit('room_create_error', { error: '비밀번호는 숫자 4자리여야 합니다.' });
      if (cb) cb({ ok: false, error: '비밀번호는 숫자 4자리여야 합니다.' });
      return;
    }
    const cleanTitle = (String(title || '').trim() || `${String(hostNickname || '방장').trim().slice(0, 16)}님의 방`).slice(0, 24);
    const cleanHostNick = String(hostNickname || '').trim().slice(0, 16) || '방장';
    const fee = Math.max(0, Math.min(1000000000, Math.floor(Number(entryFee) || 0)));
    const fMode = (roomFundingMode === 'HOST_EVENT' || roomFundingMode === 'SERVER_EVENT') ? 'HOST_EVENT' : 'ENTRY_FEE';
    const pMode = payoutMode === 'TOP3_SPLIT' ? 'TOP3_SPLIT' : 'WINNER_TAKES_ALL';
    if (fMode === 'HOST_EVENT') {
      const hostUser = (hostSaveCode && usersDB.find((u) => String(u.save_code || '').toUpperCase() === String(hostSaveCode).trim().toUpperCase()))
        || findUserByNickname(cleanHostNick);
      if (!isUserAdmin(hostUser)) {
        const msg = '🔒 서버 이벤트방은 관리자 계정만 개최할 수 있습니다.';
        socket.emit('room_create_error', { error: msg });
        if (cb) cb({ ok: false, error: msg });
        return;
      }
    } else if (fee > 0 && !canAffordGold(cleanHostNick, fee)) {
      const msg = `보유 스타가 부족하여 ${fee.toLocaleString()} 스타 입장비 방을 만들 수 없습니다. (현재 ${getUserGold(cleanHostNick).toLocaleString()} 스타)`;
      socket.emit('room_create_error', { error: msg });
      if (cb) cb({ ok: false, error: msg });
      return;
    }
    const cap = Math.max(0, Math.min(100, Number(maxPlayers || 0)));
    const id = roomId || `room_${Date.now()}`;
    const now = Date.now();
    if (!rooms.some((r) => r.id === id)) {
      rooms.unshift(ensureMarbleRoomState({
        id,
        title: cleanTitle,
        count: 0,
        status: 'LOBBY',
        seed: now,
        mapId: 'pinball_chaos',
        speed: 1.2,
        winnerTarget: 'FIRST',
        customTargetRank: 1,
        onlyScreenOn: false,
        rankings: [],
        hostClientId: clientId || socket.id,
        hostSocketId: socket.id,
        hostNickname: cleanHostNick,
        maxPlayers: cap,
        password: rawPw,
        entryFee: fee,
        roomFundingMode: fMode,
        payoutMode: pMode,
        prizePool: 0,
        lastPayouts: [],
        createdAt: now,
        lastActivityAt: now,
        hostLastSeenAt: now
      }));
    }
    for (const r of socket.rooms) {
      if (r !== socket.id && r !== id && !String(r).startsWith('user:')) socket.leave(r);
    }
    socket.join(id);
    updateRoomCounts();
    io.emit('rooms_updated', getMarbleRoomsSummary());
    if (cb) cb({ ok: true, roomId: id });
  });

  // 방장이 방 삭제 -> 해당 방(roomId)만 삭제하고 해당 방 참가자만 퇴장시킴
  socket.on('delete_room', ({ roomId, title, clientId, isGlobalAdmin } = {}) => {
    if (!roomId) return;
    const targetRm = rooms.find((r) => r.id === roomId);
    if (targetRm && !isGlobalAdmin && targetRm.hostClientId && clientId && targetRm.hostClientId !== clientId && targetRm.hostSocketId !== socket.id) return;
    const deletedTitle = title || (targetRm ? targetRm.title : '해당');
    rooms = rooms.filter((r) => r.id !== roomId);
    participants = participants.filter((p) => p.roomId !== roomId);
    updateRoomCounts();
    io.to(roomId).emit('room_deleted', { roomId, title: deletedTitle });
    emitRoomParticipants(roomId);
    io.emit('rooms_updated', getMarbleRoomsSummary());
  });

  // 유저가 나가기 버튼 클릭 시 -> 해당 유저의 구슬을 즉시 제거!
  socket.on('leave_game', ({ roomId, participantId, clientId, keepInRoom } = {}) => {
    const rmLeave = roomId ? getMarbleRoom(roomId) : null;
    if (keepInRoom && rmLeave && rmLeave.status !== 'LOBBY') {
      socket.emit('race_start_error', { roomId: rmLeave.id, message: 'ℹ️ 대기 상태에서만 관전으로 전환할 수 있습니다.' });
      return;
    }
    if (roomId && !keepInRoom) {
      socket.leave(roomId);
      if (socket.data && socket.data.marbleRoomId === roomId) {
        socket.data.marbleRoomId = null;
      }
    }
    const affectedRooms = new Set();
    if (roomId) affectedRooms.add(roomId);
    participants.forEach((p) => {
      if (p.id === participantId || (clientId && p.clientId === clientId) || p.socketId === socket.id) {
        if (p.roomId) affectedRooms.add(p.roomId);
      }
    });
    participants = participants.filter(
      (p) =>
        p.id !== participantId &&
        !(clientId && p.clientId === clientId) &&
        p.socketId !== socket.id
    );
    updateRoomCounts();
    affectedRooms.forEach((rid) => emitRoomParticipants(rid));
    io.emit('rooms_updated', getMarbleRoomsSummary());
  });

  socket.on('marble_chat', ({ roomId, text, nickname } = {}, cb) => {
    const rid = String(roomId || '').trim();
    if (!rid || !getMarbleRoom(rid)) {
      if (cb) cb({ ok: false, error: '방 정보를 찾을 수 없습니다.' });
      return;
    }
    if (!socket.rooms.has(rid)) {
      if (cb) cb({ ok: false, error: '해당 방에 입장한 상태에서만 채팅할 수 있습니다.' });
      return;
    }
    const now = Date.now();
    if (now - (socket.data._lastMarbleChatAt || 0) < 400) {
      if (cb) cb({ ok: false, error: '채팅은 잠시 후 다시 입력해 주세요.' });
      return;
    }
    socket.data._lastMarbleChatAt = now;
    const cleanText = String(text || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 140);
    if (!cleanText) {
      if (cb) cb({ ok: false, error: '메시지를 입력해 주세요.' });
      return;
    }
    const senderNick = String(socket.data.nickname || nickname || '익명').trim().slice(0, 16) || '익명';
    if (adminConsoleHooks && typeof adminConsoleHooks.isUserChatMuted === 'function') {
      const mInfo = adminConsoleHooks.isUserChatMuted(senderNick);
      if (mInfo) {
        if (cb) cb({ ok: false, error: `🔇 채팅 제한 중입니다. (남은 시간: 약 ${mInfo.remainMin}분)` });
        return;
      }
    }
    const d = new Date(now + 9 * 3600 * 1000);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    const msg = {
      id: 'mc_' + now + '_' + Math.random().toString(36).slice(2, 6),
      roomId: rid,
      nickname: senderNick,
      cosmetics: getUserCosmetics(senderNick),
      text: cleanText,
      time: `${hh}:${mm}`,
      at: now
    };
    let hist = marbleRoomChats.get(rid);
    if (!hist) { hist = []; marbleRoomChats.set(rid, hist); }
    hist.push(msg);
    if (hist.length > MAX_MARBLE_ROOM_CHAT) hist.splice(0, hist.length - MAX_MARBLE_ROOM_CHAT);
    io.to(rid).emit('marble_chat_message', { roomId: rid, message: msg });
    if (cb) cb({ ok: true, message: msg });
  });

  socket.on('join_room', ({ roomId, clientId, password, nickname, mode } = {}, cb) => {
    const rm = getMarbleRoom(roomId);
    if (mode !== 'spectate' && globalServerSettings.enforceOneRoomPerAccount && (clientId || nickname)) {
      const conflict = findUserExistingRoomGlobal(clientId, nickname, 'marble', roomId);
      if (conflict) {
        const roleTxt = conflict.role === 'host' ? '생성한' : '입장 중인';
        const msg = `이미 ${roleTxt} 방 [${conflict.title}] (${conflict.gameLabel})이 있습니다. 기존 방에서 나가거나 삭제한 후 이용해주세요.`;
        socket.emit('join_room_error', { roomId, error: 'ROOM_CONFLICT', message: msg });
        if (cb) cb({ ok: false, error: 'ROOM_CONFLICT', message: msg });
        return;
      }
    }
    if (rm && rm.password && (!clientId || rm.hostClientId !== clientId)) {
      if (String(password || '') !== rm.password) {
        const msg = '방 비밀번호(숫자 4자리)가 일치하지 않습니다.';
        socket.emit('join_room_error', { roomId, error: 'WRONG_PASSWORD', message: msg });
        if (cb) cb({ ok: false, error: 'WRONG_PASSWORD', message: msg });
        return;
      }
    }
    if (roomId) {
      for (const r of socket.rooms) {
        if (r !== socket.id && r !== roomId && !String(r).startsWith('user:')) socket.leave(r);
      }
      socket.join(roomId);
      socket.data.marbleRoomId = roomId;
      if (clientId) socket.data.marbleClientId = String(clientId);
      if (nickname) socket.data.marbleNickname = String(nickname).trim().slice(0, 16);
    }
    if (rm) {
      const now = Date.now();
      rm.lastActivityAt = now;
      if (clientId && rm.hostClientId === clientId) {
        rm.hostLastSeenAt = now;
        rm.hostSocketId = socket.id;
      }
    }
    if (cb) cb({ ok: true });
    if (roomId) {
      socket.emit('marble_chat_history', { roomId, messages: marbleRoomChats.get(roomId) || [] });
    }
    const rmParticipants = (roomId ? participants.filter((p) => p.roomId === roomId) : participants).map((p) => {
      if (p.name) p.cosmetics = getUserCosmetics(p.name);
      return p;
    });
    socket.emit('sync_state', {
      roomId: rm ? rm.id : roomId,
      rooms: getMarbleRoomsSummary(),
      deletedRooms: deletedMarbleRooms,
      customMaps: customMapsDB,
      participants: rmParticipants,
      gameState: rm ? rm.status : 'LOBBY',
      currentSeed: rm ? rm.seed : currentSeed,
      currentMapId: rm ? rm.mapId : currentMapId,
      currentSpeed: rm ? rm.speed : currentSpeed,
      winnerTarget: rm ? rm.winnerTarget : winnerTarget,
      customTargetRank: rm ? rm.customTargetRank : customTargetRank,
      onlyScreenOn: rm ? Boolean(rm.onlyScreenOn) : false,
      skillMode: rm ? (rm.skillMode || 'NONE') : 'NONE',
      activeRaceSkill: rm ? (rm.activeRaceSkill || 'NONE') : 'NONE',
      hostClientId: rm ? rm.hostClientId : null,
      hostNickname: rm ? rm.hostNickname : '',
      maxPlayers: rm ? rm.maxPlayers : 0,
      hasPassword: rm ? Boolean(rm.password) : false,
      entryFee: rm ? (rm.entryFee || 0) : 0,
      roomFundingMode: rm ? (rm.roomFundingMode || 'ENTRY_FEE') : 'ENTRY_FEE',
      payoutMode: rm ? (rm.payoutMode || 'WINNER_TAKES_ALL') : 'WINNER_TAKES_ALL',
      prizePool: rm ? (rm.prizePool || 0) : 0,
      lastPayouts: rm ? (rm.lastPayouts || []) : [],
      rankings: rm ? rm.rankings : [],
      spectators: roomId ? getRoomSpectators(roomId) : []
    });
    if (roomId) {
      io.to(roomId).emit('room_spectators_updated', { roomId, spectators: getRoomSpectators(roomId) });
    }
  });

  // 마블 게임 참가 (다른 OX 퀴즈 방이나 다른 마블 방에 있던 내 캐릭터는 자동 퇴장 처리하여 동시 입장 차단!)
  socket.on('join_game', ({ roomId, name, clientId, password, presenceState }) => {
    if (!name || typeof name !== 'string') return;
    const cleanName = name.trim().slice(0, 16);
    if (!cleanName) return;
    const targetRoomId = roomId || (rooms[0]?.id || 'room_custom');
    const targetRoom = getMarbleRoom(targetRoomId);
    if (targetRoom && targetRoom.password && (!clientId || targetRoom.hostClientId !== clientId)) {
      if (String(password || '') !== targetRoom.password) {
        socket.emit('join_error_password', { roomId: targetRoomId });
        return;
      }
    }
    if (targetRoom && targetRoom.status !== 'LOBBY') {
      socket.emit('race_start_error', { roomId: targetRoomId, message: 'ℹ️ 대기 상태에서만 참가로 전환할 수 있습니다.' });
      return;
    }
    socket.join(targetRoomId);
    socket.data.marbleRoomId = targetRoomId;
    if (clientId) socket.data.marbleClientId = String(clientId);
    socket.data.marbleNickname = cleanName;

    // 1. 다른 모든 게임(OX/경마/블랙잭/미니게임) 방에서 이 유저를 자동 퇴장시킴
    removeUserEverywhereUnified(clientId, cleanName, 'marble', targetRoomId);

    // 2. 다른 마블 방에 있던 이 유저의 구슬도 제거 (동시 다른 방 입장 불가)
    participants = participants.filter(
      (p) =>
        p.roomId === targetRoomId ||
        ((!clientId || p.clientId !== clientId) && p.name.toLowerCase() !== cleanName.toLowerCase())
    );

    // 3. 현재 방에 이미 내 구슬이 있는지 확인
    const existingByClient = participants.find(
      (p) =>
        p.roomId === targetRoomId &&
        ((clientId && p.clientId === clientId) || p.socketId === socket.id)
    );
    if (existingByClient) {
      existingByClient.socketId = socket.id;
      existingByClient.cosmetics = getUserCosmetics(existingByClient.name);
      if (existingByClient.cosmetics && existingByClient.cosmetics.color) {
        existingByClient.color = existingByClient.cosmetics.color;
      }
      socket.emit('join_already_exists', existingByClient);
      emitRoomParticipants(targetRoomId);
      return;
    }

    const isDuplicateName = participants.some(
      (p) => p.roomId === targetRoomId && p.name.toLowerCase() === cleanName.toLowerCase()
    );
    if (isDuplicateName) {
      socket.emit('join_error_duplicate', { name: cleanName });
      return;
    }

    const roomCount = participants.filter((p) => p.roomId === targetRoomId).length;
    if (targetRoom && targetRoom.maxPlayers > 0 && roomCount >= targetRoom.maxPlayers) {
      socket.emit('join_error_full', { roomId: targetRoomId, maxPlayers: targetRoom.maxPlayers });
      return;
    }
    const isEventRoom = targetRoom && targetRoom.roomFundingMode === 'HOST_EVENT';
    const requiredJoinGold = isEventRoom ? 0 : (targetRoom ? targetRoom.entryFee : 0);
    if (targetRoom && requiredJoinGold > 0 && !canAffordGold(cleanName, requiredJoinGold)) {
      socket.emit('join_error_gold', {
        roomId: targetRoomId,
        entryFee: targetRoom.entryFee,
        userGold: getUserGold(cleanName),
        message: `입장비(${targetRoom.entryFee.toLocaleString()} 스타)가 부족하여 참가할 수 없습니다. 관전 모드로 전환됩니다.`
      });
      return;
    }
    const cos = getUserCosmetics(cleanName);
    const isOwner = Boolean(targetRoom && targetRoom.hostClientId && clientId && targetRoom.hostClientId === clientId);
    const newParticipant = {
      id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      roomId: targetRoomId,
      name: cleanName,
      color: '#38bdf8',
      cosmetics: cos,
      ready: isOwner,
      socketId: socket.id,
      clientId: clientId || `anon_${socket.id}`,
      presenceState: presenceState === 'away' ? 'away' : 'online',
      joinedAt: Date.now()
    };

    participants.push(newParticipant);
    updateRoomCounts();
    socket.emit('join_success', newParticipant);
    emitRoomParticipants(targetRoomId);
    io.emit('rooms_updated', getMarbleRoomsSummary());
  });

  socket.on('host_add_bulk', ({ roomId, names }) => {
    if (!Array.isArray(names)) return;
    const activeRoomId = roomId || (rooms[0]?.id || 'room_custom');
    names.forEach((rawName) => {
      const cleanName = String(rawName).trim().slice(0, 16);
      if (!cleanName) return;
      const isDup = participants.some((p) => p.roomId === activeRoomId && p.name.toLowerCase() === cleanName.toLowerCase());
      if (isDup) return;

      participants.push({
        id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        roomId: activeRoomId,
        name: cleanName,
        color: '#38bdf8',
        socketId: null,
        clientId: null,
        presenceState: 'online',
        joinedAt: Date.now()
      });
    });
    updateRoomCounts();
    emitRoomParticipants(activeRoomId);
    io.emit('rooms_updated', getMarbleRoomsSummary());
  });

  socket.on('host_remove_participant', ({ id, roomId, clientId, isGlobalAdmin } = {}) => {
    const kicked = participants.find((p) => p.id === id);
    const targetRid = (kicked && kicked.roomId) || roomId;
    const rm = getMarbleRoom(targetRid);
    if (rm && !isGlobalAdmin && rm.hostClientId && clientId && rm.hostClientId !== clientId && rm.hostSocketId !== socket.id) return;
    participants = participants.filter((p) => p.id !== id);
    updateRoomCounts();
    if (kicked) {
      io.to(targetRid || socket.id).emit('kicked_from_room', {
        participantId: id,
        clientId: kicked.clientId || null,
        roomId: targetRid || null,
        name: kicked.name || ''
      });
    }
    if (targetRid) emitRoomParticipants(targetRid);
    io.emit('rooms_updated', getMarbleRoomsSummary());
  });

  socket.on('host_clear_participants', ({ roomId, clientId, isGlobalAdmin } = {}) => {
    const rm = getMarbleRoom(roomId);
    if (rm && !isGlobalAdmin && rm.hostClientId && clientId && rm.hostClientId !== clientId && rm.hostSocketId !== socket.id) return;
    const targetRoomId = rm ? rm.id : roomId;
    participants = participants.filter((p) => p.roomId !== targetRoomId);
    if (rm) {
      rm.rankings = [];
      rm.status = 'LOBBY';
    }
    updateRoomCounts();
    emitRoomParticipants(targetRoomId);
    io.emit('rooms_updated', getMarbleRoomsSummary());
  });

  socket.on('marble_presence', ({ clientId, presenceState } = {}) => {
    const changedRooms = new Set();
    participants.forEach((p) => {
      if ((clientId && p.clientId === clientId) || p.socketId === socket.id) {
        const nextSt = presenceState === 'away' ? 'away' : 'online';
        if (p.presenceState !== nextSt) {
          p.presenceState = nextSt;
          if (p.roomId) changedRooms.add(p.roomId);
        }
      }
    });
    changedRooms.forEach((rid) => emitRoomParticipants(rid));
  });

  socket.on('host_update_settings', ({ roomId, mapId, speed, target, customRank, onlyScreenOn, maxPlayers, skillMode, entryFee, payoutMode, clientId, isGlobalAdmin } = {}) => {
    const rm = getMarbleRoom(roomId);
    if (!rm) return;
    if (!isGlobalAdmin && rm.hostClientId && clientId && rm.hostClientId !== clientId && rm.hostSocketId !== socket.id) return;
    const changes = [];
    if (mapId && mapId !== rm.mapId) {
      rm.mapId = mapId;
      const cm = customMapsDB.find((x) => x.id === mapId);
      const mapNames = {
        pinball_chaos: '1. 카오스 핀볼',
        mega_funnel: '2. 메가 깔때기',
        bumper_storm: '3. 하이퍼 범퍼 폭풍',
        hyper_zigzag: '4. 지그재그 슬로프',
        twin_tunnel: '5. 더블 트윈 터널',
        chaos_plinko: '6. 카오스 플링코'
      };
      changes.push(`🗺️ 맵 변경: ${cm ? cm.name : (mapNames[mapId] || mapId)}`);
    }
    if (speed && Math.abs(Number(speed) - rm.speed) > 0.02) {
      rm.speed = Number(speed) || 1.2;
      changes.push(`⏱️ 게임 속도: ${(rm.speed / 1.2).toFixed(1)}x`);
    }
    if (target && target !== rm.winnerTarget) {
      rm.winnerTarget = target;
      const tNames = { FIRST: '1등 당첨', LAST: '꼴찌 당첨', THIRD: '3등 당첨', CUSTOM: '특정 등수' };
      changes.push(`🏆 당첨 기준: ${tNames[target] || target}`);
    }
    if (customRank) rm.customTargetRank = Number(customRank) || 1;
    if (typeof onlyScreenOn === 'boolean' && onlyScreenOn !== Boolean(rm.onlyScreenOn)) {
      rm.onlyScreenOn = onlyScreenOn;
      changes.push(`👀 화면 켠 구슬만: ${onlyScreenOn ? 'ON' : 'OFF'}`);
    }
    if (skillMode && String(skillMode) !== rm.skillMode) {
      rm.skillMode = String(skillMode);
      const skNames = {
        NONE: '스킬 OFF', RANDOM: '랜덤 스킬', SHOCKWAVE: '충격파',
        GHOST: '유령화', DASH: '터보 대시', FREEZE: '빙결 파동',
        HOP: '점프 리셋', HEAVY: '헤비 메탈'
      };
      changes.push(`⚡ 스킬 모드: ${skNames[rm.skillMode] || rm.skillMode}`);
    }
    if (typeof maxPlayers !== 'undefined') {
      const nextCap = Math.max(0, Math.min(100, Number(maxPlayers) || 0));
      if (nextCap !== rm.maxPlayers) {
        rm.maxPlayers = nextCap;
        changes.push(`👥 최대 인원: ${nextCap > 0 ? nextCap + '명' : '무제한'}`);
      }
    }
    if (typeof entryFee !== 'undefined' && rm.status === 'LOBBY') {
      const nextFee = Math.max(0, Math.min(1000000000, Math.floor(Number(entryFee) || 0)));
      if (nextFee !== rm.entryFee) {
        rm.entryFee = nextFee;
        changes.push(`⭐ ${rm.roomFundingMode === 'HOST_EVENT' ? '이벤트 상금' : '입장비'}: ${nextFee > 0 ? nextFee.toLocaleString() + ' 스타' : '무료'}`);
      }
    }
    if (payoutMode && rm.status === 'LOBBY') {
      const nextPayout = payoutMode === 'TOP3_SPLIT' ? 'TOP3_SPLIT' : 'WINNER_TAKES_ALL';
      if (nextPayout !== rm.payoutMode) {
        rm.payoutMode = nextPayout;
        changes.push(`🏅 상금 배분: ${nextPayout === 'TOP3_SPLIT' ? '1~3등 차등(60/25/15%)' : '1등 몰아주기(100%)'}`);
      }
    }
    io.to(rm.id).emit('settings_updated', {
      roomId: rm.id,
      currentMapId: rm.mapId,
      currentSpeed: rm.speed,
      winnerTarget: rm.winnerTarget,
      customTargetRank: rm.customTargetRank,
      onlyScreenOn: Boolean(rm.onlyScreenOn),
      maxPlayers: rm.maxPlayers,
      skillMode: rm.skillMode || 'NONE',
      entryFee: rm.entryFee || 0,
      payoutMode: rm.payoutMode || 'WINNER_TAKES_ALL',
      noticeText: changes.length > 0 ? changes.join(' · ') : ''
    });
    io.emit('rooms_updated', getMarbleRoomsSummary());
  });

  socket.on('player_toggle_ready', ({ roomId, clientId } = {}, cb) => {
    const rm = getMarbleRoom(roomId);
    if (!rm) return;
    if (rm.status !== 'LOBBY') {
      if (cb) cb({ ok: false, error: '방장이 대기실을 리셋한 뒤 준비하기를 눌러주세요.' });
      return;
    }
    const p = participants.find((x) => x.roomId === rm.id && ((clientId && x.clientId === clientId) || x.socketId === socket.id));
    if (!p) {
      if (cb) cb({ ok: false, error: '먼저 구슬 참가 신청을 해주세요.' });
      return;
    }
    const fee = rm.roomFundingMode === 'HOST_EVENT' ? 0 : Number(rm.entryFee || 0);
    if (!p.ready && fee > 0 && !canAffordGold(p.name, fee)) {
      const msg = `보유 스타가 입장비(${fee.toLocaleString()} 스타)보다 부족하여 준비 완료할 수 없습니다.`;
      socket.emit('race_start_error', { roomId: rm.id, message: msg });
      if (cb) cb({ ok: false, error: msg });
      return;
    }
    p.ready = !p.ready;
    p.presenceState = 'online';
    emitRoomParticipants(rm.id);
    if (cb) cb({ ok: true, ready: p.ready });
  });

  socket.on('host_start_race', ({ roomId, onlyScreenOn, clientId } = {}) => {
    const rm = getMarbleRoom(roomId);
    if (!rm) return;
    if (rm.status === 'RACING') return;
    if (rm.hostClientId && clientId && rm.hostClientId !== clientId && rm.hostSocketId !== socket.id) return;
    const roomParticipants = participants.filter((p) => p.roomId === rm.id);
    if (roomParticipants.length === 0) return;
    const now = Date.now();
    rm.lastActivityAt = now;
    rm.hostLastSeenAt = now;

    // 1. 레디(준비 완료)하지 않았거나 화면을 끈(away) 실제 유저는 자동으로 관전 모드로 전환 (구슬 제외 & 스타 미차감!)
    const unreadyHumanList = roomParticipants.filter((p) => {
      if (!p.clientId) return false; // 호스트가 수동 추가한 더미 구슬
      const isHostMarble = rm.hostClientId && p.clientId === rm.hostClientId;
      if (isHostMarble) return false;
      return !p.ready || p.presenceState === 'away';
    });

    const readyParticipants = roomParticipants.filter((p) => !unreadyHumanList.includes(p));
    const minNeeded = (Number(rm.entryFee || 0) > 0) ? 2 : 1;
    if (readyParticipants.length < minNeeded) {
      socket.emit('race_start_error', {
        roomId: rm.id,
        message: Number(rm.entryFee || 0) > 0
          ? '⚠️ 스타 입장비 방은 최소 2명 이상 [✅ 준비 완료] 상태여야 시작할 수 있습니다.'
          : '⚠️ [✅ 준비 완료] 상태인 참가 구슬이 없습니다.'
      });
      return;
    }

    if (unreadyHumanList.length > 0) {
      // 참가 상태(구슬 등록)는 그대로 유지하고, 이번 판 레이스 주행·스타 차감에서만 제외!
      unreadyHumanList.forEach((u) => {
        io.to(rm.id).emit('unready_skipped_round', {
          roomId: rm.id,
          participantId: u.id,
          clientId: u.clientId,
          name: u.name,
          message: `⏳ [${u.name}]님은 준비하기를 누르지 않아 이번 판만 제외되었습니다. (참가 상태 유지 · 스타 미차감)`
        });
      });
    }

    let racingParticipants = readyParticipants;
    // 일반 참가비 방 vs 서버 이벤트 방(총상금 서버 전액 지급 · 개인 차감 없음)
    const fee = Number(rm.entryFee || 0);
    const isEventRoom = rm.roomFundingMode === 'HOST_EVENT';
    let collectedPool = 0;

    if (isEventRoom) {
      if (fee > 0) {
        collectedPool = fee;
      }
      racingParticipants.forEach((p) => {
        p.cosmetics = getUserCosmetics(p.name);
        if (p.clientId) recordDailyActivity(p.name, { play: 1 });
      });
    } else {
      if (fee > 0) {
        const lacking = racingParticipants.filter((p) => p.clientId && !canAffordGold(p.name, fee));
        if (lacking.length > 0) {
          const names = lacking.map((p) => p.name).join(', ');
          socket.emit('race_start_error', {
            roomId: rm.id,
            message: `참가자 [${names}]님의 보유 스타가 입장비(${fee.toLocaleString()} 스타)보다 부족하여 시작할 수 없습니다.`
          });
          return;
        }
      }
      racingParticipants.forEach((p) => {
        p.cosmetics = getUserCosmetics(p.name);
        if (p.clientId) {
          recordDailyActivity(p.name, { play: 1 });
          if (fee > 0) {
            addUserGold(p.name, -fee, 'marble_entry_fee');
            collectedPool += fee;
          }
        }
      });
    }
    rm.prizePool = collectedPool;
    rm.lastPayouts = [];
    rm.expectedFinishCount = racingParticipants.length;

    const SKILL_POOL = ['SHOCKWAVE', 'GHOST', 'DASH', 'FREEZE', 'HOP', 'HEAVY'];
    const resolvedSkill = rm.skillMode === 'RANDOM'
      ? SKILL_POOL[Math.floor(Math.random() * SKILL_POOL.length)]
      : (rm.skillMode || 'NONE');
    rm.activeRaceSkill = resolvedSkill;
    rm.usedSkillIds = new Set();
    rm.seed = now;
    rm.status = 'RACING';
    rm.rankings = [];
    updateRoomCounts();
    io.to(rm.id).emit('race_started', {
      roomId: rm.id,
      seed: rm.seed,
      mapId: rm.mapId,
      speed: rm.speed,
      winnerTarget: rm.winnerTarget,
      customTargetRank: rm.customTargetRank,
      skillMode: rm.skillMode || 'NONE',
      activeSkill: rm.activeRaceSkill || 'NONE',
      entryFee: rm.entryFee || 0,
      payoutMode: rm.payoutMode || 'WINNER_TAKES_ALL',
      prizePool: rm.prizePool || 0,
      participants: racingParticipants
    });
    io.emit('rooms_updated', getMarbleRoomsSummary());
  });

  socket.on('player_use_skill', ({ roomId, participantId, clientId } = {}) => {
    const rm = getMarbleRoom(roomId);
    if (!rm || rm.status !== 'RACING') return;
    const activeSkill = rm.activeRaceSkill || 'NONE';
    if (activeSkill === 'NONE') return;
    if (!rm.usedSkillIds) rm.usedSkillIds = new Set();
    const p = participants.find((x) => x.roomId === rm.id && ((participantId && x.id === participantId) || (clientId && x.clientId === clientId) || x.socketId === socket.id));
    if (!p) return;
    if (rm.usedSkillIds.has(p.id)) return;
    rm.usedSkillIds.add(p.id);
    io.to(rm.id).emit('skill_triggered', {
      roomId: rm.id,
      participantId: p.id,
      name: p.name,
      skill: activeSkill
    });
  });

  socket.on('host_world_snapshot', (snapshot = {}) => {
    const rid = snapshot && snapshot.roomId;
    if (!rid) return;
    const rmSnap = getMarbleRoom(rid);
    if (!rmSnap || rmSnap.status !== 'RACING') return;
    if (rmSnap.hostSocketId && rmSnap.hostSocketId !== socket.id) return;
    socket.to(rid).volatile.emit('world_snapshot', snapshot);
  });

  socket.on('host_shuffle_order', ({ roomId } = {}) => {
    const rm = getMarbleRoom(roomId);
    const seed = Date.now();
    if (rm) rm.seed = seed;
    if (rm) io.to(rm.id).emit('order_shuffled', { roomId: rm.id, seed });
  });

  socket.on('host_reset_lobby', ({ roomId, clientId } = {}) => {
    const rm = getMarbleRoom(roomId);
    if (!rm) return;
    if (rm.hostClientId && clientId && rm.hostClientId !== clientId && rm.hostSocketId !== socket.id) return;
    const seed = Date.now();
    if (rm) {
      const wasFinished = rm.status === 'FINISHED';
      rm.status = 'LOBBY';
      rm.rankings = [];
      rm.activeRaceSkill = 'NONE';
      rm.usedSkillIds = new Set();
      rm.seed = seed;
      participants.forEach((p) => {
        if (p.roomId === rm.id) {
          p.ready = Boolean(rm.hostClientId && p.clientId === rm.hostClientId);
        }
      });
      emitRoomParticipants(rm.id);
    }
    updateRoomCounts();
    if (rm) io.to(rm.id).emit('lobby_reset', { roomId: rm.id, gameState: 'LOBBY', rankings: [], seed });
    io.emit('rooms_updated', getMarbleRoomsSummary());
  });

  // 마블 골인 판정 및 유저 전적(참가 횟수, 1등 횟수, 최고 순위) 자동 기록 (방별 독립 집계!)
  socket.on('host_marble_finished', ({ roomId, participantId, name, color, time }) => {
    const pObj = participants.find((p) => p.id === participantId);
    const rm = getMarbleRoom(roomId || (pObj && pObj.roomId));
    if (!rm || rm.status !== 'RACING') return;
    if (rm.hostSocketId && rm.hostSocketId !== socket.id) return;
    if (rm.rankings.some((r) => r.participantId === participantId)) return;
    const rank = rm.rankings.length + 1;
    const entry = { rank, participantId, name, color, time };
    rm.rankings.push(entry);
    io.to(rm.id).emit('ranking_updated', { roomId: rm.id, entry, rankings: rm.rankings });

    // 유저 DB에 마블 전적 업데이트
    const userRecord = findUserByNickname(name);
    if (userRecord) {
      ensureUserStatsStructure(userRecord);
      const mStats = userRecord.game_data.stats.marble;
      mStats.plays = (mStats.plays || 0) + 1;
      if (rank === 1) {
        mStats.firstPlaceWins = (mStats.firstPlaceWins || 0) + 1;
      }
      if (!mStats.bestRank || rank < mStats.bestRank) {
        mStats.bestRank = rank;
      }
      saveUsersDB(usersDB);
    }

    rm.lastActivityAt = Date.now();
    const roomTotal = rm.expectedFinishCount || participants.filter((p) => p.roomId === rm.id).length;
    if (roomTotal > 0 && rm.rankings.length >= roomTotal) {
      rm.status = 'FINISHED';
      // 당첨 기준에 따른 우승자 판정 및 상금 풀 배분
      let targetRank = 1;
      if (rm.winnerTarget === 'LAST') targetRank = rm.rankings.length;
      else if (rm.winnerTarget === 'THIRD') targetRank = Math.min(3, rm.rankings.length);
      else if (rm.winnerTarget === 'CUSTOM') targetRank = Math.max(1, Math.min(rm.rankings.length, Number(rm.customTargetRank) || 1));
      const targetWinnerEntry = rm.rankings.find((r) => r.rank === targetRank) || rm.rankings[0];
      if (targetWinnerEntry && targetWinnerEntry.name) {
        recordDailyActivity(targetWinnerEntry.name, { mainWin: 1 });
        const wUser = findUserByNickname(targetWinnerEntry.name);
        if (wUser) {
          ensureUserStatsStructure(wUser);
          wUser.game_data.stats.marble.targetWins = (wUser.game_data.stats.marble.targetWins || 0) + 1;
          saveUsersDB(usersDB);
        }
      }
      if (rm.prizePool > 0 && (!rm.lastPayouts || rm.lastPayouts.length === 0)) {
        if (rm.payoutMode === 'TOP3_SPLIT' && rm.rankings.length >= 3) {
          const ordered = rm.rankings.slice(0, 3).map((r) => r.name);
          rm.lastPayouts = distributePoolPayout(rm.prizePool, 'TOP3_SPLIT', ordered);
        } else if (targetWinnerEntry && targetWinnerEntry.name) {
          rm.lastPayouts = distributePoolPayout(rm.prizePool, 'WINNER_TAKES_ALL', [targetWinnerEntry.name]);
        }
      }
      // 레이스 종료 시 다음 판 다시하기 동의를 위해 방장 외 참가자의 ready를 false로 초기화
      participants.forEach((p) => {
        if (p.roomId === rm.id) {
          p.ready = Boolean(rm.hostClientId && p.clientId === rm.hostClientId);
        }
      });
      emitRoomParticipants(rm.id);
      updateRoomCounts();
      io.to(rm.id).emit('race_finished', {
        roomId: rm.id,
        rankings: rm.rankings,
        prizePool: rm.prizePool || 0,
        entryFee: rm.entryFee || 0,
        roomFundingMode: rm.roomFundingMode || 'ENTRY_FEE',
        payoutMode: rm.payoutMode || 'WINNER_TAKES_ALL',
        payouts: rm.lastPayouts || []
      });
      io.emit('rooms_updated', getMarbleRoomsSummary());
    }
  });
});

function getLocalLanIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

const PORT = Number(process.env.PORT || 3000);
server.listen(PORT, '0.0.0.0', () => {
  const lanIp = getLocalLanIp();
  console.log('====================================================================');
  console.log('🚀 LIVE MULTIPLAYER ARCADE 통합 서버가 시작되었습니다!');
  console.log(`▶ 메인 포털 (React 18)     : http://localhost:${PORT}/`);
  console.log(`▶ 마블 드롭 서바이벌       : http://localhost:${PORT}/games/marble/`);
  console.log(`▶ OX 서바이벌 퀴즈         : http://localhost:${PORT}/games/ox-quiz/`);
  console.log(`▶ 로컬 네트워크 접속 주소  : http://${lanIp}:${PORT}/`);
  console.log('====================================================================');
});
