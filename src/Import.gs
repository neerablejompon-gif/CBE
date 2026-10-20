/**
 * นำเข้าข้อมูลจาก Google Sheet "แบบฟอร์มรายงานผล Core Business Enablers" (1 ชีทต่อตัวชี้วัด)
 * อ่านคอลัมน์ตามชื่อหัวตาราง ไม่อิงตำแหน่ง เพราะแต่ละชีทวางคอลัมน์ไม่ตรงกัน
 */
function norm_(v) { return String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim(); }

function headerMap_(head, code) {
  var map = {};
  head.forEach(function (h, j) {
    var t = norm_(h);
    var low = t.toLowerCase();
    if (!t) return;
    function set(k) { if (map[k] === undefined) map[k] = j; }
    if (t.indexOf('ค่าเกณฑ์') >= 0) set('criteria');
    else if (t.indexOf('GAP') >= 0) set('gap');
    else if (t.indexOf('ขั้นตอน') >= 0) set('step');
    else if (t === 'น้ำหนัก') set('weight');
    else if (t === 'เป้าหมาย') set('target');
    else if (t.indexOf('หน่วยนับ') >= 0) set('unit');
    else if (t === 'แผนผล' || t === 'แผน/ผล' || t === 'แผน ผล') set('planres');
    else if (t.indexOf('คะแนน') >= 0 && t.indexOf('ปัจ') >= 0) set('score');
    else if (t.indexOf('รายละเอียดผล') >= 0) set('narrative');
    else if (low.indexOf('min') >= 0) set('minreq');
    else if (t.indexOf('ติ๊ก') >= 0) set('tick');
    else if (t.indexOf('ชื่อหลักฐาน') >= 0) set('evidence');
    else if (t.indexOf('ข้อสังเกต') >= 0) set('comment');
  });
  // HCM: ชื่อหลักฐานอยู่ใต้หัว "ข้อสังเกตจาก กปม." และข้อสังเกตอยู่คอลัมน์ถัดไป ("หมายเหตุ")
  if (code === 'HCM' && map.evidence === undefined && map.comment !== undefined) {
    map.evidence = map.comment;
    map.comment = map.comment + 1;
  }
  return map;
}

