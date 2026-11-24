/**
 * 🔱 낚시 레이드 (2~4인 파티 심해 작살 아케이드) 서버 모듈 v1.7.2
 * - 메이플스토리 보스 레이드 스타일 2~4인 파티 대기방 (최소 2인 출발 · 하루 3회)
 * - 4대 긴장감 기믹:
 *   1) 🚢 선박 내구도(공용 HP 100) & 위협(기뢰·돌진상어·보스촉수) 요격 — 0이 되면 침몰 패배
 *   2) ⚡ 차징 관통 작살 (황금 타이밍 발사 시 경로 전체 관통 + 2.4배 딜 / 과열 불발)
 *   3) 🦑 보스 팀원 포박 & 동료 구출 (5.5초 안에 팀원이 촉수 격파 시 구출 보너스)
 *   4) 🔥 보스 광폭화(HP 30% 이하) & ⚡ 협동 카운터(2인 이상 동시 타격 시 3배 대경직)
 */

const DAILY_RAID_LIMIT = 3;
const RAID_DURATION_SEC = 80;
const ARENA_W = 960;
const ARENA_H = 540;
const SHIP_MAX_HP = 100;

// 2인 / 3인 / 4인 파티별 난이도·보상 스케일 (현재 4인팟 체감 난이도를 1.0 기준으로 정규화!)
const PARTY_SCALE = {
  2: { label: '2인팟', bossHp: 0.42, threatHp: 0.48, trapHp: 0.45, spawnCd: 1.45, shipDmg: 0.75, rewardMult: 0.85, dropMult: 1.0 },
  3: { label: '3인팟', bossHp: 0.70, threatHp: 0.74, trapHp: 0.72, spawnCd: 1.18, shipDmg: 0.88, rewardMult: 1.00, dropMult: 1.08 },
  4: { label: '4인팟', bossHp: 1.00, threatHp: 1.00, trapHp: 1.00, spawnCd: 1.00, shipDmg: 1.00, rewardMult: 1.20, dropMult: 1.20 }
};
function getPartyScale(n) {
  const k = Math.max(2, Math.min(4, Number(n) || 2));
  return PARTY_SCALE[k] || PARTY_SCALE[2];
}

const DIFFICULTIES = {
  NORMAL: {
    id: 'NORMAL',
    label: '노말',
    badgeColor: '#38bdf8',
    entryFee: 50000,
    bossName: '대왕 크라켄',
    bossIcon: '🐙',
    bossColor: '#f43f5e',
    baseBossHp: 29400,
    baseShieldHp: 7300,
    threatDmg: 22,
    clearBasePerPlayer: 180000,
    clearSharePoolPerPlayer: 120000,
    mvpBonus: 30000,
    lastHitBonus: 20000,
    fishGoldMult: 1.0,
    chestChance: 0.16,
    protectChance: 0.03
  },
  HARD: {
    id: 'HARD',
    label: '하드',
    badgeColor: '#a855f7',
    entryFee: 150000,
    bossName: '빙하 메갈로돈',
    bossIcon: '🦈',
    bossColor: '#38bdf8',
    baseBossHp: 57200,
    baseShieldHp: 14000,
    threatDmg: 26,
    clearBasePerPlayer: 600000,
    clearSharePoolPerPlayer: 400000,
    mvpBonus: 100000,
    lastHitBonus: 60000,
    fishGoldMult: 2.2,
    chestChance: 0.25,
    protectChance: 0.06
  },
  CHAOS: {
    id: 'CHAOS',
    label: '카오스',
    badgeColor: '#facc15',
    entryFee: 400000,
    bossName: '황금 리바이어던',
    bossIcon: '🐉',
    bossColor: '#facc15',
    baseBossHp: 102400,
    baseShieldHp: 24700,
    threatDmg: 32,
    clearBasePerPlayer: 1500000,
    clearSharePoolPerPlayer: 1000000,
    mvpBonus: 250000,
    lastHitBonus: 150000,
    fishGoldMult: 4.8,
    chestChance: 0.38,
    protectChance: 0.10
  }
};

const FISH_TYPES = [
  { kind: 'sardine', name: '은빛 정어리', icon: '🐟', hp: 110, r: 24, speed: 120, gold: 1800, color: '#7dd3fc', weight: 32 },
  { kind: 'tuna', name: '황금 참치', icon: '🐠', hp: 220, r: 29, speed: 102, gold: 4200, color: '#fbbf24', weight: 26 },
  { kind: 'manta', name: '심해 만타', icon: '🦈', hp: 360, r: 35, speed: 86, gold: 7800, color: '#818cf8', weight: 16 },
  { kind: 'bomb_puffer', name: '폭탄 복어', icon: '🐡', hp: 170, r: 30, speed: 80, gold: 5000, color: '#fb7185', weight: 11, special: 'BOMB' },
  { kind: 'jelly', name: '전기 해파리', icon: '🪼', hp: 100, r: 27, speed: 68, gold: 0, color: '#22d3ee', weight: 10, special: 'STUN' },
  { kind: 'chest', name: '심해 보물상자', icon: '🧰', hp: 520, r: 34, speed: 66, gold: 16000, color: '#facc15', weight: 5, special: 'CHEST' }
];

