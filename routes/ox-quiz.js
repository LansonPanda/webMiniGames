/**
 * ============================================================================
 * 전 세계 어디서든 접속 가능한 올인원 실시간 OX 서바이벌 퀴즈 서버 (server.js)
 * ============================================================================
 * [실행 방법]
 *   node server.js
 * ============================================================================
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { URL } = require('url');

// 1. .env 파일 및 환경변수에서 GEMINI_API_KEY 자동 로드
function loadEnvFile() {
  const candidates = [
    path.join(__dirname, '..', '.env'),
    path.join(process.cwd(), '.env'),
    path.join(__dirname, '.env')
  ];
  for (const envPath of candidates) {
    try {
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        content.split(/\r?\n/).forEach((line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) return;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
            if (key && !process.env[key]) {
              process.env[key] = val;
            }
          }
        });
      }
    } catch (e) {
      console.warn('⚠️ .env 파일 로드 중 오류:', e.message);
    }
  }
}

loadEnvFile();
const serverGeminiApiKey = (process.env.GEMINI_API_KEY || '').trim();

// 2. 미사용 문제 뱅크 (ox_quiz_bank.json) & 사용 완료 문제 뱅크 (ox_used_quiz_bank.json)
const ROOT_DIR = path.join(__dirname, '..');
const USED_QUESTIONS_FILE = path.join(ROOT_DIR, 'ox_used_questions.json');
const QUIZ_BANK_FILE = path.join(ROOT_DIR, 'ox_quiz_bank.json');
const USED_QUIZ_BANK_FILE = path.join(ROOT_DIR, 'ox_used_quiz_bank.json');

const serverUsedQuestions = new Set();
const serverUsedRawQuestions = [];
const persistentQuizBank = [];       // 아직 안 쓴 문제 뱅크 (ox_quiz_bank.json)
const persistentQuizBankKeys = new Set();
const usedQuizBank = [];             // 이미 사용해서 옮겨둔 문제 뱅크 (ox_used_quiz_bank.json)
const usedQuizBankKeys = new Set();
const refillingTopicLocks = new Set(); // 백그라운드 충전 중복 실행 방지 락

function normalizeQuestionKey(qText) {
  return String(qText || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\.,\?!'"`~·\-\(\)\[\]\{\}]/g, '');
}

// 배열을 골고루 섞어주는 Fisher-Yates 셔플 함수
function shuffleArray(arr) {
  const copy = Array.isArray(arr) ? [...arr] : [];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = copy[i];
    copy[i] = copy[j];
    copy[j] = temp;
  }
  return copy;
}

// 디스크 I/O 최적화를 위한 비동기 디바운스 저장 타이머
let saveUsedQuestionsTimer = null;
let saveUsedBankTimer = null;
let saveQuizBankTimer = null;

function saveUsedQuestionsToDisk() {
  if (saveUsedQuestionsTimer) clearTimeout(saveUsedQuestionsTimer);
  saveUsedQuestionsTimer = setTimeout(() => {
    fs.promises
      .writeFile(USED_QUESTIONS_FILE, JSON.stringify(serverUsedRawQuestions, null, 2), 'utf8')
      .catch((e) => console.warn('⚠️ 기출 문제 텍스트 파일 저장 실패:', e.message));
  }, 300);
}

function saveUsedQuizBankToDisk() {
  if (saveUsedBankTimer) clearTimeout(saveUsedBankTimer);
  saveUsedBankTimer = setTimeout(() => {
    fs.promises
      .writeFile(USED_QUIZ_BANK_FILE, JSON.stringify(usedQuizBank, null, 2), 'utf8')
      .catch((e) => console.warn('⚠️ 사용된 문제 뱅크 저장 실패:', e.message));
  }, 300);
}

function loadUsedQuestionsFromDisk() {
  try {
    // 1) 사용 완료 문제 뱅크(ox_used_quiz_bank.json) 로드
    if (fs.existsSync(USED_QUIZ_BANK_FILE)) {
      const rawBank = fs.readFileSync(USED_QUIZ_BANK_FILE, 'utf8');
      const parsedBank = JSON.parse(rawBank);
      if (Array.isArray(parsedBank)) {
        parsedBank.forEach((item) => {
          if (item && typeof item.question === 'string' && item.question.trim()) {
            const qClean = item.question.trim();
            const key = normalizeQuestionKey(qClean);
            if (key && !usedQuizBankKeys.has(key)) {
              usedQuizBankKeys.add(key);
              usedQuizBank.push(item);
            }
            if (key && !serverUsedQuestions.has(key)) {
              serverUsedQuestions.add(key);
              serverUsedRawQuestions.push(qClean);
            }
          }
        });
      }
    }

    // 2) 기존 단일 텍스트 기록(ox_used_questions.json)도 호환 로드
    if (fs.existsSync(USED_QUESTIONS_FILE)) {
      const raw = fs.readFileSync(USED_QUESTIONS_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.forEach((q) => {
          if (typeof q === 'string' && q.trim()) {
            const key = normalizeQuestionKey(q);
            if (key && !serverUsedQuestions.has(key)) {
              serverUsedQuestions.add(key);
              serverUsedRawQuestions.push(q.trim());
            }
          }
        });
      }
    }
    console.log(`📚 사용 완료 문제 뱅크 로드 완료: 상세 보관 ${usedQuizBank.length}문제 (총 누적 기출 ${serverUsedQuestions.size}문제)`);
  } catch (e) {
    console.warn('⚠️ 사용 완료 문제 파일 로드 실패:', e.message);
  }
}

function markQuestionAsUsed(qText, fullQuizObj = null) {
  const clean = String(qText || fullQuizObj?.question || '').trim();
  const key = normalizeQuestionKey(clean);
  if (!key) return;

  if (!serverUsedQuestions.has(key)) {
    serverUsedQuestions.add(key);
    serverUsedRawQuestions.push(clean);
    saveUsedQuestionsToDisk();
  }

  // 미사용 뱅크(persistentQuizBank)에 해당 문제가 있다면 찾아서 꺼내고 삭제!
  const idxInUnused = persistentQuizBank.findIndex(
    (item) => normalizeQuestionKey(item.question) === key
  );
  let removedItem = null;
  if (idxInUnused !== -1) {
    removedItem = persistentQuizBank.splice(idxInUnused, 1)[0];
    persistentQuizBankKeys.delete(key);
    saveQuizBankToDisk();
  }

  // 사용된 문제 뱅크(ox_used_quiz_bank.json)로 전체 문제 객체 이동 저장!
  if (!usedQuizBankKeys.has(key)) {
    const sourceObj = fullQuizObj || removedItem;
    usedQuizBankKeys.add(key);
    usedQuizBank.push({
      topic: String(sourceObj?.topic || '일반상식').trim(),
      difficulty: String(sourceObj?.difficulty || '보통').trim(),
      question: clean,
      answer: String(sourceObj?.answer || 'O').trim().toUpperCase() === 'X' ? 'X' : 'O',
      explanation: String(sourceObj?.explanation || '').trim(),
      usedAt: Date.now(),
      usedAtFormatted: new Date().toLocaleString('ko-KR')
    });
    saveUsedQuizBankToDisk();
  }
}

function isQuestionAlreadyUsed(qText, extraHistorySet = null) {
  const key = normalizeQuestionKey(qText);
  if (!key) return true;
  if (serverUsedQuestions.has(key) || usedQuizBankKeys.has(key)) return true;
  if (extraHistorySet) {
    for (const h of extraHistorySet) {
      if (normalizeQuestionKey(h) === key) return true;
    }
  }
  return false;
}

loadUsedQuestionsFromDisk();

// 3. AI 모델 탐색 및 백그라운드 뱅크 충전 유틸리티
const modelCooldownUntil = new Map();
let cachedModelList = null;

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8500) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function getAvailableModelsForKey(apiKey) {
  if (cachedModelList && cachedModelList.length > 0) return cachedModelList;
  const preferredOrder = [
    'gemini-flash-lite-latest',
    'gemma-3-27b-it',
    'gemma-3-12b-it',
    'gemini-flash-latest',
    'gemini-2.0-flash-lite',
    'gemini-2.0-flash'
  ];
  try {
    const res = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
      { method: 'GET' },
      5000
    );
    if (res.ok) {
      const data = await res.json();
      const discovered = (data.models || [])
        .filter(
          (m) =>
            Array.isArray(m.supportedGenerationMethods) &&
            m.supportedGenerationMethods.includes('generateContent')
        )
        .map((m) => String(m.name || '').replace(/^models\//, ''))
        .filter(
          (n) =>
            n &&
            !n.includes('pro') &&
            !n.includes('2.5') &&
            !n.includes('vision') &&
            !n.includes('embedding') &&
            !n.includes('imagen') &&
            !n.includes('tts') &&
            !n.includes('audio')
        );

      const merged = [
        ...preferredOrder.filter((m) => discovered.includes(m)),
        ...preferredOrder.filter((m) => !discovered.includes(m)),
        ...discovered.filter((m) => !preferredOrder.includes(m))
      ];
      cachedModelList = Array.from(new Set(merged)).slice(0, 8);
      console.log(`🤖 사용 가능한 AI 모델 설정 완료: ${cachedModelList.join(', ')}`);
      return cachedModelList;
    }
  } catch (e) {}
  cachedModelList = preferredOrder;
  return cachedModelList;
}

// AI 텍스트에서 JSON 배열 또는 개별 문제를 안전하게 추출하는 파서
function extractQuizArrayFromText(rawText, historySet) {
  const cleaned = String(rawText || '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  let parsedList = [];
  const startIdx = cleaned.indexOf('[');
  const endIdx = cleaned.lastIndexOf(']');
  if (startIdx !== -1 && endIdx > startIdx) {
    const jsonSlice = cleaned.slice(startIdx, endIdx + 1);
    try {
      const arr = JSON.parse(jsonSlice);
      if (Array.isArray(arr)) parsedList = arr;
    } catch (e) {
      // 따옴표나 줄바꿈으로 인해 전체 JSON.parse가 실패한 경우 개별 객체 정규식 추출
      const objRegex = /\{[\s\S]*?"question"\s*:\s*"([^"]+)"[\s\S]*?"answer"\s*:\s*"([OXox])"[\s\S]*?"explanation"\s*:\s*"([^"]*)"[\s\S]*?\}/g;
      let match;
      while ((match = objRegex.exec(cleaned)) !== null) {
        parsedList.push({
          question: match[1].trim(),
          answer: match[2].toUpperCase(),
          explanation: match[3].trim()
        });
      }
    }
  }

  return parsedList
    .map((item) => {
      if (!item || typeof item.question !== 'string') return null;
      const q = item.question.trim();
      const a = String(item.answer || 'O').trim().toUpperCase() === 'X' ? 'X' : 'O';
      const exp = String(item.explanation || '').trim();
      return { question: q, answer: a, explanation: exp };
    })
    .filter((item) => item && item.question && !isQuestionAlreadyUsed(item.question, historySet));
}

// ============================================================================
// [공통 AI 문제 생성 함수] 병렬(Race) 호출 + 남은 문제 로컬 JSON 뱅크 영구 저장 + 랜덤 추출
// ============================================================================
const FALLBACK_QUIZ_BANK = [
  { topic: '일반상식', difficulty: '쉬움', question: '세계에서 가장 면적이 넓은 나라는 러시아이다.', answer: 'O', explanation: '러시아는 지구 육지 면적의 약 11%를 차지하는 세계 최대 면적 국가입니다.' },
  { topic: '일반상식', difficulty: '보통', question: '올림픽 오륜기의 5가지 색깔 중에는 보라색이 있다.', answer: 'X', explanation: '오륜기는 파랑, 노랑, 검정, 초록, 빨강 5가지 색으로 이루어져 있습니다.' },
  { topic: '일반상식', difficulty: '쉬움', question: '한글날은 매년 10월 9일이다.', answer: 'O', explanation: '훈민정음 반포를 기념하는 한글날은 10월 9일입니다.' },
  { topic: '일반상식', difficulty: '보통', question: '자유의 여신상은 오른손에 횃불을 들고 있다.', answer: 'O', explanation: '자유의 여신상은 오른손에 횃불을, 왼손에는 독립선언서를 들고 있습니다.' },
  { topic: '일반상식', difficulty: '보통', question: '지구의 적도 둘레는 약 4만 km이다.', answer: 'O', explanation: '지구 적도 둘레는 약 40,075km로 약 4만 km입니다.' },
  { topic: '일반상식', difficulty: '어려움', question: '오스트레일리아(호주)의 수도는 시드니이다.', answer: 'X', explanation: '호주의 수도는 시드니가 아니라 캔버라(Canberra)입니다.' },
  { topic: '일반상식', difficulty: '어려움', question: '캐나다의 수도는 토론토이다.', answer: 'X', explanation: '캐나다의 수도는 오타와(Ottawa)입니다.' },
  { topic: '일반상식', difficulty: '보통', question: '인간의 몸에서 가장 단단한 부위는 치아의 법랑질(에나멜)이다.', answer: 'O', explanation: '치아 바깥층인 법랑질은 뼈보다도 단단한 인체 최고 경도 조직입니다.' },
  { topic: '수학/산수', difficulty: '쉬움', question: '7 곱하기 8은 54이다.', answer: 'X', explanation: '7 × 8 = 56입니다! (6 × 9 = 54와 자주 헷갈리는 구구단입니다.)' },
  { topic: '수학/산수', difficulty: '보통', question: '소수(Prime number) 중 유일한 짝수는 2이다.', answer: 'O', explanation: '2는 1과 자기 자신만으로 나누어떨어지는 가장 작은 소수이자 유일한 짝수 소수입니다.' },
  { topic: '수학/산수', difficulty: '쉬움', question: '삼각형의 세 내각의 합은 언제나 180도이다.', answer: 'O', explanation: '평면 위 모든 삼각형의 세 내각의 크기를 더하면 항상 180도가 됩니다.' },
  { topic: '수학/산수', difficulty: '쉬움', question: '100에서 10을 두 번 빼면 90이다.', answer: 'X', explanation: '100 - 10 - 10 = 80입니다!' },
  { topic: '수학/산수', difficulty: '보통', question: '시계의 시침과 분침은 낮 12시 정각에 정확히 겹친다.', answer: 'O', explanation: '12시 정각에는 시침과 분침이 모두 숫자 12를 가리키며 완전히 포개집니다.' },
  { topic: '수학/산수', difficulty: '어려움', question: '1은 소수(Prime number)에 포함된다.', answer: 'X', explanation: '소수는 약수가 2개인 자연수이므로, 약수가 1개뿐인 1은 소수가 아닙니다.' },
  { topic: '과학/우주', difficulty: '보통', question: '태양계 행성 중 자전 속도가 가장 빠른 행성은 목성이다.', answer: 'O', explanation: '목성은 크기가 가장 크지만 하루(자전 주기)가 약 10시간밖에 되지 않을 정도로 빠르게 돕니다.' },
  { topic: '과학/우주', difficulty: '보통', question: '태양빛이 지구까지 도달하는 데는 약 8초가 걸린다.', answer: 'X', explanation: '태양빛이 지구까지 도달하는 데는 약 8분 20초가 걸립니다.' },
  { topic: '과학/우주', difficulty: '보통', question: '다이아몬드와 연필심(흑연)은 똑같이 탄소로만 이루어져 있다.', answer: 'O', explanation: '다이아몬드와 흑연은 모두 순수한 탄소로 되어 있으며 결정 구조만 다릅니다.' },
  { topic: '과학/우주', difficulty: '쉬움', question: '물이 얼음으로 얼면 부피가 줄어든다.', answer: 'X', explanation: '물은 얼면서 육각형 결정 구조를 형성해 부피가 약 9% 늘어납니다.' },
  { topic: '과학/우주', difficulty: '어려움', question: '금성은 태양계 행성 중 표면 온도가 가장 높은 행성이다.', answer: 'O', explanation: '수성이 태양에 더 가깝지만, 금성은 두꺼운 이산화탄소 대기의 온실효과로 표면 온도가 가장 높습니다.' },
  { topic: '동물/자연', difficulty: '보통', question: '문어의 심장은 총 3개이다.', answer: 'O', explanation: '문어는 아가미 심장 2개와 체심장 1개로 총 3개의 심장을 가지고 있습니다.' },
  { topic: '동물/자연', difficulty: '어려움', question: '북극곰의 털을 모두 밀면 피부색은 하얀색이다.', answer: 'X', explanation: '북극곰의 털은 투명하고, 실제 피부색은 태양열을 잘 흡수하도록 검은색을 띱니다.' },
  { topic: '동물/자연', difficulty: '보통', question: '달팽이도 이빨을 가지고 있다.', answer: 'O', explanation: '달팽이는 치설이라고 불리는 수천~수만 개의 미세한 이빨 구조를 가지고 있습니다.' },
  { topic: '동물/자연', difficulty: '쉬움', question: '박쥐는 조류(새)에 속하는 동물이다.', answer: 'X', explanation: '박쥐는 새끼를 낳아 젖을 먹이는 유일하게 날 수 있는 포유류입니다.' },
  { topic: '동물/자연', difficulty: '보통', question: '기린의 목뼈 개수는 사람의 목뼈 개수와 똑같이 7개이다.', answer: 'O', explanation: '기린과 사람을 포함한 대부분의 포유류는 목뼈가 7개입니다.' },
  { topic: '역사/문화', difficulty: '쉬움', question: '이순신 장군이 학익진 전술로 대승을 거둔 해전은 한산도 대첩이다.', answer: 'O', explanation: '1592년 한산도 앞바다에서 학익진 진형으로 왜군을 크게 물리쳤습니다.' },
  { topic: '역사/문화', difficulty: '보통', question: '고구려를 세운 시조는 온조왕이다.', answer: 'X', explanation: '고구려의 시조는 동명성왕(주몽)이며, 온조왕은 백제를 세웠습니다.' },
  { topic: '역사/문화', difficulty: '어려움', question: '훈민정음이 처음 창제되었을 때의 글자 수는 28자였다.', answer: 'O', explanation: '창제 당시에는 초성 17자와 중성 11자를 합쳐 총 28자였으며 현재는 24자만 쓰입니다.' },
  { topic: '음식/생활', difficulty: '보통', question: '바나나는 나무가 아니라 여러해살이 풀에서 열리는 열매이다.', answer: 'O', explanation: '바나나 줄기는 나무껍질이 아닌 잎이 겹쳐진 형태라 식물학적으로 여러해살이 풀에 해당합니다.' },
  { topic: '음식/생활', difficulty: '보통', question: '토마토는 식물학적으로 과일이 아니라 채소로 분류된다.', answer: 'O', explanation: '한해살이 초본 식물에서 자라므로 채소(과채류)로 분류됩니다.' },
  { topic: '음식/생활', difficulty: '쉬움', question: '전자레인지에 알루미늄 호일을 넣고 돌리면 불꽃이 튈 수 있다.', answer: 'O', explanation: '금속 성분인 알루미늄 호일은 마이크로파를 반사하고 전류를 일으켜 스파크가 발생합니다.' },
  { topic: '스포츠/게임', difficulty: '쉬움', question: '축구 경기에서 한 팀의 경기장 내 출전 인원은 11명이다.', answer: 'O', explanation: '축구는 골키퍼 1명과 필드 플레이어 10명을 합쳐 11명이 뜁니다.' },
  { topic: '스포츠/게임', difficulty: '보통', question: '볼링에서 3번 연속 스트라이크를 터키(Turkey)라고 부른다.', answer: 'O', explanation: '3번 연속 스트라이크는 터키(Turkey)라고 부릅니다.' },
  { topic: '스포츠/게임', difficulty: '어려움', question: '마라톤 풀코스의 정확한 거리는 42.195km이다.', answer: 'O', explanation: '마라톤 정규 풀코스 거리는 42.195km입니다.' },
  { topic: '넌센스/재미', difficulty: '쉬움', question: '세상에서 가장 뜨거운 바다는 사해(Dead Sea)이다.', answer: 'X', explanation: '세상에서 가장 뜨거운 바다는 열받아(열바다)입니다!' },
  { topic: '넌센스/재미', difficulty: '보통', question: '왕이 넘어지면 킹콩이 된다.', answer: 'O', explanation: '왕(King)이 넘어지면 쿵(Kong) 소리가 나서 킹콩이라는 넌센스 퀴즈입니다!' }
];

function saveQuizBankToDisk() {
  if (saveQuizBankTimer) clearTimeout(saveQuizBankTimer);
  saveQuizBankTimer = setTimeout(() => {
    fs.promises
      .writeFile(QUIZ_BANK_FILE, JSON.stringify(persistentQuizBank, null, 2), 'utf8')
      .catch((e) => console.warn('⚠️ 문제 뱅크 파일(ox_quiz_bank.json) 저장 실패:', e.message));
  }, 300);
}

function addQuizzesToPersistentBank(items, defaultTopic = '일반상식', defaultDifficulty = '보통') {
  if (!Array.isArray(items) || items.length === 0) return 0;
  let added = 0;
  items.forEach((item) => {
    if (!item || typeof item.question !== 'string') return;
    const qClean = item.question.trim();
    const key = normalizeQuestionKey(qClean);
    // 이미 미사용 뱅크에 있거나, 이미 사용 완료된 문제 뱅크(usedQuizBank)에 있는 문제는 넣지 않음!
    if (!key || persistentQuizBankKeys.has(key) || isQuestionAlreadyUsed(qClean)) return;
    persistentQuizBankKeys.add(key);
    persistentQuizBank.push({
      topic: String(item.topic || defaultTopic || '일반상식').trim(),
      difficulty: String(item.difficulty || defaultDifficulty || '보통').trim(),
      question: qClean,
      answer: String(item.answer || 'O').trim().toUpperCase() === 'X' ? 'X' : 'O',
      explanation: String(item.explanation || '').trim(),
      savedAt: Date.now()
    });
    added++;
  });
  if (added > 0) {
    saveQuizBankToDisk();
  }
  return added;
}

function loadQuizBankFromDisk() {
  try {
    if (fs.existsSync(QUIZ_BANK_FILE)) {
      const raw = fs.readFileSync(QUIZ_BANK_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        addQuizzesToPersistentBank(parsed);
      }
    }
    // 기본 내장 뱅크 중 아직 안 쓴 문제들도 ox_quiz_bank.json에 병합 저장
    addQuizzesToPersistentBank(FALLBACK_QUIZ_BANK);
    console.log(`📦 미사용 문제 뱅크(ox_quiz_bank.json) 준비 완료: 현재 사용 가능한 문제 ${persistentQuizBank.length}개 대기 중`);
  } catch (e) {
    console.warn('⚠️ 문제 뱅크 파일 로드 실패:', e.message);
    addQuizzesToPersistentBank(FALLBACK_QUIZ_BANK);
  }
}

loadQuizBankFromDisk();

// 특정 주제+난이도의 남은 미사용 문제 개수 조회
function countAvailableInBank(topic, difficulty) {
  const cleanTopic = (topic || '일반상식').trim();
  const cleanDiff = (difficulty || '보통').trim();
  return persistentQuizBank.filter(
    (q) =>
      q.topic === cleanTopic &&
      q.difficulty === cleanDiff &&
      !isQuestionAlreadyUsed(q.question)
  ).length;
}

// 특정 주제의 전체 난이도 합산 남은 미사용 문제 개수 조회
function countTopicAvailableInBank(topic) {
  const cleanTopic = (topic || '일반상식').trim();
  return persistentQuizBank.filter(
    (q) => q.topic === cleanTopic && !isQuestionAlreadyUsed(q.question)
  ).length;
}

// 미사용 뱅크(ox_quiz_bank.json)에서 조건에 맞는 문제를 랜덤으로 1개 꺼내는 함수
// (consumeImmediately=false 이면 미리 뽑기 예약만 하고 실제 출제될 때 markQuestionAsUsed 호출!)
function popRandomQuizFromUnusedBank(
  topic,
  difficulty,
  historySet = null,
  allowTopicFallback = false,
  consumeImmediately = true
) {
  const cleanTopic = (topic || '일반상식').trim();
  const cleanDiff = (difficulty || '보통').trim();

  // 1순위: 주제 + 난이도 정확히 일치하는 미사용 문제
  const exactPool = shuffleArray(
    persistentQuizBank.filter(
      (q) =>
        q.topic === cleanTopic &&
        q.difficulty === cleanDiff &&
        !isQuestionAlreadyUsed(q.question, historySet)
    )
  );
  if (exactPool.length > 0) {
    const picked = exactPool[0];
    if (consumeImmediately) {
      markQuestionAsUsed(picked.question, picked);
    }
    return { picked, matchType: 'EXACT' };
  }

  if (!allowTopicFallback) return null;

  // 2순위 (AI 호출도 실패했을 때 등 비상용): 같은 주제의 다른 난이도 미사용 문제
  const topicPool = shuffleArray(
    persistentQuizBank.filter(
      (q) => q.topic === cleanTopic && !isQuestionAlreadyUsed(q.question, historySet)
    )
  );
  if (topicPool.length > 0) {
    const picked = topicPool[0];
    if (consumeImmediately) {
      markQuestionAsUsed(picked.question, picked);
    }
    return { picked, matchType: 'TOPIC_ONLY' };
  }

  // 3순위: 전체 미사용 뱅크 중 아무 문제나 랜덤 추출
  const anyPool = shuffleArray(
    persistentQuizBank.filter((q) => !isQuestionAlreadyUsed(q.question, historySet))
  );
  if (anyPool.length > 0) {
    const picked = anyPool[0];
    if (consumeImmediately) {
      markQuestionAsUsed(picked.question, picked);
    }
    return { picked, matchType: 'ANY_UNUSED' };
  }

  // 4순위: 만약 미사용 뱅크조차 완전히 바닥났다면 사용된 문제 뱅크(usedQuizBank)에서 랜덤 복원!
  const recyclePool = shuffleArray(
    usedQuizBank.filter((q) => q.topic === cleanTopic)
  );
  const finalFallback =
    recyclePool[0] ||
    shuffleArray(usedQuizBank)[0] ||
    shuffleArray(FALLBACK_QUIZ_BANK)[0];

  return { picked: finalFallback, matchType: 'RECYCLED_USED_BANK' };
}

// AI 모델들에게 병렬 요청을 보내 미사용 뱅크(ox_quiz_bank.json)에 문제를 대량 충전하는 함수
async function refillQuizBankFromAi(topic = '일반상식', difficulty = '보통', batchSize = 8) {
  const cleanTopic = (topic || '일반상식').trim();
  const cleanDiff = (difficulty || '보통').trim();
  const lockKey = `${cleanTopic}__${cleanDiff}`;

  if (!serverGeminiApiKey) {
    return { ok: false, addedCount: 0, error: 'GEMINI_API_KEY 없음' };
  }
  if (refillingTopicLocks.has(lockKey)) {
    return { ok: true, addedCount: 0, skippedLock: true };
  }

  refillingTopicLocks.add(lockKey);
  try {
    const difficultyGuideMap = {
      '쉬움': '초등학생이나 상식이 부족한 사람도 3초 만에 읽고 바로 맞힐 수 있는 아주 쉽고 직관적인 기초 난이도로 출제하세요.',
      '보통': '일반 성인들이 흥미로워하고 적당히 고민할 만한 대중적인 난이도로 출제하세요.',
      '어려움': '상식이 풍부한 사람도 헷갈릴 만한 반전 상식이나 정교한 함정이 포함된 어려운 난이도로 출제하세요.',
      '극악': '최후의 생존자를 가리기 위한 킬러 문제! 사람들이 흔히 반대로 알고 있는 오개념이나 고난도 디테일을 묻는 극악 난이도로 출제하세요.'
    };
    const difficultyInstruction = difficultyGuideMap[cleanDiff] || difficultyGuideMap['보통'];

    const randomAngleHints = [
      '의외의 사실', '실생활 속 비밀', '숫자나 기록과 관련된 상식', '흔히 잘못 알고 있는 상식',
      '흥미로운 기원이나 유래', '과학적/논리적 원리', '세계 여러 나라의 특징', '재미있는 비교'
    ];

    const availableModels = await getAvailableModelsForKey(serverGeminiApiKey);
    const nowMs = Date.now();
    const activeModels = availableModels.filter((m) => (modelCooldownUntil.get(m) || 0) < nowMs);
    const candidateModels = (activeModels.length > 0 ? activeModels : availableModels).slice(0, 3);

    const attemptLogs = [];
    let winningRawResponse = '';
    let winningModel = '';
    let winningPrompt = '';
    let totalAdded = 0;

    // 각 모델에 서로 다른 관점 힌트를 주어 중복되지 않는 다양한 문제가 쏟아지도록 구성
    const requestSingleModel = async (modelName, modelIdx) => {
      const startAt = Date.now();
      const hint = randomAngleHints[( Math.floor(Math.random() * randomAngleHints.length) + modelIdx * 2 ) % randomAngleHints.length];
      const promptText = [
        '당신은 한국의 인기 서바이벌 OX 퀴즈쇼 작가입니다.',
        `주제: [${cleanTopic}] (세부 관점 힌트: ${hint})`,
        `난이도: [${cleanDiff}] - ${difficultyInstruction}`,
        `이 주제와 난이도에 정확히 맞춘 서로 다른 새로운 재미있는 OX 퀴즈 ${batchSize}개를 한꺼번에 만들어주세요.`,
        '★가장 중요한 규칙: 참가자들이 8~10초 안에 다 읽고 선택해야 하므로, 문제(question) 길이는 반드시 공백 포함 35자~45자 이내의 짧고 명확한 한 문장(~이다/한다)으로 작성하세요! 절대 길게 꼬아서 쓰지 마세요.',
        'O가 정답인 문제와 X가 정답인 문제를 골고루 섞어서 출제하세요.',
        '주의: 문자열 내부에 큰따옴표(")를 넣지 말고 작은따옴표(\')만 사용하세요.',
        '다른 인사말이나 마크다운 설명 없이 오직 아래 형식의 순수 JSON 배열만 출력하세요:',
        '[{"question":"45자 이내의 짧고 명확한 문제 (~이다)","answer":"O","explanation":"정답에 대한 핵심 1줄 해설"},{"question":"...","answer":"X","explanation":"..."}]'
      ].join('\n');

      const isGeminiModel = modelName.startsWith('gemini-');
      const payload = {
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: isGeminiModel
          ? { temperature: 0.92, responseMimeType: 'application/json' }
          : { temperature: 0.92 }
      };

      const callModelApi = async (bodyPayload) => {
        return await fetchWithTimeout(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(
            serverGeminiApiKey
          )}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyPayload)
          },
          9000
        );
      };

      let apiRes = await callModelApi(payload);
      if (apiRes.status === 400 && isGeminiModel) {
        apiRes = await callModelApi({
          contents: [{ parts: [{ text: promptText }] }],
          generationConfig: { temperature: 0.92 }
        });
      }

      const elapsedMs = Date.now() - startAt;
      const apiJson = await apiRes.json();

      if (!apiRes.ok) {
        const errMsg = apiJson?.error?.message || `HTTP ${apiRes.status}`;
        attemptLogs.push({
          model: modelName,
          status: apiRes.status,
          elapsedMs,
          ok: false,
          error: errMsg
        });
        if (apiRes.status === 429) {
          modelCooldownUntil.set(modelName, Date.now() + 90 * 1000);
        } else if (apiRes.status === 404) {
          modelCooldownUntil.set(modelName, Date.now() + 3600 * 1000);
        }
        throw new Error(`${modelName}: ${errMsg.slice(0, 80)}`);
      }

      const rawText =
        (apiJson?.candidates?.[0]?.content?.parts || [])
          .map((p) => p.text || '')
          .join('\n') || '';

      const allParsed = extractQuizArrayFromText(rawText, new Set());
      const newlySaved = addQuizzesToPersistentBank(allParsed, cleanTopic, cleanDiff);
      totalAdded += newlySaved;

      if (newlySaved > 0 || allParsed.length > 0) {
        console.log(
          `💾 [뱅크 자동 충전] ${modelName} (${cleanTopic}·${cleanDiff}): 신규 ${newlySaved}문제 추가됨 -> 현재 미사용 뱅크 총 ${persistentQuizBank.length}문제`
        );
        attemptLogs.push({
          model: modelName,
          status: apiRes.status,
          elapsedMs,
          ok: true,
          parsedCount: newlySaved
        });
        return { modelName, newlySaved, rawText, promptText };
      }

      throw new Error(`${modelName}: 유효한 신규 문제 없음`);
    };

    const racePromises = candidateModels.map((mName, idx) => requestSingleModel(mName, idx));
    const winner = await Promise.any(racePromises);
    winningModel = winner.modelName;
    winningRawResponse = winner.rawText;
    winningPrompt = winner.promptText;

    return {
      ok: true,
      modelUsed: winningModel,
      addedCount: totalAdded,
      promptText: winningPrompt,
      rawResponse: winningRawResponse,
      attempts: attemptLogs
    };
  } catch (e) {
    return {
      ok: false,
      addedCount: 0,
      error: e.message || 'AI 충전 실패'
    };
  } finally {
    refillingTopicLocks.delete(lockKey);
  }
}

const BANK_TOPICS = ['일반상식', '과학/IT', '역사/문화', '넌센스/재미'];
const BANK_DIFFICULTIES = ['쉬움', '보통', '어려움'];
const TARGET_BANK_PER_COMBO = 20;

// 남은 문제가 20개 미만일 때 백그라운드에서 비동기로 충전하는 트리거
function triggerBackgroundBankRefillIfNeeded(topic = '일반상식', difficulty = '보통') {
  const cleanTopic = (topic || '일반상식').trim();
  const cleanDiff = (difficulty || '보통').trim();
  if (cleanTopic === '전체 랜덤') return;
  const remainExact = countAvailableInBank(cleanTopic, cleanDiff);

  if (remainExact < TARGET_BANK_PER_COMBO && serverGeminiApiKey) {
    const batch = Math.min(10, Math.max(5, TARGET_BANK_PER_COMBO - remainExact));
    console.log(
      `🔄 [백그라운드 충전 시작] [${cleanTopic} · ${cleanDiff}] 미사용 뱅크 ${remainExact}/${TARGET_BANK_PER_COMBO}개 -> ${batch}개 추가 생성...`
    );
    refillQuizBankFromAi(cleanTopic, cleanDiff, batch).catch(() => {});
  }
}

let isCheckingAllCombos = false;
let lastBankRefillError = '';
async function ensureAllBankCombosFilled() {
  if (isCheckingAllCombos || !serverGeminiApiKey) return;
  isCheckingAllCombos = true;
  try {
    for (const t of BANK_TOPICS) {
      for (const d of BANK_DIFFICULTIES) {
        const remain = countAvailableInBank(t, d);
        if (remain < TARGET_BANK_PER_COMBO) {
          const needed = Math.min(10, TARGET_BANK_PER_COMBO - remain);
          console.log(`📦 [서버 자동 뱅크 체크] [${t} · ${d}] ${remain}/${TARGET_BANK_PER_COMBO}개 -> ${needed}개 자동 보충`);
          const r = await refillQuizBankFromAi(t, d, needed).catch((err) => ({ ok: false, error: err?.message || '오류' }));
          if (r && !r.ok && r.error) { lastBankRefillError = r.error; console.warn('⚠️ [OX 뱅크 자동 보충 실패]', r.error); }
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
    }
  } finally {
    isCheckingAllCombos = false;
  }
}

setTimeout(() => { ensureAllBankCombosFilled().catch(() => {}); }, 5000);
setInterval(() => { ensureAllBankCombosFilled().catch(() => {}); }, 120000);

async function generateOneQuizFromServer(
  topic = '일반상식',
  difficulty = '보통',
  recentHistory = [],
  consumeImmediately = true
) {
  const cleanTopic = (topic || '일반상식').trim();
  const cleanDiff = (difficulty || '보통').trim();
  const historyList = Array.isArray(recentHistory) ? recentHistory : [];
  const historySet = new Set(historyList);
  historyList.forEach((q) => markQuestionAsUsed(q));

  // =========================================================================
  // STEP 1. 미사용 뱅크(ox_quiz_bank.json)에 해당 주제·난이도 문제가 있으면 API 호출 없이 즉시 추출!
  // =========================================================================
  const bankHit = popRandomQuizFromUnusedBank(cleanTopic, cleanDiff, historySet, false, consumeImmediately);
  if (bankHit && bankHit.picked) {
    const remainInTopicDiff = countAvailableInBank(cleanTopic, cleanDiff);

    // 5문제 이하로 떨어졌으면 기다리지 않고 백그라운드에서 AI 모델들에 충전 요청!
    triggerBackgroundBankRefillIfNeeded(cleanTopic, cleanDiff);

    return {
      ok: true,
      quiz: bankHit.picked,
      fromUnusedBank: true,
      remainingTopicBank: remainInTopicDiff,
      usedQuestionCount: usedQuizBank.length,
      bankCount: persistentQuizBank.length,
      debug: {
        source: 'UNUSED_QUIZ_BANK',
        modelUsed: `미사용 뱅크(ox_quiz_bank.json) 즉시 추출 (남은 [${cleanTopic}·${cleanDiff}]: ${remainInTopicDiff}개 / 전체 미사용: ${persistentQuizBank.length}개 / 사용완료: ${usedQuizBank.length}개)`,
        timestamp: new Date().toLocaleTimeString('ko-KR'),
        attempts: [],
        requestPrompt: `[API 토큰 절약 · 뱅크 우선 소진] 주제: ${cleanTopic} / 난이도: ${cleanDiff}\n(남은 문제가 5개 이하일 때만 백그라운드에서 AI로 자동 보충합니다)`,
        rawResponse: JSON.stringify(bankHit.picked, null, 2)
      }
    };
  }

  // =========================================================================
  // STEP 2. 미사용 뱅크에 해당 주제·난이도 문제가 0개라면 즉시 AI 모델 병렬 호출로 뱅크를 채운 뒤 1개 꺼냄!
  // =========================================================================
  console.log(`⚡ [뱅크 소진됨 -> AI 즉시 충전] [${cleanTopic} · ${cleanDiff}] 미사용 문제가 0개이므로 AI 모델에 새 문제 묶음을 요청합니다...`);
  const refillRes = await refillQuizBankFromAi(cleanTopic, cleanDiff, 8);

  const afterRefillHit = popRandomQuizFromUnusedBank(cleanTopic, cleanDiff, historySet, true, consumeImmediately);
  const pickedQuiz = afterRefillHit ? afterRefillHit.picked : FALLBACK_QUIZ_BANK[0];
  const remainAfter = countAvailableInBank(cleanTopic, cleanDiff);

  triggerBackgroundBankRefillIfNeeded(cleanTopic, cleanDiff);

  return {
    ok: true,
    quiz: pickedQuiz,
    modelUsed: refillRes.ok
      ? `${refillRes.modelUsed} (뱅크 충전 후 추출 · 남은 [${cleanTopic}·${cleanDiff}]: ${remainAfter}개)`
      : `비상 뱅크 랜덤 추출 (전체 미사용: ${persistentQuizBank.length}개)`,
    remainingTopicBank: remainAfter,
    usedQuestionCount: usedQuizBank.length,
    bankCount: persistentQuizBank.length,
    debug: {
      source: refillRes.ok ? 'AI_REFILL_AND_POP' : 'FALLBACK_BANK',
      modelUsed: refillRes.ok
        ? `${refillRes.modelUsed} -> ox_quiz_bank.json 충전`
        : `로컬 뱅크 대체 추출 (${afterRefillHit?.matchType || 'FALLBACK'})`,
      timestamp: new Date().toLocaleTimeString('ko-KR'),
      attempts: refillRes.attempts || [],
      requestPrompt: refillRes.promptText || `주제: ${cleanTopic} / 난이도: ${cleanDiff}`,
      rawResponse: refillRes.rawResponse || JSON.stringify(pickedQuiz, null, 2)
    }
  };
}

// 난이도 및 질문 글자 수에 따른 스마트 제한시간(초) 자동 계산기
function calculateSmartDurationSeconds(questionText, difficulty) {
  const baseByDiff = {
    '쉬움': 8,
    '보통': 10,
    '어려움': 12,
    '극악': 14
  };
  let sec = baseByDiff[difficulty] || 10;
  const len = String(questionText || '').trim().length;
  if (len > 55) sec += 4;
  else if (len > 42) sec += 3;
  else if (len > 30) sec += 2;
  return Math.min(18, sec);
}

// 자동 진행 시 남은 생존자 수/비율 및 문제 번호에 따른 난이도 자동 결정기
function pickAutoDifficulty(aliveCount, initialAliveCount, questionId, difficultyMode = 'auto') {
  if (difficultyMode && difficultyMode !== 'auto') {
    return difficultyMode;
  }
  const baseTotal = Math.max(aliveCount, initialAliveCount || aliveCount || 1);
  const ratio = aliveCount / baseTotal;

  if (Number(questionId || 1) <= 1) return '쉬움';
  if (aliveCount <= 2 || Number(questionId) >= 8) return '극악';
  if (aliveCount <= 4 || ratio <= 0.35 || Number(questionId) >= 5) return '어려움';
  if (Number(questionId) === 2 && ratio >= 0.7 && aliveCount >= 5) return '쉬움';
  return '보통';
}

// 방 번호(roomCode)별 실시간 메모리 저장소
const rooms = new Map();

let externalRemoveUserEverywhere = null;
let externalRecordOxStats = null;
let externalFindUserExistingRoom = null;
let externalEconomyHooks = null;

function setServerHooks({ removeUserEverywhere, recordOxStats, findUserExistingRoom, economyHooks }) {
  externalRemoveUserEverywhere = removeUserEverywhere;
  externalRecordOxStats = recordOxStats;
  externalFindUserExistingRoom = typeof findUserExistingRoom === 'function' ? findUserExistingRoom : null;
  externalEconomyHooks = economyHooks || null;
}

function removeParticipantFromAllOxRooms(participantId, nickname, exceptRoomCode = null) {
  for (const [rCode, rm] of rooms.entries()) {
    if (exceptRoomCode && rCode === exceptRoomCode) continue;
    const before = rm.participants.length;
    rm.participants = rm.participants.filter(
      (p) => p.id !== participantId && (!nickname || p.nickname !== nickname)
    );
    if (rm.participants.length !== before) {
      broadcastRoomUpdate(rCode);
    }
  }
}


const deletedOxRooms = new Map(); // roomCode -> { title, reason, deletedAt }
let oxGlobalIdleTimeoutMs = 15 * 60 * 1000; // 기본 15분 (전역 관리자 설정으로 변경 가능)

function setOxIdleTimeoutMinutes(mins) {
  const m = Math.max(1, Math.min(180, Number(mins) || 15));
  oxGlobalIdleTimeoutMs = m * 60 * 1000;
}

function getOxRoomsSummary() {
  return Array.from(rooms.values()).map((r) => ({
    roomCode: r.roomCode,
    title: r.title,
    hostClientId: r.hostClientId || null,
    hostNickname: r.hostNickname || '',
    maxPlayers: r.maxPlayers || 0,
    hasPassword: Boolean(r.password),
    entryFee: r.entryFee || 0,
    roomFundingMode: r.roomFundingMode || 'ENTRY_FEE',
    payoutMode: r.payoutMode || 'WINNER_TAKES_ALL',
    prizePool: r.prizePool || 0,
    roomMode: r.quizState?.roomMode || 'AUTO',
    count: (r.participants || []).length,
    status: r.quizState?.status || 'waiting',
    roundNumber: r.quizState?.roundNumber || 1,
    createdAt: r.createdAt || Date.now(),
    lastActivityAt: r.lastActivityAt || Date.now(),
    hostLastSeenAt: r.hostLastSeenAt || Date.now()
  }));
}

function deleteOxRoomByCode(targetCode, reason = '방장이 방을 삭제했습니다.') {
  const rm = rooms.get(targetCode);
  if (!rm) return null;
  const deletedTitle = rm.title || `방 #${targetCode}`;
  clearRoomTimers(rm);
  deletedOxRooms.set(targetCode, {
    title: deletedTitle,
    reason,
    deletedAt: Date.now()
  });
  const payload = JSON.stringify({
    ok: true,
    roomDeleted: true,
    deletedRoomCode: targetCode,
    deletedTitle,
    reason
  });
  for (const clientRes of rm.sseClients) {
    try { clientRes.write(`data: ${payload}\n\n`); } catch (_) {}
  }
  rooms.delete(targetCode);
  return deletedTitle;
}

// 30초마다 장시간 미사용 방(게임 미시작 또는 방장 미접속 15분 이상) 자동 삭제
setInterval(() => {
  const now = Date.now();
  for (const [rCode, rm] of rooms.entries()) {
    const idleFromActivity = now - Number(rm.lastActivityAt || rm.createdAt || now);
    const idleFromHost = now - Number(rm.hostLastSeenAt || rm.createdAt || now);
    if (idleFromActivity >= oxGlobalIdleTimeoutMs || idleFromHost >= oxGlobalIdleTimeoutMs) {
      deleteOxRoomByCode(rCode, '장시간 미사용으로 방이 자동 삭제되었습니다.');
    }
  }
}, 30000);

function getOrCreateRoom(roomCode = '1004', roomTitle = null, hostClientId = null, options = {}) {
  const cleanCode = String(roomCode || '1004').trim() || '1004';
  if (!rooms.has(cleanCode)) {
    const now = Date.now();
    const rawPw = String(options.password || '').trim();
    const cleanPw = /^\d{4}$/.test(rawPw) ? rawPw : '';
    const cap = Math.max(0, Math.min(100, Number(options.maxPlayers || 0)));
    const cleanHostNick = String(options.hostNickname || '').trim().slice(0, 16) || '';
    const fee = Math.max(0, Math.min(1000000000, Math.floor(Number(options.entryFee) || 0)));
    const fMode = options.roomFundingMode === 'HOST_EVENT' ? 'HOST_EVENT' : 'ENTRY_FEE';
    const pMode = options.payoutMode === 'TOP3_SPLIT' ? 'TOP3_SPLIT' : 'WINNER_TAKES_ALL';
    rooms.set(cleanCode, {
      roomCode: cleanCode,
      title: roomTitle || `OX 서바이벌 방 #${cleanCode}`,
      hostClientId: hostClientId || null,
      hostNickname: cleanHostNick,
      maxPlayers: cap,
      password: cleanPw,
      entryFee: fee,
      roomFundingMode: fMode,
      payoutMode: pMode,
      prizePool: 0,
      lastPayouts: [],
      feeCollectedForRound: false,
      prizeSettledForRound: false,
      createdAt: now,
      lastActivityAt: now,
      hostLastSeenAt: now,
      quizState: {
        roomMode: options.roomMode === 'MANUAL' ? 'MANUAL' : 'AUTO',
        status: 'waiting',
        question: '',
        topic: '일반상식',
        correctAnswer: 'O',
        explanation: '',
        difficulty: '보통',
        roundNumber: 1,
        questionId: 1,
        targetWins: 1,
        drumrollEnabled: true,
        chimeStyle: 'classic_dingdong',
        victoryMusicStyle: 'royal_fanfare',
        finalChampionNickname: null,
        gameStarted: false,
        winnerNickname: null,
        allWrongRevived: false,
        revealAt: null,
        countdownDuration: null,
        autoPlayEnabled: false,
        autoPlayStopAfterCurrent: false,
        autoPlayTopic: '일반상식',
        autoPlayDifficultyMode: 'auto',
        autoPlayQuestionDurationSec: 0, // 0 = 난이도·글자수별 스마트 자동(추천), 그 외 숫자 = 고정 초
        autoPlayIntervalSec: 8,
        nextAutoQuestionAt: null,
        initialAliveCount: 0,
        updatedAt: Date.now()
      },
      participants: [],
      kickedIds: new Set(),
      reactions: [],
      notices: [],
      updatedAt: Date.now(),
      timerHandle: null,
      autoNextTimerHandle: null,
      prefetchedNextQuiz: null,
      isGeneratingAutoQuiz: false,
      sseClients: new Set()
    });
    const createdRoom = rooms.get(cleanCode);
    if (options.autoPlayTopic) createdRoom.quizState.autoPlayTopic = String(options.autoPlayTopic);
    if (options.autoPlayDifficultyMode) createdRoom.quizState.autoPlayDifficultyMode = String(options.autoPlayDifficultyMode);
    if (typeof options.autoPlayQuestionDurationSec === 'number') {
      createdRoom.quizState.autoPlayQuestionDurationSec = Number(options.autoPlayQuestionDurationSec);
    }
    if (typeof options.targetWins === 'number') {
      createdRoom.quizState.targetWins = Math.max(0, Math.min(10, Number(options.targetWins)));
    }
  }
  if (roomTitle && rooms.get(cleanCode)) {
    rooms.get(cleanCode).title = roomTitle;
  }
  return rooms.get(cleanCode);
}
// 초기에는 생성된 방이 없으며 방장이 방을 만들면 생성됩니다.

// 참가자별 실시간 접속 상태(online / away / offline) 계산 헬퍼 (30초 기준)
const OFFLINE_TIMEOUT_MS = 30 * 1000;

function isParticipantEffectivelyOffline(p, now = Date.now()) {
  if (!p) return true;
  if (p.presenceState === 'offline') {
    const offMs = now - Number(p.disconnectedAt || p.lastSeenAt || 0);
    return offMs >= OFFLINE_TIMEOUT_MS;
  }
  const silentMs = now - Number(p.lastSeenAt || p.updatedAt || 0);
  return silentMs >= OFFLINE_TIMEOUT_MS;
}

// 참가자 배열 병합 (기기 시계 오차와 무관하게 현재 문제 선택을 100% 반영 + 접속 상태 보존)
function mergeParticipants(existingList, incomingList, serverNow = Date.now(), activeQuestionId = null, kickedIdsSet = null) {
  const map = new Map();
  (existingList || []).forEach((p) => {
    if (p && p.id && !p.removed) map.set(p.id, p);
  });
  (incomingList || []).forEach((inc) => {
    if (!inc || !inc.id) return;
    if (inc.removed) {
      map.delete(inc.id);
      return;
    }
    if (kickedIdsSet && kickedIdsSet.has(inc.id)) {
      if (inc.explicitRejoin) {
        kickedIdsSet.delete(inc.id);
      } else {
        return;
      }
    }
    // Deduplicate same nickname with different legacy id
    if (inc.nickname) {
      const lowerNick = String(inc.nickname).trim().toLowerCase();
      for (const [k, v] of map.entries()) {
        if (k !== inc.id && String(v.nickname || '').trim().toLowerCase() === lowerNick) {
          map.delete(k);
        }
      }
    }
    const prev = map.get(inc.id);
    const maxWins =
      typeof inc.forceWins === 'number'
        ? Math.max(0, inc.forceWins)
        : Math.max(Number(prev?.wins || 0), Number(inc?.wins || 0));

    const hasActiveChoice =
      activeQuestionId !== null &&
      Number(inc.questionId) === Number(activeQuestionId) &&
      (inc.choice === 'O' || inc.choice === 'X');

    const preservedPresence = inc.presenceState || prev?.presenceState || 'online';
    const preservedReady = typeof inc.ready === 'boolean' ? inc.ready : Boolean(prev?.ready);
    const preservedLastSeen = Number(inc.lastSeenAt || prev?.lastSeenAt || serverNow);
    const preservedDisconnectedAt =
      preservedPresence === 'offline'
        ? Number(inc.disconnectedAt || prev?.disconnectedAt || serverNow)
        : null;

    if (!prev) {
      map.set(inc.id, {
        ...inc,
        ready: preservedReady,
        wins: maxWins,
        presenceState: preservedPresence,
        lastSeenAt: preservedLastSeen,
        disconnectedAt: preservedDisconnectedAt,
        updatedAt: serverNow
      });
    } else if (hasActiveChoice) {
      map.set(inc.id, {
        ...prev,
        ...inc,
        spectatorOnly: typeof inc.spectatorOnly === 'boolean' ? inc.spectatorOnly : Boolean(prev?.spectatorOnly),
        choice: inc.choice,
        questionId: Number(activeQuestionId),
        wins: maxWins,
        presenceState: preservedPresence,
        lastSeenAt: preservedLastSeen,
        disconnectedAt: preservedDisconnectedAt,
        updatedAt: serverNow
      });
    } else if (Number(inc.updatedAt || 0) >= Number(prev.updatedAt || 0)) {
      const keepPrevActiveChoice =
        activeQuestionId !== null &&
        Number(prev.questionId) === Number(activeQuestionId) &&
        (prev.choice === 'O' || prev.choice === 'X') &&
        !inc.choice;
      map.set(inc.id, {
        ...prev,
        ...inc,
        choice: keepPrevActiveChoice ? prev.choice : inc.choice,
        questionId: keepPrevActiveChoice ? prev.questionId : inc.questionId,
        wins: maxWins,
        presenceState: preservedPresence,
        lastSeenAt: preservedLastSeen,
        disconnectedAt: preservedDisconnectedAt,
        updatedAt: serverNow
      });
    } else {
      map.set(inc.id, {
        ...prev,
        wins: maxWins,
        presenceState: preservedPresence,
        lastSeenAt: preservedLastSeen,
        disconnectedAt: preservedDisconnectedAt
      });
    }
  });
  return Array.from(map.values());
}

// 공통 방 상태 응답 생성기 (모든 API 응답과 SSE 브로드캐스트 포맷 통일)
function autoSpectateUnreadyOxPlayers(room) {
  if (!room) return { readyCount: 0, spectatedNames: [] };
  const now = Date.now();
  const spectatedNames = [];
  room.participants = (room.participants || []).map((p) => {
    if (p.spectatorOnly) return { ...p, isAlive: false };
    const isHost = Boolean(room.hostClientId && p.id === room.hostClientId);
    const isOnline = !isParticipantEffectivelyOffline(p, now) && p.presenceState !== 'away';
    const isReady = isHost || Boolean(p.ready);
    if (!isOnline || !isReady) {
      spectatedNames.push(p.nickname || '참가자');
      return {
        ...p,
        ready: false,
        spectatorOnly: true,
        isAlive: false,
        choice: null,
        spectatorChoice: null,
        updatedAt: now
      };
    }
    return { ...p, isAlive: true, spectatorOnly: false };
  });
  if (spectatedNames.length > 0) {
    room.notices.push({
      id: 'nt_autospec_' + now,
      text: `👀 미준비/자리비움 자동 관전 전환(스타 미차감): ${spectatedNames.join(', ')}`,
      createdAt: now
    });
    if (room.notices.length > 20) room.notices = room.notices.slice(-20);
  }
  const readyCount = room.participants.filter((p) => !p.spectatorOnly && p.isAlive !== false).length;
  return { readyCount, spectatedNames };
}

function collectOxEntryFeesIfNeeded(room) {
  if (!room || room.feeCollectedForRound) return;
  autoSpectateUnreadyOxPlayers(room);
  room.feeCollectedForRound = true;
  room.prizeSettledForRound = false;
  room.lastPayouts = [];
  const fee = Number(room.entryFee || 0);
  const isEventRoom = room.roomFundingMode === 'HOST_EVENT';
  let pool = 0;
  const activePlayers = (room.participants || []).filter((p) => !p.spectatorOnly && p.isAlive !== false);
  if (isEventRoom) {
    if (fee > 0 && room.hostNickname && externalEconomyHooks?.canAffordGold && externalEconomyHooks.canAffordGold(room.hostNickname, fee)) {
      externalEconomyHooks.addUserGold(room.hostNickname, -fee, 'ox_event_sponsor');
      pool = fee;
    }
    activePlayers.forEach((p) => {
      if (p.nickname && externalEconomyHooks?.recordDailyActivity) {
        externalEconomyHooks.recordDailyActivity(p.nickname, { play: 1 });
      }
    });
  } else {
    activePlayers.forEach((p) => {
      if (p.nickname && externalEconomyHooks?.recordDailyActivity) {
        externalEconomyHooks.recordDailyActivity(p.nickname, { play: 1 });
      }
      if (fee > 0 && p.nickname && externalEconomyHooks?.canAffordGold && externalEconomyHooks.canAffordGold(p.nickname, fee)) {
        externalEconomyHooks.addUserGold(p.nickname, -fee, 'ox_entry_fee');
        pool += fee;
      }
    });
  }
  room.prizePool = pool;
  if (pool > 0) {
    room.notices.push({
      id: 'nt_pool_' + Date.now(),
      text: isEventRoom
        ? `🎁 방장 이벤트 총상금 ${pool.toLocaleString()} 스타 적립 완료! (${room.payoutMode === 'TOP3_SPLIT' ? '1~3등 60/25/15%' : '1등 독식'})`
        : `⭐ 참가비 ${fee.toLocaleString()} 스타 차감 완료! 총 상금 풀 ${pool.toLocaleString()} 스타 (${room.payoutMode === 'TOP3_SPLIT' ? '1~3등 60/25/15%' : '1등 독식'})`,
      createdAt: Date.now()
    });
    if (room.notices.length > 20) room.notices = room.notices.slice(-20);
  }
}

function settleOxPrizeIfNeeded(room, winName) {
  if (!room || room.prizeSettledForRound || !winName) return;
  room.prizeSettledForRound = true;
  if (!room.prizePool || room.prizePool <= 0 || !externalEconomyHooks?.distributePoolPayout) return;
  const nonSpec = (room.participants || []).filter((p) => !p.spectatorOnly);
  const parseElimScore = (er) => {
    if (!er) return 9999;
    const m = String(er).match(/(\d+)Q/);
    return m ? Number(m[1]) : 0;
  };
  const others = nonSpec
    .filter((p) => p.nickname !== winName)
    .sort((a, b) => {
      if ((b.isAlive !== false) !== (a.isAlive !== false)) return (b.isAlive !== false) ? 1 : -1;
      const eDiff = parseElimScore(b.eliminatedRound) - parseElimScore(a.eliminatedRound);
      if (eDiff !== 0) return eDiff;
      return (b.wins || 0) - (a.wins || 0);
    })
    .map((p) => p.nickname);
  const ordered = [winName, ...others];
  const payouts = externalEconomyHooks.distributePoolPayout(room.prizePool, room.payoutMode || 'WINNER_TAKES_ALL', ordered);
  room.lastPayouts = payouts;
  if (payouts.length > 0) {
    const summary = payouts.map((x) => `${x.rank}위 ${x.nickname}(+${x.amount.toLocaleString()} 스타)`).join(' · ');
    room.notices.push({
      id: 'nt_pay_' + Date.now(),
      text: `🏆 상금 배분 완료! ${summary}`,
      createdAt: Date.now()
    });
    if (room.notices.length > 20) room.notices = room.notices.slice(-20);
  }
  // 다음 라운드 재시작 전 다시 동의를 받도록 ready 초기화
  room.participants = (room.participants || []).map((p) => ({
    ...p,
    ready: Boolean(room.hostClientId && p.id === room.hostClientId)
  }));
}

function buildRoomPayload(roomCode) {
  const room = getOrCreateRoom(roomCode);
  return {
    ok: true,
    hostClientId: room.hostClientId || null,
    hostNickname: room.hostNickname || '',
    maxPlayers: room.maxPlayers || 0,
    hasPassword: Boolean(room.password),
    entryFee: room.entryFee || 0,
    roomFundingMode: room.roomFundingMode || 'ENTRY_FEE',
    payoutMode: room.payoutMode || 'WINNER_TAKES_ALL',
    prizePool: room.prizePool || 0,
    lastPayouts: room.lastPayouts || [],
    kickedIds: Array.from(room.kickedIds || []),
    quizState: room.quizState,
    participants: (room.participants || []).map((p) => ({
      ...p,
      cosmetics: externalEconomyHooks && externalEconomyHooks.getCosmeticsByNickname
        ? externalEconomyHooks.getCosmeticsByNickname(p.nickname)
        : (p.cosmetics || {})
    })),
    reactions: room.reactions,
    notices: room.notices,
    serverNow: Date.now(),
    usedQuestionCount: usedQuizBank.length,
    unusedBankCount: persistentQuizBank.length
  };
}

// SSE 브로드캐스트 전송
function broadcastRoomUpdate(roomCode) {
  const room = getOrCreateRoom(roomCode);
  const payload = JSON.stringify(buildRoomPayload(roomCode));
  for (const clientRes of room.sseClients) {
    try {
      clientRes.write(`data: ${payload}\n\n`);
    } catch (e) {
      room.sseClients.delete(clientRes);
    }
  }
}

// 자동 진행(Auto-Play): 쉬는 시간 동안 다음 문제를 미리 예약(소비하지 않고 참조만 보관)
async function prefetchNextAutoQuiz(roomCode) {
  const room = getOrCreateRoom(roomCode);
  if (room.isGeneratingAutoQuiz || room.prefetchedNextQuiz) return;
  room.isGeneratingAutoQuiz = true;
  try {
    const aliveCount = room.participants.filter((p) => p.isAlive !== false).length;
    const nextQId = Number(room.quizState.questionId || 1) + 1;
    const targetDiff = pickAutoDifficulty(
      aliveCount,
      room.quizState.initialAliveCount || aliveCount,
      nextQId,
      room.quizState.autoPlayDifficultyMode
    );
    const rawTopic = room.quizState.autoPlayTopic || room.quizState.topic || '일반상식';
  const topic = rawTopic === '전체 랜덤'
    ? BANK_TOPICS[Math.floor(Math.random() * BANK_TOPICS.length)]
    : rawTopic;
    // consumeImmediately = false 로 호출하여 뱅크에서 미리 삭제되지 않도록 예약만 수행!
    const gen = await generateOneQuizFromServer(topic, targetDiff, [], false);
    if (gen && gen.ok && gen.quiz) {
      room.prefetchedNextQuiz = {
        ...gen.quiz,
        topic,
        difficulty: targetDiff
      };
    }
  } catch (e) {
    console.warn('⚠️ 다음 문제 사전 준비 중 오류:', e.message);
  } finally {
    room.isGeneratingAutoQuiz = false;
  }
}

function clearRoomTimers(room) {
  if (room.timerHandle) {
    clearTimeout(room.timerHandle);
    room.timerHandle = null;
  }
  if (room.autoNextTimerHandle) {
    clearTimeout(room.autoNextTimerHandle);
    room.autoNextTimerHandle = null;
  }
}

// 자동 진행(Auto-Play): 대기 시간 후 다음 문제 자동 출제
async function launchNextAutoQuestion(roomCode) {
  const room = getOrCreateRoom(roomCode);
  if (room.autoNextTimerHandle) {
    clearTimeout(room.autoNextTimerHandle);
    room.autoNextTimerHandle = null;
  }
  room.quizState.nextAutoQuestionAt = null;

  if (!room.quizState.autoPlayEnabled || room.quizState.autoPlayStopAfterCurrent) {
    room.quizState.autoPlayEnabled = false;
    room.quizState.autoPlayStopAfterCurrent = false;
    room.quizState.updatedAt = Date.now();
    broadcastRoomUpdate(roomCode);
    return;
  }

  // 이미 라운드 우승자나 최종 챔피언이 나왔다면 자동 진행 종료
  if (room.quizState.winnerNickname || room.quizState.finalChampionNickname) {
    room.quizState.autoPlayEnabled = false;
    room.quizState.autoPlayStopAfterCurrent = false;
    room.quizState.updatedAt = Date.now();
    broadcastRoomUpdate(roomCode);
    return;
  }

  const aliveUsers = room.participants.filter((p) => p.isAlive !== false);
  const nextQId =
    room.quizState.status === 'waiting' && !room.quizState.question
      ? Number(room.quizState.questionId || 1)
      : Number(room.quizState.questionId || 1) + 1;

  if (!room.quizState.initialAliveCount || nextQId === 1) {
    room.quizState.initialAliveCount = Math.max(aliveUsers.length, room.participants.length, 1);
  }

  const targetDiff = pickAutoDifficulty(
    aliveUsers.length,
    room.quizState.initialAliveCount,
    nextQId,
    room.quizState.autoPlayDifficultyMode
  );
  const topic = room.quizState.autoPlayTopic || room.quizState.topic || '일반상식';

  let quizItem = room.prefetchedNextQuiz;
  room.prefetchedNextQuiz = null;

  if (
    !quizItem ||
    quizItem.difficulty !== targetDiff ||
    quizItem.topic !== topic ||
    isQuestionAlreadyUsed(quizItem.question)
  ) {
    const gen = await generateOneQuizFromServer(topic, targetDiff, [], true);
    quizItem = gen.quiz;
  } else {
    // 사전 예약된 문제를 실제로 출제하는 시점에 사용 완료 뱅크로 이동!
    markQuestionAsUsed(quizItem.question, quizItem);
    triggerBackgroundBankRefillIfNeeded(topic, targetDiff);
  }

  const now = Date.now();
  const configuredDur = Number(room.quizState.autoPlayQuestionDurationSec || 0);
  const durationSec =
    configuredDur > 0
      ? configuredDur
      : calculateSmartDurationSeconds(quizItem.question, targetDiff);
  const revealAt = now + durationSec * 1000;

  room.participants = room.participants.map((p) => ({
    ...p,
    choice: null,
    spectatorChoice: null,
    questionId: nextQId,
    updatedAt: now
  }));

  room.quizState = {
    ...room.quizState,
    status: 'question_active',
    topic,
    question: quizItem.question,
    correctAnswer: quizItem.answer === 'X' ? 'X' : 'O',
    explanation: quizItem.explanation || '',
    difficulty: targetDiff,
    questionId: nextQId,
    gameStarted: true,
    winnerNickname: null,
    allWrongRevived: false,
    revealAt,
    countdownDuration: durationSec,
    nextAutoQuestionAt: null,
    updatedAt: now
  };
  room.updatedAt = now;

  collectOxEntryFeesIfNeeded(room);
  scheduleServerAutoReveal(roomCode, revealAt);
  broadcastRoomUpdate(roomCode);
}

// 서버 타이머: 제한시간 종료 시 버저비터 유예(0.75초) 후 정답 공개 및 생존자 판정
function performServerSideReveal(roomCode) {
  const room = getOrCreateRoom(roomCode);
  if (room.quizState.status !== 'question_active') return;

  if (room.timerHandle) {
    clearTimeout(room.timerHandle);
    room.timerHandle = null;
  }

  const now = Date.now();
  const correctAns = room.quizState.correctAnswer;
  const activeQId = room.quizState.questionId;
  const currentRound = room.quizState.roundNumber || 1;
  const targetWins = room.quizState.targetWins === 0 ? 0 : Number(room.quizState.targetWins || 1);

  const currentAlive = room.participants.filter((p) => p.isAlive !== false);
  const survivors = currentAlive.filter(
    (p) => p.choice === correctAns && Number(p.questionId) === Number(activeQId)
  );

  let nextParticipants = [];
  let winnerNickname = null;
  let finalChampionNickname = room.quizState.finalChampionNickname || null;
  let allWrongRevived = false;

  if (currentAlive.length > 0 && survivors.length === 0) {
    // 전원 오답(패자부활): 단, 30초 이상 접속이 끊긴 채 미선택한 유령 참가자는 부활에서 제외하여 진행 막힘 방지!
    const activeAlive = currentAlive.filter(
      (p) => !(isParticipantEffectivelyOffline(p, now) && !p.choice)
    );
    const reviveTargetIds = new Set(
      (activeAlive.length > 0 ? activeAlive : currentAlive).map((p) => p.id)
    );

    allWrongRevived = true;
    nextParticipants = room.participants.map((p) => {
      if (p.isAlive === false) return p;
      if (reviveTargetIds.has(p.id)) {
        return { ...p, isAlive: true, updatedAt: now };
      }
      return {
        ...p,
        isAlive: false,
        eliminatedRound: `${currentRound}R-${activeQId}Q`,
        updatedAt: now
      };
    });

    const afterReviveAlive = nextParticipants.filter((p) => p.isAlive !== false);
    if (afterReviveAlive.length === 1 && room.participants.length >= 2) {
      const lastOne = afterReviveAlive[0];
      winnerNickname = lastOne.nickname;
      const newWins = Number(lastOne.wins || 0) + 1;
      if (targetWins > 0 && newWins >= targetWins) {
        finalChampionNickname = lastOne.nickname;
      }
      nextParticipants = nextParticipants.map((p) =>
        p.id === lastOne.id ? { ...p, wins: newWins, updatedAt: now } : p
      );
    }
  } else {
    if (survivors.length === 1) {
      winnerNickname = survivors[0].nickname;
    }
    nextParticipants = room.participants.map((p) => {
      if (p.isAlive === false) return p;
      const survived =
        p.choice === correctAns && Number(p.questionId) === Number(activeQId);
      let newWins = Number(p.wins || 0);
      if (survived && survivors.length === 1) {
        newWins += 1;
        if (targetWins > 0 && newWins >= targetWins) {
          finalChampionNickname = p.nickname;
        }
      }
      return {
        ...p,
        isAlive: survived,
        wins: newWins,
        eliminatedRound: survived ? null : `${currentRound}R-${activeQId}Q`,
        updatedAt: now
      };
    });
  }

  // 자동 진행 중이고 아직 우승자가 안 나왔으며 정지 예약이 안 된 경우 다음 문제 타이머 예약
  const shouldContinueAuto =
    room.quizState.autoPlayEnabled &&
    !room.quizState.autoPlayStopAfterCurrent &&
    !winnerNickname &&
    !finalChampionNickname &&
    survivors.length !== 1;

  const intervalSec = Math.max(4, Number(room.quizState.autoPlayIntervalSec || 8));
  const drumrollExtraMs = room.quizState.drumrollEnabled !== false ? 1500 : 0;
  const nextAutoAt = shouldContinueAuto ? now + intervalSec * 1000 + drumrollExtraMs : null;

  room.participants = nextParticipants;
  room.quizState = {
    ...room.quizState,
    status: 'answer_revealed',
    winnerNickname,
    finalChampionNickname,
    allWrongRevived,
    revealAt: null,
    countdownDuration: null,
    autoPlayEnabled: shouldContinueAuto,
    autoPlayStopAfterCurrent: false,
    nextAutoQuestionAt: nextAutoAt,
    updatedAt: now
  };
  room.updatedAt = now;

  if (winnerNickname || finalChampionNickname) {
    settleOxPrizeIfNeeded(room, finalChampionNickname || winnerNickname);
  }
  if (externalRecordOxStats) {
    try {
      externalRecordOxStats({
        currentAlive,
        survivors,
        winnerNickname,
        finalChampionNickname,
        correctAns,
        activeQId
      });
    } catch (_) {}
  }

  broadcastRoomUpdate(roomCode);

  if (shouldContinueAuto && nextAutoAt) {
    prefetchNextAutoQuiz(roomCode);
    if (room.autoNextTimerHandle) clearTimeout(room.autoNextTimerHandle);
    room.autoNextTimerHandle = setTimeout(() => {
      launchNextAutoQuestion(roomCode);
    }, Math.max(1000, nextAutoAt - Date.now()));
  }
}

function scheduleServerAutoReveal(roomCode, revealAt) {
  const room = getOrCreateRoom(roomCode);
  if (room.timerHandle) {
    clearTimeout(room.timerHandle);
    room.timerHandle = null;
  }
  if (!revealAt) return;
  // 버저비터(0초 직전 클릭) 패킷이 네트워크를 타고 도착할 수 있도록 750ms 유예 부여
  const delay = Math.max(100, Number(revealAt) - Date.now() + 750);
  room.timerHandle = setTimeout(() => {
    performServerSideReveal(roomCode);
  }, delay);
}

// ============================================================================
// 브라우저 단일 파일 클라이언트 HTML (모바일/PC 반응형 + 실시간 부분 업데이트 + 접속 감지)
// ============================================================================

function readJsonBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
      if (body.length > 2 * 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

async function requestHandler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // 0. OX 서바이벌 방 목록 조회 / 새 방 만들기 (계정당 1개 제한) / 방 삭제 (/ox-rooms)
  if (pathname === '/ox-rooms') {
    if (req.method === 'GET') {
      const checkCode = parsedUrl.searchParams.get('checkRoomCode');
      const deletedInfo = checkCode && deletedOxRooms.has(checkCode) ? deletedOxRooms.get(checkCode) : null;
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, rooms: getOxRoomsSummary(), deletedInfo }));
    }
    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      if (body.action === 'DELETE_ROOM' && body.roomCode) {
        const targetCode = String(body.roomCode);
        const deletedTitle = deleteOxRoomByCode(targetCode, '방장이 방을 삭제했습니다.') || `방 #${targetCode}`;
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: true, deletedTitle, rooms: getOxRoomsSummary() }));
      }

      const hostCid = String(body.hostClientId || '').trim();
      // 계정(hostClientId)당 방 1개만 생성 가능
      if (hostCid) {
        const existingGlobal = externalFindUserExistingRoom ? externalFindUserExistingRoom(hostCid, body.hostNickname, null, null) : null;
        const existingHostRoom = existingGlobal || Array.from(rooms.values()).find((r) => r.hostClientId === hostCid);
        if (existingHostRoom) {
          const label = existingHostRoom.gameLabel ? ` (${existingHostRoom.gameLabel})` : '';
          const roleTxt = existingHostRoom.role === 'player' ? '입장 중인' : '생성한';
          res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({
            ok: false,
            error: `이미 ${roleTxt} 방 [${existingHostRoom.title}]${label}이 있습니다. 기존 방에서 나가거나 삭제한 후 이용해주세요.`,
            existingRoom: { roomCode: existingHostRoom.roomCode || existingHostRoom.roomId, title: existingHostRoom.title }
          }));
        }
      }

      const rawPw = String(body.password || '').trim();
      if (rawPw && !/^\d{4}$/.test(rawPw)) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: '비밀번호는 숫자 4자리여야 합니다.' }));
      }
      const reqFee = Math.max(0, Math.min(1000000000, Math.floor(Number(body.entryFee) || 0)));
      const reqFunding = body.roomFundingMode === 'HOST_EVENT' ? 'HOST_EVENT' : 'ENTRY_FEE';
      const reqPayout = body.payoutMode === 'TOP3_SPLIT' ? 'TOP3_SPLIT' : 'WINNER_TAKES_ALL';
      if (reqFee > 0 && body.hostNickname && externalEconomyHooks?.canAffordGold && !externalEconomyHooks.canAffordGold(body.hostNickname, reqFee)) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: `보유 스타가 부족하여 ${reqFee.toLocaleString()} 스타 방을 만들 수 없습니다.` }));
      }
      const rawTitle = String(body.title || '').trim().slice(0, 24);
      const newCode = String(body.roomCode || Math.floor(1000 + Math.random() * 9000));
      const finalTitle = rawTitle || `${String(body.hostNickname || '방장').trim().slice(0, 16)}님의 방`;
      const created = getOrCreateRoom(newCode, finalTitle, hostCid || null, {
        hostNickname: body.hostNickname || '',
        maxPlayers: Number(body.maxPlayers || 0),
        password: rawPw,
        entryFee: reqFee,
        roomFundingMode: reqFunding,
        payoutMode: reqPayout,
        roomMode: body.roomMode,
        autoPlayTopic: body.autoPlayTopic,
        autoPlayDifficultyMode: body.autoPlayDifficultyMode,
        autoPlayQuestionDurationSec: typeof body.autoPlayQuestionDurationSec === 'number' ? body.autoPlayQuestionDurationSec : undefined,
        targetWins: body.targetWins
      });
      deletedOxRooms.delete(newCode);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({
        ok: true,
        roomCode: created.roomCode,
        title: created.title,
        hostClientId: created.hostClientId,
        roomMode: created.quizState.roomMode,
        rooms: getOxRoomsSummary()
      }));
    }
  }

  // 1. 실시간 SSE 이벤트 스트림 (연결/해제 시 참가자 접속 상태도 함께 추적)
  if (req.method === 'GET' && pathname === '/events') {
    const roomCode = parsedUrl.searchParams.get('roomCode') || '';
    const participantId = parsedUrl.searchParams.get('participantId') || '';
    const role = parsedUrl.searchParams.get('role') || '';
    if (!roomCode || !rooms.has(roomCode)) {
      const delInfo = deletedOxRooms.get(roomCode);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive'
      });
      res.write(`data: ${JSON.stringify({
        ok: false,
        roomDeleted: true,
        deletedRoomCode: roomCode,
        deletedTitle: delInfo ? delInfo.title : `방 #${roomCode}`,
        reason: delInfo ? delInfo.reason : '장시간 미사용으로 방이 삭제되었습니다.'
      })}\n\n`);
      return res.end();
    }
    const room = rooms.get(roomCode);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    if (role === 'admin') { room.hostLastSeenAt = Date.now(); }
    if (role === 'user' && participantId) {
      const now = Date.now();
      room.participants = room.participants.map((p) =>
        p.id === participantId
          ? { ...p, presenceState: 'online', lastSeenAt: now, disconnectedAt: null }
          : p
      );
    }

    room.sseClients.add(res);
    res.write(`data: ${JSON.stringify(buildRoomPayload(roomCode))}\n\n`);

    const keepAlive = setInterval(() => {
      try {
        res.write(': keep-alive\n\n');
      } catch (e) {}
    }, 15000);

    req.on('close', () => {
      clearInterval(keepAlive);
      room.sseClients.delete(res);
      if (role === 'admin') { room.hostLastSeenAt = Date.now(); }
    if (role === 'user' && participantId) {
        const now = Date.now();
        let changed = false;
        room.participants = room.participants.map((p) => {
          if (p.id === participantId) {
            changed = true;
            return {
              ...p,
              presenceState: 'offline',
              disconnectedAt: now,
              lastSeenAt: now
            };
          }
          return p;
        });
        if (changed) broadcastRoomUpdate(roomCode);
      }
    });
    return;
  }

  // 2. 방 상태 조회 (GET /sync)
  if (req.method === 'GET' && pathname === '/sync') {
    const roomCode = parsedUrl.searchParams.get('roomCode') || '';
    const participantId = parsedUrl.searchParams.get('participantId') || '';
    const role = parsedUrl.searchParams.get('role') || '';
    if (!roomCode || !rooms.has(roomCode)) {
      const delInfo = deletedOxRooms.get(roomCode);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({
        ok: false,
        roomDeleted: true,
        deletedRoomCode: roomCode,
        deletedTitle: delInfo ? delInfo.title : `방 #${roomCode}`,
        reason: delInfo ? delInfo.reason : '장시간 미사용으로 방이 삭제되었습니다.'
      }));
    }
    const room = rooms.get(roomCode);

    if (role === 'admin') { room.hostLastSeenAt = Date.now(); }
    if (role === 'user' && participantId) {
      const now = Date.now();
      room.participants = room.participants.map((p) =>
        p.id === participantId
          ? {
              ...p,
              presenceState: p.presenceState === 'away' ? 'away' : 'online',
              lastSeenAt: now,
              disconnectedAt: null
            }
          : p
      );
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(buildRoomPayload(roomCode)));
  }

  // 3. 방 상태 변경 및 액션 처리 (POST /sync)
  if (req.method === 'POST' && pathname === '/sync') {
    const body = await readJsonBody(req);
    const roomCode = body.roomCode || '';
    if (!roomCode || !rooms.has(roomCode)) {
      const delInfo = deletedOxRooms.get(roomCode);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({
        ok: false,
        roomDeleted: true,
        deletedRoomCode: roomCode,
        deletedTitle: delInfo ? delInfo.title : `방 #${roomCode}`,
        reason: delInfo ? delInfo.reason : '방이 삭제되었거나 존재하지 않습니다.'
      }));
    }
    const room = rooms.get(roomCode);
    const now = Date.now();
    room.lastActivityAt = now;
    if (!body.participantId || (room.hostClientId && body.participantId === room.hostClientId)) {
      room.hostLastSeenAt = now;
    }

    // 3-1. 참가자 실시간 접속 상태 핑 (ONLINE / AWAY / OFFLINE)
    if (body.action === 'PRESENCE_PING' && body.participantId) {
      const pState = body.presenceState || 'online';
      room.participants = room.participants.map((p) => {
        if (p.id !== body.participantId) return p;
        return {
          ...p,
          presenceState: pState,
          lastSeenAt: now,
          disconnectedAt: pState === 'offline' ? (p.disconnectedAt || now) : null
        };
      });
      broadcastRoomUpdate(roomCode);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(buildRoomPayload(roomCode)));
    }

    // 3-2. O/X 전용 초고속 선택 패킷 (생존자 정식 선택 + 관전자 모의 선택 모두 처리)
    if (body.action === 'PICK_OX' && body.participantId && (body.choice === 'O' || body.choice === 'X')) {
      const activeQId = room.quizState.questionId || 1;
      const existing = room.participants.find((p) => p.id === body.participantId);
      if (existing) {
        room.participants = room.participants.map((p) => {
          if (p.id !== body.participantId) return p;
          if (p.isAlive === false || body.isSpectator) {
            return {
              ...p,
              spectatorChoice: body.choice,
              questionId: activeQId,
              presenceState: 'online',
              lastSeenAt: now,
              updatedAt: now
            };
          }
          return {
            ...p,
            choice: body.choice,
            questionId: activeQId,
            presenceState: 'online',
            lastSeenAt: now,
            updatedAt: now
          };
        });
      } else {
        room.participants.push({
          id: body.participantId,
          nickname: body.nickname || '참가자',
          isAlive: !room.quizState.gameStarted,
          choice: room.quizState.gameStarted ? null : body.choice,
          spectatorChoice: room.quizState.gameStarted ? body.choice : null,
          questionId: activeQId,
          wins: 0,
          presenceState: 'online',
          lastSeenAt: now,
          updatedAt: now
        });
      }
      room.updatedAt = now;
      broadcastRoomUpdate(roomCode);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(buildRoomPayload(roomCode)));
    }

    // 3-2b. 대기 상태 참여/관전 모드 전환 및 레디(동의) 토글 (TOGGLE_SPECTATOR_PREF / TOGGLE_READY)
    if (body.action === 'TOGGLE_READY' && body.participantId) {
      const targetP = room.participants.find((p) => p.id === body.participantId);
      const fee = room.roomFundingMode === 'HOST_EVENT' ? 0 : Number(room.entryFee || 0);
      if (targetP && !targetP.ready && fee > 0 && externalEconomyHooks?.canAffordGold && !externalEconomyHooks.canAffordGold(targetP.nickname, fee)) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: 'INSUFFICIENT_GOLD', message: `보유 스타가 입장비(${fee.toLocaleString()} 스타)보다 부족하여 준비 완료할 수 없습니다.` }));
      }
      room.participants = room.participants.map((p) => {
        if (p.id !== body.participantId) return p;
        const nextReady = !p.ready;
        return {
          ...p,
          ready: nextReady,
          spectatorOnly: nextReady ? false : p.spectatorOnly,
          isAlive: nextReady ? true : p.isAlive,
          presenceState: 'online',
          lastSeenAt: now,
          updatedAt: now
        };
      });
      room.updatedAt = now;
      broadcastRoomUpdate(roomCode);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(buildRoomPayload(roomCode)));
    }

    if (body.action === 'TOGGLE_SPECTATOR_PREF' && body.participantId) {
      const wantSpec = Boolean(body.spectatorOnly);
      room.participants = room.participants.map((p) => {
        if (p.id !== body.participantId) return p;
        return {
          ...p,
          spectatorOnly: wantSpec,
          ready: wantSpec ? false : true,
          isAlive: !wantSpec,
          choice: null,
          spectatorChoice: null,
          updatedAt: now
        };
      });
      room.updatedAt = now;
      broadcastRoomUpdate(roomCode);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(buildRoomPayload(roomCode)));
    }

    // 3-3. 관리자: 개별 참가자 관리 (부활/탈락 토글, 승수 ±1, 강퇴)
    if (body.action === 'ADMIN_PARTICIPANT_CONTROL' && body.targetId) {
      const sub = body.subAction;
      if (sub === 'KICK') {
        if (!room.kickedIds) room.kickedIds = new Set();
        room.kickedIds.add(body.targetId);
        room.participants = room.participants.filter((p) => p.id !== body.targetId);
      } else {
        room.participants = room.participants.map((p) => {
          if (p.id !== body.targetId) return p;
          if (sub === 'TOGGLE_ALIVE') {
            const nextAlive = p.isAlive === false;
            return {
              ...p,
              isAlive: nextAlive,
              eliminatedRound: nextAlive ? null : `${room.quizState.roundNumber || 1}R-수동`,
              updatedAt: now
            };
          }
          if (sub === 'INC_WIN') {
            const nw = Number(p.wins || 0) + 1;
            return { ...p, wins: nw, updatedAt: now };
          }
          if (sub === 'DEC_WIN') {
            const nw = Math.max(0, Number(p.wins || 0) - 1);
            return { ...p, wins: nw, updatedAt: now };
          }
          return p;
        });
      }
      room.updatedAt = now;
      broadcastRoomUpdate(roomCode);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(buildRoomPayload(roomCode)));
    }

    // 3-4. 관리자: 30초 이상 접속이 끊긴 오프라인 참가자 일괄 정리
    if (body.action === 'ADMIN_PRUNE_OFFLINE') {
      const beforeCount = room.participants.length;
      room.participants = room.participants.filter(
        (p) => !isParticipantEffectivelyOffline(p, now)
      );
      const removedCount = beforeCount - room.participants.length;
      room.updatedAt = now;
      broadcastRoomUpdate(roomCode);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(
        JSON.stringify({
          ...buildRoomPayload(roomCode),
          removedCount
        })
      );
    }

    // 3-5. 자동 진행(Auto-Play) 시작 / 정지 / 설정 변경
    if (body.action === 'START_AUTO_PLAY') {
      if (!room.quizState.gameStarted) {
        const readyCheck = room.participants.filter((p) => {
          if (p.spectatorOnly) return false;
          const isHost = Boolean(room.hostClientId && p.id === room.hostClientId);
          const isOnline = !isParticipantEffectivelyOffline(p, now) && p.presenceState !== 'away';
          return isOnline && (isHost || Boolean(p.ready));
        });
        const minReq = Number(room.entryFee || 0) > 0 ? 2 : 1;
        if (readyCheck.length < minReq) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({
            ok: false,
            error: Number(room.entryFee || 0) > 0
              ? '⚠️ 스타 입장비 방은 최소 2명 이상 [✅ 준비 완료]를 눌러야 시작할 수 있습니다.'
              : '⚠️ [✅ 준비 완료] 상태인 참가자가 없습니다.'
          }));
        }
      }
      room.quizState.autoPlayEnabled = true;
      room.quizState.autoPlayStopAfterCurrent = false;
      if (body.autoPlayTopic) room.quizState.autoPlayTopic = body.autoPlayTopic;
      if (body.autoPlayDifficultyMode) room.quizState.autoPlayDifficultyMode = body.autoPlayDifficultyMode;
      if (typeof body.autoPlayQuestionDurationSec === 'number') {
        room.quizState.autoPlayQuestionDurationSec = Number(body.autoPlayQuestionDurationSec);
      }
      if (body.autoPlayIntervalSec) room.quizState.autoPlayIntervalSec = Number(body.autoPlayIntervalSec);
      room.quizState.updatedAt = now;

      if (room.quizState.status !== 'question_active') {
        await launchNextAutoQuestion(roomCode);
      } else {
        broadcastRoomUpdate(roomCode);
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(buildRoomPayload(roomCode)));
    }

    if (body.action === 'STOP_AUTO_PLAY') {
      if (room.quizState.status === 'question_active') {
        room.quizState.autoPlayStopAfterCurrent = !room.quizState.autoPlayStopAfterCurrent;
      } else {
        room.quizState.autoPlayEnabled = false;
        room.quizState.autoPlayStopAfterCurrent = false;
        room.quizState.nextAutoQuestionAt = null;
        if (room.autoNextTimerHandle) {
          clearTimeout(room.autoNextTimerHandle);
          room.autoNextTimerHandle = null;
        }
      }
      room.quizState.updatedAt = now;
      broadcastRoomUpdate(roomCode);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(buildRoomPayload(roomCode)));
    }

    if (body.action === 'VERIFY_ROOM_PASSWORD') {
      const isHost = Boolean(room.hostClientId && body.participantId && room.hostClientId === body.participantId);
      if (room.password && !isHost && String(body.password || '') !== room.password) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: 'WRONG_PASSWORD', message: '방 비밀번호(숫자 4자리)가 일치하지 않습니다.' }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true }));
    }

    if (body.action === 'HOST_UPDATE_SETTINGS') {
      const isRoundLocked = Boolean(
        room.quizState.gameStarted &&
        !room.quizState.winnerNickname &&
        !room.quizState.finalChampionNickname
      );
      if (isRoundLocked) {
        res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({
          ok: false,
          error: '라운드 진행 중에는 설정을 변경할 수 없습니다. 라운드 종료 후 수정하세요.'
        }));
      }
      const oxChanges = [];
      if ((body.roomMode === 'AUTO' || body.roomMode === 'MANUAL') && body.roomMode !== room.quizState.roomMode) {
        room.quizState.roomMode = body.roomMode;
        oxChanges.push(`진행 모드: ${body.roomMode === 'AUTO' ? '자동 출제' : '직접 출제'}`);
      }
      if (body.autoPlayTopic && String(body.autoPlayTopic) !== room.quizState.autoPlayTopic) {
        room.quizState.autoPlayTopic = String(body.autoPlayTopic);
        oxChanges.push(`주제: ${room.quizState.autoPlayTopic}`);
      }
      if (body.autoPlayDifficultyMode && String(body.autoPlayDifficultyMode) !== room.quizState.autoPlayDifficultyMode) {
        room.quizState.autoPlayDifficultyMode = String(body.autoPlayDifficultyMode);
        oxChanges.push(`난이도: ${room.quizState.autoPlayDifficultyMode === 'auto' ? '자동' : room.quizState.autoPlayDifficultyMode}`);
      }
      if (typeof body.autoPlayQuestionDurationSec === 'number' && Number(body.autoPlayQuestionDurationSec) !== room.quizState.autoPlayQuestionDurationSec) {
        room.quizState.autoPlayQuestionDurationSec = Number(body.autoPlayQuestionDurationSec);
        oxChanges.push(`제한시간: ${room.quizState.autoPlayQuestionDurationSec > 0 ? room.quizState.autoPlayQuestionDurationSec + '초' : '스마트 자동'}`);
      }
      if (typeof body.targetWins === 'number') {
        const nextTw = Math.max(0, Math.min(10, Number(body.targetWins)));
        if (nextTw !== room.quizState.targetWins) {
          room.quizState.targetWins = nextTw;
          oxChanges.push(`목표 우승: ${nextTw === 0 ? '무제한' : nextTw + '승'}`);
        }
      }
      if (typeof body.maxPlayers !== 'undefined') {
        const nextCap = Math.max(0, Math.min(100, Number(body.maxPlayers) || 0));
        if (nextCap !== room.maxPlayers) {
          room.maxPlayers = nextCap;
          oxChanges.push(`최대 인원: ${nextCap > 0 ? nextCap + '명' : '무제한'}`);
        }
      }
      if (typeof body.entryFee !== 'undefined') {
        const allowedFees = [0, 100, 500, 1000, 3000];
        const nextFee = allowedFees.includes(Number(body.entryFee)) ? Number(body.entryFee) : 0;
        if (nextFee !== room.entryFee) {
          room.entryFee = nextFee;
          oxChanges.push(`입장비: ${nextFee > 0 ? nextFee.toLocaleString() + ' 스타' : '무료'}`);
        }
      }
      if (body.payoutMode) {
        const nextPm = body.payoutMode === 'TOP3_SPLIT' ? 'TOP3_SPLIT' : 'WINNER_TAKES_ALL';
        if (nextPm !== room.payoutMode) {
          room.payoutMode = nextPm;
          oxChanges.push(`상금 배분: ${nextPm === 'TOP3_SPLIT' ? '1~3등 차등(60/25/15%)' : '1등 독식(100%)'}`);
        }
      }
      if (oxChanges.length > 0) {
        room.notices.push({ text: `📢 방장 설정 변경 · ${oxChanges.join(' · ')}`, createdAt: now });
        if (room.notices.length > 20) room.notices = room.notices.slice(-20);
      }
      room.quizState.updatedAt = now;
      broadcastRoomUpdate(roomCode);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(buildRoomPayload(roomCode)));
    }

    if (body.action === 'HOST_NEXT_ROUND') {
      clearRoomTimers(room);
      room.feeCollectedForRound = false;
      room.prizeSettledForRound = false;
      room.prizePool = 0;
      room.lastPayouts = [];
      room.quizState.status = 'waiting';
      room.quizState.gameStarted = false;
      room.quizState.winnerNickname = null;
      room.quizState.finalChampionNickname = null;
      room.quizState.allWrongRevived = false;
      room.quizState.autoPlayEnabled = false;
      room.quizState.autoPlayStopAfterCurrent = false;
      room.quizState.nextAutoQuestionAt = null;
      room.quizState.revealAt = null;
      room.quizState.roundNumber = Number(room.quizState.roundNumber || 1) + 1;
      room.quizState.updatedAt = now;
      room.participants = room.participants.map((p) => ({
        ...p,
        ready: Boolean(room.hostClientId && p.id === room.hostClientId),
        isAlive: !p.spectatorOnly,
        choice: null,
        spectatorChoice: null,
        eliminatedRound: null,
        updatedAt: now
      }));
      broadcastRoomUpdate(roomCode);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(buildRoomPayload(roomCode)));
    }

    if (body.action === 'CONFIG_AUTO_PLAY') {
      if (body.autoPlayTopic) room.quizState.autoPlayTopic = body.autoPlayTopic;
      if (body.autoPlayDifficultyMode) room.quizState.autoPlayDifficultyMode = body.autoPlayDifficultyMode;
      if (typeof body.autoPlayQuestionDurationSec === 'number') {
        room.quizState.autoPlayQuestionDurationSec = Number(body.autoPlayQuestionDurationSec);
      }
      if (body.autoPlayIntervalSec) room.quizState.autoPlayIntervalSec = Number(body.autoPlayIntervalSec);
      room.quizState.updatedAt = now;
      broadcastRoomUpdate(roomCode);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(buildRoomPayload(roomCode)));
    }

    // 진행 중인 문제 시간 연장 (+5초, +10초 등) + 전체 참가자에게 공지 알림 자동 발송
    if (body.action === 'EXTEND_TIME' && room.quizState.status === 'question_active') {
      const addSec = Math.max(1, Math.min(60, Number(body.extraSeconds || 5)));
      const baseRevealAt = Math.max(now, Number(room.quizState.revealAt || now));
      const newRevealAt = baseRevealAt + addSec * 1000;
      room.quizState.revealAt = newRevealAt;
      room.quizState.countdownDuration = Number(room.quizState.countdownDuration || 10) + addSec;
      room.quizState.updatedAt = now;

      scheduleServerAutoReveal(roomCode, newRevealAt);

      room.notices.push({
        id: 'nt_ext_' + now + '_' + Math.random().toString(36).slice(2, 6),
        text: `⏱️ 제한시간 +${addSec}초 연장!`,
        createdAt: now
      });
      if (room.notices.length > 20) room.notices = room.notices.slice(-20);

      room.updatedAt = now;
      broadcastRoomUpdate(roomCode);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(buildRoomPayload(roomCode)));
    }

    if (body.action === 'REVEAL_NOW') {
      performServerSideReveal(roomCode);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(buildRoomPayload(roomCode)));
    }

    // 3-6. 일반 상태/참가자/공지/리액션 병합
    if (body.action === 'RESET_ALL_WINS' && Array.isArray(body.participants)) {
      room.participants = body.participants.map((p) => ({
        ...p,
        wins: 0,
        isAlive: !p.spectatorOnly,
        choice: null,
        spectatorChoice: null,
        eliminatedRound: null,
        updatedAt: now
      }));
      clearRoomTimers(room);
    } else if (Array.isArray(body.participants)) {
      for (const inc of body.participants) {
        if (inc && inc.id && !inc.removed) {
          const alreadyIn = room.participants.some((p) => p.id === inc.id);
          const isHost = Boolean(room.hostClientId && room.hostClientId === inc.id);
          if (!alreadyIn && !inc.isSpectator && externalFindUserExistingRoom) {
            const conflict = externalFindUserExistingRoom(inc.id, inc.nickname, 'ox', roomCode);
            if (conflict) {
              const roleTxt = conflict.role === 'player' ? '입장 중인' : '생성한';
              res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' });
              return res.end(JSON.stringify({
                ok: false,
                error: 'ROOM_CONFLICT',
                message: `이미 ${roleTxt} 방 [${conflict.title}] (${conflict.gameLabel})이 있습니다. 기존 방에서 나가거나 삭제한 후 이용해주세요.`
              }));
            }
          }
          if (!alreadyIn && !isHost && room.password && String(body.roomPassword || '') !== room.password) {
            res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ ok: false, error: 'WRONG_PASSWORD', message: '방 비밀번호(숫자 4자리)가 일치하지 않습니다.' }));
          }
          if (!alreadyIn && !isHost && room.maxPlayers > 0 && room.participants.length >= room.maxPlayers) {
            res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ ok: false, error: 'ROOM_FULL', message: `방 최대 인원(${room.maxPlayers}명)에 도달했습니다.` }));
          }
          if (!alreadyIn && !inc.isSpectator && !inc.spectatorOnly && room.roomFundingMode !== 'HOST_EVENT' && room.entryFee > 0 && externalEconomyHooks?.canAffordGold && !externalEconomyHooks.canAffordGold(inc.nickname, room.entryFee)) {
            res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ ok: false, error: 'INSUFFICIENT_GOLD', message: `입장비(${room.entryFee.toLocaleString()} 스타)가 부족하여 참가할 수 없습니다.` }));
          }
        }
      }
      body.participants.forEach((inc) => {
        if (inc && inc.id && !inc.removed) {
          // 다른 OX 방 및 마블 드롭 방에서 해당 유저를 자동으로 퇴장시켜 동시 입장을 원천 차단!
          removeParticipantFromAllOxRooms(inc.id, inc.nickname, roomCode);
          if (externalRemoveUserEverywhere) {
            try { externalRemoveUserEverywhere({ clientId: inc.id, nickname: inc.nickname, exceptGame: 'ox' }); } catch (_) {}
          }
        }
      });
      const activeQId =
        room.quizState.status === 'question_active' ? room.quizState.questionId : null;
      const hadRemoved = body.participants.some((inc) => inc && inc.removed);
      room.participants = mergeParticipants(room.participants, body.participants, now, activeQId, room.kickedIds);
      if (hadRemoved && room.quizState.gameStarted && !room.quizState.winnerNickname && !room.quizState.finalChampionNickname) {
        const remainingAlive = room.participants.filter((p) => !p.spectatorOnly && p.isAlive !== false);
        if (remainingAlive.length === 1 && room.prizePool > 0) {
          const lastSurv = remainingAlive[0];
          room.quizState.winnerNickname = lastSurv.nickname;
          room.quizState.status = 'answer_revealed';
          room.quizState.autoPlayEnabled = false;
          clearRoomTimers(room);
          settleOxPrizeIfNeeded(room, lastSurv.nickname);
          room.notices.push({
            id: 'nt_forfeit_' + now,
            text: `🏳️ 상대 참가자 중도 기권 퇴장으로 [${lastSurv.nickname}]님이 자동 우승했습니다!`,
            createdAt: now
          });
        }
      }
    }

    if (body.quizState && typeof body.quizState === 'object') {
      const prevStatus = room.quizState.status;
      room.quizState = {
        ...room.quizState,
        ...body.quizState,
        updatedAt: now
      };
      if (room.quizState.status === 'question_active' && room.quizState.revealAt) {
        if (prevStatus !== 'question_active') {
          collectOxEntryFeesIfNeeded(room);
          markQuestionAsUsed(room.quizState.question, {
            topic: room.quizState.topic,
            difficulty: room.quizState.difficulty,
            question: room.quizState.question,
            answer: room.quizState.correctAnswer,
            explanation: room.quizState.explanation
          });
        }
        scheduleServerAutoReveal(roomCode, room.quizState.revealAt);
      }
    }

    if (body.reaction && body.reaction.emoji) {
      room.reactions.push({ ...body.reaction, createdAt: now });
      if (room.reactions.length > 30) room.reactions = room.reactions.slice(-30);
    }

    if (body.notice && body.notice.text) {
      room.notices.push({ ...body.notice, createdAt: now });
      if (room.notices.length > 20) room.notices = room.notices.slice(-20);
    }

    room.updatedAt = now;
    broadcastRoomUpdate(roomCode);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(buildRoomPayload(roomCode)));
  }

  // 4. AI 문제 뽑기 (POST /ai-quiz)
  if (req.method === 'POST' && pathname === '/ai-quiz') {
    const body = await readJsonBody(req);
    const result = await generateOneQuizFromServer(
      body.topic || '일반상식',
      body.difficulty || '보통',
      body.recentHistory || [],
      true
    );
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(result));
  }

  // 5. 문제 뱅크 수동 충전 (POST /refill-bank)
  if (req.method === 'POST' && pathname === '/refill-bank') {
    const body = await readJsonBody(req);
    const refillRes = await refillQuizBankFromAi(
      body.topic || '일반상식',
      body.difficulty || '보통',
      8
    );
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(
      JSON.stringify({
        ok: refillRes.ok,
        addedCount: refillRes.addedCount || 0,
        unusedBankCount: persistentQuizBank.length,
        usedQuestionCount: usedQuizBank.length
      })
    );
  }

  // 6. 기본 웹 페이지 응답
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(getClientHtml());
}



function getOxBankStats() {
  const combos = [];
  for (const topic of BANK_TOPICS) {
    for (const difficulty of BANK_DIFFICULTIES) {
      combos.push({
        topic,
        difficulty,
        count: countAvailableInBank(topic, difficulty)
      });
    }
  }
  return {
    hasApiKey: Boolean(serverGeminiApiKey),
    lastError: lastBankRefillError,
    totalUnused: persistentQuizBank.length,
    totalUsed: usedQuizBank.length,
    targetPerCombo: TARGET_BANK_PER_COMBO,
    hasGeminiKey: Boolean(serverGeminiApiKey),
    combos
  };
}

function getOxRoomsJoinedBy(cid, nick) {
  const nLow = String(nick || '').trim().toLowerCase();
  const resList = [];
  for (const [, rm] of rooms.entries()) {
    if (rm.participants.some((p) => (cid && p.id === cid) || (nLow && p.nickname && p.nickname.toLowerCase() === nLow))) {
      resList.push({ roomCode: rm.roomCode, title: rm.title, hostClientId: rm.hostClientId, hostNickname: rm.hostNickname, count: rm.participants.length });
    }
  }
  return resList;
}
module.exports = { requestHandler, setServerHooks, removeParticipantFromAllOxRooms, getOxRoomsSummary, getOxRoomsJoinedBy, deleteOxRoomByCode, setOxIdleTimeoutMinutes, getOxBankStats };