/** แปลงค่าทั้งชีท (อาร์เรย์ 2 มิติ) เป็นโครงสร้างประเด็นย่อย → ระดับ → ขั้นตอน/หลักฐาน */
function parseSheet_(values, code) {
  var out = { target: null, owner: '', budget: '', subs: {}, warnings: [] };
  var h = -1;
  for (var i = 0; i < values.length; i++) {
    if (norm_(values[i][0]) === 'ลำดับ') { h = i; break; }
  }
  if (h < 0) { out.warnings.push('ไม่พบแถวหัวตาราง (คอลัมน์ A = "ลำดับ")'); return out; }

  for (i = 0; i < h; i++) {
    var row = values[i];
    var first = norm_(row[0]);
    var rest = row.slice(1).map(norm_).filter(String);
    if (first.indexOf('ผู้รับผิดชอบ') === 0 && rest.length) out.owner = rest[0];
    if (first.indexOf('งบประมาณ') === 0 && rest.length) out.budget = rest[0];
    for (var j = 0; j < row.length; j++) {
      if (/คะแนนเป้าหมาย\s*25\d\d/.test(norm_(row[j]))) {
        for (var k = j + 1; k < row.length; k++) { var n = num_(row[k]); if (n !== null) { out.target = n; break; } }
      }
    }
  }

  var map = headerMap_(values[h], code);
  var m0 = -1, start = h + 1;
  if (values[h + 1]) {
    for (j = 0; j < values[h + 1].length; j++) if (norm_(values[h + 1][j]) === 'ต.ค.') { m0 = j; break; }
    if (m0 >= 0) start = h + 2;
  }
  if (map.criteria === undefined) out.warnings.push('ไม่พบคอลัมน์ค่าเกณฑ์');

  function cell(r, k) { return map[k] === undefined ? '' : norm_(r[map[k]]); }
  function raw(r, k) { return map[k] === undefined ? '' : String(r[map[k]] === undefined || r[map[k]] === null ? '' : r[map[k]]).trim(); }
  function months(r) {
    if (m0 < 0) return null;
    var a = [];
    for (var x = 0; x < 12; x++) a.push(num_(r[m0 + x]) || 0);
    return a;
  }

  var sub = null, lv = null, prevLv = null;
  for (i = start; i < values.length; i++) {
    var r = values[i];
    var a = norm_(r[0]), b = norm_(r[1]);
    if (/^\d+$/.test(a)) { sub = null; lv = null; continue; }
    if (/^\d+(\.\d+)+$/.test(a)) {
      sub = out.subs[a] = { score: map.score === undefined ? null : num_(r[map.score]), levels: {} };
      lv = null; prevLv = null;
      continue;
    }
    if (!sub) continue;
    var mk = b.match(/^ระดับ(?:ที่)?\s*(\d)/);
    if (mk) {
      prevLv = lv;
      var ln = Number(mk[1]);
      lv = sub.levels[ln] || (sub.levels[ln] = { criteria: '', narrative: '', steps: [], reqs: [], comments: [] });
      var crit = raw(r, 'criteria');
      if (crit && !lv.criteria) lv.criteria = crit;
    }
    if (!lv) continue;
    if (!mk && !lv.criteria && raw(r, 'criteria')) lv.criteria = raw(r, 'criteria');

    var pr = cell(r, 'planres');
    var gap = raw(r, 'gap'), step = raw(r, 'step');
    if (pr === 'แผน' || (!pr && (gap || step) && map.planres !== undefined)) {
      lv.steps.push({ gap: gap, step: step, unit: cell(r, 'unit'), target: num_(cell(r, 'target')), plan: months(r), result: null });
    } else if (pr === 'ผล') {
      var target = lv.steps.length ? lv.steps[lv.steps.length - 1] : null;
      // ชีทบางแผ่นวางป้าย "ระดับ N" บนแถวผลของระดับก่อนหน้า
      if (!target && prevLv && prevLv.steps.length && !prevLv.steps[prevLv.steps.length - 1].result) target = prevLv.steps[prevLv.steps.length - 1];
      if (target && !target.result) target.result = months(r);
      else if (!target) lv.steps.push({ gap: '', step: '', unit: '', target: null, plan: null, result: months(r) });
    }

    var narr = raw(r, 'narrative');
    if (narr) lv.narrative = lv.narrative ? lv.narrative + '\n\n' + narr : narr;
    var req = raw(r, 'minreq');
    var ev = raw(r, 'evidence').split(/\n+/).map(norm_).filter(String);
    if (req) lv.reqs.push({ text: req, has: bool_(cell(r, 'tick')), files: ev });
    else if (ev.length) {
      if (lv.reqs.length) lv.reqs[lv.reqs.length - 1].files = lv.reqs[lv.reqs.length - 1].files.concat(ev);
      else lv.reqs.push({ text: 'เอกสารประกอบอื่น (ถ้ามี)', has: true, files: ev });
    }
    var cm = raw(r, 'comment');
    if (cm) lv.comments.push(cm);
  }
  return out;
}

/**
 * นำเข้าทุกชีทจากสเปรดชีตต้นทาง ข้ามประเด็นย่อยที่มีข้อมูลในระบบแล้ว (ยกเว้น overwrite = true)
 * ไฟล์หลักฐานนำเข้าเฉพาะชื่อ แล้วใช้ "ซิงก์ Drive" เพื่อเชื่อมกับไฟล์จริง
 */
