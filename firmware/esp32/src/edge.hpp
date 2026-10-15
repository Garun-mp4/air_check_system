#pragma once
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>

namespace aircheck {
inline bool linear_predict(const std::array<float,11>& features, const std::array<float,11>& weights, float bias, float& result) {
    if(!std::isfinite(bias)) return false;
    result=bias;
    for(size_t i=0;i<features.size();++i) {
        if(!std::isfinite(features[i]) || !std::isfinite(weights[i])) return false;
        result+=features[i]*weights[i];
    }
    return std::isfinite(result) && result>=250 && result<=10000;
}
// 121 points span ten minutes at the 5 s sampling period; RAM cost is bounded.
class EdgeHistory {
public:
    void push(uint64_t ms,float co2) { samples_[cursor_]={ms,co2}; cursor_=(cursor_+1)%samples_.size(); if(count_<samples_.size()) ++count_; }
    bool change(uint64_t now,uint64_t lookback,float current,float& delta) const {
        if(now<lookback) return false;
        const auto target=now-lookback;
        for(size_t age=0;age<count_;++age) {
            const auto& sample=samples_[(cursor_+samples_.size()-1-age)%samples_.size()];
            if(sample.ms<=target) {
                if(target-sample.ms>120000 || !std::isfinite(sample.co2)) return false;
                delta=current-sample.co2; return std::isfinite(delta);
            }
        }
        return false;
    }
private:
    struct Point { uint64_t ms=0; float co2=0; };
    std::array<Point,121> samples_{};
    size_t cursor_=0,count_=0;
};
}
