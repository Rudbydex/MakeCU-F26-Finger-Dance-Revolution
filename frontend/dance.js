const zones = [...document.querySelectorAll(".zone")];
const hands = [...document.querySelectorAll(".hand")];
const game = document.getElementById("game");
const strengthRecord = document.getElementById("strength-record");
const openStrength = document.getElementById("open-strength");
const returnGame = document.getElementById("return-game");
const latestStrengthLabel = document.getElementById("latest-strength-label");
const latestStrength = document.getElementById("latest-strength");
const exampleStrengths = strengthRecord.querySelectorAll("[data-strength-factor]");
const strengthMeters = [...strengthRecord.querySelectorAll("meter")];
const handPicker = document.getElementById("hand-picker");
const handOptions = [...handPicker.querySelectorAll("button")];
const handImages = [...document.querySelectorAll("[data-mirrored-src]")].map(image => ({
  image,
  original: image.getAttribute("src"),
}));
const squeeze = document.getElementById("squeeze");
const measureSqueeze = document.getElementById("measure-squeeze");
const continueSqueeze = document.getElementById("continue-squeeze");
const squeezeStatus = document.getElementById("squeeze-status");
const tutorial = document.getElementById("tutorial");
const speedSelector = document.getElementById("speed");
const startButton = document.getElementById("start");
const roundLabel = document.getElementById("round-label");
const roundScore = document.getElementById("round-score");
const bestScore = document.getElementById("best-score");
const cue = document.getElementById("cue");
const feedback = document.getElementById("feedback");
const sensorConnection = document.getElementById("sensor-connection");
const sensorReading = document.getElementById("sensor-reading");
const mascot = document.querySelector(".mascot");
const defaultMascot = mascot.getAttribute("src");

const tutorialZone = 1;
const directions = ["Left", "Down", "Up", "Right"];
const arrowKeys = ["ArrowLeft", "ArrowDown", "ArrowUp", "ArrowRight"];
const tracks = [
  { name: "Slow song", beatLength: 0.72, beats: 12, pitches: [261.63, 329.63, 392, 440] },
  { name: "Fast song", beatLength: 0.4, beats: 16, pitches: [392, 493.88, 587.33, 659.25] },
];
const maxScore = tracks.reduce((sum, track) => sum + track.beats, 0);
const bestKey = "finger-dance-two-round-best";
const strengthKey = "finger-dance-squeeze-";
const demoStrengths = Array.from(exampleStrengths, () => 50 + Math.floor(Math.random() * 101));
const formatStrength = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

let audio;
let tutorialComplete = false;
let selectedHand;
let activeRound;
let activeZone = 0;
let cueSentAt = 0;
let activeBeat = -1;
let lastTapId = 0;
let hardwareStateSeen = false;
let latestHardware;
let hardwareReceivedAt = 0;
let score = 0;
let wrongStreak = 0;
let best = 0;
const hitBeats = new Set();

try {
  const saved = Number(localStorage.getItem(bestKey));
  if (Number.isInteger(saved) && saved >= 0 && saved <= maxScore) best = saved;
} catch {
  // Scores still work for the current page when local storage is unavailable.
}
bestScore.textContent = best;

function latestSqueeze() {
  try {
    return ["left", "right"]
      .map(hand => JSON.parse(localStorage.getItem(strengthKey + hand) ?? "null"))
      .filter(record => record && Number.isFinite(Date.parse(record.measuredAt))
        && (Number.isFinite(record.fingerPressureAverage) || Number.isFinite(record.thumbPressure)))
      .sort((first, second) => Date.parse(second.measuredAt) - Date.parse(first.measuredAt))[0];
  } catch {
    return undefined;
  }
}

