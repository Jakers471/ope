/* ECharts builders with a shared Teal/Slate dark theme.
   Each builder takes a DOM element and a data object and returns the instance.
   Instances are tracked so the SPA can dispose/resize them cleanly. */
(function () {
  const C = {
    bg: '#0a0e13', panel: '#131a23', border: '#232e3a', grid: '#1c2733',
    text: '#e6edf3', text2: '#9aa7b4', text3: '#6b7886',
    accent: '#2dd4bf', accent2: '#4c8dff', amber: '#f5b14c',
    violet: '#a78bfa', pink: '#f472b6', green: '#34d399', red: '#f87171'
  };
  const SHIFT_COLORS = { AM: C.accent2, PM: C.accent, '167': C.amber, Training: C.violet };
  const GROUP_COLORS = { FOH: C.accent2, BOH: C.green, Events: C.amber, Other: C.text3 };

  const PALETTE = [
    '#2dd4bf', '#4c8dff', '#f5b14c', '#a78bfa', '#f472b6', '#34d399',
    '#f87171', '#38bdf8', '#fb923c', '#a3e635', '#e879f9', '#22d3ee',
    '#fbbf24', '#60a5fa', '#fca5a5', '#5eead4', '#c084fc', '#84cc16',
    '#fda4af', '#93c5fd', '#fcd34d', '#6ee7b7', '#f0abfc', '#fb7185', '#7dd3fc'
  ];
  const instances = new Set();
  function init(el) {
    const inst = echarts.init(el, null, { renderer: 'canvas' });
    instances.add(inst);
    return inst;
  }
  function disposeAll() { instances.forEach(i => i.dispose()); instances.clear(); }
  function disposeEl(el) { const i = echarts.getInstanceByDom(el); if (i) { i.dispose(); instances.delete(i); } }
  function resizeAll() { instances.forEach(i => i.resize()); }
  window.addEventListener('resize', resizeAll);

  const tooltip = (extra = {}) => Object.assign({
    backgroundColor: '#0d141c', borderColor: C.border, borderWidth: 1,
    textStyle: { color: C.text, fontSize: 12 },
    axisPointer: { lineStyle: { color: C.border2 || '#2c3a48' }, crossStyle: { color: '#2c3a48' } }
  }, extra);
  const baseGrid = { left: 48, right: 18, top: 26, bottom: 30, containLabel: true };
  const legend = (extra = {}) => Object.assign({
    textStyle: { color: C.text2 }, inactiveColor: C.text3, top: 0, right: 0,
    icon: 'roundRect', itemWidth: 9, itemHeight: 9
  }, extra);
  const catAxis = (data, o = {}) => Object.assign({
    type: 'category', data, boundaryGap: o.boundaryGap !== false,
    axisLine: { lineStyle: { color: C.border } }, axisTick: { show: false },
    axisLabel: Object.assign({ color: C.text3, fontSize: 11 }, o.axisLabel || {}),
    splitLine: { show: false }
  }, o.extra || {});
  const valAxis = (o = {}) => Object.assign({
    type: 'value', axisLine: { show: false }, axisTick: { show: false },
    axisLabel: Object.assign({ color: C.text3, fontSize: 11 }, o.axisLabel || {}),
    splitLine: { lineStyle: { color: C.grid } }
  }, o.extra || {});
  const areaGrad = c => new echarts.graphic.LinearGradient(0, 0, 0, 1,
    [{ offset: 0, color: c + '55' }, { offset: 1, color: c + '02' }]);
  const grad = (a, b) => new echarts.graphic.LinearGradient(0, 0, 0, 1,
    [{ offset: 0, color: a }, { offset: 1, color: b }]);
  const labelEvery = n => (n > 90 ? 25 : n > 30 ? 7 : 0);

  function lineArea(el, { x, y, color = C.accent, fmt }) {
    const c = init(el);
    c.setOption({
      tooltip: tooltip({ trigger: 'axis' }), grid: baseGrid,
      xAxis: catAxis(x, { boundaryGap: false, axisLabel: { interval: labelEvery(x.length), formatter: v => String(v).slice(0, 7) } }),
      yAxis: valAxis({ axisLabel: { formatter: fmt } }),
      series: [{ type: 'line', data: y, smooth: true, showSymbol: false,
        lineStyle: { width: 2, color }, areaStyle: { color: areaGrad(color) }, emphasis: { focus: 'series' } }]
    });
    return c;
  }

  function stackedArea(el, { x, series }) {
    const c = init(el);
    c.setOption({
      tooltip: tooltip({ trigger: 'axis' }), legend: legend({ data: series.map(s => s.name) }), grid: baseGrid,
      xAxis: catAxis(x, { boundaryGap: false, axisLabel: { interval: labelEvery(x.length), formatter: v => String(v).slice(0, 7) } }),
      yAxis: valAxis(),
      series: series.map(s => ({ name: s.name, type: 'line', stack: 'total', smooth: true,
        showSymbol: false, lineStyle: { width: 0 }, areaStyle: { color: s.color + 'cc' }, data: s.data }))
    });
    return c;
  }

  function stackedBar(el, { x, series, horizontal }) {
    const c = init(el);
    const opt = {
      tooltip: tooltip({ trigger: 'axis', axisPointer: { type: 'shadow' } }),
      legend: legend({ data: series.map(s => s.name) }), grid: baseGrid,
      series: series.map(s => ({ name: s.name, type: 'bar', stack: 'total',
        barWidth: '54%', itemStyle: { color: s.color }, data: s.data }))
    };
    if (horizontal) { opt.xAxis = valAxis(); opt.yAxis = catAxis(x, { boundaryGap: true }); }
    else { opt.xAxis = catAxis(x, { axisLabel: { fontSize: 10, interval: 0, rotate: x.length > 6 ? 18 : 0 } }); opt.yAxis = valAxis(); }
    c.setOption(opt);
    return c;
  }

  function donut(el, data) {
    const c = init(el);
    c.setOption({
      tooltip: tooltip({ trigger: 'item', formatter: p => `${p.name}: ${p.value.toLocaleString()} (${p.percent}%)` }),
      series: [{ type: 'pie', radius: ['56%', '82%'], center: ['50%', '50%'], avoidLabelOverlap: true,
        label: { show: false }, itemStyle: { borderColor: C.panel, borderWidth: 2 }, data }]
    });
    return c;
  }

  function hbar(el, { cats, data, c1 = C.accent2, c2 = C.accent, suffix = '' }) {
    const c = init(el);
    c.setOption({
      tooltip: tooltip({ trigger: 'axis', axisPointer: { type: 'shadow' } }),
      grid: { left: 8, right: 40, top: 8, bottom: 8, containLabel: true },
      xAxis: valAxis(), yAxis: catAxis(cats, { extra: { axisLabel: { color: C.text2, fontSize: 11 } } }),
      series: [{ type: 'bar', barWidth: '62%', data,
        itemStyle: { color: grad(c1, c2), borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: 'right', color: C.text3, fontFamily: 'monospace', fontSize: 10,
          formatter: p => p.value.toLocaleString() + suffix } }]
    });
    return c;
  }

  function groupedBar(el, { x, series }) {
    const c = init(el);
    c.setOption({
      tooltip: tooltip({ trigger: 'axis', axisPointer: { type: 'shadow' } }),
      legend: legend({ data: series.map(s => s.name) }), grid: baseGrid,
      xAxis: catAxis(x), yAxis: valAxis(),
      series: series.map(s => ({ name: s.name, type: 'bar', barGap: '12%', barWidth: series.length > 1 ? '22%' : '50%',
        itemStyle: { color: s.color, borderRadius: [3, 3, 0, 0] }, data: s.data }))
    });
    return c;
  }

  function heatmap(el, { months, dow, data }) {
    const c = init(el);
    let mx = 0; data.forEach(d => { mx = Math.max(mx, d[2]); });
    c.setOption({
      tooltip: tooltip({ position: 'top', formatter: p => `${months[p.data[0]]} ${dow[p.data[1]]}: ${p.data[2]} shifts` }),
      grid: { left: 44, right: 14, top: 8, bottom: 54, containLabel: true },
      xAxis: { type: 'category', data: months, axisLine: { lineStyle: { color: C.border } }, axisTick: { show: false },
        axisLabel: { color: C.text3, fontSize: 9, rotate: 40, interval: months.length > 24 ? 1 : 0 } },
      yAxis: { type: 'category', data: dow.map(d => d.slice(0, 3)), axisLine: { lineStyle: { color: C.border } }, axisTick: { show: false }, axisLabel: { color: C.text3, fontSize: 10 } },
      visualMap: { min: 0, max: mx, calculable: true, orient: 'horizontal', left: 'center', bottom: 0,
        textStyle: { color: C.text3, fontSize: 10 }, inRange: { color: [C.panel, C.accent2, C.accent] } },
      series: [{ type: 'heatmap', data, itemStyle: { borderColor: C.bg, borderWidth: 2 },
        emphasis: { itemStyle: { borderColor: C.text2 } } }]
    });
    return c;
  }

  // Person activity timeline: bars per week, zero weeks shown muted (breaks/vacations).
  function activityBars(el, { x, y }) {
    const c = init(el);
    c.setOption({
      tooltip: tooltip({ trigger: 'axis', axisPointer: { type: 'shadow' } }),
      grid: baseGrid,
      xAxis: catAxis(x, { axisLabel: { interval: labelEvery(x.length), formatter: v => String(v).slice(0, 7) } }),
      yAxis: valAxis(),
      series: [{ type: 'bar', data: y, barWidth: '64%',
        itemStyle: { color: p => (p.value === 0 ? C.grid : C.accent), borderRadius: [2, 2, 0, 0] } }]
    });
    return c;
  }

  // Overlaid multi-line: many people's weekly hours (or share %) on one chart.
  function multiLine(el, { x, series, yFormatter, area }) {
    const c = init(el);
    c.setOption({
      tooltip: tooltip({ trigger: 'axis', confine: true,
        order: 'valueDesc',
        valueFormatter: v => (yFormatter ? yFormatter(v) : v) }),
      legend: legend({ type: 'scroll', top: 0, left: 0, right: 0, data: series.map(s => s.name) }),
      grid: { left: 48, right: 18, top: 46, bottom: 30, containLabel: true },
      xAxis: catAxis(x, { boundaryGap: false, axisLabel: { interval: labelEvery(x.length), formatter: v => String(v).slice(0, 7) } }),
      yAxis: valAxis({ axisLabel: { formatter: yFormatter } }),
      series: series.map(s => ({
        name: s.name, type: 'line', data: s.data, smooth: true, showSymbol: false,
        lineStyle: { width: 1.1, color: s.color, opacity: 0.85 },
        itemStyle: { color: s.color },
        areaStyle: area ? { color: s.color + '20' } : undefined,
        emphasis: { focus: 'series', lineStyle: { width: 2.6, opacity: 1 } },
        blur: { lineStyle: { opacity: 0.12 } }, z: 2
      }))
    });
    return c;
  }

  // Scatter with an optional dashed trend line and an optional gold "trail"
  // (a person's path over time). points: [{x,y,name,color,size,border}].
  function scatter(el, { points, xName, yName, xFmt, yFmt, trend, trail }) {
    const c = init(el);
    const series = [{
      type: 'scatter',
      data: points.map(p => ({
        value: [p.x, p.y], name: p.name,
        symbolSize: p.size || 10,
        itemStyle: { color: p.color, borderColor: p.border || 'rgba(0,0,0,0)', borderWidth: p.border ? 2 : 0, opacity: 0.92 }
      })), z: 3
    }];
    if (trend) series.push({
      type: 'line', data: [[trend.x1, trend.y1], [trend.x2, trend.y2]],
      showSymbol: false, silent: true, z: 1,
      lineStyle: { color: C.text3, type: 'dashed', width: 1.4 }, tooltip: { show: false }
    });
    if (trail && trail.length > 1) series.push({
      type: 'line', data: trail, showSymbol: true, symbol: 'circle', symbolSize: 4,
      lineStyle: { color: C.amber, width: 1.6, opacity: 0.85 }, itemStyle: { color: C.amber, opacity: 0.85 },
      z: 2, silent: true, tooltip: { show: false }
    });
    c.setOption({
      tooltip: tooltip({ trigger: 'item', formatter: p => p.seriesType === 'line' ? '' :
        `<b>${p.data.name}</b><br>${xName}: ${p.data.value[0]}<br>${yName}: ${(yFmt ? yFmt(p.data.value[1]) : p.data.value[1])}` }),
      grid: { left: 56, right: 22, top: 18, bottom: 42, containLabel: true },
      xAxis: valAxis({ axisLabel: { formatter: xFmt }, extra: { name: xName, nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: C.text3, fontSize: 11 } } }),
      yAxis: valAxis({ axisLabel: { formatter: yFmt }, extra: { name: yName, nameTextStyle: { color: C.text3, fontSize: 11 } } }),
      series
    });
    return c;
  }

  // Percentile-over-time line (0-100) with a 50 reference; segments green above
  // the midline (favored) and red below (snubbed).
  function percentileLine(el, { x, y }) {
    const c = init(el);
    c.setOption({
      tooltip: tooltip({ trigger: 'axis', valueFormatter: v => (v == null ? '-' : v + '%') }),
      grid: { left: 44, right: 18, top: 14, bottom: 30, containLabel: true },
      xAxis: catAxis(x, { boundaryGap: false, axisLabel: { interval: labelEvery(x.length), formatter: v => String(v).slice(0, 7) } }),
      yAxis: valAxis({ extra: { min: 0, max: 100 }, axisLabel: { formatter: v => v + '%' } }),
      series: [{
        type: 'line', data: y, smooth: true, connectNulls: false,
        showSymbol: true, symbol: 'circle', symbolSize: 5,
        lineStyle: { width: 2.6, color: C.amber }, itemStyle: { color: C.amber },
        markLine: { silent: true, symbol: 'none', data: [{ yAxis: 50 }], lineStyle: { color: C.text3, type: 'dashed' }, label: { formatter: 'fair (50%)', color: C.text3, fontSize: 10, position: 'insideEndTop' } },
        markArea: {
          silent: true, data: [
            [{ yAxis: 50, itemStyle: { color: 'rgba(52,211,153,0.07)' } }, { yAxis: 100 }],
            [{ yAxis: 0, itemStyle: { color: 'rgba(248,113,113,0.07)' } }, { yAxis: 50 }]
          ]
        }
      }]
    });
    return c;
  }

  // Ranked bar chart with optional horizontal reference lines (e.g. avg, median).
  function barAvg(el, { cats, data, color = C.accent, lines = [] }) {
    const c = init(el);
    c.setOption({
      tooltip: tooltip({ trigger: 'axis', axisPointer: { type: 'shadow' } }),
      grid: { left: 40, right: 16, top: 22, bottom: cats.length > 10 ? 70 : 34, containLabel: true },
      xAxis: catAxis(cats, { axisLabel: { fontSize: 9.5, interval: 0, rotate: cats.length > 10 ? 38 : 0 } }),
      yAxis: valAxis(),
      series: [{
        type: 'bar', data, barWidth: '60%',
        itemStyle: { color: grad(color, color + '88'), borderRadius: [3, 3, 0, 0] },
        markLine: lines.length ? {
          silent: true, symbol: 'none',
          data: lines.map(l => ({
            yAxis: l.value,
            lineStyle: { color: l.color || C.text3, type: 'dashed', width: 1.4 },
            label: { formatter: `${l.label}: ${l.value}`, color: l.color || C.text2, position: 'insideEndTop', fontSize: 10 }
          }))
        } : undefined
      }]
    });
    return c;
  }

  // Favorability heatmap: rows = servers, cols = windows, cell = percentile (0-100).
  // avg = each row's overall percentile, shown color-coded on the right axis.
  function favorGrid(el, { rows, cols, data, avg, youRow }) {
    const c = init(el);
    const band = a => a >= 60 ? 'g' : a <= 40 ? 'r' : 'n';
    c.setOption({
      tooltip: tooltip({ position: 'top', formatter: p => `${rows[p.data[1]]}<br>${cols[p.data[0]]}: ${p.data[2]}%ile` }),
      grid: { left: 146, right: 58, top: 30, bottom: 38, containLabel: false },
      visualMap: {
        min: 0, max: 100, calculable: true, orient: 'horizontal', left: 'center', top: 0,
        text: ['favored', 'overlooked'], textStyle: { color: C.text3, fontSize: 10 }, inRange: { color: [C.red, C.amber, C.green] }
      },
      xAxis: {
        type: 'category', data: cols, axisLine: { lineStyle: { color: C.border } }, axisTick: { show: false },
        axisLabel: { color: C.text3, fontSize: 9, interval: Math.ceil(cols.length / 9), rotate: 30, formatter: v => String(v).slice(0, 7) }
      },
      yAxis: [
        {
          type: 'category', data: rows, inverse: true, axisLine: { lineStyle: { color: C.border } }, axisTick: { show: false },
          axisLabel: { fontSize: 10, color: C.text2, width: 138, overflow: 'truncate',
            formatter: (v, i) => i === youRow ? '{y|' + v + '}' : v, rich: { y: { color: C.amber, fontWeight: 'bold' } } }
        },
        {
          type: 'category', data: rows, inverse: true, position: 'right', axisLine: { show: false }, axisTick: { show: false },
          axisLabel: { fontSize: 11, formatter: (v, i) => (avg && avg[i] != null) ? `{${band(avg[i])}|${avg[i]}%}` : '',
            rich: { g: { color: C.green, fontWeight: 'bold' }, r: { color: C.red, fontWeight: 'bold' }, n: { color: C.text2 } } }
        }
      ],
      series: [
        { type: 'heatmap', yAxisIndex: 0, data, itemStyle: { borderColor: C.bg, borderWidth: 1 }, emphasis: { itemStyle: { borderColor: C.text } } },
        // faint dotted leader line from each name to its first cell (skipped if adjacent)
        {
          type: 'custom', silent: true, z: 1, tooltip: { show: false },
          data: (() => { const f = {}; data.forEach(d => { if (f[d[1]] === undefined || d[0] < f[d[1]]) f[d[1]] = d[0]; }); return Object.keys(f).filter(r => f[r] > 0).map(r => [Number(r), f[r]]); })(),
          renderItem: (params, api) => {
            const row = api.value(0), col = api.value(1);
            const cell = api.coord([col, row]);
            const cs = params.coordSys;
            const cellW = cs.width / Math.max(cols.length, 1);
            const x1 = cs.x + 1, x2 = cell[0] - cellW / 2 - 3, y = cell[1];
            if (x2 - x1 < 8) return;
            return { type: 'line', shape: { x1, y1: y, x2, y2: y }, style: { stroke: C.text3, lineWidth: 1, lineDash: [2, 3], opacity: 0.4 } };
          }
        }
      ]
    });
    return c;
  }

  window.Charts = {
    C, SHIFT_COLORS, GROUP_COLORS, PALETTE,
    disposeAll, disposeEl, resizeAll,
    lineArea, stackedArea, stackedBar, donut, hbar, groupedBar, heatmap, activityBars, multiLine, scatter, percentileLine, favorGrid, barAvg
  };
})();
