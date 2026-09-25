/*
  TransGuard AI — Public Transportation Edge Firmware
  Target Board: Arduino Nano (ATmega328P / CH340)
  
  Connections:
    - NEO-6M GPS Module:
        VCC -> 5V
        GND -> GND
        TX  -> Arduino Pin D2 (SoftwareSerial RX)
        RX  -> Arduino Pin D3 (SoftwareSerial TX)
    - Active Buzzer (3-pin module):
        VCC -> 5V
        GND -> GND
        I/O -> Arduino Pin D8 (Active HIGH)
    - Alert LED:
        Anode (+)   -> Arduino Pin D13 (through 220 ohm resistor)
        Cathode (-) -> GND

  Functionality:
    1. Reads GPS NMEA sentences (RMC/GGA) from NEO-6M on pins D2/D3 at 9600 baud.
    2. Transmits real-time vehicle telemetry JSON over USB serial at 115200 baud to the Edge Engine.
    3. Listens for incident alert commands from Python Edge Engine:
         - "BUZZ:ON"  -> Turns on buzzer & LED continuously
         - "BUZZ:OFF" -> Mutes buzzer & LED
         - "BEEP:N"   -> Emits N rapid audible alert chirps for transit distress/threats
*/

#include <SoftwareSerial.h>

// Pin definitions matching TransGuard AI pictorial circuit diagram
const int PIN_GPS_RX = 2; // Nano D2 connects to GPS TX
const int PIN_GPS_TX = 3; // Nano D3 connects to GPS RX
const int PIN_BUZZER = 8; // Nano D8 connects to Active Buzzer I/O
const int PIN_LED    = 13; // Nano D13 onboard/external status LED

SoftwareSerial gpsSerial(PIN_GPS_RX, PIN_GPS_TX);

unsigned long lastGpsReport = 0;
const unsigned long GPS_INTERVAL_MS = 1000; // 1Hz telemetry

// NMEA parser buffer
char nmeaSentence[128];
byte nmeaIndex = 0;
bool newSentenceAvailable = false;

// Last parsed coordinates
float currentLat = 10.5898;
float currentLon = 76.0116;
float currentSpeedKmh = 0.0;
bool hasGpsFix = false;

void setup() {
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);
  digitalWrite(PIN_LED, LOW);

  Serial.begin(115200);
  gpsSerial.begin(9600);

  // Power-on confirmation chirp
  beepAlert(2, 80);

  Serial.println(F("{\"status\":\"READY\",\"firmware\":\"TransGuard-Nano-v2.0\",\"vehicle\":\"BUS_001\"}"));
}

void loop() {
  // 1. Ingest GPS bytes
  while (gpsSerial.available() > 0) {
    char c = gpsSerial.read();
    if (c == '$') {
      nmeaIndex = 0;
      nmeaSentence[nmeaIndex++] = c;
    } else if (c == '\n' || c == '\r') {
      if (nmeaIndex > 0) {
        nmeaSentence[nmeaIndex] = '\0';
        parseNMEA(nmeaSentence);
        nmeaIndex = 0;
      }
    } else if (nmeaIndex < sizeof(nmeaSentence) - 1) {
      nmeaSentence[nmeaIndex++] = c;
    }
  }

  // 2. Periodic telemetry push over USB Serial to Python Edge Engine
  unsigned long now = millis();
  if (now - lastGpsReport >= GPS_INTERVAL_MS) {
    lastGpsReport = now;
    Serial.print(F("{\"type\":\"gps\",\"lat\":"));
    Serial.print(currentLat, 6);
    Serial.print(F(",\"lon\":"));
    Serial.print(currentLon, 6);
    Serial.print(F(",\"speed\":"));
    Serial.print(currentSpeedKmh, 1);
    Serial.print(F(",\"fix\":"));
    Serial.print(hasGpsFix ? 1 : 0);
    Serial.println(F("}"));
  }

  // 3. Handle commands from Python Edge Engine
  if (Serial.available() > 0) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    if (cmd == "BUZZ:ON" || cmd == "ALARM:ON") {
      digitalWrite(PIN_BUZZER, HIGH);
      digitalWrite(PIN_LED, HIGH);
    } else if (cmd == "BUZZ:OFF" || cmd == "ALARM:OFF") {
      digitalWrite(PIN_BUZZER, LOW);
      digitalWrite(PIN_LED, LOW);
    } else if (cmd.startsWith("BEEP:")) {
      int count = cmd.substring(5).toInt();
      if (count <= 0) count = 3;
      beepAlert(count, 100);
    }
  }
}

// Emits N rapid alert beeps
void beepAlert(int count, int durationMs) {
  for (int i = 0; i < count; i++) {
    digitalWrite(PIN_BUZZER, HIGH);
    digitalWrite(PIN_LED, HIGH);
    delay(durationMs);
    digitalWrite(PIN_BUZZER, LOW);
    digitalWrite(PIN_LED, LOW);
    if (i < count - 1) delay(durationMs);
  }
}

// Minimal NMEA $GPRMC / $GNRMC parser for latitude, longitude, and speed
void parseNMEA(char* s) {
  if (strncmp(s, "$GPRMC", 6) != 0 && strncmp(s, "$GNRMC", 6) != 0) return;

  // Split comma-delimited tokens
  char* tokens[13];
  byte tokenIdx = 0;
  char* p = s;
  tokens[tokenIdx++] = p;
  while (*p && tokenIdx < 13) {
    if (*p == ',') {
      *p = '\0';
      tokens[tokenIdx++] = p + 1;
    }
    p++;
  }

  if (tokenIdx >= 8 && strcmp(tokens[2], "A") == 0) { // 'A' = Valid Fix
    hasGpsFix = true;
    
    // Parse Latitude (DDMM.MMMM)
    float rawLat = atof(tokens[3]);
    int degLat = (int)(rawLat / 100);
    float minLat = rawLat - (degLat * 100);
    currentLat = degLat + (minLat / 60.0);
    if (strcmp(tokens[4], "S") == 0) currentLat = -currentLat;

    // Parse Longitude (DDDMM.MMMM)
    float rawLon = atof(tokens[5]);
    int degLon = (int)(rawLon / 100);
    float minLon = rawLon - (degLon * 100);
    currentLon = degLon + (minLon / 60.0);
    if (strcmp(tokens[6], "W") == 0) currentLon = -currentLon;

    // Parse speed in knots -> km/h
    float knots = atof(tokens[7]);
    currentSpeedKmh = knots * 1.852;
  } else {
    hasGpsFix = false;
  }
}
