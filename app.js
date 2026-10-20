/* Ascent Log — live ascent tracker. All data stays on this device (localStorage). */
(() => {
  'use strict';

  const STORE_KEY = 'summit-log:v1'; // original name kept so data saved before the rename still loads
  const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN, DAY = 24 * HOUR;
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const TAP_LOCK_MS = 4000;
  const DEFAULT_EVENT_START = '2026-10-23T06:00'; // Fri, Oct 23, 2026 at 6:00 AM // ignore a second tap of the big button within this window

  const defaultScenarios = () => [
    { id: 's1', name: 'Red Hat', baseMin: 120, stepMin: 0, stepEvery: 2, extraMin: 30, extraLaps: [4, 6, 12, 15] },
    { id: 's2', name: 'Main', baseMin: 90, stepMin: 0, stepEvery: 2, extraMin: 30, extraLaps: [6, 9, 12, 15] },
    { id: 's3', name: 'Stretch', baseMin: 65, stepMin: 5, stepEvery: 2, extraMin: 30, extraLaps: [4, 6, 12, 15] },
  ];
  // Earlier default names of the built-in scenarios. Saved data still using one of these is renamed on load;
  // a name the user typed is never touched.
  const OLD_SCENARIO_NAMES = {
    s1: { from: ['Scenario 1', 'Red Hat Pace'], to: 'Red Hat' },
    s2: { from: ['Scenario 2'], to: 'Main' },
    s3: { from: ['Scenario 3'], to: 'Stretch' },
  };

  // Seven Summits milestones. Each is awarded at the ascent whose total climb is closest to its height
  // (rounded to the nearest ascent); Everest is always the final ascent.
  const SUMMITS = [
    { id: 'kosciuszko', name: 'Kosciuszko', feet: 7310, where: 'Australia' },
    { id: 'vinson', name: 'Vinson', feet: 16050, where: 'Antarctica' },
    { id: 'elbrus', name: 'Elbrus', feet: 18510, where: 'Europe' },
    { id: 'kilimanjaro', name: 'Kilimanjaro', feet: 19341, where: 'Africa' },
    { id: 'denali', name: 'Denali', feet: 20310, where: 'North America' },
    { id: 'aconcagua', name: 'Aconcagua', feet: 22841, where: 'South America' },
    { id: 'everest', name: 'Everest', feet: 29029, where: 'Asia', final: true },
  ];

  // Ascent mantras: one is drawn at random when an ascent starts, never repeating within the event.
  const MANTRAS = [
    "Breathe Mthrfckr",
    "Do Hard Shit",
    "Why not me?",
    "We get to do this",
    "Smile or you're doing it wrong",
    "No Stoppy till the Toppy",
    "Your mom can run a 5K",
    "Step 1: Start Hiking; Step 2: There is no step 2",
    "It's supposed to be hard",
    "Trust the process, not the panic",
    "It never always gets worse",
    "The body achieves what the mind believes",
    "It’s not impossible, it’s just hard. Do the hard thing",
    "Forward is a pace",
    "Embrace the suck",
    "Inhale confidence, exhale doubt",
    "It always seems impossible until it’s done",
  ];

  // ---------- utils ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const pad = (n) => String(n).padStart(2, '0');
  const sum = (arr) => arr.reduce((a, v) => a + (v ?? 0), 0);
  const mean = (arr) => (arr.length ? arr.reduce((a, v) => a + v, 0) / arr.length : null);
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  function parseLocal(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(str || '');
    if (!m) return NaN;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime();
  }
  function toLocalInput(ms) {
    if (!isNum(ms)) return '';
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // Duration as h:mm (or h:mm:ss)
  function fmtDur(ms, secs = false) {
    if (!isNum(ms)) return '—';
    const neg = ms < 0;
    const a = Math.abs(ms);
    const total = secs ? Math.floor(a / SEC) : Math.round(a / MIN) * 60;
    const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
    return (neg ? '−' : '') + (secs ? `${h}:${pad(m)}:${pad(s)}` : `${h}:${pad(m)}`);
  }
  // "12 min" under an hour, otherwise "1:12"
  function fmtGap(ms) {
    const a = Math.abs(ms);
    return a < HOUR ? `${Math.round(a / MIN)} min` : `${fmtDur(a)} hr`;
  }
  // 1D 10H 19M 57S style countdown
  function fmtCountdown(ms) {
    const t = Math.max(0, Math.floor(Math.abs(ms) / SEC));
    const d = Math.floor(t / 86400), h = Math.floor((t % 86400) / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
    return `${d ? d + 'D ' : ''}${h}H ${pad(m)}M ${pad(sec)}S`;
  }
  function eventStartMs() { return parseLocal(state.settings.eventStart); }
  function dayOffset(ms) {
    const es = eventStartMs();
    if (!isNum(es)) return 0;
    const a = new Date(ms), b = new Date(es);
    const da = new Date(a.getFullYear(), a.getMonth(), a.getDate());
    const db = new Date(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((da - db) / DAY);
  }
  // 6:00 AM (prefixed with weekday when not on the event's first day)
  function clock(ms, opts = {}) {
    if (!isNum(ms)) return '—';
    const d = new Date(ms);
    const h = d.getHours();
    let s = `${h % 12 || 12}:${pad(d.getMinutes())}${opts.sec ? ':' + pad(d.getSeconds()) : ''} ${h < 12 ? 'AM' : 'PM'}`;
    if (opts.day !== false && dayOffset(ms) !== 0) s = `${WEEKDAYS[d.getDay()]} ${s}`;
    return s;
  }
  // Compact table time: 6:00a with a +1 marker for the next day (HTML)
  function clockCompact(ms) {
    if (!isNum(ms)) return '<span class="dash">—</span>';
    const d = new Date(ms);
    const h = d.getHours();
    const off = dayOffset(ms);
    const sup = off ? `<sup>${off > 0 ? '+' : ''}${off}</sup>` : '';
    return `<span class="t">${h % 12 || 12}:${pad(d.getMinutes())}<small>${h < 12 ? 'a' : 'p'}</small>${sup}</span>`;
  }
  function dateLabel(ms) {
    const d = new Date(ms);
    return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  }
  function fmtMinutes(min) {
    return min % 60 === 0 ? `${min / 60} hr` : `${min} min`;
  }
  function seriesColor(idx) { return `var(--series-${(idx % 8) + 1})`; }

  // ---------- state ----------
  function defaultState() {
    return {
      version: 4,
      settings: {
        eventStart: DEFAULT_EVENT_START,
        configured: true,
        cutoffHours: 36,
        totalLaps: 17,
        lapMiles: 1.4,
        lapFeet: 1750,
        theme: 'dark',
        scenarioId: 's1',
      },
      scenarios: defaultScenarios(),
      laps: Array.from({ length: 17 }, () => ({ start: null, end: null })),
    };
  }

  function cleanScenario(sc) {
    if (!sc || typeof sc !== 'object') return null;
    const int = (v, min, dflt) => (Number.isFinite(+v) && +v >= min ? Math.round(+v) : dflt);
    return {
      id: String(sc.id || 'sc' + Math.random().toString(36).slice(2, 8)),
      name: String(sc.name || 'Scenario').slice(0, 40),
      baseMin: int(sc.baseMin, 1, 60),
      stepMin: int(sc.stepMin, 0, 0),
      stepEvery: int(sc.stepEvery, 1, 1),
      extraMin: int(sc.extraMin, 0, 0),
      extraLaps: Array.isArray(sc.extraLaps) ? [...new Set(sc.extraLaps.map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b) : [],
    };
  }

  function normalize(raw) {
    const d = defaultState();
    const s = { ...d.settings, ...(raw && raw.settings) };
    s.totalLaps = Math.min(99, Math.max(1, Math.round(+s.totalLaps) || 17));
    s.cutoffHours = +s.cutoffHours > 0 ? +s.cutoffHours : 36;
    s.lapMiles = +s.lapMiles >= 0 ? +s.lapMiles : 1.4;
    s.lapFeet = +s.lapFeet >= 0 ? +s.lapFeet : 1750;
    if (!isNum(parseLocal(s.eventStart))) s.eventStart = d.settings.eventStart;
    // A start date that was never confirmed (the old "today" placeholder) moves to the event's real date.
    if (!s.configured) { s.eventStart = DEFAULT_EVENT_START; s.configured = true; }
    const scenarios = Array.isArray(raw && raw.scenarios) ? raw.scenarios.map(cleanScenario).filter(Boolean) : d.scenarios;
    if (((raw && raw.version) || 1) < 4) {
      scenarios.forEach((x) => {
        const rename = OLD_SCENARIO_NAMES[x.id];
        if (rename && rename.from.includes(x.name)) x.name = rename.to;
      });
    }
    const rawLaps = Array.isArray(raw && raw.laps) ? raw.laps : [];
    const laps = Array.from({ length: s.totalLaps }, (_, i) => {
      const l = rawLaps[i] || {};
      const lap = { start: isNum(l.start) ? l.start : null, end: isNum(l.end) ? l.end : null };
      if (Number.isInteger(l.mantra) && l.mantra >= 0 && l.mantra < MANTRAS.length) lap.mantra = l.mantra;
      return lap;
    });
    if (s.scenarioId && !scenarios.some((x) => x.id === s.scenarioId)) s.scenarioId = scenarios[0] ? scenarios[0].id : null;
    return { version: 4, settings: s, scenarios, laps };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return normalize(JSON.parse(raw));
    } catch (e) { /* fall through to defaults */ }
    return defaultState();
  }

  let state = load();
  let undoInfo = null;
  let lastTap = 0;

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      toast('Could not save on this device — export a backup.');
    }
  }
  // ---------- summits ----------
  function summitAscent(sm) {
    const n = state.laps.length, feet = state.settings.lapFeet;
    if (sm.final) return n;
    if (!(feet > 0)) return null;
    const a = Math.max(1, Math.round(sm.feet / feet));
    return a <= n ? a : null;
  }
  function completedAscents() {
    const i = state.laps.findIndex((l) => l.end == null);
    return i === -1 ? state.laps.length : i;
  }
  function reachedSummitIds() {
    const done = completedAscents();
    return SUMMITS.filter((sm) => { const a = summitAscent(sm); return a != null && a <= done; }).map((sm) => sm.id);
  }
  // Summits already reached when the app loads (or data is imported) are not re-announced.
  let celebrated = reachedSummitIds();

  // Save + redraw. With announce, any summit reached by this change gets its popup.
  function commit({ announce = false } = {}) {
    const reached = reachedSummitIds();
    const fresh = reached.filter((id) => !celebrated.includes(id));
    celebrated = reached;
    save();
    render();
    if (announce && fresh.length) queueSummits(fresh);
  }

  // ---------- scenarios ----------
  function scenarioSlots(sc, n) {
    return Array.from({ length: n }, (_, i) =>
      (sc.baseMin + sc.stepMin * Math.floor(i / sc.stepEvery) + (sc.extraLaps.includes(i + 1) ? sc.extraMin : 0)) * MIN);
  }
  function scenarioPlan(sc, n, start) {
    const slots = scenarioSlots(sc, n);
    const starts = [];
    let t = start;
    for (let i = 0; i < n; i++) { starts.push(t); t += slots[i]; }
    return { sc, slots, starts, finish: t, doneBy: (i) => (i + 1 < n ? starts[i + 1] : t) };
  }
  function scenarioSummary(sc) {
    let s = `Start an ascent every ${fmtMinutes(sc.baseMin)}`;
    if (sc.stepMin) s += `, adding ${sc.stepMin} min every ${plural(sc.stepEvery, 'ascent')}`;
    if (sc.extraMin && sc.extraLaps.length) s += ` · +${sc.extraMin} min meal/rest on ascents ${sc.extraLaps.join(', ')}`;
    return s;
  }
  const activeScenario = () => state.scenarios.find((x) => x.id === state.settings.scenarioId) || null;

  // ---------- derived model ----------
  function model(now = Date.now()) {
    const s = state.settings, L = state.laps, N = L.length;
    const eventStart = eventStartMs();
    const cutoff = eventStart + s.cutoffHours * HOUR;
    let cur = L.findIndex((l) => l.end == null);
    if (cur === -1) cur = N;
    const done = cur;
    const phase = cur >= N ? 'done' : L[cur].start != null ? 'lap' : cur === 0 ? 'pre' : 'rest';

    const dur = L.map((l) => (l.start != null && l.end != null ? l.end - l.start : null));
    const brk = L.map((l, i) => (i < N - 1 && l.end != null && L[i + 1].start != null ? L[i + 1].start - l.end : null));
    const lapDurs = dur.slice(0, done).filter(isNum);
    const breaks = brk.filter(isNum);

    // Prediction basis: the previous 2 completed laps (lap time, and the break after each)
    const avgLap = mean(lapDurs.slice(-2));
    const avgBreak = breaks.length ? mean(breaks.slice(-2)) : 0;
    const avgCycle = avgLap != null ? avgLap + avgBreak : null;
    const basis = done >= 2 ? `ascents ${done - 1}–${done}` : done === 1 ? 'ascent 1' : '';

    let lapEst = null, finalEst = null;
    if (phase === 'lap' && avgLap != null) {
      lapEst = L[cur].start + avgLap;
      const curEnd = Math.max(lapEst, now);
      finalEst = curEnd + (N - 1 - cur) * avgCycle;
    } else if (phase === 'rest' && avgLap != null) {
      const nextStart = Math.max(now, L[cur - 1].end + avgBreak);
      lapEst = now + avgLap; // if the next lap started right now
      finalEst = nextStart + (N - 1 - cur) * avgCycle + avgLap;
    } else if (phase === 'done') {
      finalEst = L[N - 1].end;
    }

    let needPer = null;
    if (phase !== 'done') {
      const from = phase === 'lap' ? L[cur].start : Math.max(now, eventStart);
      needPer = (cutoff - from) / (N - cur);
    }

    const sc = activeScenario();
    const goal = sc && isNum(eventStart) ? scenarioPlan(sc, N, eventStart) : null;

    return {
      now, N, eventStart, cutoff, cur, done, phase, dur, brk,
      totalLap: sum(dur), totalBreak: sum(brk), breakCount: breaks.length, lapDurs,
      avgLap, avgBreak, avgCycle, basis, lapEst, finalEst, needPer, goal,
      miles: done * s.lapMiles, feet: done * s.lapFeet,
    };
  }

  // ---------- rendering ----------
  function render() {
    const m = model();
    applyTheme();
    renderHeader(m);
    renderSetup();
    renderGoalPicker();
    renderTotals(m);
    renderTable(m);
    renderChart(m);
    renderActionBar(m);
    renderScenarioList();
    renderSummits(m);
    tick();
  }

  function tick() {
    const m = model();
    renderStrip(m);
    renderStatus(m);
    renderGoalStatus(m);
    renderProjection(m);
    $$('[data-since]').forEach((el) => { el.textContent = fmtDur(m.now - +el.dataset.since, el.dataset.sec === '1'); });
  }

  function renderHeader(m) {
    const s = state.settings;
    $('#eventLine').textContent = isNum(m.eventStart)
      ? `${dateLabel(m.eventStart)} · ${clock(m.eventStart, { day: false })} start · ${s.cutoffHours} hr limit`
      : 'Set your event start in Settings';
  }

  function renderStrip(m) {
    const strip = $('#strip');
    if (!isNum(m.eventStart)) { strip.textContent = ''; return; }
    let label, timer;
    if (m.phase === 'done') {
      const end = state.laps[m.N - 1].end, margin = m.cutoff - end;
      label = `Finished ${clock(end)} ·`;
      timer = `${fmtCountdown(margin)} ${margin >= 0 ? 'under' : 'over'} cutoff`;
    } else if (m.now < m.eventStart) {
      label = `Start ${dateLabel(m.eventStart)} ${clock(m.eventStart, { day: false })} ·`;
      timer = fmtCountdown(m.eventStart - m.now);
    } else if (m.now < m.cutoff) {
      label = `Cutoff ${clock(m.cutoff)} ·`;
      timer = fmtCountdown(m.cutoff - m.now);
    } else {
      label = 'Cutoff passed ·';
      timer = `+${fmtCountdown(m.now - m.cutoff)}`;
    }
    strip.innerHTML = `${esc(label)}<span class="strip-timer">${esc(timer)}</span>`;
  }

  function renderSetup() {
    const box = $('#setup');
    box.hidden = !!state.settings.configured;
    if (!box.hidden && !$('#setupDate').value) {
      $('#setupDate').value = state.settings.eventStart.slice(0, 10);
      $('#setupTime').value = state.settings.eventStart.slice(11, 16);
    }
  }

  function renderStatus(m) {
    const L = state.laps;
    let cls = m.phase, label, hero, sub;
    if (m.phase === 'pre') {
      if (m.now < m.eventStart) {
        label = 'Waiting for the start';
        const wait = m.eventStart - m.now;
        // More than a day out: show 4D 6H 10M so it fits the card
        hero = wait >= DAY ? fmtCountdown(wait).replace(/ \d+S$/, '') : fmtDur(wait, true);
        sub = `until the ${clock(m.eventStart)} start`;
      } else {
        label = 'Event underway';
        hero = fmtDur(m.now - m.eventStart, true);
        sub = 'since the start · tap Start Ascent 1 when you head up';
      }
    } else if (m.phase === 'lap') {
      label = `Ascent ${m.cur + 1} of ${m.N} · climbing`;
      hero = fmtDur(m.now - L[m.cur].start, true);
      sub = `Started ${clock(L[m.cur].start)}${m.lapEst ? ` · est. finish ${clock(m.lapEst)}` : ''}`;
    } else if (m.phase === 'rest') {
      label = `Break after ascent ${m.cur} of ${m.N}`;
      hero = fmtDur(m.now - L[m.cur - 1].end, true);
      sub = `Ascent ${m.cur} took ${fmtDur(m.dur[m.cur - 1])}, finished ${clock(L[m.cur - 1].end)}`;
    } else {
      label = 'All ascents complete';
      hero = fmtDur(L[m.N - 1].end - m.eventStart, true);
      sub = `Finished ${clock(L[m.N - 1].end)} — total time from the start`;
    }

    const endRef = m.phase === 'done' ? L[m.N - 1].end : m.now;
    const raceClock = endRef >= m.eventStart ? fmtDur(endRef - m.eventStart, true) : '—';

    const segs = Array.from({ length: m.N }, (_, i) =>
      `<i class="${i < m.done ? 'done' : i === m.cur && m.phase === 'lap' ? 'cur' : ''}"></i>`).join('');

    $('#status').innerHTML = `
      <span class="phase ${cls}">${esc(label)}</span>
      <div class="hero-time${hero.length > 8 ? ' long' : ''}">${hero}</div>
      <p class="hero-sub">${esc(sub)}</p>
      ${m.phase === 'lap' && isNum(L[m.cur].mantra) ? `<p class="hero-mantra">${esc(MANTRAS[L[m.cur].mantra])}</p>` : ''}
      <div class="hero-meta">
        <div><div class="meta-k">Race clock</div><div class="meta-v">${raceClock}</div></div>
        <div><div class="meta-k">Distance</div><div class="meta-v">${m.miles.toFixed(1)}<span class="unit">mi</span></div></div>
      </div>
      <div class="progress" aria-hidden="true">${segs}</div>
      <div class="progress-label"><span>${m.done} / ${m.N} ascents</span><span>${m.feet.toLocaleString()} / ${(m.N * state.settings.lapFeet).toLocaleString()} ft</span></div>`;
  }

  function renderGoalPicker() {
    const sel = state.settings.scenarioId;
    const btns = [`<button type="button" data-sc="" aria-pressed="${!sel}"><span class="key"></span>Off</button>`]
      .concat(state.scenarios.map((sc, idx) =>
        `<button type="button" data-sc="${esc(sc.id)}" aria-pressed="${sc.id === sel}"><span class="key" style="--c:${seriesColor(idx)}"></span>${esc(sc.name)}</button>`));
    $('#goalPicker').innerHTML = btns.join('');
    const sc = activeScenario();
    $('#goalSummary').textContent = sc ? scenarioSummary(sc) : '';
    $('#goalSummary').hidden = !sc;
  }

  function deltaHTML(ms, words = ['ahead', 'behind']) {
    if (Math.abs(ms) < MIN) return `<span class="delta even">On schedule</span>`;
    const ahead = ms > 0;
    return `<span class="delta ${ahead ? 'good' : 'bad'}"><span class="icon" aria-hidden="true">${ahead ? '▲' : '▼'}</span>${fmtGap(ms)} ${ahead ? words[0] : words[1]}</span>`;
  }

  function renderGoalStatus(m) {
    const box = $('#goalStatus');
    const g = m.goal, L = state.laps;
    if (!g) {
      box.innerHTML = '<p class="goal-line">Pick a scenario to compare your ascents against a goal schedule.</p>';
      return;
    }
    let html = '';
    if (m.phase === 'pre') {
      html = `<p class="goal-line">Goal: start ascent 1 at <b>${clock(g.starts[0])}</b></p>`;
    } else if (m.phase === 'lap') {
      const d = g.starts[m.cur] - L[m.cur].start;
      html = deltaHTML(d) + `<p class="goal-line">at the start of ascent ${m.cur + 1} (goal ${clock(g.starts[m.cur])})</p>`;
      const by = g.doneBy(m.cur);
      const nextWord = m.cur + 1 < m.N ? `Goal: start ascent ${m.cur + 2} by` : 'Goal finish';
      html += `<p class="goal-line">${nextWord} <b>${clock(by)}</b>${m.lapEst ? ` · est. finish ${clock(m.lapEst)}` : ''}</p>`;
    } else if (m.phase === 'rest') {
      const d = g.starts[m.cur] - m.now;
      html = deltaHTML(d, ['in hand', 'behind']) +
        `<p class="goal-line">Goal: start ascent ${m.cur + 1} by <b>${clock(g.starts[m.cur])}</b></p>`;
    } else {
      const d = g.finish - L[m.N - 1].end;
      html = deltaHTML(d) + `<p class="goal-line">vs. goal finish ${clock(g.finish)}</p>`;
    }
    if (m.phase !== 'done') {
      html += `<p class="goal-line">Goal finish <b>${clock(g.finish)}</b> (${fmtDur(g.finish - m.eventStart)})${isNum(m.finalEst) ? ` · projected ${clock(m.finalEst)}` : ''}</p>`;
    }
    box.innerHTML = `<div class="goal-status">${html}</div>`;
  }

  function renderProjection(m) {
    const rows = [];
    const L = state.laps;
    const row = (k, ksub, v, vsub = '', vcls = '') =>
      `<div class="row"><dt>${k}${ksub ? `<small>${ksub}</small>` : ''}</dt><dd>${v}${vsub ? `<small class="${vcls}">${vsub}</small>` : ''}</dd></div>`;

    if (m.phase === 'done') {
      const margin = m.cutoff - m.finalEst;
      rows.push(row('Finished', `${m.N} ascents`, clock(m.finalEst), `${fmtDur(Math.abs(margin))} ${margin >= 0 ? 'under' : 'over'} the limit`, margin >= 0 ? 'good' : 'bad'));
    } else {
      if (m.avgLap == null) {
        rows.push(row('Finish projection', 'Appears after your first ascent', '—'));
      } else {
        const basis = `avg ascent ${fmtDur(m.avgLap)}${m.breakCount ? ` + break ${fmtDur(m.avgBreak)}` : ''} · ${m.basis}`;
        const isLast = m.cur === m.N - 1;
        if (!isLast) {
          if (m.phase === 'lap') rows.push(row(`Ascent ${m.cur + 1} est. finish`, `avg of ${m.basis}`, clock(m.lapEst), `in ${fmtDur(Math.max(0, m.lapEst - m.now))}`));
          else rows.push(row(`Ascent ${m.cur + 1} if you start now`, `avg of ${m.basis}`, clock(m.lapEst), `${fmtDur(m.avgLap)} ascent`));
        }
        const margin = m.cutoff - m.finalEst;
        rows.push(row(isLast ? `Final ascent est. finish` : `Ascent ${m.N} (final) est. finish`, basis, clock(m.finalEst),
          `${fmtDur(Math.abs(margin))} ${margin >= 0 ? 'before' : 'after'} cutoff`, margin >= 0 ? 'good' : 'bad'));
      }
      if (isNum(m.needPer)) {
        const lapsLeft = m.N - m.cur;
        rows.push(row('Pace to make the cutoff', `start-to-start, ${plural(lapsLeft, 'ascent')} left`,
          m.needPer > 0 ? `≤ ${fmtDur(m.needPer)}` : 'Past cutoff', 'per ascent incl. break'));
      }
    }
    $('#projection').innerHTML = `<dl class="rows">${rows.join('')}</dl>`;
  }

  function renderTotals(m) {
    const s = state.settings;
    const tile = (k, v, unit, sub) =>
      `<div class="stat"><div class="stat-k">${k}</div><div class="stat-v">${v}${unit ? `<span class="unit">${unit}</span>` : ''}</div><div class="stat-s">${sub}</div></div>`;
    const fastest = m.lapDurs.length ? Math.min(...m.lapDurs) : null;
    const slowest = m.lapDurs.length ? Math.max(...m.lapDurs) : null;
    $('#totals').innerHTML = [
      tile('Ascents done', m.done, ` / ${m.N}`, m.done >= m.N ? 'All done' : `${m.N - m.done} to go`),
      tile('Total mileage', m.miles.toFixed(1), ' mi', `of ${(m.N * s.lapMiles).toFixed(1)} mi`),
      tile('Total elevation', m.feet.toLocaleString(), ' ft', `of ${(m.N * s.lapFeet).toLocaleString()} ft`),
      tile('Total ascent time', fmtDur(m.totalLap), '', m.lapDurs.length ? `avg ${fmtDur(m.totalLap / m.lapDurs.length)} per ascent` : 'No ascents yet'),
      tile('Time between ascents', fmtDur(m.totalBreak), '', m.breakCount ? `${plural(m.breakCount, 'break')} · avg ${fmtDur(m.totalBreak / m.breakCount)}` : 'No breaks yet'),
      tile('Fastest / slowest', fastest != null ? `${fmtDur(fastest)} / ${fmtDur(slowest)}` : '—', '', 'ascent time'),
    ].join('');
  }

  function renderTable(m) {
    const L = state.laps, g = m.goal;
    const head = `<thead><tr><th scope="col">Ascent</th><th scope="col">Start</th><th scope="col">End</th><th scope="col">Ascent time</th><th scope="col">Break</th>${g ? '<th scope="col">Goal</th><th scope="col">±</th>' : ''}</tr></thead>`;
    const rows = L.map((l, i) => {
      const editable = i <= m.cur;
      const cls = [i < m.done ? 'is-done' : i === m.cur && m.phase !== 'done' ? 'is-current' : 'is-future', editable ? 'editable' : ''].join(' ');
      const lapCell = editable
        ? `<button type="button" class="lapbtn" data-edit="${i}" aria-label="Edit ascent ${i + 1}">${i + 1}</button>`
        : `${i + 1}`;
      const end = l.end != null ? clockCompact(l.end) : i === m.cur && m.phase === 'lap' ? '<span class="live">…</span>' : '<span class="dash">—</span>';
      const lapTime = m.dur[i] != null ? fmtDur(m.dur[i])
        : i === m.cur && m.phase === 'lap' ? `<span class="live" data-since="${l.start}">${fmtDur(m.now - l.start)}</span>` : '<span class="dash">—</span>';
      const brk = m.brk[i] != null ? fmtDur(m.brk[i])
        : m.phase === 'rest' && i === m.cur - 1 ? `<span class="live" data-since="${l.end}">${fmtDur(m.now - l.end)}</span>` : '<span class="dash">—</span>';
      let goalCells = '';
      if (g) {
        let pm = '<span class="dash">—</span>';
        if (l.start != null) {
          const dm = Math.round((g.starts[i] - l.start) / MIN);
          const mag = Math.abs(dm) >= 60 ? `${Math.floor(Math.abs(dm) / 60)}:${pad(Math.abs(dm) % 60)}` : Math.abs(dm);
          pm = `<span class="pm ${dm > 0 ? 'good' : dm < 0 ? 'bad' : ''}">${dm > 0 ? '+' : dm < 0 ? '−' : ''}${mag}</span>`;
        }
        goalCells = `<td class="goalcol">${clockCompact(g.starts[i])}</td><td>${pm}</td>`;
      }
      return `<tr class="${cls}" data-i="${i}"><th scope="row">${lapCell}</th><td>${clockCompact(l.start)}</td><td>${end}</td><td>${lapTime}</td><td>${brk}</td>${goalCells}</tr>`;
    }).join('');
    const foot = `<tfoot><tr><th scope="row" colspan="3">Total</th><td>${fmtDur(m.totalLap)}</td><td>${fmtDur(m.totalBreak)}</td>${g ? `<td class="goalcol">${clockCompact(g.finish)}</td><td></td>` : ''}</tr></tfoot>`;
    $('#lapTable').innerHTML = head + `<tbody>${rows}</tbody>` + foot;
  }

  function renderActionBar(m) {
    const btn = $('#mainBtn');
    if (btn.classList.contains('recorded')) return;
    const flag = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4m0 0h11l-2 4 2 4H5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/></svg>';
    const up = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 19 6-10 4 6 2-3 6 7H3Z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>';
    btn.disabled = m.phase === 'done';
    btn.classList.toggle('finish', m.phase === 'lap');
    if (m.phase === 'done') btn.innerHTML = 'All ascents done';
    else if (m.phase === 'lap') btn.innerHTML = `${flag}Finish Ascent ${m.cur + 1}`;
    else btn.innerHTML = `${up}Start Ascent ${m.cur + 1}`;
  }

  // ---------- chart ----------
  let chartGeo = null;
  let lastChartWidth = 0;

  function renderChart(m = model()) {
    const box = $('#chartBox');
    const W = Math.max(280, Math.round(box.clientWidth || 340));
    lastChartWidth = W;
    const H = 240;
    const P = { l: 34, r: 14, t: 14, b: 26 };
    const N = m.N, es = m.eventStart, L = state.laps;
    const hrs = (ms) => (ms - es) / HOUR;
    const selId = state.settings.scenarioId;

    const scen = state.scenarios.map((sc, idx) => {
      const plan = scenarioPlan(sc, N, es);
      const pts = [[0, 0]].concat(plan.starts.slice(1).map((t, i) => [i + 1, hrs(t)]), [[N, hrs(plan.finish)]]);
      return { sc, idx, pts, color: seriesColor(idx), selected: sc.id === selId };
    });
    const actual = [];
    if (L[0].start != null) actual.push([0, hrs(L[0].start)]);
    for (let i = 0; i < m.done; i++) actual.push([i + 1, hrs(L[i].end)]);
    const proj = m.phase !== 'done' && isNum(m.finalEst) && actual.length ? [actual[actual.length - 1], [N, hrs(m.finalEst)]] : null;

    const cutoffH = state.settings.cutoffHours;
    const ys = [cutoffH, ...scen.flatMap((s) => s.pts.map((p) => p[1])), ...actual.map((p) => p[1]), ...(proj ? [proj[1][1]] : [])];
    const yStep = Math.max(...ys) > 48 ? 12 : 6;
    const yMax = Math.ceil(Math.max(...ys) / yStep) * yStep || yStep;
    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    const x = (v) => P.l + (v / N) * iw;
    const y = (v) => P.t + ih - (Math.max(0, v) / yMax) * ih;
    const path = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');

    let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Chart of elapsed hours at the end of each ascent, compared with goal scenarios">`;
    for (let v = 0; v <= yMax; v += yStep) {
      svg += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" style="stroke:${v === 0 ? 'var(--axis)' : 'var(--hair)'}" stroke-width="1"/>`;
      svg += `<text x="${P.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}h</text>`;
    }
    const xEvery = iw / N >= 20 ? 1 : 2;
    for (let i = 0; i <= N; i++) {
      if ((i % xEvery === 0 && N - i >= xEvery) || i === N) svg += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${i}</text>`;
    }
    // cutoff reference
    svg += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(cutoffH)}" y2="${y(cutoffH)}" style="stroke:var(--ink)" stroke-width="1" opacity="0.5"/>`;
    svg += `<text class="ref" x="${P.l + 4}" y="${y(cutoffH) - 6}" text-anchor="start">${cutoffH} HR CUTOFF</text>`;
    // scenarios: unselected first, faded
    scen.filter((s) => !s.selected).forEach((s) => {
      svg += `<path d="${path(s.pts)}" fill="none" style="stroke:${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" opacity="0.35"/>`;
    });
    scen.filter((s) => s.selected).forEach((s) => {
      svg += `<path d="${path(s.pts)}" fill="none" style="stroke:${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    });
    if (proj) {
      svg += `<path d="${path(proj)}" fill="none" style="stroke:var(--ink)" stroke-width="2" stroke-dasharray="5 5" stroke-linecap="round" opacity="0.6"/>`;
      svg += `<circle cx="${x(proj[1][0])}" cy="${y(proj[1][1])}" r="4" style="fill:var(--surface);stroke:var(--ink)" stroke-width="2"/>`;
    }
    if (actual.length) {
      svg += `<path d="${path(actual)}" fill="none" style="stroke:var(--ink)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      actual.forEach((p) => {
        svg += `<circle cx="${x(p[0])}" cy="${y(p[1])}" r="6" style="fill:var(--surface)"/><circle cx="${x(p[0])}" cy="${y(p[1])}" r="4" style="fill:var(--ink)"/>`;
      });
    }
    svg += `<line id="crosshair" x1="0" x2="0" y1="${P.t}" y2="${H - P.b}" style="stroke:var(--ink-2)" stroke-width="1" visibility="hidden"/>`;
    svg += `</svg>`;
    box.innerHTML = svg + '<div class="tip" id="chartTip" hidden></div>';
    box.tabIndex = 0;
    box.setAttribute('aria-label', 'Chart. Use left and right arrow keys to read each ascent.');
    chartGeo = { W, H, P, N, x, scen, actual, proj, es, hovered: null };

    // legend
    const leg = $('#chartLegend');
    leg.textContent = '';
    const addKey = (label, color, opts = {}) => {
      const span = document.createElement('span');
      if (opts.sel) span.className = 'sel';
      if (opts.faded) span.className = 'faded';
      const k = document.createElement('i');
      k.className = 'lk' + (opts.dashed ? ' dashed' : '');
      k.style.setProperty('--c', color);
      span.append(k, document.createTextNode(label));
      leg.append(span);
    };
    addKey('You', 'var(--ink)', { sel: true });
    if (proj) addKey('Projected', 'var(--ink)', { dashed: true });
    scen.forEach((s) => addKey(s.sc.name, s.color, { sel: s.selected, faded: !s.selected }));
  }

  function showChartTip(idx) {
    const g = chartGeo;
    if (!g) return;
    idx = Math.max(0, Math.min(g.N, idx));
    g.hovered = idx;
    const box = $('#chartBox'), tip = $('#chartTip'), cross = $('#crosshair');
    if (!tip || !cross) return;
    const cx = g.x(idx);
    cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
    tip.textContent = '';
    const h = document.createElement('div');
    h.className = 'tip-h';
    h.textContent = idx === 0 ? 'Start of ascent 1' : `End of ascent ${idx}`;
    tip.append(h);
    const addRow = (color, value, label, dashed) => {
      const r = document.createElement('div'); r.className = 'tip-r';
      const k = document.createElement('i'); k.className = 'lk' + (dashed ? ' dashed' : ''); k.style.setProperty('--c', color);
      const v = document.createElement('strong'); v.textContent = value;
      const l = document.createElement('span'); l.textContent = label;
      r.append(k, v, l); tip.append(r);
    };
    const fmtPt = (h) => `${fmtDur(h * HOUR)} · ${clock(g.es + h * HOUR)}`;
    const a = g.actual.find((p) => p[0] === idx);
    if (a) addRow('var(--ink)', fmtPt(a[1]), 'You');
    if (g.proj && idx === g.N) addRow('var(--ink)', fmtPt(g.proj[1][1]), 'Projected', true);
    g.scen.forEach((s) => addRow(s.color, fmtPt(s.pts[idx][1]), s.sc.name + (idx === 0 ? '' : idx === g.N ? ' finish' : ' goal')));
    tip.hidden = false;
    const bw = box.clientWidth, tw = tip.offsetWidth;
    const px = (cx / g.W) * bw;
    let left = px + 12;
    if (left + tw > bw) left = px - tw - 12;
    tip.style.left = `${Math.max(0, left)}px`;
  }
  function hideChartTip() {
    const tip = $('#chartTip'), cross = $('#crosshair');
    if (tip) tip.hidden = true;
    if (cross) cross.setAttribute('visibility', 'hidden');
    if (chartGeo) chartGeo.hovered = null;
  }
  function chartIndexFromEvent(e) {
    const g = chartGeo, box = $('#chartBox');
    const rect = box.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * g.W;
    return Math.round(((sx - g.P.l) / (g.W - g.P.l - g.P.r)) * g.N);
  }

  // ---------- summit popup + checklist ----------
  const summitQueue = [];
  function queueSummits(ids) {
    summitQueue.push(...ids);
    if (!$('#summitDialog').open) showNextSummit();
  }
  function showNextSummit() {
    const id = summitQueue.shift();
    if (!id) return;
    const idx = SUMMITS.findIndex((x) => x.id === id);
    const sm = SUMMITS[idx];
    $('#summitEyebrow').textContent = `Summit ${idx + 1} of ${SUMMITS.length} · Ascent ${summitAscent(sm)}`;
    const h = $('#summitMsg');
    h.textContent = 'Congrats on summiting ';
    const em = document.createElement('em');
    em.textContent = `${sm.name}!`;
    h.append(em);
    $('#summitMeta').textContent = `${sm.where} · ${sm.feet.toLocaleString()} ft`;
    $('#summitBtn').textContent = summitQueue.length ? 'Next summit' : sm.final ? 'Close' : 'Keep climbing';
    launchConfetti();
    $('#summitDialog').showModal();
  }
  function launchConfetti() {
    const box = $('#confetti');
    box.textContent = '';
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const colors = ['#e52726', '#c9a14f', '#31bcaf', '#ffffff'];
    for (let i = 0; i < 42; i++) {
      const p = document.createElement('i');
      p.style.left = `${(Math.random() * 100).toFixed(1)}%`;
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = `${(Math.random() * 0.7).toFixed(2)}s`;
      p.style.animationDuration = `${(1.8 + Math.random() * 1.6).toFixed(2)}s`;
      p.style.setProperty('--x', `${Math.round(Math.random() * 80 - 40)}px`);
      p.style.setProperty('--r', `${Math.round(Math.random() * 900 - 450)}deg`);
      box.append(p);
    }
  }

  const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square"/></svg>';

  function renderSummits(m) {
    const L = state.laps;
    const rows = SUMMITS.map((sm) => ({ sm, a: summitAscent(sm) }));
    const reached = rows.filter((r) => r.a != null && r.a <= m.done);
    const next = rows.find((r) => r.a != null && r.a > m.done);
    $('#summitsSub').innerHTML = `<b>${reached.length}</b> of ${SUMMITS.length} summits reached` +
      (next ? ` · next: <b>${rows.filter((r) => r.a === next.a).map((r) => esc(r.sm.name)).join(' &amp; ')}</b> after ascent ${next.a}`
        : reached.length === SUMMITS.length ? ' · all Seven Summits!' : '');
    $('#summitList').innerHTML = rows.map(({ sm, a }) => {
      const done = a != null && a <= m.done;
      const isNext = !done && next && a === next.a;
      let status;
      if (a == null) status = 'Not on this course';
      else if (done) status = `Reached ${clock(L[a - 1].end)}`;
      else if (isNext && m.phase === 'lap' && m.cur + 1 === a) status = 'This ascent';
      else status = `${plural(a - m.done, 'ascent')} to go`;
      return `<li class="${done ? 'reached' : isNext ? 'next' : ''}">
        <span class="check">${CHECK}</span>
        <div class="s-info"><div class="s-name">${esc(sm.name)}</div><div class="s-meta">${esc(sm.where)} · ${sm.feet.toLocaleString()} ft</div></div>
        <div class="s-status"><div class="s-asc">${a != null ? `Ascent ${a}` : ''}</div><div class="s-when">${status}</div></div>
      </li>`;
    }).join('');
    const feet = state.settings.lapFeet;
    $('#summitsNote').textContent = feet > 0
      ? `Each summit is checked off after the ascent whose total climb is closest to its height (${feet.toLocaleString()} ft per ascent). Everest is the final ascent.`
      : 'Set the feet climbed per ascent in Settings to place the summits.';
  }

  // ---------- ascent mantras ----------
  // Gives ascent i a mantra if it doesn't have one yet (an undone-then-restarted ascent keeps its own).
  function assignMantra(i) {
    const lap = state.laps[i];
    if (isNum(lap.mantra)) return;
    const used = new Set(state.laps.map((l) => l.mantra).filter(isNum));
    let pool = MANTRAS.map((_, k) => k).filter((k) => !used.has(k));
    if (!pool.length) pool = MANTRAS.map((_, k) => k); // more ascents than mantras: start the list over
    lap.mantra = pool[Math.floor(Math.random() * pool.length)];
  }
  function showMantra(i) {
    const k = state.laps[i].mantra;
    if (!isNum(k)) return;
    $('#mantraEyebrow').textContent = `Ascent ${i + 1} of ${state.laps.length} · your mantra`;
    const text = $('#mantraText');
    text.textContent = MANTRAS[k];
    text.className = MANTRAS[k].length > 34 ? 'long' : '';
    $('#mantraDialog').showModal();
  }

  // ---------- actions ----------
  function vibrate() { try { navigator.vibrate && navigator.vibrate(40); } catch (e) { /* unsupported */ } }

  function onMainButton() {
    const now = Date.now();
    if (now - lastTap < TAP_LOCK_MS) return;
    const m = model(now);
    if (m.phase === 'done') return;
    const i = m.cur;
    const field = m.phase === 'lap' ? 'end' : 'start';
    state.laps[i][field] = now;
    if (field === 'start') assignMantra(i);
    lastTap = now;
    undoInfo = { i, field, at: now };
    commit({ announce: true });
    if (field === 'start') showMantra(i);
    vibrate();
    const btn = $('#mainBtn');
    btn.classList.add('recorded');
    btn.innerHTML = `✓ Ascent ${i + 1} ${field === 'start' ? 'started' : 'finished'}`;
    setTimeout(() => { btn.classList.remove('recorded'); renderActionBar(model()); }, 1600);
    toast(`Ascent ${i + 1} ${field === 'start' ? 'started' : 'finished'} at ${clock(now, { sec: true })}`, 'Undo', () => {
      if (undoInfo && state.laps[undoInfo.i][undoInfo.field] === undoInfo.at) {
        state.laps[undoInfo.i][undoInfo.field] = null;
        undoInfo = null;
        lastTap = 0;
        commit();
        toast('Undone');
      }
    });
  }

  let toastTimer = null;
  function toast(msg, actionLabel, action) {
    const t = $('#toast'), b = $('#toastAction');
    $('#toastMsg').textContent = msg;
    b.hidden = !actionLabel;
    b.textContent = actionLabel || '';
    b.onclick = action ? () => { hideToast(); action(); } : null;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, actionLabel ? 10000 : 3000);
  }
  function hideToast() { $('#toast').hidden = true; }

  // ---------- confirmation ----------
  // In-app replacement for window.confirm(), which some browsers and app shells block (it then returns false).
  // The answer is delivered straight from the button tap, not from the dialog's (deferrable) close event.
  let confirmAnswer = null;
  function askConfirm(title, message, yesLabel = 'Confirm') {
    $('#confirmTitle').textContent = title;
    $('#confirmMsg').textContent = message;
    $('#confirmYes').textContent = yesLabel;
    if (confirmAnswer) confirmAnswer(false);
    return new Promise((resolve) => {
      confirmAnswer = resolve;
      $('#confirmDialog').showModal();
    });
  }
  function answerConfirm(yes) {
    const resolve = confirmAnswer;
    confirmAnswer = null;
    if ($('#confirmDialog').open) $('#confirmDialog').close();
    if (resolve) resolve(yes);
  }

  // ---------- edit dialog ----------
  let edit = null;

  function openEdit(i, prefillNow = false) {
    const m = model();
    if (i >= m.N) i = m.N - 1;
    const l = state.laps[i];
    edit = { i, start: l.start, end: l.end };
    if (prefillNow) {
      if (l.start == null) edit.start = Date.now();
      else if (l.end == null) edit.end = Date.now();
    }
    $('#editTitle').textContent = `Ascent ${i + 1}`;
    $('#editGoal').textContent = m.goal ? `${m.goal.sc.name} goal: start ${clock(m.goal.starts[i])}, next ascent by ${clock(m.goal.doneBy(i))}` : '';
    $('#editError').textContent = '';
    syncEdit(true);
    $('#editDialog').showModal();
  }

  function syncEdit(setInputs) {
    for (const f of ['start', 'end']) {
      const input = $(f === 'start' ? '#editStart' : '#editEnd');
      const v = edit[f];
      if (setInputs) input.value = toLocalInput(v);
      $(f === 'start' ? '#editStartRead' : '#editEndRead').textContent =
        v == null ? 'Not recorded' : `${WEEKDAYS[new Date(v).getDay()]} ${clock(v, { sec: true, day: false })}`;
    }
    $('#editDuration').textContent = edit.start != null && edit.end != null ? `Ascent time ${fmtDur(edit.end - edit.start, true)}` : '';
  }

  function validateLap(i, start, end) {
    const L = state.laps;
    if (start == null && end != null) return 'Add a start time before the end time.';
    if (start != null && end != null && end <= start) return 'End time must be after the start time.';
    if (i > 0 && start != null && L[i - 1].end == null) return `Ascent ${i} needs an end time first.`;
    if (i > 0 && start != null && start < L[i - 1].end) return `Start is before ascent ${i} ended (${clock(L[i - 1].end)}).`;
    const next = L[i + 1];
    if (next && next.start != null) {
      if (end == null) return `Ascent ${i + 2} has already started, so this ascent needs an end time.`;
      if (end > next.start) return `End is after ascent ${i + 2} started (${clock(next.start)}).`;
    }
    return null;
  }

  // ---------- settings ----------
  function openSettings() {
    const s = state.settings;
    $('#setDate').value = s.eventStart.slice(0, 10);
    $('#setTime').value = s.eventStart.slice(11, 16);
    $('#setCutoff').value = s.cutoffHours;
    $('#setLaps').value = s.totalLaps;
    $('#setMiles').value = s.lapMiles;
    $('#setFeet').value = s.lapFeet;
    $('#setTheme').value = s.theme;
    $('#settingsError').textContent = '';
    renderScenarioList();
    $('#settingsDialog').showModal();
  }

  function applySetting(id) {
    const s = state.settings;
    const err = (msg) => { $('#settingsError').textContent = msg; openSettingsValues(); };
    $('#settingsError').textContent = '';
    if (id === 'setDate' || id === 'setTime') {
      const v = `${$('#setDate').value}T${$('#setTime').value || '06:00'}`;
      if (!isNum(parseLocal(v))) return err('Enter a valid date and start time.');
      s.eventStart = v;
      s.configured = true;
    } else if (id === 'setCutoff') {
      const v = +$('#setCutoff').value;
      if (!(v > 0)) return err('Time limit must be more than 0 hours.');
      s.cutoffHours = v;
    } else if (id === 'setLaps') {
      const n = Math.round(+$('#setLaps').value);
      if (!(n >= 1 && n <= 99)) return err('Ascents must be between 1 and 99.');
      if (n < state.laps.length && state.laps.slice(n).some((l) => l.start != null || l.end != null)) {
        return err(`Ascents ${n + 1}+ already have times. Clear them first.`);
      }
      while (state.laps.length < n) state.laps.push({ start: null, end: null });
      state.laps.length = n;
      s.totalLaps = n;
    } else if (id === 'setMiles') {
      const v = +$('#setMiles').value;
      if (!(v >= 0)) return err('Enter a distance of 0 or more.');
      s.lapMiles = v;
    } else if (id === 'setFeet') {
      const v = +$('#setFeet').value;
      if (!(v >= 0)) return err('Enter an elevation of 0 or more.');
      s.lapFeet = v;
    } else if (id === 'setTheme') {
      s.theme = $('#setTheme').value;
    }
    commit();
  }
  function openSettingsValues() {
    const s = state.settings;
    $('#setDate').value = s.eventStart.slice(0, 10);
    $('#setTime').value = s.eventStart.slice(11, 16);
    $('#setCutoff').value = s.cutoffHours;
    $('#setLaps').value = s.totalLaps;
    $('#setMiles').value = s.lapMiles;
    $('#setFeet').value = s.lapFeet;
  }

  function renderScenarioList() {
    const ul = $('#scenarioList');
    ul.textContent = '';
    state.scenarios.forEach((sc, idx) => {
      const li = document.createElement('li');
      const key = document.createElement('span'); key.className = 'key'; key.style.setProperty('--c', seriesColor(idx));
      const info = document.createElement('div'); info.className = 'info';
      const name = document.createElement('div'); name.className = 'name'; name.textContent = sc.name;
      const desc = document.createElement('div'); desc.className = 'desc';
      const plan = scenarioPlan(sc, state.laps.length, eventStartMs());
      desc.textContent = `${scenarioSummary(sc)} · finish ${fmtDur(plan.finish - eventStartMs())}`;
      info.append(name, desc);
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn btn-secondary'; btn.textContent = 'Edit';
      btn.addEventListener('click', () => openScenario(sc.id));
      li.append(key, info, btn);
      ul.append(li);
    });
    if (!state.scenarios.length) {
      const li = document.createElement('li'); li.textContent = 'No scenarios yet.'; ul.append(li);
    }
  }

  // ---------- scenario editor ----------
  let editingScenarioId = null;

  function openScenario(id) {
    editingScenarioId = id;
    const sc = id ? state.scenarios.find((x) => x.id === id) : { name: `Scenario ${state.scenarios.length + 1}`, baseMin: 90, stepMin: 0, stepEvery: 2, extraMin: 30, extraLaps: [] };
    $('#scenarioTitle').textContent = id ? 'Edit scenario' : 'New scenario';
    $('#scName').value = sc.name;
    $('#scBase').value = sc.baseMin;
    $('#scStep').value = sc.stepMin;
    $('#scEvery').value = sc.stepEvery;
    $('#scExtra').value = sc.extraMin;
    $('#scExtraLaps').value = sc.extraLaps.join(', ');
    $('#scDelete').hidden = !id;
    $('#scError').textContent = '';
    previewScenario();
    $('#scenarioDialog').showModal();
  }

  function readScenarioForm() {
    const laps = $('#scExtraLaps').value.split(/[^0-9]+/).filter(Boolean).map(Number);
    return cleanScenario({
      id: editingScenarioId || 'sc' + Date.now().toString(36),
      name: $('#scName').value.trim() || 'Scenario',
      baseMin: $('#scBase').value, stepMin: $('#scStep').value, stepEvery: $('#scEvery').value,
      extraMin: $('#scExtra').value, extraLaps: laps,
    });
  }

  function previewScenario() {
    const sc = readScenarioForm();
    const es = eventStartMs();
    const plan = scenarioPlan(sc, state.laps.length, es);
    const cutoff = es + state.settings.cutoffHours * HOUR;
    const over = plan.finish > cutoff;
    $('#scPreviewHead').innerHTML = `Goal finish <b>${clock(plan.finish)}</b> · ${fmtDur(plan.finish - es)} total${over ? ` — <b style="color:var(--bad)">over the ${state.settings.cutoffHours} hr limit</b>` : ''}`;
    const rows = plan.slots.map((ms, i) =>
      `<tr class="${sc.extraLaps.includes(i + 1) && sc.extraMin ? 'extra' : ''}"><td>${i + 1}</td><td>${clockCompact(plan.starts[i])}</td><td>${fmtDur(ms)}</td></tr>`).join('');
    $('#scPreview').innerHTML = `<thead><tr><th>Ascent</th><th>Goal start</th><th>Allowed</th></tr></thead><tbody>${rows}</tbody>`;
  }

  // ---------- data import / export ----------
  async function deliverFile(name, type, text) {
    const file = new File([text], name, { type });
    const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (mobile && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  function stamp() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  }
  function exportCsv() {
    const m = model();
    const iso = (ms) => (isNum(ms) ? `${toLocalInput(ms).replace('T', ' ')}:${pad(new Date(ms).getSeconds())}` : '');
    const header = ['Ascent', 'Start', 'End', 'Ascent time', 'Break after', 'Miles', 'Feet', 'Mantra'];
    if (m.goal) header.push(`Goal start (${m.goal.sc.name})`, 'Minutes ahead (+) / behind (-)');
    const lines = [header];
    state.laps.forEach((l, i) => {
      const row = [i + 1, iso(l.start), iso(l.end), m.dur[i] != null ? fmtDur(m.dur[i], true) : '', m.brk[i] != null ? fmtDur(m.brk[i], true) : '',
        l.end != null ? ((i + 1) * state.settings.lapMiles).toFixed(1) : '', l.end != null ? (i + 1) * state.settings.lapFeet : '',
        isNum(l.mantra) ? MANTRAS[l.mantra] : ''];
      if (m.goal) row.push(iso(m.goal.starts[i]), l.start != null ? Math.round((m.goal.starts[i] - l.start) / MIN) : '');
      lines.push(row);
    });
    lines.push([]);
    lines.push(['Total ascent time', fmtDur(m.totalLap, true)], ['Total time between ascents', fmtDur(m.totalBreak, true)],
      ['Total miles', m.miles.toFixed(1)], ['Total feet', m.feet]);
    const csv = lines.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    deliverFile(`ascent-log-${stamp()}.csv`, 'text/csv', csv);
  }

  // ---------- theme ----------
  function applyTheme() {
    const t = state.settings.theme;
    document.documentElement.dataset.theme = ['light', 'dark', 'auto'].includes(t) ? t : 'dark';
  }

  // ---------- events ----------
  function bind() {
    $('#mainBtn').addEventListener('click', onMainButton);
    $('#manualBtn').addEventListener('click', () => openEdit(model().cur, true));
    $('#settingsBtn').addEventListener('click', openSettings);

    $('#setupSave').addEventListener('click', () => {
      const v = `${$('#setupDate').value}T${$('#setupTime').value || '06:00'}`;
      if (!isNum(parseLocal(v))) { toast('Pick a date and start time.'); return; }
      state.settings.eventStart = v;
      state.settings.configured = true;
      commit();
      toast(`Event start set: ${dateLabel(parseLocal(v))}, ${clock(parseLocal(v), { day: false })}`);
    });

    $('#goalPicker').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-sc]');
      if (!b) return;
      state.settings.scenarioId = b.dataset.sc || null;
      commit();
    });

    $('#lapTable').addEventListener('click', (e) => {
      const tr = e.target.closest('tr.editable');
      if (tr) openEdit(+tr.dataset.i);
    });

    // dialogs: close buttons + click on backdrop
    $$('dialog').forEach((d) => {
      d.addEventListener('click', (e) => {
        if (e.target.closest('[data-close]') || e.target === d) d.close();
      });
    });

    $('#summitDialog').addEventListener('close', () => {
      if (summitQueue.length) setTimeout(showNextSummit, 250);
    });

    $('#confirmDialog').addEventListener('click', (e) => {
      const b = e.target.closest('[data-answer]');
      if (b) answerConfirm(b.dataset.answer === 'yes');
    });
    // Tapping outside or pressing Escape counts as Cancel
    $('#confirmDialog').addEventListener('close', () => { if (confirmAnswer) answerConfirm(false); });

    // edit dialog inputs
    [['#editStart', 'start'], ['#editEnd', 'end']].forEach(([sel, f]) => {
      $(sel).addEventListener('input', (e) => {
        const v = e.target.value;
        if (!v) edit[f] = null;
        else if (v !== toLocalInput(edit[f])) edit[f] = parseLocal(v);
        $('#editError').textContent = '';
        syncEdit(false);
      });
    });
    $$('#editDialog .time-field').forEach((fieldEl) => {
      const f = fieldEl.dataset.field;
      fieldEl.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.adj) edit[f] = (edit[f] ?? Date.now()) + +b.dataset.adj * MIN;
        else if ('now' in b.dataset) edit[f] = Date.now();
        else if ('clear' in b.dataset) edit[f] = null;
        else return;
        $('#editError').textContent = '';
        syncEdit(true);
      });
    });
    $('#editForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const error = validateLap(edit.i, edit.start, edit.end);
      if (error) { $('#editError').textContent = error; return; }
      const startedNow = state.laps[edit.i].start == null && edit.start != null;
      state.laps[edit.i] = { ...state.laps[edit.i], start: edit.start, end: edit.end };
      if (edit.start != null) assignMantra(edit.i);
      undoInfo = null;
      $('#editDialog').close();
      commit({ announce: true });
      toast(`Ascent ${edit.i + 1} saved`);
      if (startedNow && edit.end == null) showMantra(edit.i);
    });

    // settings: apply on change
    ['setDate', 'setTime', 'setCutoff', 'setLaps', 'setMiles', 'setFeet', 'setTheme'].forEach((id) => {
      $('#' + id).addEventListener('change', () => applySetting(id));
    });
    $('#addScenario').addEventListener('click', () => openScenario(null));
    $('#restoreScenarios').addEventListener('click', async () => {
      if (!(await askConfirm('Restore defaults?', 'All scenarios will be replaced with the originals: Red Hat, Main and Stretch.', 'Restore'))) return;
      state.scenarios = defaultScenarios();
      if (!state.scenarios.some((x) => x.id === state.settings.scenarioId)) state.settings.scenarioId = 's1';
      commit();
    });
    $('#exportJson').addEventListener('click', () => deliverFile(`ascent-log-backup-${stamp()}.json`, 'application/json', JSON.stringify(state, null, 2)));
    $('#exportCsv').addEventListener('click', exportCsv);
    $('#importJson').addEventListener('click', () => $('#importFile').click());
    $('#importFile').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!data || !Array.isArray(data.laps) || !data.settings) throw new Error('not a backup');
        if (!(await askConfirm('Import backup?', 'Everything in the app (ascents, settings and scenarios) will be replaced with this backup.', 'Import'))) return;
        state = normalize(data);
        commit();
        $('#settingsDialog').close();
        toast('Backup imported');
      } catch (err) {
        toast('That file is not an Ascent Log backup.');
      }
    });
    $('#resetLaps').addEventListener('click', async () => {
      const recorded = state.laps.filter((l) => l.start != null || l.end != null).length;
      if (!recorded) { $('#settingsDialog').close(); toast('There are no ascent times to clear'); return; }
      if (!(await askConfirm('Clear all ascent times?', `Start and end times for ${plural(recorded, 'ascent')} will be erased. Settings and scenarios are kept.`, 'Clear ascents'))) return;
      const previous = state.laps.map((l) => ({ ...l }));
      state.laps = state.laps.map(() => ({ start: null, end: null }));
      undoInfo = null;
      lastTap = 0;
      commit();
      $('#settingsDialog').close();
      toast('Ascent times cleared', 'Undo', () => {
        state.laps = previous;
        commit();
        toast('Ascent times restored');
      });
    });

    // scenario editor
    $('#scenarioForm').addEventListener('input', previewScenario);
    $('#scenarioForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const sc = readScenarioForm();
      if (!$('#scName').value.trim()) { $('#scError').textContent = 'Give the scenario a name.'; return; }
      if (!(+$('#scBase').value >= 1)) { $('#scError').textContent = 'Minutes between ascent starts must be at least 1.'; return; }
      const i = state.scenarios.findIndex((x) => x.id === sc.id);
      if (i >= 0) state.scenarios[i] = sc; else state.scenarios.push(sc);
      if (!state.settings.scenarioId) state.settings.scenarioId = sc.id;
      commit();
      $('#scenarioDialog').close();
    });
    $('#scDelete').addEventListener('click', async () => {
      const sc = state.scenarios.find((x) => x.id === editingScenarioId);
      if (!sc || !(await askConfirm(`Delete ${sc.name}?`, 'This goal scenario will be removed.', 'Delete'))) return;
      state.scenarios = state.scenarios.filter((x) => x.id !== sc.id);
      if (state.settings.scenarioId === sc.id) state.settings.scenarioId = state.scenarios[0] ? state.scenarios[0].id : null;
      commit();
      $('#scenarioDialog').close();
    });

    // chart hover / keyboard
    const box = $('#chartBox');
    box.addEventListener('pointermove', (e) => { if (chartGeo) showChartTip(chartIndexFromEvent(e)); });
    box.addEventListener('pointerdown', (e) => { if (chartGeo) showChartTip(chartIndexFromEvent(e)); });
    box.addEventListener('pointerleave', hideChartTip);
    box.addEventListener('focus', () => showChartTip(chartGeo ? Math.max(0, Math.min(model().done, chartGeo.N)) : 0));
    box.addEventListener('blur', hideChartTip);
    box.addEventListener('keydown', (e) => {
      if (!chartGeo) return;
      const cur = chartGeo.hovered ?? 0;
      if (e.key === 'ArrowRight') { showChartTip(cur + 1); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { showChartTip(cur - 1); e.preventDefault(); }
      else if (e.key === 'Escape') hideChartTip();
    });
    if ('ResizeObserver' in window) {
      new ResizeObserver(() => {
        const w = Math.round(box.clientWidth);
        if (w && Math.abs(w - lastChartWidth) > 1) renderChart();
      }).observe(box);
    }

    // keep in sync with other tabs / app instances
    window.addEventListener('storage', (e) => {
      if (e.key === STORE_KEY) { state = load(); celebrated = reachedSummitIds(); render(); }
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
  }

  // ---------- boot ----------
  bind();
  render();
  setInterval(tick, 1000);
  // Refresh projections drawn in the chart once a minute
  setInterval(() => { if (!chartGeo || chartGeo.hovered == null) renderChart(); }, 60000);

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
})();
