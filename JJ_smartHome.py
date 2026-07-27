from machine import ADC, Pin, PWM, SoftI2C
from time import sleep
from servo import Servo

import dht
import ble_library
import bluetooth

import ssd1306
import framebuf

# OpenWeatherMap API 키 설정
API_KEY = "225582847ec75d5bfc26517638e79c64"
CITY = "Seoul"
WEATHER_URL = "http://api.openweathermap.org/data/2.5/weather?q=" + CITY + "&appid=" + API_KEY + "&units=metric"

# 조도 센서 초기화 (LDR Pin 36)
cds = ADC(Pin(36))
cds.atten(ADC.ATTN_11DB)

cds_flag = 0

# 마이크(사운드) 센서 초기화 (ADC Pin 34)
mic_adc = ADC(Pin(34))
mic_adc.atten(ADC.ATTN_11DB)

mic_active = False
snore_count = 0
snore_flag = False

# 서보 모터 초기화 (Servo Pin 13)
motor = Servo(pin=13)

# 피에조 부저 초기화 (PWM Pin 23)
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

# 멜로디 정의 (주파수 Hz)
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

# 아기상어 멜로디 정의 (주파수 Hz, 음길이 초)
baby_shark_melody = [
    # 아-기-상-어 뚜 루룻 뚜 루
    (NOTE_D4, 0.3), (NOTE_E4, 0.3), (NOTE_G4, 0.3),
    (NOTE_G4, 0.15), (NOTE_G4, 0.15), (NOTE_G4, 0.15), (NOTE_G4, 0.25), (NOTE_G4, 0.15), (NOTE_G4, 0.15),

    # 아-기-상-어 뚜 루룻 뚜 루
    (NOTE_D4, 0.3), (NOTE_E4, 0.3), (NOTE_G4, 0.3),
    (NOTE_G4, 0.15), (NOTE_G4, 0.15), (NOTE_G4, 0.15), (NOTE_G4, 0.25), (NOTE_G4, 0.15), (NOTE_G4, 0.15),

    # 아-기-상-어 뚜 루룻 뚜 루
    (NOTE_D4, 0.3), (NOTE_E4, 0.3), (NOTE_G4, 0.3),
    (NOTE_G4, 0.15), (NOTE_G4, 0.15), (NOTE_G4, 0.15), (NOTE_G4, 0.25), (NOTE_G4, 0.15), (NOTE_G4, 0.15),

    # 아-기-상-어!
    (NOTE_G4, 0.3), (NOTE_G4, 0.3), (NOTE_FS4, 0.6)
]

# RGB LED 핀 정의 (빨강 Pin 25, 초록 Pin 26, 파랑 Pin 27)
R = Pin(25, Pin.OUT)
G = Pin(26, Pin.OUT)
B = Pin(27, Pin.OUT)

# 정전식 터치 센서 4핀 정의 (touch1 Pin 17, touch2 Pin 5, touch3 Pin 18, touch4 Pin 19)
touch1 = Pin(17, Pin.IN)
touch2 = Pin(5, Pin.IN)
touch3 = Pin(18, Pin.IN)
touch4 = Pin(19, Pin.IN)

# DHT11 온습도 센서 초기화 (Pin 14)
d = dht.DHT11(Pin(14))

# OLED 1번 디스플레이 초기화 (SDA Pin 21, SCL Pin 22 - 날씨 아이콘용)
display1 = None
try:
    i2c1 = SoftI2C(sda=Pin(21), scl=Pin(22))
    display1 = ssd1306.SSD1306_I2C(128, 64, i2c1)
    display1.fill(0)
    display1.show()
    print("OLED 1 (Pin 21, 22) Initialized")
except Exception as e:
    print("OLED 1 Init Error:", e)

# OLED 2번 디스플레이 초기화 (SDA Pin 4, SCL Pin 16 - 온습도 표시용)
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

# 날씨 API 파싱 및 OLED 1, 2번 연동 함수 (DHT11 타임아웃 예외 처리 포함)
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
        try:
            d.measure()
            temp_str = str(int(d.temperature()))
            humi_str = str(int(d.humidity()))
        except Exception as dht_err:
            print("DHT11 sensor timeout (using default):", dht_err)
            temp_str = "24"
            humi_str = "55"
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

# BLE 인스턴스 초기화 및 'ESP_JJ' 장치명으로 페어링 시작 (웹 검색 필터인 'ESP_' 매칭)
ble = bluetooth.BLE()
p = ble_library.BLESimplePeripheral(ble, "ESP_JJ")

