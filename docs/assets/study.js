(() => {
  'use strict';

  const { tap, ranks, nextRank, isComplete } = window.Ranking;
  const cfg = window.STUDY_CONFIG;

  const LETTERS = ['A', 'B', 'C', 'D'];
  const OUTPUT_COLORS = ['#2563eb', '#c026d3', '#d97706', '#16a34a'];
  const SOURCE_COLORS = ['#176875', '#974213', '#4d6926', '#754283'];
  const ORDINALS = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' };
  const REQUEST_TIMEOUT_MS = 30000;
  const WHAT_TO_JUDGE = [
    ['Sounds', 'Can you hear every requested sound, and does each one sound natural?'],
    ['Timing', 'Does each sound happen when the timeline says it should?'],
    ['Overall', 'Which video do you prefer overall, considering timing, naturalness, and how fully it delivers what was requested?'],
  ];

  const params = new URLSearchParams(location.search);
  const debug = params.has('debug');
  const accessValue = params.get('k') || '';
  const canSend = Boolean(cfg.apiUrl && accessValue);

  const app = document.getElementById('app');
  let study;
  let sceneById;
  let draft;
  let teardownScene = () => {};
  let flushProgress = () => {};

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

  function show(...nodes) {
    teardownScene();
    app.replaceChildren(...nodes);
    window.scrollTo(0, 0);
  }

  function notice(title, eyebrow, ...content) {
    show(el('div', { class: 'notice-page' },
      el('main', { class: 'notice' }, el('p', { class: 'eyebrow' }, eyebrow), el('h1', {}, title), ...content)));
  }

  function body(text) {
    return el('p', { class: 'body' }, text);
  }

  async function callApi(action, payload) {
    const res = await fetch(cfg.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, access: accessValue, payload }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res.json();
  }

  /* Draft storage. Nothing leaves the browser until the final submit. */

  const draftKey = () => `media-eval-draft:${study.version}`;

  function saveDraft() {
    try { localStorage.setItem(draftKey(), JSON.stringify(draft)); } catch { /* private mode */ }
  }

  function readDraft() {
    try {
      const saved = JSON.parse(localStorage.getItem(draftKey()));
      if (saved && saved.sceneOrder.every((id) => sceneById[id])) return saved;
    } catch { /* unreadable draft */ }
    return null;
  }

  function clearDraft() {
    try { localStorage.removeItem(draftKey()); } catch { /* private mode */ }
  }

  /* Order is random per submission and stable for that submission. */

  function seededRandom(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return () => {
      h = (h + 0x6d2b79f5) | 0;
      let t = Math.imul(h ^ (h >>> 15), 1 | h);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffled(items, seed) {
    const random = seededRandom(seed);
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  function newDraft() {
    const submissionId = crypto.randomUUID();
    const outputOrder = {};
    for (const s of study.scenes) outputOrder[s.id] = shuffled(s.outputs.map((o) => o.id), submissionId + s.id);
    return {
      submissionId,
      startedAt: new Date().toISOString(),
      sceneOrder: shuffled(study.scenes.map((s) => s.id), submissionId),
      outputOrder,
      answers: {},
      index: 0,
    };
  }

  function answerFor(sceneId) {
    if (!draft.answers[sceneId]) draft.answers[sceneId] = { picks: [], playback: {}, activeMs: 0 };
    return draft.answers[sceneId];
  }

  const sceneDone = (id) => isComplete(answerFor(id).picks, draft.outputOrder[id].length);

  const shortLabel = (label) => label.replace(/'s Voice$/, '').replace(/ Voice$/, '');
  const sourceColor = (index) => SOURCE_COLORS[index % SOURCE_COLORS.length];

  /* Compact timeline for small screens: fits the width, and sits under each video. */

  function mountMiniTimeline(scene, onSeek, showNow) {
    const duration = Number(scene.duration) || 10;
    const ticks = el('div', { class: 'mini-ticks', 'aria-hidden': 'true' });
    const lastTick = Math.floor(Math.ceil(duration) / 2) * 2;
    for (let t = 0; t <= lastTick; t += 2) {
      const tick = el('span', { class: t === 0 ? 'first' : t === lastTick ? 'last' : undefined }, `${t}s`);
      tick.style.left = `${Math.min((t / duration) * 100, 100)}%`;
      ticks.append(tick);
    }

    const cursors = [];
    const rows = (scene.requested || []).map((source, i) => {
      const lane = el('div', {
        class: 'mini-lane',
        vars: { '--grid': `${(2 / duration) * 100}%` },
        on: onSeek ? {
          click: (e) => {
            const box = e.currentTarget.getBoundingClientRect();
            onSeek(Math.max(0, Math.min(duration, ((e.clientX - box.left) / box.width) * duration)));
          },
        } : {},
      });
      for (const w of source.windows || []) {
        const end = Math.min(duration, w.end);
        const block = el('span', { class: 'mini-block', title: `${source.label} · ${w.start}–${end} s` });
        block.style.left = `${(Math.max(0, w.start) / duration) * 100}%`;
        block.style.width = `${((end - Math.max(0, w.start)) / duration) * 100}%`;
        lane.append(block);
      }
      const cursor = el('i', { class: 'mini-cursor', hidden: 'hidden', 'aria-hidden': 'true' });
      cursors.push(cursor);
      lane.append(cursor);
      return el('div', { class: 'mini-row', vars: { '--source': sourceColor(i) } },
        el('span', { class: 'mini-label' }, shortLabel(source.label)), lane);
    });

    const now = showNow ? el('p', { class: 'mini-now' }, 'Press play and follow this timeline.') : null;
    let shownKey = '';

    function nowItems(time) {
      return (scene.requested || []).flatMap((source, i) => (source.windows || [])
        .filter((w) => time >= w.start && time < Math.min(duration, w.end))
        .map((w) => ({ source, index: i, window: w })));
    }

    return {
      node: el('div', { class: 'mini-timeline' },
        el('div', { class: 'mini-head' }, el('span', {}), ticks),
        ...rows,
        now),
      update(time) {
        for (const cursor of cursors) {
          cursor.hidden = false;
          cursor.style.left = `${Math.min(100, (time / duration) * 100)}%`;
        }
        if (!now) return;
        const items = nowItems(time);
        const key = items.map((item) => `${item.index}:${item.window.start}`).join('|');
        if (key === shownKey && shownKey) return;
        shownKey = key || 'none';
        if (!items.length) {
          now.replaceChildren('No requested sound right now.');
          return;
        }
        now.replaceChildren(el('strong', {}, 'Should hear now: '), ...items.flatMap(({ source, index, window: w }, position) => {
          const spoken = w.text && w.text !== 'Continuous' ? ` “${w.text}”` : '';
          return [position ? ', ' : null, el('span', { class: 'mini-now-item', vars: { '--source': sourceColor(index) } }, `${shortLabel(source.label)}${spoken}`)];
        }).filter(Boolean));
      },
    };
  }

  /* Requested timeline. One colored playhead per output. */

  function mountTimeline(scene, onSeek) {
    const duration = Number(scene.duration) || 10;
    const clock = el('span', { class: 'timeline-clock' }, '0.00 s');
    const events = (scene.requested || [])
      .flatMap((source, index) => (source.windows || []).map((w) => ({ source, index, w })))
      .sort((a, b) => a.w.start - b.w.start);
    const script = el('ol', { class: 'timeline-script' }, ...events.map(({ source, index, w }) =>
      el('li', { vars: { '--source': sourceColor(index) } },
        el('span', { class: 'script-time' }, w.text === 'Continuous' ? 'Whole clip' : `${w.start}–${Math.min(duration, w.end)} s`),
        el('span', { class: 'script-what' }, el('b', {}, shortLabel(source.label)), w.text && w.text !== 'Continuous' ? ` “${w.text}”` : ''))));
    const ticks = el('div', { class: 'timeline-ticks' });
    const lastTick = Math.floor(Math.ceil(duration) / 2) * 2;
    for (let t = 0; t <= lastTick; t += 2) {
      const tick = el('span', { class: t === 0 ? 'first' : t === lastTick ? 'last' : undefined }, `${t}s`);
      tick.style.left = `${Math.min((t / duration) * 100, 100)}%`;
      ticks.append(tick);
    }
    const chart = el('div', { class: 'timeline-chart' },
      el('div', { class: 'timeline-axis' }, el('span', {}, 'Source'), ticks));

    const cursors = LETTERS.map(() => []);
    (scene.requested || []).forEach((source, i) => {
      const lane = el('div', {
        class: 'timeline-lane',
        vars: { '--grid': `${(2 / duration) * 100}%` },
        on: {
          click: (e) => {
            const box = e.currentTarget.getBoundingClientRect();
            onSeek(Math.max(0, Math.min(duration, ((e.clientX - box.left) / box.width) * duration)));
          },
        },
      });
      for (const w of source.windows || []) {
        const end = Math.min(duration, w.end);
        const text = w.text || source.label;
        const block = el('span', { class: 'event-block', title: `${text} · ${w.start}–${end} s` },
          el('strong', {}, `${w.start}–${end} s`), el('span', {}, text));
        block.style.left = `${(Math.max(0, w.start) / duration) * 100}%`;
        block.style.width = `${((end - Math.max(0, w.start)) / duration) * 100}%`;
        lane.append(block);
      }
      LETTERS.forEach((_, outputIndex) => {
        const cursor = el('i', { class: 'time-cursor', hidden: 'hidden', 'aria-hidden': 'true', vars: { '--out': OUTPUT_COLORS[outputIndex] } });
        cursors[outputIndex].push(cursor);
        lane.append(cursor);
      });
      chart.append(el('div', { class: 'timeline-row', vars: { '--source': SOURCE_COLORS[i % SOURCE_COLORS.length] } },
        el('div', { class: 'source-label' }, source.label), lane));
    });

    const node = el('section', { class: 'timeline-panel', 'aria-label': 'Requested sound timeline' },
      el('div', { class: 'timeline-heading' },
        el('h2', {}, 'Requested sound timeline'),
        el('p', { class: 'note-wide' }, 'Filled blocks show when each source should sound. Select a time to seek the video you last played.'),
        el('p', { class: 'note-phone' }, 'Each video below has its own copy of this timeline. Follow it while you watch.'),
        clock),
      mountMiniTimeline(scene, null, false).node,
      script,
      el('div', { class: 'timeline-scroll', tabindex: '0', 'aria-label': 'Timeline' }, chart),
      el('div', { class: 'timeline-legend' }, ...LETTERS.map((letter, i) =>
        el('span', { vars: { '--out': OUTPUT_COLORS[i] } }, `Output ${letter} playhead`))));

    return {
      node,
      update(outputIndex, time) {
        for (const cursor of cursors[outputIndex]) {
          cursor.hidden = false;
          cursor.style.left = `${Math.min(100, (time / duration) * 100)}%`;
        }
        clock.textContent = `Output ${LETTERS[outputIndex]} · ${time.toFixed(2)} s`;
      },
    };
  }

  /* One scene. */

  function renderScene() {
    const sceneId = draft.sceneOrder[draft.index];
    const scene = sceneById[sceneId];
    const answer = answerFor(sceneId);
    const ids = draft.outputOrder[sceneId];
    const outputs = ids.map((id) => scene.outputs.find((o) => o.id === id));
    let segmentStart = Date.now();
    const videos = [];
    const rankButtons = [];
    let active = null;
    let frame = 0;

    const miniTimelines = [];
    const showTime = (index, time) => {
      timeline.update(index, time);
      miniTimelines[index].update(time);
    };
    const timeline = mountTimeline(scene, (time) => {
      const index = active === null ? 0 : active;
      videos[index].currentTime = time;
      showTime(index, time);
    });

    const stopFrames = () => { cancelAnimationFrame(frame); frame = 0; };
    const runFrames = () => {
      if (active !== null) showTime(active, videos[active].currentTime);
      frame = requestAnimationFrame(runFrames);
    };

    const status = el('p', { class: 'rank-status', role: 'status', 'aria-live': 'polite' });
    const nextButton = el('button', { class: 'btn primary', type: 'button', on: { click: () => move(1) } });

    function refreshRanks() {
      const current = ranks(answer.picks, ids);
      const upcoming = nextRank(answer.picks);
      ids.forEach((id, i) => {
        const button = rankButtons[i];
        const placed = current[id];
        const letter = LETTERS[i];
        if (placed) {
          button.dataset.rank = placed.rank;
          button.dataset.auto = String(placed.auto);
          button.querySelector('.main').textContent = ORDINALS[placed.rank];
          button.querySelector('.sub').textContent = placed.auto ? 'Auto-filled · tap to undo' : 'Tap to undo';
          button.setAttribute('aria-label', `Output ${letter} ranked ${ORDINALS[placed.rank]}. Activate to undo.`);
        } else {
          delete button.dataset.rank;
          delete button.dataset.auto;
          button.querySelector('.main').textContent = `Tap for ${ORDINALS[upcoming]}`;
          button.querySelector('.sub').textContent = upcoming === 1 ? 'Best of all' : 'Next best';
          button.setAttribute('aria-label', `Rank Output ${letter} ${ORDINALS[upcoming]}`);
        }
      });
      const done = isComplete(answer.picks, ids.length);
      if (done) {
        const order = ids.map((_, i) => i + 1).map((r) => `${ORDINALS[r]}: Output ${LETTERS[ids.findIndex((id) => current[id].rank === r)]}`);
        status.textContent = `Your ranking. ${order.join(' · ')}`;
      } else {
        status.textContent = `Next, tap the output you rank ${ORDINALS[upcoming]}.`;
      }
      nextButton.disabled = !done && !debug;
    }

    const cards = outputs.map((output, i) => {
      const playback = (answer.playback[output.id] ||= { plays: 0, seconds: 0 });
      const error = el('p', { class: 'video-error', hidden: 'hidden' }, 'This video could not be loaded.');
      let last = 0;
      const video = el('video', {
        src: output.src,
        controls: 'controls',
        playsinline: 'playsinline',
        preload: 'metadata',
        controlslist: 'nodownload noplaybackrate',
        disablepictureinpicture: 'disablepictureinpicture',
        'aria-label': `Output ${LETTERS[i]}`,
        on: {
          play: () => {
            videos.forEach((other, j) => { if (j !== i) other.pause(); });
            active = i;
            playback.plays += 1;
            last = video.currentTime;
            if (!frame) runFrames();
          },
          // Pausing a video because another one started must not stop the new playhead.
          pause: () => { if (active === i) stopFrames(); saveDraft(); },
          ended: () => { if (active === i) stopFrames(); saveDraft(); },
          seeked: () => {
            last = video.currentTime;
            showTime(i, video.currentTime);
          },
          timeupdate: () => {
            const delta = video.currentTime - last;
            if (delta > 0 && delta < 1.5) playback.seconds += delta;
            last = video.currentTime;
            if (active === i) showTime(i, video.currentTime);
          },
          error: () => { error.hidden = false; },
        },
      });
      videos.push(video);

      const mini = mountMiniTimeline(scene, (time) => {
        active = i;
        video.currentTime = time;
        showTime(i, time);
      }, true);
      miniTimelines.push(mini);

      const rankButton = el('button', {
        class: 'rank-btn',
        type: 'button',
        on: {
          click: () => {
            answer.picks = tap(answer.picks, output.id, ids.length);
            saveDraft();
            refreshRanks();
          },
        },
      }, el('span', { class: 'main' }), el('span', { class: 'sub' }));
      rankButtons.push(rankButton);

      return el('article', { class: 'output-card', vars: { '--out': OUTPUT_COLORS[i] } },
        el('h3', { class: 'output-name' }, `Output ${LETTERS[i]}`),
        el('div', { class: 'video-frame' }, video),
        error,
        mini.node,
        rankButton);
    });

    function flushScene() {
      answer.activeMs += Date.now() - segmentStart;
      segmentStart = Date.now();
      saveDraft();
    }

    function leaveScene() {
      stopFrames();
      flushScene();
      flushProgress = () => {};
      for (const video of videos) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
    }

    function move(step) {
      teardownScene();
      teardownScene = () => {};
      draft.index += step;
      saveDraft();
      if (draft.index >= draft.sceneOrder.length) submitResponse();
      else renderScene();
    }

    const total = draft.sceneOrder.length;
    nextButton.textContent = draft.index === total - 1 ? 'Finish' : 'Next scene';

    const rail = el('aside', { class: 'rail' },
      el('p', { class: 'eyebrow' }, `Scene ${draft.index + 1} of ${total}`),
      el('h1', {}, scene.title),
      el('p', { class: 'summary' }, scene.summary),
      scene.prompt ? el('details', {}, el('summary', {}, 'Full scene description'), el('p', {}, scene.prompt)) : null,
      el('div', { class: 'task' },
        // Collapsed on phones so that the timeline and videos come first.
        el('details', { open: window.matchMedia('(max-width: 640px)').matches ? undefined : 'open' },
          el('summary', {}, 'What to pay attention to'),
          ...WHAT_TO_JUDGE.map(([name, text]) => el('p', {}, el('b', {}, `${name}. `), text))),
        el('strong', { class: 'task-next' }, 'How to rank'),
        el('p', {}, 'Tap the videos in order, best first. The last one fills in by itself. Tap a ranked video again to undo.')));

    const workspace = el('main', { class: 'workspace' },
      rail,
      el('div', {},
        timeline.node,
        el('h2', { class: 'question' }, study.question),
        el('div', { class: 'outputs' }, ...cards),
        status,
        el('nav', { class: 'scene-nav', 'aria-label': 'Scene navigation' },
          el('span', { class: 'count' }, `${draft.index + 1} / ${total}`),
          el('button', { class: 'btn', type: 'button', disabled: draft.index === 0 ? 'disabled' : undefined, on: { click: () => move(-1) } }, 'Previous'),
          nextButton)));

    show(
      el('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': total, 'aria-valuenow': draft.index + 1 },
        el('i', { style: `width:${((draft.index + 1) / total) * 100}%` })),
      workspace);
    teardownScene = leaveScene;
    flushProgress = flushScene;
    refreshRanks();
  }

  /* Submission. */

  function buildPayload() {
    const answers = [];
    for (const sceneId of draft.sceneOrder) {
      const answer = answerFor(sceneId);
      const ids = draft.outputOrder[sceneId];
      if (!isComplete(answer.picks, ids.length)) continue;
      const placed = ranks(answer.picks, ids);
      answers.push({
        scene_id: sceneId,
        active_ms: answer.activeMs,
        ranking: ids.map((id, position) => ({
          output_id: id,
          position,
          rank: placed[id].rank,
          auto: placed[id].auto,
          plays: answer.playback[id]?.plays ?? 0,
          listened_seconds: Number((answer.playback[id]?.seconds ?? 0).toFixed(2)),
        })),
      });
    }
    return {
      submission_id: draft.submissionId,
      study_version: study.version,
      is_debug: debug,
      started_at: draft.startedAt,
      submitted_at: new Date().toISOString(),
      scene_order: draft.sceneOrder,
      answers,
    };
  }

  function statusIcon(state) {
    return el('div', { class: `submit-icon ${state}`, 'aria-hidden': 'true' });
  }

  async function submitResponse() {
    const firstOpen = debug ? -1 : draft.sceneOrder.findIndex((id) => !sceneDone(id));
    if (firstOpen >= 0) {
      draft.index = firstOpen;
      saveDraft();
      renderScene();
      return;
    }

    show(el('div', { class: 'notice-page' },
      el('main', { class: 'submit-screen', role: 'status' }, statusIcon('loading'), el('h1', {}, 'Submitting your response…'))));

    const payload = buildPayload();
    if (!canSend) {
      renderSubmitted(payload);
      return;
    }
    try {
      await callApi('submit', payload);
      renderSubmitted(null);
    } catch (e) {
      console.error(e);
      renderSubmitFailed(payload);
    }
  }

  function renderSubmitted(dryRunPayload) {
    clearDraft();
    draft = null;
    show(el('div', { class: 'notice-page' },
      el('main', { class: 'submit-screen', role: 'status' },
        statusIcon('success'),
        el('h1', {}, 'Thank you!'),
        body(dryRunPayload ? 'Debug run. Nothing was sent. This is what would have been submitted.' : 'Your response has been recorded. You can close this page.'),
        dryRunPayload ? el('pre', { class: 'payload', id: 'dry-run-payload' }, JSON.stringify(dryRunPayload, null, 2)) : null,
        el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'button', on: { click: startNew } }, 'Start another response')))));
  }

  // The draft is kept, so reopening the study link can still retry the submission.
  function renderSubmitFailed(payload) {
    const json = JSON.stringify(payload);
    const box = el('textarea', { class: 'failure-json', readonly: 'readonly', 'aria-label': 'Your response as JSON' });
    box.value = json;
    const copy = el('button', {
      class: 'btn primary',
      type: 'button',
      on: {
        click: async () => {
          box.select();
          try {
            await navigator.clipboard.writeText(json);
          } catch {
            document.execCommand('copy');
          }
          copy.textContent = 'Copied';
        },
      },
    }, 'Copy response');

    show(el('div', { class: 'notice-page' },
      el('main', { class: 'submit-screen failed', role: 'alert' },
        statusIcon('failure'),
        el('h1', {}, 'We could not save your response.'),
        body('Your rankings are not lost. Please copy the text below and send it to us in a DM, and we will add your response by hand.'),
        box,
        el('div', { class: 'actions' },
          copy,
          el('button', { class: 'btn', type: 'button', on: { click: submitResponse } }, 'Try sending again')))));
  }

  /* Entry screens. */

  function startNew() {
    draft = newDraft();
    saveDraft();
    // Asks the browser not to evict the saved progress under storage pressure.
    navigator.storage?.persist?.().catch(() => {});
    renderScene();
  }

  function renderConsent() {
    notice('Media evaluation', 'Before you begin',
      body(`You will compare short AI-generated videos across ${study.scenes.length} scenes and rank the ${study.scenes[0].outputs.length} videos in each one. Each scene takes a minute or two.`),
      body('For each scene, please pay attention to:'),
      el('ul', {}, ...WHAT_TO_JUDGE.map(([name, text]) => el('li', {}, el('b', {}, `${name}. `), text))),
      body('Before you start:'),
      el('ul', {},
        el('li', {}, 'Participation is voluntary and anonymous. We do not ask for your name or email.'),
        el('li', {}, 'All media you will see and hear are synthetic.'),
        el('li', {}, 'You may stop at any time. Your progress is saved in this browser, so you can close the page and continue later from the same link.'),
        el('li', {}, 'Your answers are sent automatically after the last scene.'),
        el('li', {}, 'A desktop or laptop, headphones, and a quiet room are recommended.')),
      el('div', { class: 'actions' },
        el('button', { class: 'btn primary', type: 'button', on: { click: renderIntro } }, 'I agree, continue')));
  }

  function renderIntro() {
    show(el('div', { class: 'notice-page' },
      el('main', { class: 'intro-screen' },
        el('p', { class: 'eyebrow' }, 'Before you start'),
        el('h1', {}, 'What to look and listen for'),
        body('Please watch this short video with the sound on.'),
        el('video', { class: 'intro-video', src: 'media/intro.mp4', controls: 'controls', playsinline: 'playsinline', preload: 'metadata', controlslist: 'nodownload noplaybackrate', disablepictureinpicture: 'disablepictureinpicture' }),
        el('div', { class: 'actions' },
          el('button', { class: 'btn primary', type: 'button', on: { click: startNew } }, 'Start the study')))));
  }

  function renderResume(saved) {
    const answered = saved.sceneOrder.filter((id) => saved.answers[id] && isComplete(saved.answers[id].picks, saved.outputOrder[id].length)).length;
    notice('Welcome back.', 'Unfinished response',
      body(`You have ranked ${answered} of ${saved.sceneOrder.length} scenes in this browser.`),
      el('div', { class: 'actions' },
        el('button', { class: 'btn primary', type: 'button', on: { click: () => { draft = saved; if (draft.index >= draft.sceneOrder.length) submitResponse(); else renderScene(); } } }, 'Resume'),
        el('button', { class: 'btn', type: 'button', on: { click: startNew } }, 'Start a new response')));
  }

  function renderAccessRequired() {
    notice('Access link required.', 'Media evaluation', body('Please open the complete study link supplied by the research team.'));
  }

  async function boot() {
    try {
      const res = await fetch('data/scenes.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(String(res.status));
      study = await res.json();
    } catch (e) {
      console.error(e);
      notice('Study unavailable.', 'Media evaluation', body('The study could not be loaded. Please try again later.'));
      return;
    }
    if (!study.scenes.length) {
      notice('Study not open yet.', 'Media evaluation', body('This study is still being prepared.'));
      return;
    }
    sceneById = Object.fromEntries(study.scenes.map((s) => [s.id, s]));

    if (!debug) {
      if (!canSend) { renderAccessRequired(); return; }
      try {
        if (!(await callApi('check'))) { renderAccessRequired(); return; }
      } catch (e) {
        console.error(e);
        notice('Study unavailable.', 'Media evaluation', body('We could not verify your link. Please try again later.'));
        return;
      }
    }

    const saved = readDraft();
    if (saved) renderResume(saved);
    else renderConsent();
  }

  // Mobile browsers can discard a backgrounded tab without firing pagehide, so save on both.
  window.addEventListener('pagehide', () => flushProgress());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushProgress();
  });

  boot();
})();
