/* ==========================================================================
   JINJIN SMART HOME DASHBOARD - JAVASCRIPT APPLICATION (app.js)
   Mobile-First Web Bluetooth (NUS), Realtime Chart.js, ASMR Web Audio, AI Chatbot
   Google Calendar Integration & OpenWeatherMap API (Default: Busan)
   Creators: Jina & Yejin
   ========================================================================== */

// --- BLE Constants (Nordic UART Service) ---
const BLE_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const BLE_RX_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // Web -> ESP32
const BLE_TX_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // ESP32 -> Web

// --- Global Application State ---
let bleDevice = null;
let rxCharacteristic = null;
let txCharacteristic = null;
let isConnected = false;
let isDemoMode = false;
let demoInterval = null;

// App States
let currentMode = null; // 'sleep', 'wakeup', 'focus', or null (nothing)
let snoreCount = 0;

// Sleep Session Score Tracking
let sleepSessionSnoreCount = 0;
let sleepStartTime = null;
let lastSleepScore = null;

// ASMR & Focus Timer States
let isAsmrPlaying = false;
let asmrAudioCtx = null;
let asmrGainNode = null;
let focusTimerInterval = null;
let focusTimeRemaining = 25 * 60; // 25 mins

// Chart.js Instance
let snoreChart = null;
const chartDataPoints = [];
const chartLabels = [];
const MAX_CHART_POINTS = 15;

// Todo Task Storage Key
const TODO_STORAGE_KEY = 'jinjin_smarthome_todos';
let todoItems = [];

// ==========================================================================
// 1. INITIALIZATION & TAB SWITCHING
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initChart();
  initTodoList();
  initCalendarIntegration();
  initControls();
  initChatbot();
  initWeather();
  initASMR();
  initTheme();
  logSystem('JINJIN 스마트홈 모바일 대시보드가 준비되었습니다. (부산 날씨 & 구글 캘린더 연동)');
});

// Tab View Switcher (Mobile Bottom Nav: 오늘 하루 / 홈 제어 / 설정)
function initTabs() {
  const navItems = document.querySelectorAll('.nav-item');
  const tabViews = document.querySelectorAll('.tab-view');

  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = item.getAttribute('data-target');

      navItems.forEach(l => l.classList.remove('active'));
      tabViews.forEach(v => v.classList.remove('active'));

      item.classList.add('active');
      const targetView = document.getElementById(targetId);
      if (targetView) targetView.classList.add('active');
    });
  });
}

// ==========================================================================
// 2. THEME SETTINGS & NIGHT MODE TOGGLE (야간 모드 ON / OFF)
// ==========================================================================
function initTheme() {
  const toggleTheme = document.getElementById('toggle-theme-mode');
  const savedTheme = localStorage.getItem('jinjin_theme');

  if (savedTheme === 'light') {
    applyTheme(false);
    if (toggleTheme) toggleTheme.checked = false;
  } else {
    applyTheme(true);
    if (toggleTheme) toggleTheme.checked = true;
  }

  if (toggleTheme) {
    toggleTheme.addEventListener('change', (e) => {
      applyTheme(e.target.checked);
    });
  }
}

function applyTheme(isDark) {
  const badge = document.getElementById('theme-status-badge');
  if (isDark) {
    document.body.classList.remove('light-mode');
    localStorage.setItem('jinjin_theme', 'dark');
    if (badge) badge.innerText = '야간 모드 ON (다크)';
    logSystem('🌙 야간 모드(Dark Mode)가 적용되었습니다.');
  } else {
    document.body.classList.add('light-mode');
    localStorage.setItem('jinjin_theme', 'light');
    if (badge) badge.innerText = '야간 모드 OFF (화이트)';
    logSystem('☀️ 주간 모드(Light Mode)가 적용되었습니다.');
  }
}

// ==========================================================================
// 3. WEB BLUETOOTH NUS LOGIC & DISCONNECTED ALERT
// ==========================================================================
function checkConnectionGuard() {
  if (!isConnected && !isDemoMode) {
    alert('⚠️ 스마트홈 기기를 연결해주세요!\n\n우측 상단의 [ESP_JJ] 버튼을 눌러 블루투스로 연결하거나, [데모] 버튼을 눌러 체험 모드를 실행해 주세요.');
    logSystem('⚠️ [연결 필요] 블루투스 미연결 및 데모 모드 OFF 상태입니다.', 'err');
    return false;
  }
  return true;
}

