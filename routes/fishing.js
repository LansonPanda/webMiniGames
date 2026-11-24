const DAILY_BAIT_LIMIT = 100;
const MAX_DAILY_BAIT_BUY = 100;
const EXTRA_BAIT_PRICE = 10000;
const MAX_ROD_LEVEL = 11;

const ROD_DAILY_BAIT_LIMITS = [300, 315, 330, 350, 370, 390, 410, 430, 450, 470, 485, 500];
const AWAKENING_SPECS = [
  { level: 1, cost: 30000000, extraCasts: 100, sellBonusPct: 5, bossCritBonus: 0.15, materials: { mat_abyss_essence: 50, mat_kraken_ink: 10, mat_megalodon_tooth: 8 } },
  { level: 2, cost: 70000000, extraCasts: 200, sellBonusPct: 10, bossCritBonus: 0.30, materials: { mat_abyss_essence: 100, mat_kraken_ink: 15, mat_megalodon_tooth: 12, mat_leviathan_scale: 10 } },
  { level: 3, cost: 150000000, extraCasts: 350, sellBonusPct: 15, bossCritBonus: 0.50, materials: { mat_abyss_essence: 200, mat_leviathan_scale: 15, mat_cthulhu_eye: 10 } }
];
function getRodDailyBaitLimit(level, awakening = 0) {
  const lv = Math.max(0, Math.min(11, Math.floor(Number(level) || 0)));
  const base = ROD_DAILY_BAIT_LIMITS[lv] || 300;
  const aw = Math.max(0, Math.min(3, Math.floor(Number(awakening) || 0)));
  const awSpec = aw > 0 ? AWAKENING_SPECS.find((x) => x.level === aw) : null;
  return base + (awSpec ? awSpec.extraCasts : 0);
}

const ROD_SKIN_DROPS = [
  { id: 'rod_skin_abyss', name: '🔱 심연의 포세이돈 스킨', value: 'rod_abyss', probPct: 0.004 },
  { id: 'rod_skin_celestial', name: '🌌 성운의 창세 스킨', value: 'rod_celestial', probPct: 0.001 }
];

function rollRodSkinDrop(mult = 1) {
  const m = Math.max(1, Number(mult) || 1);
  const r = Math.random() * 100;
  let acc = 0;
  for (const rs of ROD_SKIN_DROPS) {
    acc += rs.probPct * m;
    if (r < acc) return rs;
  }
  return null;
}

const ROD_UPGRADE_TABLE = [
  { level: 1, cost: 100000, rate: 0.90, failBonus: 0.09, destroyRate: 0 },
  { level: 2, cost: 300000, rate: 0.70, failBonus: 0.07, destroyRate: 0 },
  { level: 3, cost: 320000, rate: 0.50, failBonus: 0.05, destroyRate: 0 },
  { level: 4, cost: 340000, rate: 0.30, failBonus: 0.03, destroyRate: 0 },
  { level: 5, cost: 360000, rate: 0.20, failBonus: 0.02, destroyRate: 0 },
  { level: 6, cost: 380000, rate: 0.12, failBonus: 0.012, destroyRate: 0 },
  { level: 7, cost: 400000, rate: 0.08, failBonus: 0.008, destroyRate: 0 },
  { level: 8, cost: 420000, rate: 0.06, failBonus: 0.006, destroyRate: 0.03 },
  { level: 9, cost: 440000, rate: 0.04, failBonus: 0.004, destroyRate: 0.06 },
  { level: 10, cost: 470000, rate: 0.02, failBonus: 0.002, destroyRate: 0.09 },
  { level: 11, cost: 500000, rate: 0.01, failBonus: 0.001, destroyRate: 0.14 }
];

const TIER_META = {
  COMMON: { label: '일반', color: '#94a3b8', bg: 'rgba(148,163,184,0.15)', baseRate: 56.0, gaugeWidth: 48, speed: 1.0 },
  RARE: { label: '희귀', color: '#38bdf8', bg: 'rgba(56,189,248,0.18)', baseRate: 26.0, gaugeWidth: 42, speed: 1.25 },
  HERO: { label: '영웅', color: '#c084fc', bg: 'rgba(192,132,252,0.2)', baseRate: 12.0, gaugeWidth: 36, speed: 1.5 },
  LEGEND: { label: '전설', color: '#facc15', bg: 'rgba(250,204,21,0.22)', baseRate: 4.5, gaugeWidth: 30, speed: 1.8 },
  MYTHIC: { label: '신화', color: '#fb7185', bg: 'rgba(251,113,133,0.24)', baseRate: 1.2, gaugeWidth: 26, speed: 2.1 },
  IMMORTAL: { label: '불멸', color: '#f472b6', bg: 'rgba(244,114,182,0.28)', baseRate: 0.25, gaugeWidth: 22, speed: 2.4 },
  TRANSCENDENT: { label: '초월', color: '#22d3ee', bg: 'rgba(34,211,238,0.28)', baseRate: 0.05, gaugeWidth: 19, speed: 2.6 }
};

const FISH_CATALOG = [
  // 일반 (5종)
  { id: 'c_crucian', tier: 'COMMON', name: '은빛 붕어', icon: '🐟', minLength: 15, maxLength: 38, price: 120, desc: '맑은 호수 어디서나 만날 수 있는 친근한 붕어' },
  { id: 'c_minnow', tier: 'COMMON', name: '날렵 피라미', icon: '🐠', minLength: 8, maxLength: 20, price: 100, desc: '수면 위를 빠르게 헤엄치는 작은 피라미' },
  { id: 'c_carp', tier: 'COMMON', name: '통통 잉어', icon: '🐟', minLength: 30, maxLength: 75, price: 220, desc: '묵직한 손맛을 주는 통통한 토종 잉어' },
  { id: 'c_puffer', tier: 'COMMON', name: '동글 복어', icon: '🐡', minLength: 14, maxLength: 35, price: 260, desc: '놀라면 몸을 부풀리는 귀여운 복어' },
  { id: 'c_squid', tier: 'COMMON', name: '반짝 오징어', icon: '🦑', minLength: 18, maxLength: 45, price: 300, desc: '밤바다 불빛을 따라 올라온 투명한 오징어' },

  // 희귀 (5종)
  { id: 'r_salmon', tier: 'RARE', name: '붉은 연어', icon: '🐟', minLength: 45, maxLength: 95, price: 650, desc: '물살을 거슬러 오르는 힘찬 붉은 연어' },
  { id: 'r_bream', tier: 'RARE', name: '황금 참돔', icon: '🐠', minLength: 35, maxLength: 85, price: 850, desc: '비늘이 붉고 빛나는 고급 어종 참돔' },
  { id: 'r_octopus', tier: 'RARE', name: '대왕 문어', icon: '🐙', minLength: 50, maxLength: 140, price: 1100, desc: '여덟 다리로 찌를 힘껏 끌어당기는 문어' },
  { id: 'r_lobster', tier: 'RARE', name: '로얄 랍스터', icon: '🦞', minLength: 28, maxLength: 68, price: 1300, desc: '단단한 붉은 껍질을 지닌 고급 랍스터' },
  { id: 'r_porcupine', tier: 'RARE', name: '가시복어', icon: '🐡', minLength: 25, maxLength: 60, price: 1500, desc: '뾰족한 가시를 세운 희귀 가시복어' },

  // 영웅 (5종)
  { id: 'h_mako', tier: 'HERO', name: '청상아리', icon: '🦈', minLength: 120, maxLength: 280, price: 2800, desc: '빠른 속도로 찌를 물고 달아나는 영웅 상어' },
  { id: 'h_dolphin', tier: 'HERO', name: '푸른 돌고래', icon: '🐬', minLength: 140, maxLength: 300, price: 3400, desc: '낚시터에 행운을 가져다준다는 푸른 돌고래' },
  { id: 'h_turtle', tier: 'HERO', name: '비취 바다거북', icon: '🐢', minLength: 80, maxLength: 180, price: 4000, desc: '영롱한 비취빛 등껍질을 지닌 장수 거북' },
  { id: 'h_tuna', tier: 'HERO', name: '대왕 참다랑어', icon: '🐟', minLength: 130, maxLength: 320, price: 4800, desc: '바다의 다이아몬드라 불리는 초대형 참치' },
  { id: 'h_eel', tier: 'HERO', name: '전기 뱀장어', icon: '🐍', minLength: 90, maxLength: 220, price: 5500, desc: '찌릿한 전류를 내뿜는 심해 전기 뱀장어' },

  // 전설 (5종)
  { id: 'l_whale', tier: 'LEGEND', name: '푸른 대왕고래', icon: '🐋', minLength: 450, maxLength: 1200, price: 12000, desc: '수면을 가르며 나타나는 거대한 전설의 고래' },
  { id: 'l_imugi', tier: 'LEGEND', name: '깊은 물 이무기', icon: '🐉', minLength: 320, maxLength: 850, price: 15000, desc: '천 년을 묵어 승천을 기다리는 호수의 이무기' },
  { id: 'l_greatwhite', tier: 'LEGEND', name: '심해 백상아리', icon: '🦈', minLength: 280, maxLength: 680, price: 18000, desc: '바다의 제왕으로 군림하는 전설의 백상아리' },
  { id: 'l_kraken', tier: 'LEGEND', name: '심연의 크라켄', icon: '🦑', minLength: 350, maxLength: 920, price: 21000, desc: '거대한 촉수로 낚싯대를 휘게 만드는 전설 괴수' },
  { id: 'l_goldcarp', tier: 'LEGEND', name: '순금 황금잉어', icon: '🌟', minLength: 110, maxLength: 260, price: 25000, desc: '온몸이 순금으로 빛나 막대한 행운을 주는 잉어' },

  // 신화 (4종)
  { id: 'm_bluedragon', tier: 'MYTHIC', name: '창공의 청룡', icon: '🐉', minLength: 600, maxLength: 1600, price: 45000, desc: '비와 번개를 부르며 수면 위로 솟구치는 신화 속 청룡' },
  { id: 'm_siren', tier: 'MYTHIC', name: '세이렌의 보물어', icon: '🧜', minLength: 180, maxLength: 420, price: 55000, desc: '신비로운 노랫소리와 함께 나타나는 바다의 보물어' },
  { id: 'm_thunder_ray', tier: 'MYTHIC', name: '뇌신 가오리', icon: '⚡', minLength: 320, maxLength: 780, price: 68000, desc: '전격의 날개를 펼쳐 심해를 누비는 신화 가오리' },
  { id: 'm_leviathan', tier: 'MYTHIC', name: '해신 리바이어던', icon: '🌊', minLength: 800, maxLength: 2000, price: 82000, desc: '거대한 파도를 일으키는 태고의 해신' },

  // 불멸 (3종)
  { id: 'i_poseidon', tier: 'IMMORTAL', name: '포세이돈의 황금룡', icon: '👑', minLength: 900, maxLength: 2500, price: 150000, desc: '바다의 왕관을 쓴 불멸의 황금 바다룡' },
  { id: 'i_nebula_whale', tier: 'IMMORTAL', name: '은하수 성운고래', icon: '🌌', minLength: 1200, maxLength: 3200, price: 220000, desc: '우주의 별빛을 품고 헤엄치는 신비로운 불멸 고래' },
  { id: 'i_phoenix_fish', tier: 'IMMORTAL', name: '불사조 심해어', icon: '🔥', minLength: 450, maxLength: 1100, price: 300000, desc: '꺼지지 않는 불꽃 지느러미를 지닌 전설 너머의 불멸어' },

  // 초월 (2종)
  { id: 't_chronos_whale', tier: 'TRANSCENDENT', name: '시공의 창세고래', icon: '🌠', minLength: 2000, maxLength: 5500, price: 650000, desc: '시간과 우주의 경계를 유영하는 초월적 존재' },
  { id: 't_abyss_emperor', tier: 'TRANSCENDENT', name: '심연의 절대룡', icon: '💠', minLength: 1600, maxLength: 4200, price: 850000, desc: '모든 바다의 법칙을 초월한 태초의 절대룡' }
];

// 낚시 중 구슬 스킨 드롭 테이블 (총 0.350%, 낚싯대 강화와 무관하게 모든 유저 동일 확률)
const MARBLE_SKIN_DROPS = [
  // 기본색 8종 (총 0.280%, 개당 0.0350%)
  { value: 'color_red', name: '❤️ 루비 레드 구슬', price: 50000, group: '기본색', probPct: 0.035 },
  { value: 'color_emerald', name: '💚 에메랄드 구슬', price: 50000, group: '기본색', probPct: 0.035 },
  { value: 'color_purple', name: '💜 바이올렛 구슬', price: 50000, group: '기본색', probPct: 0.035 },
  { value: 'color_gold', name: '💛 골든 옐로우 구슬', price: 50000, group: '기본색', probPct: 0.035 },
  { value: 'color_orange', name: '🧡 탠저린 오렌지 구슬', price: 50000, group: '기본색', probPct: 0.035 },
  { value: 'color_pink', name: '🩷 로즈 핑크 구슬', price: 50000, group: '기본색', probPct: 0.035 },
  { value: 'color_mint', name: '🩵 민트 아쿠아 구슬', price: 50000, group: '기본색', probPct: 0.035 },
  { value: 'color_white', name: '🤍 스노우 화이트 구슬', price: 50000, group: '기본색', probPct: 0.035 },
  // 링 6종 (총 0.045%, 개당 0.0075%)
  { value: 'ring_cyan', name: '💠 시안 링 구슬', price: 300000, group: '링', probPct: 0.0075 },
  { value: 'ring_gold', name: '⭕ 스타 링 구슬', price: 300000, group: '링', probPct: 0.0075 },
  { value: 'ring_red', name: '🔴 루비 링 구슬', price: 300000, group: '링', probPct: 0.0075 },
  { value: 'ring_purple', name: '🟣 퍼플 링 구슬', price: 300000, group: '링', probPct: 0.0075 },
  { value: 'ring_emerald', name: '🟢 에메랄드 링 구슬', price: 300000, group: '링', probPct: 0.0075 },
  { value: 'ring_white', name: '⚪ 실버 링 구슬', price: 300000, group: '링', probPct: 0.0075 },
  // 글로우 5종 (총 0.018%, 개당 0.0036%)
  { value: 'glow_aqua', name: '✨ 아쿠아 글로우 구슬', price: 500000, group: '글로우', probPct: 0.0036 },
  { value: 'glow_rose', name: '🌸 로즈 글로우 구슬', price: 500000, group: '글로우', probPct: 0.0036 },
  { value: 'glow_gold', name: '✨ 스타 글로우 구슬', price: 500000, group: '글로우', probPct: 0.0036 },
  { value: 'glow_purple', name: '✨ 퍼플 글로우 구슬', price: 500000, group: '글로우', probPct: 0.0036 },
  { value: 'glow_lime', name: '✨ 라임 글로우 구슬', price: 500000, group: '글로우', probPct: 0.0036 },
  // 궤적 5종 (총 0.006%, 개당 0.0012%)
  { value: 'trail_flame', name: '🔥 블레이즈 궤적 구슬', price: 1500000, group: '궤적', probPct: 0.0012 },
  { value: 'trail_aqua', name: '🌊 아쿠아 웨이브 궤적', price: 2000000, group: '궤적', probPct: 0.0012 },
  { value: 'trail_neon', name: '⚡ 사이버 네온 궤적', price: 3000000, group: '궤적', probPct: 0.0012 },
  { value: 'trail_emerald', name: '🍃 에메랄드 유성 궤적', price: 4000000, group: '궤적', probPct: 0.0012 },
  { value: 'trail_gold', name: '🌟 황금 유성 궤적', price: 5000000, group: '궤적', probPct: 0.0012 },
  // 스페셜 3종 (총 0.001%)
  { value: 'crown', name: '👑 제왕의 왕관 구슬', price: 10000000, group: '스페셜', probPct: 0.0006 },
  { value: 'prism', name: '🌈 프리즘 스펙트럼', price: 30000000, group: '스페셜', probPct: 0.0003 },
  { value: 'galaxy', name: '🌌 갤럭시 엠페러 구슬', price: 100000000, group: '스페셜', probPct: 0.0001 },
  { value: 'art_soccer', name: '⚽ 챔피언 축구공', price: 800000, group: '아트', probPct: 0.0025 },
  { value: 'art_basketball', name: '🏀 코트 농구공', price: 800000, group: '아트', probPct: 0.0025 },
  { value: 'art_8ball', name: '🎱 럭키 8번공', price: 1000000, group: '아트', probPct: 0.0020 },
  { value: 'art_watermelon', name: '🍉 한여름 수박', price: 1200000, group: '아트', probPct: 0.0018 },
  { value: 'art_pokeball', name: '🔴 몬스터 캡슐', price: 1500000, group: '아트', probPct: 0.0015 },
  { value: 'art_earth', name: '🌍 푸른 지구본', price: 2500000, group: '아트', probPct: 0.0010 },
  { value: 'art_donut', name: '🍩 딸기 도넛', price: 2500000, group: '아트', probPct: 0.0010 },
  { value: 'art_eye', name: '👁️ 심연의 마안', price: 8000000, group: '아트', probPct: 0.0005 },
  { value: 'art_saturn', name: '🪐 골든 토성', price: 12000000, group: '아트', probPct: 0.0003 },
  { value: 'art_taegeuk', name: '☯️ 태극 소용돌이', price: 20000000, group: '아트', probPct: 0.0002 }
];

