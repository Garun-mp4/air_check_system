"""LAN SNTP from the server's UTC clock. No external network dependency."""
import os
import socket
import struct
import time

EPOCH = 2208988800
def stamp(unix):
    whole = int(unix)
    return struct.pack('!II', (whole + EPOCH) & 0xffffffff, int((unix - whole) * (1 << 32)))

def response(packet, received, transmitted):
    if len(packet) < 48 or len(packet) > 512 or packet[0] & 7 != 3 or packet[0] >> 3 & 7 not in (3,4): return None
    if received < 1700000000 or transmitted < received: return None
    result = bytearray(48)
    result[0] = 4 << 3 | 4
    result[1] = 2
    result[2] = min(packet[2], 10)
    result[3] = 0xec
    result[12:16] = b'LOCL'
    result[16:24] = stamp(received)
    result[24:32] = packet[40:48]
    result[32:40] = stamp(received)
    result[40:48] = stamp(transmitted)
    return bytes(result)

def main():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(('0.0.0.0', int(os.environ.get('NTP_PORT', '8123'))))
    clients = {}
    while True:
        packet, address = sock.recvfrom(513)
        received, monotonic = time.time(), time.monotonic()
        previous = clients.get(address[0], 0)
        if monotonic - previous < .25: continue
        if len(clients) >= 512 and address[0] not in clients: clients.clear()
        clients[address[0]] = monotonic
        result = response(packet, received, time.time())
        if result: sock.sendto(result, address)

if __name__ == '__main__': main()