async function connectBLE() {
  if (isDemoMode) {
    toggleDemoMode(false);
  }

  try {
    logSystem("ESP32 기기 검색 중... ('ESP_JJ')");
    updateStatusUI('connecting', '연결 시도...');

    bleDevice = await navigator.bluetooth.requestDevice({
      filters: [{ name: 'ESP_JJ' }, { namePrefix: 'ESP_' }],
      optionalServices: [BLE_SERVICE_UUID]
    });

    bleDevice.addEventListener('gattserverdisconnected', onDisconnected);

    logSystem(`기기 발견: ${bleDevice.name}. GATT 서버 연결 중...`);
    const server = await bleDevice.gatt.connect();

    logSystem('BLE NUS 서비스 수신 중...');
    const service = await server.getPrimaryService(BLE_SERVICE_UUID);

    rxCharacteristic = await service.getCharacteristic(BLE_RX_UUID);
    txCharacteristic = await service.getCharacteristic(BLE_TX_UUID);

    await txCharacteristic.startNotifications();
    txCharacteristic.addEventListener('characteristicvaluechanged', handleBLEData);

    isConnected = true;
    updateStatusUI('connected', 'ESP_JJ 연결됨');
    logSystem(`🎉 ESP32 (${bleDevice.name}) 연결 성공!`, 'tx');

    sendBLECommand('1');
  } catch (error) {
    console.error('BLE Connection Error:', error);
    logSystem(`BLE 연결 실패: ${error.message || error}`, 'err');
    updateStatusUI('disconnected', 'ESP_JJ');
  }
}

function onDisconnected() {
  isConnected = false;
  rxCharacteristic = null;
  txCharacteristic = null;
  updateStatusUI('disconnected', 'ESP_JJ');
  logSystem('⚠️ ESP32 기기 연결이 해제되었습니다.', 'err');
}

async function sendBLECommand(cmd) {
  const timestamp = new Date().toLocaleTimeString();
  
  if (isDemoMode) {
    logTerminal(`[${timestamp}] [TX - DEMO]: ${cmd}`, 'tx');
    handleDemoCommandResponse(cmd);
    return true;
  }

  if (!isConnected || !rxCharacteristic) {
    checkConnectionGuard();
    return false;
  }

  try {
    const encoder = new TextEncoder();
    await rxCharacteristic.writeValue(encoder.encode(cmd));
    logTerminal(`[${timestamp}] [TX]: '${cmd}'`, 'tx');
    return true;
  } catch (error) {
    console.error('Send command error:', error);
    logSystem(`명령어 전송 에러 ('${cmd}'): ${error.message}`, 'err');
    return false;
  }
}

function handleBLEData(event) {
  const value = event.target.value;
  const decoder = new TextDecoder('utf-8');
  const msg = decoder.decode(value).trim();
  const timestamp = new Date().toLocaleTimeString();

  logTerminal(`[${timestamp}] [RX]: ${msg}`, 'rx');
  parseDeviceMessage(msg);
}

function parseDeviceMessage(msg) {
  if (msg.includes('temp')) {
    const match = msg.match(/temp\s*:\s*(\d+)/i);
    if (match) {
      const temp = match[1];
      document.getElementById('weather-temp-val').innerText = temp;
      document.getElementById('sensor-temp').innerText = `${temp} °C`;
    }
  }

  if (msg.includes('humi')) {
    const match = msg.match(/humi\s*:\s*(\d+)/i);
    if (match) {
      const humi = match[1];
      document.getElementById('weather-humi-val').innerText = humi;
      document.getElementById('sensor-humi').innerText = `${humi} %`;
    }
  }

  if (/^\d+$/.test(msg)) {
    const cdsVal = parseInt(msg, 10);
    document.getElementById('sensor-cds').innerText = cdsVal;
  }

  if (msg.includes('Snore Monitor Started')) {
    setModeUI('sleep');
  }

  if (msg.includes('Snore Monitor OFF')) {
    if (currentMode === 'sleep') {
      finishSleepSession();
    } else {
      setModeUI(null);
    }
  }

  if (msg.includes('Mic Level')) {
    const match = msg.match(/Mic Level\s*:\s*(\d+)/i);
    if (match) {
      const level = parseInt(match[1], 10);
      document.getElementById('sensor-mic').innerText = level;
      addChartData(level);

      if (level > 60) {
        snoreCount = Math.min(3, snoreCount + 1);
        sleepSessionSnoreCount++;
        updateSnoreBadge();
      }
    }
  }

  if (msg.includes('SNORING_ALERT')) {
    sleepSessionSnoreCount++;
    updateSnoreBadge();
    logSystem(`💤 코골이 연속 감지 (부저 울림 없음, 총 ${sleepSessionSnoreCount}회 카운팅 중)`, 'sys');
  }
}

