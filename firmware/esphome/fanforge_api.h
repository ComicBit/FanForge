#pragma once

#include "esphome.h"
#include "esphome/components/web_server_base/web_server_base.h"

#ifdef USE_ESP32
#include <ArduinoJson.h>
#include <cmath>
#include <cstring>
#include <string>

#if __has_include("esphome/components/web_server_idf/web_server_idf.h")
#include "esphome/components/web_server_idf/web_server_idf.h"
#endif

using esphome::web_server_base::global_web_server_base;
using esphome::web_server_idf::AsyncWebHandler;
using esphome::web_server_idf::AsyncWebServerRequest;
using esphome::web_server_idf::AsyncWebServerResponse;

static constexpr int FT_MAX_POINTS = 16;

/**
 * Hardware: EC fan "yellow" control input has an internal pull-up to ~5V.
 * We drive it using an NPN open-collector pull-down:
 *   - ESP GPIO -> base resistor -> NPN base
 *   - NPN collector -> fan yellow
 *   - NPN emitter -> GND (shared with fan)
 *
 * In this topology the effective signal at the fan is inverted:
 *   GPIO HIGH  -> transistor ON  -> yellow pulled LOW
 *   GPIO LOW   -> transistor OFF -> yellow pulled HIGH (via fan pull-up)
 *
 * Many EC fans interpret "HIGH" as maximum command, and "LOW" as minimum/off.
 * Therefore we invert so that "pwm_pct" feels intuitive:
 *   pwm_pct = 0%   => yellow LOW (off/min)
 *   pwm_pct = 100% => yellow HIGH (max)
 */
static constexpr bool FT_PWM_INVERTED = true;

// Ignore only DS18B20 half-degree chatter around a stable point.
// Any movement >= ~0.5 C should be considered "real" for control.
static constexpr float FT_TEMP_CONTROL_DEADBAND_C = 0.51f;

// No additional PWM deadband: temperature gating above is the only ignore rule.
static constexpr float FT_PWM_DEADBAND_PCT = 0.0f;

// Failsafe hysteresis.
static constexpr float FT_FAILSAFE_HYST_C = 1.0f;
static float ft_last_target_pwm_pct = 0.0f;
static float ft_last_output_level = 0.0f;
static bool ft_control_temp_initialized = false;
static float ft_control_temp_c = NAN;

struct FtPoint {
  float t;
  float p;
};

