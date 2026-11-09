// Adaptive coach. Learns from each play, separately for each hand, and saves it in
// this browser.
//  - Difficulty: a rolling hit rate quietly steps the level down when the player
//    struggles and up when they are doing well, during a song and between plays.
//  - Fingers: after a play, a finger that clearly lags the others (or is suddenly
//    much slower than usual) is flagged so the game can ask the player whether to
//    practice it more or give it a break. The choice tilts the choreography toward
//    or away from that finger until it improves, for a limited number of plays.

const LEVELS = ["Beginner", "Easy", "Medium", "Hard", "Challenge"];
const FINGER_NAMES = ["index", "middle", "ring", "little"];

const coachTuning = {
  // Finger focus
  practiceWeight: 1.6, // "Practice more": about 35% of steps instead of 25%
  breakWeight: 0.35,   // "Take a break": about 10% of steps, enough to see it recover
  minFingerNotes: 4,   // notes on a finger before one play says anything about it
  struggleBelow: 0.75, // a finger hitting less than this...
  struggleGap: 0.2,    // ...and this far below the other fingers is struggling
  slowFactor: 1.6,     // or reacting this many times slower than its usual...
  slowMargin: 0.15,    // ...and at least this many seconds slower
  improvedAt: 0.8,     // a focused finger hitting this well (and near the others) has improved
  improvedGap: 0.1,
  practiceMaxPlays: 5, // practice ends after this many plays even without improvement
  breakMinPlays: 2,    // a break lasts at least this many plays...
  breakMaxPlays: 4,    // ...and at most this many
  // Difficulty
  window: 10,          // recent notes used for the live hit rate
  cooldown: 8,         // notes after a change before the next easier step
  greatCount: 12,      // notes after a change before the next harder step
  struggle: 0.5,       // live hit rate below this makes things easier
  great: 0.9,          // live hit rate at or above this makes things harder
  levelUp: 0.9,        // end-of-play hit rate that starts the next play one level up
  levelDown: 0.55,     // end-of-play hit rate that starts the next play one level down
};

const coachKey = "finger-dance-coach-v2-";

function freshCoach() {
  return {
    level: 2,
    fingers: FINGER_NAMES.map(() => ({ accuracy: null, reaction: null })),
    // { finger: 0-3, mode: "practice" | "break", plays: n } while the player has chosen one.
    focus: null,
  };
}

function loadCoach(hand) {
  const profile = freshCoach();
  try {
    const saved = JSON.parse(localStorage.getItem(coachKey + hand) ?? "null");
    if (saved && typeof saved === "object") {
      if (Number.isInteger(saved.level) && saved.level >= 0 && saved.level < LEVELS.length) profile.level = saved.level;
      saved.fingers?.slice(0, 4).forEach((finger, index) => {
        if (Number.isFinite(finger?.accuracy)) profile.fingers[index].accuracy = finger.accuracy;
        if (Number.isFinite(finger?.reaction)) profile.fingers[index].reaction = finger.reaction;
      });
      const focus = saved.focus;
      if (focus && Number.isInteger(focus.finger) && focus.finger >= 0 && focus.finger < 4
        && (focus.mode === "practice" || focus.mode === "break") && Number.isInteger(focus.plays)) {
        profile.focus = { finger: focus.finger, mode: focus.mode, plays: focus.plays };
      }
    }
  } catch {
    // Without storage the coach still adapts within the current page.
  }
  return profile;
}

function saveCoach(hand, profile) {
  try {
    localStorage.setItem(coachKey + hand, JSON.stringify(profile));
  } catch {
    // The profile still lives for this page.
  }
}

