/**
 * ============================================================================
 * 공통 무패스워드 로그인 & 세이브 코드 & 내정보(1일 1회 닉네임 변경/통계) SDK
 * ============================================================================
 */
(function (global) {
  const STORAGE_KEYS = {
    CLIENT_UID: 'arcade_client_uid_v1',
    USER_ID: 'arcade_auth_user_id',
    SAVE_CODE: 'arcade_auth_save_code',
    NICKNAME: 'arcade_auth_nickname',
    PROFILE: 'arcade_auth_profile',
    LEGACY_MARBLE_PROFILE: 'marble_auth_profile',
    LEGACY_MARBLE_CODE: 'marble_auth_save_code',
    LEGACY_MARBLE_NAME: 'marble_my_name',
    LEGACY_OX_NICK: 'ox_nick_v3',
    LEGACY_OX_UID: 'ox_uid_v3',
    LEGACY_OX_ROLE: 'ox_role_v3'
  };

  function getOrCreateClientId() {
    try {
      let cid =
        localStorage.getItem(STORAGE_KEYS.CLIENT_UID) ||
        localStorage.getItem('marble_client_uid') ||
        localStorage.getItem(STORAGE_KEYS.LEGACY_OX_UID);
      if (!cid) {
        cid = 'u_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
      }
      localStorage.setItem(STORAGE_KEYS.CLIENT_UID, cid);
      localStorage.setItem('marble_client_uid', cid);
      localStorage.setItem(STORAGE_KEYS.LEGACY_OX_UID, cid);
      return cid;
    } catch (_) {
      return 'u_mem_' + Math.random().toString(36).slice(2, 9);
    }
  }

  function getStoredProfile() {
    try {
      const raw =
        localStorage.getItem(STORAGE_KEYS.PROFILE) ||
        localStorage.getItem(STORAGE_KEYS.LEGACY_MARBLE_PROFILE);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.nickname && parsed.save_code) {
          return parsed;
        }
      }
    } catch (_) {}
    return null;
  }

  function syncAllStorageKeys(profile) {
    if (!profile || !profile.nickname) return;
    try {
      const jsonStr = JSON.stringify(profile);
      localStorage.setItem(STORAGE_KEYS.PROFILE, jsonStr);
      localStorage.setItem(STORAGE_KEYS.USER_ID, profile.id || '');
      localStorage.setItem(STORAGE_KEYS.SAVE_CODE, profile.save_code || '');
      localStorage.setItem(STORAGE_KEYS.NICKNAME, profile.nickname);

      localStorage.setItem(STORAGE_KEYS.LEGACY_MARBLE_PROFILE, jsonStr);
      localStorage.setItem(STORAGE_KEYS.LEGACY_MARBLE_CODE, profile.save_code || '');
      localStorage.setItem(STORAGE_KEYS.LEGACY_MARBLE_NAME, profile.nickname);
      localStorage.setItem(STORAGE_KEYS.LEGACY_OX_NICK, profile.nickname);
      if (profile.id) {
        localStorage.setItem(STORAGE_KEYS.LEGACY_OX_UID, profile.id);
      }
    } catch (_) {}
  }

  function clearStoredProfile() {
    try {
      Object.values(STORAGE_KEYS).forEach((k) => {
        if (k !== STORAGE_KEYS.CLIENT_UID) localStorage.removeItem(k);
      });
      localStorage.removeItem('marble_my_id');
      localStorage.removeItem('marble_auth_user_id');
    } catch (_) {}
  }

  async function registerNickname(nickname) {
    const clean = String(nickname || '').trim().slice(0, 16);
    if (!clean) throw new Error('닉네임을 입력해주세요.');

    const clientId = getOrCreateClientId();
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: clean, clientId })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || '닉네임 생성에 실패했습니다.');
    }
    if (data && data.user) {
      syncAllStorageKeys(data.user);
      return data.user;
    }
    throw new Error('서버 응답 오류');
  }

  async function loadBySaveCode(saveCode) {
    const cleanCode = String(saveCode || '').trim().toUpperCase();
    if (cleanCode.length !== 8) {
      throw new Error('8자리 세이브 코드를 정확히 입력해주세요.');
    }
    const clientId = getOrCreateClientId();
    const res = await fetch('/api/sync/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ save_code: cleanCode, clientId })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || '일치하는 세이브 코드를 찾을 수 없습니다.');
    }
    if (data && data.user) {
      syncAllStorageKeys(data.user);
      return data.user;
    }
    throw new Error('코드 불러오기 실패');
  }

  async function refreshMyProfile() {
    const prof = getStoredProfile();
    if (!prof || !prof.save_code) return null;
    try {
      const res = await fetch('/api/user/profile?save_code=' + encodeURIComponent(prof.save_code));
      if (res.ok) {
        const data = await res.json();
        if (data && data.user) {
          syncAllStorageKeys(data.user);
          return data.user;
        }
      } else if (res.status === 404 && prof.nickname && prof.save_code) {
        const rRes = await fetch('/api/auth/auto-restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(prof)
        });
        if (rRes.ok) {
          const rData = await rRes.json();
          if (rData && rData.user) {
            syncAllStorageKeys(rData.user);
            return rData.user;
          }
        }
      }
    } catch (_) {}
    return prof;
  }

  async function changeNicknameOncePerDay(newNickname) {
    const prof = getStoredProfile();
    if (!prof || !prof.save_code) throw new Error('로그인이 필요합니다.');
    const clean = String(newNickname || '').trim().slice(0, 16);
    if (!clean) throw new Error('새 닉네임을 입력해주세요.');

    const res = await fetch('/api/auth/change-nickname', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        save_code: prof.save_code,
        new_nickname: clean,
        clientId: getOrCreateClientId()
      })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || '닉네임 변경에 실패했습니다.');
    }
    if (data && data.user) {
      syncAllStorageKeys(data.user);
      return data.user;
    }
    throw new Error('닉네임 변경 실패');
  }

  async function fetchGamesRegistry() {
    const res = await fetch('/api/games');
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.games) ? data.games : [];
  }

  // 1-Click HTTP(:3000) -> HTTPS 자동 계정 이관 수신 & 기존 주소 자동 이동
  (function handleHttpsAccountMigration() {
    try {
      var host = String(location.hostname || '');
      var isLocal = host === 'localhost' || host === '127.0.0.1' || /^192\.168\./.test(host) || /^10\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);

      // A) 새 HTTPS 주소에서 #migrate=CODE 수신 시 자동 복구 로그인
      var hash = String(location.hash || '');
      if (hash.indexOf('#migrate=') === 0) {
        var migCode = decodeURIComponent(hash.slice(9)).trim().toUpperCase();
        try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {}
        if (migCode && migCode.length >= 6) {
          fetch('/api/sync/load', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ save_code: migCode })
          })
            .then(function (r) { return r.json(); })
            .then(function (d) {
              if (d && d.ok && d.user) {
                saveProfile(d.user);
                location.reload();
              }
            })
            .catch(function () {});
        }
        return;
      }

      // B) 기존 외부 도메인 HTTP(:3000)로 접속한 기존 유저는 자동으로 HTTPS로 계정 이관 리다이렉트
      if (!isLocal && location.protocol === 'http:' && location.port === '3000' && location.pathname !== '/migrate-https') {
        var existingCode = localStorage.getItem(STORAGE_KEYS.SAVE_CODE) || localStorage.getItem(STORAGE_KEYS.LEGACY_MARBLE_CODE) || '';
        if (!existingCode) {
          var p = getProfile();
          if (p && p.save_code) existingCode = p.save_code;
        }
        existingCode = String(existingCode || '').trim().toUpperCase();
        if (existingCode) {
          location.replace('https://' + host + '/#migrate=' + encodeURIComponent(existingCode));
        }
      }
    } catch (_) {}
  })();

  global.ArcadeAuth = {
    getClientId: getOrCreateClientId,
    getProfile: getStoredProfile,
    saveProfile: syncAllStorageKeys,
    clearProfile: clearStoredProfile,
    registerNickname,
    loadBySaveCode,
    refreshMyProfile,
    changeNicknameOncePerDay,
    fetchGamesRegistry,
    formatStyledNameHtml: function (nickname, cosmetics, fallbackColor) {
      var esc = function (v) {
        return String(v == null ? '' : v)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      };
      var nick = esc(nickname || '');
      var cos = cosmetics && typeof cosmetics === 'object' ? cosmetics : {};
      var titleVal = cos.equippedTitle || cos.title || '';
      var colorVal = cos.equippedColor || cos.color || '';
      var titleHtml = titleVal ? '<span class="text-amber-300 font-black mr-1">' + esc(titleVal) + '</span>' : '';
      var colorStyle = '';
      if (colorVal === 'rainbow' || colorVal === 'rainbow_aurora') {
        var grad = colorVal === 'rainbow_aurora' ? 'linear-gradient(90deg,#22d3ee,#34d399,#818cf8,#f472b6)' : 'linear-gradient(90deg,#f472b6,#facc15,#34d399,#38bdf8,#c084fc)';
        colorStyle = ' style="background:' + grad + ';-webkit-background-clip:text;-webkit-text-fill-color:transparent;font-weight:900;"';
      } else if (colorVal && colorVal.indexOf('grad:') === 0) {
        var gCols = esc(colorVal.slice(5));
        colorStyle = ' style="background:linear-gradient(90deg,' + gCols + ');-webkit-background-clip:text;-webkit-text-fill-color:transparent;font-weight:900;"';
      } else if (colorVal && colorVal.indexOf('glow:') === 0) {
        var gc = esc(colorVal.slice(5));
        colorStyle = ' style="color:' + gc + ';text-shadow:0 0 8px ' + gc + ',0 0 14px ' + gc + ';"';
      } else if (colorVal) {
        colorStyle = ' style="color:' + esc(colorVal) + '"';
      } else if (fallbackColor) {
        colorStyle = ' style="color:' + esc(fallbackColor) + '"';
      }
      return titleHtml + '<span' + colorStyle + '>' + nick + '</span>';
    }
  };
})(window);

