# ติดตั้ง CBE Reporting บน server ของ กยท.

ระบบรัน `mockup/_worker.js` ชุดเดียวกับบน Cloudflare ด้วย Node.js ผ่าน `server/index.mjs`
- **ข้อมูล:** ยังอยู่ที่ Google Sheets และ Google Drive เหมือนเดิม
- **เปลี่ยน:** เฉพาะเครื่องที่ให้บริการหน้าเว็บและ API

```
ผู้ใช้ ──HTTPS──▶ nginx (server กยท.) ──▶ Docker: Node.js + _worker.js ──▶ Google Sheets / Drive API
                                                           ├──▶ Cloudflare Workers AI (REST, ถ้าเปิดใช้)
                                                           └──▶ Gemini API / LINE API (ถ้าเปิดใช้)
```

## 1. สิ่งที่ต้องขอจากฝ่ายไอที

| รายการ | รายละเอียด |
|---|---|
| เครื่อง | Linux (เช่น Ubuntu 22.04+) 2 vCPU, RAM 4 GB, ดิสก์ 20 GB, ติดตั้ง Docker + Docker Compose และ nginx |
| โดเมน | เช่น `cbe.raot.co.th` ชี้ DNS มาที่เครื่อง + ใบรับรอง HTTPS |
| อินเทอร์เน็ตขาออก (443) | `oauth2.googleapis.com`, `sheets.googleapis.com`, `www.googleapis.com` · ถ้าใช้ AI: `api.cloudflare.com`, `generativelanguage.googleapis.com` · ถ้าใช้ LINE: `api.line.me` |
| อินเทอร์เน็ตขาเข้า | 443 (ผู้ใช้) · ถ้าใช้ LINE ต้องให้ LINE เรียก `https://<โดเมน>/api/line/webhook` ได้ |
| ผู้ดูแล | อัปเดตระบบ ต่ออายุใบรับรอง และตรวจ log |

## 2. เตรียมค่าตั้งค่า

ค่าลับใน Cloudflare อ่านย้อนกลับไม่ได้ ต้องเตรียมใหม่ดังนี้

1. **Service account ของ Google** (`GOOGLE_SA`)
   - ใช้ไฟล์ JSON เดิมที่เก็บไว้ หรือสร้างคีย์ใหม่ที่ Google Cloud Console → IAM & Admin → Service accounts → `cbe-report@…` → Keys → Add key → JSON
   - บันทึกเป็น `server/secrets/google_sa.json`
   - Service account และ Sheets/Drive API ไม่คิดเงิน จึงใช้ต่อได้หลังหมดช่วงทดลองใช้ฟรีของ Google Cloud
2. **`SESSION_SECRET`:** ข้อความสุ่มอย่างน้อย 32 ตัวอักษร สร้างด้วย `openssl rand -base64 48` ค่าใหม่ทำให้ผู้ใช้ต้องเข้าระบบใหม่ 1 ครั้ง
3. **`SYSTEM_SHEET_ID`, `FILES_FOLDER_ID`, `DRIVE_OAUTH`:** ค่าเดียวกับที่ตั้งใน Cloudflare (ดูวิธีได้มาใน `mockup/DEPLOY.md`)
4. **Workers AI (ถ้าใช้):**
   - Cloudflare → My Profile → API Tokens → Create Token → เทมเพลต **Workers AI**
   - ได้ `CF_API_TOKEN` ส่วน `CF_ACCOUNT_ID` ดูได้ที่หน้า Workers AI
   - ยังใช้โควตาฟรีวันละ 10,000 Neurons ของบัญชี Cloudflare เดิม
5. **Gemini, LINE:** ค่าเดียวกับใน Cloudflare

คัดลอก `server/.env.example` เป็น `server/.env` แล้วใส่ค่า (ทั้ง `.env` และ `secrets/` ไม่เข้า git)

## 3. ติดตั้ง

```bash
git clone https://github.com/neerablejompon-gif/CBE.git && cd CBE
```
```bash
cp server/.env.example server/.env && nano server/.env
```
```bash
mkdir -p server/secrets && cp /path/to/google_sa.json server/secrets/google_sa.json && chmod 600 server/secrets/google_sa.json
```
```bash
docker compose -f server/docker-compose.yml up -d --build
```
ตั้ง nginx ตาม `server/nginx.conf.example` แล้ว `sudo nginx -t && sudo systemctl reload nginx`

ตรวจ: `docker compose -f server/docker-compose.yml logs -f` ต้องเห็น `[cbe] listening on :8080 · public https://…` แล้วเปิดโดเมนในเบราว์เซอร์และเข้าระบบด้วยบัญชีทดสอบ

## 4. ย้ายจาก Cloudflare (วันสลับระบบ)

1. ทดสอบบนโดเมนใหม่ให้ครบ ทั้งเข้าระบบ บันทึก แนบไฟล์ และ กปม. ตรวจ ระหว่างนี้ Cloudflare ยังใช้งานได้ตามปกติ เพราะใช้ข้อมูลชุดเดียวกัน
2. **LINE:** LINE Developers → Messaging API → Webhook URL = `https://<โดเมนใหม่>/api/line/webhook`
3. **แจ้งเตือนรายวัน:** GitHub → Settings → Secrets → `CBE_APP_URL` = `https://<โดเมนใหม่>`
4. แจ้งผู้ใช้ให้ใช้ที่อยู่ใหม่
5. **Cloudflare:** ใช้เป็นระบบสำรองได้ หรือปิดโปรเจกต์ Pages เมื่อมั่นใจแล้ว (Workers AI ยังใช้บัญชี Cloudflare ต่อได้)

## 5. ดูแลระบบ

| งาน | คำสั่ง / วิธี |
|---|---|
| อัปเดตเป็นเวอร์ชันล่าสุด | `git pull && docker compose -f server/docker-compose.yml up -d --build` |
| ดู log | `docker compose -f server/docker-compose.yml logs --since 1h` |
| รีสตาร์ต | `docker compose -f server/docker-compose.yml restart` |
| สำรองข้อมูล | ข้อมูลอยู่ใน Google Sheets/Drive ไม่ได้อยู่บนเครื่องนี้ สำรองด้วยการคัดลอกชีตตามรอบ บนเครื่องมีเพียง `server/.env` และ `server/secrets/` ที่ต้องเก็บสำรองแบบปลอดภัย |

## หมายเหตุทางเทคนิค
- **ไฟล์ที่เปิดให้เข้าถึง:** เฉพาะ `index.html`, `privacy.html` และ `assets/` ไฟล์อื่นใน `mockup/` ไม่เปิดให้เข้าถึง
- **`PUBLIC_URL` ต้องตรงกับที่อยู่ที่ผู้ใช้พิมพ์:** ระบบใช้ค่านี้ตรวจว่าคำขอมาจากหน้าระบบจริง และใช้สร้างลิงก์ในข้อความ LINE
- **การล็อกบัญชีเมื่อใส่รหัสผิด:** นับตามรหัสพนักงานรวมกับ IP จาก `X-Forwarded-For` ของ nginx และเก็บในหน่วยความจำ จึงรีเซ็ตเมื่อรีสตาร์ต
- **ทดสอบตัวแปลง:** `node tests/server/adapter_test.mjs` ใช้ Google จำลอง ไม่ต้องต่อเน็ต
