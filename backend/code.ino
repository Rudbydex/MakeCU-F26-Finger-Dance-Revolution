// Finger Dance Revolution - controller firmware (the WEBSITE runs the game)
// --------------------------------------------------------------------------
// The website sends commands (which finger to ask for, LED colors) and the
// Arduino reports touches back. Serial at 115200 baud, one message per line.
//
// WEBSITE -> ARDUINO
//   TARGET,INDEX     ask for a finger (INDEX, MIDDLE, RING, PINKY or 1-4)
//   CANCEL           stop asking for the current finger
//   COLOR,GREEN      set the RGB LED yourself (OFF RED GREEN YELLOW BLUE PURPLE CYAN WHITE)
//   CAL              re-measure the FSR resting value (thumb off the FSR)
//   THRESHOLD,100    contact sensitivity (FSR change that counts as pressed)
//   STREAM,1         send raw sensor readings 20x/second (STREAM,0 to stop)
//   PING             replies PONG
//   HELP             lists the commands
//
// ARDUINO -> WEBSITE
//   READY,<rest>                      after startup
//   -> CONTACT: <finger>              a finger started touching (format read by serial_bridge.py)
//   CONTACT,<finger>                  a finger started touching the thumb
//   RELEASE,<finger>,<hold_ms>        that finger let go
//   HIT,<finger>,<reaction_ms>        the TARGET finger touched the thumb
//   WRONG,<finger>                    a different finger touched while a target was set
//   DONE,<finger>,<reaction_ms>,<hold_ms>,<wrong_count>   target finger released, trial over
//   S,<index>,<middle>,<ring>,<pinky>,<fsr>   raw readings (only with STREAM,1)
//   OK,... / ERR,... / REST,<value> / PONG     command replies
//
// RGB LED FEEDBACK (automatic while a TARGET is set)
//   correct finger -> that finger's color while held:
//     index = GREEN, middle = BLUE, ring = YELLOW, pinky = PURPLE
//   wrong finger   -> RED (while held, plus a moment after)
//
// WIRING
//   Touch sensors yellow -> D2 (index), D3 (middle), D4 (ring), D5 (pinky); red -> 5V, black -> GND
//   FSR: 5V -> FSR -> A0, 10k resistor A0 -> GND (FSR legs in different rows)
//   RGB LED: red leg -> 470 ohm -> A1, green -> 470 ohm -> A2, blue -> 470 ohm -> A3
//            long (common) leg -> GND (common cathode) or 5V (common anode)
//
// To try it without the website: open the Serial Monitor at 115200, set the
// line ending to "Newline", and type commands like TARGET,INDEX

const bool COMMON_ANODE = false;        // true if the RGB LED's long leg goes to 5V

const int TOUCH_PINS[4] = {2, 3, 4, 5};
const char* NAMES[4] = {"INDEX", "MIDDLE", "RING", "PINKY"};
const int FSR_PIN = A0;
const int RGB_PINS[3] = {A1, A2, A3};

const int OFF = 0, RED = 1, GREEN = 2, YELLOW = 3, BLUE = 4, PURPLE = 5, CYAN = 6, WHITE = 7;
const char* COLOR_NAMES[8] = {"OFF", "RED", "GREEN", "YELLOW", "BLUE", "PURPLE", "CYAN", "WHITE"};
const int FINGER_COLORS[4] = {GREEN, BLUE, YELLOW, PURPLE};
const int WRONG_COLOR = RED;

const unsigned long GRACE_MS = 150;     // ignore tiny contact dropouts
const unsigned long WRONG_SHOW_MS = 300;

int fsrThreshold = 100;
int fsrRest = 0;

int target = -1;                        // finger being asked for, -1 = none
unsigned long targetStart = 0, reactMs = 0;
int wrongCount = 0;
bool targetHit = false;

int activeFinger = -1;                  // finger currently touching the thumb
unsigned long contactStart = 0, lastContact = 0, wrongUntil = 0;

int manualColor = OFF;
bool streaming = false;
unsigned long lastStream = 0;

char line[40];
int lineLen = 0;

// ---------- LED ----------
void setColor(int c) {
  for (int i = 0; i < 3; i++) {
    bool on = (c >> i) & 1;
    if (COMMON_ANODE) on = !on;
    digitalWrite(RGB_PINS[i], on ? HIGH : LOW);
  }
}

// ---------- Sensors ----------
int readFsr() {
  long s = 0;
  for (int i = 0; i < 4; i++) s += analogRead(FSR_PIN);
  return s / 4;
}

void measureRest() {
  long s = 0;
  for (int i = 0; i < 50; i++) { s += readFsr(); delay(10); }
  fsrRest = s / 50;
}

bool touched(int f) { return digitalRead(TOUCH_PINS[f]) == HIGH; }

int anyContact() {
  if (abs(readFsr() - fsrRest) <= fsrThreshold) return -1;
  for (int i = 0; i < 4; i++) if (touched(i)) return i;
  return -1;
}

// ---------- Helpers ----------
void send2(const char* a, const char* b) {
  Serial.print(a); Serial.print(","); Serial.println(b);
}

int parseFinger(const char* s) {
  for (int i = 0; i < 4; i++) if (strcmp(s, NAMES[i]) == 0) return i;
  if (s[0] >= '1' && s[0] <= '4' && s[1] == '\0') return s[0] - '1';
  return -1;
}

int parseColor(const char* s) {
  for (int i = 0; i < 8; i++) if (strcmp(s, COLOR_NAMES[i]) == 0) return i;
  return -1;
}

