(function (global) {
  if (global.ArcadeAdminPanel) return;

  var LOG_STORAGE_KEY = 'arcade_admin_cmd_logs_v1';
  var HIST_STORAGE_KEY = 'arcade_admin_cmd_hist_v1';

  var state = {
    isAdmin: false,
    panelOpen: false,
    manualOpen: false,
    manualCat: '전체',
    manualQuery: '',
    manual: [],
    onlineNicknames: [],
    allUsers: [],
    allItems: [],
    banner: null,
    logs: [],
    history: [],
    histIdx: -1,
    sending: false
  };

  try {
    var savedLogs = JSON.parse(sessionStorage.getItem(LOG_STORAGE_KEY) || '[]');
    if (Array.isArray(savedLogs)) state.logs = savedLogs.slice(-40);
    var savedHist = JSON.parse(sessionStorage.getItem(HIST_STORAGE_KEY) || '[]');
    if (Array.isArray(savedHist)) state.history = savedHist.slice(-30);
  } catch (_) {}

  function getProf() {
    return (global.ArcadeAuth && typeof global.ArcadeAuth.getProfile === 'function')
      ? global.ArcadeAuth.getProfile()
      : null;
  }

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtRemain(ms) {
    var sec = Math.max(0, Math.floor(ms / 1000));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function saveLogs() {
    try { sessionStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(state.logs.slice(-40))); } catch (_) {}
  }

  function saveHist() {
    try { sessionStorage.setItem(HIST_STORAGE_KEY, JSON.stringify(state.history.slice(-30))); } catch (_) {}
  }

  function pushLog(kind, text) {
    var d = new Date();
    var hh = String(d.getHours()).padStart(2, '0');
    var mm = String(d.getMinutes()).padStart(2, '0');
    var ss = String(d.getSeconds()).padStart(2, '0');
    state.logs.push({ kind: kind, time: hh + ':' + mm + ':' + ss, text: String(text || '') });
    if (state.logs.length > 40) state.logs.shift();
    saveLogs();
    renderLogArea();
  }

  function injectStyles() {
    if (document.getElementById('arcadeAdminPanelStyles')) return;
    var st = document.createElement('style');
    st.id = 'arcadeAdminPanelStyles';
    st.textContent = [
      '.adm-dark-scroll::-webkit-scrollbar{width:6px;height:6px;}',
      '.adm-dark-scroll::-webkit-scrollbar-track{background:#090d16;border-radius:999px;}',
      '.adm-dark-scroll::-webkit-scrollbar-thumb{background:#334155;border-radius:999px;}',
      '.adm-dark-scroll::-webkit-scrollbar-thumb:hover{background:#475569;}',
      '#arcadeGlobalEventBar{position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:9990;display:flex;flex-direction:column;align-items:center;gap:6px;max-width:min(94vw,640px);pointer-events:none;}',
      '#arcadeGlobalEventBar .adm-banner-pill{pointer-events:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:center;padding:7px 13px;border-radius:999px;font-size:12px;font-weight:800;box-shadow:0 8px 24px rgba(0,0,0,0.45);backdrop-filter:blur(8px);}',
      '#arcadeAdminFab{position:fixed;bottom:54px;left:12px;z-index:9992;display:none;align-items:center;gap:6px;padding:8px 13px;border-radius:999px;border:1px solid rgba(251,191,36,0.55);background:linear-gradient(135deg,rgba(15,23,42,0.95),rgba(30,27,75,0.95));color:#fde68a;font-size:12px;font-weight:900;cursor:pointer;box-shadow:0 8px 22px rgba(0,0,0,0.5);transition:transform .15s,box-shadow .15s;}',
      '#arcadeAdminFab:hover{transform:translateY(-1px);box-shadow:0 10px 26px rgba(251,191,36,0.25);}',
      '#arcadeAdminDrawer{position:fixed;bottom:98px;left:12px;z-index:9993;display:none;flex-direction:column;width:min(450px,calc(100vw - 24px));max-height:min(540px,calc(100vh - 130px));background:rgba(9,13,24,0.97);border:1px solid rgba(251,191,36,0.4);border-radius:18px;box-shadow:0 18px 50px rgba(0,0,0,0.7);color:#e2e8f0;overflow:hidden;font-family:Pretendard,"Noto Sans KR",sans-serif;}',
      '#arcadeAdminManualModal{position:fixed;inset:0;z-index:9998;display:none;align-items:center;justify-content:center;background:rgba(2,6,23,0.78);backdrop-filter:blur(4px);padding:14px;font-family:Pretendard,"Noto Sans KR",sans-serif;}'
    ].join('');
    document.head.appendChild(st);
  }

  // ==================== 1. Global Event Banner (All Users) ====================
  function ensureGlobalBanner() {
    var el = document.getElementById('arcadeGlobalEventBar');
    if (!el) {
      el = document.createElement('div');
      el.id = 'arcadeGlobalEventBar';
      document.body.appendChild(el);
    }
    return el;
  }

  function renderGlobalBanner() {
    var bar = ensureGlobalBanner();
    var b = state.banner;
    if (!b) { bar.innerHTML = ''; return; }
    var now = Date.now();
    var html = '';

    if (b.maintenance && b.maintenance.active && b.maintenance.endsAt > now) {
      html += '<div class="adm-banner-pill" style="background:rgba(127,29,29,0.94);border:1px solid rgba(248,113,113,0.7);color:#fecaca;">' +
        '<span>🔧 점검 예고 (' + fmtRemain(b.maintenance.endsAt - now) + ')</span>' +
        '<span style="color:#ffffff;font-weight:700;">' + esc(b.maintenance.reason || '서버 업데이트 예정') + '</span>' +
      '</div>';
    }

    if (b.hotTime && b.hotTime.active && b.hotTime.endsAt > now) {
      html += '<div class="adm-banner-pill" style="background:rgba(124,45,18,0.92);border:1px solid rgba(251,146,60,0.75);color:#fed7aa;">' +
        '<span>🔥 핫타임 ' + esc(b.hotTime.label || (b.hotTime.multiplier + '배')) + '</span>' +
        '<span style="color:#fde047;">남은 ' + fmtRemain(b.hotTime.endsAt - now) + '</span>' +
      '</div>';
    }

    if (b.tradeFrozen) {
      html += '<div class="adm-banner-pill" style="background:rgba(30,41,59,0.94);border:1px solid rgba(148,163,184,0.55);color:#e2e8f0;">' +
        '<span>🔒 거래소 · 1:1 거래 일시 중지 중</span>' +
      '</div>';
    }

    if (b.fcfsEvent && b.fcfsEvent.endsAt > now && b.fcfsEvent.claimedCount < b.fcfsEvent.maxWinners) {
      var fc = b.fcfsEvent;
      html += '<div class="adm-banner-pill" style="background:rgba(49,46,129,0.95);border:1px solid rgba(129,140,248,0.8);color:#e0e7ff;">' +
        '<span>⚡ 선착순 [' + esc(fc.keyword) + '] · +' + Number(fc.reward || 0).toLocaleString() + ' 스타 (' + fc.claimedCount + '/' + fc.maxWinners + '명 · ' + fmtRemain(fc.endsAt - now) + ')</span>' +
        '<button type="button" data-fcfs-claim="' + esc(fc.keyword) + '" style="padding:3px 10px;border-radius:999px;border:none;background:#facc15;color:#1e1b4b;font-size:11px;font-weight:900;cursor:pointer;">지금 받기!</button>' +
      '</div>';
    }

    bar.innerHTML = html;
    var btn = bar.querySelector('[data-fcfs-claim]');
    if (btn) {
      btn.addEventListener('click', function () {
        var kw = btn.getAttribute('data-fcfs-claim') || '';
        var p = getProf();
        if (!p || !p.save_code) { alert('로그인 후 참여할 수 있습니다.'); return; }
        btn.disabled = true;
        btn.textContent = '처리 중...';
        fetch('/api/events/fcfs/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-save-code': p.save_code },
          body: JSON.stringify({ save_code: p.save_code, keyword: kw })
        })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            alert(d && d.ok ? d.message : (d && d.error ? d.error : '참여에 실패했습니다.'));
            if (d && d.ok && global.ArcadeEconomy && global.ArcadeEconomy.refresh) {
              global.ArcadeEconomy.refresh(null, true);
            }
          })
          .catch(function () { alert('네트워크 오류가 발생했습니다.'); });
      });
    }
  }

  // ==================== 2. Floating Admin Drawer + Autocomplete ====================
  function ensureAdminDom() {
    if (!document.getElementById('arcadeAdminFab')) {
      var fab = document.createElement('button');
      fab.id = 'arcadeAdminFab';
      fab.type = 'button';
      fab.title = '관리자 명령어 패널 열기/닫기 (Ctrl+Shift+A)';
      fab.innerHTML = '<span>🛡️</span><span>관리자</span>';
      fab.addEventListener('click', function () { togglePanel(); });
      document.body.appendChild(fab);
    }

    if (!document.getElementById('arcadeAdminDrawer')) {
      var dr = document.createElement('div');
      dr.id = 'arcadeAdminDrawer';
      dr.innerHTML = [
        '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:linear-gradient(90deg,#131a2e,#1e1b4b);border-bottom:1px solid rgba(251,191,36,0.25);">',
          '<div style="display:flex;align-items:center;gap:6px;">',
            '<span style="font-size:14px;">🛡️</span>',
            '<strong style="font-size:13px;color:#fde68a;font-weight:900;">관리자 명령어 콘솔</strong>',
            '<span style="font-size:10px;color:#94a3b8;">Ctrl+Shift+A</span>',
          '</div>',
          '<div style="display:flex;align-items:center;gap:5px;">',
            '<button type="button" id="admBtnOpenManual" style="padding:4px 9px;border-radius:8px;border:1px solid rgba(56,189,248,0.45);background:rgba(56,189,248,0.14);color:#7dd3fc;font-size:11px;font-weight:900;cursor:pointer;">📖 설명서</button>',
            '<button type="button" id="admBtnClearLogs" style="padding:4px 7px;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#94a3b8;font-size:10px;font-weight:800;cursor:pointer;">지우기</button>',
            '<button type="button" id="admBtnCloseDrawer" style="padding:3px 7px;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#cbd5e1;font-size:12px;font-weight:900;cursor:pointer;">✕</button>',
          '</div>',
        '</div>',
        '<div style="display:flex;flex-wrap:wrap;gap:5px;padding:7px 10px;background:#0b1120;border-bottom:1px solid #1e293b;">',
          '<button type="button" data-adm-quick="/현황" style="padding:3px 8px;border-radius:999px;border:1px solid #334155;background:#111827;color:#93c5fd;font-size:10px;font-weight:800;cursor:pointer;">📊 현황</button>',
          '<button type="button" data-adm-quick="/접속자" style="padding:3px 8px;border-radius:999px;border:1px solid #334155;background:#111827;color:#86efac;font-size:10px;font-weight:800;cursor:pointer;">👥 접속자</button>',
          '<button type="button" data-adm-quick="/서버" style="padding:3px 8px;border-radius:999px;border:1px solid #334155;background:#111827;color:#c4b5fd;font-size:10px;font-weight:800;cursor:pointer;">🖥️ 서버</button>',
          '<button type="button" data-adm-quick="/문의" style="padding:3px 8px;border-radius:999px;border:1px solid #334155;background:#111827;color:#fda4af;font-size:10px;font-weight:800;cursor:pointer;">📩 문의</button>',
          '<button type="button" data-adm-quick="/보스" style="padding:3px 8px;border-radius:999px;border:1px solid rgba(244,63,94,0.45);background:rgba(244,63,94,0.12);color:#fda4af;font-size:10px;font-weight:800;cursor:pointer;">⚔️ 보스</button>',
          '<button type="button" data-adm-quick="/선물상자" style="padding:3px 8px;border-radius:999px;border:1px solid rgba(251,191,36,0.45);background:rgba(251,191,36,0.12);color:#fde68a;font-size:10px;font-weight:800;cursor:pointer;">🎁 상자</button>',
          '<button type="button" data-adm-quick="/백업" style="padding:3px 8px;border-radius:999px;border:1px solid rgba(16,185,129,0.45);background:rgba(16,185,129,0.12);color:#6ee7b7;font-size:10px;font-weight:800;cursor:pointer;">💾 백업</button>',
        '</div>',
        '<div id="admLogBox" class="adm-dark-scroll" style="flex:1;min-height:190px;max-height:290px;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:6px;font-size:11.5px;line-height:1.45;background:#060a14;"></div>',
        '<div id="admSuggestBox" class="adm-dark-scroll" style="display:none;max-height:150px;overflow-y:auto;background:#0f172a;border-top:1px solid #1e293b;padding:4px;"></div>',
        '<div id="admHintBar" style="display:none;padding:6px 10px;background:#111a2e;border-top:1px solid rgba(56,189,248,0.3);font-size:11px;line-height:1.4;color:#cbd5e1;"></div>',
        '<form id="admCmdForm" style="display:flex;gap:6px;padding:9px 10px;background:#0b1120;border-top:1px solid #1e293b;">',
          '<input id="admCmdInput" type="text" autocomplete="off" placeholder="/명령어 입력 (예: /확성기, /지급, /도움)" style="flex:1;min-width:0;background:#060a14;border:1px solid #334155;border-radius:10px;padding:8px 10px;color:#f8fafc;font-size:12px;outline:none;" />',
          '<button type="submit" style="padding:8px 13px;border-radius:10px;border:none;background:#f59e0b;color:#1e1b4b;font-size:12px;font-weight:900;cursor:pointer;flex-shrink:0;">실행</button>',
        '</form>'
      ].join('');
      document.body.appendChild(dr);

      document.getElementById('admBtnCloseDrawer').addEventListener('click', function () { togglePanel(false); });
      document.getElementById('admBtnOpenManual').addEventListener('click', function () { openManualModal(); });
      document.getElementById('admBtnClearLogs').addEventListener('click', function () {
        state.logs = [];
        saveLogs();
        renderLogArea();
      });

      dr.querySelectorAll('[data-adm-quick]').forEach(function (b) {
        b.addEventListener('click', function () {
          executeCommand(b.getAttribute('data-adm-quick'));
        });
      });

      var inp = document.getElementById('admCmdInput');
      inp.addEventListener('input', renderSuggestions);
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowUp') {
          if (state.history.length > 0) {
            e.preventDefault();
            if (state.histIdx === -1) state.histIdx = state.history.length - 1;
            else if (state.histIdx > 0) state.histIdx--;
            inp.value = state.history[state.histIdx] || '';
            renderSuggestions();
          }
        } else if (e.key === 'ArrowDown') {
          if (state.history.length > 0 && state.histIdx !== -1) {
            e.preventDefault();
            if (state.histIdx < state.history.length - 1) {
              state.histIdx++;
              inp.value = state.history[state.histIdx] || '';
            } else {
              state.histIdx = -1;
              inp.value = '';
            }
            renderSuggestions();
          }
        } else if (e.key === 'Tab') {
          var firstBtn = document.querySelector('#admSuggestBox [data-sug-val]');
          if (firstBtn) {
            e.preventDefault();
            applySuggestion(firstBtn.getAttribute('data-sug-val'));
          }
        } else if (e.key === 'Escape') {
          document.getElementById('admSuggestBox').style.display = 'none'; var hbHide = document.getElementById('admHintBar'); if (hbHide) hbHide.style.display = 'none';
        }
      });

      document.getElementById('admCmdForm').addEventListener('submit', function (e) {
        e.preventDefault();
        var txt = inp.value.trim();
        if (!txt) { inp.focus(); return; }
        inp.value = '';
        document.getElementById('admSuggestBox').style.display = 'none'; var hbHide = document.getElementById('admHintBar'); if (hbHide) hbHide.style.display = 'none';
        executeCommand(txt);
        inp.focus();
      });
    }

    if (!document.getElementById('arcadeAdminManualModal')) {
      var mm = document.createElement('div');
      mm.id = 'arcadeAdminManualModal';
      mm.addEventListener('click', function (e) {
        if (e.target === mm) closeManualModal();
      });
      document.body.appendChild(mm);
    }
  }

  function renderLogArea() {
    var box = document.getElementById('admLogBox');
    if (!box) return;
    if (state.logs.length === 0) {
      box.innerHTML = '<div style="color:#64748b;text-align:center;padding:24px 8px;">관리자 명령어를 입력하거나 상단 퀵버튼을 눌러보세요.<br><span style="color:#38bdf8;">/도움</span> 입력 또는 우측 상단 <strong style="color:#7dd3fc;">📖 설명서</strong>를 열어 전체 명령어를 확인할 수 있습니다.</div>';
      return;
    }
    var html = '';
    state.logs.forEach(function (item) {
      var bg = item.kind === 'cmd' ? 'rgba(30,41,59,0.7)' : item.kind === 'err' ? 'rgba(127,29,29,0.38)' : 'rgba(15,23,42,0.9)';
      var bd = item.kind === 'cmd' ? '#334155' : item.kind === 'err' ? 'rgba(248,113,113,0.4)' : '#1e293b';
      var col = item.kind === 'cmd' ? '#fde68a' : item.kind === 'err' ? '#fca5a5' : '#e2e8f0';
      html += '<div style="padding:6px 8px;border-radius:10px;background:' + bg + ';border:1px solid ' + bd + ';white-space:pre-wrap;word-break:break-word;color:' + col + ';">' +
        '<span style="color:#64748b;font-size:10px;margin-right:6px;">[' + esc(item.time) + ']</span>' +
        esc(item.text) +
      '</div>';
    });
    box.innerHTML = html;
    box.scrollTop = box.scrollHeight;
  }

  function applySuggestion(val) {
    var inp = document.getElementById('admCmdInput');
    if (!inp) return;
    inp.value = val;
    inp.focus();
    renderSuggestions();
  }

  function renderSuggestions() {
    var box = document.getElementById('admSuggestBox');
    var hintBar = document.getElementById('admHintBar');
    var inp = document.getElementById('admCmdInput');
    if (!box || !inp) return;
    var val = inp.value;
    if (!val || !val.startsWith('/')) {
      box.style.display = 'none';
      if (hintBar) hintBar.style.display = 'none';
      return;
    }

    var parts = val.split(/\s+/);
    var firstCmd = parts[0].toLowerCase();

    // 1) 항상 끝까지 유지되는 명령어 문법 & 예시 안내 바
    var exactManual = (state.manual || []).find(function (m) {
      return m.cmd.split(/\s+/)[0].toLowerCase() === firstCmd;
    });
    if (hintBar) {
      if (exactManual) {
        hintBar.innerHTML =
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">' +
            '<span style="color:#fde68a;font-weight:900;">' + esc(exactManual.cmd) + '</span>' +
            '<span style="color:#7dd3fc;font-size:10.5px;">예: ' + esc(exactManual.ex) + '</span>' +
          '</div>' +
          '<div style="color:#94a3b8;font-size:10.5px;margin-top:2px;">' + esc(exactManual.desc) + '</div>';
        hintBar.style.display = 'block';
      } else {
        hintBar.style.display = 'none';
      }
    }

    var html = '';

    // 2) 첫 토큰: 명령어 자동완성
    if (parts.length === 1) {
      var q = firstCmd;
      var matches = (state.manual || []).filter(function (m) {
        var base = m.cmd.split(/\s+/)[0].toLowerCase();
        return base.indexOf(q) === 0 || m.desc.toLowerCase().indexOf(q.slice(1)) !== -1;
      }).slice(0, 8);
      if (matches.length === 0) { box.style.display = 'none'; return; }
      matches.forEach(function (m) {
        var base = m.cmd.split(/\s+/)[0] + ' ';
        html += '<button type="button" data-sug-val="' + esc(base) + '" style="width:100%;text-align:left;padding:5px 8px;border-radius:8px;border:none;background:transparent;color:#e2e8f0;font-size:11px;cursor:pointer;display:flex;justify-content:space-between;gap:8px;">' +
          '<span style="color:#fde68a;font-weight:900;white-space:nowrap;">' + esc(m.cmd) + '</span>' +
          '<span style="color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(m.desc) + '</span>' +
        '</button>';
      });
    } else if (parts.length === 2) {
      // 3) 두 번째 토큰: 유저 닉네임 자동완성 (접속자 🟢 + 미접속자 ⚫ 모두 표시!)
      var nickCmds = ['/지급', '/차감', '/알림', '/아이템', '/아이템회수', '/낚싯대지급', '/낚싯대회수', '/압수', '/낚싯대압수', '/채금', '/채금해제', '/강퇴', '/조회', '/코드', '/미끼초기화', '/레이드초기화'];
      if (nickCmds.indexOf(firstCmd) !== -1) {
        var nq = parts[1].toLowerCase();
        var userPool = (state.allUsers && state.allUsers.length > 0)
          ? state.allUsers
          : (state.onlineNicknames || []).map(function (n) { return { nickname: n, online: true }; });
        var nMatches = userPool.filter(function (u) {
          return !nq || String(u.nickname || '').toLowerCase().indexOf(nq) !== -1;
        }).slice(0, 14);
        if (nMatches.length === 0) { box.style.display = 'none'; return; }
        nMatches.forEach(function (u) {
          var nextVal = parts[0] + ' ' + u.nickname + ' ';
          var dot = u.online ? '🟢' : '⚫';
          var col = u.online ? '#86efac' : '#94a3b8';
          var tag = u.online ? '' : ' <span style="font-size:10px;color:#64748b;">(미접속)</span>';
          html += '<button type="button" data-sug-val="' + esc(nextVal) + '" style="width:100%;text-align:left;padding:5px 8px;border-radius:8px;border:none;background:transparent;color:#e2e8f0;font-size:11px;cursor:pointer;">' +
            '<span style="color:' + col + ';font-weight:800;">' + dot + ' ' + esc(u.nickname) + '</span>' + tag +
          '</button>';
        });
      } else if (firstCmd === '/날씨') {
        ['폭풍', '황금', '무지개', '맑음'].forEach(function (w) {
          if (!parts[1] || w.indexOf(parts[1]) !== -1) {
            html += '<button type="button" data-sug-val="/날씨 ' + w + '" style="width:100%;text-align:left;padding:5px 8px;border-radius:8px;border:none;background:transparent;color:#7dd3fc;font-size:11px;font-weight:800;cursor:pointer;">🌦️ ' + w + '</button>';
          }
        });
      } else if (firstCmd === '/거래정지') {
        ['on', 'off'].forEach(function (v) {
          html += '<button type="button" data-sug-val="/거래정지 ' + v + '" style="width:100%;text-align:left;padding:5px 8px;border-radius:8px;border:none;background:transparent;color:#fde68a;font-size:11px;font-weight:800;cursor:pointer;">🔒 ' + v + '</button>';
        });
      } else if (firstCmd === '/대회') {
        ['시작 10', '종료'].forEach(function (v) {
          html += '<button type="button" data-sug-val="/대회 ' + v + '" style="width:100%;text-align:left;padding:5px 8px;border-radius:8px;border:none;background:transparent;color:#fde68a;font-size:11px;font-weight:800;cursor:pointer;">🏆 ' + v + '</button>';
        });
      } else {
        box.style.display = 'none';
        return;
      }
    } else if (parts.length === 3 && (firstCmd === '/아이템' || firstCmd === '/아이템회수' || firstCmd === '/압수')) {
      // 4) 세 번째 토큰: 전체 아이템(소모품·칭호·컬러·구슬스킨 전부) 자동완성
      var iq = String(parts[2] || '').toLowerCase();
      var pool = (state.allItems && state.allItems.length > 0)
        ? state.allItems
        : [
            { key: '방지권', name: '🛡️ 대장간 파괴 방지권', cat: '소모품' },
            { key: '상자', name: '🧰 보물상자', cat: '소모품' },
            { key: '복권', name: '🎫 황금 복권', cat: '소모품' },
            { key: '미끼', name: '🪱 추가 미끼', cat: '소모품' }
          ];
      var iMatches = pool.filter(function (it) {
        if (!iq) return true;
        return String(it.name || '').toLowerCase().indexOf(iq) !== -1
          || String(it.key || '').toLowerCase().indexOf(iq) !== -1
          || String(it.cat || '').toLowerCase().indexOf(iq) !== -1;
      }).slice(0, 16);
      iMatches.forEach(function (it) {
        var nextVal = parts[0] + ' ' + parts[1] + ' ' + it.key + ' ';
        html += '<button type="button" data-sug-val="' + esc(nextVal) + '" style="width:100%;text-align:left;padding:5px 8px;border-radius:8px;border:none;background:transparent;color:#e2e8f0;font-size:11px;cursor:pointer;display:flex;justify-content:space-between;gap:8px;">' +
          '<span style="color:#fde68a;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">[' + esc(it.cat) + '] ' + esc(it.name) + '</span>' +
          '<span style="color:#64748b;font-size:10px;white-space:nowrap;">' + esc(it.key) + '</span>' +
        '</button>';
      });
    } else {
      box.style.display = 'none';
      return;
    }

    if (!html) { box.style.display = 'none'; return; }
    box.innerHTML = html;
    box.style.display = 'block';
    box.querySelectorAll('[data-sug-val]').forEach(function (b) {
      b.addEventListener('click', function () {
        applySuggestion(b.getAttribute('data-sug-val'));
      });
    });
  }

  function executeCommand(rawCmd) {
    var cmd = String(rawCmd || '').trim();
    if (!cmd || state.sending) return;
    var p = getProf();
    if (!p || !p.save_code) {
      pushLog('err', '관리자 로그인 정보를 확인할 수 없습니다.');
      return;
    }
    if (state.history[state.history.length - 1] !== cmd) {
      state.history.push(cmd);
      if (state.history.length > 30) state.history.shift();
      saveHist();
    }
    state.histIdx = -1;
    pushLog('cmd', '> ' + cmd);
    state.sending = true;
    fetch('/api/admin/command', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-save-code': p.save_code
      },
      body: JSON.stringify({ command: cmd })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        state.sending = false;
        if (res.ok && res.d && res.d.ok) {
          pushLog('res', res.d.output || '완료되었습니다.');
          if (res.d.banner) {
            state.banner = res.d.banner;
            renderGlobalBanner();
          }
          if (global.ArcadeEconomy && global.ArcadeEconomy.refresh) {
            global.ArcadeEconomy.refresh(null, true);
          }
        } else {
          pushLog('err', '⚠️ ' + (res.d && res.d.error ? res.d.error : '명령어 실행에 실패했습니다.'));
        }
      })
      .catch(function () {
        state.sending = false;
        pushLog('err', '⚠️ 서버 통신 오류가 발생했습니다.');
      });
  }

  function togglePanel(force) {
    ensureAdminDom();
    state.panelOpen = typeof force === 'boolean' ? force : !state.panelOpen;
    var dr = document.getElementById('arcadeAdminDrawer');
    if (dr) dr.style.display = state.panelOpen ? 'flex' : 'none';
    if (state.panelOpen) {
      fetchPanelState();
      renderLogArea();
      var inp = document.getElementById('admCmdInput');
      if (inp) setTimeout(function () { inp.focus(); }, 30);
    }
  }

  // ==================== 3. Interactive 📖 Command Manual Modal ====================
  function openManualModal() {
    ensureAdminDom();
    state.manualOpen = true;
    var mm = document.getElementById('arcadeAdminManualModal');
    if (mm) mm.style.display = 'flex';
    renderManualModal();
  }

  function closeManualModal() {
    state.manualOpen = false;
    var mm = document.getElementById('arcadeAdminManualModal');
    if (mm) mm.style.display = 'none';
  }

  function renderManualModal() {
    var mm = document.getElementById('arcadeAdminManualModal');
    if (!mm || !state.manualOpen) return;
    var cats = ['전체', '공지·소통', '재화·아이템', '이벤트·재미', '낚시터 제어', '어뷰징·긴급', '조회·모니터링'];
    var q = state.manualQuery.trim().toLowerCase();
    var items = (state.manual || []).filter(function (m) {
      if (state.manualCat !== '전체' && m.cat !== state.manualCat) return false;
      if (!q) return true;
      return m.cmd.toLowerCase().indexOf(q) !== -1 || m.desc.toLowerCase().indexOf(q) !== -1 || m.ex.toLowerCase().indexOf(q) !== -1;
    });

    var catBtns = cats.map(function (c) {
      var active = state.manualCat === c;
      return '<button type="button" data-man-cat="' + esc(c) + '" style="padding:5px 10px;border-radius:999px;font-size:11px;font-weight:900;cursor:pointer;border:1px solid ' +
        (active ? '#38bdf8' : '#334155') + ';background:' + (active ? 'rgba(56,189,248,0.2)' : '#0f172a') + ';color:' + (active ? '#e0f2fe' : '#94a3b8') + ';">' + esc(c) + '</button>';
    }).join('');

    var cards = items.map(function (m) {
      return '<div style="padding:10px 12px;border-radius:12px;background:#0b1120;border:1px solid #1e293b;display:flex;flex-direction:column;gap:5px;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">' +
          '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
            '<span style="padding:2px 7px;border-radius:999px;background:rgba(99,102,241,0.2);color:#a5b4fc;font-size:10px;font-weight:800;">' + esc(m.cat) + '</span>' +
            '<code style="color:#fde68a;font-size:12.5px;font-weight:900;">' + esc(m.cmd) + '</code>' +
          '</div>' +
          '<button type="button" data-man-fill="' + esc(m.ex) + '" style="padding:4px 9px;border-radius:8px;border:1px solid rgba(251,191,36,0.45);background:rgba(251,191,36,0.14);color:#fde68a;font-size:10px;font-weight:900;cursor:pointer;">⌨️ 예시 넣기</button>' +
        '</div>' +
        '<div style="font-size:11.5px;color:#cbd5e1;">' + esc(m.desc) + '</div>' +
        '<div style="font-size:11px;color:#64748b;">예시: <span style="color:#7dd3fc;">' + esc(m.ex) + '</span></div>' +
      '</div>';
    }).join('');

    mm.innerHTML =
      '<div style="width:min(680px,100%);max-height:86vh;display:flex;flex-direction:column;background:#090d18;border:1px solid rgba(56,189,248,0.4);border-radius:20px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,0.75);color:#e2e8f0;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;padding:13px 16px;background:linear-gradient(90deg,#111827,#1e1b4b);border-bottom:1px solid #1e293b;">' +
          '<div>' +
            '<div style="font-size:15px;font-weight:900;color:#7dd3fc;">📖 관리자 명령어 설명서 (총 ' + (state.manual ? state.manual.length : 0) + '개)</div>' +
            '<div style="font-size:11px;color:#94a3b8;margin-top:2px;">예시 넣기를 누르면 콘솔 입력창에 바로 채워집니다 · 단축키 Ctrl+Shift+A</div>' +
          '</div>' +
          '<button type="button" id="admManCloseBtn" style="padding:6px 10px;border-radius:10px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;font-size:12px;font-weight:900;cursor:pointer;">닫기 ✕</button>' +
        '</div>' +
        '<div style="padding:10px 14px;background:#0b1120;border-bottom:1px solid #1e293b;display:flex;flex-direction:column;gap:8px;">' +
          '<input id="admManSearchInput" type="text" value="' + esc(state.manualQuery) + '" placeholder="명령어 또는 기능 검색 (예: 보스, 지급, 채금, 백업)..." style="width:100%;box-sizing:border-box;background:#060a14;border:1px solid #334155;border-radius:10px;padding:8px 11px;color:#fff;font-size:12px;outline:none;" />' +
          '<div style="display:flex;flex-wrap:wrap;gap:5px;">' + catBtns + '</div>' +
        '</div>' +
        '<div class="adm-dark-scroll" style="flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:8px;">' +
          (cards || '<div style="text-align:center;color:#64748b;padding:30px 0;font-size:12px;">검색 결과가 없습니다.</div>') +
        '</div>' +
      '</div>';

    document.getElementById('admManCloseBtn').addEventListener('click', closeManualModal);
    var sInp = document.getElementById('admManSearchInput');
    sInp.addEventListener('input', function () {
      state.manualQuery = sInp.value;
      renderManualModal();
      var nextInp = document.getElementById('admManSearchInput');
      if (nextInp) {
        nextInp.focus();
        nextInp.setSelectionRange(nextInp.value.length, nextInp.value.length);
      }
    });
    mm.querySelectorAll('[data-man-cat]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.manualCat = b.getAttribute('data-man-cat');
        renderManualModal();
      });
    });
    mm.querySelectorAll('[data-man-fill]').forEach(function (b) {
      b.addEventListener('click', function () {
        var ex = b.getAttribute('data-man-fill') || '';
        closeManualModal();
        togglePanel(true);
        var inp = document.getElementById('admCmdInput');
        if (inp) {
          inp.value = ex;
          inp.focus();
        }
      });
    });
  }

  // ==================== 4. Bootstrap & Live Sync ====================
  function fetchPanelState() {
    var p = getProf();
    var headers = {};
    if (p && p.save_code) headers['x-admin-save-code'] = p.save_code;
    fetch('/api/admin/panel/state?t=' + Date.now(), { cache: 'no-store', headers: headers })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok) return;
        state.banner = d.banner || null;
        renderGlobalBanner();
        state.isAdmin = Boolean(d.isAdmin);
        if (state.isAdmin) {
          if (Array.isArray(d.manual)) state.manual = d.manual;
          if (Array.isArray(d.onlineNicknames)) state.onlineNicknames = d.onlineNicknames;
          if (Array.isArray(d.allUsers)) state.allUsers = d.allUsers;
          if (Array.isArray(d.allItems)) state.allItems = d.allItems;
          ensureAdminDom();
          var fab = document.getElementById('arcadeAdminFab');
          if (fab) fab.style.display = 'inline-flex';
        }
      })
      .catch(function () {});
  }

  function init() {
    injectStyles();
    fetchPanelState();

    // Global shortcut Ctrl+Shift+A
    document.addEventListener('keydown', function (e) {
      if (state.isAdmin && e.ctrlKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
        e.preventDefault();
        togglePanel();
      }
    });

    // Live countdown refresh for active banners (1s)
    setInterval(function () {
      if (state.banner && ((state.banner.hotTime && state.banner.hotTime.active) || (state.banner.maintenance && state.banner.maintenance.active) || state.banner.fcfsEvent)) {
        renderGlobalBanner();
      }
    }, 1000);

    // Periodic sync for online nicknames & late login detection
    setInterval(function () {
      if (document.visibilityState !== 'hidden') fetchPanelState();
    }, 20000);

    // Real-time Socket.IO banner updates
    if (typeof global.io === 'function') {
      try {
        var sock = global.io();
        sock.on('admin_banner_state', function (b) {
          state.banner = b || null;
          renderGlobalBanner();
        });
      } catch (_) {}
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.ArcadeAdminPanel = {
    toggle: togglePanel,
    openManual: openManualModal,
    refresh: fetchPanelState
  };
})(window);
