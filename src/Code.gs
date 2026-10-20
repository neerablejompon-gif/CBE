/**
 * จุดเข้าเว็บแอป: doGet ส่งหน้าเว็บ และ api() เป็นช่องทางเดียวที่หน้าเว็บเรียกฝั่งเซิร์ฟเวอร์
 */
function doGet() {
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('CBE Reporting · ระบบรายงานผล Core Business Enablers')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/** action → [handler, ต้องล็อกการเขียน] (สร้างตอนเรียก เพราะไฟล์ .gs โหลดตามลำดับ) */
function actions_() {
  return {
    bootstrap: [bootstrap_, false],
    getSub: [function (u, p) { return getSub_(u, p.key); }, false],
    listFiles: [listFiles_, false],
    downloadFile: [downloadFile_, false],
    listUsers: [listUsers_, false],
    logout: [function () { return true; }, false],
    changePassword: [function (u, p) { Auth.changePassword(u, p.oldPw, p.newPw); return true; }, true],
    saveLevel: [saveLevel_, true],
    setSelfScore: [setSelfScore_, true],
    saveStep: [saveStep_, true],
    deleteStep: [deleteStep_, true],
    addRequirement: [addRequirement_, true],
    submit: [submit_, true],
    approve: [approve_, true],
    returnSub: [returnSub_, true],
    addComment: [addComment_, true],
    resolveComment: [resolveComment_, true],
    uploadFile: [uploadFile_, true],
    deleteFile: [deleteFile_, true],
    saveActivity: [saveActivity_, true],
    deleteActivity: [deleteActivity_, true],
    saveWindow: [saveWindow_, true],
    setTimelineLock: [setTimelineLock_, true],
    saveUser: [saveUser_, true],
    resetPassword: [resetPassword_, true],
    saveSettings: [saveSettings_, true],
    saveEnabler: [saveEnabler_, true],
    importSheet: [importSheet_, true],
    syncDrive: [syncDrive_, true]
  };
}

function api(token, action, payload) {
  var lock = null;
  try {
    Db.reset();
    payload = payload && typeof payload === 'object' ? payload : {};
    if (action === 'login') {
      lock = LockService.getScriptLock();
      lock.waitLock(20000);
      return { ok: true, data: Auth.login(payload.email, payload.password) };
    }
    var h = Object.prototype.hasOwnProperty.call(actions_(), action) ? actions_()[action] : null;
    if (!h) throw new UserError('ไม่รู้จักคำสั่ง');
    var user = Auth.require(token);
    if (action === 'logout') { Auth.logout(token); return { ok: true, data: true }; }
    if (bool_(user.must_change) && action !== 'changePassword' && action !== 'bootstrap') throw new UserError('กรุณาเปลี่ยนรหัสผ่านก่อนใช้งาน');
    if (h[1]) {
      lock = LockService.getScriptLock();
      lock.waitLock(20000);
      Db.reset();
    }
    return { ok: true, data: h[0](user, payload) };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, auth: true, error: e.message };
    if (e instanceof UserError) return { ok: false, error: e.message };
    console.error(action + ': ' + (e && e.stack || e));
    return { ok: false, error: 'เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่ หากยังพบปัญหาแจ้งผู้ดูแลระบบ' };
  } finally {
    if (lock) try { lock.releaseLock(); } catch (x) { /* ไม่ได้ถือ lock */ }
  }
}
