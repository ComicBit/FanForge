# FanForge

![FanForge Web App](docs/assets/fanforge-ui.png)

FanForge is an ESP32/ESPHome fan-control project with:
- Autonomous on-device control logic
- An optional, polished web UI for curve editing and telemetry
- A clean HTTP API contract for integration

## Highlights

- Draggable fan-curve editor with `linear` and `smooth` interpolation
- Real-time temperature and PWM telemetry
- Failsafe temperature, PWM limits, slew-rate, and operating modes
- Dockerized UI for fast local usage
- ESPHome-first firmware that runs independently from the UI

## Important Design Principle

The web UI is **optional**.

Your controller keeps operating from persisted on-device config even if:
- The UI is closed
- The UI container is down
- The network/UI is unavailable

## Quick Start (Optional UI with Docker)

```bash
docker compose up --build
```

Open: [http://localhost:8080](http://localhost:8080)

## Local UI Development

```bash
npm install
npm run dev
```

## Firmware (Standalone ESPHome)

Primary firmware files:
- `firmware/esphome/fanforge-controller.yaml`
- `firmware/esphome/fanforge_api.h`

API schema:
- `openapi/esp32-api.yaml`

Endpoints:
- `GET /api/status`
- `GET /api/config`
- `POST /api/config`

If the browser UI talks directly to your device, allow CORS for your UI origin (for example `http://localhost:8080`).

Reference hardware mapping in starter config:
- `DS18B20` temperature sensor on `GPIO4` (OneWire)
- 4-wire fan PWM output on `GPIO18` at `25kHz` (via `6N137` path in this reference design)

## Repository Layout

- `src/` web UI
- `firmware/esphome/` firmware config and control/API logic
- `openapi/esp32-api.yaml` OpenAPI contract
- `Dockerfile`, `docker-compose.yml` containerized UI runtime
