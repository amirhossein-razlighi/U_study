// Ranking rules for one scene.
//
// `picks` is the list of manual taps, oldest first: [{ id, rank }]. There is always one fewer
// pick than there are outputs, because the remaining output is implied as the last rank.
(function (root) {
  'use strict';

  function nextRank(picks) {
    let rank = 1;
    while (picks.some((p) => p.rank === rank)) rank += 1;
    return rank;
  }

  function isComplete(picks, outputCount) {
    return picks.length >= outputCount - 1;
  }

  // A tap on a manually ranked output clears only that output, so other ranks never shift.
  // A tap on the auto-filled last output undoes the tap that caused the auto-fill; clearing
  // just the last output would immediately fill it again.
  function tap(picks, id, outputCount) {
    if (picks.some((p) => p.id === id)) return picks.filter((p) => p.id !== id);
    if (isComplete(picks, outputCount)) return picks.slice(0, -1);
    return [...picks, { id, rank: nextRank(picks) }];
  }

  function ranks(picks, ids) {
    const result = {};
    for (const p of picks) result[p.id] = { rank: p.rank, auto: false };
    if (isComplete(picks, ids.length)) {
      const remaining = ids.find((id) => !result[id]);
      if (remaining !== undefined) result[remaining] = { rank: ids.length, auto: true };
    }
    return result;
  }

  const api = { tap, ranks, nextRank, isComplete };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Ranking = api;
})(this);
