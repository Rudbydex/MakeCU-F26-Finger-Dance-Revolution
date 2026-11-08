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
const stopButton = document.getElementById("stop");
const roundLabel = document.getElementById("round-label");
const roundScore = document.getElementById("round-score");
const bestScore = document.getElementById("best-score");
const cue = document.getElementById("cue");
const feedback = document.getElementById("feedback");
const sensorConnection = document.getElementById("sensor-connection");
const sensorReading = document.getElementById("sensor-reading");
const openSongs = document.getElementById("open-songs");
const songLibrary = document.getElementById("song-library");
const songsReturn = document.getElementById("songs-return");
const starterSongs = document.getElementById("starter-songs");
const uploadedSongs = document.getElementById("uploaded-songs");
const uploadForm = document.getElementById("upload-song");
const uploadButton = document.getElementById("upload-button");
const songStatus = document.getElementById("song-status");
const selectedSongLabel = document.getElementById("selected-song");
const mascot = document.querySelector(".mascot");
const defaultMascot = mascot.getAttribute("src");

const tutorialZone = 1;
const placementPrompt = "Try placing the pad of your finger on the center of the thumb sensor.";
const squeezeRise = 12;
const squeezeWindowMs = 1000;
const directions = ["Left", "Down", "Up", "Right"];
const arrowKeys = ["ArrowLeft", "ArrowDown", "ArrowUp", "ArrowRight"];
const tracks = [
  { name: "Slow song", beatLength: 0.72, beats: 12, pitches: [261.63, 329.63, 392, 440] },
  { name: "Fast song", beatLength: 0.4, beats: 16, pitches: [392, 493.88, 587.33, 659.25] },
];
const warmupBestKey = "finger-dance-two-round-best";
const starterSlots = 3;
// Each speed asks DDC for a matching difficulty when playing a real song.
const songDifficulty = { "0.5": "Easy", "0.8": "Medium", "1.3": "Hard" };
const songGrace = 0.12;
const strengthKey = "finger-dance-squeeze-";
const demoStrengths = Array.from(exampleStrengths, () => 50 + Math.floor(Math.random() * 101));
const formatStrength = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

let audio;
let tutorialComplete = false;
let selectedHand;
let selectedSong = null;
let liveSources = [];
let stopRequested = false;
let loadingSong = false;
let playToken = 0;
let activeRound;
let rounds = [];
let feedbackTimeout;
let activeZone = 0;
let cueSentAt = 0;
let activeNote = -1;
let lastTapId = 0;
let hardwareStateSeen = false;
let latestHardware;
let hasSensX25 = false;
let hardwareReceivedAt = 0;
let squeezeCapture;
let score = 0;
let wrongStreak = 0;
let best = 0;
const preparedSongs = new Map();

function bestKey() {
  return selectedSong ? `finger-dance-best:${selectedSong.id}:${currentDifficulty()}` : warmupBestKey;
}

function loadBest() {
  best = 0;
  try {
    const saved = Number(localStorage.getItem(bestKey()));
    if (Number.isInteger(saved) && saved >= 0) best = saved;
  } catch {
    // Scores still work for the current page when local storage is unavailable.
  }
  bestScore.textContent = best;
}
loadBest();

function setMenusDisabled(disabled) {
  openStrength.disabled = disabled;
  openSongs.disabled = disabled;
}

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
  publishCue();
  songLibrary.hidden = true;
  strengthRecord.hidden = false;
  document.getElementById("strength-title").focus();
});

