from machine import ADC, Pin, PWM, SoftI2C
from time import sleep, ticks_ms, ticks_diff
from servo import Servo

import dht
import ble_library
import bluetooth

import ssd1306
import framebuf

# ==========================================================================
# JINJIN SMART HOME - ESP32 MICROPYTHON HARDWARE CONTROL (JJ_smartHome.py)
# Creators: Jina & Yejin
# Hardware: ESP32, LDR CDS (36), Mic ADC (34), Servo (13), Piezo (23),
#           RGB LED (25, 26, 27), DHT11 (14), Touch (17, 5, 18, 19),
#           OLED 1 (I2C 21, 22), OLED 2 (I2C 4, 16)
# ==========================================================================

# OpenWeatherMap API 키 설정 (Busan / Seoul)
API_KEY = "225582847ec75d5bfc26517638e79c64"
CITY = "Busan"
WEATHER_URL = "http://api.openweathermap.org/data/2.5/weather?q=" + CITY + "&appid=" + API_KEY + "&units=metric"

# 1. 조도 센서 초기화 (LDR Pin 36)
cds = ADC(Pin(36))
cds.atten(ADC.ATTN_11DB)
cds_flag = 0
auto_blind_enabled = True # 조도 자동 블라인드 연동 플래그

# 2. 마이크(사운드) 센서 초기화 (ADC Pin 34)
mic_adc = ADC(Pin(34))
mic_adc.atten(ADC.ATTN_11DB)

mic_active = False
snore_count = 0
snore_flag = False

# 3. 서보 모터 초기화 (Servo Pin 13)
motor = Servo(pin=13)

# 4. 피에조 부저 초기화 (PWM Pin 23)
buzzer = PWM(Pin(23))
buzzer.duty_u16(0)

# 피에조 부저 톤 재생 함수 (50% Duty Square Wave - 맑고 큰 부저 소리)
def play_tone(freq, duration):
    if freq <= 0:
        sleep(duration)
        return
    buzzer.freq(freq)
    buzzer.duty_u16(32768) # 50% duty_u16 (피에조 부저 최대 공성 음량)
    sleep(duration)
    buzzer.duty_u16(0)

# 멜로디 주파수 정의 (Hz)
blindMelody = (524, 659, 784)
melody1 = (784, 784, 880, 880, 784, 784, 659) # 학교종

# 피에조 부저 음계 정의
NOTE_C4 = 262
NOTE_D4 = 294
NOTE_E4 = 330
NOTE_F4 = 349
NOTE_FS4 = 370
NOTE_G4 = 392
NOTE_A4 = 440
NOTE_B4 = 494
NOTE_C5 = 523

# 5. RGB LED 핀 정의 (빨강 Pin 25, 초록 Pin 26, 파랑 Pin 27)
R = Pin(25, Pin.OUT)
G = Pin(26, Pin.OUT)
B = Pin(27, Pin.OUT)

# 6. 정전식 터치 센서 4핀 정의 (touch1 Pin 17, touch2 Pin 5, touch3 Pin 18, touch4 Pin 19)
touch1 = Pin(17, Pin.IN)
touch2 = Pin(5, Pin.IN)
touch3 = Pin(18, Pin.IN)
touch4 = Pin(19, Pin.IN)

# 7. DHT11 온습도 센서 초기화 (Pin 14)
d = dht.DHT11(Pin(14))
humi_alert_enabled = True # 습도 경보 연동 플래그
humi_threshold = 70       # 습도 경보 기준 (기본 70%)

# 8. OLED 1번 디스플레이 초기화 (SDA Pin 21, SCL Pin 22 - 날씨 아이콘/영단어/날짜용)
display1 = None
try:
    i2c1 = SoftI2C(sda=Pin(21), scl=Pin(22))
    display1 = ssd1306.SSD1306_I2C(128, 64, i2c1)
    display1.fill(0)
    display1.show()
    print("OLED 1 (Pin 21, 22) Initialized")
except Exception as e:
    print("OLED 1 Init Error:", e)

