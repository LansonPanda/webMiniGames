/**
 * 🔱 낚시 레이드 (2~4인 파티 심해 작살 아케이드) 서버 모듈
 * - 메이플스토리 보스 레이드 스타일 2~4인 파티 대기방 (노말 / 하드 / 카오스, 최소 2인 출발)
 * - 일일 3회 제한 · 조준 단발 작살 발사 (케이블 연결 연출)
 * - 70초 3웨이브 실시간 아케이드 (30Hz 서버 시뮬레이션 + 클라이언트 60fps 보간)
 */

const DAILY_RAID_LIMIT = 3;
const RAID_DURATION_SEC = 70;
const ARENA_W = 960;
const ARENA_H = 540;

const DIFFICULTIES = {
  NORMAL: {
    id: 'NORMAL',
    label: '노말',
    badgeColor: '#38bdf8',
    entryFee: 50000,
    bossName: '대왕 크라켄',
    bossIcon: '🐙',
    bossColor: '#f43f5e',
    baseBossHp: 2200,
    baseShieldHp: 420,
    clearBasePerPlayer: 35000,
    clearSharePoolPerPlayer: 25000,
    mvpBonus: 15000,
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
    baseBossHp: 4500,
    baseShieldHp: 850,
    clearBasePerPlayer: 95000,
    clearSharePoolPerPlayer: 70000,
    mvpBonus: 40000,
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
    baseBossHp: 8800,
    baseShieldHp: 1650,
    clearBasePerPlayer: 240000,
    clearSharePoolPerPlayer: 180000,
    mvpBonus: 100000,
    fishGoldMult: 4.8,
    chestChance: 0.38,
    protectChance: 0.10
  }
};