static inline float ft_clampf(float v, float lo, float hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

static inline void ft_add_cors(AsyncWebServerResponse *res) {
  // ESPHome web_server already emits Access-Control-Allow-Origin.
  // Adding it again here results in duplicated values ("*, *") and browser CORS failures.
  res->addHeader("Access-Control-Allow-Headers", "Content-Type");
  res->addHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res->addHeader("Access-Control-Allow-Private-Network", "true");
}

static inline const char *ft_mode_to_str(int mode) {
  switch (mode) {
    case 1:
      return "manual";
    case 2:
      return "off";
    default:
      return "auto";
  }
}

static inline int ft_str_to_mode(const char *mode) {
  if (strcmp(mode, "manual") == 0) return 1;
  if (strcmp(mode, "off") == 0) return 2;
  return 0;
}

static inline const char *ft_smoothing_to_str(int smoothing_mode) {
  return smoothing_mode == 0 ? "linear" : "smooth";
}

static inline int ft_str_to_smoothing(const char *smoothing_mode) {
  return (strcmp(smoothing_mode, "linear") == 0) ? 0 : 1;
}

static inline void ft_send_json(AsyncWebServerRequest *req, JsonDocument &doc, int status = 200) {
  std::string payload;
  serializeJson(doc, payload);
  auto *res = req->beginResponse(status, "application/json", payload);
  req->send(res);
}

static inline int ft_load_points(FtPoint *out_points, int max_points) {
  JsonDocument points_doc;
  DeserializationError err = deserializeJson(points_doc, id(cfg_points_json).c_str());
  if (err || !points_doc.is<JsonArray>()) return 0;

  int n = 0;
  for (JsonObject p : points_doc.as<JsonArray>()) {
    if (n >= max_points) break;
    if (!p["t"].is<float>() || !p["p"].is<float>()) continue;
    out_points[n].t = p["t"].as<float>();
    out_points[n].p = p["p"].as<float>();
    n++;
  }
  return n;
}

static inline float ft_curve_linear(float temp, const FtPoint *pts, int n) {
  if (n <= 0) return 0.0f;
  if (temp <= pts[0].t) return pts[0].p;
  if (temp >= pts[n - 1].t) return pts[n - 1].p;

  for (int i = 0; i < n - 1; i++) {
    const FtPoint &a = pts[i];
    const FtPoint &b = pts[i + 1];
    if (temp >= a.t && temp <= b.t) {
      float u = (temp - a.t) / fmaxf(1e-6f, (b.t - a.t));
      return a.p + (b.p - a.p) * u;
    }
  }
  return pts[n - 1].p;
}

static inline float ft_curve_smooth(float temp, const FtPoint *pts, int n) {
  if (n <= 0) return 0.0f;
  if (n == 1) return pts[0].p;

  if (temp <= pts[0].t) return pts[0].p;
  if (temp >= pts[n - 1].t) return pts[n - 1].p;

  float m[FT_MAX_POINTS] = {0};
  float tg[FT_MAX_POINTS] = {0};

  for (int i = 0; i < n - 1; i++) {
    float dx = pts[i + 1].t - pts[i].t;
    float dy = pts[i + 1].p - pts[i].p;
    m[i] = dy / fmaxf(1e-6f, dx);
  }

  tg[0] = m[0];
  tg[n - 1] = m[n - 2];
  for (int i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0.0f)
      tg[i] = 0.0f;
    else
      tg[i] = (m[i - 1] + m[i]) * 0.5f;
  }

  for (int i = 0; i < n - 1; i++) {
    if (fabsf(m[i]) < 1e-6f) {
      tg[i] = 0.0f;
      tg[i + 1] = 0.0f;
      continue;
    }
    float a = tg[i] / m[i];
    float b = tg[i + 1] / m[i];
    float s = a * a + b * b;
    if (s > 9.0f) {
      float k = 3.0f / sqrtf(s);
      tg[i] = k * a * m[i];
      tg[i + 1] = k * b * m[i];
    }
  }

  int seg = 0;
  for (; seg < n - 1; seg++) {
    if (temp >= pts[seg].t && temp <= pts[seg + 1].t) break;
  }

  float x0 = pts[seg].t;
  float x1 = pts[seg + 1].t;
  float y0 = pts[seg].p;
  float y1 = pts[seg + 1].p;
  float h = x1 - x0;
  float u = (temp - x0) / fmaxf(1e-6f, h);

  float h00 = 2.0f * u * u * u - 3.0f * u * u + 1.0f;
  float h10 = u * u * u - 2.0f * u * u + u;
  float h01 = -2.0f * u * u * u + 3.0f * u * u;
  float h11 = u * u * u - u * u;

  return h00 * y0 + h10 * h * tg[seg] + h01 * y1 + h11 * h * tg[seg + 1];
}

static inline bool ft_parse_points(JsonArray in_points, JsonArray out_points, String &err) {
  if (in_points.size() < 2) {
    err = "points must contain at least 2 items";
    return false;
  }

  float prev_t = -100000.0f;
  for (JsonObject p : in_points) {
    if (!p["t"].is<float>() || !p["p"].is<float>()) {
      err = "each point must include numeric t and p";
      return false;
    }

    float t = p["t"].as<float>();
    float pwm = p["p"].as<float>();

    if (pwm < 0.0f || pwm > 100.0f) {
      err = "point.p must be within 0..100";
      return false;
    }

    if (t <= prev_t) {
      err = "point temperatures must be strictly increasing";
      return false;
    }

    prev_t = t;

    JsonObject dst = out_points.add<JsonObject>();
    dst["t"] = roundf(t);
    dst["p"] = roundf(pwm);
  }

  return true;
}

static inline void ft_build_config_doc(JsonDocument &doc) {
  doc["mode"] = ft_mode_to_str(id(cfg_mode));
  doc["smoothing_mode"] = ft_smoothing_to_str(id(cfg_smoothing_mode));

  JsonDocument points_doc;
  DeserializationError points_err = deserializeJson(points_doc, id(cfg_points_json).c_str());
  JsonArray dst_points = doc["points"].to<JsonArray>();

  if (!points_err && points_doc.is<JsonArray>()) {
    for (JsonObject p : points_doc.as<JsonArray>()) {
      JsonObject out_p = dst_points.add<JsonObject>();
      out_p["t"] = p["t"].as<float>();
      out_p["p"] = p["p"].as<float>();
    }
  } else {
    JsonObject p1 = dst_points.add<JsonObject>();
    p1["t"] = 20;
    p1["p"] = 20;
    JsonObject p2 = dst_points.add<JsonObject>();
    p2["t"] = 50;
    p2["p"] = 100;
  }

  doc["min_pwm"] = id(cfg_min_pwm);
  doc["max_pwm"] = id(cfg_max_pwm);
  doc["curve_min"] = id(cfg_curve_min);
  doc["curve_max"] = id(cfg_curve_max);
  doc["slew_pct_per_sec"] = id(cfg_slew_pct_per_sec);
  doc["failsafe_temp"] = id(cfg_failsafe_temp);
  doc["failsafe_pwm"] = id(cfg_failsafe_pwm);

  // Optional: expose manual pwm for UI convenience (doesn't change API contract)
  doc["manual_pwm"] = id(cfg_manual_pwm);
}

