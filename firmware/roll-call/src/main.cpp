// Roll-call marshal device for M5Stack PaperS3.
//
// Four-screen UX with explicit confirmations:
//
//   PRESENCE       — default. Auto-refresh every AUTO_REFRESH_MIN.
//                    Read-only roster (IN + NOT-IN). Big bottom button
//                    "START ROLL CALL".
//   CONFIRM_START  — modal. "Start roll call?". Cancel / Start.
//   INCIDENT       — rows tappable: IN = accounted-for, NOT-IN = exception.
//                    Auto-refresh paused. Button "END ROLL CALL".
//   CONFIRM_END    — modal. Shows counts. Cancel / Save & end.
//                    Confirm POSTs to /api/roll-call/incidents and returns
//                    to PRESENCE; failure preserves state for retry.
//
// Tick / flag state lives in RAM only. Returning to PRESENCE wipes it.

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
  bool   marked;
};

enum class Mode { PRESENCE, CONFIRM_START, INCIDENT, CONFIRM_END };

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
static Mode    g_mode = Mode::PRESENCE;
static time_t  g_incidentStartEpoch = 0;

// Layout
static constexpr int SCREEN_W = 540;
static constexpr int SCREEN_H = 960;
static constexpr int HEADER_H = 200;
static constexpr int FOOTER_H = 170;            // pagination row + action button
static constexpr int ROW_H    = 64;
static constexpr int ROWS_PER_PAGE = (SCREEN_H - HEADER_H - FOOTER_H) / ROW_H;
static constexpr int TICK_BOX = 44;
static constexpr int TICK_MARGIN = 16;

// Pagination row geometry (PRESENCE / INCIDENT)
static constexpr int PAGER_Y = SCREEN_H - FOOTER_H + 10;
static constexpr int PAGER_H = 50;
static constexpr int PREV_X  = 20;
static constexpr int NEXT_X  = SCREEN_W - 160;
static constexpr int PAGE_BTN_W = 140;

// Big action button (PRESENCE / INCIDENT)
static constexpr int ACT_X = 20;
static constexpr int ACT_Y = SCREEN_H - 90;
static constexpr int ACT_W = SCREEN_W - 40;
static constexpr int ACT_H = 80;

// Confirm-modal buttons (CONFIRM_*)
static constexpr int MODAL_CANCEL_X = 50;
static constexpr int MODAL_CONFIRM_X = SCREEN_W - 50 - 200;
static constexpr int MODAL_BTN_Y = 720;
static constexpr int MODAL_BTN_W = 200;
static constexpr int MODAL_BTN_H = 110;

// Forward decls
static void connectWifi();
static void syncTime();
static bool fetchSnapshot();
static bool postIncident();

static int  inPages();
static int  notInPages();
static int  totalPages();
static int  accountedCount();
static int  exceptionCount();

static void renderAll();
static void renderPresenceOrIncident();
static void renderHeader();
static void renderFooter();
static void renderRow(int row);
static void renderConfirmStart();
static void renderConfirmEnd();

static void handleTouch(int x, int y);
static void enterPresence();
static void enterIncident();

static String isoUtc(time_t t);
static String fmtUtc(time_t t);
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
  // Use full-refresh (quality) mode — earlier epd_text mode rendered thin
  // outlines and inverted text inconsistently. Slower but reliable.
  M5.Display.fillScreen(TFT_WHITE);
  M5.Display.setTextColor(TFT_BLACK, TFT_WHITE);
  M5.Display.setTextSize(2);
  M5.Display.setCursor(20, 20);
  M5.Display.println("Roll Call");
  M5.Display.println();
  M5.Display.println("Connecting WiFi...");
  M5.Display.display();

  connectWifi();
  syncTime();

  g_status = fetchSnapshot() ? "snapshot ok" : "fetch failed";
  Serial.printf("status: %s, http: %d, in: %d, notIn: %d\n",
                g_status.c_str(), g_lastHttpCode,
                (int)g_in.size(), (int)g_notIn.size());

  g_mode = Mode::PRESENCE;
  g_page = 0;
  renderAll();
}

void loop() {
  M5.update();

  if (M5.Touch.getCount() > 0) {
    auto t = M5.Touch.getDetail();
    if (t.wasPressed()) handleTouch(t.x, t.y);
  }

  // Auto-refresh only in PRESENCE
  if (g_mode == Mode::PRESENCE && AUTO_REFRESH_MIN > 0 &&
      millis() - g_lastFetchMs > (uint32_t)AUTO_REFRESH_MIN * 60UL * 1000UL) {
    Serial.println("auto-refresh tick");
    if (fetchSnapshot()) renderAll();
  }

  delay(20);
}

