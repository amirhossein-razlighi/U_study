(() => {
  'use strict';

  const cfg = window.STUDY_CONFIG;
  const { computeStats } = window.StudyStats;
  const app = document.getElementById('app');
  const tip = document.getElementById('tip');

  // Fixed order, assigned to methods sorted by name, so a method always keeps its color.
  const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'];
  const RANK_LABELS = ['1st', '2nd', '3rd', '4th'];
  const LETTERS = ['A', 'B', 'C', 'D'];

  // Held in memory only, so that Refresh works and closing the tab signs out.
  let password = '';
  let includeDebug = false;
  let rankCount = RANK_LABELS.length;

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'on') for (const [ev, fn] of Object.entries(value)) node.addEventListener(ev, fn);
      else if (key === 'vars') for (const [name, v] of Object.entries(value)) node.style.setProperty(name, v);
      else if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value);
    }
    node.append(...children.filter((c) => c !== null && c !== undefined));
    return node;
  }

  const fixed = (value, digits = 2) => (value === null || value === undefined ? '–' : value.toFixed(digits));
  const pct = (value) => (value === null || value === undefined ? '–' : `${Math.round(value * 100)}%`);

  function pValue(value) {
    if (value === null || value === undefined) return '–';
    return value < 0.001 ? '< 0.001' : value.toFixed(3);
  }

  function duration(seconds) {
    if (seconds === null || seconds === undefined) return '–';
    const whole = Math.round(seconds);
    return whole < 60 ? `${whole}s` : `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, '0')}s`;
  }

  function when(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '–' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  }

  const rankAxisPercent = (rank) => ((rank - 1) / (rankCount - 1)) * 100;

  /* Sign-in. */

  async function adminRequest(body) {
    const res = await fetch(cfg.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.status === 'ok') return data;
    throw new Error(data.status || 'error');
  }

  const requestData = (candidate) => adminRequest({ action: 'admin', password: candidate });
  const requestDelete = (submissionId) => adminRequest({ action: 'admin_delete', password, submission_id: submissionId });

  const SIGN_IN_ERRORS = {
    denied: 'Incorrect password.',
    locked: 'Too many failed attempts. Please try again in 15 minutes.',
  };

  function renderSignIn(message) {
    password = '';
    includeDebug = false;
    const input = el('input', { class: 'password', type: 'password', name: 'password', autocomplete: 'current-password', required: 'required', 'aria-label': 'Password' });
    const error = el('p', { class: 'error-text', role: 'alert', hidden: message ? undefined : 'hidden' }, message || '');
    const submit = el('button', { class: 'btn primary', type: 'submit' }, 'Sign in');
    const form = el('form', {
      on: {
        submit: async (event) => {
          event.preventDefault();
          submit.disabled = true;
          error.hidden = true;
          try {
            const data = await requestData(input.value);
            password = input.value;
            renderPanel(data);
          } catch (e) {
            error.textContent = SIGN_IN_ERRORS[e.message] || 'The results could not be loaded. Please try again.';
            error.hidden = false;
            submit.disabled = false;
            input.select();
          }
        },
      },
    }, el('label', {}, 'Password', input), error, el('div', { class: 'actions' }, submit));

    app.replaceChildren(el('div', { class: 'notice-page' },
      el('main', { class: 'notice' }, el('p', { class: 'eyebrow' }, 'Study administration'), el('h1', {}, 'Sign in.'), form)));
    input.focus();
  }

  /* Panel pieces. */

  function section(title, note, ...content) {
    return el('section', { class: 'panel' },
      el('h2', {}, title),
      note ? el('p', { class: 'note' }, note) : null,
      ...content);
  }

  function tile(label, value, detail) {
    return el('div', { class: 'tile' },
      el('div', { class: 'tile-value' }, String(value)),
      el('div', { class: 'tile-label' }, label),
      detail ? el('div', { class: 'tile-detail' }, detail) : null);
  }

  function table(headers, rows) {
    return el('div', { class: 'table-scroll' },
      el('table', {},
        el('thead', {}, el('tr', {}, ...headers.map((h) => el('th', { scope: 'col' }, h)))),
        el('tbody', {}, ...rows.map((cells) => el('tr', {}, ...cells.map((c) => (c instanceof Node ? c : el('td', {}, String(c)))))))));
  }

  const methodName = (method, index) => el('span', { class: 'method-name', vars: { '--series': SERIES_COLORS[index] } }, method);

  function legend(items) {
    return el('div', { class: 'legend' }, ...items.map(([label, color]) => el('span', { vars: { '--swatch': color } }, label)));
  }

  function meanRankChart(stats) {
    const rows = stats.methodSummary.map((summary, index) => {
      const lane = el('div', { class: 'dot-lane' });
      if (summary.low !== null) {
        const low = rankAxisPercent(Math.max(1, summary.low));
        const high = rankAxisPercent(Math.min(rankCount, summary.high));
        lane.append(el('i', { class: 'ci', style: `left:${low}%;width:${high - low}%` }));
      }
      if (summary.mean !== null) {
        lane.append(el('i', {
          class: 'dot',
          style: `left:${rankAxisPercent(summary.mean)}%`,
          vars: { '--series': SERIES_COLORS[index] },
          'data-tip': `${summary.method}: mean rank ${fixed(summary.mean)}, 95% CI ${fixed(summary.low)} to ${fixed(summary.high)}`,
        }));
      }
      return el('div', { class: 'dot-row' },
        methodName(summary.method, index),
        lane,
        el('span', { class: 'dot-value' }, fixed(summary.mean)));
    });
    const axisLabels = stats.methods.map((_, i) => {
      const rank = i + 1;
      return el('span', {}, rank === 1 ? '1 (best)' : rank === rankCount ? `${rank} (worst)` : String(rank));
    });
    const axis = el('div', { class: 'dot-row dot-axis' }, el('span', {}), el('div', { class: 'axis-labels' }, ...axisLabels), el('span', {}));
    return el('div', { class: 'dot-chart' }, ...rows, axis);
  }

  function rankDistribution(stats) {
    const shades = ['#0f4c43', '#2a7a6e', '#57a195', '#86b8ae'];
    const rows = stats.methodSummary.map((summary, index) =>
      el('div', { class: 'stack-row' },
        methodName(summary.method, index),
        el('div', { class: 'stack' }, ...summary.rankShares.map((share, rank) => {
          if (!share) return null;
          return el('i', {
            style: `flex:${share} 0 0;background:${shades[rank]};color:${rank <= 1 ? '#fff' : 'var(--ink)'}`,
            'data-tip': `${summary.method}: ranked ${RANK_LABELS[rank]} in ${pct(share)} of scenes`,
          }, share >= 0.1 ? pct(share) : '');
        }))));
    return el('div', {}, legend(RANK_LABELS.slice(0, rankCount).map((label, i) => [label, shades[i]])), ...rows);
  }

  function sceneHeatmap(stats) {
    const shade = (rank) => {
      if (rank === null) return { background: '#f1efe8', color: 'var(--muted)' };
      const strength = (rankCount - rank) / (rankCount - 1);
      const mix = (from, to) => Math.round(from + (to - from) * strength);
      return { background: `rgb(${mix(238, 32)},${mix(245, 120)},${mix(243, 108)})`, color: strength > 0.55 ? '#fff' : 'var(--ink)' };
    };
    const rows = stats.scenes.map((scene) => [
      el('th', { scope: 'row' }, scene.title),
      el('td', { class: 'num' }, String(scene.n)),
      ...scene.cells.map((cell, index) => {
        const colors = shade(cell.mean);
        return el('td', {
          class: 'heat',
          style: `background:${colors.background};color:${colors.color}`,
          'data-tip': `${scene.title}, ${stats.methods[index]}: mean rank ${fixed(cell.mean)}, ranked 1st by ${pct(cell.firstShare)}`,
        }, fixed(cell.mean));
      }),
      el('td', {}, scene.best.join(', ') || '–'),
    ]);
    return table(['Scene', 'Responses', ...stats.methods, 'Best'], rows);
  }

  function perDayChart(stats) {
    const peak = Math.max(1, ...stats.perDay.map((d) => d.count));
    return el('div', { class: 'day-bars' }, ...stats.perDay.map((d) =>
      el('div', { class: 'day' },
        el('span', { class: 'day-count' }, String(d.count)),
        el('i', { style: `height:${(d.count / peak) * 100}%`, 'data-tip': `${d.day}: ${d.count} response${d.count === 1 ? '' : 's'}` }),
        el('span', { class: 'day-label' }, d.day.slice(5)))));
  }

  /* Deleting a response. The server only flags it, so the row stays in the database. */

  function confirmDelete(response) {
    const shortId = response.id.slice(0, 8);
    const error = el('p', { class: 'error-text', role: 'alert', hidden: 'hidden' });
    const closeDialog = () => { dialog.close(); dialog.remove(); };
    const cancel = el('button', { class: 'btn', type: 'button', on: { click: closeDialog } }, 'Cancel');
    const confirm = el('button', {
      class: 'btn danger',
      type: 'button',
      on: {
        click: async () => {
          confirm.disabled = true;
          cancel.disabled = true;
          error.hidden = true;
          try {
            await requestDelete(response.id);
            const data = await requestData(password);
            closeDialog();
            renderPanel(data);
          } catch (e) {
            if (SIGN_IN_ERRORS[e.message]) {
              closeDialog();
              renderSignIn(SIGN_IN_ERRORS[e.message]);
              return;
            }
            error.textContent = 'The response could not be deleted. Please try again.';
            error.hidden = false;
            confirm.disabled = false;
            cancel.disabled = false;
          }
        },
      },
    }, 'Delete');
    const dialog = el('dialog', { class: 'confirm', 'aria-labelledby': 'confirm-title', on: { close: () => dialog.remove() } },
      el('h2', { id: 'confirm-title' }, 'Are you sure?'),
      el('p', { class: 'note' }, `Response ${shortId} will be removed from the results and statistics.`),
      error,
      el('div', { class: 'actions' }, cancel, confirm));
    document.body.append(dialog);
    dialog.showModal();
  }

  function deleteButton(response) {
    const button = el('button', {
      class: 'delete-btn',
      type: 'button',
      title: 'Delete response',
      'aria-label': `Delete response ${response.id.slice(0, 8)}`,
      on: { click: () => confirmDelete(response) },
    });
    button.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>';
    return el('td', { class: 'delete-cell' }, button);
  }

  /* Panel. */

  function renderPanel(data) {
    const debugCount = data.responses.filter((r) => r.is_debug).length;
    const stats = computeStats({ ...data, responses: data.responses.filter((r) => includeDebug || !r.is_debug) });
    rankCount = stats.methods.length;
    const none = stats.responseCount === 0;
    const excludedDebug = includeDebug ? 0 : debugCount;

    const refresh = el('button', {
      class: 'btn',
      type: 'button',
      on: {
        click: async () => {
          refresh.disabled = true;
          try {
            renderPanel(await requestData(password));
          } catch (e) {
            renderSignIn(SIGN_IN_ERRORS[e.message] || 'Your session could not be refreshed. Please sign in again.');
          }
        },
      },
    }, 'Refresh');

    const debugCheckbox = el('input', {
      type: 'checkbox',
      checked: includeDebug ? 'checked' : undefined,
      on: { change: (event) => { includeDebug = event.target.checked; renderPanel(data); } },
    });
    const debugToggle = el('label', { class: 'debug-toggle' }, debugCheckbox, `Include debug responses (${debugCount})`);

    const header = el('header', { class: 'top' },
      el('div', {},
        el('p', { class: 'eyebrow' }, 'Study administration'),
        el('h1', {}, 'Results'),
        el('p', { class: 'note' }, `Updated ${when(stats.generatedAt)}. Debug responses are ${includeDebug ? 'included' : 'excluded'}.`)),
      el('div', { class: 'top-actions' },
        debugToggle,
        refresh,
        el('button', { class: 'btn', type: 'button', on: { click: () => renderSignIn() } }, 'Sign out')));

    const tiles = el('div', { class: 'tiles' },
      tile('Completed responses', stats.responseCount, excludedDebug ? `${excludedDebug} debug excluded` : null),
      tile('Scene judgments', stats.judgments),
      tile('Median completion time', duration(stats.medianDuration)),
      tile('Median time per scene', duration(stats.medianSceneSeconds)),
      tile('Videos played', pct(stats.playedShare), `All 3 played in ${pct(stats.allThreePlayedShare)} of scenes`),
      tile('Low-engagement responses', stats.lowEngagementCount, `Played under ${pct(stats.lowEngagementThreshold)} of videos`));

    if (none) {
      app.replaceChildren(el('main', { class: 'dashboard' }, header, tiles,
        el('section', { class: 'panel empty' }, el('h2', {}, 'No responses yet'), el('p', { class: 'note' }, 'Statistics will appear here once participants submit the study.'))));
      return;
    }

    const f = stats.friedman;
    const methodRows = stats.methodSummary.map((s, i) => [
      el('th', { scope: 'row' }, methodName(s.method, i)),
      el('td', { class: 'num' }, fixed(s.mean)),
      el('td', { class: 'num' }, s.low === null ? '–' : `${fixed(s.low)} to ${fixed(s.high)}`),
      ...s.rankShares.map((share) => el('td', { class: 'num' }, pct(share))),
      el('td', { class: 'num' }, String(s.n)),
    ]);

    const pairRows = stats.pairs.map((p) => [
      el('th', { scope: 'row' }, `${p.a} vs ${p.b}`),
      el('td', { class: 'num' }, `${pct(p.share)} / ${pct(p.share === null ? null : 1 - p.share)}`),
      el('td', { class: 'num' }, `${p.wins} / ${p.losses}${p.ties ? ` (${p.ties} tied)` : ''}`),
      el('td', { class: 'num' }, pValue(p.p)),
      el('td', { class: 'num' }, pValue(p.pHolm)),
    ]);

    const engagementRows = stats.methodSummary.map((s, i) => [
      el('th', { scope: 'row' }, methodName(s.method, i)),
      el('td', { class: 'num' }, pct(s.playedShare)),
      el('td', { class: 'num' }, fixed(s.meanPlays, 1)),
      el('td', { class: 'num' }, `${fixed(s.meanListened, 1)} s`),
    ]);

    const positionRows = stats.positions.map((p) => [
      el('th', { scope: 'row' }, `Output ${LETTERS[p.position]}`),
      el('td', { class: 'num' }, fixed(p.meanRank)),
      ...p.methodCounts.map((count) => el('td', { class: 'num' }, String(count))),
    ]);

    const responseRows = stats.responses.map((r) => [
      el('th', { scope: 'row' }, r.id.slice(0, 8)),
      when(r.submittedAt),
      el('td', { class: 'num' }, duration(r.durationSeconds)),
      el('td', { class: 'num' }, String(r.scenes)),
      ...r.methodMeans.map((m) => el('td', { class: 'num' }, fixed(m))),
      el('td', { class: 'num' }, pct(r.playedShare)),
      [r.isDebug ? 'Debug' : '', r.lowEngagement ? 'Low engagement' : ''].filter(Boolean).join(', '),
      deleteButton(r),
    ]);

    app.replaceChildren(el('main', { class: 'dashboard' },
      header,
      tiles,
      stats.unmapped ? el('p', { class: 'error-text' }, `${stats.unmapped} ranking entries did not match a known video and were left out.`) : null,

      section('Mean rank by method', 'Lower is better. Bars show 95% confidence intervals across participants.',
        legend(stats.methods.map((m, i) => [m, SERIES_COLORS[i]])),
        meanRankChart(stats),
        el('p', { class: 'stat-line' }, f
          ? `Friedman test across ${f.n} participants: χ²(${f.df}) = ${fixed(f.chi2)}, p = ${pValue(f.p)}.`
          : 'The Friedman test needs at least two participants.'),
        table(['Method', 'Mean rank', '95% CI', ...RANK_LABELS.slice(0, rankCount), 'Judgments'], methodRows)),

      section('Rank distribution', 'How often each method was placed at each rank.', rankDistribution(stats)),

      section('Pairwise preference', 'Scene preference is the share of judgments placing each method above the other. Participants are counted by who gave each method the better mean rank, tested with an exact sign test.',
        table(['Pair', 'Scene preference', 'Participants', 'p', 'Holm p'], pairRows)),

      section('Results by scene', 'Mean rank per method. Darker cells are ranked better.', sceneHeatmap(stats)),

      el('div', { class: 'columns' },
        section('Playback by method', 'Whether participants actually watched each method.', table(['Method', 'Played', 'Mean plays', 'Mean listened'], engagementRows)),
        section('Position balance', `Randomized positions should give similar counts and mean ranks near ${fixed((rankCount + 1) / 2, 1)}.`, table(['Position', 'Mean rank', ...stats.methods], positionRows))),

      section('Responses per day', null, perDayChart(stats)),

      section('Individual responses', 'Newest first. Method columns show each participant\'s mean rank.',
        table(['ID', 'Submitted', 'Duration', 'Scenes', ...stats.methods, 'Played', 'Flag', ''], responseRows))));
  }

  /* Tooltip for chart marks. */

  document.addEventListener('mousemove', (event) => {
    const target = event.target.closest?.('[data-tip]');
    if (!target) { tip.hidden = true; return; }
    tip.textContent = target.dataset.tip;
    tip.hidden = false;
    const left = Math.min(event.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${event.clientY + 16}px`;
  });

  renderSignIn();
})();
