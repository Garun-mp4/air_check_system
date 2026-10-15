#pragma once
#include "core.hpp"
#include "driver/i2c_master.h"
#include "driver/uart.h"
namespace aircheck {
class SensorDriver {
public:
    SensorDriver(unsigned index, i2c_master_bus_handle_t bus);
    Quality read(float* values, unsigned& count, uint64_t now);
private:
    unsigned index_;
    i2c_master_dev_handle_t device_ = nullptr;
    uart_port_t uart_ = UART_NUM_1;
    bool transport_ready_ = false, started_ = false;
    uint64_t ready_at_ = 0, retry_at_ = 0;
    Quality i2c_command(uint16_t command, uint16_t* words, unsigned count, unsigned delay_ms);
    int uart_command(uint8_t command, const uint8_t* payload, size_t length, uint8_t* output, size_t capacity);
};
}
