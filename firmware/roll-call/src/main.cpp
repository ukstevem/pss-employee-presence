// Roll-call marshal device for M5Stack PaperS3.
//
// State machine:
//   IDLE     — auto-refreshes /api/roll-call every AUTO_REFRESH_MIN minutes.
//              Marshal sees a live view of who's IN.
//   INCIDENT — triggered the moment the marshal taps anyone (IN or not-IN).
//              Auto-refresh is paused; ticks/flags are preserved. BtnA =
//              close incident → POSTs to /api/roll-call/incidents then
//              clears state and returns to IDLE.
//
// On not-IN people: a tap is interpreted as an "exception flag" — the
// marshal has physically seen someone the system says isn't on site.
//
// Tick / flag state lives in RAM only. Closing the incident or fetching
// a new snapshot wipes it.

#include <M5Unified.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <time.h>
#include <vector>
#include "config.h"

struct Person {
  String id;
  String name;
  String team;
  String status;     // "in", "out", "never"
  bool   marked;     // IN: accounted-for. NOT-IN: exception (seen at muster).
};

enum class Mode { IDLE, INCIDENT };

// Global state
static std::vector<Person> g_in;
static std::vector<Person> g_notIn;
static String  g_snapshotAtIso;
static String  g_wifiInfo = "wifi: ?";
static String  g_status   = "boot";
static int     g_lastHttpCode = 0;
static int     g_page = 0;
static uint32_t g_lastFetchMs = 0;
static time_t  g_lastFetchEpoch = 0;
static Mode    g_mode = Mode::IDLE;
static time_t  g_incidentStartEpoch = 0;

// Layout (portrait 540 x 960)
static constexpr int SCREEN_W = 540;
static constexpr int SCREEN_H = 960;
static constexpr int HEADER_H = 220;
static constexpr int FOOTER_H = 80;
static constexpr int ROW_H    = 64;
static constexpr int ROWS_PER_PAGE = (SCREEN_H - HEADER_H - FOOTER_H) / ROW_H;
static constexpr int TICK_BOX = 44;
static constexpr int TICK_MARGIN = 16;

// Page index space:
//   [0 .. inPages-1]                       → IN list (tappable = accounted)
//   [inPages .. inPages + notInPages - 1]  → NOT-IN list (tappable = exception)
static int  inPages();
static int  notInPages();
static int  totalPages();

static void connectWifi();
static void syncTime();
static bool fetchSnapshot();
static bool postIncident();

static void renderAll();
static void renderHeader();
static void renderFooter();
static void renderRowAtIndex(int globalIdx, bool partial);

static void handleTouch(int x, int y);
static void enterIncidentMode();
static void closeIncident();

static String isoUtc(time_t t);
static String fmtLocalTime(time_t t);
static String relativeAgo(time_t t);

// =============================================================
// setup / loop
// =============================================================

void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);
  Serial.begin(115200);
  delay(500);
  Serial.println();
  Serial.println("=== roll-call boot ===");
  Serial.printf("device:%s url:%s\n", DEVICE_ID, ROLL_CALL_URL);

  M5.Display.setRotation(0);
  M5.Display.setEpdMode(epd_mode_t::epd_text);
  M5.Display.fillScreen(TFT_WHITE);
  M5.Display.setTextColor(TFT_BLACK, TFT_WHITE);
  M5.Display.setTextSize(2);
  M5.Display.setCursor(20, 20);
  M5.Display.println("Roll Call");
  M5.Display.println();
  M5.Display.println("Connecting WiFi...");

  connectWifi();
  syncTime();

  M5.Display.println("Fetching snapshot...");
  g_status = fetchSnapshot() ? "snapshot ok" : "fetch failed";
  Serial.printf("status: %s, http: %d, in: %d, notIn: %d\n",
                g_status.c_str(), g_lastHttpCode,
                (int)g_in.size(), (int)g_notIn.size());

  g_page = 0;
  renderAll();
}