openStrength.addEventListener("click", () => {
  const record = latestSqueeze();
  const hasFingerAverage = Number.isFinite(record?.fingerPressureAverage);
  const reference = hasFingerAverage ? record.fingerPressureAverage : record?.thumbPressure;
  const examples = Array.from(exampleStrengths, (row, index) =>
    record ? reference * Number(row.dataset.strengthFactor) : demoStrengths[index]
  );
  exampleStrengths.forEach((row, index) => {
    row.textContent = `${formatStrength.format(examples[index])} counts`;
  });
  const values = [...examples, reference ?? 0];
  const largest = Math.max(0, ...values);
  const scaleMax = largest > 0 ? largest / 0.7 : 1;
  strengthMeters.forEach((meter, index) => {
    meter.max = scaleMax;
    meter.value = values[index];
  });
  const date = record ? new Date(record.measuredAt) : null;
  const isToday = date?.toDateString() === new Date().toDateString();
  latestStrengthLabel.textContent = !date || isToday ? "Today" : `Latest · ${date.toLocaleDateString()}`;
  const readingType = hasFingerAverage ? "finger average" : "thumb only";
  latestStrength.textContent = record
    ? `${formatStrength.format(reference)} counts (${readingType}, ${record.hand} hand)`
    : "No squeeze recorded yet";
  game.hidden = true;
  strengthRecord.hidden = false;
  document.getElementById("strength-title").focus();
});

returnGame.addEventListener("click", () => {
  strengthRecord.hidden = true;
  game.hidden = false;
  openStrength.focus();
});

function makePattern(length) {
  const pattern = [];
  while (pattern.length < length) {
    const bag = [1, 2, 3, 4];
    for (let index = bag.length - 1; index > 0; index--) {
      const swap = Math.floor(Math.random() * (index + 1));
      [bag[index], bag[swap]] = [bag[swap], bag[index]];
    }
    if (bag[0] === pattern.at(-1)) [bag[0], bag[1]] = [bag[1], bag[0]];
    pattern.push(...bag);
  }
  return pattern.slice(0, length);
}

function post(endpoint, data) {
  return fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).catch(() => {
    // The local browser game remains playable without the hardware bridge.
  });
}

function showZone(zone) {
  if (zone === activeZone) return;
  activeZone = zone;
  zones.forEach(button => {
    button.classList.toggle("is-cued", Number(button.dataset.zone) === zone);
  });
  hands.forEach(hand => {
    hand.hidden = Number(hand.dataset.zone) !== zone;
  });
  publishCue();
}

function publishCue() {
  cueSentAt = audio.currentTime;
  post("/api/cue", { zone: activeZone || null });
}

function showFeedback(message, wrongTap = false) {
  feedback.textContent = message;
  let image = defaultMascot;
  if (!tutorial.hidden || wrongStreak >= 4) image = "assets/octopus-wrong-streak.png";
  else if (wrongTap) image = "assets/octopus-wrong.png";
  if (mascot.getAttribute("src") !== image) mascot.src = image;
}

function scoreTap(zone) {
  if (!activeRound) return;
  const beat = Math.floor((audio.currentTime - activeRound.start) / activeRound.beatLength);
  const expectedZone = activeRound.pattern[beat];
  if (expectedZone === undefined) return;
  if (zone !== expectedZone) {
    wrongStreak += 1;
    showFeedback("Try the lit finger!", true);
    return;
  }
  wrongStreak = 0;
  showFeedback("On beat!");
  if (hitBeats.has(beat)) return;
  hitBeats.add(beat);
  roundScore.textContent = ++score;
}

function scheduleTrack(track, start, speed) {
  const beatLength = track.beatLength / speed;
  const pattern = makePattern(track.beats);
  pattern.forEach((zone, index) => {
    const time = start + index * beatLength;
    const duration = beatLength * 0.68;
    const tone = audio.createOscillator();
    const volume = audio.createGain();
    tone.frequency.value = track.pitches[zone - 1];
    volume.gain.setValueAtTime(0.001, time);
    volume.gain.exponentialRampToValueAtTime(0.13, time + 0.025);
    volume.gain.exponentialRampToValueAtTime(0.001, time + duration);
    tone.connect(volume).connect(audio.destination);
    tone.start(time);
    tone.stop(time + duration);
  });
  return { ...track, beatLength, pattern, start, end: start + track.beats * beatLength };
}

