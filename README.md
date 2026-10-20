# CBE Reporting · ระบบรายงานผล Core Business Enablers

เว็บแอปสำหรับรายงานผลการดำเนินงานตามเกณฑ์ SE-AM ของ 9 ตัวชี้วัด (CG, SP, RM, SM, DT, HCM, KM, IM, IA) แทนแบบฟอร์ม Google Sheet เดิม ผู้รายงานกรอกแผน/ผลรายเดือน รายละเอียดผล และแนบหลักฐาน กองประเมินผล (กปม.) ตรวจ ให้คะแนน และส่งกลับแก้ไขได้ในระบบเดียว

## ความสามารถ

| ส่วน | รายละเอียด |
|---|---|
| เข้าสู่ระบบ | อีเมล + รหัสผ่าน, ล็อกบัญชี 15 นาทีเมื่อผิด 5 ครั้ง, รหัสชั่วคราวต้องเปลี่ยนเมื่อเข้าใช้ครั้งแรก |
| สิทธิ์ | แอดมิน/Audit เห็นทุกตัวชี้วัดแต่รายละเอียดผลดูอย่างเดียว · ผู้รายงานเห็นและแก้ได้เฉพาะตัวชี้วัดของตน (ตรวจฝั่งเซิร์ฟเวอร์ทุกคำสั่ง) |
| ภาพรวม | คะแนนถ่วงน้ำหนักเทียบเป้า, สถานะการตรวจ, ความครบของหลักฐาน, heatmap ผลรายเดือน, รายการที่ต้องติดตาม |
| รายงานผล | หัวข้อ → ประเด็นย่อย → ระดับ 1–5: ขั้นตอน/GAP, แผน-ผล 12 เดือน, รายละเอียดผล, Minimum Requirement + ไฟล์, ข้อสังเกต กปม. |
| ขั้นตอนการตรวจ | ร่าง → ส่งตรวจ (ล็อก) → อนุมัติพร้อมคะแนน กปม. หรือส่งกลับพร้อมเหตุผล → ปลดล็อกได้ |
| คลังเอกสาร | ไฟล์อยู่ใน Google Drive โครงสร้างเดิม `3.x CODE / 3.x.y ชื่อประเด็น / เอกสารแนบค่าเกณฑ์ระดับ N` |
| Timeline | แผนกิจกรรมปีถัดไปแบบ Gantt, แอดมินกำหนดช่วงเวลากรอกและล็อกรายตัวชี้วัด |
| ผู้ดูแล | จัดการผู้ใช้, รอบรายงาน, เป้าหมาย, นำเข้าจาก Google Sheet เดิม, ซิงก์ไฟล์จาก Drive, ประวัติการแก้ไข |

## สถาปัตยกรรม

- **Google Apps Script** (V8) เป็นเว็บแอป `src/Code.gs` → `doGet()` ส่งหน้าเว็บ, `api(token, action, payload)` เป็นช่องทางเดียวที่หน้าเว็บเรียกเซิร์ฟเวอร์
- **Google Sheets** เป็นฐานข้อมูล (1 ชีทต่อตาราง ดู `TABLES` ใน `src/Config.gs`) สร้างให้อัตโนมัติด้วย `setup()`
- **Google Drive** เก็บไฟล์หลักฐาน ผู้ใช้ไม่ต้องมีสิทธิ์โฟลเดอร์ ระบบตรวจสิทธิ์แล้วส่งไฟล์ให้
- หน้าเว็บ: `src/Index.html` (โครง + ไอคอน + โลโก้), `src/Styles.html`, `src/App.html` (JavaScript ฝั่งหน้าเว็บ ไม่มีไลบรารีภายนอก)

| ไฟล์ | หน้าที่ |
|---|---|
| `Auth.gs` | รหัสผ่าน (SHA-256 + salt วนซ้ำ 4,000 รอบ), session token, ตรวจสิทธิ์ |
| `Service.gs` | ข้อมูลภาพรวม รายละเอียด การบันทึก การตรวจ Timeline ผู้ใช้ ตั้งค่า |
| `Files.gs` | อัปโหลด/ดาวน์โหลด/ลบไฟล์ และซิงก์ Drive |
| `Import.gs` | อ่านชีทต้นฉบับตามชื่อหัวคอลัมน์ |
| `Seed.gs` | โครงสร้างตัวชี้วัด หัวข้อ ประเด็นย่อย และน้ำหนักตาม SE-AM 2569 |
| `Setup.gs` | ติดตั้งฐานข้อมูลและแอดมินคนแรก |

## รูปแบบการติดตั้ง

ใช้โค้ดตรรกะชุดเดียวกัน (`src/*.gs`) ได้ 2 แบบ

