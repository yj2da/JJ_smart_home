from machine import ADC, Pin, PWM, SoftI2C, time_pulse_us
from time import sleep, ticks_ms, ticks_diff
from servo import Servo
from neopixel import NeoPixel

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
#           Ultrasonic Trig (12), Echo (32), OLED 1 (I2C 21, 22), OLED 2 (I2C 4, 16)
# ==========================================================================

# OpenWeatherMap API 키 설정 (Busan / Seoul)
API_KEY = "225582847ec75d5bfc26517638e79c64"
CITY = "Busan"
WEATHER_URL = "http://api.openweathermap.org/data/2.5/weather?q=" + CITY + "&appid=" + API_KEY + "&units=metric"

# 1. 조도 센서 초기화 (LDR Pin 36)
cds = ADC(Pin(36))
cds.atten(ADC.ATTN_11DB)
cds_flag = 0
auto_blind_enabled = False # 조도 자동 블라인드 연동 플래그 (기본 OFF)

# 1.1 초음파 센서 초기화 (HC-SR04: Trig Pin 12, Echo Pin 32) & 자동 기상 추적 (3cm 미만)
trig_pin = Pin(12, Pin.OUT)
echo_pin = Pin(32, Pin.IN)
auto_wakeup_enabled = True # 초음파 3cm 미만 자동 기상 추적 (기본 ON)
last_auto_wakeup_time = 0

def get_ultrasonic_distance():
    try:
        trig_pin.value(0)
        sleep(0.000002)
        trig_pin.value(1)
        sleep(0.00001)
        trig_pin.value(0)
        
        duration = time_pulse_us(echo_pin, 1, 20000)
        if duration < 0:
            return 999.0
        distance = (duration * 0.0343) / 2.0
        return distance
    except Exception as e:
        return 999.0

# 2. 마이크(사운드) 센서 초기화 (ADC Pin 34)
mic_adc = ADC(Pin(34))
mic_adc.atten(ADC.ATTN_11DB)

mic_active = False
snore_count = 0
snore_flag = False

# 3. 서보 모터 초기화 (Servo Pin 13)
motor = Servo(pin=13)
current_blind_angle = -1 # 현재 모터 각도 추적 변수

# 4. 피에조 부저 초기화 (PWM Pin 23)
buzzer = PWM(Pin(23))
buzzer.duty_u16(0)

# 피에조 부저 톤 재생 함수 (50% Duty Square Wave - 맑고 큰 부저 소리)
def play_tone(freq, duration):
    if freq <= 0:
        sleep(duration)
        return
    buzzer.freq(freq)
    buzzer.duty_u16(32768) # 50% duty_u16
    sleep(duration)
    buzzer.duty_u16(0)

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

# 멜로디 주파수 정의
blindMelody = (524, 659, 784)
melody1 = (784, 784, 880, 880, 784, 784, 659) # 학교종

# 루틴 시간 실행 시 상쾌한 피에조 부저 멜로디 (도-미-솔-도)
routine_chime_melody = [
    (NOTE_C4, 0.15), (NOTE_E4, 0.15), (NOTE_G4, 0.15), (NOTE_C5, 0.35)
]

# 아기상어 멜로디 (Baby Shark Melody)
melody2_baby_shark = [
    (NOTE_D4, 0.25), (NOTE_E4, 0.25), (NOTE_G4, 0.25), (NOTE_G4, 0.25), (NOTE_G4, 0.15), (NOTE_G4, 0.15), (NOTE_G4, 0.25),
    (NOTE_D4, 0.25), (NOTE_E4, 0.25), (NOTE_G4, 0.25), (NOTE_G4, 0.25), (NOTE_G4, 0.15), (NOTE_G4, 0.15), (NOTE_G4, 0.25),
    (NOTE_D4, 0.25), (NOTE_E4, 0.25), (NOTE_G4, 0.25), (NOTE_G4, 0.25), (NOTE_G4, 0.15), (NOTE_G4, 0.15), (NOTE_G4, 0.25),
    (NOTE_G4, 0.25), (NOTE_G4, 0.25), (NOTE_E4, 0.5)
]

# 5. NeoPixel LED 스트립 초기화 (Pin 15, 12개 LED) 및 습도 경보용 RGB LED 핀
neo_pin = Pin(15, Pin.OUT)
np = NeoPixel(neo_pin, 12)

