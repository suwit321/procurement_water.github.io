/* util.js — ฟังก์ชันพื้นฐาน: จัดรูปแบบ, สถิติ, วันที่, DOM
   โหลดก่อนไฟล์อื่นทั้งหมด */
'use strict';

const U = (() => {

  /* ---------- จัดรูปแบบ ---------- */

  /* Number.prototype.toLocaleString สร้างตัวจัดรูปแบบใหม่ทุกครั้งที่เรียก
     ซึ่งช้ามากเมื่อเรียกหลายพันครั้งต่อการประเมินหนึ่งรอบ
     การเก็บ Intl.NumberFormat ไว้ใช้ซ้ำเร็วกว่าหลายสิบเท่า */
  const _formatters = new Map();

  function formatter(digits) {
    let f = _formatters.get(digits);
    if (!f) {
      f = new Intl.NumberFormat('th-TH', {
        minimumFractionDigits: digits, maximumFractionDigits: digits
      });
      _formatters.set(digits, f);
    }
    return f;
  }

  function num(x, digits = 0) {
    if (x === null || x === undefined || x === '' || Number.isNaN(Number(x))) return '-';
    return formatter(digits).format(Number(x));
  }

  /** ย่อจำนวนเงินเป็น พัน/ล้าน/พันล้าน — ตัวเลขเต็มอ่านยากในการ์ด KPI */
  function money(x) {
    if (x === null || x === undefined || Number.isNaN(Number(x))) return '-';
    const v = Number(x);
    const abs = Math.abs(v);
    if (abs >= 1e9) return (v / 1e9).toFixed(2) + ' พันล้าน';
    if (abs >= 1e6) return (v / 1e6).toFixed(2) + ' ล้าน';
    if (abs >= 1e3) return (v / 1e3).toFixed(1) + ' พัน';
    return num(v, 0);
  }

  function baht(x) { return x === null || x === undefined ? '-' : num(x, 2) + ' บาท'; }

  function pct(x, digits = 1) {
    if (x === null || x === undefined || Number.isNaN(Number(x))) return '-';
    return (Number(x) * 100).toFixed(digits) + '%';
  }

  function esc(x) {
    return String(x ?? '').replace(/[&<>"']/g,
      m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  /* ---------- วันที่ ---------- */

  const THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

  /** '2025-11-20' -> '20 พ.ย. 68' (แสดงผลเป็น พ.ศ. ตามต้นฉบับ) */
  function thaiDate(iso) {
    if (!iso) return '-';
    const d = new Date(iso + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return '-';
    const be = d.getFullYear() + 543;
    return `${d.getDate()} ${THAI_MONTHS_SHORT[d.getMonth()]} ${String(be).slice(-2)}`;
  }

  /** '2025-11-20' -> '2025-11' สำหรับจัดกลุ่มรายเดือน */
  function monthKey(iso) { return iso ? iso.slice(0, 7) : null; }

  function thaiMonthLabel(key) {
    if (!key) return '-';
    const [y, m] = key.split('-').map(Number);
    return `${THAI_MONTHS_SHORT[m - 1]} ${String(y + 543).slice(-2)}`;
  }

  /* ---------- สถิติ ---------- */

  const sum = a => a.reduce((s, x) => s + (Number(x) || 0), 0);
  const mean = a => (a.length ? sum(a) / a.length : 0);

  function quantile(sorted, q) {
    if (!sorted.length) return 0;
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  function median(values) {
    return quantile([...values].sort((a, b) => a - b), 0.5);
  }

  function stddev(values) {
    if (values.length < 2) return 0;
    const m = mean(values);
    return Math.sqrt(sum(values.map(v => (v - m) ** 2)) / (values.length - 1));
  }

  /** สัมประสิทธิ์การแปรผัน — ใช้วัดการกระจายของราคาภายในหน่วยงาน */
  function cv(values) {
    const m = mean(values);
    return m === 0 ? 0 : stddev(values) / m;
  }

  /** ขอบเขต outlier แบบ Tukey; ใช้ 3.0 เพื่อจับเฉพาะค่าสุดโต่งจริง */
  function iqrBounds(values, k = 3.0) {
    const sorted = [...values].sort((a, b) => a - b);
    const q1 = quantile(sorted, 0.25), q3 = quantile(sorted, 0.75);
    const iqr = q3 - q1;
    return { q1, q3, iqr, lower: q1 - k * iqr, upper: q3 + k * iqr };
  }

  /* ---------- การจัดกลุ่ม ---------- */

  function groupBy(rows, keyFn) {
    const map = new Map();
    for (const row of rows) {
      const key = keyFn(row);
      if (key === null || key === undefined || key === '') continue;
      let bucket = map.get(key);
      if (!bucket) { bucket = []; map.set(key, bucket); }
      bucket.push(row);
    }
    return map;
  }

  function countBy(rows, keyFn) {
    const map = new Map();
    for (const row of rows) {
      const key = keyFn(row);
      if (key === null || key === undefined || key === '') continue;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }

  /* ---------- ภูมิศาสตร์ ---------- */

  /** ระยะทางวงกลมใหญ่ (กม.) */
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371, toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  /* ---------- DOM ---------- */

  const $ = id => document.getElementById(id);

  /* ตัวรับแจ้งหลังวาดเนื้อหาใหม่
     ใช้แทน MutationObserver เพราะทำงานตรงจุดและตามลำดับที่แน่นอน
     ผู้รับแจ้งจะไม่ถูกเรียกซ้ำจากการแก้ DOM ของตัวเอง */
  const _renderHooks = [];
  function onRender(fn) { _renderHooks.push(fn); }

  function setHTML(id, html) {
    const el = $(id);
    if (!el) return;
    el.innerHTML = html;
    for (const fn of _renderHooks) {
      try { fn(el); } catch (e) { console.error('render hook ล้มเหลว', e); }
    }
  }

  /** ข้อความว่างที่มีกรอบชัดเจน — เดิมช่องว่างเปล่าแยกไม่ออกจาก widget ที่พัง */
  function emptyState(message = 'ไม่พบข้อมูลตามเงื่อนไขที่เลือก') {
    return `<div class="empty-state">${esc(message)}</div>`;
  }

  function emptyRow(colspan, message = 'ไม่พบข้อมูลตามเงื่อนไขที่เลือก') {
    return `<tr><td colspan="${colspan}" class="text-center small-muted py-4">${esc(message)}</td></tr>`;
  }

  function debounce(fn, wait = 200) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  /* ---------- ส่งออก CSV ---------- */

  function toCSV(headers, rows) {
    const cell = v => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return [headers.map(cell).join(','), ...rows.map(r => r.map(cell).join(','))].join('\n');
  }

  function downloadCSV(filename, headers, rows) {
    // BOM เพื่อให้ Excel อ่านภาษาไทยถูกต้อง
    const blob = new Blob(['﻿' + toCSV(headers, rows)],
      { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return {
    num, money, baht, pct, esc,
    thaiDate, monthKey, thaiMonthLabel, THAI_MONTHS_SHORT,
    sum, mean, median, quantile, stddev, cv, iqrBounds,
    groupBy, countBy, haversine,
    $, setHTML, onRender, emptyState, emptyRow, debounce,
    toCSV, downloadCSV,
  };
})();