// =============================================================
// Network / time (unchanged from previous version)
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
    p.id     = String((const char*)e["id"]);
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

  JsonDocument doc;
  doc["device_id"]      = DEVICE_ID;
  doc["started_at"]     = isoUtc(g_incidentStartEpoch ? g_incidentStartEpoch : time(nullptr));
  doc["ended_at"]       = isoUtc(time(nullptr));
  doc["snapshot_at"]    = g_snapshotAtIso;
  doc["expected_count"] = (int)g_in.size();

  int accounted = 0;
  JsonArray outstanding = doc["outstanding"].to<JsonArray>();
  for (auto& p : g_in) {
    if (p.marked) accounted++;
    else {
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

static void enterPresence() {
  g_mode = Mode::PRESENCE;
  g_incidentStartEpoch = 0;
  for (auto& p : g_in)    p.marked = false;
  for (auto& p : g_notIn) p.marked = false;
  g_page = 0;
}

static void enterIncident() {
  g_mode = Mode::INCIDENT;
  g_incidentStartEpoch = time(nullptr);
  g_page = 0;
  Serial.printf("INCIDENT started epoch=%ld\n", (long)g_incidentStartEpoch);
}

// =============================================================
// Counts / pages
// =============================================================

static int inPages() {
  if (g_in.empty()) return 1;
  return ((int)g_in.size() + ROWS_PER_PAGE - 1) / ROWS_PER_PAGE;
}
static int notInPages() {
  if (g_notIn.empty()) return 0;
  return ((int)g_notIn.size() + ROWS_PER_PAGE - 1) / ROWS_PER_PAGE;
}
static int totalPages() { return inPages() + notInPages(); }

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

// =============================================================
// Render — top level
// =============================================================

static void renderAll() {
  M5.Display.fillScreen(TFT_WHITE);
  switch (g_mode) {
    case Mode::PRESENCE:
    case Mode::INCIDENT:
      renderPresenceOrIncident();
      break;
    case Mode::CONFIRM_START:
      renderConfirmStart();
      break;
    case Mode::CONFIRM_END:
      renderConfirmEnd();
      break;
  }
  M5.Display.display();
}

// =============================================================
// PRESENCE / INCIDENT screens
// =============================================================

static void renderHeader() {
  M5.Display.setTextColor(TFT_BLACK, TFT_WHITE);

  M5.Display.setTextSize(4);
  M5.Display.setCursor(20, 15);
  M5.Display.print(g_mode == Mode::INCIDENT ? "Roll Call" : "Presence");

  // Mode badge (right of title)
  M5.Display.setTextSize(2);
  if (g_mode == Mode::INCIDENT) {
    M5.Display.fillRect(SCREEN_W - 240, 18, 220, 36, TFT_BLACK);
    M5.Display.setTextColor(TFT_WHITE, TFT_BLACK);
    M5.Display.setCursor(SCREEN_W - 230, 26);
    M5.Display.print(" INCIDENT ACTIVE");
    M5.Display.setTextColor(TFT_BLACK, TFT_WHITE);
  } else {
    M5.Display.setCursor(SCREEN_W - 160, 26);
    M5.Display.print("live / idle");
  }

  // Last refresh
  M5.Display.setCursor(20, 70);
  if (g_lastFetchEpoch == 0) {
    M5.Display.print("Last refresh: never");
  } else {
    M5.Display.printf("Last refresh: %s  (%s)",
                      fmtUtc(g_lastFetchEpoch).c_str(),
                      relativeAgo(g_lastFetchEpoch).c_str());
  }

  // Counters
  M5.Display.setTextSize(3);
  M5.Display.setCursor(20, 100);
  int expected = (int)g_in.size();
  if (g_mode == Mode::INCIDENT) {
    int accounted = accountedCount();
    int outstanding = expected - accounted;
    M5.Display.printf("In:%d  OK:%d  Out:%d", expected, accounted, outstanding);
  } else {
    M5.Display.printf("In: %d   Not in: %d", expected, (int)g_notIn.size());
  }

  int ex = exceptionCount();
  if (ex > 0) {
    M5.Display.setTextSize(2);
    M5.Display.setCursor(20, 138);
    M5.Display.printf("Exceptions flagged: %d", ex);
  }

  // Diag
  M5.Display.setTextSize(1);
  M5.Display.setCursor(20, 175);
  M5.Display.setTextColor(TFT_DARKGREY, TFT_WHITE);
  M5.Display.printf("%s  http:%d  %s",
                    g_wifiInfo.c_str(), g_lastHttpCode, g_status.c_str());
  M5.Display.setTextColor(TFT_BLACK, TFT_WHITE);

  M5.Display.drawFastHLine(0, HEADER_H - 2, SCREEN_W, TFT_BLACK);
}

static void renderRow(int row) {
  int y = HEADER_H + row * ROW_H;
  bool inSection = g_page < inPages();
  std::vector<Person>& list = inSection ? g_in : g_notIn;
  int sectionPage = inSection ? g_page : g_page - inPages();
  int idxInList = sectionPage * ROWS_PER_PAGE + row;
  if (idxInList < 0 || idxInList >= (int)list.size()) return;
  Person& p = list[idxInList];

  int bx = TICK_MARGIN;
  int by = y + (ROW_H - TICK_BOX) / 2;

  if (g_mode == Mode::INCIDENT) {
    // Tickable box
    M5.Display.drawRect(bx, by, TICK_BOX, TICK_BOX, TFT_BLACK);
    M5.Display.drawRect(bx + 1, by + 1, TICK_BOX - 2, TICK_BOX - 2, TFT_BLACK);
    if (p.marked) {
      M5.Display.fillRect(bx + 5, by + 5, TICK_BOX - 10, TICK_BOX - 10, TFT_BLACK);
    }
  } else {
    // Read-only status indicator
    M5.Display.setTextSize(3);
    M5.Display.setCursor(bx, y + 14);
    M5.Display.setTextColor(TFT_BLACK, TFT_WHITE);
    M5.Display.print(inSection ? "IN" : "--");
  }

  M5.Display.setTextSize(3);
  M5.Display.setCursor(bx + TICK_BOX + 16, y + 10);
  M5.Display.setTextColor(TFT_BLACK, TFT_WHITE);
  M5.Display.print(p.name);

  M5.Display.setTextSize(2);
  M5.Display.setCursor(bx + TICK_BOX + 16, y + 40);
  M5.Display.setTextColor(TFT_DARKGREY, TFT_WHITE);
  if (inSection || g_mode != Mode::INCIDENT) {
    M5.Display.print(p.team);
  } else {
    M5.Display.printf("%s — %s (tap if seen)",
                      p.team.c_str(), p.status.c_str());
  }
  M5.Display.setTextColor(TFT_BLACK, TFT_WHITE);

  M5.Display.drawFastHLine(0, y + ROW_H - 1, SCREEN_W, TFT_LIGHTGREY);
}

static void renderFooter() {
  M5.Display.drawFastHLine(0, SCREEN_H - FOOTER_H, SCREEN_W, TFT_BLACK);
  M5.Display.setTextColor(TFT_BLACK, TFT_WHITE);

  // Pagination row
  M5.Display.drawRect(PREV_X, PAGER_Y, PAGE_BTN_W, PAGER_H, TFT_BLACK);
  M5.Display.drawRect(PREV_X + 1, PAGER_Y + 1, PAGE_BTN_W - 2, PAGER_H - 2, TFT_BLACK);
  M5.Display.setTextSize(2);
  M5.Display.setCursor(PREV_X + 38, PAGER_Y + 16);
  M5.Display.print("< Prev");

  M5.Display.drawRect(NEXT_X, PAGER_Y, PAGE_BTN_W, PAGER_H, TFT_BLACK);
  M5.Display.drawRect(NEXT_X + 1, PAGER_Y + 1, PAGE_BTN_W - 2, PAGER_H - 2, TFT_BLACK);
  M5.Display.setCursor(NEXT_X + 38, PAGER_Y + 16);
  M5.Display.print("Next >");

  M5.Display.setTextSize(2);
  M5.Display.setCursor(SCREEN_W / 2 - 60, PAGER_Y + 6);
  M5.Display.printf("%s", g_page < inPages() ? "IN" : "NOT-IN");
  M5.Display.setCursor(SCREEN_W / 2 - 30, PAGER_Y + 28);
  M5.Display.printf("%d/%d", g_page + 1, totalPages());

  // Big action button (filled, high-contrast — definitely visible on e-paper)
  M5.Display.fillRect(ACT_X, ACT_Y, ACT_W, ACT_H, TFT_BLACK);
  M5.Display.setTextColor(TFT_WHITE, TFT_BLACK);
  M5.Display.setTextSize(4);
  if (g_mode == Mode::INCIDENT) {
    M5.Display.setCursor(ACT_X + 70, ACT_Y + 25);
    M5.Display.print("END ROLL CALL");
  } else {
    M5.Display.setCursor(ACT_X + 55, ACT_Y + 25);
    M5.Display.print("START ROLL CALL");
  }
  M5.Display.setTextColor(TFT_BLACK, TFT_WHITE);
}

static void renderPresenceOrIncident() {
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
      renderRow(i - start);
    }
  }

  renderFooter();
}