const NICKNAME_COLOR_DROPS = [
  { id: 'color_mint', name: '에메랄드 민트', value: '#34d399', price: 300000, probPct: 0.015 },
  { id: 'color_gold', name: '골든 앰버', value: '#facc15', price: 300000, probPct: 0.015 },
  { id: 'color_rose', name: '크림슨 로즈', value: '#fb7185', price: 300000, probPct: 0.015 },
  { id: 'color_sky', name: '스카이 애저', value: '#38bdf8', price: 300000, probPct: 0.015 },
  { id: 'color_orange', name: '코랄 선셋', value: '#fb923c', price: 300000, probPct: 0.015 },
  { id: 'color_lavender', name: '라일락 퍼플', value: '#a78bfa', price: 300000, probPct: 0.015 },
  { id: 'color_lime', name: '라임 네온', value: '#a3e635', price: 300000, probPct: 0.015 },
  { id: 'color_silver', name: '퓨어 실버', value: '#e2e8f0', price: 300000, probPct: 0.015 },
  { id: 'color_indigo', name: '딥 인디고', value: '#818cf8', price: 300000, probPct: 0.015 },
  { id: 'color_teal', name: '오션 틸', value: '#2dd4bf', price: 300000, probPct: 0.015 },
  { id: 'color_pink', name: '체리 블라썸', value: '#f472b6', price: 300000, probPct: 0.015 },
  { id: 'color_crimson', name: '스칼렛 레드', value: '#ef4444', price: 300000, probPct: 0.015 },
  { id: 'color_lemon', name: '레몬 옐로우', value: '#fde047', price: 300000, probPct: 0.015 },
  { id: 'color_ice', name: '아이스 블루', value: '#7dd3fc', price: 300000, probPct: 0.015 },
  { id: 'color_glow_cyan', name: '✨ 네온 시안 글로우', value: 'glow:#22d3ee', price: 1000000, probPct: 0.0025 },
  { id: 'color_glow_purple', name: '✨ 로얄 퍼플 글로우', value: 'glow:#c084fc', price: 1000000, probPct: 0.0025 },
  { id: 'color_glow_gold', name: '✨ 황금 오라 글로우', value: 'glow:#fde047', price: 1000000, probPct: 0.0025 },
  { id: 'color_glow_ruby', name: '✨ 루비 플레임 글로우', value: 'glow:#f43f5e', price: 1000000, probPct: 0.0025 },
  { id: 'color_glow_pink', name: '✨ 네온 핑크 글로우', value: 'glow:#f472b6', price: 1000000, probPct: 0.0025 },
  { id: 'color_glow_blue', name: '✨ 딥블루 글로우', value: 'glow:#38bdf8', price: 1000000, probPct: 0.0025 },
  { id: 'color_grad_sunset', name: '🌅 선셋 플레임 그라데이션', value: 'grad:#f97316,#f43f5e,#c084fc', price: 5000000, probPct: 0.0005 },
  { id: 'color_grad_ocean', name: '🌊 심해 오션 그라데이션', value: 'grad:#22d3ee,#3b82f6,#818cf8', price: 5000000, probPct: 0.0005 },
  { id: 'color_rainbow', name: '🌈 프리즘 레인보우', value: 'rainbow', price: 10000000, probPct: 0.0003 },
  { id: 'color_rainbow_aurora', name: '🌌 오로라 레인보우', value: 'rainbow_aurora', price: 10000000, probPct: 0.0003 },
  { id: 'color_grad_gold', name: '👑 임페리얼 골드 그라데이션', value: 'grad:#fef08a,#f59e0b,#ea580c', price: 15000000, probPct: 0.0002 },
  { id: 'color_grad_neon', name: '⚡ 사이버 네온 그라데이션', value: 'grad:#34d399,#22d3ee,#e879f9', price: 20000000, probPct: 0.00015 },
  { id: 'color_grad_void', name: '🌌 보이드 아케이드 그라데이션', value: 'grad:#f43f5e,#a855f7,#22d3ee', price: 30000000, probPct: 0.0001 }
];

function rollNicknameColorDrop(mult = 1) {
  const m = Math.max(1, Number(mult) || 1);
  const r = Math.random() * 100;
  let acc = 0;
  for (const c of NICKNAME_COLOR_DROPS) {
    acc += c.probPct * m;
    if (r < acc) return c;
  }
  return null;
}

function rollMarbleSkinDrop(skinMult = 1) {
  const mult = Math.max(1, Number(skinMult) || 1);
  const r = Math.random() * 100;
  let acc = 0;
  for (const s of MARBLE_SKIN_DROPS) {
    acc += s.probPct * mult;
    if (r < acc) return s;
  }
  return null;
}

function pickWeightedMarbleSkinForChest() {
  const totalW = MARBLE_SKIN_DROPS.reduce((sum, s) => sum + (s.probPct || 0), 0);
  let r = Math.random() * totalW;
  for (const s of MARBLE_SKIN_DROPS) {
    r -= (s.probPct || 0);
    if (r <= 0) return s;
  }
  return MARBLE_SKIN_DROPS[0];
}

function getRodBonuses(level) {
  const lv = Math.max(0, Math.min(MAX_ROD_LEVEL, Number(level) || 0));
  return {
    rodLevel: lv,
    waitReductionPct: lv * 4,
    rareLuckBonusPct: +(lv * 1.5).toFixed(1),
    gaugeWidthBonusPct: lv * 2,
    sellPriceBonusPct: lv * 2,
    baitSaveChancePct: lv >= 9 ? 8 : (lv >= 7 ? 5 : 0),
    skinDropMult: lv >= 11 ? 2.0 : (lv >= 9 ? 1.5 : 1.0),
    transcendentMult: lv >= 11 ? 1.5 : 1.0
  };
}

function rollFishForUser(rodLevel, weather = null, awakening = 0) {
  const bonus = getRodBonuses(rodLevel);
  const weatherLuck = (weather && typeof weather.luckBonus === 'number') ? weather.luckBonus : 0;
  const luck = bonus.rareLuckBonusPct + weatherLuck;
  const wCommon = Math.max(15, TIER_META.COMMON.baseRate - luck);
  const wRare = TIER_META.RARE.baseRate + luck * 0.45;
  const wHero = TIER_META.HERO.baseRate + luck * 0.30;
  const wLegend = TIER_META.LEGEND.baseRate + luck * 0.16;
  const wMythic = TIER_META.MYTHIC.baseRate + luck * 0.065;
  const wImmortal = TIER_META.IMMORTAL.baseRate + luck * 0.020;
  const wTranscendent = (TIER_META.TRANSCENDENT.baseRate + luck * 0.005) * (bonus.transcendentMult || 1.0);

  const total = wCommon + wRare + wHero + wLegend + wMythic + wImmortal + wTranscendent;
  let r = Math.random() * total;
  let chosenTier = 'COMMON';
  const buckets = [
    ['COMMON', wCommon],
    ['RARE', wRare],
    ['HERO', wHero],
    ['LEGEND', wLegend],
    ['MYTHIC', wMythic],
    ['IMMORTAL', wImmortal],
    ['TRANSCENDENT', wTranscendent]
  ];
  for (const [tier, w] of buckets) {
    if (r < w) {
      chosenTier = tier;
      break;
    }
    r -= w;
  }

  const pool = FISH_CATALOG.filter((f) => f.tier === chosenTier);
  const fish = pool[Math.floor(Math.random() * pool.length)];
  const lenBias = (weather && typeof weather.lengthBias === 'number') ? weather.lengthBias : 0;
  const ratio = lenBias > 0 ? Math.pow(Math.random(), Math.max(0.4, 1 - lenBias)) : Math.random();
  const isKingSize = ratio >= 0.95;
  const lengthCm = +(fish.minLength + ratio * (fish.maxLength - fish.minLength)).toFixed(1);
  // 희귀도 기본 가격 * 길이 배율 (최소 길이 0.8배 ~ 최대 길이 1.4배)
  const lengthMultiplier = 0.8 + ratio * 0.6;
  const awSpec = awakening > 0 ? AWAKENING_SPECS.find((x) => x.level === awakening) : null;
  const awSellPct = awSpec ? awSpec.sellBonusPct : 0;
  const hotMult = typeof getHotTimeMultiplier === 'function' ? Math.max(1, Number(getHotTimeMultiplier() || 1)) : 1;
  const computedPrice = Math.round(fish.price * lengthMultiplier * (isKingSize ? 1.5 : 1.0) * (1 + ((bonus.sellPriceBonusPct || 0) + awSellPct) / 100) * hotMult);
  const tierInfo = TIER_META[fish.tier];
  const gaugeWidth = Math.min(70, +(tierInfo.gaugeWidth * (1 + bonus.gaugeWidthBonusPct / 100)).toFixed(1));
  return {
    fish,
    lengthCm,
    isKingSize,
    computedPrice,
    tierInfo,
    gaugeWidth,
    gaugeSpeed: tierInfo.speed
  };
}

