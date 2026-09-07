/* analytics.js — การคำนวณเชิงสถิติและการรวมกลุ่ม

   ทุกฟังก์ชันรับ "ชุดระเบียนที่กรองแล้ว" เข้ามา ไม่ได้อ่านจากค่าที่คำนวณล่วงหน้า
   จึงทำให้ตัวกรองส่วนกลางมีผลกับทุกตารางและทุกกราฟพร้อมกัน
   (ของเดิมอ่านจากอาเรย์สำเร็จรูปใน data.json ตัวกรองจึงไม่มีผลข้ามแท็บ)
*/
'use strict';

const Analytics = (() => {

  const SPECIFIC = 'เฉพาะเจาะจง';

  /* ---------------------------------------------------------------
     การกระจุกตัวของตลาด
     --------------------------------------------------------------- */

  /** HHI ต่อหน่วยงาน = ผลรวมของ (ส่วนแบ่งมูลค่า x 100) ยกกำลังสอง
   *  minContracts สำคัญมาก: หน่วยงานที่มีสัญญาเดียวจะได้ 10,000 เสมอ
   *  ของเดิมไม่มีเกณฑ์นี้ ตาราง "กระจุกตัวสูง" จึงเต็มไปด้วยหน่วยงานสัญญาเดียว
   */
  function hhi(records, { minContracts = 5 } = {}) {
    const out = [];
    for (const [dept, rows] of U.groupBy(records, r => r.dept_key)) {
      if (rows.length < minContracts) continue;
      const total = U.sum(rows.map(r => r.contract_price_agree));
      if (total <= 0) continue;
      const byContractor = U.groupBy(rows, r => r.winner_key);
      let index = 0;
      for (const [, crows] of byContractor) {
        const share = U.sum(crows.map(r => r.contract_price_agree)) / total;
        index += (share * 100) ** 2;
      }
      out.push({
        dept_name: dept, hhi: Math.round(index * 100) / 100,
        n_contracts: rows.length, n_contractors: byContractor.size, total_value: total,
      });
    }
    return out.sort((a, b) => b.hhi - a.hhi);
  }

  /** ตัวชี้วัดคัดกรองต่อหน่วยงาน: การกระจายราคา + ส่วนแบ่งของผู้ชนะรายใหญ่สุด */
  function screening(records, { minContracts = 5 } = {}) {
    const out = [];
    for (const [dept, rows] of U.groupBy(records, r => r.dept_key)) {
      if (rows.length < minContracts) continue;
      const prices = rows.map(r => r.contract_price_agree).filter(v => v !== null);
      const total = U.sum(prices);
      const byContractor = U.groupBy(rows, r => r.winner_key);
      let topShare = 0, topName = '';
      for (const [name, crows] of byContractor) {
        const share = total > 0 ? U.sum(crows.map(r => r.contract_price_agree)) / total : 0;
        if (share > topShare) { topShare = share; topName = name; }
      }
      out.push({
        dept_name: dept, n_contracts: rows.length,
        cv_price: prices.length > 1 ? U.cv(prices) : null,
        top_winner: topName, top_winner_share: topShare,
        specific_share: rows.filter(r => r.purchase_method_name === SPECIFIC).length / rows.length,
        total_value: total,
      });
    }
    return out.sort((a, b) => b.top_winner_share - a.top_winner_share);
  }

  /** หน่วยงานที่พึ่งพาวิธีเฉพาะเจาะจงสูง */
  function noncompete(records, { minContracts = 5 } = {}) {
    const out = [];
    for (const [dept, rows] of U.groupBy(records, r => r.dept_key)) {
      if (rows.length < minContracts) continue;
      const spec = rows.filter(r => r.purchase_method_name === SPECIFIC);
      out.push({
        dept_name: dept, n_contracts: rows.length,
        pct_specific: spec.length / rows.length,
        value_specific: U.sum(spec.map(r => r.contract_price_agree)),
        total_value: U.sum(rows.map(r => r.contract_price_agree)),
      });
    }
    return out.sort((a, b) => b.pct_specific - a.pct_specific || b.n_contracts - a.n_contracts);
  }

  /* ---------------------------------------------------------------
     การตรวจจับความผิดปกติ
     --------------------------------------------------------------- */

  const BENFORD_EXPECTED = Array.from({ length: 9 },
    (_, i) => Math.log10(1 + 1 / (i + 1)));

  /** การกระจายเลขหลักแรกเทียบกฎเบนฟอร์ด
   *  ค่าวิกฤต chi-square ที่ df=8, p=0.05 คือ 15.51
   */
  function benford(values) {
    const digits = new Array(9).fill(0);
    let n = 0;
    for (const v of values) {
      if (v === null || v === undefined) continue;
      const abs = Math.abs(Number(v));
      if (!Number.isFinite(abs) || abs < 1) continue;
      const first = Number(String(Math.trunc(abs))[0]);
      if (first >= 1 && first <= 9) { digits[first - 1]++; n++; }
    }
    if (!n) return { n: 0, observed: digits, observedPct: digits, expectedPct: BENFORD_EXPECTED, chi2: 0, deviates: false };

    const observedPct = digits.map(d => d / n);
    let chi2 = 0;
    for (let i = 0; i < 9; i++) {
      const expected = BENFORD_EXPECTED[i] * n;
      chi2 += (digits[i] - expected) ** 2 / expected;
    }
    return {
      n, observed: digits, observedPct, expectedPct: BENFORD_EXPECTED,
      chi2: Math.round(chi2 * 100) / 100, deviates: chi2 > 15.51,
    };
  }

  /** เบนฟอร์ดรายหน่วยงาน — ชี้เป้าหน่วยงานที่การกระจายเลขหลักแรกเบี่ยงเบนมาก */
  function benfordByAgency(records, { minContracts = 30 } = {}) {
    const out = [];
    for (const [dept, rows] of U.groupBy(records, r => r.dept_key)) {
      if (rows.length < minContracts) continue;
      const b = benford(rows.map(r => r.contract_price_agree));
      if (b.n < minContracts) continue;
      out.push({ dept_name: dept, n: b.n, chi2: b.chi2, deviates: b.deviates, total_value: U.sum(rows.map(r => r.contract_price_agree)) });
    }
    return out.sort((a, b) => b.chi2 - a.chi2);
  }

  /** หน้าผาที่เพดานราคา — นับสัญญาต่อช่วงราคา เพื่อให้เห็นการกองตัวใต้เพดาน
   *  สัญญาณเด่นของชุดข้อมูลนี้: ช่วงใต้เพดาน 500,000 หนาแน่นกว่าช่วงเหนือเพดานหลายเท่า
   */
  function thresholdCliff(records, { ceiling = 500000, binWidth = 50000, span = 5 } = {}) {
    const bins = [];
    for (let i = -span; i < span; i++) {
      const lo = ceiling + i * binWidth;
      bins.push({ lo, hi: lo + binWidth, n: 0, value: 0 });
    }
    for (const r of records) {
      const v = r.contract_price_agree;
      if (v === null) continue;
      for (const b of bins) {
        if (v >= b.lo && v < b.hi) { b.n++; b.value += v; break; }
      }
    }
    const below = bins.find(b => b.hi === ceiling);
    const above = bins.find(b => b.lo === ceiling);
    const ratio = below && above && above.n > 0 ? below.n / above.n : null;
    return { bins, ceiling, belowCount: below?.n ?? 0, aboveCount: above?.n ?? 0, ratio };
  }

  /** ฮิสโทแกรมอัตราส่วนราคาสัญญาต่อราคากลาง — แท่งพุ่งที่ 1.00 คือสัญญาณไร้การแข่งขัน */
  function priceRatioHistogram(records, { bins = 24, lo = 0.4, hi = 1.15 } = {}) {
    const width = (hi - lo) / bins;
    const buckets = Array.from({ length: bins }, (_, i) => ({
      lo: lo + i * width, hi: lo + (i + 1) * width, n: 0,
    }));
    let exact = 0, counted = 0;
    for (const r of records) {
      if (!r.price_build || r.contract_price_agree === null) continue;
      const ratio = r.contract_price_agree / r.price_build;
      counted++;
      if (Math.abs(ratio - 1) < 1e-9) exact++;
      const idx = Math.floor((ratio - lo) / width);
      if (idx >= 0 && idx < bins) buckets[idx].n++;
    }
    return { buckets, exact, counted };
  }

  /** ราคาผิดปกติเทียบกลุ่มเปรียบเทียบ (ประเภทโครงการ x วิธีจัดหา)
   *  ใช้ IQR แทน z-score เพราะการกระจายราคาเบ้มากและมีหางยาว
   */
  function priceOutliers(records, { minGroup = 30, k = 3.0, limit = 100 } = {}) {
    const out = [];
    const groups = U.groupBy(records,
      r => r.project_type_name + ' | ' + r.purchase_method_name);
    for (const [key, rows] of groups) {
      const prices = rows.map(r => r.contract_price_agree).filter(v => v !== null && v > 0);
      if (prices.length < minGroup) continue;
      const { upper, q1, q3 } = U.iqrBounds(prices, k);
      const med = U.median(prices);
      for (const r of rows) {
        const v = r.contract_price_agree;
        if (v === null || v <= upper) continue;
        out.push({
          record: r, peer_group: key, peer_median: med, peer_q1: q1, peer_q3: q3,
          upper_bound: upper, value: v, times_median: med > 0 ? v / med : null,
        });
      }
    }
    return out.sort((a, b) => (b.times_median || 0) - (a.times_median || 0)).slice(0, limit);
  }

  /** ระยะเวลาสัญญาผิดปกติ (สั้นติดลบ หรือยาวเกินกลุ่ม) */
  function durationOutliers(records, { limit = 50 } = {}) {
    const withDur = records.filter(r => r.duration_days !== null);
    if (!withDur.length) return { negative: [], long: [], median: 0 };
    const days = withDur.map(r => r.duration_days);
    const { upper } = U.iqrBounds(days, 3.0);
    return {
      median: U.median(days),
      negative: withDur.filter(r => r.duration_days < 0)
        .sort((a, b) => a.duration_days - b.duration_days).slice(0, limit),
      long: withDur.filter(r => r.duration_days > upper)
        .sort((a, b) => b.duration_days - a.duration_days).slice(0, limit),
      upper,
    };
  }

  /* ---------------------------------------------------------------
     รูปแบบการทุจริต
     --------------------------------------------------------------- */

  /** กลุ่มสัญญาที่เข้าข่ายแบ่งซื้อแบ่งจ้าง — รวมเป็นคลัสเตอร์ ไม่ใช่รายสัญญา */
  function splitClusters(records, { maxEach = 500000, minTotal = 400000, minCount = 2 } = {}) {
    const out = [];
    const groups = U.groupBy(records.filter(r => r.contract_date),
      r => r.dept_key + ' ' + r.winner_key + ' ' + r.contract_date);
    for (const [, rows] of groups) {
      if (rows.length < minCount) continue;
      if (!rows.every(r => r.contract_price_agree !== null && r.contract_price_agree < maxEach)) continue;
      const total = U.sum(rows.map(r => r.contract_price_agree));
      if (total < minTotal) continue;
      out.push({
        dept_name: rows[0].dept_key, winner_name: rows[0].winner_key,
        contract_date: rows[0].contract_date, n: rows.length, total, rows,
      });
    }
    return out.sort((a, b) => b.total - a.total);
  }

  /** เลขภาษีผูกกับหลายชื่อ (และทิศกลับ) — ตรวจหลังทำชื่อเป็นมาตรฐานแล้ว */
  function tinMismatch(records) {
    const byTin = new Map(), byName = new Map();
    for (const r of records) {
      if (r.tin_is_masked || !r.winner_tin || !r.winner_key) continue;
      let t = byTin.get(r.winner_tin);
      if (!t) { t = { names: new Set(), rows: [] }; byTin.set(r.winner_tin, t); }
      t.names.add(r.winner_key); t.rows.push(r);

      let n = byName.get(r.winner_key);
      if (!n) { n = { tins: new Set(), rows: [] }; byName.set(r.winner_key, n); }
      n.tins.add(r.winner_tin); n.rows.push(r);
    }

    const oneTinManyNames = [];
    for (const [tin, t] of byTin) {
      if (t.names.size < 2) continue;
      oneTinManyNames.push({
        kind: 'tin', key: tin, names: [...t.names], n_contracts: t.rows.length,
        total_value: U.sum(t.rows.map(r => r.contract_price_agree)),
      });
    }
    const oneNameManyTins = [];
    for (const [name, n] of byName) {
      if (n.tins.size < 2) continue;
      oneNameManyTins.push({
        kind: 'name', key: name, names: [...n.tins], n_contracts: n.rows.length,
        total_value: U.sum(n.rows.map(r => r.contract_price_agree)),
      });
    }
    return [...oneTinManyNames, ...oneNameManyTins]
      .sort((a, b) => b.total_value - a.total_value);
  }

  /** การผลัดกันชนะระหว่างผู้รับจ้างสองรายในหน่วยงานเดียว
   *  ชื่อถูกทำเป็นมาตรฐานตั้งแต่ ETL แล้ว จึงไม่เกิดกรณี "บริษัทสลับกับตัวเอง"
   *  ที่เคยเกิดจากชื่อต่างกันแค่เว้นวรรคซ้อน
   */
  function bidRotation(records, { minContracts = 6, minRatio = 0.6 } = {}) {
    const out = [];
    for (const [dept, rows] of U.groupBy(records, r => r.dept_key)) {
      if (rows.length < minContracts) continue;
      const counts = [...U.countBy(rows, r => r.winner_key)]
        .sort((a, b) => b[1] - a[1]);
      if (counts.length < 2) continue;
      const [a, b] = counts;
      const ratio = (a[1] + b[1]) / rows.length;
      if (ratio < minRatio) continue;
      // ต้องผลัดกันจริง ไม่ใช่รายเดียวกินขาด
      const balance = Math.min(a[1], b[1]) / Math.max(a[1], b[1]);
      if (balance < 0.4) continue;
      out.push({
        dept_name: dept, top_winners: [a[0], b[0]], counts: [a[1], b[1]],
        n_total_contracts: rows.length, alternation_ratio: ratio, balance,
        total_value: U.sum(rows.map(r => r.contract_price_agree)),
      });
    }
    return out.sort((a, b) => b.alternation_ratio - a.alternation_ratio || b.total_value - a.total_value);
  }

  /* ---------------------------------------------------------------
     การรวมกลุ่มพื้นฐาน
     --------------------------------------------------------------- */

  function totalsBy(records, keyFn, keyName) {
    const out = [];
    for (const [key, rows] of U.groupBy(records, keyFn)) {
      out.push({
        [keyName]: key,
        n_contracts: rows.length,
        total_value: U.sum(rows.map(r => r.contract_price_agree)),
        avg_risk: U.mean(rows.map(r => r.risk_score || 0)),
        max_risk: Math.max(...rows.map(r => r.risk_score || 0)),
        n_flagged: rows.filter(r => (r.rule_hits || []).length).length,
      });
    }
    return out.sort((a, b) => b.total_value - a.total_value);
  }

  const agencyTotals = r => totalsBy(r, x => x.dept_key, 'dept_name');
  const contractorTotals = r => totalsBy(r, x => x.winner_key, 'winner_name');

  /** ผู้รับจ้างที่ชนะงานจากหลายหน่วยงาน */
  function repeatWinners(records, { minAgencies = 3 } = {}) {
    const out = [];
    for (const [name, rows] of U.groupBy(records, r => r.winner_key)) {
      const agencies = new Set(rows.map(r => r.dept_key));
      if (agencies.size < minAgencies) continue;
      out.push({
        winner_name: name, n_agencies: agencies.size, n_contracts: rows.length,
        total_value: U.sum(rows.map(r => r.contract_price_agree)),
        agencies: [...agencies],
      });
    }
    return out.sort((a, b) => b.n_agencies - a.n_agencies || b.total_value - a.total_value);
  }

  /* ตัวคั่นคีย์ของเส้นเชื่อม ต้องเป็นอักขระที่ไม่มีทางปรากฏในชื่อจริง
     เพราะทั้งชื่อหน่วยงานและชื่อผู้รับจ้างมีช่องว่างอยู่ในตัวเองอยู่แล้ว
     (9,313 จาก 10,174 ระเบียน) ถ้าใช้ช่องว่างเป็นตัวคั่น ชื่อจะถูกตัดขาดตอนแยกกลับ
     เขียนเป็น escape เพื่อให้เห็นชัดในซอร์ส และกันเครื่องมืออื่นตัดอักขระควบคุมทิ้ง */
  const EDGE_SEP = '\u0000';

  /** เส้นเชื่อมหน่วยงาน-ผู้รับจ้าง คำนวณจากระเบียนที่กรองแล้ว (ไม่ใช่ค่าคงที่จาก ETL)
   *  แต่ละเส้นพกข้อมูลพอให้แท็บเครือข่ายกรองต่อได้ โดยไม่ต้องวนระเบียนซ้ำ
   */
  function networkEdges(records) {
    const out = [];
    for (const [key, rows] of U.groupBy(records, r => r.dept_key + EDGE_SEP + r.winner_key)) {
      const [source, target] = key.split(EDGE_SEP);
      if (!source || !target) continue;

      const rules = new Set();
      let flagged = 0;
      for (const r of rows) {
        const hits = r.rule_hits || [];
        if (hits.length) flagged++;
        for (const h of hits) rules.add(h.rule_id);
      }

      out.push({
        source, target, n: rows.length,
        value: U.sum(rows.map(r => r.contract_price_agree)),
        max_risk: Math.max(...rows.map(r => r.risk_score || 0)),
        avg_risk: U.mean(rows.map(r => r.risk_score || 0)),
        rules,
        flagged,
        // เลขภาษีถูกปิดบังทั้งคู่ ใช้ยืนยันตัวตนผู้รับจ้างไม่ได้
        masked: rows.every(r => r.tin_is_masked),
        rows,
      });
    }
    return out.sort((a, b) => b.value - a.value);
  }

  /** อนุกรมเวลารายเดือน แยกตามมิติที่เลือก */
  function timeseries(records, dimension = 'purchase_method_name') {
    const months = new Set();
    const series = new Map();
    for (const r of records) {
      const m = U.monthKey(r.contract_date);
      if (!m) continue;
      months.add(m);
      const dim = r[dimension] || 'ไม่ระบุ';
      let s = series.get(dim);
      if (!s) { s = new Map(); series.set(dim, s); }
      const cur = s.get(m) || { n: 0, value: 0 };
      cur.n++; cur.value += r.contract_price_agree || 0;
      s.set(m, cur);
    }
    const sortedMonths = [...months].sort();
    return {
      months: sortedMonths,
      series: [...series.entries()]
        .map(([name, byMonth]) => ({
          name,
          counts: sortedMonths.map(m => byMonth.get(m)?.n || 0),
          values: sortedMonths.map(m => byMonth.get(m)?.value || 0),
          total: U.sum(sortedMonths.map(m => byMonth.get(m)?.n || 0)),
        }))
        .sort((a, b) => b.total - a.total),
    };
  }

  /** โปรไฟล์ผู้รับจ้างพร้อมมิติความเสี่ยง 5 ด้าน
   *  network มาจากดัชนี percentile ที่ ETL คำนวณไว้ (สเกล 0-100 เท่ากันทุกมิติ)
   *  ของเดิม network อยู่สเกล 0-22 ทำให้น้ำหนัก 30% ที่โฆษณาไว้ไม่เป็นจริง
   */
  const RISK_WEIGHTS = { network: 0.30, price: 0.20, competition: 0.20, contract: 0.20, concentration: 0.10 };

  function contractorProfiles(records, nodeIndex, { minContracts = 1 } = {}) {
    const edges = networkEdges(records);
    const byContractor = new Map();
    for (const e of edges) {
      let list = byContractor.get(e.target);
      if (!list) { list = []; byContractor.set(e.target, list); }
      list.push(e);
    }

    const profiles = [];
    for (const [name, rows] of U.groupBy(records, r => r.winner_key)) {
      if (rows.length < minContracts) continue;
      const pairs = (byContractor.get(name) || []).sort((a, b) => b.value - a.value);
      const totalValue = U.sum(rows.map(r => r.contract_price_agree));
      const node = nodeIndex.get('C::' + name);

      // มิติที่ 1 — ตำแหน่งในเครือข่าย (percentile จาก ETL)
      const network = node ? node.composite_risk_norm : 0;

      // มิติที่ 2 — ราคา: สัดส่วนสัญญาที่ราคาชิดราคากลาง
      const withCeiling = rows.filter(r => r.price_build && r.contract_price_agree !== null);
      const tight = withCeiling.filter(r => r.contract_price_agree / r.price_build >= 0.99).length;
      const price = withCeiling.length ? tight / withCeiling.length * 100 : 0;

      // มิติที่ 3 — การแข่งขัน: สัดส่วนงานที่ได้มาด้วยวิธีเฉพาะเจาะจง
      const competition = rows.filter(r => r.purchase_method_name === SPECIFIC).length / rows.length * 100;

      // มิติที่ 4 — สัญญา: คะแนนความเสี่ยงสูงสุดจาก rule engine
      const contract = Math.max(...rows.map(r => r.risk_score || 0));

      // มิติที่ 5 — การกระจุกตัว: พึ่งพาหน่วยงานเดียวมากแค่ไหน
      const topPair = pairs.length ? pairs[0].value : 0;
      const concentration = totalValue > 0 ? topPair / totalValue * 100 : 0;

      const final =
        RISK_WEIGHTS.network * network + RISK_WEIGHTS.price * price +
        RISK_WEIGHTS.competition * competition + RISK_WEIGHTS.contract * contract +
        RISK_WEIGHTS.concentration * concentration;

      profiles.push({
        winner_name: name,
        winner_tin: rows[0].winner_tin,
        tin_is_masked: rows[0].tin_is_masked,
        n_contracts: rows.length,
        n_agencies: new Set(rows.map(r => r.dept_key)).size,
        total_value: totalValue,
        max_risk: contract,
        avg_risk: U.mean(rows.map(r => r.risk_score || 0)),
        n_flagged: rows.filter(r => (r.rule_hits || []).length).length,
        risk: {
          network: Math.round(network * 10) / 10,
          price: Math.round(price * 10) / 10,
          competition: Math.round(competition * 10) / 10,
          contract: Math.round(contract * 10) / 10,
          concentration: Math.round(concentration * 10) / 10,
          final: Math.round(final * 10) / 10,
        },
        pairs, rows,
        node,
      });
    }
    return profiles.sort((a, b) => b.risk.final - a.risk.final);
  }

  return {
    hhi, screening, noncompete,
    benford, benfordByAgency, thresholdCliff, priceRatioHistogram,
    priceOutliers, durationOutliers,
    splitClusters, tinMismatch, bidRotation,
    agencyTotals, contractorTotals, repeatWinners, networkEdges, timeseries,
    contractorProfiles, RISK_WEIGHTS,
  };
})();