// =============================================================
// CONFIRM screens
// =============================================================

static void drawModalButton(int x, int y, const char* line1, const char* line2, bool inverted) {
  if (inverted) {
    M5.Display.fillRect(x, y, MODAL_BTN_W, MODAL_BTN_H, TFT_BLACK);
    M5.Display.setTextColor(TFT_WHITE, TFT_BLACK);
  } else {
    M5.Display.fillRect(x, y, MODAL_BTN_W, MODAL_BTN_H, TFT_WHITE);
    M5.Display.drawRect(x, y, MODAL_BTN_W, MODAL_BTN_H, TFT_BLACK);
    M5.Display.drawRect(x + 1, y + 1, MODAL_BTN_W - 2, MODAL_BTN_H - 2, TFT_BLACK);
    M5.Display.drawRect(x + 2, y + 2, MODAL_BTN_W - 4, MODAL_BTN_H - 4, TFT_BLACK);
    M5.Display.setTextColor(TFT_BLACK, TFT_WHITE);
  }
  M5.Display.setTextSize(4);
  int x1 = x + (MODAL_BTN_W - (int)strlen(line1) * 24) / 2;
  M5.Display.setCursor(x1, y + 18);
  M5.Display.print(line1);
  if (line2 && *line2) {
    M5.Display.setTextSize(2);
    int x2 = x + (MODAL_BTN_W - (int)strlen(line2) * 12) / 2;
    M5.Display.setCursor(x2, y + 70);
    M5.Display.print(line2);
  }
  M5.Display.setTextColor(TFT_BLACK, TFT_WHITE);
}

