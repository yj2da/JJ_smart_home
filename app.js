/**
 * 예진의 스마트홈 웹 대시보드 - Web Bluetooth NUS & UI Control Engine
 * Author: 오예진
 * Target Device: ESP32 (ESP_oyj / namePrefix 'ESP_')
 * Theme: Forest Green
 */

// --- BLE NUS UUID Constants ---
const NUS_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NUS_RX_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // Web -> ESP32 Write
const NUS_TX_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // ESP32 -> Web Notify

// --- Application State ---
const state = {
  bluetoothDevice: null,
  gattServer: null,
  rxCharacteristic: null,
  txCharacteristic: null,
  isConnected: false,
  isDemoMode: false,
  autoPollInterval: null,
  rxBuffer: '',

  // Quick State Trackers
  lightState: false, // RGB LED ON/OFF
  lcdState: true,    // LCD Backlight ON/OFF
  temperature: 24,
  humidity: 45,
  cdsValue: 3200
};

// --- DOM Elements Cache ---
let elements = {};

document.addEventListener('DOMContentLoaded', () => {
  cacheElements();
  initEventListeners();
  checkEnvironment();
  updateUIState();
  logSystem('예진의 스마트홈 시스템 초기화 완료. ESP32(ESP_oyj)를 연결하세요.');
});

// Cache DOM Nodes
function cacheElements() {
  elements = {
    connectOverlay: document.getElementById('connect-overlay'),
    btnModalConnect: document.getElementById('btn-modal-connect'),
    btnModalDemo: document.getElementById('btn-modal-demo'),
    overlayStatusTitle: document.getElementById('overlay-status-title'),
    overlayStatusDesc: document.getElementById('overlay-status-desc'),

    headerStatusBadge: document.getElementById('header-status-badge'),
    headerStatusText: document.getElementById('header-status-text'),
    httpsWarning: document.getElementById('https-warning'),
    demoBanner: document.getElementById('demo-banner'),
    btnExitDemo: document.getElementById('btn-exit-demo'),

    // Values
    homeTemp: document.getElementById('home-temp-val'),
    homeHumi: document.getElementById('home-humi-val'),
    homeLight: document.getElementById('home-light-val'),

    valTemp: document.getElementById('val-temperature'),
    valHumi: document.getElementById('val-humidity'),
    valCds: document.getElementById('val-cds'),

    gaugeTemp: document.getElementById('gauge-temp'),
    gaugeHumi: document.getElementById('gauge-humi'),
    gaugeCds: document.getElementById('gauge-cds'),

    badgeTemp: document.getElementById('badge-temp-status'),
    badgeHumi: document.getElementById('badge-humi-status'),
    badgeCds: document.getElementById('badge-cds-status'),

    quickLightState: document.getElementById('quick-light-state'),
    quickLcdState: document.getElementById('quick-lcd-state'),
    autoSyncStatus: document.getElementById('auto-sync-status'),

    // Controls & Views
    navItems: document.querySelectorAll('.nav-item'),
    tabViews: document.querySelectorAll('.tab-view'),
    actionCmdBtns: document.querySelectorAll('.action-cmd-btn'),

    // Terminal & Manual Input
    terminalOutput: document.getElementById('terminal-output'),
    btnClearTerminal: document.getElementById('btn-clear-terminal'),
    manualCmdInput: document.getElementById('manual-cmd-input'),
    btnSendManual: document.getElementById('btn-send-manual'),

    // Toggles & Quick Refresh
    toggleAutoPoll: document.getElementById('toggle-auto-poll'),
    btnQuickRefresh: document.getElementById('btn-quick-refresh'),
    quickBtnLight: document.getElementById('quick-btn-light'),
    quickBtnLcd: document.getElementById('quick-btn-lcd'),
    quickBtnM1: document.getElementById('quick-btn-m1'),
    quickBtnOled: document.getElementById('quick-btn-oled'),

    toastContainer: document.getElementById('toast-container')
  };
}

