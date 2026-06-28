/* Small DOM + formatting helpers and a reusable sortable table. No framework. */
(function () {
  const fmt = n => (n == null ? '-' : Number(n).toLocaleString());
  const fmt1 = n => (n == null ? '-' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 }));
  const pct = n => (n == null ? '-' : n + '%');

  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k.startsWith('on') && typeof attrs[k] === 'function') e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    }
    for (const kid of kids.flat()) if (kid != null) e.append(kid.nodeType ? kid : document.createTextNode(kid));
    return e;
  }

  const groupTag = g => `<span class="tag ${(g || 'other').toLowerCase()}">${g}</span>`;
  const statusTag = s => `<span class="tag ${s}">${s[0].toUpperCase() + s.slice(1)}</span>`;
  const initials = name => {
    try { const [last, rest] = name.split(','); return (rest.trim()[0] + last.trim()[0]).toUpperCase(); }
    catch { return name.slice(0, 2).toUpperCase(); }
  };
  const avatar = (name, lg) => `<span class="avatar${lg ? ' lg' : ''}">${initials(name)}</span>`;

  function kpi(label, value, sub) {
    return `<div class="card kpi"><div class="k-label">${label}</div>
      <div class="k-value">${value}</div><div class="k-sub">${sub || ''}</div></div>`;
  }

  function miniBar(value, max, alt) {
    const w = max ? Math.round(value / max * 100) : 0;
    const bg = alt ? 'background:linear-gradient(90deg,#f5b14c,#a78bfa)' : '';
    return `<div class="bar-cell mono">${fmt(value)}<div class="bar-track"><div class="bar-fill" style="width:${w}%;${bg}"></div></div></div>`;
  }

  /* Sortable table.
     columns: [{key, label, num, html(row), sortVal(row)}]
     opts: { rowClick(row), initialSort:{key,dir}, maxHeight } */
  function sortableTable(columns, rows, opts = {}) {
    let sortKey = opts.initialSort?.key || columns.find(c => c.num)?.key || columns[0].key;
    let sortDir = opts.initialSort?.dir || 'desc';
    // Optional isolate mode: select rows, then "Hide unselected" masks everyone else
    // (for clean screenshots of just the people you want to show).
    const iso = opts.isolate ? { idOf: opts.isolate.idOf || (r => r.id) } : null;
    const selected = new Set();
    let hideOthers = false;

    const container = el('div');
    let barCount = null;
    if (iso) {
      const bar = el('div', { class: 'toolbar', style: 'margin-bottom:8px;' });
      const hideBtn = el('span', { class: 'chip' }, 'Hide unselected');
      hideBtn.addEventListener('click', () => { hideOthers = !hideOthers; hideBtn.classList.toggle('active', hideOthers); renderBody(); });
      const clr = el('span', { class: 'chip' }, 'Clear');
      clr.addEventListener('click', () => { selected.clear(); hideOthers = false; hideBtn.classList.remove('active'); renderBody(); });
      barCount = el('span', { class: 'dim', style: 'font-size:11px;align-self:center;' });
      bar.append(el('span', { class: 'muted', style: 'font-size:11px;align-self:center;' }, 'Tick rows then'), hideBtn, clr, barCount);
      container.append(bar);
    }
    const wrap = el('div', { class: 'tbl-wrap' });
    const table = el('table', { class: 'data' });
    const thead = el('thead');
    const tbody = el('tbody');
    table.append(thead, tbody);
    wrap.append(table);
    container.append(wrap);

    function valOf(col, row) { return col.sortVal ? col.sortVal(row) : row[col.key]; }
    function renderHead() {
      thead.innerHTML = '';
      const tr = el('tr');
      if (iso) tr.append(el('th', { style: 'width:26px' }));
      columns.forEach(col => {
        const arrow = col.key === sortKey ? `<span class="arrow">${sortDir === 'asc' ? '▲' : '▼'}</span>` : '';
        const th = el('th', { class: col.num ? 'num' : '', html: col.label + arrow });
        if (col.sortable !== false) th.addEventListener('click', () => {
          if (sortKey === col.key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
          else { sortKey = col.key; sortDir = col.num ? 'desc' : 'asc'; }
          renderHead(); renderBody();
        });
        tr.append(th);
      });
      thead.append(tr);
    }
    function renderBody() {
      const col = columns.find(c => c.key === sortKey);
      const sorted = [...rows].sort((a, b) => {
        let x = valOf(col, a), y = valOf(col, b);
        if (typeof x === 'string') { x = x.toLowerCase(); y = String(y).toLowerCase(); }
        if (x < y) return sortDir === 'asc' ? -1 : 1;
        if (x > y) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });
      tbody.innerHTML = '';
      sorted.forEach((row, i) => {
        const tr = el('tr');
        const id = iso ? iso.idOf(row) : null;
        const masked = iso && hideOthers && !selected.has(id);
        if (iso) {
          const box = el('input', { type: 'checkbox' });
          box.checked = selected.has(id);
          box.style.cursor = 'pointer';
          box.addEventListener('click', e => {
            e.stopPropagation();
            if (box.checked) selected.add(id); else selected.delete(id);
            if (barCount) barCount.textContent = `${selected.size} selected`;
            if (hideOthers) renderBody();  // only re-render when masking is on
          });
          const td = el('td'); td.append(box); tr.append(td);
        }
        columns.forEach(col => {
          const raw = col.html ? col.html(row, i) : (col.num ? fmt(row[col.key]) : (row[col.key] ?? ''));
          const html = masked ? '<span class="dim">&middot;&middot;&middot;</span>' : raw;
          tr.append(el('td', { class: col.num ? 'num' : '', html }));
        });
        if (opts.rowClick && !masked) tr.addEventListener('click', () => opts.rowClick(row));
        if (masked) tr.style.opacity = '0.5';
        tbody.append(tr);
      });
      if (barCount) barCount.textContent = `${selected.size} selected`;
    }
    renderHead(); renderBody();
    if (opts.maxHeight) wrap.style.maxHeight = opts.maxHeight;
    return container;
  }

  window.UI = { fmt, fmt1, pct, el, groupTag, statusTag, avatar, initials, kpi, miniBar, sortableTable };
})();
