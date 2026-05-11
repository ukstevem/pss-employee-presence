// Roll-call marshal device for M5Stack PaperS3.
//
// On boot: connect WiFi, GET /api/roll-call, render IN-employees as a tick
// list. Touch toggles "accounted for". BtnA = new snapshot.
//
// Tick state lives in RAM only — taking a new snapshot wipes ticks, which
// matches the web marshal page (one snapshot per incident).

#include <M5Unified.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <vector>
#include "config.h"

struct Person {
  String id;
  String name;
  String team;
  bool ticked;
};

static std::vector<Person> g_people;
static String g_snapshotAt;          // ISO from server
static String g_status = "boot";     // last status line
static int g_page = 0;
static uint32_t g_lastFetchMs = 0;

// Layout (portrait 540 x 960).
static constexpr int SCREEN_W = 540;
static constexpr int SCREEN_H = 960;
static constexpr int HEADER_H = 180;
static constexpr int FOOTER_H = 80;
static constexpr int ROW_H = 64;
static constexpr int ROWS_PER_PAGE = (SCREEN_H - HEADER_H - FOOTER_H) / ROW_H;
static constexpr int TICK_BOX = 44;
static constexpr int TICK_MARGIN = 16;

static void connectWifi();
static bool fetchSnapshot();
static void renderAll();
static void renderRow(int idx, bool partial);
static void handleTouch(int x, int y);
static int  totalPages();
static int  accountedCount();

void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);
  M5.Display.setRotation(0);          // portrait, USB-C at bottom
  M5.Display.setEpdMode(epd_mode_t::epd_text);
  M5.Display.fillScreen(TFT_WHITE);
  M5.Display.setTextColor(TFT_BLACK, TFT_WHITE);
  M5.Display.setTextSize(2);
  M5.Display.setCursor(20, 20);
  M5.Display.println("Roll Call");
  M5.Display.println("");
  M5.Display.println("Connecting WiFi...");

  connectWifi();

  M5.Display.println("Fetching snapshot...");
  if (fetchSnapshot()) {
    g_status = "snapshot ok";
  } else {
    g_status = "fetch failed";
  }
  g_page = 0;
  renderAll();
}

void loop() {
  M5.update();

  // BtnA = new snapshot (re-pulls from API, clears ticks)
  if (M5.BtnA.wasPressed()) {
    M5.Display.fillRect(0, SCREEN_H - FOOTER_H, SCREEN_W, FOOTER_H, TFT_WHITE);
    M5.Display.setCursor(20, SCREEN_H - FOOTER_H + 20);
    M5.Display.setTextSize(2);
    M5.Display.print("Refreshing...");
    if (fetchSnapshot()) {
      g_status = "snapshot ok";
    } else {
      g_status = "fetch failed";
    }
    g_page = 0;
    renderAll();
  }

  // Touch — tick toggle or page nav
  if (M5.Touch.getCount() > 0) {
    auto t = M5.Touch.getDetail();
    if (t.wasPressed()) {
      handleTouch(t.x, t.y);
    }
  }

  // Optional auto-refresh
  if (AUTO_REFRESH_MIN > 0 &&
      millis() - g_lastFetchMs > (uint32_t)AUTO_REFRESH_MIN * 60UL * 1000UL) {
    if (fetchSnapshot()) renderAll();
  }

  delay(20);
}

static void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 30000) {
    delay(250);
  }
}

static bool fetchSnapshot() {
  if (WiFi.status() != WL_CONNECTED) connectWifi();
  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  http.setTimeout(10000);
  if (!http.begin(ROLL_CALL_URL)) return false;
  int code = http.GET();
  if (code != 200) {
    http.end();
    return false;
  }

  // Stream-parse to keep PSRAM use low.
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, http.getStream());
  http.end();
  if (err) return false;

  g_snapshotAt = doc["generated_at"].as<const char*>();
  g_people.clear();
  for (JsonObject e : doc["employees"].as<JsonArray>()) {
    const char* status = e["status"];
    if (!status || strcmp(status, "in") != 0) continue;   // marshal only cares about IN
    Person p;
    p.id     = e["id"].as<const char*>();
    p.name   = e["name"].as<const char*>();
    p.team   = e["team"].as<const char*>();
    p.ticked = false;
    g_people.push_back(p);
  }
  g_lastFetchMs = millis();
  return true;
}

static int totalPages() {
  if (g_people.empty()) return 1;
  return ((int)g_people.size() + ROWS_PER_PAGE - 1) / ROWS_PER_PAGE;
}

static int accountedCount() {
  int n = 0;
  for (auto& p : g_people) if (p.ticked) n++;
  return n;
}