| แบบ | เหมาะกับ | เอกสาร |
|---|---|---|
| **Google Apps Script** | ติดตั้งเร็ว ไม่มีค่าใช้จ่าย ใช้บัญชี Google ที่มีสิทธิ์โฟลเดอร์ | หัวข้อ "ติดตั้งบน Apps Script" ด้านล่าง |
| **Cloudflare Pages + Workers + Sheets/Drive API** | หน้าเว็บเร็ว ใช้โดเมนของตนเอง ไม่ผูกกับบัญชีบุคคล (ใช้ service account) | หัวข้อ "Deploy บน Cloudflare" ด้านล่าง |

## ติดตั้งบน Apps Script

1. สร้างโปรเจกต์ Apps Script ใหม่ (script.google.com) ด้วยบัญชีที่จะเป็นเจ้าของข้อมูลและมีสิทธิ์โฟลเดอร์ Drive ของ CBE
2. นำโค้ดขึ้น เลือกวิธีใดวิธีหนึ่ง
   - **clasp**: `npm i -g @google/clasp && clasp login` คัดลอก `.clasp.json.example` เป็น `.clasp.json` ใส่ Script ID แล้ว `clasp push`
   - **คัดลอกเอง**: สร้างไฟล์ชื่อเดียวกับใน `src/` (ไฟล์ .gs เป็น Script, .html เป็น HTML) และเปิด "Show appsscript.json" ในการตั้งค่าโปรเจกต์ แล้ววางเนื้อหา `src/appsscript.json`
3. Project Settings → Script Properties เพิ่ม `ADMIN_EMAIL` = อีเมลแอดมินคนแรก
4. เปิดไฟล์ `Setup.gs` เลือกฟังก์ชัน `setup` กด Run และอนุญาตสิทธิ์ ดูรหัสผ่านชั่วคราวใน Execution log (แสดงครั้งเดียว)
   - ระบบสร้างสเปรดชีตฐานข้อมูลชื่อ "CBE Reporting Database" และเก็บ ID ไว้ใน Script Property `DB_SPREADSHEET_ID` (หากต้องการใช้สเปรดชีตที่มีอยู่ ให้ใส่ ID นี้ก่อนรัน)
   - `setup()` รันซ้ำได้ ไม่สร้างข้อมูลซ้ำ
5. Deploy → New deployment → Web app: Execute as **Me**, Who has access **Anyone** (ระบบมีหน้าเข้าสู่ระบบของตัวเอง) หรือจำกัดเป็น **Anyone within โดเมนองค์กร** ถ้าทุกคนใช้บัญชี Google ขององค์กร
6. เข้าเว็บแอปด้วยอีเมลแอดมินและรหัสชั่วคราว ตั้งรหัสใหม่ แล้วไปที่ **ตั้งค่าและนำเข้าข้อมูล**
   - กด **นำเข้าข้อมูล** เพื่อดึงเกณฑ์ ขั้นตอน แผน/ผล รายละเอียดผล และชื่อหลักฐานจาก Google Sheet เดิม (ID ตั้งไว้ใน `DEFAULT_SETTINGS.source_sheet_id`)
   - กด **ซิงก์ Drive** เพื่อเชื่อมชื่อหลักฐานกับไฟล์จริงในโฟลเดอร์ Drive
   - ตรวจผู้รับผิดชอบ งบประมาณ และคะแนนเป้าหมาย
7. เพิ่มผู้ใช้ในหน้า **ผู้ใช้งาน** และแจ้งรหัสชั่วคราวผ่านช่องทางที่ปลอดภัย

ลืมรหัสแอดมิน: ใส่ Script Property `RESET_EMAIL` แล้วรัน `resetPasswordFromEditor` รหัสชั่วคราวใหม่อยู่ใน Execution log

## Deploy บน Cloudflare (Pages + Workers + Google Sheets API)

> สถานะ: โค้ดและชุดทดสอบพร้อมแล้ว ทดสอบกับ Google API จำลองเท่านั้น **ยังไม่เคย deploy หรือต่อ Google/Cloudflare จริง** ควรทดลองกับสเปรดชีตและโฟลเดอร์สำเนาก่อนใช้ข้อมูลจริง

### โครงสร้าง

```
เบราว์เซอร์ ──▶ Cloudflare Pages (cloudflare/pages)  หน้าเว็บ index.html + app.js + _headers (CSP)
                    │ POST /api  (Pages Function: functions/api.js)
                    ▼ service binding (ไม่เปิด Worker สู่อินเทอร์เน็ตโดยตรง)
               Worker "cbe-api" (cloudflare/worker) ──▶ Durable Object ตัวเดียว: รันคำขอทีละรายการ, เก็บ session, จำกัดการ login ต่อ IP
                    │ service account (JWT → OAuth)
                    ▼
               Google Sheets API (ฐานข้อมูล)  +  Google Drive API (ไฟล์หลักฐาน)
```