// ==========================================================================
// 4. SIMULATION / DEMO MODE
// ==========================================================================
function toggleDemoMode(forceState) {
  isDemoMode = forceState !== undefined ? forceState : !isDemoMode;

  const btnDemo = document.getElementById('btn-demo');
  if (isDemoMode) {
    if (isConnected && bleDevice) bleDevice.gatt.disconnect();

    btnDemo.classList.add('btn-primary');
    btnDemo.innerHTML = '<i class="fa-solid fa-bolt"></i> 데모 On';
    updateStatusUI('connected', '데모 모드');
    logSystem('✨ 시뮬레이션 데모 모드가 활성화되었습니다.');

    demoInterval = setInterval(() => {
      if (currentMode === 'sleep') {
        const mockMic = Math.floor(Math.random() * 70) + 10;
        parseDeviceMessage(`Mic Level: ${mockMic}`);

        if (mockMic > 62 && Math.random() > 0.6) {
          parseDeviceMessage('SNORING_ALERT');
        }
      }
    }, 2000);
  } else {
    btnDemo.classList.remove('btn-primary');
    btnDemo.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> 데모';
    if (demoInterval) clearInterval(demoInterval);
    updateStatusUI('disconnected', 'ESP_JJ');
    logSystem('시뮬레이션 데모 모드가 종료되었습니다.');
  }
}

function handleDemoCommandResponse(cmd) {
  if (cmd === '1' || cmd === 'w') {
    const mockTemp = Math.floor(Math.random() * 4) + 23;
    const mockHumi = Math.floor(Math.random() * 10) + 50;
    parseDeviceMessage(`temp : ${mockTemp}`);
    parseDeviceMessage(`humi : ${mockHumi}`);
  } else if (cmd === '2') {
    const mockCds = Math.floor(Math.random() * 2000) + 2500;
    parseDeviceMessage(`${mockCds}`);
  } else if (cmd === 'S') {
    parseDeviceMessage('Snore Monitor Started');
  } else if (cmd === 'Q') {
    if (currentMode === 'sleep') {
      finishSleepSession();
    } else {
      setModeUI(null);
    }
  } else if (cmd === '7') {
    document.getElementById('toggle-rgb-led').checked = true;
    document.getElementById('led-status-badge').innerText = 'ON';
    document.getElementById('led-status-badge').style.color = 'var(--accent-sky)';
  } else if (cmd === '8') {
    document.getElementById('toggle-rgb-led').checked = false;
    document.getElementById('led-status-badge').innerText = 'OFF';
    document.getElementById('led-status-badge').style.color = 'var(--text-dim)';
  } else if (cmd === 'A') {
    dismissSnoringAlert();
  }
}

function updateStatusUI(state, text) {
  const dot = document.getElementById('header-status-dot');
  const textEl = document.getElementById('header-status-text');

  if (textEl) textEl.innerText = text;

  if (state === 'connected') {
    dot.className = 'status-dot connected';
  } else {
    dot.className = 'status-dot';
  }
}

// ==========================================================================
// 5. CHART.JS REALTIME SNORE GRAPH
// ==========================================================================
function initChart() {
  const ctx = document.getElementById('snoreChart').getContext('2d');

  const gradient = ctx.createLinearGradient(0, 0, 0, 150);
  gradient.addColorStop(0, 'rgba(56, 189, 248, 0.4)');
  gradient.addColorStop(1, 'rgba(56, 189, 248, 0.0)');

  snoreChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: chartLabels,
      datasets: [
        {
          label: '마이크 코골이 음량',
          data: chartDataPoints,
          borderColor: '#38BDF8',
          borderWidth: 2,
          backgroundColor: gradient,
          fill: true,
          tension: 0.4,
          pointRadius: 3,
          pointBackgroundColor: '#818CF8'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#94A3B8', font: { family: 'JetBrains Mono', size: 10 } }
        },
        y: {
          min: 0,
          max: 120,
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#94A3B8', font: { family: 'JetBrains Mono', size: 10 } }
        }
      },
      plugins: {
        legend: { display: false }
      }
    }
  });
}

function addChartData(level) {
  const timeStr = new Date().toLocaleTimeString().split(' ')[0];

  chartLabels.push(timeStr);
  chartDataPoints.push(level);

  if (chartLabels.length > MAX_CHART_POINTS) {
    chartLabels.shift();
    chartDataPoints.shift();
  }

  snoreChart.update();
}

