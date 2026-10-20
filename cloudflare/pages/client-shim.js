/* แทน google.script.run ของ Apps Script: ส่งคำสั่งไปที่ /api (Pages Function ส่งต่อให้ Worker) */
window.google = { script: { get run() {
  var ok = function () {}, bad = function () {};
  var o = {
    withSuccessHandler: function (f) { ok = f; return o; },
    withFailureHandler: function (f) { bad = f; return o; },
    api: function (token, action, payload) {
      fetch('/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, action: action, payload: payload }),
        credentials: 'same-origin', cache: 'no-store'
      }).then(function (r) {
        return r.json().catch(function () { throw new Error('HTTP ' + r.status); });
      }).then(ok, bad);
    }
  };
  return o;
} } };