# 습도 경보 전용 RGB LED (B.on() 유지)
R = Pin(25, Pin.OUT)
G = Pin(26, Pin.OUT)
B = Pin(27, Pin.OUT)

# NeoPixel 제어 헬퍼 함수 (RGB 모두 50을 MAX로 제한)
def set_neopixel_color(r, g, b):
    r_val = min(50, int(r * 50 / 255)) if r > 50 else min(50, max(0, int(r)))
    g_val = min(50, int(g * 50 / 255)) if g > 50 else min(50, max(0, int(g)))
    b_val = min(50, int(b * 50 / 255)) if b > 50 else min(50, max(0, int(b)))
    for i in range(12):
        np[i] = (r_val, g_val, b_val)
    np.write()

def neopixel_off():
    for i in range(12):
        np[i] = (0, 0, 0)
    np.write()

# 6. 정전식 터치 센서 4핀 정의 (touch1 Pin 17, touch2 Pin 5, touch3 Pin 18, touch4 Pin 19)
touch1 = Pin(17, Pin.IN)
touch2 = Pin(5, Pin.IN)
touch3 = Pin(18, Pin.IN)
touch4 = Pin(19, Pin.IN)

# 7. DHT11 온습도 센서 초기화 (Pin 14)
d = dht.DHT11(Pin(14))
humi_alert_enabled = False # 습도 경보 연동 플래그 (기본 OFF)
humi_threshold = 70        # 습도 경보 기준 (기본 70%)

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
    if not disp or not oled_power_state:
        return
    disp.fill(0)
    w = weather_type.lower()
    
    if 'clear' in w or 'sun' in w:
        disp.text("WEATHER: SUNNY", 8, 0)
        disp.fill_rect(54, 24, 20, 20, 1)
        disp.line(64, 14, 64, 20, 1)
        disp.line(64, 48, 64, 54, 1)
        disp.line(44, 34, 50, 34, 1)
        disp.line(78, 34, 84, 34, 1)
        disp.line(50, 20, 54, 24, 1)
        disp.line(74, 44, 78, 48, 1)
        disp.line(50, 48, 54, 44, 1)
        disp.line(74, 24, 78, 20, 1)
        disp.text("[ CLEAR SKY ]", 12, 54)
    elif 'rain' in w or 'drizzle' in w or 'thunder' in w:
        disp.text("WEATHER: RAINING", 0, 0)
        disp.fill_rect(40, 22, 48, 14, 1)
        disp.fill_rect(48, 16, 32, 12, 1)
        disp.line(48, 40, 44, 48, 1)
        disp.line(64, 40, 60, 48, 1)
        disp.line(80, 40, 76, 48, 1)
        disp.text("[ HEAVY RAIN ]", 8, 54)
    elif 'snow' in w:
        disp.text("WEATHER: SNOWING", 0, 0)
        disp.line(64, 18, 64, 48, 1)
        disp.line(49, 33, 79, 33, 1)
        disp.line(53, 22, 75, 44, 1)
        disp.line(53, 44, 75, 22, 1)
        disp.text("[ SNOWFALL ]", 16, 54)
    else:
        disp.text("WEATHER: CLOUDY", 4, 0)
        disp.fill_rect(36, 28, 56, 16, 1)
        disp.fill_rect(46, 20, 36, 14, 1)
        disp.fill_rect(56, 14, 16, 10, 1)
        disp.text("[ OVERCAST ]", 16, 54)
        
    disp.show()

# 부산 실시간 날씨 데이터 전역 변수
busan_temp_str = "24"
busan_humi_str = "58"

# 1회성 실내 센서 측정 & OLED 2 화면 갱신 함수 (OLED에는 부산 실시간 온습도 표시)
def update_sensors_and_oled2():
    global busan_temp_str, busan_humi_str
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
    
    # OLED 2 디스플레이 갱신 (센서 모드이고 OLED 전원이 ON 일 때 - HOME CONDITION 표시)
    if current_display2_mode == 'sensor' and display2 and oled_power_state:
        display2.fill(0)
        display2.text("=== HOME CONDITION ===", 0, 0)
        display2.text("Temp: " + temp_str + " C", 0, 16)
        display2.text("Humi: " + humi_str + " %", 0, 32)
        if h_val >= humi_threshold and humi_alert_enabled:
            display2.text("⚠️ HIGH HUMI!", 0, 48)
            B.on() # 고습도 경보 시 RGB LED 파란색 불 켜기!
        else:
            if not mic_active:
                pass
            display2.text("CDS: " + str(current_cds), 0, 48)
        display2.show()

    return temp_str, humi_str

