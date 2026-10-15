#include "sensor_protocol.hpp"
#include <cstring>
namespace aircheck {
uint8_t crc8(const uint8_t* bytes, size_t length) {
    uint8_t crc = 0xff;
    for (size_t i = 0; i < length; ++i) { crc ^= bytes[i]; for (int b = 0; b < 8; ++b) crc = (crc & 0x80) ? (crc << 1) ^ 0x31 : crc << 1; }
    return crc;
}
bool decode_words(const uint8_t* b, size_t length, uint16_t* out, size_t words) {
    if (length != words * 3) return false;
    for (size_t i = 0; i < words; ++i) { if (crc8(b + 3*i, 2) != b[3*i+2]) return false; out[i] = (b[3*i] << 8) | b[3*i+1]; }
    return true;
}
static bool escaped(uint8_t b) { return b == 0x7e || b == 0x7d || b == 0x11 || b == 0x13; }
size_t shdlc_encode(uint8_t command, const uint8_t* data, size_t length, uint8_t* out, size_t capacity) {
    if (length > 255 || capacity < 2) return 0;
    size_t pos = 0; out[pos++] = 0x7e;
    auto put = [&](uint8_t b) { if (pos + (escaped(b) ? 2 : 1) >= capacity) return false; if (escaped(b)) { out[pos++] = 0x7d; out[pos++] = b ^ 0x20; } else out[pos++] = b; return true; };
    uint8_t sum = command + length;
    if (!put(0) || !put(command) || !put(length)) return 0;
    for (size_t i = 0; i < length; ++i) { sum += data[i]; if (!put(data[i])) return 0; }
    if (!put(~sum)) return 0;
    out[pos++] = 0x7e; return pos;
}
int shdlc_decode(const uint8_t* frame, size_t length, uint8_t command, uint8_t* out, size_t capacity) {
    if (length < 7 || frame[0] != 0x7e || frame[length-1] != 0x7e) return -1;
    uint8_t b[260]; size_t n = 0;
    for (size_t i = 1; i + 1 < length; ++i) {
        uint8_t v = frame[i];
        if (v == 0x7e || n == sizeof(b)) return -1;
        if (v == 0x7d) { if (++i + 1 >= length) return -1; v = frame[i] ^ 0x20; if (!escaped(v)) return -1; }
        b[n++] = v;
    }
    if (n < 5 || b[0] != 0 || b[1] != command || b[2] != 0 || n != static_cast<size_t>(b[3]) + 5 || b[3] > capacity) return -1;
    uint8_t sum = 0; for (size_t i = 0; i < n; ++i) sum += b[i];
    if (sum != 0xff) return -1;
    std::memcpy(out, b + 4, b[3]); return b[3];
}
float big_endian_float(const uint8_t* b) { uint32_t bits = (uint32_t(b[0]) << 24) | (uint32_t(b[1]) << 16) | (uint32_t(b[2]) << 8) | b[3]; float f; std::memcpy(&f, &bits, 4); return f; }
}