returnGame.addEventListener("click", () => {
  strengthRecord.hidden = true;
  game.hidden = false;
  publishCue();
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
  cueSentAt = performance.now();
  const zone = game.hidden ? null : tutorial.hidden ? activeZone || null : tutorialZone;
  post("/api/cue", { zone });
}

function showFeedback(message, wrongTap = false) {
  clearTimeout(feedbackTimeout);
  feedback.textContent = message;
  let image = defaultMascot;
  if (!tutorial.hidden || wrongStreak >= 4) image = "assets/octopus-wrong-streak.png";
  else if (wrongTap) image = "assets/octopus-wrong.png";
  if (mascot.getAttribute("src") !== image) mascot.src = image;
}

// The note playing at this time. Taps pass a grace period so a slightly early tap counts.
function noteAt(round, time, grace = 0) {
  for (let index = round.notes.length - 1; index >= 0; index--) {
    const note = round.notes[index];
    if (note.time - grace <= time) return time < note.end ? index : -1;
  }
  return -1;
}

function scoreTap(zone, ageMs, centered) {
  if (!rounds.length) return;
  // Hardware taps arrive a little late, so score them at the time they happened.
  const tapTime = audio.currentTime - ageMs / 1000;
  const round = rounds.find(({ start, end, grace }) => tapTime >= start - grace && tapTime < end);
  if (!round) return;
  const index = noteAt(round, tapTime, round.grace);
  if (index < 0) {
    if (centered === false) {
      showFeedback(placementPrompt);
      feedbackTimeout = setTimeout(() => showFeedback(""), 1400);
    }
    return;
  }
  const correct = zone === round.notes[index].zone;
  post("/api/feedback", { zone, correct });
  if (!correct) {
    wrongStreak += 1;
    const message = centered === false ? `Try the lit finger. ${placementPrompt}` : "Try the lit finger!";
    showFeedback(message, true);
    feedbackTimeout = setTimeout(() => showFeedback(""), centered === false ? 1400 : 350);
    return;
  }
  wrongStreak = 0;
  showFeedback(centered === false ? `On beat! ${placementPrompt}` : "On beat!");
  feedbackTimeout = setTimeout(() => showFeedback(""), centered === false ? 1400 : 350);
  if (round.hitNotes.has(index)) return;
  round.hitNotes.add(index);
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
    liveSources.push(tone);
  });
  const notes = pattern.map((zone, index) => ({
    zone,
    time: start + index * beatLength,
    end: start + (index + 1) * beatLength,
  }));
  return { name: track.name, notes, grace: 0, start, end: start + track.beats * beatLength, hitNotes: new Set() };
}

function currentDifficulty() {
  return songDifficulty[speedSelector.querySelector("input:checked").value] ?? "Medium";
}

async function prepareSong(song, difficulty) {
  const key = `${song.id}|${difficulty}`;
  if (!preparedSongs.has(key)) {
    const loading = (async () => {
      audio ??= new AudioContext();
      const [chartResponse, audioResponse] = await Promise.all([
        fetch(`/api/chart?${new URLSearchParams({ id: song.id, difficulty })}`, { cache: "no-store" }),
        fetch(song.audio_url),
      ]);
      const chart = await chartResponse.json().catch(() => ({}));
      if (!chartResponse.ok) throw new Error(chart.error ?? "Could not make steps for this song");
      if (!audioResponse.ok) throw new Error("Could not load the song audio");
      const buffer = await audio.decodeAudioData(await audioResponse.arrayBuffer())
        .catch(() => { throw new Error("This browser cannot play that audio format"); });
      return { notes: chart.notes, buffer };
    })();
    preparedSongs.set(key, loading);
    loading.catch(() => preparedSongs.delete(key));
  }
  return preparedSongs.get(key);
}

function scheduleSong(song, prepared, start) {
  const songSource = audio.createBufferSource();
  songSource.buffer = prepared.buffer;
  songSource.connect(audio.destination);
  songSource.start(start);
  liveSources.push(songSource);
  const notes = prepared.notes.map(note => ({ zone: note.zone, time: start + note.time, end: start + note.end }));
  const end = Math.max(start + prepared.buffer.duration, (notes.at(-1)?.end ?? start) + 0.5);
  return { name: song.title, notes, grace: songGrace, start, end, hitNotes: new Set() };
}

function finishGame(stopped = false) {
  const total = rounds.reduce((sum, round) => sum + round.notes.length, 0);
  wrongStreak = 0;
  activeRound = undefined;
  rounds = [];
  liveSources.forEach(source => source.stop());
  liveSources = [];
  stopButton.hidden = true;
  showZone(0);
  if (!stopped && score > best) {
    best = score;
    bestScore.textContent = best;
    try {
      localStorage.setItem(bestKey(), String(best));
    } catch {
      // The best score is still displayed for this page.
    }
  }
  if (stopped) {
    roundLabel.textContent = "Stopped";
    cue.textContent = total ? `Stopped early. You hit ${score} of ${total} beats.` : "Stopped";
  } else {
    roundLabel.textContent = selectedSong ? "Song complete" : "Both songs complete";
    cue.textContent = `You hit ${score} of ${total} beats!`;
  }
  showFeedback("");
  speedSelector.disabled = false;
  setMenusDisabled(false);
  startButton.textContent = "Play again";
  startButton.hidden = false;
  startButton.disabled = false;
  if (stopped || zones.includes(document.activeElement)) startButton.focus();
}

