#pragma once
#include <array>
#include <cstddef>
#include <cstdint>

namespace aircheck {
enum class Quality { unknown, warmup, ok, timeout, crc, protocol, range, stale, suspect_jump, suspect_stuck };
const char* quality_name(Quality value);
struct Sample {
    std::array<float, 3> values{};
    unsigned count = 0;
    uint64_t sampled_ms = 0;
    uint64_t last_good_ms = 0;
    Quality quality = Quality::unknown;
    unsigned failures = 0;
};
class SensorMonitor {
public:
    explicit SensorMonitor(unsigned sensor_index) : index_(sensor_index) {}
    Sample read(uint64_t now) const;
    void success(const float* values, unsigned count, uint64_t now);
    void failure(Quality reason, uint64_t now);
private:
    unsigned index_;
    Sample sample_{};
    uint64_t unchanged_since_ = 0;
};
enum class Target { exhaust, intake, window };
enum class Outcome { none, accepted, applied, expired, clock_unsynced, disabled, fault, duplicate, invalid, cancelled, unsafe_air };
const char* outcome_name(Outcome value);
struct Command { uint64_t id = 0; Target target = Target::window; bool desired = false; int64_t expires_epoch_ms = 0; bool manual = true; };
struct Feedback { bool open_limit = false; bool close_limit = false; unsigned exhaust_rpm = 0; unsigned intake_rpm = 0; };
struct Outputs { bool exhaust = false; bool intake = false; bool open = false; bool close = false; };
struct Result { uint64_t id = 0; Outcome outcome = Outcome::none; };
struct ControllerState {
    Outputs outputs{};
    Feedback feedback{};
    // -1 means unknown; never interpolate time into a measured position.
    int position_percent = -1;
    bool window_fault = false;
    std::array<bool, 2> fan_fault{};
    std::array<Result, 3> results{};
};
struct Policy {
    bool enabled = false, auto_window = false, filtered_intake = false;
    float co2_on = 1000, co2_off = 800, outdoor_pm25_max = 35, outdoor_pm25_recovery = 30;
    float outdoor_min_c = 5, outdoor_recovery_c = 7;
    uint32_t manual_override_ms = 1800000, minimum_ventilation_ms = 180000;
    uint32_t max_sensor_age_ms = 15000;
};
bool valid_policy(const Policy& policy);
class Controller {
public:
    explicit Controller(bool commissioned) : commissioned_(commissioned) {}
    Outcome command(const Command& command, uint64_t now, int64_t epoch_ms);
    void tick(uint64_t now, int64_t epoch_ms, const Feedback& feedback);
    void autonomous(uint64_t now, const Sample& indoor, const Sample& outdoor, const Sample& outdoor_pm, const Policy& policy);
    void safety(uint64_t now, const Sample& indoor, const Sample& outdoor, const Sample& outdoor_pm, const Policy& policy);
    void configure(const Policy& policy);
    void reconcile_pending(const uint64_t* ids, size_t count);
    const ControllerState& state() const { return state_; }
private:
    bool commissioned_;
    ControllerState state_{};
    std::array<Command, 3> active_{};
    std::array<uint64_t, 3> started_{};
    std::array<uint64_t, 32> completed_{};
    unsigned completed_cursor_ = 0;
    uint64_t manual_until_ = 0;
    Policy policy_{};
    bool pollution_blocked_ = false, cold_blocked_ = false;
    std::array<bool, 2> automatic_fans_{};
    bool safe_window_ = false, safe_fans_ = false;
    bool auto_window_active_ = false, auto_window_desired_ = false;
    uint64_t auto_window_started_ = 0, auto_opened_at_ = 0;
    void finish(unsigned target, Outcome outcome);
    void stop_window();
    void stop_automatic_fans();
};
// Bounded queue with peek/ack semantics: a failed upload keeps the same identity.
template <typename T, size_t N> class Queue {
public:
    bool push(const T& value) { if (size_ == N) return false; items_[(head_ + size_) % N] = value; ++size_; return true; }
    const T* peek() const { return size_ ? &items_[head_] : nullptr; }
    void pop() { if (size_) { head_ = (head_ + 1) % N; --size_; } }
    size_t size() const { return size_; }
private:
    std::array<T, N> items_{};
    size_t head_ = 0, size_ = 0;
};
}
