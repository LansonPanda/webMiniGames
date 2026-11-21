// 🃏 로얄 블랙잭 (멀티플레이어 카지노 블랙잭 · 6덱 · 히트/스탠드/더블다운/스플릿/서렌더) - /blackjack 네임스페이스
module.exports = function setupBlackjackSocket(io, deps) {
  const {
    usersDB,
    saveUsersDB,
    globalServerSettings,
    economyHooks,
    removeUserFromOtherGames,
    findUserExistingRoom
  } = deps;

  const nsp = io.of('/blackjack');
  let bjRooms = [];

  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

  function createShoe(numDecks = 6) {
    const shoe = [];
    for (let d = 0; d < numDecks; d++) {
      for (const suit of SUITS) {
        for (const rank of RANKS) {
          shoe.push({ suit, rank });
        }
      }
    }
    for (let i = shoe.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
    }
    return shoe;
  }

  function cardRankValue(rank) {
    if (rank === 'A') return 11;
    if (['K', 'Q', 'J', '10'].includes(rank)) return 10;
    return Number(rank) || 0;
  }

  function evaluateHand(cards) {
    let total = 0;
    let aces = 0;
    for (const c of cards) {
      if (c.rank === 'A') aces++;
      total += cardRankValue(c.rank);
    }
    while (total > 21 && aces > 0) {
      total -= 10;
      aces--;
    }
    const isSoft = aces > 0 && total <= 21;
    const isBust = total > 21;
    const isNatural = cards.length === 2 && total === 21;
    return { total, isSoft, isBust, isNatural };
  }

  function recordBlackjackStat(nickname, won) {
    if (!nickname) return;
    const u = usersDB.find((x) => x.nickname.toLowerCase() === String(nickname).toLowerCase());
    if (!u) return;
    if (!u.game_data) u.game_data = {};
    if (!u.game_data.stats) u.game_data.stats = {};
    if (!u.game_data.stats.blackjack) u.game_data.stats.blackjack = { plays: 0, wins: 0 };
    u.game_data.stats.blackjack.plays += 1;
    if (won) u.game_data.stats.blackjack.wins += 1;
    u.updated_at = new Date().toISOString();
    saveUsersDB(usersDB);
  }

  function getRoomSummaryList() {
    return bjRooms.map((r) => ({
      id: r.id,
      title: r.title,
      hostClientId: r.hostClientId,
      hostNickname: r.hostNickname,
      hasPassword: Boolean(r.password),
      maxPlayers: r.maxPlayers || 6,
      startingChips: r.startingChips || 3000,
      totalRounds: r.totalRounds || 0,
      bettingDurationSec: r.bettingDurationSec || 20,
      status: r.status,
      round: r.round,
      playerIds: r.players.map((p) => p.clientId),
      count: r.players.length,
      spectatorCount: r.spectators.length
    }));
  }

  function sanitizeRoom(rm) {
    const hideDealerHole = rm.status === 'DEALING' || rm.status === 'PLAYER_TURN';
    const dealerVisibleCards = rm.dealerCards.map((c, idx) =>
      hideDealerHole && idx === 1 ? { suit: '?', rank: '?', hidden: true } : c
    );
    const dealerEval = hideDealerHole
      ? evaluateHand(rm.dealerCards.slice(0, 1))
      : evaluateHand(rm.dealerCards);

    return {
      id: rm.id,
      title: rm.title,
      hostClientId: rm.hostClientId,
      hostNickname: rm.hostNickname,
      hasPassword: Boolean(rm.password),
      maxPlayers: rm.maxPlayers || 6,
      startingChips: rm.startingChips || 3000,
      totalRounds: rm.totalRounds || 0,
      bettingDurationSec: rm.bettingDurationSec || 20,
      phaseEndsAt: rm.phaseEndsAt || null,
      status: rm.status,
      round: rm.round,
      shoeRemaining: rm.shoe.length,
      activePlayerIndex: rm.activePlayerIndex,
      dealer: {
        cards: dealerVisibleCards,
        total: dealerEval.total,
        isSoft: dealerEval.isSoft,
        isBust: dealerEval.isBust,
        isNatural: !hideDealerHole && dealerEval.isNatural,
        holeHidden: hideDealerHole
      },
      players: rm.players.map((p) => {
        if (economyHooks) p.chips = economyHooks.getUserGold(p.nickname);
        return {
          clientId: p.clientId,
          nickname: p.nickname,
          chips: p.chips,
          cosmetics: economyHooks ? economyHooks.getUserCosmetics(p.nickname) : {},
          pendingBet: p.pendingBet,
          betConfirmed: p.betConfirmed,
          activeHandIndex: p.activeHandIndex,
        hands: p.hands.map((h) => {
          const ev = evaluateHand(h.cards);
          return {
            cards: h.cards,
            bet: h.bet,
            total: ev.total,
            isSoft: ev.isSoft,
            isBust: ev.isBust,
            isNatural: ev.isNatural && !h.fromSplit,
            stood: h.stood,
            doubled: h.doubled,
            surrendered: h.surrendered,
            fromSplit: Boolean(h.fromSplit),
            result: h.result || null,
            payout: h.payout || 0,
            net: h.net || 0
          };
        })
      };
      }),
      spectators: rm.spectators.map((s) => ({ clientId: s.clientId, nickname: s.nickname })),
      tableLog: rm.tableLog || '',
      finalStandings: rm.finalStandings || null
    };
  }

  function emitRoom(rm) {
    nsp.to(rm.id).emit('bj_room_state', sanitizeRoom(rm));
  }

  function emitRooms() {
    nsp.emit('bj_rooms_updated', getRoomSummaryList());
  }

  function clearRoomTimers(rm) {
    if (rm.phaseTimer) {
      clearTimeout(rm.phaseTimer);
      rm.phaseTimer = null;
    }
    if (rm.dealerStepTimer) {
      clearTimeout(rm.dealerStepTimer);
      rm.dealerStepTimer = null;
    }
    rm.phaseEndsAt = null;
  }

  function drawCard(rm) {
    if (rm.shoe.length < 36) {
      rm.shoe = createShoe(6);
      rm.tableLog = '🃏 슈 카드가 적어 6덱(312장)을 새로 셔플했습니다.';
    }
    return rm.shoe.pop();
  }

  function startBettingPhase(rm) {
    clearRoomTimers(rm);
    rm.round += 1;
    rm.status = 'BETTING';
    rm.dealerCards = [];
    rm.activePlayerIndex = -1;
    rm.finalStandings = null;

    rm.players.forEach((p) => {
      if (economyHooks) p.chips = economyHooks.getUserGold(p.nickname);
      p.pendingBet = p.chips >= 10000 ? Math.max(10000, Math.min(p.pendingBet || 10000, p.chips)) : p.chips;
      p.betConfirmed = false;
      p.hands = [];
      p.activeHandIndex = 0;
    });

    const sec = rm.bettingDurationSec || 20;
    if (sec > 0) {
      rm.phaseEndsAt = Date.now() + sec * 1000;
      rm.phaseTimer = setTimeout(() => {
        if (!bjRooms.includes(rm) || rm.status !== 'BETTING') return;
        rm.players.forEach((p) => {
          if (!p.betConfirmed) p.betConfirmed = true;
        });
        dealInitialCards(rm);
      }, sec * 1000);
    } else {
      rm.phaseEndsAt = null;
    }

    rm.tableLog = `⭐ ${rm.round}라운드 배팅 시작! 칩을 걸고 [배팅 확정]을 눌러주세요.`;
    emitRoom(rm);
    emitRooms();
  }

  function dealInitialCards(rm) {
    clearRoomTimers(rm);
    rm.players.forEach((p) => {
      if (economyHooks) p.chips = economyHooks.getUserGold(p.nickname);
    });
    const activeBettors = rm.players.filter((p) => p.pendingBet > 0 && p.chips >= p.pendingBet);
    if (activeBettors.length === 0) {
      rm.tableLog = '⚠️ 배팅한 플레이어가 없거나 보유 스타가 부족하여 배팅을 다시 진행합니다.';
      rm.round = Math.max(0, rm.round - 1);
      startBettingPhase(rm);
      return;
    }

    rm.status = 'DEALING';
    rm.dealerCards = [drawCard(rm), drawCard(rm)];
    rm.players.forEach((p) => {
      if (p.pendingBet > 0 && p.chips >= p.pendingBet) {
        if (economyHooks) {
          p.chips = economyHooks.addUserGold(p.nickname, -p.pendingBet, 'bj_bet');
          economyHooks.recordDailyActivity(p.nickname, { play: 1 });
        } else {
          p.chips -= p.pendingBet;
        }
        const c1 = drawCard(rm);
        const c2 = drawCard(rm);
        p.hands = [{
          cards: [c1, c2],
          bet: p.pendingBet,
          stood: false,
          doubled: false,
          surrendered: false,
          fromSplit: false,
          result: null,
          payout: 0,
          net: 0
        }];
        p.activeHandIndex = 0;
      } else {
        p.hands = [];
      }
    });

    const dealerEval = evaluateHand(rm.dealerCards);
    if (dealerEval.isNatural) {
      rm.tableLog = '🃏 딜러 블랙잭! 즉시 결과를 정산합니다.';
      settleRound(rm);
      return;
    }

    // Check players for natural blackjack (auto-stand them)
    rm.players.forEach((p) => {
      if (p.hands.length > 0) {
        const ev = evaluateHand(p.hands[0].cards);
        if (ev.isNatural) {
          p.hands[0].stood = true;
        }
      }
    });

    rm.status = 'PLAYER_TURN';
    advanceToNextPlayableTurn(rm, 0, 0);
  }

  function setTurnTimer(rm) {
    clearRoomTimers(rm);
    rm.phaseEndsAt = Date.now() + 25000;
    rm.phaseTimer = setTimeout(() => {
      if (!bjRooms.includes(rm) || rm.status !== 'PLAYER_TURN') return;
      const p = rm.players[rm.activePlayerIndex];
      if (!p) return;
      const h = p.hands[p.activeHandIndex];
      if (h && !h.stood && !h.surrendered) {
        h.stood = true;
        rm.tableLog = `⏱️ ${p.nickname}님 시간 초과 → 자동 스탠드!`;
        advanceToNextPlayableTurn(rm, rm.activePlayerIndex, p.activeHandIndex + 1);
      }
    }, 25000);
  }

  function advanceToNextPlayableTurn(rm, startPlayerIdx, startHandIdx) {
    for (let pi = startPlayerIdx; pi < rm.players.length; pi++) {
      const p = rm.players[pi];
      const hStart = (pi === startPlayerIdx) ? startHandIdx : 0;
      for (let hi = hStart; hi < p.hands.length; hi++) {
        const h = p.hands[hi];
        const ev = evaluateHand(h.cards);
        if (!h.stood && !h.surrendered && !ev.isBust && ev.total < 21) {
          rm.activePlayerIndex = pi;
          p.activeHandIndex = hi;
          rm.tableLog = `🎯 [${p.nickname}]님 차례입니다. (현재 ${ev.total}${ev.isSoft ? ' Soft' : ''})`;
          setTurnTimer(rm);
          emitRoom(rm);
          return;
        }
        if (ev.total === 21 && !h.stood) {
          h.stood = true;
        }
      }
    }

    // All players finished -> Dealer turn!
    rm.activePlayerIndex = -1;
    clearRoomTimers(rm);
    runDealerTurn(rm);
  }

  function runDealerTurn(rm) {
    const anyAlive = rm.players.some((p) =>
      p.hands.some((h) => {
        const ev = evaluateHand(h.cards);
        return !h.surrendered && !ev.isBust && !(ev.isNatural && !h.fromSplit);
      })
    );

    rm.status = 'DEALER_TURN';
    if (!anyAlive) {
      rm.tableLog = '🃏 딜러 홀카드 공개 후 정산합니다.';
      emitRoom(rm);
      rm.dealerStepTimer = setTimeout(() => {
        if (!bjRooms.includes(rm) || rm.status !== 'DEALER_TURN') return;
        settleRound(rm);
      }, 800);
      return;
    }

    const dEval = evaluateHand(rm.dealerCards);
    rm.tableLog = `🃏 딜러 홀카드 공개! (현재 ${dEval.total})`;
    emitRoom(rm);

    const stepDealer = () => {
      if (!bjRooms.includes(rm) || rm.status !== 'DEALER_TURN') return;
      const ev = evaluateHand(rm.dealerCards);
      if (ev.total < 17) {
        const card = drawCard(rm);
        rm.dealerCards.push(card);
        const nextEv = evaluateHand(rm.dealerCards);
        rm.tableLog = nextEv.isBust
          ? `💥 딜러 [${card.suit}${card.rank}] → ${nextEv.total} 버스트!`
          : `🃏 딜러 [${card.suit}${card.rank}] 히트 → ${nextEv.total}`;
        emitRoom(rm);
        rm.dealerStepTimer = setTimeout(stepDealer, 750);
      } else {
        rm.tableLog = `🛑 딜러 ${ev.total}점으로 스탠드!`;
        emitRoom(rm);
        rm.dealerStepTimer = setTimeout(() => {
          if (!bjRooms.includes(rm) || rm.status !== 'DEALER_TURN') return;
          settleRound(rm);
        }, 700);
      }
    };

    rm.dealerStepTimer = setTimeout(stepDealer, 750);
  }

  function settleRound(rm) {
    clearRoomTimers(rm);
    const dEval = evaluateHand(rm.dealerCards);

    rm.players.forEach((p) => {
      let playerWonAny = false;
      p.hands.forEach((h) => {
        const ev = evaluateHand(h.cards);
        const isNat = ev.isNatural && !h.fromSplit;
        let payout = 0;
        let result = 'LOSE';

        if (h.surrendered) {
          payout = Math.floor(h.bet * 0.5);
          result = 'SURRENDER';
        } else if (ev.isBust) {
          payout = 0;
          result = 'BUST';
        } else if (isNat && !dEval.isNatural) {
          payout = Math.floor(h.bet * 2.5); // 1.5x profit + original bet
          result = 'BLACKJACK';
          playerWonAny = true;
        } else if (dEval.isNatural && !isNat) {
          payout = 0;
          result = 'LOSE';
        } else if (isNat && dEval.isNatural) {
          payout = h.bet;
          result = 'PUSH';
        } else if (dEval.isBust) {
          payout = h.bet * 2;
          result = 'WIN';
          playerWonAny = true;
        } else if (ev.total > dEval.total) {
          payout = h.bet * 2;
          result = 'WIN';
          playerWonAny = true;
        } else if (ev.total === dEval.total) {
          payout = h.bet;
          result = 'PUSH';
        } else {
          payout = 0;
          result = 'LOSE';
        }

        h.payout = payout;
        h.net = payout - h.bet;
        h.result = result;
        if (economyHooks) {
          if (payout > 0) {
            p.chips = economyHooks.addUserGold(p.nickname, payout, 'bj_payout');
          } else {
            p.chips = economyHooks.getUserGold(p.nickname);
          }
        } else {
          p.chips += payout;
        }
      });

      if (p.hands.length > 0) {
        recordBlackjackStat(p.nickname, playerWonAny);
        if (playerWonAny && economyHooks) {
          economyHooks.recordDailyActivity(p.nickname, { mainWin: 1 });
        }
      }
    });

    if (rm.totalRounds > 0 && rm.round >= rm.totalRounds) {
      rm.status = 'GAME_OVER';
      rm.finalStandings = [...rm.players]
        .sort((a, b) => b.chips - a.chips)
        .map((p, idx) => ({ rank: idx + 1, nickname: p.nickname, chips: p.chips }));
      rm.tableLog = `🏆 ${rm.totalRounds}라운드 종료! 최종 우승: ${rm.finalStandings[0]?.nickname || '-'}`;
    } else {
      rm.status = 'SETTLED';
      rm.tableLog = dEval.isBust
        ? `🎉 딜러 버스트(${dEval.total})! 생존 플레이어 전원 승리!`
        : `🏁 ${rm.round}라운드 정산 완료! (딜러 ${dEval.total}점)`;
    }
    emitRoom(rm);
    emitRooms();
  }

  nsp.on('connection', (socket) => {
    socket.on('bj_list_rooms', () => {
      socket.emit('bj_rooms_updated', getRoomSummaryList());
    });

    socket.on('bj_create_room', ({ title, clientId, nickname, password, maxPlayers, startingChips, totalRounds, bettingDurationSec } = {}, cb) => {
      try {
      const rawPw = String(password || '').trim();
      if (rawPw && !/^\d{4}$/.test(rawPw)) {
        return cb && cb({ ok: false, error: '비밀번호는 숫자 4자리여야 합니다.' });
      }
      if (globalServerSettings?.enforceOneRoomPerAccount && clientId) {
        const existing = (typeof findUserExistingRoom === 'function' ? findUserExistingRoom(clientId, nickname) : null) || bjRooms.find((r) => r.hostClientId === clientId);
        if (existing) {
          const label = existing.gameLabel ? ` (${existing.gameLabel})` : '';
          const roleTxt = existing.role === 'player' ? '입장 중인' : '생성한';
          return cb && cb({ ok: false, error: `이미 ${roleTxt} 방 [${existing.title}]${label}이 있습니다. 기존 방에서 나가거나 삭제한 후 이용해주세요.` });
        }
      }
      if (typeof removeUserFromOtherGames === 'function') {
        removeUserFromOtherGames(clientId, nickname, 'blackjack', null);
      }

      const id = `bj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const cleanNick = String(nickname || '방장').trim().slice(0, 16);
      const cleanTitle = (String(title || '').trim() || `${cleanNick}님의 방`).slice(0, 24);
      const initChips = [1000, 3000, 5000, 10000].includes(Number(startingChips)) ? Number(startingChips) : 3000;
      const roundsLimit = [0, 5, 10].includes(Number(totalRounds)) ? Number(totalRounds) : 0;
      const betSec = [0, 15, 20, 30].includes(Number(bettingDurationSec)) ? Number(bettingDurationSec) : 20;
      const maxP = Math.max(2, Math.min(6, Number(maxPlayers) || 6));

      const rm = {
        id,
        title: cleanTitle,
        hostClientId: clientId || socket.id,
        hostNickname: cleanNick,
        password: rawPw,
        maxPlayers: maxP,
        startingChips: initChips,
        totalRounds: roundsLimit,
        bettingDurationSec: betSec,
        status: 'WAITING',
        round: 0,
        shoe: createShoe(6),
        dealerCards: [],
        activePlayerIndex: -1,
        players: [{
          clientId: clientId || socket.id,
          nickname: cleanNick,
          socketId: socket.id,
          chips: economyHooks ? economyHooks.getUserGold(cleanNick) : initChips,
          pendingBet: Math.min(10000, economyHooks ? economyHooks.getUserGold(cleanNick) : initChips),
          betConfirmed: false,
          hands: [],
          activeHandIndex: 0
        }],
        spectators: [],
        tableLog: '🃏 방장이 게임을 시작하기를 기다리고 있습니다.',
        finalStandings: null,
        phaseTimer: null,
        dealerStepTimer: null,
        phaseEndsAt: null,
        createdAt: Date.now(),
        lastActivityAt: Date.now()
      };

      bjRooms.unshift(rm);
      socket.join(id);
      emitRoom(rm);
      emitRooms();
      if (cb) cb({ ok: true, room: sanitizeRoom(rm) });
      } catch (err) {
        console.error('[bj_create_room error]', err);
        if (cb) cb({ ok: false, error: '블랙잭 방 생성 오류: ' + (err && err.message ? err.message : '알 수 없는 오류') });
      }
    });

    socket.on('bj_join_room', ({ roomId, clientId, nickname, password, mode } = {}, cb) => {
      const rm = bjRooms.find((r) => r.id === roomId);
      if (!rm) return cb && cb({ ok: false, error: '방을 찾을 수 없습니다.' });
      const isHost = rm.hostClientId === clientId;
      if (mode !== 'spectate' && globalServerSettings?.enforceOneRoomPerAccount && typeof findUserExistingRoom === 'function') {
        const conflict = findUserExistingRoom(clientId, nickname, 'blackjack', rm.id);
        if (conflict) {
          const roleTxt = conflict.role === 'player' ? '입장 중인' : '생성한';
          return cb && cb({ ok: false, error: `이미 ${roleTxt} 방 [${conflict.title}] (${conflict.gameLabel})이 있습니다. 기존 방에서 나가거나 삭제한 후 이용해주세요.` });
        }
      }
      if (rm.password && !isHost && String(password || '') !== rm.password) {
        return cb && cb({ ok: false, error: '방 비밀번호(숫자 4자리)가 일치하지 않습니다.' });
      }
      if (typeof removeUserFromOtherGames === 'function') {
        removeUserFromOtherGames(clientId, nickname, 'blackjack', rm.id);
      }

      rm.lastActivityAt = Date.now();
      socket.join(rm.id);
      const cleanNick = String(nickname || '유저').trim().slice(0, 16);

      const already = rm.players.find((p) => p.clientId === clientId);
      if (already) {
        already.socketId = socket.id;
        already.nickname = cleanNick;
      } else if (mode !== 'spectate' && rm.players.length < (rm.maxPlayers || 6)) {
        rm.spectators = rm.spectators.filter((s) => s.clientId !== clientId);
        const uGold = economyHooks ? economyHooks.getUserGold(cleanNick) : rm.startingChips;
        rm.players.push({
          clientId,
          nickname: cleanNick,
          socketId: socket.id,
          chips: uGold,
          pendingBet: Math.min(10000, uGold),
          betConfirmed: false,
          hands: [],
          activeHandIndex: 0
        });
      } else {
        if (!rm.spectators.some((s) => s.clientId === clientId)) {
          rm.spectators.push({ clientId, nickname: cleanNick, socketId: socket.id });
        }
      }
      emitRoom(rm);
      emitRooms();
      if (cb) cb({ ok: true, room: sanitizeRoom(rm) });
    });

    socket.on('bj_start_round', ({ roomId, clientId } = {}) => {
      const rm = bjRooms.find((r) => r.id === roomId);
      if (!rm || rm.hostClientId !== clientId) return;
      if (rm.status !== 'WAITING' && rm.status !== 'SETTLED' && rm.status !== 'GAME_OVER') return;
      if (rm.status === 'GAME_OVER') {
        rm.round = 0;
        rm.players.forEach((p) => {
          const g = economyHooks ? economyHooks.getUserGold(p.nickname) : p.chips;
          p.chips = g;
          p.pendingBet = Math.min(10000, g);
        });
      }
      rm.lastActivityAt = Date.now();
      startBettingPhase(rm);
    });

    socket.on('bj_set_bet', ({ roomId, clientId, amount } = {}) => {
      const rm = bjRooms.find((r) => r.id === roomId);
      if (!rm || rm.status !== 'BETTING') return;
      const p = rm.players.find((x) => x.clientId === clientId);
      if (!p || p.betConfirmed) return;
      if (economyHooks) p.chips = economyHooks.getUserGold(p.nickname);
      const amt = Math.max(0, Math.min(p.chips, Math.floor(Number(amount) || 0)));
      p.pendingBet = amt;
      rm.lastActivityAt = Date.now();
      emitRoom(rm);
    });

    socket.on('bj_confirm_bet', ({ roomId, clientId } = {}) => {
      const rm = bjRooms.find((r) => r.id === roomId);
      if (!rm || rm.status !== 'BETTING') return;
      const p = rm.players.find((x) => x.clientId === clientId);
      if (!p) return;
      if (economyHooks) p.chips = economyHooks.getUserGold(p.nickname);
      if (p.pendingBet > 0 && p.chips >= 10000 && p.pendingBet < 10000) {
        p.pendingBet = 10000;
      }
      p.betConfirmed = true;
      rm.lastActivityAt = Date.now();
      if (rm.players.every((x) => x.betConfirmed)) {
        dealInitialCards(rm);
      } else {
        emitRoom(rm);
      }
    });

    socket.on('bj_rebuy', ({ roomId, clientId } = {}) => {
      const rm = bjRooms.find((r) => r.id === roomId);
      if (!rm || (rm.status !== 'BETTING' && rm.status !== 'SETTLED' && rm.status !== 'WAITING')) return;
      const p = rm.players.find((x) => x.clientId === clientId);
      if (!p) return;
      if (economyHooks) p.chips = economyHooks.getUserGold(p.nickname);
      if (p.chips >= 100) return;
      const u = usersDB.find((x) => x.nickname.toLowerCase() === p.nickname.toLowerCase());
      const eco = u && u.game_data && u.game_data.economy;
      if (eco && (eco.bailoutCount || 0) >= 3) {
        rm.tableLog = `⚠️ ${p.nickname}님 오늘 파산 구제금(일일 3회)을 모두 사용했습니다. 일일 미션 보상을 확인해보세요!`;
        emitRoom(rm);
        return;
      }
      if (eco) eco.bailoutCount = (eco.bailoutCount || 0) + 1;
      p.chips = economyHooks ? economyHooks.addUserGold(p.nickname, 300, 'bj_bailout') : (p.chips + 300);
      p.pendingBet = Math.min(100, p.chips);
      rm.tableLog = `🛟 ${p.nickname}님이 파산 구제금 +300 스타를 지원받았습니다!`;
      emitRoom(rm);
    });

    socket.on('bj_action', ({ roomId, clientId, action } = {}) => {
      const rm = bjRooms.find((r) => r.id === roomId);
      if (!rm || rm.status !== 'PLAYER_TURN') return;
      const pIdx = rm.activePlayerIndex;
      const p = rm.players[pIdx];
      if (!p || p.clientId !== clientId) return;
      const hi = p.activeHandIndex;
      const h = p.hands[hi];
      if (!h || h.stood || h.surrendered) return;
      rm.lastActivityAt = Date.now();

      if (action === 'HIT') {
        const card = drawCard(rm);
        h.cards.push(card);
        const ev = evaluateHand(h.cards);
        if (ev.isBust) {
          rm.tableLog = `💥 ${p.nickname}님 [${card.suit}${card.rank}] → ${ev.total} 버스트!`;
          advanceToNextPlayableTurn(rm, pIdx, hi + 1);
        } else if (ev.total === 21) {
          h.stood = true;
          rm.tableLog = `🔥 ${p.nickname}님 [${card.suit}${card.rank}] → 21 달성!`;
          advanceToNextPlayableTurn(rm, pIdx, hi + 1);
        } else {
          rm.tableLog = `🃏 ${p.nickname}님 히트 [${card.suit}${card.rank}] → ${ev.total}`;
          setTurnTimer(rm);
          emitRoom(rm);
        }
      } else if (action === 'STAND') {
        h.stood = true;
        const ev = evaluateHand(h.cards);
        rm.tableLog = `✋ ${p.nickname}님 ${ev.total}점으로 스탠드`;
        advanceToNextPlayableTurn(rm, pIdx, hi + 1);
      } else if (action === 'DOUBLE') {
        if (economyHooks) p.chips = economyHooks.getUserGold(p.nickname);
        if (h.cards.length !== 2 || p.chips < h.bet) return;
        p.chips = economyHooks ? economyHooks.addUserGold(p.nickname, -h.bet, 'bj_double') : (p.chips - h.bet);
        h.bet *= 2;
        h.doubled = true;
        const card = drawCard(rm);
        h.cards.push(card);
        h.stood = true;
        const ev = evaluateHand(h.cards);
        rm.tableLog = ev.isBust
          ? `⚡ ${p.nickname}님 더블 다운 [${card.suit}${card.rank}] → ${ev.total} 버스트!`
          : `⚡ ${p.nickname}님 더블 다운 [${card.suit}${card.rank}] → ${ev.total}점 스탠드!`;
        advanceToNextPlayableTurn(rm, pIdx, hi + 1);
      } else if (action === 'SPLIT') {
        if (economyHooks) p.chips = economyHooks.getUserGold(p.nickname);
        if (h.cards.length !== 2 || p.hands.length >= 2 || p.chips < h.bet) return;
        const v1 = cardRankValue(h.cards[0].rank);
        const v2 = cardRankValue(h.cards[1].rank);
        if (v1 !== v2) return;
        p.chips = economyHooks ? economyHooks.addUserGold(p.nickname, -h.bet, 'bj_split') : (p.chips - h.bet);
        const cA = h.cards[0];
        const cB = h.cards[1];
        const newH1 = {
          cards: [cA, drawCard(rm)],
          bet: h.bet,
          stood: false,
          doubled: false,
          surrendered: false,
          fromSplit: true,
          result: null,
          payout: 0,
          net: 0
        };
        const newH2 = {
          cards: [cB, drawCard(rm)],
          bet: h.bet,
          stood: false,
          doubled: false,
          surrendered: false,
          fromSplit: true,
          result: null,
          payout: 0,
          net: 0
        };
        p.hands = [newH1, newH2];
        p.activeHandIndex = 0;
        rm.tableLog = `✂️ ${p.nickname}님 스플릿! 핸드 2개로 플레이합니다.`;
        setTurnTimer(rm);
        emitRoom(rm);
      } else if (action === 'SURRENDER') {
        if (h.cards.length !== 2 || h.fromSplit) return;
        h.surrendered = true;
        rm.tableLog = `🏳️ ${p.nickname}님 서렌더 (배팅액 50% 반환)`;
        advanceToNextPlayableTurn(rm, pIdx, hi + 1);
      }
    });

    socket.on('bj_leave_room', ({ roomId, clientId } = {}) => {
      const rm = bjRooms.find((r) => r.id === roomId);
      if (!rm) return;
      socket.leave(rm.id);
      if (rm.hostClientId === clientId) {
        clearRoomTimers(rm);
        if ((rm.status === 'DEALING' || rm.status === 'PLAYER_TURN' || rm.status === 'DEALER_TURN') && economyHooks) {
          rm.players.forEach((p) => {
            if (p.clientId !== clientId && Array.isArray(p.hands)) {
              const totalBet = p.hands.reduce((s, h) => s + (h.bet || 0), 0);
              if (totalBet > 0) economyHooks.addUserGold(p.nickname, totalBet, 'bj_host_abort_refund');
            }
          });
        }
        bjRooms = bjRooms.filter((r) => r.id !== rm.id);
        nsp.to(rm.id).emit('bj_room_deleted', { roomId: rm.id, title: rm.title });
        emitRooms();
        return;
      }
      const leavingIdx = rm.players.findIndex((p) => p.clientId === clientId);
      rm.players = rm.players.filter((p) => p.clientId !== clientId);
      rm.spectators = rm.spectators.filter((s) => s.clientId !== clientId);
      if (rm.status === 'PLAYER_TURN' && leavingIdx >= 0) {
        if (leavingIdx < rm.activePlayerIndex) {
          rm.activePlayerIndex = Math.max(0, rm.activePlayerIndex - 1);
          emitRoom(rm);
        } else if (leavingIdx === rm.activePlayerIndex) {
          advanceToNextPlayableTurn(rm, leavingIdx, 0);
        } else {
          emitRoom(rm);
        }
      } else {
        emitRoom(rm);
      }
      emitRooms();
    });
  });

  setInterval(() => {
    const timeoutMs = (globalServerSettings?.idleRoomTimeoutMinutes || 15) * 60 * 1000;
    const now = Date.now();
    let changed = false;
    bjRooms = bjRooms.filter((rm) => {
      if (now - (rm.lastActivityAt || rm.createdAt) > timeoutMs) {
        clearRoomTimers(rm);
        nsp.to(rm.id).emit('bj_room_deleted', { roomId: rm.id, title: rm.title });
        changed = true;
        return false;
      }
      return true;
    });
    if (changed) emitRooms();
  }, 60000);

  return {
    getBlackjackRoomsSummary: getRoomSummaryList,
    getBlackjackRoomsJoinedBy: (cid, nick) => {
      const nLow = String(nick || '').trim().toLowerCase();
      return bjRooms
        .filter((r) => r.players.some((p) => (cid && p.clientId === cid) || (nLow && p.nickname.toLowerCase() === nLow)))
        .map((r) => ({ id: r.id, title: r.title, hostClientId: r.hostClientId, hostNickname: r.hostNickname, count: r.players.length }));
    },
    deleteBlackjackRoomById: (roomId) => {
      const rm = bjRooms.find((r) => r.id === roomId);
      if (!rm) return;
      clearRoomTimers(rm);
      bjRooms = bjRooms.filter((r) => r.id !== roomId);
      nsp.to(rm.id).emit('bj_room_deleted', { roomId: rm.id, title: rm.title });
      emitRooms();
    },
    removeUserFromBlackjack: (clientId, nickname) => {
      let changed = false;
      bjRooms.forEach((rm) => {
        const before = rm.players.length + rm.spectators.length;
        rm.players = rm.players.filter((p) => p.clientId !== clientId && p.nickname.toLowerCase() !== String(nickname || '').toLowerCase());
        rm.spectators = rm.spectators.filter((s) => s.clientId !== clientId);
        if (rm.players.length + rm.spectators.length !== before) {
          emitRoom(rm);
          changed = true;
        }
      });
      if (changed) emitRooms();
    }
  };
};
