#pragma once
#include <cstddef>
#include <cstdint>
namespace aircheck {
uint8_t crc8(const uint8_t* bytes, size_t length);
bool decode_words(const uint8_t* bytes, size_t length, uint16_t* output, size_t words);
size_t shdlc_encode(uint8_t command, const uint8_t* data, size_t length, uint8_t* output, size_t capacity);
// Returns payload length, or -1 for malformed/CRC/state error. Response must match command.
int shdlc_decode(const uint8_t* frame, size_t length, uint8_t command, uint8_t* output, size_t capacity);
float big_endian_float(const uint8_t* bytes);
}
