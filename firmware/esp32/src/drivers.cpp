#include "drivers.hpp"
#include "board.hpp"
#include "sensor_protocol.hpp"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <algorithm>
#include <cmath>
namespace aircheck {
SensorDriver::SensorDriver(unsigned index, i2c_master_bus_handle_t bus) : index_(index) {
#if defined(AIRCHECK_FAKE_SENSORS)
    transport_ready_ = true;
#else
    if (index < 2 && bus) {
        i2c_device_config_t config{}; config.dev_addr_length=I2C_ADDR_BIT_LEN_7;
        config.device_address=index==0?0x62:0x44; config.scl_speed_hz=board::i2c_hz;
        transport_ready_ = i2c_master_bus_add_device(bus,&config,&device_)==ESP_OK;
    } else if (index >= 2) {
        uart_=index==2?UART_NUM_1:UART_NUM_2;
        uart_config_t config{}; config.baud_rate=115200; config.data_bits=UART_DATA_8_BITS;
        config.parity=UART_PARITY_DISABLE; config.stop_bits=UART_STOP_BITS_1;
        config.flow_ctrl=UART_HW_FLOWCTRL_DISABLE; config.source_clk=UART_SCLK_DEFAULT;
        transport_ready_=uart_param_config(uart_,&config)==ESP_OK &&
            uart_set_pin(uart_,index==2?board::indoor_uart_tx:board::outdoor_uart_tx,index==2?board::indoor_uart_rx:board::outdoor_uart_rx,UART_PIN_NO_CHANGE,UART_PIN_NO_CHANGE)==ESP_OK &&
            uart_driver_install(uart_,1024,0,0,nullptr,0)==ESP_OK;
    }
#endif
}
Quality SensorDriver::i2c_command(uint16_t command, uint16_t* words, unsigned count, unsigned delay_ms) {
    uint8_t tx[]={uint8_t(command>>8),uint8_t(command)};
    if (!device_ || i2c_master_transmit(device_,tx,2,100)!=ESP_OK) return Quality::timeout;
    if (!count) return Quality::ok;
    vTaskDelay(pdMS_TO_TICKS(delay_ms));
    uint8_t rx[9];
    if (count>3 || i2c_master_receive(device_,rx,count*3,100)!=ESP_OK) return Quality::timeout;
    return decode_words(rx,count*3,words,count)?Quality::ok:Quality::crc;
}
int SensorDriver::uart_command(uint8_t command, const uint8_t* payload, size_t length, uint8_t* out, size_t capacity) {
    uint8_t tx[64],rx[128]; size_t tx_len=shdlc_encode(command,payload,length,tx,sizeof(tx));
    if (!tx_len) return -1;
    uart_flush_input(uart_);
    if (uart_write_bytes(uart_,tx,tx_len)!=int(tx_len)) return -1;
    size_t received=0;
    for (unsigned tries=0;tries<10 && received<sizeof(rx);++tries) {
        int n=uart_read_bytes(uart_,rx+received,sizeof(rx)-received,pdMS_TO_TICKS(20));
        if(n<0) return -1;
        received+=n;
        if(received>1 && rx[received-1]==0x7e) return shdlc_decode(rx,received,command,out,capacity);
    }
    return -2;
}
Quality SensorDriver::read(float* values, unsigned& count, uint64_t now) {
#if defined(AIRCHECK_FAKE_SENSORS)
    // Explicit simulator source; no outputs are commissioned in a fake build.
    if(index_==0) { values[0]=650+100*std::sin(now/60000.0); values[1]=23; values[2]=45; count=3; }
    else if(index_==1) { values[0]=18; values[1]=55; count=2; }
    else { values[0]=index_==2?8:12; count=1; }
    return now<5000?Quality::warmup:Quality::ok;
#else
    if(!transport_ready_) return Quality::timeout;
    if(now<retry_at_) return Quality::timeout;
    if(!started_) {
        Quality result=Quality::ok;
        if(index_==0) {
            result=i2c_command(0x3f86,nullptr,0,0);
            vTaskDelay(pdMS_TO_TICKS(500));
            if(result==Quality::ok) result=i2c_command(0x21b1,nullptr,0,0);
        } else if(index_>=2) {
            uint8_t payload[]={0x01,0x03},response[4];
            if(uart_command(0x00,payload,2,response,sizeof(response))!=0) result=Quality::protocol;
        }
        if(result!=Quality::ok) { retry_at_=now+30000; return result; }
        started_=true; ready_at_=now+(index_>=2?30000:index_==0?5000:0);
    }
    if(now<ready_at_) return Quality::warmup;
    Quality result=Quality::ok;
    if(index_==0) {
        uint16_t words[3]; result=i2c_command(0xe4b8,words,1,1);
        if(result==Quality::ok && !(words[0]&0x7ff)) return Quality::warmup;
        if(result==Quality::ok) result=i2c_command(0xec05,words,3,1);
        if(result==Quality::ok) { values[0]=words[0]; values[1]=-45+175*words[1]/65535.0f; values[2]=100*words[2]/65535.0f; count=3; }
    } else if(index_==1) {
        const uint8_t command=0xfd; uint8_t rx[6]; uint16_t words[2];
        if(i2c_master_transmit(device_,&command,1,100)!=ESP_OK) result=Quality::timeout;
        else {
            vTaskDelay(pdMS_TO_TICKS(10));
            if(i2c_master_receive(device_,rx,6,100)!=ESP_OK) result=Quality::timeout;
            else if(!decode_words(rx,6,words,2)) result=Quality::crc;
            else { values[0]=-45+175*words[0]/65535.0f; values[1]=std::clamp(-6+125*words[1]/65535.0f,0.0f,100.0f); count=2; }
        }
    } else {
        uint8_t response[40]; int n=uart_command(0x03,nullptr,0,response,sizeof(response));
        if(n==-2) result=Quality::timeout;
        else if(n==0) result=Quality::warmup;
        else if(n!=40) result=Quality::protocol;
        else { values[0]=big_endian_float(response+4); count=1; }
    }
    if(result==Quality::timeout || result==Quality::protocol) { started_=false; retry_at_=now+30000; }
    return result;
#endif
}
}
