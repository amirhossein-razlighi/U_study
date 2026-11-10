// Turns raw study responses into the numbers shown on the admin panel.
//
// Participants are the unit for confidence intervals and significance tests, because the
// scene-level judgments of one person are not independent of each other.
(function (root) {
  'use strict';

  const T_95 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228];
  const LOW_ENGAGEMENT_SHARE = 0.5;

  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  const mean = (xs) => (xs.length ? sum(xs) / xs.length : null);

  function median(xs) {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  function sd(xs) {
    const m = mean(xs);
    return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1));
  }

  function tCritical(df) {
    if (df <= T_95.length) return T_95[df - 1];
    const z = 1.96;
    return z + (z ** 3 + z) / (4 * df) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df ** 2);
  }

  function meanCI(xs) {
    const m = mean(xs);
    if (xs.length < 2) return { mean: m, low: null, high: null };
    const half = (tCritical(xs.length - 1) * sd(xs)) / Math.sqrt(xs.length);
    return { mean: m, low: m - half, high: m + half };
  }

  // Exact two-sided sign test. Ties are dropped by the caller.
  function signTestP(wins, losses) {
    const n = wins + losses;
    if (!n) return null;
    let tail = 0;
    let coefficient = 1;
    const k = Math.min(wins, losses);
    for (let i = 0; i <= k; i++) {
      tail += coefficient;
      coefficient = (coefficient * (n - i)) / (i + 1);
    }
    return Math.min(1, (2 * tail) / 2 ** n);
  }

  function holm(ps) {
    const order = ps.map((p, i) => [p, i]).filter(([p]) => p !== null).sort((a, b) => a[0] - b[0]);
    const adjusted = ps.map(() => null);
    let running = 0;
    order.forEach(([p, i], position) => {
      running = Math.max(running, Math.min(1, p * (order.length - position)));
      adjusted[i] = running;
    });
    return adjusted;
  }

  function averageRanks(values) {
    const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const ranks = new Array(values.length);
    let ties = 0;
    for (let i = 0; i < order.length; ) {
      let j = i;
      while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
      const t = j - i + 1;
      ties += t ** 3 - t;
      for (let k = i; k <= j; k++) ranks[order[k][1]] = (i + j) / 2 + 1;
      i = j + 1;
    }
    return { ranks, ties };
  }

  // Friedman test with tie correction. With three methods, df = 2 and p = exp(-chi2 / 2).
  function friedman(blocks) {
    const n = blocks.length;
    const k = n ? blocks[0].length : 0;
    if (n < 2 || k !== 3) return null;
    const totals = new Array(k).fill(0);
    let ties = 0;
    for (const block of blocks) {
      const result = averageRanks(block);
      result.ranks.forEach((r, i) => { totals[i] += r; });
      ties += result.ties;
    }
    const correction = 1 - ties / (n * k * (k * k - 1));
    if (correction <= 0) return { chi2: 0, p: 1, n };
    const spread = sum(totals.map((t) => (t / n - (k + 1) / 2) ** 2));
    const chi2 = ((12 * n) / (k * (k + 1)) * spread) / correction;
    return { chi2, p: Math.exp(-chi2 / 2), n };
  }

  function flatten(data, codebook) {
    const judgments = [];
    let unmapped = 0;
    for (const response of data.responses) {
      for (const answer of response.answers) {
        for (const entry of answer.ranking) {
          const known = codebook.get(entry.output_id);
          if (!known) { unmapped += 1; continue; }
          judgments.push({
            sid: response.submission_id,
            sceneId: answer.scene_id,
            sceneTitle: known.scene_title,
            method: known.method_label,
            rank: entry.rank,
            position: entry.position,
            plays: entry.plays || 0,
            listened: entry.listened_seconds || 0,
          });
        }
      }
    }
    return { judgments, unmapped };
  }

  const groupBy = (items, key) => {
    const groups = new Map();
    for (const item of items) {
      const k = key(item);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(item);
    }
    return groups;
  };

  function computeStats(data) {
    const codebook = new Map(data.codebook.map((c) => [c.output_id, c]));
    const methods = [...new Set(data.codebook.map((c) => c.method_label))].sort();
    const { judgments, unmapped } = flatten(data, codebook);
    const bySid = groupBy(judgments, (j) => j.sid);
    const sids = [...bySid.keys()];

    const methodMeanFor = (rows, method) => mean(rows.filter((r) => r.method === method).map((r) => r.rank));
    const participantMeans = new Map(sids.map((sid) => [sid, methods.map((m) => methodMeanFor(bySid.get(sid), m))]));
    const complete = sids.filter((sid) => participantMeans.get(sid).every((v) => v !== null));

    const methodSummary = methods.map((method, index) => {
      const rows = judgments.filter((j) => j.method === method);
      const ci = meanCI(complete.map((sid) => participantMeans.get(sid)[index]));
      const share = (rank) => (rows.length ? rows.filter((r) => r.rank === rank).length / rows.length : null);
      return {
        method,
        n: rows.length,
        mean: mean(rows.map((r) => r.rank)),
        low: ci.low,
        high: ci.high,
        rankShares: [share(1), share(2), share(3)],
        playedShare: rows.length ? rows.filter((r) => r.plays > 0).length / rows.length : null,
        meanPlays: mean(rows.map((r) => r.plays)),
        meanListened: mean(rows.map((r) => r.listened)),
      };
    });

    const pairs = [];
    for (let a = 0; a < methods.length; a++) {
      for (let b = a + 1; b < methods.length; b++) {
        const rankOf = (rows, method) => rows.find((r) => r.method === method)?.rank;
        let above = 0;
        let compared = 0;
        for (const rows of groupBy(judgments, (j) => `${j.sid}|${j.sceneId}`).values()) {
          const ra = rankOf(rows, methods[a]);
          const rb = rankOf(rows, methods[b]);
          if (ra === undefined || rb === undefined) continue;
          compared += 1;
          if (ra < rb) above += 1;
        }
        let wins = 0;
        let losses = 0;
        let ties = 0;
        for (const sid of complete) {
          const [ma, mb] = [participantMeans.get(sid)[a], participantMeans.get(sid)[b]];
          if (ma < mb) wins += 1;
          else if (ma > mb) losses += 1;
          else ties += 1;
        }
        pairs.push({ a: methods[a], b: methods[b], share: compared ? above / compared : null, compared, wins, losses, ties, p: signTestP(wins, losses) });
      }
    }
    holm(pairs.map((p) => p.p)).forEach((value, i) => { pairs[i].pHolm = value; });

    const scenes = [...groupBy(data.codebook, (c) => c.scene_id).entries()].map(([sceneId, entries]) => {
      const rows = judgments.filter((j) => j.sceneId === sceneId);
      const cells = methods.map((method) => {
        const subset = rows.filter((r) => r.method === method);
        return { mean: mean(subset.map((r) => r.rank)), firstShare: subset.length ? subset.filter((r) => r.rank === 1).length / subset.length : null };
      });
      const available = cells.map((c) => c.mean).filter((v) => v !== null);
      const bestMean = available.length ? Math.min(...available) : null;
      return {
        sceneId,
        title: entries[0].scene_title,
        n: new Set(rows.map((r) => r.sid)).size,
        cells,
        best: bestMean === null ? [] : methods.filter((_, i) => cells[i].mean === bestMean),
      };
    }).sort((a, b) => a.title.localeCompare(b.title));

    const positions = [0, 1, 2].map((position) => {
      const rows = judgments.filter((j) => j.position === position);
      return { position, n: rows.length, meanRank: mean(rows.map((r) => r.rank)), methodCounts: methods.map((m) => rows.filter((r) => r.method === m).length) };
    });

    const responses = data.responses.map((response) => {
      const rows = bySid.get(response.submission_id) || [];
      const started = Date.parse(response.started_at);
      const submitted = Date.parse(response.submitted_at);
      const playedShare = rows.length ? rows.filter((r) => r.plays > 0).length / rows.length : null;
      return {
        id: response.submission_id,
        submittedAt: response.submitted_at || response.received_at,
        durationSeconds: Number.isFinite(started) && Number.isFinite(submitted) ? (submitted - started) / 1000 : null,
        scenes: response.answers.length,
        methodMeans: participantMeans.get(response.submission_id) || methods.map(() => null),
        playedShare,
        lowEngagement: playedShare !== null && playedShare < LOW_ENGAGEMENT_SHARE,
        isDebug: Boolean(response.is_debug),
      };
    }).sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));

    const sceneTimes = data.responses.flatMap((r) => r.answers.map((a) => a.active_ms / 1000).filter(Number.isFinite));
    const allPlayed = [...groupBy(judgments, (j) => `${j.sid}|${j.sceneId}`).values()];
    const perDay = [...groupBy(data.responses, (r) => String(r.submitted_at || r.received_at).slice(0, 10)).entries()]
      .map(([day, rows]) => ({ day, count: rows.length })).sort((a, b) => a.day.localeCompare(b.day));

    return {
      generatedAt: data.generated_at,
      methods,
      responseCount: data.responses.length,
      judgments: allPlayed.length,
      unmapped,
      medianDuration: median(responses.map((r) => r.durationSeconds).filter((v) => v !== null)),
      medianSceneSeconds: median(sceneTimes),
      playedShare: judgments.length ? judgments.filter((j) => j.plays > 0).length / judgments.length : null,
      allThreePlayedShare: allPlayed.length ? allPlayed.filter((rows) => rows.every((r) => r.plays > 0)).length / allPlayed.length : null,
      lowEngagementCount: responses.filter((r) => r.lowEngagement).length,
      lowEngagementThreshold: LOW_ENGAGEMENT_SHARE,
      methodSummary,
      friedman: friedman(complete.map((sid) => participantMeans.get(sid))),
      pairs,
      scenes,
      positions,
      responses,
      perDay,
    };
  }

  const api = { computeStats, signTestP, holm, friedman, averageRanks, meanCI, median };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StudyStats = api;
})(this);
