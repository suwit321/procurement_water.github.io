/* charts.js — ตัวห่อ Plotly

   ใช้ Plotly.react แทน newPlot เพื่อให้การอัปเดตเป็นการ diff ไม่ใช่สร้างกราฟใหม่ทั้งหมด
   และเปิด modebar ไว้เพื่อให้ผู้ใช้บันทึกกราฟเป็น PNG ได้ (ของเดิมปิดไว้ทุกจุด)
*/
'use strict';

const Charts = (() => {

  const C = {
    teal: '#0f766e', orange: '#ea580c', red: '#b91c1c', yellow: '#ca8a04',
    purple: '#7c3aed', indigo: '#4338ca', blue: '#1d4ed8', green: '#166534',
    grey: '#94a3b8', pink: '#db2777', sky: '#0ea5e9',
  };

  const CATEGORICAL = [C.teal, C.orange, C.purple, C.blue, C.yellow,
    C.red, C.green, C.pink, C.sky, C.indigo];

  const FONT = { family: "'IBM Plex Sans Thai', system-ui, sans-serif", size: 11, color: '#1f2937' };

  const CONFIG = {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d'],
    toImageButtonOptions: { format: 'png', scale: 2 },
  };

  function baseLayout(extra = {}) {
    return Object.assign({
      font: FONT,
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      margin: { t: 30, l: 60, r: 20, b: 45 },
      hoverlabel: { font: { family: FONT.family, size: 11 } },
      xaxis: { gridcolor: '#eef2f7', zerolinecolor: '#e5e7eb' },
      yaxis: { gridcolor: '#eef2f7', zerolinecolor: '#e5e7eb' },
    }, extra);
  }

  /** วาดกราฟ; ถ้าไม่มีข้อมูลให้แสดงข้อความแทนที่จะปล่อยพื้นที่ว่าง
   *  (ของเดิมกราฟว่างแยกไม่ออกจาก widget ที่พัง) */
  function draw(id, traces, layout = {}, emptyMessage = 'ไม่มีข้อมูลสำหรับกราฟนี้') {
    const el = U.$(id);
    if (!el) return;
    // ต้องครอบคลุมทุกชนิดกราฟที่ใช้: cartesian (x/y), pie (values/labels),
    // sankey (link), treemap (labels) และ scatterpolar (r/theta)
    const hasData = traces.some(t =>
      (t.x && t.x.length) || (t.y && t.y.length) ||
      (t.values && t.values.length) || (t.labels && t.labels.length) ||
      (t.r && t.r.length) ||
      (t.link && t.link.value && t.link.value.length));
    if (!hasData) {
      if (el.dataset.plotted) { Plotly.purge(el); delete el.dataset.plotted; }
      el.innerHTML = U.emptyState(emptyMessage);
      return;
    }
    if (!el.dataset.plotted) el.innerHTML = '';
    Plotly.react(el, traces, baseLayout(layout), CONFIG);
    el.dataset.plotted = '1';
  }

  /** เรียกเมื่อแท็บถูกเปิด — กราฟที่วาดตอนแท็บซ่อนอยู่จะมีความกว้าง 0 */
  function resizeIn(container) {
    if (!container) return;
    container.querySelectorAll('[data-plotted]').forEach(el => {
      try { Plotly.Plots.resize(el); } catch (e) { /* กราฟยังไม่พร้อม */ }
    });
  }

  /* ---------- รูปแบบกราฟที่ใช้ซ้ำ ---------- */

  function bar(id, labels, values, { title, color, horizontal = false, valueFormat, colors, axisTitle } = {}) {
    const marker = { color: colors || color || C.teal };
    const trace = horizontal
      ? { type: 'bar', orientation: 'h', y: labels, x: values, marker }
      : { type: 'bar', x: labels, y: values, marker };
    trace.hovertemplate = '%{' + (horizontal ? 'y' : 'x') + '}<br>' +
      (valueFormat || '%{' + (horizontal ? 'x' : 'y') + ':,.0f}') + '<extra></extra>';
    draw(id, [trace], {
      title: title ? { text: title, font: { size: 12 } } : undefined,
      margin: horizontal ? { t: title ? 34 : 12, l: 220, r: 24, b: 40 } : { t: title ? 34 : 12, l: 66, r: 20, b: 70 },
      xaxis: horizontal ? { title: axisTitle, gridcolor: '#eef2f7' } : { automargin: true, gridcolor: '#eef2f7' },
      yaxis: horizontal ? { automargin: true, autorange: 'reversed' } : { title: axisTitle, gridcolor: '#eef2f7' },
    });
  }

  function donut(id, labels, values, colors) {
    draw(id, [{
      type: 'pie', hole: 0.58, labels, values,
      marker: { colors: colors || CATEGORICAL },
      textinfo: 'percent', hovertemplate: '%{label}<br>%{value:,.0f} (%{percent})<extra></extra>',
    }], { margin: { t: 12, l: 12, r: 12, b: 12 }, showlegend: true, legend: { orientation: 'h', y: -0.08, font: { size: 10 } } });
  }

  function sankey(id, edges, { nodeColorFn, height } = {}) {
    if (!edges.length) { draw(id, [], {}, 'ไม่มีเส้นเชื่อมตามเงื่อนไขที่เลือก'); return; }
    const sources = new Set(edges.map(e => e.source));
    const nodes = [...new Set(edges.flatMap(e => [e.source, e.target]))];
    const index = new Map(nodes.map((n, i) => [n, i]));
    draw(id, [{
      type: 'sankey', orientation: 'h',
      node: {
        label: nodes, pad: 11, thickness: 13,
        line: { color: '#ffffff', width: 0.5 },
        color: nodes.map(n => nodeColorFn
          ? nodeColorFn(n, sources.has(n) ? 'agency' : 'contractor')
          : (sources.has(n) ? C.teal : C.orange)),
        hovertemplate: '%{label}<br>รวม %{value:,.0f} บาท<extra></extra>',
      },
      link: {
        source: edges.map(e => index.get(e.source)),
        target: edges.map(e => index.get(e.target)),
        value: edges.map(e => Math.max(e.value, 1)),
        color: 'rgba(15,118,110,0.20)',
        customdata: edges.map(e => [e.n, e.value]),
        hovertemplate: '%{source.label} → %{target.label}<br>' +
          '%{customdata[0]} สัญญา · %{customdata[1]:,.0f} บาท<extra></extra>',
      },
    }], { font: { size: 10, family: FONT.family }, margin: { t: 10, l: 10, r: 10, b: 10 }, height });
  }

  function scatter(id, points, { xTitle, yTitle, colorTitle } = {}) {
    draw(id, [{
      type: 'scatter', mode: 'markers',
      x: points.map(p => p.x), y: points.map(p => p.y),
      text: points.map(p => p.label),
      marker: {
        size: points.map(p => p.size ?? 9),
        color: points.map(p => p.color ?? 0),
        colorscale: 'YlOrRd', showscale: !!colorTitle,
        colorbar: colorTitle ? { title: { text: colorTitle, font: { size: 10 } }, thickness: 12 } : undefined,
        line: { width: 0.5, color: 'rgba(0,0,0,0.15)' },
      },
      hovertemplate: '%{text}<extra></extra>',
    }], {
      xaxis: { title: xTitle, gridcolor: '#eef2f7' },
      yaxis: { title: yTitle, gridcolor: '#eef2f7' },
      margin: { t: 16, l: 70, r: 20, b: 55 },
    });
  }

  function lines(id, xLabels, series, { yTitle, mode = 'lines+markers' } = {}) {
    draw(id, series.map((s, i) => ({
      type: 'scatter', mode, name: s.name, x: xLabels, y: s.y,
      line: { color: CATEGORICAL[i % CATEGORICAL.length], width: 2 },
      marker: { size: 6 },
      hovertemplate: '%{fullData.name}<br>%{x}: %{y:,.0f}<extra></extra>',
    })), {
      yaxis: { title: yTitle, gridcolor: '#eef2f7' },
      xaxis: { gridcolor: '#eef2f7' },
      margin: { t: 16, l: 70, r: 20, b: 50 },
      legend: { orientation: 'h', y: -0.16, font: { size: 10 } },
      hovermode: 'x unified',
    });
  }

  function waterfall(id, labels, values, title) {
    draw(id, [{
      type: 'waterfall', x: labels, y: values,
      connector: { line: { color: C.grey } },
      increasing: { marker: { color: C.orange } },
      totals: { marker: { color: C.teal } },
      hovertemplate: '%{x}: +%{y}<extra></extra>',
    }], {
      title: title ? { text: title, font: { size: 11 } } : undefined,
      margin: { t: title ? 40 : 16, l: 44, r: 16, b: 40 },
      yaxis: { title: 'น้ำหนักคะแนน', gridcolor: '#eef2f7' },
    }, 'ไม่พบสัญญาณความเสี่ยงในรายการนี้');
  }

  function radar(id, categories, values) {
    draw(id, [{
      type: 'scatterpolar', r: [...values, values[0]], theta: [...categories, categories[0]],
      fill: 'toself', fillcolor: 'rgba(234,88,12,0.18)',
      line: { color: C.orange, width: 2 },
      hovertemplate: '%{theta}: %{r:.1f}<extra></extra>',
    }], {
      polar: { radialaxis: { visible: true, range: [0, 100], gridcolor: '#e5e7eb' }, angularaxis: { gridcolor: '#e5e7eb' } },
      showlegend: false, margin: { t: 30, l: 50, r: 50, b: 30 },
    });
  }

  function treemap(id, edges) {
    if (!edges.length) { draw(id, [], {}, 'ไม่มีข้อมูลตามเงื่อนไขที่เลือก'); return; }
    const agencies = [...new Set(edges.map(e => e.source))];
    const labels = [...agencies], parents = agencies.map(() => ''), values = agencies.map(() => 0);
    for (const e of edges) {
      labels.push(e.source + ' | ' + e.target);
      parents.push(e.source);
      values.push(e.value);
    }
    draw(id, [{
      type: 'treemap', labels, parents, values, branchvalues: 'remainder',
      marker: { colorscale: 'Teal' },
      hovertemplate: '%{label}<br>%{value:,.0f} บาท<extra></extra>',
      textinfo: 'label+value',
    }], { margin: { t: 10, l: 10, r: 10, b: 10 } });
  }

  return { C, CATEGORICAL, draw, resizeIn, bar, donut, sankey, scatter, lines, waterfall, radar, treemap, CONFIG, baseLayout };
})();
