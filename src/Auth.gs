/**
 * การยืนยันตัวตน: บัญชีอยู่ในตาราง users รหัสผ่านเก็บเป็นแฮช SHA-256 แบบวนซ้ำพร้อม salt
 * session token สุ่มใหม่ทุกครั้งที่เข้าสู่ระบบ เก็บใน CacheService (เก็บเฉพาะแฮชของ token)
 */
var Auth = (function () {
  function hex_(bytes) {
    return bytes.map(function (b) { return ((b < 0 ? b + 256 : b) + 0x100).toString(16).slice(1); }).join('');
  }

  function sha_(s) {
    return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8));
  }

  function hashPassword(pw, salt) {
    var h = salt + ':' + pw;
    for (var i = 0; i < APP.pwIterations; i++) h = sha_(h + ':' + salt);
    return h;
  }

  function randomToken_() {
    return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  }

  /** รหัสผ่านชั่วคราว 12 ตัว ไม่มีตัวที่สับสนง่าย */
  function tempPassword() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    var hexs = randomToken_();
    var out = '';
    for (var i = 0; i < 12; i++) out += chars[parseInt(hexs.substr(i * 2, 2), 16) % chars.length];
    return out;
  }

  function validatePassword(pw) {
    if (typeof pw !== 'string' || pw.length < APP.pwMinLength) return 'รหัสผ่านต้องยาวอย่างน้อย ' + APP.pwMinLength + ' ตัวอักษร';
    if (pw.length > 128) return 'รหัสผ่านยาวเกินไป';
    if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'รหัสผ่านต้องมีทั้งตัวอักษรและตัวเลข';
    return '';
  }

  function setPassword(user, pw, mustChange) {
    var salt = randomToken_().slice(0, 32);
    Db.update('users', user, { pw_hash: hashPassword(pw, salt), pw_salt: salt, must_change: mustChange ? 'TRUE' : 'FALSE', failed: 0, locked_until: '' });
  }

  function cacheKey_(token) { return 'sess:' + sha_(token); }

  function login(email, pw) {
    email = String(email || '').trim().toLowerCase();
    if (!email || !pw) throw new UserError('กรุณากรอกอีเมลและรหัสผ่าน');
    var user = Db.find('users', function (u) { return String(u.email).toLowerCase() === email; });
    var generic = 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
    if (!user || !bool_(user.active)) {
      hashPassword(String(pw), 'dummy-salt-to-equalize-timing');
      throw new UserError(generic);
    }
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      throw new UserError('บัญชีถูกล็อกชั่วคราวเพราะใส่รหัสผ่านผิดหลายครั้ง ลองใหม่ภายหลังหรือติดต่อผู้ดูแลระบบ');
    }
    if (hashPassword(String(pw), user.pw_salt) !== user.pw_hash) {
      var failed = (Number(user.failed) || 0) + 1;
      var patch = { failed: failed };
      if (failed >= APP.maxLoginFail) {
        patch.locked_until = new Date(Date.now() + APP.lockMinutes * 60000).toISOString();
        patch.failed = 0;
      }
      Db.update('users', user, patch);
      audit_(user, 'login_failed', '', 'ใส่รหัสผ่านผิด');
      throw new UserError(generic);
    }
    Db.update('users', user, { failed: 0, locked_until: '', last_login: nowIso_() });
    var token = randomToken_();
    CacheService.getScriptCache().put(cacheKey_(token), user.id, APP.sessionTtlSec);
    audit_(user, 'login', '', 'เข้าสู่ระบบ');
    return { token: token, mustChange: bool_(user.must_change) };
  }

  /** คืนผู้ใช้จาก token หรือโยน error ถ้าหมดอายุ (ต่ออายุแบบเลื่อนทุกครั้งที่ใช้) */
  function require(token) {
    if (!token || typeof token !== 'string' || token.length > 100) throw new AuthError();
    var cache = CacheService.getScriptCache();
    var key = cacheKey_(token);
    var uid = cache.get(key);
    if (!uid) throw new AuthError();
    var user = Db.find('users', function (u) { return u.id === uid; });
    if (!user || !bool_(user.active)) { cache.remove(key); throw new AuthError(); }
    cache.put(key, uid, APP.sessionTtlSec);
    return user;
  }

  function logout(token) {
    if (token) CacheService.getScriptCache().remove(cacheKey_(token));
  }

  function changePassword(user, oldPw, newPw) {
    if (hashPassword(String(oldPw || ''), user.pw_salt) !== user.pw_hash) throw new UserError('รหัสผ่านเดิมไม่ถูกต้อง');
    var err = validatePassword(newPw);
    if (err) throw new UserError(err);
    if (newPw === oldPw) throw new UserError('รหัสผ่านใหม่ต้องไม่ซ้ำรหัสผ่านเดิม');
    setPassword(user, newPw, false);
    audit_(user, 'change_password', '', 'เปลี่ยนรหัสผ่าน');
  }

  return { login: login, require: require, logout: logout, changePassword: changePassword, setPassword: setPassword, tempPassword: tempPassword, validatePassword: validatePassword, hashPassword: hashPassword };
})();

/** ข้อผิดพลาดที่แสดงให้ผู้ใช้เห็นได้ (ข้อผิดพลาดอื่นจะถูกซ่อนรายละเอียด) */
function UserError(msg) { this.message = msg; this.name = 'UserError'; }
UserError.prototype = Object.create(Error.prototype);
function AuthError() { this.message = 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'; this.name = 'AuthError'; }
AuthError.prototype = Object.create(Error.prototype);

function isAdmin_(u) { return u.role === 'admin'; }

function userEnablers_(u) {
  if (isAdmin_(u)) return Db.all('enablers').map(function (e) { return e.code; });
  return String(u.enablers || '').split(',').map(function (s) { return s.trim(); }).filter(String);
}

function canSee_(u, code) { return isAdmin_(u) || userEnablers_(u).indexOf(code) >= 0; }

function assertSee_(u, code) {
  if (!canSee_(u, code)) throw new UserError('ไม่มีสิทธิ์เข้าถึงตัวชี้วัดนี้');
}

/** ผู้รายงานแก้ได้เฉพาะตัวชี้วัดของตน แอดมิน/Audit ดูรายละเอียดผลได้อย่างเดียว */
function assertOwner_(u, code) {
  if (isAdmin_(u)) throw new UserError('แอดมิน/Audit ดูรายละเอียดผลการดำเนินงานได้อย่างเดียว');
  if (userEnablers_(u).indexOf(code) < 0) throw new UserError('ไม่มีสิทธิ์แก้ไขตัวชี้วัดนี้');
}

function assertAdmin_(u) {
  if (!isAdmin_(u)) throw new UserError('เฉพาะแอดมิน/Audit');
}

function audit_(u, action, enabler, detail) {
  Db.insert('audit_log', { at: nowIso_(), user: u ? u.name : 'system', role: u ? u.role : 'system', enabler: enabler || '', action: action, detail: String(detail || '').slice(0, 500) });
}
