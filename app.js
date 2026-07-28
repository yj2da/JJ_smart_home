/* ==========================================================================
   JINJIN SMART HOME DASHBOARD - JAVASCRIPT APPLICATION (app.js)
   Mobile-First Web Bluetooth (NUS), Realtime Chart.js, ASMR Web Audio, AI Chatbot
   Google Calendar Integration, OpenWeatherMap API & Cloud DB Sync (/api/todos)
   Default Theme: Light Mode (야간 모드 OFF)
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
let isASMRPlaying = false;
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
function bootApp() {
  const safeRun = (fn, name) => {
    try {
      if (typeof fn === 'function') fn();
    } catch (e) {
      console.error(`[Boot System Error] ${name}:`, e);
    }
  };

  safeRun(initTheme, 'initTheme');
  safeRun(initLanguage, 'initLanguage');
  safeRun(initTabs, 'initTabs');
  safeRun(initChart, 'initChart');
  safeRun(initTodoList, 'initTodoList');
  safeRun(initCalendarIntegration, 'initCalendarIntegration');
  safeRun(initControls, 'initControls');
  safeRun(initChatbot, 'initChatbot');
  safeRun(initWeather, 'initWeather');
  safeRun(initASMR, 'initASMR');
  safeRun(initRoutineScheduler, 'initRoutineScheduler');
  safeRun(initFocusTimer, 'initFocusTimer');

  logSystem('JINJIN 스마트홈 모바일 대시보드가 준비되었습니다.');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootApp);
} else {
  bootApp();
}

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
// 2. THEME SETTINGS & NIGHT MODE TOGGLE (Default: 야간 모드 OFF / Light Mode)
// ==========================================================================
function initTheme() {
  const toggleTheme = document.getElementById('toggle-theme-mode');
  const savedTheme = localStorage.getItem('jinjin_theme');

  if (savedTheme === 'dark') {
    applyTheme(true);
    if (toggleTheme) toggleTheme.checked = true;
  } else {
    applyTheme(false);
    if (toggleTheme) toggleTheme.checked = false;
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
    logSystem("ESP32 기기 검색 중... ('MPY ESP32')");
    updateStatusUI('connecting', '연결 시도...');

    bleDevice = await navigator.bluetooth.requestDevice({
      filters: [
        { name: 'MPY ESP32' },
        { namePrefix: 'MPY' },
        { namePrefix: 'mpy' },
        { namePrefix: 'ESP' },
        { services: [BLE_SERVICE_UUID] }
      ],
      optionalServices: [BLE_SERVICE_UUID]
    });

    bleDevice.addEventListener('gattserverdisconnected', onDisconnected);

    const deviceName = bleDevice.name || 'MPY ESP32';
    logSystem(`기기 발견: ${deviceName}. GATT 서버 연결 중...`);
    const server = await bleDevice.gatt.connect();

    logSystem('BLE NUS 서비스 수신 중...');
    const service = await server.getPrimaryService(BLE_SERVICE_UUID);

    rxCharacteristic = await service.getCharacteristic(BLE_RX_UUID);
    txCharacteristic = await service.getCharacteristic(BLE_TX_UUID);

    await txCharacteristic.startNotifications();
    txCharacteristic.addEventListener('characteristicvaluechanged', handleBLEData);

    isConnected = true;
    updateStatusUI('connected', `${deviceName} 연결됨`);
    logSystem(`🎉 기기 (${deviceName}) 연결 성공!`, 'tx');

    // ESP 연결 시 스플래시 화면 재출력 및 클라우드 DB 적용
    showSplashScreen(`⚡ ${deviceName} 연결됨! DB 적용 중...`, 1800);

    sendBLECommand('1');
    await fetchCloudDBByESPName(deviceName);
  } catch (error) {
    console.error('BLE Connection Error:', error);
    logSystem(`BLE 연결 실패: ${error.message || error}`, 'err');
    updateStatusUI('disconnected', 'MPY ESP32');
  }
}

function resetSmartHomeDefaults() {
  todoItems = [
    { id: 101, text: '스마트홈 대시보드 연결 확인하기', date: '오늘', completed: false }
  ];
  try {
    localStorage.setItem(TODO_STORAGE_KEY, JSON.stringify(todoItems));
  } catch (e) {}
  if (typeof renderTodoList === 'function') renderTodoList();

  routinesList = [
    { id: 'rt_default_1', time: '08:00', actionKey: 'WAKEUP', enabled: true }
  ];
  try {
    localStorage.setItem('jj_routines', JSON.stringify(routinesList));
  } catch (e) {}
  if (typeof renderRoutinesList === 'function') renderRoutinesList();

  logSystem('🔄 [기본 세팅 초기화] ESP 장치 연결 해제로 Todo 일정 및 루틴 목록이 기본 세팅으로 재설정되었습니다.');
}

function onDisconnected() {
  isConnected = false;
  rxCharacteristic = null;
  txCharacteristic = null;
  updateStatusUI('disconnected', 'ESP_JJ');
  logSystem('⚠️ ESP32 기기 연결이 해제되었습니다.', 'err');
  resetSmartHomeDefaults();
}

window.resetSmartHomeDefaults = resetSmartHomeDefaults;

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

function syncBlindUI(angle) {
  const blindSlider = document.getElementById('slider-blind-motor');
  const valBadge = document.getElementById('blind-angle-val');
  if (blindSlider) blindSlider.value = angle;
  if (valBadge) valBadge.innerText = `${angle}°`;
}

  if (/^\d+$/.test(msg)) {
    const cdsVal = parseInt(msg, 10);
    const cdsEl = document.getElementById('sensor-cds');
    if (cdsEl) cdsEl.innerText = cdsVal;
  }

  if (msg.includes('BLIND:') || msg.includes('M:')) {
    const match = msg.match(/(?:BLIND:|M:)(\d+)/i);
    if (match) {
      syncBlindUI(match[1]);
    }
  }

  if (msg.includes('MODE:SLEEP') || msg.includes('Snore Monitor Started')) {
    setModeUI('sleep');
  }

  if (msg.includes('MODE:WAKEUP') || msg.includes('Snore Monitor OFF') || msg.includes('AUTO_WAKEUP_TRIGGERED')) {
    if (currentMode === 'sleep') {
      finishSleepSession();
    } else {
      setModeUI('wakeup');
    }
    if (msg.includes('AUTO_WAKEUP_TRIGGERED')) {
      logSystem('☀️ [자동 기상 추적] ESP32 초음파 센서(3cm 미만) 감지로 기상 모드가 자동 실행되었습니다!');
    }
  }

  if (msg.includes('MODE:FOCUS')) {
    setModeUI('focus');
    focusSelectedMinutes = 5;
    focusTimeRemaining = 5 * 60;
    document.querySelectorAll('.btn-preset-min').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-min') === '5');
    });
    updateTimerDisplay();
    startASMR();
    if (!focusTimerInterval) {
      toggleFocusTimer();
    }
    logSystem('🧠 [Touch 3] 하드웨어 집중 모드 시작 (5분 타이머 & 백색소음 자동 실행)');
  }

  if (msg.includes('MODE:OFF')) {
    setModeUI(null);
    stopASMR();
    if (focusTimerInterval) {
      clearInterval(focusTimerInterval);
      focusTimerInterval = null;
      const btnTimer = document.getElementById('btn-start-timer');
      if (btnTimer) {
        btnTimer.innerText = '시작';
        btnTimer.classList.add('btn-primary');
      }
      updateTimerDisplay();
    }
    logSystem('⚪ [Touch 4] 하드웨어 모든 모드 OFF (스마트홈 대기 상태)');
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

    if (btnDemo) {
      btnDemo.classList.add('btn-primary');
      btnDemo.innerHTML = currentLanguage === 'en'
        ? '<i class="fa-solid fa-bolt"></i> Demo ON'
        : '<i class="fa-solid fa-bolt"></i> 데모 On';
    }
    updateStatusUI('connected', currentLanguage === 'en' ? 'Demo Mode' : '데모 모드');
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
    if (btnDemo) {
      btnDemo.classList.remove('btn-primary');
      btnDemo.innerHTML = currentLanguage === 'en'
        ? '<i class="fa-solid fa-wand-magic-sparkles"></i> Demo'
        : '<i class="fa-solid fa-wand-magic-sparkles"></i> 데모';
    }
    if (demoInterval) clearInterval(demoInterval);
    updateStatusUI('disconnected', isConnected && bleDevice ? bleDevice.name : (currentLanguage === 'en' ? 'Disconnected' : '연결 안됨'));
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
    badge.innerText = currentLanguage === 'en'
      ? `Snores: ${sleepSessionSnoreCount}`
      : `코골이: ${sleepSessionSnoreCount}회`;
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
  let durationStr = currentLanguage === 'en' ? 'Under 1m' : '1분 미만';

  if (sleepStartTime) {
    const elapsedSeconds = Math.max(1, Math.floor((sleepEndTime - sleepStartTime) / 1000));
    if (elapsedSeconds < 60) {
      durationStr = currentLanguage === 'en' ? `${elapsedSeconds}s` : `${elapsedSeconds}초`;
    } else {
      const mins = Math.floor(elapsedSeconds / 60);
      const hours = Math.floor(mins / 60);
      durationStr = hours > 0 
        ? (currentLanguage === 'en' ? `${hours}h ${mins % 60}m` : `${hours}시간 ${mins % 60}분`)
        : (currentLanguage === 'en' ? `${mins}m` : `${mins}분`);
    }
  }

  const score = Math.max(50, Math.min(100, 100 - (sleepSessionSnoreCount * 6)));
  lastSleepScore = score;

  let gradeTitle = currentLanguage === 'en' ? '😴 Excellent Sleep' : '😴 꿀잠! 최상의 수면 상태';

  if (score >= 90) {
    gradeTitle = currentLanguage === 'en' ? '😴 Excellent Sleep' : '😴 꿀잠! 최상의 수면 상태';
  } else if (score >= 75) {
    gradeTitle = currentLanguage === 'en' ? '😌 Good Sleep' : '😌 편안하고 양호한 수면';
  } else if (score >= 60) {
    gradeTitle = currentLanguage === 'en' ? '🥱 Mild Snoring' : '🥱 주의: 약간의 코골이 감지';
  } else {
    gradeTitle = currentLanguage === 'en' ? '⚠️ Frequent Snoring' : '⚠️ 경고: 잦은 코골이 발생';
  }

  const scoreCard = document.getElementById('sleep-score-card');
  document.getElementById('card-sleep-score-num').innerText = score;
  document.getElementById('card-sleep-grade').innerText = gradeTitle;
  document.getElementById('card-sleep-snore-count').innerText = currentLanguage === 'en' ? `${sleepSessionSnoreCount}` : `${sleepSessionSnoreCount}회`;
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

let focusSelectedMinutes = 25;

function initASMR() {
  const btnToggle = document.getElementById('btn-toggle-asmr');
  const btnTimer = document.getElementById('btn-start-timer');
  const btnMinus = document.getElementById('btn-timer-minus');
  const btnPlus = document.getElementById('btn-timer-plus');

  if (btnToggle) btnToggle.addEventListener('click', toggleASMR);
  if (btnTimer) btnTimer.addEventListener('click', toggleFocusTimer);

  if (btnMinus) {
    btnMinus.addEventListener('click', () => {
      if (focusTimerInterval) return;
      focusSelectedMinutes = Math.max(5, focusSelectedMinutes - 5);
      updateTimerDisplay();
    });
  }

  if (btnPlus) {
    btnPlus.addEventListener('click', () => {
      if (focusTimerInterval) return;
      focusSelectedMinutes = Math.min(120, focusSelectedMinutes + 5);
      updateTimerDisplay();
    });
  }

  document.querySelectorAll('.btn-preset-min').forEach(btn => {
    btn.addEventListener('click', () => {
      if (focusTimerInterval) return;
      const mins = parseInt(btn.getAttribute('data-min'), 10);
      focusSelectedMinutes = mins;
      document.querySelectorAll('.btn-preset-min').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateTimerDisplay();
    });
  });
}

function updateTimerDisplay() {
  focusTimeRemaining = focusSelectedMinutes * 60;
  const mins = focusSelectedMinutes.toString().padStart(2, '0');
  const display = document.getElementById('focus-timer-display');
  if (display) display.innerText = `${mins}:00`;
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
    btnTimer.classList.add('btn-primary');
    updateTimerDisplay();
  } else {
    btnTimer.innerText = '정지';
    btnTimer.classList.remove('btn-primary');
    focusTimerInterval = setInterval(() => {
      focusTimeRemaining--;
      const mins = Math.floor(focusTimeRemaining / 60).toString().padStart(2, '0');
      const secs = (focusTimeRemaining % 60).toString().padStart(2, '0');
      const display = document.getElementById('focus-timer-display');
      if (display) display.innerText = `${mins}:${secs}`;

      if (focusTimeRemaining <= 0) {
        clearInterval(focusTimerInterval);
        focusTimerInterval = null;
        btnTimer.innerText = '시작';
        btnTimer.classList.add('btn-primary');
        updateTimerDisplay();
        sendBLECommand('5'); // 집중 타이머 알람 완료 부저 연주
        logSystem(`🎉 ${focusSelectedMinutes}분 집중 시간 완료! 피에조 부저 알람을 연주합니다.`);
        alert(`🎉 ${focusSelectedMinutes}분 집중 시간이 완료되었습니다!`);
      }
    }, 1000);
  }
}

// ==========================================================================
// 6. TODO TASK MANAGER & CLOUD DB INTEGRATION (/api/todos)
// ==========================================================================
async function initTodoList() {
  document.getElementById('btn-add-todo').addEventListener('click', addTodo);
  document.getElementById('todo-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addTodo();
  });

  try {
    const res = await fetch('/api/todos');
    const data = await res.json();
    if (data && data.success) {
      if (Array.isArray(data.todos)) {
        todoItems = data.todos;
        localStorage.setItem(TODO_STORAGE_KEY, JSON.stringify(todoItems));
      }
      if (Array.isArray(data.routines)) {
        routinesList = data.routines;
        localStorage.setItem('jj_routines', JSON.stringify(routinesList));
        if (typeof renderRoutines === 'function') renderRoutines();
      }
      const espName = data.espName || 'MPY ESP32';
      logSystem(`🗄️ [Cloud DB] Vercel DB 데이터 로드 완료 (ESP: '${espName}', 일정 ${todoItems.length}개, 루틴 ${routinesList.length}개)`);
      renderTodoList();
      return;
    }
  } catch (e) {
    console.log('Cloud DB Fetch Fallback to LocalStorage:', e);
  }

  const saved = localStorage.getItem(TODO_STORAGE_KEY);
  if (saved) {
    try { todoItems = JSON.parse(saved); } catch (e) { todoItems = []; }
  } else {
    todoItems = [
      { id: 1, text: '스마트홈 온습도 체크', completed: true },
      { id: 2, text: '수면 코골이 분석 모니터링', completed: false }
    ];
  }

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

async function fetchCloudDBByESPName(espName) {
  const targetName = espName || (bleDevice && bleDevice.name) || 'MPY ESP32';
  try {
    logSystem(`☁️ [DB 조회] ESP 장치 ('${targetName}') 전용 데이터베이스 조회 중...`);
    const res = await fetch(`/api/todos?espName=${encodeURIComponent(targetName)}`);
    const data = await res.json();

    if (data && data.success) {
      if (Array.isArray(data.todos) && data.todos.length > 0) {
        todoItems = data.todos;
        try {
          localStorage.setItem(TODO_STORAGE_KEY, JSON.stringify(todoItems));
        } catch(e) {}
        if (typeof renderTodoList === 'function') renderTodoList();
      }

      if (Array.isArray(data.routines) && data.routines.length > 0) {
        routinesList = data.routines;
        try {
          localStorage.setItem('jj_routines', JSON.stringify(routinesList));
        } catch(e) {}
        if (typeof renderRoutinesList === 'function') renderRoutinesList();
      }

      logSystem(`☁️ [DB 로드 완료] ESP 장치('${targetName}')의 일정(${todoItems.length}개) 및 루틴(${routinesList.length}개) 데이터를 로드했습니다!`);
    }
  } catch (err) {
    console.error('fetchCloudDBByESPName Error:', err);
    logSystem(`☁️ [DB 조회 실패] 클라우드 동기화 실패: ${err.message}`, 'err');
  }
}

async function syncFullSmartHomeCloudDB() {
  const currentEspName = (bleDevice && bleDevice.name) ? bleDevice.name : 'MPY ESP32';
  try {
    const payload = {
      todos: todoItems,
      routines: routinesList,
      espName: currentEspName
    };
    await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    logSystem(`☁️ [Cloud DB] Vercel DB 동기화 완료 (ESP: '${currentEspName}', 할 일 ${todoItems.length}개, 루틴 ${routinesList.length}개)`);
  } catch (e) {
    console.error('Full Cloud DB Sync Error:', e);
  }
}

async function saveAndRenderTodo() {
  localStorage.setItem(TODO_STORAGE_KEY, JSON.stringify(todoItems));
  renderTodoList();

  const oledTodoBtn = document.querySelector('.btn-oled-setting[data-mode="todo"]');
  if (oledTodoBtn && oledTodoBtn.classList.contains('active')) {
    sendTodoToOLED();
  }

  await syncFullSmartHomeCloudDB();
}

function renderTodoList() {
  const container = document.getElementById('todo-list');
  const countBadge = document.getElementById('task-count-badge');
  container.innerHTML = '';

  const activeCount = todoItems.filter(i => !i.completed).length;
  if (countBadge) {
    countBadge.innerText = currentLanguage === 'en'
      ? `${activeCount} remaining`
      : `${activeCount}개 남음`;
  }

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
  const btnConnect = document.getElementById('btn-connect');
  if (btnConnect) btnConnect.addEventListener('click', connectBLE);

  const btnDemo = document.getElementById('btn-demo');
  if (btnDemo) btnDemo.addEventListener('click', () => toggleDemoMode());

  const modeSleep = document.getElementById('mode-sleep');
  if (modeSleep) {
    modeSleep.addEventListener('click', () => {
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
  }

  const modeWakeup = document.getElementById('mode-wakeup');
  if (modeWakeup) {
    modeWakeup.addEventListener('click', () => {
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
  }

  const modeFocus = document.getElementById('mode-focus');
  if (modeFocus) {
    modeFocus.addEventListener('click', () => {
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
  }

  const toggleRgbLed = document.getElementById('toggle-rgb-led');
  if (toggleRgbLed) {
    toggleRgbLed.addEventListener('change', (e) => {
      if (!checkConnectionGuard()) {
        e.target.checked = !e.target.checked;
        return;
      }
      sendBLECommand(e.target.checked ? '7' : '8');
    });
  }

  // RGB Color Picker & Mood Buttons Event Listeners
  const colorPicker = document.getElementById('rgb-color-picker');
  if (colorPicker) {
    colorPicker.addEventListener('input', (e) => applyRGBColor(e.target.value));
    colorPicker.addEventListener('change', (e) => applyRGBColor(e.target.value));
  }

  document.querySelectorAll('.btn-color-mood').forEach(btn => {
    btn.addEventListener('click', () => {
      const color = btn.getAttribute('data-color');
      if (colorPicker) colorPicker.value = color;
      applyRGBColor(color);
      document.querySelectorAll('.btn-color-mood').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  const blindSlider = document.getElementById('slider-blind-motor');
  if (blindSlider) {
    blindSlider.addEventListener('change', (e) => {
      if (!checkConnectionGuard()) return;
      const angle = e.target.value;
      const valBadge = document.getElementById('blind-angle-val');
      if (valBadge) valBadge.innerText = `${angle}°`;
      sendBLECommand(`M${angle}`);
    });
  }

  document.querySelectorAll('.btn-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!checkConnectionGuard()) return;
      const angle = btn.getAttribute('data-angle');
      if (blindSlider) blindSlider.value = angle;
      const valBadge = document.getElementById('blind-angle-val');
      if (valBadge) valBadge.innerText = `${angle}°`;
      sendBLECommand(`M${angle}`);
    });
  });

  // 어두우면 블라인드 자동 열기 토글
  const toggleAutoBlind = document.getElementById('toggle-auto-blind');
  if (toggleAutoBlind) {
    toggleAutoBlind.addEventListener('change', (e) => {
      const isChecked = e.target.checked;
      sendBLECommand(isChecked ? 'B_AUTO:1' : 'B_AUTO:0');
      logSystem(`🪟 [스마트 블라인드] 어두우면 자동 열기 ${isChecked ? 'ON (활성화)' : 'OFF (비활성화)'}`);
    });
  }

  // 초음파 센서 3cm 미만 자동 기상 추적 토글
  const toggleAutoWakeup = document.getElementById('toggle-auto-wakeup');
  if (toggleAutoWakeup) {
    toggleAutoWakeup.addEventListener('change', (e) => {
      const isChecked = e.target.checked;
      sendBLECommand(isChecked ? 'W_AUTO:1' : 'W_AUTO:0');
      const badge = document.getElementById('auto-wakeup-status-badge');
      if (badge) {
        badge.innerText = isChecked ? '자동 추적 ON' : '자동 추적 OFF';
        badge.style.color = isChecked ? 'var(--accent-emerald)' : 'var(--text-muted)';
      }
      logSystem(`☀️ [자동 기상 추적] 초음파 센서(3cm 미만) 기상모드 자동 켜기가 ${isChecked ? 'ON (활성화)' : 'OFF (비활성화)'} 되었습니다.`);
    });
  }

  const toggleHumiAlert = document.getElementById('toggle-humi-alert');
  const sliderHumiThreshold = document.getElementById('slider-humi-threshold');
  const humiThresholdVal = document.getElementById('humi-threshold-val');

  if (sliderHumiThreshold) {
    sliderHumiThreshold.addEventListener('input', (e) => {
      if (humiThresholdVal) {
        humiThresholdVal.innerText = currentLanguage === 'en' ? `${e.target.value}% or higher` : `${e.target.value}% 이상`;
      }
    });
    sliderHumiThreshold.addEventListener('change', (e) => {
      sendBLECommand(`H_TH:${e.target.value}`);
      logSystem(`🌧️ [습도 경보] 작동 기준이 ${e.target.value}% 로 설정되었습니다.`);
    });
  }

  if (toggleHumiAlert) {
    toggleHumiAlert.addEventListener('change', (e) => {
      const isChecked = e.target.checked;
      sendBLECommand(isChecked ? 'H_ALERT:1' : 'H_ALERT:0');
      logSystem(`🌧️ [습도 경보] 고습도 안내 경보가 ${isChecked ? 'ON (활성화)' : 'OFF (비활성화)'} 되었습니다.`);
    });
  }

  // 스마트 디스플레이 세팅
  document.querySelectorAll('.btn-oled-setting').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-mode');
      document.querySelectorAll('.btn-oled-setting').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const badge = document.getElementById('oled-mode-badge');
      const wordPanel = document.getElementById('word-card-panel');
      let modeText = currentLanguage === 'en' ? 'Weather / Air' : '날씨/미세먼지';
      let cmd = 'O1';

      if (mode === 'word') {
        modeText = currentLanguage === 'en' ? 'Daily Word Card' : '오늘의 영단어';
        cmd = 'O2';
        if (wordPanel) wordPanel.style.display = 'block';
        updateRandomWord();
      } else if (mode === 'todo') {
        modeText = currentLanguage === 'en' ? 'Today\'s Tasks' : '할 일/D-Day';
        cmd = 'O3';
        if (wordPanel) wordPanel.style.display = 'none';
        sendTodoToOLED();
      } else {
        if (wordPanel) wordPanel.style.display = 'none';
      }

      if (badge) badge.innerText = modeText;
      sendBLECommand(cmd);
      logSystem(`🖥️ [스마트 디스플레이] 화면 모드가 '${modeText}'(으)로 변경되었습니다.`);
    });
  });

  const btnRefreshWord = document.getElementById('btn-refresh-word');
  if (btnRefreshWord) {
    btnRefreshWord.addEventListener('click', () => updateRandomWord());
  }

  const btnOledPowerOn = document.getElementById('btn-oled-power-on');
  if (btnOledPowerOn) {
    btnOledPowerOn.addEventListener('click', () => {
      sendBLECommand('3');
      logSystem('📺 [OLED 전원] 화면 전원을 켰습니다. (OLED ON)');
    });
  }

  const btnOledPowerOff = document.getElementById('btn-oled-power-off');
  if (btnOledPowerOff) {
    btnOledPowerOff.addEventListener('click', () => {
      sendBLECommand('4');
      logSystem('📺 [OLED 전원] 화면 전원을 껐습니다. (OLED OFF)');
    });
  }

  const btnReadCds = document.getElementById('btn-read-cds');
  if (btnReadCds) btnReadCds.addEventListener('click', () => sendBLECommand('2'));

  const btnSyncWeather = document.getElementById('btn-sync-weather');
  if (btnSyncWeather) btnSyncWeather.addEventListener('click', () => sendBLECommand('1'));

  document.querySelectorAll('.btn-quick-cmd').forEach(btn => {
    btn.addEventListener('click', () => {
      const cmd = btn.getAttribute('data-cmd');
      sendBLECommand(cmd);
    });
  });

  const btnSendCustomCmd = document.getElementById('btn-send-custom-cmd');
  if (btnSendCustomCmd) btnSendCustomCmd.addEventListener('click', sendCustomCommand);

  const customCmdInput = document.getElementById('custom-cmd-input');
  if (customCmdInput) {
    customCmdInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendCustomCommand();
    });
  }

  const btnClearLogs = document.getElementById('btn-clear-logs');
  if (btnClearLogs) {
    btnClearLogs.addEventListener('click', () => {
      const logsEl = document.getElementById('terminal-logs');
      if (logsEl) logsEl.innerHTML = '';
      logSystem('로그가 초기화되었습니다.');
    });
  }

  const btnStopAlert = document.getElementById('btn-stop-alert');
  if (btnStopAlert) btnStopAlert.addEventListener('click', () => sendBLECommand('A'));
}

const ENGLISH_WORDS_DB = [
  { en: 'SERENDIPITY', kr: '뜻밖의 행운', ex: 'Finding joy in unexpected moments.' },
  { en: 'PERSISTENCE', kr: '끈기있는 노력', ex: 'Key to achieving all great goals.' },
  { en: 'RESILIENCE', kr: '회복탄력성', ex: 'Bounce back stronger than ever.' },
  { en: 'INSPIRATION', kr: '창의적 영감', ex: 'Fresh ideas fill your day.' },
  { en: 'CREATIVITY', kr: '독창적 창의성', ex: 'Think differently every single day.' },
  { en: 'PROSPERITY', kr: '풍요로운 번영', ex: 'Wishing you success and joy.' },
  { en: 'PASSIONATE', kr: '뜨거운 열정', ex: 'Follow what makes your heart beat.' },
  { en: 'HARMONY', kr: '조화와 편안함', ex: 'Peaceful smart home environment.' },
  { en: 'BRILLIANT', kr: '눈부신 훌륭함', ex: 'You have a brilliant future.' },
  { en: 'GRATITUDE', kr: '감사하는 마음', ex: 'Be thankful for today.' },
  { en: 'MOTIVATION', kr: '동기부여 자극', ex: 'Start where you are, use what you have.' },
  { en: 'EXCELLENCE', kr: '탁월한 습관', ex: 'Excellence is a habit, not an act.' }
];

function updateRandomWord() {
  const item = ENGLISH_WORDS_DB[Math.floor(Math.random() * ENGLISH_WORDS_DB.length)];
  const elEn = document.getElementById('word-card-en');
  const elKr = document.getElementById('word-card-kr');
  const elEx = document.getElementById('word-card-ex');

  if (elEn) elEn.innerText = item.en;
  if (elKr) elKr.innerText = item.kr;
  if (elEx) elEx.innerText = `"${item.ex}"`;

  sendBLECommand(`W:${item.en}|${item.kr}|${item.ex}`);
  logSystem(`📚 [오늘의 영단어] '${item.en}' (${item.kr}) / 문장: "${item.ex}"`);
}

function sendTodoToOLED() {
  const today = new Date();
  const dateStr = `${today.getFullYear()}.${(today.getMonth() + 1).toString().padStart(2, '0')}.${today.getDate().toString().padStart(2, '0')}`;
  const pending = todoItems.filter(t => !t.completed);
  let todoText = "NONE";
  if (pending.length > 0) {
    const asciiOnly = pending[0].text.replace(/[^\x00-\x7F]/g, "").trim();
    if (asciiOnly.length >= 2) {
      todoText = asciiOnly;
    } else {
      todoText = `${pending.length} Tasks Pending`;
    }
  }
  sendBLECommand(`T:${dateStr}|${todoText}`);
  logSystem(`📅 [오늘의 할 일] 날짜: ${dateStr}, OLED 표시: ${todoText === 'NONE' ? 'Today Fighting!' : todoText}`);
}

let wakeupTimeout = null;

function setModeUI(mode) {
  currentMode = mode;
  document.querySelectorAll('.mode-card-btn').forEach(b => b.classList.remove('active'));
  const focusPanel = document.getElementById('focus-panel');

  if (wakeupTimeout) {
    clearTimeout(wakeupTimeout);
    wakeupTimeout = null;
  }

  if (mode === 'sleep') {
    document.getElementById('mode-sleep').classList.add('active');
    focusPanel.style.display = 'none';
    syncBlindUI(90);
    logSystem('💤 수면 모드 (조용한 코골이 카운팅 진행 중 - 블라인드 90° 닫힘)');
  } else if (mode === 'wakeup') {
    document.getElementById('mode-wakeup').classList.add('active');
    focusPanel.style.display = 'none';
    syncBlindUI(180);
    logSystem('☀️ 기상 모드 전환 (블라인드 180° 개방, 5초 후 일반 모드로 자동 복귀)');

    wakeupTimeout = setTimeout(() => {
      if (currentMode === 'wakeup') {
        setModeUI(null);
        logSystem('☀️ [기상 모드] 5초 경과로 일반 모드(버튼 OFF)로 복귀했습니다.');
      }
    }, 5000);
  } else if (mode === 'focus') {
    document.getElementById('mode-focus').classList.add('active');
    focusPanel.style.display = 'block';
    logSystem('🧠 집중 모드 (ASMR & 뽀모도로)');
  } else {
    focusPanel.style.display = 'none';
    logSystem('⚪ 모드가 해제되었습니다 (Nothing 상태)');
  }
}

function applyRGBColor(hex) {
  const toggleLED = document.getElementById('toggle-rgb-led');
  if (toggleLED && !toggleLED.checked) {
    toggleLED.checked = true;
  }

  const badge = document.getElementById('led-status-badge');
  if (badge) {
    badge.innerText = 'ON';
    badge.style.color = hex;
  }

  const preview = document.getElementById('led-color-preview');
  if (preview) {
    preview.style.background = hex;
    preview.style.boxShadow = `0 0 10px ${hex}`;
  }

  const icon = document.getElementById('led-icon-el');
  if (icon) {
    icon.style.color = hex;
  }

  sendBLECommand(`C${hex}`);
  logSystem(`💡 [RGB 조명] 무드 컬러 적용 (${hex})`);
}

function sendCustomCommand() {
  if (!checkConnectionGuard()) return;
  const input = document.getElementById('custom-cmd-input');
  const cmd = input ? input.value.trim() : '';
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

let currentRawWeatherDesc = '구름조금';

function updateWeatherDescDisplay() {
  const descEl = document.getElementById('weather-desc-val');
  if (!descEl) return;

  const descMap = {
    'Clear': { en: 'Clear Sky', kr: '맑음' },
    'Clouds': { en: 'Partly Cloudy', kr: '구름조금' },
    'Few Clouds': { en: 'Few Clouds', kr: '구름조금' },
    'Scattered Clouds': { en: 'Scattered Clouds', kr: '구름조금' },
    'Broken Clouds': { en: 'Broken Clouds', kr: '구름조금' },
    'Rain': { en: 'Rainy', kr: '비' },
    'Drizzle': { en: 'Light Rain', kr: '이슬비' },
    'Thunderstorm': { en: 'Thunderstorm', kr: '뇌우' },
    'Snow': { en: 'Snowy', kr: '눈' },
    'Overcast': { en: 'Overcast', kr: '온흐림' }
  };

  let translatedDesc = currentRawWeatherDesc;
  for (const [key, obj] of Object.entries(descMap)) {
    if (currentRawWeatherDesc.toLowerCase().includes(key.toLowerCase())) {
      translatedDesc = currentLanguage === 'en' ? obj.en : obj.kr;
      break;
    }
  }

  descEl.innerText = `${translatedDesc} (Busan)`;
}

async function initWeather() {
  try {
    const res = await fetch('/api/weather?city=Busan');
    const data = await res.json();
    if (data && data.main) {
      const temp = Math.round(data.main.temp);
      const humi = data.main.humidity;
      const desc = data.weather && data.weather[0] ? data.weather[0].description : 'Clouds';
      currentRawWeatherDesc = desc;

      const tempEl = document.getElementById('weather-temp-val');
      const humiEl = document.getElementById('weather-humi-val');
      const sensorTempEl = document.getElementById('sensor-temp');
      const sensorHumiEl = document.getElementById('sensor-humi');

      if (tempEl) tempEl.innerText = temp;
      if (humiEl) humiEl.innerText = humi;
      if (sensorTempEl) sensorTempEl.innerText = `${temp} °C`;
      if (sensorHumiEl) sensorHumiEl.innerText = `${humi} %`;
      
      updateWeatherDescDisplay();

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
    updateWeatherDescDisplay();
  }
}

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

  // AI 챗봇 상단 빠른 질문/제어 칩 클릭 핸들러 (AI API 미호출 / 즉시 실행)
  document.querySelectorAll('.btn-chat-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const cmdKey = btn.getAttribute('data-chat-cmd');
      const labelText = btn.innerText.trim();
      executeQuickChatAction(cmdKey, labelText);
    });
  });
}

function executeQuickChatAction(cmdKey, userLabelText) {
  if (userLabelText) {
    appendChatBubble(userLabelText, 'user');
  }

  if (cmdKey === 'LIST') {
    const botDiv = appendChatBubble('', 'bot');
    if (currentLanguage === 'en') {
      botDiv.innerHTML = `
        <div>🤖 <strong>Smart Home Quick Command Actions</strong></div>
        <div style="font-size:0.78rem; color:var(--text-muted); margin:4px 0 8px 0;">Click any button below for instant hardware control without API calls:</div>
        <div class="chat-cmd-grid">
          <button class="btn-chat-chip" onclick="executeQuickChatAction('LIGHT_ON', '💡 Light ON')">💡 Light ON</button>
          <button class="btn-chat-chip" onclick="executeQuickChatAction('LIGHT_OFF', '🌙 Light OFF')">🌙 Light OFF</button>
          <button class="btn-chat-chip" onclick="executeQuickChatAction('SLEEP', '💤 Sleep Mode')">💤 Sleep Mode</button>
          <button class="btn-chat-chip" onclick="executeQuickChatAction('WAKEUP', '☀️ Wakeup Mode')">☀️ Wakeup Mode</button>
          <button class="btn-chat-chip" onclick="executeQuickChatAction('WEATHER', '🌤️ Weather Info')">🌤️ Weather Info</button>
          <button class="btn-chat-chip" onclick="executeQuickChatAction('BABY_SHARK', '🎵 Baby Shark')">🎵 Baby Shark</button>
          <button class="btn-chat-chip" onclick="executeQuickChatAction('OPEN_BLIND', '🪟 Open Blind')">🪟 Open Blind</button>
          <button class="btn-chat-chip" onclick="executeQuickChatAction('STOP_ALARM', '🔔 Stop Alarm')">🔔 Stop Alarm</button>
        </div>
      `;
    } else {
      botDiv.innerHTML = `
        <div>🤖 <strong>스마트홈 빠른 제어 명령어 모음</strong></div>
        <div style="font-size:0.78rem; color:var(--text-muted); margin:4px 0 8px 0;">원하시는 명령 버튼을 누르면 AI API 없이 즉시 실행됩니다:</div>
        <div class="chat-cmd-grid">
          <button class="btn-chat-chip" onclick="executeQuickChatAction('LIGHT_ON', '💡 조명 켜기')">💡 조명 켜기</button>
          <button class="btn-chat-chip" onclick="executeQuickChatAction('LIGHT_OFF', '🌙 조명 끄기')">🌙 조명 끄기</button>
          <button class="btn-chat-chip" onclick="executeQuickChatAction('SLEEP', '💤 수면 모드')">💤 수면 모드</button>
          <button class="btn-chat-chip" onclick="executeQuickChatAction('WAKEUP', '☀️ 기상 모드')">☀️ 기상 모드</button>
          <button class="btn-chat-chip" onclick="executeQuickChatAction('WEATHER', '🌤️ 날씨 보기')">🌤️ 날씨 보기</button>
          <button class="btn-chat-chip" onclick="executeQuickChatAction('BABY_SHARK', '🎵 아기상어')">🎵 아기상어</button>
          <button class="btn-chat-chip" onclick="executeQuickChatAction('OPEN_BLIND', '🪟 창문 열기')">🪟 창문 열기</button>
          <button class="btn-chat-chip" onclick="executeQuickChatAction('STOP_ALARM', '🔔 알람 끄기')">🔔 알람 끄기</button>
        </div>
      `;
    }
    return;
  }

  let botReply = '';
  if (cmdKey === 'LIGHT_ON') {
    sendBLECommand('7');
    botReply = currentLanguage === 'en' ? 'Main light (RGB LED) turned ON! 💡' : '전등(RGB LED)을 켰습니다! 💡';
  } else if (cmdKey === 'LIGHT_OFF') {
    sendBLECommand('8');
    botReply = currentLanguage === 'en' ? 'Main light (RGB LED) turned OFF. 🌙' : '전등(RGB LED)을 껐습니다. 🌙';
  } else if (cmdKey === 'SLEEP') {
    sendBLECommand('S');
    startSleepSession();
    botReply = currentLanguage === 'en' ? 'Sleep mode activated. Snore monitoring started! 💤' : '수면 모드를 켜서 코골이 감지를 시작했습니다! 💤';
  } else if (cmdKey === 'WAKEUP') {
    sendBLECommand('Q');
    finishSleepSession();
    botReply = currentLanguage === 'en' ? 'Switched to Wakeup mode! Good morning ☀️' : '기상 모드로 전환했습니다! 좋은 아침이에요 ☀️';
  } else if (cmdKey === 'WEATHER') {
    sendBLECommand('1');
    const tempEl = document.getElementById('weather-temp-val');
    const temp = tempEl ? tempEl.innerText : '27';
    botReply = currentLanguage === 'en' ? `Sent Busan weather info to OLED display! (${temp}°C) 🌤️` : `부산 실시간 날씨 정보를 OLED 화면에 전송했습니다! (현재 ${temp}°C) 🌤️`;
  } else if (cmdKey === 'BABY_SHARK') {
    sendBLECommand('6');
    botReply = currentLanguage === 'en' ? 'Playing Baby Shark melody on piezo buzzer! 🦈🎵' : '피에조 부저로 아기상어 멜로디를 연주합니다! 🦈🎵';
  } else if (cmdKey === 'OLED_ON') {
    sendBLECommand('3');
    botReply = currentLanguage === 'en' ? 'OLED display powered ON! 📺' : 'OLED 디스플레이 전원을 켰습니다! 📺';
  } else if (cmdKey === 'OLED_OFF') {
    sendBLECommand('4');
    botReply = currentLanguage === 'en' ? 'OLED display powered OFF. 📺' : 'OLED 디스플레이 전원을 껐습니다. 📺';
  } else if (cmdKey === 'OPEN_BLIND') {
    sendBLECommand('M180');
    botReply = currentLanguage === 'en' ? 'Opened window blind to 180°! 🪟' : '스마트 창문 블라인드를 180° 열었습니다! 🪟';
  } else if (cmdKey === 'CLOSE_BLIND') {
    sendBLECommand('M90');
    botReply = currentLanguage === 'en' ? 'Closed window blind to 90°! 🪟' : '스마트 창문 블라인드를 90° 닫았습니다! 🪟';
  } else if (cmdKey === 'STOP_ALARM') {
    sendBLECommand('A');
    botReply = currentLanguage === 'en' ? 'Buzzer alarm turned OFF! 🔔' : '부저 알람 및 경보를 종료했습니다! 🔔';
  } else {
    botReply = currentLanguage === 'en' ? `Successfully executed command '${cmdKey}'! ✨` : `명령어 '${cmdKey}'를 성공적으로 실행했습니다! ✨`;
  }

  appendChatBubble(botReply, 'bot');
}
window.executeQuickChatAction = executeQuickChatAction;

function handleChatSubmit() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;

  const query = text.toLowerCase();
  input.value = '';

  if (query.includes('명령어') || query.includes('목록') || query.includes('도움말') || query.includes('기능') || query.includes('list') || query.includes('help') || query.includes('command')) {
    executeQuickChatAction('LIST', text);
    return;
  }

  if (query.includes('불 켜') || query.includes('조명 켜') || query.includes('전등 켜') || query.includes('light on') || query.includes('turn on light')) {
    executeQuickChatAction('LIGHT_ON', text);
    return;
  } else if (query.includes('불 꺼') || query.includes('조명 꺼') || query.includes('전등 꺼') || query.includes('light off') || query.includes('turn off light')) {
    executeQuickChatAction('LIGHT_OFF', text);
    return;
  } else if (query.includes('수면') || query.includes('잘자') || query.includes('잠자리') || query.includes('sleep')) {
    executeQuickChatAction('SLEEP', text);
    return;
  } else if (query.includes('기상') || query.includes('일어') || query.includes('모닝') || query.includes('wakeup') || query.includes('wake up')) {
    executeQuickChatAction('WAKEUP', text);
    return;
  } else if (query.includes('알람 끄') || query.includes('소리 끄') || query.includes('알람 꺼') || query.includes('stop alarm') || query.includes('alarm off')) {
    executeQuickChatAction('STOP_ALARM', text);
    return;
  } else if (query.includes('날씨') || query.includes('weather')) {
    executeQuickChatAction('WEATHER', text);
    return;
  } else if (query.includes('상어') || query.includes('아기상어') || query.includes('baby shark') || query.includes('shark')) {
    executeQuickChatAction('BABY_SHARK', text);
    return;
  } else if (query.includes('화면 켜') || query.includes('디스플레이 켜') || query.includes('oled 켜') || query.includes('screen on') || query.includes('oled on')) {
    executeQuickChatAction('OLED_ON', text);
    return;
  } else if (query.includes('화면 꺼') || query.includes('디스플레이 꺼') || query.includes('oled 꺼') || query.includes('screen off') || query.includes('oled off')) {
    executeQuickChatAction('OLED_OFF', text);
    return;
  } else if (query.includes('창문 열') || query.includes('블라인드 열') || query.includes('open blind')) {
    executeQuickChatAction('OPEN_BLIND', text);
    return;
  } else if (query.includes('창문 닫') || query.includes('블라인드 닫') || query.includes('close blind')) {
    executeQuickChatAction('CLOSE_BLIND', text);
    return;
  }

  // 3. 그 외 일반 대화 질문인 경우만 Gemini AI API 호출
  appendChatBubble(text, 'user');
  const thinkingBubble = appendChatBubble('🤖 Gemini AI 가 생각 중...', 'bot thinking');
  fetchGeminiAIResponse(text, thinkingBubble);
}

function appendChatBubble(msg, sender) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `chat-bubble ${sender}`;
  if (msg) div.innerText = msg;
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
    sendBLECommand('M90');
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

// ==========================================================================
// 스마트홈 루틴 세팅기 (Routine Scheduler Engine)
// ==========================================================================
const ROUTINE_LABELS = {
  'WAKEUP': '☀️ 기상 모드 ON',
  'SLEEP': '💤 수면 모드 ON',
  'LIGHT_ON': '💡 조명 켜기',
  'LIGHT_OFF': '🌙 조명 끄기',
  'OPEN_BLIND': '🪟 블라인드 열기 (180°)',
  'CLOSE_BLIND': '🪟 블라인드 닫기 (90°)',
  'OLED_ON': '📺 OLED 화면 켜기',
  'OLED_OFF': '📺 OLED 화면 끄기',
  'BABY_SHARK': '🦈 아기상어 노래'
};

const ROUTINE_LABELS_EN = {
  'WAKEUP': '☀️ Wakeup Mode ON',
  'SLEEP': '💤 Sleep Mode ON',
  'LIGHT_ON': '💡 Turn Light ON',
  'LIGHT_OFF': '🌙 Turn Light OFF',
  'OPEN_BLIND': '🪟 Open Blind (180°)',
  'CLOSE_BLIND': '🪟 Close Blind (90°)',
  'OLED_ON': '📺 OLED Screen ON',
  'OLED_OFF': '📺 OLED Screen OFF',
  'BABY_SHARK': '🦈 Baby Shark Melody'
};

let routinesList = [];
let lastTriggeredMinutes = '';

function initRoutineScheduler() {
  loadRoutines();

  const btnAdd = document.getElementById('btn-add-routine');
  if (btnAdd) {
    btnAdd.addEventListener('click', addRoutine);
  }

  // 10초 주기 루틴 시간 자동 체크 엔진 실행
  setInterval(checkRoutinesTimerEngine, 10000);
}

function loadRoutines() {
  const saved = localStorage.getItem('jj_routines');
  if (saved) {
    try {
      routinesList = JSON.parse(saved);
    } catch (e) {
      routinesList = getDefaultRoutines();
    }
  } else {
    routinesList = getDefaultRoutines();
  }
  renderRoutines();
}

function getDefaultRoutines() {
  return [
    { id: 'default_1', time: '08:00', actionKey: 'WAKEUP', enabled: true }
  ];
}

function saveRoutines() {
  localStorage.setItem('jj_routines', JSON.stringify(routinesList));
  renderRoutines();
  syncFullSmartHomeCloudDB();
}

function renderRoutines() {
  const container = document.getElementById('routine-list-container');
  const badge = document.getElementById('routine-count-badge');
  if (!container) return;

  const activeCount = routinesList.filter(r => r.enabled).length;
  if (badge) {
    badge.innerText = currentLanguage === 'en' ? `${activeCount} Active` : `${activeCount}개 활성화됨`;
  }

  if (routinesList.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding:16px; color:var(--text-muted); font-size:0.8rem; font-weight:600;">${currentLanguage === 'en' ? 'No routines added yet.<br>Select time and action above to add!' : '등록된 스마트홈 루틴이 없습니다.<br>위에서 시각과 기능을 선택 후 [+ 루틴 추가]를 눌러보세요!'}</div>`;
    return;
  }

  const labelsMap = currentLanguage === 'en' ? ROUTINE_LABELS_EN : ROUTINE_LABELS;
  container.innerHTML = routinesList.map(r => {
    const label = labelsMap[r.actionKey] || ROUTINE_LABELS[r.actionKey] || r.actionKey;
    return `
      <div class="routine-item">
        <div style="display:flex; align-items:center; gap:12px;">
          <span class="routine-time-badge">${r.time}</span>
          <span style="font-size:0.88rem; font-weight:700; color:var(--text-main);">${label}</span>
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          <label class="toggle-switch" style="transform:scale(0.85); margin:0;">
            <input type="checkbox" onchange="toggleRoutine('${r.id}', this.checked)" ${r.enabled ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
          <button onclick="deleteRoutine('${r.id}')" class="btn-routine-delete" title="삭제">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function addRoutine() {
  const timeInput = document.getElementById('routine-time-input');
  const actionSelect = document.getElementById('routine-action-select');
  if (!timeInput || !actionSelect) return;

  const time = timeInput.value.trim();
  const actionKey = actionSelect.value;
  if (!time) {
    alert('시간을 선택해주세요!');
    return;
  }

  const newRoutine = {
    id: 'rt_' + Date.now(),
    time: time,
    actionKey: actionKey,
    enabled: true
  };

  routinesList.push(newRoutine);
  saveRoutines();
  const label = ROUTINE_LABELS[actionKey] || actionKey;
  logSystem(`⏰ [루틴 추가] 시각: ${time} -> ${label} (등록 완료)`);
}

function toggleRoutine(id, enabled) {
  const item = routinesList.find(r => r.id === id);
  if (item) {
    item.enabled = enabled;
    saveRoutines();
    logSystem(`⏰ [루틴 변경] ${item.time} 루틴이 ${enabled ? '활성화' : '비활성화'} 되었습니다.`);
  }
}

function deleteRoutine(id) {
  routinesList = routinesList.filter(r => r.id !== id);
  saveRoutines();
  logSystem('⏰ [루틴 삭제] 선택한 루틴이 삭제되었습니다.');
}

function playWebRoutineChime() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6 (Do-Mi-Sol-Do)
    notes.forEach((freq, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.12, audioCtx.currentTime + idx * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + idx * 0.14 + 0.35);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(audioCtx.currentTime + idx * 0.14);
      osc.stop(audioCtx.currentTime + idx * 0.14 + 0.35);
    });
  } catch(e) {
    console.error('Web Routine Chime Error:', e);
  }
}

function checkRoutinesTimerEngine() {
  const now = new Date();
  const hh = now.getHours().toString().padStart(2, '0');
  const mm = now.getMinutes().toString().padStart(2, '0');
  const currentTimeStr = `${hh}:${mm}`;

  if (lastTriggeredMinutes === currentTimeStr) return;

  routinesList.forEach(r => {
    if (r.enabled && r.time === currentTimeStr) {
      lastTriggeredMinutes = currentTimeStr;
      const label = ROUTINE_LABELS[r.actionKey] || r.actionKey;
      logSystem(`⏰ [루틴 자동 실행] 시각: ${r.time} -> ${label} (피에조 부저 멜로디 재생 🔔)`);
      
      // 1. 피에조 부저 상쾌한 멜로디 전송 (BLE Command '5') & 브라우저 알림음 연주
      sendBLECommand('5');
      playWebRoutineChime();

      // 2. 루틴 스마트홈 동작 실행 (기상모드, 조명, 블라인드 등)
      executeQuickChatAction(r.actionKey, `⏰ 루틴 실행(${r.time}): ${label}`);
    }
  });
}

window.toggleRoutine = toggleRoutine;
window.deleteRoutine = deleteRoutine;

// ==========================================================================
// 집중 모드 1분 단위 타이머 & Web Audio ASMR 빗소리 엔진
// ==========================================================================
let focusMinutes = 25;
let focusSecondsLeft = 25 * 60;
let isFocusTimerRunning = false;
let asmrAudio = null;

function initFocusTimer() {
  const btnMinus = document.getElementById('btn-timer-minus');
  const btnPlus = document.getElementById('btn-timer-plus');
  const btnStart = document.getElementById('btn-start-timer');
  const btnASMR = document.getElementById('btn-toggle-asmr');
  const presetBtns = document.querySelectorAll('.btn-preset-min');

  // 1분 감소 (-) 버튼
  if (btnMinus) {
    btnMinus.addEventListener('click', () => {
      if (isFocusTimerRunning) return;
      if (focusMinutes > 1) {
        focusMinutes--;
        focusSecondsLeft = focusMinutes * 60;
        updateFocusTimerDisplay();
        logSystem(`🧠 [집중 타이머] 1분 감소 -> ${focusMinutes}분`);
      }
    });
  }

  // 1분 증가 (+) 버튼
  if (btnPlus) {
    btnPlus.addEventListener('click', () => {
      if (isFocusTimerRunning) return;
      if (focusMinutes < 180) {
        focusMinutes++;
        focusSecondsLeft = focusMinutes * 60;
        updateFocusTimerDisplay();
        logSystem(`🧠 [집중 타이머] 1분 증가 -> ${focusMinutes}분`);
      }
    });
  }

  // 분 단위 프리셋 버튼 (5, 10, 25, 45, 60분)
  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      if (isFocusTimerRunning) return;
      const min = parseInt(btn.getAttribute('data-min'), 10);
      if (min) {
        focusMinutes = min;
        focusSecondsLeft = focusMinutes * 60;
        presetBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        updateFocusTimerDisplay();
        logSystem(`🧠 [집중 타이머] 프리셋 선택 -> ${focusMinutes}분`);
      }
    });
  });

  // 타이머 시작/일시정지 버튼
  if (btnStart) {
    btnStart.addEventListener('click', toggleFocusTimer);
  }

  // ASMR 빗소리 토글 버튼
  if (btnASMR) {
    btnASMR.addEventListener('click', toggleASMR);
  }

  updateFocusTimerDisplay();
}

function updateFocusTimerDisplay() {
  const display = document.getElementById('focus-timer-display');
  if (!display) return;
  const m = Math.floor(focusSecondsLeft / 60);
  const s = focusSecondsLeft % 60;
  display.innerText = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function toggleFocusTimer() {
  const btnStart = document.getElementById('btn-start-timer');

  if (isFocusTimerRunning) {
    // 타이머 일시정지
    clearInterval(focusTimerInterval);
    focusTimerInterval = null;
    isFocusTimerRunning = false;
    if (btnStart) btnStart.innerText = '시작';
    logSystem('🧠 [집중 타이머] 일시정지 되었습니다.');
  } else {
    // 타이머 시작
    if (focusSecondsLeft <= 0) {
      focusSecondsLeft = focusMinutes * 60;
    }
    isFocusTimerRunning = true;
    if (btnStart) btnStart.innerText = '정지';
    logSystem(`🧠 [집중 타이머] ${focusMinutes}분 카운트다운 시작!`);

    focusTimerInterval = setInterval(() => {
      focusSecondsLeft--;
      updateFocusTimerDisplay();

      if (focusSecondsLeft <= 0) {
        clearInterval(focusTimerInterval);
        focusTimerInterval = null;
        isFocusTimerRunning = false;
        if (btnStart) btnStart.innerText = '시작';
        focusSecondsLeft = focusMinutes * 60;
        updateFocusTimerDisplay();
        
        // 부저 알람 연주 (BLE 명령 '5' -> 피에조 부저 알람 멜로디 재생)
        sendBLECommand('5');
        playWebRoutineChime();
        logSystem(`🔔 [집중 타이머 완료] 설정한 ${focusMinutes}분 집중 시간이 종료되었습니다! 축하합니다! 🎉`);
        alert(`🔔 [집중 타이머 종료]\n설정한 ${focusMinutes}분 집중 시간이 완료되었습니다!`);
      }
    }, 1000);
  }
}

function toggleASMR() {
  const btnASMR = document.getElementById('btn-toggle-asmr');
  if (!asmrAudio) {
    asmrAudio = createRainSoundAudio();
  }

  if (isASMRPlaying) {
    if (asmrAudio && asmrAudio.stop) asmrAudio.stop();
    isASMRPlaying = false;
    if (btnASMR) btnASMR.innerHTML = '<i class="fa-solid fa-play"></i> 재생';
    logSystem('🎧 [ASMR 빗소리] 정지되었습니다.');
  } else {
    if (asmrAudio && asmrAudio.start) asmrAudio.start();
    isASMRPlaying = true;
    if (btnASMR) btnASMR.innerHTML = '<i class="fa-solid fa-pause"></i> 정지';
    logSystem('🎧 [ASMR 빗소리] 빗소리 백색소음 재생 시작');
  }
}

function stopASMR() {
  const btnASMR = document.getElementById('btn-toggle-asmr');
  if (isASMRPlaying && asmrAudio && asmrAudio.stop) {
    asmrAudio.stop();
    isASMRPlaying = false;
    if (btnASMR) btnASMR.innerHTML = '<i class="fa-solid fa-play"></i> 재생';
  }
}

function createRainSoundAudio() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const bufferSize = 2 * audioCtx.sampleRate;
    const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);

    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.05;
      b6 = white * 0.115926;
    }

    let whiteNoiseSource = null;

    return {
      start: () => {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        whiteNoiseSource = audioCtx.createBufferSource();
        whiteNoiseSource.buffer = noiseBuffer;
        whiteNoiseSource.loop = true;
        
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1000, audioCtx.currentTime);

        whiteNoiseSource.connect(filter);
        filter.connect(audioCtx.destination);
        whiteNoiseSource.start();
      },
      stop: () => {
        if (whiteNoiseSource) {
          try { whiteNoiseSource.stop(); } catch(e) {}
          whiteNoiseSource = null;
        }
      }
    };
  } catch(e) {
    console.error('Web Audio Synth Error:', e);
    return { start: () => {}, stop: () => {} };
  }
}

// ==========================================================================
// INTERNATIONALIZATION (i18n) LANGUAGE SYSTEM (Korean / English)
// ==========================================================================
let currentLanguage = 'kr';

const I18N_TRANSLATIONS = {
  kr: {
    appName: "JINJIN 스마트홈",
    statusConn: "연결 안됨",
    statusConnSuccess: "연결됨",
    demoBtn: "🪄 데모",
    tabToday: "오늘 하루",
    tabHomeControl: "홈 제어",
    tabSettings: "설정",

    sleepAnalysisTitle: "수면 분석 점수",
    scoreWaiting: "측정 대기",
    snoreDetectCount: "코골이 감지:",
    sleepDuration: "수면 시간:",
    sleepPromptMsg: "수면 모드를 켜서 점수를 체크하세요!",

    smartModeTitle: "스마트 모드 설정",
    modeSleepTitle: "수면 모드",
    modeSleepSub: "코골이 분석",
    modeWakeupTitle: "기상 모드",
    modeWakeupSub: "5초 오토 리셋",
    modeFocusTitle: "집중 모드",
    modeFocusSub: "뽀모도로 & ASMR",
    btnPlay: "재생",
    btnPause: "정지",

    weatherCardTitle: "부산 실시간 날씨",
    btnSyncWeather: "화면에 띄우기",
    weatherHumiLabel: "습도:",
    weatherLocLabel: "위치: 부산 (Busan)",

    todoTitle: "오늘 하루 일정",
    btnGCal: "구글 캘린더로 보내기",
    todoPlaceholder: "새 일정 입력...",
    btnAddTodo: "추가",

    chartTitle: "실시간 수면 질 차트",

    sensorCardTitle: "실시간 센서 정보",
    btnReadCds: "조도 측정",
    sensorTempTitle: "실내 온도",
    sensorHumiTitle: "실내 습도",
    sensorCdsTitle: "조도 센서",
    sensorMicTitle: "코골이 음량",

    lightingControlTitle: "스마트 조명 & 앰비언트",
    rgbLedToggleLabel: "전등 메인 스위치 (RGB LED)",
    rgbLedToggleSub: "스마트홈 메인 전등 ON / OFF",
    colorPickerLabel: "RGB 컬러 조절 픽커",
    moodPresetLabel: "무드등 원터치 프리셋",
    presetWarm: "Warm 웜톤",
    presetCool: "Cool 쿨톤",
    presetPurple: "Purple 보라",
    presetRose: "Rose 로즈",

    blindTitle: "스마트 창문 블라인드",
    autoBlindLabel: "어두우면 자동으로 열기",
    autoBlindSub: "조도 센서(CDS) 연동 180° 자동 개방",
    blindAngleLabel: "서보 모터 각도 제어",
    presetClose: "90° 닫기",
    presetHalf: "135° 반개",
    presetOpen: "180° 열기",

    humiAlertTitle: "스마트 습도 안내 경보",
    humiAlertLabel: "고습도 감지 경보",
    humiAlertSub: "습도 높을 시 스마트 조명으로 경고 점등",
    humiThresholdLabel: "경보 작동 기준 습도",

    smartOledTitle: "스마트 디스플레이 세팅",
    oledModeWeather: "실시간 미세먼지 / 날씨 정보",
    oledModeWord: "오늘의 영단어 / 암기 카드",
    oledModeTodo: "오늘의 할 일 / D-Day",
    oledPowerOn: "OLED 켜기",
    oledPowerOff: "OLED 끄기",

    routineTitle: "스마트홈 루틴 세팅기",
    addNewRoutine: "새 루틴 추가",
    timeSelectLabel: "시간 선택",
    featureSelectLabel: "스마트홈 기능",
    btnAddRoutine: "루틴 추가하기",
    autoWakeupTitle: "자동 기상 추적 기능",
    langSettingTitle: "언어 설정 (Language)",
    langOptionLabel: "앱 표시 언어 (App Language)",
    langOptionSub: "한국어 또는 English 선택",
    themeTitle: "앱 디스플레이 테마",
    darkModeLabel: "야간 모드 (Dark Mode)",
    darkModeSub: "ON: 검은색 배경 / OFF: 흰색 배경",
    deviceInfoTitle: "스마트홈 기기 정보",
    bleDeviceLabel: "BLE 디바이스:",
    protocolLabel: "통신 프로토콜:",
    creatorsLabel: "프로젝트 제작자:",
    creatorsNames: "김진아 (Jina), 오예진 (Yejin)",
    logTitle: "Web Bluetooth 로그",
    btnClearLog: "지우기",
    btnSendCmd: "전송",
    cmdInputPlaceholder: "커스텀 명령 전송...",

    asmrTitle: "ASMR 빗소리",
    focusTimerTitle: "집중 타이머",
    btnStartTimer: "시작",
    chatHeaderTitle: "JINJIN AI 도우미",
    chipList: "명령어 모음",
    chipLightOn: "조명 켜기",
    chipLightOff: "조명 끄기",
    chipSleep: "수면 모드",
    chipWakeup: "기상 모드",
    chipWeather: "실시간 날씨",
    chipBabyShark: "아기상어",
    chipOpenBlind: "창문 열기",
    chipStopAlarm: "알람 끄기",
    chatBotGreeting: "안녕하세요! 👋 스마트홈 AI 도우미입니다.<br>위 <strong>명령어 버튼</strong>을 누르면 API 호출 없이 즉시 제어되며, \"명령어 모음\"을 누르면 전체 기능 목록을 확인하실 수 있습니다!",
    chatInputPlaceholder: "메시지 입력..."
  },
  en: {
    appName: "JINJIN Smart Home",
    statusConn: "Disconnected",
    statusConnSuccess: "Connected",
    demoBtn: "🪄 Demo",
    tabToday: "Today",
    tabHomeControl: "Controls",
    tabSettings: "Settings",

    sleepAnalysisTitle: "Sleep Score Analysis",
    scoreWaiting: "Awaiting Measurement",
    snoreDetectCount: "Snore Count:",
    sleepDuration: "Sleep Duration:",
    sleepPromptMsg: "Enable Sleep Mode to check score",

    smartModeTitle: "Smart Mode Control",
    modeSleepTitle: "Sleep Mode",
    modeSleepSub: "Snore Monitor",
    modeWakeupTitle: "Wakeup Mode",
    modeWakeupSub: "5s Auto Reset",
    modeFocusTitle: "Focus Mode",
    modeFocusSub: "Pomodoro & ASMR",
    btnPlay: "Play",
    btnPause: "Pause",

    weatherCardTitle: "Busan Realtime Weather",
    btnSyncWeather: "Show on OLED",
    weatherHumiLabel: "Humidity:",
    weatherLocLabel: "Location: Busan",

    todoTitle: "Today's Tasks",
    btnGCal: "Export GCal",
    todoPlaceholder: "Enter new task...",
    btnAddTodo: "Add",

    chartTitle: "Realtime Sleep Quality Chart",

    sensorCardTitle: "Realtime Sensor Data",
    btnReadCds: "Read Light",
    sensorTempTitle: "Indoor Temp",
    sensorHumiTitle: "Indoor Humidity",
    sensorCdsTitle: "Light Sensor",
    sensorMicTitle: "Mic Volume",

    lightingControlTitle: "Smart Lighting & Ambient",
    rgbLedToggleLabel: "Main Lighting Switch (RGB LED)",
    rgbLedToggleSub: "Smart Home Main Lights ON / OFF",
    colorPickerLabel: "RGB Color Picker",
    moodPresetLabel: "One-Touch Mood Presets",
    presetWarm: "Warm Tone",
    presetCool: "Cool Tone",
    presetPurple: "Purple",
    presetRose: "Rose",

    blindTitle: "Smart Window Blind",
    autoBlindLabel: "Auto Open When Dark",
    autoBlindSub: "CDS Sensor 180° Auto Open",
    blindAngleLabel: "Servo Motor Angle Control",
    presetClose: "90° Closed",
    presetHalf: "135° Half",
    presetOpen: "180° Open",

    humiAlertTitle: "Smart Humidity Warning",
    humiAlertLabel: "High Humidity Alarm",
    humiAlertSub: "Warn with Smart Light on High Humidity",
    humiThresholdLabel: "Alert Humidity Threshold",

    smartOledTitle: "Smart Display Settings",
    oledModeWeather: "Realtime Weather & Air Quality",
    oledModeWord: "Daily Vocabulary Card",
    oledModeTodo: "Today's Tasks & D-Day",
    oledPowerOn: "OLED Power ON",
    oledPowerOff: "OLED Power OFF",

    routineTitle: "Smart Home Routine Scheduler",
    addNewRoutine: "Add New Routine",
    timeSelectLabel: "Select Time",
    featureSelectLabel: "Smart Home Action",
    btnAddRoutine: "Add Routine",
    autoWakeupTitle: "Automatic Wakeup Tracking",
    langSettingTitle: "Language Settings",
    langOptionLabel: "App Language",
    langOptionSub: "Select Korean or English",
    themeTitle: "Display Theme",
    darkModeLabel: "Dark Mode",
    darkModeSub: "ON: Dark Background / OFF: White Background",
    deviceInfoTitle: "Device Information",
    bleDeviceLabel: "BLE Device:",
    protocolLabel: "Protocol:",
    creatorsLabel: "Creators:",
    creatorsNames: "Jina Kim, Yejin Oh",
    logTitle: "Web Bluetooth Logs",
    btnClearLog: "Clear",
    btnSendCmd: "Send",
    cmdInputPlaceholder: "Send custom command...",

    asmrTitle: "ASMR Rain Ambient",
    focusTimerTitle: "Focus Timer",
    btnStartTimer: "Start",
    chatHeaderTitle: "JINJIN AI Assistant",
    chipList: "Commands List",
    chipLightOn: "Light ON",
    chipLightOff: "Light OFF",
    chipSleep: "Sleep Mode",
    chipWakeup: "Wakeup Mode",
    chipWeather: "Weather",
    chipBabyShark: "Baby Shark",
    chipOpenBlind: "Open Blind",
    chipStopAlarm: "Stop Alarm",
    chatBotGreeting: "Hello! 👋 I am your Smart Home AI Assistant.<br>Click the <strong>command buttons</strong> above for instant control!",
    chatInputPlaceholder: "Type a message..."
  }
};

function initLanguage() {
  const savedLang = localStorage.getItem('jinjin_lang') || 'kr';
  applyLanguage(savedLang);

  document.querySelectorAll('.btn-lang-select').forEach(btn => {
    btn.addEventListener('click', () => {
      const lang = btn.getAttribute('data-lang');
      applyLanguage(lang);
    });
  });
}

function showSplashScreen(message, durationMs = 1800) {
  const splash = document.getElementById('splash-screen');
  const subText = document.querySelector('.splash-sub');
  if (!splash) return;

  if (subText && message) {
    subText.innerText = message;
  }

  splash.style.display = 'flex';
  splash.style.opacity = '1';
  splash.style.pointerEvents = 'auto';

  setTimeout(() => {
    splash.style.opacity = '0';
    splash.style.pointerEvents = 'none';
    setTimeout(() => {
      splash.style.display = 'none';
    }, 400);
  }, durationMs);
}

function applyLanguage(lang) {
  currentLanguage = lang;
  try {
    localStorage.setItem('jinjin_lang', lang);
  } catch(e) {}

  document.querySelectorAll('.btn-lang-select').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-lang') === lang);
  });

  const badge = document.getElementById('lang-status-badge');
  if (badge) {
    badge.innerText = lang === 'en' ? '🇺🇸 English' : '🇰🇷 한국어';
  }

  const dict = I18N_TRANSLATIONS[lang] || I18N_TRANSLATIONS.kr;

  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (dict[key]) {
      const icon = el.querySelector('i');
      if (icon) {
        const iconHTML = icon.outerHTML;
        el.innerHTML = `${iconHTML} ${dict[key]}`;
      } else {
        el.innerText = dict[key];
      }
    }
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (dict[key]) {
      el.placeholder = dict[key];
    }
  });

  // 1. 집중 타이머 분 단위 프리셋 버튼 (5m, 10m... / 5분, 10분...)
  document.querySelectorAll('.btn-preset-min').forEach(btn => {
    const min = btn.getAttribute('data-min');
    if (min) btn.innerText = lang === 'en' ? `${min}m` : `${min}분`;
  });

  // 2. 스마트홈 루틴 드롭다운 드롭박스 (<select id="routine-action-select">)
  const actionSelect = document.getElementById('routine-action-select');
  if (actionSelect) {
    const labelsMap = lang === 'en' ? ROUTINE_LABELS_EN : ROUTINE_LABELS;
    Array.from(actionSelect.options).forEach(opt => {
      if (labelsMap[opt.value]) opt.text = labelsMap[opt.value];
    });
  }

  // 3. 헤더 상단 BLE/데모 상태 알림 알약
  const statusText = document.getElementById('header-status-text');
  if (statusText) {
    if (isDemoMode) {
      statusText.innerText = lang === 'en' ? 'Demo Mode' : '데모 모드';
    } else if (!isConnected) {
      statusText.innerText = lang === 'en' ? 'Disconnected' : '연결 안됨';
    }
  }

  // 4. 테마 설정 카드 배지 (#theme-status-badge)
  const themeBadge = document.getElementById('theme-status-badge');
  if (themeBadge) {
    const isDark = document.body.classList.contains('dark-mode');
    themeBadge.innerText = lang === 'en'
      ? (isDark ? 'Dark Mode ON' : 'Dark Mode OFF (White)')
      : (isDark ? '야간 모드 ON (다크)' : '야간 모드 OFF (화이트)');
  }

  // 5. 스마트 습도 경보 상태 배지 및 임계값 텍스트
  const humiBadge = document.getElementById('humi-alert-status');
  if (humiBadge) {
    humiBadge.innerText = lang === 'en' ? 'Normal (Comfortable)' : '정상 (쾌적)';
  }
  const humiTh = document.getElementById('humi-threshold-val');
  if (humiTh) {
    const val = document.getElementById('slider-humi-threshold')?.value || 70;
    humiTh.innerText = lang === 'en' ? `${val}% or higher` : `${val}% 이상`;
  }

  // 6. 스마트 디스플레이 OLED 모드 배지
  const oledBadge = document.getElementById('oled-mode-badge');
  if (oledBadge) {
    oledBadge.innerText = lang === 'en' ? 'Weather / Air Quality' : '날씨/미세먼지';
  }

  // 7. 동적 목록 및 날씨 설명 재렌더링
  renderRoutines();
  renderTodoList();
  updateSnoreBadge();
  updateWeatherDescDisplay();

  logSystem(`🌐 [언어 변경] 앱 표시 언어가 '${lang === 'en' ? 'English' : '한국어'}'(으)로 설정되었습니다.`);
}

window.showSplashScreen = showSplashScreen;
window.initLanguage = initLanguage;
window.applyLanguage = applyLanguage;