void loop() {
  M5.update();

  // Side button — context-aware
  if (M5.BtnA.wasPressed()) {
    if (g_mode == Mode::INCIDENT) {
      // Close + POST incident. Only wipe local state if the POST succeeded —
      // a fire that takes the AP down must not also erase the marshal's
      // accounted-for list. Failed POST leaves ticks intact so the marshal
      // can retry (or read off the screen onto paper if all else fails).
      M5.Display.fillRect(0, SCREEN_H - FOOTER_H, SCREEN_W, FOOTER_H, TFT_WHITE);
      M5.Display.setCursor(20, SCREEN_H - FOOTER_H + 25);
      M5.Display.setTextSize(2);
      M5.Display.setTextColor(TFT_BLACK, TFT_WHITE);
      M5.Display.print("Closing incident...");
      bool ok = postIncident();
      Serial.printf("incident close: %s\n", ok ? "ok" : "FAIL");
      if (ok) {
        closeIncident();
        g_status = fetchSnapshot() ? "snapshot ok" : "fetch failed";
        g_page = 0;
      } else {
        g_status = "post failed — retry BtnA";
      }
      renderAll();
    } else {
      // IDLE: just re-snapshot manually.
      g_status = fetchSnapshot() ? "snapshot ok" : "fetch failed";
      g_page = 0;
      renderAll();
    }
  }

  if (M5.Touch.getCount() > 0) {
    auto t = M5.Touch.getDetail();
    if (t.wasPressed()) handleTouch(t.x, t.y);
  }

  // Auto-refresh (IDLE only)
  if (g_mode == Mode::IDLE && AUTO_REFRESH_MIN > 0 &&
      millis() - g_lastFetchMs > (uint32_t)AUTO_REFRESH_MIN * 60UL * 1000UL) {
    Serial.println("auto-refresh tick");
    if (fetchSnapshot()) renderAll();
  }

  delay(20);
}

// =============================================================
// Network / time
// =============================================================

static void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("WiFi: connecting to '%s'...\n", WIFI_SSID);
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 30000) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    IPAddress ip = WiFi.localIP();
    g_wifiInfo = String("wifi ok ") + ip.toString() + " rssi:" + String(WiFi.RSSI());
    Serial.printf("WiFi OK ip=%s rssi=%d\n", ip.toString().c_str(), WiFi.RSSI());
  } else {
    g_wifiInfo = String("wifi FAIL status=") + String((int)WiFi.status());
    Serial.printf("WiFi FAIL status=%d\n", (int)WiFi.status());
  }
}

static void syncTime() {
  configTime(0, 0, NTP_SERVER);
  Serial.printf("NTP: %s ...", NTP_SERVER);
  uint32_t start = millis();
  while (time(nullptr) < 1700000000UL && millis() - start < 10000) {
    delay(250);
    Serial.print(".");
  }
  Serial.printf(" epoch=%ld\n", (long)time(nullptr));
}

static bool fetchSnapshot() {
  if (WiFi.status() != WL_CONNECTED) connectWifi();
  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  http.setTimeout(10000);
  http.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
  Serial.printf("fetch: GET %s\n", ROLL_CALL_URL);
  if (!http.begin(ROLL_CALL_URL)) {
    Serial.println("fetch: http.begin failed");
    g_lastHttpCode = -1;
    return false;
  }
  http.addHeader("Accept", "application/json");
  http.addHeader("Accept-Encoding", "identity");
  int code = http.GET();
  g_lastHttpCode = code;
  Serial.printf("fetch: http %d\n", code);
  if (code != 200) {
    http.end();
    return false;
  }

  String body = http.getString();
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, body);
  http.end();
  if (err) {
    Serial.printf("fetch: parse err: %s\n", err.c_str());
    return false;
  }

  g_snapshotAtIso = String((const char*)doc["generated_at"]);
  g_in.clear();
  g_notIn.clear();
  for (JsonObject e : doc["employees"].as<JsonArray>()) {
    Person p;
    p.id     = String((const char*)e["id"]);    // may be empty if server not redeployed
    p.name   = String((const char*)e["name"]);
    p.team   = String((const char*)e["team"]);
    p.status = String((const char*)e["status"]);
    p.marked = false;
    if (p.status == "in") g_in.push_back(p);
    else                  g_notIn.push_back(p);
  }
  g_lastFetchMs    = millis();
  g_lastFetchEpoch = time(nullptr);
  Serial.printf("fetch: in=%d notIn=%d\n", (int)g_in.size(), (int)g_notIn.size());
  return true;
}