function importSheet_(u, p) {
  assertAdmin_(u);
  var id = (p && p.sheetId) || settings_().source_sheet_id;
  var book = SpreadsheetApp.openById(id);
  var overwrite = !!(p && p.overwrite);
  var report = [];
  Db.all('enablers').forEach(function (e) {
    var sh = book.getSheets().filter(function (s) { return norm_(s.getName()).toUpperCase().indexOf(e.code) === 0; })[0];
    if (!sh) { report.push({ code: e.code, error: 'ไม่พบชีท' }); return; }
    var parsed = parseSheet_(sh.getDataRange().getValues(), e.code);
    var patch = {};
    if (parsed.target !== null && (e.target === '' || e.target === null)) patch.target = parsed.target;
    if (parsed.owner && !e.owner) patch.owner = parsed.owner;
    if (parsed.budget && !e.budget) patch.budget = parsed.budget;
    if (Object.keys(patch).length) Db.update('enablers', e, patch);
    var r = { code: e.code, imported: 0, skipped: 0, unknown: [], warnings: parsed.warnings };
    Object.keys(parsed.subs).forEach(function (no) {
      var key = e.code + '-' + no;
      var s = Db.find('subtopics', function (x) { return x.key === key; });
      if (!s) { r.unknown.push(no); return; }
      var has = Db.find('levels', function (x) { return x.sub_key === key; });
      if (has && !overwrite) { r.skipped++; return; }
      applyParsedSub_(s, parsed.subs[no]);
      r.imported++;
    });
    report.push(r);
  });
  Db.reset();
  audit_(u, 'import_sheet', '', 'นำเข้าจาก Google Sheet: ' + report.map(function (x) { return x.code + ' ' + (x.error || x.imported + ' ประเด็น'); }).join(', '));
  return report;
}

function applyParsedSub_(s, ps) {
  var key = s.key;
  ['levels', 'steps', 'requirements', 'comments'].forEach(function (t) {
    Db.removeWhere(t, function (x) { return x.sub_key === key && (t !== 'comments' || x.author === 'กปม. (นำเข้า)'); });
  });
  Db.removeWhere('evidence', function (x) { return x.sub_key === key && !x.drive_id; });
  var L = [], S = [], R = [], E = [], C = [];
  var now = nowIso_();
  Object.keys(ps.levels).forEach(function (k) {
    var n = Number(k), lv = ps.levels[k];
    L.push({ id: key + '-L' + n, sub_key: key, level: n, criteria: lv.criteria, narrative: lv.narrative, folder_id: '', updated_at: now, updated_by: 'นำเข้า' });
    lv.steps.forEach(function (st, i) {
      S.push({ id: id_(), sub_key: key, level: n, sort: i, gap: st.gap, step: st.step, unit: st.unit, target: st.target === null ? '' : st.target, plan: st.plan, result: st.result || (st.plan ? [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] : null), updated_at: now });
    });
    lv.reqs.forEach(function (rq, i) {
      var rid = id_();
      R.push({ id: rid, sub_key: key, level: n, sort: i, text: rq.text, has: rq.has ? 'TRUE' : 'FALSE' });
      rq.files.forEach(function (f) {
        E.push({ id: id_(), sub_key: key, level: n, req_id: rid, name: f, drive_id: '', mime: '', size: '', uploaded_by: 'นำเข้า', uploaded_at: now, deleted: 'FALSE' });
      });
    });
    lv.comments.forEach(function (c) {
      C.push({ id: id_(), sub_key: key, author: 'กปม. (นำเข้า)', role: 'admin', text: 'ระดับ ' + n + ': ' + c, resolved: 'FALSE', created_at: now });
    });
  });
  Db.insertMany('levels', L); Db.insertMany('steps', S); Db.insertMany('requirements', R); Db.insertMany('evidence', E); Db.insertMany('comments', C);
  var sp = { updated_at: now, updated_by: 'นำเข้า' };
  if (ps.score !== null) sp.self_score = ps.score;
  if (!s.status) sp.status = 'draft';
  Db.update('subtopics', s, sp);
}
