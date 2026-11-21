const fs = require('fs');
const path = require('path');
const os = require('os');

const COMMAND_MANUAL = [
  { cat: '공지·소통', cmd: '/확성기 <내용>', desc: '전 서버 모든 접속자에게 상단 배너 공지를 즉시 발송합니다.', ex: '/확성기 잠시 후 9시에 깜짝 보스 레이드 시작합니다!' },
  { cat: '공지·소통', cmd: '/알림 <닉네임> <내용>', desc: '특정 유저에게 개인 알림(🔔)을 즉시 전송합니다.', ex: '/알림 키티 이벤트 당첨 축하드립니다!' },
  { cat: '재화·아이템', cmd: '/지급 <닉네임> <금액>', desc: '특정 유저에게 스타를 지급하고 경제 장부와 알림을 기록합니다.', ex: '/지급 키티 500000' },
  { cat: '재화·아이템', cmd: '/차감 <닉네임> <금액>', desc: '특정 유저의 보유 스타를 회수합니다.', ex: '/차감 키티 100000' },
  { cat: '재화·아이템', cmd: '/전체지급 <금액> [사유]', desc: '현재 접속 중인 모든 온라인 유저에게 스타를 일괄 지급합니다.', ex: '/전체지급 100000 주말 감사 이벤트' },
  { cat: '재화·아이템', cmd: '/아이템 <닉네임> <종류> [수량]', desc: '방지권·상자·복권·미끼는 물론 모든 칭호·닉네임 컬러·구슬 스킨을 즉시 지급합니다.', ex: '/아이템 키티 방지권 3' },
  { cat: '재화·아이템', cmd: '/아이템회수 <닉네임> <종류> [수량]', desc: '유저의 소모품(방지권·상자·복권·미끼) 및 모든 칭호·닉네임 컬러·구슬 스킨을 즉시 회수합니다.', ex: '/아이템회수 키티 미끼 50' },
  { cat: '재화·아이템', cmd: '/낚싯대지급 <닉네임> <강화수치> [각성]', desc: '특정 유저에게 원하는 강화 단계(0~11강)·각성 낚싯대를 즉시 지급합니다.', ex: '/낚싯대지급 키티 11' },
  { cat: '재화·아이템', cmd: '/낚싯대회수 <닉네임> <강화수치>', desc: '유저가 보유한 특정 강화 단계 낚싯대 1개를 즉시 회수합니다.', ex: '/낚싯대회수 키티 11' },
  { cat: '재화·아이템', cmd: '/압수 <닉네임> <아이템> [수량]', desc: '유저의 아이템(소모품·칭호·컬러·구슬스킨)을 빼서 내(관리자) 창고로 즉시 옮깁니다.', ex: '/압수 키티 상자 3' },
  { cat: '재화·아이템', cmd: '/낚싯대압수 <닉네임> <강화수치>', desc: '유저의 특정 강화 단계 낚싯대 1개를 내(관리자) 창고로 즉시 옮깁니다.', ex: '/낚싯대압수 키티 11' },
  { cat: '이벤트·재미', cmd: '/선물상자', desc: '낚시터 화면에 선착순 보물상자를 즉시 1개 투하합니다.', ex: '/선물상자' },
  { cat: '이벤트·재미', cmd: '/추첨 <금액>', desc: '현재 온라인 유저 중 랜덤 1명을 추첨해 스타 지급 + 확성기 발표합니다.', ex: '/추첨 300000' },
  { cat: '이벤트·재미', cmd: '/선착순 <키워드> <금액> <인원> [분]', desc: '전 유저 상단에 선착순 이벤트 배너를 띄웁니다. (/선착순 종료 로 중단)', ex: '/선착순 화이팅 100000 5 3' },
  { cat: '이벤트·재미', cmd: '/핫타임 <배수> <분>', desc: '지정 시간 동안 낚시 판매가 배수 핫타임 버프를 적용합니다. (/핫타임 종료)', ex: '/핫타임 1.5 30' },
  { cat: '낚시터 제어', cmd: '/보스', desc: '낚시터에 보스 레이드를 즉시 소환합니다.', ex: '/보스' },
  { cat: '낚시터 제어', cmd: '/날씨 [폭풍|황금|무지개|맑음]', desc: '낚시터 특수 날씨를 즉시 변경합니다. (생략 시 랜덤 특수 날씨)', ex: '/날씨 황금' },
  { cat: '낚시터 제어', cmd: '/대회 <시작 [분]|종료>', desc: '낚시 대회를 즉시 시작하거나 종료합니다.', ex: '/대회 시작 10' },
  { cat: '낚시터 제어', cmd: '/미끼초기화 [닉네임|전체]', desc: '전체 또는 특정 유저의 오늘 미끼 사용 횟수를 0으로 초기화합니다.', ex: '/미끼초기화 전체' },
  { cat: '어뷰징·긴급', cmd: '/채금 <닉네임> [분]', desc: '유저의 모든 채팅(낚시터·마블·1:1 DM)을 지정 분 동안 제한합니다. (기본 10분)', ex: '/채금 도배유저 15' },
  { cat: '어뷰징·긴급', cmd: '/채금해제 <닉네임>', desc: '채금이 걸린 유저의 제한을 즉시 해제합니다.', ex: '/채금해제 도배유저' },
  { cat: '어뷰징·긴급', cmd: '/강퇴 <닉네임>', desc: '특정 유저를 현재 참여 중인 마블 방에서 즉시 퇴장시킵니다.', ex: '/강퇴 비매너' },
  { cat: '어뷰징·긴급', cmd: '/거래정지 <on|off>', desc: '서버 재시작 없이 거래소 및 1:1 직거래를 긴급 잠금/해제합니다.', ex: '/거래정지 on' },
  { cat: '어뷰징·긴급', cmd: '/점검 <분> [사유]', desc: '전 유저 상단에 서버 점검 카운트다운 배너를 표시합니다. (/점검 해제)', ex: '/점검 5 v1.5 업데이트 적용' },
  { cat: '어뷰징·긴급', cmd: '/백업', desc: '현재 서버의 모든 JSON DB 파일을 backups 폴더에 즉시 백업합니다.', ex: '/백업' },
  { cat: '조회·모니터링', cmd: '/현황', desc: '접속자 수, 활성 방, 오늘 스타 유입/소각/순증감 요약을 확인합니다.', ex: '/현황' },
  { cat: '조회·모니터링', cmd: '/접속자', desc: '현재 온라인 유저 목록과 각 유저가 있는 위치(로비·낚시터·마블)를 봅니다.', ex: '/접속자' },
  { cat: '조회·모니터링', cmd: '/코드 <닉네임>', desc: '보안코드를 분실한 유저의 8자리 세이브 코드를 즉시 조회합니다.', ex: '/코드 키티' },
  { cat: '조회·모니터링', cmd: '/조회 <닉네임>', desc: '특정 유저의 보유 스타, 최고 낚싯대, 온라인 여부, 채금 상태를 조회합니다.', ex: '/조회 키티' },
  { cat: '조회·모니터링', cmd: '/서버', desc: 'Node 메모리(RSS/Heap), 서버 가동시간, 활성 소켓 수 등 서버 상태를 확인합니다.', ex: '/서버' },
  { cat: '조회·모니터링', cmd: '/로그', desc: '최근 관리자 명령어·고액 거래·매크로 의심 감지 로그 10건을 확인합니다.', ex: '/로그' },
  { cat: '조회·모니터링', cmd: '/문의', desc: '미답변 고객 문의 건수와 최근 미답변 문의 5건을 미리 봅니다.', ex: '/문의' },
  { cat: '조회·모니터링', cmd: '/방삭제 <방제목 또는 ID>', desc: '방치되거나 문제가 생긴 마블 룰렛 방을 강제 삭제합니다.', ex: '/방삭제 테스트방' },
  { cat: '기타', cmd: '/도움', desc: '사용 가능한 주요 명령어 목록을 터미널에 출력합니다.', ex: '/도움' }
];