# 블루투스 수신 이벤트 핸들러
def on_rx(v): 
    # bytes 타입으로 전달되는 경우 문자열로 안전하게 디코딩 및 공백 제거
    if isinstance(v, bytes):
        v = v.decode('utf-8').strip()
    else:
        v = str(v).strip()
        
    print("Received BLE Command:", v)
    # '1' 수신 시: OpenWeatherMap API 조회 -> OLED 1(날씨 그림), OLED 2(온습도) 표시
    if v == '1' or v == 'w' or v == 'weather':
        print("Fetching Weather...")
        temp, humi, weather = update_weather()
        
        # 웹 브라우저 대시보드 화면 동기화를 위해 블루투스 송신 (p.send)
        p.send("temp : " + temp + "\n")
        p.send("humi : " + humi + "\n")
        
    # '2' 수신 시: 1번 OLED(TV)에 조도 센서 측정값 표시 및 웹 브라우저로 블루투스 송신
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
            
        # 웹 브라우저 대시보드 화면 동기화를 위해 조도 값 블루투스 송신 (p.send)
        p.send(str(cds_value) + "\n")

    # '3' 수신 시: 1번 OLED 화면 켜기
    if v == '3':
        if display1:
            display1.poweron()
        
    # '4' 수신 시: 1번 OLED 화면 끄기
    if v == '4':
        if display1:
            display1.poweroff()
    
    # '5' 수신 시: 멜로디 1 (학교종) 스피커/부저 재생
    if v == '5':
        for i in melody1:
            play_tone(i, 0.5)
            sleep(0.05)

    # '6' 또는 '10' 또는 'shark' 수신 시: 아기상어 (Baby Shark) 멜로디 스피커/부저 재생
    if v == '6' or v == '10' or v == 'shark':
        for freq, duration in baby_shark_melody:
            play_tone(freq, duration)
            sleep(0.03)
    
    # '7' 수신 시: RGB LED 전체 켜기
    if v == '7':
        R.on()
        G.on()
        B.on()        
    
    # '8' 수신 시: RGB LED 전체 끄기
    if v == '8':
        R.off()
        G.off()
        B.off()    
    
    # '9' 수신 시: 2번 OLED에 Kitty PBM 단색 비트맵 이미지 드로잉
    if v == '9':
        with open('img/kitty.pbm', 'rb') as f:
            f.readline() # PBM 포맷 헤더 스킵
            f.readline() # 이미지 크기 헤더 스킵
            data = bytearray(f.read())
        fb = framebuf.FrameBuffer(data, 128, 64, framebuf.MONO_HLSB)
        if display2:
            display2.invert(0)
            display2.fill(0)
            display2.blit(fb, 0, 0)
            display2.show()

# 블루투스 수신 데이터 바인딩
p.on_write(on_rx)

# 메인 무한 루프
while True:
    # 조도 밝기 변화에 따른 모터 및 멜로디 동작
    cds_value = cds.read()
    
    if cds_value > 4000 and cds_flag == 1:
        for i in blindMelody:
            play_tone(i, 0.3)
        motor.move(180)
        cds_flag = 0       
        
    elif cds_value <= 4000 and cds_flag == 0:
        motor.move(90)
        cds_flag = 1 
        
    # 터치 센서 접촉 감지에 따른 실시간 LED 점등 및 피에조 부저 재생
    if touch1.value():
        if not mic_active:
            mic_active = True
            snore_count = 0
            snore_flag = False
            print("💤 [Snore Monitor] 코골이 감지 모드가 시작되었습니다. (Listening...)")
            p.send("Snore Monitor Started\n")
            R.on()
            G.off()
            B.off()
        
    elif touch2.value():
        if mic_active:
            mic_active = False
            snore_count = 0
            snore_flag = False
            print("💤 [Snore Monitor] 코골이 감지 모드가 종료되었습니다. (OFF)")
            if display1:
                display1.fill(0)
                display1.text("Snore Monitor OFF", 0, 0)
                display1.show()
            p.send("Snore Monitor OFF\n")
            R.off()
            G.off()
            B.off()
        else:
            print("Button 2 touched")
            R.on()
            G.on()
            B.off()
    
    elif touch3.value():
        print("Button 3 touched - Updating Weather")
        update_weather()
        R.on()
        G.off()
        B.on()
        
    elif touch4.value():
        print("🔔 [Piezo Buzzer Test] 피에조 부저 멜로디 연주 (Pin 23)!")
        p.send("Piezo Buzzer Test\n")
        R.on()
        G.on()
        B.on()
        
        if display1:
            display1.fill(0)
            display1.text("🔔 PIEZO BUZZER", 0, 0)
            display1.text("Playing Tone...", 0, 20)
            display1.text("Pin 23 Active", 0, 40)
            display1.show()
            
        # 피에조 부저 도-레-미-파-솔-라-시-도 8음계 멜로디 재생
        scale_notes = [NOTE_C4, NOTE_D4, NOTE_E4, NOTE_F4, NOTE_G4, NOTE_A4, NOTE_B4, NOTE_C5]
        for freq in scale_notes:
            play_tone(freq, 0.15)
            sleep(0.03)
        
        R.off()
        G.off()
        B.off()

    # 코골이 감지 모드 활성화 시 실시간 코골이 음성 및 패턴 분석
    if mic_active:
        min_v = 4095
        max_v = 0
        for _ in range(150): # 고속 파형 샘플링 (피크-투-피크)
            v = mic_adc.read()
            if v < min_v: min_v = v
            if v > max_v: max_v = v
        
        sound_level = max_v - min_v
        print("[Microphone Sound Level]:", sound_level)
        
        # 코골이 음량 기준 (60 이상 시 코골이 펄스 카운트)
        if sound_level > 60:
            if not snore_flag:
                snore_count += 1
                snore_flag = True
                print(f"⚠️ [Snore Pulse] 코골이 소리 감지! ({snore_count}/3회)")
        else:
            snore_flag = False

        # 코골이 3회 연속 감지 시 경보 및 베개 각도(서보 모터) 자동 조절
        if snore_count >= 3:
            print("🚨 [SNORING DETECTED] 경고: 코골이가 지속 발생했습니다! (베개 위치 조절)")
            p.send("SNORING_ALERT\n")
            
            if display1:
                display1.fill(0)
                display1.text("🚨 SNORE ALERT!", 0, 0)
                display1.text("Snoring Detected!", 0, 16)
                display1.text("Adjusting Pillow...", 0, 32)
                display1.show()
            
            # 서보 모터를 이용한 스마트 베개 위치 자동 변경
            motor.move(140)
            sleep(0.4)
            motor.move(90)
            
            # 피에조 부저 코골이 경보음 (440Hz 삐- 소리)
            play_tone(440, 0.3)
            
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