static inline bool ft_apply_config_doc(JsonDocument &doc, String &err) {
  const int prev_mode = id(cfg_mode);
  const float prev_manual_pwm = id(cfg_manual_pwm);

  if (!doc["mode"].is<const char *>()) {
    err = "mode is required";
    return false;
  }

  if (!doc["points"].is<JsonArray>()) {
    err = "points array is required";
    return false;
  }

  if (!doc["smoothing_mode"].is<const char *>()) {
    err = "smoothing_mode is required";
    return false;
  }

  if (!doc["min_pwm"].is<float>() || !doc["max_pwm"].is<float>() || !doc["slew_pct_per_sec"].is<float>() ||
      !doc["failsafe_temp"].is<float>() || !doc["failsafe_pwm"].is<float>()) {
    err = "numeric fields are required: min_pwm, max_pwm, slew_pct_per_sec, failsafe_temp, failsafe_pwm";
    return false;
  }

  const char *mode_str = doc["mode"].as<const char *>();
  const char *smoothing_str = doc["smoothing_mode"].as<const char *>();
  if (strcmp(smoothing_str, "linear") != 0 && strcmp(smoothing_str, "smooth") != 0) {
    err = "smoothing_mode must be linear or smooth";
    return false;
  }

  int mode = ft_str_to_mode(mode_str);
  int smoothing_mode = ft_str_to_smoothing(smoothing_str);
  float min_pwm = ft_clampf(doc["min_pwm"].as<float>(), 0.0f, 100.0f);
  float max_pwm = ft_clampf(doc["max_pwm"].as<float>(), 0.0f, 100.0f);
  float slew = ft_clampf(doc["slew_pct_per_sec"].as<float>(), 0.0f, 100.0f);
  float failsafe_temp = ft_clampf(doc["failsafe_temp"].as<float>(), 0.0f, 120.0f);
  float failsafe_pwm = ft_clampf(doc["failsafe_pwm"].as<float>(), 0.0f, 100.0f);
  float curve_min = id(cfg_curve_min);
  float curve_max = id(cfg_curve_max);

  if (doc["curve_min"].is<float>()) curve_min = doc["curve_min"].as<float>();
  if (doc["curve_max"].is<float>()) curve_max = doc["curve_max"].as<float>();

  curve_min = ft_clampf(roundf(curve_min), 15.0f, 50.0f);
  curve_max = ft_clampf(roundf(curve_max), 15.0f, 50.0f);
  if (curve_max < curve_min) {
    float tmp = curve_min;
    curve_min = curve_max;
    curve_max = tmp;
  }
  if ((curve_max - curve_min) < 1.0f) {
    if ((curve_max + 1.0f) <= 50.0f) curve_max = curve_min + 1.0f;
    else curve_min = curve_max - 1.0f;
  }

  if (max_pwm < min_pwm) {
    err = "max_pwm must be >= min_pwm";
    return false;
  }

  JsonDocument points_doc;
  JsonArray points = points_doc.to<JsonArray>();
  if (!ft_parse_points(doc["points"].as<JsonArray>(), points, err)) return false;
  for (JsonObject p : points) {
    float point_pwm = p["p"].as<float>();
    if (point_pwm < min_pwm || point_pwm > max_pwm) {
      err = "point.p must be within min_pwm..max_pwm";
      return false;
    }
  }

  std::string points_json;
  serializeJson(points, points_json);

  id(cfg_mode) = mode;
  id(cfg_smoothing_mode) = smoothing_mode;
  id(cfg_points_json) = points_json;
  id(cfg_min_pwm) = min_pwm;
  id(cfg_max_pwm) = max_pwm;
  id(cfg_curve_min) = curve_min;
  id(cfg_curve_max) = curve_max;
  id(cfg_slew_pct_per_sec) = slew;
  id(cfg_failsafe_temp) = failsafe_temp;
  id(cfg_failsafe_pwm) = failsafe_pwm;

  // Optional
  if (doc["manual_pwm"].is<float>()) {
    id(cfg_manual_pwm) = ft_clampf(doc["manual_pwm"].as<float>(), 0.0f, 100.0f);
  }

  if (id(cfg_mode) != prev_mode) {
    id(fan_mode).publish_state(ft_mode_to_str(id(cfg_mode)));
  }

  if (id(cfg_mode) == 1) {
    if (id(cfg_manual_pwm) != prev_manual_pwm || doc["manual_pwm"].is<float>()) {
      id(fan_manual_pwm).publish_state(id(cfg_manual_pwm));
    }
  } else {
    id(fan_manual_pwm).publish_state(NAN);
  }

  return true;
}