static bool postIncident() {
  if (WiFi.status() != WL_CONNECTED) connectWifi();
  if (WiFi.status() != WL_CONNECTED) return false;

  // Build payload
  JsonDocument doc;
  doc["device_id"]       = DEVICE_ID;
  doc["started_at"]      = isoUtc(g_incidentStartEpoch ? g_incidentStartEpoch : time(nullptr));
  doc["ended_at"]        = isoUtc(time(nullptr));
  doc["snapshot_at"]     = g_snapshotAtIso;
  doc["expected_count"]  = (int)g_in.size();

  int accounted = 0;
  JsonArray outstanding = doc["outstanding"].to<JsonArray>();
  for (auto& p : g_in) {
    if (p.marked) {
      accounted++;
    } else {
      JsonObject o = outstanding.add<JsonObject>();
      if (p.id.length()) o["id"] = p.id;
      o["name"] = p.name;
      o["team"] = p.team;
    }
  }
  doc["accounted_count"] = accounted;

  JsonArray exceptions = doc["exceptions"].to<JsonArray>();
  for (auto& p : g_notIn) {
    if (!p.marked) continue;
    JsonObject o = exceptions.add<JsonObject>();
    if (p.id.length()) o["id"] = p.id;
    o["name"]   = p.name;
    o["team"]   = p.team;
    o["status"] = p.status;
  }

  String payload;
  serializeJson(doc, payload);
  Serial.printf("post: payload=%s\n", payload.c_str());

  HTTPClient http;
  http.setTimeout(10000);
  http.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
  if (!http.begin(INCIDENTS_POST_URL)) return false;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Accept", "application/json");
  http.addHeader("Accept-Encoding", "identity");
  int code = http.POST(payload);
  String body = http.getString();
  Serial.printf("post: http %d body=%s\n", code, body.c_str());
  http.end();
  return code >= 200 && code < 300;
}

// =============================================================
// Mode transitions
// =============================================================

static void enterIncidentMode() {
  if (g_mode == Mode::INCIDENT) return;
  g_mode = Mode::INCIDENT;
  g_incidentStartEpoch = time(nullptr);
  Serial.printf("INCIDENT started epoch=%ld\n", (long)g_incidentStartEpoch);
}

static void closeIncident() {
  g_mode = Mode::IDLE;
  g_incidentStartEpoch = 0;
  for (auto& p : g_in)    p.marked = false;
  for (auto& p : g_notIn) p.marked = false;
}

// =============================================================
// Render
// =============================================================

static int inPages() {
  if (g_in.empty()) return 1;
  return ((int)g_in.size() + ROWS_PER_PAGE - 1) / ROWS_PER_PAGE;
}
static int notInPages() {
  if (g_notIn.empty()) return 0;
  return ((int)g_notIn.size() + ROWS_PER_PAGE - 1) / ROWS_PER_PAGE;
}
static int totalPages() {
  return inPages() + notInPages();
}

static int accountedCount() {
  int n = 0;
  for (auto& p : g_in) if (p.marked) n++;
  return n;
}

static int exceptionCount() {
  int n = 0;
  for (auto& p : g_notIn) if (p.marked) n++;
  return n;
}