- `cloudflare/build.mjs` ห่อ `src/*.gs` เป็น `worker/gen/core.js` (ตรรกะเดียวกับ Apps Script ไม่ต้องดูแลสองชุด) และสร้าง `pages/dist`
- `worker/src/engine.js` จำลอง SpreadsheetApp/DriveApp/CacheService บน API จริง: โหลดตารางครั้งเดียวต่อคำขอ เขียนกลับเฉพาะแถวที่เปลี่ยนแบบ `RAW` (ข้อความไม่ถูกแปลงเป็นวันที่/ตัวเลข) และเขียน Drive ก่อน Sheets เพื่อไม่ให้มีแถวอ้างไฟล์ที่ไม่มีอยู่จริง
- `worker/src/google.js` ขอ access token ด้วย service account และเรียก Sheets/Drive REST API (ลองใหม่อัตโนมัติเมื่อเจอ 429/5xx)

### สิ่งที่ต้องเตรียม

1. **Google Cloud**
   - สร้างโปรเจกต์ เปิดใช้ **Google Sheets API** และ **Google Drive API**
   - IAM & Admin → Service Accounts → สร้าง service account (ไม่ต้องให้ role ในโปรเจกต์) → Keys → Add key → JSON เก็บไฟล์ไว้อย่างปลอดภัย ห้าม commit
2. **สเปรดชีตฐานข้อมูล**: สร้าง Google Sheet เปล่า 1 ไฟล์ แชร์ให้อีเมล service account (`...@...iam.gserviceaccount.com`) เป็น **Editor** จด ID จาก URL (`/d/<ID>/edit`)
3. **สเปรดชีตต้นทาง** (แบบฟอร์มเดิม ใช้ตอนนำเข้า): แชร์ให้ service account เป็น **Viewer**
4. **โฟลเดอร์เอกสาร**: service account ไม่มีพื้นที่เก็บไฟล์ของตัวเอง จึง**อัปโหลดลง My Drive ของบุคคลไม่ได้** ให้ย้ายโฟลเดอร์ "Core Business Enablers" ไปไว้ใน **Shared drive** แล้วเพิ่ม service account เป็นสมาชิกสิทธิ์ **Content manager** ถ้า ID โฟลเดอร์เปลี่ยนหลังย้าย ให้แก้ค่า `root_folder_id` ในชีท `settings` ของสเปรดชีตฐานข้อมูล (หลังรัน setup) (ถ้าเพียงแชร์โฟลเดอร์ใน My Drive จะอ่าน/ซิงก์ได้ แต่อัปโหลดไม่ได้)
5. **Cloudflare**: บัญชี Cloudflare แผน **Workers Paid** (ทดสอบในเครื่องพบว่าการ login ใช้ CPU ราว 35 ms ต่อครั้งจากการแฮชรหัสผ่าน ซึ่งเกินเพดาน 10 ms ของแผนฟรี) และ Node.js 20 ขึ้นไป

### ขั้นตอน

```bash
cd cloudflare
npm install
npx wrangler login                     # หรือตั้ง CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID

# 1) สร้างตาราง โครงสร้างตัวชี้วัด และแอดมินคนแรก (รันจากเครื่องผู้ดูแล รหัสชั่วคราวแสดงบนจอครั้งเดียว)
GOOGLE_SERVICE_ACCOUNT_FILE=./sa.json DB_SPREADSHEET_ID=<ID> ADMIN_EMAIL=<อีเมลแอดมิน> npm run setup

# 2) Worker API
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON --config worker/wrangler.toml < ./sa.json
npm run build && npx wrangler deploy --config worker/wrangler.toml --var DB_SPREADSHEET_ID:<ID>

# 3) หน้าเว็บ (ครั้งแรกจะสร้าง Pages project ชื่อ cbe-reporting)
npm run deploy:pages
```

จากนั้นเปิด `https://cbe-reporting.pages.dev` (หรือผูกโดเมนของหน่วยงานใน Pages → Custom domains) เข้าสู่ระบบด้วยรหัสชั่วคราว แล้วทำต่อตามข้อ 6–7 ของการติดตั้งบน Apps Script (นำเข้าข้อมูล ซิงก์ Drive เพิ่มผู้ใช้)

- Pages Function เรียก Worker ผ่าน service binding ที่ตั้งใน `pages/wrangler.toml` (`API` → `cbe-api`) จึงต้อง deploy Worker ก่อน Pages
- Worker ตั้ง `workers_dev = false` เรียกจากภายนอกโดยตรงไม่ได้
- ลืมรหัสแอดมิน: `GOOGLE_SERVICE_ACCOUNT_FILE=./sa.json DB_SPREADSHEET_ID=<ID> RESET_EMAIL=<อีเมล> npm run setup`
- ดู log ของ Worker: `npx wrangler tail cbe-api`
- อัปเดตโค้ด: แก้ที่ `src/` แล้วรันขั้นตอนที่ 2–3 ซ้ำ (ไม่ต้องรัน setup ใหม่)

