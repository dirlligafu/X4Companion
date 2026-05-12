// X4 stores relations as floats [-1, 1]. In-game display is [-30, +30].
// Lookup table built from in-game measurements (bac-à-sable session 2026-04-09).
// Index = absolute rank (0..30). Values are symmetric for negative ranks.
const REP_LOOKUP: number[] = [
  0,          // rank 0 — absent from XML
  0.00064,    // rank 1
  0.00128,    // rank 2
  0.00192,    // rank 3
  0.00256,    // rank 4
  0.0032,     // rank 5
  0.0041065,  // rank 6
  0.00515549, // rank 7
  0.00647609, // rank 8
  0.00813863, // rank 9
  0.01,       // rank 10
  0.0129328,  // rank 11
  0.0163266,  // rank 12
  0.0205991,  // rank 13
  0.0259779,  // rank 14
  0.032,      // rank 15
  0.041065,   // rank 16
  0.0515549,  // rank 17
  0.0647609,  // rank 18
  0.0813863,  // rank 19
  0.1,        // rank 20
  0.129328,   // rank 21
  0.163266,   // rank 22
  0.205991,   // rank 23
  0.259779,   // rank 24
  0.32,       // rank 25
  0.408708,   // rank 26
  0.5,        // rank 27
  0.644811,   // rank 28
  0.812385,   // rank 29
  1.0,        // rank 30
];

/** XML float → in-game rank [-30..+30].
 *  Uses floor semantics: highest rank r such that REP_LOOKUP[r] <= absVal.
 *  This correctly handles trigger values like 0.00999 (→ +9) and 0.098 (→ +19)
 *  which are intentionally just below the +10 and +20 thresholds.
 */
export function repRank(combinedRelation: number): number {
  if (combinedRelation === 0) return 0;
  const sign = combinedRelation > 0 ? 1 : -1;
  const absVal = Math.min(1, Math.abs(combinedRelation));
  let rank = 0;
  for (let r = 1; r <= 30; r++) {
    if (REP_LOOKUP[r] <= absVal) rank = r;
    else break;
  }
  return sign * rank;
}

/** In-game rank [-30..+30] → XML float. */
export function rankToValue(rank: number): number {
  if (rank === 0) return 0;
  const sign = rank > 0 ? 1 : -1;
  return sign * REP_LOOKUP[Math.min(30, Math.max(0, Math.abs(rank)))];
}

/**
 * Maximum editable rank given the current (original) rank.
 * Enforces progressive unlock: player must trigger each ceremony in-game.
 *   < +10 → cap at +9  (triggers Friend ceremony on next action)
 *   < +20 → cap at +19 (triggers Ally ceremony on next action)
 *   ≥ +20 → full range up to +30
 */
export function maxEditableRank(currentRank: number): number {
  if (currentRank < 10) return 9;
  if (currentRank < 20) return 19;
  return 30;
}

/**
 * XML float to write for a given target rank.
 * When the target is the ceremony threshold cap, uses a "just below" value
 * so the game fires the ceremony naturally on the next player action.
 */
export function rankToWriteValue(targetRank: number, originalRank: number): number {
  const cap = maxEditableRank(originalRank);
  if (targetRank === 9  && cap === 9)  return 0.00999; // just below Friend (+10 = 0.01)
  if (targetRank === 19 && cap === 19) return 0.098;   // just below Ally  (+20 = 0.1)
  return rankToValue(targetRank);
}

// Confirmed thresholds from in-game labels (bac-à-sable measurements):
//   Hostile ≤ -25 | Enemy -24..-10 | Neutral -9..+10 | Friend +11..+19 | Ally ≥ +20
export function repBadge(rank: number): { label: string; className: string } {
  if (rank <= -25)
    return {
      label: `Hostile (${rank})`,
      className:
        "bg-red-100 text-red-900 border-red-300/90 dark:bg-red-900/40 dark:text-red-300 dark:border-red-800",
    };
  if (rank <= -10)
    return {
      label: `Enemy (${rank})`,
      className:
        "bg-orange-100 text-orange-900 border-orange-300/90 dark:bg-orange-900/40 dark:text-orange-300 dark:border-orange-800",
    };
  if (rank <= 10)
    return {
      label: `Neutral (${rank})`,
      className: "bg-muted text-muted-foreground border-border",
    };
  if (rank <= 19)
    return {
      label: `Friend (${rank})`,
      className:
        "bg-blue-100 text-blue-900 border-blue-300/90 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-800",
    };
  return {
    label: `Ally (${rank})`,
    className:
      "bg-green-100 text-green-900 border-green-300/90 dark:bg-green-900/40 dark:text-green-300 dark:border-green-800",
  };
}
