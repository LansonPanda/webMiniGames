const fs = require('fs');
const path = require('path');

function setupSocialModule(app, io, deps) {
  const {
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
    isUserChatMuted,
    isTradeFrozen,
    pushAuditLog
  } = deps;

  const SOCIAL_FILE = path.join(__dirname, '..', 'social_data.json');
  const MAX_DM_PER_PAIR = 100;

  function normId(v) {
    return String(v || '').trim();
  }

  function findUserById(uid) {
    const id = normId(uid);
    if (!id) return null;
    return usersDB.find((u) => normId(u.id) === id) || null;
  }

  function resolveUserIdFromLegacyKey(key) {
    const k = normId(key);
    if (!k) return '';
    const byId = usersDB.find((u) => normId(u.id) === k);
    if (byId) return byId.id;
    const byCode = usersDB.find((u) => String(u.save_code || '').toUpperCase() === k.toUpperCase());
    return byCode ? byCode.id : k;
  }

  function makePairKey(id1, id2) {
    const a = normId(id1);
    const b = normId(id2);
    return a < b ? `${a}__${b}` : `${b}__${a}`;
  }

  function getAuthedUser(req) {
    const code = String(req.headers?.['x-save-code'] || req.body?.save_code || req.query?.save_code || '').trim();
    if (typeof findUserByValidCode === 'function') return findUserByValidCode(code);
    return null;
  }

  function loadSocialData() {
    let raw = { friendships: [], friendRequests: [], dmThreads: {}, unreadDm: {} };
    try {
      if (fs.existsSync(SOCIAL_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(SOCIAL_FILE, 'utf8'));
        raw = {
          friendships: Array.isArray(parsed.friendships) ? parsed.friendships : [],
          friendRequests: Array.isArray(parsed.friendRequests) ? parsed.friendRequests : [],
          dmThreads: (parsed.dmThreads && typeof parsed.dmThreads === 'object') ? parsed.dmThreads : {},
          unreadDm: (parsed.unreadDm && typeof parsed.unreadDm === 'object') ? parsed.unreadDm : {}
        };
      }
    } catch (_) {}

    // 🔒 기존 save_code 기반 소셜 데이터를 공개 안전 ID(user.id)로 자동 마이그레이션
    let migrated = false;
    const friendships = [];
    const seenPairs = new Set();
    for (const f of raw.friendships) {
      const aId = resolveUserIdFromLegacyKey(f.aId || f.aCode);
      const bId = resolveUserIdFromLegacyKey(f.bId || f.bCode);
      if (!aId || !bId || aId === bId) continue;
      if (f.aCode || f.bCode) migrated = true;
      const pk = makePairKey(aId, bId);
      if (seenPairs.has(pk)) continue;
      seenPairs.add(pk);
      friendships.push({ aId, bId, createdAt: f.createdAt || new Date().toISOString() });
    }

    const friendRequests = [];
    for (const r of raw.friendRequests) {
      const fromId = resolveUserIdFromLegacyKey(r.fromId || r.fromCode);
      const toId = resolveUserIdFromLegacyKey(r.toId || r.toCode);
      if (!fromId || !toId || fromId === toId) continue;
      if (r.fromCode || r.toCode) migrated = true;
      friendRequests.push({
        id: r.id,
        fromId,
        fromNick: r.fromNick || '',
        toId,
        toNick: r.toNick || '',
        createdAt: r.createdAt || new Date().toISOString()
      });
    }

    const dmThreads = {};
    for (const [k, list] of Object.entries(raw.dmThreads)) {
      if (!Array.isArray(list)) continue;
      const parts = String(k).split('__');
      const pA = resolveUserIdFromLegacyKey(parts[0]);
      const pB = resolveUserIdFromLegacyKey(parts[1]);
      if (!pA || !pB) continue;
      const nextKey = makePairKey(pA, pB);
      if (nextKey !== k) migrated = true;
      const cleanList = list.map((m) => {
        const fId = resolveUserIdFromLegacyKey(m.fromId || m.fromCode);
        const tId = resolveUserIdFromLegacyKey(m.toId || m.toCode);
        if (m.fromCode || m.toCode) migrated = true;
        return {
          id: m.id,
          fromId: fId,
          fromNick: m.fromNick || '',
          toId: tId,
          toNick: m.toNick || '',
          text: m.text || '',
          read: Boolean(m.read),
          createdAt: m.createdAt || new Date().toISOString()
        };
      });
      dmThreads[nextKey] = (dmThreads[nextKey] || []).concat(cleanList).slice(-MAX_DM_PER_PAIR);
    }

    const unreadDm = {};
    for (const [uKey, sub] of Object.entries(raw.unreadDm)) {
      const uid = resolveUserIdFromLegacyKey(uKey);
      if (!uid || !sub || typeof sub !== 'object') continue;
      if (uid !== uKey) migrated = true;
      unreadDm[uid] = unreadDm[uid] || {};
      for (const [oKey, cnt] of Object.entries(sub)) {
        const oid = resolveUserIdFromLegacyKey(oKey);
        if (!oid) continue;
        if (oid !== oKey) migrated = true;
        unreadDm[uid][oid] = Math.max(0, Number(unreadDm[uid][oid] || 0)) + Math.max(0, Number(cnt || 0));
      }
    }

    const out = { friendships, friendRequests, dmThreads, unreadDm };
    if (migrated) {
      try {
        const tmp = SOCIAL_FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(out, null, 2), 'utf8');
        fs.renameSync(tmp, SOCIAL_FILE);
      } catch (_) {}
    }
    return out;
  }

  function saveSocialData() {
    try {
      const tmp = SOCIAL_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(socialData, null, 2), 'utf8');
      fs.renameSync(tmp, SOCIAL_FILE);
    } catch (err) {
      console.error('Failed to save social_data.json:', err.message);
    }
  }

  const socialData = loadSocialData();
  const activeTrades = new Map(); // tradeId -> tradeSession

  function isFriend(id1, id2) {
    const k = makePairKey(id1, id2);
    return socialData.friendships.some((f) => makePairKey(f.aId, f.bId) === k);
  }

  function getOnlineNickSet() {
    const list = typeof getOnlineUsersList === 'function' ? getOnlineUsersList() : [];
    return new Set(list.map((x) => String((typeof x === 'string' ? x : x.nickname) || '').toLowerCase()));
  }

  // 🔒 개인 룸(user:<id>)으로만 1:1 소켓 전송 (타인에게 절대 브로드캐스트 금지!)
  function emitToUsers(userIds, eventName, payload) {
    const uniq = Array.from(new Set((userIds || []).map(normId).filter(Boolean)));
    for (const uid of uniq) {
      io.to('user:' + uid).emit(eventName, payload);
    }
  }

  function emitSocialUpdate(userIds = []) {
    emitToUsers(userIds, 'social_updated', { at: Date.now() });
  }

  function formatRodLabel(r) {
    const lv = Math.max(0, Math.floor(Number(r.level) || 0));
    const aw = Math.max(0, Math.floor(Number(r.awakening) || 0));
    const awTag = aw > 0 ? `[⚡${aw}각성] ` : '';
    const skinTag = (r.boundSkin && r.boundSkin.name) ? ` [${r.boundSkin.name}]` : '';
    const crTag = r.craftedBy ? ` (제작:${r.craftedBy})` : '';
    return `${awTag}🎣 +${lv}강 낚싯대${skinTag}${crTag}`;
  }

  function getPublicTrade(tr) {
    if (!tr) return null;
    return {
      id: tr.id,
      status: tr.status,
      fromId: tr.fromId,
      fromNick: tr.fromNick,
      toId: tr.toId,
      toNick: tr.toNick,
      offers: {
        [tr.fromId]: {
          gold: tr.offers[tr.fromId].gold,
          items: tr.offers[tr.fromId].items,
          locked: tr.offers[tr.fromId].locked,
          confirmed: tr.offers[tr.fromId].confirmed
        },
        [tr.toId]: {
          gold: tr.offers[tr.toId].gold,
          items: tr.offers[tr.toId].items,
          locked: tr.offers[tr.toId].locked,
          confirmed: tr.offers[tr.toId].confirmed
        }
      },
      createdAt: tr.createdAt,
      updatedAt: tr.updatedAt,
      cancelReason: tr.cancelReason || ''
    };
  }

  function pruneOldTrades() {
    const now = Date.now();
    for (const [id, tr] of activeTrades.entries()) {
      const age = now - (tr.updatedAt || tr.createdAt || 0);
      if ((tr.status === 'PENDING' && age > 5 * 60 * 1000) ||
          (tr.status === 'OPEN' && age > 20 * 60 * 1000) ||
          ((tr.status === 'COMPLETED' || tr.status === 'CANCELLED') && age > 3 * 60 * 1000)) {
        activeTrades.delete(id);
      }
    }
  }
  setInterval(pruneOldTrades, 60000);

  // ================= 1. 소셜 개요 (공개 userId만 반환, save_code 비노출) =================
  app.get('/api/social/overview', (req, res) => {
    const me = getAuthedUser(req);
    if (!me) return res.status(401).json({ ok: false, error: '인증 정보가 유효하지 않습니다.' });
    const myId = normId(me.id);
    const onlineSet = getOnlineNickSet();
    const myUnreadMap = socialData.unreadDm[myId] || {};

    const friends = [];
    for (const f of socialData.friendships) {
      const a = normId(f.aId);
      const b = normId(f.bId);
      if (a !== myId && b !== myId) continue;
      const otherId = a === myId ? b : a;
      const otherUser = findUserById(otherId);
      if (!otherUser) continue;
      const cos = getUserCosmetics ? getUserCosmetics(otherUser.nickname) : {};
      const online = onlineSet.has(String(otherUser.nickname || '').toLowerCase());
      const unreadDm = Math.max(0, Number(myUnreadMap[otherId] || 0));
      const pk = makePairKey(myId, otherId);
      const msgs = socialData.dmThreads[pk] || [];
      const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
      friends.push({
        userId: otherUser.id,
        nickname: otherUser.nickname,
        cosmetics: cos,
        online,
        unreadDm,
        lastMessage: lastMsg ? { text: lastMsg.text, createdAt: lastMsg.createdAt, fromNick: lastMsg.fromNick } : null
      });
    }
    friends.sort((x, y) => {
      if (y.unreadDm !== x.unreadDm) return y.unreadDm - x.unreadDm;
      if (Number(y.online) !== Number(x.online)) return Number(y.online) - Number(x.online);
      return String(x.nickname).localeCompare(String(y.nickname), 'ko');
    });

    const incomingRequests = socialData.friendRequests
      .filter((r) => normId(r.toId) === myId)
      .map((r) => {
        const u = findUserById(r.fromId);
        return {
          id: r.id,
          fromId: r.fromId,
          fromNick: u ? u.nickname : r.fromNick,
          fromCosmetics: u && getUserCosmetics ? getUserCosmetics(u.nickname) : {},
          createdAt: r.createdAt
        };
      });

    const outgoingRequests = socialData.friendRequests
      .filter((r) => normId(r.fromId) === myId)
      .map((r) => {
        const u = findUserById(r.toId);
        return { id: r.id, toId: r.toId, toNick: u ? u.nickname : r.toNick, createdAt: r.createdAt };
      });

    const myTrades = [];
    for (const tr of activeTrades.values()) {
      if ((tr.status === 'PENDING' || tr.status === 'OPEN') &&
          (tr.fromId === myId || tr.toId === myId)) {
        myTrades.push(getPublicTrade(tr));
      }
    }

    const totalUnreadDm = Object.values(myUnreadMap).reduce((acc, v) => acc + Math.max(0, Number(v || 0)), 0);
    const pendingIncomingTrades = myTrades.filter((t) => t.status === 'PENDING' && t.toId === myId).length;
    const totalBadge = incomingRequests.length + totalUnreadDm + pendingIncomingTrades;

    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      ok: true,
      myUserId: myId,
      myNickname: me.nickname,
      friends,
      incomingRequests,
      outgoingRequests,
      activeTrades: myTrades,
      totalUnreadDm,
      totalBadge
    });
  });

  // ================= 2. 유저 검색 / 친구 신청 / 수락 / 거절 / 취소 / 삭제 =================
  app.get('/api/social/users/search', (req, res) => {
    const me = getAuthedUser(req);
    if (!me) return res.status(401).json({ ok: false, error: '인증 정보가 유효하지 않습니다.' });
    const myId = normId(me.id);
    const query = String(req.query?.q || '').trim().toLowerCase();
    if (!query) return res.json({ ok: true, users: [] });
    const onlineSet = getOnlineNickSet();
    const matches = [];
    for (const u of usersDB) {
      if (!u || !u.nickname) continue;
      const uId = normId(u.id);
      if (uId === myId) continue;
      const low = String(u.nickname).toLowerCase();
      if (!low.includes(query)) continue;
      matches.push({
        userId: u.id,
        nickname: u.nickname,
        cosmetics: getUserCosmetics ? getUserCosmetics(u.nickname) : {},
        online: onlineSet.has(low),
        isFriend: isFriend(myId, uId),
        isOutgoing: socialData.friendRequests.some((r) => normId(r.fromId) === myId && normId(r.toId) === uId),
        isIncoming: socialData.friendRequests.some((r) => normId(r.fromId) === uId && normId(r.toId) === myId),
        exactScore: low === query ? 2 : (low.startsWith(query) ? 1 : 0)
      });
    }
    matches.sort((a, b) => (b.exactScore - a.exactScore) || (Number(b.online) - Number(a.online)) || String(a.nickname).localeCompare(String(b.nickname), 'ko'));
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true, users: matches.slice(0, 10) });
  });

  app.post('/api/social/friends/request', (req, res) => {
    const me = getAuthedUser(req);
    if (!me) return res.status(401).json({ ok: false, error: '인증 정보가 유효하지 않습니다.' });
    const targetName = String(req.body?.targetNickname || '').trim();
    if (!targetName) return res.status(400).json({ ok: false, error: '추가할 유저의 닉네임을 입력해주세요.' });
    const target = findUserByNickname(targetName);
    if (!target) return res.status(404).json({ ok: false, error: `'${targetName}' 유저를 찾을 수 없습니다.` });

    const myId = normId(me.id);
    const tId = normId(target.id);
    if (myId === tId) return res.status(400).json({ ok: false, error: '자기 자신은 친구로 추가할 수 없습니다.' });
    if (isFriend(myId, tId)) return res.status(400).json({ ok: false, error: '이미 친구로 등록된 유저입니다.' });

    const revIdx = socialData.friendRequests.findIndex((r) => normId(r.fromId) === tId && normId(r.toId) === myId);
    if (revIdx !== -1) {
      socialData.friendRequests.splice(revIdx, 1);
      socialData.friendships.push({ aId: myId, bId: tId, createdAt: new Date().toISOString() });
      saveSocialData();
      if (pushUserNotification) {
        pushUserNotification(target, { type: 'friend_accept', icon: '👥', title: '친구 수락 완료', message: `${me.nickname}님과 친구가 되었습니다!` }, true);
      }
      emitSocialUpdate([myId, tId]);
      return res.json({ ok: true, autoAccepted: true, message: `👥 ${target.nickname}님과 바로 친구가 되었습니다!` });
    }

    const dup = socialData.friendRequests.some((r) => normId(r.fromId) === myId && normId(r.toId) === tId);
    if (dup) return res.status(400).json({ ok: false, error: '이미 친구 신청을 보냈습니다.' });

    const reqObj = {
      id: 'fr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      fromId: myId,
      fromNick: me.nickname,
      toId: tId,
      toNick: target.nickname,
      createdAt: new Date().toISOString()
    };
    socialData.friendRequests.unshift(reqObj);
    saveSocialData();

    if (pushUserNotification) {
      pushUserNotification(target, { type: 'friend_request', icon: '👋', title: '새 친구 신청', message: `${me.nickname}님이 친구 신청을 보냈습니다. 친구 메뉴에서 수락할 수 있어요.` }, true);
    }
    emitSocialUpdate([myId, tId]);
    return res.json({ ok: true, request: reqObj, message: `👋 ${target.nickname}님에게 친구 신청을 보냈습니다!` });
  });

  app.post('/api/social/friends/respond', (req, res) => {
    const me = getAuthedUser(req);
    if (!me) return res.status(401).json({ ok: false, error: '인증 정보가 유효하지 않습니다.' });
    const { requestId, action } = req.body || {};
    const myId = normId(me.id);
    const idx = socialData.friendRequests.findIndex((r) => r.id === requestId && normId(r.toId) === myId);
    if (idx === -1) return res.status(404).json({ ok: false, error: '친구 신청을 찾을 수 없습니다.' });

    const reqObj = socialData.friendRequests.splice(idx, 1)[0];
    const fromUser = findUserById(reqObj.fromId);

    if (action === 'accept') {
      if (!isFriend(myId, reqObj.fromId)) {
        socialData.friendships.push({ aId: myId, bId: normId(reqObj.fromId), createdAt: new Date().toISOString() });
      }
      saveSocialData();
      if (fromUser && pushUserNotification) {
        pushUserNotification(fromUser, { type: 'friend_accept', icon: '👥', title: '친구 신청 수락됨', message: `${me.nickname}님이 친구 신청을 수락했습니다!` }, true);
      }
      emitSocialUpdate([myId, reqObj.fromId]);
      return res.json({ ok: true, message: `👥 ${fromUser ? fromUser.nickname : reqObj.fromNick}님과 친구가 되었습니다!` });
    } else {
      saveSocialData();
      emitSocialUpdate([myId, reqObj.fromId]);
      return res.json({ ok: true, message: '친구 신청을 거절했습니다.' });
    }
  });

  app.post('/api/social/friends/cancel', (req, res) => {
    const me = getAuthedUser(req);
    if (!me) return res.status(401).json({ ok: false, error: '인증 정보가 유효하지 않습니다.' });
    const myId = normId(me.id);
    const idx = socialData.friendRequests.findIndex((r) => r.id === req.body?.requestId && normId(r.fromId) === myId);
    if (idx === -1) return res.status(404).json({ ok: false, error: '취소할 친구 신청을 찾을 수 없습니다.' });
    const removed = socialData.friendRequests.splice(idx, 1)[0];
    saveSocialData();
    emitSocialUpdate([myId, removed.toId]);
    return res.json({ ok: true, message: `${removed.toNick}님에게 보낸 친구 신청을 취소했습니다.` });
  });

  app.post('/api/social/friends/remove', (req, res) => {
    const me = getAuthedUser(req);
    if (!me) return res.status(401).json({ ok: false, error: '인증 정보가 유효하지 않습니다.' });
    const myId = normId(me.id);
    const fId = normId(req.body?.friendId);
    const pk = makePairKey(myId, fId);
    const before = socialData.friendships.length;
    socialData.friendships = socialData.friendships.filter((f) => makePairKey(f.aId, f.bId) !== pk);
    if (socialData.friendships.length !== before) {
      saveSocialData();
      emitSocialUpdate([myId, fId]);
    }
    return res.json({ ok: true, message: '친구 목록에서 삭제되었습니다.' });
  });

  // ================= 3. 1:1 채팅 (DM · 당사자 개인 룸에만 1:1 전송) =================
  app.get('/api/social/dm/history', (req, res) => {
    const me = getAuthedUser(req);
    if (!me) return res.status(401).json({ ok: false, error: '인증 정보가 유효하지 않습니다.' });
    const myId = normId(me.id);
    const tId = normId(req.query?.targetId);
    const target = findUserById(tId);
    if (!target) return res.status(404).json({ ok: false, error: '대화 상대를 찾을 수 없습니다.' });

    const pk = makePairKey(myId, tId);
    const msgs = socialData.dmThreads[pk] || [];
    let readChanged = false;
    for (const m of msgs) {
      if (normId(m.fromId) === tId && !m.read) {
        m.read = true;
        readChanged = true;
      }
    }
    if (socialData.unreadDm[myId] && socialData.unreadDm[myId][tId]) {
      delete socialData.unreadDm[myId][tId];
      readChanged = true;
    }
    if (readChanged) {
      saveSocialData();
      emitToUsers([myId, tId], 'social_dm_read', { pairKey: pk, readerId: myId, senderId: tId });
      emitSocialUpdate([myId]);
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      ok: true,
      target: {
        userId: target.id,
        nickname: target.nickname,
        cosmetics: getUserCosmetics ? getUserCosmetics(target.nickname) : {}
      },
      messages: msgs
    });
  });

  app.post('/api/social/dm/send', (req, res) => {
    const me = getAuthedUser(req);
    if (!me) return res.status(401).json({ ok: false, error: '인증 정보가 유효하지 않습니다.' });
    if (typeof isUserChatMuted === 'function') {
      const mInfo = isUserChatMuted(me.nickname);
      if (mInfo) return res.status(403).json({ ok: false, error: `🔇 채팅 제한 중입니다. (남은 시간: 약 ${mInfo.remainMin}분)` });
    }
    const myId = normId(me.id);
    const tId = normId(req.body?.targetId);
    const target = findUserById(tId);
    if (!target) return res.status(404).json({ ok: false, error: '대화 상대를 찾을 수 없습니다.' });
    if (myId === tId) return res.status(400).json({ ok: false, error: '본인에게는 메시지를 보낼 수 없습니다.' });

    const cleanText = String(req.body?.text || '').trim().slice(0, 300);
    if (!cleanText) return res.status(400).json({ ok: false, error: '메시지를 입력해주세요.' });

    const pk = makePairKey(myId, tId);
    if (!Array.isArray(socialData.dmThreads[pk])) socialData.dmThreads[pk] = [];
    const msg = {
      id: 'dm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      fromId: myId,
      fromNick: me.nickname,
      toId: tId,
      toNick: target.nickname,
      text: cleanText,
      read: false,
      createdAt: new Date().toISOString()
    };
    socialData.dmThreads[pk].push(msg);
    if (socialData.dmThreads[pk].length > MAX_DM_PER_PAIR) {
      socialData.dmThreads[pk] = socialData.dmThreads[pk].slice(-MAX_DM_PER_PAIR);
    }
    if (!socialData.unreadDm[tId]) socialData.unreadDm[tId] = {};
    socialData.unreadDm[tId][myId] = Math.max(0, Number(socialData.unreadDm[tId][myId] || 0)) + 1;
    saveSocialData();

    emitToUsers([myId, tId], 'social_dm_message', { pairKey: pk, message: msg });
    emitSocialUpdate([myId, tId]);
    return res.json({ ok: true, message: msg });
  });

  app.post('/api/social/dm/read', (req, res) => {
    const me = getAuthedUser(req);
    if (!me) return res.status(401).json({ ok: false, error: '인증 정보가 유효하지 않습니다.' });
    const myId = normId(me.id);
    const tId = normId(req.body?.targetId);
    const pk = makePairKey(myId, tId);
    const msgs = socialData.dmThreads[pk] || [];
    let changed = false;
    for (const m of msgs) {
      if (normId(m.fromId) === tId && !m.read) {
        m.read = true;
        changed = true;
      }
    }
    if (socialData.unreadDm[myId] && socialData.unreadDm[myId][tId]) {
      delete socialData.unreadDm[myId][tId];
      changed = true;
    }
    if (changed) {
      saveSocialData();
      emitToUsers([myId, tId], 'social_dm_read', { pairKey: pk, readerId: myId, senderId: tId });
      emitSocialUpdate([myId]);
    }
    return res.json({ ok: true });
  });

  // ================= 4. 1:1 아이템·스타 거래 (5% 수수료 · 당사자 개인 룸 전송) =================
  function getTradableInventory(user) {
    ensureUserStatsStructure(user);
    const today = getTodayKstString ? getTodayKstString() : '';
    const catalog = getEffectiveShopCatalog ? getEffectiveShopCatalog() : [];
    const cos = user.game_data.cosmetics || {};
    const counts = cos.itemCounts || {};
    const items = [];

    for (const [itemId, rawQty] of Object.entries(counts)) {
      const qty = Math.max(0, Math.floor(Number(rawQty) || 0));
      if (qty <= 0) continue;
      const catItem = catalog.find((x) => x.id === itemId);
      if (!catItem) continue;
      if (catItem.exclusive && !['rodSkin', 'material', 'consumable'].includes(catItem.category)) continue;
      items.push({ itemType: catItem.category, itemId: catItem.id, name: catItem.name, qty });
    }

    const rawRods = (user.game_data.fishing && Array.isArray(user.game_data.fishing.rods)) ? user.game_data.fishing.rods : [];
    const rods = rawRods.map((r) => {
      const lim = getServerRodDailyBaitLimit ? getServerRodDailyBaitLimit(r.level || 0, r.awakening || 0) : 300;
      const used = (today && r.lastBaitDate === today) ? Math.max(0, Math.floor(Number(r.dailyBaitUsed) || 0)) : 0;
      return {
        id: r.id,
        level: r.level || 0,
        awakening: r.awakening || 0,
        boundSkin: r.boundSkin || null,
        craftedBy: r.craftedBy || '',
        dailyBaitLimit: lim,
        dailyBaitRemaining: Math.max(0, lim - used),
        name: formatRodLabel(r)
      };
    });

    return { gold: Math.max(0, Math.floor(Number(user.gold) || 0)), rods, items };
  }

  app.get('/api/social/trade/inventory', (req, res) => {
    const me = getAuthedUser(req);
    if (!me) return res.status(401).json({ ok: false, error: '인증 정보가 유효하지 않습니다.' });
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true, ...getTradableInventory(me) });
  });

  app.post('/api/social/trade/request', (req, res) => {
    if (typeof isTradeFrozen === 'function' && isTradeFrozen()) return res.status(403).json({ ok: false, error: '🔒 관리자에 의해 거래가 일시 정지되었습니다.' });
    const me = getAuthedUser(req);
    if (!me) return res.status(401).json({ ok: false, error: '인증 정보가 유효하지 않습니다.' });
    const { targetId, targetNickname } = req.body || {};
    const target = targetId ? findUserById(targetId) : findUserByNickname(String(targetNickname || '').trim());
    if (!target) return res.status(404).json({ ok: false, error: '거래 상대를 찾을 수 없습니다.' });

    const myId = normId(me.id);
    const tId = normId(target.id);
    if (myId === tId) return res.status(400).json({ ok: false, error: '자기 자신과는 거래할 수 없습니다.' });

    for (const tr of activeTrades.values()) {
      if ((tr.status === 'PENDING' || tr.status === 'OPEN') &&
          makePairKey(tr.fromId, tr.toId) === makePairKey(myId, tId)) {
        return res.json({ ok: true, trade: getPublicTrade(tr), message: '이미 진행 중인 거래 요청이 있습니다.' });
      }
    }

    const tradeId = 'trd_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const tr = {
      id: tradeId,
      status: 'PENDING',
      fromId: myId,
      fromNick: me.nickname,
      toId: tId,
      toNick: target.nickname,
      offers: {
        [myId]: { gold: 0, items: [], locked: false, confirmed: false },
        [tId]: { gold: 0, items: [], locked: false, confirmed: false }
      },
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    activeTrades.set(tradeId, tr);

    if (pushUserNotification) {
      pushUserNotification(target, {
        type: 'trade_request',
        icon: '🤝',
        title: '1:1 거래 요청',
        message: `${me.nickname}님이 1:1 거래를 요청했습니다. 소셜 창의 [거래] 탭에서 수락할 수 있어요.`
      }, true);
    }
    emitToUsers([tId], 'social_trade_invite', { trade: getPublicTrade(tr) });
    emitSocialUpdate([myId, tId]);
    return res.json({ ok: true, trade: getPublicTrade(tr), message: `🤝 ${target.nickname}님에게 1:1 거래를 요청했습니다!` });
  });

  app.post('/api/social/trade/respond', (req, res) => {
    if (typeof isTradeFrozen === 'function' && isTradeFrozen()) return res.status(403).json({ ok: false, error: '🔒 관리자에 의해 거래가 일시 정지되었습니다.' });
    const me = getAuthedUser(req);
    if (!me) return res.status(401).json({ ok: false, error: '인증 정보가 유효하지 않습니다.' });
    const { tradeId, action } = req.body || {};
    const myId = normId(me.id);
    const tr = activeTrades.get(tradeId);
    if (!tr || tr.status !== 'PENDING') return res.status(404).json({ ok: false, error: '유효한 거래 요청을 찾을 수 없습니다.' });
    if (tr.toId !== myId) return res.status(403).json({ ok: false, error: '거래를 요청받은 유저만 응답할 수 있습니다.' });

    if (action === 'accept') {
      tr.status = 'OPEN';
      tr.updatedAt = Date.now();
    } else {
      tr.status = 'CANCELLED';
      tr.cancelReason = `${me.nickname}님이 거래 요청을 거절했습니다.`;
      tr.updatedAt = Date.now();
    }
    const pub = getPublicTrade(tr);
    emitToUsers([tr.fromId, tr.toId], 'social_trade_updated', { trade: pub });
    emitSocialUpdate([tr.fromId, tr.toId]);
    return res.json({ ok: true, trade: pub });
  });

  function validateUserOffer(user, gold, rawItems) {
    ensureUserStatsStructure(user);
    const cleanGold = Math.max(0, Math.floor(Number(gold) || 0));
    if (cleanGold > Math.floor(Number(user.gold) || 0)) {
      return { ok: false, error: `보유 스타(${Math.floor(Number(user.gold) || 0).toLocaleString()} 스타)보다 많이 올릴 수 없습니다.` };
    }
    const items = Array.isArray(rawItems) ? rawItems : [];
    const catalog = getEffectiveShopCatalog ? getEffectiveShopCatalog() : [];
    const cos = user.game_data.cosmetics || {};
    const counts = cos.itemCounts || {};
    const rods = (user.game_data.fishing && Array.isArray(user.game_data.fishing.rods)) ? user.game_data.fishing.rods : [];

    const normalized = [];
    const usedRodIds = new Set();
    const usedItemQtys = {};

    for (const it of items) {
      if (!it || !it.itemType || !it.itemId) continue;
      if (it.itemType === 'rod') {
        if (usedRodIds.has(it.itemId)) continue;
        const rod = rods.find((r) => r.id === it.itemId);
        if (!rod) return { ok: false, error: '보유하지 않은 낚싯대가 포함되어 있습니다.' };
        usedRodIds.add(it.itemId);
        normalized.push({ itemType: 'rod', itemId: rod.id, qty: 1, name: formatRodLabel(rod) });
      } else {
        const qty = Math.max(1, Math.floor(Number(it.qty) || 1));
        const catItem = catalog.find((x) => x.id === it.itemId && x.category === it.itemType);
        if (!catItem) return { ok: false, error: '거래할 수 없는 아이템이 포함되어 있습니다.' };
        if (catItem.exclusive && !['rodSkin', 'material', 'consumable'].includes(catItem.category)) {
          return { ok: false, error: '업적 전용 아이템은 거래할 수 없습니다.' };
        }
        usedItemQtys[it.itemId] = (usedItemQtys[it.itemId] || 0) + qty;
        const ownedQty = Math.max(0, Math.floor(Number(counts[it.itemId]) || 0));
        if (usedItemQtys[it.itemId] > ownedQty) {
          return { ok: false, error: `[${catItem.name}] 보유 수량(${ownedQty}개)이 부족합니다.` };
        }
        const existing = normalized.find((x) => x.itemType === it.itemType && x.itemId === it.itemId);
        if (existing) existing.qty += qty;
        else normalized.push({ itemType: it.itemType, itemId: it.itemId, qty, name: catItem.name });
      }
    }
    return { ok: true, gold: cleanGold, items: normalized };
  }

  app.post('/api/social/trade/update', (req, res) => {
    const me = getAuthedUser(req);
    if (!me) return res.status(401).json({ ok: false, error: '인증 정보가 유효하지 않습니다.' });
    const { tradeId, gold, items } = req.body || {};
    const myId = normId(me.id);
    const tr = activeTrades.get(tradeId);
    if (!tr || tr.status !== 'OPEN') return res.status(404).json({ ok: false, error: '진행 중인 거래를 찾을 수 없습니다.' });
    if (tr.fromId !== myId && tr.toId !== myId) return res.status(403).json({ ok: false, error: '거래 당사자가 아닙니다.' });

    const check = validateUserOffer(me, gold, items);
    if (!check.ok) return res.status(400).json({ ok: false, error: check.error });

    tr.offers[myId].gold = check.gold;
    tr.offers[myId].items = check.items;
    tr.offers[tr.fromId].locked = false;
    tr.offers[tr.fromId].confirmed = false;
    tr.offers[tr.toId].locked = false;
    tr.offers[tr.toId].confirmed = false;
    tr.updatedAt = Date.now();

    const pub = getPublicTrade(tr);
    emitToUsers([tr.fromId, tr.toId], 'social_trade_updated', { trade: pub });
    return res.json({ ok: true, trade: pub });
  });

  app.post('/api/social/trade/lock', (req, res) => {
    const me = getAuthedUser(req);
    if (!me) return res.status(401).json({ ok: false, error: '인증 정보가 유효하지 않습니다.' });
    const { tradeId, locked } = req.body || {};
    const myId = normId(me.id);
    const tr = activeTrades.get(tradeId);
    if (!tr || tr.status !== 'OPEN') return res.status(404).json({ ok: false, error: '진행 중인 거래를 찾을 수 없습니다.' });
    if (tr.fromId !== myId && tr.toId !== myId) return res.status(403).json({ ok: false, error: '거래 당사자가 아닙니다.' });

    const nextLock = Boolean(locked);
    if (nextLock) {
      const check = validateUserOffer(me, tr.offers[myId].gold, tr.offers[myId].items);
      if (!check.ok) return res.status(400).json({ ok: false, error: check.error });
    }
    tr.offers[myId].locked = nextLock;
    if (!nextLock) {
      tr.offers[tr.fromId].confirmed = false;
      tr.offers[tr.toId].confirmed = false;
    }
    tr.updatedAt = Date.now();

    const pub = getPublicTrade(tr);
    emitToUsers([tr.fromId, tr.toId], 'social_trade_updated', { trade: pub });
    return res.json({ ok: true, trade: pub });
  });

  app.post('/api/social/trade/confirm', (req, res) => {
    if (typeof isTradeFrozen === 'function' && isTradeFrozen()) return res.status(403).json({ ok: false, error: '🔒 관리자에 의해 거래가 일시 정지되었습니다.' });
    const me = getAuthedUser(req);
    if (!me) return res.status(401).json({ ok: false, error: '인증 정보가 유효하지 않습니다.' });
    const { tradeId } = req.body || {};
    const myId = normId(me.id);
    const tr = activeTrades.get(tradeId);
    if (!tr || tr.status !== 'OPEN') return res.status(404).json({ ok: false, error: '진행 중인 거래를 찾을 수 없습니다.' });
    if (tr.fromId !== myId && tr.toId !== myId) return res.status(403).json({ ok: false, error: '거래 당사자가 아닙니다.' });

    const offerA = tr.offers[tr.fromId];
    const offerB = tr.offers[tr.toId];
    if (!offerA.locked || !offerB.locked) {
      return res.status(400).json({ ok: false, error: '양쪽 모두 [준비 완료]를 눌러야 거래를 확정할 수 있습니다.' });
    }
    tr.offers[myId].confirmed = true;
    tr.updatedAt = Date.now();

    if (offerA.confirmed && offerB.confirmed) {
      const userA = findUserById(tr.fromId);
      const userB = findUserById(tr.toId);
      if (!userA || !userB) {
        tr.status = 'CANCELLED';
        tr.cancelReason = '유저 정보를 찾을 수 없어 거래가 취소되었습니다.';
        emitToUsers([tr.fromId, tr.toId], 'social_trade_updated', { trade: getPublicTrade(tr) });
        return res.status(400).json({ ok: false, error: tr.cancelReason });
      }

      const chkA = validateUserOffer(userA, offerA.gold, offerA.items);
      const chkB = validateUserOffer(userB, offerB.gold, offerB.items);
      if (!chkA.ok || !chkB.ok) {
        offerA.locked = false; offerA.confirmed = false;
        offerB.locked = false; offerB.confirmed = false;
        const errMsg = !chkA.ok ? `${userA.nickname}: ${chkA.error}` : `${userB.nickname}: ${chkB.error}`;
        emitToUsers([tr.fromId, tr.toId], 'social_trade_updated', { trade: getPublicTrade(tr) });
        return res.status(400).json({ ok: false, error: `거래 검증 실패 (${errMsg})` });
      }

      // 스타 교환 (수수료 5% 적용)
      const taxA = Math.floor(chkA.gold * 0.05);
      const netToB = chkA.gold - taxA;
      const taxB = Math.floor(chkB.gold * 0.05);
      const netToA = chkB.gold - taxB;
      if (typeof recordEconomyFlow === 'function' && (taxA + taxB) > 0) recordEconomyFlow('out_p2p_tax', taxA + taxB);
      userA.gold = Math.max(0, Math.floor(userA.gold - chkA.gold + netToA));
      userB.gold = Math.max(0, Math.floor(userB.gold - chkB.gold + netToB));

      function transferOfferItems(sender, receiver, offerItems) {
        const sf = sender.game_data.fishing;
        const rf = receiver.game_data.fishing;
        for (const it of offerItems) {
          if (it.itemType === 'rod') {
            const rIdx = (sf.rods || []).findIndex((r) => r.id === it.itemId);
            if (rIdx !== -1) {
              const [movedRod] = sf.rods.splice(rIdx, 1);
              if (sf.equippedRodId === movedRod.id) {
                sf.equippedRodId = sf.rods[0] ? sf.rods[0].id : '';
                sf.rodLevel = sf.rods[0] ? (sf.rods[0].level || 0) : 0;
                sf.rodFailBonus = sf.rods[0] ? (sf.rods[0].failBonus || 0) : 0;
                sf.rodSkinLevel = sf.rods[0] && typeof sf.rods[0].skinLevel === 'number' ? sf.rods[0].skinLevel : null;
              }
              const clonedRod = { ...movedRod, id: 'rod_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) };
              rf.rods.push(clonedRod);
              if (!rf.equippedRodId) {
                rf.equippedRodId = clonedRod.id;
                rf.rodLevel = clonedRod.level || 0;
                rf.rodFailBonus = clonedRod.failBonus || 0;
                rf.rodSkinLevel = typeof clonedRod.skinLevel === 'number' ? clonedRod.skinLevel : null;
              }
            }
          } else {
            removeCosmeticItem(sender, it.itemType, it.itemId, it.qty);
            addCosmeticItem(receiver, it.itemType, it.itemId, it.qty);
          }
        }
      }

      transferOfferItems(userA, userB, chkA.items);
      transferOfferItems(userB, userA, chkB.items);

      tr.status = 'COMPLETED';
      tr.updatedAt = Date.now();
      userA.updated_at = new Date().toISOString();
      userB.updated_at = new Date().toISOString();
      saveUsersDB(usersDB);

      const summarize = (g, its) => {
        const parts = [];
        if (g > 0) parts.push(`${g.toLocaleString()} 스타`);
        for (const it of its) parts.push(it.qty > 1 ? `${it.name}×${it.qty}` : it.name);
        return parts.length > 0 ? parts.join(', ') : '없음';
      };

      if (pushUserNotification) {
        pushUserNotification(userA, {
          type: 'trade_done',
          icon: '🤝',
          title: '1:1 거래 완료',
          message: `${userB.nickname}님과 거래 완료! (보냄: ${summarize(chkA.gold, chkA.items)} / 실수령(5% 수수료 제외): ${summarize(netToA, chkB.items)})`
        }, false);
        pushUserNotification(userB, {
          type: 'trade_done',
          icon: '🤝',
          title: '1:1 거래 완료',
          message: `${userA.nickname}님과 거래 완료! (보냄: ${summarize(chkB.gold, chkB.items)} / 실수령(5% 수수료 제외): ${summarize(netToB, chkA.items)})`
        }, false);
        saveUsersDB(usersDB);
      }

      io.emit('gold_updated', { nickname: userA.nickname, gold: userA.gold, reason: 'p2p_trade' });
      io.emit('gold_updated', { nickname: userB.nickname, gold: userB.gold, reason: 'p2p_trade' });
      const pub = getPublicTrade(tr);
      emitToUsers([tr.fromId, tr.toId], 'social_trade_updated', { trade: pub });
      emitSocialUpdate([tr.fromId, tr.toId]);
      return res.json({ ok: true, completed: true, trade: pub, message: '🤝 1:1 거래가 성공적으로 완료되었습니다!' });
    }

    const pub = getPublicTrade(tr);
    emitToUsers([tr.fromId, tr.toId], 'social_trade_updated', { trade: pub });
    return res.json({ ok: true, completed: false, trade: pub, message: '거래 확정을 눌렀습니다. 상대방의 확정을 기다리는 중...' });
  });

  app.post('/api/social/trade/cancel', (req, res) => {
    const me = getAuthedUser(req);
    if (!me) return res.status(401).json({ ok: false, error: '인증 정보가 유효하지 않습니다.' });
    const myId = normId(me.id);
    const tr = activeTrades.get(req.body?.tradeId);
    if (!tr || (tr.status !== 'PENDING' && tr.status !== 'OPEN')) {
      return res.json({ ok: true });
    }
    if (tr.fromId !== myId && tr.toId !== myId) return res.status(403).json({ ok: false, error: '거래 당사자가 아닙니다.' });
    tr.status = 'CANCELLED';
    tr.cancelReason = `${me.nickname}님이 거래를 취소했습니다.`;
    tr.updatedAt = Date.now();
    const pub = getPublicTrade(tr);
    emitToUsers([tr.fromId, tr.toId], 'social_trade_updated', { trade: pub });
    emitSocialUpdate([tr.fromId, tr.toId]);
    return res.json({ ok: true, trade: pub, message: '거래가 취소되었습니다.' });
  });

  return {
    getFriendCount: (uid) => {
      const nid = normId(uid);
      return socialData.friendships.filter((f) => normId(f.aId) === nid || normId(f.bId) === nid).length;
    }
  };
}

module.exports = { setupSocialModule };
