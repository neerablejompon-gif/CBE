// ส่งคำขอ /api ต่อให้ Worker "cbe-api" ผ่าน service binding (หน้าเว็บกับ API อยู่โดเมนเดียวกัน ไม่ต้องเปิด CORS)
export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  const fwd = new Request('https://cbe-api.internal/api', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': request.headers.get('CF-Connecting-IP') || '', 'Origin': url.origin }, body: request.body });
  return env.API.fetch(fwd);
}
export function onRequest() {
  return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
}