// Attach Event Handlers
function initEventListeners() {
  // Navigation Tabs
  elements.navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetId = item.getAttribute('data-target');
      switchTab(targetId);
    });
  });

  // Modal Buttons
  elements.btnModalConnect.addEventListener('click', connectBLEDevice);
  elements.btnModalDemo.addEventListener('click', startDemoMode);
  elements.btnExitDemo.addEventListener('click', exitDemoMode);

  // Command Buttons
  elements.actionCmdBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const cmd = btn.getAttribute('data-cmd');
      if (cmd) sendCommand(cmd);
    });
  });

  // Quick Action Buttons
  elements.quickBtnLight.addEventListener('click', () => {
    state.lightState = !state.lightState;
    sendCommand(state.lightState ? '7' : '8');
  });

  elements.quickBtnLcd.addEventListener('click', () => {
    state.lcdState = !state.lcdState;
    sendCommand(state.lcdState ? '3' : '4');
  });

  elements.quickBtnM1.addEventListener('click', () => sendCommand('5'));
  elements.quickBtnOled.addEventListener('click', () => sendCommand('9'));
  elements.btnQuickRefresh.addEventListener('click', refreshSensors);

  // Terminal Controls
  elements.btnClearTerminal.addEventListener('click', () => {
    elements.terminalOutput.innerHTML = '';
    logSystem('터미널 로그를 지웠습니다.');
  });

  elements.btnSendManual.addEventListener('click', sendManualInput);
  elements.manualCmdInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendManualInput();
  });

  // Auto Polling Switch
  elements.toggleAutoPoll.addEventListener('change', (e) => {
    if (e.target.checked) {
      startAutoPoll();
    } else {
      stopAutoPoll();
    }
  });
}

// Check Environment for HTTPS / Web Bluetooth Support
function checkEnvironment() {
  const isSecure = window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!isSecure) {
    elements.httpsWarning.classList.remove('hidden');
  }

  if (!navigator.bluetooth) {
    logError('이 브라우저는 Web Bluetooth API를 지원하지 않습니다. (Bluefy 앱 또는 Chrome 필요)');
    elements.overlayStatusDesc.textContent = 'Web Bluetooth 미지원 브라우저입니다. 데모 모드를 이용해보세요.';
  }
}

// Tab Switching Handler
function switchTab(targetId) {
  elements.navItems.forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-target') === targetId);
  });

  elements.tabViews.forEach(view => {
    view.classList.toggle('active-view', view.id === targetId);
  });
}

// --- Web Bluetooth BLE Core Functions ---
async function connectBLEDevice() {
  if (!navigator.bluetooth) {
    showToast('Web Bluetooth를 지원하지 않는 브라우저입니다.', 'error');
    return;
  }

  try {
    elements.overlayStatusTitle.textContent = '기기 스캔 중...';
    elements.overlayStatusDesc.textContent = '팝업창에서 [ESP_oyj] 기기를 선택해 주세요.';
    logSystem('BLE 기기 검색을 시작합니다 (Filter: NUS Service & namePrefix "ESP_").');

    // Try scanning for 'ESP_' prefix or NUS Service, with optionalServices
    try {
      state.bluetoothDevice = await navigator.bluetooth.requestDevice({
        filters: [
          { namePrefix: 'ESP_' },
          { name: 'ESP_oyj' },
          { services: [NUS_SERVICE_UUID] }
        ],
        optionalServices: [NUS_SERVICE_UUID]
      });
    } catch (filterErr) {
      if (filterErr.name === 'SecurityError' || (filterErr.name === 'NotFoundError' && filterErr.message.includes('User cancelled'))) {
        throw filterErr; // User explicitly clicked cancel
      }
      // Fallback scan: list all devices if filter failed
      logSystem('모든 BLE 기기 검색 모드로 재시도합니다.');
      state.bluetoothDevice = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [NUS_SERVICE_UUID]
      });
    }

    state.bluetoothDevice.addEventListener('gattserverdisconnected', onDisconnected);

    elements.overlayStatusTitle.textContent = 'GATT 서버 연결 중...';
    logSystem(`[${state.bluetoothDevice.name}] 기기에 연결 시도 중...`);

    state.gattServer = await state.bluetoothDevice.gatt.connect();

    // Get NUS Service
    const service = await state.gattServer.getPrimaryService(NUS_SERVICE_UUID);

    // Get RX & TX Characteristics
    state.rxCharacteristic = await service.getCharacteristic(NUS_RX_UUID);
    state.txCharacteristic = await service.getCharacteristic(NUS_TX_UUID);

    // Enable Notifications for TX
    await state.txCharacteristic.startNotifications();
    state.txCharacteristic.addEventListener('characteristicvaluechanged', handleTXNotification);

    state.isConnected = true;
    state.isDemoMode = false;

    updateUIState();
    elements.connectOverlay.classList.add('hidden');
    showToast(`성공적으로 [${state.bluetoothDevice.name}]에 연결되었습니다!`, 'success');
    logSystem(`GATT 연결 성공: NUS 통신이 활성화되었습니다.`);

    // Request Initial Sensor Values
    setTimeout(() => {
      sendCommand('1');
      setTimeout(() => sendCommand('2'), 400);
    }, 500);

  } catch (err) {
    console.error('BLE Connection Error:', err);
    elements.overlayStatusTitle.textContent = '연결 실패';
    elements.overlayStatusDesc.textContent = err.message || '연결이 취소되거나 실패했습니다.';
    logError(`BLE 연결 오류: ${err.message}`);
    showToast('연결이 취소되었거나 기기를 찾을 수 없습니다.', 'error');
  }
}