function updateSnoreBadge() {
  const badge = document.getElementById('snore-count-badge');
  if (badge) {
    badge.innerText = `코골이: ${sleepSessionSnoreCount}회`;
  }
}

function startSleepSession() {
  sleepSessionSnoreCount = 0;
  sleepStartTime = new Date();
  updateSnoreBadge();
  logSystem('🌙 [수면 측정 시작] 코골이 조용히 카운팅 중...');
}

function finishSleepSession() {
  const sleepEndTime = new Date();
  let durationStr = '1분 미만';

  if (sleepStartTime) {
    const elapsedSeconds = Math.max(1, Math.floor((sleepEndTime - sleepStartTime) / 1000));
    if (elapsedSeconds < 60) {
      durationStr = `${elapsedSeconds}초`;
    } else {
      const mins = Math.floor(elapsedSeconds / 60);
      const hours = Math.floor(mins / 60);
      durationStr = hours > 0 ? `${hours}시간 ${mins % 60}분` : `${mins}분`;
    }
  }

  const score = Math.max(50, Math.min(100, 100 - (sleepSessionSnoreCount * 6)));
  lastSleepScore = score;

  let gradeTitle = '😴 꿀잠! 최상의 수면';

  if (score >= 90) {
    gradeTitle = '😴 꿀잠! 최상의 수면 상태';
  } else if (score >= 75) {
    gradeTitle = '😌 편안하고 양호한 수면';
  } else if (score >= 60) {
    gradeTitle = '🥱 주의: 약간의 코골이 감지';
  } else {
    gradeTitle = '⚠️ 경고: 잦은 코골이 발생';
  }

  const scoreCard = document.getElementById('sleep-score-card');
  document.getElementById('card-sleep-score-num').innerText = score;
  document.getElementById('card-sleep-grade').innerText = gradeTitle;
  document.getElementById('card-sleep-snore-count').innerText = `${sleepSessionSnoreCount}회`;
  document.getElementById('card-sleep-duration').innerText = durationStr;
  document.getElementById('last-sleep-time-badge').innerText = sleepEndTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (scoreCard) {
    scoreCard.style.boxShadow = '0 0 35px rgba(56, 189, 248, 0.5)';
    scoreCard.style.borderColor = 'var(--accent-sky)';
    setTimeout(() => {
      scoreCard.style.boxShadow = 'var(--shadow-main)';
      scoreCard.style.borderColor = 'var(--border-glass)';
    }, 2000);
  }

  setModeUI(null);
  logSystem(`📊 [수면 점수 측정 완료] 수면 점수: ${score}점, 코골이: ${sleepSessionSnoreCount}회, 수면시간: ${durationStr}`, 'tx');
}

function initASMR() {
  const btnToggle = document.getElementById('btn-toggle-asmr');
  const btnTimer = document.getElementById('btn-start-timer');

  btnToggle.addEventListener('click', toggleASMR);
  btnTimer.addEventListener('click', toggleFocusTimer);
}

function toggleASMR() {
  if (isAsmrPlaying) {
    stopASMR();
  } else {
    startASMR();
  }
}

function startASMR() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    asmrAudioCtx = new AudioCtx();
    asmrGainNode = asmrAudioCtx.createGain();
    asmrGainNode.gain.setValueAtTime(0.15, asmrAudioCtx.currentTime);

    const bufferSize = asmrAudioCtx.sampleRate * 2;
    const noiseBuffer = asmrAudioCtx.createBuffer(1, bufferSize, asmrAudioCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);

    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < bufferSize; i++) {
      let white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      output[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      output[i] *= 0.08;
      b6 = white * 0.115926;
    }

    const whiteNoise = asmrAudioCtx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;
    whiteNoise.connect(asmrGainNode);
    asmrGainNode.connect(asmrAudioCtx.destination);
    whiteNoise.start();

    isAsmrPlaying = true;
    const btnToggle = document.getElementById('btn-toggle-asmr');
    btnToggle.innerHTML = '<i class="fa-solid fa-pause"></i> 정지';
    btnToggle.classList.add('btn-primary');
    logSystem('🎵 백색소음(ASMR 빗소리) 재생 시작');
  } catch (e) {
    console.error('Audio Context Error:', e);
  }
}

function stopASMR() {
  if (asmrAudioCtx) {
    asmrAudioCtx.close();
    asmrAudioCtx = null;
  }
  isAsmrPlaying = false;
  const btnToggle = document.getElementById('btn-toggle-asmr');
  if (btnToggle) {
    btnToggle.innerHTML = '<i class="fa-solid fa-play"></i> 재생';
    btnToggle.classList.remove('btn-primary');
  }
  logSystem('백색소음 정지');
}

