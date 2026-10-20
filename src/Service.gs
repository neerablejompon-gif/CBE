/**
 * ตรรกะธุรกิจ: ทุกฟังก์ชันรับผู้ใช้ที่ยืนยันตัวตนแล้ว และตรวจสิทธิ์เองเสมอ (ไม่เชื่อค่าจากฝั่งเบราว์เซอร์)
 */

/* ---------- ค่าตั้งระบบ ---------- */
function settings_() {
  var s = Object.assign({}, DEFAULT_SETTINGS);
  Db.all('settings').forEach(function (r) { s[r.key] = String(r.value); });
  return s;
}

function setSetting_(key, value) {
  var r = Db.find('settings', function (x) { return x.key === key; });
  if (r) Db.update('settings', r, { value: String(value) });
  else Db.insert('settings', { key: key, value: String(value) });
}

function windowOpen_(s) {
  var today = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
  return today >= s.tl_open && today <= s.tl_close;
}

/** ดัชนีเดือนปัจจุบันในปีบัญชี (ต.ค. = 0) ของปีบัญชี fyBE; ก่อนเริ่ม = -1, หลังจบ = 12 */
function fiscalMonthIndex_(fyBE) {
  var start = new Date(Number(fyBE) - 543 - 1, 9, 1);
  var now = new Date();
  var idx = (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth();
  return Math.max(-1, Math.min(12, idx));
}

/* ---------- ค้นหา ---------- */
function sub_(key) {
  var s = Db.find('subtopics', function (x) { return x.key === key; });
  if (!s) throw new UserError('ไม่พบประเด็นย่อย');
  return s;
}

function editableStatus_(s) { return s.status === 'draft' || s.status === 'returned' || s.status === ''; }

function assertEditableSub_(u, s) {
  assertOwner_(u, s.enabler);
  if (!editableStatus_(s)) throw new UserError('ประเด็นนี้ส่งตรวจหรืออนุมัติแล้ว แก้ไขไม่ได้จนกว่าจะถูกส่งกลับ');
}

function levelNo_(level) {
  var n = Number(level);
  if (!(n >= 1 && n <= 5 && Math.floor(n) === n)) throw new UserError('ระดับต้องเป็น 1–5');
  return n;
}

function levelRow_(key, level, create) {
  var r = Db.find('levels', function (x) { return x.sub_key === key && Number(x.level) === level; });
  if (!r && create) r = Db.insert('levels', { id: key + '-L' + level, sub_key: key, level: level, criteria: '', narrative: '', folder_id: '', updated_at: nowIso_(), updated_by: '' });
  return r;
}

function touchSub_(u, s) {
  Db.update('subtopics', s, { updated_at: nowIso_(), updated_by: u.name });
}

function str_(v, max, label) {
  var t = String(v === undefined || v === null ? '' : v).trim();
  if (t.length > max) throw new UserError((label || 'ข้อความ') + ' ยาวเกิน ' + max + ' ตัวอักษร');
  return t;
}

function months_(arr, label) {
  if (!Array.isArray(arr) || arr.length !== 12) throw new UserError(label + ' ต้องมี 12 เดือน');
  return arr.map(function (v) {
    if (v === '' || v === null || v === undefined) return 0;
    var n = Number(v);
    if (isNaN(n) || n < 0 || n > 999999) throw new UserError(label + ' ต้องเป็นตัวเลข 0 ขึ้นไป');
    return n;
  });
}

/* ---------- ข้อมูลเริ่มต้นหลังเข้าสู่ระบบ ---------- */
function bootstrap_(u) {
  var s = settings_();
  var codes = userEnablers_(u);
  var subs = Db.where('subtopics', function (x) { return codes.indexOf(x.enabler) >= 0; });
  var keys = {};
  subs.forEach(function (x) { keys[x.key] = true; });

  var docs = {}, req = {}, reqHas = {}, cm = {}, tl = {};
  var files = {};
  Db.all('evidence').forEach(function (f) {
    if (!keys[f.sub_key] || bool_(f.deleted)) return;
    docs[f.sub_key] = (docs[f.sub_key] || 0) + 1;
    if (f.req_id) files[f.req_id] = true;
  });
  Db.all('requirements').forEach(function (r) {
    if (!keys[r.sub_key]) return;
    req[r.sub_key] = (req[r.sub_key] || 0) + 1;
    if (bool_(r.has) && files[r.id]) reqHas[r.sub_key] = (reqHas[r.sub_key] || 0) + 1;
  });
  Db.all('comments').forEach(function (c) {
    if (keys[c.sub_key] && c.role === 'admin' && !bool_(c.resolved)) cm[c.sub_key] = (cm[c.sub_key] || 0) + 1;
  });
  var acts = Db.where('activities', function (a) { return keys[a.sub_key]; });
  acts.forEach(function (a) { tl[a.sub_key] = true; });

  // ผลรายเดือนเทียบแผน: นับขั้นตอนที่มีแผนในเดือนนั้น และที่มีผลถึงแผน
  var monthly = {};
  Db.all('steps').forEach(function (st) {
    if (!keys[st.sub_key]) return;
    var code = st.sub_key.split('-')[0];
    var p = json_(st.plan, null), r = json_(st.result, null);
    if (!p) return;
    var m = monthly[code] || (monthly[code] = { plan: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], done: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
    for (var i = 0; i < 12; i++) if (Number(p[i]) > 0) { m.plan[i]++; if (r && Number(r[i]) >= Number(p[i])) m.done[i]++; }
  });

  var topics = Db.all('topics');
  var enablers = Db.all('enablers').filter(function (e) { return codes.indexOf(e.code) >= 0; })
    .sort(function (a, b) { return a.sort - b.sort; })
    .map(function (e) {
      return {
        code: e.code, no: String(e.no), drive: String(e.drive), name: e.name, en: e.en, owner: e.owner, budget: e.budget,
        target: num_(e.target), incomplete: bool_(e.incomplete), folderId: e.folder_id, reportFileId: e.report_file_id,
        monthly: monthly[e.code] || null,
        topics: topics.filter(function (t) { return t.enabler === e.code; }).sort(function (a, b) { return a.sort - b.sort; }).map(function (t) {
          return {
            id: t.id, no: String(t.no), name: t.name, w: num_(t.weight),
            subs: subs.filter(function (x) { return x.topic_id === t.id; }).sort(function (a, b) { return a.sort - b.sort; }).map(function (x) {
              return {
                key: x.key, no: String(x.no), name: x.name, w: num_(x.weight), self: num_(x.self_score), audit: num_(x.audit_score),
                status: x.status || 'draft', submittedAt: x.submitted_at || '', updatedAt: x.updated_at || '', folderId: x.folder_id,
                docs: docs[x.key] || 0, req: req[x.key] || 0, reqHas: reqHas[x.key] || 0, openCm: cm[x.key] || 0, hasTl: !!tl[x.key]
              };
            })
          };
        })
      };
    });

  var log = Db.all('audit_log').filter(function (l) {
    return isAdmin_(u) ? l.action !== 'login' && l.action !== 'login_failed' : l.enabler && codes.indexOf(l.enabler) >= 0;
  }).slice(-150).reverse().map(function (l) { return { at: l.at, user: l.user, role: l.role, enabler: l.enabler, action: l.action, detail: l.detail }; });

  return {
    me: { id: u.id, name: u.name, email: u.email, role: u.role, enablers: codes, mustChange: bool_(u.must_change) },
    today: Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd'),
    settings: { fy: s.fy, reportMonth: Number(s.report_month), deadline: s.report_deadline, contact: s.contact, rootFolderId: s.root_folder_id },
    timeline: {
      fy: s.tl_fy, open: s.tl_open, close: s.tl_close, from: Number(s.tl_from), to: Number(s.tl_to), locked: json_(s.tl_locked, []),
      isOpen: windowOpen_(s), now: fiscalMonthIndex_(s.tl_fy),
      acts: acts.map(actOut_)
    },
    enablers: enablers,
    log: log
  };
}

function actOut_(a) {
  return { id: a.id, sub: a.sub_key, lv: Number(a.level), name: a.name, s: Number(a.start), e: Number(a.end), p: Number(a.progress) || 0, out: a.output, by: a.created_by };
}

/* ---------- รายละเอียดประเด็นย่อย ---------- */
function getSub_(u, key) {
  var s = sub_(key);
  assertSee_(u, s.enabler);
  var lv = Db.where('levels', function (x) { return x.sub_key === key; });
  var st = Db.where('steps', function (x) { return x.sub_key === key; });
  var rq = Db.where('requirements', function (x) { return x.sub_key === key; });
  var ev = Db.where('evidence', function (x) { return x.sub_key === key && !bool_(x.deleted); });
  var levels = [1, 2, 3, 4, 5].map(function (n) {
    var L = lv.filter(function (x) { return Number(x.level) === n; })[0];
    return {
      level: n, exists: !!L, criteria: L ? L.criteria : '', narrative: L ? L.narrative : '', folderId: L ? L.folder_id : '',
      updatedAt: L ? L.updated_at : '', updatedBy: L ? L.updated_by : '',
      steps: st.filter(function (x) { return Number(x.level) === n; }).sort(function (a, b) { return a.sort - b.sort; }).map(function (x) {
        return { id: x.id, gap: x.gap, step: x.step, unit: x.unit, target: num_(x.target), plan: json_(x.plan, null), result: json_(x.result, null) };
      }),
      reqs: rq.filter(function (x) { return Number(x.level) === n; }).sort(function (a, b) { return a.sort - b.sort; }).map(function (x) {
        return { id: x.id, text: x.text, has: bool_(x.has), files: ev.filter(function (f) { return f.req_id === x.id; }).map(fileOut_) };
      }),
      loose: ev.filter(function (f) { return Number(f.level) === n && !f.req_id; }).map(fileOut_)
    };
  });
  var comments = Db.where('comments', function (x) { return x.sub_key === key; })
    .sort(function (a, b) { return a.created_at < b.created_at ? -1 : 1; })
    .map(function (c) { return { id: c.id, by: c.author, role: c.role, text: c.text, resolved: bool_(c.resolved), at: c.created_at }; });
  return { key: key, status: s.status || 'draft', self: num_(s.self_score), audit: num_(s.audit_score), levels: levels, comments: comments };
}

function fileOut_(f) {
  return { id: f.id, name: f.name, driveId: f.drive_id, size: Number(f.size) || 0, at: f.uploaded_at, by: f.uploaded_by, level: Number(f.level), sub: f.sub_key };
}

/* ---------- ผู้รายงาน: บันทึกผล ---------- */
function saveLevel_(u, p) {
  var s = sub_(p.key);
  assertEditableSub_(u, s);
  var n = levelNo_(p.level);
  var L = levelRow_(s.key, n, true);
  var cur = Number(settings_().report_month);
  if (p.narrative !== undefined) Db.update('levels', L, { narrative: str_(p.narrative, 5000, 'รายละเอียดผลการดำเนินงาน'), updated_at: nowIso_(), updated_by: u.name });
  if (p.results) {
    Object.keys(p.results).forEach(function (sid) {
      var st = Db.find('steps', function (x) { return x.id === sid && x.sub_key === s.key && Number(x.level) === n; });
      if (!st) throw new UserError('ไม่พบขั้นตอนที่จะบันทึกผล');
      var vals = months_(p.results[sid], 'ผลรายเดือน');
      var old = json_(st.result, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      for (var i = cur + 1; i < 12; i++) if (vals[i] !== (Number(old[i]) || 0)) throw new UserError('บันทึกผลได้ถึงเดือน ' + APP.months[cur] + ' เท่านั้น');
      Db.update('steps', st, { result: vals, updated_at: nowIso_() });
    });
  }
  if (p.reqHas) {
    Object.keys(p.reqHas).forEach(function (rid) {
      var r = Db.find('requirements', function (x) { return x.id === rid && x.sub_key === s.key; });
      if (!r) throw new UserError('ไม่พบรายการ Minimum Requirement');
      Db.update('requirements', r, { has: p.reqHas[rid] ? 'TRUE' : 'FALSE' });
    });
  }
  touchSub_(u, s);
  audit_(u, 'save_level', s.enabler, 'บันทึก ' + s.key + ' ระดับ ' + n);
  return getSub_(u, s.key);
}

function setSelfScore_(u, p) {
  var s = sub_(p.key);
  assertEditableSub_(u, s);
  var v = Number(p.score);
  if (p.score === '' || isNaN(v) || v < 0 || v > 5) throw new UserError('คะแนนประเมินตนเองต้องอยู่ระหว่าง 0–5');
  Db.update('subtopics', s, { self_score: Math.round(v * 10000) / 10000 });
  touchSub_(u, s);
  audit_(u, 'self_score', s.enabler, s.key + ' ประเมินตนเอง ' + v.toFixed(2));
  return { self: Number(s.self_score) };
}

function saveStep_(u, p) {
  var s = sub_(p.key);
  assertEditableSub_(u, s);
  var n = levelNo_(p.level);
  levelRow_(s.key, n, true);
  var data = {
    gap: str_(p.gap, 3000, 'วิเคราะห์ GAP'), step: str_(p.step, 3000, 'ขั้นตอนการดำเนินงาน'), unit: str_(p.unit, 50, 'หน่วยนับ'),
    target: p.target === '' || p.target === null || p.target === undefined ? '' : Number(p.target),
    plan: months_(p.plan, 'แผนรายเดือน'), updated_at: nowIso_()
  };
  if (data.target !== '' && (isNaN(data.target) || data.target < 0)) throw new UserError('เป้าหมายต้องเป็นตัวเลข 0 ขึ้นไป');
  if (!data.step) throw new UserError('กรุณาระบุขั้นตอนการดำเนินงาน');
  if (p.id) {
    var st = Db.find('steps', function (x) { return x.id === p.id && x.sub_key === s.key; });
    if (!st) throw new UserError('ไม่พบขั้นตอน');
    Db.update('steps', st, data);
  } else {
    var sort = Db.where('steps', function (x) { return x.sub_key === s.key && Number(x.level) === n; }).length;
    Db.insert('steps', Object.assign({ id: id_(), sub_key: s.key, level: n, sort: sort, result: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }, data));
  }
  touchSub_(u, s);
  audit_(u, p.id ? 'edit_step' : 'add_step', s.enabler, s.key + ' ระดับ ' + n + ': ' + data.step.slice(0, 80));
  return getSub_(u, s.key);
}

function deleteStep_(u, p) {
  var s = sub_(p.key);
  assertEditableSub_(u, s);
  var st = Db.find('steps', function (x) { return x.id === p.id && x.sub_key === s.key; });
  if (!st) throw new UserError('ไม่พบขั้นตอน');
  Db.removeWhere('steps', function (x) { return x.id === p.id; });
  touchSub_(u, s);
  audit_(u, 'delete_step', s.enabler, s.key + ' ลบขั้นตอน: ' + String(st.step).slice(0, 80));
  return getSub_(u, s.key);
}

function addRequirement_(u, p) {
  var s = sub_(p.key);
  assertEditableSub_(u, s);
  var n = levelNo_(p.level);
  var text = str_(p.text, 1000, 'Minimum Requirement');
  if (!text) throw new UserError('กรุณาระบุรายการเอกสาร');
  levelRow_(s.key, n, true);
  var sort = Db.where('requirements', function (x) { return x.sub_key === s.key && Number(x.level) === n; }).length;
  Db.insert('requirements', { id: id_(), sub_key: s.key, level: n, sort: sort, text: text, has: 'FALSE' });
  touchSub_(u, s);
  audit_(u, 'add_requirement', s.enabler, s.key + ' ระดับ ' + n + ': ' + text.slice(0, 80));
  return getSub_(u, s.key);
}

/* ---------- ขั้นตอนอนุมัติ ---------- */
function submit_(u, p) {
  var s = sub_(p.key);
  assertEditableSub_(u, s);
  var reqs = Db.where('requirements', function (x) { return x.sub_key === s.key && bool_(x.has); });
  var ev = Db.where('evidence', function (x) { return x.sub_key === s.key && !bool_(x.deleted); });
  var missing = reqs.filter(function (r) { return !ev.some(function (f) { return f.req_id === r.id; }); });
  if (missing.length) throw new UserError('ยังส่งไม่ได้: มี ' + missing.length + ' รายการที่ติ๊กว่ามีเอกสารแต่ยังไม่แนบไฟล์');
  if (s.self_score === '' || s.self_score === null) throw new UserError('กรุณากรอกคะแนนประเมินตนเองก่อนส่งตรวจ');
  Db.update('subtopics', s, { status: 'submitted', submitted_at: nowIso_(), updated_at: nowIso_(), updated_by: u.name });
  audit_(u, 'submit', s.enabler, 'ส่ง ' + s.key + ' ให้ กปม. ตรวจ');
  return { status: s.status };
}

function approve_(u, p) {
  assertAdmin_(u);
  var s = sub_(p.key);
  if (s.status !== 'submitted') throw new UserError('อนุมัติได้เฉพาะรายการที่รอตรวจ');
  var v = Number(p.score);
  if (p.score === '' || p.score === null || isNaN(v) || v < 0 || v > 5) throw new UserError('คะแนน กปม. ต้องอยู่ระหว่าง 0–5');
  Db.update('subtopics', s, { status: 'approved', audit_score: Math.round(v * 10000) / 10000, updated_at: nowIso_(), updated_by: u.name });
  audit_(u, 'approve', s.enabler, 'อนุมัติ ' + s.key + ' คะแนน ' + v.toFixed(2));
  return { status: s.status };
}

function returnSub_(u, p) {
  assertAdmin_(u);
  var s = sub_(p.key);
  var reason = str_(p.reason, 2000, 'เหตุผล');
  if (reason.length < 10) throw new UserError('กรุณาระบุเหตุผลอย่างน้อย 10 ตัวอักษร');
  if (p.unlock ? s.status !== 'approved' : s.status !== 'submitted') throw new UserError(p.unlock ? 'ปลดล็อกได้เฉพาะรายการที่อนุมัติแล้ว' : 'ส่งกลับได้เฉพาะรายการที่รอตรวจ');
  Db.update('subtopics', s, { status: 'returned', updated_at: nowIso_(), updated_by: u.name });
  Db.insert('comments', { id: id_(), sub_key: s.key, author: u.name, role: 'admin', text: (p.unlock ? 'ปลดล็อก: ' : '') + reason, resolved: 'FALSE', created_at: nowIso_() });
  audit_(u, p.unlock ? 'unlock' : 'return', s.enabler, (p.unlock ? 'ปลดล็อก ' : 'ส่งกลับ ') + s.key + ': ' + reason);
  return { status: s.status };
}

function addComment_(u, p) {
  var s = sub_(p.key);
  if (isAdmin_(u)) assertSee_(u, s.enabler); else assertOwner_(u, s.enabler);
  var text = str_(p.text, 2000, 'ข้อความ');
  if (!text) throw new UserError('กรุณาพิมพ์ข้อความ');
  Db.insert('comments', { id: id_(), sub_key: s.key, author: u.name, role: isAdmin_(u) ? 'admin' : 'user', text: text, resolved: 'FALSE', created_at: nowIso_() });
  audit_(u, 'comment', s.enabler, s.key + ': ' + text.slice(0, 120));
  return getSub_(u, s.key).comments;
}

function resolveComment_(u, p) {
  assertAdmin_(u);
  var c = Db.find('comments', function (x) { return x.id === p.id; });
  if (!c) throw new UserError('ไม่พบข้อสังเกต');
  Db.update('comments', c, { resolved: 'TRUE' });
  audit_(u, 'resolve_comment', c.sub_key.split('-')[0], 'ปิดข้อสังเกต ' + c.sub_key);
  return getSub_(u, c.sub_key).comments;
}

/* ---------- Timeline ---------- */
function saveActivity_(u, p) {
  var s = sub_(p.sub);
  assertOwner_(u, s.enabler);
  var cfg = settings_();
  if (!windowOpen_(cfg)) throw new UserError('อยู่นอกช่วงเวลากรอก Timeline (' + cfg.tl_open + ' ถึง ' + cfg.tl_close + ')');
  if (json_(cfg.tl_locked, []).indexOf(s.enabler) >= 0) throw new UserError('Timeline ของ ' + s.enabler + ' ถูกล็อกโดยแอดมิน');
  var start = Number(p.s), end = Number(p.e), from = Number(cfg.tl_from), to = Number(cfg.tl_to);
  if (!(start >= from && end <= to && end >= start)) throw new UserError('ช่วงเดือนไม่ถูกต้อง: ต้องอยู่ระหว่าง ' + APP.months[from] + ' ถึง ' + APP.months[to] + ' และเดือนสิ้นสุดต้องไม่ก่อนเดือนเริ่ม');
  var name = str_(p.name, 200, 'ชื่อกิจกรรม');
  if (!name) throw new UserError('กรุณาระบุชื่อกิจกรรม');
  var prog = Number(p.p);
  if (isNaN(prog) || prog < 0 || prog > 100) throw new UserError('ความก้าวหน้าต้องอยู่ระหว่าง 0–100');
  var data = { level: levelNo_(p.lv), name: name, start: start, end: end, progress: Math.round(prog), output: str_(p.out, 200, 'ผลผลิต'), updated_at: nowIso_() };
  var a;
  if (p.id) {
    a = Db.find('activities', function (x) { return x.id === p.id; });
    if (!a || a.sub_key !== s.key) throw new UserError('ไม่พบกิจกรรม');
    Db.update('activities', a, data);
  } else {
    a = Db.insert('activities', Object.assign({ id: id_(), sub_key: s.key, created_by: u.name }, data));
  }
  audit_(u, p.id ? 'edit_activity' : 'add_activity', s.enabler, 'Timeline ' + s.key + ': ' + name);
  return actOut_(a);
}

function deleteActivity_(u, p) {
  var a = Db.find('activities', function (x) { return x.id === p.id; });
  if (!a) throw new UserError('ไม่พบกิจกรรม');
  var code = a.sub_key.split('-')[0];
  assertOwner_(u, code);
  var cfg = settings_();
  if (!windowOpen_(cfg)) throw new UserError('อยู่นอกช่วงเวลากรอก Timeline');
  if (json_(cfg.tl_locked, []).indexOf(code) >= 0) throw new UserError('Timeline ของ ' + code + ' ถูกล็อกโดยแอดมิน');
  Db.removeWhere('activities', function (x) { return x.id === p.id; });
  audit_(u, 'delete_activity', code, 'ลบกิจกรรม Timeline: ' + a.name);
  return true;
}

function saveWindow_(u, p) {
  assertAdmin_(u);
  var re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(p.open) || !re.test(p.close)) throw new UserError('รูปแบบวันที่ไม่ถูกต้อง');
  if (p.close < p.open) throw new UserError('วันปิดรับต้องไม่ก่อนวันเปิด');
  var from = Number(p.from), to = Number(p.to);
  if (!(from >= 0 && to <= 11 && to >= from)) throw new UserError('ช่วงเดือนไม่ถูกต้อง');
  var out = Db.all('activities').filter(function (a) { return Number(a.start) < from || Number(a.end) > to; });
  if (out.length) throw new UserError('มี ' + out.length + ' กิจกรรมที่อยู่นอกช่วงเดือนใหม่ ให้ผู้รับผิดชอบปรับก่อน');
  setSetting_('tl_open', p.open); setSetting_('tl_close', p.close); setSetting_('tl_from', from); setSetting_('tl_to', to);
  audit_(u, 'timeline_window', '', 'ช่วงกรอก Timeline ' + p.open + ' ถึง ' + p.close + ' (' + APP.months[from] + '–' + APP.months[to] + ')');
  return true;
}

function setTimelineLock_(u, p) {
  assertAdmin_(u);
  if (!Db.find('enablers', function (e) { return e.code === p.code; })) throw new UserError('ไม่พบตัวชี้วัด');
  var locked = json_(settings_().tl_locked, []).filter(function (c) { return c !== p.code; });
  if (p.locked) locked.push(p.code);
  setSetting_('tl_locked', JSON.stringify(locked));
  audit_(u, 'timeline_lock', p.code, (p.locked ? 'ล็อก' : 'ปลดล็อก') + ' Timeline ' + p.code);
  return locked;
}

/* ---------- แอดมิน: ผู้ใช้และค่าตั้ง ---------- */
function listUsers_(u) {
  assertAdmin_(u);
  return Db.all('users').map(function (x) {
    return { id: x.id, email: x.email, name: x.name, role: x.role, enablers: String(x.enablers || '').split(',').filter(String), active: bool_(x.active), lastLogin: x.last_login, locked: !!(x.locked_until && new Date(x.locked_until) > new Date()) };
  });
}

function saveUser_(u, p) {
  assertAdmin_(u);
  var email = str_(p.email, 200, 'อีเมล').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserError('อีเมลไม่ถูกต้อง');
  var name = str_(p.name, 120, 'ชื่อ');
  if (!name) throw new UserError('กรุณาระบุชื่อ');
  if (p.role !== 'admin' && p.role !== 'reporter') throw new UserError('บทบาทไม่ถูกต้อง');
  var codes = Db.all('enablers').map(function (e) { return e.code; });
  var en = (p.enablers || []).filter(function (c) { return codes.indexOf(c) >= 0; });
  if (p.role === 'reporter' && !en.length) throw new UserError('ผู้รายงานต้องมีตัวชี้วัดที่รับผิดชอบอย่างน้อย 1 ตัว');
  var dup = Db.find('users', function (x) { return String(x.email).toLowerCase() === email && x.id !== p.id; });
  if (dup) throw new UserError('อีเมลนี้มีในระบบแล้ว');
  var data = { email: email, name: name, role: p.role, enablers: p.role === 'admin' ? '' : en.join(','), active: p.active === false ? 'FALSE' : 'TRUE' };
  if (p.id) {
    var x = Db.find('users', function (y) { return y.id === p.id; });
    if (!x) throw new UserError('ไม่พบผู้ใช้');
    if (x.id === u.id && (data.role !== 'admin' || data.active === 'FALSE')) throw new UserError('เปลี่ยนบทบาทหรือปิดบัญชีของตัวเองไม่ได้');
    Db.update('users', x, data);
    audit_(u, 'edit_user', '', 'แก้ไขผู้ใช้ ' + email);
    return { id: x.id };
  }
  var nu = Db.insert('users', Object.assign({ id: id_(), created_at: nowIso_(), failed: 0, locked_until: '', last_login: '' }, data));
  var pw = Auth.tempPassword();
  Auth.setPassword(nu, pw, true);
  audit_(u, 'add_user', '', 'เพิ่มผู้ใช้ ' + email);
  return { id: nu.id, tempPassword: pw };
}

function resetPassword_(u, p) {
  assertAdmin_(u);
  var x = Db.find('users', function (y) { return y.id === p.id; });
  if (!x) throw new UserError('ไม่พบผู้ใช้');
  var pw = Auth.tempPassword();
  Auth.setPassword(x, pw, true);
  audit_(u, 'reset_password', '', 'รีเซ็ตรหัสผ่าน ' + x.email);
  return { tempPassword: pw };
}

function saveSettings_(u, p) {
  assertAdmin_(u);
  var m = Number(p.reportMonth);
  if (!(m >= 0 && m <= 11)) throw new UserError('เดือนรอบรายงานไม่ถูกต้อง');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.deadline)) throw new UserError('วันปิดรับผลไม่ถูกต้อง');
  if (!/^25\d\d$/.test(String(p.fy))) throw new UserError('ปีบัญชีต้องเป็น พ.ศ. 4 หลัก');
  setSetting_('report_month', m); setSetting_('report_deadline', p.deadline); setSetting_('fy', p.fy);
  setSetting_('contact', str_(p.contact, 120, 'ช่องทางติดต่อ'));
  audit_(u, 'settings', '', 'รอบรายงาน ' + APP.months[m] + ' ปิดรับ ' + p.deadline);
  return true;
}

function saveEnabler_(u, p) {
  assertAdmin_(u);
  var e = Db.find('enablers', function (x) { return x.code === p.code; });
  if (!e) throw new UserError('ไม่พบตัวชี้วัด');
  var t = p.target === '' || p.target === null ? '' : Number(p.target);
  if (t !== '' && (isNaN(t) || t < 0 || t > 5)) throw new UserError('คะแนนเป้าหมายต้องอยู่ระหว่าง 0–5');
  Db.update('enablers', e, { owner: str_(p.owner, 300, 'ผู้รับผิดชอบ'), budget: str_(p.budget, 100, 'งบประมาณ'), target: t });
  audit_(u, 'edit_enabler', e.code, 'แก้ข้อมูลตัวชี้วัด ' + e.code);
  return true;
}