# 9. OLED 2번 디스플레이 초기화 (SDA Pin 4, SCL Pin 16 - 온습도/활용문장/할일/키티용)
display2 = None
try:
    i2c2 = SoftI2C(sda=Pin(4), scl=Pin(16))
    display2 = ssd1306.SSD1306_I2C(128, 64, i2c2)
    display2.fill(0)
    display2.show()
    print("OLED 2 (Pin 4, 16) Initialized")
except Exception as e:
    print("OLED 2 Init Error (using OLED 1 fallback):", e)
    display2 = display1

# OLED 1번 전용: 날씨 상태별 그래픽 아이콘 드로잉 함수
def draw_weather_icon(disp, weather_type):
    if not disp:
        return
    disp.fill(0)
    w = weather_type.lower()
    
    if 'clear' in w or 'sun' in w:
        # 맑음 (SUNNY) 해 드로잉
        disp.text("WEATHER: SUNNY", 8, 0)
        disp.fill_rect(54, 24, 20, 20, 1) # 해 중앙
        disp.line(64, 14, 64, 20, 1) # 상
        disp.line(64, 48, 64, 54, 1) # 하
        disp.line(44, 34, 50, 34, 1) # 좌
        disp.line(78, 34, 84, 34, 1) # 우
        disp.line(50, 20, 54, 24, 1) # 대각선
        disp.line(74, 44, 78, 48, 1)
        disp.line(50, 48, 54, 44, 1)
        disp.line(74, 24, 78, 20, 1)
        disp.text("[ CLEAR SKY ]", 12, 54)
        
    elif 'rain' in w or 'drizzle' in w or 'thunder' in w:
        # 비 (RAIN) 구름+빗방울 드로잉
        disp.text("WEATHER: RAINING", 0, 0)
        disp.fill_rect(40, 22, 48, 14, 1)
        disp.fill_rect(48, 16, 32, 12, 1)
        disp.line(48, 40, 44, 48, 1)
        disp.line(64, 40, 60, 48, 1)
        disp.line(80, 40, 76, 48, 1)
        disp.text("[ HEAVY RAIN ]", 8, 54)
        
    elif 'snow' in w:
        # 눈 (SNOW) 눈결정 드로잉
        disp.text("WEATHER: SNOWING", 0, 0)
        disp.line(64, 18, 64, 48, 1)
        disp.line(49, 33, 79, 33, 1)
        disp.line(53, 22, 75, 44, 1)
        disp.line(53, 44, 75, 22, 1)
        disp.text("[ SNOWFALL ]", 16, 54)
        
    else:
        # 구름 (CLOUDY / OVERCAST) 드로잉
        disp.text("WEATHER: CLOUDY", 4, 0)
        disp.fill_rect(36, 28, 56, 16, 1)
        disp.fill_rect(46, 20, 36, 14, 1)
        disp.fill_rect(56, 14, 16, 10, 1)
        disp.text("[ OVERCAST ]", 16, 54)
        
    disp.show()

# 1회성 실내 센서 측정 & OLED 2 화면 갱신 함수 (5초 무한 반복 대신 동기화/기상 시 수동 호출)
def update_sensors_and_oled2():
    temp_str = "24"
    humi_str = "55"
    h_val = 55
    try:
        d.measure()
        t_val = d.temperature()
        h_val = d.humidity()
        temp_str = str(int(t_val))
        humi_str = str(int(h_val))
    except Exception as dht_err:
        print("DHT11 sensor measure error:", dht_err)
    
    current_cds = cds.read()
    
    # 웹 대시보드로 실시간 텔레메트리 데이터 1회 송신
    p.send("temp : " + temp_str + "\n")
    p.send("humi : " + humi_str + "\n")
    p.send(str(current_cds) + "\n")
    
    # OLED 2 디스플레이 갱신 (센서 모드일 때)
    if current_display2_mode == 'sensor' and display2:
        display2.fill(0)
        display2.text("=== JINJIN HOME ===", 0, 0)
        display2.text("Temp: " + temp_str + " C", 0, 16)
        display2.text("Humi: " + humi_str + " %", 0, 32)
        if h_val >= humi_threshold and humi_alert_enabled:
            display2.text("⚠️ HIGH HUMI!", 0, 48)
        else:
            display2.text("CDS: " + str(current_cds), 0, 48)
        display2.show()

    return temp_str, humi_str

