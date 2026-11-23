/*
  TransGuard AI — Mobile Emergency SOS Unit (v2.3 Hotspot + Dual-Core Production Firmware)
  Target: DOIT ESP32 DEVKIT V1 (30-Pin) + Green Screw Expansion Board
  Verified Pins (COM5):
    - Buzzer: D15 / GPIO 15 (Active-Low Module: HIGH = Silent, LOW = Beep)
    - GPS: NEO-6M on Serial2 (RX2=GPIO 16, TX2=GPIO 17 @ 9600 baud)
    - Push Button: D26 / GPIO 26 (INPUT_PULLUP, triggers on LOW)
*/

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <HardwareSerial.h>
#include <TinyGPSPlus.h>

// ==========================================
// CONFIGURATION (HOTSPOT + VERIFIED CREDENTIALS)
// ==========================================
const char *WIFI_SSID = "Afish";
const char *WIFI_PASSWORD = "Z3c0g7a1";

// Telegram Bot Credentials
const char *BOT_TOKEN = "9017514500:AAEOD2HIL3NkWFzzitRxwu6hr7lJBlcVXb8";
const char *CHAT_ID = "5408766784";

// TransGuard AI Backend IP on CCTV BROADBAND LAN (192.168.18.192)
const char *TRANSGUARD_API_URL = "http://192.168.18.192:5000/api/alerts/sos";
const char *DISPATCH_COMMAND_URL = "http://192.168.18.192:5000/api/alerts/command?vehicle_id=BUS_001";

// ==========================================
// PIN DEFINITIONS (EXACT VERIFIED PINOUT)
// ==========================================
const int BUZZER_PIN = 15; // D15 / GPIO 15 (Active-Low: HIGH = Silent, LOW = Active)
const int BUTTON_PIN = 26; // D26 / GPIO 26 (Red Push Button)
const int GPS_RX_PIN = 16; // RX2 -> GPS TX
const int GPS_TX_PIN = 17; // TX2 -> GPS RX

// ==========================================
// HARDWARE INSTANCES & STATE VARIABLES
// ==========================================
TinyGPSPlus gps;
HardwareSerial gpsSerial(2);

// Non-blocking 5-second alarm timer (Strictly controlled by Core 1)
volatile bool isAlarmActive = false;
unsigned long alarmStartTime = 0;
const unsigned long ALARM_DURATION = 5000; // 5 seconds (5000 ms)
const unsigned long PULSE_INTERVAL = 200;  // 200 ms ON / 200 ms OFF rhythm

unsigned long lastPulseToggle = 0;
bool pulseWindowOn = false;

// Software 2000Hz tone generator (Works on both Active & Passive buzzers)
unsigned long lastToneMicros = 0;
bool tonePinState = HIGH;
const unsigned long TONE_HALF_PERIOD_US = 250;

// Cross-Core Atomic Flags
volatile bool pendingSosNetworkDispatch = false;  // Core 1 -> Core 0 (Red button pressed)
volatile bool pendingRemoteAlarmTrigger = false; // Core 0 -> Core 1 (Dashboard approved alarm!)

// Button debounce variables
int lastButtonReading = HIGH;
int buttonState = HIGH;
unsigned long lastDebounceTime = 0;
const unsigned long DEBOUNCE_DELAY = 50;

// Shared GPS Coordinate Cache
volatile double currentLat = 10.5898;
volatile double currentLon = 76.0116;
volatile double currentSpeed = 0.0;
volatile uint32_t currentSatellites = 0;
volatile bool hasValidGps = false;

// Diagnostic & Fallback tracking
long lastTelegramUpdateId = 0;
int consecutiveLanFailures = 0;

TaskHandle_t networkTaskHandle = NULL;

// ==========================================
// FUNCTION DECLARATIONS
// ==========================================
void startFiveSecondAlarm();
void stopBuzzerCompletely();
void playBootChirp(int durationMs);
void sendTelegramAlert(double lat, double lon, double speed, uint32_t sats, bool hasFix);
void sendTransGuardAlert(double lat, double lon, double speed, bool hasFix);
void checkDispatchCommand();
void checkTelegramFallbackTrigger();
void networkWorkerTask(void *parameter);
String escapeJsonString(const String &input);

// ==========================================
// BUZZER CONTROL (EXECUTED ONLY ON CORE 1)
// ==========================================
void playBootChirp(int durationMs) {
  unsigned long start = millis();
  while (millis() - start < (unsigned long)durationMs) {
    digitalWrite(BUZZER_PIN, LOW);
    delayMicroseconds(TONE_HALF_PERIOD_US);
    digitalWrite(BUZZER_PIN, HIGH);
    delayMicroseconds(TONE_HALF_PERIOD_US);
  }
  digitalWrite(BUZZER_PIN, HIGH);
}