static void renderHeader() {
  M5.Display.fillRect(0, 0, SCREEN_W, HEADER_H, TFT_WHITE);
  M5.Display.setTextColor(TFT_BLACK, TFT_WHITE);

  // Title + mode badge
  M5.Display.setTextSize(4);
  M5.Display.setCursor(20, 15);
  M5.Display.print("Roll Call");

  M5.Display.setTextSize(2);
  if (g_mode == Mode::INCIDENT) {
    M5.Display.setCursor(SCREEN_W - 180, 25);
    M5.Display.fillRect(SCREEN_W - 190, 18, 175, 36, TFT_BLACK);
    M5.Display.setTextColor(TFT_WHITE, TFT_BLACK);
    M5.Display.print(" INCIDENT ACTIVE");
    M5.Display.setTextColor(TFT_BLACK, TFT_WHITE);
  } else {
    M5.Display.setCursor(SCREEN_W - 140, 25);
    M5.Display.print("idle / live");
  }

  // Last refreshed
  M5.Display.setCursor(20, 70);
  if (g_lastFetchEpoch == 0) {
    M5.Display.print("Last refresh: never");
  } else {
    M5.Display.printf("Last refresh: %s  (%s)",
                      fmtLocalTime(g_lastFetchEpoch).c_str(),
                      relativeAgo(g_lastFetchEpoch).c_str());
  }

  // Counters
  int expected   = (int)g_in.size();
  int accounted  = accountedCount();
  int outstanding = expected - accounted;
  int exceptions  = exceptionCount();

  M5.Display.setTextSize(3);
  M5.Display.setCursor(20, 105);
  M5.Display.printf("In:%d  OK:%d  Out:%d", expected, accounted, outstanding);
  if (exceptions > 0) {
    M5.Display.setCursor(20, 140);
    M5.Display.setTextColor(TFT_RED, TFT_WHITE);
    M5.Display.printf("Exceptions: %d", exceptions);
    M5.Display.setTextColor(TFT_BLACK, TFT_WHITE);
  }

  // Diag line
  M5.Display.setTextSize(1);
  M5.Display.setCursor(20, 185);
  M5.Display.setTextColor(TFT_DARKGREY, TFT_WHITE);
  M5.Display.printf("%s  http:%d  %s",
                    g_wifiInfo.c_str(), g_lastHttpCode, g_status.c_str());
  M5.Display.setTextColor(TFT_BLACK, TFT_WHITE);

  M5.Display.drawFastHLine(0, HEADER_H - 2, SCREEN_W, TFT_BLACK);
}

static void renderFooter() {
  M5.Display.fillRect(0, SCREEN_H - FOOTER_H, SCREEN_W, FOOTER_H, TFT_WHITE);
  M5.Display.drawFastHLine(0, SCREEN_H - FOOTER_H, SCREEN_W, TFT_BLACK);
  M5.Display.setTextColor(TFT_BLACK, TFT_WHITE);
  M5.Display.setTextSize(2);

  M5.Display.drawRect(10, SCREEN_H - FOOTER_H + 10, 140, FOOTER_H - 20, TFT_BLACK);
  M5.Display.setCursor(50, SCREEN_H - FOOTER_H + 30);
  M5.Display.print("< Prev");

  M5.Display.drawRect(SCREEN_W - 150, SCREEN_H - FOOTER_H + 10, 140, FOOTER_H - 20, TFT_BLACK);
  M5.Display.setCursor(SCREEN_W - 130, SCREEN_H - FOOTER_H + 30);
  M5.Display.print("Next >");

  // Middle: section + page
  M5.Display.setCursor(SCREEN_W / 2 - 80, SCREEN_H - FOOTER_H + 18);
  M5.Display.printf("%s", g_page < inPages() ? "IN" : "NOT-IN");
  M5.Display.setCursor(SCREEN_W / 2 - 30, SCREEN_H - FOOTER_H + 42);
  M5.Display.printf("%d/%d", g_page + 1, totalPages());
}

static void renderRowAtIndex(int globalIdx, bool partial) {
  // globalIdx = page * ROWS_PER_PAGE + offsetWithinPage, page-local.
  int row = globalIdx % ROWS_PER_PAGE;
  int y = HEADER_H + row * ROW_H;

  if (partial) {
    M5.Display.fillRect(0, y, SCREEN_W, ROW_H, TFT_WHITE);
  }

  bool inSection = g_page < inPages();
  std::vector<Person>& list = inSection ? g_in : g_notIn;
  int sectionPage = inSection ? g_page : g_page - inPages();
  int idxInList = sectionPage * ROWS_PER_PAGE + row;
  if (idxInList < 0 || idxInList >= (int)list.size()) return;
  Person& p = list[idxInList];

  int bx = TICK_MARGIN;
  int by = y + (ROW_H - TICK_BOX) / 2;
  M5.Display.drawRect(bx, by, TICK_BOX, TICK_BOX, TFT_BLACK);
  if (p.marked) {
    M5.Display.fillRect(bx + 4, by + 4, TICK_BOX - 8, TICK_BOX - 8, TFT_BLACK);
  }

  M5.Display.setTextColor(TFT_BLACK, TFT_WHITE);
  M5.Display.setTextSize(3);
  M5.Display.setCursor(bx + TICK_BOX + 16, y + 10);
  M5.Display.print(p.name);

  M5.Display.setTextSize(2);
  M5.Display.setCursor(bx + TICK_BOX + 16, y + 40);
  M5.Display.setTextColor(TFT_DARKGREY, TFT_WHITE);
  if (inSection) {
    M5.Display.print(p.team);
  } else {
    M5.Display.printf("%s — %s (tap if seen)",
                      p.team.c_str(), p.status.c_str());
  }

  M5.Display.drawFastHLine(0, y + ROW_H - 1, SCREEN_W, TFT_LIGHTGREY);
}