# 날씨 API 파싱 및 OLED 1, 2번 연동 함수
def update_weather():
    temp_str = "24"
    humi_str = "55"
    weather_main = "Clouds"
    city_name = CITY
    
    try:
        import urequests
        res = urequests.get(WEATHER_URL)
        data = res.json()
        res.close()
        
        weather_main = data['weather'][0]['main']
        temp_str = str(int(data['main']['temp']))
        humi_str = str(int(data['main']['humidity']))
        city_name = data['name']
        print("API Weather Fetch Success:", weather_main, temp_str + "C", humi_str + "%")
    except Exception as e:
        print("Weather API Fallback Check:", e)
        temp_str, humi_str = update_sensors_and_oled2()
        weather_main = "Clear"

    # OLED 1번: 날씨 모양 이쁜 그림/아이콘 출력 (Pin 21, 22)
    if display1:
        draw_weather_icon(display1, weather_main)

    # OLED 2번: 온도 및 습도 출력 (Pin 4, 16)
    if display2:
        display2.fill(0)
        display2.text("=== WEATHER ===", 0, 0)
        display2.text("City: " + city_name, 0, 16)
        display2.text("Temp: " + temp_str + " C", 0, 32)
        display2.text("Humi: " + humi_str + " %", 0, 48)
        display2.show()

    return temp_str, humi_str, weather_main

# 10. BLE 인스턴스 초기화 및 'ESP_JJ' 장치명으로 페어링 시작
ble = bluetooth.BLE()
p = ble_library.BLESimplePeripheral(ble, "ESP_JJ")

# OLED 화면 상태 관리를 위한 전역 변수 설정
current_oled_mode = 'O1'         # 'O1': 날씨/온습도, 'O2': 영단어, 'O3': 날짜/할일
current_display2_mode = 'sensor' # 'sensor': 온습도/조도 표시, 'kitty': 헬로키티 비트맵 표시