void startFiveSecondAlarm() {
  pinMode(BUZZER_PIN, OUTPUT);
  alarmStartTime = millis();
  lastPulseToggle = millis();
  lastToneMicros = micros();
  pulseWindowOn = true;
  isAlarmActive = true;
  digitalWrite(BUZZER_PIN, LOW);
  Serial.println("[BUZZER] 5-second pulsed SOS alarm STARTED on Pin 15.");
}

void stopBuzzerCompletely() {
  isAlarmActive = false;
  pulseWindowOn = false;
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, HIGH); // Force silent
  Serial.println("[BUZZER] 5-second timeout finished. Buzzer turned OFF.");
}

String escapeJsonString(const String &input) {
  String out = "";
  out.reserve(input.length() + 32);
  for (unsigned int i = 0; i < input.length(); i++) {
    char c = input.charAt(i);
    if (c == '\"') out += "\\\"";
    else if (c == '\\') out += "\\\\";
    else if (c == '\n') out += "\\n";
    else if (c == '\r') continue;
    else out += c;
  }
  return out;
}

// ==========================================
// SETUP (CORE 1)
// ==========================================
void setup() {
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, HIGH);

  Serial.begin(115200);
  delay(200);
  Serial.println("\n==================================================");
  Serial.println("  TransGuard AI — ESP32 Emergency SOS Unit v2.3");
  Serial.println("==================================================");

  pinMode(BUTTON_PIN, INPUT_PULLUP);
  gpsSerial.begin(9600, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);

  // Quick boot chirp test
  playBootChirp(80);
  delay(80);
  playBootChirp(80);

  WiFi.mode(WIFI_STA);
  WiFi.persistent(false);      // Avoid corrupted NVS Wi-Fi state & flash wear
  WiFi.setAutoReconnect(false); // Prevent ESP-IDF 30Hz "Set status to INIT" spam
  WiFi.disconnect(true);
  delay(150);
  WiFi.setTxPower(WIFI_POWER_15dBm); // Prevents USB brownout resets with GPS + Buzzer
  Serial.printf("[WIFI] Connecting to %s ", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long wifiStart = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - wifiStart < 12000)) {
    delay(400);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WIFI] Connected successfully!");
    Serial.print("[WIFI] ESP32 IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[WIFI] Initial timeout — background task will auto-reconnect.");
  }

  xTaskCreatePinnedToCore(
      networkWorkerTask,
      "NetworkWorkerTask",
      8192,
      NULL,
      1,
      &networkTaskHandle,
      0
  );

  Serial.println("[SYSTEM] Ready! Waiting for Red Button or Dashboard Approval...");
  Serial.println("==================================================");
}

// ==========================================
// MAIN REAL-TIME LOOP (CORE 1)
// ==========================================
void loop() {
  // 1. Trigger 5-second buzzer if React dashboard or cloud fallback approved an alarm
  if (pendingRemoteAlarmTrigger) {
    pendingRemoteAlarmTrigger = false;
    if (!isAlarmActive) {
      Serial.println("\n>>> [DASHBOARD APPROVED] REMOTE ALARM TRIGGERED BUZZER! <<<");
      startFiveSecondAlarm();
    }
  }

  // 2. Drive buzzer for exactly 5 seconds (non-blocking)
  if (isAlarmActive) {
    unsigned long nowMillis = millis();

    if (nowMillis - alarmStartTime >= ALARM_DURATION) {
      stopBuzzerCompletely();
    } else {
      if (nowMillis - lastPulseToggle >= PULSE_INTERVAL) {
        lastPulseToggle = nowMillis;
        pulseWindowOn = !pulseWindowOn;
        if (!pulseWindowOn) {
          digitalWrite(BUZZER_PIN, HIGH);
        }
      }

      if (pulseWindowOn) {
        unsigned long nowMicros = micros();
        if (nowMicros - lastToneMicros >= TONE_HALF_PERIOD_US) {
          lastToneMicros = nowMicros;
          tonePinState = !tonePinState;
          digitalWrite(BUZZER_PIN, tonePinState);
        }
      }
    }
  }

  // 3. Continuously read NEO-6M GPS bytes
  while (gpsSerial.available() > 0) {
    if (gps.encode(gpsSerial.read())) {
      if (gps.location.isValid() && gps.location.age() < 5000) {
        currentLat = gps.location.lat();
        currentLon = gps.location.lng();
        currentSpeed = gps.speed.isValid() ? gps.speed.kmph() : 0.0;
        hasValidGps = true;
      }
      if (gps.satellites.isValid()) {
        currentSatellites = gps.satellites.value();
      }
    }
  }

  // 4. Red Push Button debounce & trigger
  int reading = digitalRead(BUTTON_PIN);
  if (reading != lastButtonReading) {
    lastDebounceTime = millis();
  }

  if ((millis() - lastDebounceTime) > DEBOUNCE_DELAY) {
    if (reading != buttonState) {
      buttonState = reading;
      if (buttonState == LOW && !isAlarmActive) {
        Serial.println("\n>>> [SOS ALERT] PHYSICAL RED BUTTON PRESSED! <<<");
        startFiveSecondAlarm();
        pendingSosNetworkDispatch = true;
      }
    }
  }
  lastButtonReading = reading;
}

