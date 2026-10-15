#pragma once
#include <array>
#include <cstdint>
#include <cstdio>
#include <string>

namespace aircheck {
// Fixed slots bound both disk and RAM. Uncommitted/torn records never enter replay.
class Journal {
public:
    static constexpr unsigned slots=2048, max_record=3072, stride=max_record+16;
    ~Journal() { close(); }
    bool open(const char* path);
    void close();
    bool append(const std::string& body);
    bool peek(std::string& body, unsigned& slot);
    bool acknowledge(unsigned slot);
    unsigned backlog() const { return count_; }
    unsigned corrupt_records() const { return corrupt_; }
    bool healthy() const { return file_ && healthy_; }
private:
    FILE* file_=nullptr;
    std::array<uint32_t,slots> generations_{};
    uint32_t generation_=0;
    unsigned count_=0,corrupt_=0;
    bool healthy_=false;
    bool write(unsigned slot,const void* data,unsigned size,unsigned offset=0);
    bool read(unsigned slot,std::string& body,uint32_t& generation);
    bool sync();
};
}