function onDisconnected() {
  state.isConnected = false;
  state.gattServer = null;
  state.rxCharacteristic = null;
  state.txCharacteristic = null;

  updateUIState();
  stopAutoPoll();
  logError('BLE 연결이 끊어졌습니다.');
  showToast('ESP32 기기와의 연결이 해제되었습니다.', 'error');
  elements.connectOverlay.classList.remove('hidden');
}

// Handle Incoming Notifications from ESP32 (TX)
function handleTXNotification(event) {
  const decoder = new TextDecoder('utf-8');
  const chunk = decoder.decode(event.target.value);
  state.rxBuffer += chunk;

  // Process completed lines (delimited by \n)
  let lines = state.rxBuffer.split('\n');
  state.rxBuffer = lines.pop(); // Keep partial line in buffer

  lines.forEach(line => {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      logRX(trimmed);
      parseIncomingPacket(trimmed);
    }
  });
}

// Packet Parser Logic
function parseIncomingPacket(packet) {
  // 1. Temperature Parsing: "temp : 24"
  if (packet.includes('temp')) {
    const match = packet.match(/temp\s*:\s*(\d+)/i);
    if (match) {
      const tempVal = parseInt(match[1], 10);
      updateTemperatureUI(tempVal);
    }
  }

  // 2. Humidity Parsing: "humi : 45"
  if (packet.includes('humi')) {
    const match = packet.match(/humi\s*:\s*(\d+)/i);
    if (match) {
      const humiVal = parseInt(match[1], 10);
      updateHumidityUI(humiVal);
    }
  }

  // 3. CdS Illuminance Parsing: "3200" or raw number string
  if (/^\d+$/.test(packet)) {
    const cdsVal = parseInt(packet, 10);
    updateCdSUI(cdsVal);
  }
}

// Send Command String to ESP32 (RX)
async function sendCommand(cmdStr) {
  if (!state.isConnected && !state.isDemoMode) {
    showToast('기기가 연결되지 않았습니다.', 'error');
    elements.connectOverlay.classList.remove('hidden');
    return;
  }

  logTX(`명령어 전송: '${cmdStr}'`);

  if (state.isDemoMode) {
    handleDemoCommand(cmdStr);
    return;
  }

  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(cmdStr);

    if (state.rxCharacteristic.properties.writeWithoutResponse) {
      await state.rxCharacteristic.writeValueWithoutResponse(data);
    } else {
      await state.rxCharacteristic.writeValue(data);
    }
  } catch (err) {
    console.error('BLE TX Write Error:', err);
    logError(`TX 송신 오류: ${err.message}`);
    showToast('명령 전송에 실패했습니다.', 'error');
  }
}

function sendManualInput() {
  const val = elements.manualCmdInput.value.trim();
  if (val) {
    sendCommand(val);
    elements.manualCmdInput.value = '';
  }
}

// --- Sensor Refresh & Auto Polling ---
function refreshSensors() {
  sendCommand('1');
  setTimeout(() => sendCommand('2'), 350);
}