static void renderConfirmStart() {
  M5.Display.setTextColor(TFT_BLACK, TFT_WHITE);
  M5.Display.setTextSize(5);
  M5.Display.setCursor(60, 120);
  M5.Display.print("Start roll call?");

  M5.Display.setTextSize(3);
  M5.Display.setCursor(60, 240);
  M5.Display.printf("Currently in: %d", (int)g_in.size());
  M5.Display.setCursor(60, 290);
  M5.Display.printf("Not in:       %d", (int)g_notIn.size());

  M5.Display.setTextSize(2);
  M5.Display.setCursor(60, 380);
  M5.Display.print("This locks the current snapshot for the");
  M5.Display.setCursor(60, 410);
  M5.Display.print("duration of the incident. Auto-refresh");
  M5.Display.setCursor(60, 440);
  M5.Display.print("will pause until you end the roll call.");

  drawModalButton(MODAL_CANCEL_X,  MODAL_BTN_Y, "CANCEL", "no change", false);
  drawModalButton(MODAL_CONFIRM_X, MODAL_BTN_Y, "START",  "begin incident", true);
}

static void renderConfirmEnd() {
  int expected = (int)g_in.size();
  int accounted = accountedCount();
  int outstanding = expected - accounted;
  int exceptions = exceptionCount();

  M5.Display.setTextColor(TFT_BLACK, TFT_WHITE);
  M5.Display.setTextSize(5);
  M5.Display.setCursor(60, 120);
  M5.Display.print("End roll call?");

  M5.Display.setTextSize(3);
  M5.Display.setCursor(60, 240);
  M5.Display.printf("Accounted: %d / %d", accounted, expected);
  M5.Display.setCursor(60, 290);
  M5.Display.printf("Outstanding: %d", outstanding);
  if (exceptions > 0) {
    M5.Display.setCursor(60, 340);
    M5.Display.printf("Exceptions: %d", exceptions);
  }

  M5.Display.setTextSize(2);
  M5.Display.setCursor(60, 420);
  M5.Display.print("Saving will record this incident in the");
  M5.Display.setCursor(60, 450);
  M5.Display.print("audit log and resume auto-refresh.");

  drawModalButton(MODAL_CANCEL_X,  MODAL_BTN_Y, "CANCEL", "keep ticks", false);
  drawModalButton(MODAL_CONFIRM_X, MODAL_BTN_Y, "SAVE",   "& end", true);
}