# 날씨 API 파싱 및 OLED 1, 2번 연동 함수
def update_weather():
    global busan_temp_str, busan_humi_str
    temp_str = "24"
    humi_str = "58"
    weather_main = "Clouds"
    city_name = CITY
    
    if WEATHER_URL:
        try:
            import urequests
            res = urequests.get(WEATHER_URL)
            data = res.json()
            res.close()
            
            if isinstance(data, dict) and 'weather' in data and 'main' in data:
                weather_main = data['weather'][0]['main']
                temp_str = str(int(data['main']['temp']))
                humi_str = str(int(data['main']['humidity']))
                city_name = data.get('name', CITY)
                busan_temp_str = temp_str
                busan_humi_str = humi_str
                print("API Weather Fetch Success:", weather_main, temp_str + "C", humi_str + "%")
            else:
                s_res = update_sensors_and_oled2()
                if isinstance(s_res, tuple) and len(s_res) >= 2:
                    temp_str, humi_str = s_res[0], s_res[1]
        except Exception as e:
            print("Weather API Fallback Check:", e)
            try:
                s_res = update_sensors_and_oled2()
                if isinstance(s_res, tuple) and len(s_res) >= 2:
                    temp_str, humi_str = s_res[0], s_res[1]
            except Exception as dht_err:
                print("DHT Fallback Error:", dht_err)
    else:
        try:
            s_res = update_sensors_and_oled2()
            if isinstance(s_res, tuple) and len(s_res) >= 2:
                temp_str, humi_str = s_res[0], s_res[1]
        except Exception as dht_err:
            print("DHT Fallback Error:", dht_err)

    if display1 and oled_power_state:
        draw_weather_icon(display1, weather_main)

    if display2 and oled_power_state and current_display2_mode == 'sensor':
        display2.fill(0)
        display2.text("=== BUSAN WEATHER ===", 0, 0)
        display2.text("Temp: " + busan_temp_str + " C", 0, 16)
        display2.text("Humi: " + busan_humi_str + " %", 0, 32)
        display2.show()

    return temp_str, humi_str, weather_main

# 10. BLE 인스턴스 초기화 및 'ESP_JJ' 장치명으로 페어링 시작
ble = bluetooth.BLE()
p = ble_library.BLESimplePeripheral(ble, "ESP_JJ")

# OLED 화면 상태 및 캐시 데이터 전역 변수
current_oled_mode = 'O1'         # 'O1': 날씨/온습도, 'O2': 영단어, 'O3': 날짜/할일
current_display2_mode = 'sensor' # 'sensor': 온습도/조도, 'word': 영단어문장, 'todo': 할일목록, 'kitty': 키티
oled_power_state = True          # True: 화면 ON, False: 화면 OFF

cached_word_en = "SERENDIPITY"
cached_word_kr = "뜻밖의 행운"
cached_word_ex = "Finding joy in unexpected moments."

cached_todo_date = "TODAY"
cached_todo_text = "Today Fighting!"

# OLED 16자 자동 줄바꿈 헬퍼 함수
def wrap_text_16(text, max_lines=3):
    clean = ''.join([c if ord(c) < 128 else '' for c in text]).strip()
    words = clean.split(' ')
    lines = []
    current_line = ""
    for w in words:
        if not w:
            continue
        if len(current_line) + len(w) + (1 if current_line else 0) <= 16:
            current_line += (" " if current_line else "") + w
        else:
            if current_line:
                lines.append(current_line)
            current_line = w[:16]
            if len(lines) >= max_lines:
                break
    if current_line and len(lines) < max_lines:
        lines.append(current_line)
    return lines

# 영단어 카드 렌더링 함수
def render_word_card():
    if not oled_power_state: return
    if display1:
        display1.fill(0)
        display1.text("== WORD CARD ==", 4, 0)
        display1.text(cached_word_en[0:16], 0, 24)
        display1.text("[ VOCABULARY ]", 8, 48)
        display1.show()

    if display2:
        display2.fill(0)
        display2.text("TODAY'S SENTENCE", 0, 0)
        lines = wrap_text_16(cached_word_ex, 3)
        y_offsets = [18, 32, 46]
        for idx, line_str in enumerate(lines):
            display2.text(line_str, 0, y_offsets[idx])
        display2.show()

