(function (global) {
  if (global.ArcadeSocial) return;

  var state = {
    activeTab: 'friends', // friends | dm | trade
    overview: { friends: [], incomingRequests: [], outgoingRequests: [], activeTrades: [], totalBadge: 0, totalUnreadDm: 0 },
    dmTargetId: '',
    dmTargetInfo: null,
    dmMessages: [],
    activeTrade: null,
    myInventory: { gold: 0, rods: [], items: [] },
    draftGold: 0,
    draftItems: []
  };

  function getProf() {
    return (global.ArcadeAuth && typeof global.ArcadeAuth.getProfile === 'function')
      ? global.ArcadeAuth.getProfile()
      : null;
  }

  function normCode(c) {
    return String(c || '').trim().toUpperCase();
  }
  function normId(v) {
    return String(v || '').trim();
  }
  function getMyId() {
    if (state.overview && state.overview.myUserId) return normId(state.overview.myUserId);
    var p = getProf();
    return p && p.id ? normId(p.id) : '';
  }

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function styledName(nick, cos) {
    if (global.ArcadeAuth && typeof global.ArcadeAuth.formatStyledNameHtml === 'function') {
      return global.ArcadeAuth.formatStyledNameHtml(nick, cos, '#f8fafc');
    }
    return esc(nick || '');
  }

  function showToast(msg) {
    if (typeof global.showToast === 'function') {
      global.showToast(msg);
      return;
    }
    var t = document.createElement('div');
    t.style.cssText = 'position:fixed;top:54px;left:50%;transform:translateX(-50%);z-index:10020;background:#4f46e5;color:#fff;padding:9px 16px;border-radius:14px;font-size:12px;font-weight:900;box-shadow:0 10px 25px rgba(0,0,0,0.55);pointer-events:none;max-width:90vw;text-align:center;';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3000);
  }

  function emitBadgeEvent() {
    try {
      global.dispatchEvent(new CustomEvent('arcade-social-badge', {
        detail: {
          totalBadge: Number(state.overview.totalBadge || 0),
          totalUnreadDm: Number(state.overview.totalUnreadDm || 0),
          incomingRequests: (state.overview.incomingRequests || []).length
        }
      }));
    } catch (_) {}
  }

  function fetchOverview(cb) {
    ensureSocialUserRoom();
    var prof = getProf();
    if (!prof || (!prof.save_code && !prof.nickname)) {
      if (cb) cb(null);
      return;
    }
    fetch('/api/social/overview?save_code=' + encodeURIComponent(prof.save_code || '') + '&nickname=' + encodeURIComponent(prof.nickname || '') + '&t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && d.ok) {
          state.overview = d;
          var openTr = Array.isArray(d.activeTrades) ? d.activeTrades.find(function (t) { return t.status === 'OPEN'; }) : null;
          if (openTr) {
            syncActiveTrade(openTr);
          } else {
            state.activeTrade = null;
          }
          emitBadgeEvent();
          renderModalIfOpen();
        }
        if (cb) cb(d);
      })
      .catch(function () { if (cb) cb(null); });
  }

  function fetchInventory(cb) {
    var prof = getProf();
    if (!prof) return;
    fetch('/api/social/trade/inventory?save_code=' + encodeURIComponent(prof.save_code || '') + '&nickname=' + encodeURIComponent(prof.nickname || '') + '&t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && d.ok) {
          state.myInventory = { gold: d.gold || 0, rods: d.rods || [], items: d.items || [] };
          renderModalIfOpen();
        }
        if (cb) cb(d);
      })
      .catch(function () {});
  }

  function fetchDmHistory(targetCode, cb) {
    var prof = getProf();
    if (!prof || !targetCode) return;
    state.dmTargetId = normId(targetCode);
    fetch('/api/social/dm/history?save_code=' + encodeURIComponent(prof.save_code || '') + '&nickname=' + encodeURIComponent(prof.nickname || '') + '&targetId=' + encodeURIComponent(state.dmTargetId) + '&t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && d.ok) {
          state.dmTargetInfo = d.target;
          state.dmMessages = Array.isArray(d.messages) ? d.messages : [];
          renderModalIfOpen(true);
        }
        if (cb) cb(d);
      })
      .catch(function () {});
  }

  function syncActiveTrade(tr) {
    state.activeTrade = tr;
    var prof = getProf();
    var myCode = getMyId();
    if (tr && tr.offers && tr.offers[myCode]) {
      state.draftGold = Number(tr.offers[myCode].gold || 0);
      state.draftItems = (tr.offers[myCode].items || []).map(function (x) {
        return { itemType: x.itemType, itemId: x.itemId, qty: x.qty || 1, name: x.name };
      });
    } else {
      state.draftGold = 0;
      state.draftItems = [];
    }
  }

  function postJson(url, body, cb) {
    var prof = getProf() || {};
    var payload = Object.assign({ save_code: prof.save_code || '', nickname: prof.nickname || '' }, body || {});
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (cb) cb(d); })
      .catch(function () { showToast('서버 통신 오류가 발생했습니다.'); });
  }

  function buildDmMessagesHtml(myCode) {
    if (!state.dmMessages || state.dmMessages.length === 0) {
      return '<div style="text-align:center;color:#64748b;font-size:11px;margin:auto;">첫 메시지를 보내 대화를 시작해 보세요!</div>';
    }
    var lastReadMyIdx = -1;
    for (var i = 0; i < state.dmMessages.length; i++) {
      var item = state.dmMessages[i];
      if (normId(item.fromId) === myCode && item.read) {
        lastReadMyIdx = i;
      }
    }
    return state.dmMessages.map(function (m, idx) {
      var isMe = normId(m.fromId) === myCode;
      var readBadge = isMe
        ? (!m.read
            ? '<span style="font-size:10px;font-weight:900;color:#facc15;margin-right:4px;">1</span>'
            : (idx === lastReadMyIdx
                ? '<span style="font-size:9px;font-weight:900;color:#38bdf8;margin-right:4px;">읽음</span>'
                : ''))
        : '';
      return '<div style="display:flex;flex-direction:column;align-items:' + (isMe ? 'flex-end' : 'flex-start') + ';">' +
        '<div style="display:flex;align-items:flex-end;gap:4px;max-width:86%;' + (isMe ? 'flex-direction:row;' : 'flex-direction:row-reverse;') + '">' +
          readBadge +
          '<div style="padding:7px 11px;border-radius:14px;font-size:12px;line-height:1.45;word-break:break-word;background:' + (isMe ? '#4f46e5' : '#1e293b') + ';color:#f8fafc;">' + esc(m.text) + '</div>' +
        '</div>' +
        '<span style="font-size:9px;color:#64748b;margin-top:2px;">' + (isMe ? '나' : esc(m.fromNick)) + ' · ' + formatTime(m.createdAt) + '</span>' +
      '</div>';
    }).join('');
  }

  function renderDmMessagesOnly() {
    var listEl = document.getElementById('socDmMsgList');
    if (!listEl) return false;
    var prof = getProf() || {};
    var myCode = getMyId();
    listEl.innerHTML = buildDmMessagesHtml(myCode);
    listEl.scrollTop = listEl.scrollHeight;
    return true;
  }

  function formatTime(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      var hh = String(d.getHours()).padStart(2, '0');
      var mm = String(d.getMinutes()).padStart(2, '0');
      return hh + ':' + mm;
    } catch (_) { return ''; }
  }

  function ensureSocialStyles() {
    if (document.getElementById('arcadeSocialCustomScrollCss')) return;
    var st = document.createElement('style');
    st.id = 'arcadeSocialCustomScrollCss';
    st.textContent =
      '.arcade-social-scroll{scrollbar-width:thin;scrollbar-color:#334155 #080c17;}' +
      '.arcade-social-scroll::-webkit-scrollbar{width:6px;height:6px;}' +
      '.arcade-social-scroll::-webkit-scrollbar-track{background:#080c17;border-radius:999px;}' +
      '.arcade-social-scroll::-webkit-scrollbar-thumb{background:#2b3861;border-radius:999px;border:1px solid #080c17;}' +
      '.arcade-social-scroll::-webkit-scrollbar-thumb:hover{background:#4f46e5;}';
    document.head.appendChild(st);
  }

  function ensureModalEl() {
    ensureSocialStyles();
    var modal = document.getElementById('arcadeSocialModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'arcadeSocialModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:10010;background:rgba(0,0,0,0.78);backdrop-filter:blur(4px);display:none;align-items:center;justify-content:center;padding:12px;';
    modal.innerHTML =
      '<div style="width:100%;max-width:480px;max-height:90vh;display:flex;flex-direction:column;background:#111625;border:1px solid #2b3861;border-radius:24px;padding:16px;box-shadow:0 22px 55px rgba(0,0,0,0.75);color:#f8fafc;font-family:Pretendard,system-ui,sans-serif;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">' +
          '<div style="font-size:15px;font-weight:900;color:#fff;">👥 친구 · 1:1 채팅 · 1:1 거래</div>' +
          '<button id="btnCloseArcadeSocial" type="button" style="background:rgba(255,255,255,0.06);border:none;color:#cbd5e1;width:30px;height:30px;border-radius:999px;font-size:16px;font-weight:900;cursor:pointer;">✕</button>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:12px;">' +
          '<button type="button" data-soc-tab="friends" style="padding:8px 4px;border-radius:12px;border:1px solid #1e293b;font-size:11px;font-weight:900;cursor:pointer;">👥 친구</button>' +
          '<button type="button" data-soc-tab="dm" style="padding:8px 4px;border-radius:12px;border:1px solid #1e293b;font-size:11px;font-weight:900;cursor:pointer;">💬 1:1 채팅</button>' +
          '<button type="button" data-soc-tab="trade" style="padding:8px 4px;border-radius:12px;border:1px solid #1e293b;font-size:11px;font-weight:900;cursor:pointer;">🤝 1:1 거래</button>' +
        '</div>' +
        '<div id="arcadeSocialModalBody" class="arcade-social-scroll" style="flex:1;overflow-y:auto;min-height:280px;padding-right:2px;"></div>' +
      '</div>';
    function cancelOpenTradeIfAny() {
      if (state.activeTrade && state.activeTrade.status === 'OPEN' && state.activeTrade.id) {
        var tid = state.activeTrade.id;
        state.activeTrade = null;
        postJson('/api/social/trade/cancel', { tradeId: tid }, function () { fetchOverview(); });
      }
    }
    modal.addEventListener('click', function (e) {
      if (e.target === modal || e.target.id === 'btnCloseArcadeSocial') {
        cancelOpenTradeIfAny();
        modal.style.display = 'none';
      }
    });
    if (!global.__arcadeSocialUnloadBound) {
      global.__arcadeSocialUnloadBound = true;
      global.addEventListener('beforeunload', function () {
        if (state.activeTrade && state.activeTrade.status === 'OPEN' && state.activeTrade.id && navigator.sendBeacon) {
          var p = getProf() || {};
          var blob = new Blob([JSON.stringify({ save_code: p.save_code || '', nickname: p.nickname || '', tradeId: state.activeTrade.id })], { type: 'application/json' });
          navigator.sendBeacon('/api/social/trade/cancel', blob);
        }
      });
    }
    modal.querySelectorAll('button[data-soc-tab]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.activeTab = b.getAttribute('data-soc-tab');
        if (state.activeTab === 'trade') fetchInventory();
        if (state.activeTab === 'dm' && !state.dmTargetId && state.overview.friends && state.overview.friends.length > 0) {
          fetchDmHistory(state.overview.friends[0].save_code);
        }
        renderModalIfOpen(true);
      });
    });
    document.body.appendChild(modal);
    return modal;
  }

  function renderModalIfOpen(forceScrollDm) {
    var modal = document.getElementById('arcadeSocialModal');
    if (!modal || modal.style.display === 'none') return;
    var bodyEl = document.getElementById('arcadeSocialModalBody');
    if (!bodyEl) return;

    // 입력 중일 때 배경 갱신으로 포커스 잃는 것 방지 (강제 렌더링 제외)
    if (!forceScrollDm && document.activeElement && bodyEl.contains(document.activeElement) && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT')) {
      return;
    }

    var prof = getProf() || {};
    var myCode = getMyId();
    var ov = state.overview || {};
    var friends = ov.friends || [];
    var inReqs = ov.incomingRequests || [];
    var outReqs = ov.outgoingRequests || [];
    var pendingInTrades = (ov.activeTrades || []).filter(function (t) { return t.status === 'PENDING' && t.toId === myCode; });

    modal.querySelectorAll('button[data-soc-tab]').forEach(function (b) {
      var tab = b.getAttribute('data-soc-tab');
      var active = tab === state.activeTab;
      b.style.background = active ? '#4f46e5' : '#080c17';
      b.style.color = active ? '#ffffff' : '#94a3b8';
      b.style.borderColor = active ? '#6366f1' : '#1e293b';
      if (tab === 'friends') b.textContent = '👥 친구' + (inReqs.length > 0 ? ' (' + inReqs.length + ')' : '');
      else if (tab === 'dm') b.textContent = '💬 1:1 채팅' + (ov.totalUnreadDm > 0 ? ' (' + ov.totalUnreadDm + ')' : '');
      else if (tab === 'trade') b.textContent = '🤝 1:1 거래' + (pendingInTrades.length > 0 ? ' (' + pendingInTrades.length + ')' : '');
    });

    if (state.activeTab === 'friends') {
      var html = '';
      // 친구 추가 입력 바 + 비슷한 닉네임 실시간 검색 결과
      html += '<div style="margin-bottom:12px;">' +
        '<div style="display:flex;gap:6px;">' +
          '<input id="socAddFriendInput" type="text" maxlength="16" placeholder="닉네임 검색 또는 입력 (비슷한 이름 자동 검색)" style="flex:1;padding:9px 12px;border-radius:12px;background:#080c17;border:1px solid #263253;color:#fff;font-size:12px;font-weight:700;outline:none;" />' +
          '<button id="btnSocSendFriendReq" type="button" style="padding:9px 14px;border-radius:12px;border:none;background:#4f46e5;color:#fff;font-size:11px;font-weight:900;cursor:pointer;white-space:nowrap;">+ 친구 신청</button>' +
        '</div>' +
        '<div id="socFriendSearchResults" style="display:none;margin-top:6px;padding:8px;border-radius:12px;background:#080c17;border:1px solid #334155;max-height:170px;overflow-y:auto;"></div>' +
      '</div>';

      // 받은 친구 신청
      if (inReqs.length > 0) {
        html += '<div style="margin-bottom:12px;padding:10px;border-radius:14px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.4);">' +
          '<div style="font-size:11px;font-weight:900;color:#fde68a;margin-bottom:8px;">👋 받은 친구 신청 (' + inReqs.length + '건)</div>' +
          '<div style="display:flex;flex-direction:column;gap:6px;">';
        inReqs.forEach(function (r) {
          html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-radius:10px;background:#080c17;border:1px solid #1f2942;">' +
            '<div style="font-size:12px;font-weight:900;">' + styledName(r.fromNick, r.fromCosmetics) + '</div>' +
            '<div style="display:flex;gap:5px;">' +
              '<button type="button" data-fr-act="accept" data-fr-id="' + esc(r.id) + '" style="padding:5px 10px;border-radius:8px;border:none;background:#10b981;color:#022c22;font-size:10px;font-weight:900;cursor:pointer;">수락</button>' +
              '<button type="button" data-fr-act="reject" data-fr-id="' + esc(r.id) + '" style="padding:5px 10px;border-radius:8px;border:1px solid rgba(244,63,94,0.4);background:rgba(244,63,94,0.15);color:#fda4af;font-size:10px;font-weight:900;cursor:pointer;">거절</button>' +
            '</div>' +
          '</div>';
        });
        html += '</div></div>';
      }

      // 친구 목록
      html += '<div style="font-size:11px;font-weight:900;color:#94a3b8;margin-bottom:6px;">내 친구 목록 (' + friends.length + '명)</div>';
      if (friends.length === 0) {
        html += '<div style="text-align:center;padding:24px 10px;border-radius:14px;background:#080c17;border:1px solid #1f2942;color:#64748b;font-size:12px;">아직 등록된 친구가 없습니다. 위에서 닉네임으로 친구를 추가해 보세요!</div>';
      } else {
        html += '<div style="display:flex;flex-direction:column;gap:7px;">';
        friends.forEach(function (fr) {
          html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-radius:14px;background:#080c17;border:1px solid #1f2942;">' +
            '<div style="min-width:0;">' +
              '<div style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:900;">' +
                '<span style="width:8px;height:8px;border-radius:999px;background:' + (fr.online ? '#34d399' : '#475569') + ';display:inline-block;flex-shrink:0;"></span>' +
                '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + styledName(fr.nickname, fr.cosmetics) + '</span>' +
                (fr.unreadDm > 0 ? '<span style="padding:1px 6px;border-radius:999px;background:#ef4444;color:#fff;font-size:10px;font-weight:900;">' + fr.unreadDm + '</span>' : '') +
              '</div>' +
              '<div style="font-size:10px;color:#64748b;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
                (fr.online ? '🟢 접속중' : '⚫ 오프라인') + (fr.lastMessage ? ' · ' + esc(fr.lastMessage.text) : '') +
              '</div>' +
            '</div>' +
            '<div style="display:flex;gap:4px;flex-shrink:0;">' +
              '<button type="button" data-open-dm="' + esc(fr.userId) + '" style="padding:6px 9px;border-radius:9px;border:1px solid rgba(56,189,248,0.4);background:rgba(56,189,248,0.15);color:#7dd3fc;font-size:10px;font-weight:900;cursor:pointer;">💬 채팅</button>' +
              '<button type="button" data-req-trade="' + esc(fr.userId) + '" style="padding:6px 9px;border-radius:9px;border:1px solid rgba(250,204,21,0.4);background:rgba(250,204,21,0.15);color:#fde68a;font-size:10px;font-weight:900;cursor:pointer;">🤝 거래</button>' +
              '<button type="button" data-rm-fr="' + esc(fr.userId) + '" data-rm-nick="' + esc(fr.nickname) + '" style="padding:6px 7px;border-radius:9px;border:1px solid rgba(244,63,94,0.3);background:rgba(244,63,94,0.1);color:#fda4af;font-size:10px;font-weight:900;cursor:pointer;">✕</button>' +
            '</div>' +
          '</div>';
        });
        html += '</div>';
      }

      if (outReqs.length > 0) {
        html += '<div style="margin-top:14px;padding:12px;border-radius:14px;background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.38);">' +
          '<div style="font-size:12px;font-weight:900;color:#c7d2fe;margin-bottom:8px;">📤 보낸 친구 신청 대기중 (' + outReqs.length + '건)</div>' +
          '<div style="display:flex;flex-direction:column;gap:6px;">';
        outReqs.forEach(function (r) {
          html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-radius:10px;background:#080c17;border:1px solid #1f2942;">' +
            '<div style="font-size:12px;font-weight:900;color:#f8fafc;">' + esc(r.toNick) + ' <span style="font-size:10px;color:#94a3b8;font-weight:700;">· 수락 대기중</span></div>' +
            '<button type="button" data-fr-cancel="' + esc(r.id) + '" style="padding:5px 10px;border-radius:8px;border:1px solid rgba(244,63,94,0.45);background:rgba(244,63,94,0.16);color:#fda4af;font-size:11px;font-weight:900;cursor:pointer;">신청 취소</button>' +
          '</div>';
        });
        html += '</div></div>';
      }

      bodyEl.innerHTML = html;

      var addInput = bodyEl.querySelector('#socAddFriendInput');
      var sendBtn = bodyEl.querySelector('#btnSocSendFriendReq');
      var doSendReq = function () {
        var nick = addInput ? addInput.value.trim() : '';
        if (!nick) return;
        postJson('/api/social/friends/request', { targetNickname: nick }, function (d) {
          if (d && d.ok) {
            if (addInput) addInput.value = '';
            showToast(d.message || '친구 신청 완료!');
            fetchOverview();
          } else {
            showToast((d && d.error) || '친구 신청 실패');
          }
        });
      };
      if (sendBtn) sendBtn.addEventListener('click', doSendReq);
      var searchResEl = bodyEl.querySelector('#socFriendSearchResults');
      var searchTimer = null;
      if (addInput) {
        addInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') doSendReq(); });
        addInput.addEventListener('input', function () {
          var q = addInput.value.trim();
          clearTimeout(searchTimer);
          if (!q) {
            if (searchResEl) { searchResEl.style.display = 'none'; searchResEl.innerHTML = ''; }
            return;
          }
          searchTimer = setTimeout(function () {
            var p = getProf() || {};
            fetch('/api/social/users/search?save_code=' + encodeURIComponent(p.save_code || '') + '&nickname=' + encodeURIComponent(p.nickname || '') + '&q=' + encodeURIComponent(q) + '&t=' + Date.now(), { cache: 'no-store' })
              .then(function (r) { return r.ok ? r.json() : null; })
              .then(function (d) {
                if (!searchResEl) return;
                if (!d || !d.ok || !Array.isArray(d.users) || d.users.length === 0) {
                  searchResEl.style.display = 'block';
                  searchResEl.innerHTML = '<div style="font-size:11px;color:#64748b;text-align:center;padding:6px 0;">비슷한 닉네임의 유저를 찾지 못했습니다.</div>';
                  return;
                }
                searchResEl.style.display = 'block';
                searchResEl.innerHTML = '<div style="display:flex;flex-direction:column;gap:5px;">' + d.users.map(function (u) {
                  var rightHtml = u.isFriend
                    ? '<span style="font-size:10px;color:#34d399;font-weight:900;">✓ 친구</span>'
                    : u.isOutgoing
                    ? '<span style="font-size:10px;color:#a5b4fc;font-weight:900;">대기중</span>'
                    : '<button type="button" data-search-add="' + esc(u.nickname) + '" style="padding:4px 9px;border-radius:8px;border:none;background:#4f46e5;color:#fff;font-size:10px;font-weight:900;cursor:pointer;">+ 신청</button>';
                  return '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px;border-radius:9px;background:#111625;border:1px solid #1f2942;">' +
                    '<div style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:900;min-width:0;">' +
                      '<span style="width:7px;height:7px;border-radius:999px;background:' + (u.online ? '#34d399' : '#475569') + ';flex-shrink:0;"></span>' +
                      '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + styledName(u.nickname, u.cosmetics) + '</span>' +
                    '</div>' + rightHtml +
                  '</div>';
                }).join('') + '</div>';
                searchResEl.querySelectorAll('button[data-search-add]').forEach(function (sb) {
                  sb.addEventListener('click', function () {
                    var tNick = sb.getAttribute('data-search-add');
                    postJson('/api/social/friends/request', { targetNickname: tNick }, function (resp) {
                      if (resp && resp.ok) {
                        if (addInput) addInput.value = '';
                        searchResEl.style.display = 'none';
                        showToast(resp.message || '친구 신청 완료!');
                        fetchOverview();
                      } else {
                        showToast((resp && resp.error) || '친구 신청 실패');
                      }
                    });
                  });
                });
              })
              .catch(function () {});
          }, 180);
        });
      }
      bodyEl.querySelectorAll('button[data-fr-cancel]').forEach(function (cb) {
        cb.addEventListener('click', function () {
          postJson('/api/social/friends/cancel', { requestId: cb.getAttribute('data-fr-cancel') }, function (d) {
            if (d && d.ok) { showToast(d.message || '친구 신청을 취소했습니다.'); fetchOverview(); }
            else showToast((d && d.error) || '취소 실패');
          });
        });
      });

      bodyEl.querySelectorAll('button[data-fr-act]').forEach(function (b) {
        b.addEventListener('click', function () {
          postJson('/api/social/friends/respond', { requestId: b.getAttribute('data-fr-id'), action: b.getAttribute('data-fr-act') }, function (d) {
            if (d && d.ok) { showToast(d.message || '처리되었습니다.'); fetchOverview(); }
            else showToast((d && d.error) || '처리 실패');
          });
        });
      });
      bodyEl.querySelectorAll('button[data-open-dm]').forEach(function (b) {
        b.addEventListener('click', function () {
          state.activeTab = 'dm';
          fetchDmHistory(b.getAttribute('data-open-dm'));
        });
      });
      bodyEl.querySelectorAll('button[data-req-trade]').forEach(function (b) {
        b.addEventListener('click', function () {
          postJson('/api/social/trade/request', { targetId: b.getAttribute('data-req-trade') }, function (d) {
            if (d && d.ok && d.trade) {
              if (d.trade.status === 'OPEN') syncActiveTrade(d.trade);
              state.activeTab = 'trade';
              fetchOverview();
              fetchInventory();
              showToast(d.message || '거래를 요청했습니다.');
              renderModalIfOpen(true);
            } else showToast((d && d.error) || '거래 요청 실패');
          });
        });
      });
      bodyEl.querySelectorAll('button[data-rm-fr]').forEach(function (b) {
        b.addEventListener('click', function () {
          var n = b.getAttribute('data-rm-nick');
          if (!global.confirm(n + '님을 친구 목록에서 삭제할까요?')) return;
          postJson('/api/social/friends/remove', { friendId: b.getAttribute('data-rm-fr') }, function (d) {
            if (d && d.ok) { showToast(d.message || '삭제되었습니다.'); fetchOverview(); }
          });
        });
      });

    } else if (state.activeTab === 'dm') {
      var dHtml = '';
      if (friends.length === 0 && !state.dmTargetId) {
        dHtml = '<div style="text-align:center;padding:30px 10px;color:#64748b;font-size:12px;">먼저 친구를 추가하면 1:1 실시간 채팅을 이용할 수 있어요!</div>';
        bodyEl.innerHTML = dHtml;
        return;
      }
      // 친구 선택 칩
      dHtml += '<div class="arcade-social-scroll" style="display:flex;gap:6px;overflow-x:auto;padding-bottom:8px;margin-bottom:8px;border-bottom:1px solid #1e293b;">';
      friends.forEach(function (fr) {
        var sel = normId(fr.userId) === normId(state.dmTargetId);
        dHtml += '<button type="button" data-dm-pick="' + esc(fr.userId) + '" style="padding:6px 10px;border-radius:999px;font-size:11px;font-weight:900;cursor:pointer;white-space:nowrap;border:1px solid ' + (sel ? '#38bdf8' : '#263253') + ';background:' + (sel ? 'rgba(56,189,248,0.2)' : '#080c17') + ';color:' + (sel ? '#e0f2fe' : '#94a3b8') + ';">' +
          (fr.online ? '🟢 ' : '⚫ ') + esc(fr.nickname) + (fr.unreadDm > 0 ? ' (' + fr.unreadDm + ')' : '') +
        '</button>';
      });
      dHtml += '</div>';

      if (!state.dmTargetId) {
        dHtml += '<div style="text-align:center;padding:24px;color:#94a3b8;font-size:12px;">위에서 대화할 친구를 선택하세요.</div>';
        bodyEl.innerHTML = dHtml;
      } else {
        dHtml += '<div id="socDmMsgList" class="arcade-social-scroll" style="height:250px;overflow-y:auto;display:flex;flex-direction:column;gap:7px;padding:10px;border-radius:14px;background:#080c17;border:1px solid #1f2942;margin-bottom:10px;">' + buildDmMessagesHtml(myCode) + '</div>';
        dHtml += '<div style="display:flex;gap:6px;">' +
          '<input id="socDmInput" type="text" maxlength="300" placeholder="메시지를 입력하세요..." style="flex:1;padding:9px 12px;border-radius:12px;background:#080c17;border:1px solid #263253;color:#fff;font-size:12px;outline:none;" />' +
          '<button id="btnSocDmSend" type="button" style="padding:9px 14px;border-radius:12px;border:none;background:#38bdf8;color:#082f49;font-size:11px;font-weight:900;cursor:pointer;">전송</button>' +
        '</div>';
        bodyEl.innerHTML = dHtml;
        var listEl = bodyEl.querySelector('#socDmMsgList');
        if (listEl) listEl.scrollTop = listEl.scrollHeight;

        var dmIn = bodyEl.querySelector('#socDmInput');
        var dmBtn = bodyEl.querySelector('#btnSocDmSend');
        var sendDm = function () {
          var txt = dmIn ? dmIn.value.trim() : '';
          if (!txt) return;
          if (dmIn) { dmIn.value = ''; dmIn.focus(); }
          postJson('/api/social/dm/send', { targetId: state.dmTargetId, text: txt }, function (d) {
            if (d && d.ok && d.message) {
              if (!state.dmMessages.some(function (x) { return x.id === d.message.id; })) {
                state.dmMessages.push(d.message);
              }
              renderDmMessagesOnly();
            } else if (!d || !d.ok) {
              showToast((d && d.error) || '전송 실패');
            }
          });
        };
        if (dmBtn) dmBtn.addEventListener('click', sendDm);
        if (dmIn) dmIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') sendDm(); });
      }
      bodyEl.querySelectorAll('button[data-dm-pick]').forEach(function (b) {
        b.addEventListener('click', function () { fetchDmHistory(b.getAttribute('data-dm-pick')); });
      });

    } else if (state.activeTab === 'trade') {
      var tHtml = '';
      var tr = state.activeTrade;

      if (tr && tr.status === 'OPEN') {
        var otherCode = tr.fromId === myCode ? tr.toId : tr.fromId;
        var otherNick = tr.fromId === myCode ? tr.toNick : tr.fromNick;
        var myOffer = tr.offers[myCode] || { gold: 0, items: [], locked: false, confirmed: false };
        var othOffer = tr.offers[otherCode] || { gold: 0, items: [], locked: false, confirmed: false };
        var bothLocked = Boolean(myOffer.locked && othOffer.locked);

        function renderOfferBox(title, offer, isMine) {
          var badge = offer.confirmed
            ? '<span style="padding:2px 6px;border-radius:6px;background:#10b981;color:#022c22;font-size:9px;font-weight:900;">확정완료</span>'
            : offer.locked
            ? '<span style="padding:2px 6px;border-radius:6px;background:#f59e0b;color:#451a03;font-size:9px;font-weight:900;">준비완료</span>'
            : '<span style="padding:2px 6px;border-radius:6px;background:#1e293b;color:#94a3b8;font-size:9px;font-weight:900;">선택중</span>';
          var out = '<div style="padding:10px;border-radius:14px;background:#080c17;border:1px solid ' + (offer.locked ? 'rgba(245,158,11,0.55)' : '#1f2942') + ';">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">' +
              '<span style="font-size:11px;font-weight:900;color:' + (isMine ? '#38bdf8' : '#fde68a') + ';">' + esc(title) + '</span>' + badge +
            '</div>' +
            '<div style="font-size:12px;font-weight:900;color:#fbbf24;margin-bottom:6px;">⭐ ' + Number(offer.gold || 0).toLocaleString() + ' 스타' + (Number(offer.gold || 0) > 0 ? '<div style="font-size:9px;color:#94a3b8;font-weight:700;">(5% 수수료 제외 실수령 ' + Math.floor(Number(offer.gold || 0) * 0.95).toLocaleString() + ' 스타)</div>' : '') + '</div>';
          if (!offer.items || offer.items.length === 0) {
            out += '<div style="font-size:10px;color:#64748b;">올린 아이템 없음</div>';
          } else {
            out += '<div style="display:flex;flex-direction:column;gap:4px;">';
            offer.items.forEach(function (it, idx) {
              out += '<div style="display:flex;align-items:center;justify-content:space-between;gap:4px;padding:4px 7px;border-radius:8px;background:#111625;border:1px solid #263253;font-size:10px;font-weight:800;">' +
                '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(it.name) + (it.qty > 1 ? ' ×' + it.qty : '') + '</span>' +
                (isMine && !offer.locked ? '<button type="button" data-tr-rm-idx="' + idx + '" style="background:none;border:none;color:#fb7185;font-weight:900;cursor:pointer;">✕</button>' : '') +
              '</div>';
            });
            out += '</div>';
          }
          out += '</div>';
          return out;
        }

        tHtml += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">' +
          renderOfferBox('내 제안 (나)', myOffer, true) +
          renderOfferBox(otherNick + '의 제안', othOffer, false) +
        '</div>';

        // 내 품목/스타 편집 영역 (잠금 전)
        if (!myOffer.locked) {
          tHtml += '<div style="padding:10px;border-radius:14px;background:#0b1120;border:1px solid #232f52;margin-bottom:10px;display:flex;flex-direction:column;gap:8px;">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;font-size:10px;color:#94a3b8;">' +
              '<span>내 보유 스타: <strong style="color:#fde68a;">⭐ ' + Number(state.myInventory.gold || 0).toLocaleString() + '</strong></span>' +
              '<span style="color:#fda4af;font-weight:800;">스타 수수료 5%</span>' +
            '</div>' +
            '<div style="display:flex;gap:6px;">' +
              '<input id="trGoldInput" type="number" min="0" step="1" value="' + Number(state.draftGold || 0) + '" placeholder="보낼 스타" style="flex:1;padding:7px 10px;border-radius:10px;background:#080c17;border:1px solid #263253;color:#fde68a;font-size:12px;font-weight:900;outline:none;" />' +
              '<button id="btnTrSetGold" type="button" style="padding:7px 12px;border-radius:10px;border:none;background:#f59e0b;color:#451a03;font-size:11px;font-weight:900;cursor:pointer;">스타 적용</button>' +
            '</div>';

          // 창고 아이템/낚싯대 선택 드롭다운
          var opts = '<option value="">-- 창고 아이템·낚싯대 선택 --</option>';
          (state.myInventory.rods || []).forEach(function (r) {
            opts += '<option value="rod|' + esc(r.id) + '">' + esc(r.name) + ' (' + r.dailyBaitRemaining + '/' + r.dailyBaitLimit + ')</option>';
          });
          (state.myInventory.items || []).forEach(function (it) {
            opts += '<option value="' + esc(it.itemType) + '|' + esc(it.itemId) + '">' + esc(it.name) + ' (보유 ' + it.qty + '개)</option>';
          });
          tHtml += '<div style="display:flex;gap:6px;">' +
            '<select id="trItemSelect" style="flex:1;padding:7px 8px;border-radius:10px;background:#080c17;border:1px solid #263253;color:#e2e8f0;font-size:11px;font-weight:700;outline:none;">' + opts + '</select>' +
            '<input id="trItemQty" type="number" min="1" value="1" style="width:52px;padding:7px 6px;border-radius:10px;background:#080c17;border:1px solid #263253;color:#fff;font-size:11px;font-weight:900;text-align:center;" />' +
            '<button id="btnTrAddItem" type="button" style="padding:7px 10px;border-radius:10px;border:none;background:#38bdf8;color:#082f49;font-size:11px;font-weight:900;cursor:pointer;">올리기</button>' +
          '</div></div>';
        }

        // 하단 액션 버튼
        tHtml += '<div style="display:flex;gap:6px;">' +
          '<button id="btnTrLock" type="button" style="flex:1;padding:10px;border-radius:12px;border:none;background:' + (myOffer.locked ? '#334155' : '#f59e0b') + ';color:' + (myOffer.locked ? '#e2e8f0' : '#451a03') + ';font-size:12px;font-weight:900;cursor:pointer;">' + (myOffer.locked ? '🔓 준비 해제' : '✅ 준비 완료') + '</button>' +
          '<button id="btnTrConfirm" type="button" ' + (!bothLocked || myOffer.confirmed ? 'disabled' : '') + ' style="flex:1;padding:10px;border-radius:12px;border:none;background:' + (bothLocked && !myOffer.confirmed ? '#10b981' : '#1e293b') + ';color:' + (bothLocked && !myOffer.confirmed ? '#022c22' : '#64748b') + ';font-size:12px;font-weight:900;cursor:' + (bothLocked && !myOffer.confirmed ? 'pointer' : 'not-allowed') + ';">' + (myOffer.confirmed ? '⏳ 상대 확정 대기' : '🤝 거래 확정') + '</button>' +
          '<button id="btnTrCancelOpen" type="button" style="padding:10px 12px;border-radius:12px;border:1px solid rgba(244,63,94,0.45);background:rgba(244,63,94,0.15);color:#fda4af;font-size:11px;font-weight:900;cursor:pointer;">취소</button>' +
        '</div>';

        bodyEl.innerHTML = tHtml;

        function pushOfferUpdate(nextGold, nextItems) {
          postJson('/api/social/trade/update', { tradeId: tr.id, gold: nextGold, items: nextItems }, function (d) {
            if (d && d.ok && d.trade) { syncActiveTrade(d.trade); renderModalIfOpen(true); }
            else showToast((d && d.error) || '제안 수정 실패');
          });
        }

        var bGold = bodyEl.querySelector('#btnTrSetGold');
        if (bGold) bGold.addEventListener('click', function () {
          var g = Math.max(0, Math.floor(Number((bodyEl.querySelector('#trGoldInput') || {}).value || 0)));
          pushOfferUpdate(g, state.draftItems);
        });
        var bAdd = bodyEl.querySelector('#btnTrAddItem');
        if (bAdd) bAdd.addEventListener('click', function () {
          var sel = (bodyEl.querySelector('#trItemSelect') || {}).value || '';
          if (!sel) return;
          var parts = sel.split('|');
          var qty = Math.max(1, Math.floor(Number((bodyEl.querySelector('#trItemQty') || {}).value || 1)));
          var next = state.draftItems.slice();
          next.push({ itemType: parts[0], itemId: parts[1], qty: parts[0] === 'rod' ? 1 : qty });
          pushOfferUpdate(state.draftGold, next);
        });
        bodyEl.querySelectorAll('button[data-tr-rm-idx]').forEach(function (b) {
          b.addEventListener('click', function () {
            var idx = Number(b.getAttribute('data-tr-rm-idx'));
            var next = state.draftItems.filter(function (_, i) { return i !== idx; });
            pushOfferUpdate(state.draftGold, next);
          });
        });
        var bLock = bodyEl.querySelector('#btnTrLock');
        if (bLock) bLock.addEventListener('click', function () {
          postJson('/api/social/trade/lock', { tradeId: tr.id, locked: !myOffer.locked }, function (d) {
            if (d && d.ok && d.trade) { syncActiveTrade(d.trade); renderModalIfOpen(true); }
            else showToast((d && d.error) || '준비 상태 변경 실패');
          });
        });
        var bConf = bodyEl.querySelector('#btnTrConfirm');
        if (bConf) bConf.addEventListener('click', function () {
          postJson('/api/social/trade/confirm', { tradeId: tr.id }, function (d) {
            if (d && d.ok) {
              if (d.completed) {
                showToast(d.message || '🤝 1:1 거래가 완료되었습니다!');
                state.activeTrade = null;
                if (global.ArcadeEconomy && global.ArcadeEconomy.refresh) global.ArcadeEconomy.refresh(null, true);
                fetchOverview();
                fetchInventory();
              } else {
                syncActiveTrade(d.trade);
                showToast(d.message || '거래 확정 완료! 상대방 대기 중...');
              }
              renderModalIfOpen(true);
            } else {
              showToast((d && d.error) || '거래 확정 실패');
            }
          });
        });
        var bCanO = bodyEl.querySelector('#btnTrCancelOpen');
        if (bCanO) bCanO.addEventListener('click', function () {
          postJson('/api/social/trade/cancel', { tradeId: tr.id }, function () {
            state.activeTrade = null; fetchOverview(); renderModalIfOpen(true);
          });
        });
        return;
      }

      // 활성 거래 없을 때: 닉네임으로 직접 거래 요청 또는 친구 선택
      tHtml += '<div style="margin-bottom:12px;">' +
        '<div style="font-size:11px;font-weight:900;color:#fde68a;margin-bottom:6px;">🤝 닉네임으로 바로 1:1 거래 신청 (스타 수수료 5%)</div>' +
        '<div style="display:flex;gap:6px;">' +
          '<input id="socTradeNickInput" type="text" maxlength="16" placeholder="닉네임 검색 또는 입력 (비슷한 이름 자동 검색)" style="flex:1;padding:9px 12px;border-radius:12px;background:#080c17;border:1px solid #263253;color:#fff;font-size:12px;font-weight:700;outline:none;" />' +
          '<button id="btnSocTradeByNick" type="button" style="padding:9px 14px;border-radius:12px;border:none;background:#f59e0b;color:#451a03;font-size:11px;font-weight:900;cursor:pointer;white-space:nowrap;">거래 요청</button>' +
        '</div>' +
        '<div id="socTradeSearchResults" class="arcade-social-scroll" style="display:none;margin-top:6px;padding:8px;border-radius:12px;background:#080c17;border:1px solid #334155;max-height:165px;overflow-y:auto;"></div>' +
      '</div>';

      if (friends.length > 0) {
        tHtml += '<div style="font-size:11px;font-weight:900;color:#94a3b8;margin-bottom:6px;">친구에게 바로 거래 요청</div><div style="display:flex;flex-direction:column;gap:6px;">';
        friends.forEach(function (fr) {
          tHtml += '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-radius:12px;background:#080c17;border:1px solid #1f2942;">' +
            '<span style="font-size:12px;font-weight:900;">' + (fr.online ? '🟢 ' : '⚫ ') + styledName(fr.nickname, fr.cosmetics) + '</span>' +
            '<button type="button" data-quick-tr="' + esc(fr.userId) + '" style="padding:6px 10px;border-radius:9px;border:none;background:rgba(245,158,11,0.2);color:#fde68a;font-size:10px;font-weight:900;cursor:pointer;">🤝 거래 요청</button>' +
          '</div>';
        });
        tHtml += '</div>';
      }
      // 하단에 받은 거래 요청 + 보낸 거래 요청 전체 나열
      var allPendingTrs = (ov.activeTrades || []).filter(function (x) { return x.status === 'PENDING'; });
      var inPendingTrs = allPendingTrs.filter(function (x) { return x.toId === myCode; });
      var outPendingTrs = allPendingTrs.filter(function (x) { return x.fromId === myCode; });

      if (inPendingTrs.length > 0) {
        tHtml += '<div style="margin-top:14px;padding:12px;border-radius:14px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.42);">' +
          '<div style="font-size:12px;font-weight:900;color:#fde68a;margin-bottom:8px;">📥 받은 1:1 거래 요청 (' + inPendingTrs.length + '건)</div>' +
          '<div style="display:flex;flex-direction:column;gap:6px;">';
        inPendingTrs.forEach(function (pt) {
          tHtml += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-radius:10px;background:#080c17;border:1px solid #1f2942;">' +
            '<div style="font-size:12px;font-weight:900;color:#fff;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">🤝 ' + esc(pt.fromNick) + '님의 거래 요청</div>' +
            '<div style="display:flex;gap:5px;flex-shrink:0;">' +
              '<button type="button" data-tr-list-acc="' + esc(pt.id) + '" style="padding:5px 10px;border-radius:8px;border:none;background:#10b981;color:#022c22;font-size:11px;font-weight:900;cursor:pointer;">✓ 수락</button>' +
              '<button type="button" data-tr-list-rej="' + esc(pt.id) + '" style="padding:5px 10px;border-radius:8px;border:1px solid rgba(244,63,94,0.45);background:rgba(244,63,94,0.15);color:#fda4af;font-size:11px;font-weight:900;cursor:pointer;">거절</button>' +
            '</div>' +
          '</div>';
        });
        tHtml += '</div></div>';
      }

      if (outPendingTrs.length > 0) {
        tHtml += '<div style="margin-top:12px;padding:12px;border-radius:14px;background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.38);">' +
          '<div style="font-size:12px;font-weight:900;color:#c7d2fe;margin-bottom:8px;">📤 보낸 1:1 거래 요청 대기중 (' + outPendingTrs.length + '건)</div>' +
          '<div style="display:flex;flex-direction:column;gap:6px;">';
        outPendingTrs.forEach(function (pt) {
          tHtml += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border-radius:10px;background:#080c17;border:1px solid #1f2942;">' +
            '<div style="font-size:12px;font-weight:900;color:#f8fafc;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">⏳ ' + esc(pt.toNick) + '님 수락 대기중</div>' +
            '<button type="button" data-tr-list-can="' + esc(pt.id) + '" style="padding:5px 10px;border-radius:8px;border:1px solid rgba(244,63,94,0.45);background:rgba(244,63,94,0.16);color:#fda4af;font-size:11px;font-weight:900;cursor:pointer;flex-shrink:0;">요청 취소</button>' +
          '</div>';
        });
        tHtml += '</div></div>';
      }

      bodyEl.innerHTML = tHtml;

      bodyEl.querySelectorAll('button[data-tr-list-acc]').forEach(function (b) {
        b.addEventListener('click', function () {
          postJson('/api/social/trade/respond', { tradeId: b.getAttribute('data-tr-list-acc'), action: 'accept' }, function (d) {
            if (d && d.ok && d.trade) { syncActiveTrade(d.trade); fetchInventory(); renderModalIfOpen(true); }
            else showToast((d && d.error) || '수락 실패');
          });
        });
      });
      bodyEl.querySelectorAll('button[data-tr-list-rej]').forEach(function (b) {
        b.addEventListener('click', function () {
          postJson('/api/social/trade/respond', { tradeId: b.getAttribute('data-tr-list-rej'), action: 'reject' }, function () {
            fetchOverview();
          });
        });
      });
      bodyEl.querySelectorAll('button[data-tr-list-can]').forEach(function (b) {
        b.addEventListener('click', function () {
          postJson('/api/social/trade/cancel', { tradeId: b.getAttribute('data-tr-list-can') }, function () {
            showToast('거래 요청을 취소했습니다.');
            fetchOverview();
          });
        });
      });

      var tNickIn = bodyEl.querySelector('#socTradeNickInput');
      var tNickBtn = bodyEl.querySelector('#btnSocTradeByNick');
      var reqByNick = function () {
        var n = tNickIn ? tNickIn.value.trim() : '';
        if (!n) return;
        postJson('/api/social/trade/request', { targetNickname: n }, function (d) {
          if (d && d.ok && d.trade) { if (d.trade.status === 'OPEN') syncActiveTrade(d.trade); fetchOverview(); fetchInventory(); showToast(d.message || '거래 요청 완료!'); }
          else showToast((d && d.error) || '거래 요청 실패');
        });
      };
      if (tNickBtn) tNickBtn.addEventListener('click', reqByNick);
      var trSearchResEl = bodyEl.querySelector('#socTradeSearchResults');
      var trSearchTimer = null;
      if (tNickIn) {
        tNickIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') reqByNick(); });
        tNickIn.addEventListener('input', function () {
          var q = tNickIn.value.trim();
          clearTimeout(trSearchTimer);
          if (!q) {
            if (trSearchResEl) { trSearchResEl.style.display = 'none'; trSearchResEl.innerHTML = ''; }
            return;
          }
          trSearchTimer = setTimeout(function () {
            var p = getProf() || {};
            fetch('/api/social/users/search?save_code=' + encodeURIComponent(p.save_code || '') + '&nickname=' + encodeURIComponent(p.nickname || '') + '&q=' + encodeURIComponent(q) + '&t=' + Date.now(), { cache: 'no-store' })
              .then(function (r) { return r.ok ? r.json() : null; })
              .then(function (d) {
                if (!trSearchResEl) return;
                if (!d || !d.ok || !Array.isArray(d.users) || d.users.length === 0) {
                  trSearchResEl.style.display = 'block';
                  trSearchResEl.innerHTML = '<div style="font-size:11px;color:#64748b;text-align:center;padding:6px 0;">비슷한 닉네임의 유저를 찾지 못했습니다.</div>';
                  return;
                }
                trSearchResEl.style.display = 'block';
                trSearchResEl.innerHTML = '<div style="display:flex;flex-direction:column;gap:5px;">' + d.users.map(function (u) {
                  return '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px;border-radius:9px;background:#111625;border:1px solid #1f2942;">' +
                    '<div style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:900;min-width:0;">' +
                      '<span style="width:7px;height:7px;border-radius:999px;background:' + (u.online ? '#34d399' : '#475569') + ';flex-shrink:0;"></span>' +
                      '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + styledName(u.nickname, u.cosmetics) + '</span>' +
                    '</div>' +
                    '<button type="button" data-tr-search-req="' + esc(u.userId) + '" style="padding:4px 9px;border-radius:8px;border:none;background:#f59e0b;color:#451a03;font-size:10px;font-weight:900;cursor:pointer;white-space:nowrap;">🤝 거래 요청</button>' +
                  '</div>';
                }).join('') + '</div>';
                trSearchResEl.querySelectorAll('button[data-tr-search-req]').forEach(function (sb) {
                  sb.addEventListener('click', function () {
                    var tCode = sb.getAttribute('data-tr-search-req');
                    postJson('/api/social/trade/request', { targetId: tCode }, function (resp) {
                      if (resp && resp.ok && resp.trade) {
                        if (resp.trade.status === 'OPEN') syncActiveTrade(resp.trade);
                        fetchOverview();
                        fetchInventory();
                        showToast(resp.message || '거래 요청 완료!');
                      } else {
                        showToast((resp && resp.error) || '거래 요청 실패');
                      }
                    });
                  });
                });
              })
              .catch(function () {});
          }, 180);
        });
      }
      bodyEl.querySelectorAll('button[data-quick-tr]').forEach(function (b) {
        b.addEventListener('click', function () {
          postJson('/api/social/trade/request', { targetId: b.getAttribute('data-quick-tr') }, function (d) {
            if (d && d.ok && d.trade) { if (d.trade.status === 'OPEN') syncActiveTrade(d.trade); fetchOverview(); fetchInventory(); showToast(d.message || '거래 요청 완료!'); }
            else showToast((d && d.error) || '거래 요청 실패');
          });
        });
      });
    }
  }

  function openModal(tab, targetCode) {
    if (tab) state.activeTab = tab;
    if (targetCode) state.dmTargetId = normId(targetCode);
    var modal = ensureModalEl();
    modal.style.display = 'flex';
    fetchOverview();
    if (state.activeTab === 'trade') fetchInventory();
    if (state.activeTab === 'dm' && state.dmTargetId) fetchDmHistory(state.dmTargetId);
    renderModalIfOpen(true);
  }

  // 실시간 소켓 이벤트 연결 (개인 인증 룸 user:<id> 전용 수신)
  var _socialSock = null;
  var _registeredRoomCode = '';
  function ensureSocialUserRoom() {
    try {
      var prof = getProf();
      if (!_socialSock || !_socialSock.connected || !prof || !prof.save_code) return;
      var code = normCode(prof.save_code);
      if (!code || _registeredRoomCode === code) return;
      _socialSock.emit('register_user_room', { save_code: code }, function (r) {
        if (r && r.ok) {
          _registeredRoomCode = code;
          if (r.userId && state.overview) state.overview.myUserId = r.userId;
        }
      });
    } catch (_) {}
  }

  function initSocket() {
    if (typeof global.io !== 'function') return;
    try {
      var sock = global.io();
      _socialSock = sock;
      sock.on('connect', function () {
        _registeredRoomCode = '';
        ensureSocialUserRoom();
      });
      if (sock.connected) ensureSocialUserRoom();

      sock.on('social_updated', function () {
        if (!getProf()) return;
        fetchOverview();
      });
      sock.on('social_dm_message', function (d) {
        var prof = getProf();
        if (!prof || !d || !d.message) return;
        var myId = getMyId();
        var msg = d.message;
        var otherId = normId(msg.fromId) === myId ? normId(msg.toId) : normId(msg.fromId);
        var modal = document.getElementById('arcadeSocialModal');
        var isViewingThisDm = modal && modal.style.display !== 'none' && state.activeTab === 'dm' && normId(state.dmTargetId) === otherId;
        if (isViewingThisDm) {
          if (!state.dmMessages.some(function (x) { return x.id === msg.id; })) {
            state.dmMessages.push(msg);
          }
          // 입력창 포커스와 작성 중인 텍스트를 유지하면서 메시지 영역만 즉시 갱신!
          if (!renderDmMessagesOnly()) renderModalIfOpen(false);
          if (normId(msg.fromId) !== myId) {
            postJson('/api/social/dm/read', { targetId: otherId }, function () {});
          }
        } else if (normId(msg.fromId) !== myId) {
          showToast('💬 ' + msg.fromNick + ': ' + String(msg.text || '').slice(0, 32));
          fetchOverview();
        }
      });
      sock.on('social_dm_read', function (d) {
        var prof = getProf();
        if (!prof || !d) return;
        var myId = getMyId();
        if (normId(d.senderId) === myId && normId(state.dmTargetId) === normId(d.readerId)) {
          state.dmMessages.forEach(function (m) {
            if (normId(m.fromId) === myId) m.read = true;
          });
          renderDmMessagesOnly();
        }
      });
      sock.on('social_trade_invite', function (d) {
        var prof = getProf();
        if (!prof || !d || !d.trade) return;
        showToast('🤝 ' + d.trade.fromNick + '님이 1:1 거래를 요청했습니다!');
        fetchOverview();
      });
      sock.on('social_trade_updated', function (d) {
        var prof = getProf();
        if (!prof || !d || !d.trade) return;
        var tr = d.trade;
        if (tr.status === 'COMPLETED') {
          state.activeTrade = null;
          showToast('🤝 1:1 거래가 완료되었습니다!');
          if (global.ArcadeEconomy && global.ArcadeEconomy.refresh) global.ArcadeEconomy.refresh(null, true);
          fetchInventory();
        } else if (tr.status === 'CANCELLED') {
          var wasOpen = Boolean(state.activeTrade && state.activeTrade.id === tr.id && state.activeTrade.status === 'OPEN');
          state.activeTrade = null;
          showToast(tr.cancelReason || '상대방이 거래를 취소했습니다.');
          if (wasOpen) {
            var sm = document.getElementById('arcadeSocialModal');
            if (sm) sm.style.display = 'none';
          }
        } else if (tr.status === 'OPEN') {
          syncActiveTrade(tr);
        }
        fetchOverview();
        renderModalIfOpen(true);
      });
    } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initSocket(); fetchOverview(); });
  } else {
    initSocket();
    fetchOverview();
  }
  setInterval(function () { if (document.visibilityState !== 'hidden') fetchOverview(); }, 20000);

  global.ArcadeSocial = {
    openModal: openModal,
    refresh: fetchOverview,
    getBadgeCount: function () { return Number(state.overview.totalBadge || 0); }
  };
})(window);
