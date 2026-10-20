// ติดตั้งฐานข้อมูลบน Google Sheets ผ่าน service account จากเครื่องผู้ดูแล (รันครั้งเดียว รันซ้ำได้ไม่สร้างข้อมูลซ้ำ)
//   GOOGLE_SERVICE_ACCOUNT_FILE=./sa.json DB_SPREADSHEET_ID=... ADMIN_EMAIL=... npm run setup
//   RESET_EMAIL=... (แทน ADMIN_EMAIL) เพื่อออกรหัสผ่านชั่วคราวใหม่ให้บัญชีนั้น
// รหัสผ่านชั่วคราวแสดงบนจอนี้เท่านั้น ไม่ถูกบันทึกที่อื่น
import fs from 'node:fs';
import { createGoogle } from '../worker/src/google.js';
import { createEngine } from '../worker/src/engine.js';

const env = process.env;
const saJson = env.GOOGLE_SERVICE_ACCOUNT_JSON || (env.GOOGLE_SERVICE_ACCOUNT_FILE && fs.readFileSync(env.GOOGLE_SERVICE_ACCOUNT_FILE, 'utf8'));
if (!saJson || !env.DB_SPREADSHEET_ID || !(env.ADMIN_EMAIL || env.RESET_EMAIL)) {
  console.error('ต้องตั้งค่า GOOGLE_SERVICE_ACCOUNT_FILE (หรือ GOOGLE_SERVICE_ACCOUNT_JSON), DB_SPREADSHEET_ID และ ADMIN_EMAIL หรือ RESET_EMAIL');
  process.exit(1);
}
const engine = createEngine({
  google: createGoogle(saJson),
  store: { async get() { return null; }, async put() {}, async remove() {} },
  props: { DB_SPREADSHEET_ID: env.DB_SPREADSHEET_ID, ADMIN_EMAIL: env.ADMIN_EMAIL || '', RESET_EMAIL: env.RESET_EMAIL || '' },
  log: (lv, t) => console.log(t)
});
try {
  if (env.RESET_EMAIL) await engine.resetPassword();
  else await engine.setup();
} catch (e) {
  console.error('ไม่สำเร็จ: ' + e.message);
  process.exit(1);
}
