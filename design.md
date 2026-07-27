---
name: Lumina Home - Desktop Glass Dashboard
version: 1.0.0
deviceType: DESKTOP (1280x1204 / 1440px max-width)
colors:
  primary: '#FFD6E8' # Soft Pink
  secondary: '#E0F2F1' # Mint
  tertiary: '#F3E5F5' # Lavender
  background-gradient: 'linear-gradient(135deg, #FFF5F7 0%, #F0F4FF 35%, #E6FFFA 70%, #FFF9E6 100%)'
  text-primary: '#2D3436'
  text-secondary: '#636E72'
  surface-glass: 'rgba(255, 255, 255, 0.25)'
  border-glass: 'rgba(255, 255, 255, 0.7)'
  shadow-glass: '0 10px 40px rgba(0, 0, 0, 0.02), inset 0 4px 16px rgba(255, 255, 255, 0.5)'
typography:
  headline: 'Plus Jakarta Sans'
  body: 'Plus Jakarta Sans'
  mono: 'JetBrains Mono'
rounded:
  default: '1.25rem'
  pill: '9999px'
  bubble: '32px'
spacing:
  base: '8px'
  gutter: '24px'
  card-gap: '24px'
  container-padding: '40px'
  max-width: '1440px'
---

# 💎 Lumina Home - Desktop Glass Dashboard Design System (`design.md`)

본 문서(`design.md`)는 Stitch 프로젝트의 **Lumina Home - Desktop Glass Dashboard (Desktop / 1280x1204)** 가이드라인 및 웹 대시보드 커스텀 디자인 가이드(webguide)입니다.

---

## 🎨 1. 브랜드 & 디자인 스타일 (Brand & Style)

- **디자인 컨셉**: **Crystal Glass & Ethereal Glassmorphism**
- **특징**: 데스크톱 환경(1280x1204 / 최대 1440px)에 최적화된 시원한 크리스탈 글래스 스타일과 파스텔 톤(Soft Pink, Mint, Lavender)의 결합.
- **핵심 요소**:
  - 투명하고 부드러운 블러 효과 (`backdrop-filter: blur(24px)`)
  - 입체적인 빛 감의 내외부 테두리 및 섀도우 (`border: 1px solid rgba(255, 255, 255, 0.7)`)
  - 둥글고 친근한 알약/버블 형태의 인터랙티브 요소 (`border-radius: 32px` & `9999px`)

---

## 🎨 2. 컬러 팔레트 (Color Palette)

| 구분 | 색상 코드 / 값 | 설명 |
| :--- | :--- | :--- |
| **배경 그라데이션** | `linear-gradient(135deg, #FFF5F7, #F0F4FF, #E6FFFA, #FFF9E6)` | 시각적 깊이감을 부여하는 에테르(Ethereal) 파스텔 배경 |
| **Primary (핑크)** | `#FFD6E8` (텍스트: `#9B4D6B`) | 주 제어 버튼 및 활성화 상태 강조 |
| **Secondary (민트)** | `#E0F2F1` (텍스트: `#4D8B83`) | 온습도 및 센서 관련 카드/버튼 |
| **Tertiary (라벤더)** | `#F3E5F5` (텍스트: `#7B5E8C`) | 부가 기능 및 서브 버튼 |
| **Glass Surface** | `rgba(255, 255, 255, 0.25)` | 글래스 카드 배경색 |
| **Glass Border** | `rgba(255, 255, 255, 0.7)` | 카드 입체감 라인 |
| **Text Primary** | `#2D3436` | 메인 헤드라인 및 중요 텍스트 |
| **Text Secondary** | `#636E72` | 설명글 및 서브 라벨 |

---

## ✍️ 3. 타이포그래피 (Typography)

- **Headline / Body**: `Plus Jakarta Sans` (Google Fonts)
- **Code / Mono Data**: `JetBrains Mono` (Google Fonts - 센서 측정치, 터미널 로그용)
- **계층 구조**:
  - **Main Dashboard Title**: `32px` / `Font-Weight: 800`
  - **Section Title / Card Title**: `20px` / `Font-Weight: 700`
  - **Sensor Display Value**: `36px` / `Font-Weight: 700` (`JetBrains Mono`)
  - **Body / Label**: `14px`~`16px` / `Font-Weight: 500`

---

## 📐 4. 레이아웃 & 그리드 (Desktop 1280x1204)

- **Max Container Width**: `1440px` (중앙 정렬)
- **Container Padding**: `40px`
- **Gutter / Gap**: `24px`
- **Grid Layout**:
  - **상단 헤더**: 전체 너비 타이틀 및 BLE 상태 알약 버튼
  - **메인 Grid (3컬럼 데스크톱)**:
    - **Left Column**: 메인 LED / 서보모터 / 조명 컨트롤 파트
    - **Center Column**: 실시간 환경 센서 (온도, 습도, 조도) 카드
    - **Right Column**: 실시간 BLE 센서 데이터 그래프 & 터미널 콘솔 로그

---

## 🧩 5. 핵심 CSS 디자인 요소 (CSS Design System)

### 1) 글래스모피즘 카드 (`.bubble-glass`)
```css
.bubble-glass {
  background: rgba(255, 255, 255, 0.25);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.7);
  box-shadow: 
    0 10px 40px rgba(0, 0, 0, 0.02),
    inset 0 4px 16px rgba(255, 255, 255, 0.5);
  border-radius: 32px;
  transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.bubble-glass:hover {
  background: rgba(255, 255, 255, 0.35);
  transform: translateY(-4px);
  box-shadow: 
    0 20px 60px rgba(0, 0, 0, 0.04),
    inset 0 4px 16px rgba(255, 255, 255, 0.6);
}
```

### 2) 알약 버튼 (`.pill-btn`)
```css
.pill-btn {
  border-radius: 9999px;
  padding: 14px 28px;
  font-weight: 700;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: all 0.3s ease;
}

.pill-btn-pink {
  background: #FFD6E8;
  color: #9B4D6B;
  border: 1px solid rgba(255, 255, 255, 0.8);
  box-shadow: 0 4px 15px rgba(255, 214, 232, 0.4);
}
.pill-btn-pink:hover {
  background: #ffc2db;
  transform: scale(1.02);
}
```

### 3) 배경 분위기 조명 (`.ethereal-bg`)
```css
.ethereal-bg {
  position: fixed;
  inset: 0;
  z-index: -1;
  background: 
    radial-gradient(at 10% 10%, rgba(255, 214, 232, 0.4) 0px, transparent 50%),
    radial-gradient(at 90% 20%, rgba(224, 242, 241, 0.4) 0px, transparent 50%),
    radial-gradient(at 50% 90%, rgba(243, 229, 245, 0.5) 0px, transparent 50%),
    radial-gradient(at 80% 80%, rgba(255, 249, 230, 0.4) 0px, transparent 50%);
  filter: blur(100px);
}
```

---

## 🛠️ 6. student_web_dashboard_guide 연동 안내

본 `design.md`를 적용하여 `index.html`을 데스크톱 글래스 대시보드로 구성할 경우:
1. `index.html`의 `<head>` 태그에 `Plus Jakarta Sans` 및 `JetBrains Mono` 폰트 CDN 추가
2. 위의 `.bubble-glass`, `.pill-btn`, `.ethereal-bg` CSS 스타일 시트 적용
3. `student_web_dashboard_guide.md`의 **3단계(Stitch 디자인 적용)** 시 본 `design.md`의 토큰과 클래스명을 활용하여 UI를 고도화할 수 있습니다.