// ==========================================
// CORE 0 BACKGROUND TASK: NETWORK & DASHBOARD POLLING
// ==========================================
void networkWorkerTask(void *parameter) {
  unsigned long lastCommandPoll = 0;
  unsigned long lastTelegramPoll = 0;
  unsigned long lastWifiCheck = 0;
  const unsigned long COMMAND_POLL_INTERVAL = 1200;

  for (;;) {
    if (WiFi.status() != WL_CONNECTED && (millis() - lastWifiCheck >= 10000)) {
      lastWifiCheck = millis();
      Serial.printf("[WIFI] Not connected (status=%d). Retrying %s...\n", WiFi.status(), WIFI_SSID);
      WiFi.disconnect(false);
      vTaskDelay(200 / portTICK_PERIOD_MS);
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }

    if (pendingSosNetworkDispatch) {
      pendingSosNetworkDispatch = false;

      double latSnapshot = currentLat;
      double lonSnapshot = currentLon;
      double speedSnapshot = currentSpeed;
      uint32_t satsSnapshot = currentSatellites;
      bool fixSnapshot = hasValidGps;

      if (WiFi.status() == WL_CONNECTED) {
        sendTelegramAlert(latSnapshot, lonSnapshot, speedSnapshot, satsSnapshot, fixSnapshot);
        sendTransGuardAlert(latSnapshot, lonSnapshot, speedSnapshot, fixSnapshot);
      }
    }

    if (!isAlarmActive && WiFi.status() == WL_CONNECTED &&
        (millis() - lastCommandPoll >= COMMAND_POLL_INTERVAL)) {
      lastCommandPoll = millis();
      checkDispatchCommand();
    }

    if (!isAlarmActive && WiFi.status() == WL_CONNECTED && consecutiveLanFailures >= 3 &&
        (millis() - lastTelegramPoll >= 3000)) {
      lastTelegramPoll = millis();
      checkTelegramFallbackTrigger();
    }

    vTaskDelay(20 / portTICK_PERIOD_MS);
  }
}

// ==========================================
// DISPATCH COMMAND POLLER (REACT DASHBOARD -> ESP32 BUZZER)
// ==========================================
void checkDispatchCommand() {
  HTTPClient http;
  // Piggyback live NEO-6M GPS coordinates onto the existing 1.2s poll (zero extra requests)
  String pollUrl = String(DISPATCH_COMMAND_URL);
  pollUrl += "&lat=" + String(currentLat, 6);
  pollUrl += "&lon=" + String(currentLon, 6);
  pollUrl += "&speed=" + String(currentSpeed, 1);
  pollUrl += "&sats=" + String(currentSatellites);
  pollUrl += "&gps_fix=" + String(hasValidGps ? 1 : 0);

  http.begin(pollUrl);
  http.setTimeout(1000);
  int httpCode = http.GET();

  if (httpCode == 200) {
    consecutiveLanFailures = 0;
    String payload = http.getString();
    String clean = payload;
    clean.replace(" ", "");
    clean.toLowerCase();

    if (clean.indexOf("\"trigger_alarm\":true") >= 0 ||
        clean.indexOf("\"trigger_alarm\":1") >= 0 ||
        clean.indexOf("\"trigger_alarm\":\"true\"") >= 0 ||
        clean.indexOf("\"approved\":true") >= 0 ||
        clean.indexOf("\"alarm\":true") >= 0) {
      Serial.println("\n[DASHBOARD POLL] Received trigger_alarm=true from TransGuard Backend!");
      pendingRemoteAlarmTrigger = true;
    }
  } else {
    consecutiveLanFailures++;
    if (consecutiveLanFailures == 1 || consecutiveLanFailures % 10 == 0) {
      Serial.printf("[POLL WARNING] Cannot reach %s (HTTP %d). Check backend on 0.0.0.0:5000 & Firewall.\n",
                    DISPATCH_COMMAND_URL, httpCode);
    }
  }
  http.end();
}

