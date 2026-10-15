#include "journal.hpp"
#include <algorithm>
#include <climits>
#include <cstring>
#include <cerrno>
#include <fcntl.h>
#include <unistd.h>
namespace aircheck {
static uint32_t crc(const void* bytes,size_t size,uint32_t value=0xffffffffu) {
    const auto data=static_cast<const unsigned char*>(bytes);
    for(size_t i=0;i<size;++i) { value^=data[i]; for(unsigned bit=0;bit<8;++bit) value=(value>>1)^(0xedb88320u & (0u-(value&1u))); }
    return value;
}
static uint32_t decode(const unsigned char* data) { return uint32_t(data[0]) | uint32_t(data[1])<<8 | uint32_t(data[2])<<16 | uint32_t(data[3])<<24; }
static void encode(unsigned char* data,uint32_t value) { for(unsigned i=0;i<4;++i) data[i]=value>>(i*8); }
void Journal::close() { if(file_) std::fclose(file_); file_=nullptr; healthy_=false; }
bool Journal::sync() { return healthy_=std::fflush(file_)==0 && fsync(fileno(file_))==0; }
bool Journal::write(unsigned slot,const void* data,unsigned size,unsigned offset) {
    return healthy_=file_ && slot<slots && offset+size<=stride && std::fseek(file_,long(slot)*stride+offset,SEEK_SET)==0 && std::fwrite(data,1,size,file_)==size;
}
bool Journal::read(unsigned slot,std::string& body,uint32_t& generation) {
    unsigned char header[16];
    if(std::fseek(file_,long(slot)*stride,SEEK_SET)!=0) { healthy_=false; return false; }
    const auto size=std::fread(header,1,sizeof(header),file_);
    if(std::ferror(file_)) { healthy_=false; return false; }
    if(size!=sizeof(header) || std::memcmp(header,"ACJ1",4)!=0) return false;
    const auto length=decode(header+4); generation=decode(header+8);
    if(!length || length>max_record || !generation) { ++corrupt_; return false; }
    body.resize(length);
    if(std::fread(body.data(),1,length,file_)!=length || decode(header+12)!=(crc(body.data(),length,crc(header+4,8))^0xffffffffu)) { ++corrupt_; return false; }
    return true;
}
bool Journal::open(const char* path) {
    close(); generations_.fill(0); count_=corrupt_=generation_=0;
    file_=std::fopen(path,"r+b");
    if(!file_ && errno==ENOENT) {
        const int descriptor=::open(path,O_RDWR|O_CREAT|O_EXCL,0600);
        if(descriptor>=0) { file_=fdopen(descriptor,"w+b"); if(!file_) ::close(descriptor); }
    }
    if(!file_) return false;
    healthy_=true;
    if(std::fseek(file_,0,SEEK_END)!=0 || std::ftell(file_)>long(slots)*stride) { close(); return false; }
    std::string body;
    for(unsigned slot=0;slot<slots;++slot) {
        uint32_t generation=0;
        if(read(slot,body,generation)) { generations_[slot]=generation; generation_=std::max(generation_,generation); ++count_; }
        if(!healthy_) { close(); return false; }
        std::clearerr(file_);
    }
    return true;
}
bool Journal::append(const std::string& body) {
    if(!healthy() || body.empty() || body.size()>max_record || count_==slots || generation_==UINT_MAX) return false;
    const auto found=std::find(generations_.begin(),generations_.end(),0);
    const unsigned slot=found-generations_.begin(); unsigned char header[16]={};
    if(!write(slot,header,sizeof(header)) || !sync() || !write(slot,body.data(),body.size(),16) || !sync()) return false;
    std::memcpy(header,"ACJ1",4); encode(header+4,body.size()); encode(header+8,generation_+1);
    encode(header+12,crc(body.data(),body.size(),crc(header+4,8))^0xffffffffu);
    if(!write(slot,header,sizeof(header)) || !sync()) return false;
    generations_[slot]=++generation_; ++count_; return true;
}
bool Journal::peek(std::string& body,unsigned& slot) {
    if(!healthy() || !count_) return false;
    uint32_t oldest=UINT_MAX;
    for(unsigned i=0;i<slots;++i) if(generations_[i] && generations_[i]<=oldest) { oldest=generations_[i]; slot=i; }
    uint32_t actual=0;
    if(read(slot,body,actual) && actual==oldest) return true;
    // Corrupted committed data is discarded explicitly; it must never be uploaded.
    if(healthy_) acknowledge(slot);
    return false;
}
bool Journal::acknowledge(unsigned slot) {
    if(!healthy() || slot>=slots || !generations_[slot]) return false;
    unsigned char empty[16]={}; if(!write(slot,empty,sizeof(empty)) || !sync()) return false;
    generations_[slot]=0; --count_; return true;
}
}