static void renderAll() {
  M5.Display.fillScreen(TFT_WHITE);
  renderHeader();

  bool inSection = g_page < inPages();
  std::vector<Person>& list = inSection ? g_in : g_notIn;
  int sectionPage = inSection ? g_page : g_page - inPages();

  if (list.empty()) {
    M5.Display.setTextSize(3);
    M5.Display.setCursor(40, HEADER_H + 60);
    M5.Display.setTextColor(TFT_BLACK, TFT_WHITE);
    if (g_lastHttpCode == 200) {
      M5.Display.print(inSection ? "Nobody currently in." : "Nobody not-in.");
    } else if (g_lastHttpCode > 0) {
      M5.Display.printf("HTTP %d", g_lastHttpCode);
    } else {
      M5.Display.print("Fetch failed (see serial).");
    }
  } else {
    int start = sectionPage * ROWS_PER_PAGE;
    int end   = std::min((int)list.size(), start + ROWS_PER_PAGE);
    for (int i = start; i < end; i++) {
      // pass globalIdx (= row position) consistent with renderRowAtIndex contract
      renderRowAtIndex(i, false);
    }
  }

  renderFooter();
  M5.Display.display();
}

// =============================================================
// Input
// =============================================================

static void handleTouch(int x, int y) {
  // Footer: prev / next
  if (y >= SCREEN_H - FOOTER_H + 10 && y <= SCREEN_H - 10) {
    if (x >= 10 && x <= 150) {
      if (g_page > 0) { g_page--; renderAll(); }
      return;
    }
    if (x >= SCREEN_W - 150 && x <= SCREEN_W - 10) {
      if (g_page < totalPages() - 1) { g_page++; renderAll(); }
      return;
    }
  }

  // Row tap → toggle marked
  if (y >= HEADER_H && y < SCREEN_H - FOOTER_H) {
    int row = (y - HEADER_H) / ROW_H;
    bool inSection = g_page < inPages();
    std::vector<Person>& list = inSection ? g_in : g_notIn;
    int sectionPage = inSection ? g_page : g_page - inPages();
    int idxInList = sectionPage * ROWS_PER_PAGE + row;
    if (idxInList < 0 || idxInList >= (int)list.size()) return;

    list[idxInList].marked = !list[idxInList].marked;

    // Any tap kicks us into INCIDENT mode (auto-refresh paused).
    enterIncidentMode();

    renderRowAtIndex(row, true);
    renderHeader();
    M5.Display.display();
  }
}

// =============================================================
// Time helpers
// =============================================================

static String isoUtc(time_t t) {
  if (t <= 0) return String();
  struct tm tm;
  gmtime_r(&t, &tm);
  char buf[32];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tm);
  return String(buf);
}

static String fmtLocalTime(time_t t) {
  // Display in UTC — adding TZ is a Pi-side concern (server hands back
  // already-formatted snapshot_at). Keep device simple.
  if (t <= 0) return String("--");
  struct tm tm;
  gmtime_r(&t, &tm);
  char buf[24];
  strftime(buf, sizeof(buf), "%d %b %H:%M UTC", &tm);
  return String(buf);
}

static String relativeAgo(time_t t) {
  time_t now = time(nullptr);
  if (t <= 0 || now <= 0 || now < t) return String("just now");
  long secs = (long)(now - t);
  if (secs < 60)  return String(secs) + "s ago";
  if (secs < 3600) return String(secs / 60) + "m ago";
  if (secs < 86400) return String(secs / 3600) + "h ago";
  return String(secs / 86400) + "d ago";
}
