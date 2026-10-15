idf_component_register(SRCS "main.cpp" "core.cpp" "sensor_protocol.cpp" "drivers.cpp"
                       INCLUDE_DIRS "." "../include"
                       REQUIRES esp_wifi esp_netif nvs_flash esp_http_client esp_driver_i2c esp_driver_uart esp_driver_gpio esp_driver_sdspi fatfs espressif__cjson esp_timer esp_system mbedtls lwip)