function toggleFocusTimer() {
  const btnTimer = document.getElementById('btn-start-timer');
  if (focusTimerInterval) {
    clearInterval(focusTimerInterval);
    focusTimerInterval = null;
    btnTimer.innerText = '시작';
  } else {
    btnTimer.innerText = '정지';
    focusTimerInterval = setInterval(() => {
      focusTimeRemaining--;
      const mins = Math.floor(focusTimeRemaining / 60).toString().padStart(2, '0');
      const secs = (focusTimeRemaining % 60).toString().padStart(2, '0');
      document.getElementById('focus-timer-display').innerText = `${mins}:${secs}`;

      if (focusTimeRemaining <= 0) {
        clearInterval(focusTimerInterval);
        focusTimerInterval = null;
        alert('🎉 25분 집중 시간이 완료되었습니다!');
      }
    }, 1000);
  }
}

// ==========================================================================
// 6. TODO TASK MANAGER & GOOGLE CALENDAR INTEGRATION
// ==========================================================================
function initTodoList() {
  const saved = localStorage.getItem(TODO_STORAGE_KEY);
  if (saved) {
    try { todoItems = JSON.parse(saved); } catch (e) { todoItems = []; }
  } else {
    todoItems = [
      { id: 1, text: '스마트홈 온습도 체크', completed: true },
      { id: 2, text: '수면 코골이 분석 모니터링', completed: false }
    ];
  }

  document.getElementById('btn-add-todo').addEventListener('click', addTodo);
  document.getElementById('todo-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addTodo();
  });

  renderTodoList();
}

function addTodo() {
  const input = document.getElementById('todo-input');
  const text = input.value.trim();
  if (!text) return;

  todoItems.push({ id: Date.now(), text: text, completed: false });
  input.value = '';
  saveAndRenderTodo();
}

function toggleTodo(id) {
  todoItems = todoItems.map(item => item.id === id ? { ...item, completed: !item.completed } : item);
  saveAndRenderTodo();
}

function deleteTodo(id) {
  todoItems = todoItems.filter(item => item.id !== id);
  saveAndRenderTodo();
}

function saveAndRenderTodo() {
  localStorage.setItem(TODO_STORAGE_KEY, JSON.stringify(todoItems));
  renderTodoList();
}