function finishGame() {
  wrongStreak = 0;
  activeRound = undefined;
  showZone(0);
  if (score > best) {
    best = score;
    bestScore.textContent = best;
    try {
      localStorage.setItem(bestKey, String(best));
    } catch {
      // The best score is still displayed for this page.
    }
  }
  roundLabel.textContent = "Both songs complete";
  cue.textContent = `You hit ${score} of ${maxScore} beats!`;
  showFeedback("");
  speedSelector.disabled = false;
  openStrength.disabled = false;
  startButton.textContent = "Play again";
  startButton.hidden = false;
  startButton.disabled = false;
  if (zones.includes(document.activeElement)) startButton.focus();
}

async function startGame() {
  if (!tutorial.hidden || startButton.disabled) return;
  startButton.disabled = true;
  openStrength.disabled = true;
  try {
    audio ??= new AudioContext();
    if (audio.state !== "running") await audio.resume();
    if (!tutorialComplete) {
      tutorial.hidden = false;
      startButton.hidden = true;
      roundLabel.textContent = "Tutorial";
      openStrength.disabled = false;
      cue.textContent = "";
      cue.hidden = true;
      showFeedback("");
      zones[0].focus();
      return;
    }
    const speed = Number(speedSelector.querySelector("input:checked").value);
    const slow = scheduleTrack(tracks[0], audio.currentTime + 1, speed);
    const fast = scheduleTrack(tracks[1], slow.end + 2, speed);
    speedSelector.disabled = true;

    score = 0;
    wrongStreak = 0;
    roundScore.textContent = score;
    roundLabel.textContent = slow.name;
    cue.hidden = false;
    cue.textContent = "Get ready";
    showFeedback("");
    startButton.hidden = true;
    zones[0].focus();

    function update() {
      const time = audio.currentTime;
      if (time >= fast.end) {
        finishGame();
        return;
      }
      const round = time < slow.end ? slow : fast;
      if (round !== activeRound) {
        activeRound = round;
        activeBeat = -1;
        hitBeats.clear();
        roundLabel.textContent = round.name;
        cue.textContent = round === slow ? "Get ready" : "Fast song up next";
        showFeedback("");
        showZone(0);
      }

      const beat = Math.floor((time - round.start) / round.beatLength);
      if (beat >= 0 && beat !== activeBeat) {
        activeBeat = beat;
        const zone = round.pattern[beat];
        showFeedback("");
        cue.textContent = `Tap ${directions[zone - 1]}!`;
        showZone(zone);
      }
      // Keep long, slow cues active on the hardware bridge.
      if (activeZone && time - cueSentAt >= 0.5) publishCue();
      requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
  } catch {
    cue.hidden = false;
    cue.textContent = "Audio could not start";
    speedSelector.disabled = false;
    openStrength.disabled = false;
    startButton.textContent = "Try again";
    startButton.hidden = false;
    startButton.disabled = false;
  }
}

function handleTap(zone) {
  if (game.hidden) return;
  if (tutorial.hidden) {
    scoreTap(zone);
    return;
  }
  if (zone !== tutorialZone) {
    showFeedback("Try the green index finger.");
    return;
  }
  tutorialComplete = true;
  tutorial.hidden = true;
  startButton.disabled = false;
  startGame();
}

function sendTap(zone) {
  handleTap(zone);
  post("/api/tap", { zone, source: "browser" });
}

function showHardwareStatus(hardware) {
  latestHardware = hardware;
  hardwareReceivedAt = performance.now();
  const connected = Boolean(hardware);
  const label = connected ? "Sensor connected" : "Waiting for sensor";
  if (sensorConnection.textContent !== label) sensorConnection.textContent = label;
  sensorConnection.dataset.connected = connected;
  sensorReading.hidden = !connected;
  if (connected) {
    const contact = hardware.zone ? zones[hardware.zone - 1].textContent.trim() : "No pinch";
    sensorReading.textContent = `Thumb pressure ${hardware.fsr} / ${contact}`;
  }
}

async function readHardware() {
  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (response.ok) {
      const { last_tap: tap, hardware } = await response.json();
      showHardwareStatus(hardware);
      // Ignore a tap left over from before this page opened.
      if (!hardwareStateSeen) {
        hardwareStateSeen = true;
        lastTapId = tap?.id ?? 0;
      }
      if (!tap || tap.id < lastTapId) lastTapId = 0;
      if (tap && tap.id > lastTapId) {
        lastTapId = tap.id;
        if (tap.source === "hardware") handleTap(tap.zone);
      }
    } else {
      showHardwareStatus(null);
    }
  } catch {
    showHardwareStatus(null);
  } finally {
    setTimeout(readHardware, 65);
  }
}