function startAutoPoll() {
  if (state.autoPollInterval) clearInterval(state.autoPollInterval);
  state.autoPollInterval = setInterval(() => {
    refreshSensors();
  }, 5000);
  elements.autoSyncStatus.textContent = '활성 (5초 마다 자동 측정)';
  logSystem('센서 5초 자동 조회가 시작되었습니다.');
  showToast('5초 자동 동기화 활성화됨', 'info');
}

function stopAutoPoll() {
  if (state.autoPollInterval) {
    clearInterval(state.autoPollInterval);
    state.autoPollInterval = null;
  }
  elements.toggleAutoPoll.checked = false;
  elements.autoSyncStatus.textContent = '비활성 (수동 요청)';
  logSystem('센서 자동 조회가 정지되었습니다.');
}

// --- Simulation (Demo) Mode ---
function startDemoMode() {
  state.isDemoMode = true;
  state.isConnected = false;

  elements.connectOverlay.classList.add('hidden');
  updateUIState();
  logSystem('⚡ 시뮬레이션(데모) 모드가 활성화되었습니다. (오예진 가상 스마트홈 ESP_oyj)');
  showToast('데모 모드가 시작되었습니다.', 'info');

  // Trigger initial virtual measurements
  refreshSensors();
}

function exitDemoMode() {
  state.isDemoMode = false;
  stopAutoPoll();
  updateUIState();
  elements.connectOverlay.classList.remove('hidden');
  logSystem('데모 모드가 종료되었습니다.');
}

function handleDemoCommand(cmd) {
  setTimeout(() => {
    switch (cmd) {
      case '1': {
        // Temperature & Humidity
        state.temperature = Math.min(38, Math.max(16, state.temperature + (Math.floor(Math.random() * 3) - 1)));
        state.humidity = Math.min(80, Math.max(30, state.humidity + (Math.floor(Math.random() * 5) - 2)));

        const tempMsg = `temp : ${state.temperature}`;
        const humiMsg = `humi : ${state.humidity}`;
        logRX(tempMsg);
        parseIncomingPacket(tempMsg);

        setTimeout(() => {
          logRX(humiMsg);
          parseIncomingPacket(humiMsg);
        }, 100);
        break;
      }
      case '2': {
        // CdS Light Sensor
        state.cdsValue = Math.min(4095, Math.max(100, state.cdsValue + (Math.floor(Math.random() * 600) - 300)));
        const cdsMsg = `${state.cdsValue}`;
        logRX(cdsMsg);
        parseIncomingPacket(cdsMsg);
        break;
      }
      case '3':
        state.lcdState = true;
        updateQuickStates();
        showToast('LCD 백라이트 ON (Demo)', 'info');
        break;
      case '4':
        state.lcdState = false;
        updateQuickStates();
        showToast('LCD 백라이트 OFF (Demo)', 'info');
        break;
      case '5':
        showToast('🎵 멜로디 1 (학교종) 재생 중...', 'info');
        break;
      case '6':
        showToast('⭐ 멜로디 2 (작은별) 재생 중...', 'info');
        break;
      case '7':
        state.lightState = true;
        updateQuickStates();
        showToast('💡 RGB LED 점등 (Demo)', 'success');
        break;
      case '8':
        state.lightState = false;
        updateQuickStates();
        showToast('💡 RGB LED 소등 (Demo)', 'info');
        break;
      case '9':
        showToast('🐱 OLED 헬로키티 비트맵 출력 (img/kitty.pbm)', 'success');
        break;
      default:
        showToast(`수신된 커스텀 명령: '${cmd}'`, 'info');
    }
  }, 120);
}

// --- UI Update Helpers ---
function updateUIState() {
  const badge = elements.headerStatusBadge;
  const label = elements.headerStatusText;

  badge.className = 'header-status neumorph-sunken-sm';

  if (state.isConnected) {
    badge.classList.add('status-connected');
    label.textContent = `연결됨 (${state.bluetoothDevice ? state.bluetoothDevice.name : 'ESP_oyj'})`;
    elements.demoBanner.classList.add('hidden');
  } else if (state.isDemoMode) {
    badge.classList.add('status-demo');
    label.textContent = '데모 모드 (ESP_oyj 가상 기기)';
    elements.demoBanner.classList.remove('hidden');
  } else {
    badge.classList.add('status-disconnected');
    label.textContent = '연결 안 됨';
    elements.demoBanner.classList.add('hidden');
  }

  updateQuickStates();
}