/* ARCADE_VERSION_START */
window.ArcadeNotifyUpdate = null;
window.ARCADE_VERSION = 'v1.7.22';
(function () {
  function getStoredProfile() {
    return window.ArcadeAuth && typeof window.ArcadeAuth.getProfile === 'function'
      ? window.ArcadeAuth.getProfile()
      : null;
  }
  function getOrCreateClientId() {
    return window.ArcadeAuth && typeof window.ArcadeAuth.getClientId === 'function'
      ? window.ArcadeAuth.getClientId()
      : '';
  }
  function mountVersionFooter() {
    if (!document.body || document.getElementById('arcade-version-footer')) return;
    var el = document.createElement('div');
    el.id = 'arcade-version-footer';
    el.textContent = 'webMiniGames ' + window.ARCADE_VERSION;
    el.style.cssText = 'width:100%;text-align:center;font-size:11px;font-weight:600;color:#475569;padding:6px 0 12px;letter-spacing:0.04em;pointer-events:none;user-select:none;';
    document.body.appendChild(el);
  }

  window.ArcadeNotifyUpdate = showUpdateBanner;
  function showUpdateBanner(serverVer) {
    if (!document.body || document.getElementById('arcade-update-banner')) return;
    var banner = document.createElement('div');
    banner.id = 'arcade-update-banner';
    banner.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:99999;background:#1e1b4b;border:1px solid #6366f1;color:#fff;padding:10px 14px;border-radius:14px;box-shadow:0 12px 30px rgba(0,0,0,0.45);display:flex;align-items:center;gap:10px;font-size:12px;font-weight:700;max-width:92vw;';
    banner.innerHTML = '<span>🔄 서버가 <strong>' + serverVer + '</strong>으로 업데이트되었습니다.</span>' +
      '<button id="arcade-reload-btn" type="button" style="background:#5851f6;color:#fff;border:none;padding:6px 12px;border-radius:10px;font-weight:800;font-size:11px;cursor:pointer;white-space:nowrap;">새로고침</button>';
    document.body.appendChild(banner);
    var btn = document.getElementById('arcade-reload-btn');
    if (btn) {
      btn.addEventListener('click', function () {
        window.location.href = window.location.pathname + '?v=' + Date.now();
      });
    }
  }

  function getCurrentPageLabel() {
    var p = (window.location && window.location.pathname) || '/';
    if (p.indexOf('/games/marble') !== -1) return '마블 룰렛';
    if (p.indexOf('/games/ox-quiz') !== -1) return 'OX 퀴즈';
    if (p.indexOf('/games/black-white') !== -1) return '흑과 백';
    if (p.indexOf('/games/russian-roulette') !== -1) return '러시안 룰렛';
    if (p.indexOf('/games/dice-21') !== -1) return '다이스 21';
    if (p.indexOf('/games/horse-racing') !== -1) return '로얄 경마';
    if (p.indexOf('/games/blackjack') !== -1) return '로얄 블랙잭';
    if (p.indexOf('/games/fishing') !== -1) return '힐링 낚시터';
    return '로비';
  }

  function sendHeartbeat() {
    var prof = getStoredProfile();
    var cid = window.ArcadeAuth && window.ArcadeAuth.getClientId ? window.ArcadeAuth.getClientId() : '';
    fetch('/api/auth/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        save_code: prof && prof.save_code ? prof.save_code : '',
        clientId: cid,
        nickname: (prof && prof.nickname) ? prof.nickname : '방문자',
        page: getCurrentPageLabel()
      })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && typeof d.count === 'number') {
          window.__arcadeOnlineCount = d.count;
          window.dispatchEvent(new CustomEvent('arcade-online-count', { detail: { count: d.count } }));
        }
      })
      .catch(function () {});
  }

  sendHeartbeat();
  setInterval(sendHeartbeat, 20000);
  window.addEventListener('pagehide', function () {
    if (!navigator.sendBeacon) return;
    var prof = getStoredProfile();
    var cid = window.ArcadeAuth && window.ArcadeAuth.getClientId ? window.ArcadeAuth.getClientId() : '';
    var blob = new Blob([JSON.stringify({ save_code: prof && prof.save_code ? prof.save_code : '', clientId: cid })], { type: 'application/json' });
    navigator.sendBeacon('/api/auth/offline', blob);
  });

  function checkServerVersion() {
    fetch('/api/version?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && d.version && window.ARCADE_VERSION && d.version !== window.ARCADE_VERSION) {
          showUpdateBanner(d.version);
        }
      })
      .catch(function () {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      mountVersionFooter();
      setTimeout(checkServerVersion, 2000);
    });
  } else {
    mountVersionFooter();
    setTimeout(checkServerVersion, 2000);
  }
  setInterval(checkServerVersion, 5000);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') checkServerVersion();
  });

  // ================= UNIFIED PER-SCREEN & PER-GAME WEB AUDIO BGM ENGINE =================
  (function setupArcadeBGM() {
    var path = (window.location && window.location.pathname) || '/';
    var pageGameTheme = 'lobby';
    if (path.indexOf('/games/marble') !== -1) pageGameTheme = 'marble';
    else if (path.indexOf('/games/ox-quiz') !== -1) pageGameTheme = 'ox-quiz';
    else if (path.indexOf('/games/horse-racing') !== -1) pageGameTheme = 'horse-racing';
    else if (path.indexOf('/games/blackjack') !== -1) pageGameTheme = 'blackjack';
    else if (path.indexOf('/games/black-white') !== -1) pageGameTheme = 'black-white';
    else if (path.indexOf('/games/russian-roulette') !== -1) pageGameTheme = 'russian-roulette';
    else if (path.indexOf('/games/dice-21') !== -1) pageGameTheme = 'dice-21';
    else if (path.indexOf('/games/fishing') !== -1) pageGameTheme = 'fishing';

    var STORAGE_KEY = 'arcade_bgm_enabled';
    var enabled = true;
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved === '0') enabled = false;
    } catch (_) {}

    var THEMES = {
      'lobby': {
        label: '🏠 메인 로비',
        stepMs: 295,
        bass: [130.81, 0, 196.00, 0, 110.00, 0, 164.81, 0, 87.31, 0, 130.81, 0, 98.00, 0, 146.83, 0],
        lead: [523.25, 0, 659.25, 587.33, 440.00, 0, 523.25, 493.88, 349.23, 0, 440.00, 523.25, 392.00, 493.88, 587.33, 0],
        wave: 'sine',
        bassWave: 'sine',
        cutoff: 1150
      },
      'room-select': {
        label: '🚪 방 선택',
        stepMs: 245,
        bass: [164.81, 0, 164.81, 246.94, 146.83, 0, 146.83, 220.00, 130.81, 0, 130.81, 196.00, 146.83, 0, 196.00, 0],
        lead: [659.25, 783.99, 659.25, 587.33, 523.25, 587.33, 659.25, 0, 587.33, 659.25, 523.25, 440.00, 493.88, 587.33, 659.25, 0],
        wave: 'triangle',
        bassWave: 'sine',
        cutoff: 1350
      },
      'map-editor': {
        label: '🎨 맵 에디터',
        stepMs: 320,
        bass: [146.83, 0, 220.00, 0, 130.81, 0, 196.00, 0, 110.00, 0, 164.81, 0, 130.81, 0, 146.83, 0],
        lead: [440.00, 523.25, 587.33, 0, 523.25, 493.88, 440.00, 0, 392.00, 440.00, 523.25, 0, 493.88, 440.00, 392.00, 0],
        wave: 'sine',
        bassWave: 'triangle',
        cutoff: 1000
      },
      'fishing': {
        label: '🎣 힐링 낚시터',
        stepMs: 850,
        ambientChords: [
          [261.63, 329.63, 392.00, 493.88],
          [220.00, 261.63, 329.63, 392.00],
          [174.61, 220.00, 261.63, 329.63],
          [196.00, 246.94, 293.66, 329.63]
        ],
        ambientMelody: [523.25, 587.33, 659.25, 783.99, 659.25, 587.33, 523.25, 440.00],
        bass: [],
        lead: [],
        wave: 'sine',
        bassWave: 'sine',
        cutoff: 780
      },
      'marble': {
        label: '🔮 아케이드 신스',
        stepMs: 225,
        bass: [130.81, 0, 130.81, 196.00, 146.83, 0, 164.81, 196.00, 174.61, 0, 174.61, 130.81, 196.00, 0, 146.83, 196.00],
        lead: [523.25, 659.25, 783.99, 659.25, 587.33, 659.25, 783.99, 1046.5, 698.46, 880.00, 783.99, 659.25, 587.33, 659.25, 523.25, 0],
        wave: 'triangle',
        bassWave: 'sine'
      },
      'ox-quiz': {
        label: '⭕ 퀴즈쇼 펄스',
        stepMs: 245,
        bass: [196.00, 0, 146.83, 0, 164.81, 0, 196.00, 146.83, 196.00, 0, 146.83, 0, 130.81, 0, 146.83, 0],
        lead: [392.00, 493.88, 587.33, 0, 659.25, 587.33, 493.88, 392.00, 440.00, 523.25, 659.25, 587.33, 523.25, 493.88, 440.00, 392.00],
        wave: 'sine',
        bassWave: 'triangle'
      },
      'horse-racing': {
        label: '🏇 경마 질주',
        stepMs: 185,
        bass: [146.83, 146.83, 220.00, 146.83, 146.83, 220.00, 164.81, 164.81, 246.94, 196.00, 196.00, 293.66],
        lead: [587.33, 0, 739.99, 880.00, 0, 739.99, 659.25, 739.99, 880.00, 987.77, 880.00, 739.99],
        wave: 'sawtooth',
        bassWave: 'triangle',
        cutoff: 1200
      },
      'blackjack': {
        label: '🃏 카지노 재즈',
        stepMs: 310,
        bass: [146.83, 0, 174.61, 196.00, 196.00, 0, 246.94, 146.83, 130.81, 0, 164.81, 196.00, 110.00, 0, 130.81, 164.81],
        lead: [523.25, 0, 659.25, 587.33, 493.88, 0, 587.33, 523.25, 440.00, 0, 523.25, 493.88, 392.00, 440.00, 493.88, 0],
        wave: 'sine',
        bassWave: 'sine',
        cutoff: 1100
      },
      'black-white': {
        label: '🎭 심리전 미스터리',
        stepMs: 280,
        bass: [110.00, 0, 0, 110.00, 87.31, 0, 0, 87.31, 146.83, 0, 0, 146.83, 82.41, 0, 123.47, 0],
        lead: [440.00, 523.25, 659.25, 523.25, 349.23, 440.00, 523.25, 440.00, 587.33, 659.25, 698.46, 587.33, 659.25, 523.25, 493.88, 0],
        wave: 'sine',
        bassWave: 'triangle',
        cutoff: 1000
      },
      'russian-roulette': {
        label: '🔫 서부 스릴러',
        stepMs: 330,
        bass: [82.41, 82.41, 0, 0, 98.00, 98.00, 0, 0, 110.00, 110.00, 0, 0, 123.47, 0, 98.00, 0],
        lead: [329.63, 0, 392.00, 329.63, 293.66, 0, 329.63, 0, 440.00, 392.00, 329.63, 293.66, 246.94, 0, 0, 0],
        wave: 'triangle',
        bassWave: 'sine',
        cutoff: 950
      },
      'dice-21': {
        label: '🎲 펑키 보드',
        stepMs: 250,
        bass: [174.61, 0, 174.61, 220.00, 196.00, 0, 130.81, 196.00, 174.61, 0, 220.00, 261.63, 196.00, 146.83, 130.81, 0],
        lead: [698.46, 0, 587.33, 523.25, 440.00, 523.25, 587.33, 0, 698.46, 880.00, 783.99, 698.46, 587.33, 523.25, 440.00, 0],
        wave: 'triangle',
        bassWave: 'sine'
      }
    };

    function isVisibleEl(id) {
      var el = document.getElementById(id);
      return Boolean(el && !el.classList.contains('hidden') && el.offsetParent !== null);
    }

    function detectCurrentScreenTheme() {
      if (pageGameTheme === 'lobby') return 'lobby';
      if (pageGameTheme === 'marble') {
        if (isVisibleEl('viewMapEditor')) return 'map-editor';
        if (isVisibleEl('viewEntry')) return 'room-select';
        return 'marble';
      }
      if (pageGameTheme === 'fishing') return 'fishing';
      if (pageGameTheme === 'ox-quiz') {
        if (document.getElementById('ox-new-room-title')) return 'room-select';
        return 'ox-quiz';
      }
      if (isVisibleEl('viewLobby')) return 'room-select';
      if (isVisibleEl('viewGame')) return pageGameTheme;
      return 'room-select';
    }

    var currentThemeKey = detectCurrentScreenTheme();
    var theme = THEMES[currentThemeKey] || THEMES['lobby'];
    var ctx = null;
    var masterGain = null;
    var filter = null;
    var stepIdx = 0;
    var loopTimer = null;
    var btnEl = null;

    function ensureAudio() {
      if (!ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = theme.cutoff || 1400;
        masterGain = ctx.createGain();
        masterGain.gain.value = 0.09;
        filter.connect(masterGain);
        masterGain.connect(ctx.destination);
      }
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(function () {});
      }
      return ctx;
    }

    function playNote(freq, dur, wave, vol) {
      if (!ctx || !filter || !freq) return;
      var now = ctx.currentTime;
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = wave || 'sine';
      o.frequency.setValueAtTime(freq, now);
      g.gain.setValueAtTime(0.001, now);
      g.gain.linearRampToValueAtTime(vol, now + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, now + dur);
      o.connect(g);
      g.connect(filter);
      o.start(now);
      o.stop(now + dur + 0.02);
    }

    function playSoftPad(freq, dur, wave, vol, delay) {
      if (!ctx || !filter || !freq) return;
      var t0 = ctx.currentTime + (delay || 0);
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = wave || 'sine';
      o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + 0.18);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g);
      g.connect(filter);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    }

    function tickStep() {
      if (!enabled || document.visibilityState === 'hidden') return;
      if (!ctx || ctx.state !== 'running') return;
      if (theme.ambientChords && theme.ambientChords.length > 0) {
        var chordIdx = Math.floor(stepIdx / 4) % theme.ambientChords.length;
        if (stepIdx % 4 === 0) {
          var ch = theme.ambientChords[chordIdx];
          for (var ci = 0; ci < ch.length; ci++) {
            playSoftPad(ch[ci], 3.2, 'sine', 0.22, ci * 0.09);
          }
        }
        if (stepIdx % 2 === 0 || Math.random() < 0.45) {
          var melFreq = theme.ambientMelody[(stepIdx + chordIdx) % theme.ambientMelody.length];
          playSoftPad(melFreq, 1.4, 'triangle', 0.16, 0.05);
        }
        stepIdx = (stepIdx + 1) % 32;
        return;
      }
      var bFreq = theme.bass[stepIdx % theme.bass.length];
      var lFreq = theme.lead[stepIdx % theme.lead.length];
      var durSec = (theme.stepMs / 1000) * 0.85;
      if (bFreq) playNote(bFreq, durSec, theme.bassWave || 'sine', 0.42);
      if (lFreq) playNote(lFreq, durSec * 0.8, theme.wave || 'triangle', 0.25);
      stepIdx++;
    }

    function startLoop() {
      if (loopTimer) clearInterval(loopTimer);
      loopTimer = setInterval(tickStep, theme.stepMs);
    }

    function setTheme(nextKey) {
      if (!THEMES[nextKey] || nextKey === currentThemeKey) return;
      currentThemeKey = nextKey;
      theme = THEMES[nextKey];
      stepIdx = 0;
      if (filter) filter.frequency.value = theme.cutoff || 1400;
      if (enabled && loopTimer) startLoop();
      updateBtn();
    }

    function updateBtn() {
      if (!btnEl) return;
      btnEl.textContent = enabled ? ('🔊 BGM ON · ' + theme.label) : '🔇 BGM OFF';
      btnEl.style.background = enabled ? 'rgba(16, 185, 129, 0.2)' : 'rgba(15, 23, 42, 0.85)';
      btnEl.style.borderColor = enabled ? 'rgba(52, 211, 153, 0.55)' : 'rgba(71, 85, 105, 0.6)';
      btnEl.style.color = enabled ? '#6ee7b7' : '#94a3b8';
    }

    function toggleBgm() {
      enabled = !enabled;
      try { localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0'); } catch (_) {}
      if (enabled) {
        ensureAudio();
        startLoop();
      } else if (loopTimer) {
        clearInterval(loopTimer);
        loopTimer = null;
      }
      updateBtn();
    }

    function mountBgmToggle() {
      if (document.getElementById('arcadeBgmToggleBtn')) return;
      btnEl = document.createElement('button');
      btnEl.id = 'arcadeBgmToggleBtn';
      btnEl.type = 'button';
      btnEl.style.cssText = 'position:fixed;bottom:10px;right:12px;z-index:9998;font-size:11px;font-weight:800;padding:5px 10px;border-radius:9999px;border:1px solid;backdrop-filter:blur(6px);cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.35);';
      btnEl.addEventListener('click', toggleBgm);
      document.body.appendChild(btnEl);
      updateBtn();
    }

    function unlockOnFirstGesture() {
      if (!enabled) return;
      ensureAudio();
      if (!loopTimer) startLoop();
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mountBgmToggle);
    } else {
      mountBgmToggle();
    }
    if (enabled) {
      ensureAudio();
      startLoop();
    }
    ['click', 'touchend', 'pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
      document.addEventListener(ev, unlockOnFirstGesture, { capture: true, passive: true });
    });

    setInterval(function () {
      var nextKey = detectCurrentScreenTheme();
      if (nextKey !== currentThemeKey) setTheme(nextKey);
    }, 450);

    window.ArcadeBGM = {
      toggle: toggleBgm,
      setTheme: setTheme,
      isEnabled: function () { return enabled; },
      getTheme: function () { return currentThemeKey; }
    };
  })();
  // ================= UNIFIED PER-GAME RULES MODAL =================
  (function setupArcadeRules() {
    var path = (window.location && window.location.pathname) || '/';
    var gameKey = null;
    if (path.indexOf('/games/marble') !== -1) gameKey = 'marble';
    else if (path.indexOf('/games/ox-quiz') !== -1) gameKey = 'ox-quiz';
    else if (path.indexOf('/games/horse-racing') !== -1) gameKey = 'horse-racing';
    else if (path.indexOf('/games/blackjack') !== -1) gameKey = 'blackjack';
    else if (path.indexOf('/games/black-white') !== -1) gameKey = 'black-white';
    else if (path.indexOf('/games/russian-roulette') !== -1) gameKey = 'russian-roulette';
    else if (path.indexOf('/games/dice-21') !== -1) gameKey = 'dice-21';
    if (!gameKey) return;

    var RULES = {
      'marble': {
        title: '🔮 마블 드롭 서바이벌 규칙',
        items: [
          '방에 입장하면 내 구슬 1개가 자동으로 생성됩니다. (1인 1구슬)',
          '방장이 당첨 기준(1등 · 꼴찌 · N등), 맵 코스, 배속, 스킬 모드를 설정해 레이스를 시작합니다.',
          '스킬 모드가 켜져 있으면 레이스 중 스킬 버튼을 판당 1회 사용할 수 있습니다. (충격파 · 유령 · 대시 · 빙결 · 점프 · 거대화)',
          '방 선택 화면의 [🎨 커스텀 맵 제작]에서 누구나 직접 맵을 만들어 모든 방에서 플레이할 수 있습니다.',
          '레이스가 진행 중일 때 나가기를 누르면 해당 판이 끝난 뒤 자동으로 방에서 나가집니다.'
        ]
      },
      'ox-quiz': {
        title: '⭕ OX 서바이벌 퀴즈 규칙',
        items: [
          '문제가 출제되면 제한 시간 안에 O 또는 X 진영을 선택하세요.',
          '정답을 맞히면 다음 문제로 생존하고, 오답을 고르면 탈락합니다.',
          '탈락한 뒤에도 실시간으로 남은 라운드를 관전할 수 있습니다.',
          '최후의 생존자가 되거나 최종 점수 1위를 달성하면 승리합니다.'
        ]
      },
      'horse-racing': {
        title: '🏇 로얄 경마 규칙',
        items: [
          '총 5라운드로 진행되며, 시작 칩을 가지고 3마리의 말 중 1등할 말에 배팅합니다.',
          '모두 배팅 확정을 누르거나 제한 시간이 끝나면 자동으로 경주가 출발합니다.',
          '배당은 [총 배팅 풀 ÷ 1등 말에 걸린 금액] 비율로 지급됩니다. (1등 말에 배팅자가 없으면 원금 환불)',
          '5라운드가 끝난 뒤 보유 칩이 가장 많은 플레이어가 최종 우승합니다.'
        ]
      },
      'blackjack': {
        title: '🃏 로얄 블랙잭 규칙',
        items: [
          '카드 합을 21에 가깝게 만들어 딜러보다 점수가 높으면 승리합니다. (21 초과 시 즉시 버스트 패배)',
          '점수 계산: A는 1 또는 11, J·Q·K는 10, 숫자 카드는 적힌 숫자 그대로 계산합니다.',
          '내추럴 블랙잭(첫 2장이 A + 10/J/Q/K)으로 이기면 배팅액의 1.5배를 받습니다.',
          '히트(1장 더), 스탠드(멈춤), 더블다운(배팅 2배+1장만 받기), 스플릿(같은 값 2장 분리), 서렌더(절반 환불 포기)를 선택할 수 있습니다.',
          '딜러는 17 미만이면 무조건 히트하고, 17 이상이면 스탠드합니다.'
        ]
      },
      'black-white': {
        title: '🎭 흑과 백 (원작 룰)',
        items: [
          '각자 0~8 숫자 타일 9장(짝수=흑, 홀수=백)을 가지고 총 9라운드 대결합니다.',
          '1라운드는 랜덤 룰렛으로 선공을 정하며, 선공이 먼저 타일을 내면 후공은 그 색깔(흑/백) 힌트를 보고 선택합니다.',
          '양쪽 모두 선택을 마치면 숫자가 공개되며, 더 큰 숫자를 낸 쪽이 1점을 얻습니다.',
          '다음 라운드부터는 직전 라운드 승자가 선공(먼저 제출)이 되어 공정한 심리전이 이어집니다.',
          '먼저 5점을 달성하거나 9라운드 종료 시 점수가 높은 쪽이 승리합니다.'
        ]
      },
      'russian-roulette': {
        title: '🔫 러시안 룰렛 규칙',
        items: [
          '6발짜리 실린더 중 무작위 1칸에 실탄이 장전된 상태로 시작합니다.',
          '게임 시작 시 랜덤 룰렛으로 선공이 결정됩니다.',
          '내 차례에 [방아쇠 당기기]를 누르며, 판당 1회만 [턴 넘기기]를 사용할 수 있습니다.',
          '실탄이 격발되면 즉시 아웃되고, 끝까지 살아남은 플레이어가 승리합니다.'
        ]
      },
      'dice-21': {
        title: '🎲 다이스 21 규칙',
        items: [
          '게임 시작 시 랜덤 룰렛으로 선공을 정한 뒤 번갈아 주사위(1~6)를 굴립니다.',
          '주사위 합계가 21을 넘으면 즉시 버스트로 패배합니다.',
          '더 굴리지 않고 [스톱(Hold)]을 누르면 현재 점수로 확정됩니다.',
          '양쪽 모두 스톱했을 때 21에 더 가까운 쪽이 승리하며, 동점이면 주사위를 더 많이 굴린 쪽이 승리합니다.'
        ]
      }
    };

    var info = RULES[gameKey];
    if (!info) return;

    function openRulesModal() {
      var existing = document.getElementById('arcadeRulesModal');
      if (existing) {
        existing.style.display = 'flex';
        return;
      }
      var overlay = document.createElement('div');
      overlay.id = 'arcadeRulesModal';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.72);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:16px;';
      var listHtml = info.items.map(function (txt) {
        return '<li style="display:flex;gap:8px;align-items:flex-start;line-height:1.5;"><span style="color:#38bdf8;font-weight:900;">•</span><span>' + txt + '</span></li>';
      }).join('');
      overlay.innerHTML =
        '<div style="width:100%;max-width:420px;background:#0d1322;border:1px solid #2b3861;border-radius:20px;padding:20px;box-shadow:0 20px 50px rgba(0,0,0,0.6);color:#e2e8f0;font-family:Pretendard,system-ui,sans-serif;">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">' +
            '<div style="font-size:15px;font-weight:900;color:#fff;">' + info.title + '</div>' +
            '<button id="btnCloseArcadeRules" type="button" style="background:none;border:none;color:#94a3b8;font-size:20px;font-weight:900;cursor:pointer;line-height:1;">×</button>' +
          '</div>' +
          '<ul style="list-style:none;padding:0;margin:0 0 16px 0;font-size:12px;font-weight:600;color:#cbd5e1;display:flex;flex-direction:column;gap:8px;">' + listHtml + '</ul>' +
          '<button id="btnOkArcadeRules" type="button" style="width:100%;padding:10px;border-radius:12px;border:none;background:#5851f6;color:#fff;font-size:12px;font-weight:900;cursor:pointer;">확인</button>' +
        '</div>';
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay || e.target.id === 'btnCloseArcadeRules' || e.target.id === 'btnOkArcadeRules') {
          overlay.style.display = 'none';
        }
      });
      document.body.appendChild(overlay);
    }

    function mountRulesBtn() {
      if (document.getElementById('arcadeRulesBtn')) return;
      var btn = document.createElement('button');
      btn.id = 'arcadeRulesBtn';
      btn.type = 'button';
      btn.textContent = '📖 게임 규칙';
      btn.style.cssText = 'position:fixed;bottom:10px;left:12px;z-index:9998;font-size:11px;font-weight:800;padding:5px 10px;border-radius:9999px;border:1px solid rgba(56,189,248,0.45);background:rgba(15,23,42,0.88);color:#7dd3fc;backdrop-filter:blur(6px);cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.35);';
      btn.addEventListener('click', openRulesModal);
      document.body.appendChild(btn);
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mountRulesBtn);
    } else {
      mountRulesBtn();
    }

    window.ArcadeRules = { open: openRulesModal };
  })();

  // ================= EXISTING ROOM CONFLICT POPUP =================
  (function setupArcadeMyRooms() {
    function openConflictPopup(message) {
      var cid = getOrCreateClientId();
      var _p = getStoredProfile();
      var url = '/api/user/my-rooms?clientId=' + encodeURIComponent(cid) + (_p && _p.nickname ? '&nickname=' + encodeURIComponent(_p.nickname) : '');
      fetch(url)
        .then(function (r) { return r.json(); })
        .then(function (data) {
          var createdRooms = (data && Array.isArray(data.rooms)) ? data.rooms : [];
          var joinedRooms = (data && Array.isArray(data.joinedRooms)) ? data.joinedRooms : [];
          var old = document.getElementById('arcadeConflictModal');
          if (old) old.remove();

          var overlay = document.createElement('div');
          overlay.id = 'arcadeConflictModal';
          overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.75);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:16px;';

          var itemsHtml = '';
          createdRooms.forEach(function (rm) {
            itemsHtml += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px;border-radius:12px;background:#080c17;border:1px solid rgba(251,191,36,0.45);">' +
              '<div style="min-width:0;">' +
                '<div style="font-size:12px;font-weight:900;color:#fde68a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">👑 [내 방] ' + (rm.icon || '🎮') + ' ' + rm.title + '</div>' +
                '<div style="font-size:10px;color:#94a3b8;font-weight:700;">' + rm.gameLabel + ' · ' + rm.count + '명</div>' +
              '</div>' +
              '<div style="display:flex;gap:6px;flex-shrink:0;">' +
                '<a href="' + rm.path + '" style="padding:6px 10px;border-radius:8px;background:#10b981;color:#052e16;font-size:11px;font-weight:900;text-decoration:none;">이동</a>' +
                '<button type="button" data-del-room="' + rm.roomId + '" data-del-type="' + rm.gameType + '" style="padding:6px 10px;border-radius:8px;background:rgba(244,63,94,0.2);border:1px solid rgba(244,63,94,0.45);color:#fda4af;font-size:11px;font-weight:900;cursor:pointer;">삭제</button>' +
              '</div>' +
            '</div>';
          });
          joinedRooms.forEach(function (rm) {
            itemsHtml += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px;border-radius:12px;background:#080c17;border:1px solid rgba(56,189,248,0.45);">' +
              '<div style="min-width:0;">' +
                '<div style="font-size:12px;font-weight:900;color:#7dd3fc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">🟢 [참여 중] ' + (rm.icon || '🎮') + ' ' + rm.title + '</div>' +
                '<div style="font-size:10px;color:#94a3b8;font-weight:700;">' + rm.gameLabel + ' · ' + rm.count + '명</div>' +
              '</div>' +
              '<div style="display:flex;gap:6px;flex-shrink:0;">' +
                '<a href="' + rm.path + '" style="padding:6px 10px;border-radius:8px;background:#38bdf8;color:#082f49;font-size:11px;font-weight:900;text-decoration:none;">복귀</a>' +
                '<button type="button" data-leave-room="' + rm.roomId + '" data-leave-type="' + rm.gameType + '" style="padding:6px 10px;border-radius:8px;background:rgba(148,163,184,0.2);border:1px solid rgba(148,163,184,0.45);color:#e2e8f0;font-size:11px;font-weight:900;cursor:pointer;">나가기</button>' +
              '</div>' +
            '</div>';
          });
          if (!itemsHtml) {
            itemsHtml = '<div style="font-size:12px;color:#94a3b8;text-align:center;padding:10px 0;">현재 열려 있는 방 정보를 확인해주세요.</div>';
          }

          overlay.innerHTML =
            '<div style="width:100%;max-width:400px;background:#111625;border:1px solid #334155;border-radius:20px;padding:20px;box-shadow:0 20px 50px rgba(0,0,0,0.65);color:#f8fafc;font-family:Pretendard,system-ui,sans-serif;">' +
              '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">' +
                '<div style="font-size:15px;font-weight:900;color:#fbbf24;">⚠️ 이미 참여/생성한 방이 있습니다</div>' +
                '<button id="btnCloseConflictModal" type="button" style="background:none;border:none;color:#94a3b8;font-size:20px;font-weight:900;cursor:pointer;line-height:1;">×</button>' +
              '</div>' +
              '<p style="font-size:12px;color:#cbd5e1;margin:0 0 12px 0;line-height:1.45;">' + (message || '기존 방으로 이동하거나 나가기/삭제 후 이용해주세요.') + '</p>' +
              '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px;">' + itemsHtml + '</div>' +
              '<button id="btnOkConflictModal" type="button" style="width:100%;padding:10px;border-radius:12px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;font-size:12px;font-weight:800;cursor:pointer;">닫기</button>' +
            '</div>';

          overlay.addEventListener('click', function (e) {
            if (e.target === overlay || e.target.id === 'btnCloseConflictModal' || e.target.id === 'btnOkConflictModal') {
              overlay.remove();
            }
          });
          overlay.querySelectorAll('button[data-del-room]').forEach(function (btn) {
            btn.addEventListener('click', function () {
              if (!window.confirm('⚠️ 정말 이 방을 삭제하시겠습니까?\n스타가 걸린 게임 진행 중에 삭제하면 기권패 처리되어 스타를 잃을 수 있습니다.')) return;
              var rId = btn.getAttribute('data-del-room');
              var gType = btn.getAttribute('data-del-type');
              fetch('/api/user/delete-my-room', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientId: cid, nickname: (_p && _p.nickname) || '', gameType: gType, roomId: rId })
              }).then(function (r) { return r.json(); }).then(function (res) {
                if (res && res.ok) {
                  overlay.remove();
                  if (typeof window.showToast === 'function') window.showToast('🗑️ 기존 방이 삭제되었습니다. 다시 시도해주세요!');
                }
              }).catch(function () {});
            });
          });
          overlay.querySelectorAll('button[data-leave-room]').forEach(function (btn) {
            btn.addEventListener('click', function () {
              if (!window.confirm('⚠️ 정말 현재 참여 중인 방에서 나가시겠습니까?\n스타가 걸린 게임 진행 중에 나가면 자동 기권패 처리되어 걸어둔 스타를 잃게 됩니다.')) return;
              var rId = btn.getAttribute('data-leave-room');
              var gType = btn.getAttribute('data-leave-type');
              fetch('/api/user/leave-joined-room', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientId: cid, nickname: (_p && _p.nickname) || '', gameType: gType, roomId: rId })
              }).then(function (r) { return r.json(); }).then(function (res) {
                if (res && res.ok) {
                  overlay.remove();
                  if (typeof window.showToast === 'function') window.showToast('🚪 기존 방에서 퇴장했습니다. 다시 시도해주세요!');
                }
              }).catch(function () {});
            });
          });
          document.body.appendChild(overlay);
        })
        .catch(function () {});
    }

    window.ArcadeMyRooms = { openConflictPopup: openConflictPopup };
  })();

  // ================= UNIFIED ACCOUNT GOLD / DAILY MISSIONS / SHOP / LEADERBOARD UI =================
  (function setupArcadeEconomy() {
    var ecoState = {
      gold: 3000,
      missions: [],
      bailout: { available: false, bailoutCount: 0, maxBailout: 3, reward: 50000 },
      cosmetics: { ownedTitles: [], equippedTitle: '', ownedColors: [], equippedColor: '', ownedMarbleSkins: [], equippedMarbleSkin: '', ownedFishingPets: [], equippedFishingPet: '', ownedRodEffects: [], equippedRodEffect: '' },
      fishingBait: { price: 10000, dailyBuyLimit: 100, boughtToday: 0, freeRemaining: 100, extraBait: 0 },
      fishingRods: { rods: [], equippedRodId: '' },
      shopCatalog: [],
      marketListings: [],
      marketFilter: 'all',
      leaderboard: [],
      activeTab: 'missions',
      shopCategory: 'all',
      unreadNotifications: 0
    };

    function showEcoToast(msg) {
      if (typeof window.showToast === 'function') {
        window.showToast(msg);
        return;
      }
      var t = document.createElement('div');
      t.style.cssText = 'position:fixed;top:52px;left:50%;transform:translateX(-50%);z-index:10005;background:#5851f6;color:#fff;padding:9px 16px;border-radius:14px;font-size:12px;font-weight:900;box-shadow:0 10px 25px rgba(0,0,0,0.5);pointer-events:none;';
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2600);
    }

    var isFetchingEco = false;
    var lastEcoFetchAt = 0;

    function updateTopEconomyBar() {
      var bar = document.getElementById('arcadeEconomyTopBar');
      if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
    }

    function emitEconomyUpdated() {
      updateTopEconomyBar();
      try {
        window.dispatchEvent(new CustomEvent('arcade-economy-updated', { detail: ecoState }));
      } catch (_) {}
    }

    function refreshEconomyStatus(cb, force) {
      var prof = getStoredProfile();
      if (!prof || (!prof.save_code && !prof.nickname)) {
        updateTopEconomyBar();
        if (cb) cb(null);
        return;
      }
      var now = Date.now();
      if (isFetchingEco || (!force && now - lastEcoFetchAt < 1200)) {
        if (cb) cb(null);
        return;
      }
      isFetchingEco = true;
      lastEcoFetchAt = now;
      var q = '/api/economy/status?save_code=' + encodeURIComponent(prof.save_code || '') + '&nickname=' + encodeURIComponent(prof.nickname || '') + '&t=' + Date.now();
      fetch(q, { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          isFetchingEco = false;
          if (d && d.ok) {
            ecoState.gold = d.gold;
            ecoState.missions = d.missions || [];
            ecoState.bailout = d.bailout || ecoState.bailout;
            ecoState.cosmetics = d.cosmetics || ecoState.cosmetics;
            if (d.fishingBait) ecoState.fishingBait = d.fishingBait;
            if (d.fishingRods) ecoState.fishingRods = d.fishingRods;
            ecoState.shopCatalog = d.shopCatalog || [];
            if (typeof d.unreadNotifications === 'number') ecoState.unreadNotifications = d.unreadNotifications;
            emitEconomyUpdated();
            if (d.attendanceJustGranted) {
              showEcoToast('🎁 오늘의 첫 출석 보상 +100,000 스타가 자동 지급되었습니다!');
            }
            renderModalContentIfOpen();
          }
          if (cb) cb(d);
        })
        .catch(function () {
          isFetchingEco = false;
          if (cb) cb(null);
        });
    }

    function fetchMarketListings(cb) {
      fetch('/api/economy/market?t=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (d && Array.isArray(d.listings)) {
            ecoState.marketListings = d.listings;
            renderModalContentIfOpen();
          }
          if (cb) cb(ecoState.marketListings);
        })
        .catch(function () {});
    }

    function fetchLeaderboard(cb) {
      fetch('/api/economy/leaderboard')
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (d && Array.isArray(d.leaderboard)) {
            ecoState.leaderboard = d.leaderboard;
            renderModalContentIfOpen();
          }
          if (cb) cb(ecoState.leaderboard);
        })
        .catch(function () {});
    }

    var lastRenderedModalKey = '';
    function renderModalContentIfOpen() {
      var modal = document.getElementById('arcadeEconomyModal');
      if (!modal || modal.style.display === 'none') return;
      var bodyEl = document.getElementById('arcadeEconomyModalBody');
      var goldBadge = document.getElementById('arcadeEconomyModalGold');
      if (goldBadge) goldBadge.textContent = '⭐ ' + Number(ecoState.gold || 0).toLocaleString() + ' 스타';
      if (!bodyEl) return;
      var curModalKey = String(ecoState.activeTab || '') + '|' + String(ecoState.shopCategory || '') + '|' + String(ecoState.marketFilter || '');
      var sameView = (curModalKey === lastRenderedModalKey);
      // 입력창에 타이핑 중이면 배경 갱신으로 입력/스크롤이 초기화되지 않도록 보호
      if (sameView && document.activeElement && bodyEl.contains(document.activeElement) && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
        return;
      }
      var prevScrollEl = bodyEl.querySelector('[data-eco-scroll]');
      var savedScrollTop = (sameView && prevScrollEl) ? prevScrollEl.scrollTop : 0;
      lastRenderedModalKey = curModalKey;

      var tabBtns = modal.querySelectorAll('button[data-eco-tab]');
      tabBtns.forEach(function (b) {
        var active = b.getAttribute('data-eco-tab') === ecoState.activeTab;
        b.style.background = active ? '#5851f6' : '#080c17';
        b.style.color = active ? '#ffffff' : '#94a3b8';
        b.style.borderColor = active ? '#6366f1' : '#1e293b';
      });

      var prof = getStoredProfile() || {};
      if (ecoState.activeTab === 'missions') {
        var mHtml = '<div style="display:flex;flex-direction:column;gap:8px;">';
        mHtml += '<div style="padding:10px 12px;border-radius:12px;background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.35);font-size:11px;color:#a7f3d0;font-weight:700;">✅ 매일 접속 시 출석 보상 <strong>+100,000 스타</strong> 자동 지급 · 일일 미션은 매일 자정(KST) 초기화됩니다.</div>';
        (ecoState.missions || []).forEach(function (m) {
          var btnHtml = '';
          if (m.claimed) {
            btnHtml = '<span style="padding:6px 10px;border-radius:10px;background:#1e293b;color:#64748b;font-size:11px;font-weight:900;">수령 완료</span>';
          } else if (m.completed) {
            btnHtml = '<button type="button" data-claim-id="' + m.id + '" style="padding:6px 12px;border-radius:10px;border:none;background:#10b981;color:#052e16;font-size:11px;font-weight:900;cursor:pointer;">+' + m.reward.toLocaleString() + ' 스타 받기</button>';
          } else {
            btnHtml = '<span style="padding:6px 10px;border-radius:10px;background:#0f172a;border:1px solid #1e293b;color:#fbbf24;font-size:11px;font-weight:800;">+' + m.reward.toLocaleString() + ' 스타 (' + m.current + '/' + m.target + ')</span>';
          }
          mHtml += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:11px 12px;border-radius:14px;background:#080c17;border:1px solid #1f2942;">' +
            '<div style="min-width:0;">' +
              '<div style="font-size:12px;font-weight:900;color:#f8fafc;">' + (m.icon || '🎯') + ' ' + m.title + '</div>' +
              '<div style="font-size:10px;color:#94a3b8;margin-top:2px;">' + m.desc + ' · 진행도 ' + m.current + ' / ' + m.target + '</div>' +
            '</div>' +
            '<div style="flex-shrink:0;">' + btnHtml + '</div>' +
          '</div>';
        });

        var bInfo = ecoState.bailout || { available: false, bailoutCount: 0, maxBailout: 3, reward: 50000 };
        mHtml += '<div style="margin-top:6px;padding:12px;border-radius:14px;background:#080c17;border:1px solid rgba(56,189,248,0.35);display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
          '<div>' +
            '<div style="font-size:12px;font-weight:900;color:#7dd3fc;">🛟 파산 지원금 (+' + Number(bInfo.reward || 50000).toLocaleString() + ' 스타)</div>' +
            '<div style="font-size:10px;color:#94a3b8;margin-top:2px;">보유 스타 50,000 스타 미만일 때 하루 3회 무료 충전 (오늘 ' + bInfo.bailoutCount + '/' + bInfo.maxBailout + '회)</div>' +
          '</div>' +
          '<button type="button" id="btnClaimBailout" ' + (bInfo.available ? '' : 'disabled') + ' style="padding:7px 12px;border-radius:10px;border:none;background:' + (bInfo.available ? '#38bdf8' : '#1e293b') + ';color:' + (bInfo.available ? '#082f49' : '#64748b') + ';font-size:11px;font-weight:900;cursor:' + (bInfo.available ? 'pointer' : 'not-allowed') + ';flex-shrink:0;">+50,000 스타 신청</button>' +
        '</div>';
        mHtml += '</div>';
        bodyEl.innerHTML = mHtml;

        bodyEl.querySelectorAll('button[data-claim-id]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var mid = btn.getAttribute('data-claim-id');
            fetch('/api/economy/claim-mission', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ save_code: prof.save_code, nickname: prof.nickname, missionId: mid })
            })
              .then(function (r) { return r.json(); })
              .then(function (res) {
                if (res && res.ok) {
                  ecoState.gold = res.gold;
                  ecoState.missions = res.missions || ecoState.missions;
                  ecoState.bailout = res.bailout || ecoState.bailout;
                  updateTopEconomyBar();
                  renderModalContentIfOpen();
                  showEcoToast(res.message || '미션 보상을 수령했습니다!');
                } else if (res && res.error) {
                  showEcoToast(res.error);
                }
              });
          });
        });

        var bailBtn = document.getElementById('btnClaimBailout');
        if (bailBtn && bInfo.available) {
          bailBtn.addEventListener('click', function () {
            fetch('/api/economy/bailout', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ save_code: prof.save_code, nickname: prof.nickname })
            })
              .then(function (r) { return r.json(); })
              .then(function (res) {
                if (res && res.ok) {
                  ecoState.gold = res.gold;
                  ecoState.bailout = res.bailout || ecoState.bailout;
                  updateTopEconomyBar();
                  renderModalContentIfOpen();
                  showEcoToast(res.message || '파산 지원금이 지급되었습니다!');
                } else if (res && res.error) {
                  showEcoToast(res.error);
                }
              });
          });
        }
      } else if (ecoState.activeTab === 'shop') {
        var cos = ecoState.cosmetics || {};
        var myNick = (prof && prof.nickname) ? prof.nickname : '내닉네임';
        var shopCats = [
          { id: 'all', label: '전체' },
          { id: 'rod', label: '🎣 낚싯대' },
          { id: 'rodSkin', label: '✨ 낚싯대 스킨' },
          { id: 'consumable', label: '🛡️ 소모품' },
          { id: 'title', label: '🏷️ 칭호' },
          { id: 'color', label: '🎨 닉네임 컬러' },
          { id: 'fishingPet', label: '🐾 낚시 펫' },
          { id: 'rodEffect', label: '✨ 낚시 이펙트' },
          { id: 'marbleSkin', label: '🔮 구슬 스킨' }
        ];
        var sHtml = '<div style="display:flex;gap:5px;margin-bottom:10px;flex-wrap:wrap;">';
        shopCats.forEach(function (sc) {
          var act = ecoState.shopCategory === sc.id;
          sHtml += '<button type="button" data-shop-cat="' + sc.id + '" style="padding:5px 10px;border-radius:999px;font-size:11px;font-weight:900;cursor:pointer;border:1px solid ' + (act ? '#a855f7' : '#263253') + ';background:' + (act ? 'rgba(168,85,247,0.25)' : '#080c17') + ';color:' + (act ? '#f3e8ff' : '#94a3b8') + ';">' + sc.label + '</button>';
        });
        sHtml += '</div>';
        sHtml += '<div data-eco-scroll="1" style="display:flex;flex-direction:column;gap:8px;max-height:330px;overflow-y:auto;padding-right:2px;">';
        if (ecoState.shopCategory === 'all') {
          var fb = ecoState.fishingBait || { price: 10000, dailyBuyLimit: 100, boughtToday: 0, freeRemaining: 100, extraBait: 0 };
          sHtml += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px;border-radius:14px;background:rgba(14,116,144,0.16);border:1px solid rgba(56,189,248,0.4);">' +
            '<div style="min-width:0;">' +
              '<div style="font-size:12px;font-weight:900;color:#7dd3fc;">🪱 낚시터 추가 미끼 (개당 ' + Number(typeof fb.price === 'number' ? fb.price : 10000).toLocaleString() + ' 스타)</div>' +
              '<div style="font-size:10px;color:#cbd5e1;margin-top:2px;">구매 한도 없음 · 보유 추가미끼 ' + (fb.extraBait || 0) + '개</div>' +
            '</div>' +
            '<div style="display:flex;gap:5px;flex-shrink:0;">' +
              '<button type="button" data-buy-bait="1" style="padding:6px 9px;border-radius:10px;border:none;background:#38bdf8;color:#082f49;font-size:11px;font-weight:900;cursor:pointer;">+1개</button>' +
              '<button type="button" data-buy-bait="10" style="padding:6px 9px;border-radius:10px;border:none;background:#f59e0b;color:#0f172a;font-size:11px;font-weight:900;cursor:pointer;">+10개</button>' +
            '</div>' +
          '</div>';
        }

        var filteredCatalog = (ecoState.shopCatalog || []).filter(function (it) {
          return !it.exclusive && (ecoState.shopCategory === 'all' || it.category === ecoState.shopCategory);
        });

        filteredCatalog.forEach(function (item) {
          var ownedList = item.category === 'title' ? (cos.ownedTitles || []) : item.category === 'color' ? (cos.ownedColors || []) : item.category === 'fishingPet' ? (cos.ownedFishingPets || []) : item.category === 'rodEffect' ? (cos.ownedRodEffects || []) : (cos.ownedMarbleSkins || []);
          var isOwned = ownedList.indexOf(item.id) !== -1;
          var isEquipped = (item.category === 'title' && cos.equippedTitle === item.value) ||
                           (item.category === 'color' && cos.equippedColor === item.value) ||
                           (item.category === 'marbleSkin' && cos.equippedMarbleSkin === item.value) ||
                           (item.category === 'fishingPet' && cos.equippedFishingPet === item.value) ||
                           (item.category === 'rodEffect' && cos.equippedRodEffect === item.value);
          var canAfford = Number(ecoState.gold || 0) >= Number(item.price || 0);
          var itemCount = (cos.itemCounts && cos.itemCounts[item.id]) ? Number(cos.itemCounts[item.id]) : (isOwned ? 1 : 0);
          var catBadge = item.category === 'rod' ? '🎣 낚싯대' : item.category === 'rodSkin' ? '✨ 낚싯대스킨' : item.category === 'consumable' ? '🛡️ 소모품' : item.category === 'title' ? '🏷️ 칭호' : item.category === 'color' ? '🎨 컬러' : '🔮 구슬스킨';

          var previewHtml = '';
          if (item.category === 'marbleSkin') {
            previewHtml = '<canvas data-skin-preview="' + item.value + '" width="46" height="46" style="width:46px;height:46px;border-radius:12px;background:#040814;border:1px solid #1e293b;flex-shrink:0;"></canvas>';
          } else if (item.category === 'color') {
            var pStyle = '';
            if (item.value === 'rainbow' || item.value === 'rainbow_aurora') {
              var pGrad = item.value === 'rainbow_aurora' ? 'linear-gradient(90deg,#22d3ee,#34d399,#818cf8,#f472b6)' : 'linear-gradient(90deg,#f472b6,#facc15,#34d399,#38bdf8,#c084fc)';
              pStyle = 'background:' + pGrad + ';-webkit-background-clip:text;-webkit-text-fill-color:transparent;';
            } else if (item.value.indexOf('grad:') === 0) {
              pStyle = 'background:linear-gradient(90deg,' + item.value.slice(5) + ');-webkit-background-clip:text;-webkit-text-fill-color:transparent;';
            } else if (item.value.indexOf('glow:') === 0) {
              var gHex = item.value.slice(5);
              pStyle = 'color:' + gHex + ';text-shadow:0 0 8px ' + gHex + ',0 0 14px ' + gHex + ';';
            } else {
              pStyle = 'color:' + item.value + ';';
            }
            previewHtml = '<div style="width:54px;height:46px;border-radius:12px;background:#040814;border:1px solid #1e293b;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;flex-shrink:0;padding:2px;">' +
              '<span style="font-size:13px;font-weight:900;' + pStyle + '">Aa</span>' +
              '<span style="font-size:9px;font-weight:900;max-width:48px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' + pStyle + '">' + myNick + '</span>' +
            '</div>';
          } else if (item.category === 'rod') {
            previewHtml = '<div style="width:46px;height:46px;border-radius:12px;background:#040814;border:1px solid #1e293b;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">🎣</div>';
          } else if (item.category === 'rodSkin') {
            previewHtml = '<canvas data-rod-skin-preview="' + item.value + '" width="46" height="46" style="width:46px;height:46px;border-radius:12px;background:#040814;border:1px solid #1e293b;flex-shrink:0;"></canvas>';
          } else if (item.category === 'consumable') {
            previewHtml = '<div style="width:46px;height:46px;border-radius:12px;background:#040814;border:1px solid #1e293b;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">🛡️</div>';
          } else {
            var previewLabel = item.isCustomTitleTicket ? '[내칭호]' : item.value;
            previewHtml = '<div style="width:46px;height:46px;border-radius:12px;background:#040814;border:1px solid #1e293b;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2px;flex-shrink:0;text-align:center;">' +
              '<span style="font-size:9px;font-weight:900;color:#facc15;line-height:1.1;word-break:keep-all;">' + previewLabel + '</span>' +
              '<span style="font-size:8px;color:#cbd5e1;margin-top:2px;max-width:42px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + myNick + '</span>' +
            '</div>';
          }

          var actionBtn = '';
          if (item.isCustomTitleTicket) {
            actionBtn = '<div style="display:flex;align-items:center;gap:4px;">' +
              '<input id="customTitleShopInput" type="text" maxlength="8" placeholder="최대 8글자" style="width:88px;padding:6px 8px;border-radius:10px;border:1px solid #334155;background:#0f172a;color:#fff;font-size:11px;font-weight:800;outline:none;" />' +
              (canAfford
                ? '<button type="button" id="btnBuyCustomTitle" style="padding:6px 10px;border-radius:10px;border:none;background:#f59e0b;color:#0f172a;font-size:11px;font-weight:900;cursor:pointer;white-space:nowrap;">신청 (' + item.price.toLocaleString() + ')</button>'
                : '<button type="button" disabled style="padding:6px 10px;border-radius:10px;border:1px solid #334155;background:#1e293b;color:#64748b;font-size:11px;font-weight:800;cursor:not-allowed;">🔒 ' + item.price.toLocaleString() + '</button>') +
            '</div>';
          } else if (item.category === 'rodSkin') {
            var rsCnt = (cos.itemCounts && cos.itemCounts[item.id]) ? Number(cos.itemCounts[item.id]) : 0;
            actionBtn = (canAfford
              ? '<button type="button" data-buy-id="' + item.id + '" style="padding:6px 10px;border-radius:10px;border:none;background:#a855f7;color:#fff;font-size:11px;font-weight:900;cursor:pointer;">⭐ ' + item.price.toLocaleString() + (rsCnt > 0 ? ' (보유 ' + rsCnt + ')' : '') + '</button>'
              : '<button type="button" disabled style="padding:6px 10px;border-radius:10px;border:1px solid #334155;background:#1e293b;color:#64748b;font-size:11px;font-weight:800;cursor:not-allowed;">🔒 ' + item.price.toLocaleString() + ' 스타</button>');
          } else if (item.isConsumable || item.category === 'consumable') {
            var consCnt = (cos.itemCounts && cos.itemCounts[item.id]) ? Number(cos.itemCounts[item.id]) : 0;
            actionBtn = (canAfford
              ? '<button type="button" data-buy-id="' + item.id + '" style="padding:6px 10px;border-radius:10px;border:none;background:#10b981;color:#022c22;font-size:11px;font-weight:900;cursor:pointer;">⭐ ' + item.price.toLocaleString() + ' (보유 ' + consCnt + ')</button>'
              : '<button type="button" disabled style="padding:6px 10px;border-radius:10px;border:1px solid #334155;background:#1e293b;color:#64748b;font-size:11px;font-weight:800;cursor:not-allowed;">🔒 ' + item.price.toLocaleString() + ' 스타</button>');
          } else if (item.isRepeatableRod) {
            var rodOwnedCnt = (ecoState.fishingRods && Array.isArray(ecoState.fishingRods.rods)) ? ecoState.fishingRods.rods.length : 0;
            actionBtn = (canAfford
              ? '<button type="button" data-buy-id="' + item.id + '" style="padding:6px 10px;border-radius:10px;border:none;background:#f59e0b;color:#0f172a;font-size:11px;font-weight:900;cursor:pointer;">⭐ ' + item.price.toLocaleString() + ' (보유 ' + rodOwnedCnt + ')</button>'
              : '<button type="button" disabled style="padding:6px 10px;border-radius:10px;border:1px solid #334155;background:#1e293b;color:#64748b;font-size:11px;font-weight:800;cursor:not-allowed;">🔒 ' + item.price.toLocaleString() + ' 스타</button>');
          } else if (isOwned) {
            actionBtn = '<span style="display:inline-block;padding:6px 10px;border-radius:10px;border:1px solid rgba(52,211,153,0.4);background:rgba(16,185,129,0.12);color:#34d399;font-size:11px;font-weight:900;">✅ 보유' + (itemCount > 1 ? ' ×' + itemCount : ' 중') + '</span>';
          } else if (canAfford) {
            actionBtn = '<button type="button" data-buy-id="' + item.id + '" style="padding:6px 10px;border-radius:10px;border:none;background:#f59e0b;color:#0f172a;font-size:11px;font-weight:900;cursor:pointer;">⭐ ' + item.price.toLocaleString() + ' 스타</button>';
          } else {
            actionBtn = '<button type="button" disabled style="padding:6px 10px;border-radius:10px;border:1px solid #334155;background:#1e293b;color:#64748b;font-size:11px;font-weight:800;cursor:not-allowed;">🔒 ' + item.price.toLocaleString() + ' 스타</button>';
          }

          var nameStyle = item.category === 'color' ? ((item.value === 'rainbow' || item.value === 'rainbow_aurora') ? 'color:#f472b6;' : item.value.indexOf('grad:') === 0 ? ('color:' + (item.value.slice(5).split(',')[0] || '#facc15') + ';') : item.value.indexOf('glow:') === 0 ? ('color:' + item.value.slice(5) + ';text-shadow:0 0 6px ' + item.value.slice(5) + ';') : ('color:' + item.value + ';')) : 'color:#f8fafc;';
          sHtml += '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px;border-radius:14px;background:#080c17;border:1px solid ' + (isOwned ? 'rgba(52,211,153,0.35)' : '#1f2942') + ';">' +
            '<div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1;">' +
              previewHtml +
              '<div style="min-width:0;">' +
                '<div style="font-size:12px;font-weight:900;' + nameStyle + '"><span style="font-size:10px;color:#94a3b8;margin-right:4px;">[' + catBadge + ']</span>' + item.name + (isEquipped ? ' <span style="font-size:10px;color:#facc15;">(장착중)</span>' : '') + '</div>' +
                '<div style="font-size:10px;color:#94a3b8;margin-top:2px;line-height:1.3;">' + item.desc + '</div>' +
              '</div>' +
            '</div>' +
            '<div style="flex-shrink:0;">' + actionBtn + '</div>' +
          '</div>';
        });
        sHtml += '</div>';
        bodyEl.innerHTML = sHtml;

        bodyEl.querySelectorAll('button[data-shop-cat]').forEach(function (cbtn) {
          cbtn.addEventListener('click', function () {
            ecoState.shopCategory = cbtn.getAttribute('data-shop-cat') || 'all';
            renderModalContentIfOpen();
          });
        });

        bodyEl.querySelectorAll('canvas[data-skin-preview]').forEach(function (cv) {
          var skinVal = cv.getAttribute('data-skin-preview');
          var c = cv.getContext('2d');
          if (!c) return;
          var cx = 23, cy = 23, r = 9;
          c.clearRect(0, 0, 46, 46);
          c.save();
          var bodyCol = '#38bdf8';
          var colMap = {
            color_red: '#ef4444', ring_red: '#ef4444',
            color_emerald: '#10b981', ring_emerald: '#10b981', trail_emerald: '#10b981',
            color_purple: '#a855f7', ring_purple: '#a855f7', glow_purple: '#c084fc',
            color_gold: '#facc15', ring_gold: '#facc15', glow_gold: '#facc15', trail_gold: '#facc15', gold: '#facc15',
            color_orange: '#fb923c', trail_flame: '#f97316', flame: '#f97316',
            color_pink: '#f472b6', glow_rose: '#fb7185',
            color_mint: '#2dd4bf', trail_aqua: '#06b6d4', glow_aqua: '#22d3ee',
            color_white: '#f8fafc', ring_white: '#e2e8f0',
            glow_lime: '#a3e635',
            prism: '#a855f7', galaxy: '#a855f7'
          };
          if (colMap[skinVal]) bodyCol = colMap[skinVal];

          if (skinVal.indexOf('ring_') === 0) {
            c.strokeStyle = colMap[skinVal] || '#22d3ee'; c.lineWidth = 2.5;
            c.beginPath(); c.arc(cx, cy, r + 4.5, 0, Math.PI * 2); c.stroke();
          } else if (skinVal.indexOf('glow_') === 0) {
            c.shadowColor = colMap[skinVal] || '#22d3ee'; c.shadowBlur = 13;
          } else if (skinVal === 'trail_flame' || skinVal === 'flame' || skinVal === 'trail_aqua' || skinVal === 'trail_emerald' || skinVal === 'trail_gold' || skinVal === 'gold') {
            c.shadowColor = bodyCol; c.shadowBlur = 11;
            c.strokeStyle = bodyCol; c.lineWidth = 2.6;
            c.beginPath(); c.arc(cx, cy, r + 4.8, 0, Math.PI * 2); c.stroke();
          } else if (skinVal === 'trail_neon' || skinVal === 'neon') {
            c.shadowColor = '#22d3ee'; c.shadowBlur = 10;
            c.strokeStyle = '#22d3ee'; c.lineWidth = 2.4; c.setLineDash([5, 3]);
            c.beginPath(); c.arc(cx, cy, r + 4.5, 0, Math.PI * 2); c.stroke();
            c.setLineDash([]);
          } else if (skinVal === 'crown') {
            c.shadowColor = '#fde047'; c.shadowBlur = 11;
            c.strokeStyle = '#fde047'; c.lineWidth = 2.8;
            c.beginPath(); c.arc(cx, cy, r + 5, 0, Math.PI * 2); c.stroke();
          } else if (skinVal === 'prism' || skinVal === 'galaxy') {
            c.shadowColor = '#a855f7'; c.shadowBlur = 12;
            var gGrad = c.createLinearGradient(0, 0, 46, 46);
            gGrad.addColorStop(0, '#f472b6'); gGrad.addColorStop(0.5, '#38bdf8'); gGrad.addColorStop(1, '#facc15');
            c.strokeStyle = gGrad; c.lineWidth = 3;
            c.beginPath(); c.arc(cx, cy, r + 5.2, 0, Math.PI * 2); c.stroke();
          }
          if (skinVal.indexOf('art_') === 0) {
            drawArtMarblePreview(c, skinVal, cx, cy, r + 4);
          } else {
            c.fillStyle = bodyCol;
            c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
            c.shadowBlur = 0;
            c.strokeStyle = '#ffffff'; c.lineWidth = 1.5; c.stroke();
          }
          var badgeIcon = (skinVal === 'trail_gold' || skinVal === 'gold') ? '🌟' : (skinVal === 'trail_flame' || skinVal === 'flame') ? '🔥' : (skinVal === 'trail_aqua') ? '🌊' : (skinVal === 'trail_emerald') ? '🍃' : (skinVal === 'trail_neon' || skinVal === 'neon') ? '⚡' : (skinVal === 'crown' || skinVal === 'galaxy') ? '👑' : skinVal === 'prism' ? '🌈' : '';
          if (badgeIcon) {
            c.font = '11px sans-serif'; c.textAlign = 'center';
            c.fillText(badgeIcon, cx + r, cy - r + 2);
          }
          c.restore();
        });

        bodyEl.querySelectorAll('canvas[data-rod-skin-preview]').forEach(function (cv) {
          var rv = cv.getAttribute('data-rod-skin-preview');
          var c = cv.getContext('2d');
          if (!c) return;
          var rsMap = {
            rod_bamboo: { col: '#4ade80', grip: '#365314', glow: '#bef264', acc: '#fde047' },
            rod_sakura: { col: '#fbcfe8', grip: '#be185d', glow: '#f472b6', acc: '#f9a8d4' },
            rod_cyber: { col: '#e879f9', grip: '#0891b2', glow: '#22d3ee', acc: '#67e8f9' },
            rod_dragon: { col: '#fbbf24', grip: '#991b1b', glow: '#f59e0b', acc: '#ef4444' },
            rod_ice: { col: '#bae6fd', grip: '#0369a1', glow: '#38bdf8', acc: '#ffffff' },
            rod_inferno: { col: '#fb923c', grip: '#7f1d1d', glow: '#ef4444', acc: '#fde047' },
            rod_phantom: { col: '#5eead4', grip: '#115e59', glow: '#2dd4bf', acc: '#a7f3d0' },
            rod_galaxy: { col: '#c084fc', grip: '#312e81', glow: '#818cf8', acc: '#fde047' }
          };
          var st = rsMap[rv] || { col: '#38bdf8', grip: '#1e293b', glow: '#38bdf8', acc: '#ffffff' };
          c.clearRect(0, 0, 46, 46);
          c.save();
          c.shadowColor = st.glow; c.shadowBlur = 10;
          c.strokeStyle = st.col; c.lineWidth = 3.2; c.lineCap = 'round';
          c.beginPath(); c.moveTo(9, 37); c.lineTo(37, 9); c.stroke();
          c.strokeStyle = st.grip; c.lineWidth = 5;
          c.beginPath(); c.moveTo(9, 37); c.lineTo(17, 29); c.stroke();
          c.shadowBlur = 0;
          if (rv === 'rod_bamboo') {
            c.strokeStyle = st.acc; c.lineWidth = 1.8;
            [[20, 26], [28, 18]].forEach(function (p) { c.beginPath(); c.arc(p[0], p[1], 2.2, 0, Math.PI * 2); c.stroke(); });
          } else if (rv === 'rod_sakura') {
            c.fillStyle = st.acc;
            [[16, 15], [31, 27], [34, 13]].forEach(function (p) { c.beginPath(); c.ellipse(p[0], p[1], 3, 1.6, 0.7, 0, Math.PI * 2); c.fill(); });
          } else if (rv === 'rod_cyber' || rv === 'rod_galaxy') {
            c.strokeStyle = st.acc; c.lineWidth = 1.5;
            c.beginPath(); c.ellipse(34, 12, 6, 2.5, -0.5, 0, Math.PI * 2); c.stroke();
          } else {
            c.fillStyle = st.acc;
            [[37, 9], [28, 14], [33, 21]].forEach(function (p) { c.beginPath(); c.arc(p[0], p[1], 2, 0, Math.PI * 2); c.fill(); });
          }
          c.restore();
        });

        bodyEl.querySelectorAll('button[data-buy-bait]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var q = Number(btn.getAttribute('data-buy-bait') || 1);
            fetch('/api/fishing/buy-bait', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-save-code': prof.save_code || '' },
              body: JSON.stringify({ save_code: prof.save_code || '', nickname: prof.nickname, quantity: q })
            })
              .then(function (r) { return r.json(); })
              .then(function (res) {
                if (res && res.ok) {
                  ecoState.gold = res.gold;
                  refreshEconomyStatus();
                  showEcoToast(res.message || '미끼를 구매했습니다!');
                } else if (res && res.error) {
                  showEcoToast(res.error);
                }
              });
          });
        });

        var customBtn = document.getElementById('btnBuyCustomTitle');
        if (customBtn) {
          customBtn.addEventListener('click', function () {
            var inp = document.getElementById('customTitleShopInput');
            var rawVal = inp ? String(inp.value || '').trim() : '';
            if (!rawVal) { showEcoToast('원하는 칭호를 1~8글자로 입력해주세요.'); return; }
            fetch('/api/economy/custom-title/request', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ save_code: prof.save_code, nickname: prof.nickname, titleText: rawVal })
            })
              .then(function (r) { return r.json(); })
              .then(function (res) {
                if (res && res.ok) {
                  ecoState.gold = res.gold;
                  ecoState.cosmetics = res.cosmetics || ecoState.cosmetics;
                  if (res.fishingRods) ecoState.fishingRods = res.fishingRods;
                  updateTopEconomyBar();
                  renderModalContentIfOpen();
                  showEcoToast(res.message || '커스텀 칭호 신청 완료!');
                } else if (res && res.error) {
                  showEcoToast(res.error);
                }
              });
          });
        }

        bodyEl.querySelectorAll('button[data-buy-id]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var iid = btn.getAttribute('data-buy-id');
            fetch('/api/economy/shop/buy', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ save_code: prof.save_code, nickname: prof.nickname, itemId: iid })
            })
              .then(function (r) { return r.json(); })
              .then(function (res) {
                if (res && res.ok) {
                  ecoState.gold = res.gold;
                  ecoState.cosmetics = res.cosmetics || ecoState.cosmetics;
                  updateTopEconomyBar();
                  renderModalContentIfOpen();
                  showEcoToast(res.message || '아이템을 구매했습니다!');
                } else if (res && res.error) {
                  showEcoToast(res.error);
                }
              });
          });
        });

        bodyEl.querySelectorAll('button[data-equip-cat]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var cat = btn.getAttribute('data-equip-cat');
            var iid = btn.getAttribute('data-equip-id');
            fetch('/api/economy/shop/equip', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ save_code: prof.save_code, nickname: prof.nickname, category: cat, itemId: iid })
            })
              .then(function (r) { return r.json(); })
              .then(function (res) {
                if (res && res.ok) {
                  ecoState.cosmetics = res.cosmetics || ecoState.cosmetics;
                  updateTopEconomyBar();
                  renderModalContentIfOpen();
                  showEcoToast(res.message || '장착 상태가 변경되었습니다.');
                }
              });
          });
        });
      } else if (ecoState.activeTab === 'market') {
        var mCats = [
          { id: 'all', label: '전체' },
          { id: 'rod', label: '🎣 낚싯대' },
          { id: 'rodSkin', label: '✨ 낚싯대스킨' },
          { id: 'material', label: '🫧 각성재료' },
          { id: 'marbleSkin', label: '🔮 구슬스킨' },
          { id: 'title', label: '🏷️ 칭호' },
          { id: 'color', label: '🎨 컬러' }
        ];
        var mkHtml = '<div style="padding:9px 11px;border-radius:12px;background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);font-size:11px;color:#fde68a;font-weight:700;margin-bottom:8px;">⚖️ 거래 수수료 <strong>5% 세금</strong> 제외 후 정산 · 등록 후 <strong>3일(72시간)</strong> 경과 시 창고로 자동 반환됩니다.</div>';
        mkHtml += '<div style="display:flex;gap:5px;margin-bottom:10px;flex-wrap:wrap;">';
        mCats.forEach(function (mc) {
          var actM = ecoState.marketFilter === mc.id;
          mkHtml += '<button type="button" data-mkt-cat="' + mc.id + '" style="padding:5px 10px;border-radius:999px;font-size:11px;font-weight:900;cursor:pointer;border:1px solid ' + (actM ? '#f59e0b' : '#263253') + ';background:' + (actM ? 'rgba(245,158,11,0.22)' : '#080c17') + ';color:' + (actM ? '#fde68a' : '#94a3b8') + ';">' + mc.label + '</button>';
        });
        mkHtml += '</div>';
        mkHtml += '<div data-eco-scroll="1" style="display:flex;flex-direction:column;gap:8px;max-height:320px;overflow-y:auto;padding-right:2px;">';
        var listM = (ecoState.marketListings || []).filter(function (l) {
          return ecoState.marketFilter === 'all' || l.itemType === ecoState.marketFilter;
        });
        if (listM.length === 0) {
          mkHtml += '<div style="text-align:center;color:#94a3b8;font-size:12px;padding:24px 0;">현재 등록된 거래소 매물이 없습니다.</div>';
        } else {
          var myCodeUp = String((prof && prof.save_code) || '').toUpperCase();
          listM.forEach(function (l) {
            var isMine = String(l.sellerCode || '').toUpperCase() === myCodeUp;
            var canBuyM = Number(ecoState.gold || 0) >= Number(l.price || 0);
            var typeTag = l.itemType === 'rod' ? '🎣 낚싯대' : l.itemType === 'rodSkin' ? '✨ 낚싯대스킨' : l.itemType === 'material' ? '🫧 재료' : l.itemType === 'marbleSkin' ? '🔮 구슬' : l.itemType === 'title' ? '🏷️ 칭호' : '🎨 컬러';
            var remMs = l.expiresAt ? Math.max(0, new Date(l.expiresAt).getTime() - Date.now()) : (3 * 24 * 3600 * 1000);
            var remHrs = Math.floor(remMs / 3600000);
            var remDays = Math.floor(remHrs / 24);
            var remLabel = remDays > 0 ? (remDays + '일 ' + (remHrs % 24) + '시간') : (Math.max(1, remHrs) + '시간');
            var btnM = isMine
              ? '<button type="button" data-mkt-cancel="' + l.id + '" style="padding:6px 10px;border-radius:10px;border:1px solid #475569;background:#1e293b;color:#e2e8f0;font-size:11px;font-weight:900;cursor:pointer;">취소(반환)</button>'
              : (canBuyM
                ? '<button type="button" data-mkt-buy="' + l.id + '" style="padding:6px 10px;border-radius:10px;border:none;background:#10b981;color:#052e16;font-size:11px;font-weight:900;cursor:pointer;">⭐ ' + Number(l.price || 0).toLocaleString() + ' 구매</button>'
                : '<button type="button" disabled style="padding:6px 10px;border-radius:10px;border:1px solid #334155;background:#1e293b;color:#64748b;font-size:11px;font-weight:800;cursor:not-allowed;">🔒 ' + Number(l.price || 0).toLocaleString() + '</button>');
            mkHtml += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px;border-radius:14px;background:#080c17;border:1px solid ' + (isMine ? 'rgba(56,189,248,0.4)' : '#1f2942') + ';">' +
              '<div style="min-width:0;">' +
                '<div style="font-size:12px;font-weight:900;color:#f8fafc;"><span style="font-size:10px;color:#94a3b8;margin-right:4px;">[' + typeTag + ']</span>' + l.itemName + '</div>' +
                '<div style="font-size:10px;color:#94a3b8;margin-top:2px;">판매자: <strong style="color:#cbd5e1;">' + l.sellerNickname + '</strong> · <strong style="color:#fbbf24;">' + Number(l.price || 0).toLocaleString() + ' 스타</strong> · <span style="color:#7dd3fc;">⏳ ' + remLabel + '</span></div>' +
              '</div>' +
              '<div style="flex-shrink:0;">' + btnM + '</div>' +
            '</div>';
          });
        }
        mkHtml += '</div>';
        bodyEl.innerHTML = mkHtml;
        bodyEl.querySelectorAll('button[data-mkt-cat]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            ecoState.marketFilter = btn.getAttribute('data-mkt-cat') || 'all';
            renderModalContentIfOpen();
          });
        });
        bodyEl.querySelectorAll('button[data-mkt-buy]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var lid = btn.getAttribute('data-mkt-buy');
            fetch('/api/economy/market/buy', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ save_code: prof.save_code, nickname: prof.nickname, listingId: lid })
            })
              .then(function (r) { return r.json(); })
              .then(function (res) {
                if (res && res.ok) {
                  ecoState.gold = res.gold;
                  ecoState.cosmetics = res.cosmetics || ecoState.cosmetics;
                  if (res.fishingRods) ecoState.fishingRods = res.fishingRods;
                  if (Array.isArray(res.listings)) ecoState.marketListings = res.listings;
                  emitEconomyUpdated();
                  renderModalContentIfOpen();
                  refreshEconomyStatus(null, true);
                  showEcoToast(res.message || '거래소 구매 완료!');
                } else if (res && res.error) {
                  showEcoToast(res.error);
                }
              });
          });
        });
        bodyEl.querySelectorAll('button[data-mkt-cancel]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var lid = btn.getAttribute('data-mkt-cancel');
            fetch('/api/economy/market/cancel', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ save_code: prof.save_code, nickname: prof.nickname, listingId: lid })
            })
              .then(function (r) { return r.json(); })
              .then(function (res) {
                if (res && res.ok) {
                  ecoState.cosmetics = res.cosmetics || ecoState.cosmetics;
                  if (res.fishingRods) ecoState.fishingRods = res.fishingRods;
                  if (Array.isArray(res.listings)) ecoState.marketListings = res.listings;
                  emitEconomyUpdated();
                  renderModalContentIfOpen();
                  refreshEconomyStatus(null, true);
                  showEcoToast(res.message || '등록이 취소되었습니다.');
                } else if (res && res.error) {
                  showEcoToast(res.error);
                }
              });
          });
        });
      } else if (ecoState.activeTab === 'ranking') {
        var rHtml = '<div data-eco-scroll="1" style="display:flex;flex-direction:column;gap:6px;max-height:340px;overflow-y:auto;">';
        if (!ecoState.leaderboard || ecoState.leaderboard.length === 0) {
          rHtml += '<div style="text-align:center;color:#94a3b8;font-size:12px;padding:16px 0;">랭킹 데이터를 불러오는 중...</div>';
        } else {
          ecoState.leaderboard.forEach(function (row) {
            var medal = row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : (row.rank + '위');
            var styledNick = (window.ArcadeAuth && window.ArcadeAuth.formatStyledNameHtml)
              ? window.ArcadeAuth.formatStyledNameHtml(row.nickname, row.cosmetics, '#f8fafc')
              : row.nickname;
            rHtml += '<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 12px;border-radius:12px;background:#080c17;border:1px solid ' + (row.rank <= 3 ? 'rgba(250,204,21,0.4)' : '#1f2942') + ';">' +
              '<div style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:900;">' +
                '<span style="width:28px;color:#fbbf24;">' + medal + '</span>' +
                '<span>' + styledNick + '</span>' +
              '</div>' +
              '<span style="font-size:12px;font-weight:900;color:#fde68a;">⭐ ' + Number(row.gold || 0).toLocaleString() + ' 스타</span>' +
            '</div>';
          });
        }
        rHtml += '</div>';
        bodyEl.innerHTML = rHtml;
      }
      if (savedScrollTop > 0) {
        var nextScrollEl = bodyEl.querySelector('[data-eco-scroll]');
        if (nextScrollEl) nextScrollEl.scrollTop = savedScrollTop;
      }
    }

    function ensureEcoScrollCss() {
      if (document.getElementById('arcadeUnifiedScrollCss')) return;
      var st = document.createElement('style');
      st.id = 'arcadeUnifiedScrollCss';
      st.textContent =
        '*{scrollbar-width:thin;scrollbar-color:#2b3861 #080c17;}' +
        '::-webkit-scrollbar{width:6px;height:6px;}' +
        '::-webkit-scrollbar-track{background:#080c17;border-radius:999px;}' +
        '::-webkit-scrollbar-thumb{background:#2b3861;border-radius:999px;border:1px solid #080c17;}' +
        '::-webkit-scrollbar-thumb:hover{background:#4f46e5;}';
      document.head.appendChild(st);
    }

    function openEconomyModal(defaultTab) {
      ensureEcoScrollCss();
      if (defaultTab) ecoState.activeTab = defaultTab;
      var modal = document.getElementById('arcadeEconomyModal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'arcadeEconomyModal';
        modal.style.cssText = 'position:fixed;inset:0;z-index:10002;background:rgba(0,0,0,0.75);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:14px;';
        modal.innerHTML =
          '<div style="width:100%;max-width:440px;background:#111625;border:1px solid #2b3861;border-radius:22px;padding:18px;box-shadow:0 20px 50px rgba(0,0,0,0.7);color:#f8fafc;font-family:Pretendard,system-ui,sans-serif;">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">' +
              '<div style="font-size:15px;font-weight:900;color:#fff;">🏦 스타 센터 · 일일 미션 & 상점</div>' +
              '<div style="display:flex;align-items:center;gap:8px;">' +
                '<span id="arcadeEconomyModalGold" style="padding:4px 10px;border-radius:999px;background:rgba(251,191,36,0.15);border:1px solid rgba(251,191,36,0.45);color:#fde68a;font-size:12px;font-weight:900;">⭐ 0 스타</span>' +
                '<button id="btnCloseArcadeEconomy" type="button" style="background:none;border:none;color:#94a3b8;font-size:20px;font-weight:900;cursor:pointer;line-height:1;">×</button>' +
              '</div>' +
            '</div>' +
            '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-bottom:12px;">' +
              '<button type="button" data-eco-tab="missions" style="padding:8px 4px;border-radius:11px;border:1px solid #1e293b;font-size:11px;font-weight:900;cursor:pointer;">🎁 일일 미션</button>' +
              '<button type="button" data-eco-tab="shop" style="padding:8px 4px;border-radius:11px;border:1px solid #1e293b;font-size:11px;font-weight:900;cursor:pointer;">🛒 상점</button>' +
              '<button type="button" data-eco-tab="market" style="padding:8px 4px;border-radius:11px;border:1px solid #1e293b;font-size:11px;font-weight:900;cursor:pointer;">⚖️ 거래소</button>' +
              '<button type="button" data-eco-tab="ranking" style="padding:8px 4px;border-radius:11px;border:1px solid #1e293b;font-size:11px;font-weight:900;cursor:pointer;">🏆 랭킹</button>' +
            '</div>' +
            '<div id="arcadeEconomyModalBody"></div>' +
          '</div>';
        modal.addEventListener('click', function (e) {
          if (e.target === modal || e.target.id === 'btnCloseArcadeEconomy') {
            modal.style.display = 'none';
          }
        });
        modal.querySelectorAll('button[data-eco-tab]').forEach(function (b) {
          b.addEventListener('click', function () {
            ecoState.activeTab = b.getAttribute('data-eco-tab');
            if (ecoState.activeTab === 'ranking') fetchLeaderboard();
            if (ecoState.activeTab === 'market') fetchMarketListings();
            renderModalContentIfOpen();
          });
        });
        document.body.appendChild(modal);
      }
      modal.style.display = 'flex';
      refreshEconomyStatus();
      if (ecoState.activeTab === 'ranking') fetchLeaderboard();
      if (ecoState.activeTab === 'market') fetchMarketListings();
      renderModalContentIfOpen();
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        refreshEconomyStatus();
      });
    } else {
      refreshEconomyStatus();
    }
    setInterval(function () { if (document.visibilityState !== 'hidden') refreshEconomyStatus(); }, 15000);

    function drawArtMarblePreview(c, sk, cx, cy, r) {
      c.save();
      c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.clip();
      if (sk === 'art_soccer') {
        c.fillStyle = '#f8fafc'; c.fillRect(cx - r, cy - r, r * 2, r * 2);
        c.fillStyle = '#0f172a';
        [[0, 0], [-0.65, -0.55], [0.65, -0.55], [-0.65, 0.55], [0.65, 0.55]].forEach(function (pt) {
          c.beginPath(); c.arc(cx + pt[0] * r, cy + pt[1] * r, r * 0.28, 0, Math.PI * 2); c.fill();
        });
      } else if (sk === 'art_basketball') {
        c.fillStyle = '#ea580c'; c.fillRect(cx - r, cy - r, r * 2, r * 2);
        c.strokeStyle = '#1e1b18'; c.lineWidth = 1.4;
        c.beginPath(); c.moveTo(cx - r, cy); c.lineTo(cx + r, cy); c.moveTo(cx, cy - r); c.lineTo(cx, cy + r); c.stroke();
        c.beginPath(); c.arc(cx - r * 0.75, cy, r * 0.65, -1.1, 1.1); c.stroke();
        c.beginPath(); c.arc(cx + r * 0.75, cy, r * 0.65, Math.PI - 1.1, Math.PI + 1.1); c.stroke();
      } else if (sk === 'art_8ball') {
        c.fillStyle = '#090d16'; c.fillRect(cx - r, cy - r, r * 2, r * 2);
        c.fillStyle = '#ffffff'; c.beginPath(); c.arc(cx, cy, r * 0.48, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#090d16'; c.font = 'bold ' + Math.round(r * 0.75) + 'px sans-serif';
        c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('8', cx, cy + 0.5);
      } else if (sk === 'art_watermelon') {
        c.fillStyle = '#16a34a'; c.fillRect(cx - r, cy - r, r * 2, r * 2);
        c.strokeStyle = '#052e16'; c.lineWidth = r * 0.22;
        [-0.5, 0, 0.5].forEach(function (dx) {
          c.beginPath(); c.moveTo(cx + dx * r, cy - r); c.lineTo(cx + dx * r * 0.6, cy + r); c.stroke();
        });
      } else if (sk === 'art_pokeball') {
        c.fillStyle = '#ef4444'; c.fillRect(cx - r, cy - r, r * 2, r);
        c.fillStyle = '#f8fafc'; c.fillRect(cx - r, cy, r * 2, r);
        c.fillStyle = '#0f172a'; c.fillRect(cx - r, cy - 1.5, r * 2, 3);
        c.beginPath(); c.arc(cx, cy, r * 0.34, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#ffffff'; c.beginPath(); c.arc(cx, cy, r * 0.2, 0, Math.PI * 2); c.fill();
      } else if (sk === 'art_earth') {
        c.fillStyle = '#0284c7'; c.fillRect(cx - r, cy - r, r * 2, r * 2);
        c.fillStyle = '#22c55e';
        c.beginPath(); c.arc(cx - r * 0.3, cy - r * 0.2, r * 0.42, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.arc(cx + r * 0.35, cy + r * 0.25, r * 0.35, 0, Math.PI * 2); c.fill();
      } else if (sk === 'art_donut') {
        c.fillStyle = '#f59e0b'; c.fillRect(cx - r, cy - r, r * 2, r * 2);
        c.fillStyle = '#f472b6'; c.beginPath(); c.arc(cx, cy, r * 0.85, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#040814'; c.beginPath(); c.arc(cx, cy, r * 0.28, 0, Math.PI * 2); c.fill();
      } else if (sk === 'art_eye') {
        c.fillStyle = '#f8fafc'; c.fillRect(cx - r, cy - r, r * 2, r * 2);
        c.fillStyle = '#dc2626'; c.beginPath(); c.arc(cx, cy, r * 0.56, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#090d16'; c.beginPath(); c.arc(cx, cy, r * 0.26, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#ffffff'; c.beginPath(); c.arc(cx - r * 0.16, cy - r * 0.16, r * 0.12, 0, Math.PI * 2); c.fill();
      } else if (sk === 'art_saturn') {
        c.fillStyle = '#1e1b4b'; c.fillRect(cx - r, cy - r, r * 2, r * 2);
        c.fillStyle = '#fbbf24'; c.beginPath(); c.arc(cx, cy, r * 0.62, 0, Math.PI * 2); c.fill();
        c.strokeStyle = '#fde68a'; c.lineWidth = 2.2;
        c.beginPath(); c.ellipse(cx, cy, r * 0.95, r * 0.28, -0.35, 0, Math.PI * 2); c.stroke();
      } else if (sk === 'art_taegeuk') {
        c.fillStyle = '#ef4444'; c.beginPath(); c.arc(cx, cy, r, Math.PI, 0); c.fill();
        c.fillStyle = '#2563eb'; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI); c.fill();
        c.fillStyle = '#ef4444'; c.beginPath(); c.arc(cx - r * 0.5, cy, r * 0.5, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#2563eb'; c.beginPath(); c.arc(cx + r * 0.5, cy, r * 0.5, 0, Math.PI * 2); c.fill();
      }
      c.restore();
      c.strokeStyle = '#ffffff'; c.lineWidth = 1.4;
      c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke();
    }

    function showGlobalAnnouncementBanner(payload) {
      if (!payload || !payload.text) return;
      var el = document.getElementById('arcadeGlobalAnnouncement');
      if (!el) {
        el = document.createElement('div');
        el.id = 'arcadeGlobalAnnouncement';
        el.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:99999;max-width:min(92vw,640px);padding:10px 18px;border-radius:999px;background:linear-gradient(90deg,rgba(15,23,42,0.96),rgba(30,27,75,0.96));border:1px solid rgba(250,204,21,0.65);color:#fef08a;font-size:13px;font-weight:900;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,0.65);pointer-events:none;transition:opacity 0.3s ease;';
        document.body.appendChild(el);
      }
      el.textContent = payload.text;
      el.style.opacity = '1';
      el.style.display = 'block';
      clearTimeout(window.__arcadeAnnTimer);
      window.__arcadeAnnTimer = setTimeout(function () {
        if (el) { el.style.opacity = '0'; setTimeout(function () { if (el) el.style.display = 'none'; }, 300); }
      }, 7500);
    }


  // ================= 🔒 단일 세션 (탭/기기 동시 접속 차단) =================
  var TAB_SESSION_ID = (function () {
    try {
      var sid = sessionStorage.getItem('arcade_tab_session_id');
      if (!sid) {
        sid = 'tab_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
        sessionStorage.setItem('arcade_tab_session_id', sid);
      }
      return sid;
    } catch (_) {
      return 'tab_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
    }
  })();
  window.__ARCADE_TAB_SESSION_ID__ = TAB_SESSION_ID;
  var __trackedSockets = [];
  var __sessionKicked = false;

  function showSessionKickedOverlay(reason) {
    if (__sessionKicked) return;
    __sessionKicked = true;
    window.__ARCADE_SESSION_KICKED__ = true;
    // Stop all local sockets from auto-reconnecting (prevents ping-pong kick loops!)
    __trackedSockets.forEach(function (s) {
      try {
        if (s && s.io && s.io.opts) s.io.opts.reconnection = false;
        if (s && typeof s.disconnect === 'function') s.disconnect();
      } catch (_) {}
    });
    if (document.getElementById('arcadeSessionKickedOverlay')) return;
    var ov = document.createElement('div');
    ov.id = 'arcadeSessionKickedOverlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:999999;background:rgba(2,6,23,0.92);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:20px;font-family:Pretendard,system-ui,sans-serif;';
    ov.innerHTML =
      '<div style="width:100%;max-width:380px;background:#0f172a;border:2px solid rgba(244,63,94,0.65);border-radius:24px;padding:26px 22px;text-align:center;box-shadow:0 25px 60px rgba(0,0,0,0.75);color:#f8fafc;">' +
        '<div style="font-size:40px;margin-bottom:8px;">🔒</div>' +
        '<div style="font-size:18px;font-weight:900;color:#fda4af;margin-bottom:8px;">다른 기기(또는 창)에서 접속됨</div>' +
        '<div style="font-size:13px;line-height:1.55;color:#cbd5e1;margin-bottom:20px;">' + (reason || '같은 계정으로 다른 기기나 새 탭에서 접속하여 현재 연결이 해제되었습니다.') + '</div>' +
        '<button type="button" id="btnReconnectHere" style="width:100%;padding:12px 16px;border:none;border-radius:14px;background:linear-gradient(90deg,#06b6d4,#3b82f6);color:#020617;font-size:14px;font-weight:900;cursor:pointer;">🔄 여기서 다시 연결하기</button>' +
      '</div>';
    document.body.appendChild(ov);
    var btn = document.getElementById('btnReconnectHere');
    if (btn) btn.addEventListener('click', function () { window.location.reload(); });
  }

  // Wrap window.io so EVERY socket on the page carries tabSessionId & save_code
  if (typeof window.io === 'function' && !window.io.__arcadeWrapped) {
    var _origIo = window.io;
    window.io = function (uri, opts) {
      var realUri = uri;
      var realOpts = opts;
      if (typeof uri === 'object' && uri !== null) {
        realOpts = Object.assign({}, uri);
        realUri = undefined;
      } else {
        realOpts = Object.assign({}, opts || {});
      }
      var curCode = '';
      try {
        curCode = localStorage.getItem('arcade_auth_save_code') || localStorage.getItem('marble_auth_save_code') || '';
      } catch (_) {}
      realOpts.auth = Object.assign({}, realOpts.auth || {}, {
        tabSessionId: TAB_SESSION_ID,
        save_code: curCode
      });
      var sock = realUri !== undefined ? _origIo(realUri, realOpts) : _origIo(realOpts);
      __trackedSockets.push(sock);
      sock.on('session_kicked', function (d) {
        showSessionKickedOverlay(d && d.reason);
      });
      sock.on('connect', function () {
        if (__sessionKicked) {
          try { sock.disconnect(); } catch (_) {}
          return;
        }
        var c = '';
        try { c = localStorage.getItem('arcade_auth_save_code') || localStorage.getItem('marble_auth_save_code') || ''; } catch (_) {}
        if (c) sock.emit('register_user_room', { save_code: c, sessionId: TAB_SESSION_ID });
      });
      return sock;
    };
    Object.keys(_origIo).forEach(function (k) { window.io[k] = _origIo[k]; });
    window.io.__arcadeWrapped = true;
  }

  // Wrap window.fetch to attach X-Session-Id on /api/* and detect 409 session kick
  if (typeof window.fetch === 'function' && !window.fetch.__arcadeSessionWrapped) {
    var _origFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.indexOf('/api/') === 0 || url.indexOf(window.location.origin + '/api/') === 0) {
        var nextInit = Object.assign({}, init || {});
        var hdrs = new Headers(nextInit.headers || {});
        if (!hdrs.has('X-Session-Id')) hdrs.set('X-Session-Id', TAB_SESSION_ID);
        nextInit.headers = hdrs;
        return _origFetch(input, nextInit).then(function (resp) {
          if (resp && resp.status === 409) {
            resp.clone().json().then(function (d) {
              if (d && d.kicked) showSessionKickedOverlay(d.error);
            }).catch(function () {});
          }
          return resp;
        });
      }
      return _origFetch(input, init);
    };
    window.fetch.__arcadeSessionWrapped = true;
  }

    if (typeof window.io === 'function') {
      try {
        var annSock = window.io();
        annSock.on('global_announcement', showGlobalAnnouncementBanner);
        annSock.on('market_updated', function (d) {
          if (d && Array.isArray(d.listings)) {
            ecoState.marketListings = d.listings;
            renderModalContentIfOpen();
          }
        });
        annSock.on('gold_updated', function (d) {
          var p = getStoredProfile();
          if (p && d && d.nickname && p.nickname && d.nickname.toLowerCase() === p.nickname.toLowerCase()) {
            refreshEconomyStatus(null, true);
          }
        });
      } catch (_) {}
    }

    window.ArcadeEconomy = {
      refresh: refreshEconomyStatus,
      openModal: openEconomyModal,
      getGold: function () { return ecoState.gold; },
      getCosmetics: function () { return ecoState.cosmetics; },
      getFishingRods: function () { return ecoState.fishingRods || { rods: [], equippedRodId: '' }; },
      setMarketListings: function (list) {
        if (Array.isArray(list)) {
          ecoState.marketListings = list;
          renderModalContentIfOpen();
        }
      },
      getShopCatalog: function () { return ecoState.shopCatalog || []; }
    };
  })();

})();
/* ARCADE_VERSION_END */
