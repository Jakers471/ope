/* SPA: router, data loading, and page renderers wired to the Flask API. */
(function () {
  const { fmt, fmt1, pct, el, groupTag, statusTag, avatar, kpi, miniBar, sortableTable } = UI;
  const cache = {};

  // ---- global time filter --------------------------------------------
  const filterState = { preset: 'all', start: null, end: null };
  let BOUNDS = { date_start: null, date_end: null };
  let SHARE = false;  // public/shared mode - hides personal pay data

  // ---- visit / page-time tracking (beacons survive Cloudflare caching) ----
  let SID = sessionStorage.getItem('sid');
  if (!SID) { SID = Math.random().toString(36).slice(2, 10); sessionStorage.setItem('sid', SID); }
  let _curPage = null, _enter = 0;
  function pageName(h) {
    if (h.startsWith('#/job/')) return 'job: ' + decodeURIComponent(h.slice(6));
    if (h.startsWith('#/person/')) return 'person';
    if (h.startsWith('#/seniority')) return 'seniority';
    if (h.startsWith('#/people')) return 'people';
    if (h.startsWith('#/pay')) return 'pay';
    return 'overview';
  }
  function _beacon(payload) {
    const body = JSON.stringify(Object.assign({ sid: SID }, payload));
    try {
      if (navigator.sendBeacon) navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }));
      else fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
    } catch (e) {}
  }
  function _flush() { if (_curPage != null) { const s = Math.round((Date.now() - _enter) / 100) / 10; if (s >= 1) _beacon({ page: _curPage, secs: s }); } }
  function trackPage(h) { _flush(); _curPage = pageName(h); _enter = Date.now(); }
  window.addEventListener('pagehide', _flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') _flush(); _enter = Date.now(); });

  const PRESETS = [
    { key: 'all', label: 'All time' },
    { key: '12m', label: 'Last 12 months', days: 365 },
    { key: '6m', label: 'Last 6 months', days: 182 },
    { key: '90d', label: 'Last 90 days', days: 90 },
    { key: '30d', label: 'Last 30 days', days: 30 },
  ];
  const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  function resolvePreset(key) {
    if (key === 'custom') return { start: filterState.start, end: filterState.end };
    if (key === 'all') return { start: BOUNDS.date_start, end: BOUNDS.date_end };
    const p = PRESETS.find(x => x.key === key);
    return { start: addDays(BOUNDS.date_end, -p.days), end: BOUNDS.date_end };
  }
  const rangeQS = () => {
    const p = new URLSearchParams();
    if (filterState.start) p.set('start', filterState.start);
    if (filterState.end) p.set('end', filterState.end);
    const q = p.toString();
    return q ? '?' + q : '';
  };
  function api(path) {
    const qs = rangeQS();
    const full = '/api' + path + (path.includes('?') ? (qs ? '&' + qs.slice(1) : '') : qs);
    if (!cache[full]) {
      cache[full] = fetch(full).then(r => (r.ok ? r.json() : null));
    }
    return cache[full];
  }
  const saveFilter = () => { try { localStorage.setItem('schedFilter', JSON.stringify(filterState)); } catch (e) {} };
  const loadFilter = () => { try { return JSON.parse(localStorage.getItem('schedFilter')); } catch (e) { return null; } };
  const $main = () => document.getElementById('main');
  const $side = () => document.getElementById('side');
  const enc = encodeURIComponent;
  const GROUPS = ['FOH', 'BOH', 'Events', 'Other'];
  const GROUP_LABEL = { FOH: 'Front of House', BOH: 'Back of House', Events: 'Events / 167', Other: 'Other' };
  const SHIFT_ORDER = ['PM', 'AM', '167', 'Training'];
  function shiftDonut(id, mix) {
    const data = SHIFT_ORDER.filter(k => mix[k]).map(k => ({ name: k, value: mix[k], itemStyle: { color: Charts.SHIFT_COLORS[k] } }));
    Charts.donut(document.getElementById(id), data);
  }
  function shiftLegend(mix) {
    return SHIFT_ORDER.filter(k => mix[k] > 0).map(k =>
      `<span><i style="background:${Charts.SHIFT_COLORS[k]}"></i>${k} ${fmt(mix[k])}</span>`).join('');
  }

  function loading() { $main().innerHTML = '<div class="loading"><div class="spinner"></div><div>Loading</div></div>'; }
  function mount(node) { const m = $main(); m.innerHTML = ''; m.append(node); }
  function emptyState(msg) {
    return `<div class="card" style="margin-top:18px;text-align:center;padding:40px;">
      <div class="muted" style="font-size:13px;">${msg}</div>
      <div style="margin-top:12px;"><span class="chip" onclick="document.querySelector('#topbar .fb-chip[data-preset=all]').click()">Reset to all time</span></div></div>`;
  }

  /* ---------------- Time filter bar ---------------- */
  function renderTopbar() {
    const tb = document.getElementById('topbar');
    tb.innerHTML = `
      <span class="fb-label">Time period</span>
      <div class="fb-presets">${PRESETS.map(p => `<span class="fb-chip" data-preset="${p.key}">${p.label}</span>`).join('')}</div>
      <div class="fb-custom"><input type="date" id="fb-start"> <span>to</span> <input type="date" id="fb-end"></div>
      <span class="fb-resolved" id="fb-resolved"></span>`;
    const s = document.getElementById('fb-start'), e = document.getElementById('fb-end');
    s.min = e.min = BOUNDS.date_start; s.max = e.max = BOUNDS.date_end;
    tb.querySelectorAll('.fb-chip').forEach(c => c.addEventListener('click', () => setPreset(c.dataset.preset)));
    s.addEventListener('change', () => setCustom(s.value, e.value));
    e.addEventListener('change', () => setCustom(s.value, e.value));
    updateTopbar();
  }
  function updateTopbar() {
    document.querySelectorAll('#topbar .fb-chip').forEach(c => c.classList.toggle('active', c.dataset.preset === filterState.preset));
    const s = document.getElementById('fb-start'), e = document.getElementById('fb-end'), r = document.getElementById('fb-resolved');
    if (s) s.value = filterState.start;
    if (e) e.value = filterState.end;
    if (r) r.textContent = `${filterState.start}  to  ${filterState.end}`;
  }
  function setPreset(key) { const { start, end } = resolvePreset(key); applyFilter({ preset: key, start, end }); }
  function setCustom(start, end) {
    if (!start || !end) return;
    if (start > end) { const t = start; start = end; end = t; }
    applyFilter({ preset: 'custom', start, end });
  }
  async function applyFilter(ns) {
    Object.assign(filterState, ns);
    saveFilter(); updateTopbar();
    await buildSidebar();
    await route();
  }

  /* ---------------- Sidebar ---------------- */
  async function buildSidebar() {
    const jobs = await api('/jobs');
    const ov = await api('/overview');
    const byGroup = {};
    jobs.forEach(j => { (byGroup[j.group] = byGroup[j.group] || []).push(j); });
    const s = $side();
    s.innerHTML = `
      <div class="brand"><div class="logo">O</div>
        <div><div class="title">Oakville Grill</div><div class="sub">167 Events</div></div></div>
      <div class="nav-group"><div class="label">Overview</div>
        <div class="nav"><a data-route="#/overview" href="#/overview">Restaurant overview</a>
        <a data-route="#/seniority" href="#/seniority">Seniority (servers)</a>
        ${SHARE
          ? '<a style="opacity:.38;pointer-events:none;cursor:not-allowed;" title="Private - hidden on the shared link">My pay &amp; tips <span class="dim" style="font-size:9px;">private</span></a>'
          : '<a data-route="#/pay" href="#/pay">My pay &amp; tips</a>'}
        <a data-route="#/people" href="#/people">People directory <span class="count">${ov.totals.employees}</span></a></div></div>
      ${GROUPS.filter(g => byGroup[g]).map(g => `
        <div class="nav-group"><div class="label">${GROUP_LABEL[g]}</div><div class="nav">
        ${byGroup[g].sort((a, b) => b.hours - a.hours).map(j =>
          `<a data-route="#/job/${enc(j.job)}" href="#/job/${enc(j.job)}">${j.job}<span class="count">${j.people}</span></a>`).join('')}
        </div></div>`).join('')}`;
  }
  function setActiveNav() {
    document.querySelectorAll('#side .nav a').forEach(a => {
      a.classList.toggle('active', a.getAttribute('data-route') === location.hash ||
        (location.hash.startsWith('#/person/') && false));
    });
  }

  /* ---------------- Overview ---------------- */
  async function renderOverview() {
    loading();
    const ov = await api('/overview');
    const t = ov.totals;
    if (!t.shifts) {
      mount(el('div', { html: `<div class="page-head"><div><div class="crumbs"><b>Overview</b> / restaurant-wide</div><h1>Restaurant overview</h1></div></div>${emptyState('No shifts fall within the selected time period.')}` }));
      return;
    }
    const node = el('div');
    node.innerHTML = `
      <div class="page-head"><div>
        <div class="crumbs"><b>Overview</b> / restaurant-wide</div>
        <h1>Restaurant overview</h1>
        <div class="muted" style="font-size:12px;margin-top:3px;">The Oakville Grill &amp; Cellar and 167 Events &middot; ${t.date_start} to ${t.date_end} &middot; ${t.weeks} weeks</div>
      </div></div>
      <div class="grid cols-4">
        ${kpi('Total labor hours', fmt(t.hours), `across ${t.weeks} weeks`)}
        ${kpi('Total shifts', fmt(t.shifts), `avg ${t.avg_shifts_week} / week`)}
        ${kpi('Employees (all-time)', fmt(t.employees), `${statusTag('active')} ${t.active} &nbsp; ${statusTag('inactive')} ${t.inactive}`)}
        ${kpi('167 / transfer shifts', fmt(t.transfers), `${t.transfer_pct}% of all shifts`)}
      </div>
      <div class="grid cols-3" style="margin-top:14px;">
        <div class="card span-2"><div class="card-head"><h3>Weekly labor hours</h3><span class="hint">${t.weeks} weeks</span></div><div id="ov-trend" class="chart"></div></div>
        <div class="card"><div class="card-head"><h3>Shift mix</h3><span class="hint">all time</span></div><div id="ov-mix" class="chart"></div>
          <div class="legend" style="margin-top:6px;">${shiftLegend(ov.shift_mix)}</div></div>
      </div>
      <div class="grid cols-2" style="margin-top:14px;">
        <div class="card"><div class="card-head"><h3>Hours by department</h3><span class="hint">stacked by shift</span></div><div id="ov-dept" class="chart"></div></div>
        <div class="card"><div class="card-head"><h3>Headcount per week</h3><span class="hint">distinct employees scheduled</span></div><div id="ov-head" class="chart"></div></div>
      </div>
      <div class="card" style="margin-top:14px;"><div class="card-head"><h3>Coverage heatmap</h3><span class="hint">shifts by day of week x month</span></div><div id="ov-heat" class="chart short"></div></div>
      <div class="card" style="margin-top:14px;"><div class="card-head"><h3>Busiest days</h3><span class="hint">total shifts (staffing) by day of week</span></div><div id="ov-dow" class="chart short"></div></div>
      <div class="card" style="margin-top:14px;"><div class="card-head"><h3>Busiest months</h3><span class="hint">total shifts by month of year</span></div><div id="ov-moy" class="chart short"></div></div>
      <div class="card" style="margin-top:14px;"><div class="card-head"><h3>Major US holidays</h3><span class="hint">total shifts worked on each holiday, all years</span></div><div id="ov-holidays" class="chart tall"></div></div>
      <div class="card" style="margin-top:14px;"><div class="card-head"><h3>Workforce turnover</h3><span class="hint">employees who first appear vs last appear, per week</span></div><div id="ov-turn" class="chart short"></div></div>
      <div class="card" style="margin-top:14px;"><div class="card-head"><h3>Staffing by position</h3><span class="hint"><b>${fmt(ov.total_staff)}</b> total staff &middot; each counted once, in their main role</span></div><div id="ov-staff" class="chart"></div></div>
      <div class="section-title">Job types</div>
      <div id="ov-jobs" class="card flush"></div>`;
    mount(node);

    const x = ov.weekly.map(w => w.label);
    Charts.lineArea(document.getElementById('ov-trend'), { x, y: ov.weekly.map(w => w.hours) });
    shiftDonut('ov-mix', ov.shift_mix);
    Charts.stackedBar(document.getElementById('ov-dept'), {
      x: ov.departments.map(d => d.department),
      series: ['AM', 'PM', '167', 'Training'].map(s => ({ name: s, color: Charts.SHIFT_COLORS[s], data: ov.departments.map(d => d[s + '_hours']) }))
    });
    Charts.lineArea(document.getElementById('ov-head'), { x, y: ov.weekly.map(w => w.headcount), color: Charts.C.accent2 });
    Charts.heatmap(document.getElementById('ov-heat'), ov.heatmap);
    const dowMean = Math.round(ov.by_dow.reduce((a, d) => a + d.shifts, 0) / (ov.by_dow.length || 1));
    Charts.barAvg(document.getElementById('ov-dow'), {
      cats: ov.by_dow.map(d => d.day), data: ov.by_dow.map(d => d.shifts), color: Charts.C.accent,
      lines: [{ value: dowMean, label: 'avg', color: Charts.C.amber }]
    });
    const moyMean = Math.round(ov.by_month.reduce((a, d) => a + d.shifts, 0) / (ov.by_month.length || 1));
    Charts.barAvg(document.getElementById('ov-moy'), {
      cats: ov.by_month.map(d => d.month), data: ov.by_month.map(d => d.shifts), color: Charts.C.accent2,
      lines: [{ value: moyMean, label: 'avg', color: Charts.C.amber }]
    });
    Charts.hbar(document.getElementById('ov-holidays'), {
      cats: [...ov.holidays].reverse().map(h => h.name), data: [...ov.holidays].reverse().map(h => h.shifts),
      c1: Charts.C.amber, c2: Charts.C.pink
    });
    Charts.groupedBar(document.getElementById('ov-turn'), {
      x: ov.turnover.map(w => w.label),
      series: [
        { name: 'Started', color: Charts.C.green, data: ov.turnover.map(w => w.started) },
        { name: 'Left', color: Charts.C.red, data: ov.turnover.map(w => w.left) }]
    });

    const sc = ov.staffing.map(s => s.people);
    const sAvg = sc.length ? Math.round(sc.reduce((a, b) => a + b, 0) / sc.length * 10) / 10 : 0;
    const sortedC = [...sc].sort((a, b) => a - b);
    const sMed = sortedC.length ? (sortedC.length % 2 ? sortedC[(sortedC.length - 1) / 2] : (sortedC[sortedC.length / 2 - 1] + sortedC[sortedC.length / 2]) / 2) : 0;
    Charts.barAvg(document.getElementById('ov-staff'), {
      cats: ov.staffing.map(s => s.role), data: sc, color: Charts.C.accent2,
      lines: [{ value: sAvg, label: 'avg', color: Charts.C.amber }, { value: sMed, label: 'median', color: Charts.C.accent }]
    });

    const jobs = await api('/jobs');
    const maxH = Math.max(...jobs.map(j => j.hours));
    document.getElementById('ov-jobs').append(sortableTable([
      { key: 'rank', label: '#', html: (r, i) => `<span class="rank">${i + 1}</span>`, sortable: false },
      { key: 'job', label: 'Job type', html: r => `<b>${r.job}</b>` },
      { key: 'group', label: 'Group', html: r => groupTag(r.group) },
      { key: 'people', label: 'People', num: true },
      { key: 'shifts', label: 'Shifts', num: true },
      { key: 'hours', label: 'Hours', num: true, html: r => fmt(r.hours) },
      { key: 'hbar', label: 'Hours share', html: r => miniBar(r.hours, maxH), sortable: false },
      { key: 'pm_pct', label: 'PM %', num: true, html: r => r.pm_pct + '%' },
      { key: 'transfers', label: '167', num: true },
      { key: 'median_tenure', label: 'Med. tenure', num: true, html: r => r.median_tenure + 'd' }
    ], jobs, { initialSort: { key: 'hours', dir: 'desc' }, rowClick: r => location.hash = '#/job/' + enc(r.job) }));
  }

  /* ---------------- Job detail ---------------- */
  async function renderJob(job) {
    loading();
    const d = await api('/job/' + enc(job));
    if (!d) {
      mount(el('div', { html: `<div class="page-head"><div><div class="crumbs"><a href="#/overview">Overview</a> / <b>${job}</b></div><h1>${job}</h1></div></div>${emptyState('No ' + job + ' shifts fall within the selected time period.')}` }));
      return;
    }
    const k = d.kpis;
    const node = el('div');
    node.innerHTML = `
      <div class="page-head"><div>
        <div class="crumbs"><a href="#/overview">Overview</a> / ${GROUP_LABEL[d.group] || d.group} / <b>${d.job}</b></div>
        <h1>${d.job} ${groupTag(d.group)}</h1>
        <div class="muted" style="font-size:12px;margin-top:3px;">${fmt(k.people)} people &middot; ${fmt(k.shifts)} shifts &middot; ${fmt(k.hours)} hours &middot; ${d.department}</div>
      </div></div>
      <div class="grid cols-4">
        ${kpi('People (all-time)', fmt(k.people), `${statusTag('active')} ${k.active} &nbsp; ${statusTag('inactive')} ${k.inactive}`)}
        ${kpi('Total hours', fmt(k.hours), 'sum across roster')}
        ${kpi('PM share', k.pm_pct + '%', `${fmt(d.shift_mix.PM)} PM shifts`)}
        ${kpi('Median tenure', fmt(k.median_tenure), `days &middot; ${fmt(k.transfers)} transfers`)}
      </div>
      <div class="grid cols-3" style="margin-top:14px;">
        <div class="card span-2"><div class="card-head"><h3>${d.job} hours per week</h3></div><div id="j-trend" class="chart"></div></div>
        <div class="card"><div class="card-head"><h3>Shift mix</h3></div><div id="j-mix" class="chart"></div></div>
      </div>
      <div class="section-title" style="display:flex;align-items:center;gap:12px;margin-bottom:0;">Leaderboards
        <span class="toolbar" style="margin-left:auto;">
          <span class="chip" data-lbstatus="all">All</span>
          <span class="chip active" data-lbstatus="active">Active</span>
          <span class="chip" data-lbstatus="inactive">Inactive</span>
        </span>
      </div>
      <div class="grid cols-2" style="margin-top:10px;">
        <div class="card"><div class="card-head"><h3>Top by hours</h3><span class="hint">leaderboard</span></div><div id="j-rank" class="chart tall"></div></div>
        <div class="card"><div class="card-head"><h3>Fri / Sat PM load</h3><span class="hint">who carries the weekend dinner</span></div><div id="j-week" class="chart tall"></div></div>
      </div>
      <div class="grid cols-3" style="margin-top:14px;">
        <div class="card"><div class="card-head"><h3>Top PM shifts</h3><span class="hint">most dinner shifts</span></div><div id="j-pm" class="chart tall"></div></div>
        <div class="card"><div class="card-head"><h3>Top AM shifts</h3><span class="hint">most lunch shifts</span></div><div id="j-am" class="chart tall"></div></div>
        <div class="card"><div class="card-head"><h3>Top 167 / events</h3><span class="hint">most event shifts</span></div><div id="j-167t" class="chart tall"></div></div>
      </div>
      ${d.job === 'Server' ? `
      <div class="card" style="margin-top:14px;">
        <div class="card-head"><h3>Server consistency and trend</h3>
          <div class="toolbar">
            <span class="chip active" id="ds-consistent">Most consistent</span>
            <span class="chip" id="ds-erratic">Least consistent</span>
            <span class="chip" id="ds-rising">Rising</span>
            <span class="chip" id="ds-falling">Falling</span>
            <span style="width:1px;height:20px;background:var(--border);margin:0 2px;"></span>
            <span class="chip" data-dstatus="all">All</span>
            <span class="chip active" data-dstatus="active">Active</span>
            <span class="chip" data-dstatus="inactive">Inactive</span>
          </div></div>
        <div id="dyn-table"></div>
        <div class="note" id="dyn-note" style="margin-top:8px;"></div>
      </div>` : ''}
      <div class="section-title" style="display:flex;align-items:center;gap:12px;">
        <span><span id="j-roster-count">${d.roster.length}</span> people</span>
        <span class="toolbar" style="margin-left:auto;">
          <span class="chip" data-rstatus="all">All</span>
          <span class="chip active" data-rstatus="active">Active</span>
          <span class="chip" data-rstatus="inactive">Inactive</span>
        </span>
      </div>
      <div id="j-roster"></div>`;
    mount(node);
    if (d.job === 'Server') renderDynamics(job);

    Charts.lineArea(document.getElementById('j-trend'), { x: d.weekly.map(w => w.label), y: d.weekly.map(w => w.hours) });
    shiftDonut('j-mix', d.shift_mix);
    let lbStatus = 'active';
    function drawLeaderboards() {
      const rows = d.roster.filter(r => lbStatus === 'all' || r.status === lbStatus);
      const topBy = (key, c1, c2) => { const t = [...rows].sort((a, b) => b[key] - a[key]).slice(0, 10).reverse(); return { cats: t.map(p => p.name.split(',')[0]), data: t.map(p => p[key]), c1, c2 }; };
      const set = (id, cfg) => { Charts.disposeEl(document.getElementById(id)); Charts.hbar(document.getElementById(id), cfg); };
      set('j-rank', topBy('hours', Charts.C.accent2, Charts.C.accent));
      set('j-week', topBy('frisat_pm', Charts.C.amber, Charts.C.pink));
      set('j-pm', topBy('PM', Charts.C.accent, Charts.C.green));
      set('j-am', topBy('AM', Charts.C.accent2, '#7dd3fc'));
      set('j-167t', topBy('167', Charts.C.amber, Charts.C.violet));
    }
    node.querySelectorAll('[data-lbstatus]').forEach(c => c.addEventListener('click', () => {
      lbStatus = c.dataset.lbstatus;
      node.querySelectorAll('[data-lbstatus]').forEach(x => x.classList.toggle('active', x === c));
      drawLeaderboards();
    }));
    drawLeaderboards();

    let rosterStatus = 'active';
    function drawRoster() {
      const rows = d.roster.filter(r => rosterStatus === 'all' || r.status === rosterStatus);
      document.getElementById('j-roster-count').textContent = rows.length;
      const maxH = Math.max(1, ...rows.map(p => p.hours));
      const host = document.getElementById('j-roster'); host.innerHTML = '';
      const card = el('div', { class: 'card', style: 'padding:10px 12px;' });
      card.append(sortableTable([
        { key: 'name', label: 'Name', html: r => `<div class="namecell">${avatar(r.name)}${r.name}</div>` },
        { key: 'status', label: 'Status', html: r => statusTag(r.status) },
        { key: 'shifts', label: 'Shifts', num: true },
        { key: 'hours', label: 'Hours', num: true, html: r => fmt(r.hours) },
        { key: 'hbar', label: '', html: r => miniBar(r.hours, maxH), sortable: false },
        { key: 'AM', label: 'AM', num: true, sortVal: r => (r.AM + r.PM) ? r.AM / (r.AM + r.PM) * 100 : -1,
          html: r => { const t = r.AM + r.PM; if (!t) return '<span class="dim">-</span>'; const p = Math.round(r.AM / t * 100); const c = p >= 55 ? 'var(--green)' : p <= 45 ? 'var(--red)' : 'var(--text-3)'; return `${r.AM} <span style="color:${c};font-size:11px;font-weight:600">${p}%</span>`; } },
        { key: 'PM', label: 'PM', num: true, sortVal: r => (r.AM + r.PM) ? r.PM / (r.AM + r.PM) * 100 : -1,
          html: r => { const t = r.AM + r.PM; if (!t) return '<span class="dim">-</span>'; const p = Math.round(r.PM / t * 100); const c = p >= 55 ? 'var(--green)' : p <= 45 ? 'var(--red)' : 'var(--text-3)'; return `${r.PM} <span style="color:${c};font-size:11px;font-weight:600">${p}%</span>`; } },
        { key: 'frisat_pm', label: 'Fri/Sat PM', num: true },
        { key: '167', label: '167', num: true },
        { key: 'tenure', label: 'Tenure', num: true, html: r => r.tenure + 'd' }
      ], rows, { initialSort: { key: 'hours', dir: 'desc' }, maxHeight: '600px', isolate: {}, rowClick: r => location.hash = '#/person/' + r.id }));
      host.append(card);
    }
    node.querySelectorAll('[data-rstatus]').forEach(c => c.addEventListener('click', () => {
      rosterStatus = c.dataset.rstatus;
      node.querySelectorAll('[data-rstatus]').forEach(x => x.classList.toggle('active', x === c));
      drawRoster();
    }));
    drawRoster();
  }

  /* ---------------- Server dynamics: concentration + consistency ---------------- */
  function sparkline(values, w = 130, h = 26) {
    if (!values || values.length < 2) return '';
    let v = values;
    if (v.length > 60) {
      const b = Math.ceil(v.length / 50), out = [];
      for (let i = 0; i < v.length; i += b) { const s = v.slice(i, i + b); out.push(s.reduce((a, c) => a + c, 0) / s.length); }
      v = out;
    }
    const max = Math.max(...v), min = Math.min(...v), rng = (max - min) || 1;
    const pts = v.map((val, i) => {
      const x = (i / (v.length - 1)) * (w - 2) + 1;
      const y = h - 2 - ((val - min) / rng) * (h - 5);
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    const line = pts.join(' ');
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block">
      <polygon points="1,${h - 1} ${line} ${w - 1},${h - 1}" fill="#2dd4bf14"/>
      <polyline points="${line}" fill="none" stroke="#2dd4bf" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
  }
  function trendBadge(t) {
    const cls = t > 0.5 ? 'up' : t < -0.5 ? 'down' : 'flat';
    const arrow = t > 0.5 ? '↑' : t < -0.5 ? '↓' : '→';
    return `<span class="delta ${cls}">${arrow} ${t > 0 ? '+' : ''}${fmt1(t)}h</span>`;
  }
  async function renderDynamics(job) {
    const dyn = await api('/dynamics/' + enc(job));
    if (!dyn || !document.getElementById('dyn-table')) return;

    const SORTS = {
      consistent: { key: 'consistency', dir: 'desc' },
      erratic: { key: 'consistency', dir: 'asc' },
      rising: { key: 'trend', dir: 'desc' },
      falling: { key: 'trend', dir: 'asc' }
    };
    let dynWhich = 'consistent', dynStatus = 'active';
    function drawTable() {
      ['consistent', 'erratic', 'rising', 'falling'].forEach(k =>
        document.getElementById('ds-' + k).classList.toggle('active', k === dynWhich));
      const rows = dyn.people.filter(p => dynStatus === 'all' || p.status === dynStatus);
      const host = document.getElementById('dyn-table'); host.innerHTML = '';
      host.append(sortableTable([
        { key: 'name', label: 'Server', html: r => `<div class="namecell">${avatar(r.name)}${r.name}</div>` },
        { key: 'status', label: 'Status', html: r => statusTag(r.status) },
        { key: 'avg_week', label: 'Avg/wk', num: true, html: r => fmt1(r.avg_week) + 'h' },
        { key: 'consistency', label: 'Consistency', num: true, html: r => miniBar(r.consistency, 100) },
        { key: 'trend', label: 'Trend', num: true, html: r => trendBadge(r.trend) },
        { key: 'weeks_worked', label: 'Weeks', num: true },
        { key: 'spark', label: 'Weekly hours', sortable: false, html: r => sparkline(r.weekly) }
      ], rows, { initialSort: SORTS[dynWhich], maxHeight: '520px', rowClick: r => location.hash = '#/person/' + r.id }));
      document.getElementById('dyn-note').textContent =
        `${rows.length} servers with ${dyn.min_weeks}+ worked weeks. Consistency = how steady their hours are across the weeks they actually worked (time off ignored; 100 = identical every week). Trend = change in hours/week, early vs recent worked weeks.`;
    }
    ['consistent', 'erratic', 'rising', 'falling'].forEach(k =>
      document.getElementById('ds-' + k).addEventListener('click', () => { dynWhich = k; drawTable(); }));
    document.querySelectorAll('[data-dstatus]').forEach(c =>
      c.addEventListener('click', () => { dynStatus = c.dataset.dstatus; document.querySelectorAll('[data-dstatus]').forEach(x => x.classList.toggle('active', x === c)); drawTable(); }));
    drawTable();
  }

  /* ---------------- People directory ---------------- */
  let peopleState = { q: '', group: '', job: '', status: 'active' };
  async function renderPeople() {
    loading();
    const people = await api('/people');
    const jobs = await api('/jobs');
    const node = el('div');
    node.innerHTML = `
      <div class="page-head"><div>
        <div class="crumbs"><b>People</b> / directory</div>
        <h1>People directory</h1>
        <div class="muted" id="p-count" style="font-size:12px;margin-top:3px;"></div>
      </div>
      <div class="toolbar">
        <input class="search" id="p-q" placeholder="Search name" value="${peopleState.q}">
        <select class="sel" id="p-group"></select>
        <select class="sel" id="p-job"></select>
        <select class="sel" id="p-status"></select>
      </div></div>
      <div id="p-table" class="card flush"></div>`;
    mount(node);

    const grp = document.getElementById('p-group');
    grp.innerHTML = `<option value="">All groups</option>` + GROUPS.map(g => `<option value="${g}">${GROUP_LABEL[g]}</option>`).join('');
    grp.value = peopleState.group;
    const jb = document.getElementById('p-job');
    jb.innerHTML = `<option value="">All jobs</option>` + jobs.map(j => `<option value="${j.job}">${j.job}</option>`).join('');
    jb.value = peopleState.job;
    const st = document.getElementById('p-status');
    st.innerHTML = `<option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option>`;
    st.value = peopleState.status;

    const draw = () => drawPeople(people);
    document.getElementById('p-q').addEventListener('input', e => { peopleState.q = e.target.value; draw(); });
    grp.addEventListener('change', e => { peopleState.group = e.target.value; draw(); });
    jb.addEventListener('change', e => { peopleState.job = e.target.value; draw(); });
    st.addEventListener('change', e => { peopleState.status = e.target.value; draw(); });
    draw();
  }

  function drawPeople(people) {
    const { q, group, job, status } = peopleState;
    let rows = people.filter(p =>
      (!q || p.name.toLowerCase().includes(q.toLowerCase())) &&
      (!group || p.group === group) &&
      (!status || p.status === status) &&
      (!job || p.jobs.includes(job)));

    // When filtering by job, show that job's slice (every job a person held appears under it).
    const jobView = !!job;
    if (jobView) rows = rows.map(p => {
      const s = p.job_slices.find(x => x.job === job) || {};
      return { ...p, _shifts: s.shifts, _hours: s.hours, _pm: s.PM, _frisat: s.frisat_pm, _group: s.group };
    });

    document.getElementById('p-count').innerHTML =
      `${rows.length} of ${people.length} employees${job ? ` &middot; showing ${job} activity` : ''}`;

    const get = (r, k) => jobView ? r['_' + k] : r[k === 'pm' ? 'PM' : k === 'frisat' ? 'frisat_pm' : k];
    const maxH = Math.max(1, ...rows.map(r => jobView ? r._hours : r.hours));
    const cols = [
      { key: 'name', label: 'Name', html: r => `<div class="namecell">${avatar(r.name)}${r.name}</div>` },
      { key: 'main_role', label: jobView ? 'Filtered role' : 'Main role', html: r => jobView ? `<b>${job}</b>` : r.main_role },
      { key: 'group', label: 'Group', html: r => groupTag(jobView ? r._group : r.group) },
      { key: 'status', label: 'Status', html: r => statusTag(r.status) },
      { key: 'shifts', label: 'Shifts', num: true, sortVal: r => jobView ? r._shifts : r.shifts, html: r => fmt(jobView ? r._shifts : r.shifts) },
      { key: 'hours', label: 'Hours', num: true, sortVal: r => jobView ? r._hours : r.hours, html: r => fmt(jobView ? r._hours : r.hours) },
      { key: 'hbar', label: '', html: r => miniBar(jobView ? r._hours : r.hours, maxH), sortable: false },
      { key: 'pm', label: 'PM', num: true, sortVal: r => jobView ? r._pm : r.PM, html: r => fmt(jobView ? r._pm : r.PM) },
      { key: 'frisat', label: 'Fri/Sat PM', num: true, sortVal: r => jobView ? r._frisat : r.frisat_pm, html: r => fmt(jobView ? r._frisat : r.frisat_pm) }
    ];
    if (!jobView) cols.push(
      { key: '167', label: '167', num: true },
      { key: 'tenure', label: 'Tenure', num: true, html: r => r.tenure + 'd' },
      { key: 'streak_worked', label: 'Max on', num: true, html: r => r.streak_worked + 'd' },
      { key: 'streak_off', label: 'Max off', num: true, html: r => r.streak_off + 'd' });
    else cols.push({ key: 'tenure', label: 'Tenure', num: true, html: r => r.tenure + 'd' });

    const tbl = sortableTable(cols, rows, {
      initialSort: { key: 'hours', dir: 'desc' }, maxHeight: '640px',
      rowClick: r => location.hash = '#/person/' + r.id
    });
    const host = document.getElementById('p-table'); host.innerHTML = ''; host.append(tbl);
  }

  /* ---------------- Person detail ---------------- */
  async function renderPerson(id) {
    loading();
    const p = await api('/person/' + id);
    if (!p) {
      mount(el('div', { html: `<div class="page-head"><div><div class="crumbs"><a href="#/people">People</a></div><h1>Employee</h1></div></div>${emptyState('This employee has no shifts within the selected time period.')}` }));
      return;
    }
    const k = p.kpis, s = p.streaks;
    const node = el('div');
    node.innerHTML = `
      <div class="page-head"><div>
        <div class="crumbs"><a href="#/overview">Overview</a> / <a href="#/job/${enc(p.main_role)}">${p.main_role}</a> / <b>${p.name}</b></div>
        <h1>${avatar(p.name, true)} ${p.name} ${statusTag(p.status)}</h1>
        <div class="muted" style="font-size:12px;margin-top:4px;">Mainly ${p.main_role} ${groupTag(p.group)}${p.title && p.title !== p.main_role ? ` &middot; title ${p.title}` : ''} &middot; ${p.home_venue} &middot; first seen ${p.first}, last ${p.last}</div>
      </div>
      <div class="toolbar"><a class="chip" href="#/job/${enc(p.main_role)}">Back to ${p.main_role}</a></div></div>
      <div class="grid cols-4">
        ${kpi('Total hours', fmt(k.hours), k.rank ? `rank ${k.rank} of ${k.rank_of} in ${p.main_role}` : '')}
        ${kpi('Total shifts', fmt(k.shifts), `avg ${k.avg_hours} h / shift`)}
        ${kpi('Tenure', fmt(k.tenure), 'days, first to last seen')}
        ${kpi('167 transfers', fmt(k.transfers), `${k.transfer_pct}% of shifts`)}
      </div>
      <div class="grid cols-3" style="margin-top:14px;">
        <div class="card span-2"><div class="card-head"><h3>Activity timeline</h3><span class="hint">shifts per week &middot; gaps are breaks and vacations</span></div>
          <div id="pp-time" class="chart"></div>
          <div class="legend" style="margin-top:4px;">
            <span class="dim">Longest streak worked: <b style="color:#e6edf3">${s.worked} days</b></span>
            <span class="dim">Longest stretch off: <b style="color:#e6edf3">${s.off} days</b>${s.off_start ? ` (${s.off_start} to ${s.off_end})` : ''}</span>
            <span class="dim">Fri/Sat PM: <b style="color:#e6edf3">${k.frisat_pm}</b></span></div></div>
        <div class="card"><div class="card-head"><h3>Shift breakdown</h3></div><div id="pp-mix" class="chart"></div>
          <div class="legend" style="margin-top:6px;">${shiftLegend(p.shift_mix)}</div></div>
      </div>
      <div class="grid cols-3" style="margin-top:14px;">
        <div class="card"><div class="card-head"><h3>Shifts by day of week</h3></div><div id="pp-dow" class="chart short"></div></div>
        <div class="card"><div class="card-head"><h3>Job history</h3><span class="hint">role worked over time</span></div><div id="pp-hist"></div></div>
        <div class="card"><div class="card-head"><h3>167 transfer destinations</h3></div><div id="pp-tr"></div></div>
      </div>`;
    mount(node);

    Charts.activityBars(document.getElementById('pp-time'), { x: p.weekly.map(w => w.label), y: p.weekly.map(w => w.shifts) });
    shiftDonut('pp-mix', p.shift_mix);
    Charts.groupedBar(document.getElementById('pp-dow'), { x: p.dow.map(d => d.day), series: [{ name: 'Shifts', color: Charts.C.accent, data: p.dow.map(d => d.shifts) }] });

    document.getElementById('pp-hist').innerHTML = p.job_history.length
      ? p.job_history.map(h => `<div class="kv"><span class="k mono">${h.date}</span><span class="v">${h.from === 'hired' ? '<span class="dim">hired as</span> ' : h.from + ' &rarr; '}<b>${h.to}</b></span></div>`).join('')
      : '<div class="note">No role changes.</div>';
    document.getElementById('pp-tr').innerHTML = p.transfers.length
      ? p.transfers.slice(0, 8).map(t => `<div class="kv"><span class="k">${t.venue}<br><span class="dim" style="font-size:10px">${t.department}</span></span><span class="v">${t.shifts} sh &middot; ${fmt1(t.hours)}h</span></div>`).join('')
      : '<div class="note">No 167 transfers on record.</div>';
  }

  /* ---------------- Seniority (servers) ---------------- */
  const SENIORITY_METRICS = [
    { key: 'avg_week', label: 'Hours / week', fmt: v => fmt1(v) + 'h', desc: 'average size of a week they served (intensity, not total volume). Noisy for new servers - a 6-week average is not comparable to a 50-week one.' },
    { key: 'recent_hours', label: 'Hours: last 12wk', fmt: v => fmt1(v) + 'h', desc: 'total server hours in the last 12 weeks - a fixed recent window, the fairest "what are they getting now" comparison.' },
    { key: 'total_hours', label: 'Hours: all-time', fmt: v => fmt(v) + 'h', desc: 'all-time server hours. Inflated by tenure - longer-serving people have more simply because they have worked more weeks.' },
    { key: 'events_167', label: '167 events', fmt: v => fmt(v), desc: 'all 167 / event shifts worked, across every role (banquet serving is logged separately, so it is counted here too) - matches the total on their profile.' },
    { key: 'weekend_pm', label: 'Fri/Sat PM', fmt: v => fmt(v), desc: 'number of Friday / Saturday PM dinner shifts (the high-tip "money" shifts).' },
    { key: 'pm', label: 'PM shifts', fmt: v => fmt(v), desc: 'number of PM (after 3pm, dinner) shifts - generally the busier, higher-tip service.' },
    { key: 'am', label: 'AM shifts', fmt: v => fmt(v), desc: 'number of AM (before 3pm, lunch/brunch) shifts - generally lower-volume and lower-tip, so MORE of these is usually less desirable.' },
    { key: 'pm_share', label: 'PM share %', fmt: v => v + '%', desc: 'share of their AM+PM service shifts that are PM. High = they get the better dinner shifts; low = stuck on AM.' },
  ];
  let seniorityState = { metric: 'avg_week', scope: 'srv', youId: null };
  const corrLabel = r => { const a = Math.abs(r); return a < 0.2 ? 'none' : a < 0.4 ? 'weak' : a < 0.6 ? 'moderate' : a < 0.8 ? 'strong' : 'very strong'; };
  const corrColor = r => r >= 0.6 ? 'var(--green)' : r >= 0.4 ? 'var(--accent)' : r >= 0.2 ? 'var(--amber)' : 'var(--red)';
  function regression(pts) {
    const n = pts.length; if (n < 2) return null;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    pts.forEach(p => { sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y; });
    const d = n * sxx - sx * sx; if (!d) return null;
    const slope = (n * sxy - sx * sy) / d;
    return { slope, intercept: (sy - slope * sx) / n };
  }

  async function renderSeniority() {
    loading();
    const data = await api('/seniority');
    if (!data || !data.n) {
      mount(el('div', { html: `<div class="page-head"><div><div class="crumbs"><b>Seniority</b> / servers</div><h1>Seniority vs rewards</h1></div></div>${emptyState('No active servers in the selected period.')}` }));
      return;
    }
    const servers = data.servers;
    if (seniorityState.youId == null || !servers.find(s => s.id === seniorityState.youId)) {
      const pao = servers.find(s => s.name.startsWith('Paoletti'));
      seniorityState.youId = (pao || servers[0]).id;
    }
    const node = el('div');
    node.innerHTML = `
      <div class="page-head"><div>
        <div class="crumbs"><b>Seniority</b> / servers</div>
        <h1>Seniority vs rewards</h1>
        <div class="muted" style="font-size:12px;margin-top:3px;">${data.n} active servers (title Server, ${data.min_weeks}+ weeks) &middot; as of ${data.as_of} &middot; <b>always all history</b> (the top time filter does not apply here - use the metric chips for recency) &middot; Server shifts = time spent serving; All shifts = overall tenure</div>
      </div>
      <div class="toolbar">
        <span class="muted" style="font-size:11px;">Count:</span>
        <span class="chip" data-scope="srv">Server shifts</span>
        <span class="chip" data-scope="all">All shifts</span>
        <span class="muted" style="font-size:11px;margin-left:8px;">You:</span><select class="sel" id="sen-you"></select>
      </div></div>
      <div class="toolbar" style="margin-bottom:14px;">${SENIORITY_METRICS.map(m => `<span class="chip" data-metric="${m.key}">${m.label}</span>`).join('')}</div>
      <div id="sen-kpis" class="grid cols-4"></div>
      <div class="note" style="margin-top:10px;">
        <b>Correlation</b> (the first three tiles): how strongly seniority tracks each reward, from -1 to +1. Above +0.4 = seniors clearly get more; near 0 = seniority makes no difference; <b>negative = seniors get less</b> (the policy is broken for that reward).
        &nbsp;&middot;&nbsp; <b>Standing</b>: the selected server's rank of ${data.n} - <b>#sen</b> (1 = longest-serving) vs <b>#rwd</b> (1 = most of the selected reward). Reward rank worse than seniority = getting less than their tenure predicts.
      </div>
      <div class="grid cols-3" style="margin-top:14px;">
        <div class="card span-2"><div class="card-head"><h3>Seniority vs <span id="sen-ylabel"></span></h3><span class="hint">each dot a server &middot; dashed line = expected for seniority</span></div>
          <div id="sen-scatter" class="chart tall"></div>
          <div class="legend" style="margin-top:8px;">
            <span><i style="background:#f87171"></i>below the line (less than expected)</span>
            <span><i style="background:#34d399"></i>above the line (more than expected)</span>
            <span><i style="background:#4c8dff"></i>on the line (about as expected)</span>
            <span><i style="background:#f5b14c"></i>selected (You)</span>
            <span class="dim">dashed line = reward expected for that seniority</span>
          </div>
          <div class="note" id="sen-metric-note" style="margin-top:8px;"></div>
          <div class="note" style="margin-top:6px;">Read it: dots <b>low and to the right</b> (senior, little reward) are overlooked; <b>high and to the left</b> (junior, lots of reward) are favored.</div></div>
        <div class="card"><div class="card-head"><h3>Juniors out-earning you</h3><span class="hint" id="sen-lev-hint"></span></div><div id="sen-leverage"></div></div>
      </div>
      <div class="card" style="margin-top:14px;">
        <div class="card-head"><h3>Favorability over time &middot; <span id="traj-who"></span></h3><span class="hint">standing vs the pack, rolling 12-week windows</span></div>
        <div id="traj-line" class="chart"></div>
        <div class="note" id="traj-note" style="margin-top:6px;">Above the 50% line = favored that window; below = overlooked. Rising = ascending toward favored, falling = descending. The all-time scatter dot is roughly the average of this line; the right end is "right now".</div>
      </div>
      <div class="card" style="margin-top:14px;">
        <div class="card-head"><h3>Favorability heatmap &middot; every server, by window</h3>
          <div class="toolbar"><span class="chip active" data-hsort="seniority">By seniority</span><span class="chip" data-hsort="favored">Most favored</span><span class="hint" id="grid-hint" style="align-self:center;"></span></div>
        </div>
        <div id="favor-grid" class="chart" style="height:600px;"></div>
        <div class="note" style="margin-top:6px;">Each row a server (most senior at top), each column a 12-week window. Green = favored that window, red = overlooked, empty = not serving. Read across a row to see one server rise/fall; read down a column to compare everyone at one time. Your row is gold.</div>
      </div>
      <div class="card" style="margin-top:14px;">
        <div class="card-head"><h3>Favorability ranking &middot; overall + by category</h3><span class="hint">most favored to overlooked, side by side</span></div>
        <div id="favor-ranks" style="overflow-x:auto;"></div>
        <div class="note" style="margin-top:8px;"><b>Overall</b> = unweighted average of every category (each counts equally; hours shows up as 3 categories, so it weighs a bit more - disclosed, not hidden). In Overall, <b>AM is flipped</b>: fewer lunch shifts = more favored. The "X/8" is how many of the 8 categories they're favored in (above the median). Each category column just ranks who gets the most of that shift type.</div>
      </div>
      <div class="section-title">All active servers &middot; sorted by seniority</div>
      <div class="note" style="margin-bottom:10px;"><b>Gap</b> = reward rank minus seniority rank for the selected metric. <span style="color:var(--red)">Positive (red)</span> = ranks worse in reward than in seniority (under-rewarded / overlooked); <span style="color:var(--green)">negative (green)</span> = getting more than seniority predicts (favored). Click any column to re-sort; click a row to open that server.</div>
      <div id="sen-table" class="card flush"></div>`;
    mount(node);

    const youSel = document.getElementById('sen-you');
    youSel.innerHTML = [...servers].sort((a, b) => a.name.localeCompare(b.name)).map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    youSel.value = seniorityState.youId;
    youSel.addEventListener('change', e => { seniorityState.youId = +e.target.value; draw(); });
    node.querySelectorAll('[data-metric]').forEach(c => c.addEventListener('click', () => { seniorityState.metric = c.dataset.metric; draw(); }));
    node.querySelectorAll('[data-scope]').forEach(c => c.addEventListener('click', () => { seniorityState.scope = c.dataset.scope; draw(); }));

    const trajCache = {};
    const gridCache = {};
    let heatSort = 'seniority';
    node.querySelectorAll('[data-hsort]').forEach(c => c.addEventListener('click', () => {
      heatSort = c.dataset.hsort;
      node.querySelectorAll('[data-hsort]').forEach(x => x.classList.toggle('active', x === c));
      draw();
    }));
    function draw() {
      const M = SENIORITY_METRICS.find(m => m.key === seniorityState.metric);
      const sc = seniorityState.scope;
      const val = s => s[sc][M.key];
      node.querySelectorAll('[data-metric]').forEach(c => c.classList.toggle('active', c.dataset.metric === seniorityState.metric));
      node.querySelectorAll('[data-scope]').forEach(c => c.classList.toggle('active', c.dataset.scope === sc));
      const scopeWord = sc === 'srv' ? 'server' : 'all-role';
      document.getElementById('sen-ylabel').textContent = M.label.toLowerCase() + ' (' + scopeWord + ')';
      document.getElementById('sen-metric-note').innerHTML = `<b>${M.label}</b> counts ${scopeWord} shifts: ${M.desc}`;
      const you = servers.find(s => s.id === seniorityState.youId);
      const ten = s => s[sc].tenure;
      const byTen = [...servers].sort((a, b) => ten(b) - ten(a));
      const byMet = [...servers].sort((a, b) => val(b) - val(a));
      const senRank = s => byTen.indexOf(s) + 1;
      const metRank = s => byMet.indexOf(s) + 1;
      const cor = data.correlations[sc];
      const corKpi = (label, r) => kpi('Seniority → ' + label, `<span style="color:${corrColor(r)}">${r.toFixed(2)}</span>`, corrLabel(r) + ' correlation');
      document.getElementById('sen-kpis').innerHTML =
        corKpi(M.label.toLowerCase(), cor[M.key])
        + corKpi('167 events', cor.events_167)
        + corKpi('Fri/Sat PM', cor.weekend_pm)
        + kpi('Your standing', `#${senRank(you)} <span class="dim" style="font-size:13px">sen</span> &middot; #${metRank(you)} <span class="dim" style="font-size:13px">rwd</span>`, `${you.name.split(',')[0]} of ${data.n} servers`);

      const reg = regression(servers.map(s => ({ x: ten(s), y: val(s) })));
      const xs = servers.map(ten), xmin = Math.min(...xs), xmax = Math.max(...xs);
      const predOf = s => reg ? reg.slope * ten(s) + reg.intercept : val(s);
      const resids = servers.map(s => val(s) - predOf(s));
      const rsd = Math.sqrt(resids.reduce((a, r) => a + r * r, 0) / (resids.length || 1)) || 1;
      const thr = 0.5 * rsd;  // neutral band: dots within ~half a std of the line are "on the line"
      const points = servers.map(s => {
        const resid = val(s) - predOf(s);
        let color = Charts.C.accent2, size = 9, border = null;   // blue = on the line
        if (resid < -thr) color = Charts.C.red;                  // clearly below expected
        else if (resid > thr) color = Charts.C.green;            // clearly above expected
        if (s.id === you.id) { color = Charts.C.amber; size = 16; border = '#ffffff'; }
        return { x: ten(s), y: val(s), name: `${s.name} · ${M.fmt(val(s))}`, color, size, border };
      });
      const trend = reg ? { x1: xmin, y1: reg.slope * xmin + reg.intercept, x2: xmax, y2: reg.slope * xmax + reg.intercept } : null;
      const traj = trajCache[you.id + '_' + sc];
      Charts.disposeEl(document.getElementById('sen-scatter'));
      Charts.scatter(document.getElementById('sen-scatter'), { points, trend, xName: 'tenure (days)', yName: M.label, xFmt: v => v, yFmt: M.fmt });

      const juniors = servers.filter(s => ten(s) < ten(you) && val(s) > val(you)).sort((a, b) => val(b) - val(a));
      document.getElementById('sen-lev-hint').textContent = M.label.toLowerCase();
      document.getElementById('sen-leverage').innerHTML = juniors.length
        ? juniors.slice(0, 10).map(s => `<div class="kv"><span class="k"><a href="#/person/${s.id}">${s.name}</a><br><span class="dim" style="font-size:10px">${ten(s)}d ${sc === 'srv' ? 'serving' : 'tenure'} &middot; ${ten(you) - ten(s)}d junior to you</span></span><span class="v" style="color:var(--amber)">${M.fmt(val(s))}</span></div>`).join('')
          + `<div class="note" style="margin-top:8px;">${juniors.length} server${juniors.length > 1 ? 's' : ''} less senior than you get more ${M.label.toLowerCase()}.</div>`
        : `<div class="note">No server junior to you beats you on ${M.label.toLowerCase()} - you are getting your seniority's worth here.</div>`;

      const host = document.getElementById('sen-table'); host.innerHTML = '';
      host.append(sortableTable([
        { key: 'sen', label: 'Sen #', num: true, sortVal: s => senRank(s), html: s => `<span class="rank">${senRank(s)}</span>` },
        { key: 'name', label: 'Server', html: s => `<div class="namecell">${avatar(s.name)}${s.name}${s.id === you.id ? ' <span class="tag pm" style="margin-left:6px">you</span>' : ''}</div>` },
        { key: 'first', label: sc === 'srv' ? 'Serving since' : 'Started', sortVal: s => s[sc].first || '', html: s => s[sc].first || '-' },
        { key: 'tenure', label: sc === 'srv' ? 'Serving' : 'Tenure', num: true, sortVal: s => ten(s), html: s => ten(s) + 'd' },
        { key: 'avg_week', label: 'Hrs/wk', num: true, sortVal: s => s[sc].avg_week, html: s => fmt1(s[sc].avg_week) },
        { key: 'recent_hours', label: 'Last 12wk', num: true, sortVal: s => s[sc].recent_hours, html: s => fmt1(s[sc].recent_hours) },
        { key: 'events_167', label: '167', num: true, sortVal: s => s[sc].events_167, html: s => s[sc].events_167 },
        { key: 'weekend_pm', label: 'Fri/Sat PM', num: true, sortVal: s => s[sc].weekend_pm, html: s => s[sc].weekend_pm },
        { key: 'gap', label: 'Gap', num: true, sortVal: s => metRank(s) - senRank(s), html: s => { const g = metRank(s) - senRank(s); const cls = g >= 4 ? 'down' : g <= -4 ? 'up' : 'flat'; return `<span class="delta ${cls}">${g > 0 ? '+' : ''}${g}</span>`; } },
      ], servers, { initialSort: { key: 'sen', dir: 'asc' }, maxHeight: '520px', rowClick: s => location.hash = '#/person/' + s.id }));

      // Favorability-over-time line (and feeds the scatter trail above).
      document.getElementById('traj-who').textContent = `${you.name} · ${M.label.toLowerCase()}`;
      const lineEl = document.getElementById('traj-line');
      const key = you.id + '_' + sc;
      if (traj) {
        const pctAll = traj.metrics[M.key].pct;
        // start the chart where this person's data begins (trim leading/trailing empty windows)
        let lo = pctAll.findIndex(v => v != null);
        let hi = pctAll.length - 1; while (hi > 0 && pctAll[hi] == null) hi--;
        if (lo < 0) lo = 0;
        const pct = pctAll.slice(lo, hi + 1);
        const xWin = traj.windows.slice(lo, hi + 1);
        Charts.disposeEl(lineEl);
        Charts.percentileLine(lineEl, { x: xWin, y: pct });
        const active = pct.filter(v => v != null);
        const nowP = active.length ? active[active.length - 1] : null;
        const startP = active.length ? active[0] : null;
        const dir = (nowP != null && startP != null) ? (nowP - startP) : 0;
        document.getElementById('traj-note').innerHTML =
          (nowP != null ? `Now at <b style="color:${nowP >= 50 ? 'var(--green)' : 'var(--red)'}">${nowP}%</b> (${nowP >= 50 ? 'favored' : 'overlooked'}) on ${M.label.toLowerCase()}; ${dir > 4 ? '<b style="color:var(--green)">ascending</b>' : dir < -4 ? '<b style="color:var(--red)">descending</b>' : 'roughly steady'} since they started (${startP}%). ` : '')
          + 'Above 50% = favored that window; below = overlooked. The all-time scatter dot is the average of this line; the right end is "right now".';
      } else {
        lineEl.innerHTML = '<div class="loading"><div class="spinner"></div><div>Building trajectory</div></div>';
        api('/trajectory/' + you.id + '?scope=' + sc).then(d => {
          if (d) { trajCache[key] = d; if (seniorityState.youId === you.id && seniorityState.scope === sc) draw(); }
        });
      }

      // Favorability heatmap - every server x window, for the selected metric.
      const gridEl = document.getElementById('favor-grid');
      const grid = gridCache[sc];
      document.getElementById('grid-hint').textContent = M.label.toLowerCase() + ' (' + scopeWord + ')';
      if (grid) {
        const tenOf = {}; servers.forEach(s => tenOf[s.id] = ten(s));
        const gs = grid.servers.map(s => {
          const arr = s.pct[M.key] || [];
          const present = arr.filter(v => v != null);
          return { ...s, _avg: present.length ? Math.round(present.reduce((x, y) => x + y, 0) / present.length) : null, _ten: tenOf[s.id] ?? -1 };
        });
        const ordered = gs.sort((a, b) => heatSort === 'favored' ? ((b._avg ?? -1) - (a._avg ?? -1)) : (b._ten - a._ten));
        const rowNames = ordered.map((s, i) => `${i + 1}. ` + (s.name.length > 18 ? s.name.slice(0, 17) + '…' : s.name));
        const youRow = ordered.findIndex(s => s.id === you.id);
        const data = [], avg = [];
        ordered.forEach((s, ri) => {
          (s.pct[M.key] || []).forEach((v, ci) => { if (v != null) data.push([ci, ri, v]); });
          avg.push(s._avg);
        });
        Charts.disposeEl(gridEl);
        Charts.favorGrid(gridEl, { rows: rowNames, cols: grid.windows, data, avg, youRow });

        // Ranked lists: an unweighted Overall (AM flipped) plus each category, side by side.
        const lastCounts = {};
        grid.servers.forEach(s => { const l = s.name.split(',')[0].trim(); lastCounts[l] = (lastCounts[l] || 0) + 1; });
        const dispName = nm => { const l = nm.split(',')[0].trim(), f = (nm.split(',')[1] || '').trim(); return lastCounts[l] > 1 && f ? `${l}, ${f[0]}` : l; };
        const perServer = grid.servers.map(s => {
          const cat = {};
          SENIORITY_METRICS.forEach(MM => { const a = (s.pct[MM.key] || []).filter(v => v != null); cat[MM.key] = a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null; });
          const vals = SENIORITY_METRICS.map(MM => { const v = cat[MM.key]; return v == null ? null : (MM.key === 'am' ? 100 - v : v); }).filter(v => v != null);
          const overall = vals.length ? Math.round(vals.reduce((x, y) => x + y, 0) / vals.length) : null;
          return { id: s.id, name: s.name, cat, overall, fav: vals.filter(v => v >= 50).length, tot: vals.length };
        });
        const colCss = c => c >= 60 ? 'var(--green)' : c <= 40 ? 'var(--red)' : 'var(--text-3)';
        const colHtml = (label, valOf, isOverall) => {
          const ranked = perServer.filter(r => valOf(r) != null).sort((a, b) => valOf(b) - valOf(a));
          return `<div style="min-width:${isOverall ? 150 : 112}px;flex:1;${isOverall ? 'border-right:2px solid var(--border-2);padding-right:6px;' : ''}">
            <div style="font-size:10.5px;font-weight:700;color:${isOverall ? 'var(--accent)' : 'var(--text-2)'};padding:5px 3px;border-bottom:1px solid var(--border);white-space:nowrap;">${label}</div>
            ${ranked.map((r, i) => `<div title="${r.name}" style="display:flex;justify-content:space-between;gap:5px;padding:3px;font-size:10.5px;border-radius:4px;${r.id === you.id ? 'background:rgba(245,177,76,0.14);' : ''}">
              <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:${r.id === you.id ? 'var(--amber)' : 'var(--text-2)'};${r.id === you.id ? 'font-weight:700;' : ''}"><span class="dim">${i + 1}.</span> ${dispName(r.name)}</span>
              <span style="font-weight:700;white-space:nowrap;color:${colCss(valOf(r))}">${valOf(r)}%${isOverall ? ` <span class="dim" style="font-weight:400;">${r.fav}/${r.tot}</span>` : ''}</span>
            </div>`).join('')}
          </div>`;
        };
        document.getElementById('favor-ranks').innerHTML = '<div style="display:flex;gap:6px;min-width:max-content;">'
          + colHtml('Overall', r => r.overall, true)
          + SENIORITY_METRICS.map(MM => colHtml(MM.label, r => r.cat[MM.key], false)).join('')
          + '</div>';
      } else {
        gridEl.innerHTML = '<div class="loading"><div class="spinner"></div><div>Building heatmap</div></div>';
        api('/favorability?scope=' + sc).then(d => {
          if (d) { gridCache[sc] = d; if (seniorityState.scope === sc) draw(); }
        });
      }
    }
    draw();
  }

  /* ---------------- Pay & tips (personal timecard) ---------------- */
  async function renderPay() {
    loading();
    const p = await api('/pay');
    if (!p) { mount(el('div', { html: `<div class="page-head"><div><h1>Pay & tips</h1></div></div>${emptyState('No timecard data found in pay/.')}` })); return; }
    const t = p.totals;
    const node = el('div');
    node.innerHTML = `
      <div class="page-head"><div>
        <div class="crumbs"><b>Pay &amp; tips</b> / ${p.name}</div>
        <h1>Pay &amp; tips</h1>
        <div class="muted" style="font-size:12px;margin-top:3px;">${p.source} &middot; ${t.shifts} shifts &middot; ${t.date_start} to ${t.date_end} &middot; hours &amp; tips reliable, paycodes ignored</div>
      </div></div>
      <div class="grid cols-4">
        ${kpi('Total tips', '$' + fmt(t.tips), `${t.tipped_shifts} tipped shifts`)}
        ${kpi('Tips / hour', '$' + t.tph, `${fmt(t.hours)} hours worked`)}
        ${kpi('Avg / shift', '$' + fmt(t.avg_tips), `best single shift $${fmt(t.best_shift)}`)}
        ${kpi('Shifts', fmt(t.shifts), `${t.zero_shifts} with no recorded tips`)}
      </div>
      <div class="grid cols-3" style="margin-top:14px;">
        <div class="card span-2"><div class="card-head"><h3>Tips over time</h3><span class="hint">per week</span></div><div id="pay-weekly" class="chart"></div></div>
        <div class="card"><div class="card-head"><h3>Avg tips by day</h3><span class="hint">per shift</span></div><div id="pay-dow" class="chart"></div></div>
      </div>
      <div class="grid cols-3" style="margin-top:14px;">
        <div class="card"><div class="card-head"><h3>Tips / hour by day</h3></div><div id="pay-tph" class="chart short"></div></div>
        <div class="card"><div class="card-head"><h3>Tips by month</h3></div><div id="pay-month" class="chart short"></div></div>
        <div class="card"><div class="card-head"><h3>Tips vs shift length</h3><span class="hint">each dot a shift</span></div><div id="pay-scatter" class="chart short"></div></div>
      </div>
      <div class="section-title">Every shift &middot; ${p.shifts.length}</div>
      <div id="pay-table" class="card flush"></div>`;
    mount(node);
    Charts.lineArea(document.getElementById('pay-weekly'), { x: p.weekly.map(w => w.label), y: p.weekly.map(w => w.tips), color: Charts.C.green, fmt: v => '$' + v });
    const dowAvg = Math.round(p.by_dow.reduce((a, d) => a + d.avg_tips, 0) / 7);
    Charts.barAvg(document.getElementById('pay-dow'), { cats: p.by_dow.map(d => d.day), data: p.by_dow.map(d => d.avg_tips), color: Charts.C.green, lines: [{ value: dowAvg, label: 'avg', color: Charts.C.amber }] });
    Charts.barAvg(document.getElementById('pay-tph'), { cats: p.by_dow.map(d => d.day), data: p.by_dow.map(d => d.tph), color: Charts.C.accent });
    Charts.barAvg(document.getElementById('pay-month'), { cats: p.by_month.map(m => m.month), data: p.by_month.map(m => m.tips), color: Charts.C.accent2 });
    Charts.scatter(document.getElementById('pay-scatter'), { points: p.shifts.map(s => ({ x: s.hours, y: s.tips, name: `${s.date} (${s.day})`, color: Charts.C.green })), xName: 'hours', yName: 'tips', xFmt: v => v + 'h', yFmt: v => '$' + v });
    document.getElementById('pay-table').append(sortableTable([
      { key: 'date', label: 'Date' },
      { key: 'day', label: 'Day' },
      { key: 'in', label: 'In', sortable: false },
      { key: 'out', label: 'Out', sortable: false },
      { key: 'hours', label: 'Hours', num: true, html: r => fmt1(r.hours) },
      { key: 'tips', label: 'Tips', num: true, html: r => '$' + fmt(r.tips) },
      { key: 'tph', label: '$/hr', num: true, html: r => '$' + r.tph }
    ], p.shifts, { initialSort: { key: 'date', dir: 'desc' }, maxHeight: '540px' }));
  }

  /* ---------------- Router ---------------- */
  async function route() {
    Charts.disposeAll();
    let h = location.hash || '#/overview';
    if (SHARE && h.startsWith('#/pay')) h = '#/overview';  // personal data blocked in share mode
    trackPage(h);
    // The time filter does nothing on the Seniority page (it is always all-time), so hide it there.
    const tb = document.getElementById('topbar');
    if (tb) tb.style.display = h.startsWith('#/seniority') ? 'none' : '';
    try {
      if (h.startsWith('#/job/')) await renderJob(decodeURIComponent(h.slice(6)));
      else if (h.startsWith('#/person/')) await renderPerson(parseInt(h.slice(9), 10));
      else if (h.startsWith('#/people')) await renderPeople();
      else if (h.startsWith('#/seniority')) await renderSeniority();
      else if (h.startsWith('#/pay')) await renderPay();
      else await renderOverview();
    } catch (e) {
      $main().innerHTML = `<div class="loading">Error: ${e.message}</div>`;
    }
    setActiveNav();
    window.scrollTo(0, 0);
  }

  function showWelcome() {
    const overlay = el('div', { class: 'modal-overlay' });
    overlay.innerHTML = `
      <div class="modal-card">
        <button class="modal-close" title="Close">&times;</button>
        <div class="modal-body">
          <p>whats up daddy alan</p>
          <p>for the left side, front-of-house schedule data for <b>hosts and bar</b> is kinda whack / not complete - but doesnt really matter. <b>Server data is 100% complete</b> though.</p>
          <p>lmk if you want me to add anything</p>
        </div>
      </div>`;
    document.body.append(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('.modal-close').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
  }

  function initChat() {
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const box = el('div', { class: 'chat-box' });
    box.innerHTML = `
      <div class="chat-head"><span><span class="chat-dot"></span>Chat</span><span class="chat-toggle">&ndash;</span></div>
      <div class="chat-body">
        <div class="chat-msgs" id="chat-msgs"><div class="chat-empty">No messages yet. Say hi.</div></div>
        <div class="chat-input">
          <input class="chat-name-i" id="chat-name" placeholder="your name" maxlength="24">
          <div class="chat-row"><input id="chat-text" placeholder="message or paste an image..." maxlength="500"><button id="chat-send">Send</button></div>
        </div>
      </div>`;
    document.body.append(box);
    const msgs = box.querySelector('#chat-msgs');
    const nameI = box.querySelector('#chat-name');
    const textI = box.querySelector('#chat-text');
    const toggle = box.querySelector('.chat-toggle');
    nameI.value = localStorage.getItem('chatname') || (SHARE ? '' : 'Host');
    let lastId = 0, empty = true;
    function add(m) {
      if (empty) { msgs.innerHTML = ''; empty = false; }
      const d = el('div', { class: 'chat-msg' });
      let html = `<span class="chat-name">${esc(m.name)}</span><span class="chat-time">${esc(m.ts)}</span>`;
      if (m.text) html += `<div class="chat-text">${esc(m.text)}</div>`;
      if (m.img) html += `<a href="${esc(m.img)}" target="_blank" rel="noopener"><img class="chat-img" src="${esc(m.img)}" alt="image"></a>`;
      d.innerHTML = html;
      msgs.append(d); msgs.scrollTop = msgs.scrollHeight;
      lastId = Math.max(lastId, m.id);
    }
    async function poll() {
      try { (await fetch('/api/chat?since=' + lastId).then(r => r.json())).forEach(add); } catch (e) {}
    }
    function curName() { const n = nameI.value.trim() || (SHARE ? 'Guest' : 'Host'); localStorage.setItem('chatname', n); nameI.value = n; return n; }
    async function send() {
      const text = textI.value.trim(); if (!text) return;
      const name = curName(); textI.value = '';
      try { await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, text }) }); } catch (e) {}
      poll();
    }
    async function sendImage(file) {
      const dataUrl = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
      const name = curName(); const text = textI.value.trim(); textI.value = '';
      try { await fetch('/api/chat/image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, text, data: dataUrl }) }); } catch (e) {}
      poll();
    }
    box.querySelector('#chat-send').addEventListener('click', send);
    textI.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
    textI.addEventListener('paste', e => {
      const items = (e.clipboardData && e.clipboardData.items) || [];
      for (const it of items) {
        if (it.type && it.type.startsWith('image/')) { e.preventDefault(); const f = it.getAsFile(); if (f) sendImage(f); return; }
      }
    });
    box.querySelector('.chat-head').addEventListener('click', () => {
      const c = box.classList.toggle('collapsed');
      toggle.innerHTML = c ? '+' : '&ndash;';
    });
    poll();
    setInterval(poll, 3000);
  }

  let BUILD = null;
  function watchBuild() {
    // Poll the server build id; reload when it changes so already-open pages update.
    setInterval(async () => {
      try {
        const b = (await fetch('/api/config', { cache: 'no-store' }).then(r => r.json())).build;
        if (BUILD && b && b !== BUILD) location.reload();
      } catch (e) {}
    }, 5000);
  }

  async function start() {
    try { const cfg = await fetch('/api/config').then(r => r.json()); SHARE = cfg.share; BUILD = cfg.build; } catch (e) {}
    _beacon({ event: 'open' });  // logs the visit (real IP via Cloudflare header)
    BOUNDS = await fetch('/api/meta').then(r => r.json());
    const saved = loadFilter();
    if (saved && saved.preset) {
      filterState.preset = saved.preset;
      const r = saved.preset === 'custom' ? { start: saved.start, end: saved.end } : resolvePreset(saved.preset);
      filterState.start = r.start; filterState.end = r.end;
    } else {
      const r = resolvePreset('all');
      filterState.start = r.start; filterState.end = r.end;
    }
    renderTopbar();
    await buildSidebar();
    window.addEventListener('hashchange', route);
    await route();
    showWelcome();
    initChat();
    watchBuild();
  }
  start();
})();