function updateQuickStates() {
  elements.quickLightState.textContent = state.lightState ? 'ON (켜짐)' : 'OFF (꺼짐)';
  elements.quickLightState.style.color = state.lightState ? 'var(--accent-green)' : 'var(--text-muted)';

  elements.quickLcdState.textContent = state.lcdState ? 'ON' : 'OFF';
}

function updateTemperatureUI(temp) {
  state.temperature = temp;
  if (elements.homeTemp) elements.homeTemp.innerHTML = `${temp} <span>°C</span>`;
  if (elements.valTemp) elements.valTemp.textContent = temp;

  // Percentage for gauge (0 to 50 deg C scale)
  const pct = Math.min(100, Math.max(0, (temp / 50) * 100));
  if (elements.gaugeTemp) elements.gaugeTemp.style.width = `${pct}%`;

  if (elements.badgeTemp) {
    if (temp < 18) {
      elements.badgeTemp.textContent = '쌀쌀함';
    } else if (temp <= 28) {
      elements.badgeTemp.textContent = '쾌적함';
    } else {
      elements.badgeTemp.textContent = '무더움';
    }
  }
}

function updateHumidityUI(humi) {
  state.humidity = humi;
  if (elements.homeHumi) elements.homeHumi.innerHTML = `${humi} <span>%</span>`;
  if (elements.valHumi) elements.valHumi.textContent = humi;

  const pct = Math.min(100, Math.max(0, humi));
  if (elements.gaugeHumi) elements.gaugeHumi.style.width = `${pct}%`;

  if (elements.badgeHumi) {
    if (humi < 35) {
      elements.badgeHumi.textContent = '건조함';
    } else if (humi <= 65) {
      elements.badgeHumi.textContent = '적정';
    } else {
      elements.badgeHumi.textContent = '습함';
    }
  }
}

function updateCdSUI(cdsVal) {
  state.cdsValue = cdsVal;
  if (elements.homeLight) elements.homeLight.textContent = cdsVal;
  if (elements.valCds) elements.valCds.textContent = cdsVal;

  const lightBar = document.getElementById('home-light-bar');
  const pct = Math.min(100, Math.max(0, (cdsVal / 4095) * 100));
  if (elements.gaugeCds) elements.gaugeCds.style.width = `${pct}%`;
  if (lightBar) lightBar.style.width = `${pct}%`;

  if (elements.badgeCds) {
    if (cdsVal > 3000) {
      elements.badgeCds.textContent = '어두움';
    } else {
      elements.badgeCds.textContent = '밝음';
    }
  }
}

// --- Terminal Log Helpers ---
function getTimestamp() {
  const now = new Date();
  return now.toTimeString().split(' ')[0];
}

function logSystem(msg) {
  appendLogLine(`[${getTimestamp()}] ⚙️ ${msg}`, 'log-sys');
}

function logTX(msg) {
  appendLogLine(`[${getTimestamp()}] 📤 TX: ${msg}`, 'log-tx');
}

function logRX(msg) {
  appendLogLine(`[${getTimestamp()}] 📥 RX: ${msg}`, 'log-rx');
}

function logError(msg) {
  appendLogLine(`[${getTimestamp()}] ❌ ERROR: ${msg}`, 'log-err');
}

function appendLogLine(text, className) {
  if (!elements.terminalOutput) return;

  const line = document.createElement('div');
  line.className = `log-line ${className}`;
  line.textContent = text;

  elements.terminalOutput.appendChild(line);
  elements.terminalOutput.scrollTop = elements.terminalOutput.scrollHeight;
}

// --- Toast System ---
function showToast(message, type = 'info') {
  if (!elements.toastContainer) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  let icon = 'fa-circle-info';
  if (type === 'success') icon = 'fa-circle-check';
  if (type === 'error') icon = 'fa-triangle-exclamation';

  toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
  elements.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 2800);
}