async function startGame() {
  if (!tutorial.hidden || startButton.disabled) return;
  startButton.disabled = true;
  setMenusDisabled(true);
  let token;
  try {
    audio ??= new AudioContext();
    if (audio.state !== "running") await audio.resume();
    if (!tutorialComplete) {
      tutorial.hidden = false;
      publishCue();
      startButton.hidden = true;
      roundLabel.textContent = "Tutorial";
      setMenusDisabled(false);
      cue.textContent = "";
      cue.hidden = true;
      showFeedback("");
      zones[0].focus();
      return;
    }
    speedSelector.disabled = true;
    startButton.hidden = true;
    stopRequested = false;
    token = ++playToken;
    stopButton.hidden = false;
    cue.hidden = false;
    if (selectedSong) {
      roundLabel.textContent = selectedSong.title;
      cue.textContent = "Making finger steps…";
      loadingSong = true;
      const prepared = await prepareSong(selectedSong, currentDifficulty()).finally(() => { loadingSong = false; });
      // Stop already reset the game while the steps were loading.
      if (token !== playToken || stopRequested) return;
      rounds = [scheduleSong(selectedSong, prepared, audio.currentTime + 1)];
    } else {
      const speed = Number(speedSelector.querySelector("input:checked").value);
      const slow = scheduleTrack(tracks[0], audio.currentTime + 1, speed);
      rounds = [slow, scheduleTrack(tracks[1], slow.end + 2, speed)];
    }
    loadBest();

    score = 0;
    wrongStreak = 0;
    roundScore.textContent = score;
    roundLabel.textContent = rounds[0].name;
    cue.textContent = "Get ready";
    showFeedback("");
    zones[0].focus();

    function update() {
      const time = audio.currentTime;
      if (stopRequested) {
        finishGame(true);
        return;
      }
      const end = rounds.at(-1).end;
      if (time >= end) {
        // Give the last beat's queued taps time to reach the browser.
        showZone(0);
        if (time >= end + 0.15) finishGame();
        else requestAnimationFrame(update);
        return;
      }
      const round = rounds.find(candidate => time < candidate.end);
      if (round !== activeRound) {
        activeRound = round;
        activeNote = -1;
        roundLabel.textContent = round.name;
        cue.textContent = round === rounds[0] ? "Get ready" : `${round.name} up next`;
        showFeedback("");
        showZone(0);
      }

      const index = noteAt(round, time);
      if (index !== activeNote) {
        activeNote = index;
        if (index >= 0) {
          const zone = round.notes[index].zone;
          cue.textContent = `Tap ${directions[zone - 1]}!`;
          showZone(zone);
        } else {
          showZone(0);
        }
      }
      requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
  } catch (error) {
    // A load that failed after Stop was pressed has nothing left to report.
    if (stopRequested || (token && token !== playToken)) return;
    cue.hidden = false;
    cue.textContent = error instanceof Error && error.message ? error.message : "Audio could not start";
    stopButton.hidden = true;
    speedSelector.disabled = false;
    setMenusDisabled(false);
    startButton.textContent = "Try again";
    startButton.hidden = false;
    startButton.disabled = false;
  }
}

function handleTap(zone, ageMs = 0, centered) {
  if (game.hidden) return;
  if (tutorial.hidden) {
    scoreTap(zone, ageMs, centered);
    return;
  }
  if (hasSensX25 && centered === undefined) {
    showFeedback("Use the glove to touch the thumb sensor with your index finger.");
    return;
  }
  const correctFinger = zone === tutorialZone;
  const correct = correctFinger && centered !== false;
  post("/api/feedback", { zone, correct });
  if (!correct) {
    const message = correctFinger ? `${placementPrompt} Release and try again.` : "Try the green index finger.";
    showFeedback(message);
    return;
  }
  tutorialComplete = true;
  tutorial.hidden = true;
  publishCue();
  startButton.disabled = false;
  startGame();
}

function sendTap(zone) {
  handleTap(zone);
  post("/api/tap", { zone, source: "browser" });
}

function showHardwareStatus(hardware, samples = []) {
  latestHardware = hardware;
  hardwareReceivedAt = performance.now();
  for (const sample of samples.length ? samples : hardware ? [hardware] : []) {
    observeSqueeze(sample);
  }
  const connected = Boolean(hardware);
  const label = connected ? "Sensor connected" : "Waiting for sensor";
  if (sensorConnection.textContent !== label) sensorConnection.textContent = label;
  sensorConnection.dataset.connected = connected;
  sensorReading.hidden = !connected;
  if (connected) {
    hasSensX25 = hardware.thumb_sensor === "sensx25";
    const contact = hardware.zone ? zones[hardware.zone - 1].textContent.trim() : "No pinch";
    sensorReading.textContent = `Thumb pressure ${hardware.fsr} / ${contact}`;
  }
}

async function readHardware() {
  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (response.ok) {
      const { last_tap: tap, hardware_taps: taps, hardware, hardware_samples: samples } = await response.json();
      showHardwareStatus(hardware, samples);
      // Ignore a tap left over from before this page opened.
      if (!hardwareStateSeen) {
        hardwareStateSeen = true;
        lastTapId = tap?.id ?? 0;
      }
      if (!tap || tap.id < lastTapId) lastTapId = 0;
      const pendingTaps = taps ?? (tap?.source === "hardware" ? [tap] : []);
      for (const pendingTap of pendingTaps) {
        if (pendingTap.id > lastTapId) handleTap(pendingTap.zone, pendingTap.age_ms, pendingTap.centered);
      }
      lastTapId = tap?.id ?? 0;
    } else {
      showHardwareStatus(null);
    }
  } catch {
    showHardwareStatus(null);
  } finally {
    if (!game.hidden && (activeZone || !tutorial.hidden) && performance.now() - cueSentAt >= 500) {
      publishCue();
    }
    setTimeout(readHardware, rounds.length || !tutorial.hidden ? 25 : 65);
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

function freshSqueezeSample() {
  const age = latestHardware?.age_ms + performance.now() - hardwareReceivedAt;
  return age >= 0 && age <= 850 ? latestHardware : null;
}

function observeSqueeze(sample) {
  const capture = squeezeCapture;
  if (!capture || (sample.id !== undefined && sample.id <= capture.lastSampleId)) return;
  capture.lastSampleId = sample.id ?? capture.lastSampleId;
  const sampledAt = hardwareReceivedAt - sample.age_ms;
  if (sampledAt < capture.armedAt) return;

  if (capture.endsAt === null) {
    if (!sample.zone && sample.fsr - capture.baseline < squeezeRise) return;
    clearTimeout(capture.timeout);
    capture.endsAt = sampledAt + squeezeWindowMs;
    // Allow the next poll to deliver samples recorded just before the window closed.
    const delay = Math.max(0, capture.endsAt + 200 - performance.now());
    capture.timeout = setTimeout(finishSqueeze, delay);
  }
  if (sampledAt > capture.endsAt) {
    clearTimeout(capture.timeout);
    finishSqueeze();
    return;
  }

  const counts = sample.pressure_counts ?? null;
  const average = counts
    ? (counts.reduce((sum, count) => sum + count, 0) - Math.min(...counts)) / 3
    : null;
  const best = capture.best;
  const hasFingerAverage = best?.fingerPressureAverage != null;
  if (best && (average !== null
    ? hasFingerAverage && average <= best.fingerPressureAverage
    : hasFingerAverage || sample.fsr <= best.thumbPressure)) return;

  capture.best = {
    thumbPressure: sample.fsr,
    fingerPressureCounts: counts,
    fingerPressureAverage: average,
  };
  squeezeStatus.textContent = `Measuring… Peak so far: ${formatStrength.format(average ?? sample.fsr)} counts.`;
}

function finishSqueeze() {
  const reading = squeezeCapture.best;
  squeezeCapture = undefined;
  measureSqueeze.disabled = false;
  continueSqueeze.disabled = false;
  setMenusDisabled(false);

  if (!reading) {
    squeezeStatus.textContent = freshSqueezeSample()
      ? "No pinch detected. Touch your fingers to your thumb and try again."
      : "Lost the sensor signal. Check the connection and try again.";
    measureSqueeze.focus();
    return;
  }

  const measurement = { ...reading, hand: selectedHand, measuredAt: new Date().toISOString() };
  try {
    localStorage.setItem(strengthKey + selectedHand, JSON.stringify(measurement));
  } catch {
    squeezeStatus.textContent = "This browser could not save the reading. Try again or skip.";
    measureSqueeze.focus();
    return;
  }
  const average = measurement.fingerPressureAverage;
  squeezeStatus.textContent = average === null
    ? `Peak thumb reading saved: ${measurement.thumbPressure} counts.`
    : `Peak finger pressure average saved: ${average.toFixed(1)} counts.`;
  measureSqueeze.hidden = true;
  continueSqueeze.textContent = "Continue";
  continueSqueeze.focus();
}

measureSqueeze.addEventListener("click", () => {
  const sample = freshSqueezeSample();
  if (!sample) {
    squeezeStatus.textContent = "Waiting for the glove. Connect it before starting the squeeze.";
    return;
  }
  if (sample.zone) {
    squeezeStatus.textContent = "Release your grip, then click Begin squeeze again.";
    return;
  }
  measureSqueeze.disabled = true;
  continueSqueeze.disabled = true;
  setMenusDisabled(true);
  squeezeStatus.textContent = "Squeeze when ready";
  squeezeCapture = {
    armedAt: performance.now(),
    baseline: sample.fsr,
    lastSampleId: sample.id ?? 0,
    endsAt: null,
    best: null,
    timeout: setTimeout(finishSqueeze, 5000),
  };
});
stopButton.addEventListener("click", () => {
  stopRequested = true;
  // While steps load there is no update loop to notice the request, so stop now.
  if (loadingSong) finishGame(true);
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
function songItem(song) {
  const item = document.createElement("li");
  const details = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = song ? song.title : "Warm-Up";
  details.append(title);
  // Only added songs show an artist and whether their steps are ready.
  if (song && !song.starter) {
    const meta = document.createElement("span");
    const ready = song.charted?.includes(currentDifficulty());
    meta.textContent = [song.artist, ready ? "Steps ready" : "Steps made on first play"].filter(Boolean).join(" · ");
    details.append(meta);
  }
  const play = document.createElement("button");
  play.type = "button";
  const selected = (selectedSong?.id ?? null) === (song?.id ?? null);
  play.textContent = selected ? "Selected" : "Play this song";
  play.setAttribute("aria-pressed", selected);
  play.addEventListener("click", () => chooseSong(song, play));
  item.append(details, play);
  return item;
}

function emptySlot(number) {
  const item = document.createElement("li");
  item.className = "empty-slot";
  item.textContent = `Starter slot ${number}: add an MP3 to the songs folder`;
  return item;
}

async function refreshSongs() {
  let library = [];
  try {
    const response = await fetch("/api/songs", { cache: "no-store" });
    if (!response.ok) throw new Error();
    library = (await response.json()).songs;
  } catch {
    songStatus.textContent = "Could not load the song list. Is the game server running?";
  }
  const starters = library.filter(song => song.starter);
  const uploads = library.filter(song => !song.starter);
  starterSongs.replaceChildren(songItem(null), ...starters.map(songItem));
  for (let slot = starters.length + 1; slot <= starterSlots; slot++) starterSongs.append(emptySlot(slot));
  uploadedSongs.replaceChildren(...uploads.map(songItem));
  if (!uploads.length) {
    const none = document.createElement("li");
    none.className = "empty-slot";
    none.textContent = "No songs added yet";
    uploadedSongs.append(none);
  }
  return library;
}

function showSelectedSong() {
  selectedSongLabel.textContent = `Song: ${selectedSong ? selectedSong.title : "Warm-Up"}`;
  loadBest();
}

async function chooseSong(song, button) {
  if (!song) {
    selectedSong = null;
    showSelectedSong();
    closeSongs();
    return;
  }
  const difficulty = currentDifficulty();
  songLibrary.querySelectorAll("button").forEach(control => { control.disabled = true; });
  songStatus.textContent = `Making ${difficulty} finger steps for ${song.title}. A new song can take a minute or two…`;
  try {
    await prepareSong(song, difficulty);
    selectedSong = song;
    showSelectedSong();
    closeSongs();
    cue.textContent = `${song.title} is ready. Press Start game.`;
  } catch (error) {
    songStatus.textContent = error.message;
    button.focus();
  } finally {
    songLibrary.querySelectorAll("button").forEach(control => { control.disabled = false; });
    refreshSongs();
  }
}

function closeSongs() {
  songLibrary.hidden = true;
  game.hidden = false;
  openSongs.focus();
}

openSongs.addEventListener("click", () => {
  game.hidden = true;
  strengthRecord.hidden = true;
  songLibrary.hidden = false;
  songStatus.textContent = "";
  refreshSongs();
  document.getElementById("songs-title").focus();
});
songsReturn.addEventListener("click", closeSongs);

uploadForm.addEventListener("submit", async event => {
  event.preventDefault();
  const file = uploadForm.elements.file.files[0];
  if (!file) return;
  uploadButton.disabled = true;
  songStatus.textContent = `Uploading ${file.name}…`;
  try {
    const query = new URLSearchParams({
      filename: file.name,
      title: uploadForm.elements.title.value,
      artist: uploadForm.elements.artist.value,
    });
    const response = await fetch(`/api/songs?${query}`, { method: "POST", body: file });
    const song = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(song.error ?? "Upload failed");
    uploadForm.reset();
    await refreshSongs();
    const button = [...uploadedSongs.querySelectorAll("button")][0];
    await chooseSong(song, button);
  } catch (error) {
    songStatus.textContent = error.message;
  } finally {
    uploadButton.disabled = false;
  }
});

readHardware();