static void renderHeader() {
  M5.Display.fillRect(0, 0, SCREEN_W, HEADER_H, TFT_WHITE);
  M5.Display.setTextColor(TFT_BLACK, TFT_WHITE);

  M5.Display.setTextSize(4);
  M5.Display.setCursor(20, 20);
  M5.Display.print("Roll Call");

  M5.Display.setTextSize(2);
  M5.Display.setCursor(20, 80);
  M5.Display.printf("Snapshot: %s", g_snapshotAt.c_str());

  int expected   = (int)g_people.size();
  int accounted  = accountedCount();
  int outstanding = expected - accounted;
  M5.Display.setTextSize(3);
  M5.Display.setCursor(20, 115);
  M5.Display.printf("In:%d  OK:%d  Out:%d", expected, accounted, outstanding);

  // Separator
  M5.Display.drawFastHLine(0, HEADER_H - 2, SCREEN_W, TFT_BLACK);
}

static void renderFooter() {
  M5.Display.fillRect(0, SCREEN_H - FOOTER_H, SCREEN_W, FOOTER_H, TFT_WHITE);
  M5.Display.drawFastHLine(0, SCREEN_H - FOOTER_H, SCREEN_W, TFT_BLACK);
  M5.Display.setTextColor(TFT_BLACK, TFT_WHITE);
  M5.Display.setTextSize(2);

  // Prev / Next zones drawn as buttons at bottom-left / bottom-right.
  M5.Display.drawRect(10, SCREEN_H - FOOTER_H + 10, 140, FOOTER_H - 20, TFT_BLACK);
  M5.Display.setCursor(50, SCREEN_H - FOOTER_H + 30);
  M5.Display.print("< Prev");

  M5.Display.drawRect(SCREEN_W - 150, SCREEN_H - FOOTER_H + 10, 140, FOOTER_H - 20, TFT_BLACK);
  M5.Display.setCursor(SCREEN_W - 130, SCREEN_H - FOOTER_H + 30);
  M5.Display.print("Next >");

  M5.Display.setCursor(SCREEN_W / 2 - 40, SCREEN_H - FOOTER_H + 30);
  M5.Display.printf("%d/%d", g_page + 1, totalPages());
}

static void renderRow(int idx, bool partial) {
  int row = idx - g_page * ROWS_PER_PAGE;
  if (row < 0 || row >= ROWS_PER_PAGE) return;
  int y = HEADER_H + row * ROW_H;
  Person& p = g_people[idx];

  if (partial) {
    M5.Display.fillRect(0, y, SCREEN_W, ROW_H, TFT_WHITE);
  }

  // Tick box
  int bx = TICK_MARGIN;
  int by = y + (ROW_H - TICK_BOX) / 2;
  M5.Display.drawRect(bx, by, TICK_BOX, TICK_BOX, TFT_BLACK);
  if (p.ticked) {
    M5.Display.fillRect(bx + 4, by + 4, TICK_BOX - 8, TICK_BOX - 8, TFT_BLACK);
  }

  // Name + team
  M5.Display.setTextColor(TFT_BLACK, TFT_WHITE);
  M5.Display.setTextSize(3);
  M5.Display.setCursor(bx + TICK_BOX + 16, y + 10);
  M5.Display.print(p.name);

  M5.Display.setTextSize(2);
  M5.Display.setCursor(bx + TICK_BOX + 16, y + 40);
  M5.Display.setTextColor(TFT_DARKGREY, TFT_WHITE);
  M5.Display.print(p.team);

  // Row separator
  M5.Display.drawFastHLine(0, y + ROW_H - 1, SCREEN_W, TFT_LIGHTGREY);
}

static void renderAll() {
  M5.Display.fillScreen(TFT_WHITE);
  renderHeader();

  if (g_people.empty()) {
    M5.Display.setTextSize(3);
    M5.Display.setCursor(40, HEADER_H + 60);
    M5.Display.setTextColor(TFT_BLACK, TFT_WHITE);
    M5.Display.print("Nobody currently in.");
  } else {
    int start = g_page * ROWS_PER_PAGE;
    int end   = std::min((int)g_people.size(), start + ROWS_PER_PAGE);
    for (int i = start; i < end; i++) renderRow(i, false);
  }

  renderFooter();
  M5.Display.display();   // full refresh
}

static void handleTouch(int x, int y) {
  // Footer buttons
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

  // Row tap → toggle tick
  if (y >= HEADER_H && y < SCREEN_H - FOOTER_H) {
    int row = (y - HEADER_H) / ROW_H;
    int idx = g_page * ROWS_PER_PAGE + row;
    if (idx >= 0 && idx < (int)g_people.size()) {
      g_people[idx].ticked = !g_people[idx].ticked;
      renderRow(idx, true);
      // Update header counters
      renderHeader();
      M5.Display.display();
    }
  }
}
