// Ranking rules for one scene with three outputs.
//
// `picks` is the list of manual taps, oldest first: [{ id, rank }]. There are at most two,
// because the remaining output is always implied as rank 3.
(function (root) {
  'use strict';

  const MANUAL_SLOTS = 2;

  function nextRank(picks) {
    return picks.some((p) => p.rank === 1) ? 2 : 1;
  }

  // A tap on a manually ranked output clears only that output, so other ranks never shift.
  // A tap on the auto-filled third output undoes the tap that caused the auto-fill; clearing
  // just the third would immediately fill it again.
  function tap(picks, id) {
    if (picks.some((p) => p.id === id)) return picks.filter((p) => p.id !== id);
    if (picks.length >= MANUAL_SLOTS) return picks.slice(0, -1);
    return [...picks, { id, rank: nextRank(picks) }];
  }

  function ranks(picks, ids) {
    const result = {};
    for (const p of picks) result[p.id] = { rank: p.rank, auto: false };
    if (picks.length >= MANUAL_SLOTS) {
      const remaining = ids.find((id) => !result[id]);
      if (remaining !== undefined) result[remaining] = { rank: 3, auto: true };
    }
    return result;
  }

  function isComplete(picks) {
    return picks.length >= MANUAL_SLOTS;
  }

  const api = { tap, ranks, nextRank, isComplete };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Ranking = api;
})(this);