// =============================================================
// Touch dispatch
// =============================================================

static bool hit(int x, int y, int bx, int by, int bw, int bh) {
  return x >= bx && x <= bx + bw && y >= by && y <= by + bh;
}

static void handleTouch(int x, int y) {
  Serial.printf("touch x=%d y=%d mode=%d\n", x, y, (int)g_mode);

  switch (g_mode) {
    case Mode::PRESENCE:
    case Mode::INCIDENT: {
      // Big action button
      if (hit(x, y, ACT_X, ACT_Y, ACT_W, ACT_H)) {
        if (g_mode == Mode::PRESENCE) {
          g_mode = Mode::CONFIRM_START;
        } else {
          g_mode = Mode::CONFIRM_END;
        }
        renderAll();
        return;
      }
      // Pagination
      if (hit(x, y, PREV_X, PAGER_Y, PAGE_BTN_W, PAGER_H)) {
        if (g_page > 0) { g_page--; renderAll(); }
        return;
      }
      if (hit(x, y, NEXT_X, PAGER_Y, PAGE_BTN_W, PAGER_H)) {
        if (g_page < totalPages() - 1) { g_page++; renderAll(); }
        return;
      }
      // Row tap (only meaningful in INCIDENT)
      if (g_mode == Mode::INCIDENT &&
          y >= HEADER_H && y < SCREEN_H - FOOTER_H) {
        int row = (y - HEADER_H) / ROW_H;
        bool inSection = g_page < inPages();
        std::vector<Person>& list = inSection ? g_in : g_notIn;
        int sectionPage = inSection ? g_page : g_page - inPages();
        int idxInList = sectionPage * ROWS_PER_PAGE + row;
        if (idxInList >= 0 && idxInList < (int)list.size()) {
          list[idxInList].marked = !list[idxInList].marked;
          renderAll();   // full repaint — keeps counters/header in sync
        }
      }
      break;
    }

    case Mode::CONFIRM_START: {
      if (hit(x, y, MODAL_CANCEL_X, MODAL_BTN_Y, MODAL_BTN_W, MODAL_BTN_H)) {
        g_mode = Mode::PRESENCE;
        renderAll();
        return;
      }
      if (hit(x, y, MODAL_CONFIRM_X, MODAL_BTN_Y, MODAL_BTN_W, MODAL_BTN_H)) {
        enterIncident();
        renderAll();
        return;
      }
      break;
    }

    case Mode::CONFIRM_END: {
      if (hit(x, y, MODAL_CANCEL_X, MODAL_BTN_Y, MODAL_BTN_W, MODAL_BTN_H)) {
        g_mode = Mode::INCIDENT;
        renderAll();
        return;
      }
      if (hit(x, y, MODAL_CONFIRM_X, MODAL_BTN_Y, MODAL_BTN_W, MODAL_BTN_H)) {
        // Show "saving" feedback
        M5.Display.fillRect(0, MODAL_BTN_Y + MODAL_BTN_H + 20, SCREEN_W, 40, TFT_WHITE);
        M5.Display.setTextSize(2);
        M5.Display.setCursor(60, MODAL_BTN_Y + MODAL_BTN_H + 24);
        M5.Display.setTextColor(TFT_BLACK, TFT_WHITE);
        M5.Display.print("Saving incident...");
        M5.Display.display();

        bool ok = postIncident();
        Serial.printf("incident close: %s\n", ok ? "ok" : "FAIL");
        if (ok) {
          enterPresence();
          g_status = fetchSnapshot() ? "snapshot ok" : "fetch failed";
        } else {
          // Back to INCIDENT, surface error
          g_mode = Mode::INCIDENT;
          g_status = "post failed - retry";
        }
        renderAll();
        return;
      }
      break;
    }
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

static String fmtUtc(time_t t) {
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
  if (secs < 60)   return String(secs) + "s ago";
  if (secs < 3600) return String(secs / 60) + "m ago";
  if (secs < 86400) return String(secs / 3600) + "h ago";
  return String(secs / 86400) + "d ago";
}