startButton.addEventListener("click", () => {
  startButton.hidden = true;
  handPicker.hidden = false;
  cue.textContent = "Choose the hand you will use";
  (handOptions.find(button => button.dataset.hand === selectedHand) ?? handOptions[0]).focus();
});
handOptions.forEach(button => button.addEventListener("click", () => {
  const hand = button.dataset.hand;
  if (hand !== selectedHand) {
    tutorialComplete = false;
    selectedHand = hand;
    handImages.forEach(({ image, original }) => {
      image.src = hand === "left" ? image.dataset.mirroredSrc : original;
    });
  }
  handPicker.hidden = true;
  squeeze.hidden = false;
  roundLabel.textContent = "Squeeze check";
  cue.hidden = true;
  squeezeStatus.textContent = "";
  measureSqueeze.hidden = false;
  continueSqueeze.textContent = "Skip for now";
  measureSqueeze.focus();
}));

measureSqueeze.addEventListener("click", () => {
  measureSqueeze.disabled = true;
  continueSqueeze.disabled = true;
  openStrength.disabled = true;
  squeezeStatus.textContent = "Get ready";
  setTimeout(() => { squeezeStatus.textContent = "Squeeze and hold"; }, 400);
  setTimeout(() => {
    measureSqueeze.disabled = false;
    continueSqueeze.disabled = false;
    openStrength.disabled = false;
    const sampleAge = latestHardware?.age_ms + performance.now() - hardwareReceivedAt;
    if (!(sampleAge >= 0 && sampleAge <= 850)) {
      squeezeStatus.textContent = "No fresh sensor reading. Check the connection and try again.";
      measureSqueeze.focus();
      return;
    }

    const counts = latestHardware.pressure_counts ?? null;
    const average = counts
      ? (counts.reduce((sum, count) => sum + count, 0) - Math.min(...counts)) / 3
      : null;
    const measurement = {
      hand: selectedHand,
      thumbPressure: latestHardware.fsr,
      fingerPressureCounts: counts,
      fingerPressureAverage: average,
      measuredAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(strengthKey + selectedHand, JSON.stringify(measurement));
    } catch {
      squeezeStatus.textContent = "This browser could not save the reading. Try again or skip.";
      measureSqueeze.focus();
      return;
    }
    squeezeStatus.textContent = average === null
      ? `Thumb reading saved: ${measurement.thumbPressure}. Individual finger pressure unavailable.`
      : `Finger pressure average saved: ${average.toFixed(1)}.`;
    measureSqueeze.hidden = true;
    continueSqueeze.textContent = "Continue";
    continueSqueeze.focus();
  }, 2400);
});
continueSqueeze.addEventListener("click", () => {
  squeeze.hidden = true;
  startGame();
});
zones.forEach(button => button.addEventListener("click", () => sendTap(Number(button.dataset.zone))));
window.addEventListener("keydown", event => {
  if (game.hidden || speedSelector.contains(event.target) || (tutorial.hidden && !startButton.disabled)) return;
  const arrow = arrowKeys.indexOf(event.key);
  if (arrow >= 0) {
    event.preventDefault();
    if (!event.repeat) sendTap(arrow + 1);
  } else if (!event.repeat && /^[1-4]$/.test(event.key)) {
    sendTap(Number(event.key));
  }
});
readHardware();
