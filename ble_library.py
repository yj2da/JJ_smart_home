# ==========================================================================
# MicroPython BLE Simple Peripheral Library (ble_library.py)
# Safe UTF-8 Exception Handling for ESP32 UART GATT Service
# ==========================================================================
import bluetooth
import struct

_ADV_TYPE_FLAGS = const(0x01)
_ADV_TYPE_NAME = const(0x09)
_ADV_TYPE_UUID16_COMPLETE = const(0x3)
_ADV_TYPE_UUID32_COMPLETE = const(0x5)
_ADV_TYPE_UUID128_COMPLETE = const(0x7)
_ADV_TYPE_APPEARANCE = const(0x19)

# Nordic UART Service (NUS) UUIDs
_UART_UUID = bluetooth.UUID("6E400001-B5A3-F393-E0A9-E50E24DCCA9E")
_UART_TX = (
    bluetooth.UUID("6E400003-B5A3-F393-E0A9-E50E24DCCA9E"),
    bluetooth.FLAG_READ | bluetooth.FLAG_NOTIFY,
)
_UART_RX = (
    bluetooth.UUID("6E400002-B5A3-F393-E0A9-E50E24DCCA9E"),
    bluetooth.FLAG_WRITE | bluetooth.FLAG_WRITE_NO_RESPONSE,
)
_UART_SERVICE = (
    _UART_UUID,
    (_UART_TX, _UART_RX),
)

def advertising_payload(limited_disc=False, br_edr=False, name=None, services=None, appearance=0):
    payload = bytearray()

    def _append(adv_type, value):
        nonlocal payload
        payload.extend(struct.pack("BB", len(value) + 1, adv_type))
        payload.extend(value)

    flags = (0x02 if limited_disc else 0x06) if not br_edr else 0x04
    _append(_ADV_TYPE_FLAGS, struct.pack("B", flags))

    if name:
        _append(_ADV_TYPE_NAME, name.encode("utf-8"))

    if services:
        for uuid in services:
            b = bytes(uuid)
            if len(b) == 2:
                _append(_ADV_TYPE_UUID16_COMPLETE, b)
            elif len(b) == 4:
                _append(_ADV_TYPE_UUID32_COMPLETE, b)
            elif len(b) == 16:
                _append(_ADV_TYPE_UUID128_COMPLETE, b)

    if appearance:
        _append(_ADV_TYPE_APPEARANCE, struct.pack("<H", appearance))

    return payload


class BLESimplePeripheral:
    def __init__(self, ble, name="ESP_JJ"):
        self._ble = ble
        self._ble.active(True)
        self._ble.irq(self._irq)
        ((self._handle_tx, self._handle_rx),) = self._ble.gatts_register_services((_UART_SERVICE,))
        self._connections = set()
        self._write_callback = None
        self._payload = advertising_payload(name=name, services=[_UART_UUID])
        self._advertise()

    def _irq(self, event, data):
        if event == 1: # _IRQ_CENTRAL_CONNECT
            conn_handle, _, _ = data
            print("New connection", conn_handle)
            self._connections.add(conn_handle)
        elif event == 2: # _IRQ_CENTRAL_DISCONNECT
            conn_handle, _, _ = data
            print("Disconnected", conn_handle)
            try:
                self._connections.remove(conn_handle)
            except Exception:
                pass
            self._advertise()
        elif event == 3: # _IRQ_GATTS_WRITE
            conn_handle, value_handle = data
            value = self._ble.gatts_read(value_handle)
            if value_handle == self._handle_rx and self._write_callback:
                try:
                    self._write_callback(value)
                except Exception as rx_err:
                    print("BLE RX IRQ Callback Safe Catch Error:", rx_err)

    def send(self, data):
        if not self._connections:
            return
        if isinstance(data, str):
            data = data.encode('utf-8')
        for conn_handle in self._connections:
            try:
                self._ble.gatts_notify(conn_handle, self._handle_tx, data)
            except Exception as send_err:
                print("BLE Send Error:", send_err)

    def is_connected(self):
        return len(self._connections) > 0

    def on_write(self, callback):
        self._write_callback = callback

    def _advertise(self, interval_us=500000):
        print("Starting advertising")
        self._ble.gap_advertise(interval_us, adv_data=self._payload)
