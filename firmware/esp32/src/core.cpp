#include "core.hpp"
#include "board.hpp"
#include <algorithm>
#include <cmath>

namespace aircheck {
const char* quality_name(Quality q) {
    static const char* names[] = {"unknown", "warmup", "ok", "timeout", "crc", "protocol", "range", "stale", "suspect_jump", "suspect_stuck"};
    return names[static_cast<unsigned>(q)];
}
const char* outcome_name(Outcome q) {
    static const char* names[] = {"none", "accepted", "applied", "expired", "clock_unsynced", "disabled", "fault", "duplicate", "invalid", "cancelled", "unsafe_air"};
    return names[static_cast<unsigned>(q)];
}
Sample SensorMonitor::read(uint64_t now) const {
    Sample result = sample_;
    if (result.count && now - result.last_good_ms > board::sensor_stale_ms && result.quality == Quality::ok) result.quality = Quality::stale;
    return result;
}
void SensorMonitor::failure(Quality reason, uint64_t now) {
    sample_.quality = reason;
    sample_.sampled_ms = now;
    ++sample_.failures;
}
void SensorMonitor::success(const float* values, unsigned count, uint64_t now) {
    const unsigned expected = index_ == 0 ? 3 : index_ == 1 ? 2 : 1;
    if (count != expected) { failure(Quality::protocol, now); return; }
    const float low[] = {250, -60, 0};
    const float high[] = {10000, 80, 100};
    for (unsigned i = 0; i < count; ++i) {
        unsigned channel = index_ == 0 ? i : index_ == 1 ? i + 1 : 0;
        float min = index_ >= 2 ? 0 : low[channel];
        float max = index_ >= 2 ? 1000 : high[channel];
        if (!std::isfinite(values[i]) || values[i] < min || values[i] > max) { failure(Quality::range, now); return; }
    }
    bool unchanged = sample_.count == count;
    bool jump = false;
    const float jump_limits[] = {1000, 10, 25};
    for (unsigned i = 0; i < count; ++i) {
        unchanged = unchanged && values[i] == sample_.values[i];
        float threshold = index_ >= 2 ? 100 : jump_limits[index_ == 1 ? i + 1 : i];
        jump = jump || (sample_.count && now - sample_.last_good_ms < board::sensor_stale_ms && std::fabs(values[i] - sample_.values[i]) > threshold);
    }
    if (!unchanged) unchanged_since_ = now;
    std::copy_n(values, count, sample_.values.begin());
    sample_.count = count; sample_.sampled_ms = now; sample_.last_good_ms = now; sample_.failures = 0;
    sample_.quality = jump ? Quality::suspect_jump : unchanged && now - unchanged_since_ >= 1800000 ? Quality::suspect_stuck : Quality::ok;
}
void Controller::stop_window() { state_.outputs.open = false; state_.outputs.close = false; }
void Controller::finish(unsigned target, Outcome outcome) {
    if (active_[target].id) {
        state_.results[target] = {active_[target].id, outcome};
        completed_[completed_cursor_++ % completed_.size()] = active_[target].id;
    }
    active_[target] = {};
}
Outcome Controller::command(const Command& c, uint64_t now, int64_t epoch_ms) {
    const auto t = static_cast<unsigned>(c.target);
    if (!c.id || t > 2) return Outcome::invalid;
    for (auto id : completed_) if (id == c.id) return Outcome::duplicate;
    for (auto a : active_) if (a.id == c.id) return Outcome::duplicate;
    auto reject = [&](Outcome outcome) { state_.results[t] = {c.id, outcome}; completed_[completed_cursor_++ % completed_.size()] = c.id; return outcome; };
    if (!commissioned_) return reject(Outcome::disabled);
    if (epoch_ms < 1700000000000LL) return reject(Outcome::clock_unsynced);
    if (c.expires_epoch_ms <= epoch_ms) return reject(Outcome::expired);
    if ((t == 2 && state_.window_fault) || (t < 2 && state_.fan_fault[t] && c.desired)) return reject(Outcome::fault);
    if (active_[t].id) finish(t, Outcome::expired);
    active_[t] = c; started_[t] = now;
    if (c.manual) manual_until_ = now + 30 * 60 * 1000;
    state_.results[t] = {c.id, Outcome::accepted};
    if (t == 0) state_.outputs.exhaust = c.desired;
    if (t == 1) state_.outputs.intake = c.desired;
    if (t == 2) {
        stop_window();
        // Direction reversal is separated by the next control tick.
    }
    return Outcome::accepted;
}
void Controller::reconcile_pending(const uint64_t* ids, size_t count) {
    for (unsigned t = 0; t < 3; ++t) {
        if (!active_[t].id) continue;
        bool found = false; for (size_t i = 0; i < count; ++i) found = found || ids[i] == active_[t].id;
        if (!found) {
            if (t == 2) stop_window();
            if (t == 0) state_.outputs.exhaust = false;
            if (t == 1) state_.outputs.intake = false;
            finish(t, Outcome::cancelled);
        }
    }
}
void Controller::tick(uint64_t now, int64_t epoch_ms, const Feedback& f) {
    state_.feedback = f;
    state_.position_percent = f.open_limit && !f.close_limit ? 100 : f.close_limit && !f.open_limit ? 0 : -1;
    if (f.open_limit && f.close_limit) { state_.window_fault = true; stop_window(); finish(2, Outcome::fault); }
    for (unsigned t = 0; t < 3; ++t) {
        if (!active_[t].id) continue;
        if (epoch_ms < 1700000000000LL || active_[t].expires_epoch_ms <= epoch_ms) {
            if (t == 2) stop_window();
            if (t == 0) state_.outputs.exhaust = false;
            if (t == 1) state_.outputs.intake = false;
            finish(t, Outcome::expired); continue;
        }
        const auto age = now - started_[t];
        if (t == 2) {
            if ((active_[t].desired && f.open_limit) || (!active_[t].desired && f.close_limit)) { stop_window(); finish(t, Outcome::applied); }
            else if (age >= board::window_travel_ms) { state_.window_fault = true; stop_window(); finish(t, Outcome::fault); }
            else if (age >= 100) { state_.outputs.open = active_[t].desired; state_.outputs.close = !active_[t].desired; }
        } else {
            const auto rpm = t == 0 ? f.exhaust_rpm : f.intake_rpm;
            if (age >= 1000 && (active_[t].desired ? rpm > 0 : rpm == 0)) finish(t, Outcome::applied);
            else if (age >= board::fan_start_ms) { state_.fan_fault[t] = true; if (t == 0) state_.outputs.exhaust = false; else state_.outputs.intake = false; finish(t, Outcome::fault); }
        }
    }
    // Loss of expected feedback is a fault even after an acknowledged command.
    if (state_.outputs.exhaust && f.exhaust_rpm == 0 && now - started_[0] >= board::fan_start_ms) { state_.fan_fault[0] = true; state_.outputs.exhaust = false; }
    if (state_.outputs.intake && f.intake_rpm == 0 && now - started_[1] >= board::fan_start_ms) { state_.fan_fault[1] = true; state_.outputs.intake = false; }
}
void Controller::autonomous(uint64_t now, const Sample& indoor, const Sample& outdoor, const Sample& pm, const Policy& p) {
    if (!commissioned_) return;
    auto fresh = [now](const Sample& s) { return s.quality == Quality::ok && s.count && now - s.last_good_ms <= board::sensor_stale_ms; };
    const bool safe = fresh(outdoor) && fresh(pm) && pm.values[0] <= p.outdoor_pm25_max && outdoor.values[0] >= p.outdoor_min_c && outdoor.values[0] <= p.outdoor_max_c;
    if (!safe || !fresh(indoor)) {
        // Stop uncertain movement. A closed window is never inferred or forced without feedback.
        stop_window();
        state_.outputs.exhaust = false; state_.outputs.intake = false;
        for (unsigned target = 0; target < 3; ++target) if (active_[target].id) finish(target, Outcome::unsafe_air);
        return;
    }
    if (now < manual_until_ || active_[0].id || active_[1].id || active_[2].id) return;
    if (indoor.values[0] >= p.co2_on) {
        if (!state_.fan_fault[0] && !state_.outputs.exhaust) { started_[0] = now; state_.outputs.exhaust = true; }
        if (!state_.fan_fault[1] && !state_.outputs.intake) { started_[1] = now; state_.outputs.intake = true; }
    } else if (indoor.values[0] <= p.co2_off) { state_.outputs.exhaust = false; state_.outputs.intake = false; }
}
}
