/* tablesort.js — คลิกหัวคอลัมน์เพื่อเรียงลำดับ

   ใช้ event delegation ที่ระดับ document จึงทำงานกับทุกตารางในแอปโดยอัตโนมัติ
   รวมถึงตารางที่ถูกวาดขึ้นใหม่ภายหลัง โดยไม่ต้องแก้ฟังก์ชันวาดผลทีละจุด

   ลำดับการอ่านค่าที่ใช้เรียง:
     1. data-sort ของเซลล์ (ค่าดิบ แม่นยำที่สุด)
     2. ข้อความในเซลล์ ถอดรูปแบบไทยกลับเป็นตัวเลข เช่น "1.5 ล้าน" -> 1500000
     3. เทียบเป็นข้อความด้วย localeCompare ภาษาไทย

   สถานะการเรียงถูกเก็บไว้บน tbody เอง (data-sort-index / data-sort-dir)
   จึงไม่ต้องมีตารางอ้างอิงภายนอกและไม่รั่วเมื่อ DOM ถูกแทนที่
*/
'use strict';

const TableSort = (() => {

  const TABLE = 'table.mini-table';

  /* ---------- ถอดรูปแบบตัวเลขที่แสดงผลกลับเป็นค่าตัวเลข ---------- */

  // ต้องตรวจ "พันล้าน" ก่อน "ล้าน" และ "พัน" เพราะเป็นคำที่ซ้อนกัน
  const UNITS = [['พันล้าน', 1e9], ['ล้าน', 1e6], ['พัน', 1e3]];

  function parseNumber(text) {
    if (!text) return null;
    let s = String(text).trim();
    if (!s || s === '-' || s === '—') return null;

    let mult = 1;
    for (const [word, factor] of UNITS) {
      if (s.includes(word)) { mult = factor; s = s.replace(word, ''); break; }
    }

    s = s.replace(/[,%×\s]/g, '')
         .replace(/บาท|วัน|สัญญา|ฉบับ|ราย|หน่วยงาน|เท่า|ของมัธยฐาน/g, '');

    // ต้องเป็นตัวเลขทั้งสตริงเท่านั้น
    // ถ้าใช้ parseFloat ตรงๆ ข้อความอย่าง "0105519003571 เลขภาษี..." จะถูกอ่านเป็นตัวเลข
    // เพราะ parseFloat หยิบเฉพาะตัวเลขนำหน้ามา ทำให้คอลัมน์ข้อความถูกเรียงผิดประเภท
    if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return null;

    const n = parseFloat(s);
    return Number.isFinite(n) ? n * mult : null;
  }

  /** ค่าที่ใช้เรียงของเซลล์หนึ่ง คืน {n, s} โดย n เป็น null ถ้าไม่ใช่ตัวเลข */
  function cellValue(row, index) {
    const cell = row.children[index];
    if (!cell) return { n: null, s: '' };

    if (cell.dataset.sort !== undefined) {
      const raw = cell.dataset.sort.trim();
      if (raw === '') return { n: null, s: '' };
      // ตัวเลขล้วนเท่านั้นจึงถือเป็นตัวเลข ("2025-11-20" ต้องเรียงแบบข้อความ
      // ซึ่งรูปแบบ ISO เรียงตามลำดับเวลาได้อยู่แล้ว)
      if (!/[^0-9.+\-eE]/.test(raw)) {
        const n = Number(raw);
        if (Number.isFinite(n)) return { n, s: raw };
      }
      return { n: null, s: raw };
    }

    const text = cell.textContent.trim();
    return { n: parseNumber(text), s: text };
  }

  /* ---------- การเรียง ---------- */

  /** แถวสถานะว่าง (colspan) ต้องไม่ถูกนำไปเรียง */
  function sortableRows(tbody) {
    return [...tbody.rows].filter(r =>
      r.children.length > 1 && ![...r.children].some(c => c.hasAttribute('colspan')));
  }

  function sortRows(rows, index, dir) {
    const decorated = rows.map((r, i) => ({ r, i, v: cellValue(r, index) }));
    const withNumber = decorated.filter(d => d.v.n !== null).length;
    const nonEmpty = decorated.filter(d => d.v.s !== '').length || 1;
    const numeric = withNumber >= nonEmpty * 0.6;

    decorated.sort((a, b) => {
      let cmp;
      if (numeric) {
        // ค่าว่างไปอยู่ท้ายเสมอ ไม่ว่าจะเรียงจากน้อยหรือมาก
        if (a.v.n === null && b.v.n === null) cmp = 0;
        else if (a.v.n === null) return 1;
        else if (b.v.n === null) return -1;
        else cmp = a.v.n - b.v.n;
      } else {
        if (a.v.s === '' && b.v.s !== '') return 1;
        if (b.v.s === '' && a.v.s !== '') return -1;
        cmp = a.v.s.localeCompare(b.v.s, 'th', { numeric: true, sensitivity: 'base' });
      }
      // ลำดับเดิมเป็นตัวตัดสินเมื่อค่าเท่ากัน ทำให้การเรียงเสถียร
      return cmp !== 0 ? dir * cmp : a.i - b.i;
    });

    return decorated.map(d => d.r);
  }

  function apply(tbody, index, dir) {
    const rows = sortableRows(tbody);
    if (rows.length < 2) return;
    const frag = document.createDocumentFragment();
    sortRows(rows, index, dir).forEach(r => frag.appendChild(r));
    tbody.appendChild(frag);
  }

  /* ---------- สถานะที่จำไว้ เก็บบน tbody โดยตรง ---------- */

  function getState(tbody) {
    const index = Number(tbody.dataset.sortIndex);
    if (!tbody.dataset.sortIndex || !Number.isInteger(index)) return null;
    return { index, dir: tbody.dataset.sortDir === 'desc' ? -1 : 1 };
  }

  function setState(tbody, index, dir) {
    tbody.dataset.sortIndex = String(index);
    tbody.dataset.sortDir = dir === 1 ? 'asc' : 'desc';
  }

  /* ---------- ตัวบ่งชี้บนหัวตาราง ---------- */

  function markHeaders(table, index, dir) {
    if (!table?.tHead) return;
    [...table.tHead.rows[0].cells].forEach((th, i) => {
      th.classList.remove('sort-asc', 'sort-desc');
      if (i === index) {
        th.classList.add(dir === 1 ? 'sort-asc' : 'sort-desc');
        th.setAttribute('aria-sort', dir === 1 ? 'ascending' : 'descending');
      } else {
        th.removeAttribute('aria-sort');
      }
    });
  }

  /* ---------- เตรียมหัวตาราง ---------- */

  function prepare(table) {
    if (!table.tHead || table.dataset.sortReady) return;
    table.dataset.sortReady = '1';
    [...table.tHead.rows[0].cells].forEach(th => {
      if (th.hasAttribute('data-nosort')) return;
      th.classList.add('sortable');
      th.tabIndex = 0;
      if (!th.title) th.title = 'คลิกเพื่อเรียงลำดับ (เรียงเฉพาะแถวที่แสดงอยู่)';
    });
  }

  function prepareWithin(root) {
    const scope = root instanceof Element ? root : document;
    if (scope.matches?.(TABLE)) prepare(scope);
    scope.querySelectorAll?.(TABLE).forEach(prepare);
  }

  function toggle(th) {
    const table = th.closest(TABLE);
    const tbody = table?.tBodies[0];
    if (!tbody) return;

    const index = [...th.parentElement.cells].indexOf(th);
    const current = getState(tbody);
    // คลิกซ้ำที่คอลัมน์เดิมคือสลับทิศ คอลัมน์ใหม่เริ่มจากน้อยไปมาก
    const dir = current && current.index === index ? -current.dir : 1;

    setState(tbody, index, dir);
    apply(tbody, index, dir);
    markHeaders(table, index, dir);
  }

  /** เรียกหลังตารางถูกวาดใหม่ เพื่อคงลำดับที่ผู้ใช้เลือกไว้
   *  ผูกกับ U.onRender จึงทำงานทันทีและตามลำดับ ไม่ต้องพึ่ง MutationObserver */
  function reapply(el) {
    prepareWithin(el);
    const bodies = el.tagName === 'TBODY' ? [el] : [...(el.querySelectorAll?.('tbody') || [])];
    for (const tbody of bodies) {
      const st = getState(tbody);
      if (!st) continue;
      apply(tbody, st.index, st.dir);
      markHeaders(tbody.closest('table'), st.index, st.dir);
    }
  }

  function init() {
    prepareWithin(document);
    U.onRender(reapply);

    document.addEventListener('click', e => {
      const th = e.target.closest(`${TABLE} thead th.sortable`);
      if (th) toggle(th);
    });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const th = e.target.closest?.(`${TABLE} thead th.sortable`);
      if (th) { e.preventDefault(); toggle(th); }
    });
  }

  /** ล้างลำดับที่จำไว้ทั้งหมด */
  function reset() {
    document.querySelectorAll('tbody[data-sort-index]').forEach(tb => {
      delete tb.dataset.sortIndex;
      delete tb.dataset.sortDir;
    });
    document.querySelectorAll(`${TABLE} thead th`).forEach(th => {
      th.classList.remove('sort-asc', 'sort-desc');
      th.removeAttribute('aria-sort');
    });
  }

  return { init, reset, reapply, apply, parseNumber };
})();