void printHelp() {
  Serial.println("Commands: TARGET,<INDEX|MIDDLE|RING|PINKY|1-4>  CANCEL  COLOR,<name>");
  Serial.println("          CAL  THRESHOLD,<n>  STREAM,<1|0>  PING  HELP");
}

// ---------- Touch events ----------
void onContactStart(int f, unsigned long now) {
  Serial.print("-> CONTACT: "); Serial.println(NAMES[f]);   // for serial_bridge.py
  send2("CONTACT", NAMES[f]);
  if (target == -1) return;
  if (f == target && !targetHit) {
    targetHit = true;
    reactMs = now - targetStart;
    Serial.print("HIT,"); Serial.print(NAMES[f]); Serial.print(","); Serial.println(reactMs);
  } else if (f != target) {
    wrongCount++;
    send2("WRONG", NAMES[f]);
  }
}

void onRelease(int f, unsigned long holdMs, unsigned long now) {
  Serial.print("RELEASE,"); Serial.print(NAMES[f]); Serial.print(","); Serial.println(holdMs);
  if (target == -1) return;
  if (f == target && targetHit) {
    Serial.print("DONE,"); Serial.print(NAMES[f]); Serial.print(",");
    Serial.print(reactMs); Serial.print(","); Serial.print(holdMs); Serial.print(",");
    Serial.println(wrongCount);
    target = -1;
  } else if (f != target) {
    wrongUntil = now + WRONG_SHOW_MS;
  }
}

// ---------- Commands ----------
void handleLine() {
  line[lineLen] = '\0';
  lineLen = 0;
  for (int i = 0; line[i]; i++) {          // upper-case, allow spaces instead of commas
    if (line[i] >= 'a' && line[i] <= 'z') line[i] -= 32;
    if (line[i] == ' ') line[i] = ',';
  }
  if (line[0] == '\0') return;

  char* arg = strchr(line, ',');
  if (arg) { *arg = '\0'; arg++; } else arg = (char*)"";

  if (strcmp(line, "TARGET") == 0) {
    int f = parseFinger(arg);
    if (f < 0) { send2("ERR", "finger must be INDEX MIDDLE RING PINKY or 1-4"); return; }
    target = f;
    targetStart = millis();
    targetHit = false;
    wrongCount = 0;
    reactMs = 0;
    manualColor = OFF;
    Serial.print("OK,TARGET,"); Serial.println(NAMES[f]);
  } else if (strcmp(line, "CANCEL") == 0) {
    target = -1;
    Serial.println("OK,CANCEL");
  } else if (strcmp(line, "COLOR") == 0) {
    int c = parseColor(arg);
    if (c < 0) { send2("ERR", "color must be OFF RED GREEN YELLOW BLUE PURPLE CYAN WHITE"); return; }
    manualColor = c;
    send2("OK,COLOR", COLOR_NAMES[c]);
  } else if (strcmp(line, "CAL") == 0) {
    measureRest();
    Serial.print("REST,"); Serial.println(fsrRest);
  } else if (strcmp(line, "THRESHOLD") == 0) {
    int v = atoi(arg);
    if (v < 1) { send2("ERR", "threshold must be a positive number"); return; }
    fsrThreshold = v;
    Serial.print("OK,THRESHOLD,"); Serial.println(fsrThreshold);
  } else if (strcmp(line, "STREAM") == 0) {
    streaming = (arg[0] == '1');
    Serial.print("OK,STREAM,"); Serial.println(streaming ? 1 : 0);
  } else if (strcmp(line, "PING") == 0) {
    Serial.println("PONG");
  } else if (strcmp(line, "HELP") == 0) {
    printHelp();
  } else {
    send2("ERR,unknown command", line);
  }
}

// ---------- Setup & loop ----------
void setup() {
  Serial.begin(115200);
  for (int i = 0; i < 4; i++) pinMode(TOUCH_PINS[i], INPUT);
  for (int i = 0; i < 3; i++) pinMode(RGB_PINS[i], OUTPUT);

  // Color check at power-up: green, blue, yellow, purple, red
  for (int i = 0; i < 4; i++) { setColor(FINGER_COLORS[i]); delay(300); }
  setColor(WRONG_COLOR); delay(300);
  setColor(OFF);

  delay(300);
  measureRest();                         // keep thumb OFF the FSR during startup
  Serial.print("READY,"); Serial.println(fsrRest);
}

void loop() {
  // 1) Commands from the website
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') { if (lineLen > 0) handleLine(); }
    else if (lineLen < (int)sizeof(line) - 1) line[lineLen++] = c;
  }

  // 2) Track contact (with a short grace period so flickers don't count as releases)
  unsigned long now = millis();
  int c = anyContact();
  if (c != -1) {
    if (activeFinger == -1) {
      activeFinger = c;
      contactStart = now;
      onContactStart(c, now);
    }
    if (c == activeFinger) lastContact = now;
  }
  if (activeFinger != -1 && now - lastContact > GRACE_MS) {
    int f = activeFinger;
    activeFinger = -1;
    onRelease(f, lastContact - contactStart, now);
  }

  // 3) RGB LED
  int color;
  if (target != -1 && activeFinger != -1) {
    color = (activeFinger == target) ? FINGER_COLORS[target] : WRONG_COLOR;
  } else if (now < wrongUntil) {
    color = WRONG_COLOR;
  } else if (target != -1) {
    color = OFF;
  } else {
    color = manualColor;
  }
  setColor(color);

  // 4) Optional raw stream
  if (streaming && now - lastStream >= 50) {
    lastStream = now;
    Serial.print("S,");
    for (int i = 0; i < 4; i++) { Serial.print(touched(i) ? 1 : 0); Serial.print(","); }
    Serial.println(readFsr());
  }

  delay(5);
}