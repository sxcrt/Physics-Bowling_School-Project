// Pure presentation model for the scorecards.
//
// Both the compact bar card and the full RIGHT-SHIFT card render from this
// module, and it derives everything from the game's own BowlingGame (frameMarks,
// cumulativeScores, current_frame_number) - so a displayed mark or total can
// never disagree with the scoring engine. It contains no DOM, which is what lets
// the mapping be unit-tested directly against the scoring rules.
export const MISS_MARK = '-';

// A printed card writes a miss as "-"; the engine stores it as a 0.
export function normaliseMark(mark) {
  return mark === '0' ? MISS_MARK : mark;
}

// The roll boxes a frame shows: two for frames 1-9, three for the tenth.
export function boxCountFor(frame) { return frame === 10 ? 3 : 2; }

// The marks to print in each roll box of a frame ("" for a box not yet bowled).
export function frameBoxes(score, frame) {
  const marks = score.frameMarks(frame).map(normaliseMark);
  const boxes = [];
  for (let i = 0; i < boxCountFor(frame); i++) boxes.push(marks[i] !== undefined ? marks[i] : '');
  return boxes;
}

export function isBonusMark(mark) { return mark === 'X' || mark === '/'; }

// Everything a card needs for one player's game.
export function cardModel(score) {
  const boxes = [];
  for (let frame = 1; frame <= 10; frame++) boxes.push(frameBoxes(score, frame));
  return {
    boxes,
    totals: score.cumulativeScores(),
    currentFrame: score.is_complete ? null : score.current_frame_number,
    official: score.current_score,
    final: score.total_score,
    complete: score.is_complete,
  };
}
