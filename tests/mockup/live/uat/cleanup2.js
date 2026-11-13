const B = 'https://cbe-report.pages.dev';
const m = { '1006': 'RM|RM|1.1|self', '1005': 'HCM|HCM|1.1|self', '1001': 'DT|DT|1.1|self', '1004': 'IA|IA|1.1|self', '1002': 'SCM|CM|1.1|self', '1003': 'SCM|SM|2.1|self', '1007': 'SP|SP|1.1|self', '1009': 'KMIM|KM|1.1|self', '1011': 'KMIM|IM|1.1|self' };
(async () => { for (const [id, k] of Object.entries(m)) {
  const l = await fetch(B + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: B }, body: JSON.stringify({ id, password: 'cbe@' + id }) });
  const x = await fetch(B + '/api/save', { method: 'POST', headers: { 'content-type': 'application/json', origin: B, cookie: l.headers.get('set-cookie').split(';')[0] }, body: JSON.stringify({ fy: 2570, ops: [{ s: 'patch', k, v: null }], log: [] }) });
  console.log(id, k, x.status); } })();