# 할 일 카드 렌더링 함수
def render_todo_card():
    if not oled_power_state: return
    if display1:
        display1.fill(0)
        display1.text("=== TODAY DATE ===", 0, 0)
        display1.text(cached_todo_date[0:16], 4, 24)
        display1.text("[ JINJIN HOME ]", 4, 48)
        display1.show()

    if display2:
        display2.fill(0)
        display2.text("=== TODO LIST ===", 4, 0)
        clean_todo = ''.join([c if ord(c) < 128 else '' for c in cached_todo_text]).strip()
        if not clean_todo or clean_todo == "NONE":
            display2.text("Today Fighting!", 4, 20)
            display2.text("Good Luck Today!", 0, 36)
            display2.text("Have a Nice Day!", 0, 50)
        else:
            lines = wrap_text_16(clean_todo, 3)
            y_offsets = [18, 32, 46]
            for idx, line_str in enumerate(lines):
                display2.text(line_str, 0, y_offsets[idx])
        display2.show()

# 블루투스 수신 이벤트 핸들러
def on_rx(v): 
    global current_oled_mode, current_display2_mode, auto_blind_enabled, humi_alert_enabled, humi_threshold
    global oled_power_state, cached_word_en, cached_word_kr, cached_word_ex, cached_todo_date, cached_todo_text
    global mic_active, snore_count, snore_flag, current_blind_angle

    if isinstance(v, bytes):
        try:
            v = v.decode('utf-8', 'ignore').strip()
        except Exception:
            try:
                v = str(v, 'utf-8').strip()
            except Exception:
                v = str(v).strip()
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
        
    # '2' 수신 시: 1번 OLED에 조도 센서 측정값 1회 표시 및 웹 송신
    if v == '2':
        cds_value = cds.read()
        if display1 and oled_power_state:
            display1.fill(0)
            display1.text("CDS: " + str(cds_value), 0, 0)
            if cds_value > 2500:   
                display1.text("It's dark", 0, 16)
            else:
                display1.text("It's bright", 0, 16)
            display1.show()
        p.send(str(cds_value) + "\n")

    # '3' / '4' 또는 'OLED_ON' / 'OLED_OFF' 수신 시: OLED 디스플레이 화면 전원 켜기 / 끄기
    if v == '3' or v == 'OLED_ON':
        oled_power_state = True
        if display1: display1.poweron()
        if display2: display2.poweron()
        print("📺 [BLE Command] OLED 디스플레이 전원 ON")
        if current_oled_mode == 'O1': update_weather()
        elif current_oled_mode == 'O2': render_word_card()
        elif current_oled_mode == 'O3': render_todo_card()

    if v == '4' or v == 'OLED_OFF':
        oled_power_state = False
        if display1: display1.poweroff()
        if display2: display2.poweroff()
        print("📺 [BLE Command] OLED 디스플레이 전원 OFF")
    
    # '5' 또는 'R_CHIME' 수신 시: 상쾌한 기상/루틴 알림 피에조 부저 멜로디 연주
    if v == '5' or v == 'F_ALARM' or v == 'R_CHIME':
        print("🔔 [Piezo Buzzer] 루틴 알림 상쾌한 멜로디 재생 (도-미-솔-도)")
        for freq, dur in routine_chime_melody:
            play_tone(freq, dur)
            sleep(0.04)

    # '6' 또는 'BABY_SHARK' 수신 시: 아기상어 멜로디 연주
    if v == '6' or v == 'BABY_SHARK' or v == 'shark':
        print("🦈 [Piezo Buzzer] 아기상어 멜로디 재생")
        for freq, dur in melody2_baby_shark:
            play_tone(freq, dur)
            sleep(0.03)

    # '7' / '8' 수신 시: NeoPixel 조명 전체 켜기 / 전체 끄기
    if v == '7':
        set_neopixel_color(50, 50, 50)
        print("💡 [BLE Command] NeoPixel 조명 ON (Max 50)")
    if v == '8':
        neopixel_off()
        print("🌙 [BLE Command] NeoPixel 조명 OFF")
    
    # '9' 수신 시: 2번 OLED에 Kitty PBM 이미지 드로잉
    if v == '9':
        current_display2_mode = 'kitty'
        try:
            with open('img/kitty.pbm', 'rb') as f:
                f.readline(); f.readline()
                data = bytearray(f.read())
            fb = framebuf.FrameBuffer(data, 128, 64, framebuf.MONO_HLSB)
            if display2 and oled_power_state:
                display2.invert(0)
                display2.fill(0)
                display2.blit(fb, 0, 0)
                display2.show()
        except Exception as img_err:
            print("Kitty PBM image load error:", img_err)

    # 'S' 수신 시: 수면 모드 시작 -> 불 다 끄기 (NeoPixel OFF) & 블라인드 90° 닫기
    if v == 'S':
        mic_active = True
        snore_count = 0
        snore_flag = False
        print("💤 [BLE Command] 수면 모드 시작 -> 불 다 끄기 & 블라인드 90° 닫기")
        p.send("Snore Monitor Started\n")
        neopixel_off()
        R.off(); G.off()
        motor.move(90)
        current_blind_angle = 90
        if display1 and oled_power_state:
            display1.fill(0)
            display1.text("=== SLEEP MODE ===", 0, 0)
            display1.text("Lights: OFF", 0, 16)
            display1.text("Blind: 90 Closed", 0, 32)
            display1.text("Snore Monitor: ON", 0, 48)
            display1.show()

    # 'Q' 수신 시: 기상 모드 진입 -> 불 켜기 (NeoPixel ON) & 블라인드 180° 개방
    if v == 'Q':
        mic_active = False
        snore_count = 0
        snore_flag = False
        buzzer.duty_u16(0)
        print("☀️ [BLE Command] 기상 모드 진입 -> 불 켜기 (NeoPixel ON) & 블라인드 180° 개방")
        p.send("Snore Monitor OFF\n")
        set_neopixel_color(50, 50, 50)
        R.off(); G.off()
        motor.move(180)
        current_blind_angle = 180
        if display1 and oled_power_state:
            display1.fill(0)
            display1.text("=== WAKEUP MODE ===", 0, 0)
            display1.text("Lights: ON", 0, 16)
            display1.text("Blind: 180 Open", 0, 32)
            display1.show()
        update_sensors_and_oled2()

    # 'A' 수신 시: 부저 알람 즉시 끄기
    if v == 'A':
        buzzer.duty_u16(0)
        print("🔔 [BLE Command] 부저 알람 즉시 끄기 완료")

    # 'M'으로 시작하는 서보 모터 직접 제어 (예: M90, M180, M0)
    if v.startswith('M'):
        try:
            angle = int(v[1:])
            motor.move(angle)
            current_blind_angle = angle
            print("📐 [BLE Command] 서보 모터 각도:", angle)
        except Exception as e:
            print("Motor angle parse error:", e)

    # 'W:'로 시작하는 오늘의 영단어 & 활용 문장 수신
    if v.startswith('W:'):
        current_oled_mode = 'O2'
        current_display2_mode = 'word'
        parts = v[2:].split('|')
        cached_word_en = parts[0] if len(parts) > 0 else "WORD"
        cached_word_kr = parts[1] if len(parts) > 1 else ""
        cached_word_ex = parts[2] if len(parts) > 2 else "Finding joy!"
        print("📚 [BLE Command] Word:", cached_word_en, "/ Ex:", cached_word_ex)
        render_word_card()

    # 'T:'로 시작하는 오늘의 날짜 & 할 일 수신
    if v.startswith('T:'):
        current_oled_mode = 'O3'
        current_display2_mode = 'todo'
        parts = v[2:].split('|')
        cached_todo_date = parts[0] if len(parts) > 0 else "DATE"
        cached_todo_text = parts[1] if len(parts) > 1 else "NONE"
        print("📅 [BLE Command] Date:", cached_todo_date, "/ Todo:", cached_todo_text)
        render_todo_card()

    # 'C'로 시작하는 NeoPixel 무드 컬러 지정 (RGB 50 MAX 제한)
    if v.startswith('C'):
        try:
            color_str = v[2:] if v[1] == '#' else v[1:]
            r_val = int(color_str[0:2], 16)
            g_val = int(color_str[2:4], 16)
            b_val = int(color_str[4:6], 16)
            set_neopixel_color(r_val, g_val, b_val)
            print("💡 [BLE Command] NeoPixel 컬러 세팅: R", r_val, "G", g_val, "B", b_val)
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
        current_display2_mode = 'word'
        current_oled_mode = 'O2'
        render_word_card()
    elif v == 'O3':
        print("🖥️ [BLE Command] OLED 모드: 오늘 날짜 및 할 일")
        current_display2_mode = 'todo'
        current_oled_mode = 'O3'
        render_todo_card()

    # 'B_WX:'로 시작하는 부산 실시간 OpenWeatherMap API 날씨/온습도 수신
    if v.startswith('B_WX:'):
        try:
            parts = v[5:].split('|')
            busan_temp_str = parts[0]
            busan_humi_str = parts[1]
            weather_main = parts[2] if len(parts) > 2 else "Clear"
            print("🌤️ [BLE Weather Sync] Busan Temp:", busan_temp_str, "C | Humi:", busan_humi_str, "%")

            if display1 and oled_power_state:
                draw_weather_icon(display1, weather_main)

            if display2 and oled_power_state:
                display2.fill(0)
                display2.text("=== BUSAN WEATHER ===", 0, 0)
                display2.text("Temp: " + busan_temp_str + " C", 0, 16)
                display2.text("Humi: " + busan_humi_str + " %", 0, 32)
                display2.show()
        except Exception as wx_err:
            print("B_WX Weather parse error:", wx_err)

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

    # 'W_AUTO:1' / 'W_AUTO:0' 초음파 3cm 미만 자동 기상 추적 옵션
    if v == 'W_AUTO:1':
        auto_wakeup_enabled = True
        print("☀️ [BLE Command] 초음파 3cm 미만 자동 기상 추적 ON")
    elif v == 'W_AUTO:0':
        auto_wakeup_enabled = False
        print("☀️ [BLE Command] 초음파 3cm 미만 자동 기상 추적 OFF")