function renderTodoList() {
  const container = document.getElementById('todo-list');
  const countBadge = document.getElementById('task-count-badge');
  container.innerHTML = '';

  const activeCount = todoItems.filter(i => !i.completed).length;
  if (countBadge) countBadge.innerText = `${activeCount}개 남음`;

  todoItems.forEach(item => {
    const div = document.createElement('div');
    div.className = `todo-item ${item.completed ? 'completed' : ''}`;
    const safeText = item.text.replace(/'/g, "\\'");

    div.innerHTML = `
      <div class="todo-left">
        <div class="todo-checkbox" onclick="toggleTodo(${item.id})">
          ${item.completed ? '<i class="fa-solid fa-check" style="color:#fff; font-size:10px;"></i>' : ''}
        </div>
        <span class="todo-text">${item.text}</span>
      </div>
      <div class="todo-right-btns">
        <button class="todo-apple-btn" onclick="exportSingleGCal('${safeText}')" title="구글 캘린더에 등록">
          <i class="fa-brands fa-google" style="color:#4285F4;"></i>
        </button>
        <button class="todo-del-btn" onclick="deleteTodo(${item.id})" title="일정 삭제">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
    `;
    container.appendChild(div);
  });
}

window.toggleTodo = toggleTodo;
window.deleteTodo = deleteTodo;

// ==========================================================================
// 7. GOOGLE CALENDAR INTEGRATION FUNCTIONS
// ==========================================================================
function initCalendarIntegration() {
  const btnGCalAll = document.getElementById('btn-export-all-gcal');
  if (btnGCalAll) btnGCalAll.addEventListener('click', exportAllToGoogleCalendar);
}

function exportSingleGCal(itemText) {
  const now = new Date();
  const startStr = now.toISOString().replace(/-|:|\.\d+/g, '').slice(0, 15) + 'Z';
  const end = new Date(now.getTime() + 60 * 60 * 1000);
  const endStr = end.toISOString().replace(/-|:|\.\d+/g, '').slice(0, 15) + 'Z';

  const title = encodeURIComponent(`JINJIN 스마트홈 - ${itemText}`);
  const details = encodeURIComponent(`JINJIN Smart Home 대시보드에서 등록한 일정입니다.`);
  const gcalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&details=${details}&dates=${startStr}/${endStr}`;

  window.open(gcalUrl, '_blank');
  logSystem(`📅 [Google Calendar] "${itemText}" 구글 캘린더 등록 페이지를 엽니다.`);
}

function exportAllToGoogleCalendar() {
  const pendingTodos = todoItems.filter(i => !i.completed);
  if (pendingTodos.length === 0) {
    alert('등록할 진행 중인 일정이 없습니다.');
    return;
  }
  const summaryText = pendingTodos.map(t => `• ${t.text}`).join('\n');
  const title = encodeURIComponent(`JINJIN 스마트홈 오늘 일정 (${pendingTodos.length}개)`);
  const details = encodeURIComponent(`오늘의 스마트홈 주요 일정 목록:\n\n${summaryText}`);

  const now = new Date();
  const startStr = now.toISOString().replace(/-|:|\.\d+/g, '').slice(0, 15) + 'Z';
  const end = new Date(now.getTime() + 60 * 60 * 1000);
  const endStr = end.toISOString().replace(/-|:|\.\d+/g, '').slice(0, 15) + 'Z';

  const gcalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&details=${details}&dates=${startStr}/${endStr}`;
  window.open(gcalUrl, '_blank');
  logSystem(`📅 [Google Calendar] 전체 일정(${pendingTodos.length}개) 구글 캘린더 등록 페이지 오픈.`);
}

window.exportSingleGCal = exportSingleGCal;

function initControls() {
  document.getElementById('btn-connect').addEventListener('click', connectBLE);
  document.getElementById('btn-demo').addEventListener('click', () => toggleDemoMode());

  document.getElementById('mode-sleep').addEventListener('click', () => {
    if (!checkConnectionGuard()) return;

    if (currentMode === 'sleep') {
      sendBLECommand('Q');
      finishSleepSession();
    } else {
      sendBLECommand('S');
      startSleepSession();
      setModeUI('sleep');
    }
  });

  document.getElementById('mode-wakeup').addEventListener('click', () => {
    if (!checkConnectionGuard()) return;

    if (currentMode === 'sleep') {
      sendBLECommand('Q');
      finishSleepSession();
    } else if (currentMode === 'wakeup') {
      setModeUI(null);
    } else {
      sendBLECommand('Q');
      setModeUI('wakeup');
    }
  });

  document.getElementById('mode-focus').addEventListener('click', () => {
    if (currentMode === 'focus') {
      stopASMR();
      if (focusTimerInterval) {
        clearInterval(focusTimerInterval);
        focusTimerInterval = null;
        const btnTimer = document.getElementById('btn-start-timer');
        if (btnTimer) btnTimer.innerText = '시작';
      }
      setModeUI(null);
    } else {
      setModeUI('focus');
    }
  });

  document.getElementById('toggle-rgb-led').addEventListener('change', (e) => {
    if (!checkConnectionGuard()) {
      e.target.checked = !e.target.checked;
      return;
    }
    sendBLECommand(e.target.checked ? '7' : '8');
  });

  const blindSlider = document.getElementById('slider-blind-motor');
  blindSlider.addEventListener('change', (e) => {
    if (!checkConnectionGuard()) return;
    const angle = e.target.value;
    document.getElementById('blind-angle-val').innerText = `${angle}°`;
    sendBLECommand(`M${angle}`);
  });

  document.querySelectorAll('.btn-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!checkConnectionGuard()) return;
      const angle = btn.getAttribute('data-angle');
      blindSlider.value = angle;
      document.getElementById('blind-angle-val').innerText = `${angle}°`;
      sendBLECommand(`M${angle}`);
    });
  });

  document.getElementById('btn-oled1-on').addEventListener('click', () => sendBLECommand('3'));
  document.getElementById('btn-oled1-off').addEventListener('click', () => sendBLECommand('4'));
  document.getElementById('btn-kitty-draw').addEventListener('click', () => sendBLECommand('9'));

  document.getElementById('btn-melody-bell').addEventListener('click', () => sendBLECommand('5'));
  document.getElementById('btn-melody-shark').addEventListener('click', () => sendBLECommand('6'));
  document.getElementById('btn-buzzer-scale').addEventListener('click', () => sendBLECommand('4'));

  document.getElementById('btn-read-cds').addEventListener('click', () => sendBLECommand('2'));
  document.getElementById('btn-sync-weather').addEventListener('click', () => sendBLECommand('1'));

  document.querySelectorAll('.btn-quick-cmd').forEach(btn => {
    btn.addEventListener('click', () => {
      const cmd = btn.getAttribute('data-cmd');
      sendBLECommand(cmd);
    });
  });

  document.getElementById('btn-send-custom-cmd').addEventListener('click', sendCustomCommand);
  document.getElementById('custom-cmd-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendCustomCommand();
  });

  document.getElementById('btn-clear-logs').addEventListener('click', () => {
    document.getElementById('terminal-logs').innerHTML = '';
    logSystem('로그가 초기화되었습니다.');
  });

  document.getElementById('btn-stop-alert').addEventListener('click', () => sendBLECommand('A'));
}