static inline void ft_apply_pwm_percent(float pwm_pct) {
  // pwm_pct here is the "user meaning": 0..100, where 0 should truly be off/min.
  pwm_pct = ft_clampf(pwm_pct, 0.0f, 100.0f);

  float level = pwm_pct / 100.0f;          // 0..1
  if (FT_PWM_INVERTED) level = 1.0f - level;

  level = ft_clampf(level, 0.0f, 1.0f);
  ft_last_output_level = level;
  id(fan_pwm_output).set_level(level);
}

static inline void fanforge_control_tick() {
  static bool failsafe_latched = false;

  // Load curve points
  FtPoint points[FT_MAX_POINTS];
  int n = ft_load_points(points, FT_MAX_POINTS);
  if (n < 2) {
    points[0] = {20.0f, 20.0f};
    points[1] = {50.0f, 100.0f};
    n = 2;
  }

  // Compute target
  float target_pwm = 0.0f;
  float temp = NAN;
  bool is_auto_mode = false;
  bool use_output_shaping = false;

  float raw_temp = id(temp_c).state;
  if (isfinite(raw_temp)) {
    // Temperature deadband before curve evaluation: ignore 0.5 C chatter,
    // but accept larger movement immediately.
    if (!ft_control_temp_initialized || !isfinite(ft_control_temp_c)) {
      ft_control_temp_c = raw_temp;
      ft_control_temp_initialized = true;
    } else if (fabsf(raw_temp - ft_control_temp_c) >= FT_TEMP_CONTROL_DEADBAND_C) {
      ft_control_temp_c = raw_temp;
    }
    id(control_temp_c) = ft_control_temp_c;
    id(control_temp_valid) = true;
  } else {
    id(control_temp_valid) = false;
  }

  if (id(cfg_mode) == 2) {
    // OFF: force to 0 immediately.
    target_pwm = 0.0f;
  } else if (id(cfg_mode) == 1) {
    // MANUAL: direct operator control for validation/tuning.
    target_pwm = ft_clampf(id(cfg_manual_pwm), 0.0f, 100.0f);
  } else {
    // AUTO
    // AUTO depends on temperature validity. MANUAL/OFF should still operate without a sensor reading.
    if (!isfinite(raw_temp) || !ft_control_temp_initialized || !isfinite(ft_control_temp_c)) {
      id(last_update_ms) = millis();
      return;
    }
    temp = ft_control_temp_c;

    is_auto_mode = true;
    use_output_shaping = true;
    target_pwm = (id(cfg_smoothing_mode) == 1) ? ft_curve_smooth(temp, points, n) : ft_curve_linear(temp, points, n);
    target_pwm = ft_clampf(target_pwm, 0.0f, 100.0f);
  }

  if (is_auto_mode) {
    // In AUTO, enforce a practical running window once we're above 0.
    if (target_pwm > 0.0f) {
      target_pwm = ft_clampf(target_pwm, id(cfg_min_pwm), id(cfg_max_pwm));
    } else {
      target_pwm = 0.0f;
    }
  }

  // Failsafe applies only during AUTO control.
  if (is_auto_mode) {
    if (temp >= id(cfg_failsafe_temp)) {
      failsafe_latched = true;
    } else if (temp <= (id(cfg_failsafe_temp) - FT_FAILSAFE_HYST_C)) {
      failsafe_latched = false;
    }
    if (failsafe_latched) target_pwm = fmaxf(target_pwm, id(cfg_failsafe_pwm));
  } else {
    failsafe_latched = false;
  }
  target_pwm = ft_clampf(target_pwm, 0.0f, 100.0f);

  float next_pwm = target_pwm;
  uint32_t now = millis();
  if (use_output_shaping) {
    // Deadband: avoid micro-hunting due to quantization/noise
    if (fabsf(target_pwm - id(current_pwm_pct)) < FT_PWM_DEADBAND_PCT) {
      target_pwm = id(current_pwm_pct);
    }

    // Slew limiting
    float dt = 0.2f;
    if (id(last_update_ms) > 0 && now >= id(last_update_ms)) {
      dt = fmaxf(0.02f, (now - id(last_update_ms)) / 1000.0f);
    }

    float max_step = ft_clampf(id(cfg_slew_pct_per_sec), 0.0f, 100.0f) * dt;
    float delta = target_pwm - id(current_pwm_pct);
    float step = ft_clampf(delta, -max_step, max_step);
    next_pwm = ft_clampf(id(current_pwm_pct) + step, 0.0f, 100.0f);
  }

  id(current_pwm_pct) = next_pwm;
  ft_last_target_pwm_pct = target_pwm;
  id(last_update_ms) = now;

  // Drive hardware output
  ft_apply_pwm_percent(next_pwm);
}