# 블루투스 수신 이벤트 핸들러
def on_rx(v): 
    global current_oled_mode, current_display2_mode, auto_blind_enabled, humi_alert_enabled, humi_threshold
    if isinstance(v, bytes):
        v = v.decode('utf-8').strip()
    else:
        v = str(v).strip()
        
    print("Received BLE Command:", v)

    # '1' 또는 'sync' 수신 시: 웹 동기화 요청 -> 날씨/센서 1회 갱신
    if v == '1' or v == 'w' or v == 'weather' or v == 'sync':
        print("Fetching Weather & Sensor Sync (1-Time)...")
        current_display2_mode = 'sensor'
        current_oled_mode = 'O1'
        temp, humi, weather = update_weather()
        p.send("temp : " + temp + "\n")
        p.send("humi : " + humi + "\n")
        
    # '2' 수신 시: 1번 OLED(TV)에 조도 센서 측정값 1회 표시 및 웹 송신
    if v == '2':
        cds_value = cds.read()
        if display1:
            display1.fill(0)
            display1.text("CDS: " + str(cds_value), 0, 0)
            if cds_value > 4000:   
                display1.text("It's dark", 0, 16)
            else:
                display1.text("It's bright", 0, 16)
            display1.show()
        p.send(str(cds_value) + "\n")

    # '3' / '4' 수신 시: 1번 OLED 화면 켜기 / 끄기
    if v == '3':
        if display1: display1.poweron()
    if v == '4':
        if display1: display1.poweroff()
    
    # '5' 수신 시: 학교종 멜로디 또는 집중 모드 완료 부저 알람 연주
    if v == '5' or v == 'F_ALARM':
        print("🔔 [Piezo Buzzer] 집중 모드 완료 / 알람 멜로디 재생")
        for i in melody1:
            play_tone(i, 0.5)
            sleep(0.05)

    # '7' / '8' 수신 시: RGB LED 전체 켜기 / 전체 끄기
    if v == '7':
        R.on(); G.on(); B.on()
    if v == '8':
        R.off(); G.off(); B.off()
    
    # '9' 수신 시: 2번 OLED에 Kitty PBM 이미지 드로잉
    if v == '9':
        current_display2_mode = 'kitty'
        try:
            with open('img/kitty.pbm', 'rb') as f:
                f.readline(); f.readline()
                data = bytearray(f.read())
            fb = framebuf.FrameBuffer(data, 128, 64, framebuf.MONO_HLSB)
            if display2:
                display2.invert(0)
                display2.fill(0)
                display2.blit(fb, 0, 0)
                display2.show()
        except Exception as img_err:
            print("Kitty PBM image load error:", img_err)

    # 'S' 수신 시: 수면 모드 시작 -> 불 다 끄기 (RGB OFF) & 코골이 감지 ON
    if v == 'S':
        global mic_active, snore_count, snore_flag
        mic_active = True
        snore_count = 0
        snore_flag = False
        print("💤 [BLE Command] 수면 모드 시작 -> 불 다 끄기 (RGB ALL OFF)")
        p.send("Snore Monitor Started\n")
        # 수면 모드 시 불 다 끄기
        R.off()
        G.off()
        B.off()
        if display1:
            display1.fill(0)
            display1.text("=== SLEEP MODE ===", 0, 0)
            display1.text("Lights: OFF", 0, 20)
            display1.text("Snore Monitor: ON", 0, 40)
            display1.show()

    # 'Q' 수신 시: 기상 모드 진입 -> 불 켜기 (RGB ON), 블라인드 걷기 (모터 180°), 1회 센서 동기화
    if v == 'Q':
        global mic_active, snore_count, snore_flag
        mic_active = False
        snore_count = 0
        snore_flag = False
        buzzer.duty_u16(0) # 알람 소리 정지
        print("☀️ [BLE Command] 기상 모드 진입 -> 불 켜기 (RGB ON) & 블라인드 180° 개방")
        p.send("Snore Monitor OFF\n")
        
        # 기상 모드: 불 켜기 & 블라인드 180도 개방
        R.on()
        G.on()
        B.on()
        motor.move(180)

        if display1:
            display1.fill(0)
            display1.text("=== WAKEUP MODE ===", 0, 0)
            display1.text("Lights: ON", 0, 20)
            display1.text("Blind: 180 Open", 0, 40)
            display1.show()

        # 기상 모드 켜면 센서 1회 확인 & 갱신
        update_sensors_and_oled2()

    # 'A' 수신 시: 부저 알람 즉시 끄기
    if v == 'A':
        buzzer.duty_u16(0)
        print("🔔 [BLE Command] 부저 알람 즉시 끄기 완료")

    # 'M'으로 시작하는 서보 모터 직접 제어 (예: M90, M180)
    if v.startswith('M'):
        try:
            angle = int(v[1:])
            motor.move(angle)
            print("📐 [BLE Command] 서보 모터 각도:", angle)
        except Exception as e:
            print("Motor angle parse error:", e)

    # 'W:'로 시작하는 오늘의 영단어 & 짧은 활용 문장 수신
    # 규격: W:영단어|뜻|활용문장  (예: W:SERENDIPITY|뜻밖의 행운|Finding joy in unexpected moments.)
    if v.startswith('W:'):
        current_oled_mode = 'O2'
        parts = v[2:].split('|')
        word_en = parts[0] if len(parts) > 0 else "WORD"
        word_kr = parts[1] if len(parts) > 1 else ""
        word_ex = parts[2] if len(parts) > 2 else "Keep going!"

        print("📚 [BLE Command] 영단어:", word_en, "/ 문장:", word_ex)
        
        # OLED 1: 영단어 & 한글 뜻 표시
        if display1:
            display1.fill(0)
            display1.text("=== WORD CARD ===", 0, 0)
            display1.text(word_en[0:16], 0, 20)
            display1.text(word_kr[0:16], 0, 40)
            display1.show()

        # OLED 2: 짧은 활용 문장 표시
        if display2:
            display2.fill(0)
            display2.text("=== EXAMPLE ===", 0, 0)
            # 16자 단위 줄바꿈
            display2.text(word_ex[0:16], 0, 20)
            display2.text(word_ex[16:32], 0, 38)
            display2.show()

    # 'T:'로 시작하는 오늘의 날짜 & 할 일 수신
    # 규격: T:날짜|할일내용 (예: T:2026.07.28|스마트홈 센서 테스트)
    if v.startswith('T:'):
        current_oled_mode = 'O3'
        parts = v[2:].split('|')
        date_str = parts[0] if len(parts) > 0 else "DATE"
        todo_text = parts[1] if len(parts) > 1 else "NONE"

        print("📅 [BLE Command] 날짜:", date_str, "/ 할일:", todo_text)

        # OLED 1: 오늘의 날짜 표시
        if display1:
            display1.fill(0)
            display1.text("=== TODAY DATE ===", 0, 0)
            display1.text(date_str, 0, 28)
            display1.show()

        # OLED 2: 할 일 표시 (할 일 없을 경우 "오늘도 화이팅!" 출력)
        if display2:
            display2.fill(0)
            display2.text("=== TODO LIST ===", 0, 0)
            if todo_text == "NONE" or todo_text == "" or todo_text == "undefined":
                display2.text("Today Fighting!", 0, 28) # 오늘도 화이팅!
            else:
                display2.text(todo_text[0:16], 0, 20)
                display2.text(todo_text[16:32], 0, 38)
            display2.show()

    # 'C'로 시작하는 RGB 무드 컬러 지정 (예: C#38BDF8)
    if v.startswith('C'):
        try:
            color_str = v[2:] if v[1] == '#' else v[1:]
            r_val = int(color_str[0:2], 16)
            g_val = int(color_str[2:4], 16)
            b_val = int(color_str[4:6], 16)
            
            if r_val > 127: R.on()
            else: R.off()
            if g_val > 127: G.on()
            else: G.off()
            if b_val > 127: B.on()
            else: B.off()
            print("💡 [BLE Command] RGB LED 컬러 세팅: R", r_val, "G", g_val, "B", b_val)
        except Exception as e:
            print("RGB color parse error:", e)

    # 'O1' / 'O2' / 'O3' OLED 화면 모드 전환 제어 명령
    if v == 'O1':
        print("🖥️ [BLE Command] OLED 모드: 날씨/온습도")
        current_display2_mode = 'sensor'
        current_oled_mode = 'O1'
        update_weather()
    elif v == 'O2':
        print("🖥️ [BLE Command] OLED 모드: 오늘의 영단어")
        current_oled_mode = 'O2'
    elif v == 'O3':
        print("🖥️ [BLE Command] OLED 모드: 오늘 날짜 및 할 일")
        current_oled_mode = 'O3'

    # 'B_AUTO:1' / 'B_AUTO:0' 조도 센서 기반 모터 자동 개방 옵션
    if v == 'B_AUTO:1':
        auto_blind_enabled = True
        print("🪟 [BLE Command] 조도 자동 블라인드 ON")
    elif v == 'B_AUTO:0':
        auto_blind_enabled = False
        print("🪟 [BLE Command] 조도 자동 블라인드 OFF")

    # 'H_ALERT:1' / 'H_ALERT:0' 스마트 습도 안내 경보 옵션
    if v == 'H_ALERT:1':
        humi_alert_enabled = True
        print("🌧️ [BLE Command] 스마트 습도 안내 경보 ON")
    elif v == 'H_ALERT:0':
        humi_alert_enabled = False
        humi_alert_active = False
        B.off()
        print("🌧️ [BLE Command] 스마트 습도 안내 경보 OFF")

    # 'H_TH:75' 형태의 스마트 습도 경보 기준치 설정
    if v.startswith('H_TH:'):
        try:
            humi_threshold = int(v[5:])
            print("🌧️ [BLE Command] 습도 경보 기준 설정:", humi_threshold, "%")
        except Exception as e:
            print("Humi threshold parse error:", e)

