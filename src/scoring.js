// Standard ten-pin bowling scoring (USBC rules). Ported 1:1 from scoring.py.
export class BowlingGame {
  constructor() { this.rolls = []; }
  static get NUM_FRAMES() { return 10; }
  static get MAX_PINS() { return 10; }

  reset() { this.rolls = []; }

  recordRoll(pins) {
    if (typeof pins === 'boolean' || !Number.isInteger(pins)) {
      throw new TypeError(`pins must be an int, got ${typeof pins}`);
    }
    if (this.is_complete) throw new ValueError("cannot record a roll: game is already complete");
    if (!(pins >= 0 && pins <= BowlingGame.MAX_PINS)) {
      throw new ValueError(`pins must be between 0 and ${BowlingGame.MAX_PINS}, got ${pins}`);
    }
    const standing = this.standingPins();
    if (standing === null) throw new ValueError("cannot record a roll: no pins are standing");
    if (pins > standing) {
      throw new ValueError(`cannot knock down ${pins} pin(s): only ${standing} standing`);
    }
    this.rolls.push(pins);
  }

  _frameBounds() {
    const bounds = [];
    let i = 0;
    for (let frame = 0; frame < BowlingGame.NUM_FRAMES; frame++) {
      if (frame === BowlingGame.NUM_FRAMES - 1) {
        bounds.push([i, this.rolls.length]);
        break;
      }
      if (i >= this.rolls.length) { bounds.push([i, i]); continue; }
      const first = this.rolls[i];
      if (first === BowlingGame.MAX_PINS) { bounds.push([i, i + 1]); i += 1; }
      else { const end = Math.min(i + 2, this.rolls.length); bounds.push([i, end]); i = end; }
    }
    return bounds;
  }

  frameRolls(frameNumber) {
    const [start, end] = this._frameBounds()[frameNumber - 1];
    return this.rolls.slice(start, end);
  }

  _isFrameComplete(index, rolls) {
    if (index < BowlingGame.NUM_FRAMES - 1) {
      if (!rolls.length) return false;
      if (rolls[0] === BowlingGame.MAX_PINS) return true;
      return rolls.length >= 2;
    }
    if (!rolls.length) return false;
    if (rolls[0] === BowlingGame.MAX_PINS) return rolls.length >= 3;
    if (rolls.length >= 2 && rolls[0] + rolls[1] === BowlingGame.MAX_PINS) return rolls.length >= 3;
    return rolls.length >= 2;
  }

  get is_complete() {
    const frames = Array.from({ length: BowlingGame.NUM_FRAMES },
      (_, f) => this.frameRolls(f + 1));
    return this._isFrameComplete(BowlingGame.NUM_FRAMES - 1, frames[BowlingGame.NUM_FRAMES - 1]);
  }

  get current_frame_number() {
    for (let frame = 1; frame <= BowlingGame.NUM_FRAMES; frame++) {
      const rolls = this.frameRolls(frame);
      if (!this._isFrameComplete(frame - 1, rolls)) return frame;
    }
    return BowlingGame.NUM_FRAMES;
  }

  get roll_in_frame() {
    if (this.is_complete) return null;
    return this.frameRolls(this.current_frame_number).length;
  }

  standingPins() {
    if (this.is_complete) return null;
    const current = this.current_frame_number;
    const rolls = this.frameRolls(current);
    if (current < BowlingGame.NUM_FRAMES) {
      if (!rolls.length) return BowlingGame.MAX_PINS;
      return BowlingGame.MAX_PINS - rolls[0];
    }
    if (!rolls.length) return BowlingGame.MAX_PINS;
    if (rolls[0] === BowlingGame.MAX_PINS) {
      if (rolls.length === 1) return BowlingGame.MAX_PINS;
      if (rolls[1] === BowlingGame.MAX_PINS) return BowlingGame.MAX_PINS;
      return BowlingGame.MAX_PINS - rolls[1];
    }
    if (rolls.length === 1) return BowlingGame.MAX_PINS - rolls[0];
    if (rolls[0] + rolls[1] === BowlingGame.MAX_PINS) return BowlingGame.MAX_PINS;
    return null;
  }

  frameMarks(frameNumber) {
    const rolls = this.frameRolls(frameNumber);
    if (frameNumber < BowlingGame.NUM_FRAMES) return regularMarks(rolls, BowlingGame.MAX_PINS);
    return finalMarks(rolls, BowlingGame.MAX_PINS);
  }

  frameScore(frameNumber) {
    const bounds = this._frameBounds();
    const [start, end] = bounds[frameNumber - 1];
    const rolls = this.rolls.slice(start, end);
    if (!rolls.length) return null;
    if (frameNumber < BowlingGame.NUM_FRAMES) {
      if (rolls[0] === BowlingGame.MAX_PINS) {
        const bonus = this.rolls.slice(end, end + 2);
        if (bonus.length < 2) return null;
        return BowlingGame.MAX_PINS + bonus.reduce((a, b) => a + b, 0);
      }
      if (rolls.length < 2) return null;
      if (rolls[0] + rolls[1] === BowlingGame.MAX_PINS) {
        if (end >= this.rolls.length) return null;
        return BowlingGame.MAX_PINS + this.rolls[end];
      }
      return rolls[0] + rolls[1];
    }
    if (!this._isFrameComplete(BowlingGame.NUM_FRAMES - 1, rolls)) return null;
    return rolls.reduce((a, b) => a + b, 0);
  }

  cumulativeScores() {
    const result = [];
    let running = 0;
    for (let frame = 1; frame <= BowlingGame.NUM_FRAMES; frame++) {
      const score = this.frameScore(frame);
      if (score === null) result.push(null);
      else { running += score; result.push(running); }
    }
    return result;
  }

  get current_score() {
    const scores = this.cumulativeScores();
    for (let i = scores.length - 1; i >= 0; i--) if (scores[i] !== null) return scores[i];
    return 0;
  }

  get total_score() {
    if (!this.is_complete) return null;
    return this.cumulativeScores()[this.cumulativeScores().length - 1];
  }

  // snake_case aliases kept so the ported call sites read like the original.
  standing_pins() { return this.standingPins(); }
  frame_rolls(frameNumber) { return this.frameRolls(frameNumber); }
  cumulative_scores() { return this.cumulativeScores(); }
  frame_marks(frameNumber) { return this.frameMarks(frameNumber); }
  frame_score(frameNumber) { return this.frameScore(frameNumber); }
}

function regularMarks(rolls, maxPins) {
  const marks = [];
  rolls.forEach((pins, i) => {
    if (i === 0 && pins === maxPins) marks.push("X");
    else if (i === 1 && rolls[0] + pins === maxPins) marks.push("/");
    else marks.push(String(pins));
  });
  return marks;
}

function finalMarks(rolls, maxPins) {
  const marks = [];
  let freshRack = true;
  rolls.forEach((pins, i) => {
    if (pins === maxPins && freshRack) { marks.push("X"); freshRack = true; }
    else if (i > 0 && !freshRack && rolls[i - 1] + pins === maxPins) { marks.push("/"); freshRack = true; }
    else { marks.push(String(pins)); freshRack = false; }
  });
  return marks;
}

// A minimal error type to mirror Python's ValueError messages.
export class ValueError extends Error {
  constructor(message) { super(message); this.name = 'ValueError'; }
}