class FanForgeApiHandler : public AsyncWebHandler {
 public:
  bool canHandle(AsyncWebServerRequest *request) const override {
    const std::string url = request->url();
    if (url != "/api/status" && url != "/api/config") return false;
    const http_method m = request->method();
    return m == HTTP_GET || m == HTTP_POST || m == HTTP_OPTIONS;
  }

  bool isRequestHandlerTrivial() const override { return false; }

  void handleRequest(AsyncWebServerRequest *request) override {
    const std::string url = request->url();
    const http_method m = request->method();

    if (m == HTTP_OPTIONS) {
      auto *res = request->beginResponse(200, "text/plain", "ok");
      ft_add_cors(res);
      res->addHeader("Access-Control-Max-Age", "600");
      request->send(res);
      return;
    }

    if (m == HTTP_GET && url == "/api/status") {
      JsonDocument doc;

      if (ft_control_temp_initialized && isfinite(ft_control_temp_c))
        doc["temp_c"] = ft_control_temp_c;
      else if (isfinite(id(temp_c).state))
        doc["temp_c"] = id(temp_c).state;
      else
        doc["temp_c"] = nullptr;

      doc["pwm_pct"] = id(current_pwm_pct);
      doc["target_pwm_pct"] = ft_last_target_pwm_pct;
      doc["output_level"] = ft_last_output_level;
      doc["mode"] = ft_mode_to_str(id(cfg_mode));
      doc["smoothing_mode"] = ft_smoothing_to_str(id(cfg_smoothing_mode));
      doc["min_pwm"] = id(cfg_min_pwm);
      doc["max_pwm"] = id(cfg_max_pwm);
      doc["slew_pct_per_sec"] = id(cfg_slew_pct_per_sec);
      doc["manual_pwm"] = id(cfg_manual_pwm);
      doc["last_update_ms"] = id(last_update_ms);

      ft_send_json(request, doc, 200);
      return;
    }

    if (m == HTTP_GET && url == "/api/config") {
      JsonDocument doc;
      ft_build_config_doc(doc);
      ft_send_json(request, doc, 200);
      return;
    }

    if (m == HTTP_POST && url == "/api/config") {
      std::string body;
      if (request->hasArg("plain")) {
        body = request->arg("plain");
      } else if (request->hasArg("payload")) {
        body = request->arg("payload");
      } else if (request->hasArg("config")) {
        body = request->arg("config");
      }

      if (body.empty()) {
        JsonDocument err_doc;
        err_doc["error"] = "empty request body";
        ft_send_json(request, err_doc, 400);
        return;
      }

      JsonDocument in_doc;
      DeserializationError parse_err = deserializeJson(in_doc, body);
      if (parse_err) {
        JsonDocument err_doc;
        err_doc["error"] = String("invalid JSON: ") + parse_err.c_str();
        ft_send_json(request, err_doc, 400);
        return;
      }

      String err;
      if (!ft_apply_config_doc(in_doc, err)) {
        JsonDocument err_doc;
        err_doc["error"] = err;
        ft_send_json(request, err_doc, 400);
        return;
      }

      JsonDocument out_doc;
      ft_build_config_doc(out_doc);
      ft_send_json(request, out_doc, 200);
      return;
    }

    auto *res = request->beginResponse(404, "application/json", "{}");
    request->send(res);
  }
};

static inline void fanforge_api_init() {
  auto *ws = global_web_server_base;
  if (ws == nullptr) {
    ESP_LOGW("fanforge_api", "web_server_base not initialized; API routes not registered");
    return;
  }

  ws->add_handler(new FanForgeApiHandler());
  ESP_LOGI("fanforge_api", "Registered /api/status and /api/config");
}

#endif  // USE_ESP32
