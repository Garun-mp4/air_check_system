#include "core.hpp"
#include "sensor_protocol.hpp"
#include "journal.hpp"
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <limits>
#include <vector>
#include <unistd.h>
using namespace aircheck;
#define CHECK(expression) do { if (!(expression)) { std::fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #expression); std::exit(1); } } while (0)
static constexpr int64_t epoch = 1800000000000LL;
static Sample good(std::initializer_list<float> values, uint64_t now) { Sample s; s.quality=Quality::ok; s.count=values.size(); s.last_good_ms=now; unsigned i=0; for (float v:values) s.values[i++]=v; return s; }
static void sensors() {
    SensorMonitor co2(0), climate(1), pm(2);
    CHECK(co2.read(0).quality == Quality::unknown);
    float a[]={600,23,45}; co2.success(a,3,100);
    CHECK(co2.read(15099).quality == Quality::ok);
    CHECK(co2.read(15101).quality == Quality::stale);
    co2.failure(Quality::crc,200); CHECK(co2.read(201).values[0] == 600); CHECK(co2.read(201).last_good_ms==100);
    a[0]=std::numeric_limits<float>::quiet_NaN(); co2.success(a,3,300); CHECK(co2.read(301).quality==Quality::range);
    a[0]=25000; co2.success(a,3,400); CHECK(co2.read(401).values[0]==600);
    a[0]=700; co2.success(a,3,500); CHECK(co2.read(500).failures==0);
    a[0]=2500; co2.success(a,3,600); CHECK(co2.read(600).quality==Quality::suspect_jump);
    co2.success(a,3,5600); CHECK(co2.read(5600).quality==Quality::ok);
    for(uint64_t t=10600;t<=1800600;t+=5000) co2.success(a,3,t);
    CHECK(co2.read(1800600).quality==Quality::suspect_stuck);
    float b[]={-10,40}; climate.success(b,2,200); CHECK(climate.read(200).quality==Quality::ok);
    float c[]={5}; pm.success(c,1,300); co2.failure(Quality::timeout,300); CHECK(pm.read(300).quality==Quality::ok);
    pm.success(c,2,400); CHECK(pm.read(400).quality==Quality::protocol);
    std::puts("PASS sensor range/NaN, CRC, retained time, stale, jump, stuck, independence");
}
static void controls() {
    Policy approved; approved.enabled=true;
    Controller disabled(false); CHECK(disabled.command({1,Target::window,true,epoch+10000},0,epoch)==Outcome::disabled);
    Controller c(true);
    CHECK(c.command({10,Target::window,true,epoch+10000},0,0)==Outcome::clock_unsynced);
    CHECK(c.command({11,Target::window,true,epoch-1},0,epoch)==Outcome::expired);
    CHECK(c.command({0,Target::window,true,epoch+10000},0,epoch)==Outcome::invalid);
    CHECK(c.command({1,Target::window,true,epoch+10000},0,epoch)==Outcome::accepted);
    c.tick(50,epoch+50,{}); CHECK(!c.state().outputs.open);
    c.tick(100,epoch+100,{}); CHECK(c.state().outputs.open && !c.state().outputs.close); CHECK(c.state().position_percent==-1);
    CHECK(c.command({1,Target::window,true,epoch+10000},101,epoch)==Outcome::duplicate);
    c.tick(1000,epoch+1000,{true,false,0,0}); CHECK(c.state().position_percent==100); CHECK(!c.state().outputs.open); CHECK(c.state().results[2].outcome==Outcome::applied);
    CHECK(c.command({1,Target::window,true,epoch+10000},1100,epoch)==Outcome::duplicate);
    c.command({2,Target::window,false,epoch+10000},1200,epoch); CHECK(!c.state().outputs.open && !c.state().outputs.close);
    c.tick(1300,epoch+1300,{}); CHECK(c.state().outputs.close && !c.state().outputs.open);
    c.tick(1400,epoch+10001,{}); CHECK(!c.state().outputs.close); CHECK(c.state().results[2].outcome==Outcome::expired);
    c.command({3,Target::window,true,epoch+60000},1500,epoch); c.tick(31500,epoch+31500,{}); CHECK(c.state().window_fault); CHECK(!c.state().outputs.open);
    CHECK(c.command({4,Target::window,true,epoch+60000},32000,epoch)==Outcome::fault);
    Controller contradictory(true); contradictory.tick(0,epoch,{true,true,0,0}); CHECK(contradictory.state().window_fault && contradictory.state().position_percent==-1);
    Controller cancelled(true); cancelled.command({7,Target::window,true,epoch+10000},0,epoch); cancelled.tick(100,epoch+100,{}); cancelled.reconcile_pending(nullptr,0); CHECK(!cancelled.state().outputs.open && cancelled.state().results[2].outcome==Outcome::cancelled);
    Controller fans(true); fans.command({5,Target::exhaust,true,epoch+10000},0,epoch);
    fans.tick(1000,epoch+1000,{}); CHECK(fans.state().results[0].outcome==Outcome::accepted);
    fans.tick(5000,epoch+5000,{}); CHECK(fans.state().fan_fault[0]); CHECK(!fans.state().outputs.exhaust); CHECK(fans.state().results[0].outcome==Outcome::fault);
    fans.command({6,Target::intake,true,epoch+10000},5000,epoch+5000); fans.tick(6000,epoch+6000,{false,false,0,900}); CHECK(fans.state().results[1].outcome==Outcome::applied);
    fans.tick(11000,epoch+11000,{}); CHECK(fans.state().fan_fault[1] && !fans.state().outputs.intake);
    Controller autonomous(true); autonomous.autonomous(100,good({1200,23,45},100),good({20,45},100),good({10},100),approved); CHECK(autonomous.state().outputs.exhaust && autonomous.state().outputs.intake);
    autonomous.autonomous(200,good({700,23,45},200),good({20,45},200),good({10},200),approved); CHECK(autonomous.state().outputs.exhaust);
    autonomous.autonomous(181000,good({700,23,45},181000),good({20,45},181000),good({10},181000),approved); CHECK(!autonomous.state().outputs.exhaust && !autonomous.state().outputs.intake);
    autonomous.autonomous(182000,good({1200,23,45},182000),good({20,45},182000),good({10},182000),approved);
    autonomous.safety(182100,good({1200,23,45},182100),good({20,45},182100),good({100},182100),approved); CHECK(!autonomous.state().outputs.exhaust);
    Controller unsafe(true); unsafe.autonomous(100,good({1200,23,45},100),good({-10,45},100),good({10},100),approved); CHECK(!unsafe.state().outputs.exhaust);
    Controller manual(true); manual.command({8,Target::exhaust,false,epoch+10000},0,epoch); manual.tick(1000,epoch+1000,{});
    manual.autonomous(2000,good({1200,23,45},2000),good({20,45},2000),good({10},2000),approved); CHECK(!manual.state().outputs.exhaust);
    manual.autonomous(1800001,good({1200,23,45},1800001),good({20,45},1800001),good({10},1800001),approved); CHECK(manual.state().outputs.exhaust);
    Controller safety(true); safety.command({9,Target::intake,true,epoch+10000},0,epoch);
    safety.autonomous(100,good({1200,23,45},100),good({20,45},100),good({100},100),{});
    CHECK(!safety.state().outputs.intake && !safety.state().fan_fault[1] && safety.state().results[1].outcome==Outcome::unsafe_air);
    Controller online(true); online.command({100,Target::window,true,epoch+60000},0,epoch);
    online.safety(100,{},good({20,45},100),good({10},100),approved); online.tick(100,epoch+100,{});
    CHECK(!online.state().outputs.open && online.state().results[2].outcome==Outcome::unsafe_air);
    online.command({101,Target::window,false,epoch+60000},200,epoch+200);
    online.safety(300,{},{},{},approved); online.tick(300,epoch+300,{});
    CHECK(online.state().outputs.close && !online.state().outputs.open);
    Policy filtered=approved; filtered.filtered_intake=true;
    Controller filter(true); filter.autonomous(100,good({1200,23,45},100),good({20,45},100),good({100},100),filtered);
    CHECK(filter.state().outputs.intake && !filter.state().outputs.open);
    filter.configure({}); CHECK(!filter.state().outputs.intake);
    Controller remote_auto(true); remote_auto.configure(approved); remote_auto.command({202,Target::exhaust,true,epoch+10000,false},0,epoch); remote_auto.tick(1000,epoch+1000,{false,false,900,0}); remote_auto.configure({}); CHECK(!remote_auto.state().outputs.exhaust);
    Controller remote_manual(true); remote_manual.configure(approved); remote_manual.command({203,Target::exhaust,true,epoch+10000,true},0,epoch); remote_manual.tick(1000,epoch+1000,{false,false,900,0}); remote_manual.configure({}); CHECK(remote_manual.state().outputs.exhaust);
    Controller disabled_auto(true); disabled_auto.autonomous(100,good({1200,23,45},100),good({20,45},100),good({10},100),{}); CHECK(!disabled_auto.state().outputs.exhaust);
    Policy bad=approved; bad.co2_off=2000; CHECK(!valid_policy(bad)); bad=approved; bad.outdoor_pm25_recovery=100; CHECK(!valid_policy(bad));
    Policy maximum=approved; maximum.minimum_ventilation_ms=120*60000; CHECK(valid_policy(maximum)); maximum.minimum_ventilation_ms+=1; CHECK(!valid_policy(maximum));
    Controller local_window(true); approved.auto_window=true;
    local_window.tick(0,epoch,{false,true,0,0}); local_window.autonomous(100,good({1200,23,45},100),good({20,45},100),good({10},100),approved);
    local_window.tick(200,epoch+200,{false,true,0,0}); CHECK(local_window.state().outputs.open);
    local_window.safety(300,{},{},{},approved); local_window.tick(300,epoch+300,{}); CHECK(!local_window.state().outputs.open);
    std::puts("PASS commissioning, clock, expiry, replay, reversal, limits, travel, tach, autonomous hysteresis");
}
static void protocols() {
    const uint8_t known[]={0xbe,0xef}; CHECK(crc8(known,2)==0x92);
    uint8_t words[]={0xbe,0xef,0x92}; uint16_t decoded=0; CHECK(decode_words(words,3,&decoded,1) && decoded==0xbeef);
    words[0]^=1; CHECK(!decode_words(words,3,&decoded,1)); CHECK(!decode_words(words,2,&decoded,1));
    uint8_t encoded[530],out[255]; uint8_t data[]={0x7e,0x7d,0x11,0x13};
    CHECK(shdlc_encode(3,data,4,encoded,3)==0);
    // A response has state in addition to address/command/length.
    const uint8_t response[]={0x7e,0,3,0,4,0x7d,0x5e,0x7d,0x5d,0x7d,0x31,0x7d,0x33,0xd9,0x7e};
    // Construct the checksum independently; test escaped payload and every corruption.
    std::vector<uint8_t> frame(response,response+sizeof(response));
    uint8_t sum=0; for(auto b : {0,3,0,4,0x7e,0x7d,0x11,0x13}) sum+=b; frame[frame.size()-2]=uint8_t(~sum);
    CHECK(shdlc_decode(frame.data(),frame.size(),3,out,255)==4);
    for(unsigned i=0;i<4;++i) CHECK(out[i]==data[i]);
    for(size_t i=0;i<frame.size();++i) { auto corrupt=frame; corrupt[i]^=1; CHECK(shdlc_decode(corrupt.data(),corrupt.size(),3,out,255)==-1); }
    CHECK(shdlc_decode(frame.data(),frame.size(),4,out,255)==-1);
    CHECK(shdlc_decode(frame.data(),frame.size(),3,out,2)==-1);
    const uint8_t f[]={0x42,0xc8,0,0}; CHECK(big_endian_float(f)==100.0f);
    uint32_t rng=1234;
    for(unsigned n=0;n<10000;++n) { uint8_t fuzz[300]; size_t length=n%300; for(size_t i=0;i<length;++i) { rng=1664525*rng+1013904223; fuzz[i]=rng>>24; } shdlc_decode(fuzz,length,3,out,255); }
    std::puts("PASS CRC reference, SHDLC escaping/checksum/truncation/capacity, 10000 malformed frames");
}
static void queue() {
    Queue<int,2> q; CHECK(!q.peek()); CHECK(q.push(1) && q.push(2)); CHECK(!q.push(3)); CHECK(*q.peek()==1); CHECK(*q.peek()==1); q.pop(); CHECK(q.push(3)); CHECK(*q.peek()==2); q.pop(); CHECK(*q.peek()==3); q.pop(); q.pop(); CHECK(q.size()==0);
    std::puts("PASS bounded queue overflow/retry/ack/wrap");
}
static void storage() {
    const char* path="/tmp/aircheck-journal-native.bin"; std::remove(path);
    Journal j; CHECK(!j.open("/does-not-exist/aircheck.bin")); CHECK(j.open(path));
    CHECK(j.append("{\"boot_id\":\"old\",\"sequence\":7}")); CHECK(j.append("next"));
    unsigned slot=0; std::string body; CHECK(j.peek(body,slot) && body.find("old")!=std::string::npos);
    j.close(); CHECK(j.open(path)); CHECK(j.backlog()==2 && j.peek(body,slot));
    CHECK(j.acknowledge(slot)); CHECK(j.peek(body,slot) && body=="next");
    j.close(); FILE* file=std::fopen(path,"r+b"); CHECK(file); CHECK(std::fseek(file,long(slot)*Journal::stride+16,SEEK_SET)==0); CHECK(std::fputc('X',file)!=EOF); std::fclose(file);
    CHECK(j.open(path)); CHECK(j.backlog()==0 && j.corrupt_records()==1);
    CHECK(!j.append(std::string(Journal::max_record+1,'x')));
    for(unsigned i=0;i<Journal::slots;++i) CHECK(j.append("immutable-frame"));
    CHECK(!j.append("full")); CHECK(j.healthy()); CHECK(j.peek(body,slot)); CHECK(j.acknowledge(slot)); CHECK(j.append("after-rotation"));
    j.close(); CHECK(j.open(path)); CHECK(j.backlog()==Journal::slots); j.close();
    file=std::fopen(path,"r+b"); CHECK(file); CHECK(ftruncate(fileno(file),Journal::stride+20)==0); std::fclose(file);
    CHECK(j.open(path)); CHECK(j.backlog()<=1); j.close(); std::remove(path);
    std::puts("PASS SD bounded journal, CRC, restart, torn write, full, rotation, immutable replay");
}
int main() { sensors(); controls(); protocols(); queue(); storage(); }