### ข้อควรรู้

- ทุกคำขอผ่าน Durable Object ตัวเดียวเพื่อไม่ให้การเขียนชีทชนกัน เหมาะกับผู้ใช้หลักสิบคน แต่ละคำขออ่านทั้งฐานข้อมูลใหม่จาก Sheets (เรียก API 2 ครั้ง) เวลาตอบสนองจริงยังไม่ได้วัดกับ Google จริง
- โควตา Sheets API เริ่มต้น 300 คำขอต่อนาทีต่อโปรเจกต์ เพียงพอสำหรับการใช้งานปกติ การซิงก์ Drive ครั้งแรกเรียก Drive API ตามจำนวนโฟลเดอร์
- ไฟล์ที่เป็น Google Docs/Sheets ในโฟลเดอร์จะดาวน์โหลดเป็น PDF
- ห้ามแก้หัวตาราง (แถวที่ 1) ในสเปรดชีตฐานข้อมูล แก้ค่าในแถวได้แต่ควรทำเมื่อไม่มีผู้ใช้กำลังบันทึก
- ความลับ (`GOOGLE_SERVICE_ACCOUNT_JSON`) เก็บเป็น Worker secret เท่านั้น ไม่อยู่ในโค้ดหรือหน้าเว็บ
- หน้าเว็บใช้ CSP `script-src 'self'` และ header ความปลอดภัยใน `pages/_headers`

### ทดสอบในเครื่อง (ไม่ต้องใช้ Google/Cloudflare จริง)

```bash
cd cloudflare
npm test              # Worker engine กับ Google API จำลอง (test/fake-google.mjs)
npm run test:core     # ชุดทดสอบเดิม 61 รายการกับโค้ดที่ห่อสำหรับ Worker
npm run test:e2e      # ทดสอบหน้าจอผ่านเซิร์ฟเวอร์ในเครื่อง + CSP จริง (ต้องมี Playwright)
node test/e2e-server.mjs --serve   # เปิดลองที่ http://localhost:8788 บัญชีทดลองเดียวกับ dev/harness.html
```

## ความปลอดภัย

- ทุกคำสั่งตรวจ session และสิทธิ์ฝั่งเซิร์ฟเวอร์ ไม่เชื่อค่าจากหน้าเว็บ ตรวจความยาว ชนิด และช่วงของข้อมูลทุกช่อง
- เก็บเฉพาะ hash ของรหัสผ่านและ session token, session หมดอายุเมื่อไม่ใช้งาน 6 ชั่วโมง
- ข้อความผิดพลาดของระบบไม่เปิดเผยรายละเอียดภายใน (บันทึกใน Executions log แทน) ข้อความเข้าสู่ระบบไม่บอกว่าอีเมลมีอยู่หรือไม่
- ทุกข้อความที่แสดงผ่านการ escape กัน XSS, จำกัดนามสกุลและขนาดไฟล์ (10 MB)
- ไม่มีรหัสผ่านหรือคีย์ในโค้ด ค่าที่เป็นความลับอยู่ใน Script Properties
- การเขียนข้อมูลใช้ `LockService` กันการบันทึกชนกัน, การแก้ไขสำคัญบันทึกใน `audit_log`
- ข้อจำกัด: hash รหัสผ่านใช้ SHA-256 วนซ้ำเพราะ Apps Script ไม่มี bcrypt/argon2 · ไฟล์ใหญ่กว่า 20 MB เปิดผ่านลิงก์ Drive ซึ่งต้องมีสิทธิ์โฟลเดอร์

## การทดสอบ

```bash
npm test             # ทดสอบฝั่งเซิร์ฟเวอร์ด้วยบริการ Google จำลอง (tests/gas-mock.js)
npm run test:e2e     # ทดสอบหน้าเว็บด้วย Playwright ที่ 1366px, 390px และโหมดมืด
npm run harness      # สร้าง dev/harness.html เปิดดูระบบในเบราว์เซอร์โดยไม่ต้องใช้ Google
```

`dev/harness.html` ใช้บัญชีทดลอง `admin@demo.local / Admin-Demo-2569` และ `sp@demo.local / Report-Demo-2569` ซึ่งมีอยู่เฉพาะในเครื่องมือทดสอบ ไม่อยู่ในโค้ดที่ deploy

การนำเข้าทดสอบกับข้อมูลจำลองที่เลียนรูปแบบแถวจริงของชีท SP, DT และ HCM ควรตรวจรายงานผลการนำเข้าทุกตัวชี้วัดหลังนำเข้าจากชีทจริงครั้งแรก