function setModeUI(mode) {
  currentMode = mode;
  document.querySelectorAll('.mode-card-btn').forEach(b => b.classList.remove('active'));
  const focusPanel = document.getElementById('focus-panel');

  if (mode === 'sleep') {
    document.getElementById('mode-sleep').classList.add('active');
    focusPanel.style.display = 'none';
    logSystem('💤 수면 모드 (조용한 코골이 카운팅 진행 중)');
  } else if (mode === 'wakeup') {
    document.getElementById('mode-wakeup').classList.add('active');
    focusPanel.style.display = 'none';
    logSystem('☀️ 기상 모드 전환');
  } else if (mode === 'focus') {
    document.getElementById('mode-focus').classList.add('active');
    focusPanel.style.display = 'block';
    logSystem('🧠 집중 모드 (ASMR & 뽀모도로)');
  } else {
    focusPanel.style.display = 'none';
    logSystem('⚪ 모드가 해제되었습니다 (Nothing 상태)');
  }
}

function sendCustomCommand() {
  if (!checkConnectionGuard()) return;
  const input = document.value ? input.value.trim() : '';
  if (cmd) {
    sendBLECommand(cmd);
    input.value = '';
  }
}

function dismissSnoringAlert() {
  const overlay = document.getElementById('alert-overlay');
  overlay.classList.remove('active');
  logSystem('🔔 부저 알람 종료', 'sys');
}

function logTerminal(msg, type = 'rx') {
  const logsContainer = document.getElementById('terminal-logs');
  const div = document.createElement('div');
  div.className = `log-entry log-${type}`;

  div.innerHTML = `<span>${msg}</span>`;
  logsContainer.appendChild(div);
  logsContainer.scrollTop = logsContainer.scrollHeight;
}

function logSystem(text, type = 'sys') {
  const timeStr = new Date().toLocaleTimeString();
  logTerminal(`[${timeStr}] [System]: ${text}`, type);
}

// ==========================================================================
// REAL OPENWEATHERMAP API INTEGRATION VIA VERCEL SERVERLESS FUNCTION (BUSAN)
// ==========================================================================
async function initWeather() {
  try {
    const res = await fetch('/api/weather?city=Busan');
    const data = await res.json();
    if (data && data.main) {
      const temp = Math.round(data.main.temp);
      const humi = data.main.humidity;
      const desc = data.weather && data.weather[0] ? data.weather[0].description : '온흐림';
      
      const tempEl = document.getElementById('weather-temp-val');
      const humiEl = document.getElementById('weather-humi-val');
      const sensorTempEl = document.getElementById('sensor-temp');
      const sensorHumiEl = document.getElementById('sensor-humi');
      const descEl = document.getElementById('weather-desc-val');
      
      if (tempEl) tempEl.innerText = temp;
      if (humiEl) humiEl.innerText = humi;
      if (sensorTempEl) sensorTempEl.innerText = `${temp} °C`;
      if (sensorHumiEl) sensorHumiEl.innerText = `${humi} %`;
      if (descEl) descEl.innerText = `${desc} (Busan)`;

      const iconEl = document.getElementById('weather-icon-el');
      if (iconEl && data.weather && data.weather[0]) {
        const mainState = data.weather[0].main.toLowerCase();
        if (mainState.includes('clear')) iconEl.className = 'fa-solid fa-sun';
        else if (mainState.includes('cloud')) iconEl.className = 'fa-solid fa-cloud';
        else if (mainState.includes('rain') || mainState.includes('drizzle')) iconEl.className = 'fa-solid fa-cloud-showers-heavy';
        else if (mainState.includes('thunder')) iconEl.className = 'fa-solid fa-cloud-bolt';
        else if (mainState.includes('snow')) iconEl.className = 'fa-solid fa-snowflake';
      }
      logSystem(`🌤️ [OpenWeatherMap] 부산 실시간 날씨 수신 완료 (${temp}°C, ${desc}, 습도 ${humi}%)`);
    }
  } catch (e) {
    console.log('Weather API fallback used:', e);
  }
}

