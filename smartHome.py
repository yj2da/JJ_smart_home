from machine import ADC, Pin, PWM, SoftI2C
from time import sleep
from servo import Servo

import dht
import ble_library
import bluetooth

import ssd1306
import framebuf

# 조도 센서 초기화 (LDR Pin 36)
cds = ADC(Pin(36))
cds.atten(ADC.ATTN_11DB)

cds_flag = 0

# 서보 모터 초기화 (Servo Pin 13)
motor = Servo(pin=13)

# 스피커 초기화 (PWM Pin 23)
speaker = PWM(Pin(23))
speaker.duty_u16(0)

# 멜로디 정의 (주파수 Hz)
blindMelody = (524, 659, 784)
melody1 = (784, 784, 880, 880, 784, 784, 659) # 학교종

# 음계 정의 (아기상어용)
NOTE_D4 = 294
NOTE_E4 = 330
NOTE_FS4 = 370
NOTE_G4 = 392

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

# I2C 통신 및 안전한 OLED 동적 감지
i2c = SoftI2C(sda=Pin(21), scl=Pin(22))
devices = i2c.scan()
print("Detected I2C addresses:", [hex(a) for a in devices])

display1 = None
display2 = None

# 0x3C 주소 OLED 디스플레이 초기화
if 0x3c in devices:
    try:
        display1 = ssd1306.SSD1306_I2C(128, 64, i2c, addr=0x3c)
        display1.fill(0)
        display1.show()
    except Exception as e:
        print("OLED 0x3c init error:", e)

# 0x3D 주소 OLED 디스플레이 초기화 (없으면 0x3C 디스플레이 공유)
if 0x3d in devices:
    try:
        display2 = ssd1306.SSD1306_I2C(128, 64, i2c, addr=0x3d)
        display2.fill(0)
        display2.show()
    except Exception as e:
        print("OLED 0x3d init error:", e)
        display2 = display1
else:
    display2 = display1

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
    # '1' 수신 시: 1번 OLED(TV)에 현재 온습도 표시 및 웹 브라우저로 블루투스 송신
    if v == '1':
        print("1")
        
        # 온습도 측정
        d.measure()
        temp = str(int(d.temperature()))
        humi = str(int(d.humidity()))
        
        if display1:
            display1.fill(0)
            display1.text("Temp: " + temp + " C", 0, 0)
            display1.text("Humi: " + humi + " %", 0, 16)
            display1.show()
        
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
    
    # '5' 수신 시: 멜로디 1 (학교종) 스피커 재생
    if v == '5':
        speaker.duty_u16(1000)
        for i in melody1:
            speaker.freq(i)
            sleep(0.5)
        speaker.duty_u16(0) 

    # '6' 또는 '10' 또는 'shark' 수신 시: 아기상어 (Baby Shark) 멜로디 스피커 재생
    if v == '6' or v == '10' or v == 'shark':
        for freq, duration in baby_shark_melody:
            speaker.freq(freq)
            speaker.duty_u16(1000)
            sleep(duration)
            speaker.duty_u16(0)
            sleep(0.03) # 음 간격
        speaker.duty_u16(0) 
    
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
        speaker.duty_u16(1000)
        for i in blindMelody:
            speaker.freq(i)
            sleep(0.3)
        speaker.duty_u16(0) 
        motor.move(180)
        cds_flag = 0       
        
    elif cds_value <= 4000 and cds_flag == 0:
        motor.move(90)
        cds_flag = 1 
        
    # 터치 센서 접촉 감지에 따른 실시간 LED 점등 스위칭
    if touch1.value():
        print("Button 1 touched")
        R.on()
        G.off()
        B.off()
        
    elif touch2.value():
        print("Button 2 touched")
        R.on()
        G.on()
        B.off()
    
    elif touch3.value():
        print("Button 3 touched")
        R.on()
        G.off()
        B.on()
        
    elif touch4.value():
        print("Button 4 touched")
        R.off()
        G.off()
        B.off()

    sleep(0.5)
