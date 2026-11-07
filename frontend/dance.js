const zones = [...document.querySelectorAll(".zone")];
const hands = [...document.querySelectorAll(".hand")];
const startButton = document.getElementById("start");
const roundLabel = document.getElementById("round-label");
const roundScore = document.getElementById("round-score");
const bestScore = document.getElementById("best-score");
const cue = document.getElementById("cue");
const feedback = document.getElementById("feedback");
const mascot = document.querySelector(".mascot");
const defaultMascot = mascot.getAttribute("src");

const directions = ["Left", "Down", "Up", "Right"];
const arrowKeys = ["ArrowLeft", "ArrowDown", "ArrowUp", "ArrowRight"];
const tracks = [
  { name: "Slow song", beatLength: 0.72, beats: 12, pitches: [261.63, 329.63, 392, 440] },
  { name: "Fast song", beatLength: 0.4, beats: 16, pitches: [392, 493.88, 587.33, 659.25] },
];
const maxScore = tracks.reduce((sum, track) => sum + track.beats, 0);
const bestKey = "finger-dance-two-round-best";

let audio;
let activeRound;
let activeZone = 0;
let activeBeat = -1;
let lastTapId = 0;
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
  post("/api/cue", { zone: zone || null });
}

function showFeedback(message, wrongTap = false) {
  feedback.textContent = message;
  let image = defaultMascot;
  if (wrongStreak >= 4) image = "assets/octopus-wrong-streak.png";
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

function scheduleTrack(track, start) {
  const pattern = makePattern(track.beats);
  pattern.forEach((zone, index) => {
    const time = start + index * track.beatLength;
    const duration = track.beatLength * 0.68;
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
  return { ...track, pattern, start, end: start + track.beats * track.beatLength };
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
  startButton.textContent = "Play again";
  startButton.hidden = false;
  startButton.disabled = false;
  if (zones.includes(document.activeElement)) startButton.focus();
}

async function startGame() {
  if (startButton.disabled) return;
  startButton.disabled = true;
  try {
    audio ??= new AudioContext();
    await audio.resume();
    const slow = scheduleTrack(tracks[0], audio.currentTime + 1);
    const fast = scheduleTrack(tracks[1], slow.end + 2);

    score = 0;
    wrongStreak = 0;
    roundScore.textContent = score;
    roundLabel.textContent = slow.name;
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
      requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
  } catch {
    cue.textContent = "Audio could not start";
    startButton.textContent = "Try again";
    startButton.disabled = false;
  }
}

function sendTap(zone) {
  scoreTap(zone);
  post("/api/tap", { zone, source: "browser" });
}

async function readHardware() {
  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (response.ok) {
      const { last_tap: tap } = await response.json();
      if (!tap || tap.id < lastTapId) lastTapId = 0;
      if (tap && tap.id > lastTapId) {
        lastTapId = tap.id;
        if (tap.source === "hardware") scoreTap(tap.zone);
      }
    }
  } catch {
    // Retry on the next poll if the backend is restarting.
  } finally {
    setTimeout(readHardware, 65);
  }
}

startButton.addEventListener("click", startGame);
zones.forEach(button => button.addEventListener("click", () => sendTap(Number(button.dataset.zone))));
window.addEventListener("keydown", event => {
  const arrow = arrowKeys.indexOf(event.key);
  if (arrow >= 0) {
    if (startButton.disabled) event.preventDefault();
    if (!event.repeat && startButton.disabled) sendTap(arrow + 1);
  } else if (!event.repeat && /^[1-4]$/.test(event.key) && startButton.disabled) {
    sendTap(Number(event.key));
  }
});
readHardware();