// ==========================================================================
// 8. REAL GOOGLE GEMINI API AI CHATBOT INTEGRATION VIA SERVERLESS PROXY
// ==========================================================================
function initChatbot() {
  const toggleBtn = document.getElementById('btn-chatbot-toggle');
  const modal = document.getElementById('chatbot-modal');
  const closeBtn = document.getElementById('btn-chat-close');
  const sendBtn = document.getElementById('btn-send-chat');
  const chatInput = document.getElementById('chat-input');

  toggleBtn.addEventListener('click', () => modal.classList.toggle('active'));
  closeBtn.addEventListener('click', () => modal.classList.remove('active'));

  sendBtn.addEventListener('click', handleChatSubmit);
  chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleChatSubmit();
  });
}

function handleChatSubmit() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;

  appendChatBubble(text, 'user');
  input.value = '';

  executeHardwarePattern(text);
  const thinkingBubble = appendChatBubble('🤖 Gemini AI 가 생각 중...', 'bot thinking');

  fetchGeminiAIResponse(text, thinkingBubble);
}

function appendChatBubble(msg, sender) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `chat-bubble ${sender}`;
  div.innerText = msg;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function executeHardwarePattern(text) {
  const query = text.toLowerCase();

  if (query.includes('불 켜') || query.includes('조명 켜') || query.includes('전등 켜')) {
    sendBLECommand('7');
  } else if (query.includes('불 꺼') || query.includes('조명 꺼') || query.includes('전등 꺼')) {
    sendBLECommand('8');
  } else if (query.includes('수면') || query.includes('잘자') || query.includes('잠자리')) {
    if (sendBLECommand('S')) startSleepSession();
  } else if (query.includes('기상') || query.includes('일어') || query.includes('모닝')) {
    if (sendBLECommand('Q')) finishSleepSession();
  } else if (query.includes('알람') || query.includes('소리 꺼')) {
    sendBLECommand('A');
  } else if (query.includes('날씨') || query.includes('온도')) {
    sendBLECommand('1');
  } else if (query.includes('학교종') || query.includes('종소리')) {
    sendBLECommand('5');
  } else if (query.includes('상어') || query.includes('아기상어')) {
    sendBLECommand('6');
  } else if (query.includes('키티') || query.includes('고양이')) {
    sendBLECommand('9');
  } else if (query.includes('블라인드 열') || query.includes('창문 열')) {
    sendBLECommand('M180');
  } else if (query.includes('블라인드 닫') || query.includes('창문 닫')) {
    sendBLECommand('M0');
  }
}

async function fetchGeminiAIResponse(userPrompt, thinkingBubble) {
  try {
    let response = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: userPrompt })
    });

    const data = await response.json();

    if (data.candidates && data.candidates[0] && data.candidates[0].content) {
      const replyText = data.candidates[0].content.parts[0].text.trim();
      thinkingBubble.innerText = replyText;
      thinkingBubble.classList.remove('thinking');
    } else {
      fallbackChatResponse(userPrompt, thinkingBubble);
    }
  } catch (error) {
    console.error('Gemini API Fetch Error:', error);
    fallbackChatResponse(userPrompt, thinkingBubble);
  }
}

function fallbackChatResponse(userPrompt, thinkingBubble) {
  const query = userPrompt.toLowerCase();
  let botReply = '';

  if (query.includes('불 켜') || query.includes('조명 켜')) {
    botReply = '전등(RGB LED)을 밝게 켰습니다! 💡';
  } else if (query.includes('불 꺼') || query.includes('조명 꺼')) {
    botReply = '전등(RGB LED)을 껐습니다. 🌙';
  } else if (query.includes('수면')) {
    botReply = '수면 모드를 켜서 코골이 감지를 시작했습니다! 💤';
  } else if (query.includes('기상')) {
    botReply = '기상 모드로 전환했습니다! 좋은 아침이에요 ☀️';
  } else if (query.includes('날씨')) {
    const tempEl = document.getElementById('weather-temp-val');
    const temp = tempEl ? tempEl.innerText : '27';
    botReply = `현재 부산 실시간 온도는 ${temp}°C 입니다! 🌤️`;
  } else {
    botReply = `스마트홈 AI 비서입니다. "${userPrompt}" 요청을 성공적으로 처리하였습니다! ✨`;
  }

  thinkingBubble.innerText = botReply;
  thinkingBubble.classList.remove('thinking');
}
