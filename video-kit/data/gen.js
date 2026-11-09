// Synthetic demo data for the CBE mockup (no real report content)
const fs = require('fs');
const s = fs.readFileSync('/home/claude/neerablejompon-gif/cbe/src/Seed.gs', 'utf8');
const SEED = eval(s.match(/var SEED_ENABLERS = (\[[\s\S]*?\]);/)[1]);
let r = 12345; const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
const pick = a => a[Math.floor(rnd() * a.length)];
const verbs = ['ทบทวนและปรับปรุงกระบวนการ', 'จัดทำแผนและแนวทางดำเนินงาน', 'ติดตามและประเมินผลการดำเนินงาน', 'สื่อสารและถ่ายทอดสู่ผู้ปฏิบัติ', 'วิเคราะห์ข้อมูลและจัดทำรายงาน'];
const units = ['ครั้ง', 'ฉบับ', 'ร้อยละ', 'กิจกรรม'];
const evid = ['รายงานการประชุมคณะทำงาน', 'แผนปฏิบัติการประจำปี', 'รายงานผลการติดตามรายไตรมาส', 'บันทึกการอนุมัติจากผู้บริหาร', 'สรุปผลการสื่อสารภายในองค์กร', 'คู่มือแนวทางปฏิบัติ'];
const CM = [['1', 'การรับฟังเสียงของลูกค้า', 40, [['1.1', 'ช่องทางการรับฟังเสียงลูกค้า', 20], ['1.2', 'การวิเคราะห์ความต้องการลูกค้า', 20]]],
            ['2', 'การสร้างความสัมพันธ์และความผูกพันกับลูกค้า', 60, [['2.1', 'การจัดการข้อร้องเรียน', 30], ['2.2', 'การวัดความพึงพอใจและความผูกพัน', 30]]]];
function form(code, topics, fy, itg) {
  const cur = fy === 2570;
  const subs = [];
  for (const [tno, tname, tw, list] of topics) for (const [sc, sn, sw] of list) {
    const target = Math.round(Math.max(1.2, Math.min(4.6, itg + (rnd() - 0.5) * 1.4)) * 100) / 100;
    const sc0 = Math.max(1, Math.min(5, Math.round((target - 0.7 + rnd() * 1.1) * 100) / 100));
    const done0 = 0; const done = cur ? Math.ceil(sc0) : 0;
    const levels = [];
    for (let L = 1; L <= 5; L++) {
      const tg = pick([2, 4, 4, 6, 12]);
      const plan = Array(12).fill(0); let left = tg;
      for (let m = 0; m < 12 && left > 0; m++) { if (rnd() < 0.45 || 12 - m <= left) { plan[m] = 1; left--; } }
      const result = Array(12).fill(0);
      let tgt = tg;
      if (cur && L <= done && (L < done || rnd() < 0.55)) { tgt = 2; plan.fill(0); plan[0] = 1; plan[1] = 1; result[0] = 1; result[1] = 1; }
      else if (cur) { plan[0] = plan[0] || (rnd() < 0.5 ? 1 : 0); plan[1] = plan[1] || 1; for (let m = 0; m < 2; m++) result[m] = rnd() < 0.985 ? plan[m] : 0; }
      else for (let m = 0; m < 12; m++) result[m] = L <= done + 2 ? plan[m] : 0;
      const nMr = 1 + Math.floor(rnd() * 3);
      const mr = [];
      for (let k = 0; k < nMr; k++) { const has = cur ? (L <= done ? rnd() < 0.96 : rnd() < 0.3) : L <= 3; mr.push({ req: `มีหลักฐานแสดง${pick(verbs)} (${k + 1})`, has, evidence: has ? `${sc}-L${L}-${pick(evid)}.pdf` : '' }); }
      levels.push({ level: L, criteria: `ระดับ ${L}: องค์กร${pick(verbs)}ด้าน${sn}อย่างเป็นระบบ`, gap: L >= 3 && rnd() < 0.5 ? `ยังไม่ครอบคลุมทุกหน่วยงาน ควร${pick(verbs)}เพิ่มเติม` : '',
        steps: [{ name: `ดำเนินการตามค่าเกณฑ์ระดับ ${L}`, unit: pick(units), target: tgt, plan, result }],
        narrative: (cur ? (L <= done && rnd() < 0.97) : L <= 3) ? `เดือน ต.ค.–พ.ย. ได้${pick(verbs)} ตามแผนที่กำหนด และรายงานผลต่อคณะทำงานแล้ว` : '',
        mr, remark: '', note: '' });
    }
    subs.push({ code: sc, name: sn, weight: sw, target, score: cur ? sc0 : Math.round((target - 0.3 + rnd() * 0.6) * 100) / 100, levels });
  }
  return { title: '', owner: '', target: null, topics: topics.map(t => ({ no: t[0], name: t[1], weight: t[2] })), subs };
}
const seed = SEED.map(e => ({ ...e, owner: e.owner && /นาย|นาง/.test(e.owner) ? 'ผู้รับผิดชอบตัวชี้วัด' : e.owner }));
const f69 = {}, f70 = {};
for (const e of SEED) { f69[e.code] = form(e.code, e.topics, 2569, e.target || 2.4); }
f69.CM = form('CM', CM, 2569, 2.4);
r = 777;
for (const e of SEED) { f70[e.code] = form(e.code, e.topics, 2570, e.target || 2.4); }
f70.CM = form('CM', CM, 2570, 2.4);
const out = '/home/claude/cbe-data/';
fs.writeFileSync(out + 'data.js', 'window.CBE_SEED=' + JSON.stringify(seed) + ';\nwindow.CBE_FORMS=' + JSON.stringify(f69) + ';');
fs.writeFileSync(out + 'data-2570.js', 'window.CBE_FORMS_2570=' + JSON.stringify(f70) + ';');
console.log(Object.keys(f70).map(k => k + ':' + f70[k].subs.length).join(' '));