# 블루투스 수신 데이터 바인딩
p.on_write(on_rx)

print("🚀 JINJIN Smart Home ESP32 Ready! (Manual Sync & Silent Snore Alert Mode)")

# 메인 무한 루프
while True:
    # 1. 정전식 터치 센서 4핀 실시간 제어
    if touch1.value(): # 터치 1: 수면 모드 (Sleep Mode)
        if not mic_active:
            mic_active = True
            snore_count = 0
            snore_flag = False
            print("💤 [Touch 1] 수면 모드 시작 (불 다 끄기)")
            p.send("MODE:SLEEP\n")
            R.off(); G.off(); B.off()
            if display1:
                display1.fill(0)
                display1.text("=== SLEEP MODE ===", 0, 0)
                display1.text("Lights: OFF", 0, 20)
                display1.text("Snore Monitor: ON", 0, 40)
                display1.show()
            sleep(0.3)
        
    elif touch2.value(): # 터치 2: 기상 모드 (Wakeup Mode)
        mic_active = False
        snore_count = 0
        snore_flag = False
        buzzer.duty_u16(0)
        print("☀️ [Touch 2] 기상 모드 진입 (불 켜기 & 블라인드 180°)")
        p.send("MODE:WAKEUP\n")
        R.on(); G.on(); B.on()
        motor.move(180)
        if display1:
            display1.fill(0)
            display1.text("=== WAKEUP MODE ===", 0, 0)
            display1.text("Lights: ON", 0, 20)
            display1.text("Blind: 180 Open", 0, 40)
            display1.show()
        update_sensors_and_oled2()
        sleep(0.3)
    
    elif touch3.value(): # 터치 3: 집중 모드 (Focus Mode - 웹 5분 타이머 자동 시작)
        mic_active = False
        snore_count = 0
        buzzer.duty_u16(0)
        print("🧠 [Touch 3] 집중 모드 진입 (웹 5분 집중 타이머 & 백색소음 자동 실행)")
        p.send("MODE:FOCUS\n")
        R.on(); G.on(); B.off() # 따뜻한 무드등
        if display1:
            display1.fill(0)
            display1.text("=== FOCUS MODE ===", 0, 0)
            display1.text("Timer: 5 Mins", 0, 20)
            display1.text("ASMR: Web Active", 0, 40)
            display1.show()
        sleep(0.3)
        
    elif touch4.value(): # 터치 4: 모든 모드 OFF (All Modes OFF)
        mic_active = False
        snore_count = 0
        snore_flag = False
        buzzer.duty_u16(0)
        print("⚪ [Touch 4] 모든 모드 OFF (스마트홈 대기 상태)")
        p.send("MODE:OFF\n")
        R.off(); G.off(); B.off()
        if display1:
            display1.fill(0)
            display1.text("=== ALL MODES OFF ===", 0, 0)
            display1.text("JINJIN Smart Home", 0, 24)
            display1.show()
        sleep(0.3)

    # 2. 수면 모드 활성화 시 실시간 코골이 음성 샘플링 & 패턴 분석
    if mic_active:
        min_v = 4095
        max_v = 0
        for _ in range(150): # 고속 파형 샘플링
            v = mic_adc.read()
            if v < min_v: min_v = v
            if v > max_v: max_v = v
        
        sound_level = max_v - min_v
        
        # 코골이 음량 기준 (60 이상 시 코골이 펄스 카운트)
        if sound_level > 60:
            if not snore_flag:
                snore_count += 1
                snore_flag = True
                print(f"⚠️ [Snore Pulse] 코골이 소리 감지! ({snore_count}/3회)")
        else:
            snore_flag = False

        # 코골이 3회 연속 감지 시 (부저 울리지 않고 웹으로 조용히 SNORING_ALERT 카운팅 전송)
        if snore_count >= 3:
            print("🚨 [SNORING DETECTED] 코골이 3회 감지 (부저 소리 끄고 웹 카운팅만 전송)")
            p.send("SNORING_ALERT\n")
            
            if display1:
                display1.fill(0)
                display1.text("SNORE DETECTED", 0, 0)
                display1.text("Counting Sent...", 0, 20)
                display1.show()
            
            # 피에조 부저 소리는 울리지 않음 (요청사항 반영)
            snore_count = 0  # 감지 카운터 초기화
        elif display1:
            display1.fill(0)
            display1.text("Snore Monitor: ON", 0, 0)
            display1.text("Volume: " + str(sound_level), 0, 16)
            display1.text("Count: " + str(snore_count) + "/3", 0, 32)
            display1.show()
            
        p.send("Mic Level: " + str(sound_level) + "\n")
        sleep(0.1)
    else:
        sleep(0.3)