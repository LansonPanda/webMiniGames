// 🏇 로얄 경마 (3마리 말 · 5판 총 배팅 비율 배당 · 자동 출발 타이머) - /horse-racing 네임스페이스

const fs = require('fs');
const path = require('path');
const HORSE_STATS_FILE = path.join(__dirname, '..', 'horse_stats.json');

function loadHorseStatsDB() {
  try {
    if (fs.existsSync(HORSE_STATS_FILE)) {
      const data = JSON.parse(fs.readFileSync(HORSE_STATS_FILE, 'utf8'));
      if (data && typeof data.totalRaces === 'number' && data.horses) return data;
    }
  } catch (err) {
    console.error('Failed to read horse_stats.json:', err.message);
  }
  return { totalRaces: 0, horses: { 0: { wins: 0 }, 1: { wins: 0 }, 2: { wins: 0 } } };
}

function saveHorseStatsDB(db) {
  try {
    fs.writeFileSync(HORSE_STATS_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write horse_stats.json:', err.message);
  }
}

let horseStatsDB = loadHorseStatsDB();

function getHorseWinRates() {
  const total = horseStatsDB.totalRaces || 0;
  return [0, 1, 2].map((id) => {
    const wins = horseStatsDB.horses?.[id]?.wins || 0;
    const pct = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';
    return { id, wins, totalRaces: total, winRatePct: pct };
  });
}

const HORSES = [
  { id: 0, name: '레드불릿', color: '#fb7185', style: '초반 질주형' },
  { id: 1, name: '블루윈드', color: '#38bdf8', style: '안정 밸런스형' },
  { id: 2, name: '스타다크', color: '#facc15', style: '막판 스퍼트형' }
];

function setupHorseRacingSocket(io, deps) {
  const { usersDB, saveUsersDB, ensureUserStatsStructure, globalServerSettings, economyHooks, findUserExistingRoom, removeUserFromOtherGames } = deps;
  const nsp = io.of('/horse-racing');
  let hrRooms = [];

  function findUserByNickname(nick) {
    if (!nick || !Array.isArray(usersDB)) return null;
    const clean = String(nick).trim().toLowerCase();
    return usersDB.find((u) => String(u.nickname || '').trim().toLowerCase() === clean) || null;
  }

  function recordHorseMatchResult(winnerNick, allPlayerNicks) {
    let changed = false;
    allPlayerNicks.forEach((nick) => {
      const u = findUserByNickname(nick);
      if (!u) return;
      ensureUserStatsStructure(u);
      if (!u.game_data.stats.horse) {
        u.game_data.stats.horse = { plays: 0, wins: 0 };
      }
      u.game_data.stats.horse.plays += 1;
      if (winnerNick && nick === winnerNick) {
        u.game_data.stats.horse.wins += 1;
      }
      u.updated_at = new Date().toISOString();
      changed = true;
    });
    if (changed) saveUsersDB(usersDB);
  }

  function clearRoomTimers(rm) {
    if (rm.raceTimer) { clearInterval(rm.raceTimer); rm.raceTimer = null; }
    if (rm.betTimer) { clearTimeout(rm.betTimer); rm.betTimer = null; }
  }

  function getRoomsSummary() {
    return hrRooms.map((r) => ({
      id: r.id,
      title: r.title,
      hostClientId: r.hostClientId,
      hostNickname: r.hostNickname,
      hasPassword: Boolean(r.password),
      maxPlayers: r.maxPlayers || 0,
      startingCoins: r.startingCoins || 1000,
      bettingDurationSec: r.bettingDurationSec || 15,
      status: r.status,
      round: r.round,
      totalRounds: r.totalRounds,
      playerIds: r.players.map((p) => p.clientId),
      count: r.players.length,
      spectatorCount: r.spectators.length
    }));
  }

  function getPoolStats(rm) {
    const horsePools = [0, 0, 0];
    let totalPool = 0;
    rm.players.forEach((p) => {
      if (p.bet && p.bet.amount > 0 && p.bet.horseId >= 0 && p.bet.horseId <= 2) {
        horsePools[p.bet.horseId] += p.bet.amount;
        totalPool += p.bet.amount;
      }
    });
    const odds = horsePools.map((hp) => {
      if (totalPool === 0 || hp === 0) return '-';
      return (totalPool / hp).toFixed(2);
    });
    return { totalPool, horsePools, odds };
  }

  function sanitizeRoom(rm) {
    const pools = getPoolStats(rm);
    return {
      id: rm.id,
      title: rm.title,
      hostClientId: rm.hostClientId,
      hostNickname: rm.hostNickname,
      hasPassword: Boolean(rm.password),
      maxPlayers: rm.maxPlayers || 0,
      startingCoins: rm.startingCoins || 1000,
      bettingDurationSec: rm.bettingDurationSec || 15,
      bettingEndsAt: rm.bettingEndsAt || null,
      status: rm.status,
      round: rm.round,
      totalRounds: rm.totalRounds,
      horses: rm.horses,
      pools,
      horseWinRates: getHorseWinRates(),
      players: rm.players.map((p) => {
        if (economyHooks) p.coins = economyHooks.getUserGold(p.nickname);
        return {
          clientId: p.clientId,
          nickname: p.nickname,
          coins: p.coins,
          cosmetics: economyHooks ? economyHooks.getUserCosmetics(p.nickname) : {},
          bet: p.bet,
          lastPayout: p.lastPayout || 0,
          lastNet: p.lastNet || 0
        };
      }),
      spectators: rm.spectators.map((s) => ({ clientId: s.clientId, nickname: s.nickname })),
      lastRoundSummary: rm.lastRoundSummary || null,
      finalStandings: rm.finalStandings || null,
      raceLog: rm.raceLog || '',
      serverNow: Date.now()
    };
  }

  function emitRoom(rm) {
    nsp.to(rm.id).emit('hr_room_state', sanitizeRoom(rm));
  }

  function emitRoomsList() {
    nsp.emit('hr_rooms_updated', getRoomsSummary());
  }

  function initHorses() {
    return HORSES.map((h) => ({
      ...h,
      pos: 0,
      speed: 0,
      finished: false,
      rank: null,
      eventTag: ''
    }));
  }

  function startBettingRound(rm) {
    clearRoomTimers(rm);
    rm.status = 'BETTING';
    rm.horses = initHorses();
    rm.lastRoundSummary = null;
    const durSec = rm.bettingDurationSec || 15;
    rm.bettingEndsAt = Date.now() + durSec * 1000;
    rm.raceLog = `📢 ${rm.round}/${rm.totalRounds} 라운드! ${durSec}초 안에 말을 고르고 [✅ 베팅 확정]을 눌러주세요!`;

    rm.players.forEach((p) => {
      if (economyHooks) p.coins = economyHooks.getUserGold(p.nickname);
      p.bet = null;
      p.lastPayout = 0;
      p.lastNet = 0;
    });

    rm.betTimer = setTimeout(() => {
      if (!hrRooms.includes(rm) || rm.status !== 'BETTING') return;
      runRaceSimulation(rm);
    }, durSec * 1000);

    emitRoom(rm);
    emitRoomsList();
  }

  function runRaceSimulation(rm) {
    clearRoomTimers(rm);
    rm.status = 'RACING';
    rm.bettingEndsAt = null;
    rm.horses = initHorses();
    rm.raceLog = `🔫 ${rm.round}라운드 출발!! 3마리 경주마가 달려 나갑니다!`;
    emitRoom(rm);
    emitRoomsList();

    let tick = 0;
    let finishOrder = [];

    rm.raceTimer = setInterval(() => {
      if (!hrRooms.includes(rm) || rm.status !== 'RACING') {
        clearInterval(rm.raceTimer);
        rm.raceTimer = null;
        return;
      }
      tick += 1;
      const events = [];

      rm.horses.forEach((h, idx) => {
        if (h.finished) return;
        let base = 0.62 + Math.random() * 0.72;
        if (idx === 0 && h.pos < 40) base += 0.22;
        if (idx === 1) base += 0.08;
        if (idx === 2 && h.pos > 55) base += 0.34;

        if (tick % 10 === 0 && Math.random() < 0.42) {
          const r = Math.random();
          if (r < 0.55) {
            base += 0.95;
            h.eventTag = '⚡ 스퍼트!';
            events.push(`⚡ ${h.name} 폭발적 스퍼트!`);
          } else {
            base = Math.max(0.15, base - 0.5);
            h.eventTag = '🍌 주춤!';
            events.push(`🍌 ${h.name} 살짝 주춤!`);
          }
        } else if (tick % 10 === 5) {
          h.eventTag = '';
        }

        h.speed = base;
        h.pos = Math.min(100, h.pos + base);
        if (h.pos >= 100 && !h.finished) {
          h.finished = true;
          finishOrder.push(h.id);
          h.rank = finishOrder.length;
        }
      });

      if (events.length > 0) rm.raceLog = events[0];
      nsp.to(rm.id).emit('hr_race_tick', {
        horses: rm.horses,
        raceLog: rm.raceLog
      });

      if (finishOrder.length >= 3) {
        clearInterval(rm.raceTimer);
        rm.raceTimer = null;
        resolveRound(rm, finishOrder[0]);
      }
    }, 60);
  }

  function resolveRound(rm, winnerHorseId) {
    horseStatsDB.totalRaces = (horseStatsDB.totalRaces || 0) + 1;
    if (!horseStatsDB.horses) horseStatsDB.horses = { 0: { wins: 0 }, 1: { wins: 0 }, 2: { wins: 0 } };
    if (!horseStatsDB.horses[winnerHorseId]) horseStatsDB.horses[winnerHorseId] = { wins: 0 };
    horseStatsDB.horses[winnerHorseId].wins += 1;
    saveHorseStatsDB(horseStatsDB);
    const winnerHorse = rm.horses.find((h) => h.id === winnerHorseId) || rm.horses[0];
    const { totalPool, horsePools } = getPoolStats(rm);
    const winPool = horsePools[winnerHorseId] || 0;
    const mult = (totalPool > 0 && winPool > 0) ? (totalPool / winPool).toFixed(2) : '-';

    let distributed = 0;
    const winners = [];

    rm.players.forEach((p) => {
      if (!p.bet || p.bet.amount <= 0) {
        p.lastPayout = 0;
        p.lastNet = 0;
        if (economyHooks) p.coins = economyHooks.getUserGold(p.nickname);
        return;
      }
      if (winPool === 0) {
        if (economyHooks) {
          p.coins = economyHooks.addUserGold(p.nickname, p.bet.amount, 'horse_refund');
        } else {
          p.coins += p.bet.amount;
        }
        p.lastPayout = p.bet.amount;
        p.lastNet = 0;
      } else if (p.bet.horseId === winnerHorseId) {
        winners.push(p);
      } else {
        p.lastPayout = 0;
        p.lastNet = -p.bet.amount;
        if (economyHooks) p.coins = economyHooks.getUserGold(p.nickname);
      }
    });

    if (winPool > 0 && winners.length > 0) {
      winners.forEach((p, idx) => {
        const payout = idx === winners.length - 1
          ? Math.max(0, totalPool - distributed)
          : Math.floor((totalPool * p.bet.amount) / winPool);
        distributed += payout;
        if (economyHooks) {
          p.coins = economyHooks.addUserGold(p.nickname, payout, 'horse_payout');
          economyHooks.recordDailyActivity(p.nickname, { mainWin: 1 });
        } else {
          p.coins += payout;
        }
        p.lastPayout = payout;
        p.lastNet = payout - p.bet.amount;
      });
    }

    rm.lastRoundSummary = {
      round: rm.round,
      winnerHorseId,
      winnerHorseName: winnerHorse.name,
      totalPool,
      winPool,
      multiplier: mult,
      noWinnerRefund: winPool === 0 && totalPool > 0
    };

    rm.raceLog = totalPool === 0
      ? `🏁 ${winnerHorse.name} 1등! (이번 판 베팅 없음)`
      : winPool === 0
      ? `🏁 ${winnerHorse.name} 1등! 적중자가 없어 베팅액 전액 환불됩니다.`
      : `🏁 ${winnerHorse.name} 1등! 총 풀 ${totalPool.toLocaleString()}원 → 배당 x${mult} 지급 완료!`;

    if (rm.round >= rm.totalRounds) {
      rm.status = 'MATCH_FINISHED';
      rm.players.forEach((p) => {
        if (economyHooks) p.coins = economyHooks.getUserGold(p.nickname);
      });
      const sorted = [...rm.players].sort((a, b) => {
        const netA = a.coins - (typeof a.matchStartGold === 'number' ? a.matchStartGold : a.coins);
        const netB = b.coins - (typeof b.matchStartGold === 'number' ? b.matchStartGold : b.coins);
        if (netB !== netA) return netB - netA;
        return b.coins - a.coins;
      });
      rm.finalStandings = sorted.map((p, i) => ({
        rank: i + 1,
        nickname: p.nickname,
        coins: p.coins,
        netFromStart: p.coins - (typeof p.matchStartGold === 'number' ? p.matchStartGold : p.coins)
      }));
      const topNick = sorted[0]?.nickname || null;
      recordHorseMatchResult(topNick, rm.players.map((p) => p.nickname));
    } else {
      rm.status = 'ROUND_RESULT';
    }
    emitRoom(rm);
    emitRoomsList();
  }

  nsp.on('connection', (socket) => {
    socket.on('hr_list_rooms', () => {
      socket.emit('hr_rooms_updated', getRoomsSummary());
    });

    socket.on('hr_create_room', ({ title, clientId, nickname, password, maxPlayers, startingCoins, bettingDurationSec } = {}, cb) => {
      const rawPw = String(password || '').trim();
      if (rawPw && !/^\d{4}$/.test(rawPw)) {
        return cb && cb({ ok: false, error: '비밀번호는 숫자 4자리여야 합니다.' });
      }
      if (globalServerSettings?.enforceOneRoomPerAccount && clientId) {
        const existing = (typeof findUserExistingRoom === 'function' ? findUserExistingRoom(clientId, nickname) : null) || hrRooms.find((r) => r.hostClientId === clientId);
        if (existing) {
          const label = existing.gameLabel ? ` (${existing.gameLabel})` : '';
          const roleTxt = existing.role === 'player' ? '입장 중인' : '생성한';
          return cb && cb({ ok: false, error: `이미 ${roleTxt} 방 [${existing.title}]${label}이 있습니다. 기존 방에서 나가거나 삭제한 후 이용해주세요.` });
        }
      }
      const id = `hr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const cleanNick = String(nickname || '방장').trim().slice(0, 16);
      const startCoins = Math.max(100, Math.min(100000, Number(startingCoins) || 1000));
      const cap = Math.max(0, Math.min(100, Number(maxPlayers) || 0));
      const allowedSecs = [10, 15, 20];
      const dur = allowedSecs.includes(Number(bettingDurationSec)) ? Number(bettingDurationSec) : 15;
      const rm = {
        id,
        title: (String(title || '').trim() || `${cleanNick}님의 방`).slice(0, 24),
        hostClientId: clientId || socket.id,
        hostNickname: cleanNick,
        password: rawPw,
        maxPlayers: cap,
        startingCoins: startCoins,
        bettingDurationSec: dur,
        bettingEndsAt: null,
        status: 'WAITING',
        round: 1,
        totalRounds: 5,
        horses: initHorses(),
        players: [{
          clientId: clientId || socket.id,
          nickname: cleanNick,
          coins: economyHooks ? economyHooks.getUserGold(cleanNick) : startCoins,
          matchStartGold: economyHooks ? economyHooks.getUserGold(cleanNick) : startCoins,
          bet: null,
          socketId: socket.id
        }],
        spectators: [],
        lastRoundSummary: null,
        finalStandings: null,
        raceLog: '⏳ 참가자들을 기다리고 있습니다.',
        raceTimer: null,
        betTimer: null,
        createdAt: Date.now(),
        lastActivityAt: Date.now()
      };
      hrRooms.unshift(rm);
      socket.join(id);
      emitRoom(rm);
      emitRoomsList();
      if (cb) cb({ ok: true, room: sanitizeRoom(rm) });
    });

    socket.on('hr_join_room', ({ roomId, clientId, nickname, password, mode } = {}, cb) => {
      const rm = hrRooms.find((r) => r.id === roomId);
      if (!rm) return cb && cb({ ok: false, error: '방을 찾을 수 없습니다.' });
      const isHost = rm.hostClientId === clientId;
      if (mode !== 'spectate' && globalServerSettings?.enforceOneRoomPerAccount && typeof findUserExistingRoom === 'function') {
        const conflict = findUserExistingRoom(clientId, nickname, 'horse', rm.id);
        if (conflict) {
          const roleTxt = conflict.role === 'player' ? '입장 중인' : '생성한';
          return cb && cb({ ok: false, error: `이미 ${roleTxt} 방 [${conflict.title}] (${conflict.gameLabel})이 있습니다. 기존 방에서 나가거나 삭제한 후 이용해주세요.` });
        }
      }
      if (rm.password && !isHost && String(password || '') !== rm.password) {
        return cb && cb({ ok: false, error: '방 비밀번호(숫자 4자리)가 일치하지 않습니다.' });
      }
      rm.lastActivityAt = Date.now();
      socket.join(rm.id);
      const cleanNick = String(nickname || '유저').trim().slice(0, 16);
      if (mode !== 'spectate' && typeof removeUserFromOtherGames === 'function') {
        removeUserFromOtherGames(clientId, cleanNick, 'horse', rm.id);
      }
      const existingP = rm.players.find((p) => p.clientId === clientId);
      if (existingP) {
        existingP.socketId = socket.id;
        existingP.nickname = cleanNick;
      } else if (mode !== 'spectate') {
        if (rm.maxPlayers > 0 && rm.players.length >= rm.maxPlayers) {
          return cb && cb({ ok: false, error: `방 최대 인원(${rm.maxPlayers}명)에 도달했습니다.` });
        }
        rm.spectators = rm.spectators.filter((s) => s.clientId !== clientId);
        const initG = economyHooks ? economyHooks.getUserGold(cleanNick) : (rm.startingCoins || 1000);
        rm.players.push({
          clientId,
          nickname: cleanNick,
          coins: initG,
          matchStartGold: initG,
          bet: null,
          socketId: socket.id
        });
      } else {
        if (!rm.spectators.some((s) => s.clientId === clientId)) {
          rm.spectators.push({ clientId, nickname: cleanNick, socketId: socket.id });
        }
      }
      emitRoom(rm);
      emitRoomsList();
      if (cb) cb({ ok: true, room: sanitizeRoom(rm) });
    });

    socket.on('hr_update_settings', ({ roomId, clientId, startingCoins, maxPlayers, bettingDurationSec } = {}) => {
      const rm = hrRooms.find((r) => r.id === roomId);
      if (!rm || rm.hostClientId !== clientId || rm.status !== 'WAITING') return;
      if (typeof startingCoins !== 'undefined') {
        rm.startingCoins = Math.max(100, Math.min(100000, Number(startingCoins) || 1000));
        rm.players.forEach((p) => { p.coins = rm.startingCoins; });
      }
      if (typeof maxPlayers !== 'undefined') {
        rm.maxPlayers = Math.max(0, Math.min(100, Number(maxPlayers) || 0));
      }
      if ([10, 15, 20].includes(Number(bettingDurationSec))) {
        rm.bettingDurationSec = Number(bettingDurationSec);
      }
      emitRoom(rm);
      emitRoomsList();
    });

    socket.on('hr_start_match', ({ roomId, clientId } = {}) => {
      const rm = hrRooms.find((r) => r.id === roomId);
      if (!rm || rm.hostClientId !== clientId) return;
      clearRoomTimers(rm);
      rm.round = 1;
      rm.finalStandings = null;
      rm.players.forEach((p) => {
        const g = economyHooks ? economyHooks.getUserGold(p.nickname) : p.coins;
        p.coins = g;
        p.matchStartGold = g;
      });
      startBettingRound(rm);
    });

    socket.on('hr_place_bet', ({ roomId, clientId, horseId, amount } = {}, cb) => {
      const rm = hrRooms.find((r) => r.id === roomId);
      if (!rm || rm.status !== 'BETTING') return cb && cb({ ok: false, error: '베팅 시간이 아닙니다.' });
      const p = rm.players.find((x) => x.clientId === clientId);
      if (!p) return cb && cb({ ok: false, error: '참가자만 베팅할 수 있습니다.' });
      if (p.bet) return cb && cb({ ok: false, error: '이미 이번 판 베팅을 완료했습니다.' });
      if (economyHooks) p.coins = economyHooks.getUserGold(p.nickname);
      const hId = Number(horseId);
      const amt = Math.floor(Number(amount) || 0);
      if (hId < 0 || hId > 2) return cb && cb({ ok: false, error: '말을 선택해주세요.' });
      if (amt <= 0 || amt > p.coins) return cb && cb({ ok: false, error: `1 스타 이상 보유 스타(${p.coins.toLocaleString()} 스타) 범위 내에서 베팅해주세요.` });
      if (economyHooks) {
        p.coins = economyHooks.addUserGold(p.nickname, -amt, 'horse_bet');
        economyHooks.recordDailyActivity(p.nickname, { play: 1 });
      } else {
        p.coins -= amt;
      }
      p.bet = { horseId: hId, amount: amt };
      rm.lastActivityAt = Date.now();
      emitRoom(rm);
      if (cb) cb({ ok: true });

      // 전원 베팅 완료 시 1초 뒤 자동 출발!
      if (rm.players.length > 0 && rm.players.every((x) => Boolean(x.bet))) {
        clearRoomTimers(rm);
        rm.raceLog = '✅ 전원 베팅 완료! 잠시 후 경주가 자동 출발합니다!';
        emitRoom(rm);
        rm.betTimer = setTimeout(() => {
          if (hrRooms.includes(rm) && rm.status === 'BETTING') runRaceSimulation(rm);
        }, 1000);
      }
    });

    socket.on('hr_start_race', ({ roomId, clientId } = {}) => {
      const rm = hrRooms.find((r) => r.id === roomId);
      if (!rm || rm.hostClientId !== clientId || rm.status !== 'BETTING') return;
      runRaceSimulation(rm);
    });

    socket.on('hr_next_round', ({ roomId, clientId } = {}) => {
      const rm = hrRooms.find((r) => r.id === roomId);
      if (!rm || rm.hostClientId !== clientId || rm.status !== 'ROUND_RESULT') return;
      rm.round += 1;
      startBettingRound(rm);
    });

    socket.on('hr_leave_room', ({ roomId, clientId } = {}) => {
      const rm = hrRooms.find((r) => r.id === roomId);
      if (!rm) return;
      socket.leave(rm.id);
      if (rm.hostClientId === clientId) {
        clearRoomTimers(rm);
        if ((rm.status === 'BETTING' || rm.status === 'RACING') && economyHooks) {
          rm.players.forEach((p) => {
            if (p.clientId !== clientId && p.bet && p.bet.amount > 0) {
              economyHooks.addUserGold(p.nickname, p.bet.amount, 'horse_host_abort_refund');
            }
          });
        }
        hrRooms = hrRooms.filter((r) => r.id !== rm.id);
        nsp.to(rm.id).emit('hr_room_deleted', { roomId: rm.id });
        emitRoomsList();
        return;
      }
      rm.players = rm.players.filter((p) => p.clientId !== clientId);
      rm.spectators = rm.spectators.filter((s) => s.clientId !== clientId);
      emitRoom(rm);
      emitRoomsList();
    });
  });

  return {
    getHorseRoomsSummary: getRoomsSummary,
    getHorseRoomsJoinedBy: (cid, nick) => {
      const nLow = String(nick || '').trim().toLowerCase();
      return hrRooms
        .filter((r) => r.players.some((p) => (cid && p.clientId === cid) || (nLow && p.nickname.toLowerCase() === nLow)))
        .map((r) => ({ id: r.id, title: r.title, hostClientId: r.hostClientId, hostNickname: r.hostNickname, count: r.players.length }));
    },
    removeUserFromHorse: (cid, nick, exceptRoomId = null) => {
      const nLow = String(nick || '').trim().toLowerCase();
      let changed = false;
      hrRooms.forEach((rm) => {
        if (exceptRoomId && rm.id === exceptRoomId) return;
        const before = rm.players.length;
        rm.players = rm.players.filter((p) => !( (cid && p.clientId === cid) || (nLow && p.nickname.toLowerCase() === nLow) ));
        if (rm.players.length !== before) {
          emitRoom(rm);
          changed = true;
        }
      });
      if (changed) emitRoomsList();
    },
    deleteHorseRoomById: (roomId) => {
      const rm = hrRooms.find((r) => r.id === roomId);
      if (!rm) return false;
      clearRoomTimers(rm);
      hrRooms = hrRooms.filter((r) => r.id !== rm.id);
      nsp.to(rm.id).emit('hr_room_deleted', { roomId: rm.id });
      emitRoomsList();
      return true;
    }
  };
}

module.exports = { setupHorseRacingSocket };