function setupFishingModule(app, io, deps) {
  const { usersDB, saveUsersDB, findUserByValidCode, findUserByNickname, ensureUserStatsStructure, economyHooks, getTodayKstString, onPlazaChange, isAdminAuthorized, getFishingSettings, getHotTimeMultiplier, isUserChatMuted } = deps;
  function resolveAuthedFishingUser(req) {
    const code = String(req.headers['x-save-code'] || req.body?.save_code || req.query?.save_code || '').trim().toUpperCase();
    if (!code || typeof findUserByValidCode !== 'function') return null;
    return findUserByValidCode(code);
  }
  const getBaitConfig = () => (typeof getFishingSettings === 'function' ? getFishingSettings() : { limitEnabled: true, dailyLimit: DAILY_BAIT_LIMIT, maxDailyBaitBuy: MAX_DAILY_BAIT_BUY, baitPrice: EXTRA_BAIT_PRICE });
  const syncRodDailyBait = (rod) => {
    if (!rod) return;
    const today = getTodayKstString();
    if (rod.lastBaitDate !== today) {
      rod.lastBaitDate = today;
      rod.dailyBaitUsed = 0;
    }
    if (typeof rod.dailyBaitUsed !== 'number' || Number.isNaN(rod.dailyBaitUsed)) rod.dailyBaitUsed = 0;
  };
  const computeBaitRemaining = (f) => {
    const eq = (f.rods || []).find((r) => r.id === f.equippedRodId);
    if (eq) syncRodDailyBait(eq);
    return Math.max(0, f.extraBait || 0);
  };
  const fs = require('fs');
  const path = require('path');
  const TOP_CATCHES_FILE = path.join(__dirname, '..', 'fishing_top_catches.json');
  const FISHING_ROOM_ID = 'fishing_plaza';
  const fishers = new Map(); // socket.id -> { socketId, clientId, nickname, rodLevel, cosmetics, status, pending, joinedAt }
  const BOSS_ACTIVITY_WINDOW_MS = 3 * 60 * 1000; // 최근 3분 내 실제 물고기 3마리 이상 포획해야 보스 참여 가능
  const BOSS_MIN_RECENT_CATCHES = 3;
  const recentCatchesByNick = new Map(); // nickname(lower) -> number[] (timestamps)
  function recordRecentCatch(nick, nowMs = Date.now()) {
    const key = String(nick || '').toLowerCase();
    if (!key) return;
    const arr = (recentCatchesByNick.get(key) || []).filter((t) => nowMs - t <= BOSS_ACTIVITY_WINDOW_MS);
    arr.push(nowMs);
    if (arr.length > 30) arr.splice(0, arr.length - 30);
    recentCatchesByNick.set(key, arr);
  }
  function getRecentCatchCount(nick, nowMs = Date.now()) {
    const key = String(nick || '').toLowerCase();
    if (!key) return 0;
    const arr = (recentCatchesByNick.get(key) || []).filter((t) => nowMs - t <= BOSS_ACTIVITY_WINDOW_MS);
    recentCatchesByNick.set(key, arr);
    return arr.length;
  }
  function notifyAdminsMacroSuspect(nick, detail) {
    if (!economyHooks || typeof economyHooks.pushUserNotification !== 'function' || !Array.isArray(usersDB)) return;
    for (const adm of usersDB) {
      if (adm && (adm.isAdmin || String(adm.nickname || '').trim() === '랜선판다')) {
        economyHooks.pushUserNotification(adm, {
          type: 'macro_alert',
          icon: '🤖',
          title: '오토마우스/매크로 의심 감지',
          message: `[${nick}] ${detail}`
        }, false);
      }
    }
    saveUsersDB(usersDB);
  }
  const chatHistory = [];
  let topCatchesToday = [];
  let topCatchesDate = getTodayKstString();
  try {
    if (fs.existsSync(TOP_CATCHES_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(TOP_CATCHES_FILE, 'utf8'));
      if (parsed && parsed.date === topCatchesDate && Array.isArray(parsed.catches)) {
        topCatchesToday = parsed.catches;
      }
    }
  } catch (_) {}
  // ================= 심해 몬스터 협동 레이드 이벤트 (시간당 3~4회) =================
  const BOSS_CATALOG = [
    { id: 'kraken', name: '심해의 대왕 크라켄', icon: '🐙', color: '#c084fc', targetSec: 10, baseReward: 50000, damagePool: 100000, weight: 40 },
    { id: 'megalodon', name: '고대 메갈로돈', icon: '🦈', color: '#38bdf8', targetSec: 12, baseReward: 80000, damagePool: 180000, weight: 30 },
    { id: 'leviathan', name: '심연의 레비아탄', icon: '🐉', color: '#fb7185', targetSec: 14, baseReward: 130000, damagePool: 300000, weight: 20 },
    { id: 'cthulhu', name: '태초의 심해신 크툴루', icon: '👁️', color: '#facc15', targetSec: 15, baseReward: 250000, damagePool: 600000, weight: 10 }
  ];
  const BOSS_WARNING_MS = 2600;
  const BOSS_BATTLE_MS = 45000;
  let bossRaid = {
    active: false,
    id: '',
    monster: null,
    maxHp: 0,
    hp: 0,
    startedAt: 0,
    battleStartAt: 0,
    endsAt: 0,
    damageByNick: new Map(),
    timeoutId: null,
    nextSpawnTimer: null,
    nextSpawnAt: 0
  };

  function pickRandomBoss() {
    const totalW = BOSS_CATALOG.reduce((s, m) => s + m.weight, 0);
    let r = Math.random() * totalW;
    for (const m of BOSS_CATALOG) {
      if (r < m.weight) return m;
      r -= m.weight;
    }
    return BOSS_CATALOG[0];
  }

  function getPublicBossState() {
    if (!bossRaid.active || !bossRaid.monster) {
      return { active: false, nextBossSpawnAt: bossRaid.nextSpawnAt || 0, serverNow: Date.now() };
    }
    const topDamagers = Array.from(bossRaid.damageByNick.entries())
      .map(([nickname, damage]) => ({ nickname, damage }))
      .sort((a, b) => b.damage - a.damage)
      .slice(0, 5);
    return {
      active: true,
      id: bossRaid.id,
      monster: bossRaid.monster,
      maxHp: bossRaid.maxHp,
      hp: bossRaid.hp,
      startedAt: bossRaid.startedAt,
      battleStartAt: bossRaid.battleStartAt,
      endsAt: bossRaid.endsAt,
      nextBossSpawnAt: bossRaid.nextSpawnAt || 0,
      serverNow: Date.now(),
      topDamagers
    };
  }

  function scheduleNextBossEvent() {
    if (bossRaid.nextSpawnTimer) clearTimeout(bossRaid.nextSpawnTimer);
    // 10분 ~ 15분 랜덤 간격으로 보스 출현
    const delayMs = Math.round((10 + Math.random() * 5) * 60 * 1000);
    bossRaid.nextSpawnAt = Date.now() + delayMs;
    bossRaid.nextSpawnTimer = setTimeout(() => {
      if (fishers.size > 0 && !bossRaid.active) {
        startBossRaid();
      } else {
        scheduleNextBossEvent();
      }
    }, delayMs);
  }

  function finishBossRaid(defeated) {
    if (!bossRaid.active) return;
    bossRaid.active = false;
    if (bossRaid.timeoutId) {
      clearTimeout(bossRaid.timeoutId);
      bossRaid.timeoutId = null;
    }
    const monster = bossRaid.monster;
    const entries = Array.from(bossRaid.damageByNick.entries())
      .map(([nickname, damage]) => ({ nickname, damage }))
      .filter((x) => x.damage > 0)
      .sort((a, b) => b.damage - a.damage);
    const totalDmg = entries.reduce((s, x) => s + x.damage, 0);

    let rewards = [];
    if (defeated && entries.length > 0) {
      rewards = entries.map((e, idx) => {
        const propReward = totalDmg > 0 ? Math.round(monster.damagePool * (e.damage / totalDmg)) : 0;
        const totalReward = monster.baseReward + propReward;
        economyHooks.addUserGold(e.nickname, totalReward, 'fishing_boss_raid');
        const materialsWon = [];
        const uRec = findUserByNickname(e.nickname);
        if (uRec) {
          // 참여자 전원 동일 확률 랜덤 드롭 (기존 대비 확률 절반, 1등 추가 보너스 제거)
          let essQty = Math.random() < 0.40 ? 1 : 0;
          if ((monster.id === 'leviathan' || monster.id === 'cthulhu') && Math.random() < 0.25) essQty += 1;
          if (essQty > 0) {
            economyHooks.addCosmeticItem(uRec, 'material', 'mat_abyss_essence', essQty);
            materialsWon.push({ id: 'mat_abyss_essence', name: '🫧 심해의 정수', qty: essQty });
          }
          const specMap = {
            kraken: { id: 'mat_kraken_ink', name: '🐙 크라켄 먹물', chance: 0.15 },
            megalodon: { id: 'mat_megalodon_tooth', name: '🦈 메갈로돈 이빨', chance: 0.125 },
            leviathan: { id: 'mat_leviathan_scale', name: '🐉 레비아탄 용린', chance: 0.10 },
            cthulhu: { id: 'mat_cthulhu_eye', name: '👁️ 크툴루의 눈동자', chance: 0.20 }
          };
          const sp = specMap[monster.id];
          if (sp) {
            const spQty = Math.random() < sp.chance ? 1 : 0;
            if (spQty > 0) {
              economyHooks.addCosmeticItem(uRec, 'material', sp.id, spQty);
              materialsWon.push({ id: sp.id, name: sp.name, qty: spQty });
            }
          }
          uRec.updated_at = new Date().toISOString();
        }
        return {
          rank: idx + 1,
          nickname: e.nickname,
          damage: e.damage,
          sharePct: totalDmg > 0 ? +((e.damage / totalDmg) * 100).toFixed(1) : 0,
          baseReward: monster.baseReward,
          propReward,
          totalReward,
          materialsWon
        };
      });
      saveUsersDB(usersDB);
      const sysMsg = {
        id: 'fboss_win_' + Date.now(),
        nickname: '🚨 레이드 토벌 성공',
        cosmetics: { title: '', color: '#facc15' },
        rodLevel: 0,
        text: `🎉 [${monster.icon} ${monster.name}] 토벌 완료! 참여자 ${rewards.length}명에게 기본 ${monster.baseReward.toLocaleString()} + 데미지 비례 보상(총 ${monster.damagePool.toLocaleString()} 스타)이 지급되었습니다!`,
        at: Date.now()
      };
      chatHistory.push(sysMsg);
      if (chatHistory.length > 60) chatHistory.shift();
      io.to(FISHING_ROOM_ID).emit('fishing_chat_message', sysMsg);
    } else if (!defeated) {
      const sysMsg = {
        id: 'fboss_esc_' + Date.now(),
        nickname: '💨 레이드 종료',
        cosmetics: { title: '', color: '#94a3b8' },
        rodLevel: 0,
        text: `🌊 [${monster.icon} ${monster.name}]이(가) 시간 초과로 심해로 사라졌습니다...`,
        at: Date.now()
      };
      chatHistory.push(sysMsg);
      if (chatHistory.length > 60) chatHistory.shift();
      io.to(FISHING_ROOM_ID).emit('fishing_chat_message', sysMsg);
    }

    scheduleNextBossEvent();
    io.to(FISHING_ROOM_ID).emit('fishing_boss_ended', {
      defeated,
      monster,
      totalDmg,
      rewards,
      nextBossSpawnAt: bossRaid.nextSpawnAt || 0,
      serverNow: Date.now()
    });

    // 보스 레이드로 일시 중단되었던 찌 던지기 / 입질 게이지 복원
    let restoredAny = false;
    for (const fs of fishers.values()) {
      if (!fs.pausedFishing || !fs.pausedFishing.pending) continue;
      const saved = fs.pausedFishing;
      fs.pausedFishing = null;
      fs.pending = saved.pending;
      restoredAny = true;
      if (saved.status === 'BITING' || fs.pending.biteTriggered) {
        fs.status = 'BITING';
        fs.pending.biteTriggered = true;
        io.to(fs.socketId).emit('fishing_bite', {
          tier: fs.pending.fish.tier,
          tierLabel: fs.pending.tierInfo.label,
          tierColor: fs.pending.tierInfo.color,
          gaugeWidth: fs.pending.gaugeWidth,
          gaugeSpeed: fs.pending.gaugeSpeed,
          resumed: true
        });
      } else {
        fs.status = 'CASTING';
        io.to(fs.socketId).emit('fishing_cast_resumed');
        const remWait = Math.max(800, Math.min(2500, Number(saved.remainingWaitMs) || 1500));
        if (fs.biteTimer) clearTimeout(fs.biteTimer);
        fs.biteTimer = setTimeout(() => {
          if (!fishers.has(fs.socketId) || !fs.pending) return;
          fs.status = 'BITING';
          fs.pending.biteTriggered = true;
          fs.pending.biteAt = Date.now();
          broadcastPlazaState();
          io.to(fs.socketId).emit('fishing_bite', {
            tier: fs.pending.fish.tier,
            tierLabel: fs.pending.tierInfo.label,
            tierColor: fs.pending.tierInfo.color,
            gaugeWidth: fs.pending.gaugeWidth,
            gaugeSpeed: fs.pending.gaugeSpeed,
            resumed: true
          });
        }, remWait);
      }
    }
    if (restoredAny) broadcastPlazaState();
  }

  function startBossRaid(forcedMonsterId = null) {
    if (bossRaid.active) return false;
    const monster = (forcedMonsterId && BOSS_CATALOG.find((m) => m.id === forcedMonsterId)) || pickRandomBoss();
    const nowCheck = Date.now();
    const allFishers = Array.from(fishers.values());
    const eligibleFishers = allFishers.filter((fs) => getRecentCatchCount(fs.nickname, nowCheck) >= BOSS_MIN_RECENT_CATCHES);
    const fisherList = eligibleFishers.length > 0 ? eligibleFishers : allFishers;
    const activeCount = Math.max(1, fisherList.length);
    const avgRodLv = fisherList.length > 0
      ? fisherList.reduce((sum, fs) => sum + (Number(fs.rodLevel) || 0), 0) / fisherList.length
      : 0;
    // 인원수 × 평균 강화 데미지 × 쾌적 연타(초당 약 7타) 기준 10~15초 내 처치되도록 동적 HP 산정
    const estTeamDps = activeCount * (15 + avgRodLv * 8) * 7.2;
    const maxHp = Math.max(500, Math.round(estTeamDps * (monster.targetSec || 12)));
    const now = Date.now();
    bossRaid.active = true;
    bossRaid.id = 'boss_' + now;
    bossRaid.monster = monster;
    bossRaid.maxHp = maxHp;
    bossRaid.hp = maxHp;
    bossRaid.startedAt = now;
    bossRaid.battleStartAt = now + BOSS_WARNING_MS;
    bossRaid.endsAt = bossRaid.battleStartAt + BOSS_BATTLE_MS;
    bossRaid.damageByNick = new Map();
    if (bossRaid.timeoutId) clearTimeout(bossRaid.timeoutId);
    bossRaid.timeoutId = setTimeout(() => finishBossRaid(false), BOSS_WARNING_MS + BOSS_BATTLE_MS);

    // 진행 중인 찌 던지기/입질 일시 정지 (레이드 종료 후 그대로 복원)
    for (const fs of fishers.values()) {
      if ((fs.status === 'CASTING' || fs.status === 'BITING') && fs.pending) {
        if (fs.biteTimer) {
          clearTimeout(fs.biteTimer);
          fs.biteTimer = null;
        }
        const elapsed = Date.now() - (fs.pending.castAt || Date.now());
        fs.pausedFishing = {
          status: fs.status,
          pending: fs.pending,
          remainingWaitMs: Math.max(800, 3000 - elapsed)
        };
        fs.pending = null;
        fs.status = 'IDLE';
      }
    }
    broadcastPlazaState();
    io.to(FISHING_ROOM_ID).emit('fishing_boss_state', getPublicBossState());
    return true;
  }

  scheduleNextBossEvent();

  // ================= 랜덤 호수 날씨 / 황금 물떼 이벤트 =================
  const WEATHER_CATALOG = [
    { id: 'starfall', name: '✨ 별똥별의 밤', desc: '구슬 스킨 드롭률 2배!', color: '#c084fc', skinMult: 2, luckBonus: 0, lengthBias: 0 },
    { id: 'golden_tide', name: '🐟 황금 물떼', desc: '희귀+ 어종 행운 +15%!', color: '#facc15', skinMult: 1, luckBonus: 15, lengthBias: 0 },
    { id: 'storm', name: '⚡ 심해 폭풍우', desc: '대물(큰 길이) 확률 UP!', color: '#38bdf8', skinMult: 1, luckBonus: 5, lengthBias: 0.35 }
  ];
  let activeWeather = null; // { ...item, startedAt, endsAt, endTimer }
  let nextWeatherTimer = null;

  function getPublicWeatherState() {
    if (!activeWeather || Date.now() >= activeWeather.endsAt) return { active: false, serverNow: Date.now() };
    return {
      active: true,
      id: activeWeather.id,
      name: activeWeather.name,
      desc: activeWeather.desc,
      color: activeWeather.color,
      startedAt: activeWeather.startedAt,
      endsAt: activeWeather.endsAt,
      serverNow: Date.now()
    };
  }

  function triggerRandomWeather() {
    const picked = WEATHER_CATALOG[Math.floor(Math.random() * WEATHER_CATALOG.length)];
    const now = Date.now();
    const durationMs = 3 * 60 * 1000; // 3분 지속
    if (activeWeather && activeWeather.endTimer) clearTimeout(activeWeather.endTimer);
    activeWeather = {
      ...picked,
      startedAt: now,
      endsAt: now + durationMs,
      endTimer: setTimeout(() => {
        activeWeather = null;
        io.to(FISHING_ROOM_ID).emit('fishing_weather_state', getPublicWeatherState());
        scheduleNextWeather();
      }, durationMs)
    };
    const sysMsg = {
      id: 'fw_' + now,
      nickname: '🌈 호수 날씨 알림',
      cosmetics: { title: '', color: picked.color },
      rodLevel: 0,
      text: `3분간 [${picked.name}] 이벤트가 시작되었습니다! (${picked.desc})`,
      at: now
    };
    chatHistory.push(sysMsg);
    if (chatHistory.length > 60) chatHistory.shift();
    io.to(FISHING_ROOM_ID).emit('fishing_chat_message', sysMsg);
    io.to(FISHING_ROOM_ID).emit('fishing_weather_state', getPublicWeatherState());
  }

  function scheduleNextWeather() {
    if (nextWeatherTimer) clearTimeout(nextWeatherTimer);
    const delayMs = Math.round((12 + Math.random() * 6) * 60 * 1000);
    nextWeatherTimer = setTimeout(() => {
      if (fishers.size > 0 && !activeWeather) triggerRandomWeather();
      else scheduleNextWeather();
    }, delayMs);
  }
  scheduleNextWeather();

  // ================= 🎁 낚시터 배경 랜덤 선물 상자 이벤트 (선착순 1명 · 보물상자 1~3개) =================
  let activeGiftBox = null; // { id, xPct, yPct, spawnedAt, expiresAt, timeoutId }
  let nextGiftTimer = null;

  function getPublicGiftBoxState() {
    if (!activeGiftBox || Date.now() >= activeGiftBox.expiresAt) {
      return { active: false, serverNow: Date.now() };
    }
    return {
      active: true,
      id: activeGiftBox.id,
      xPct: activeGiftBox.xPct,
      yPct: activeGiftBox.yPct,
      spawnedAt: activeGiftBox.spawnedAt,
      expiresAt: activeGiftBox.expiresAt,
      serverNow: Date.now()
    };
  }

  function spawnRandomGiftBox() {
    if (activeGiftBox && activeGiftBox.timeoutId) clearTimeout(activeGiftBox.timeoutId);
    const now = Date.now();
    const durationMs = 45 * 1000; // 45초 유지
    const xPct = Math.round(14 + Math.random() * 72); // 14% ~ 86%
    const yPct = Math.round(16 + Math.random() * 44); // 16% ~ 60% (배경 하늘/호수)
    const giftId = 'gift_' + now + '_' + Math.random().toString(36).slice(2, 6);
    activeGiftBox = {
      id: giftId,
      xPct,
      yPct,
      spawnedAt: now,
      expiresAt: now + durationMs,
      timeoutId: setTimeout(() => {
        if (activeGiftBox && activeGiftBox.id === giftId) {
          activeGiftBox = null;
          io.to(FISHING_ROOM_ID).emit('fishing_gift_state', getPublicGiftBoxState());
          scheduleNextGiftBox();
        }
      }, durationMs)
    };
    const sysMsg = {
      id: 'fg_' + now,
      nickname: '🎁 선물 상자 알림',
      cosmetics: { title: '', color: '#facc15' },
      rodLevel: 0,
      text: '🎁 낚시터 배경에 반짝이는 선물 상자가 나타났습니다! 가장 먼저 클릭하면 보물상자 1~3개를 획득합니다!',
      at: now
    };
    chatHistory.push(sysMsg);
    if (chatHistory.length > 60) chatHistory.shift();
    io.to(FISHING_ROOM_ID).emit('fishing_chat_message', sysMsg);
    io.to(FISHING_ROOM_ID).emit('fishing_gift_state', getPublicGiftBoxState());
  }

  function scheduleNextGiftBox() {
    if (nextGiftTimer) clearTimeout(nextGiftTimer);
    const delayMs = Math.round((3 + Math.random() * 3) * 60 * 1000); // 3~6분마다 랜덤 등장
    nextGiftTimer = setTimeout(() => {
      if (fishers.size > 0 && !activeGiftBox) spawnRandomGiftBox();
      else scheduleNextGiftBox();
    }, delayMs);
  }
  scheduleNextGiftBox();

  function saveTopCatches() {
    try {
      fs.writeFileSync(TOP_CATCHES_FILE, JSON.stringify({ date: topCatchesDate, catches: topCatchesToday }, null, 2), 'utf8');
    } catch (_) {}
  }

  function syncEquippedRod(f) {
    if (!f) return null;
    if (!Array.isArray(f.rods)) f.rods = [];
    const eq = f.rods.find((r) => r.id === f.equippedRodId) || null;
    if (eq) {
      syncRodDailyBait(eq);
      f.hasRod = true;
      f.rodLevel = Math.max(0, Math.floor(Number(eq.level) || 0));
      f.rodFailBonus = Number(eq.failBonus) || 0;
      f.rodSkinLevel = (typeof eq.skinLevel === 'number') ? eq.skinLevel : null;
      f.rodBoundSkin = eq.boundSkin || null;
      f.rodAwakening = Math.max(0, Math.min(3, Math.floor(Number(eq.awakening) || 0)));
      f.rodCraftedBy = eq.craftedBy || '';
      f.rodDailyBaitLimit = getRodDailyBaitLimit(f.rodLevel, f.rodAwakening);
      f.rodDailyBaitUsed = eq.dailyBaitUsed || 0;
    } else {
      f.hasRod = false;
      f.rodLevel = 0;
      f.rodFailBonus = 0;
      f.rodSkinLevel = null;
      f.rodBoundSkin = null;
      f.rodAwakening = 0;
      f.rodCraftedBy = '';
      f.rodDailyBaitLimit = 0;
      f.rodDailyBaitUsed = 0;
    }
    return eq;
  }

  function ensureUserFishing(user) {
    if (!user) return null;
    ensureUserStatsStructure(user);
    const today = getTodayKstString();
    if (!user.game_data.fishing || typeof user.game_data.fishing !== 'object') {
      user.game_data.fishing = {
        rodLevel: 0,
        dailyBaitUsed: 0,
        dailyBaitBought: 0,
        extraBait: 0,
        lastBaitDate: today,
        dex: {},
        totalCaught: 0,
        totalGoldEarned: 0
      };
    }
    const f = user.game_data.fishing;
    if (f.lastBaitDate !== today) {
      f.lastBaitDate = today;
      f.dailyBaitUsed = 0;
      f.dailyBaitBought = 0;
    }
    if (typeof f.dailyBaitBought !== 'number' || Number.isNaN(f.dailyBaitBought)) f.dailyBaitBought = 0;
    if (typeof f.extraBait !== 'number' || Number.isNaN(f.extraBait)) f.extraBait = 0;
    syncEquippedRod(f);
    if (typeof f.dailyBaitUsed !== 'number' || Number.isNaN(f.dailyBaitUsed)) f.dailyBaitUsed = 0;
    if (!f.dex || typeof f.dex !== 'object') f.dex = {};
    if (typeof f.totalCaught !== 'number') f.totalCaught = 0;
    if (typeof f.totalGoldEarned !== 'number') f.totalGoldEarned = 0;
    if (typeof f.lotteryTickets !== 'number' || Number.isNaN(f.lotteryTickets)) f.lotteryTickets = 0;
    if (typeof f.treasureChests !== 'number' || Number.isNaN(f.treasureChests)) f.treasureChests = 0;
    if (!Array.isArray(f.claimedDexMilestones)) f.claimedDexMilestones = [];
    if (f.rodSkinLevel !== null && f.rodSkinLevel !== undefined) {
      const sk = Math.floor(Number(f.rodSkinLevel));
      if (Number.isNaN(sk) || sk < 0 || sk > f.rodLevel) f.rodSkinLevel = null;
      else f.rodSkinLevel = sk;
    } else {
      f.rodSkinLevel = null;
    }
    return f;
  }

  function getEffectiveRodSkinLevel(f) {
    if (!f) return 0;
    const lv = Math.max(0, Math.floor(Number(f.rodLevel) || 0));
    if (typeof f.rodSkinLevel === 'number' && !Number.isNaN(f.rodSkinLevel) && f.rodSkinLevel >= 0 && f.rodSkinLevel <= lv) {
      return Math.floor(f.rodSkinLevel);
    }
    return lv;
  }

  function resetTopCatchesIfNewDay() {
    const today = getTodayKstString();
    if (topCatchesDate !== today) {
      topCatchesDate = today;
      topCatchesToday = [];
      saveTopCatches();
    }
  }

  function getPublicFishersList() {
    return Array.from(fishers.values())
      .sort((a, b) => (a.seatIndex ?? 0) - (b.seatIndex ?? 0))
      .map((f) => ({
      socketId: f.socketId,
      clientId: f.clientId,
      seatIndex: f.seatIndex ?? 0,
      nickname: f.nickname,
      rodLevel: f.rodLevel || 0,
      rodSkinLevel: (typeof f.rodSkinLevel === 'number' ? f.rodSkinLevel : (f.rodLevel || 0)),
      rodBoundSkin: f.rodBoundSkin || null,
      rodAwakening: f.rodAwakening || 0,
      cosmetics: (economyHooks && typeof economyHooks.getUserCosmetics === 'function') ? economyHooks.getUserCosmetics(f.nickname) : (f.cosmetics || {}),
      status: f.status || 'IDLE', // IDLE | CASTING | BITING | CAUGHT
      lastCatchText: f.lastCatchText || ''
    }));
  }

  function broadcastPlazaState() {
    resetTopCatchesIfNewDay();
    io.to(FISHING_ROOM_ID).emit('fishing_plaza_state', {
      fishers: getPublicFishersList(),
      topCatches: topCatchesToday.slice(0, 5),
      tournament: getPublicTournamentState()
    });
    if (typeof onPlazaChange === 'function') onPlazaChange();
  }


  // ================= 🏆 낚시 대회 시스템 (관리자 개최 · 서버 상금 제공 · TOP 10 결과) =================
  let tournament = {
    active: false,
    id: null,
    durationMin: 10,
    prizePool: 100000,
    startedAt: 0,
    endsAt: 0,
    entries: new Map() // nickname -> { nickname, cosmetics, fishName, icon, tierLabel, tierColor, lengthCm, caughtAt }
  };

  function getTournamentSortedList() {
    return Array.from(tournament.entries.values())
      .sort((a, b) => (b.lengthCm - a.lengthCm) || (a.caughtAt - b.caughtAt));
  }

  function getPublicTournamentState() {
    const sorted = getTournamentSortedList();
    return {
      active: tournament.active,
      id: tournament.id,
      durationMin: tournament.durationMin,
      prizePool: tournament.prizePool,
      startedAt: tournament.startedAt,
      endsAt: tournament.endsAt,
      serverNow: Date.now(),
      topPreview: sorted.slice(0, 10).map((e, idx) => ({ rank: idx + 1, ...e }))
    };
  }

  function broadcastTournamentState() {
    io.to(FISHING_ROOM_ID).emit('fishing_tournament_state', getPublicTournamentState());
  }

  function finishTournament() {
    if (!tournament.active) return;
    tournament.active = false;
    const sorted = getTournamentSortedList();
    const top10 = sorted.slice(0, 10).map((e, idx) => ({
      rank: idx + 1,
      ...e,
      prizeWon: 0
    }));

    const pool = Math.max(0, Math.floor(Number(tournament.prizePool) || 0));
    if (pool > 0 && top10.length > 0 && economyHooks && economyHooks.addUserGold) {
      if (top10.length === 1) {
        top10[0].prizeWon = pool;
      } else if (top10.length === 2) {
        top10[0].prizeWon = Math.floor(pool * 0.65);
        top10[1].prizeWon = pool - top10[0].prizeWon;
      } else {
        const p2 = Math.floor(pool * 0.30);
        const p3 = Math.floor(pool * 0.20);
        const p1 = pool - p2 - p3;
        top10[0].prizeWon = p1;
        top10[1].prizeWon = p2;
        top10[2].prizeWon = p3;
      }
      top10.forEach((row) => {
        if (row.prizeWon > 0) {
          economyHooks.addUserGold(row.nickname, row.prizeWon, 'fishing_tournament_prize');
        }
      });
    }

    // 순위(입상)에 들지 못한 참가자 전원에게 참가상 50,000 스타 지급 (서버 제공)
    const PARTICIPATION_PRIZE = 50000;
    if (economyHooks && economyHooks.addUserGold) {
      sorted.forEach((entry, idx) => {
        const topRow = idx < 10 ? top10[idx] : null;
        if (!topRow || (topRow.prizeWon || 0) <= 0) {
          economyHooks.addUserGold(entry.nickname, PARTICIPATION_PRIZE, 'fishing_tournament_participation');
          if (topRow) {
            topRow.prizeWon = PARTICIPATION_PRIZE;
            topRow.isParticipationPrize = true;
          }
        }
      });
    }

    io.to(FISHING_ROOM_ID).emit('fishing_tournament_ended', {
      id: tournament.id,
      durationMin: tournament.durationMin,
      prizePool: pool,
      participationPrize: PARTICIPATION_PRIZE,
      participantCount: sorted.length,
      top10
    });
    broadcastTournamentState();
  }

  setInterval(() => {
    if (tournament.active && Date.now() >= tournament.endsAt) {
      finishTournament();
    }
  }, 1000);

  app.post('/api/fishing/tournament/start', (req, res) => {
    const pw = String(req.body?.adminPassword || req.headers['x-admin-password'] || '').trim();
    const authed = typeof isAdminAuthorized === 'function' && isAdminAuthorized(req);
    if (!authed) {
      return res.status(403).json({ ok: false, error: '관리자 비밀번호가 일치하지 않습니다.' });
    }
    if (tournament.active) {
      return res.status(400).json({ ok: false, error: '이미 진행 중인 낚시 대회가 있습니다.' });
    }
    const allowedMin = [5, 10, 30];
    const reqMin = Number(req.body?.durationMin);
    const durationMin = allowedMin.includes(reqMin) ? reqMin : 10;
    const prizePool = Math.max(0, Math.min(1000000000, Math.floor(Number(req.body?.prizePool) || 0)));

    const now = Date.now();
    tournament = {
      active: true,
      id: 'ft_' + now,
      durationMin,
      prizePool,
      startedAt: now,
      endsAt: now + durationMin * 60 * 1000,
      entries: new Map()
    };
    broadcastTournamentState();
    return res.json({ ok: true, tournament: getPublicTournamentState() });
  });

  // REST: 관리자 심해 몬스터 즉시 소환
  app.post('/api/fishing/boss/spawn', (req, res) => {
    const authed = typeof isAdminAuthorized === 'function' && isAdminAuthorized(req);
    if (!authed) return res.status(403).json({ ok: false, error: '관리자 계정만 몬스터를 소환할 수 있습니다.' });
    if (bossRaid.active) return res.status(400).json({ ok: false, error: '이미 심해 몬스터 레이드가 진행 중입니다.' });
    startBossRaid(req.body?.monsterId || null);
    return res.json({ ok: true, boss: getPublicBossState() });
  });

  app.post('/api/fishing/tournament/stop', (req, res) => {
    const pw = String(req.body?.adminPassword || req.headers['x-admin-password'] || '').trim();
    const authed = typeof isAdminAuthorized === 'function' && isAdminAuthorized(req);
    if (!authed) {
      return res.status(403).json({ ok: false, error: '관리자 비밀번호가 일치하지 않습니다.' });
    }
    if (!tournament.active) {
      return res.status(400).json({ ok: false, error: '진행 중인 대회가 없습니다.' });
    }
    finishTournament();
    return res.json({ ok: true });
  });

  // REST: 낚시터 배경 랜덤 선물 상자 선착순 수령 (보물상자 1~3개 지급)
  app.post('/api/fishing/claim-gift', (req, res) => {
    const { nickname, giftId, isTrusted } = req.body || {};
    const u = resolveAuthedFishingUser(req);
    if (!u) return res.status(401).json({ ok: false, error: '인증 정보가 누락되었거나 만료되었습니다. 새로고침(F5) 후 다시 시도해 주세요.' });
    const now = Date.now();
    // 1. 최근 3분 이내 물고기 3마리 이상 포획 필수 (잠수 유저 선물 상자 먹튀 차단)
    const recentCnt = getRecentCatchCount(u.nickname, now);
    if (recentCnt < BOSS_MIN_RECENT_CATCHES) {
      return res.status(403).json({
        ok: false,
        error: `⚠️ 최근 3분 이내 물고기를 3마리 이상 낚은 유저만 선물 상자를 획득할 수 있습니다! (현재 ${recentCnt}/3마리)`
      });
    }
    if (!activeGiftBox || activeGiftBox.id !== giftId || now >= activeGiftBox.expiresAt) {
      return res.status(409).json({ ok: false, error: '아쉽네요! 이미 다른 유저가 먼저 획득했거나 사라진 선물 상자입니다.' });
    }
    // 2. 스크립트 합성 클릭(isTrusted=false) 또는 비정상 초고속 반응(< 350ms) 차단 + 관리자 알림
    const reactionMs = now - (activeGiftBox.spawnedAt || 0);
    if (isTrusted === false || reactionMs < 350) {
      notifyAdminsMacroSuspect(
        u.nickname,
        `배경 선물 상자 매크로/자동클릭 의심 차단 (isTrusted=${String(isTrusted)}, 반응속도 ${reactionMs}ms)`
      );
      return res.status(403).json({
        ok: false,
        error: '🤖 비정상적인 자동 클릭(매크로)이 감지되어 선물 상자 획득이 차단되었습니다.'
      });
    }
    // 선착순 1명 즉시 선점 처리
    const claimed = activeGiftBox;
    if (claimed.timeoutId) clearTimeout(claimed.timeoutId);
    activeGiftBox = null;

    const f = ensureUserFishing(u);
    const boxesWon = 1 + Math.floor(Math.random() * 3); // 1~3개 랜덤
    f.treasureChests = (f.treasureChests || 0) + boxesWon;
    u.updated_at = new Date().toISOString();
    saveUsersDB(usersDB);

    const winnerCos = (economyHooks && typeof economyHooks.getUserCosmetics === 'function')
      ? economyHooks.getUserCosmetics(u.nickname)
      : {};
    const sysMsg = {
      id: 'fgc_' + Date.now(),
      nickname: '🎁 선물 상자 알림',
      cosmetics: { title: '', color: '#fde047' },
      rodLevel: 0,
      text: `🎉 ${u.nickname}님이 배경 선물 상자를 가장 먼저 획득하여 잠긴 보물상자 ${boxesWon}개를 받았습니다!`,
      at: Date.now()
    };
    chatHistory.push(sysMsg);
    if (chatHistory.length > 60) chatHistory.shift();
    io.to(FISHING_ROOM_ID).emit('fishing_chat_message', sysMsg);
    io.to(FISHING_ROOM_ID).emit('fishing_gift_claimed', {
      giftId: claimed.id,
      winnerNickname: u.nickname,
      winnerCosmetics: winnerCos,
      boxesWon,
      xPct: claimed.xPct,
      yPct: claimed.yPct
    });
    io.to(FISHING_ROOM_ID).emit('fishing_gift_state', getPublicGiftBoxState());
    scheduleNextGiftBox();

    return res.json({
      ok: true,
      boxesWon,
      treasureChests: f.treasureChests,
      message: `🎁 선착순 선물 상자 획득! 잠긴 보물상자 +${boxesWon}개 (총 ${f.treasureChests}개)`
    });
  });

  // REST: 심해 잠긴 보물상자 열기 (꽝 / 복권 / 추가 미끼 / 랜덤 스타 1만~50만 / 구슬 스킨)
  app.post('/api/fishing/open-chest', (req, res) => {
    const nick = String(req.body?.nickname || '').trim();
    const u = resolveAuthedFishingUser(req);
    if (!u) return res.status(401).json({ ok: false, error: '인증 정보가 누락되었거나 만료되었습니다. 새로고침(F5) 후 다시 시도해 주세요.' });
    const f = ensureUserFishing(u);
    if ((f.treasureChests || 0) <= 0) {
      return res.status(400).json({ ok: false, error: '보유한 잠긴 보물상자가 없습니다.' });
    }
    f.treasureChests -= 1;

    const r = Math.random() * 100;
    let rewardType = 'empty';
    let title = '💨 꽝! 텅 빈 상자였습니다...';
    let detail = '낡은 조개껍데기만 들어있었습니다.';
    let goldAdded = 0;
    let baitAdded = 0;
    let ticketsAdded = 0;
    let skinResult = null;
    let newGold = u.gold;

    if (r < 20) {
      // 20%: 꽝
      rewardType = 'empty';
    } else if (r < 55) {
      // 35%: 황금 낚시 복권 1~2장
      rewardType = 'ticket';
      ticketsAdded = Math.random() < 0.3 ? 2 : 1;
      f.lotteryTickets = (f.lotteryTickets || 0) + ticketsAdded;
      title = `🎫 황금 낚시 복권 +${ticketsAdded}장!`;
      detail = '상자 안에서 반짝이는 낚시 복권을 발견했습니다!';
    } else if (r < 80) {
      // 25%: 추가 미끼 5~30개
      rewardType = 'bait';
      baitAdded = 5 + Math.floor(Math.random() * 26);
      f.extraBait = (f.extraBait || 0) + baitAdded;
      title = `🪱 추가 미끼 +${baitAdded}개!`;
      detail = '싱싱한 특제 미끼가 가득 들어있었습니다!';
    } else if (r < 97) {
      // 17%: 랜덤 스타 10,000 ~ 500,000 스타
      rewardType = 'star';
      const steps = 1 + Math.floor(Math.random() * 50); // 1만 ~ 50만
      goldAdded = steps * 10000;
      newGold = economyHooks.addUserGold(u.nickname, goldAdded, 'fishing_chest_star');
      title = `⭐ +${goldAdded.toLocaleString()} 스타!`;
      detail = goldAdded >= 300000 ? '대박 금화가 쏟아져 나왔습니다!!' : '반짝이는 스타 주머니를 발견했습니다!';
    } else {
      // 3%: 구슬 스킨 1종 (중복 시 10% 스타 환급)
      rewardType = 'skin';
      const picked = pickWeightedMarbleSkinForChest();
      if (!u.game_data.cosmetics) u.game_data.cosmetics = { ownedTitles: [], equippedTitle: '', ownedColors: [], equippedColor: '', ownedMarbleSkins: [], equippedMarbleSkin: '' };
      if (!Array.isArray(u.game_data.cosmetics.ownedMarbleSkins)) u.game_data.cosmetics.ownedMarbleSkins = [];
      const skinId = 'skin_' + picked.value;
      const prevCount = (u.game_data.cosmetics.itemCounts && u.game_data.cosmetics.itemCounts[skinId]) || 0;
      const newCount = economyHooks.addCosmeticItem(u, 'marbleSkin', skinId, 1);
      title = prevCount > 0 ? `🔮 ${picked.name} (보유 ×${newCount})` : `🔮 ${picked.name} 스킨 획득!`;
      detail = prevCount > 0
        ? `창고에 누적되었습니다! (총 ${newCount}개 · 거래소 판매 가능)`
        : '내정보 창고에서 장착하거나 거래소에 판매할 수 있습니다!';
      skinResult = { ...picked, id: skinId, isDuplicate: prevCount > 0, count: newCount };
    }

    u.updated_at = new Date().toISOString();
    saveUsersDB(usersDB);

    if (goldAdded >= 300000 || (rewardType === 'skin' && skinResult && !skinResult.isDuplicate)) {
      const sysMsg = {
        id: 'fchest_' + Date.now(),
        nickname: '💎 보물상자 알림',
        cosmetics: { title: '', color: '#38bdf8' },
        rodLevel: f.rodLevel || 0,
        text: `🧰 ${u.nickname}님이 심해 보물상자에서 [${title}]을(를) 뽑았습니다!`,
        at: Date.now()
      };
      chatHistory.push(sysMsg);
      if (chatHistory.length > 60) chatHistory.shift();
      io.to(FISHING_ROOM_ID).emit('fishing_chat_message', sysMsg);
    }

    return res.json({
      ok: true,
      rewardType,
      title,
      detail,
      goldAdded,
      baitAdded,
      ticketsAdded,
      skinResult,
      treasureChests: f.treasureChests,
      lotteryTickets: f.lotteryTickets,
      baitRemaining: computeBaitRemaining(f),
      gold: newGold
    });
  });

  // REST: 황금 낚시 복권 긁기
  app.post('/api/fishing/scratch-ticket', (req, res) => {
    const nick = String(req.body?.nickname || '').trim();
    const u = resolveAuthedFishingUser(req);
    if (!u) return res.status(401).json({ ok: false, error: '인증 정보가 누락되었거나 만료되었습니다. 새로고침(F5) 후 다시 시도해 주세요.' });
    const f = ensureUserFishing(u);
    if ((f.lotteryTickets || 0) <= 0) {
      return res.status(400).json({ ok: false, error: '보유한 황금 낚시 복권이 없습니다. (심해 보물상자에서 획득 가능)' });
    }
    f.lotteryTickets -= 1;
    const roll = Math.random() * 100;
    let reward = 0;
    let label = '💨 꽝! 다음 기회에...';
    let isJackpot = false;
    // 1등 150만 스타 · 1장당 평균 기댓값 정확히 120,000 스타 (2%+5%+10%+20%+25%+25%+13%=100%)
    if (roll < 2.0) {
      reward = 1500000; label = '👑 1등 대박 잭팟!!'; isJackpot = true;
    } else if (roll < 7.0) {
      reward = 500000; label = '💎 2등 초고액 당첨!'; isJackpot = true;
    } else if (roll < 17.0) {
      reward = 300000; label = '🌟 3등 당첨!';
    } else if (roll < 37.0) {
      reward = 100000; label = '✨ 4등 당첨!';
    } else if (roll < 62.0) {
      reward = 50000; label = '🎉 5등 당첨!';
    } else if (roll < 87.0) {
      reward = 10000; label = '🪙 6등 당첨!';
    }
    let newGold = u.gold;
    if (reward > 0) {
      newGold = economyHooks.addUserGold(u.nickname, reward, 'fishing_lottery');
    }
    u.updated_at = new Date().toISOString();
    saveUsersDB(usersDB);

    if (isJackpot) {
      const sysMsg = {
        id: 'flot_' + Date.now(),
        nickname: '🎫 복권 당첨 알림',
        cosmetics: { title: '', color: '#fde047' },
        rodLevel: f.rodLevel || 0,
        text: `🎊 ${u.nickname}님이 황금 낚시 복권에서 [${label} +${reward.toLocaleString()} 스타]에 당첨되었습니다!!`,
        at: Date.now()
      };
      chatHistory.push(sysMsg);
      if (chatHistory.length > 60) chatHistory.shift();
      io.to(FISHING_ROOM_ID).emit('fishing_chat_message', sysMsg);
    }

    return res.json({
      ok: true,
      reward,
      label,
      isJackpot,
      lotteryTickets: f.lotteryTickets,
      gold: newGold
    });
  });

  // REST: 내 낚시 상태(미끼, 낚싯대, 도감, 카탈로그) 조회
  app.get('/api/fishing/state', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const nick = String(req.query?.nickname || '').trim();
    const u = nick ? findUserByNickname(nick) : null;
    if (!u) return res.status(401).json({ ok: false, error: '인증 정보가 누락되었거나 만료되었습니다. 새로고침(F5) 후 다시 시도해 주세요.' });
    const f = ensureUserFishing(u);
    resetTopCatchesIfNewDay();
    const nextUpgrade = ROD_UPGRADE_TABLE.find((x) => x.level === f.rodLevel + 1) || null;
    const bCfg = getBaitConfig();
    return res.json({
      ok: true,
      gold: u.gold,
      baitLimitEnabled: bCfg.limitEnabled,
      dailyBaitLimit: bCfg.dailyLimit,
      dailyBaitUsed: f.dailyBaitUsed,
      dailyBaitBought: f.dailyBaitBought || 0,
      maxDailyBaitBuy: (typeof bCfg.maxDailyBaitBuy === 'number' && bCfg.maxDailyBaitBuy >= 1) ? Math.floor(bCfg.maxDailyBaitBuy) : MAX_DAILY_BAIT_BUY,
      extraBaitPrice: (typeof bCfg.baitPrice === 'number' && !Number.isNaN(bCfg.baitPrice) && bCfg.baitPrice >= 0) ? Math.floor(bCfg.baitPrice) : EXTRA_BAIT_PRICE,
      extraBait: f.extraBait || 0,
      baitRemaining: computeBaitRemaining(f),
      hasRod: Boolean(f.hasRod),
      rodProtectTickets: Math.max(0, Math.floor(Number((u.game_data?.cosmetics?.itemCounts?.rod_protect_ticket) || 0))),
      rods: (f.rods || []).map((r) => {
        syncRodDailyBait(r);
        const lim = getRodDailyBaitLimit(r.level || 0, r.awakening || 0);
        const used = Math.max(0, Math.floor(Number(r.dailyBaitUsed) || 0));
        return { ...r, dailyBaitLimit: lim, dailyBaitUsed: used, dailyBaitRemaining: Math.max(0, lim - used) };
      }),
      equippedRodId: f.equippedRodId || '',
      rodLevel: f.rodLevel,
      rodBoundSkin: f.rodBoundSkin || null,
      rodAwakening: f.rodAwakening || 0,
      rodCraftedBy: f.rodCraftedBy || '',
      awakeningSpecs: AWAKENING_SPECS,
      materialCounts: (u.game_data?.cosmetics?.itemCounts || {}),
      rodDailyBaitLimit: f.rodDailyBaitLimit || 0,
      rodDailyBaitUsed: f.rodDailyBaitUsed || 0,
      rodSkinLevel: getEffectiveRodSkinLevel(f),
      rodBoundSkin: f.rodBoundSkin || null,
      rodDailyBaitLimit: f.rodDailyBaitLimit || 0,
      rodDailyBaitUsed: f.rodDailyBaitUsed || 0,
      baitRemaining: computeBaitRemaining(f),
      rodFailBonus: f.rodFailBonus || 0,
      maxRodLevel: MAX_ROD_LEVEL,
      bonuses: getRodBonuses(f.rodLevel),
      nextUpgrade,
      upgradeTable: ROD_UPGRADE_TABLE,
      dex: f.dex,
      lotteryTickets: f.lotteryTickets || 0,
      treasureChests: f.treasureChests || 0,
      claimedDexMilestones: f.claimedDexMilestones || [],
      totalCaught: f.totalCaught,
      totalGoldEarned: f.totalGoldEarned,
      catalog: FISH_CATALOG,
      tiers: TIER_META,
      weather: getPublicWeatherState(),
      topCatches: topCatchesToday.slice(0, 5)
    });
  });


  // REST: 추가 미끼 구매 (개당 10,000 스타, 일일 최대 100개)
  app.post('/api/fishing/buy-bait', (req, res) => {
    const nick = String(req.body?.nickname || '').trim();
    const qty = Math.max(1, Math.min(100, Math.floor(Number(req.body?.quantity) || 1)));
    const u = resolveAuthedFishingUser(req);
    if (!u) return res.status(401).json({ ok: false, error: '인증 정보가 누락되었거나 만료되었습니다. 새로고침(F5) 후 다시 시도해 주세요.' });
    const f = ensureUserFishing(u);
    const bCfgBuy = getBaitConfig();
    const unitBaitPrice = (typeof bCfgBuy.baitPrice === 'number' && !Number.isNaN(bCfgBuy.baitPrice) && bCfgBuy.baitPrice >= 0) ? Math.floor(bCfgBuy.baitPrice) : EXTRA_BAIT_PRICE;
    const cost = qty * unitBaitPrice;
    if (u.gold < cost) {
      return res.status(400).json({ ok: false, error: `스타가 부족합니다. (${cost.toLocaleString()} 스타 필요)` });
    }
    economyHooks.addUserGold(u.nickname, -cost, 'fishing_buy_bait');
    f.dailyBaitBought = (f.dailyBaitBought || 0) + qty;
    f.extraBait = (f.extraBait || 0) + qty;
    u.updated_at = new Date().toISOString();
    saveUsersDB(usersDB);
    const totalRem = computeBaitRemaining(f);
    return res.json({
      ok: true,
      gold: u.gold,
      dailyBaitBought: f.dailyBaitBought,
      maxDailyBaitBuy: Number(bCfgBuy.maxDailyBaitBuy || 100),
      extraBaitPrice: unitBaitPrice,
      extraBait: f.extraBait,
      baitRemaining: totalRem,
      message: `🪱 미끼 ${qty}개를 구매했습니다! (-${cost.toLocaleString()} 스타)`
    });
  });

  // REST: 관리자 전용 날씨 즉시 소환 (무료)
  app.post('/api/fishing/weather/spawn', (req, res) => {
    if (!isAdminAuthorized || !isAdminAuthorized(req)) {
      return res.status(403).json({ ok: false, error: '관리자만 날씨를 소환할 수 있습니다.' });
    }
    triggerRandomWeather();
    return res.json({ ok: true, weather: getPublicWeatherState(), message: `🌈 [${activeWeather ? activeWeather.name : '특수 날씨'}] 소환 완료!` });
  });

  // REST: 스타로 낚시터 전체 날씨 소환 (80만 스타)
  app.post('/api/fishing/summon-weather', (req, res) => {
    const nick = String(req.body?.nickname || '').trim();
    const u = resolveAuthedFishingUser(req);
    if (!u) return res.status(401).json({ ok: false, error: '인증 정보가 누락되었거나 만료되었습니다. 새로고침(F5) 후 다시 시도해 주세요.' });
    if (activeWeather && Date.now() < activeWeather.endsAt) {
      const remSec = Math.ceil((activeWeather.endsAt - Date.now()) / 1000);
      return res.status(400).json({ ok: false, error: `이미 특수 날씨가 진행 중입니다! (${remSec}초 남음)` });
    }
    const COST = 800000;
    if ((u.gold || 0) < COST) {
      return res.status(400).json({ ok: false, error: `스타가 부족합니다. (필요: ${COST.toLocaleString()} 스타)` });
    }
    const newGold = economyHooks.addUserGold(u.nickname, -COST, 'fishing_summon_weather');
    const picked = WEATHER_CATALOG[Math.floor(Math.random() * WEATHER_CATALOG.length)];
    const now = Date.now();
    const durationMs = 3 * 60 * 1000;
    if (activeWeather && activeWeather.endTimer) clearTimeout(activeWeather.endTimer);
    activeWeather = {
      ...picked,
      startedAt: now,
      endsAt: now + durationMs,
      summonedBy: u.nickname,
      endTimer: setTimeout(() => {
        activeWeather = null;
        io.to(FISHING_ROOM_ID).emit('fishing_weather_state', getPublicWeatherState());
        scheduleNextWeather();
      }, durationMs)
    };
    const pub = getPublicWeatherState();
    io.to(FISHING_ROOM_ID).emit('fishing_weather_state', pub);
    const sysMsg = {
      id: 'fw_' + now,
      nickname: '🌈 날씨 소환',
      cosmetics: { title: '', color: picked.color || '#fde047' },
      rodLevel: 0,
      text: `✨ ${u.nickname}님이 ${COST.toLocaleString()} 스타로 [${picked.name}]을(를) 소환했습니다! (${picked.desc})`,
      at: now
    };
    chatHistory.push(sysMsg);
    if (chatHistory.length > 60) chatHistory.shift();
    io.to(FISHING_ROOM_ID).emit('fishing_chat_message', sysMsg);
    if (economyHooks.broadcastGlobalAnnouncement) {
      economyHooks.broadcastGlobalAnnouncement({ type: 'weather_summon', text: sysMsg.text });
    }
    return res.json({ ok: true, gold: newGold, weather: pub, message: `🌈 ${picked.name} 소환 완료!` });
  });

  // REST: 스타로 심해 보스 즉시 소환 (120만 스타)
  app.post('/api/fishing/summon-boss', (req, res) => {
    const nick = String(req.body?.nickname || '').trim();
    const u = resolveAuthedFishingUser(req);
    if (!u) return res.status(401).json({ ok: false, error: '인증 정보가 누락되었거나 만료되었습니다. 새로고침(F5) 후 다시 시도해 주세요.' });
    if (bossRaid && bossRaid.active) {
      return res.status(400).json({ ok: false, error: '이미 심해 보스 레이드가 진행 중입니다!' });
    }
    const COST = 1200000;
    if ((u.gold || 0) < COST) {
      return res.status(400).json({ ok: false, error: `스타가 부족합니다. (필요: ${COST.toLocaleString()} 스타)` });
    }
    const newGold = economyHooks.addUserGold(u.nickname, -COST, 'fishing_summon_boss');
    startBossRaid(null);
    const bossName = bossRaid && bossRaid.monster ? bossRaid.monster.name : '심해 보스';
    const sysMsg = {
      id: 'fb_' + Date.now(),
      nickname: '⚔️ 보스 소환',
      cosmetics: { title: '', color: '#fb7185' },
      rodLevel: 0,
      text: `🚨 ${u.nickname}님이 ${COST.toLocaleString()} 스타로 [${bossName}] 레이드를 즉시 소환했습니다!`,
      at: Date.now()
    };
    chatHistory.push(sysMsg);
    if (chatHistory.length > 60) chatHistory.shift();
    io.to(FISHING_ROOM_ID).emit('fishing_chat_message', sysMsg);
    if (economyHooks.broadcastGlobalAnnouncement) {
      economyHooks.broadcastGlobalAnnouncement({ type: 'boss_summon', text: sysMsg.text });
    }
    return res.json({ ok: true, gold: newGold, message: `⚔️ ${bossName} 소환 완료!` });
  });

  // REST: +11강 낚싯대 3단계 각성 (파괴 없음)
  app.post('/api/fishing/awaken-rod', (req, res) => {
    const nick = String(req.body?.nickname || '').trim();
    const u = resolveAuthedFishingUser(req);
    if (!u) return res.status(401).json({ ok: false, error: '인증 정보가 누락되었거나 만료되었습니다. 새로고침(F5) 후 다시 시도해 주세요.' });
    const f = ensureUserFishing(u);
    const eqRod = syncEquippedRod(f);
    if (!eqRod || (eqRod.level || 0) < 11) {
      return res.status(400).json({ ok: false, error: '+11강 낚싯대를 장착한 상태에서만 각성할 수 있습니다.' });
    }
    const curAw = Math.max(0, Math.floor(Number(eqRod.awakening) || 0));
    if (curAw >= 3) {
      return res.status(400).json({ ok: false, error: '이미 최고 각성(3각성) 상태입니다!' });
    }
    const spec = AWAKENING_SPECS.find((x) => x.level === curAw + 1);
    if (!spec) return res.status(400).json({ ok: false, error: '각성 정보를 찾을 수 없습니다.' });
    if ((u.gold || 0) < spec.cost) {
      return res.status(400).json({ ok: false, error: `각성 비용(${spec.cost.toLocaleString()} 스타)이 부족합니다.` });
    }
    const counts = (u.game_data?.cosmetics?.itemCounts) || {};
    for (const [matId, reqQty] of Object.entries(spec.materials)) {
      const have = Math.max(0, Math.floor(Number(counts[matId] || 0)));
      if (have < reqQty) {
        return res.status(400).json({ ok: false, error: `각성 재료가 부족합니다! (${matId}: ${have}/${reqQty})` });
      }
    }
    economyHooks.addUserGold(u.nickname, -spec.cost, 'fishing_rod_awaken');
    for (const [matId, reqQty] of Object.entries(spec.materials)) {
      counts[matId] = Math.max(0, Math.floor(Number(counts[matId] || 0)) - reqQty);
      if (counts[matId] <= 0) {
        delete counts[matId];
        if (Array.isArray(u.game_data.cosmetics.ownedMaterials)) {
          u.game_data.cosmetics.ownedMaterials = u.game_data.cosmetics.ownedMaterials.filter((x) => x !== matId);
        }
      }
    }
    eqRod.awakening = spec.level;
    if (!eqRod.craftedBy) {
      eqRod.craftedBy = u.nickname;
      eqRod.craftedAt = new Date().toISOString();
    }
    syncEquippedRod(f);
    u.updated_at = new Date().toISOString();
    saveUsersDB(usersDB);

    for (const fs of fishers.values()) {
      if (fs.nickname === u.nickname) fs.rodAwakening = f.rodAwakening;
    }
    broadcastPlazaState();
    const annText = `⚡ [+11강 낚싯대 ${spec.level}각성!] ${u.nickname}님이 낚싯대 [${spec.level}각성]에 성공했습니다!`;
    const sysMsg = { id: 'faw_' + Date.now(), nickname: '⚡ 대장간 각성', cosmetics: { title: '', color: '#fde047' }, rodLevel: 11, text: annText, at: Date.now() };
    chatHistory.push(sysMsg);
    if (chatHistory.length > 60) chatHistory.shift();
    io.to(FISHING_ROOM_ID).emit('fishing_chat_message', sysMsg);
    if (economyHooks.broadcastGlobalAnnouncement) {
      economyHooks.broadcastGlobalAnnouncement({ type: 'rod_awakening', text: annText });
    }
    return res.json({
      ok: true,
      gold: u.gold,
      rods: f.rods || [],
      rodAwakening: f.rodAwakening,
      rodDailyBaitLimit: f.rodDailyBaitLimit,
      rodDailyBaitUsed: f.rodDailyBaitUsed,
      materialCounts: counts,
      message: `⚡ +11강 낚싯대 [${spec.level}각성] 완료! (일일 횟수 ${f.rodDailyBaitLimit}회)`
    });
  });

  // REST: +11강 명예의 전당
  app.get('/api/fishing/hall-of-fame', (req, res) => {
    const entries = [];
    for (const u of usersDB) {
      const rods = u.game_data?.fishing?.rods || [];
      for (const r of rods) {
        if ((r.level || 0) >= 11) {
          entries.push({
            owner: u.nickname,
            craftedBy: r.craftedBy || u.nickname,
            craftedAt: r.craftedAt || u.updated_at || '',
            awakening: Number(r.awakening) || 0,
            boundSkin: r.boundSkin || null
          });
        }
      }
    }
    entries.sort((a, b) => (b.awakening - a.awakening) || String(a.craftedAt).localeCompare(String(b.craftedAt)));
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true, entries });
  });

  // REST: 낚싯대 스킨 영구 귀속 (창고 스킨 1개 소모 -> 해당 낚싯대에 영구 귀속)
  app.post('/api/fishing/bind-rod-skin', (req, res) => {
    const nick = String(req.body?.nickname || '').trim();
    const rodId = String(req.body?.rodId || '').trim();
    const skinId = String(req.body?.skinId || '').trim();
    const u = resolveAuthedFishingUser(req);
    if (!u) return res.status(401).json({ ok: false, error: '인증 정보가 누락되었거나 만료되었습니다. 새로고침(F5) 후 다시 시도해 주세요.' });
    const f = ensureUserFishing(u);
    const targetRod = (f.rods || []).find((r) => r.id === rodId);
    if (!targetRod) return res.status(404).json({ ok: false, error: '대상 낚싯대를 찾을 수 없습니다.' });

    const ROD_SKIN_META = {
      rod_skin_bamboo: { id: 'rod_skin_bamboo', name: '🎋 대나무 명인 낚싯대 스킨', value: 'rod_bamboo' },
      rod_skin_sakura: { id: 'rod_skin_sakura', name: '🌸 벚꽃 에디션 낚싯대 스킨', value: 'rod_sakura' },
      rod_skin_cyber: { id: 'rod_skin_cyber', name: '⚡ 사이버 플라즈마 낚싯대 스킨', value: 'rod_cyber' },
      rod_skin_dragon: { id: 'rod_skin_dragon', name: '🐉 황금 용신 낚싯대 스킨', value: 'rod_dragon' },
      rod_skin_ice: { id: 'rod_skin_ice', name: '❄️ 프로스트 빙결 낚싯대 스킨', value: 'rod_ice' },
      rod_skin_inferno: { id: 'rod_skin_inferno', name: '🔥 지옥불 인페르노 낚싯대 스킨', value: 'rod_inferno' },
      rod_skin_phantom: { id: 'rod_skin_phantom', name: '👻 팬텀 고스트 낚싯대 스킨', value: 'rod_phantom' },
      rod_skin_galaxy: { id: 'rod_skin_galaxy', name: '🪐 블랙홀 은하수 낚싯대 스킨', value: 'rod_galaxy' },
      rod_skin_abyss: { id: 'rod_skin_abyss', name: '🔱 심연의 포세이돈 스킨', value: 'rod_abyss' },
      rod_skin_celestial: { id: 'rod_skin_celestial', name: '🌌 성운의 창세 스킨', value: 'rod_celestial' }
    };
    const skinMeta = ROD_SKIN_META[skinId];
    if (!skinMeta) return res.status(400).json({ ok: false, error: '존재하지 않는 낚싯대 스킨입니다.' });
    const cos = u.game_data?.cosmetics || {};
    const curCnt = Math.max(0, Math.floor(Number((cos.itemCounts && cos.itemCounts[skinId]) || 0)));
    if (curCnt <= 0) return res.status(400).json({ ok: false, error: '보유 중인 낚싯대 스킨이 없습니다.' });

    cos.itemCounts[skinId] = curCnt - 1;
    if (cos.itemCounts[skinId] <= 0) {
      delete cos.itemCounts[skinId];
      if (Array.isArray(cos.ownedRodSkins)) cos.ownedRodSkins = cos.ownedRodSkins.filter((x) => x !== skinId);
    }
    targetRod.boundSkin = { ...skinMeta };
    syncEquippedRod(f);
    u.updated_at = new Date().toISOString();
    saveUsersDB(usersDB);

    for (const fs of fishers.values()) {
      if (fs.nickname === u.nickname) {
        fs.rodBoundSkin = f.rodBoundSkin || null;
      }
    }
    broadcastPlazaState();
    return res.json({
      ok: true,
      rods: f.rods || [],
      equippedRodId: f.equippedRodId || '',
      rodBoundSkin: f.rodBoundSkin || null,
      cosmetics: u.game_data.cosmetics,
      message: `✨ [${skinMeta.name}]이(가) +${targetRod.level || 0}강 낚싯대에 영구 귀속되었습니다!`
    });
  });


  // REST: 관리자 전용 전체 유저 낚싯대 일일 미끼 사용 횟수 초기화
  app.post('/api/admin/fishing/reset-all-daily-bait', (req, res) => {
    if (typeof isAdminAuthorized === 'function' && !isAdminAuthorized(req)) {
      return res.status(403).json({ ok: false, error: '관리자 권한이 필요합니다.' });
    }
    const today = getTodayKstString();
    let affectedUsers = 0;
    let affectedRods = 0;
    if (Array.isArray(usersDB)) {
      for (const u of usersDB) {
        if (!u || !u.game_data || !u.game_data.fishing) continue;
        const f = u.game_data.fishing;
        f.dailyBaitUsed = 0;
        f.rodDailyBaitUsed = 0;
        f.lastBaitDate = today;
        affectedUsers++;
        if (Array.isArray(f.rods)) {
          for (const r of f.rods) {
            r.dailyBaitUsed = 0;
            r.lastBaitDate = today;
            affectedRods++;
          }
        }
        syncEquippedRod(f);
      }
      saveUsersDB(usersDB);
    }
    io.to(FISHING_ROOM_ID).emit('fishing_daily_bait_reset', { at: Date.now() });
    return res.json({
      ok: true,
      affectedUsers,
      affectedRods,
      message: `🔄 전체 유저(${affectedUsers}명 · 낚싯대 ${affectedRods}개)의 일일 미끼 사용 횟수를 초기화했습니다!`
    });
  });

  // REST: 낚싯대 장착/교체
  app.post('/api/fishing/equip-rod', (req, res) => {
    const nick = String(req.body?.nickname || '').trim();
    const rodId = String(req.body?.rodId || '').trim();
    const u = resolveAuthedFishingUser(req);
    if (!u) return res.status(401).json({ ok: false, error: '인증 정보가 누락되었거나 만료되었습니다. 새로고침(F5) 후 다시 시도해 주세요.' });
    const f = ensureUserFishing(u);
    if (!rodId) {
      f.equippedRodId = '';
    } else {
      const targetRod = (f.rods || []).find((r) => r.id === rodId);
      if (!targetRod) return res.status(400).json({ ok: false, error: '보유 중인 낚싯대가 아닙니다.' });
      f.equippedRodId = targetRod.id;
    }
    syncEquippedRod(f);
    u.updated_at = new Date().toISOString();
    saveUsersDB(usersDB);
    for (const fs of fishers.values()) {
      if (fs.nickname === u.nickname) {
        fs.rodLevel = f.rodLevel;
        fs.rodSkinLevel = getEffectiveRodSkinLevel(f);
        fs.rodBoundSkin = f.rodBoundSkin || null;
        fs.rodAwakening = f.rodAwakening || 0;
      }
    }
    broadcastPlazaState();
    return res.json({
      ok: true,
      hasRod: Boolean(f.hasRod),
      rods: f.rods || [],
      equippedRodId: f.equippedRodId || '',
      rodLevel: f.rodLevel,
      rodSkinLevel: getEffectiveRodSkinLevel(f),
      bonuses: getRodBonuses(f.rodLevel),
      nextUpgrade: ROD_UPGRADE_TABLE.find((x) => x.level === f.rodLevel + 1) || null,
      message: f.hasRod ? `🎣 +${f.rodLevel}강 낚싯대를 장착했습니다!` : '낚싯대 장착을 해제했습니다.'
    });
  });

  // REST: 낚싯대 확률형 강화 (7강+부터 파괴 확률 적용)
  app.post('/api/fishing/upgrade-rod', (req, res) => {
    const nick = String(req.body?.nickname || '').trim();
    const u = resolveAuthedFishingUser(req);
    if (!u) return res.status(401).json({ ok: false, error: '인증 정보가 누락되었거나 만료되었습니다. 새로고침(F5) 후 다시 시도해 주세요.' });
    const f = ensureUserFishing(u);
    const eqRod = syncEquippedRod(f);
    if (!eqRod) {
      return res.status(400).json({ ok: false, error: '장착된 낚싯대가 없습니다! 상점에서 0강 낚싯대(5만 스타)를 구매하거나 창고에서 장착해주세요.' });
    }
    if (eqRod.level >= MAX_ROD_LEVEL) {
      return res.status(400).json({ ok: false, error: `이미 최고 강화(+${MAX_ROD_LEVEL}강) 상태입니다!` });
    }
    const nextSpec = ROD_UPGRADE_TABLE.find((x) => x.level === eqRod.level + 1);
    if (!nextSpec) return res.status(400).json({ ok: false, error: '강화 정보를 찾을 수 없습니다.' });
    if (u.gold < nextSpec.cost) {
      return res.status(400).json({ ok: false, error: `강화 비용(${nextSpec.cost.toLocaleString()} 스타)이 부족합니다.` });
    }

    const useProtect = Boolean(req.body?.useProtect);
    const destroyRate = Number(nextSpec.destroyRate || 0);
    let protectUsed = false;
    if (useProtect && destroyRate > 0) {
      const curTickets = Math.max(0, Math.floor(Number((u.game_data?.cosmetics?.itemCounts?.rod_protect_ticket) || 0)));
      if (curTickets <= 0) {
        return res.status(400).json({ ok: false, error: '보유한 파괴 방지권이 없습니다! 로비 스타 상점에서 구매해주세요.' });
      }
      u.game_data.cosmetics.itemCounts.rod_protect_ticket = curTickets - 1;
      if (u.game_data.cosmetics.itemCounts.rod_protect_ticket <= 0) delete u.game_data.cosmetics.itemCounts.rod_protect_ticket;
      protectUsed = true;
    }

    economyHooks.addUserGold(u.nickname, -nextSpec.cost, 'fishing_rod_upgrade');
    const effectiveRate = Math.min(1.0, nextSpec.rate + (eqRod.failBonus || 0));
    const roll = Math.random();
    let success = false;
    let destroyed = false;
    let protectedFromDestroy = false;
    const oldLevel = eqRod.level;

    let greatSuccess = false;
    if (roll < effectiveRate) {
      success = true;
      if (eqRod.level + 2 <= MAX_ROD_LEVEL && Math.random() < 0.03) {
        greatSuccess = true;
        eqRod.level = Math.min(MAX_ROD_LEVEL, eqRod.level + 2);
      } else {
        eqRod.level += 1;
      }
      eqRod.failBonus = 0;
      if (eqRod.level >= 11 && !eqRod.craftedBy) {
        eqRod.craftedBy = u.nickname;
        eqRod.craftedAt = new Date().toISOString();
      }
    } else if (destroyRate > 0 && roll < effectiveRate + destroyRate) {
      if (protectUsed) {
        protectedFromDestroy = true;
        eqRod.failBonus = Math.min(Math.max(0, 1.0 - nextSpec.rate - destroyRate), +((eqRod.failBonus || 0) + (nextSpec.failBonus || 0)).toFixed(4));
      } else {
        destroyed = true;
        f.rods = (f.rods || []).filter((r) => r.id !== eqRod.id);
        f.equippedRodId = '';
      }
    } else {
      eqRod.failBonus = Math.min(Math.max(0, 1.0 - nextSpec.rate - destroyRate), +((eqRod.failBonus || 0) + (nextSpec.failBonus || 0)).toFixed(4));
    }
    syncEquippedRod(f);
    u.updated_at = new Date().toISOString();
    saveUsersDB(usersDB);

    for (const fs of fishers.values()) {
      if (fs.nickname === u.nickname) {
        fs.rodLevel = f.rodLevel;
        fs.rodSkinLevel = getEffectiveRodSkinLevel(f);
      }
    }
    broadcastPlazaState();

    if (success && (greatSuccess || eqRod.level >= 8)) {
      const upAnnText = greatSuccess
        ? `🌟 [강화 대성공! 2단계 상승!] ${u.nickname}님이 +${oldLevel}강 → +${eqRod.level}강 낚싯대 강화에 대성공했습니다!`
        : `🎊 [강화 성공!] ${u.nickname}님이 +${eqRod.level}강 낚싯대 강화에 성공했습니다!`;
      const upSysMsg = {
        id: 'fup_' + Date.now(),
        nickname: greatSuccess ? '🌟 대장간 대성공' : '🔥 대장간 속보',
        cosmetics: { title: '', color: greatSuccess ? '#facc15' : '#38bdf8' },
        rodLevel: eqRod.level,
        text: upAnnText,
        at: Date.now()
      };
      chatHistory.push(upSysMsg);
      if (chatHistory.length > 60) chatHistory.shift();
      io.to(FISHING_ROOM_ID).emit('fishing_chat_message', upSysMsg);
      if (eqRod.level >= 8 && economyHooks.broadcastGlobalAnnouncement) {
        economyHooks.broadcastGlobalAnnouncement({ type: 'rod_upgrade', text: upAnnText });
      }
    }
    if (destroyed) {
      const sysMsg = {
        id: 'fbrk_' + Date.now(),
        nickname: '💥 강화 파괴 알림',
        cosmetics: { title: '', color: '#fb7185' },
        rodLevel: 0,
        text: `💔 ${u.nickname}님의 +${oldLevel}강 낚싯대가 +${oldLevel + 1}강 도전 중 산산조각 파괴되었습니다!`,
        at: Date.now()
      };
      chatHistory.push(sysMsg);
      if (chatHistory.length > 60) chatHistory.shift();
      io.to(FISHING_ROOM_ID).emit('fishing_chat_message', sysMsg);
    }

    const nextUpgrade = f.hasRod ? (ROD_UPGRADE_TABLE.find((x) => x.level === f.rodLevel + 1) || null) : null;
    return res.json({
      ok: true,
      success,
      greatSuccess,
      destroyed,
      rodDailyBaitLimit: f.rodDailyBaitLimit || 0,
      rodDailyBaitUsed: f.rodDailyBaitUsed || 0,
      baitRemaining: computeBaitRemaining(f),
      hasRod: Boolean(f.hasRod),
      rods: f.rods || [],
      equippedRodId: f.equippedRodId || '',
      rodLevel: f.rodLevel,
      rodSkinLevel: getEffectiveRodSkinLevel(f),
      rodFailBonus: f.rodFailBonus || 0,
      rodProtectTickets: Math.max(0, Math.floor(Number((u.game_data?.cosmetics?.itemCounts?.rod_protect_ticket) || 0))),
      protectedFromDestroy,
      gold: u.gold,
      bonuses: getRodBonuses(f.rodLevel),
      nextUpgrade,
      message: destroyed
        ? `💥 앗! +${oldLevel}강 낚싯대가 강화 도중 파괴되었습니다! (상점에서 0강 낚싯대 구매 가능)`
        : protectedFromDestroy
          ? `🛡️ 파괴 위기였으나 대장간 파괴 방지권으로 +${f.rodLevel}강 낚싯대를 지켜냈습니다!`
          : greatSuccess
        ? `🌟 [3% 대성공!!] 낚싯대가 한 번에 2단계 상승해 +${f.rodLevel}강이 되었습니다!`
        : success
        ? `🎉 강화 성공! 낚싯대가 +${f.rodLevel}강이 되었습니다!`
        : `💨 아쉽게 강화에 실패했습니다. (+${f.rodLevel}강 유지)`
    });
  });

  // REST: 낚싯대 0강 초기화
  app.post('/api/fishing/reset-rod', (req, res) => {
    const nick = String(req.body?.nickname || '').trim();
    const u = resolveAuthedFishingUser(req);
    if (!u) return res.status(401).json({ ok: false, error: '인증 정보가 누락되었거나 만료되었습니다. 새로고침(F5) 후 다시 시도해 주세요.' });
    const f = ensureUserFishing(u);
    const eqRod = syncEquippedRod(f);
    if (!eqRod) return res.status(400).json({ ok: false, error: '장착된 낚싯대가 없습니다.' });
    eqRod.level = 0;
    eqRod.failBonus = 0;
    eqRod.skinLevel = null;
    syncEquippedRod(f);
    u.updated_at = new Date().toISOString();
    saveUsersDB(usersDB);

    for (const fs of fishers.values()) {
      if (fs.nickname === u.nickname) {
        fs.rodLevel = 0;
        fs.rodSkinLevel = 0;
      }
    }
    broadcastPlazaState();

    const nextUpgrade = ROD_UPGRADE_TABLE.find((x) => x.level === 1) || null;
    return res.json({
      ok: true,
      rodLevel: 0,
      rodSkinLevel: 0,
      rodFailBonus: 0,
      bonuses: getRodBonuses(0),
      nextUpgrade,
      message: '🔄 낚싯대가 +0강으로 초기화되었습니다.'
    });
  });

  // REST: 낚싯대 스킨 변경 (성능은 현재 강화단계 유지)
  app.post('/api/fishing/rod-skin', (req, res) => {
    const nick = String(req.body?.nickname || '').trim();
    const u = resolveAuthedFishingUser(req);
    if (!u) return res.status(401).json({ ok: false, error: '인증 정보가 누락되었거나 만료되었습니다. 새로고침(F5) 후 다시 시도해 주세요.' });
    const f = ensureUserFishing(u);
    const eqRod = syncEquippedRod(f);
    if (!eqRod) return res.status(400).json({ ok: false, error: '장착된 낚싯대가 없습니다.' });
    const rawSkin = req.body?.skinLevel;
    if (rawSkin === null || rawSkin === undefined || rawSkin === '') {
      eqRod.skinLevel = null;
    } else {
      const sk = Math.floor(Number(rawSkin));
      if (Number.isNaN(sk) || sk < 0 || sk > eqRod.level) {
        return res.status(400).json({ ok: false, error: `현재 강화 단계(+${eqRod.level}강) 이하의 스킨만 선택할 수 있습니다.` });
      }
      eqRod.skinLevel = sk;
    }
    syncEquippedRod(f);
    u.updated_at = new Date().toISOString();
    saveUsersDB(usersDB);

    const effSkin = getEffectiveRodSkinLevel(f);
    for (const fs of fishers.values()) {
      if (fs.nickname === u.nickname) {
        fs.rodSkinLevel = effSkin;
      }
    }
    broadcastPlazaState();

    return res.json({
      ok: true,
      rodLevel: f.rodLevel,
      rodSkinLevel: effSkin,
      message: f.rodSkinLevel === null
        ? `🎨 현재 강화 단계(+${f.rodLevel}강) 기본 외형으로 설정했습니다.`
        : `🎨 +${effSkin}강 스킨을 적용했습니다! (성능은 +${f.rodLevel}강 유지)`
    });
  });

  io.on('connection', (socket) => {
    socket.on('fishing_join', ({ clientId, nickname, save_code } = {}) => {
      const authed = (save_code && typeof findUserByValidCode === 'function') ? findUserByValidCode(save_code) : null;
      const cleanNick = authed ? authed.nickname : String(nickname || '유저').trim().slice(0, 16);
      socket.join(FISHING_ROOM_ID);
      const u = authed || findUserByNickname(cleanNick);
      if (authed && authed.id) {
        socket.join('user:' + authed.id);
        socket.data.userId = authed.id;
        socket.data.nickname = authed.nickname;
      }
      const f = u ? ensureUserFishing(u) : null;
      const cos = economyHooks.getUserCosmetics ? economyHooks.getUserCosmetics(cleanNick) : {};
      const usedSeats = new Set(Array.from(fishers.values()).map((x) => x.seatIndex));
      let seatIndex = 0;
      while (usedSeats.has(seatIndex)) seatIndex++;
      fishers.set(socket.id, {
        socketId: socket.id,
        clientId: clientId || socket.id,
        seatIndex,
        nickname: cleanNick,
        rodLevel: f ? f.rodLevel : 0,
        rodSkinLevel: f ? getEffectiveRodSkinLevel(f) : 0,
        rodBoundSkin: f ? (f.rodBoundSkin || null) : null,
        rodAwakening: f ? (f.rodAwakening || 0) : 0,
        cosmetics: cos,
        status: 'IDLE',
        pending: null,
        biteTimer: null,
        lastCatchText: '',
        joinedAt: Date.now()
      });
      socket.emit('fishing_chat_history', chatHistory.slice(-40));
      socket.emit('fishing_tournament_state', getPublicTournamentState());
      socket.emit('fishing_boss_state', getPublicBossState());
      socket.emit('fishing_gift_state', getPublicGiftBoxState());
      socket.emit('fishing_weather_state', getPublicWeatherState());
      broadcastPlazaState();
    });

    socket.on('fishing_cast', ({ nickname } = {}, cb) => {
      let fisher = fishers.get(socket.id);
      if (!fisher && nickname) {
        const cleanNick = String(nickname).trim().slice(0, 16);
        const uAuto = findUserByNickname(cleanNick);
        if (uAuto) {
          socket.join(FISHING_ROOM_ID);
          const fAuto = ensureUserFishing(uAuto);
          const cosAuto = economyHooks.getUserCosmetics ? economyHooks.getUserCosmetics(cleanNick) : {};
          const usedSeats = new Set(Array.from(fishers.values()).map((x) => x.seatIndex));
          let seatIndex = 0;
          while (usedSeats.has(seatIndex)) seatIndex++;
          fisher = {
            socketId: socket.id,
            clientId: socket.id,
            seatIndex,
            nickname: cleanNick,
            rodLevel: fAuto ? fAuto.rodLevel : 0,
            rodSkinLevel: fAuto ? getEffectiveRodSkinLevel(fAuto) : 0,
            rodBoundSkin: fAuto ? (fAuto.rodBoundSkin || null) : null,
            rodAwakening: fAuto ? (fAuto.rodAwakening || 0) : 0,
            cosmetics: cosAuto,
            status: 'IDLE',
            pending: null,
            biteTimer: null,
            lastCatchText: '',
            joinedAt: Date.now()
          };
          fishers.set(socket.id, fisher);
          broadcastPlazaState();
        }
      }
      if (!fisher) return cb && cb({ ok: false, error: '낚시터에 먼저 입장해주세요.' });
      if (bossRaid.active) {
        return cb && cb({ ok: false, error: '⚔️ 심해 몬스터 레이드 진행 중에는 낚시를 할 수 없습니다! 몬스터를 먼저 처치하세요!' });
      }
      if (fisher.status === 'CASTING' || fisher.status === 'BITING') {
        return cb && cb({ ok: false, error: '이미 찌를 던져둔 상태입니다!' });
      }
      const u = findUserByNickname(fisher.nickname || nickname);
      if (!u) return cb && cb({ ok: false, error: '계정 정보를 찾을 수 없습니다.' });
      const f = ensureUserFishing(u);
      if (!f.hasRod) {
        return cb && cb({ ok: false, error: '🎣 장착된 낚싯대가 없습니다! 상점에서 0강 낚싯대(5만 스타)를 구매하거나 창고에서 장착해주세요.' });
      }
      const bCfg = getBaitConfig();
      const eqCastRod = syncEquippedRod(f);
      let baitTypeUsed = 'unlimited';
      if (bCfg.limitEnabled) {
        const rodLimit = getRodDailyBaitLimit(eqCastRod.level, eqCastRod.awakening || 0);
        const rodRem = Math.max(0, rodLimit - (eqCastRod.dailyBaitUsed || 0));
        const extraRem = Math.max(0, f.extraBait || 0);
        if (rodRem <= 0) {
          return cb && cb({ ok: false, error: `현재 +${eqCastRod.level}강 낚싯대의 오늘 낚시 가능 횟수(${rodLimit}회)를 모두 사용했습니다! 다른 낚싯대로 교체하거나 자정을 기다려주세요.` });
        }
        if (extraRem <= 0) {
          return cb && cb({ ok: false, error: `보유한 미끼가 없습니다! 상단 [+구매] 버튼에서 미끼를 구매해주세요.` });
        }
        eqCastRod.dailyBaitUsed = (eqCastRod.dailyBaitUsed || 0) + 1;
        f.rodDailyBaitUsed = eqCastRod.dailyBaitUsed;
        const castBonuses = getRodBonuses(eqCastRod.level);
        const baitSaved = castBonuses.baitSaveChancePct > 0 && Math.random() * 100 < castBonuses.baitSaveChancePct;
        if (baitSaved) {
          baitTypeUsed = 'saved';
        } else {
          f.extraBait = Math.max(0, (f.extraBait || 0) - 1);
          baitTypeUsed = 'extra';
        }
      }
      fisher.rodLevel = f.rodLevel;
      fisher.rodBoundSkin = f.rodBoundSkin || null;
      fisher.rodAwakening = f.rodAwakening || 0;
      fisher.cosmetics = economyHooks.getUserCosmetics ? economyHooks.getUserCosmetics(u.nickname) : {};
      u.updated_at = new Date().toISOString();
      saveUsersDB(usersDB);

      const curWeather = (activeWeather && Date.now() < activeWeather.endsAt) ? activeWeather : null;
      const roll = rollFishForUser(f.rodLevel, curWeather, f.rodAwakening || 0);
      const bonuses = getRodBonuses(f.rodLevel);
      const isFeverNow = Boolean(fisher.feverUntil && Date.now() < fisher.feverUntil);
      const baseWaitMs = 2000 + Math.random() * 2800; // 2.0 ~ 4.8초
      let waitMs = Math.max(900, Math.round(baseWaitMs * (1 - bonuses.waitReductionPct / 100)));
      if (isFeverNow) waitMs = Math.max(450, Math.round(waitMs * 0.5));

      if (fisher.biteTimer) clearTimeout(fisher.biteTimer);
      fisher.status = 'CASTING';
      fisher.lastCatchText = '';
      fisher.pending = {
        ...roll,
        biteTriggered: false,
        castAt: Date.now(),
        baitType: baitTypeUsed,
        tournamentId: tournament.active ? tournament.id : null
      };
      broadcastPlazaState();

      fisher.biteTimer = setTimeout(() => {
        if (!fishers.has(socket.id) || !fisher.pending) return;
        fisher.status = 'BITING';
        fisher.pending.biteTriggered = true;
        fisher.pending.biteAt = Date.now();
        broadcastPlazaState();
        socket.emit('fishing_bite', {
          tier: fisher.pending.fish.tier,
          tierLabel: fisher.pending.tierInfo.label,
          tierColor: fisher.pending.tierInfo.color,
          gaugeWidth: fisher.pending.gaugeWidth,
          gaugeSpeed: fisher.pending.gaugeSpeed
        });
      }, waitMs);

      if (cb) {
        cb({
          ok: true,
          baitRemaining: computeBaitRemaining(f),
          rodDailyBaitUsed: f.rodDailyBaitUsed || 0,
          rodDailyBaitLimit: f.rodDailyBaitLimit || 0,
          extraBait: f.extraBait || 0,
          dailyBaitUsed: f.dailyBaitUsed
        });
      }
    });

    socket.on('fishing_catch', ({ hitType } = {}, cb) => {
      const fisher = fishers.get(socket.id);
      if (!fisher || !fisher.pending) {
        return cb && cb({ ok: false, error: '진행 중인 입질이 없습니다.' });
      }
      if (!fisher.pending.biteTriggered) {
        if (fisher.biteTimer) clearTimeout(fisher.biteTimer);
        fisher.combo = 0;
        fisher.pending = null;
        fisher.status = 'MISSED';
        fisher.lastCatchText = '💨 성급한 헛손질!';
        broadcastPlazaState();
        setTimeout(() => {
          if (fishers.has(socket.id) && fisher.status === 'MISSED') {
            fisher.status = 'IDLE';
            fisher.lastCatchText = '';
            broadcastPlazaState();
          }
        }, 2200);
        return cb && cb({ ok: false, missed: true, message: '💨 너무 성급했습니다! 물고기가 놀라 도망갔습니다.' });
      }

      const pending = fisher.pending;
      fisher.pending = null;
      fisher.status = 'IDLE';

      if (hitType !== 'good' && hitType !== 'perfect') {
        fisher.combo = 0;
        fisher.status = 'MISSED';
        fisher.lastCatchText = `💨 ${pending.fish.icon} ${pending.fish.name} 놓침!`;
        if (pending.fish && (pending.fish.tier === 'IMMORTAL' || pending.fish.tier === 'TRANSCENDENT')) {
          const missMsg = {
            id: 'fmiss_' + Date.now(),
            nickname: '😱 대어 놓침 속보',
            cosmetics: { title: '', color: pending.tierInfo.color || '#f472b6' },
            rodLevel: fisher.rodLevel || 0,
            text: `저런! ${fisher.nickname}님이 ${pending.tierInfo.label}등급 ${pending.fish.icon} ${pending.fish.name}을(를) 아쉽게 놓쳐버렸어요!`,
            at: Date.now()
          };
          chatHistory.push(missMsg);
          if (chatHistory.length > 60) chatHistory.shift();
          io.to(FISHING_ROOM_ID).emit('fishing_chat_message', missMsg);
        }
        broadcastPlazaState();
        setTimeout(() => {
          if (fishers.has(socket.id) && fisher.status === 'MISSED') {
            fisher.status = 'IDLE';
            fisher.lastCatchText = '';
            broadcastPlazaState();
          }
        }, 2800);
        return cb && cb({
          ok: false,
          missed: true,
          message: `💨 아깝다! [${pending.tierInfo.label}] ${pending.fish.icon} ${pending.fish.name} (${pending.lengthCm}cm)을(를) 놓쳤습니다!`
        });
      }

      const u = findUserByNickname(fisher.nickname);
      if (!u) return cb && cb({ ok: false, error: '유저 정보를 찾을 수 없습니다.' });
      const f = ensureUserFishing(u);

      const isPerfect = hitType === 'perfect';
      const nowCatch = Date.now();
      const wasFeverActive = Boolean(fisher.feverUntil && nowCatch < fisher.feverUntil);
      let feverTriggered = false;
      if (isPerfect) {
        fisher.combo = (fisher.combo || 0) + 1;
        if (fisher.combo > 0 && fisher.combo % 5 === 0) {
          fisher.feverUntil = nowCatch + 30000;
          feverTriggered = true;
        }
      } else {
        fisher.combo = 0;
      }
      const isFeverActive = Boolean(fisher.feverUntil && nowCatch < fisher.feverUntil);

      const baseByLength = pending.computedPrice || pending.fish.price;
      let goldEarned = Math.round(baseByLength * (isPerfect ? 1.5 : 1.0));
      if (wasFeverActive) goldEarned = Math.round(goldEarned * 1.5);
      recordRecentCatch(u.nickname, Date.now());
      let newGold = economyHooks.addUserGold(u.nickname, goldEarned, 'fishing_catch');
      const isRarePlus = ['RARE', 'HERO', 'LEGEND', 'MYTHIC', 'IMMORTAL', 'TRANSCENDENT'].includes(pending.fish.tier);
      const isHeroPlus = ['HERO', 'LEGEND', 'MYTHIC', 'IMMORTAL', 'TRANSCENDENT'].includes(pending.fish.tier);
      economyHooks.recordDailyActivity(u.nickname, {
        play: 1,
        fishingRarePlus: isRarePlus ? 1 : 0,
        fishingHeroPlus: isHeroPlus ? 1 : 0
      });

      // 심해 보물상자 드롭 (3.0% 확률 -> 잠긴 보물상자 1개 획득!)
      let chestDrop = null;
      if (Math.random() < 0.03) {
        f.treasureChests = (f.treasureChests || 0) + 1;
        chestDrop = { chestsWon: 1, totalChests: f.treasureChests };
      }

      // 낚시 중 구슬 스킨 + 닉네임 컬러 드롭 판정 (날씨 배율 * 고강 낚싯대 보정)
      let skinDrop = null;
      const rodSkinMult = (getRodBonuses(f.rodLevel).skinDropMult || 1);
      const curSkinMult = ((activeWeather && nowCatch < activeWeather.endsAt) ? (activeWeather.skinMult || 1) : 1) * rodSkinMult;
      const droppedSkin = rollMarbleSkinDrop(curSkinMult);
      if (droppedSkin) {
        if (!u.game_data.cosmetics || typeof u.game_data.cosmetics !== 'object') {
          u.game_data.cosmetics = { ownedTitles: [], equippedTitle: '', ownedColors: [], equippedColor: '', ownedMarbleSkins: [], equippedMarbleSkin: '' };
        }
        if (!Array.isArray(u.game_data.cosmetics.ownedMarbleSkins)) {
          u.game_data.cosmetics.ownedMarbleSkins = [];
        }
        const skinCatalogId = 'skin_' + droppedSkin.value;
        const prevCount = (u.game_data.cosmetics.itemCounts && u.game_data.cosmetics.itemCounts[skinCatalogId]) || 0;
        const newCount = economyHooks.addCosmeticItem(u, 'marbleSkin', skinCatalogId, 1);
        skinDrop = {
          ...droppedSkin,
          id: skinCatalogId,
          isDuplicate: prevCount > 0,
          count: newCount,
          refundGold: 0
        };
      }
      let rodSkinDrop = null;
      const droppedRodSkin = rollRodSkinDrop(curSkinMult);
      if (droppedRodSkin) {
        const prevRsCnt = (u.game_data?.cosmetics?.itemCounts && u.game_data.cosmetics.itemCounts[droppedRodSkin.id]) || 0;
        const newRsCnt = economyHooks.addCosmeticItem(u, 'rodSkin', droppedRodSkin.id, 1);
        rodSkinDrop = {
          ...droppedRodSkin,
          isDuplicate: prevRsCnt > 0,
          count: newRsCnt
        };
      }
      let colorDrop = null;
      const droppedColor = rollNicknameColorDrop(curSkinMult);
      if (droppedColor) {
        const prevColCnt = (u.game_data?.cosmetics?.itemCounts && u.game_data.cosmetics.itemCounts[droppedColor.id]) || 0;
        const newColCnt = economyHooks.addCosmeticItem(u, 'color', droppedColor.id, 1);
        colorDrop = {
          ...droppedColor,
          isDuplicate: prevColCnt > 0,
          count: newColCnt
        };
      }

      const dexEntry = f.dex[pending.fish.id] || { count: 0, maxLength: 0, firstCaughtAt: Date.now() };
      const isNewDex = dexEntry.count === 0;
      dexEntry.count += 1;
      if (pending.lengthCm > (dexEntry.maxLength || 0)) dexEntry.maxLength = pending.lengthCm;
      f.dex[pending.fish.id] = dexEntry;
      f.totalCaught += 1;
      f.totalGoldEarned += goldEarned;

      // 도감 마일스톤 보상 체크 (10종 / 20종 / 27종 올클리어)
      const unlockedSpeciesCount = Object.keys(f.dex).filter((k) => (f.dex[k]?.count || 0) > 0).length;
      const milestoneRewards = [];
      const DEX_MILESTONES = [
        { count: 10, star: 50000, title: null, label: '도감 10종 달성!' },
        { count: 20, star: 200000, titleId: 'title_novice_angler', title: '[🎣 초보 낚시꾼]', label: '도감 20종 달성 (전설 정복!)' },
        { count: 24, star: 350000, titleId: 'title_decent_angler', title: '[🎣 그럴싸한 낚시꾼]', label: '도감 24종 달성 (신화 정복!)' },
        { count: 27, star: 500000, titleId: 'title_sea_king', title: '[👑 해왕]', label: '도감 27종 달성 (불멸 정복!)' },
        { count: 29, star: 1000000, titleId: 'title_sea_god', title: '[🌊 해신]', label: '도감 29종 올클리어!!' }
      ];
      for (const ms of DEX_MILESTONES) {
        if (unlockedSpeciesCount >= ms.count && !f.claimedDexMilestones.includes(ms.count)) {
          f.claimedDexMilestones.push(ms.count);
          newGold = economyHooks.addUserGold(u.nickname, ms.star, 'fishing_dex_milestone');
          if (ms.titleId) {
            if (!u.game_data.cosmetics) u.game_data.cosmetics = { ownedTitles: [], equippedTitle: '', ownedColors: [], equippedColor: '', ownedMarbleSkins: [], equippedMarbleSkin: '' };
            if (!Array.isArray(u.game_data.cosmetics.ownedTitles)) u.game_data.cosmetics.ownedTitles = [];
            if (!u.game_data.cosmetics.ownedTitles.includes(ms.titleId)) {
              u.game_data.cosmetics.ownedTitles.push(ms.titleId);
            }
          }
          milestoneRewards.push(ms);
          const sysMsg = {
            id: 'fms_' + Date.now() + '_' + ms.count,
            nickname: '📖 도감 마일스톤',
            cosmetics: { title: '', color: '#34d399' },
            rodLevel: f.rodLevel || 0,
            text: `🎊 ${u.nickname}님이 [${ms.label}]을 달성하여 +${ms.star.toLocaleString()} 스타${ms.title ? ` + 전용 칭호 ${ms.title}` : ''} 보상을 받았습니다!`,
            at: Date.now()
          };
          chatHistory.push(sysMsg);
          if (chatHistory.length > 60) chatHistory.shift();
          io.to(FISHING_ROOM_ID).emit('fishing_chat_message', sysMsg);
        }
      }

      u.updated_at = new Date().toISOString();
      saveUsersDB(usersDB);

      resetTopCatchesIfNewDay();
      topCatchesToday.push({
        nickname: u.nickname,
        cosmetics: fisher.cosmetics || {},
        fishId: pending.fish.id,
        fishName: pending.fish.name,
        icon: pending.fish.icon,
        tier: pending.fish.tier,
        tierLabel: pending.tierInfo.label,
        tierColor: pending.tierInfo.color,
        lengthCm: pending.lengthCm,
        price: goldEarned,
        at: Date.now()
      });
      topCatchesToday.sort((a, b) => ((b.lengthCm || 0) - (a.lengthCm || 0)) || ((b.price || 0) - (a.price || 0)));
      if (topCatchesToday.length > 10) topCatchesToday = topCatchesToday.slice(0, 10);
      saveTopCatches();

      fisher.status = 'CAUGHT';
      fisher.lastCatchText = `${pending.fish.icon} ${pending.fish.name}`;
      setTimeout(() => {
        if (fishers.has(socket.id) && fisher.status === 'CAUGHT') {
          fisher.status = 'IDLE';
          fisher.lastCatchText = '';
          broadcastPlazaState();
        }
      }, 2800);

      const caughtAt = Date.now();
      let tournamentExcludedPreCast = false;
      if (tournament.active && caughtAt <= tournament.endsAt) {
        const isPostStartCast = (pending.castAt || 0) >= (tournament.startedAt || 0) && pending.tournamentId === tournament.id;
        if (!isPostStartCast) {
          tournamentExcludedPreCast = true;
        } else {
          const prevE = tournament.entries.get(u.nickname);
          if (!prevE || pending.lengthCm > prevE.lengthCm) {
            tournament.entries.set(u.nickname, {
              nickname: u.nickname,
              cosmetics: fisher.cosmetics || {},
              fishName: pending.fish.name,
              icon: pending.fish.icon,
              tierLabel: pending.tierInfo.label,
              tierColor: pending.tierInfo.color,
              lengthCm: pending.lengthCm,
              caughtAt
            });
            broadcastTournamentState();
          }
        }
      }
      // 구슬 스킨 획득 시 낚시터 채팅창 공지 + 고가(궤적/스페셜) 스킨은 상단 전광판 알림
      if (skinDrop) {
        const sysMsg = {
          id: 'fskin_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          nickname: '🎁 낚시터 알림',
          cosmetics: { title: '', color: '#f472b6' },
          rodLevel: f.rodLevel || 0,
          text: skinDrop.isDuplicate
            ? `${u.nickname}님이 🔮 [${skinDrop.name}]을(를) 또 낚아 창고에 쌓았습니다! (보유 ×${skinDrop.count})`
            : `${u.nickname}님이 낚시로 🔮 [${skinDrop.name}] 스킨을 건져 올렸습니다!`,
          at: Date.now()
        };
        chatHistory.push(sysMsg);
        if (chatHistory.length > 60) chatHistory.shift();
        io.to(FISHING_ROOM_ID).emit('fishing_chat_message', sysMsg);
        if (skinDrop.price >= 1500000) {
          io.to(FISHING_ROOM_ID).emit('fishing_banner', {
            nickname: u.nickname,
            cosmetics: fisher.cosmetics || {},
            fishName: `🔮 ${skinDrop.name} 스킨`,
            icon: '🎁',
            tier: 'IMMORTAL',
            tierLabel: `${skinDrop.group} 스킨`,
            tierColor: '#f472b6',
            lengthCm: 0,
            caughtAt: Date.now(),
            goldEarned: skinDrop.isDuplicate ? skinDrop.refundGold : skinDrop.price,
            isRareBroadcast: true
          });
        }
      }

      // 전설 이상 등급 낚았을 때 공용 전광판 알림 브로드캐스트 (신화/불멸/초월은 전체 화면 특별 알림)
      if (['LEGEND', 'MYTHIC', 'IMMORTAL', 'TRANSCENDENT'].includes(pending.fish.tier)) {
        io.to(FISHING_ROOM_ID).emit('fishing_banner', {
          nickname: u.nickname,
          cosmetics: fisher.cosmetics || {},
          fishName: pending.fish.name,
          icon: pending.fish.icon,
          tier: pending.fish.tier,
          tierLabel: pending.tierInfo.label,
          tierColor: pending.tierInfo.color,
          lengthCm: pending.lengthCm,
          caughtAt,
          goldEarned,
          isRareBroadcast: pending.fish.tier === 'MYTHIC' || pending.fish.tier === 'IMMORTAL' || pending.fish.tier === 'TRANSCENDENT'
        });
      }

      broadcastPlazaState();

      if (cb) {
        cb({
          ok: true,
          missed: false,
          isPerfect,
          isKingSize: Boolean(pending.isKingSize),
          isNewDex,
          fish: pending.fish,
          tierInfo: pending.tierInfo,
          lengthCm: pending.lengthCm,
          goldEarned,
          gold: newGold,
          dexEntry,
          combo: fisher.combo || 0,
          feverUntil: fisher.feverUntil || 0,
          feverTriggered,
          wasFeverActive,
          chestDrop,
          treasureChests: f.treasureChests || 0,
          lotteryTickets: f.lotteryTickets || 0,
          milestoneRewards,
          skinDrop,
        colorDrop,
        rodSkinDrop,
          tournamentExcludedPreCast,
          baitRemaining: computeBaitRemaining(f)
        });
      }
    });

    socket.on('fishing_boss_hit', (meta = {}) => {
      const fisher = fishers.get(socket.id);
      if (!fisher || !bossRaid.active || bossRaid.hp <= 0) return;
      const now = Date.now();
      if (now < bossRaid.battleStartAt || now > bossRaid.endsAt) return;

      // 1. 이미 이번 보스 레이드에서 오토마우스/매크로로 차단된 유저
      if (fisher.macroBlockedBossId === bossRaid.id) {
        if (!fisher.lastBossWarnAt || now - fisher.lastBossWarnAt > 3000) {
          fisher.lastBossWarnAt = now;
          socket.emit('fishing_boss_blocked', {
            error: '🤖 비정상적인 연타 패턴(오토마우스/매크로)이 감지되어 이번 보스 레이드 참여가 제한되었습니다.'
          });
        }
        return;
      }

      // 2. 최근 3분 이내 실제 물고기 3마리 이상 포획 필수 조건 (보스 시작 시점 기준 3분)
      const recentCnt = getRecentCatchCount(fisher.nickname, bossRaid.startedAt || now);
      if (recentCnt < BOSS_MIN_RECENT_CATCHES) {
        if (!fisher.lastBossWarnAt || now - fisher.lastBossWarnAt > 3000) {
          fisher.lastBossWarnAt = now;
          socket.emit('fishing_boss_blocked', {
            error: `⚠️ 보스 등장 전 3분 이내 물고기 3마리 이상 포획한 유저만 참여 가능합니다! (현재 ${recentCnt}/3마리)`
          });
        }
        return;
      }

      // 3. 오토마우스 / 스크립트 매크로 감지
      // 3a. 합성 이벤트(isTrusted === false) 즉시 차단
      if (meta && meta.isTrusted === false) {
        fisher.macroBlockedBossId = bossRaid.id;
        bossRaid.damageByNick.delete(fisher.nickname);
        notifyAdminsMacroSuspect(fisher.nickname, '보스 레이드에서 비정상 스크립트 클릭(isTrusted=false)이 감지되어 차단되었습니다.');
        socket.emit('fishing_boss_blocked', {
          error: '🤖 자동화 스크립트 클릭이 감지되어 이번 보스 레이드 참여가 차단되었습니다.'
        });
        return;
      }

      if (fisher.lastBossHitAt && now - fisher.lastBossHitAt < 70) return;
      fisher.lastBossHitAt = now;

      const rodLv = Math.max(0, Number(fisher.rodLevel) || 0);
      const rodAw = Math.max(0, Math.floor(Number(fisher.rodAwakening) || 0));
      const awSpecAtk = rodAw > 0 ? AWAKENING_SPECS.find((x) => x.level === rodAw) : null;
      const baseDmg = 15 + rodLv * 8;
      const critChance = 0.15 + (awSpecAtk ? awSpecAtk.bossCritBonus : 0);
      const isCrit = Math.random() < critChance;
      const dmg = Math.max(1, Math.round(baseDmg * (isCrit ? (rodAw > 0 ? 2.0 : 1.6) : (0.9 + Math.random() * 0.2))));

      bossRaid.hp = Math.max(0, bossRaid.hp - dmg);
      const prev = bossRaid.damageByNick.get(fisher.nickname) || 0;
      bossRaid.damageByNick.set(fisher.nickname, prev + dmg);

      io.to(FISHING_ROOM_ID).emit('fishing_boss_hit_fx', {
        nickname: fisher.nickname,
        dmg,
        isCrit,
        hp: bossRaid.hp,
        maxHp: bossRaid.maxHp
      });

      if (bossRaid.hp <= 0) {
        finishBossRaid(true);
      }
    });

    const pageMacroReportCooldown = new Map();
    socket.on('fishing_page_macro_report', (info = {}) => {
      const fisher = fishers.get(socket.id);
      if (!fisher || !fisher.nickname) return;
      const key = String(fisher.nickname).toLowerCase();
      const now = Date.now();
      const lastRep = pageMacroReportCooldown.get(key) || 0;
      if (now - lastRep < 20 * 60 * 1000) return; // 20분 쿨다운 (알림 도배 방지)
      pageMacroReportCooldown.set(key, now);
      const reason = String(info.reason || '일정 간격 자동 클릭').slice(0, 60);
      const avgMs = Math.round(Number(info.avgMs) || 0);
      const stdDevMs = Number(info.stdDevMs || 0).toFixed(1);
      const samePos = Math.floor(Number(info.samePosCount) || 0);
      const pType = String(info.pointerType || 'mouse').slice(0, 12);
      notifyAdminsMacroSuspect(
        fisher.nickname,
        `낚시터 페이지 오토마우스 의심 (${reason} · 평균 ${avgMs}ms · 편차 ${stdDevMs}ms · 고정좌표 ${samePos}회 · ${pType})`
      );
    });

    socket.on('fishing_chat', ({ text } = {}) => {
      const fCheck = fishers.get(socket.id);
      if (fCheck && typeof isUserChatMuted === 'function') {
        const mInfo = isUserChatMuted(fCheck.nickname);
        if (mInfo) {
          socket.emit('fishing_chat_message', {
            id: 'mute_' + Date.now(),
            nickname: '시스템',
            rodLevel: 0,
            text: `🔇 채팅 제한 중입니다. (남은 시간: 약 ${mInfo.remainMin}분)`,
            at: Date.now()
          });
          return;
        }
      }
      const fisher = fishers.get(socket.id);
      if (!fisher) return;
      const rawText = String(text || '').trim();
      if (!rawText) return;
      if (rawText === '/확성기' || rawText.startsWith('/확성기 ')) {
        const uChat = findUserByNickname(fisher.nickname);
        const isAdm = Boolean(uChat && (uChat.isAdmin || String(uChat.nickname || '').trim() === '랜선판다'));
        if (!isAdm) {
          socket.emit('fishing_chat_message', {
            id: 'fc_err_' + Date.now(),
            nickname: '⚠️ 시스템',
            cosmetics: { title: '', color: '#fb7185' },
            rodLevel: 0,
            text: '/확성기 명령어는 관리자만 사용할 수 있습니다.',
            at: Date.now()
          });
          return;
        }
        const megaMsg = rawText.slice(4).trim().slice(0, 120);
        if (!megaMsg) {
          socket.emit('fishing_chat_message', {
            id: 'fc_err_' + Date.now(),
            nickname: '⚠️ 시스템',
            cosmetics: { title: '', color: '#fbbf24' },
            rodLevel: 0,
            text: '사용법: /확성기 할말',
            at: Date.now()
          });
          return;
        }
        if (typeof deps.broadcastGlobalAnnouncement === 'function') {
          deps.broadcastGlobalAnnouncement({ type: 'megaphone', text: `📣 [전체 공지] ${megaMsg}` });
        } else {
          io.emit('global_announcement', { id: 'ann_' + Date.now(), at: Date.now(), type: 'megaphone', text: `📣 [전체 공지] ${megaMsg}` });
        }
        const sysMsg = {
          id: 'fc_mega_' + Date.now(),
          nickname: '📣 전체 확성기',
          cosmetics: { title: '', color: '#fde047' },
          rodLevel: 0,
          text: megaMsg,
          at: Date.now()
        };
        chatHistory.push(sysMsg);
        if (chatHistory.length > 60) chatHistory.shift();
        io.to(FISHING_ROOM_ID).emit('fishing_chat_message', sysMsg);
        return;
      }
      const clean = rawText.slice(0, 100);
      if (economyHooks.getUserCosmetics) {
        fisher.cosmetics = economyHooks.getUserCosmetics(fisher.nickname);
      }
      const msg = {
        id: 'fc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        nickname: fisher.nickname,
        cosmetics: fisher.cosmetics || {},
        rodLevel: fisher.rodLevel || 0,
        text: clean,
        at: Date.now()
      };
      chatHistory.push(msg);
      if (chatHistory.length > 60) chatHistory.shift();
      io.to(FISHING_ROOM_ID).emit('fishing_chat_message', msg);
    });

    const leavePlaza = () => {
      const fisher = fishers.get(socket.id);
      if (fisher) {
        if (fisher.biteTimer) clearTimeout(fisher.biteTimer);
        fishers.delete(socket.id);
        socket.leave(FISHING_ROOM_ID);
        broadcastPlazaState();
      }
    };

    socket.on('fishing_leave', leavePlaza);
    socket.on('disconnect', leavePlaza);
  });

  return {
    getPlayerCount: () => fishers.size,
    getFishersList: () => Array.from(fishers.values()).map((x) => x.nickname).filter(Boolean),
    spawnBossAdmin: () => {
      startBossRaid(null);
      return { ok: true, message: '⚔️ 낚시터 보스 레이드를 즉시 소환했습니다!' };
    },
    setWeatherAdmin: (kw) => {
      const clean = String(kw || '').trim();
      if (clean === '맑음' || clean === '해제' || clean === 'clear') {
        activeWeather = null;
        io.to(FISHING_ROOM_ID).emit('fishing_weather_state', getPublicWeatherState());
        return { ok: true, message: '☀️ 낚시터 날씨를 맑음으로 변경했습니다.' };
      }
      const match = WEATHER_POOL.find((w) => w.name.includes(clean) || w.id.includes(clean));
      if (match) {
        activeWeather = { ...match, startedAt: Date.now(), endsAt: Date.now() + (match.durationMs || 600000) };
        io.to(FISHING_ROOM_ID).emit('fishing_weather_state', getPublicWeatherState());
        const sysMsg = { id: 'wsys_' + Date.now(), nickname: '시스템', rodLevel: 0, text: `${match.icon || '🌦️'} 관리자가 [${match.name}] 날씨를 발동했습니다!`, at: Date.now() };
        chatHistory.push(sysMsg);
        if (chatHistory.length > 60) chatHistory.shift();
        io.to(FISHING_ROOM_ID).emit('fishing_chat_message', sysMsg);
        return { ok: true, message: `${match.icon || '🌦️'} 낚시터 날씨를 [${match.name}](으)로 변경했습니다!` };
      }
      triggerRandomWeather();
      return { ok: true, message: `🌦️ 낚시터 랜덤 특수 날씨(${activeWeather ? activeWeather.name : '발동'})를 적용했습니다!` };
    },
    startTournamentAdmin: (mins = 10) => {
      const durMs = Math.max(1, Math.min(60, Number(mins) || 10)) * 60 * 1000;
      if (tournament.timer) { clearTimeout(tournament.timer); tournament.timer = null; }
      tournament.active = true;
      tournament.startedAt = Date.now();
      tournament.endsAt = Date.now() + durMs;
      tournament.entries = new Map();
      tournament.timer = setTimeout(() => finishTournament(), durMs);
      broadcastTournamentState();
      return { ok: true, message: `🏆 ${Math.round(durMs / 60000)}분 낚시 대회를 즉시 시작했습니다!` };
    },
    stopTournamentAdmin: () => {
      if (!tournament.active) return { ok: true, message: 'ℹ️ 현재 진행 중인 낚시 대회가 없습니다.' };
      finishTournament();
      return { ok: true, message: '🏆 진행 중이던 낚시 대회를 즉시 종료하고 시상을 마쳤습니다.' };
    },
    spawnGiftBoxAdmin: () => {
      spawnRandomGiftBox();
      return { ok: true, message: '🎁 낚시터에 깜짝 선착순 보물상자를 즉시 투하했습니다!' };
    },
    resetDailyBaitAdmin: (targetNick = null) => {
      const today = getTodayKstString();
      if (targetNick) {
        const u = findUserByNickname(targetNick);
        if (!u) return { ok: false, error: `유저 '${targetNick}'을(를) 찾을 수 없습니다.` };
        const f = ensureUserFishing(u);
        f.dailyBaitUsed = 0;
        f.dailyBaitDate = today;
        if (Array.isArray(f.rods)) f.rods.forEach((r) => { r.dailyBaitUsed = 0; r.dailyBaitDate = today; });
        saveUsersDB(usersDB);
        return { ok: true, message: `🔄 [${u.nickname}]님의 오늘 미끼 사용 횟수를 초기화했습니다.` };
      }
      let cnt = 0;
      usersDB.forEach((u) => {
        const f = ensureUserFishing(u);
        f.dailyBaitUsed = 0;
        f.dailyBaitDate = today;
        if (Array.isArray(f.rods)) f.rods.forEach((r) => { r.dailyBaitUsed = 0; r.dailyBaitDate = today; });
        cnt++;
      });
      saveUsersDB(usersDB);
      return { ok: true, message: `🔄 전체 유저(${cnt}명)의 오늘 미끼 사용 횟수를 초기화했습니다.` };
    }
  };
}

module.exports = { setupFishingModule };