// ==========================================
// CLOUD FALLBACK POLLER (TELEGRAM BOT TRIGGER)
// ==========================================
void checkTelegramFallbackTrigger() {
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient https;

  String url = "https://api.telegram.org/bot" + String(BOT_TOKEN) +
               "/getUpdates?limit=1&offset=" + String(lastTelegramUpdateId + 1);

  if (https.begin(client, url)) {
    https.setTimeout(2500);
    int code = https.GET();
    if (code == 200) {
      String res = https.getString();
      int idIdx = res.indexOf("\"update_id\":");
      if (idIdx >= 0) {
        long newId = res.substring(idIdx + 12).toInt();
        if (lastTelegramUpdateId == 0) {
          lastTelegramUpdateId = newId;
        } else if (newId > lastTelegramUpdateId) {
          lastTelegramUpdateId = newId;
          String lower = res;
          lower.toLowerCase();
          if (lower.indexOf("alarm") >= 0 || lower.indexOf("approved") >= 0 ||
              lower.indexOf("confirm") >= 0 || lower.indexOf("/ring") >= 0) {
            Serial.println("\n[CLOUD FALLBACK] Remote Alarm Command received via Telegram Cloud!");
            pendingRemoteAlarmTrigger = true;
          }
        }
      }
    }
    https.end();
  }
}

// ==========================================
// 1. TELEGRAM ALERT DISPATCH (HTTPS TLS POST)
// ==========================================
void sendTelegramAlert(double lat, double lon, double speed, uint32_t sats, bool hasFix) {
  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient https;
  String telegramUrl = "https://api.telegram.org/bot" + String(BOT_TOKEN) + "/sendMessage";

  String message = "🚨 <b>TRANSGUARD AI — EMERGENCY SOS!</b>\n";
  message += "Vehicle ID: <b>BUS_001</b>\n";
  message += "Driver triggered physical SOS panic button.\n\n";

  if (hasFix) {
    message += "📍 <b>GPS Status:</b> Live Satellite Lock (" + String(sats) + " sats)\n";
    message += "🌐 <b>Coordinates:</b> " + String(lat, 6) + ", " + String(lon, 6) + "\n";
    message += "⚡ <b>Speed:</b> " + String(speed, 1) + " km/h\n";
    message += "🗺️ <a href=\"https://maps.google.com/?q=" + String(lat, 6) + "," + String(lon, 6) + "\">Open Live Location in Google Maps</a>";
  } else {
    message += "⚠️ <b>GPS Status:</b> Satellite Fix Pending (" + String(sats) + " sats visible)\n";
    message += "📍 <b>Last/Fallback Coordinates:</b> " + String(lat, 6) + ", " + String(lon, 6) + "\n";
    message += "🗺️ <a href=\"https://maps.google.com/?q=" + String(lat, 6) + "," + String(lon, 6) + "\">Open Fallback Location in Google Maps</a>";
  }

  String escapedText = escapeJsonString(message);

  String jsonPayload = "{";
  jsonPayload += "\"chat_id\":\"" + String(CHAT_ID) + "\",";
  jsonPayload += "\"text\":\"" + escapedText + "\",";
  jsonPayload += "\"parse_mode\":\"HTML\",";
  jsonPayload += "\"disable_web_page_preview\":false";
  jsonPayload += "}";

  if (https.begin(client, telegramUrl)) {
    https.addHeader("Content-Type", "application/json");
    https.setTimeout(4000);
    int httpCode = https.POST(jsonPayload);
    if (httpCode == 200) {
      Serial.println("[TELEGRAM] Emergency alert delivered! (HTTP 200)");
    } else {
      Serial.printf("[TELEGRAM] Failed (HTTP %d)\n", httpCode);
    }
    https.end();
  }
}

// ==========================================
// 2. TRANSGUARD AI DASHBOARD ALERT DISPATCH
// ==========================================
void sendTransGuardAlert(double lat, double lon, double speed, bool hasFix) {
  HTTPClient http;
  http.begin(TRANSGUARD_API_URL);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(1500);

  String jsonPayload = "{";
  jsonPayload += "\"vehicle_id\":\"BUS_001\",";
  jsonPayload += "\"camera_id\":\"cam0\",";
  jsonPayload += "\"lat\":" + String(lat, 6) + ",";
  jsonPayload += "\"lon\":" + String(lon, 6) + ",";
  jsonPayload += "\"speed\":" + String(speed, 1) + ",";
  jsonPayload += "\"gps_fix\":" + String(hasFix ? "true" : "false");
  jsonPayload += "}";

  int httpCode = http.POST(jsonPayload);
  if (httpCode == 200 || httpCode == 201) {
    Serial.printf("[DASHBOARD] TransGuard Dashboard Updated! (HTTP %d)\n", httpCode);
  } else {
    Serial.printf("[DASHBOARD] Unreachable (HTTP %d)\n", httpCode);
  }
  http.end();
}