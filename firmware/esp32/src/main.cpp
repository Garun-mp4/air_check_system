#include "core.hpp"
#include "board.hpp"
#include "drivers.hpp"
#include "cJSON.h"
#include "driver/gpio.h"
#include "esp_event.h"
#include "esp_heap_caps.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_random.h"
#include "esp_sntp.h"
#include "esp_system.h"
#include "esp_task_wdt.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "nvs_flash.h"
#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <sys/time.h>
#include <time.h>
#if __has_include("secrets.h")
#include "secrets.h"
#else
#include "secrets.example.h"
#endif

using namespace aircheck;
namespace {
constexpr char TAG[]="aircheck";
constexpr char VERSION[]="2.0.0";
constexpr const char* IDS[]={"indoor_climate","outdoor_climate","indoor_particles","outdoor_particles"};
constexpr const char* KEYS[][3]={{"co2","temperature","humidity"},{"temperature","humidity",nullptr},{"pm25",nullptr,nullptr},{"pm25",nullptr,nullptr}};
constexpr gpio_num_t OUT[]={gpio_num_t(board::exhaust),gpio_num_t(board::intake),gpio_num_t(board::window_open),gpio_num_t(board::window_close)};
constexpr gpio_num_t LIMITS[]={gpio_num_t(board::open_limit),gpio_num_t(board::close_limit)};
constexpr gpio_num_t TACH[]={gpio_num_t(board::exhaust_tach),gpio_num_t(board::intake_tach)};
#if defined(AIRCHECK_FAKE_SENSORS)
constexpr const char* SOURCE="simulator";
#else
constexpr const char* SOURCE="real";
#endif
struct NodeConfig {
    char ssid[33]=AIRCHECK_WIFI_SSID, password[65]=AIRCHECK_WIFI_PASSWORD;
    char server[256]=AIRCHECK_SERVER, device_id[81]=AIRCHECK_DEVICE_ID;
    char token[257]=AIRCHECK_TOKEN, ca_pem[4096]=AIRCHECK_CA_PEM;
    char ntp_server[256]="aircheck.home.arpa";
    bool commissioned=false;
} node;
void load_config() {
    nvs_handle_t handle;
    if(nvs_open("aircheck",NVS_READONLY,&handle)!=ESP_OK) return;
    auto read=[&](const char* key,char* value,size_t capacity) {
        size_t size=capacity; const auto result=nvs_get_str(handle,key,value,&size);
        if(result!=ESP_OK && result!=ESP_ERR_NVS_NOT_FOUND) { value[0]=0; ESP_LOGE(TAG,"Invalid provisioning key: %s",key); }
    };
    read("ssid",node.ssid,sizeof(node.ssid)); read("password",node.password,sizeof(node.password));
    read("server",node.server,sizeof(node.server)); read("device_id",node.device_id,sizeof(node.device_id));
    read("token",node.token,sizeof(node.token)); read("root_ca",node.ca_pem,sizeof(node.ca_pem));
    read("ntp_server",node.ntp_server,sizeof(node.ntp_server));
    uint8_t commissioned=0; nvs_get_u8(handle,"commissioned",&commissioned);
#if !defined(AIRCHECK_FAKE_SENSORS)
    node.commissioned=commissioned==1 && AIRCHECK_OUTPUTS_COMMISSIONED;
#endif
    nvs_close(handle);
}
struct Packet {
    uint64_t sequence, monotonic_ms;
    int64_t epoch_ms;
    std::array<Sample,4> sensors;
    ControllerState controls;
    unsigned heap, min_heap, dropped, queue_depth;
};
SemaphoreHandle_t state_mutex;
QueueHandle_t telemetry_queue, command_queue;
std::array<Sample,4> shared_samples{};
Controller controller(false);
i2c_master_bus_handle_t bus=nullptr;
char boot_id[33];
bool initialize_identity() {
    uint8_t mac[6], random[6];
    if(esp_read_mac(mac,ESP_MAC_WIFI_STA)!=ESP_OK) return false;
    nvs_handle_t handle;
    if(nvs_open("aircheck",NVS_READWRITE,&handle)!=ESP_OK) return false;
    uint32_t boots=0; const auto read=nvs_get_u32(handle,"boot_count",&boots);
    if(read!=ESP_OK && read!=ESP_ERR_NVS_NOT_FOUND) { nvs_close(handle); return false; }
    ++boots;
    const auto written=nvs_set_u32(handle,"boot_count",boots);
    const auto committed=written==ESP_OK?nvs_commit(handle):written;
    nvs_close(handle);
    if(committed!=ESP_OK) return false;
    esp_fill_random(random,sizeof(random));
    for(unsigned i=0;i<6;++i) std::snprintf(boot_id+2*i,3,"%02x",mac[i]);
    std::snprintf(boot_id+12,9,"%08lx",static_cast<unsigned long>(boots));
    for(unsigned i=0;i<6;++i) std::snprintf(boot_id+20+2*i,3,"%02x",random[i]);
    return true;
}
std::atomic<bool> wifi_online{false};
std::atomic<unsigned> dropped_packets{0};
std::atomic<uint32_t> last_server_ms{0};
portMUX_TYPE tach_mux=portMUX_INITIALIZER_UNLOCKED;
unsigned tach_counts[2]={};
uint64_t monotonic_ms() { return esp_timer_get_time()/1000; }
int64_t epoch_ms() { timeval t{}; gettimeofday(&t,nullptr); const int64_t ms=int64_t(t.tv_sec)*1000+t.tv_usec/1000; return ms>=1700000000000LL?ms:0; }
std::string iso(int64_t ms) {
    if(!ms) return {};
    time_t seconds=ms/1000; tm utc{}; gmtime_r(&seconds,&utc);
    char text[32]; strftime(text,sizeof(text),"%Y-%m-%dT%H:%M:%SZ",&utc); return text;
}
void json_date(cJSON* object,const char* key,int64_t ms) { if(ms) cJSON_AddStringToObject(object,key,iso(ms).c_str()); else cJSON_AddNullToObject(object,key); }
void sensor_task(void* argument) {
    unsigned index=reinterpret_cast<uintptr_t>(argument);
    SensorDriver driver(index,bus); SensorMonitor monitor(index);
    esp_task_wdt_add(nullptr);
    TickType_t last=xTaskGetTickCount();
    while(true) {
        float values[3]{}; unsigned count=0; const auto now=monotonic_ms();
        const Quality result=driver.read(values,count,now);
        if(result==Quality::ok) monitor.success(values,count,now); else monitor.failure(result,now);
        xSemaphoreTake(state_mutex,portMAX_DELAY); shared_samples[index]=monitor.read(monotonic_ms()); xSemaphoreGive(state_mutex);
        esp_task_wdt_reset(); xTaskDelayUntil(&last,pdMS_TO_TICKS(board::telemetry_period_ms));
    }
}
void IRAM_ATTR tach_interrupt(void* argument) {
    auto index=reinterpret_cast<uintptr_t>(argument);
    portENTER_CRITICAL_ISR(&tach_mux); ++tach_counts[index]; portEXIT_CRITICAL_ISR(&tach_mux);
}
void write_outputs(const Outputs& outputs) {
    static Outputs previous{};
    const bool values[]={outputs.exhaust,outputs.intake,outputs.open,outputs.close};
    if(previous.open!=outputs.open || previous.close!=outputs.close) { gpio_set_level(OUT[2],0); gpio_set_level(OUT[3],0); }
    for(unsigned i=0;i<4;++i) gpio_set_level(OUT[i],node.commissioned && values[i]);
    previous=outputs;
}
void control_task(void*) {
    esp_task_wdt_add(nullptr); TickType_t last=xTaskGetTickCount();
    Feedback feedback{}; unsigned stable[2]={}; uint64_t rpm_at=monotonic_ms();
    while(true) {
        const auto now=monotonic_ms();
        // Input-only pins require external pull-ups; commissioned contacts are active LOW.
        for(unsigned i=0;i<2;++i) stable[i]=gpio_get_level(LIMITS[i])==0?std::min(stable[i]+1,3u):0;
        feedback.open_limit=stable[0]>=3; feedback.close_limit=stable[1]>=3;
        if(now-rpm_at>=1000) {
            portENTER_CRITICAL(&tach_mux); unsigned counts[]={tach_counts[0],tach_counts[1]}; tach_counts[0]=tach_counts[1]=0; portEXIT_CRITICAL(&tach_mux);
            // The chosen fan must supply two pulses/revolution, or this scale must be configured.
            feedback.exhaust_rpm=counts[0]*30000ULL/(now-rpm_at); feedback.intake_rpm=counts[1]*30000ULL/(now-rpm_at); rpm_at=now;
        }
        xSemaphoreTake(state_mutex,portMAX_DELAY);
        Command command;
        while(xQueueReceive(command_queue,&command,0)==pdTRUE) controller.command(command,now,epoch_ms());
        controller.tick(now,epoch_ms(),feedback);
        if(!wifi_online || uint32_t(now)-last_server_ms.load()>board::offline_after_ms) controller.autonomous(now,shared_samples[0],shared_samples[1],shared_samples[3],{});
        const auto outputs=controller.state().outputs;
        xSemaphoreGive(state_mutex);
        write_outputs(outputs); esp_task_wdt_reset(); xTaskDelayUntil(&last,pdMS_TO_TICKS(20));
    }
}
void sampler_task(void*) {
    esp_task_wdt_add(nullptr); TickType_t last=xTaskGetTickCount(); uint64_t sequence=0;
    while(true) {
        Packet packet{}; packet.sequence=sequence++; packet.monotonic_ms=monotonic_ms(); packet.epoch_ms=epoch_ms();
        xSemaphoreTake(state_mutex,portMAX_DELAY); packet.sensors=shared_samples; packet.controls=controller.state(); xSemaphoreGive(state_mutex);
        packet.heap=esp_get_free_heap_size(); packet.min_heap=esp_get_minimum_free_heap_size(); packet.dropped=dropped_packets; packet.queue_depth=uxQueueMessagesWaiting(telemetry_queue);
        if(xQueueSend(telemetry_queue,&packet,0)!=pdTRUE) ++dropped_packets;
        esp_task_wdt_reset(); xTaskDelayUntil(&last,pdMS_TO_TICKS(board::telemetry_period_ms));
    }
}
std::string serialize(const Packet& p) {
    cJSON* root=cJSON_CreateObject(); if(!root) return {};
    cJSON_AddNumberToObject(root,"schema_version",2); cJSON_AddStringToObject(root,"device_id",node.device_id);
    cJSON_AddStringToObject(root,"data_source",SOURCE); cJSON_AddStringToObject(root,"boot_id",boot_id);
    cJSON_AddNumberToObject(root,"sequence",p.sequence); json_date(root,"sampled_at",p.epoch_ms);
    auto sensors=cJSON_AddArrayToObject(root,"sensors");
    for(unsigned i=0;i<4;++i) {
        const auto& s=p.sensors[i]; auto item=cJSON_CreateObject(); cJSON_AddItemToArray(sensors,item);
        cJSON_AddStringToObject(item,"sensor_id",IDS[i]); cJSON_AddStringToObject(item,"status",quality_name(s.quality));
        cJSON_AddStringToObject(item,"reason",quality_name(s.quality));
        const auto age=p.monotonic_ms>=s.last_good_ms?p.monotonic_ms-s.last_good_ms:0;
        json_date(item,"last_good_at",p.epoch_ms && s.count?p.epoch_ms-int64_t(age):0);
        cJSON_AddNumberToObject(item,"age_ms",age); cJSON_AddNumberToObject(item,"consecutive_failures",s.failures);
        auto values=cJSON_AddObjectToObject(item,"values");
        for(unsigned n=0;n<3 && KEYS[i][n];++n) {
            if(n<s.count) cJSON_AddNumberToObject(values,KEYS[i][n],s.values[n]); else cJSON_AddNullToObject(values,KEYS[i][n]);
        }
    }
    auto info=cJSON_AddObjectToObject(root,"controller");
    cJSON_AddNumberToObject(info,"uptime_ms",p.monotonic_ms); cJSON_AddNumberToObject(info,"reset_reason",esp_reset_reason());
    cJSON_AddStringToObject(info,"firmware_version",VERSION); cJSON_AddNumberToObject(info,"free_heap",p.heap); cJSON_AddNumberToObject(info,"minimum_free_heap",p.min_heap);
    cJSON_AddBoolToObject(info,"clock_synced",p.epoch_ms!=0); cJSON_AddBoolToObject(info,"outputs_commissioned",node.commissioned);
    cJSON_AddNumberToObject(info,"dropped_packets",p.dropped); cJSON_AddNumberToObject(info,"queue_depth",p.queue_depth);
    auto a=cJSON_AddObjectToObject(root,"actuators"); auto w=cJSON_AddObjectToObject(a,"window");
    cJSON_AddBoolToObject(w,"open_limit",p.controls.feedback.open_limit); cJSON_AddBoolToObject(w,"close_limit",p.controls.feedback.close_limit);
    if(!node.commissioned || p.controls.position_percent<0) cJSON_AddNullToObject(w,"position_percent"); else cJSON_AddNumberToObject(w,"position_percent",p.controls.position_percent);
    cJSON_AddStringToObject(w,"position_quality",!node.commissioned || p.controls.position_percent<0?"unknown":"measured");
    cJSON_AddStringToObject(w,"motion",p.controls.window_fault?"fault":p.controls.outputs.open?"opening":p.controls.outputs.close?"closing":"stopped");
    for(unsigned i=0;i<2;++i) {
        auto fan=cJSON_AddObjectToObject(a,i==0?"exhaust":"intake");
        cJSON_AddBoolToObject(fan,"requested_on",i==0?p.controls.outputs.exhaust:p.controls.outputs.intake);
        cJSON_AddNumberToObject(fan,"rpm",i==0?p.controls.feedback.exhaust_rpm:p.controls.feedback.intake_rpm);
        cJSON_AddStringToObject(fan,"status",p.controls.fan_fault[i]?"fault":node.commissioned?"measured":"unknown");
    }
    auto results=cJSON_AddArrayToObject(root,"command_results");
    for(auto result:p.controls.results) if(result.id && result.outcome!=Outcome::accepted && result.outcome!=Outcome::none) {
        auto r=cJSON_CreateObject(); cJSON_AddItemToArray(results,r); cJSON_AddNumberToObject(r,"id",result.id); cJSON_AddStringToObject(r,"status",outcome_name(result.outcome));
    }
    char* raw=cJSON_PrintUnformatted(root); std::string result=raw?raw:""; cJSON_free(raw); cJSON_Delete(root); return result;
}
struct Response { std::string body; bool overflow=false; };
esp_err_t http_event(esp_http_client_event_t* event) {
    auto response=static_cast<Response*>(event->user_data);
    if(event->event_id==HTTP_EVENT_ON_DATA) {
        if(response->body.size()+event->data_len>16384) { response->overflow=true; return ESP_FAIL; }
        response->body.append(static_cast<char*>(event->data),event->data_len);
    }
    return ESP_OK;
}
int request(const char* path,const std::string* body,Response& response) {
    if(std::strncmp(node.server,"https://",8)!=0 || std::strlen(node.ca_pem)<32 || std::strlen(node.token)<32) return 0;
    const std::string url=std::string(node.server)+path;
    esp_http_client_config_t config{}; config.url=url.c_str(); config.cert_pem=node.ca_pem;
    config.timeout_ms=3000; config.event_handler=http_event; config.user_data=&response;
    config.disable_auto_redirect=true;
    auto client=esp_http_client_init(&config); if(!client) return 0;
    const std::string auth=std::string("Bearer ")+node.token;
    esp_http_client_set_header(client,"Authorization",auth.c_str());
    if(body) { esp_http_client_set_method(client,HTTP_METHOD_POST); esp_http_client_set_header(client,"Content-Type","application/json"); esp_http_client_set_post_field(client,body->c_str(),body->size()); }
    const auto error=esp_http_client_perform(client); const int status=error==ESP_OK && !response.overflow?esp_http_client_get_status_code(client):0;
    esp_http_client_cleanup(client); return status;
}
int64_t parse_date(const char* text) {
    if(!text) return 0;
    tm utc{}; char* end=strptime(text,"%Y-%m-%dT%H:%M:%S",&utc);
    if(!end) return 0;
    if(*end=='.') { ++end; while(*end>='0'&&*end<='9') ++end; }
    if(std::strcmp(end,"Z")!=0) return 0;
    return int64_t(timegm(&utc))*1000;
}
void poll_commands() {
    Response response; const std::string path=std::string("/api/v1/controls/commands?device_id=")+node.device_id+"&limit=20";
    if(request(path.c_str(),nullptr,response)!=200) return;
    auto root=cJSON_Parse(response.body.c_str()); if(!root) return;
    auto commands=cJSON_GetObjectItemCaseSensitive(root,"data");
    if(!cJSON_IsArray(commands) || cJSON_GetArraySize(commands)>20) { cJSON_Delete(root); return; }
    uint64_t pending_ids[20]; unsigned pending_count=0;
    cJSON* item=nullptr;
    cJSON_ArrayForEach(item,commands) {
        auto id=cJSON_GetObjectItemCaseSensitive(item,"id"); auto target=cJSON_GetObjectItemCaseSensitive(item,"target");
        auto desired=cJSON_GetObjectItemCaseSensitive(item,"desired_state"); auto expiry=cJSON_GetObjectItemCaseSensitive(item,"expires_at");
        if(!cJSON_IsNumber(id) || id->valuedouble<=0 || id->valuedouble>9007199254740991.0 || std::floor(id->valuedouble)!=id->valuedouble || !cJSON_IsString(target) || !cJSON_IsBool(desired) || !cJSON_IsString(expiry)) continue;
        Command c{}; c.id=id->valuedouble; c.desired=cJSON_IsTrue(desired); c.expires_epoch_ms=parse_date(expiry->valuestring);
        auto source=cJSON_GetObjectItemCaseSensitive(item,"source");
        c.manual=!cJSON_IsString(source) || std::strcmp(source->valuestring,"automatic")!=0;
        if(!std::strcmp(target->valuestring,"window")) c.target=Target::window;
        else if(!std::strcmp(target->valuestring,"intake")) c.target=Target::intake;
        else if(!std::strcmp(target->valuestring,"exhaust")) c.target=Target::exhaust; else continue;
        if(c.expires_epoch_ms) { pending_ids[pending_count++]=c.id; xQueueSend(command_queue,&c,0); }
    }
    xSemaphoreTake(state_mutex,portMAX_DELAY); controller.reconcile_pending(pending_ids,pending_count); xSemaphoreGive(state_mutex);
    cJSON_Delete(root);
}
void network_task(void*) {
    esp_task_wdt_add(nullptr); Packet pending{}; bool has_pending=false; unsigned failures=0;
    while(true) {
        if(wifi_online && epoch_ms()) {
            if(!has_pending) has_pending=xQueueReceive(telemetry_queue,&pending,0)==pdTRUE;
            if(has_pending) {
                const auto body=serialize(pending); Response response;
                const auto status=body.empty()?0:request("/api/v1/telemetry",&body,response);
                if(status>=200 && status<300) { has_pending=false; failures=0; last_server_ms=uint32_t(monotonic_ms()); }
                else if(status==400 || status==409 || status==422) { has_pending=false; ++dropped_packets; }
                else ++failures;
                esp_task_wdt_reset();
            }
            poll_commands(); esp_task_wdt_reset();
        }
        vTaskDelay(pdMS_TO_TICKS(failures?std::min(5000u,500u*(1u<<std::min(failures,3u))):1000));
        esp_task_wdt_reset();
    }
}
void wifi_event(void*,esp_event_base_t base,int32_t event,void*) {
    if(base==WIFI_EVENT && event==WIFI_EVENT_STA_START) esp_wifi_connect();
    if(base==WIFI_EVENT && event==WIFI_EVENT_STA_DISCONNECTED) { wifi_online=false; esp_wifi_connect(); }
    if(base==IP_EVENT && event==IP_EVENT_STA_GOT_IP) wifi_online=true;
}
void start_wifi() {
    if(!std::strlen(node.ssid)) { ESP_LOGW(TAG,"Wi-Fi unconfigured; local tasks continue"); return; }
    ESP_ERROR_CHECK(esp_netif_init()); ESP_ERROR_CHECK(esp_event_loop_create_default()); esp_netif_create_default_wifi_sta();
    wifi_init_config_t init=WIFI_INIT_CONFIG_DEFAULT(); ESP_ERROR_CHECK(esp_wifi_init(&init));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT,ESP_EVENT_ANY_ID,wifi_event,nullptr));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT,IP_EVENT_STA_GOT_IP,wifi_event,nullptr));
    wifi_config_t config{};
    std::memcpy(config.sta.ssid,node.ssid,std::min(std::strlen(node.ssid),sizeof(config.sta.ssid)));
    std::memcpy(config.sta.password,node.password,std::min(std::strlen(node.password),sizeof(config.sta.password)));
    config.sta.threshold.authmode=WIFI_AUTH_WPA2_PSK;
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA)); ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA,&config)); ESP_ERROR_CHECK(esp_wifi_start());
    esp_sntp_setoperatingmode(SNTP_OPMODE_POLL); esp_sntp_setservername(0,node.ntp_server); esp_sntp_init();
}
}
extern "C" void app_main() {
    for(auto pin:OUT) { gpio_set_level(pin,0); gpio_set_direction(pin,GPIO_MODE_OUTPUT); }
    for(auto pin:LIMITS) gpio_set_direction(pin,GPIO_MODE_INPUT);
    gpio_install_isr_service(0);
    for(unsigned i=0;i<2;++i) { gpio_set_direction(TACH[i],GPIO_MODE_INPUT); gpio_set_intr_type(TACH[i],GPIO_INTR_NEGEDGE); gpio_isr_handler_add(TACH[i],tach_interrupt,reinterpret_cast<void*>(uintptr_t(i))); }
    // NVS may hold provisioning data: do not erase it automatically on an init failure.
    const auto nvs=nvs_flash_init(); if(nvs!=ESP_OK) ESP_LOGE(TAG,"NVS init failed (%s); network unconfigured",esp_err_to_name(nvs));
    if(nvs==ESP_OK) load_config();
    const bool identity_ready=nvs==ESP_OK && initialize_identity();
    if(!identity_ready) ESP_LOGE(TAG,"Boot identity could not be persisted; network stays disabled");
    controller=Controller(node.commissioned);
    state_mutex=xSemaphoreCreateMutex(); telemetry_queue=xQueueCreate(8,sizeof(Packet)); command_queue=xQueueCreate(8,sizeof(Command));
    if(!state_mutex || !telemetry_queue || !command_queue) { ESP_LOGE(TAG,"Insufficient memory; outputs remain inactive"); return; }
    i2c_master_bus_config_t config{}; config.i2c_port=I2C_NUM_0; config.sda_io_num=gpio_num_t(board::sda); config.scl_io_num=gpio_num_t(board::scl);
    config.clk_source=I2C_CLK_SRC_DEFAULT; config.glitch_ignore_cnt=7; config.flags.enable_internal_pullup=false;
    if(i2c_new_master_bus(&config,&bus)!=ESP_OK) ESP_LOGE(TAG,"I2C unavailable; UART sensors and control continue");
    for(unsigned i=0;i<4;++i) if(xTaskCreate(sensor_task,IDS[i],4096,reinterpret_cast<void*>(uintptr_t(i)),3,nullptr)!=pdPASS) ESP_LOGE(TAG,"Sensor task unavailable: %s",IDS[i]);
    if(xTaskCreate(control_task,"control",4096,nullptr,6,nullptr)!=pdPASS) return;
    xTaskCreate(sampler_task,"sampler",4096,nullptr,2,nullptr);
    if(identity_ready) start_wifi();
    xTaskCreate(network_task,"network",12288,nullptr,1,nullptr);
    ESP_LOGI(TAG,"Firmware %s, source %s, outputs %s",VERSION,SOURCE,node.commissioned?"commissioned":"disabled");
}