const FISH_TYPES = [
  { kind: 'sardine', name: '은빛 정어리', icon: '🐟', hp: 70, r: 24, speed: 120, gold: 1800, color: '#7dd3fc', weight: 32 },
  { kind: 'tuna', name: '황금 참치', icon: '🐠', hp: 145, r: 29, speed: 102, gold: 4200, color: '#fbbf24', weight: 26 },
  { kind: 'manta', name: '심해 만타', icon: '🦈', hp: 230, r: 35, speed: 86, gold: 7800, color: '#818cf8', weight: 16 },
  { kind: 'bomb_puffer', name: '폭탄 복어', icon: '🐡', hp: 110, r: 30, speed: 80, gold: 5000, color: '#fb7185', weight: 11, special: 'BOMB' },
  { kind: 'jelly', name: '전기 해파리', icon: '🪼', hp: 100, r: 27, speed: 68, gold: 0, color: '#22d3ee', weight: 10, special: 'STUN' },
  { kind: 'chest', name: '심해 보물상자', icon: '🧰', hp: 310, r: 34, speed: 66, gold: 16000, color: '#facc15', weight: 5, special: 'CHEST' }
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
    onRoomsChange
  } = deps;

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
    const diff = DIFFICULTIES[room.difficulty] || DIFFICULTIES.NORMAL;
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
    const diff = DIFFICULTIES[room.difficulty] || DIFFICULTIES.NORMAL;
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

  function spawnFish(room, wave) {
    const game = room.game;
    if (!game) return;
    const diff = DIFFICULTIES[room.difficulty] || DIFFICULTIES.NORMAL;
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
    const y = 75 + Math.random() * 270;
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

  function spawnBoss(room) {
    const game = room.game;
    const diff = DIFFICULTIES[room.difficulty] || DIFFICULTIES.NORMAL;
    const n = game.initialPartySize;
    const mult = n <= 2 ? 1.0 : n === 3 ? 1.42 : 1.82;
    const maxHp = Math.round(diff.baseBossHp * mult);
    const shieldMax = Math.round(diff.baseShieldHp * mult);
    game.boss = {
      name: diff.bossName,
      icon: diff.bossIcon,
      color: diff.bossColor,
      x: ARENA_W / 2,
      y: 170,
      vx: 72,
      r: 74,
      hp: maxHp,
      maxHp,
      alive: true,
      weakOffsetX: 30,
      weakOffsetY: -10,
      weakR: 28,
      weakTimer: 3.0,
      shieldHp: 0,
      shieldMax,
      shieldTimer: 0,
      shieldCount: 0,
      groggyTimer: 0,
      inkTimer: 0
    };
    io.to('fr_room:' + room.id).emit('fr_banner', {
      text: `🚨 최종 보스 [${diff.bossIcon} ${diff.bossName}] 출현! 약점 과녁에 작살을 꽂으세요!`,
      tone: 'danger'
    });
  }

  function finishRaid(room, bossDefeated) {
    if (!room || !room.game || room.status !== 'PLAYING') return;
    stopRaidLoop(room);
    room.status = 'RESULT';
    const game = room.game;
    const diff = DIFFICULTIES[room.difficulty] || DIFFICULTIES.NORMAL;
    const isFullParty = game.initialPartySize >= 4;
    const dropBonusMult = isFullParty ? 1.2 : 1.0;

    const totalDmg = Math.max(1, room.members.reduce((s, m) => s + (game.stats[m.userId]?.damage || 0), 0));
    const sortedByDmg = [...room.members].sort((a, b) => (game.stats[b.userId]?.damage || 0) - (game.stats[a.userId]?.damage || 0));
    const mvpUserId = (bossDefeated && sortedByDmg.length > 0 && (game.stats[sortedByDmg[0].userId]?.damage || 0) > 0)
      ? sortedByDmg[0].userId
      : null;

    const results = [];
    for (const m of room.members) {
      const st = game.stats[m.userId] || { damage: 0, kills: 0, waveGold: 0, bonusChests: 0 };
      const u = findUserByNickname(m.nickname);
      const shareRatio = st.damage / totalDmg;
      const clearBase = bossDefeated ? diff.clearBasePerPlayer : 0;
      const clearShare = bossDefeated ? Math.round(diff.clearSharePoolPerPlayer * room.members.length * shareRatio) : 0;
      const mvpGold = (bossDefeated && m.userId === mvpUserId) ? diff.mvpBonus : 0;
      const totalGold = Math.round(st.waveGold + clearBase + clearShare + mvpGold);

      const drops = [];
      let chestsGained = st.bonusChests || 0;
      if (bossDefeated && Math.random() < diff.chestChance * dropBonusMult) {
        chestsGained += 1;
      }
      let protectGained = 0;
      if (bossDefeated && Math.random() < diff.protectChance * dropBonusMult) {
        protectGained += 1;
      }

      if (u) {
        ensureUserStatsStructure(u);
        if (!u.game_data.fishing) u.game_data.fishing = {};
        if (totalGold > 0) {
          economyHooks.addUserGold(u.nickname, totalGold, 'fishing_raid_reward');
        }
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
        waveGold: st.waveGold,
        clearGold: clearBase + clearShare,
        mvpGold,
        totalGold,
        isMvp: m.userId === mvpUserId,
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
      difficulty: diff.id,
      difficultyLabel: diff.label,
      bossName: diff.bossName,
      bossIcon: diff.bossIcon,
      elapsedSec: Math.min(RAID_DURATION_SEC, Math.round(game.elapsed)),
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
      stats[m.userId] = { damage: 0, kills: 0, waveGold: 0, bonusChests: 0 };
      playerState[m.socketId] = {
        seatIndex: idx,
        x: seatX,
        y: 472,
        angle: -Math.PI / 2,
        lastShotAt: 0,
        stunUntil: 0,
        color: seatColors[idx % 4],
        // Heavy single-shot harpoon stats
        damage: Math.round(72 + m.rodLevel * 12 + m.rodAwakening * 14),
        cooldownMs: Math.max(400, 620 - m.rodLevel * 14),
        critChance: Math.min(0.45, 0.10 + m.rodAwakening * 0.06)
      };
    });

    room.status = 'PLAYING';
    room.game = {
      seq: 0,
      initialPartySize: initialCount,
      startedAt: Date.now(),
      elapsed: 0,
      wave: 1,
      feverGauge: 0,
      feverTimer: 0,
      spawnAcc: 0,
      entities: [],
      projectiles: [],
      effects: [],
      boss: null,
      stats,
      playerState
    };

    for (let i = 0; i < 6; i++) spawnFish(room, 1);

    broadcastRoomState(room);
    broadcastRoomsList();

    io.to('fr_room:' + room.id).emit('fr_banner', {
      text: `⚓ 출항 완료! 1웨이브: 목표를 조준하고 클릭/터치해 작살을 발사하세요! (폭탄복어=광역 / 전기해파리=감전)`,
      tone: 'info'
    });

    const TICK_MS = 33; // ~30Hz smooth server tick & broadcast
    const dt = TICK_MS / 1000;

    room.tickTimer = setInterval(() => {
      const game = room.game;
      if (!game || room.status !== 'PLAYING') {
        stopRaidLoop(room);
        return;
      }
      const now = Date.now();
      game.elapsed = (now - game.startedAt) / 1000;

      // Wave transitions
      if (game.wave === 1 && game.elapsed >= 25) {
        game.wave = 2;
        io.to('fr_room:' + room.id).emit('fr_banner', {
          text: `🧰 2웨이브: 심해 보물선 출현! 협동 피버 게이지를 채워 작살을 강화하세요!`,
          tone: 'gold'
        });
      } else if (game.wave === 2 && game.elapsed >= 45) {
        game.wave = 3;
        spawnBoss(room);
      }

      if (game.feverTimer > 0) {
        game.feverTimer = Math.max(0, game.feverTimer - dt);
      }

      // Spawn fish
      const targetFishCount = game.wave === 3 ? 5 : game.wave === 2 ? 11 : 9;
      game.spawnAcc += dt;
      const spawnInterval = game.wave === 2 ? 0.65 : game.wave === 3 ? 1.5 : 0.9;
      if (game.spawnAcc >= spawnInterval && game.entities.length < targetFishCount) {
        game.spawnAcc = 0;
        spawnFish(room, game.wave);
      }

      // Move fish
      for (let i = game.entities.length - 1; i >= 0; i--) {
        const e = game.entities[i];
        e.x += e.vx * dt;
        e.y = e.baseY + Math.sin(game.elapsed * 2.4 + e.phase) * 14;
        if (e.x < -80 || e.x > ARENA_W + 80) {
          game.entities.splice(i, 1);
        }
      }

      // Update Boss
      if (game.boss && game.boss.alive) {
        const b = game.boss;
        if (b.inkTimer > 0) b.inkTimer = Math.max(0, b.inkTimer - dt);

        if (b.groggyTimer > 0) {
          b.groggyTimer = Math.max(0, b.groggyTimer - dt);
        } else {
          const speedMult = b.shieldTimer > 0 ? 0.45 : 1.0;
          b.x += b.vx * speedMult * dt;
          if (b.x < 150) { b.x = 150; b.vx = Math.abs(b.vx); }
          if (b.x > ARENA_W - 150) { b.x = ARENA_W - 150; b.vx = -Math.abs(b.vx); }
          b.y = 165 + Math.sin(game.elapsed * 1.9) * 20;
        }

        b.weakTimer -= dt;
        if (b.weakTimer <= 0) {
          b.weakTimer = 3.0;
          const ang = Math.random() * Math.PI * 2;
          const dist = 22 + Math.random() * 28;
          b.weakOffsetX = Math.round(Math.cos(ang) * dist);
          b.weakOffsetY = Math.round(Math.sin(ang) * dist);
        }

        if (b.shieldTimer <= 0 && b.groggyTimer <= 0) {
          if ((b.shieldCount === 0 && game.elapsed >= 52) || (b.shieldCount === 1 && game.elapsed >= 61)) {
            b.shieldCount += 1;
            b.shieldHp = b.shieldMax;
            b.shieldTimer = 4.6;
            io.to('fr_room:' + room.id).emit('fr_banner', {
              text: `🛡️ 보스 보호막 전개! 4.5초 안에 작살 집중 사격으로 깨뜨리면 그로기(딜 2배)!`,
              tone: 'warn'
            });
          }
        } else if (b.shieldTimer > 0) {
          b.shieldTimer -= dt;
          if (b.shieldTimer <= 0 && b.shieldHp > 0) {
            b.shieldHp = 0;
            b.inkTimer = 3.2;
            io.to('fr_room:' + room.id).emit('fr_banner', {
              text: `🦑 보호막 파괴 실패! 보스가 먹물을 뿌렸습니다!`,
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

        let hit = false;
        const st = game.stats[p.userId];
        const pState = game.playerState[p.socketId];
        const feverMult = game.feverTimer > 0 ? 1.5 : 1.0;

        // 1) Check Boss Hit
        if (game.boss && game.boss.alive) {
          const b = game.boss;
          const dx = p.x - b.x;
          const dy = p.y - b.y;
          if (dx * dx + dy * dy <= (b.r + 12) * (b.r + 12)) {
            hit = true;
            const wx = b.x + b.weakOffsetX;
            const wy = b.y + b.weakOffsetY;
            const isWeak = ((p.x - wx) ** 2 + (p.y - wy) ** 2) <= (b.weakR + 14) ** 2;
            let dmg = p.damage;
            let tag = '';
            if (p.isCrit) { dmg = Math.round(dmg * 1.8); tag = 'CRIT!'; }
            if (isWeak) { dmg = Math.round(dmg * 1.7); tag = 'WEAK!'; }
            if (b.groggyTimer > 0) { dmg = Math.round(dmg * 2.0); tag = tag ? tag + ' ×2' : 'GROGGY!'; }

            if (b.shieldTimer > 0 && b.shieldHp > 0) {
              b.shieldHp = Math.max(0, b.shieldHp - dmg);
              if (st) st.damage += dmg;
              game.effects.push({ x: p.x, y: p.y, text: `🛡️-${dmg}`, color: '#38bdf8', life: 0.65 });
              if (b.shieldHp <= 0) {
                b.shieldTimer = 0;
                b.groggyTimer = 4.5;
                io.to('fr_room:' + room.id).emit('fr_banner', {
                  text: `💥 보호막 브레이크 성공!! 4.5초간 보스 그로기 (데미지 2배)!!`,
                  tone: 'gold'
                });
              }
            } else {
              b.hp = Math.max(0, b.hp - dmg);
              if (st) st.damage += dmg;
              game.effects.push({ x: p.x, y: p.y, text: `${tag ? tag + ' ' : ''}-${dmg}`, color: isWeak || p.isCrit ? '#facc15' : '#ffffff', life: 0.7 });
              if (b.hp <= 0) {
                b.alive = false;
                if (st) st.kills += 1;
                finishRaid(room, true);
                return;
              }
            }
          }
        }

        // 2) Check Fish Hit
        if (!hit) {
          for (let j = game.entities.length - 1; j >= 0; j--) {
            const e = game.entities[j];
            const dx = p.x - e.x;
            const dy = p.y - e.y;
            if (dx * dx + dy * dy <= (e.r + 14) * (e.r + 14)) {
              hit = true;
              if (e.special === 'STUN') {
                if (pState) pState.stunUntil = now + 1800;
                game.effects.push({ x: e.x, y: e.y, text: '⚡감전!', color: '#22d3ee', life: 0.85 });
                game.entities.splice(j, 1);
                break;
              }
              let dmg = p.isCrit ? Math.round(p.damage * 1.8) : p.damage;
              e.hp -= dmg;
              if (st) st.damage += dmg;
              if (game.feverTimer <= 0) {
                game.feverGauge = Math.min(100, game.feverGauge + 5.5);
                if (game.feverGauge >= 100) {
                  game.feverGauge = 0;
                  game.feverTimer = 10.0;
                  io.to('fr_room:' + room.id).emit('fr_banner', {
                    text: `🔥 파티 피버 타임 발동!! (10초간 작살 장전 가속 & 어종 보상 1.5배!)`,
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
                      const bDmg = Math.round(p.damage * 1.9);
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
                game.effects.push({ x: p.x, y: p.y, text: `-${dmg}`, color: p.isCrit ? '#facc15' : '#e2e8f0', life: 0.5 });
              }
              break;
            }
          }
        }

        if (hit) {
          game.projectiles.splice(i, 1);
        }
      }

      for (let i = game.effects.length - 1; i >= 0; i--) {
        game.effects[i].life -= dt;
        game.effects[i].y -= 28 * dt;
        if (game.effects[i].life <= 0) game.effects.splice(i, 1);
      }

      if (game.elapsed >= RAID_DURATION_SEC) {
        finishRaid(room, false);
        return;
      }

      // Broadcast smooth 30Hz snapshot with velocities and fixed turret x
      io.to('fr_room:' + room.id).volatile.emit('fr_snapshot', {
        t: +(RAID_DURATION_SEC - game.elapsed).toFixed(1),
        w: game.wave,
        fg: Math.round(game.feverGauge),
        ft: +game.feverTimer.toFixed(1),
        // e: [id, kind, icon, x, y, vx, r, hp, maxHp, color]
        e: game.entities.map((e) => [e.id, e.kind, e.icon, Math.round(e.x), Math.round(e.y), Math.round(e.vx), e.r, e.hp, e.maxHp, e.color]),
        // p: [x, y, vx, vy, ox, oy, ang, isCrit, color]
        p: game.projectiles.map((p) => [Math.round(p.x), Math.round(p.y), Math.round(p.vx), Math.round(p.vy), p.ox, p.oy, +p.ang.toFixed(2), p.isCrit ? 1 : 0, p.color]),
        fx: game.effects.slice(-24).map((fx) => [Math.round(fx.x), Math.round(fx.y), fx.text, fx.color, fx.blast ? 1 : 0]),
        b: game.boss && game.boss.alive ? {
          name: game.boss.name,
          icon: game.boss.icon,
          color: game.boss.color,
          x: Math.round(game.boss.x),
          y: Math.round(game.boss.y),
          vx: game.boss.groggyTimer > 0 ? 0 : Math.round(game.boss.vx * (game.boss.shieldTimer > 0 ? 0.45 : 1.0)),
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
            col: ps ? ps.color : '#38bdf8',
            ang: ps ? +ps.angle.toFixed(2) : -1.57,
            cd: +cdPct.toFixed(2),
            stun: ps ? Math.max(0, +(Math.max(0, ps.stunUntil - now) / 1000).toFixed(1)) : 0,
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
    return res.json({
      ok: true,
      nickname: u.nickname,
      gold: u.gold || 0,
      quota,
      rod,
      difficulties: DIFFICULTIES
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

      const diff = DIFFICULTIES[room.difficulty] || DIFFICULTIES.NORMAL;
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
      if (!ps) return;
      const tx = Math.max(10, Math.min(ARENA_W - 10, Number(x) || ARENA_W / 2));
      const ty = Math.max(10, Math.min(430, Number(y) || 200));
      ps.angle = Math.atan2(ty - ps.y, tx - ps.x);
    });

    socket.on('fr_shoot', ({ x, y } = {}) => {
      const roomId = socketToRoom.get(socket.id);
      const room = roomId ? rooms.get(roomId) : null;
      if (!room || room.status !== 'PLAYING' || !room.game) return;
      const game = room.game;
      const ps = game.playerState[socket.id];
      const member = room.members.find((m) => m.socketId === socket.id);
      if (!ps || !member) return;

      const now = Date.now();
      if (now < ps.stunUntil) return;
      const effCd = game.feverTimer > 0 ? Math.round(ps.cooldownMs * 0.62) : ps.cooldownMs;
      if (now - ps.lastShotAt < effCd) return;
      ps.lastShotAt = now;

      const tx = Math.max(10, Math.min(ARENA_W - 10, Number(x) || ARENA_W / 2));
      const ty = Math.max(10, Math.min(430, Number(y) || 200));
      const dx = tx - ps.x;
      const dy = ty - ps.y;
      const len = Math.max(1, Math.hypot(dx, dy));
      const speed = game.feverTimer > 0 ? 1220 : 1060;
      const ang = Math.atan2(dy, dx);
      ps.angle = ang;

      const isCrit = Math.random() < ps.critChance;
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
        damage: ps.damage,
        isCrit,
        color: isCrit ? '#facc15' : ps.color
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