// The player's answer to "struggling with this finger?".
function chooseFocus(profile, finger, mode) {
  profile.focus = { finger, mode, plays: 0 };
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((first, second) => first - second);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

class CoachSession {
  // canUseLevel(level) says whether steps for that level are ready to switch to mid-play.
  constructor(profile, level, canUseLevel) {
    this.profile = profile;
    this.level = level;
    this.startLevel = level;
    this.canUseLevel = canUseLevel;
    this.outcomes = [];
    this.sinceChange = [];
    this.ease = 0;
    this.easeCounter = 0;
  }

  // How much each finger should be cued this play, relative to the chart's own mix.
  weights() {
    const weights = [1, 1, 1, 1];
    const focus = this.profile.focus;
    if (focus) weights[focus.finger] = focus.mode === "practice" ? coachTuning.practiceWeight : coachTuning.breakWeight;
    return weights;
  }

  // Reassign a chart note so the finger mix matches the chart's mix tilted by the
  // weights. Notes keep their finger whenever possible, so the choreography only
  // changes as much as the weights ask for.
  pickZone(zone, chartShares, previousZone) {
    const weights = this.weights();
    const smoothed = chartShares.map(share => Math.max(share, 0.05));
    const chartTotal = smoothed.reduce((sum, share) => sum + share, 0);
    const chart = smoothed.map(share => share / chartTotal);
    const tilted = chart.map((share, index) => share * weights[index]);
    const tiltedTotal = tilted.reduce((sum, share) => sum + share, 0);
    const target = tilted.map(share => share / tiltedTotal);
    const original = zone - 1;
    if (Math.random() < Math.min(1, target[original] / chart[original])) return zone;
    // Move it to a finger that needs more steps, but never onto the finger just
    // cued: two cues in a row on one finger look like a single long cue.
    const pool = target.map((share, index) => (index !== previousZone - 1 ? Math.max(0, share - chart[index]) : 0));
    const total = pool.reduce((sum, share) => sum + share, 0);
    if (!total) return zone;
    let pick = Math.random() * total;
    for (let index = 0; index < pool.length; index++) {
      pick -= pool[index];
      if (pick <= 0 && pool[index] > 0) return index + 1;
    }
    return zone;
  }

  // The player picked a new speed while paused: judge from there, without easing.
  setLevel(level) {
    this.level = level;
    this.startLevel = level;
    this.ease = 0;
    this.sinceChange = [];
  }

  // While eased, skip every third (or every second) note. Never two in a row.
  shouldDrop() {
    if (!this.ease) return false;
    this.easeCounter += 1;
    return this.easeCounter % (this.ease === 1 ? 3 : 2) === 0;
  }

  // Record one note's result and quietly adjust the difficulty.
  record(zone, hit, reaction = null) {
    this.outcomes.push({ zone, hit, reaction });
    this.sinceChange.push(hit);
    const rate = mean(this.sinceChange.slice(-coachTuning.window));
    if (this.sinceChange.length >= coachTuning.cooldown && rate < coachTuning.struggle) this.easier();
    else if (this.sinceChange.length >= coachTuning.greatCount && rate >= coachTuning.great) this.harder();
  }

  easier() {
    if (this.ease === 0 && this.level > 0 && this.canUseLevel(this.level - 1)) this.level -= 1;
    else if (this.ease < 2) this.ease += 1;
    else return;
    this.sinceChange = [];
  }

  harder() {
    if (this.ease > 0) this.ease -= 1;
    else if (this.level < LEVELS.length - 1 && this.canUseLevel(this.level + 1)) this.level += 1;
    else return;
    this.sinceChange = [];
  }

  // Fold this play into the saved profile. Returns the index of a finger worth
  // asking about, or null.
  finish() {
    const profile = this.profile;
    if (this.outcomes.length < 8) return null;

    const session = FINGER_NAMES.map((_, index) => {
      const mine = this.outcomes.filter(outcome => outcome.zone === index + 1);
      const hits = mine.filter(outcome => outcome.hit);
      return {
        count: mine.length,
        accuracy: mine.length ? hits.length / mine.length : null,
        reaction: median(hits.map(outcome => outcome.reaction)),
      };
    });
    const othersAccuracy = index => mean(session
      .filter((other, otherIndex) => otherIndex !== index && other.count >= coachTuning.minFingerNotes)
      .map(other => other.accuracy));
    const reallySlow = index => {
      const usual = profile.fingers[index].reaction
        ?? median(this.outcomes.filter(outcome => outcome.hit && outcome.zone !== index + 1).map(outcome => outcome.reaction));
      const reaction = session[index].reaction;
      return usual != null && reaction != null
        && reaction > Math.max(usual * coachTuning.slowFactor, usual + coachTuning.slowMargin);
    };

    // Find the finger that is struggling most, before folding in today's numbers.
    let struggling = null;
    let worstGap = 0;
    session.forEach((stats, index) => {
      if (stats.count < coachTuning.minFingerNotes) return;
      const gap = (othersAccuracy(index) ?? stats.accuracy) - stats.accuracy;
      const lagging = stats.accuracy < coachTuning.struggleBelow && gap >= coachTuning.struggleGap;
      if ((lagging || reallySlow(index)) && (struggling === null || gap > worstGap)) {
        struggling = index;
        worstGap = gap;
      }
    });

    // A practice or break lasts until the finger improves, and never forever.
    const focus = profile.focus;
    if (focus) {
      focus.plays += 1;
      const stats = session[focus.finger];
      const enough = stats.count >= (focus.mode === "break" ? 2 : coachTuning.minFingerNotes);
      const improved = enough && stats.accuracy >= coachTuning.improvedAt
        && stats.accuracy >= (othersAccuracy(focus.finger) ?? 0) - coachTuning.improvedGap
        && !reallySlow(focus.finger);
      const done = focus.mode === "practice"
        ? improved || focus.plays >= coachTuning.practiceMaxPlays
        : (improved && focus.plays >= coachTuning.breakMinPlays) || focus.plays >= coachTuning.breakMaxPlays;
      if (done) profile.focus = null;
    }

    session.forEach((stats, index) => {
      if (stats.count < coachTuning.minFingerNotes) return;
      const finger = profile.fingers[index];
      finger.accuracy = finger.accuracy == null ? stats.accuracy : 0.7 * finger.accuracy + 0.3 * stats.accuracy;
      // A sore day should not become the finger's usual reaction time.
      if (stats.reaction != null && !reallySlow(index)) {
        finger.reaction = finger.reaction == null ? stats.reaction : 0.7 * finger.reaction + 0.3 * stats.reaction;
      }
    });

    let level = this.level;
    const rate = mean(this.sinceChange);
    if (this.sinceChange.length >= coachTuning.cooldown) {
      if (rate >= coachTuning.levelUp && this.ease === 0) level = Math.min(LEVELS.length - 1, level + 1);
      else if (rate < coachTuning.levelDown || this.ease > 0) level = Math.max(0, level - 1);
    }
    profile.level = level;

    // Only ask while no practice or break is under way.
    return profile.focus ? null : struggling;
  }
}
