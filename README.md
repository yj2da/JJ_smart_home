<!--
====================================================================
📌 [GitHub About 설정 가이드]
- Description: Web Bluetooth(BLE) 기반 IoT 스마트홈 대시보드 & 자연어 AI 제어 에이전트 (ESP32, MicroPython, NUS)
- Website: https://jj-smart-home.vercel.app
- Topics: web-bluetooth, ble, esp32, micropython, iot, smart-home, ai-agent, chartjs, glassmorphism
====================================================================
-->

# 🏠 JJ Smart Home: Web Bluetooth IoT Dashboard & AI Control Agent

<p align="center">
  <img src="https://img.shields.io/badge/Vercel-Live%20Demo-black?style=for-the-badge&logo=vercel&logoColor=white" />
  <img src="https://img.shields.io/badge/Web%20Bluetooth-NUS%20Protocol-0082FC?style=for-the-badge&logo=bluetooth&logoColor=white" />
  <img src="https://img.shields.io/badge/Hardware-ESP32%20DEVKIT%20V1-E7352C?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Firmware-MicroPython-2B5B84?style=for-the-badge&logo=python&logoColor=white" />
  <img src="https://img.shields.io/badge/UI-Glassmorphism%20CSS-7952B3?style=for-the-badge" />
</p>

> **별도의 모바일 네이티브 앱 설치 없이, 웹 브라우저에서 Web Bluetooth API를 통해 ESP32 마이크로컨트롤러와 초저지연 통신하는 스마트홈 대시보드**  
> 실시간 온습도·조도·사운드 센서 모니터링, 서보 모터 블라인드 제어, 그리고 사용자의 자연어 발화를 기기 제어 명령어로 매핑하는 대화형 AI 에이전트를 결합했습니다.

🔗 **라이브 데모:** [jj-smart-home.vercel.app](https://jj-smart-home.vercel.app)

---

## 📌 Key Highlights

- **No-App Web Bluetooth 연결**: Nordic UART Service (NUS) GATT 프로토콜을 구현하여, 크롬/웨일 등 브라우저 클릭 한 번으로 하드웨어와 즉시 페어링.
- **간편 AI 대화형 제어 에이전트**:
  - 사용자의 자연어 음성/텍스트 발화("조명 켜줘", "취침 모드 시작해줘")를 실시간 파싱하여 BLE 제어 바이트 코드로 자동 매핑.
- **센서 데이터 시각화 & 액추에이터 제어**:
  - DHT11(온습도), CdS(조도), 사운드 센서 측정값을 Chart.js 실시간 꺾은선 그래프로 시각화
  - SG90 서보 모터를 이용한 스마트 블라인드 정밀 각도 제어 및 LED 조명 PWM 디밍
- **프리미엄 UI/UX**: 글래스모피즘(Glassmorphism)과 반응형 다크 모드 디자인 시스템 적용.

---

## 🏗️ System Architecture

```mermaid
flowchart LR
    subgraph Browser [Client Browser / Vercel]
        UI[Glassmorphism Dashboard]
        AIAgent[자연어 AI 명령 파서]
        WebBLE[Web Bluetooth API]
        UI <--> AIAgent
        AIAgent --> WebBLE
    end
    
    subgraph BLE [Bluetooth Low Energy (NUS)]
        TX[TX / RX GATT Characteristic]
    end
    
    subgraph Hardware [ESP32 DEVKIT V1 / MicroPython]
        ESP32[ESP32 Microcontroller]
        Sensors[DHT11 / CdS / Sound Sensor]
        Actuators[SG90 서보모터 / LED]
        ESP32 --> Sensors
        ESP32 --> Actuators
    end
    
    WebBLE <== NUS Protocol ==> TX <== UART ==> ESP32
```

---

## 🛠 Tech Stack

| 구분 | 기술 스택 |
| :--- | :--- |
| **Frontend & UI** | JavaScript (ES6+), HTML5 Canvas, CSS3 (Glassmorphism), Chart.js |
| **Communication** | Web Bluetooth API, Nordic UART Service (NUS) GATT Profile |
| **Hardware & Firmware** | ESP32 DEVKIT V1, MicroPython, UART / ADC / PWM |
| **Deployment** | Vercel (`jj-smart-home.vercel.app`) |

---

## 🚀 Getting Started

### 1. 웹 대시보드 로컬 실행
```bash
git clone https://github.com/yj2da/JJ_smart_home.git
cd JJ_smart_home
# Live Server 또는 웹 서버로 실행
```

### 2. ESP32 펌웨어 플래싱
1. Thonny 또는 `ampy`를 통해 `main.py`와 `ble_uart.py`를 ESP32에 업로드합니다.
2. ESP32 전원을 인가한 후 웹 브라우저에서 **[기기 연결 (Connect)]** 버튼을 클릭하여 블루투스 페어링을 진행합니다.

---

## 👩‍💻 Author
* **오예진 (Oh Yejin)** - IoT & Web Product Engineer  
* Email: [yejin.6642@gmail.com](mailto:yejin.6642@gmail.com) | GitHub: [@yj2da](https://github.com/yj2da)
