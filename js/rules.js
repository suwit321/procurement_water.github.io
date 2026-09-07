/* rules.js — เครื่องมือประเมินความเสี่ยง R1-R17

   เดิม rule ทั้งหมดถูกคำนวณล่วงหน้าใน data.json โดยสคริปต์ที่หายไป ทำให้ปรับเงื่อนไขไม่ได้
   และ 5 rule ไม่เคยทำงานเพราะข้อมูลนำเข้า parse ผิด ตอนนี้ย้ายมาคำนวณในเบราว์เซอร์
   จึงปรับ threshold/น้ำหนักได้สดและเห็นผลทันที

   หลักการสำคัญ: คะแนนจริงกับคะแนนสาธิตแยกกันเด็ดขาด
     risk_score       = เฉพาะ rule ที่ใช้ข้อมูลจริง (ค่าเริ่มต้นที่แสดง)
     risk_score_all   = รวม rule สาธิต (R5/R6) ไว้เปรียบเทียบเท่านั้น
*/
'use strict';

const Rules = (() => {

  const SPECIFIC_METHOD = 'เฉพาะเจาะจง';
  const STORAGE_KEY = 'pa.ruleSettings.v1';

  /* ---------------------------------------------------------------
     นิยาม rule
     - thresholds: ปรับได้จาก UI
     - evaluate(): คืน null ถ้าไม่เข้าเงื่อนไข หรือ {actual} ถ้าเข้า
     --------------------------------------------------------------- */
  const DEFS = [
    {
      id: 'R1', name: 'ส่วนลดเทียบวงเงินโครงการสูงผิดปกติ',
      severity: 'medium', weight: 15, category: 'ราคา', source: 'real',
      desc: 'ส่วนลดจากวงเงินโครงการมากผิดปกติ อาจสะท้อนการตั้งวงเงินสูงเกินจริง หรือการเสนอราคาต่ำเพื่อให้ได้งาน',
      thresholds: { pct: { value: 0.30, min: 0.05, max: 0.90, step: 0.05, label: 'ส่วนลดขั้นต่ำ', format: 'pct' } },
      logic: t => `(project_money - contract_price_agree) / project_money >= ${t.pct}`,
      evaluate(r, ctx, t) {
        if (!r.project_money || r.contract_price_agree === null) return null;
        const d = (r.project_money - r.contract_price_agree) / r.project_money;
        return d >= t.pct ? { actual: U.pct(d) } : null;
      }
    },
    {
      id: 'R2', name: 'ส่วนลดเทียบราคากลางสูงผิดปกติ',
      severity: 'medium', weight: 15, category: 'ราคา', source: 'real',
      desc: 'ราคาสัญญาต่ำกว่าราคากลางมาก อาจบ่งชี้ราคากลางที่ตั้งไว้ไม่สมเหตุสมผล',
      thresholds: { pct: { value: 0.30, min: 0.05, max: 0.90, step: 0.05, label: 'ส่วนลดขั้นต่ำ', format: 'pct' } },
      logic: t => `(price_build - contract_price_agree) / price_build >= ${t.pct}`,
      evaluate(r, ctx, t) {
        if (!r.price_build || r.contract_price_agree === null) return null;
        const d = (r.price_build - r.contract_price_agree) / r.price_build;
        return d >= t.pct ? { actual: U.pct(d) } : null;
      }
    },
    {
      id: 'R3', name: 'โครงการเดียวมีหลายสัญญา',
      severity: 'high', weight: 20, category: 'โครงสร้างสัญญา', source: 'real',
      desc: 'โครงการเดียวถูกแยกทำสัญญาหลายฉบับ ควรตรวจว่ามีเหตุผลรองรับหรือเป็นการเลี่ยงวงเงิน',
      thresholds: { min: { value: 2, min: 2, max: 20, step: 1, label: 'จำนวนสัญญาขั้นต่ำ' } },
      logic: t => `จำนวนสัญญาของ project_id เดียวกัน >= ${t.min}`,
      evaluate(r, ctx, t) {
        const n = ctx.projectContracts.get(r.project_id) || 1;
        return n >= t.min ? { actual: `${n} สัญญา` } : null;
      }
    },
    {
      id: 'R4', name: 'มูลค่าสัญญาเกินวงเงินโครงการ',
      severity: 'critical', weight: 30, category: 'ราคา', source: 'real',
      desc: 'ราคาสัญญาสูงกว่าวงเงินที่ได้รับอนุมัติ เป็นความผิดปกติที่ต้องมีเอกสารอธิบาย',
      thresholds: { ratio: { value: 1.0, min: 1.0, max: 2.0, step: 0.05, label: 'อัตราส่วนขั้นต่ำ' } },
      logic: t => `contract_price_agree / project_money > ${t.ratio}`,
      evaluate(r, ctx, t) {
        if (!r.project_money || r.contract_price_agree === null) return null;
        const ratio = r.contract_price_agree / r.project_money;
        return ratio > t.ratio ? { actual: `${ratio.toFixed(4)} เท่า` } : null;
      }
    },
    {
      id: 'R5', name: 'ผู้เสนอราคารายเดียว',
      severity: 'high', weight: 20, category: 'การแข่งขัน', source: 'synthetic',
      desc: 'ชุดข้อมูลจริงไม่มีจำนวนผู้เสนอราคา ตัวเลขนี้สังเคราะห์ขึ้นเพื่อสาธิตแนวคิดเท่านั้น',
      thresholds: { max: { value: 1, min: 1, max: 5, step: 1, label: 'จำนวนรายสูงสุด' } },
      logic: t => `demo_n_bidders <= ${t.max}   [ข้อมูลสาธิต]`,
      evaluate(r, ctx, t) {
        return r.demo_n_bidders <= t.max ? { actual: `${r.demo_n_bidders} ราย` } : null;
      }
    },
    {
      id: 'R6', name: 'ระยะเวลายื่นข้อเสนอสั้นผิดปกติ (สาธิต)',
      severity: 'medium', weight: 10, category: 'การแข่งขัน', source: 'synthetic',
      desc: 'ตัวเลขสังเคราะห์ ใช้ R16 แทนสำหรับข้อมูลจริงที่มีวันประกาศ',
      thresholds: { days: { value: 7, min: 1, max: 30, step: 1, label: 'จำนวนวันสูงสุด' } },
      logic: t => `demo_submission_days <= ${t.days}   [ข้อมูลสาธิต]`,
      evaluate(r, ctx, t) {
        return r.demo_submission_days <= t.days ? { actual: `${r.demo_submission_days} วัน` } : null;
      }
    },
    {
      id: 'R7', name: 'เลขผู้เสียภาษีกับชื่อผู้รับจ้างไม่สอดคล้อง',
      severity: 'high', weight: 25, category: 'ผู้รับจ้าง', source: 'real',
      desc: 'เลขภาษีเดียวผูกกับหลายชื่อ หรือชื่อเดียวผูกกับหลายเลขภาษี ' +
        'ตรวจหลังทำชื่อให้เป็นมาตรฐานแล้วเพื่อตัด false positive จากรูปแบบการพิมพ์',
      thresholds: { min: { value: 2, min: 2, max: 10, step: 1, label: 'จำนวนคู่ตรงข้ามขั้นต่ำ' } },
      logic: t => `จำนวนชื่อต่อ 1 เลขภาษี >= ${t.min} หรือ จำนวนเลขภาษีต่อ 1 ชื่อ >= ${t.min}`,
      evaluate(r, ctx, t) {
        if (r.tin_is_masked) return null;   // เลขภาษีถูกปิดบัง ใช้ระบุตัวตนไม่ได้
        const names = ctx.tinToNames.get(r.winner_tin);
        const tins = ctx.nameToTins.get(r.winner_key);
        if (names && names.size >= t.min) return { actual: `เลขภาษีนี้ผูกกับ ${names.size} ชื่อ` };
        if (tins && tins.size >= t.min) return { actual: `ชื่อนี้ผูกกับ ${tins.size} เลขภาษี` };
        return null;
      }
    },
    {
      id: 'R8', name: 'หน่วยงานพึ่งพาวิธีเฉพาะเจาะจงสูงผิดปกติ',
      severity: 'medium', weight: 10, category: 'วิธีจัดหา', source: 'real',
      desc: 'หน่วยงานที่ใช้วิธีเฉพาะเจาะจงเกือบทั้งหมด สะท้อนการหลีกเลี่ยงการแข่งขัน',
      thresholds: {
        share: { value: 0.95, min: 0.5, max: 1.0, step: 0.05, label: 'สัดส่วนขั้นต่ำ', format: 'pct' },
        minContracts: { value: 5, min: 1, max: 50, step: 1, label: 'จำนวนสัญญาขั้นต่ำ' }
      },
      logic: t => `สัดส่วนวิธีเฉพาะเจาะจง >= ${t.share} และจำนวนสัญญา >= ${t.minContracts}`,
      evaluate(r, ctx, t) {
        const s = ctx.agencyMethod.get(r.dept_key);
        if (!s || s.total < t.minContracts) return null;
        const share = s.specific / s.total;
        return share >= t.share
          ? { actual: `${U.pct(share)} จาก ${s.total} สัญญา` } : null;
      }
    },
    {
      id: 'R9', name: 'ราคาสัญญาเป็นเลขกลมผิดปกติ',
      severity: 'low', weight: 5, category: 'ราคา', source: 'real',
      desc: 'ราคาลงท้ายด้วยศูนย์หลายตัว เป็นสัญญาณอ่อน พบมากในชุดข้อมูล จึงให้น้ำหนักต่ำ',
      thresholds: {
        zeros: { value: 3, min: 2, max: 6, step: 1, label: 'จำนวนศูนย์ท้าย' },
        minValue: { value: 100000, min: 10000, max: 5000000, step: 10000, label: 'มูลค่าขั้นต่ำ' }
      },
      logic: t => `contract_price_agree >= ${t.minValue} และลงท้ายด้วยศูนย์ ${t.zeros} ตัว`,
      evaluate(r, ctx, t) {
        const v = r.contract_price_agree;
        if (v === null || v < t.minValue) return null;
        const mod = 10 ** t.zeros;
        return v % mod === 0 ? { actual: U.num(v, 0) } : null;
      }
    },
    {
      id: 'R10', name: 'สงสัยการแบ่งซื้อแบ่งจ้าง',
      severity: 'critical', weight: 25, category: 'โครงสร้างสัญญา', source: 'real',
      desc: 'หน่วยงานและผู้รับจ้างคู่เดิมทำสัญญาหลายฉบับในวันเดียวกัน แต่ละฉบับต่ำกว่าเพดาน ' +
        'แต่ยอดรวมสูง เป็นรูปแบบการเลี่ยงวิธีจัดหาที่เข้มงวดกว่า',
      thresholds: {
        maxEach: { value: 500000, min: 100000, max: 5000000, step: 50000, label: 'เพดานต่อสัญญา' },
        minTotal: { value: 400000, min: 100000, max: 10000000, step: 50000, label: 'ยอดรวมขั้นต่ำ' },
        minCount: { value: 2, min: 2, max: 10, step: 1, label: 'จำนวนสัญญาขั้นต่ำ' }
      },
      logic: t => `หน่วยงาน+ผู้รับจ้าง+วันทำสัญญาเดียวกัน >= ${t.minCount} สัญญา, ` +
        `แต่ละฉบับ < ${t.maxEach}, รวม >= ${t.minTotal}`,
      evaluate(r, ctx, t) {
        const g = r._splitGroup;
        if (!g || g.rows.length < t.minCount) return null;
        // ผลของทั้งกลุ่มเหมือนกันทุกสมาชิก จึงตัดสินครั้งเดียวแล้วเก็บไว้
        // ไม่เช่นนั้นกลุ่มขนาด n จะถูกตรวจซ้ำ n รอบ
        const sig = t.maxEach + '|' + t.minTotal + '|' + t.minCount;
        if (g._sig !== sig) {
          g._sig = sig;
          g._verdict = (g.total >= t.minTotal &&
            g.rows.every(x => x.contract_price_agree !== null && x.contract_price_agree < t.maxEach))
            ? { actual: `${g.rows.length} สัญญา รวม ${U.num(g.total, 0)} บาท` }
            : null;
        }
        return g._verdict;
      }
    },
    {
      id: 'R11', name: 'วันสิ้นสุดสัญญาก่อนวันทำสัญญา',
      severity: 'high', weight: 15, category: 'เอกสาร/ข้อมูล', source: 'real',
      desc: 'ความผิดพลาดของข้อมูลวันที่ ควรตรวจสอบเอกสารต้นฉบับ',
      thresholds: { maxDays: { value: 0, min: -30, max: 30, step: 1, label: 'ระยะเวลาต่ำสุด (วัน)' } },
      logic: t => `duration_days < ${t.maxDays}`,
      evaluate(r, ctx, t) {
        if (r.duration_days === null) return null;
        return r.duration_days < t.maxDays ? { actual: `${r.duration_days} วัน` } : null;
      }
    },
    {
      id: 'R12', name: 'ราคาชิดเพดานวิธีเฉพาะเจาะจง',
      severity: 'high', weight: 20, category: 'ราคา', source: 'real',
      desc: 'ราคาสัญญาเกาะอยู่ใต้เพดาน 500,000 บาทของวิธีเฉพาะเจาะจง ' +
        'ชุดข้อมูลนี้มีสัญญาในช่วง 450,000-500,000 มากกว่าช่วงเหนือเพดานหลายเท่า ' +
        'ซึ่งเป็นรูปแบบที่ไม่เกิดขึ้นเองตามธรรมชาติ',
      thresholds: {
        ceiling: { value: 500000, min: 100000, max: 5000000, step: 50000, label: 'เพดาน' },
        bandPct: { value: 0.10, min: 0.01, max: 0.30, step: 0.01, label: 'ความกว้างช่วงใต้เพดาน', format: 'pct' }
      },
      logic: t => `วิธีเฉพาะเจาะจง และ ${t.ceiling} * (1 - ${t.bandPct}) <= ราคา < ${t.ceiling}`,
      evaluate(r, ctx, t) {
        if (r.purchase_method_name !== SPECIFIC_METHOD) return null;
        const v = r.contract_price_agree;
        if (v === null) return null;
        const lo = t.ceiling * (1 - t.bandPct);
        return (v >= lo && v < t.ceiling)
          ? { actual: `${U.num(v, 0)} (${U.pct(v / t.ceiling)} ของเพดาน)` } : null;
      }
    },
    {
      id: 'R13', name: 'ราคาสัญญาเท่ากับราคากลางพอดี',
      severity: 'medium', weight: 15, category: 'การแข่งขัน', source: 'real',
      desc: 'ไม่มีส่วนลดจากราคากลางเลย สะท้อนการไม่มีแรงกดดันด้านการแข่งขัน',
      thresholds: { minRatio: { value: 1.0, min: 0.95, max: 1.0, step: 0.005, label: 'อัตราส่วนขั้นต่ำ' } },
      logic: t => `contract_price_agree / price_build >= ${t.minRatio}`,
      evaluate(r, ctx, t) {
        if (!r.price_build || r.contract_price_agree === null) return null;
        const ratio = r.contract_price_agree / r.price_build;
        return ratio >= t.minRatio ? { actual: `${(ratio * 100).toFixed(2)}% ของราคากลาง` } : null;
      }
    },
    {
      id: 'R14', name: 'ราคากลางเท่ากับวงเงินโครงการ',
      severity: 'medium', weight: 10, category: 'ราคา', source: 'real',
      desc: 'ราคากลางถูกตั้งเท่าวงเงินที่ได้รับ แทนที่จะประมาณราคาอย่างเป็นอิสระ',
      thresholds: { tolerance: { value: 0.001, min: 0, max: 0.05, step: 0.001, label: 'ค่าคลาดเคลื่อนที่ยอมรับ', format: 'pct' } },
      logic: t => `|price_build - project_money| / project_money <= ${t.tolerance}`,
      evaluate(r, ctx, t) {
        if (!r.price_build || !r.project_money) return null;
        const diff = Math.abs(r.price_build - r.project_money) / r.project_money;
        return diff <= t.tolerance ? { actual: `ต่างกัน ${U.pct(diff, 3)}` } : null;
      }
    },
    {
      id: 'R15', name: 'คู่หน่วยงาน-ผู้รับจ้างซ้ำสูง',
      severity: 'medium', weight: 15, category: 'การแข่งขัน', source: 'real',
      desc: 'ผู้รับจ้างรายเดิมได้งานจากหน่วยงานเดิมซ้ำหลายครั้ง ควรตรวจความสม่ำเสมอของการแข่งขัน',
      thresholds: { minPair: { value: 5, min: 2, max: 60, step: 1, label: 'จำนวนสัญญาขั้นต่ำต่อคู่' } },
      logic: t => `จำนวนสัญญาของคู่หน่วยงาน-ผู้รับจ้าง >= ${t.minPair}`,
      evaluate(r, ctx, t) {
        const n = ctx.pairCounts.get(r.dept_key + KEY_SEP + r.winner_key) || 0;
        return n >= t.minPair ? { actual: `${n} สัญญากับหน่วยงานเดียวกัน` } : null;
      }
    },
    {
      id: 'R16', name: 'ช่วงเวลาประกาศถึงทำสัญญาสั้น',
      severity: 'high', weight: 20, category: 'การแข่งขัน', source: 'real',
      desc: 'ใช้วันประกาศจริงจากชุดข้อมูล (มีเฉพาะรายการที่ประกาศเชิญชวน/คัดเลือก) ' +
        'ช่วงเวลาที่สั้นเกินไปจำกัดโอกาสของผู้เสนอราคารายอื่น',
      thresholds: { maxDays: { value: 15, min: 1, max: 90, step: 1, label: 'จำนวนวันสูงสุด' } },
      logic: t => `announce_gap_days <= ${t.maxDays}`,
      evaluate(r, ctx, t) {
        if (r.announce_gap_days === null) return null;
        return r.announce_gap_days <= t.maxDays
          ? { actual: `${r.announce_gap_days} วัน` } : null;
      }
    },
    {
      id: 'R17', name: 'พิกัดโครงการห่างจากพื้นที่ปกติของจังหวัด',
      severity: 'medium', weight: 10, category: 'ภูมิศาสตร์', source: 'real',
      desc: 'พิกัดโครงการอยู่ไกลจากศูนย์กลางพื้นที่ของจังหวัดที่หน่วยงานสังกัด ' +
        'หมายเหตุ: จังหวัดในข้อมูลระบุที่ตั้งหน่วยงาน ไม่ใช่ที่ตั้งโครงการ จึงเป็นสัญญาณให้ตรวจสอบ ไม่ใช่ข้อสรุป',
      thresholds: { maxKm: { value: 200, min: 50, max: 800, step: 25, label: 'ระยะทางสูงสุด (กม.)' } },
      logic: t => `ระยะจากศูนย์กลางจังหวัด > ${t.maxKm} กม.`,
      evaluate(r, ctx, t) {
        if (r.lat === null || r.lon === null) return null;
        const c = ctx.provinceCentroid.get(r.province);
        if (!c) return null;
        const km = U.haversine(r.lat, r.lon, c.lat, c.lon);
        return km > t.maxKm ? { actual: `${km.toFixed(0)} กม. จาก ${r.province}` } : null;
      }
    },
  ];

  const BY_ID = new Map(DEFS.map(d => [d.id, d]));

  /* ---------------------------------------------------------------
     ชั้นเอกสารกำกับกฎ — ใช้สร้างตารางอ้างอิงในแท็บ "กฎและการตั้งค่า"

     fields = คอลัมน์ในชุดข้อมูลต้นทางที่กฎนี้ใช้จริง
     basis  = เหตุผลที่ตั้งกฎ และหลักฐานที่พบในชุดข้อมูลนี้ถ้ามี
              ระบุเฉพาะสิ่งที่ตรวจสอบย้อนกลับได้จากข้อมูล ไม่อ้างอิงเอกสารที่ยืนยันไม่ได้
     --------------------------------------------------------------- */
  const DOCS = {
    R1: {
      fields: ['project_money', 'contract_price_agree'],
      basis: 'ส่วนลดที่มากผิดปกติสะท้อนได้ทั้งการตั้งวงเงินสูงเกินจริงและการเสนอราคาต่ำเพื่อให้ได้งาน ' +
        'ทั้งสองกรณีต้องมีเอกสารอธิบาย พบ 711 สัญญาในชุดข้อมูลนี้',
    },
    R2: {
      fields: ['price_build', 'contract_price_agree'],
      basis: 'ราคากลางคือราคาที่หน่วยงานประเมินว่าสมเหตุสมผล การต่ำกว่ามากจึงชี้ว่าราคากลาง ' +
        'อาจตั้งไว้ไม่เหมาะสม พบ 610 สัญญา',
    },
    R3: {
      fields: ['project_id'],
      basis: 'โครงการเดียวที่แยกทำสัญญาหลายฉบับอาจมีเหตุผลรองรับ แต่ก็เป็นวิธีเลี่ยงวงเงิน ' +
        'ที่ต้องใช้วิธีจัดหาเข้มงวดกว่าได้เช่นกัน พบ 225 สัญญาใน 51 โครงการ',
    },
    R4: {
      fields: ['contract_price_agree', 'project_money'],
      basis: 'ราคาสัญญาไม่ควรเกินวงเงินที่ได้รับอนุมัติ การเกินจึงเป็นความผิดปกติเชิงงบประมาณ ' +
        'ที่ต้องอธิบายได้ พบ 27 สัญญา',
    },
    R5: {
      fields: ['demo_n_bidders (สังเคราะห์)'],
      basis: 'ชุดข้อมูลต้นทางไม่มีจำนวนผู้เสนอราคา ตัวเลขนี้สังเคราะห์ขึ้นเพื่อสาธิตแนวคิดเท่านั้น ' +
        'จึงไม่ถูกนับรวมในคะแนนความเสี่ยงที่แสดง',
    },
    R6: {
      fields: ['demo_submission_days (สังเคราะห์)'],
      basis: 'ชุดข้อมูลต้นทางไม่มีวันปิดรับซอง ใช้ R16 แทนสำหรับรายการที่มีวันประกาศจริง ' +
        'ไม่ถูกนับรวมในคะแนนที่แสดง',
    },
    R7: {
      fields: ['winner_tin', 'winner_name', 'tin_is_masked'],
      basis: 'เลขภาษีกับชื่อควรสอดคล้องกันแบบหนึ่งต่อหนึ่ง ความไม่สอดคล้องอาจชี้ถึงนิติบุคคล ' +
        'ที่ใช้ตัวตนซ้อนกัน ตรวจหลังทำชื่อเป็นมาตรฐานและตัดเลขภาษีที่ถูกปิดบัง 2,205 แถวออกแล้ว ' +
        'จำนวนที่พบจึงลดจาก 460 เหลือ 155 เพราะส่วนต่างเป็นผลจากรูปแบบการพิมพ์ ไม่ใช่ความผิดปกติจริง',
    },
    R8: {
      fields: ['dept_name', 'purchase_method_name'],
      basis: 'หน่วยงานที่ใช้วิธีเฉพาะเจาะจงเกือบทุกสัญญาแสดงถึงการไม่เปิดให้แข่งขันอย่างเป็นระบบ ' +
        'ต้องมีสัญญาอย่างน้อย 5 ฉบับสัดส่วนจึงมีความหมาย',
    },
    R9: {
      fields: ['contract_price_agree'],
      basis: 'ราคาที่ลงท้ายด้วยศูนย์หลายตัวอาจมาจากการกำหนดตัวเลขแทนการคำนวณต้นทุนจริง ' +
        'แต่เป็นสัญญาณอ่อนเพราะพบถึง 5,646 สัญญา จึงตั้งน้ำหนักไว้ต่ำสุดเพียง 5 คะแนน',
    },
    R10: {
      fields: ['dept_name', 'winner_name', 'contract_date', 'contract_price_agree'],
      basis: 'การแตกงานเป็นหลายสัญญาย่อยในวันเดียวกันกับคู่สัญญาเดิม โดยแต่ละฉบับต่ำกว่าเพดาน ' +
        'แต่ยอดรวมสูง เป็นรูปแบบการเลี่ยงวิธีจัดหาที่เข้มงวดกว่า พบ 441 กลุ่ม ครอบคลุม 1,025 สัญญา',
    },
    R11: {
      fields: ['contract_date', 'contract_finish_date'],
      basis: 'วันสิ้นสุดก่อนวันเริ่มเป็นไปไม่ได้ในทางปฏิบัติ จึงเป็นความผิดพลาดของข้อมูล ' +
        'ที่ควรตรวจกับเอกสารต้นฉบับ พบ 10 สัญญา',
    },
    R12: {
      fields: ['purchase_method_name', 'contract_price_agree'],
      basis: 'หลักฐานจากชุดข้อมูลนี้โดยตรง: ช่วงราคา 450,000-500,000 บาท มี 1,789 สัญญา ' +
        'ขณะที่ช่วง 500,000-550,000 มีเพียง 119 สัญญา ต่างกัน 15 เท่า ' +
        'การกระจายราคาตามธรรมชาติไม่ทำให้เกิดหน้าผาแบบนี้ที่เพดานพอดี ' +
        'จึงเป็นสัญญาณเชิงประจักษ์ที่หนักแน่นที่สุดในชุดข้อมูล',
    },
    R13: {
      fields: ['contract_price_agree', 'price_build'],
      basis: 'การไม่มีส่วนลดจากราคากลางเลยแสดงว่าไม่มีแรงกดดันด้านการแข่งขัน ' +
        'พบ 3,264 สัญญาที่ราคาตรงกับราคากลางพอดีทุกบาท คิดเป็น 32.2% ของสัญญาที่มีราคากลาง',
    },
    R14: {
      fields: ['price_build', 'project_money'],
      basis: 'ราคากลางควรมาจากการประมาณต้นทุนอย่างอิสระ การตั้งให้เท่าวงเงินที่ได้รับพอดี ' +
        'สะท้อนว่าไม่ได้ประมาณราคาแยกต่างหาก พบ 4,759 สัญญา คิดเป็น 46.8%',
    },
    R15: {
      fields: ['dept_name', 'winner_name'],
      basis: 'ผู้รับจ้างรายเดิมที่ได้งานจากหน่วยงานเดิมซ้ำหลายครั้งอาจมาจากความเชี่ยวชาญเฉพาะ ' +
        'หรือจากการแข่งขันที่ไม่สม่ำเสมอ ต้องดูประกอบกับวิธีจัดหา พบ 254 คู่ที่มีสัญญาตั้งแต่ 5 ฉบับ สูงสุด 52 ฉบับ',
    },
    R16: {
      fields: ['announce_date', 'contract_date'],
      basis: 'ช่วงเวลาระหว่างประกาศกับทำสัญญาที่สั้นเกินไปจำกัดโอกาสของผู้เสนอราคารายอื่น ' +
        'ใช้วันประกาศจริงจากชุดข้อมูล ซึ่งมีเฉพาะ 1,910 รายการที่ประกาศเชิญชวนหรือคัดเลือก ' +
        'เป็นกฎที่ใช้ข้อมูลจริงมาแทน R6 ที่เป็นข้อมูลสาธิต',
    },
    R17: {
      fields: ['project_location', 'province'],
      basis: 'คอลัมน์จังหวัดระบุที่ตั้งหน่วยงาน ส่วนพิกัดระบุที่ตั้งโครงการ ระยะห่างมากจึงหมายถึง ' +
        'หน่วยงานจัดหาไกลจากพื้นที่ตนเอง ซึ่งอาจมีเหตุผลรองรับ เป็นสัญญาณให้ตรวจสอบ ไม่ใช่ข้อสรุป ' +
        'ศูนย์กลางจังหวัดคำนวณจากมัธยฐานพิกัดของสัญญาในจังหวัดนั้น',
    },
  };

  /* ตัวคั่นคีย์ ต้องเป็นอักขระที่ไม่ปรากฏในชื่อจริง
     ชื่อหน่วยงานและผู้รับจ้างมีช่องว่างอยู่ในตัวเอง (9,313 จาก 10,174 ระเบียน)
     การใช้ช่องว่างเป็นตัวคั่นจะทำให้คนละคู่ได้คีย์ชนกันได้
     เขียนเป็น escape เพื่อให้เห็นชัดและกันเครื่องมืออื่นตัดอักขระควบคุมทิ้ง */
  const KEY_SEP = '\u0000';

  function splitKey(r) {
    return r.dept_key + KEY_SEP + r.winner_key + KEY_SEP + (r.contract_date || '');
  }

  /* ---------------------------------------------------------------
     ระดับความเสี่ยง — นิยามเดียวใช้ทั้งแอป
     เดิมมีนิยามระดับกระจัดกระจาย 11 ชุดที่ไม่ตรงกัน
     --------------------------------------------------------------- */
  const BANDS = [
    { key: 'critical', label: 'วิกฤต', min: 60, cls: 'badge-critical', color: '#b91c1c' },
    { key: 'high', label: 'สูง', min: 40, cls: 'badge-high', color: '#ea580c' },
    { key: 'medium', label: 'ปานกลาง', min: 20, cls: 'badge-medium', color: '#ca8a04' },
    { key: 'low', label: 'ต่ำ', min: 0.0001, cls: 'badge-low', color: '#0f766e' },
    { key: 'none', label: 'ไม่พบสัญญาณ', min: -1, cls: 'badge-none', color: '#94a3b8' },
  ];

  function band(score) {
    return BANDS.find(b => score >= b.min) || BANDS[BANDS.length - 1];
  }

  const SEVERITY_ORDER = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };

  /* ---------------------------------------------------------------
     การตั้งค่า threshold (ปรับได้จาก UI, จำไว้ใน localStorage)
     --------------------------------------------------------------- */

  function defaultSettings() {
    const s = {};
    for (const d of DEFS) {
      s[d.id] = { enabled: true, weight: d.weight, thresholds: {} };
      for (const [k, spec] of Object.entries(d.thresholds || {})) {
        s[d.id].thresholds[k] = spec.value;
      }
    }
    return s;
  }

  function loadSettings() {
    const base = defaultSettings();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return base;
      const saved = JSON.parse(raw);
      for (const [id, cfg] of Object.entries(saved)) {
        if (!base[id]) continue;
        if (typeof cfg.enabled === 'boolean') base[id].enabled = cfg.enabled;
        if (Number.isFinite(cfg.weight)) base[id].weight = cfg.weight;
        for (const [k, v] of Object.entries(cfg.thresholds || {})) {
          if (k in base[id].thresholds && Number.isFinite(v)) base[id].thresholds[k] = v;
        }
      }
    } catch (e) {
      console.warn('อ่านการตั้งค่า rule ไม่สำเร็จ ใช้ค่าเริ่มต้นแทน', e);
    }
    return base;
  }

  function saveSettings(settings) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); }
    catch (e) { /* โหมดส่วนตัวหรือพื้นที่เต็ม — ไม่กระทบการทำงาน */ }
  }

  function resetSettings() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ไม่สำคัญ */ }
    return defaultSettings();
  }

  /* ---------------------------------------------------------------
     บริบท — สร้างดัชนีครั้งเดียว ใช้ซ้ำทุกครั้งที่ประเมิน
     --------------------------------------------------------------- */

  function buildContext(records) {
    const projectContracts = new Map();
    const tinToNames = new Map();
    const nameToTins = new Map();
    const agencyMethod = new Map();
    const splitGroups = new Map();
    const pairCounts = new Map();
    const provincePoints = new Map();

    for (const r of records) {
      projectContracts.set(r.project_id, (projectContracts.get(r.project_id) || 0) + 1);

      if (!r.tin_is_masked && r.winner_tin && r.winner_key) {
        let names = tinToNames.get(r.winner_tin);
        if (!names) { names = new Set(); tinToNames.set(r.winner_tin, names); }
        names.add(r.winner_key);

        let tins = nameToTins.get(r.winner_key);
        if (!tins) { tins = new Set(); nameToTins.set(r.winner_key, tins); }
        tins.add(r.winner_tin);
      }

      let am = agencyMethod.get(r.dept_key);
      if (!am) { am = { total: 0, specific: 0 }; agencyMethod.set(r.dept_key, am); }
      am.total++;
      if (r.purchase_method_name === SPECIFIC_METHOD) am.specific++;

      // เก็บกลุ่มไว้กับตัวระเบียนเลย จะได้ไม่ต้องประกอบคีย์ใหม่ทุกครั้งที่ประเมิน
      if (r.contract_date) {
        const k = splitKey(r);
        let g = splitGroups.get(k);
        if (!g) { g = { rows: [], total: 0 }; splitGroups.set(k, g); }
        g.rows.push(r);
        g.total += r.contract_price_agree || 0;
        r._splitGroup = g;
      } else {
        r._splitGroup = null;
      }

      const pk = r.dept_key + KEY_SEP + r.winner_key;
      pairCounts.set(pk, (pairCounts.get(pk) || 0) + 1);

      if (r.lat !== null && r.lon !== null && r.province) {
        let pts = provincePoints.get(r.province);
        if (!pts) { pts = { lats: [], lons: [] }; provincePoints.set(r.province, pts); }
        pts.lats.push(r.lat);
        pts.lons.push(r.lon);
      }
    }

    // ใช้มัธยฐานแทนค่าเฉลี่ย เพื่อไม่ให้พิกัดผิดปกติดึงศูนย์กลางเพี้ยน
    const provinceCentroid = new Map();
    for (const [prov, pts] of provincePoints) {
      if (pts.lats.length < 3) continue;   // จุดน้อยเกินไป ศูนย์กลางไม่น่าเชื่อถือ
      provinceCentroid.set(prov, { lat: U.median(pts.lats), lon: U.median(pts.lons) });
    }

    return { projectContracts, tinToNames, nameToTins, agencyMethod, splitGroups, pairCounts, provinceCentroid };
  }

  /* ---------------------------------------------------------------
     ประเมินผล
     --------------------------------------------------------------- */

  /** เขียนผลลงในตัว record โดยตรง เพื่อไม่ต้องคัดลอกอาเรย์ 10,174 รายการทุกครั้งที่ปรับ threshold */
  function evaluate(records, ctx, settings) {
    const active = DEFS.filter(d => settings[d.id]?.enabled !== false);

    for (const r of records) {
      const hits = [];
      let scoreReal = 0, scoreAll = 0;
      let sevReal = 'none', sevAll = 'none';

      for (const def of active) {
        const cfg = settings[def.id];
        const t = cfg.thresholds;
        let res;
        try {
          res = def.evaluate(r, ctx, t);
        } catch (e) {
          res = null;   // rule เดียวพังต้องไม่ทำให้ทั้งหน้าพัง
        }
        if (!res) continue;

        const weight = Number.isFinite(cfg.weight) ? cfg.weight : def.weight;
        hits.push({
          rule_id: def.id, rule_name: def.name, severity: def.severity,
          source: def.source, category: def.category, weight,
          actual: res.actual, logic: def.logic(t),
        });

        scoreAll += weight;
        if (SEVERITY_ORDER[def.severity] > SEVERITY_ORDER[sevAll]) sevAll = def.severity;
        if (def.source === 'real') {
          scoreReal += weight;
          if (SEVERITY_ORDER[def.severity] > SEVERITY_ORDER[sevReal]) sevReal = def.severity;
        }
      }

      r.rule_hits = hits;
      r.risk_score = Math.min(100, scoreReal);
      r.risk_score_all = Math.min(100, scoreAll);
      r.max_severity = sevReal;
      r.max_severity_all = sevAll;
      r.risk_band = band(r.risk_score).key;
    }

    return records;
  }

  /** สรุปจำนวน hit ต่อ rule — ใช้ในแผงตั้งค่าและ KPI */
  function summarize(records) {
    const counts = new Map(DEFS.map(d => [d.id, { n: 0, value: 0 }]));
    let flagged = 0, flaggedValue = 0;
    const bandCounts = Object.fromEntries(BANDS.map(b => [b.key, 0]));

    for (const r of records) {
      const hits = r.rule_hits || [];
      if (hits.length) { flagged++; flaggedValue += r.contract_price_agree || 0; }
      bandCounts[r.risk_band] = (bandCounts[r.risk_band] || 0) + 1;
      for (const h of hits) {
        const c = counts.get(h.rule_id);
        if (c) { c.n++; c.value += r.contract_price_agree || 0; }
      }
    }
    return { counts, flagged, flaggedValue, bandCounts, total: records.length };
  }

  return {
    DEFS, BY_ID, DOCS, BANDS, SEVERITY_ORDER,
    band, buildContext, evaluate, summarize,
    defaultSettings, loadSettings, saveSettings, resetSettings,
    SPECIFIC_METHOD,
  };
})();
