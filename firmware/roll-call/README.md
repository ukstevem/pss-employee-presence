# M5 PaperS3 — Roll-Call Marshal Device

Battery-powered e-paper device for fire-marshal roll call. Hits the
`/api/roll-call` endpoint on the LAN, displays IN-employees, and lets the
marshal tap each name to mark "accounted for".

## Hardware

- **M5Stack PaperS3** (ESP32-S3, 4.7" 540x960 e-paper, GT911 cap touch, battery, RTC)
- Powered on/off by side switch; BtnA = side button

## One-time setup

1. Install [PlatformIO Core](https://platformio.org/install/cli) (or use the VS Code extension).
2. Copy the config template:
   ```bash
   cp include/config.h.example include/config.h
   ```
3. Edit `include/config.h` — set `WIFI_SSID`, `WIFI_PASSWORD`, and `ROLL_CALL_URL` (the LAN URL of the employee-presence app, e.g. `http://10.0.0.75:3000/employee-presence/api/roll-call`).

`include/config.h` is gitignored — never commit credentials.

## Build & flash

Plug the PaperS3 in via USB-C, then:

```bash
pio run -e m5papers3 -t upload
pio device monitor       # optional, view serial logs
```

If upload fails to enter download mode, hold the side **BOOT** button while pressing **RST**, then release RST.

## Usage

- On power-up: connects to WiFi, fetches the snapshot, draws the IN-list.
- **Tap a name** → toggles the tick box and updates the counter (`In / OK / Out`).
- **`< Prev` / `Next >`** at the bottom paginate the list.
- **Side button (BtnA)** → re-snapshots from the server. Wipes existing ticks (intentional — one snapshot per incident).

Tick state lives only in RAM. Power-cycling or re-snapshotting clears it.

## Auth model

The API is open on the LAN (no token). The endpoint uses the Supabase
service-role key server-side, so the device doesn't need credentials. Lock
this down with a token in `Authorization:` headers if the device ever
leaves the private network.

## Endpoint contract

`GET /employee-presence/api/roll-call` returns:

```json
{
  "generated_at": "2026-05-11T09:00:00.000Z",
  "counts": { "in": 12, "out": 5, "never": 0, "total": 17 },
  "employees": [
    { "id": "...", "name": "...", "team": "...", "status": "in", "last_tap_at": "..." }
  ]
}
```

The firmware filters `status == "in"` client-side. If the contract changes, update `fetchSnapshot()` in `src/main.cpp`.
