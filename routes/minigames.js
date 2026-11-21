// 1:1 미니게임 실시간 Socket.io 서버 (/minigames 네임스페이스)
// 지원 게임: black-white (흑과 백), russian-roulette (러시안 룰렛), dice-21 (다이스 21)

const GAME_TITLES = {
  'black-white': '🎭 흑과 백',
  'russian-roulette': '🔫 러시안 룰렛',
  'dice-21': '🎲 다이스 21'
};

function setupMinigamesSocket(io, deps) {
  const { usersDB, saveUsersDB, ensureUserStatsStructure, globalServerSettings, economyHooks, findUserExistingRoom, removeUserFromOtherGames } = deps;
  const nsp = io.of('/minigames');
  let mgRooms = [];

  function findUserByNickname(nick) {
    if (!nick || !Array.isArray(usersDB)) return null;
    const clean = String(nick).trim().toLowerCase();
    return usersDB.find((u) => String(u.nickname || '').trim().toLowerCase() === clean) || null;
  }

  function recordMinigameResult(winnerNick, loserNick, isDraw = false) {
    let changed = false;
    [
      { nick: winnerNick, won: !isDraw },
      { nick: loserNick, won: false }
    ].forEach(({ nick, won }) => {
      if (!nick || nick.startsWith('🤖')) return;
      const u = findUserByNickname(nick);
      if (!u) return;
      ensureUserStatsStructure(u);
      if (!u.game_data.stats.minigames) {
        u.game_data.stats.minigames = { plays: 0, wins: 0 };
      }
      u.game_data.stats.minigames.plays += 1;
      if (won) u.game_data.stats.minigames.wins += 1;
      u.updated_at = new Date().toISOString();
      changed = true;
    });
    if (changed) saveUsersDB(usersDB);
  }

  function getRoomSummaryList(gameType) {
    return mgRooms
      .filter((r) => !gameType || r.gameType === gameType)
      .map((r) => ({
        id: r.id,
        gameType: r.gameType,
        title: r.title,
        hostClientId: r.hostClientId,
        hostNickname: r.hostNickname,
        hasPassword: Boolean(r.password),
        entryFee: r.entryFee || 0,
        prizePool: r.prizePool || 0,
        status: r.status,
        playerCount: r.players.length,
        spectatorCount: r.spectators.length,
        playerIds: r.players.map((p) => p.clientId),
        players: r.players.map((p) => ({ clientId: p.clientId, nickname: p.nickname, isBot: Boolean(p.isBot) })),
        createdAt: r.createdAt
      }));
  }

  function sanitizeRoomForClient(rm) {
    const safeGame = rm.game ? JSON.parse(JSON.stringify(rm.game)) : null;
    if (safeGame) {
      if (rm.gameType === 'russian-roulette') {
        delete safeGame.bulletIndex;
      }
      if (rm.gameType === 'black-white' && safeGame.phase === 'PICKING') {
        safeGame.picksHidden = {
          0: safeGame.picks[0] !== null ? (safeGame.picks[0] % 2 === 0 ? 'BLACK' : 'WHITE') : null,
          1: safeGame.picks[1] !== null ? (safeGame.picks[1] % 2 === 0 ? 'BLACK' : 'WHITE') : null
        };
        delete safeGame.picks;
      }
    }
    return {
      id: rm.id,
      gameType: rm.gameType,
      title: rm.title,
      hostClientId: rm.hostClientId,
      hostNickname: rm.hostNickname,
      hasPassword: Boolean(rm.password),
      entryFee: rm.entryFee || 0,
      prizePool: rm.prizePool || 0,
      status: rm.status,
      players: rm.players.map((p) => ({
        clientId: p.clientId,
        nickname: p.nickname,
        isBot: Boolean(p.isBot),
        ready: Boolean(p.isBot || p.clientId === rm.hostClientId || p.ready),
        wins: p.wins || 0,
        gold: p.isBot ? 0 : (economyHooks ? economyHooks.getUserGold(p.nickname) : 3000),
        cosmetics: p.isBot ? { title: '[AI]', color: '#94a3b8', marbleSkin: '' } : (economyHooks ? economyHooks.getUserCosmetics(p.nickname) : {})
      })),
      spectators: rm.spectators.map((s) => ({ clientId: s.clientId, nickname: s.nickname })),
      winnerIndex: rm.winnerIndex,
      isDraw: rm.isDraw,
      resultMessage: rm.resultMessage || '',
      game: safeGame
    };
  }

  function emitRoomState(rm) {
    nsp.to(rm.id).emit('mg_room_state', sanitizeRoomForClient(rm));
  }

  function emitRoomsList(gameType) {
    nsp.emit('mg_rooms_updated', { gameType, rooms: getRoomSummaryList(gameType) });
  }

  function initGameState(rm) {
    rm.status = 'PLAYING';
    rm.winnerIndex = null;
    rm.isDraw = false;
    rm.resultMessage = '';
    if (rm.gameType === 'black-white') {
      const firstIdx = Math.random() < 0.5 ? 0 : 1;
      rm.game = {
        round: 1,
        maxRounds: 9,
        phase: 'PICKING',
        turnIndex: firstIdx,
        roundStarter: firstIdx,
        selectingTurn: true,
        tiles: [
          [0, 1, 2, 3, 4, 5, 6, 7, 8],
          [0, 1, 2, 3, 4, 5, 6, 7, 8]
        ],
        scores: [0, 0],
        picks: [null, null],
        lastRound: null
      };
      setTimeout(() => {
        if (!mgRooms.includes(rm) || rm.status !== 'PLAYING' || !rm.game) return;
        rm.game.selectingTurn = false;
        emitRoomState(rm);
        runBotTurnIfNeeded(rm);
      }, 2100);
    } else if (rm.gameType === 'russian-roulette') {
      rm.game = {
        chamberSize: 6,
        currentChamber: 0,
        bulletIndex: Math.floor(Math.random() * 6),
        turnIndex: Math.random() < 0.5 ? 0 : 1,
        selectingTurn: true,
        spinLeft: [1, 1],
        passLeft: [1, 1],
        lastLog: '🎲 선공 플레이어를 추첨하고 있습니다...'
      };
      setTimeout(() => {
        if (!mgRooms.includes(rm) || rm.status !== 'PLAYING' || !rm.game) return;
        rm.game.selectingTurn = false;
        const starterName = rm.players[rm.game.turnIndex]?.nickname || '플레이어';
        rm.game.lastLog = `🔫 실린더 장전 완료! [${starterName}]님부터 시작합니다.`;
        emitRoomState(rm);
        runBotTurnIfNeeded(rm);
      }, 2100);
    } else if (rm.gameType === 'dice-21') {
      rm.game = {
        turnIndex: Math.random() < 0.5 ? 0 : 1,
        selectingTurn: true,
        totals: [0, 0],
        rolls: [[], []],
        held: [false, false],
        lastLog: '🎲 선공 플레이어를 추첨하고 있습니다...'
      };
      setTimeout(() => {
        if (!mgRooms.includes(rm) || rm.status !== 'PLAYING' || !rm.game) return;
        rm.game.selectingTurn = false;
        const starterName = rm.players[rm.game.turnIndex]?.nickname || '플레이어';
        rm.game.lastLog = `🎲 선공 확정! [${starterName}]님부터 주사위를 굴립니다.`;
        emitRoomState(rm);
        runBotTurnIfNeeded(rm);
      }, 2100);
    }
  }

  function finishGame(rm, winnerIdx, isDraw, msg) {
    rm.status = 'FINISHED';
    rm.winnerIndex = winnerIdx;
    rm.isDraw = Boolean(isDraw);
    let finalMsg = msg;
    const p0 = rm.players[0]?.nickname;
    const p1 = rm.players[1]?.nickname;
    const hasBot = rm.players.some((p) => p.isBot);

    if (isDraw) {
      recordMinigameResult(p0, p1, true);
      if (rm.prizePool > 0 && rm.entryFee > 0 && economyHooks) {
        if (hasBot) {
          const humanP = rm.players.find((p) => !p.isBot);
          if (humanP) economyHooks.addUserGold(humanP.nickname, rm.entryFee, 'minigame_bot_draw_refund');
          finalMsg += ` (⭐ 무승부 배팅금 ${rm.entryFee.toLocaleString()} 스타 환급)`;
        } else {
          if (p0) economyHooks.addUserGold(p0, rm.entryFee, 'minigame_draw_refund');
          if (p1) economyHooks.addUserGold(p1, rm.entryFee, 'minigame_draw_refund');
          finalMsg += ` (⭐ 무승부 입장비 ${rm.entryFee.toLocaleString()} 스타 환급)`;
        }
        rm.prizePool = 0;
      }
    } else if (winnerIdx === 0 || winnerIdx === 1) {
      const winPlayer = rm.players[winnerIdx];
      const losePlayer = rm.players[1 - winnerIdx];
      if (winPlayer) winPlayer.wins = (winPlayer.wins || 0) + 1;
      recordMinigameResult(winPlayer?.nickname, losePlayer?.nickname, false);
      if (winPlayer && !winPlayer.isBot && economyHooks) {
        economyHooks.recordDailyActivity(winPlayer.nickname, { minigameWin: 1 });
        if (rm.prizePool > 0) {
          economyHooks.addUserGold(winPlayer.nickname, rm.prizePool, hasBot ? 'minigame_bot_prize' : 'minigame_prize');
          finalMsg += hasBot
            ? ` (🤖 봇전 승리 상금 +${rm.prizePool.toLocaleString()} 스타!)`
            : ` (⭐ 상금 +${rm.prizePool.toLocaleString()} 스타 독식!)`;
          rm.prizePool = 0;
        } else if (hasBot) {
          economyHooks.addUserGold(winPlayer.nickname, 30, 'minigame_bot_win');
          finalMsg += ` (🤖 연습 승리 보너스 +30 스타)`;
        }
      } else {
        rm.prizePool = 0;
      }
    }
    // 게임 종료 시 다음 판(다시하기)을 위해 상대방(비방장 인간 플레이어)의 ready 상태를 false로 초기화하여 동의를 받도록 함
    rm.players.forEach((p) => {
      p.ready = Boolean(p.isBot || p.clientId === rm.hostClientId);
    });
    rm.resultMessage = finalMsg;
    emitRoomState(rm);
    emitRoomsList(rm.gameType);
  }

  function runBotTurnIfNeeded(rm) {
    if (!rm || rm.status !== 'PLAYING') return;
    const botIdx = rm.players.findIndex((p) => p.isBot);
    if (botIdx < 0) return;

    setTimeout(() => {
      if (!mgRooms.includes(rm) || rm.status !== 'PLAYING' || !rm.game) return;
      const humanIdx = 1 - botIdx;

      if (rm.gameType === 'black-white') {
        if (!rm.game.selectingTurn && rm.game.phase === 'PICKING' && rm.game.turnIndex === botIdx && rm.game.picks[botIdx] === null) {
          const avail = [...(rm.game.tiles[botIdx] || [])].sort((a, b) => a - b);
          if (avail.length > 0) {
            let pick = avail[Math.floor(Math.random() * avail.length)];
            const oppPick = rm.game.picks[humanIdx];
            // 후공일 때: 상대가 낸 타일의 흑(짝수)/백(홀수) 색상 정보와 상대 남은 흑/백 분포만 활용해 정정당당하게 심리전 수행
            if (oppPick !== null && oppPick !== undefined) {
              const oppIsEven = oppPick % 2 === 0;
              const oppCandidates = (rm.game.tiles[humanIdx] || []).filter((t) => (t % 2 === 0) === oppIsEven);
              const oppExpected = oppCandidates.length > 0
                ? oppCandidates.reduce((s, v) => s + v, 0) / oppCandidates.length
                : (oppIsEven ? 4 : 5);
              // 이길 수 있는 타일 중 가장 작은 타일(최소 비용 승리) 탐색
              const winningTiles = avail.filter((t) => t > oppExpected + 0.5);
              if (winningTiles.length > 0 && Math.random() < 0.72) {
                pick = winningTiles[0];
              } else if (Math.random() < 0.65) {
                // 이기기 어렵거나 높은 타일을 아껴야 할 때는 가장 낮은 타일 버리기
                pick = avail[0];
              }
            }
            handleBlackWhitePick(rm, botIdx, pick);
          }
        }
      } else if (rm.gameType === 'russian-roulette') {
        if (!rm.game.selectingTurn && rm.game.turnIndex === botIdx) {
          if (rm.game.currentChamber >= 3 && rm.game.passLeft[botIdx] > 0 && Math.random() < 0.75) {
            handleRussianAction(rm, botIdx, 'PASS');
          } else {
            handleRussianAction(rm, botIdx, 'PULL');
          }
        }
      } else if (rm.gameType === 'dice-21') {
        if (!rm.game.selectingTurn && rm.game.turnIndex === botIdx && !rm.game.held[botIdx]) {
          const myTotal = rm.game.totals[botIdx] || 0;
          const oppTotal = rm.game.totals[humanIdx] || 0;
          const myRolls = (rm.game.rolls[botIdx] || []).length;
          const oppRolls = (rm.game.rolls[humanIdx] || []).length;
          const oppHeld = Boolean(rm.game.held[humanIdx]);

          let action = 'ROLL';
          if (myTotal >= 21) {
            action = 'HOLD';
          } else if (myTotal < oppTotal) {
            // 상대보다 점수가 낮으면 멈추는 순간 무조건 패배(또는 상대 홀드 시 즉시 패배)하므로 버스트 위험을 감수하고 무조건 굴림!
            action = 'ROLL';
          } else if (myTotal === oppTotal) {
            if (oppHeld) {
              // 상대가 이미 홀드한 동점 상황: 주사위 굴린 횟수가 내가 더 많으면 타이브레이커 승리로 즉시 홀드, 같거나 적으면 멈추면 지거나 비기므로 굴림!
              if (myRolls > oppRolls) action = 'HOLD';
              else action = 'ROLL';
            } else {
              // 상대가 아직 홀드하지 않은 동점 상황: 18점 이상이면서 굴린 횟수 우위거나 19점 이상이면 홀드, 아니면 더 굴림
              if (myTotal >= 19 || (myTotal >= 18 && myRolls > oppRolls)) action = 'HOLD';
              else action = 'ROLL';
            }
          } else {
            // 내가 상대보다 점수가 높은 상황 (myTotal > oppTotal)
            if (oppHeld) {
              // 상대가 이미 멈췄고 내 점수가 더 높으면 더 굴릴 필요 없이 즉시 홀드하여 100% 승리 확정!
              action = 'HOLD';
            } else {
              // 상대가 아직 안 멈췄을 때는 18점 이상에서 안정적으로 홀드(17점은 상대 점수 차이에 따라 선택적 홀드)
              if (myTotal >= 18) action = 'HOLD';
              else if (myTotal === 17 && (myTotal - oppTotal >= 4) && Math.random() < 0.45) action = 'HOLD';
              else action = 'ROLL';
            }
          }
          handleDiceAction(rm, botIdx, action);
        }
      }
    }, 650);
  }

  function handleBlackWhitePick(rm, pIdx, tileVal) {
    const g = rm.game;
    if (g.selectingTurn || g.phase !== 'PICKING') return;
    if (g.turnIndex !== pIdx) return;
    if (g.picks[pIdx] !== null) return;
    const num = Number(tileVal);
    if (!g.tiles[pIdx].includes(num)) return;
    g.picks[pIdx] = num;
    if (g.picks[1 - pIdx] === null) {
      g.turnIndex = 1 - pIdx;
      emitRoomState(rm);
      runBotTurnIfNeeded(rm);
      return;
    }
    emitRoomState(rm);

    if (g.picks[0] !== null && g.picks[1] !== null) {
      const v0 = g.picks[0];
      const v1 = g.picks[1];
      g.tiles[0] = g.tiles[0].filter((x) => x !== v0);
      g.tiles[1] = g.tiles[1].filter((x) => x !== v1);
      let roundWinner = -1;
      if (v0 > v1) { g.scores[0] += 1; roundWinner = 0; }
      else if (v1 > v0) { g.scores[1] += 1; roundWinner = 1; }
      g.lastRound = { round: g.round, v0, v1, roundWinner };
      g.phase = 'REVEALED';
      emitRoomState(rm);

      setTimeout(() => {
        if (!mgRooms.includes(rm) || rm.status !== 'PLAYING') return;
        if (g.scores[0] >= 5 || g.scores[1] >= 5 || g.round >= g.maxRounds) {
          if (g.scores[0] > g.scores[1]) {
            finishGame(rm, 0, false, `🏆 ${rm.players[0].nickname} 승리! (${g.scores[0]} : ${g.scores[1]})`);
          } else if (g.scores[1] > g.scores[0]) {
            finishGame(rm, 1, false, `🏆 ${rm.players[1].nickname} 승리! (${g.scores[0]} : ${g.scores[1]})`);
          } else {
            finishGame(rm, null, true, `🤝 무승부! (${g.scores[0]} : ${g.scores[1]})`);
          }
        } else {
          g.round += 1;
          g.picks = [null, null];
          g.phase = 'PICKING';
          const nextFirst = roundWinner >= 0 ? roundWinner : (typeof g.roundStarter === 'number' ? g.roundStarter : 0);
          g.roundStarter = nextFirst;
          g.turnIndex = nextFirst;
          emitRoomState(rm);
          runBotTurnIfNeeded(rm);
        }
      }, 3400);
    } else {
      runBotTurnIfNeeded(rm);
    }
  }

  function handleRussianAction(rm, pIdx, actionType) {
    const g = rm.game;
    if (g.selectingTurn || g.turnIndex !== pIdx) return;
    const actorName = rm.players[pIdx]?.nickname || '플레이어';

    if (actionType === 'PASS') {
      if (g.passLeft[pIdx] <= 0) return;
      g.passLeft[pIdx] -= 1;
      g.turnIndex = 1 - pIdx;
      g.lastLog = `⏭️ ${actorName}님이 턴 패스를 사용했습니다!`;
      emitRoomState(rm);
      runBotTurnIfNeeded(rm);
      return;
    }
    if (actionType === 'PULL') {
      if (g.currentChamber === g.bulletIndex) {
        const oppIdx = 1 - pIdx;
        g.lastLog = `💥 탕!! ${actorName}님이 실탄에 맞았습니다!`;
        finishGame(rm, oppIdx, false, `💥 탕! ${rm.players[oppIdx].nickname} 생존 승리!`);
      } else {
        g.currentChamber = (g.currentChamber + 1) % g.chamberSize;
        g.turnIndex = 1 - pIdx;
        g.lastLog = `😮‍💨 딸깍! ${actorName}님 생존! (${g.chamberSize - g.currentChamber}발 남음)`;
        emitRoomState(rm);
        runBotTurnIfNeeded(rm);
      }
    }
  }

  function handleDiceAction(rm, pIdx, actionType) {
    const g = rm.game;
    if (g.selectingTurn) return;
    if (g.turnIndex !== pIdx || g.held[pIdx]) return;
    const actorName = rm.players[pIdx]?.nickname || '플레이어';
    if (actionType === 'ROLL') {
      const val = Math.floor(Math.random() * 6) + 1;
      g.rolls[pIdx].push(val);
      g.totals[pIdx] += val;
      if (g.totals[pIdx] > 21) {
        const oppIdx = 1 - pIdx;
        g.lastLog = `💥 ${actorName}님 주사위 [${val}] → 합계 ${g.totals[pIdx]} 버스트!`;
        finishGame(rm, oppIdx, false, `💥 ${actorName} 버스트! ${rm.players[oppIdx].nickname} 승리!`);
        return;
      }
      g.lastLog = `🎲 ${actorName}님 [${val}] 굴림 → 현재 합계 ${g.totals[pIdx]}`;
      if (!g.held[1 - pIdx]) g.turnIndex = 1 - pIdx;
      emitRoomState(rm);
      runBotTurnIfNeeded(rm);
    } else if (actionType === 'HOLD') {
      g.held[pIdx] = true;
      g.lastLog = `✋ ${actorName}님 ${g.totals[pIdx]}점으로 스톱(Hold)!`;
      if (g.held[0] && g.held[1]) {
        const t0 = g.totals[0], t1 = g.totals[1];
        const c0 = g.rolls[0].length, c1 = g.rolls[1].length;
        if (t0 > t1) finishGame(rm, 0, false, `🏆 ${rm.players[0].nickname} 승리! (${t0}점 vs ${t1}점)`);
        else if (t1 > t0) finishGame(rm, 1, false, `🏆 ${rm.players[1].nickname} 승리! (${t0}점 vs ${t1}점)`);
        else if (c0 > c1) finishGame(rm, 0, false, `🏆 ${rm.players[0].nickname} 동점 주사위 횟수 승리! (${t0}점 · ${c0}회 vs ${c1}회)`);
        else if (c1 > c0) finishGame(rm, 1, false, `🏆 ${rm.players[1].nickname} 동점 주사위 횟수 승리! (${t0}점 · ${c0}회 vs ${c1}회)`);
        else finishGame(rm, null, true, `🤝 완전 동점 무승부! (${t0}점 · ${c0}회 동일)`);
        return;
      }
      g.turnIndex = 1 - pIdx;
      emitRoomState(rm);
      runBotTurnIfNeeded(rm);
    }
  }

  nsp.on('connection', (socket) => {
    socket.on('mg_list_rooms', ({ gameType } = {}) => {
      socket.emit('mg_rooms_updated', { gameType, rooms: getRoomSummaryList(gameType) });
    });

    socket.on('mg_create_room', ({ gameType, title, clientId, nickname, password, entryFee } = {}, cb) => {
      if (!GAME_TITLES[gameType]) return cb && cb({ ok: false, error: '지원하지 않는 게임입니다.' });
      const rawPw = String(password || '').trim();
      if (rawPw && !/^\d{4}$/.test(rawPw)) {
        return cb && cb({ ok: false, error: '비밀번호는 숫자 4자리여야 합니다.' });
      }
      if (globalServerSettings?.enforceOneRoomPerAccount && clientId) {
        const existing = (typeof findUserExistingRoom === 'function' ? findUserExistingRoom(clientId, nickname) : null) || mgRooms.find((r) => r.hostClientId === clientId);
        if (existing) {
          const label = existing.gameLabel ? ` (${existing.gameLabel})` : '';
          const roleTxt = existing.role === 'player' ? '입장 중인' : '생성한';
          return cb && cb({ ok: false, error: `이미 ${roleTxt} 방 [${existing.title}]${label}이 있습니다. 기존 방에서 나가거나 삭제한 후 이용해주세요.` });
        }
      }
      const cleanNick = String(nickname || '방장').trim().slice(0, 16);
      const fee = Math.max(0, Math.min(1000000000, Math.floor(Number(entryFee) || 0)));
      if (fee > 0 && economyHooks && !economyHooks.canAffordGold(cleanNick, fee)) {
        return cb && cb({ ok: false, error: `보유 스타가 부족하여 ${fee.toLocaleString()} 스타 내기 방을 만들 수 없습니다. (현재 ${economyHooks.getUserGold(cleanNick).toLocaleString()} 스타)` });
      }
      const id = `mg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const cleanTitle = (String(title || '').trim() || `${cleanNick}님의 방`).slice(0, 24);
      const rm = {
        id,
        gameType,
        title: cleanTitle,
        hostClientId: clientId || socket.id,
        hostNickname: cleanNick,
        password: rawPw,
        entryFee: fee,
        prizePool: 0,
        status: 'WAITING',
        players: [{ clientId: clientId || socket.id, nickname: cleanNick, socketId: socket.id, isBot: false, ready: true, wins: 0 }],
        spectators: [],
        winnerIndex: null,
        isDraw: false,
        resultMessage: '',
        game: null,
        createdAt: Date.now(),
        lastActivityAt: Date.now()
      };
      mgRooms.unshift(rm);
      socket.join(id);
      emitRoomState(rm);
      emitRoomsList(gameType);
      if (cb) cb({ ok: true, room: sanitizeRoomForClient(rm) });
    });

    socket.on('mg_join_room', ({ roomId, clientId, nickname, password, mode } = {}, cb) => {
      const rm = mgRooms.find((r) => r.id === roomId);
      if (!rm) return cb && cb({ ok: false, error: '방을 찾을 수 없습니다.' });
      const isHost = rm.hostClientId === clientId;
      if (mode !== 'spectate' && globalServerSettings?.enforceOneRoomPerAccount && typeof findUserExistingRoom === 'function') {
        const conflict = findUserExistingRoom(clientId, nickname, 'minigame', rm.id);
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
        removeUserFromOtherGames(clientId, cleanNick, 'minigame', rm.id);
      }
      const alreadyPlayer = rm.players.find((p) => p.clientId === clientId);
      if (alreadyPlayer) {
        alreadyPlayer.socketId = socket.id;
        alreadyPlayer.nickname = cleanNick;
      } else if (mode !== 'spectate' && rm.status === 'WAITING' && rm.players.length < 2) {
        if (rm.entryFee > 0 && economyHooks && !economyHooks.canAffordGold(cleanNick, rm.entryFee)) {
          return cb && cb({ ok: false, error: `입장비(${rm.entryFee.toLocaleString()} 스타)가 부족하여 대결에 참가할 수 없습니다. (현재 ${economyHooks.getUserGold(cleanNick).toLocaleString()} 스타)` });
        }
        rm.spectators = rm.spectators.filter((s) => s.clientId !== clientId);
        rm.players.push({ clientId, nickname: cleanNick, socketId: socket.id, isBot: false, ready: isHost, wins: 0 });
      } else {
        if (!rm.spectators.some((s) => s.clientId === clientId)) {
          rm.spectators.push({ clientId, nickname: cleanNick, socketId: socket.id });
        }
      }
      emitRoomState(rm);
      emitRoomsList(rm.gameType);
      if (cb) cb({ ok: true, room: sanitizeRoomForClient(rm) });
    });

    socket.on('mg_add_bot', ({ roomId, clientId } = {}, cb) => {
      const rm = mgRooms.find((r) => r.id === roomId);
      if (!rm || rm.hostClientId !== clientId || rm.status !== 'WAITING') return;
      if (rm.players.length >= 2) return;
      if (Number(rm.entryFee || 0) > 10000) {
        if (cb) cb({ ok: false, error: '🤖 봇전 배팅은 최대 10,000 스타 방까지만 가능합니다.' });
        return;
      }
      rm.players.push({ clientId: 'bot_ai', nickname: '🤖 연습 봇', socketId: null, isBot: true, ready: true, wins: 0 });
      emitRoomState(rm);
      emitRoomsList(rm.gameType);
      if (cb) cb({ ok: true });
    });

    socket.on('mg_toggle_ready', ({ roomId, clientId } = {}, cb) => {
      const rm = mgRooms.find((r) => r.id === roomId);
      if (!rm || rm.status === 'PLAYING') return;
      const p = rm.players.find((x) => x.clientId === clientId);
      if (!p || p.isBot || p.clientId === rm.hostClientId) return;
      const fee = Number(rm.entryFee || 0);
      if (!p.ready && fee > 0 && economyHooks && !economyHooks.canAffordGold(p.nickname, fee)) {
        const msg = `보유 스타가 입장비(${fee.toLocaleString()} 스타)보다 부족하여 준비 완료할 수 없습니다.`;
        if (cb) cb({ ok: false, error: msg });
        return;
      }
      p.ready = !p.ready;
      rm.lastActivityAt = Date.now();
      emitRoomState(rm);
      if (cb) cb({ ok: true, ready: p.ready });
    });

    socket.on('mg_start_game', ({ roomId, clientId } = {}, cb) => {
      const rm = mgRooms.find((r) => r.id === roomId);
      if (!rm || rm.hostClientId !== clientId) return;
      if (rm.players.length < 2) return;
      const unready = rm.players.find((p) => !p.isBot && p.clientId !== rm.hostClientId && !p.ready);
      if (unready) {
        const msg = `⏳ 상대방 [${unready.nickname}]님이 아직 [준비 완료(동의)]를 누르지 않았습니다.`;
        if (cb) cb({ ok: false, error: msg });
        return;
      }
      const hasBot = rm.players.some((p) => p.isBot);
      const fee = Number(rm.entryFee || 0);
      if (hasBot && fee > 0 && economyHooks) {
        if (fee > 10000) {
          const errMsg = '🤖 봇전 배팅은 최대 10,000 스타까지만 가능합니다.';
          if (cb) cb({ ok: false, error: errMsg });
          return;
        }
        const humanP = rm.players.find((p) => !p.isBot);
        if (!humanP || !economyHooks.canAffordGold(humanP.nickname, fee)) {
          const errMsg = `보유 스타가 배팅금(${fee.toLocaleString()} 스타)보다 부족하여 시작할 수 없습니다.`;
          rm.resultMessage = `⚠️ ${errMsg}`;
          emitRoomState(rm);
          if (cb) cb({ ok: false, error: errMsg });
          return;
        }
        const usedToday = economyHooks.getMinigameDailyBetUsed ? economyHooks.getMinigameDailyBetUsed(humanP.nickname, rm.gameType) : 0;
        if (usedToday + fee > 100000) {
          const remain = Math.max(0, 100000 - usedToday);
          const errMsg = `⚠️ 오늘 이 게임의 일일 봇전 배팅 한도(100,000 스타)를 초과했습니다! (남은 한도: ${remain.toLocaleString()} 스타 · 무료 0 스타 방은 이용 가능)`;
          rm.resultMessage = errMsg;
          emitRoomState(rm);
          if (cb) cb({ ok: false, error: errMsg });
          return;
        }
        economyHooks.addUserGold(humanP.nickname, -fee, 'minigame_bot_bet');
        if (economyHooks.addMinigameDailyBet) economyHooks.addMinigameDailyBet(humanP.nickname, rm.gameType, fee);
        economyHooks.recordDailyActivity(humanP.nickname, { play: 1 });
        rm.prizePool = fee * 2;
      } else if (!hasBot && fee > 0 && economyHooks) {
        const lacking = rm.players.filter((p) => !p.isBot && !economyHooks.canAffordGold(p.nickname, fee));
        if (lacking.length > 0) {
          const names = lacking.map((p) => p.nickname).join(', ');
          const errMsg = `[${names}]님의 스타가 입장비(${fee.toLocaleString()} 스타)보다 부족하여 시작할 수 없습니다.`;
          rm.resultMessage = `⚠️ ${errMsg}`;
          emitRoomState(rm);
          if (cb) cb({ ok: false, error: errMsg });
          return;
        }
        rm.players.forEach((p) => {
          if (!p.isBot) {
            economyHooks.addUserGold(p.nickname, -fee, 'minigame_entry_fee');
            economyHooks.recordDailyActivity(p.nickname, { play: 1 });
          }
        });
        rm.prizePool = fee * 2;
      } else {
        rm.prizePool = 0;
        rm.players.forEach((p) => {
          if (!p.isBot && economyHooks) {
            economyHooks.recordDailyActivity(p.nickname, { play: 1 });
          }
        });
      }
      initGameState(rm);
      emitRoomState(rm);
      emitRoomsList(rm.gameType);
      if (cb) cb({ ok: true });
      if (rm.gameType !== 'russian-roulette' && rm.gameType !== 'dice-21' && rm.gameType !== 'black-white') runBotTurnIfNeeded(rm);
    });

    socket.on('mg_action', ({ roomId, clientId, action, value } = {}) => {
      const rm = mgRooms.find((r) => r.id === roomId);
      if (!rm || rm.status !== 'PLAYING') return;
      const pIdx = rm.players.findIndex((p) => p.clientId === clientId);
      if (pIdx < 0) return;
      rm.lastActivityAt = Date.now();
      if (rm.gameType === 'black-white' && action === 'PICK_TILE') {
        handleBlackWhitePick(rm, pIdx, value);
      } else if (rm.gameType === 'russian-roulette') {
        handleRussianAction(rm, pIdx, action);
      } else if (rm.gameType === 'dice-21') {
        handleDiceAction(rm, pIdx, action);
      }
    });

    socket.on('mg_leave_room', ({ roomId, clientId } = {}) => {
      const rm = mgRooms.find((r) => r.id === roomId);
      if (!rm) return;
      socket.leave(rm.id);
      const leavingIdx = rm.players.findIndex((p) => p.clientId === clientId);
      // 게임 진행 중 플레이어가 나가면 즉시 기권패 처리 및 상대방에게 상금 지급!
      if (rm.status === 'PLAYING' && leavingIdx >= 0 && rm.players.length === 2) {
        const winnerIdx = 1 - leavingIdx;
        const leaverName = rm.players[leavingIdx]?.nickname || '상대방';
        const winnerName = rm.players[winnerIdx]?.nickname || '플레이어';
        finishGame(rm, winnerIdx, false, `🏳️ ${leaverName}님 중도 퇴장(기권패)! 🏆 ${winnerName}님 기권승!`);
      }
      if (rm.hostClientId === clientId) {
        mgRooms = mgRooms.filter((r) => r.id !== rm.id);
        nsp.to(rm.id).emit('mg_room_deleted', { roomId: rm.id, title: rm.title });
        emitRoomsList(rm.gameType);
        return;
      }
      rm.players = rm.players.filter((p) => p.clientId !== clientId);
      rm.spectators = rm.spectators.filter((s) => s.clientId !== clientId);
      if (rm.players.length < 2 && rm.status !== 'WAITING') {
        rm.status = 'WAITING';
        rm.game = null;
      }
      emitRoomState(rm);
      emitRoomsList(rm.gameType);
    });

    socket.on('mg_delete_room', ({ roomId, clientId, isGlobalAdmin } = {}) => {
      const rm = mgRooms.find((r) => r.id === roomId);
      if (!rm) return;
      if (!isGlobalAdmin && rm.hostClientId !== clientId) return;
      if (rm.status === 'PLAYING' && rm.players.length === 2 && !isGlobalAdmin) {
        const hostIdx = rm.players.findIndex((p) => p.clientId === rm.hostClientId);
        const guestIdx = hostIdx === 0 ? 1 : 0;
        const guest = rm.players[guestIdx];
        if (guest && !guest.isBot) {
          finishGame(rm, guestIdx, false, `🏳️ 방장 방 삭제로 인한 기권패! 🏆 ${guest.nickname}님 기권승!`);
        }
      }
      mgRooms = mgRooms.filter((r) => r.id !== rm.id);
      nsp.to(rm.id).emit('mg_room_deleted', { roomId: rm.id, title: rm.title });
      emitRoomsList(rm.gameType);
    });
  });

  // Idle cleanup (every 30s)
  setInterval(() => {
    const mins = Math.max(1, Number(globalServerSettings?.idleRoomTimeoutMinutes || 15));
    const cutoff = Date.now() - mins * 60 * 1000;
    const before = mgRooms.length;
    const expired = mgRooms.filter((r) => (r.lastActivityAt || r.createdAt) < cutoff);
    if (expired.length > 0) {
      mgRooms = mgRooms.filter((r) => (r.lastActivityAt || r.createdAt) >= cutoff);
      expired.forEach((rm) => {
        nsp.to(rm.id).emit('mg_room_deleted', { roomId: rm.id, title: rm.title });
        emitRoomsList(rm.gameType);
      });
    }
  }, 30000);

  return {
    getMinigameRoomsSummary: () => getRoomSummaryList(null),
    getMinigameRoomsJoinedBy: (cid, nick) => {
      const nLow = String(nick || '').trim().toLowerCase();
      return mgRooms
        .filter((r) => r.players.some((p) => !p.isBot && ((cid && p.clientId === cid) || (nLow && p.nickname.toLowerCase() === nLow))))
        .map((r) => ({ id: r.id, gameType: r.gameType, title: r.title, hostClientId: r.hostClientId, hostNickname: r.hostNickname, count: r.players.length }));
    },
    removeUserFromMinigames: (cid, nick, exceptRoomId = null) => {
      const nLow = String(nick || '').trim().toLowerCase();
      const typesChanged = new Set();
      mgRooms.forEach((rm) => {
        if (exceptRoomId && rm.id === exceptRoomId) return;
        const before = rm.players.length;
        rm.players = rm.players.filter((p) => p.isBot || !((cid && p.clientId === cid) || (nLow && p.nickname.toLowerCase() === nLow)));
        if (rm.players.length !== before) {
          emitRoomState(rm);
          typesChanged.add(rm.gameType);
        }
      });
      typesChanged.forEach((gt) => emitRoomsList(gt));
    },
    deleteMinigameRoomById: (roomId) => {
      const rm = mgRooms.find((r) => r.id === roomId);
      if (!rm) return false;
      mgRooms = mgRooms.filter((r) => r.id !== roomId);
      nsp.to(rm.id).emit('mg_room_deleted', { roomId: rm.id, title: rm.title });
      emitRoomsList(rm.gameType);
      return true;
    }
  };
}

module.exports = { setupMinigamesSocket };
