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
static constexpr bool FT_PWM_INVERTED = true;  // 6N137 + 4-wire fan common wiring
// Control-loop stabilization for real sensor noise and DS18B20 quantization.
//
// FT_TEMP_EMA_ALPHA controls exponential moving average (EMA) filtering applied
// to raw temperature before curve evaluation:
//   filtered = filtered + alpha * (raw - filtered)
// - Lower alpha (ex: 0.10..0.20): stronger filtering, less jitter, but slower
//   response to real thermal changes (more lag when system heats/cools quickly).
// - Higher alpha (ex: 0.35..0.60): faster tracking of real changes, but more
//   sensitivity to measurement noise and step-like sensor quantization.
// Practical tuning:
// - If PWM chatters while temperature is near steady state, decrease alpha.
// - If fan reacts too slowly to load spikes, increase alpha slightly.
// - Change in small steps (about 0.05) and re-test thermal transients.
static constexpr float FT_TEMP_EMA_ALPHA = 0.25f;
//
// FT_PWM_DEADBAND_PCT defines a "do nothing" zone around current output.
// If |target_pwm - current_pwm| is below this threshold, we hold output steady.
// This removes constant micro-corrections caused by sensor noise and finite
// temperature resolution (9-bit DS18B20 reports in 0.5 C steps).
// - Lower deadband (ex: 0.5..1.0): tighter control, but more audible/visible
//   fan speed hunting in noisy conditions.
// - Higher deadband (ex: 2.0..3.0): calmer fan behavior, but coarse control and
//   slightly larger steady-state temperature error near curve transitions.
// Practical tuning:
// - Start around 1.0..1.5 for most fans.
// - Increase if RPM keeps oscillating at stable temperature.
// - Decrease if output feels too "sticky" and misses small valid corrections.
static constexpr float FT_PWM_DEADBAND_PCT = 1.5f;
//
// FT_FAILSAFE_HYST_C is hysteresis applied to failsafe threshold to avoid
// rapid on/off toggling when temperature hovers around cfg_failsafe_temp.
// Behavior:
// - Failsafe turns ON at:  temp >= cfg_failsafe_temp
// - Failsafe turns OFF at: temp <= cfg_failsafe_temp - hysteresis
// - Effective band width is exactly FT_FAILSAFE_HYST_C degrees C.
// - Lower hysteresis (ex: 0.3..0.7): faster release from failsafe, but higher
//   risk of chatter near threshold.
// - Higher hysteresis (ex: 1.5..3.0): very stable failsafe state, but slower
//   return to normal control after a high-temperature event.
// Practical tuning:
// - Keep at least 0.5 C with DS18B20 at 9-bit resolution.
// - Increase if failsafe repeatedly toggles near threshold.
static constexpr float FT_FAILSAFE_HYST_C = 1.0f;

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
  ft_add_cors(res);
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
  doc["slew_pct_per_sec"] = id(cfg_slew_pct_per_sec);
  doc["failsafe_temp"] = id(cfg_failsafe_temp);
  doc["failsafe_pwm"] = id(cfg_failsafe_pwm);
}

static inline bool ft_apply_config_doc(JsonDocument &doc, String &err) {
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

  if (max_pwm < min_pwm) {
    err = "max_pwm must be >= min_pwm";
    return false;
  }

  JsonDocument points_doc;
  JsonArray points = points_doc.to<JsonArray>();
  if (!ft_parse_points(doc["points"].as<JsonArray>(), points, err)) return false;

  std::string points_json;
  serializeJson(points, points_json);

  id(cfg_mode) = mode;
  id(cfg_smoothing_mode) = smoothing_mode;
  id(cfg_points_json) = points_json;
  id(cfg_min_pwm) = min_pwm;
  id(cfg_max_pwm) = max_pwm;
  id(cfg_slew_pct_per_sec) = slew;
  id(cfg_failsafe_temp) = failsafe_temp;
  id(cfg_failsafe_pwm) = failsafe_pwm;

  return true;
}

static inline void fanforge_control_tick() {
  static bool temp_filter_initialized = false;
  static float filtered_temp_c = NAN;
  static bool failsafe_latched = false;

  FtPoint points[FT_MAX_POINTS];
  int n = ft_load_points(points, FT_MAX_POINTS);
  if (n < 2) {
    points[0] = {20.0f, 20.0f};
    points[1] = {50.0f, 100.0f};
    n = 2;
  }

  float raw_temp = id(temp_c).state;
  if (!isfinite(raw_temp)) {
    id(last_update_ms) = millis();
    return;
  }

  if (!temp_filter_initialized || !isfinite(filtered_temp_c)) {
    filtered_temp_c = raw_temp;
    temp_filter_initialized = true;
  } else {
    filtered_temp_c += FT_TEMP_EMA_ALPHA * (raw_temp - filtered_temp_c);
  }
  float temp = filtered_temp_c;

  float target_pwm = 0.0f;
  if (id(cfg_mode) == 2) {
    target_pwm = 0.0f;
  } else if (id(cfg_mode) == 1) {
    target_pwm = ft_clampf(id(cfg_manual_pwm), 0.0f, 100.0f);
  } else {
    target_pwm = (id(cfg_smoothing_mode) == 1) ? ft_curve_smooth(temp, points, n) : ft_curve_linear(temp, points, n);
  }

  target_pwm = ft_clampf(target_pwm, id(cfg_min_pwm), id(cfg_max_pwm));
  if (temp >= id(cfg_failsafe_temp)) {
    failsafe_latched = true;
  } else if (temp <= (id(cfg_failsafe_temp) - FT_FAILSAFE_HYST_C)) {
    failsafe_latched = false;
  }
  if (failsafe_latched) target_pwm = fmaxf(target_pwm, id(cfg_failsafe_pwm));
  target_pwm = ft_clampf(target_pwm, 0.0f, 100.0f);

  // Keep fan output stable around tiny corrections caused by sensor quantization/noise.
  if (fabsf(target_pwm - id(current_pwm_pct)) < FT_PWM_DEADBAND_PCT) {
    target_pwm = id(current_pwm_pct);
  }

  uint32_t now = millis();
  float dt = 0.2f;
  if (id(last_update_ms) > 0 && now >= id(last_update_ms)) {
    dt = fmaxf(0.02f, (now - id(last_update_ms)) / 1000.0f);
  }

  float max_step = ft_clampf(id(cfg_slew_pct_per_sec), 0.0f, 100.0f) * dt;
  float delta = target_pwm - id(current_pwm_pct);
  float step = ft_clampf(delta, -max_step, max_step);
  float next_pwm = ft_clampf(id(current_pwm_pct) + step, 0.0f, 100.0f);

  id(current_pwm_pct) = next_pwm;
  id(last_update_ms) = now;

  float level = next_pwm / 100.0f;
  if (FT_PWM_INVERTED) level = 1.0f - level;
  level = ft_clampf(level, 0.0f, 1.0f);
  id(fan_pwm_output).set_level(level);
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
      if (isfinite(id(temp_c).state))
        doc["temp_c"] = id(temp_c).state;
      else
        doc["temp_c"] = nullptr;
      doc["pwm_pct"] = id(current_pwm_pct);
      doc["mode"] = ft_mode_to_str(id(cfg_mode));
      doc["smoothing_mode"] = ft_smoothing_to_str(id(cfg_smoothing_mode));
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
    ft_add_cors(res);
    request->send(res);
  }

 private:
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

#endif