function setupAdminConsoleModule(app, io, deps) {
  const {
    usersDB,
    saveUsersDB,
    findUserByValidCode,
    findUserByNickname,
    ensureUserStatsStructure,
    isAdminAuthorized,
    addUserGold,
    pushUserNotification,
    recordEconomyFlow,
    getTodayKstString,
    getOnlineUsersList,
    getMarbleRoomsSummary,
    deleteMarbleRoomByQuery,
    kickUserFromMarbleRooms,
    getInquiriesList,
    getEconomySummaryToday,
    getEffectiveShopCatalog,
    addCosmeticItem,
    removeCosmeticItem,
    getFishingHooks,
    rootDir
  } = deps;

  // 실시간 Node 프로세스 CPU 사용률(%) 2초 간격 샘플링 (Termux/Linux 공통 동작)
  let _lastCpuUsage = process.cpuUsage();
  let _lastCpuHr = process.hrtime.bigint();
  let _lastCpuPct = 0;
  let _peakCpuPct = 0;
  setInterval(() => {
    try {
      const nowHr = process.hrtime.bigint();
      const diff = process.cpuUsage(_lastCpuUsage);
      const elapsedUs = Number(nowHr - _lastCpuHr) / 1000;
      if (elapsedUs > 0) {
        const usedUs = diff.user + diff.system;
        _lastCpuPct = Math.round((usedUs / elapsedUs) * 1000) / 10; // 단일 코어 기준 %(top 표시 방식과 동일)
        if (_lastCpuPct > _peakCpuPct) _peakCpuPct = _lastCpuPct;
      }
      _lastCpuUsage = process.cpuUsage();
      _lastCpuHr = nowHr;
    } catch (_) {}
  }, 2000);

  const runtime = {
    hotTime: { active: false, multiplier: 1, endsAt: 0, label: '' },
    maintenance: { active: false, endsAt: 0, reason: '' },
    fcfsEvent: null, // { id, keyword, reward, maxWinners, winners: [{ userId, nickname, at }], endsAt }
    mutedUsers: new Map(), // nickLower -> { nickname, until, reason }
    tradeFrozen: false,
    logs: []
  };

  function pushAuditLog(category, text) {
    const d = new Date(Date.now() + 9 * 3600 * 1000);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    const ss = String(d.getUTCSeconds()).padStart(2, '0');
    runtime.logs.unshift({
      at: Date.now(),
      time: `${hh}:${mm}:${ss}`,
      category: String(category || 'ADMIN'),
      text: String(text || '')
    });
    if (runtime.logs.length > 80) runtime.logs.length = 80;
  }

  function cleanExpiredStates() {
    const now = Date.now();
    let changed = false;
    if (runtime.hotTime.active && runtime.hotTime.endsAt <= now) {
      runtime.hotTime = { active: false, multiplier: 1, endsAt: 0, label: '' };
      changed = true;
    }
    if (runtime.maintenance.active && runtime.maintenance.endsAt <= now) {
      runtime.maintenance = { active: false, endsAt: 0, reason: '' };
      changed = true;
    }
    if (runtime.fcfsEvent && (runtime.fcfsEvent.endsAt <= now || runtime.fcfsEvent.winners.length >= runtime.fcfsEvent.maxWinners)) {
      if (runtime.fcfsEvent.endsAt <= now) {
        runtime.fcfsEvent = null;
        changed = true;
      }
    }
    for (const [k, v] of runtime.mutedUsers.entries()) {
      if (!v || v.until <= now) runtime.mutedUsers.delete(k);
    }
    return changed;
  }

  function getPublicBannerState() {
    cleanExpiredStates();
    const fc = runtime.fcfsEvent;
    return {
      serverNow: Date.now(),
      tradeFrozen: runtime.tradeFrozen,
      hotTime: runtime.hotTime.active ? { ...runtime.hotTime } : { active: false, multiplier: 1, endsAt: 0, label: '' },
      maintenance: runtime.maintenance.active ? { ...runtime.maintenance } : { active: false, endsAt: 0, reason: '' },
      fcfsEvent: fc && fc.winners.length < fc.maxWinners && fc.endsAt > Date.now()
        ? {
            id: fc.id,
            keyword: fc.keyword,
            reward: fc.reward,
            maxWinners: fc.maxWinners,
            claimedCount: fc.winners.length,
            endsAt: fc.endsAt
          }
        : null
    };
  }

  function broadcastBannerState() {
    io.emit('admin_banner_state', getPublicBannerState());
  }

  function isUserChatMuted(nickname) {
    cleanExpiredStates();
    const key = String(nickname || '').trim().toLowerCase();
    if (!key) return null;
    const info = runtime.mutedUsers.get(key);
    if (!info || info.until <= Date.now()) return null;
    const remainSec = Math.max(1, Math.ceil((info.until - Date.now()) / 1000));
    const remainMin = Math.ceil(remainSec / 60);
    return { ...info, remainSec, remainMin };
  }

  function getHotTimeMultiplier() {
    cleanExpiredStates();
    return runtime.hotTime.active ? Math.max(1, Number(runtime.hotTime.multiplier || 1)) : 1;
  }

  function isTradeFrozen() {
    return Boolean(runtime.tradeFrozen);
  }

  // Periodic expiry broadcast (every 15s)
  setInterval(() => {
    if (cleanExpiredStates()) broadcastBannerState();
  }, 15000);

  // Public + Admin panel state endpoint
  app.get('/api/admin/panel/state', (req, res) => {
    const pub = getPublicBannerState();
    const isAdm = isAdminAuthorized(req);
    if (!isAdm) {
      return res.json({ ok: true, isAdmin: false, banner: pub });
    }
    return res.json({
      ok: true,
      isAdmin: true,
      banner: pub,
      manual: COMMAND_MANUAL,
      onlineNicknames: (getOnlineUsersList() || []).map((u) => u.nickname).filter(Boolean),
      allUsers: (() => {
        const onSet = new Set((getOnlineUsersList() || []).map((u) => String(u.nickname || '').toLowerCase()));
        return usersDB
          .map((u) => ({ nickname: u.nickname, online: onSet.has(String(u.nickname || '').toLowerCase()) }))
          .filter((x) => Boolean(x.nickname))
          .sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0) || a.nickname.localeCompare(b.nickname, 'ko'));
      })(),
      allItems: (() => {
        const base = [
          { key: '방지권', name: '🛡️ 대장간 파괴 방지권', cat: '소모품' },
          { key: '상자', name: '🧰 보물상자', cat: '소모품' },
          { key: '복권', name: '🎫 황금 복권', cat: '소모품' },
          { key: '미끼', name: '🪱 추가 미끼', cat: '소모품' }
        ];
        const catMap = { title: '칭호', color: '컬러', marbleSkin: '구슬스킨', fishingPet: '낚시펫', rodEffect: '낚시이펙트', rodSkin: '낚싯대스킨', consumable: '상점소모품', material: '재료' };
        const shop = typeof getEffectiveShopCatalog === 'function' ? (getEffectiveShopCatalog() || []) : [];
        shop.forEach((it) => {
          if (!it || !it.id) return;
          if (it.id === 'fishing_protect_ticket') return; // 방지권과 중복 제외
          base.push({
            key: it.id,
            name: String(it.name || it.id),
            cat: catMap[it.category] || String(it.category || '치장')
          });
        });
        return base;
      })(),
      mutedCount: runtime.mutedUsers.size,
      recentLogs: runtime.logs.slice(0, 15)
    });
  });

  // Player FCFS Event Claim Endpoint
  app.post('/api/events/fcfs/claim', (req, res) => {
    const saveCode = String(req.headers['x-save-code'] || req.body?.save_code || '').trim();
    const user = findUserByValidCode(saveCode);
    if (!user) return res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
    cleanExpiredStates();
    const fc = runtime.fcfsEvent;
    if (!fc || fc.endsAt <= Date.now()) {
      return res.status(400).json({ ok: false, error: '진행 중인 선착순 이벤트가 없습니다.' });
    }
    if (fc.winners.length >= fc.maxWinners) {
      return res.status(400).json({ ok: false, error: '이미 선착순 마감되었습니다!' });
    }
    const answer = String(req.body?.keyword || '').trim();
    if (answer.toLowerCase() !== fc.keyword.toLowerCase()) {
      return res.status(400).json({ ok: false, error: `키워드가 일치하지 않습니다. (정답: ${fc.keyword})` });
    }
    if (fc.winners.some((w) => w.userId === user.id)) {
      return res.status(400).json({ ok: false, error: '이미 이번 선착순 이벤트 보상을 받았습니다.' });
    }
    fc.winners.push({ userId: user.id, nickname: user.nickname, at: Date.now() });
    addUserGold(user.nickname, fc.reward, 'admin_fcfs_event');
    pushUserNotification(user, {
      type: 'reward',
      icon: '⚡',
      title: `선착순 이벤트 ${fc.winners.length}등 당첨!`,
      message: `키워드 [${fc.keyword}] 선착순 보상으로 ${fc.reward.toLocaleString()} 스타를 받았습니다!`
    }, true);
    pushAuditLog('FCFS', `${user.nickname} 선착순 ${fc.winners.length}/${fc.maxWinners}등 (+${fc.reward.toLocaleString()} 스타)`);
    if (fc.winners.length >= fc.maxWinners) {
      io.emit('global_announcement', {
        id: 'ann_' + Date.now(),
        at: Date.now(),
        text: `⚡ 선착순 [${fc.keyword}] 이벤트가 마감되었습니다! (당첨자: ${fc.winners.map((w) => w.nickname).join(', ')})`
      });
      runtime.fcfsEvent = null;
    }
    broadcastBannerState();
    return res.json({
      ok: true,
      rank: fc.winners.length,
      reward: fc.reward,
      message: `🎉 선착순 ${fc.winners.length}등 당첨! +${fc.reward.toLocaleString()} 스타 지급 완료!`
    });
  });

  // Execute Admin Command
  app.post('/api/admin/command', (req, res) => {
    if (!isAdminAuthorized(req)) {
      return res.status(403).json({ ok: false, error: '관리자 권한이 필요합니다.' });
    }
    const raw = String(req.body?.command || '').trim();
    if (!raw) return res.status(400).json({ ok: false, error: '명령어를 입력해 주세요.' });

    const normalized = raw.startsWith('/') ? raw : '/' + raw;
    const tokens = normalized.split(/\s+/).filter(Boolean);
    const cmd = tokens[0].toLowerCase();
    const args = tokens.slice(1);
    const restText = normalized.slice(tokens[0].length).trim();
    const fh = typeof getFishingHooks === 'function' ? getFishingHooks() : null;

    const reply = (lines, extra = {}) => {
      const output = Array.isArray(lines) ? lines.join('\n') : String(lines || '');
      if (cmd !== '/도움' && cmd !== '/현황' && cmd !== '/접속자' && cmd !== '/서버' && cmd !== '/로그' && cmd !== '/문의' && cmd !== '/조회') {
        pushAuditLog('CMD', `${normalized} -> ${output.split('\n')[0].slice(0, 70)}`);
      }
      return res.json({ ok: true, command: normalized, output, banner: getPublicBannerState(), ...extra });
    };

    try {
      // 1. /도움
      if (cmd === '/도움' || cmd === '/help') {
        const lines = ['📖 주요 관리자 명령어 (우측 상단 [📖 설명서] 버튼에서 전체 검색 가능)'];
        COMMAND_MANUAL.forEach((m) => {
          lines.push(`• ${m.cmd} — ${m.desc}`);
        });
        return reply(lines);
      }

      // 2. /확성기 <내용>
      if (cmd === '/확성기') {
        if (!restText) return res.status(400).json({ ok: false, error: '사용법: /확성기 공지할 내용' });
        io.emit('global_announcement', { id: 'ann_' + Date.now(), at: Date.now(), text: restText });
        return reply(`📢 전 서버 확성기 발송 완료: "${restText}"`);
      }

      // 3. /알림 <닉네임> <내용>
      if (cmd === '/알림') {
        const nick = args[0];
        const msg = args.slice(1).join(' ').trim();
        if (!nick || !msg) return res.status(400).json({ ok: false, error: '사용법: /알림 닉네임 보낼내용' });
        const u = findUserByNickname(nick);
        if (!u) return res.status(404).json({ ok: false, error: `유저 '${nick}'을(를) 찾을 수 없습니다.` });
        pushUserNotification(u, { type: 'admin', icon: '📩', title: '관리자 메시지', message: msg }, true);
        return reply(`🔔 [${u.nickname}]님에게 개인 알림 전송 완료: "${msg}"`);
      }

      // 4. /지급 <닉네임> <금액> & 5. /차감 <닉네임> <금액>
      if (cmd === '/지급' || cmd === '/차감') {
        const nick = args[0];
        const amt = Math.floor(Number(String(args[1] || '').replace(/,/g, '')));
        if (!nick || !Number.isFinite(amt) || amt <= 0) {
          return res.status(400).json({ ok: false, error: `사용법: ${cmd} 닉네임 금액 (예: ${cmd} 키티 100000)` });
        }
        const u = findUserByNickname(nick);
        if (!u) return res.status(404).json({ ok: false, error: `유저 '${nick}'을(를) 찾을 수 없습니다.` });
        const delta = cmd === '/지급' ? amt : -amt;
        addUserGold(u.nickname, delta, cmd === '/지급' ? 'admin_grant' : 'admin_deduct');
        const reason = args.slice(2).join(' ').trim();
        pushUserNotification(u, {
          type: 'reward',
          icon: delta > 0 ? '🎁' : '⚠️',
          title: delta > 0 ? `관리자 스타 지급 (+${amt.toLocaleString()})` : `관리자 스타 회수 (-${amt.toLocaleString()})`,
          message: reason || (delta > 0 ? '관리자로부터 스타가 지급되었습니다.' : '관리자에 의해 스타가 조정되었습니다.')
        }, true);
        return reply(`⭐ [${u.nickname}] ${delta > 0 ? '+' : ''}${delta.toLocaleString()} 스타 적용 완료 (현재 보유: ${Number(u.gold || 0).toLocaleString()} 스타)`);
      }

      // 6. /전체지급 <금액> [사유]
      if (cmd === '/전체지급') {
        const amt = Math.floor(Number(String(args[0] || '').replace(/,/g, '')));
        if (!Number.isFinite(amt) || amt <= 0) {
          return res.status(400).json({ ok: false, error: '사용법: /전체지급 금액 [사유]' });
        }
        const reason = args.slice(1).join(' ').trim() || '관리자 깜짝 전체 지급 이벤트';
        const online = getOnlineUsersList() || [];
        let count = 0;
        online.forEach((ou) => {
          const u = findUserByNickname(ou.nickname);
          if (!u) return;
          addUserGold(u.nickname, amt, 'admin_grant_all');
          pushUserNotification(u, {
            type: 'reward',
            icon: '🎉',
            title: `전체 이벤트 보상 +${amt.toLocaleString()} 스타!`,
            message: reason
          }, false);
          count++;
        });
        if (count > 0) saveUsersDB(usersDB);
        io.emit('global_announcement', {
          id: 'ann_' + Date.now(),
          at: Date.now(),
          text: `🎉 관리자 깜짝 선물! 접속 중인 ${count}명 전원에게 +${amt.toLocaleString()} 스타 지급! (${reason})`
        });
        return reply(`🎉 온라인 유저 ${count}명 전원에게 +${amt.toLocaleString()} 스타 일괄 지급 완료!`);
      }

      // 7. /아이템 <닉네임> <방지권|상자|복권|미끼> [수량]
      if (cmd === '/아이템') {
        const nick = args[0];
        const kind = String(args[1] || '').trim();
        const qty = Math.max(1, Math.min(999, Math.floor(Number(args[2] || 1))));
        if (!nick || !kind) {
          return res.status(400).json({ ok: false, error: '사용법: /아이템 닉네임 방지권|상자|복권|미끼 [수량]' });
        }
        const u = findUserByNickname(nick);
        if (!u) return res.status(404).json({ ok: false, error: `유저 '${nick}'을(를) 찾을 수 없습니다.` });
        ensureUserStatsStructure(u);
        if (!u.game_data.fishing) u.game_data.fishing = {};
        const f = u.game_data.fishing;
        let label = '';
        if (kind.includes('방지')) {
          if (typeof addCosmeticItem === 'function') addCosmeticItem(u, 'consumable', 'rod_protect_ticket', qty);
          f.protectTickets = Math.max(0, Number(u.game_data?.cosmetics?.itemCounts?.rod_protect_ticket || 0));
          label = `🛡️ 대장간 파괴 방지권 ${qty}장`;
        } else if (kind.includes('상자') || kind.includes('보물')) {
          f.treasureChests = (f.treasureChests || 0) + qty;
          label = `🧰 보물상자 ${qty}개`;
        } else if (kind.includes('복권') || kind.includes('티켓')) {
          f.lotteryTickets = (f.lotteryTickets || 0) + qty;
          label = `🎫 황금 복권 ${qty}장`;
        } else if (kind.includes('미끼')) {
          f.extraBait = (f.extraBait || 0) + qty;
          label = `🪱 추가 미끼 ${qty}개`;
        } else {
          const shop = typeof getEffectiveShopCatalog === 'function' ? (getEffectiveShopCatalog() || []) : [];
          const normK = kind.toLowerCase().replace(/\s+/g, '');
          const found = shop.find((it) => String(it.id || '').toLowerCase() === normK)
            || shop.find((it) => String(it.name || '').toLowerCase().replace(/\s+/g, '') === normK)
            || shop.find((it) => String(it.name || '').toLowerCase().replace(/\s+/g, '').includes(normK));
          if (!found || typeof addCosmeticItem !== 'function') {
            return res.status(400).json({ ok: false, error: `아이템 '${kind}'을(를) 찾을 수 없습니다. 자동완성 목록에서 선택해 주세요.` });
          }
          addCosmeticItem(u, found.category, found.id, qty);
          label = `✨ ${found.name} ${qty}개`;
        }
        u.updated_at = new Date().toISOString();
        saveUsersDB(usersDB);
        pushUserNotification(u, {
          type: 'reward',
          icon: '🎁',
          title: '관리자 아이템 지급',
          message: `${label}이(가) 창고로 지급되었습니다!`
        }, true);
        return reply(`🎁 [${u.nickname}]님에게 ${label} 지급 완료!`);
      }

      // 7.5. /아이템회수 <닉네임> <방지권|상자|복권|미끼> [수량]
      if (cmd === '/아이템회수') {
        const nick = args[0];
        const kind = String(args[1] || '').trim();
        const qty = Math.max(1, Math.min(9999, Math.floor(Number(args[2] || 1))));
        if (!nick || !kind) {
          return res.status(400).json({ ok: false, error: '사용법: /아이템회수 닉네임 방지권|상자|복권|미끼 [수량]' });
        }
        const u = findUserByNickname(nick);
        if (!u) return res.status(404).json({ ok: false, error: `유저 '${nick}'을(를) 찾을 수 없습니다.` });
        ensureUserStatsStructure(u);
        if (!u.game_data.fishing) u.game_data.fishing = {};
        const f = u.game_data.fishing;
        let label = '';
        let removed = 0;
        let remain = 0;
        if (kind.includes('방지')) {
          const cur = Math.max(0, Number(u.game_data?.cosmetics?.itemCounts?.rod_protect_ticket || 0));
          removed = Math.min(cur, qty);
          if (removed > 0 && typeof removeCosmeticItem === 'function') removeCosmeticItem(u, 'consumable', 'rod_protect_ticket', removed);
          remain = Math.max(0, Number(u.game_data?.cosmetics?.itemCounts?.rod_protect_ticket || 0));
          f.protectTickets = remain;
          label = '🛡️ 파괴 방지권';
        } else if (kind.includes('상자') || kind.includes('보물')) {
          const cur = Math.max(0, Number(f.treasureChests || 0));
          removed = Math.min(cur, qty);
          f.treasureChests = cur - removed;
          remain = f.treasureChests;
          label = '🧰 보물상자';
        } else if (kind.includes('복권') || kind.includes('티켓')) {
          const cur = Math.max(0, Number(f.lotteryTickets || 0));
          removed = Math.min(cur, qty);
          f.lotteryTickets = cur - removed;
          remain = f.lotteryTickets;
          label = '🎫 황금 복권';
        } else if (kind.includes('미끼')) {
          const cur = Math.max(0, Number(f.extraBait || 0));
          removed = Math.min(cur, qty);
          f.extraBait = cur - removed;
          remain = f.extraBait;
          label = '🪱 추가 미끼';
        } else {
          const shop = typeof getEffectiveShopCatalog === 'function' ? (getEffectiveShopCatalog() || []) : [];
          const normK = kind.toLowerCase().replace(/\s+/g, '');
          const found = shop.find((it) => String(it.id || '').toLowerCase() === normK)
            || shop.find((it) => String(it.name || '').toLowerCase().replace(/\s+/g, '') === normK)
            || shop.find((it) => String(it.name || '').toLowerCase().replace(/\s+/g, '').includes(normK));
          if (!found || typeof removeCosmeticItem !== 'function') {
            return res.status(400).json({ ok: false, error: `아이템 '${kind}'을(를) 찾을 수 없습니다. 자동완성 목록에서 선택해 주세요.` });
          }
          const curCnt = Math.max(0, Number(u.game_data?.cosmetics?.itemCounts?.[found.id] || 0));
          if (curCnt <= 0) {
            return res.status(400).json({ ok: false, error: `[${u.nickname}]님은 '${found.name}'을(를) 보유하고 있지 않습니다.` });
          }
          removed = Math.min(curCnt, qty);
          removeCosmeticItem(u, found.category, found.id, removed);
          remain = Math.max(0, Number(u.game_data?.cosmetics?.itemCounts?.[found.id] || 0));
          label = `✨ ${found.name}`;
        }
        u.updated_at = new Date().toISOString();
        saveUsersDB(usersDB);
        return reply(`🧹 [${u.nickname}] ${label} ${removed}개 회수 완료 (남은 수량: ${remain}개)`);
      }

      // 7.55. /낚싯대지급 <닉네임> <강화수치> [각성단계]
      if (cmd === '/낚싯대지급') {
        const nick = args[0];
        const lv = Math.floor(Number(args[1]));
        const awk = Math.max(0, Math.min(10, Math.floor(Number(args[2] || 0))));
        if (!nick || !Number.isFinite(lv) || lv < 0 || lv > 11) {
          return res.status(400).json({ ok: false, error: '사용법: /낚싯대지급 닉네임 강화수치(0~11) [각성0~10] (예: /낚싯대지급 키티 11)' });
        }
        const u = findUserByNickname(nick);
        if (!u) return res.status(404).json({ ok: false, error: `유저 '${nick}'을(를) 찾을 수 없습니다.` });
        ensureUserStatsStructure(u);
        if (!u.game_data.fishing) u.game_data.fishing = {};
        const f = u.game_data.fishing;
        if (!Array.isArray(f.rods)) f.rods = [];
        const newRod = {
          id: 'rod_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          level: lv,
          awakening: lv >= 11 ? awk : 0,
          awakeningLevel: lv >= 11 ? awk : 0,
          skinLevel: lv,
          dailyBaitUsed: 0,
          dailyBaitDate: getTodayKstString(),
          createdAt: new Date().toISOString()
        };
        f.rods.push(newRod);
        if (!f.equippedRodId) {
          f.equippedRodId = newRod.id;
          f.rodLevel = lv;
        }
        u.updated_at = new Date().toISOString();
        saveUsersDB(usersDB);
        const awkTxt = newRod.awakeningLevel > 0 ? ` (${newRod.awakeningLevel}각성)` : '';
        pushUserNotification(u, {
          type: 'reward',
          icon: '🎣',
          title: `관리자 낚싯대 지급 (+${lv}강${awkTxt})`,
          message: `+${lv}강${awkTxt} 낚싯대가 내 창고로 지급되었습니다!`
        }, true);
        return reply(`🎣 [${u.nickname}]님에게 +${lv}강${awkTxt} 낚싯대 1개 지급 완료! (총 보유 ${f.rods.length}개)`);
      }

      // 7.6. /낚싯대회수 <닉네임> <강화수치>
      if (cmd === '/낚싯대회수') {
        const nick = args[0];
        const lv = Math.floor(Number(args[1]));
        if (!nick || !Number.isFinite(lv) || lv < 0) {
          return res.status(400).json({ ok: false, error: '사용법: /낚싯대회수 닉네임 강화수치 (예: /낚싯대회수 키티 11)' });
        }
        const u = findUserByNickname(nick);
        if (!u) return res.status(404).json({ ok: false, error: `유저 '${nick}'을(를) 찾을 수 없습니다.` });
        ensureUserStatsStructure(u);
        const f = u.game_data.fishing || {};
        if (!Array.isArray(f.rods)) return res.status(404).json({ ok: false, error: '보유한 낚싯대가 없습니다.' });
        const idx = f.rods.findIndex((r) => Number(r.level || 0) === lv);
        if (idx === -1) return res.status(404).json({ ok: false, error: `[${u.nickname}]님은 +${lv}강 낚싯대를 보유하고 있지 않습니다.` });
        const [removedRod] = f.rods.splice(idx, 1);
        if (f.equippedRodId === removedRod.id) {
          f.equippedRodId = f.rods[0] ? f.rods[0].id : '';
          f.rodLevel = f.rods[0] ? Number(f.rods[0].level || 0) : 0;
        }
        u.updated_at = new Date().toISOString();
        saveUsersDB(usersDB);
        return reply(`🧹 [${u.nickname}] +${lv}강 낚싯대 1개 회수 완료 (남은 낚싯대: ${f.rods.length}개)`);
      }

      // 7.7. /압수 <닉네임> <아이템> [수량] (유저 -> 실행 관리자 창고로 즉시 이동)
      if (cmd === '/압수') {
        const adminCode = String(req.headers['x-admin-save-code'] || req.body?.adminSaveCode || '').trim();
        const adminUser = findUserByValidCode(adminCode);
        if (!adminUser) return res.status(401).json({ ok: false, error: '관리자 계정 정보를 확인할 수 없습니다.' });
        const nick = args[0];
        const kind = String(args[1] || '').trim();
        const qty = Math.max(1, Math.min(9999, Math.floor(Number(args[2] || 1))));
        if (!nick || !kind) {
          return res.status(400).json({ ok: false, error: '사용법: /압수 닉네임 아이템 [수량]' });
        }
        const u = findUserByNickname(nick);
        if (!u) return res.status(404).json({ ok: false, error: `유저 '${nick}'을(를) 찾을 수 없습니다.` });
        if (u.id === adminUser.id) return res.status(400).json({ ok: false, error: '본인 계정에서는 압수할 수 없습니다.' });
        ensureUserStatsStructure(u);
        ensureUserStatsStructure(adminUser);
        if (!u.game_data.fishing) u.game_data.fishing = {};
        if (!adminUser.game_data.fishing) adminUser.game_data.fishing = {};
        const f = u.game_data.fishing;
        const af = adminUser.game_data.fishing;
        let label = '';
        let moved = 0;
        if (kind.includes('방지')) {
          const cur = Math.max(0, Number(u.game_data?.cosmetics?.itemCounts?.rod_protect_ticket || 0));
          if (cur <= 0) return res.status(400).json({ ok: false, error: `[${u.nickname}]님은 파괴 방지권을 보유하고 있지 않습니다.` });
          moved = Math.min(cur, qty);
          if (typeof removeCosmeticItem === 'function') removeCosmeticItem(u, 'consumable', 'rod_protect_ticket', moved);
          if (typeof addCosmeticItem === 'function') addCosmeticItem(adminUser, 'consumable', 'rod_protect_ticket', moved);
          f.protectTickets = Math.max(0, Number(u.game_data?.cosmetics?.itemCounts?.rod_protect_ticket || 0));
          af.protectTickets = Math.max(0, Number(adminUser.game_data?.cosmetics?.itemCounts?.rod_protect_ticket || 0));
          label = '🛡️ 파괴 방지권';
        } else if (kind.includes('상자') || kind.includes('보물')) {
          const cur = Math.max(0, Number(f.treasureChests || 0));
          if (cur <= 0) return res.status(400).json({ ok: false, error: `[${u.nickname}]님은 보물상자를 보유하고 있지 않습니다.` });
          moved = Math.min(cur, qty);
          f.treasureChests = cur - moved;
          af.treasureChests = Math.max(0, Number(af.treasureChests || 0)) + moved;
          label = '🧰 보물상자';
        } else if (kind.includes('복권') || kind.includes('티켓')) {
          const cur = Math.max(0, Number(f.lotteryTickets || 0));
          if (cur <= 0) return res.status(400).json({ ok: false, error: `[${u.nickname}]님은 황금 복권을 보유하고 있지 않습니다.` });
          moved = Math.min(cur, qty);
          f.lotteryTickets = cur - moved;
          af.lotteryTickets = Math.max(0, Number(af.lotteryTickets || 0)) + moved;
          label = '🎫 황금 복권';
        } else if (kind.includes('미끼')) {
          const cur = Math.max(0, Number(f.extraBait || 0));
          if (cur <= 0) return res.status(400).json({ ok: false, error: `[${u.nickname}]님은 추가 미끼를 보유하고 있지 않습니다.` });
          moved = Math.min(cur, qty);
          f.extraBait = cur - moved;
          af.extraBait = Math.max(0, Number(af.extraBait || 0)) + moved;
          label = '🪱 추가 미끼';
        } else {
          const shop = typeof getEffectiveShopCatalog === 'function' ? (getEffectiveShopCatalog() || []) : [];
          const normK = kind.toLowerCase().replace(/\s+/g, '');
          const found = shop.find((it) => String(it.id || '').toLowerCase() === normK)
            || shop.find((it) => String(it.name || '').toLowerCase().replace(/\s+/g, '') === normK)
            || shop.find((it) => String(it.name || '').toLowerCase().replace(/\s+/g, '').includes(normK));
          if (!found || typeof removeCosmeticItem !== 'function' || typeof addCosmeticItem !== 'function') {
            return res.status(400).json({ ok: false, error: `아이템 '${kind}'을(를) 찾을 수 없습니다. 자동완성 목록에서 선택해 주세요.` });
          }
          const curCnt = Math.max(0, Number(u.game_data?.cosmetics?.itemCounts?.[found.id] || 0));
          if (curCnt <= 0) return res.status(400).json({ ok: false, error: `[${u.nickname}]님은 '${found.name}'을(를) 보유하고 있지 않습니다.` });
          moved = Math.min(curCnt, qty);
          removeCosmeticItem(u, found.category, found.id, moved);
          addCosmeticItem(adminUser, found.category, found.id, moved);
          label = `✨ ${found.name}`;
        }
        const nowIso = new Date().toISOString();
        u.updated_at = nowIso;
        adminUser.updated_at = nowIso;
        saveUsersDB(usersDB);
        return reply(`📦 [${u.nickname}] → [${adminUser.nickname} 창고] ${label} ${moved}개 압수·이전 완료!`);
      }

      // 7.8. /낚싯대압수 <닉네임> <강화수치> (유저 -> 실행 관리자 창고로 즉시 이동)
      if (cmd === '/낚싯대압수') {
        const adminCode = String(req.headers['x-admin-save-code'] || req.body?.adminSaveCode || '').trim();
        const adminUser = findUserByValidCode(adminCode);
        if (!adminUser) return res.status(401).json({ ok: false, error: '관리자 계정 정보를 확인할 수 없습니다.' });
        const nick = args[0];
        const lv = Math.floor(Number(args[1]));
        if (!nick || !Number.isFinite(lv) || lv < 0) {
          return res.status(400).json({ ok: false, error: '사용법: /낚싯대압수 닉네임 강화수치 (예: /낚싯대압수 키티 11)' });
        }
        const u = findUserByNickname(nick);
        if (!u) return res.status(404).json({ ok: false, error: `유저 '${nick}'을(를) 찾을 수 없습니다.` });
        if (u.id === adminUser.id) return res.status(400).json({ ok: false, error: '본인 계정에서는 압수할 수 없습니다.' });
        ensureUserStatsStructure(u);
        ensureUserStatsStructure(adminUser);
        const f = u.game_data.fishing || {};
        if (!Array.isArray(f.rods)) return res.status(404).json({ ok: false, error: '보유한 낚싯대가 없습니다.' });
        const idx = f.rods.findIndex((r) => Number(r.level || 0) === lv);
        if (idx === -1) return res.status(404).json({ ok: false, error: `[${u.nickname}]님은 +${lv}강 낚싯대를 보유하고 있지 않습니다.` });
        const [movedRod] = f.rods.splice(idx, 1);
        if (f.equippedRodId === movedRod.id) {
          f.equippedRodId = f.rods[0] ? f.rods[0].id : '';
          f.rodLevel = f.rods[0] ? Number(f.rods[0].level || 0) : 0;
        }
        if (!adminUser.game_data.fishing) adminUser.game_data.fishing = {};
        if (!Array.isArray(adminUser.game_data.fishing.rods)) adminUser.game_data.fishing.rods = [];
        adminUser.game_data.fishing.rods.push(movedRod);
        const nowIso = new Date().toISOString();
        u.updated_at = nowIso;
        adminUser.updated_at = nowIso;
        saveUsersDB(usersDB);
        return reply(`📦 [${u.nickname}] → [${adminUser.nickname} 창고] +${lv}강 낚싯대 1개 압수·이전 완료!`);
      }

      // 8. /보스
      if (cmd === '/보스') {
        if (!fh || typeof fh.spawnBossAdmin !== 'function') return res.status(500).json({ ok: false, error: '낚시터 훅을 찾을 수 없습니다.' });
        const r = fh.spawnBossAdmin();
        return reply(r.message || '⚔️ 낚시터 보스 레이드를 소환했습니다!');
      }

      // 9. /날씨 [폭풍|황금|무지개|맑음]
      if (cmd === '/날씨') {
        if (!fh || typeof fh.setWeatherAdmin !== 'function') return res.status(500).json({ ok: false, error: '낚시터 훅을 찾을 수 없습니다.' });
        const r = fh.setWeatherAdmin(args[0] || '');
        return reply(r.message || '🌦️ 낚시터 날씨를 변경했습니다!');
      }

      // 10. /대회 <시작 [분]|종료>
      if (cmd === '/대회') {
        if (!fh || typeof fh.startTournamentAdmin !== 'function') return res.status(500).json({ ok: false, error: '낚시터 훅을 찾을 수 없습니다.' });
        const sub = String(args[0] || '시작').trim();
        if (sub === '종료' || sub === '중지' || sub === 'stop') {
          const r = fh.stopTournamentAdmin();
          return reply(r.message || '🏆 낚시 대회를 종료했습니다.');
        }
        const mins = Math.max(1, Math.min(60, Math.floor(Number(args[1] || 10))));
        const r = fh.startTournamentAdmin(mins);
        return reply(r.message || `🏆 ${mins}분 낚시 대회를 시작했습니다!`);
      }

      // 11. /미끼초기화 [닉네임|전체]
      if (cmd === '/미끼초기화') {
        if (!fh || typeof fh.resetDailyBaitAdmin !== 'function') return res.status(500).json({ ok: false, error: '낚시터 훅을 찾을 수 없습니다.' });
        const target = args[0] && args[0] !== '전체' ? args[0] : null;
        const r = fh.resetDailyBaitAdmin(target);
        if (!r.ok) return res.status(404).json(r);
        return reply(r.message);
      }

      // 12. /선물상자
      if (cmd === '/선물상자') {
        if (!fh || typeof fh.spawnGiftBoxAdmin !== 'function') return res.status(500).json({ ok: false, error: '낚시터 훅을 찾을 수 없습니다.' });
        const r = fh.spawnGiftBoxAdmin();
        return reply(r.message || '🎁 낚시터에 깜짝 보물상자를 투하했습니다!');
      }

      // 13. /추첨 <금액>
      if (cmd === '/추첨') {
        const amt = Math.floor(Number(String(args[0] || '').replace(/,/g, '')));
        if (!Number.isFinite(amt) || amt <= 0) {
          return res.status(400).json({ ok: false, error: '사용법: /추첨 금액 (예: /추첨 300000)' });
        }
        const online = (getOnlineUsersList() || []).filter((ou) => Boolean(findUserByNickname(ou.nickname)));
        if (online.length === 0) return res.status(400).json({ ok: false, error: '현재 접속 중인 유저가 없습니다.' });
        const pick = online[Math.floor(Math.random() * online.length)];
        const winner = findUserByNickname(pick.nickname);
        addUserGold(winner.nickname, amt, 'admin_raffle');
        pushUserNotification(winner, {
          type: 'reward',
          icon: '🎊',
          title: `랜덤 추첨 당첨! +${amt.toLocaleString()} 스타`,
          message: `관리자 즉석 랜덤 추첨에서 당첨되어 ${amt.toLocaleString()} 스타를 받았습니다!`
        }, true);
        io.emit('global_announcement', {
          id: 'ann_' + Date.now(),
          at: Date.now(),
          text: `🎊 깜짝 랜덤 추첨 당첨! [${winner.nickname}]님 축하합니다! (+${amt.toLocaleString()} 스타)`
        });
        return reply(`🎊 접속자 ${online.length}명 중 [${winner.nickname}]님 당첨! +${amt.toLocaleString()} 스타 지급 완료`);
      }

      // 14. /선착순 <키워드> <금액> <인원> [분] | /선착순 종료
      if (cmd === '/선착순') {
        if (args[0] === '종료' || args[0] === '취소' || args[0] === 'off') {
          runtime.fcfsEvent = null;
          broadcastBannerState();
          return reply('⚡ 진행 중이던 선착순 이벤트를 종료했습니다.');
        }
        const keyword = String(args[0] || '').trim().slice(0, 20);
        const reward = Math.floor(Number(String(args[1] || '').replace(/,/g, '')));
        const maxWinners = Math.max(1, Math.min(50, Math.floor(Number(args[2] || 3))));
        const mins = Math.max(1, Math.min(60, Math.floor(Number(args[3] || 3))));
        if (!keyword || !Number.isFinite(reward) || reward <= 0) {
          return res.status(400).json({ ok: false, error: '사용법: /선착순 키워드 금액 인원 [분] (예: /선착순 화이팅 100000 5 3)' });
        }
        runtime.fcfsEvent = {
          id: 'fcfs_' + Date.now(),
          keyword,
          reward,
          maxWinners,
          winners: [],
          endsAt: Date.now() + mins * 60 * 1000
        };
        broadcastBannerState();
        io.emit('global_announcement', {
          id: 'ann_' + Date.now(),
          at: Date.now(),
          text: `⚡ 선착순 이벤트! 상단 배너에 [${keyword}] 입력 시 선착순 ${maxWinners}명에게 ${reward.toLocaleString()} 스타!`
        });
        return reply(`⚡ 선착순 이벤트 시작! 키워드 [${keyword}] · ${reward.toLocaleString()} 스타 · 선착순 ${maxWinners}명 (${mins}분간)`);
      }

      // 15. /핫타임 <배수> <분> | /핫타임 종료
      if (cmd === '/핫타임') {
        if (args[0] === '종료' || args[0] === '해제' || args[0] === 'off') {
          runtime.hotTime = { active: false, multiplier: 1, endsAt: 0, label: '' };
          broadcastBannerState();
          return reply('🔥 핫타임 버프를 종료했습니다.');
        }
        const mult = Math.max(1.1, Math.min(5.0, Number(args[0] || 1.5)));
        const mins = Math.max(1, Math.min(180, Math.floor(Number(args[1] || 30))));
        runtime.hotTime = {
          active: true,
          multiplier: Math.round(mult * 10) / 10,
          endsAt: Date.now() + mins * 60 * 1000,
          label: `낚시 판매가 ${Math.round(mult * 10) / 10}배`
        };
        broadcastBannerState();
        io.emit('global_announcement', {
          id: 'ann_' + Date.now(),
          at: Date.now(),
          text: `🔥 서버 핫타임 시작! 앞으로 ${mins}분 동안 낚시 어종 판매가 ${runtime.hotTime.multiplier}배 적용!`
        });
        return reply(`🔥 핫타임 ON! ${mins}분 동안 낚시 판매가 ${runtime.hotTime.multiplier}배 적용`);
      }

      // 16. /채금 <닉네임> [분]
      if (cmd === '/채금') {
        const nick = args[0];
        const mins = Math.max(1, Math.min(1440, Math.floor(Number(args[1] || 10))));
        if (!nick) return res.status(400).json({ ok: false, error: '사용법: /채금 닉네임 [분]' });
        const u = findUserByNickname(nick);
        const targetNick = u ? u.nickname : nick;
        runtime.mutedUsers.set(targetNick.toLowerCase(), {
          nickname: targetNick,
          until: Date.now() + mins * 60 * 1000,
          reason: args.slice(2).join(' ').trim() || '관리자 채팅 제한'
        });
        if (u) {
          pushUserNotification(u, {
            type: 'warning',
            icon: '🔇',
            title: `채팅 제한 안내 (${mins}분)`,
            message: `관리자에 의해 ${mins}분 동안 채팅이 제한되었습니다.`
          }, true);
        }
        return reply(`🔇 [${targetNick}]님 ${mins}분간 채팅 금지 적용 완료`);
      }

      // 17. /채금해제 <닉네임>
      if (cmd === '/채금해제') {
        const nick = args[0];
        if (!nick) return res.status(400).json({ ok: false, error: '사용법: /채금해제 닉네임' });
        const existed = runtime.mutedUsers.delete(nick.trim().toLowerCase());
        return reply(existed ? `🔊 [${nick}]님 채금을 해제했습니다.` : `ℹ️ [${nick}]님은 현재 채금 상태가 아닙니다.`);
      }

      // 18. /강퇴 <닉네임>
      if (cmd === '/강퇴') {
        const nick = args[0];
        if (!nick) return res.status(400).json({ ok: false, error: '사용법: /강퇴 닉네임' });
        const kicked = typeof kickUserFromMarbleRooms === 'function' ? kickUserFromMarbleRooms(nick) : 0;
        const u = findUserByNickname(nick);
        if (u) {
          pushUserNotification(u, {
            type: 'warning',
            icon: '🚪',
            title: '관리자 강제 퇴장 안내',
            message: '관리자에 의해 현재 게임 방에서 퇴장 처리되었습니다.'
          }, true);
        }
        return reply(kicked > 0 ? `🚪 [${nick}]님을 마블 방에서 강제 퇴장시켰습니다.` : `ℹ️ [${nick}]님이 참여 중인 마블 방이 없습니다. (알림 발송 완료)`);
      }

      // 19. /거래정지 <on|off>
      if (cmd === '/거래정지') {
        const v = String(args[0] || '').toLowerCase();
        if (v !== 'on' && v !== 'off') {
          return res.status(400).json({ ok: false, error: `현재 상태: ${runtime.tradeFrozen ? 'ON(잠금)' : 'OFF(정상)'} — 사용법: /거래정지 on 또는 off` });
        }
        runtime.tradeFrozen = v === 'on';
        broadcastBannerState();
        io.emit('global_announcement', {
          id: 'ann_' + Date.now(),
          at: Date.now(),
          text: runtime.tradeFrozen
            ? '🔒 관리자 긴급 조치로 거래소 및 1:1 거래가 일시 중지되었습니다.'
            : '🔓 거래소 및 1:1 거래 이용이 정상 재개되었습니다.'
        });
        return reply(runtime.tradeFrozen ? '🔒 거래소 및 1:1 직거래를 긴급 잠금했습니다.' : '🔓 거래소 및 1:1 직거래 잠금을 해제했습니다.');
      }

      // 20. /점검 <분> [사유] | /점검 해제
      if (cmd === '/점검') {
        if (args[0] === '해제' || args[0] === '종료' || args[0] === 'off') {
          runtime.maintenance = { active: false, endsAt: 0, reason: '' };
          broadcastBannerState();
          return reply('🔧 점검 예고 배너를 해제했습니다.');
        }
        const mins = Math.max(1, Math.min(180, Math.floor(Number(args[0] || 5))));
        const reason = args.slice(1).join(' ').trim() || '서버 업데이트 및 점검 예정';
        runtime.maintenance = { active: true, endsAt: Date.now() + mins * 60 * 1000, reason };
        broadcastBannerState();
        io.emit('global_announcement', {
          id: 'ann_' + Date.now(),
          at: Date.now(),
          text: `🔧 ${mins}분 뒤 서버 점검 예정: ${reason}`
        });
        return reply(`🔧 전 유저 상단에 ${mins}분 점검 카운트다운 배너 표시 완료 (${reason})`);
      }

      // 21. /백업
      if (cmd === '/백업') {
        const d = new Date(Date.now() + 9 * 3600 * 1000);
        const stamp = d.toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const backupDir = path.join(rootDir, 'backups', `manual_${stamp}`);
        fs.mkdirSync(backupDir, { recursive: true });
        const dbFiles = [
          'users_db.json', 'custom_maps.json', 'horse_stats.json',
          'server_settings.json', 'fishing_top_catches.json', 'custom_title_requests.json',
          'market_listings.json', 'social_data.json', 'inquiries.json', 'economy_ledger.json'
        ];
        let copied = 0;
        dbFiles.forEach((f) => {
          const src = path.join(rootDir, f);
          if (fs.existsSync(src)) {
            fs.copyFileSync(src, path.join(backupDir, f));
            copied++;
          }
        });
        return reply(`💾 DB 스냅샷 백업 완료! (${copied}개 파일 -> backups/manual_${stamp})`);
      }

      // 22. /현황
      if (cmd === '/현황') {
        const online = getOnlineUsersList() || [];
        const mRooms = typeof getMarbleRoomsSummary === 'function' ? getMarbleRoomsSummary() : [];
        const fCount = fh && typeof fh.getPlayerCount === 'function' ? fh.getPlayerCount() : 0;
        const eco = typeof getEconomySummaryToday === 'function' ? getEconomySummaryToday() : null;
        const lines = [
          `📊 실시간 서버 현황 (${getTodayKstString()})`,
          `• 온라인: ${online.length}명 (낚시터 ${fCount}명 · 마블 방 ${mRooms.length}개)`,
          `• 가입 계정: ${usersDB.length}명 · 거래잠금: ${runtime.tradeFrozen ? 'ON' : 'OFF'} · 핫타임: ${runtime.hotTime.active ? runtime.hotTime.multiplier + 'x' : 'OFF'}`
        ];
        if (eco) {
          lines.push(`• 오늘 스타: 유입 +${eco.inflow.toLocaleString()} / 소각 -${eco.outflow.toLocaleString()} / 순증감 ${eco.net >= 0 ? '+' : ''}${eco.net.toLocaleString()}`);
          lines.push(`• 서버 총 유통 스타: ${eco.totalGold.toLocaleString()} 스타`);
        }
        return reply(lines);
      }

      // 23. /접속자
      if (cmd === '/접속자') {
        const online = getOnlineUsersList() || [];
        const fishersSet = new Set((fh && typeof fh.getFishersList === 'function' ? fh.getFishersList() : []).map((n) => String(n).toLowerCase()));
        const mRooms = typeof getMarbleRoomsSummary === 'function' ? getMarbleRoomsSummary() : [];
        if (online.length === 0) return reply('👥 현재 온라인 유저가 없습니다.');
        const lines = [`👥 현재 온라인 유저 (${online.length}명)`];
        online.forEach((ou, idx) => {
          const loc = fishersSet.has(String(ou.nickname || '').toLowerCase())
            ? '🎣 낚시터'
            : (mRooms.some((r) => String(r.hostNickname || '').toLowerCase() === String(ou.nickname || '').toLowerCase()) ? '🔮 마블(방장)' : '🏠 로비/게임');
          lines.push(`${idx + 1}. ${ou.nickname} — ${loc}`);
        });
        return reply(lines);
      }

      // 23.5. /코드 <닉네임> (보안코드 분실 유저 안내용)
      if (cmd === '/코드') {
        const nick = args[0];
        if (!nick) return res.status(400).json({ ok: false, error: '사용법: /코드 닉네임' });
        const u = findUserByNickname(nick);
        if (!u) return res.status(404).json({ ok: false, error: `유저 '${nick}'을(를) 찾을 수 없습니다.` });
        return reply(`🔑 [${u.nickname}]님의 세이브 코드: ${u.save_code}`);
      }

      // 24. /조회 <닉네임>
      if (cmd === '/조회') {
        const nick = args[0];
        if (!nick) return res.status(400).json({ ok: false, error: '사용법: /조회 닉네임' });
        const u = findUserByNickname(nick);
        if (!u) return res.status(404).json({ ok: false, error: `유저 '${nick}'을(를) 찾을 수 없습니다.` });
        ensureUserStatsStructure(u);
        const f = u.game_data?.fishing || {};
        const rods = Array.isArray(f.rods) ? f.rods : [];
        const maxRod = rods.reduce((mx, r) => Math.max(mx, Number(r.level || 0)), Number(f.rodLevel || 0));
        const online = (getOnlineUsersList() || []).some((x) => String(x.nickname || '').toLowerCase() === u.nickname.toLowerCase());
        const muteInfo = isUserChatMuted(u.nickname);
        return reply([
          `🔍 유저 조회: ${u.nickname} (${online ? '🟢 온라인' : '⚫ 오프라인'})`,
          `• 보유 스타: ${Number(u.gold || 0).toLocaleString()} 스타`,
          `• 낚싯대: 최고 +${maxRod}강 (총 ${rods.length}개) · 방지권 ${Math.max(0, Number(u.game_data?.cosmetics?.itemCounts?.rod_protect_ticket || 0))}장 · 상자 ${f.treasureChests || 0}개 · 복권 ${f.lotteryTickets || 0}장`,
          `• 채금 상태: ${muteInfo ? `🔇 남은 ${muteInfo.remainMin}분` : '정상'}`
        ]);
      }

      // 25. /서버
      if (cmd === '/서버') {
        const mem = process.memoryUsage();
        const rssMb = (mem.rss / 1024 / 1024).toFixed(1);
        const heapMb = (mem.heapUsed / 1024 / 1024).toFixed(1);
        const totalRamMb = os.totalmem() / 1024 / 1024;
        const freeRamMb = os.freemem() / 1024 / 1024;
        const usedRamMb = Math.max(0, totalRamMb - freeRamMb);
        const sysRamPct = totalRamMb > 0 ? ((usedRamMb / totalRamMb) * 100).toFixed(1) : '0.0';
        const nodeRamPct = totalRamMb > 0 ? ((mem.rss / os.totalmem()) * 100).toFixed(2) : '0.00';
        const cpuCores = (os.cpus() || []).length || 1;
        const loads = os.loadavg ? os.loadavg().map((n) => Number(n || 0).toFixed(2)) : ['0.00', '0.00', '0.00'];
        const upSec = Math.floor(process.uptime());
        const upH = Math.floor(upSec / 3600);
        const upM = Math.floor((upSec % 3600) / 60);
        const sockCount = io.engine ? io.engine.clientsCount : 0;
        return reply([
          `🖥️ Termux Node 서버 리소스 상태`,
          `• Node CPU: ${_lastCpuPct.toFixed(1)}% (최고 ${_peakCpuPct.toFixed(1)}% · ${cpuCores}코어 · Load ${loads[0]}/${loads[1]})`,
          `• Node 메모리: RSS ${rssMb} MB (${nodeRamPct}%) · Heap ${heapMb} MB`,
          `• 기기 전체 RAM: ${(usedRamMb / 1024).toFixed(2)} GB / ${(totalRamMb / 1024).toFixed(2)} GB (${sysRamPct}%)`,
          `• 가동 시간: ${upH}시간 ${upM}분 · 활성 소켓: ${sockCount}개`,
          `• 상태: 채금 ${runtime.mutedUsers.size}명 · 거래잠금 ${runtime.tradeFrozen ? 'ON' : 'OFF'} · 핫타임 ${runtime.hotTime.active ? runtime.hotTime.multiplier + 'x' : 'OFF'}`
        ]);
      }

      // 26. /로그
      if (cmd === '/로그') {
        if (runtime.logs.length === 0) return reply('📜 아직 기록된 운영 로그가 없습니다.');
        const lines = ['📜 최근 운영·보안 로그 (최대 10건)'];
        runtime.logs.slice(0, 10).forEach((l) => {
          lines.push(`[${l.time}] (${l.category}) ${l.text}`);
        });
        return reply(lines);
      }

      // 27. /문의
      if (cmd === '/문의') {
        const all = typeof getInquiriesList === 'function' ? getInquiriesList() : [];
        const pending = all.filter((x) => x.status !== 'ANSWERED');
        if (pending.length === 0) return reply(`📩 미답변 문의가 없습니다. (전체 누적 ${all.length}건)`);
        const lines = [`📩 미답변 문의 ${pending.length}건 (최근 5건 미리보기)`];
        pending.slice(0, 5).forEach((q, idx) => {
          lines.push(`${idx + 1}. [${q.nickname}] ${q.title} — ${String(q.content || '').slice(0, 36)}`);
        });
        return reply(lines);
      }

      // 28. /방삭제 <방제목 또는 ID>
      if (cmd === '/방삭제') {
        if (!restText) return res.status(400).json({ ok: false, error: '사용법: /방삭제 방제목(또는 방ID)' });
        const r = typeof deleteMarbleRoomByQuery === 'function' ? deleteMarbleRoomByQuery(restText) : { ok: false, error: '지원되지 않습니다.' };
        if (!r.ok) return res.status(404).json(r);
        return reply(`🗑️ 마블 방 [${r.title}] 강제 삭제 완료!`);
      }

      return res.status(400).json({ ok: false, error: `알 수 없는 명령어입니다: ${cmd} (/도움 또는 우측 [📖 설명서]를 확인하세요)` });
    } catch (err) {
      return res.status(500).json({ ok: false, error: '명령어 처리 중 오류: ' + (err && err.message ? err.message : String(err)) });
    }
  });

  return {
    isUserChatMuted,
    getHotTimeMultiplier,
    isTradeFrozen,
    getPublicBannerState,
    pushAuditLog
  };
}

module.exports = { setupAdminConsoleModule, COMMAND_MANUAL };