# 블루투스 수신 데이터 바인딩
p.on_write(on_rx)

print("🚀 JINJIN Smart Home ESP32 Ready! (Manual Sync & Silent Snore Alert Mode)")

last_dht_print_time = ticks_ms()

# 메인 무한 루프
while True:
    current_ms = ticks_ms()

    # 0. 10초 주기 온습도 및 조도 쉘 콘솔 로그 출력
    if ticks_diff(current_ms, last_dht_print_time) >= 10000:
        last_dht_print_time = current_ms
        t_str, h_str = update_sensors_and_oled2()
        c_val = cds.read()
        print("🌡️ [DHT11 10s Log] 온도: " + t_str + "°C | 습도: " + h_str + "% | 조도(CDS): " + str(c_val))

    # 1. 정전식 터치 센서 4핀 실시간 제어
    if touch1.value(): # 터치 1: 수면 모드 (Sleep Mode - 불 끄기 & 블라인드 90°)
        if not mic_active:
            mic_active = True
            snore_count = 0
            snore_flag = False
            print("💤 [Touch 1] 수면 모드 시작 (불 다 끄기 & 블라인드 90°)")
            p.send("MODE:SLEEP\n")
            neopixel_off()
            R.off(); G.off()
            motor.move(90)
            current_blind_angle = 90
            if display1 and oled_power_state:
                display1.fill(0)
                display1.text("=== SLEEP MODE ===", 0, 0)
                display1.text("Lights: OFF", 0, 16)
                display1.text("Blind: 90 Closed", 0, 32)
                display1.text("Snore Monitor: ON", 0, 48)
                display1.show()
            sleep(0.3)
        
    elif touch2.value(): # 터치 2: 기상 모드 (Wakeup Mode - NeoPixel 켜기 & 블라인드 180°)
        mic_active = False
        snore_count = 0
        snore_flag = False
        buzzer.duty_u16(0)
        print("☀️ [Touch 2] 기상 모드 진입 (NeoPixel ON & 블라인드 180°)")
        p.send("MODE:WAKEUP\n")
        set_neopixel_color(50, 50, 50)
        R.off(); G.off()
        motor.move(180)
        current_blind_angle = 180
        if display1 and oled_power_state:
            display1.fill(0)
            display1.text("=== WAKEUP MODE ===", 0, 0)
            display1.text("Lights: ON", 0, 16)
            display1.text("Blind: 180 Open", 0, 32)
            display1.show()
        update_sensors_and_oled2()
        sleep(0.3)
    
    elif touch3.value(): # 터치 3: 집중 모드 (NeoPixel 웜톤 ON)
        mic_active = False
        snore_count = 0
        buzzer.duty_u16(0)
        print("🧠 [Touch 3] 집중 모드 진입")
        p.send("MODE:FOCUS\n")
        set_neopixel_color(50, 40, 0)
        R.off(); G.off()
        if display1 and oled_power_state:
            display1.fill(0)
            display1.text("=== FOCUS MODE ===", 0, 0)
            display1.text("Timer: 5 Mins", 0, 20)
            display1.text("ASMR: Web Active", 0, 40)
            display1.show()
        sleep(0.3)
        
    elif touch4.value(): # 터치 4: 모든 모드 OFF (NeoPixel OFF)
        mic_active = False
        snore_count = 0
        snore_flag = False
        buzzer.duty_u16(0)
        print("⚪ [Touch 4] 모든 모드 OFF (스마트홈 대기 상태)")
        p.send("MODE:OFF\n")
        neopixel_off()
        R.off(); G.off()
        if display1 and oled_power_state:
            display1.fill(0)
            display1.text("=== ALL MODES OFF ===", 0, 0)
            display1.text("JINJIN Smart Home", 0, 24)
            display1.show()
        sleep(0.3)

    # 2. 조도 센서 기반 자동 블라인드 제어 (수면 모드가 아닐 때)
    if auto_blind_enabled and not mic_active:
        c_val = cds.read()
        if c_val > 2500 and current_blind_angle != 180:
            motor.move(180)
            current_blind_angle = 180
            print("🌙 [Auto Blind] 어두워짐 (CDS: " + str(c_val) + ") -> 블라인드 180° 열기")
        elif c_val < 1500 and current_blind_angle != 90:
            motor.move(90)
            current_blind_angle = 90
            print("☀️ [Auto Blind] 밝아짐 (CDS: " + str(c_val) + ") -> 블라인드 90° 닫기")

    # 2.1 초음파 센서 감지: 근접(10cm 미만) 시 기상 모드 자동 활성화 (auto_wakeup_enabled ON 일 때)
    if auto_wakeup_enabled:
        dist_cm = get_ultrasonic_distance()
        if 0.1 <= dist_cm <= 10.0:
            if ticks_diff(current_ms, last_auto_wakeup_time) > 5000:
                last_auto_wakeup_time = current_ms
                print("☀️ [Auto Wakeup] 초음파 센서 근접 감지 (" + str(round(dist_cm, 1)) + "cm) -> 기상모드 자동 활성화!")
                p.send("AUTO_WAKEUP_TRIGGERED\n")
                p.send("MODE:WAKEUP\n")
                mic_active = False
                snore_count = 0
                snore_flag = False
                buzzer.duty_u16(0)
                set_neopixel_color(50, 50, 50)
                R.off(); G.off()
                motor.move(180)
                current_blind_angle = 180
                if display1 and oled_power_state:
                    display1.fill(0)
                    display1.text("=== AUTO WAKEUP ===", 0, 0)
                    display1.text("Distance: " + str(round(dist_cm, 1)) + "cm", 0, 16)
                    display1.text("Blind: 180 Open", 0, 32)
                    display1.text("Lights: ON", 0, 48)
                    display1.show()
                for freq in melody1:
                    play_tone(freq, 0.12)
                    sleep(0.05)

    # 3. 수면 모드 활성화 시 실시간 코골이 음성 샘플링 & 패턴 분석
    if mic_active:
        min_v = 4095
        max_v = 0
        for _ in range(150):
            v = mic_adc.read()
            if v < min_v: min_v = v
            if v > max_v: max_v = v
        
        sound_level = max_v - min_v
        
        if sound_level > 60:
            if not snore_flag:
                snore_count += 1
                snore_flag = True
                print(f"⚠️ [Snore Pulse] 코골이 소리 감지! ({snore_count}/3회)")
        else:
            snore_flag = False

        if snore_count >= 3:
            print("🚨 [SNORING DETECTED] 코골이 3회 감지")
            p.send("SNORING_ALERT\n")
            
            if display1 and oled_power_state:
                display1.fill(0)
                display1.text("SNORE DETECTED", 0, 0)
                display1.text("Counting Sent...", 0, 20)
                display1.show()
            
            snore_count = 0
        elif display1 and oled_power_state:
            display1.fill(0)
            display1.text("Snore Monitor: ON", 0, 0)
            display1.text("Volume: " + str(sound_level), 0, 16)
            display1.text("Count: " + str(snore_count) + "/3", 0, 32)
            display1.show()
            
        p.send("Mic Level: " + str(sound_level) + "\n")
        sleep(0.1)
    else:
        sleep(0.3)