function setupFishingRaidModule(app, io, deps) {
  const {
    usersDB,
    saveUsersDB,
    findUserByValidCode,
    findUserByNickname,
    ensureUserStatsStructure,
    economyHooks,
    getTodayKstString,
    getRaidEntryFees,
    onRoomsChange
  } = deps;

  function getLiveDiff(key) {
    const base = DIFFICULTIES[key] || DIFFICULTIES.NORMAL;
    const overrides = typeof getRaidEntryFees === 'function' ? (getRaidEntryFees() || {}) : {};
    const fee = (typeof overrides[base.id] === 'number' && !Number.isNaN(overrides[base.id]) && overrides[base.id] >= 0)
      ? Math.floor(overrides[base.id])
      : base.entryFee;
    return { ...base, entryFee: fee };
  }
  function getAllLiveDiffs() {
    return { NORMAL: getLiveDiff('NORMAL'), HARD: getLiveDiff('HARD'), CHAOS: getLiveDiff('CHAOS') };
  }

  const rooms = new Map();
  const socketToRoom = new Map();

  function syncUserRaidQuota(u) {
    ensureUserStatsStructure(u);
    if (!u.game_data.fishing) u.game_data.fishing = {};
    const f = u.game_data.fishing;
    const today = getTodayKstString();
    if (f.raidDate !== today) {
      f.raidDate = today;
      f.raidUsed = 0;
    }
    if (typeof f.raidUsed !== 'number' || Number.isNaN(f.raidUsed)) f.raidUsed = 0;
    if (typeof f.raidTotalClears !== 'number' || Number.isNaN(f.raidTotalClears)) f.raidTotalClears = 0;
    return {
      usedToday: f.raidUsed,
      dailyLimit: DAILY_RAID_LIMIT,
      remainingToday: Math.max(0, DAILY_RAID_LIMIT - f.raidUsed),
      totalClears: f.raidTotalClears
    };
  }

  function getUserRodProfile(u) {
    const f = (u && u.game_data && u.game_data.fishing) ? u.game_data.fishing : {};
    let rodLevel = Number(f.rodLevel || 0);
    let rodAwakening = Number(f.rodAwakening || 0);
    let rodSkinLevel = typeof f.rodSkinLevel === 'number' ? f.rodSkinLevel : rodLevel;
    let rodBoundSkin = f.rodBoundSkin || null;
    if (Array.isArray(f.rods) && f.rods.length > 0) {
      const eq = f.rods.find((r) => r.id === f.equippedRodId) || f.rods[0];
      if (eq) {
        rodLevel = Number(eq.level || 0);
        rodAwakening = Number(eq.awakening || 0);
        rodBoundSkin = eq.boundSkin || rodBoundSkin;
        rodSkinLevel = typeof eq.skinLevel === 'number' ? eq.skinLevel : rodLevel;
      }
    }
    const cosmetics = (economyHooks && typeof economyHooks.getUserCosmetics === 'function')
      ? economyHooks.getUserCosmetics(u.nickname)
      : {};
    return { rodLevel, rodAwakening, rodSkinLevel, rodBoundSkin, cosmetics };
  }

  function getSeatX(seatIndex, totalSeats) {
    const count = Math.max(1, totalSeats);
    const margin = 150;
    if (count === 1) return ARENA_W / 2;
    const usable = ARENA_W - margin * 2;
    return Math.round(margin + (usable / (count - 1)) * seatIndex);
  }

  function serializeRoomSummary(room) {
    const diff = getLiveDiff(room.difficulty);
    return {
      id: room.id,
      title: room.title,
      difficulty: diff.id,
      difficultyLabel: diff.label,
      entryFee: diff.entryFee,
      bossName: diff.bossName,
      bossIcon: diff.bossIcon,
      maxPlayers: room.maxPlayers,
      memberCount: room.members.length,
      hostNickname: room.hostNickname,
      status: room.status
    };
  }

  function serializeRoomState(room) {
    const diff = getLiveDiff(room.difficulty);
    return {
      id: room.id,
      title: room.title,
      difficulty: diff.id,
      difficultyMeta: diff,
      maxPlayers: room.maxPlayers,
      hostSocketId: room.hostSocketId,
      hostNickname: room.hostNickname,
      status: room.status,
      chat: room.chat.slice(-30),
      members: room.members.map((m, idx) => ({
        socketId: m.socketId,
        userId: m.userId,
        nickname: m.nickname,
        ready: m.ready,
        isHost: m.socketId === room.hostSocketId,
        seatIndex: idx,
        rodLevel: m.rodLevel,
        rodAwakening: m.rodAwakening,
        rodSkinLevel: m.rodSkinLevel,
        rodBoundSkin: m.rodBoundSkin,
        cosmetics: m.cosmetics,
        remainingToday: m.remainingToday,
        gold: m.gold
      }))
    };
  }

  function broadcastRoomsList() {
    const list = Array.from(rooms.values()).map(serializeRoomSummary);
    io.to('fishing_raid_lobby').emit('fr_rooms_list', { rooms: list });
    if (typeof onRoomsChange === 'function') onRoomsChange();
  }

  function broadcastRoomState(room) {
    io.to('fr_room:' + room.id).emit('fr_room_state', serializeRoomState(room));
  }

  function stopRaidLoop(room) {
    if (room && room.tickTimer) {
      clearInterval(room.tickTimer);
      room.tickTimer = null;
    }
  }

  function damageShip(room, dmg, reason) {
    const game = room.game;
    if (!game) return;
    game.shipHp = Math.max(0, game.shipHp - dmg);
    game.shakeSeq += 1;
    io.to('fr_room:' + room.id).emit('fr_ship_hit', { dmg, shipHp: game.shipHp, reason });
    if (game.shipHp <= 0 && game.defeatTimer <= 0 && game.victoryTimer <= 0) {
      game.threats = [];
      game.projectiles = [];
      game.defeatTimer = game.defeatTotal;
      game.defeatShipSunk = true;
      game.shakeSeq += 1;
      io.to('fr_room:' + room.id).emit('fr_banner', {
        text: `🚢 선박 내구도 0! 배가 침몰하고 있습니다...`,
        tone: 'danger'
      });
    }
  }

  function spawnFish(room, wave) {
    const game = room.game;
    if (!game) return;
    const diff = getLiveDiff(room.difficulty);
    const partyScale = 1 + Math.max(0, game.initialPartySize - 1) * 0.35;

    const pool = FISH_TYPES.map((ft) => {
      let w = ft.weight;
      if (wave === 2 && (ft.kind === 'chest' || ft.kind === 'tuna' || ft.kind === 'manta')) w *= 1.8;
      if (wave === 3 && ft.kind === 'jelly') w *= 0.6;
      return { ft, w };
    });
    const totalW = pool.reduce((s, x) => s + x.w, 0);
    let r = Math.random() * totalW;
    let chosen = FISH_TYPES[0];
    for (const item of pool) {
      r -= item.w;
      if (r <= 0) { chosen = item.ft; break; }
    }

    const fromLeft = Math.random() < 0.5;
    const y = 70 + Math.random() * 255;
    const spd = chosen.speed * (0.85 + Math.random() * 0.35);
    const maxHp = Math.round(chosen.hp * (diff.id === 'CHAOS' ? 1.8 : diff.id === 'HARD' ? 1.35 : 1.0) * (chosen.special === 'CHEST' ? partyScale : 1));
    const goldVal = Math.round(chosen.gold * diff.fishGoldMult);

    game.entities.push({
      id: 'f_' + (++game.seq),
      kind: chosen.kind,
      name: chosen.name,
      icon: chosen.icon,
      special: chosen.special || null,
      color: chosen.color,
      x: fromLeft ? -35 : ARENA_W + 35,
      y,
      baseY: y,
      vx: fromLeft ? spd : -spd,
      phase: Math.random() * Math.PI * 2,
      r: chosen.r,
      hp: maxHp,
      maxHp,
      gold: goldVal
    });
  }

  function spawnThreat(room, fromBoss = false) {
    const game = room.game;
    if (!game) return;
    const diff = getLiveDiff(room.difficulty);
    const isBoss = fromBoss && game.boss && game.boss.alive;
    const x = isBoss ? (game.boss.x + (Math.random() - 0.5) * 100) : (120 + Math.random() * (ARENA_W - 240));
    const y = isBoss ? (game.boss.y + 34) : 35;
    const isMine = !isBoss && Math.random() < 0.55;
    const waveFactor = game.wave === 1 ? 0.72 : game.wave === 2 ? 0.92 : 1.0;
    const vy = isBoss
      ? (game.boss.enraged ? 92 : 72)
      : Math.round((isMine ? 76 : 96) * (game.wave === 1 ? 0.85 : 1.0));
    const pScale = getPartyScale(game.initialPartySize);
    const maxHp = Math.round((isBoss ? 1350 : isMine ? 800 : 980) * waveFactor * (diff.id === 'CHAOS' ? 1.85 : diff.id === 'HARD' ? 1.38 : 1.0) * pScale.threatHp);
    game.threats.push({
      id: 'th_' + (++game.seq),
      icon: isBoss ? (diff.id === 'HARD' ? '🧊' : '🦑') : (isMine ? '💣' : '🦈'),
      label: isBoss ? '보스 공격!' : (isMine ? '기뢰!' : '돌진 상어!'),
      x: Math.max(80, Math.min(ARENA_W - 80, x)),
      y,
      vy,
      r: 28,
      hp: maxHp,
      maxHp,
      dmg: Math.max(8, Math.round((diff.threatDmg + (isBoss && game.boss.enraged ? 4 : 0)) * pScale.shipDmg)),
      gold: Math.round(2500 * diff.fishGoldMult)
    });
  }

  function spawnBoss(room) {
    const game = room.game;
    const diff = getLiveDiff(room.difficulty);
    const pScale = getPartyScale(game.initialPartySize);
    const maxHp = Math.round(diff.baseBossHp * pScale.bossHp);
    const shieldMax = Math.round(diff.baseShieldHp * pScale.bossHp);
    game.boss = {
      name: diff.bossName,
      icon: diff.bossIcon,
      color: diff.bossColor,
      x: ARENA_W / 2,
      y: 112,
      vx: 78,
      r: 74,
      hp: maxHp,
      maxHp,
      alive: true,
      enraged: false,
      weakOffsetX: 30,
      weakOffsetY: -10,
      weakR: 28,
      weakTimer: 3.0,
      shieldHp: 0,
      shieldMax,
      shieldTimer: 0,
      shieldCount: 0,
      groggyTimer: 0,
      groggyMult: 2.0,
      inkTimer: 0,
      counterTimer: 0,
      counterPhase: 0,
      counterHitters: new Set(),
      grabCooldown: 6.0,
      hazardCooldown: 3.0
    };
    io.to('fr_room:' + room.id).emit('fr_banner', {
      text: `🚨 최종 보스 [${diff.bossIcon} ${diff.bossName}] 출현! 약점 타격 · 위협 요격 · 동료 구출에 대비하세요!`,
      tone: 'danger'
    });
  }

  function finishRaid(room, bossDefeated, shipSunk = false) {
    if (!room || !room.game || room.status !== 'PLAYING') return;
    stopRaidLoop(room);
    room.status = 'RESULT';
    const game = room.game;
    const diff = getLiveDiff(room.difficulty);
    const pScale = getPartyScale(game.initialPartySize);
    const isFullParty = game.initialPartySize >= 4;
    const dropBonusMult = pScale.dropMult;
    const rewardMult = pScale.rewardMult;

    const totalDmg = Math.max(1, room.members.reduce((s, m) => s + (game.stats[m.userId]?.damage || 0), 0));
    const sortedByDmg = [...room.members].sort((a, b) => (game.stats[b.userId]?.damage || 0) - (game.stats[a.userId]?.damage || 0));
    const mvpUserId = (bossDefeated && sortedByDmg.length > 0 && (game.stats[sortedByDmg[0].userId]?.damage || 0) > 0)
      ? sortedByDmg[0].userId
      : null;

    const results = [];
    for (const m of room.members) {
      const st = game.stats[m.userId] || { damage: 0, kills: 0, waveGold: 0, bonusChests: 0, rescues: 0 };
      const u = findUserByNickname(m.nickname);
      const shareRatio = st.damage / totalDmg;
      const clearBase = bossDefeated ? Math.round(diff.clearBasePerPlayer * rewardMult) : 0;
      const clearShare = bossDefeated ? Math.round(diff.clearSharePoolPerPlayer * rewardMult * room.members.length * shareRatio) : 0;
      const mvpGold = (bossDefeated && m.userId === mvpUserId) ? Math.round(diff.mvpBonus * rewardMult) : 0;
      const lastHitGold = (bossDefeated && m.userId === game.bossLastHitUserId) ? Math.round((diff.lastHitBonus || 0) * rewardMult) : 0;
      // If ship sunk, players keep 50% of wave fish gold
      const waveGoldFinal = shipSunk ? Math.round(st.waveGold * 0.5) : st.waveGold;
      const totalGold = Math.round(waveGoldFinal + clearBase + clearShare + mvpGold + lastHitGold);

      const drops = [];
      let chestsGained = st.bonusChests || 0;
      if (bossDefeated && Math.random() < diff.chestChance * dropBonusMult) chestsGained += 1;
      let protectGained = 0;
      if (bossDefeated && Math.random() < diff.protectChance * dropBonusMult) protectGained += 1;

      if (u) {
        ensureUserStatsStructure(u);
        if (!u.game_data.fishing) u.game_data.fishing = {};
        if (totalGold > 0) economyHooks.addUserGold(u.nickname, totalGold, 'fishing_raid_reward');
        if (chestsGained > 0) {
          u.game_data.fishing.treasureChests = (u.game_data.fishing.treasureChests || 0) + chestsGained;
          drops.push(`🧰 심해 보물상자 ×${chestsGained}`);
        }
        if (protectGained > 0 && u.game_data.cosmetics) {
          const cnts = u.game_data.cosmetics.itemCounts || (u.game_data.cosmetics.itemCounts = {});
          cnts.rod_protect_ticket = Math.max(0, Number(cnts.rod_protect_ticket || 0)) + protectGained;
          drops.push(`🛡️ 대장간 파괴 방지권 ×${protectGained}`);
        }
        if (bossDefeated) {
          u.game_data.fishing.raidTotalClears = (u.game_data.fishing.raidTotalClears || 0) + 1;
          if (!u.game_data.cosmetics) u.game_data.cosmetics = { ownedTitles: [], equippedTitle: '', ownedColors: [], equippedColor: '', ownedMarbleSkins: [], equippedMarbleSkin: '' };
          if (!Array.isArray(u.game_data.cosmetics.ownedTitles)) u.game_data.cosmetics.ownedTitles = [];
          const diffTitleMap = {
            NORMAL: { id: 'title_raid_kraken', label: '[🐙 크라켄 사냥꾼]' },
            HARD: { id: 'title_raid_megalodon', label: '[🦈 빙하의 학살자]' },
            CHAOS: { id: 'title_raid_leviathan', label: '[🐉 리바이어던 슬레이어]' }
          };
          const dt = diffTitleMap[diff.id];
          if (dt && !u.game_data.cosmetics.ownedTitles.includes(dt.id)) {
            u.game_data.cosmetics.ownedTitles.push(dt.id);
            drops.push(`🏷️ 전용 칭호 ${dt.label}`);
          }
          if (u.game_data.fishing.raidTotalClears >= 15 && !u.game_data.cosmetics.ownedTitles.includes('title_raid_master')) {
            u.game_data.cosmetics.ownedTitles.push('title_raid_master');
            drops.push('🏷️ 전용 칭호 [🏹 전설의 석궁수]');
          }
        }
        u.updated_at = new Date().toISOString();
        m.gold = u.gold;
        m.remainingToday = syncUserRaidQuota(u).remainingToday;
      }

      m.ready = (m.socketId === room.hostSocketId);

      results.push({
        userId: m.userId,
        nickname: m.nickname,
        cosmetics: m.cosmetics,
        rodLevel: m.rodLevel,
        damage: st.damage,
        damagePct: Math.round(shareRatio * 100),
        kills: st.kills,
        rescues: st.rescues || 0,
        waveGold: waveGoldFinal,
        clearGold: clearBase + clearShare,
        mvpGold,
        lastHitGold,
        totalGold,
        isMvp: m.userId === mvpUserId,
        isLastHit: bossDefeated && m.userId === game.bossLastHitUserId,
        drops
      });
    }

    saveUsersDB(usersDB);

    if (bossDefeated && diff.id === 'CHAOS' && economyHooks.broadcastGlobalAnnouncement) {
      const names = room.members.map((m) => m.nickname).join(', ');
      economyHooks.broadcastGlobalAnnouncement({
        type: 'fishing_raid_clear',
        text: `🔱 [카오스 낚시 레이드 토벌!] ${names} 파티가 [${diff.bossIcon} ${diff.bossName}]을(를) 격파했습니다!!`
      });
    }

    io.to('fr_room:' + room.id).emit('fr_raid_result', {
      bossDefeated,
      shipSunk,
      shipHp: game.shipHp,
      difficulty: diff.id,
      difficultyLabel: diff.label,
      bossName: diff.bossName,
      bossIcon: diff.bossIcon,
      elapsedSec: Math.min(RAID_DURATION_SEC, Math.round(game.elapsed)),
      partySize: game.initialPartySize,
      rewardMult,
      fullPartyBonus: isFullParty,
      results: results.sort((a, b) => b.damage - a.damage)
    });
    room.game = null;
    broadcastRoomState(room);
    broadcastRoomsList();
  }

  function startRaidLoop(room) {
    const stats = {};
    const playerState = {};
    const initialCount = room.members.length;
    const seatColors = ['#38bdf8', '#f472b6', '#34d399', '#facc15'];

    room.members.forEach((m, idx) => {
      const seatX = getSeatX(idx, initialCount);
      stats[m.userId] = { damage: 0, kills: 0, waveGold: 0, bonusChests: 0, rescues: 0 };
      playerState[m.socketId] = {
        seatIndex: idx,
        x: seatX,
        y: 472,
        angle: -Math.PI / 2,
        lastShotAt: 0,
        stunUntil: 0,
        trappedHp: 0,
        trappedMaxHp: 0,
        trappedTimer: 0,
        color: seatColors[idx % 4],
        damage: Math.round(72 + m.rodLevel * 12 + m.rodAwakening * 14),
        cooldownMs: Math.max(400, 620 - m.rodLevel * 14),
        critChance: Math.min(0.45, 0.10 + m.rodAwakening * 0.06)
      };
    });

    room.status = 'PLAYING';
    const introDiff = getLiveDiff(room.difficulty);
    room.game = {
      seq: 0,
      shakeSeq: 0,
      initialPartySize: initialCount,
      shipHp: SHIP_MAX_HP,
      shipMaxHp: SHIP_MAX_HP,
      startedAt: Date.now(),
      introTotal: 3.4,
      introTimer: 3.4,
      introBossIcon: introDiff.bossIcon,
      introBossName: introDiff.bossName,
      introDiffLabel: introDiff.label,
      victoryTotal: 2.6,
      victoryTimer: 0,
      defeatTotal: 2.4,
      defeatTimer: 0,
      defeatShipSunk: false,
      elapsed: 0,
      wave: 1,
      feverGauge: 0,
      feverTimer: 0,
      spawnAcc: 0,
      threatAcc: 0,
      entities: [],
      threats: [],
      projectiles: [],
      effects: [],
      boss: null,
      stats,
      playerState
    };

    for (let i = 0; i < 6; i++) spawnFish(room, 1);

    broadcastRoomState(room);
    broadcastRoomsList();

    // 출항 인트로(3.4초) 종료 후 전투 시작 배너를 띄웁니다.

    const TICK_MS = 33;
    const dt = TICK_MS / 1000;

    room.tickTimer = setInterval(() => {
      const game = room.game;
      if (!game || room.status !== 'PLAYING') {
        stopRaidLoop(room);
        return;
      }
      const now = Date.now();

      // 1) 출항 인트로 연출 (깜빡깜빡 경고 + 보스 등장 컷인 + 카운트다운)
      if (game.introTimer > 0) {
        game.introTimer = Math.max(0, game.introTimer - dt);
        game.startedAt = now; // 실제 전투 타이머는 인트로 종료 시점부터 시작!
        if (game.introTimer <= 0) {
          io.to('fr_room:' + room.id).emit('fr_banner', {
            text: `🏹 전투 시작!! 꾹 눌러 차징 관통 화살 · 전기 해파리는 전원 감전 주의!`,
            tone: 'info'
          });
        }
        io.to('fr_room:' + room.id).volatile.emit('fr_snapshot', {
          t: RAID_DURATION_SEC,
          w: 1,
          shp: game.shipHp,
          smax: game.shipMaxHp,
          shk: game.shakeSeq,
          fg: 0,
          ft: 0,
          intro: {
            rem: +game.introTimer.toFixed(2),
            tot: game.introTotal,
            icon: game.introBossIcon,
            name: game.introBossName,
            diff: game.introDiffLabel
          },
          e: [],
          th: [],
          p: [],
          fx: [],
          b: null,
          pl: room.members.map((m) => {
            const ps = game.playerState[m.socketId];
            return {
              seat: ps ? ps.seatIndex : 0,
              x: ps ? ps.x : ARENA_W / 2,
              nick: m.nickname,
              pet: (m.cosmetics && m.cosmetics.fishingPet) || '',
              rodLv: typeof m.rodSkinLevel === 'number' ? m.rodSkinLevel : (m.rodLevel || 0),
              col: ps ? ps.color : '#38bdf8',
              ang: ps ? +ps.angle.toFixed(2) : -1.57,
              cd: 1,
              stun: 0,
              trHp: 0,
              trMax: 0,
              trT: 0,
              dmg: 0,
              gold: 0
            };
          })
        });
        return;
      }

      // 2) 보스 격파 승리 모션 (2.6초 폭발·침몰 연출 후 결과 정산)
      if (game.victoryTimer > 0) {
        game.victoryTimer = Math.max(0, game.victoryTimer - dt);
        for (let i = game.effects.length - 1; i >= 0; i--) {
          game.effects[i].life -= dt;
          game.effects[i].y -= 28 * dt;
          if (game.effects[i].life <= 0) game.effects.splice(i, 1);
        }
        if (game.victoryTimer <= 0) {
          finishRaid(room, true, false);
          return;
        }
        io.to('fr_room:' + room.id).volatile.emit('fr_snapshot', {
          t: +(Math.max(0, RAID_DURATION_SEC - game.elapsed)).toFixed(1),
          w: 3,
          shp: game.shipHp,
          smax: game.shipMaxHp,
          shk: game.shakeSeq,
          fg: Math.round(game.feverGauge),
          ft: +game.feverTimer.toFixed(1),
          vic: {
            rem: +game.victoryTimer.toFixed(2),
            tot: game.victoryTotal,
            x: game.boss ? Math.round(game.boss.x) : ARENA_W / 2,
            y: game.boss ? Math.round(game.boss.y) : 112,
            icon: game.boss ? game.boss.icon : game.introBossIcon,
            name: game.boss ? game.boss.name : game.introBossName
          },
          e: [],
          th: [],
          p: [],
          fx: game.effects.slice(-26).map((fx) => [Math.round(fx.x), Math.round(fx.y), fx.text, fx.color, fx.blast ? 1 : 0]),
          b: null,
          pl: room.members.map((m) => {
            const ps = game.playerState[m.socketId];
            const st = game.stats[m.userId] || { damage: 0, waveGold: 0 };
            return {
              seat: ps ? ps.seatIndex : 0,
              x: ps ? ps.x : ARENA_W / 2,
              nick: m.nickname,
              pet: (m.cosmetics && m.cosmetics.fishingPet) || '',
              rodLv: typeof m.rodSkinLevel === 'number' ? m.rodSkinLevel : (m.rodLevel || 0),
              col: ps ? ps.color : '#38bdf8',
              ang: ps ? +ps.angle.toFixed(2) : -1.57,
              cd: 1,
              stun: 0,
              trHp: 0,
              trMax: 0,
              trT: 0,
              dmg: st.damage,
              gold: st.waveGold
            };
          })
        });
        return;
      }

      // 3) 레이드 실패 연출 (2.4초 침몰 / 타임오버 보스 도주 연출 후 결과 정산)
      if (game.defeatTimer > 0) {
        game.defeatTimer = Math.max(0, game.defeatTimer - dt);
        for (let i = game.effects.length - 1; i >= 0; i--) {
          game.effects[i].life -= dt;
          game.effects[i].y -= 28 * dt;
          if (game.effects[i].life <= 0) game.effects.splice(i, 1);
        }
        if (game.defeatTimer <= 0) {
          finishRaid(room, false, Boolean(game.defeatShipSunk));
          return;
        }
        io.to('fr_room:' + room.id).volatile.emit('fr_snapshot', {
          t: +(Math.max(0, RAID_DURATION_SEC - game.elapsed)).toFixed(1),
          w: game.wave,
          shp: game.shipHp,
          smax: game.shipMaxHp,
          shk: game.shakeSeq,
          fg: Math.round(game.feverGauge),
          ft: 0,
          def: {
            rem: +game.defeatTimer.toFixed(2),
            tot: game.defeatTotal,
            sunk: game.defeatShipSunk ? 1 : 0,
            icon: game.boss ? game.boss.icon : game.introBossIcon,
            name: game.boss ? game.boss.name : game.introBossName
          },
          e: [],
          th: [],
          p: [],
          fx: game.effects.slice(-26).map((fx) => [Math.round(fx.x), Math.round(fx.y), fx.text, fx.color, fx.blast ? 1 : 0]),
          b: null,
          pl: room.members.map((m) => {
            const ps = game.playerState[m.socketId];
            const st = game.stats[m.userId] || { damage: 0, waveGold: 0 };
            return {
              seat: ps ? ps.seatIndex : 0,
              x: ps ? ps.x : ARENA_W / 2,
              nick: m.nickname,
              pet: (m.cosmetics && m.cosmetics.fishingPet) || '',
              rodLv: typeof m.rodSkinLevel === 'number' ? m.rodSkinLevel : (m.rodLevel || 0),
              col: ps ? ps.color : '#38bdf8',
              ang: ps ? +ps.angle.toFixed(2) : -1.57,
              cd: 0,
              stun: 0,
              trHp: 0,
              trMax: 0,
              trT: 0,
              dmg: st.damage,
              gold: st.waveGold
            };
          })
        });
        return;
      }

      game.elapsed = (now - game.startedAt) / 1000;

      // Wave transitions
      if (game.wave === 1 && game.elapsed >= 20) {
        game.wave = 2;
        io.to('fr_room:' + room.id).emit('fr_banner', {
          text: `🧰 2웨이브: 보물선 & 돌진 위협 증가! 협동 피버로 돌파하세요!`,
          tone: 'gold'
        });
      } else if (game.wave === 2 && game.elapsed >= 40) {
        game.wave = 3;
        spawnBoss(room);
      }

      if (game.feverTimer > 0) game.feverTimer = Math.max(0, game.feverTimer - dt);

      // Spawn fish
      const targetFishCount = game.wave === 3 ? 4 : game.wave === 2 ? 10 : 8;
      game.spawnAcc += dt;
      const spawnInterval = game.wave === 2 ? 0.7 : game.wave === 3 ? 1.8 : 0.95;
      if (game.spawnAcc >= spawnInterval && game.entities.length < targetFishCount) {
        game.spawnAcc = 0;
        spawnFish(room, game.wave);
      }

      // Smooth pacing: 5s grace period at start, gentle Wave 1, ramping up in Wave 2
      if (game.wave < 3 && game.elapsed >= 5.0) {
        game.threatAcc += dt;
        const pScaleLoop = getPartyScale(game.initialPartySize);
        const thInterval = (game.wave === 1 ? 4.0 : 2.5) * pScaleLoop.spawnCd;
        const maxTh = game.wave === 1 ? 2 : (2 + Math.ceil(game.initialPartySize / 2));
        if (game.threatAcc >= thInterval && game.threats.length < maxTh) {
          game.threatAcc = 0;
          spawnThreat(room, false);
          if (game.wave === 2 && game.initialPartySize >= 3 && Math.random() < 0.3 && game.threats.length < maxTh) {
            spawnThreat(room, false);
          }
        }
      }

      // Move fish
      for (let i = game.entities.length - 1; i >= 0; i--) {
        const e = game.entities[i];
        e.x += e.vx * dt;
        e.y = e.baseY + Math.sin(game.elapsed * 2.4 + e.phase) * 14;
        if (e.x < -80 || e.x > ARENA_W + 80) game.entities.splice(i, 1);
      }

      // Move threats downward toward boat
      for (let i = game.threats.length - 1; i >= 0; i--) {
        const th = game.threats[i];
        th.y += th.vy * dt;
        if (th.y >= 438) {
          game.effects.push({ x: th.x, y: 432, text: `💥 선박 -${th.dmg}!`, color: '#fb7185', life: 1.0, blast: true });
          game.threats.splice(i, 1);
          damageShip(room, th.dmg, th.label);
          if (room.status !== 'PLAYING') return;
        }
      }

      // Update trapped players (Tentacle Grab rescue timer)
      for (const m of room.members) {
        const ps = game.playerState[m.socketId];
        if (ps && ps.trappedHp > 0) {
          ps.trappedTimer -= dt;
          if (ps.trappedTimer <= 0) {
            ps.trappedHp = 0;
            ps.trappedTimer = 0;
            game.effects.push({ x: ps.x, y: 440, text: '🦑 구출 실패! 선박 -24', color: '#fb7185', life: 1.1, blast: true });
            damageShip(room, 24, '촉수 구출 실패');
            if (room.status !== 'PLAYING') return;
          }
        }
      }

      // Update Boss
      if (game.boss && game.boss.alive) {
        const b = game.boss;
        if (b.inkTimer > 0) b.inkTimer = Math.max(0, b.inkTimer - dt);

        // Enrage at <= 30% HP
        if (!b.enraged && b.hp <= b.maxHp * 0.30) {
          b.enraged = true;
          b.vx = (b.vx >= 0 ? 1 : -1) * 118;
          io.to('fr_room:' + room.id).emit('fr_banner', {
            text: `🔥 [${b.name}] 광폭화 돌입!! 공격 속도 증가 · 카운터에 대비하세요!`,
            tone: 'danger'
          });
        }

        // Cooperative Counter Window trigger (at <= 55% HP and <= 24% HP)
        if (b.counterTimer <= 0 && b.shieldTimer <= 0 && b.groggyTimer <= 0) {
          if ((b.counterPhase === 0 && b.hp <= b.maxHp * 0.55) || (b.counterPhase === 1 && b.hp <= b.maxHp * 0.24)) {
            b.counterPhase += 1;
            b.counterTimer = 2.4;
            b.counterHitters = new Set();
            io.to('fr_room:' + room.id).emit('fr_banner', {
              text: `⚡ 협동 카운터 타이밍! 2.4초 안에 파티원 2명 이상이 보스를 동시 사격하세요!!`,
              tone: 'gold'
            });
          }
        }

        if (b.counterTimer > 0) {
          b.counterTimer -= dt;
          if (b.counterTimer <= 0) {
            // Failed cooperative counter!
            b.counterHitters.clear();
            game.effects.push({ x: b.x, y: b.y + 40, text: '🌊 카운터 실패! 선박 -28!', color: '#fb7185', life: 1.2, blast: true });
            damageShip(room, 28, '보스 광역 돌진');
            if (room.status !== 'PLAYING') return;
          }
        } else if (b.groggyTimer > 0) {
          b.groggyTimer = Math.max(0, b.groggyTimer - dt);
        } else {
          const speedMult = b.shieldTimer > 0 ? 0.45 : 1.0;
          b.x += b.vx * speedMult * dt;
          if (b.x < 150) { b.x = 150; b.vx = Math.abs(b.vx); }
          if (b.x > ARENA_W - 150) { b.x = ARENA_W - 150; b.vx = -Math.abs(b.vx); }
          b.y = 112 + Math.sin(game.elapsed * (b.enraged ? 3.0 : 1.9)) * 12;

          // Boss launches multi-lane hull threats
          b.hazardCooldown -= dt;
          const maxBossTh = 3 + game.initialPartySize;
          if (b.hazardCooldown <= 0 && game.threats.length < maxBossTh) {
            b.hazardCooldown = (b.enraged ? 2.1 : 3.2) * getPartyScale(game.initialPartySize).spawnCd;
            spawnThreat(room, true);
            if ((b.enraged || game.initialPartySize >= 3) && game.threats.length < maxBossTh) {
              spawnThreat(room, true);
            }
          }

          // Boss Tentacle Grab on a random active player
          b.grabCooldown -= dt;
          if (b.grabCooldown <= 0 && room.members.length >= 2) {
            b.grabCooldown = b.enraged ? 5.8 : 7.8;
            const candidates = room.members.filter((m) => {
              const ps = game.playerState[m.socketId];
              return ps && ps.trappedHp <= 0;
            });
            if (candidates.length >= 2) {
              const victim = candidates[Math.floor(Math.random() * candidates.length)];
              const vps = game.playerState[victim.socketId];
              const trapHp = Math.round(680 * (room.difficulty === 'CHAOS' ? 1.8 : room.difficulty === 'HARD' ? 1.35 : 1.0) * getPartyScale(game.initialPartySize).trapHp);
              vps.trappedMaxHp = trapHp;
              vps.trappedHp = trapHp;
              vps.trappedTimer = 4.8;
              io.to('fr_room:' + room.id).emit('fr_banner', {
                text: `🦑 ${victim.nickname}님이 촉수에 묶였습니다! 팀원들이 포대를 집중 사격해 구출하세요! (4.8초)`,
                tone: 'warn'
              });
            }
          }
        }

        b.weakTimer -= dt;
        if (b.weakTimer <= 0) {
          b.weakTimer = 3.0;
          const ang = Math.random() * Math.PI * 2;
          const dist = 22 + Math.random() * 28;
          b.weakOffsetX = Math.round(Math.cos(ang) * dist);
          b.weakOffsetY = Math.round(Math.sin(ang) * dist);
        }

        // Shield Break Pattern at 49s and 60s
        if (b.shieldTimer <= 0 && b.groggyTimer <= 0 && b.counterTimer <= 0) {
          if ((b.shieldCount === 0 && game.elapsed >= 49) || (b.shieldCount === 1 && game.elapsed >= 64)) {
            b.shieldCount += 1;
            b.shieldHp = b.shieldMax;
            b.shieldTimer = 4.4;
            io.to('fr_room:' + room.id).emit('fr_banner', {
              text: `🛡️ 보스 보호막 전개! 4.4초 안에 전원 집중 사격으로 깨뜨리세요!`,
              tone: 'warn'
            });
          }
        } else if (b.shieldTimer > 0) {
          b.shieldTimer -= dt;
          if (b.shieldTimer <= 0 && b.shieldHp > 0) {
            b.shieldHp = 0;
            b.inkTimer = 3.2;
            damageShip(room, 15, '보호막 파괴 실패');
            if (room.status !== 'PLAYING') return;
            io.to('fr_room:' + room.id).emit('fr_banner', {
              text: `🦑 보호막 파괴 실패! 선박 -15 & 먹물 시야 방해!`,
              tone: 'danger'
            });
          }
        }
      }

      // Move harpoons & resolve collisions
      for (let i = game.projectiles.length - 1; i >= 0; i--) {
        const p = game.projectiles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.x < -30 || p.x > ARENA_W + 30 || p.y < -30 || p.y > ARENA_H + 30) {
          game.projectiles.splice(i, 1);
          continue;
        }

        let stopHarpoon = false;
        const st = game.stats[p.userId];
        const pState = game.playerState[p.socketId];
        const feverMult = game.feverTimer > 0 ? 1.5 : 1.0;

        // 0) Check Trapped Teammate Rescue Hit!
        for (const m of room.members) {
          if (m.socketId === p.socketId) continue;
          const tps = game.playerState[m.socketId];
          if (tps && tps.trappedHp > 0 && !p.hitIds.has('trap_' + m.socketId)) {
            const dx = p.x - tps.x;
            const dy = p.y - 458;
            if (dx * dx + dy * dy <= 42 * 42) {
              p.hitIds.add('trap_' + m.socketId);
              tps.trappedHp = Math.max(0, tps.trappedHp - p.damage);
              game.effects.push({ x: tps.x, y: 435, text: `✂️-${p.damage}`, color: '#34d399', life: 0.6 });
              if (tps.trappedHp <= 0) {
                tps.trappedTimer = 0;
                if (st) { st.rescues += 1; st.waveGold += 8000; }
                game.effects.push({ x: tps.x, y: 418, text: '💚 동료 구출! +8,000⭐', color: '#34d399', life: 1.1 });
                io.to('fr_room:' + room.id).emit('fr_banner', {
                  text: `💚 ${m.nickname}님 구출 성공!`,
                  tone: 'gold'
                });
              }
              if (!p.pierce) { stopHarpoon = true; break; }
            }
          }
        }

        // 1) Check Incoming Threat Intercept!
        if (!stopHarpoon) {
          for (let t = game.threats.length - 1; t >= 0; t--) {
            const th = game.threats[t];
            if (p.hitIds.has(th.id)) continue;
            const dx = p.x - th.x;
            const dy = p.y - th.y;
            if (dx * dx + dy * dy <= (th.r + 16) * (th.r + 16)) {
              p.hitIds.add(th.id);
              const dmg = p.isCrit ? Math.round(p.damage * 1.8) : p.damage;
              th.hp -= dmg;
              if (st) st.damage += dmg;
              if (th.hp <= 0) {
                if (st) { st.kills += 1; st.waveGold += th.gold; }
                game.effects.push({ x: th.x, y: th.y, text: `🛡️요격! +${th.gold.toLocaleString()}⭐`, color: '#34d399', life: 0.9 });
                game.threats.splice(t, 1);
              } else {
                game.effects.push({ x: p.x, y: p.y, text: `-${dmg}`, color: '#fbbf24', life: 0.45 });
              }
              if (!p.pierce) { stopHarpoon = true; break; }
            }
          }
        }

        // 2) Check Boss Hit
        if (!stopHarpoon && game.boss && game.boss.alive && !p.hitIds.has('boss')) {
          const b = game.boss;
          const dx = p.x - b.x;
          const dy = p.y - b.y;
          if (dx * dx + dy * dy <= (b.r + 14) * (b.r + 14)) {
            p.hitIds.add('boss');
            stopHarpoon = true;

            // Cooperative Counter Window check!
            if (b.counterTimer > 0) {
              b.counterHitters.add(p.userId);
              game.effects.push({ x: p.x, y: p.y, text: `⚡COUNTER (${b.counterHitters.size}/${Math.max(2, Math.min(room.members.length, Math.ceil(room.members.length * 0.65)))})`, color: '#fde047', life: 0.8 });
              const needed = Math.max(2, Math.min(room.members.length, Math.ceil(room.members.length * 0.65)));
              if (b.counterHitters.size >= needed) {
                b.counterTimer = 0;
                b.counterHitters.clear();
                b.groggyTimer = 5.0;
                b.groggyMult = 2.2;
                game.shakeSeq += 1;
                io.to('fr_room:' + room.id).emit('fr_banner', {
                  text: `💥 협동 카운터 대성공!! 5초간 보스 대경직 (데미지 2.2배 폭딜!!)`,
                  tone: 'gold'
                });
              }
            }

            const wx = b.x + b.weakOffsetX;
            const wy = b.y + b.weakOffsetY;
            const isWeak = ((p.x - wx) ** 2 + (p.y - wy) ** 2) <= (b.weakR + 14) ** 2;
            let dmg = p.damage;
            let tag = p.pierce ? '⚡MEGA' : '';
            if (p.isCrit) { dmg = Math.round(dmg * 1.5); tag = tag ? tag + ' CRIT' : 'CRIT!'; }
            if (isWeak) { dmg = Math.round(dmg * 1.45); tag = 'WEAK!'; }
            if (b.groggyTimer > 0) { dmg = Math.round(dmg * (b.groggyMult || 2.0)); tag = tag ? tag + ` ×${b.groggyMult}` : `GROGGY ×${b.groggyMult}!`; }

            if (b.shieldTimer > 0 && b.shieldHp > 0) {
              b.shieldHp = Math.max(0, b.shieldHp - dmg);
              if (st) st.damage += dmg;
              game.effects.push({ x: p.x, y: p.y, text: `🛡️-${dmg}`, color: '#38bdf8', life: 0.65 });
              if (b.shieldHp <= 0) {
                b.shieldTimer = 0;
                b.groggyTimer = 4.5;
                b.groggyMult = 1.7;
                io.to('fr_room:' + room.id).emit('fr_banner', {
                  text: `💥 보호막 브레이크 성공!! 4.5초간 보스 그로기 (데미지 2배)!!`,
                  tone: 'gold'
                });
              }
            } else {
              b.hp = Math.max(0, b.hp - dmg);
              if (st) st.damage += dmg;
              game.effects.push({ x: p.x, y: p.y, text: `${tag ? tag + ' ' : ''}-${dmg}`, color: isWeak || p.isCrit || p.pierce ? '#facc15' : '#ffffff', life: 0.7 });
              if (b.hp <= 0) {
                b.alive = false;
                game.bossLastHitUserId = p.userId;
                if (st) st.kills += 1;
                game.threats = [];
                game.projectiles = [];
                game.victoryTimer = game.victoryTotal;
                game.shakeSeq += 1;
                game.effects.push({ x: b.x, y: b.y, text: '💥 BOSS DEFEATED!!', color: '#fde047', life: 2.2, blast: true });
                io.to('fr_room:' + room.id).emit('fr_banner', {
                  text: `🏆 [${b.icon} ${b.name}] 토벌 성공!! 최후의 일격!!`,
                  tone: 'gold'
                });
                return;
              }
            }
          }
        }

        // 3) Check Fish Hit (piercing mega harpoon slices through multiple fish!)
        if (!stopHarpoon) {
          for (let j = game.entities.length - 1; j >= 0; j--) {
            const e = game.entities[j];
            if (p.hitIds.has(e.id)) continue;
            const dx = p.x - e.x;
            const dy = p.y - e.y;
            if (dx * dx + dy * dy <= (e.r + 14) * (e.r + 14)) {
              p.hitIds.add(e.id);
              if (e.special === 'STUN') {
                // 한 명이라도 전기 해파리를 건드리면 파티 전원 감전!
                const shooter = room.members.find((m) => m.socketId === p.socketId);
                for (const m of room.members) {
                  const mps = game.playerState[m.socketId];
                  if (mps) mps.stunUntil = now + 1800;
                }
                game.shakeSeq += 1;
                game.effects.push({ x: e.x, y: e.y, text: '⚡전원 감전!!', color: '#22d3ee', life: 1.1, blast: true });
                io.to('fr_room:' + room.id).emit('fr_banner', {
                  text: `⚡ ${shooter ? shooter.nickname : '파티원'}님이 전기 해파리를 건드려 파티 전원 1.8초 감전!!`,
                  tone: 'warn'
                });
                game.entities.splice(j, 1);
                if (!p.pierce) { stopHarpoon = true; break; }
                continue;
              }
              const dmg = p.isCrit ? Math.round(p.damage * 1.8) : p.damage;
              e.hp -= dmg;
              if (st) st.damage += dmg;
              if (game.feverTimer <= 0) {
                game.feverGauge = Math.min(100, game.feverGauge + (p.pierce ? 9 : 5.5));
                if (game.feverGauge >= 100) {
                  game.feverGauge = 0;
                  game.feverTimer = 10.0;
                  io.to('fr_room:' + room.id).emit('fr_banner', {
                    text: `🔥 파티 피버 타임 발동!! (10초간 장전 가속 & 어종 보상 1.5배!)`,
                    tone: 'gold'
                  });
                }
              }

              if (e.hp <= 0) {
                const earned = Math.round(e.gold * feverMult);
                if (st) {
                  st.kills += 1;
                  st.waveGold += earned;
                  if (e.special === 'CHEST' && Math.random() < 0.35) {
                    st.bonusChests += 1;
                    game.effects.push({ x: e.x, y: e.y - 18, text: '🧰 보물상자 +1!', color: '#facc15', life: 1.0 });
                  }
                }
                game.effects.push({ x: e.x, y: e.y, text: `+${earned.toLocaleString()}⭐`, color: '#34d399', life: 0.9 });

                if (e.special === 'BOMB') {
                  game.effects.push({ x: e.x, y: e.y, text: '💣 BOOM!', color: '#fb7185', life: 0.95, blast: true });
                  for (let k = game.entities.length - 1; k >= 0; k--) {
                    if (k === j) continue;
                    const o = game.entities[k];
                    if (o.special === 'STUN') continue;
                    const d2 = (o.x - e.x) ** 2 + (o.y - e.y) ** 2;
                    if (d2 <= 195 * 195) {
                      const bDmg = Math.round(p.damage * 1.6);
                      o.hp -= bDmg;
                      if (st) st.damage += bDmg;
                      if (o.hp <= 0) {
                        const oEarn = Math.round(o.gold * feverMult);
                        if (st) { st.kills += 1; st.waveGold += oEarn; }
                        game.effects.push({ x: o.x, y: o.y, text: `+${oEarn.toLocaleString()}⭐`, color: '#34d399', life: 0.8 });
                        game.entities.splice(k, 1);
                        if (k < j) j--;
                      }
                    }
                  }
                }
                game.entities.splice(j, 1);
              } else {
                game.effects.push({ x: p.x, y: p.y, text: `${p.pierce ? '⚡' : ''}-${dmg}`, color: p.pierce || p.isCrit ? '#facc15' : '#e2e8f0', life: 0.5 });
              }
              if (!p.pierce) { stopHarpoon = true; break; }
            }
          }
        }

        if (stopHarpoon) {
          game.projectiles.splice(i, 1);
        }
      }

      for (let i = game.effects.length - 1; i >= 0; i--) {
        game.effects[i].life -= dt;
        game.effects[i].y -= 28 * dt;
        if (game.effects[i].life <= 0) game.effects.splice(i, 1);
      }

      if (game.elapsed >= RAID_DURATION_SEC) {
        game.threats = [];
        game.projectiles = [];
        game.defeatTimer = game.defeatTotal;
        game.defeatShipSunk = false;
        io.to('fr_room:' + room.id).emit('fr_banner', {
          text: `⏱️ 제한시간 종료! 보스가 심해 속으로 도주했습니다...`,
          tone: 'danger'
        });
        return;
      }

      // Broadcast smooth 30Hz snapshot
      io.to('fr_room:' + room.id).volatile.emit('fr_snapshot', {
        t: +(RAID_DURATION_SEC - game.elapsed).toFixed(1),
        w: game.wave,
        shp: game.shipHp,
        smax: game.shipMaxHp,
        shk: game.shakeSeq,
        fg: Math.round(game.feverGauge),
        ft: +game.feverTimer.toFixed(1),
        e: game.entities.map((e) => [e.id, e.kind, e.icon, Math.round(e.x), Math.round(e.y), Math.round(e.vx), e.r, e.hp, e.maxHp, e.color]),
        th: game.threats.map((th) => [th.id, th.icon, th.label, Math.round(th.x), Math.round(th.y), Math.round(th.vy), th.r, th.hp, th.maxHp]),
        p: game.projectiles.map((p) => [Math.round(p.x), Math.round(p.y), Math.round(p.vx), Math.round(p.vy), p.ox, p.oy, +p.ang.toFixed(2), p.isCrit ? 1 : 0, p.pierce ? 1 : 0, p.rodLv || 0, p.color]),
        fx: game.effects.slice(-26).map((fx) => [Math.round(fx.x), Math.round(fx.y), fx.text, fx.color, fx.blast ? 1 : 0]),
        b: game.boss && game.boss.alive ? {
          name: game.boss.name,
          icon: game.boss.icon,
          color: game.boss.color,
          enr: game.boss.enraged ? 1 : 0,
          x: Math.round(game.boss.x),
          y: Math.round(game.boss.y),
          vx: (game.boss.groggyTimer > 0 || game.boss.counterTimer > 0) ? 0 : Math.round(game.boss.vx * (game.boss.shieldTimer > 0 ? 0.45 : 1.0)),
          r: game.boss.r,
          hp: game.boss.hp,
          maxHp: game.boss.maxHp,
          wx: Math.round(game.boss.x + game.boss.weakOffsetX),
          wy: Math.round(game.boss.y + game.boss.weakOffsetY),
          wr: game.boss.weakR,
          sh: game.boss.shieldHp,
          shMax: game.boss.shieldMax,
          shT: +game.boss.shieldTimer.toFixed(1),
          grT: +game.boss.groggyTimer.toFixed(1),
          grM: game.boss.groggyMult || 2,
          ctT: +game.boss.counterTimer.toFixed(1),
          ctN: game.boss.counterHitters.size,
          ctReq: Math.max(2, Math.min(room.members.length, Math.ceil(room.members.length * 0.65))),
          inkT: +game.boss.inkTimer.toFixed(1)
        } : null,
        pl: room.members.map((m) => {
          const ps = game.playerState[m.socketId];
          const st = game.stats[m.userId] || { damage: 0, waveGold: 0 };
          const effCd = ps ? (game.feverTimer > 0 ? Math.round(ps.cooldownMs * 0.62) : ps.cooldownMs) : 600;
          const cdPct = ps ? Math.min(1, (now - ps.lastShotAt) / effCd) : 1;
          return {
            seat: ps ? ps.seatIndex : 0,
            x: ps ? ps.x : ARENA_W / 2,
            nick: m.nickname,
            pet: (m.cosmetics && m.cosmetics.fishingPet) || '',
            rodLv: typeof m.rodSkinLevel === 'number' ? m.rodSkinLevel : (m.rodLevel || 0),
            col: ps ? ps.color : '#38bdf8',
            ang: ps ? +ps.angle.toFixed(2) : -1.57,
            cd: +cdPct.toFixed(2),
            stun: ps ? Math.max(0, +(Math.max(0, ps.stunUntil - now) / 1000).toFixed(1)) : 0,
            trHp: ps ? ps.trappedHp : 0,
            trMax: ps ? ps.trappedMaxHp : 0,
            trT: ps ? +Math.max(0, ps.trappedTimer).toFixed(1) : 0,
            dmg: st.damage,
            gold: st.waveGold
          };
        })
      });
    }, TICK_MS);
  }

  function leaveCurrentRoom(socket) {
    const roomId = socketToRoom.get(socket.id);
    if (!roomId) return;
    socketToRoom.delete(socket.id);
    socket.leave('fr_room:' + roomId);
    const room = rooms.get(roomId);
    if (!room) return;
    room.members = room.members.filter((m) => m.socketId !== socket.id);
    if (room.members.length === 0) {
      stopRaidLoop(room);
      rooms.delete(roomId);
    } else {
      if (room.hostSocketId === socket.id) {
        room.hostSocketId = room.members[0].socketId;
        room.hostNickname = room.members[0].nickname;
        room.members[0].ready = true;
      }
      broadcastRoomState(room);
    }
    broadcastRoomsList();
  }

  app.get('/api/fishing-raid/me', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const code = String(req.headers['x-save-code'] || req.query?.save_code || '').trim().toUpperCase();
    const nick = String(req.query?.nickname || '').trim();
    const u = (code && findUserByValidCode(code)) || (nick ? findUserByNickname(nick) : null);
    if (!u) return res.status(401).json({ ok: false, error: '인증 정보가 필요합니다.' });
    const quota = syncUserRaidQuota(u);
    const rod = getUserRodProfile(u);
    const fData = (u.game_data && u.game_data.fishing) ? u.game_data.fishing : {};
    return res.json({
      ok: true,
      nickname: u.nickname,
      gold: u.gold || 0,
      quota,
      rod,
      rods: Array.isArray(fData.rods) ? fData.rods : [],
      equippedRodId: fData.equippedRodId || '',
      difficulties: getAllLiveDiffs()
    });
  });

  io.on('connection', (socket) => {
    socket.on('fr_enter_lobby', () => {
      socket.join('fishing_raid_lobby');
      const list = Array.from(rooms.values()).map(serializeRoomSummary);
      socket.emit('fr_rooms_list', { rooms: list });
    });

    socket.on('fr_create_room', ({ save_code, title, difficulty, maxPlayers } = {}, cb) => {
      const code = String(save_code || '').trim().toUpperCase();
      const u = code ? findUserByValidCode(code) : null;
      if (!u) return cb && cb({ ok: false, error: '로그인이 필요합니다. 새로고침 후 다시 시도해주세요.' });
      leaveCurrentRoom(socket);

      const diffKey = DIFFICULTIES[difficulty] ? difficulty : 'NORMAL';
      const maxP = Math.max(2, Math.min(4, Math.floor(Number(maxPlayers) || 4)));
      const roomId = 'fr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
      const cleanTitle = String(title || `${u.nickname}의 ${DIFFICULTIES[diffKey].label} 원정대`).trim().slice(0, 24);
      const quota = syncUserRaidQuota(u);
      const rod = getUserRodProfile(u);

      const room = {
        id: roomId,
        title: cleanTitle,
        difficulty: diffKey,
        maxPlayers: maxP,
        hostSocketId: socket.id,
        hostNickname: u.nickname,
        status: 'LOBBY',
        chat: [{ at: Date.now(), nickname: '🔱 시스템', text: `${u.nickname}님이 [${DIFFICULTIES[diffKey].label} · ${maxP}인팟] 원정대를 개설했습니다.` }],
        members: [{
          socketId: socket.id,
          userId: u.id,
          nickname: u.nickname,
          ready: true,
          gold: u.gold || 0,
          remainingToday: quota.remainingToday,
          ...rod
        }],
        game: null,
        tickTimer: null
      };
      rooms.set(roomId, room);
      socketToRoom.set(socket.id, roomId);
      socket.join('fr_room:' + roomId);
      broadcastRoomState(room);
      broadcastRoomsList();
      if (cb) cb({ ok: true, room: serializeRoomState(room) });
    });

    socket.on('fr_join_room', ({ save_code, roomId } = {}, cb) => {
      const code = String(save_code || '').trim().toUpperCase();
      const u = code ? findUserByValidCode(code) : null;
      if (!u) return cb && cb({ ok: false, error: '로그인이 필요합니다.' });
      const room = rooms.get(String(roomId || ''));
      if (!room) return cb && cb({ ok: false, error: '존재하지 않는 파티방입니다.' });
      if (room.status !== 'LOBBY') return cb && cb({ ok: false, error: '이미 출항 중이거나 정산 중인 파티입니다.' });
      if (room.members.some((m) => m.userId === u.id)) {
        return cb && cb({ ok: false, error: '이미 해당 파티에 참가 중입니다.' });
      }
      if (room.members.length >= room.maxPlayers) {
        return cb && cb({ ok: false, error: '파티 정원이 가득 찼습니다.' });
      }
      leaveCurrentRoom(socket);
      const quota = syncUserRaidQuota(u);
      const rod = getUserRodProfile(u);
      room.members.push({
        socketId: socket.id,
        userId: u.id,
        nickname: u.nickname,
        ready: false,
        gold: u.gold || 0,
        remainingToday: quota.remainingToday,
        ...rod
      });
      room.chat.push({ at: Date.now(), nickname: '🔱 시스템', text: `${u.nickname}님이 파티에 합류했습니다.` });
      if (room.chat.length > 50) room.chat.shift();
      socketToRoom.set(socket.id, room.id);
      socket.join('fr_room:' + room.id);
      broadcastRoomState(room);
      broadcastRoomsList();
      if (cb) cb({ ok: true, room: serializeRoomState(room) });
    });

    socket.on('fr_sync_rod', ({ save_code } = {}, cb) => {
      const roomId = socketToRoom.get(socket.id);
      const room = roomId ? rooms.get(roomId) : null;
      if (!room || room.status !== 'LOBBY') return cb && cb({ ok: false });
      const m = room.members.find((x) => x.socketId === socket.id);
      if (!m) return cb && cb({ ok: false });
      const code = String(save_code || '').trim().toUpperCase();
      const u = (code && findUserByValidCode(code)) || findUserByNickname(m.nickname);
      if (!u) return cb && cb({ ok: false });
      const rod = getUserRodProfile(u);
      Object.assign(m, rod);
      m.gold = u.gold || 0;
      broadcastRoomState(room);
      if (cb) cb({ ok: true, rod });
    });

    socket.on('fr_toggle_ready', (_, cb) => {
      const roomId = socketToRoom.get(socket.id);
      const room = roomId ? rooms.get(roomId) : null;
      if (!room || room.status !== 'LOBBY') return cb && cb({ ok: false });
      const m = room.members.find((x) => x.socketId === socket.id);
      if (!m || m.socketId === room.hostSocketId) return cb && cb({ ok: false });
      m.ready = !m.ready;
      broadcastRoomState(room);
      if (cb) cb({ ok: true, ready: m.ready });
    });

    socket.on('fr_chat', ({ text } = {}) => {
      const roomId = socketToRoom.get(socket.id);
      const room = roomId ? rooms.get(roomId) : null;
      if (!room) return;
      const m = room.members.find((x) => x.socketId === socket.id);
      if (!m) return;
      const clean = String(text || '').trim().slice(0, 120);
      if (!clean) return;
      const msg = { at: Date.now(), nickname: m.nickname, text: clean };
      room.chat.push(msg);
      if (room.chat.length > 50) room.chat.shift();
      io.to('fr_room:' + room.id).emit('fr_chat_message', msg);
    });

    socket.on('fr_leave_room', (_, cb) => {
      leaveCurrentRoom(socket);
      if (cb) cb({ ok: true });
    });

    socket.on('fr_start_raid', (_, cb) => {
      const roomId = socketToRoom.get(socket.id);
      const room = roomId ? rooms.get(roomId) : null;
      if (!room) return cb && cb({ ok: false, error: '파티방에 속해 있지 않습니다.' });
      if (room.hostSocketId !== socket.id) return cb && cb({ ok: false, error: '파티장만 출항할 수 있습니다.' });
      if (room.status !== 'LOBBY') return cb && cb({ ok: false, error: '이미 진행 중입니다.' });
      if (room.members.length < 2) {
        return cb && cb({ ok: false, error: '최소 2명 이상 파티원이 모여야 출항할 수 있습니다!' });
      }

      const unready = room.members.find((m) => m.socketId !== room.hostSocketId && !m.ready);
      if (unready) return cb && cb({ ok: false, error: `${unready.nickname}님이 아직 준비 완료하지 않았습니다.` });

      const diff = getLiveDiff(room.difficulty);
      const resolvedUsers = [];
      for (const m of room.members) {
        const u = findUserByNickname(m.nickname);
        if (!u) return cb && cb({ ok: false, error: `${m.nickname} 계정을 찾을 수 없습니다.` });
        const q = syncUserRaidQuota(u);
        if (q.remainingToday <= 0) {
          return cb && cb({ ok: false, error: `${m.nickname}님의 오늘 낚시 레이드 횟수(${DAILY_RAID_LIMIT}회)가 모두 소진되었습니다.` });
        }
        if ((u.gold || 0) < diff.entryFee) {
          return cb && cb({ ok: false, error: `${m.nickname}님의 스타가 부족합니다. (출항비 ${diff.entryFee.toLocaleString()} 스타)` });
        }
        resolvedUsers.push({ m, u });
      }

      for (const { m, u } of resolvedUsers) {
        economyHooks.addUserGold(u.nickname, -diff.entryFee, 'fishing_raid_entry');
        u.game_data.fishing.raidUsed = (u.game_data.fishing.raidUsed || 0) + 1;
        u.updated_at = new Date().toISOString();
        m.gold = u.gold;
        m.remainingToday = syncUserRaidQuota(u).remainingToday;
        const rod = getUserRodProfile(u);
        Object.assign(m, rod);
      }
      saveUsersDB(usersDB);

      startRaidLoop(room);
      if (cb) cb({ ok: true });
    });

    socket.on('fr_aim', ({ x, y } = {}) => {
      const roomId = socketToRoom.get(socket.id);
      const room = roomId ? rooms.get(roomId) : null;
      if (!room || room.status !== 'PLAYING' || !room.game) return;
      const ps = room.game.playerState[socket.id];
      if (!ps || ps.trappedHp > 0) return;
      const tx = Math.max(10, Math.min(ARENA_W - 10, Number(x) || ARENA_W / 2));
      const ty = Math.max(10, Math.min(485, Number(y) || 200));
      ps.angle = Math.atan2(ty - ps.y, tx - ps.x);
    });

    socket.on('fr_shoot', ({ x, y, charged, overheat } = {}) => {
      const roomId = socketToRoom.get(socket.id);
      const room = roomId ? rooms.get(roomId) : null;
      if (!room || room.status !== 'PLAYING' || !room.game) return;
      const game = room.game;
      if (game.introTimer > 0 || game.victoryTimer > 0 || game.defeatTimer > 0) return;
      const ps = game.playerState[socket.id];
      const member = room.members.find((m) => m.socketId === socket.id);
      if (!ps || !member) return;

      const now = Date.now();
      if (now < ps.stunUntil || ps.trappedHp > 0) return;
      const effCd = game.feverTimer > 0 ? Math.round(ps.cooldownMs * 0.62) : ps.cooldownMs;
      if (now - ps.lastShotAt < effCd) return;

      if (overheat) {
        ps.lastShotAt = now + 250;
        game.effects.push({ x: ps.x, y: 442, text: '🔥 과열 불발!', color: '#fb7185', life: 0.75 });
        return;
      }

      // Charged piercing mega harpoon requires at least 420ms since last shot
      const isCharged = Boolean(charged) && (now - ps.lastShotAt >= Math.max(effCd, 850));
      ps.lastShotAt = now;

      const tx = Math.max(10, Math.min(ARENA_W - 10, Number(x) || ARENA_W / 2));
      const ty = Math.max(10, Math.min(485, Number(y) || 200));
      const dx = tx - ps.x;
      const dy = ty - ps.y;
      const len = Math.max(1, Math.hypot(dx, dy));
      const speed = isCharged ? 1380 : (game.feverTimer > 0 ? 1220 : 1060);
      const ang = Math.atan2(dy, dx);
      ps.angle = ang;

      const isCrit = Math.random() < ps.critChance;
      const finalDmg = isCharged ? Math.round(ps.damage * 1.9) : ps.damage;
      game.projectiles.push({
        socketId: socket.id,
        userId: member.userId,
        seatIndex: ps.seatIndex,
        ox: ps.x,
        oy: ps.y,
        x: ps.x + (dx / len) * 28,
        y: ps.y + (dy / len) * 28,
        vx: (dx / len) * speed,
        vy: (dy / len) * speed,
        ang,
        damage: finalDmg,
        isCrit,
        pierce: isCharged,
        rodLv: typeof member.rodSkinLevel === 'number' ? member.rodSkinLevel : (member.rodLevel || 0),
        hitIds: new Set(),
        color: isCharged ? '#fde047' : (isCrit ? '#facc15' : ps.color)
      });
    });

    socket.on('fr_reset_room', (_, cb) => {
      const roomId = socketToRoom.get(socket.id);
      const room = roomId ? rooms.get(roomId) : null;
      if (!room || room.status !== 'RESULT') return cb && cb({ ok: false });
      if (room.hostSocketId !== socket.id) return cb && cb({ ok: false, error: '파티장만 대기실로 복귀할 수 있습니다.' });
      room.status = 'LOBBY';
      room.members.forEach((m) => {
        m.ready = (m.socketId === room.hostSocketId);
      });
      broadcastRoomState(room);
      broadcastRoomsList();
      if (cb) cb({ ok: true });
    });

    socket.on('disconnect', () => {
      leaveCurrentRoom(socket);
    });
  });

  return {
    getRoomsSummary: () => Array.from(rooms.values()).map(serializeRoomSummary),
    getPlayerCount: () => Array.from(rooms.values()).reduce((s, r) => s + r.members.length, 0)
  };
}

module.exports = { setupFishingRaidModule, DIFFICULTIES };
