# ติดตั้งระบบจริง: Cloudflare Pages + Google Sheets (Service Account)

```
ผู้ใช้ → หน้าเข้าสู่ระบบ (รหัสพนักงาน 4 หลัก + รหัสผ่าน cbe@รหัสพนักงาน)
      → Cloudflare Pages: index.html + _worker.js
      → _worker.js ──service account──→ Google Sheets (แบบฟอร์ม 10 ไฟล์ + ชีตระบบ) / Google Drive (ไฟล์หลักฐาน)
```

- **ชีตแบบฟอร์ม (10 ไฟล์):** เป็นฐานข้อมูลเกณฑ์ แผน และเป้าหมาย ระบบเขียนผลรายเดือน ผลการดำเนินงาน และหลักฐานกลับลงฟอร์มให้อัตโนมัติ
- **ชีตระบบ "CBE System":** เก็บผู้ใช้/สิทธิ์ สถานะการส่งตรวจ ข้อมูลทุกช่องที่แก้ในระบบ และ Audit trail
- **ใช้ระบบเป็นช่องทางแก้หลัก:** ถ้าแก้ในชีตแบบฟอร์มโดยตรง ระดับที่เคยบันทึกผ่านระบบแล้วจะยังแสดงค่าจากระบบ

## 1. Google Cloud: สร้าง Service Account
1. เปิด https://console.cloud.google.com/iam-admin/serviceaccounts แล้วเลือกโปรเจกต์
2. กด **Create service account** ตั้งชื่อเช่น `cbe-report` ไม่ต้องให้ role ใด ๆ (สิทธิ์มาจากการแชร์ไฟล์)
3. เปิด service account ที่สร้าง แล้วไปที่ **Keys → Add key → JSON** ระบบจะดาวน์โหลดไฟล์กุญแจลงเครื่อง
   - เก็บไฟล์นี้เป็นความลับ ห้ามใส่ใน GitHub ห้ามส่งทางแชต
4. ไปที่ **APIs & Services → Library** แล้วเปิด **Google Sheets API** และ **Google Drive API**
5. ใช้ service account แยกจากระบบอื่น เพื่อไม่แชร์กุญแจและโควตา Sheets (60 คำขอต่อนาทีต่อ service account)

## 2. Google Drive: เตรียมชีต
1. **แปลงแบบฟอร์มเป็น Google Sheets:** อัปโหลด `New Form/*.xlsx` ทั้ง 10 ไฟล์ขึ้น Drive แล้วเปิดแต่ละไฟล์ เลือก **ไฟล์ → บันทึกเป็น Google ชีต**
   - ห้ามเปลี่ยนชื่อแท็บ `1.สรุปรายงานผู้บริหาร` และ `2.ผลตามเกณฑ์และ GAP`
2. **สร้าง Google ชีตชื่อ "CBE System"** มี 4 แท็บ แถวที่ 1 เป็นหัวตาราง:

   | แท็บ | หัวตาราง (A, B, C, …) | ใส่อะไร |
   |---|---|---|
   | `users` | id · role · ind · part · name | หนึ่งแถวต่อผู้ใช้ |
   | `forms` | fy · code · id | หนึ่งแถวต่อแบบฟอร์ม |
   | `state` | fy · store · key · value · by · at | เว้นว่าง ระบบเขียนเอง |
   | `log` | at · id · who · what | เว้นว่าง ระบบเขียนเอง |

   **แท็บ `users`** (คอลัมน์ id = รหัสพนักงาน 4 หลัก)
   - **role:** `audit` (กปม./ผู้ดูแลระบบ), `exec` (ผู้บริหาร) หรือ `reporter`
   - **ind (เฉพาะ reporter):** `CG` `SP` `RM` `SCM` `DT` `HCM` `KMIM` `IA`
   - **part:** ใส่เฉพาะผู้รายงานรายส่วน คือ `SM` `CM` (ของ SCM) หรือ `KM` `IM` (ของ KMIM) ถ้าเว้นว่างจะแก้ได้ทั้งตัวชี้วัด
   - **ยกเลิกสิทธิ์:** ลบแถวออก ระบบตัดการเข้าใช้ภายใน 1 นาที

   ```
   id    role      ind   part  name
   1000  audit                 ผู้ดูแลระบบ
   2001  exec                  ผู้บริหาร
   3001  reporter  SCM   SM    ผู้รายงาน SM
   3002  reporter  RM          ผู้รายงาน RM
   ```

   **แท็บ `forms`**
   - **id:** รหัสชีตในลิงก์ `docs.google.com/spreadsheets/d/<id>/edit`
   - **code:** `CG` `SP` `RM` `SM` `CM` `DT` `HCM` `KM` `IM` `IA` (10 แถว ใส่ fy เป็น `2570`)
   - **แถวที่ 11 สำหรับปี 2569:** fy เว้นว่าง code = `ARCHIVE` id = รหัสไฟล์ `data.js` ใน Drive
     - สร้าง `data.js` ด้วย `tools/forms-to-json.ps1` (ใส่ `-KeepNames` ถ้าต้องการชื่อจริง) แล้วอัปโหลดขึ้น Drive
     - รหัสไฟล์คือส่วน `<id>` ในลิงก์ `drive.google.com/file/d/<id>/view`
   - **ผลประเมินรายประเด็น (หน้าผลการดำเนินงานที่ผ่านมา):** fy เว้นว่าง code = `HISTORY_AXES` id = รหัสไฟล์ `history-axes.js` ใน Drive
     - ไฟล์นี้เก็บคะแนนรายประเด็นและประเด็น GAP จากรายงาน TRIS ปี 2566–2568 มีเนื้อหารายงานจริง ห้ามใส่ใน GitHub
     - แชร์ให้ service account สิทธิ์ **ผู้มีสิทธิ์อ่าน** เหมือน `data.js`
3. **แชร์ทุกไฟล์ให้อีเมล service account:**
   - ชีตแบบฟอร์ม 10 ไฟล์ และ CBE System: สิทธิ์ **ผู้แก้ไข**
   - `data.js`: สิทธิ์ **ผู้มีสิทธิ์อ่าน**
4. **โฟลเดอร์ไฟล์หลักฐาน:** ระบบเก็บไฟล์ตามโครงสร้างเดิมของโฟลเดอร์ "กลุ่มที่ 3 Core Business Enablers"
   ```
   กลุ่มที่ 3 Core Business Enablers/          ← FILES_FOLDER_ID
     3.6 HCM/                                  ← ตามแบบฟอร์ม: 3.1 CG, 3.2 SP, 3.3 RM, 3.4.1 SM, 3.4.2 CM, 3.5 DT, 3.6 HCM, 3.7.1 KM, 3.7.2 IM, 3.8 IA
       3.6.4.4 บทบาทของสายงาน HR/              ← "เลขแบบฟอร์ม.รหัสประเด็น ชื่อประเด็น"
         เอกสารแนบค่าเกณฑ์ระดับ 1/ … 5/        ← ไฟล์ที่แนบในระดับนั้น
   ```
   - **โฟลเดอร์ที่มีอยู่แล้ว:** ระบบใช้โฟลเดอร์เดิม ค้นจากเลขนำหน้าชื่อ
   - **โฟลเดอร์ที่ยังไม่มี:** ระบบสร้างให้อัตโนมัติด้วยชื่อแบบเดียวกัน
   - **service account อัปโหลดไฟล์ไม่ได้:** Google ไม่ให้พื้นที่เก็บไฟล์กับ service account ถ้าโฟลเดอร์อยู่ใน Drive ส่วนตัว (@gmail.com) ต้องให้**เจ้าของโฟลเดอร์**อนุญาตผ่าน OAuth ตามขั้นที่ 2.5 ไฟล์จะเป็นของบัญชีนั้นและใช้พื้นที่ของบัญชีนั้น
   - **ถ้าใช้ Shared Drive ของ Google Workspace:** เพิ่ม service account เป็นผู้จัดการเนื้อหาก็พอ ไม่ต้องทำขั้นที่ 2.5

## 2.5 OAuth ของเจ้าของโฟลเดอร์หลักฐาน (ทำครั้งเดียว)
1. **ตั้งหน้าขอความยินยอม:** ไปที่ Google Cloud โปรเจกต์ `cbe-report` → **APIs & Services → OAuth consent screen**
   - เลือก **External** ตั้งชื่อแอปว่า `CBE Report` แล้วใส่อีเมลติดต่อ
   - ในหน้า Audience กด **Publish app** เพื่อเปลี่ยนเป็น **In production** ถ้าค้างเป็น Testing โทเคนจะหมดอายุใน 7 วัน
2. **สร้าง OAuth client:** ไปที่ **Credentials → Create credentials → OAuth client ID**
   - เลือก **Web application**
   - **Authorized redirect URIs:** `https://developers.google.com/oauthplayground`
   - จด **Client ID** และ **Client secret**
3. **ขอ refresh token:** เปิด https://developers.google.com/oauthplayground
   - กด ⚙️ แล้วติ๊ก **Use your own OAuth credentials** วาง Client ID และ Client secret
   - ช่อง Step 1 พิมพ์ `https://www.googleapis.com/auth/drive` แล้วกด **Authorize APIs**
   - ล็อกอินด้วย**บัญชีเจ้าของโฟลเดอร์**แล้วกดอนุญาต ถ้าขึ้น "Google hasn't verified this app" ให้กด Advanced → Go to CBE Report
   - Step 2 กด **Exchange authorization code for tokens** แล้วคัดลอก **Refresh token**
4. **ใส่ค่าใน Cloudflare:** ไปที่ Settings → Variables and secrets
   - `DRIVE_OAUTH` (**Secret**): `{"client_id":"…","client_secret":"…","refresh_token":"…"}`
   - `FILES_FOLDER_ID` (Text): รหัสโฟลเดอร์ "กลุ่มที่ 3 Core Business Enablers"
   - กด **Retry deployment**

refresh token เข้าถึง Drive ทั้งหมดของบัญชีนั้น ต้องเก็บเป็นความลับ ถ้าต้องการยกเลิก ไปที่ https://myaccount.google.com/permissions ของบัญชีนั้น

## 3. Cloudflare Pages: ขึ้นเว็บ
1. push โฟลเดอร์ `mockup/` ขึ้น GitHub (`.gitignore` กันไฟล์ข้อมูลไว้แล้ว)
2. ไปที่ Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** แล้วเลือก repo
   - **Build command:** เว้นว่าง
   - **Build output directory:** `mockup`
3. ไปที่ **Settings → Variables and Secrets (Production)** แล้วเพิ่ม:

   | ชื่อ | ชนิด | ค่า |
   |---|---|---|
   | `GOOGLE_SA` | **Secret** | วางเนื้อหาไฟล์กุญแจ JSON ทั้งไฟล์ |
   | `SESSION_SECRET` | **Secret** | ข้อความสุ่มยาว 32 ตัวขึ้นไป ใช้เซ็นคุกกี้เข้าสู่ระบบ ถ้าเปลี่ยน ทุกคนต้องล็อกอินใหม่ |
   | `SYSTEM_SHEET_ID` | Text | รหัสชีต CBE System |
   | `FILES_FOLDER_ID` | Text | รหัสโฟลเดอร์หลักฐาน (ไม่บังคับ) |
   | `CUR_FY` | Text | `2570` |

   สร้าง `SESSION_SECRET` ได้ด้วยคำสั่ง PowerShell:
   ```powershell
   -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 48 | % { [char]$_ })
   ```
4. กด **Retry deployment** ให้ค่าใหม่มีผล

## 4. ความปลอดภัยของการเข้าสู่ระบบ
**ข้อจำกัดของรหัสผ่านแบบนี้:** รหัสผ่านเป็น `cbe@รหัสพนักงาน` ตามที่องค์กรกำหนด ใครรู้รหัสพนักงานของคนอื่นก็เข้าระบบแทนได้

ระบบป้องกันเท่าที่ทำได้ภายใต้เงื่อนไขนี้:
- **ล็อกเมื่อใส่ผิด:** ใส่รหัสผิด 5 ครั้งต่อรหัสพนักงานต่อเครื่อง ล็อก 15 นาที
- **หมดเวลาอัตโนมัติ:** คุกกี้เข้าสู่ระบบเซ็นด้วย `SESSION_SECRET` และหมดอายุใน 8 ชั่วโมง
- **กันคำขอจากเว็บอื่น:** ไม่รับคำขอที่ส่งมาจากเว็บไซต์อื่น
- **Audit trail:** บันทึกการเข้า/ออกระบบและทุกการแก้ไข พร้อมรหัสพนักงาน
- **ตัดสิทธิ์ได้เร็ว:** ลบแถวออกจากแท็บ `users` ระบบตัดการเข้าใช้ภายใน 1 นาที แม้ผู้ใช้ยังล็อกอินค้างอยู่

ควรตั้งเพิ่มใน Cloudflare (แพ็กเกจฟรีทำได้):
- **Security → WAF → Rate limiting rules:** URI path เท่ากับ `/api/login` จำกัด 10 ครั้งต่อนาทีต่อ IP แล้ว Block
- **ถ้าจะให้ใช้เฉพาะในเครือข่ายองค์กร:** ตั้ง WAF custom rule ให้ Block เมื่อ IP ไม่อยู่ในช่วง IP ขององค์กร

## 5. ตรวจหลังติดตั้ง
- **ทดสอบแต่ละบทบาท:** เข้าด้วย 1000 / `cbe@1000` แล้วลองบัญชีผู้บริหารและผู้รายงาน ต้องเห็นเมนูตามสิทธิ์
- **ทดสอบการบันทึก:** ให้ผู้รายงานกรอกผล 1 ช่อง แล้วดูแท็บ `state` และ `log` กับแถวผลในชีตแบบฟอร์ม ต้องมีข้อมูลเข้า
- **ถ้ารหัสถูกแต่เข้าไม่ได้:** ตรวจว่ามีรหัสพนักงานในแท็บ `users` และกำหนด role ถูกต้อง ระบบแคชรายชื่อไว้ 60 วินาที
- **ถ้าขึ้น error 1102 (Worker exceeded resource limits):** แพ็กเกจฟรีให้ CPU 10ms ต่อคำขอ ให้เปลี่ยนเป็น Workers Paid ($5/เดือน)

## 6. แจ้งเตือนผ่าน LINE (Messaging API)

| เมื่อ | ส่งถึง | เนื้อหา |
|---|---|---|
| ทุกวันที่ 1 เวลา 08:00 | ผู้รายงาน | ค่าเกณฑ์/หัวข้อ/ระดับที่มีแผนในเดือนที่ผ่านมา (ครบกำหนดส่งวันที่ 5) และงานล่าช้า/เลยกำหนด |
| ทุกวันที่ 6 เวลา 08:00 | กปม. | สรุปภาพรวมรายเดือนทุกตัวชี้วัด และจำนวนระดับที่เลยกำหนด |
| ทุกวัน เวลา 08:00 | ผู้รายงาน | ช่วงกรอกแผนจะปิดในอีก 3 วัน |
| ทันทีที่ กปม. เปลี่ยน Config | ผู้รายงาน | เปิด/ปิดช่วงกรอกแผนการดำเนินงาน หรือแผนปรับปรุง GAP |

ส่งเฉพาะผู้ใช้ที่เชื่อมต่อ LINE แล้ว ข้อความเป็น Flex message พร้อมปุ่มเปิดระบบ

### 6.1 LINE Developers Console (บัญชี LINE OA ของหน่วยงาน)
1. เปิด https://developers.line.biz/console/ เลือก Provider และ Channel แบบ **Messaging API** ของ OA (ถ้ายังไม่มี ให้เปิด Messaging API จาก LINE Official Account Manager → ตั้งค่า → Messaging API)
2. แท็บ **Basic settings:** คัดลอก **Channel secret**
3. แท็บ **Messaging API:**
   - **Channel access token (long-lived):** กด Issue แล้วคัดลอก
   - **Webhook URL:** `https://<โดเมนระบบ>/api/line/webhook` กด **Verify** ต้องขึ้น Success แล้วเปิด **Use webhook**
   - **Auto-reply messages / Greeting messages:** ปิดทั้งคู่ (กดลิงก์ไปที่ OA Manager) ไม่อย่างนั้น OA จะตอบข้อความซ้ำกับระบบ
4. คัดลอกลิงก์เพิ่มเพื่อนของ OA จาก OA Manager (รูปแบบ `https://line.me/R/ti/p/@xxxxxxx`)

### 6.2 Cloudflare Pages → Settings → Variables and Secrets (Production)
| ชื่อ | ชนิด | ค่า |
|---|---|---|
| `LINE_CHANNEL_SECRET` | **Secret** | Channel secret |
| `LINE_CHANNEL_TOKEN` | **Secret** | Channel access token (long-lived) |
| `LINE_ADD_URL` | Text | ลิงก์เพิ่มเพื่อนของ OA |
| `CRON_KEY` | **Secret** | ข้อความสุ่มยาว 32 ตัวขึ้นไป (สร้างแบบเดียวกับ `SESSION_SECRET`) |

แล้วกด **Retry deployment** ถ้ายังไม่ตั้ง `LINE_CHANNEL_TOKEN` ระบบใช้งานได้ตามปกติ แค่ไม่มีเมนูเชื่อมต่อ LINE

### 6.3 ชีต CBE System
เพิ่มแท็บ **`line`** แถวที่ 1 เป็นหัวตาราง: `id · line_user · linked_at · code · code_exp` เว้นข้อมูลว่างไว้ ระบบเขียนเอง (ห้ามแก้มือ ยกเว้นลบแถวเพื่อยกเลิกการเชื่อมต่อของคนนั้น)

### 6.4 GitHub → Settings → Secrets and variables → Actions → New repository secret
| ชื่อ | ค่า |
|---|---|
| `CBE_APP_URL` | ที่อยู่ระบบ เช่น `https://cbe-report.pages.dev` (ไม่มี `/` ท้าย) |
| `CBE_CRON_KEY` | ค่าเดียวกับ `CRON_KEY` ใน Cloudflare |

งานตั้งเวลาอยู่ที่ `.github/workflows/line-notify.yml` รันทุกวัน 08:00 (GitHub อาจเริ่มช้ากว่าเวลาที่ตั้ง 5–30 นาที)

### 6.5 ทดสอบ
1. เข้าระบบ → กดชื่อมุมขวาบน → **เชื่อมต่อ LINE** → เพิ่มเพื่อน → **รับรหัส** → ส่งรหัส 6 หลักในแชท OA ภายใน 10 นาที → หน้าต่างในระบบเปลี่ยนเป็น "เชื่อมต่อแล้ว"
2. กด **ส่งข้อความทดสอบ** ต้องได้รับข้อความใน LINE
3. GitHub → **Actions → LINE notify → Run workflow** เลือก job = `monthly` และติ๊ก **dry** ดูข้อความที่จะส่งใน log (ไม่ส่งจริง) แล้วค่อยรันแบบไม่ติ๊ก dry
4. ทดสอบในเครื่อง: `npm run test:line` (จำลอง Google Sheets และ LINE API)

### 6.6 ริชเมนู (LINE OA Manager → ริชเมนู → สร้าง)
ภาพ `line/richmenu.jpg` (2500×1686 · แก้ได้ที่ `line/richmenu.html`) เลือก template ขนาดใหญ่ 6 ช่อง แล้วตั้ง action:

| ช่อง | ปุ่ม | ชนิด | ค่า |
|---|---|---|---|
| 1 | งานของฉัน | ลิงก์ | `https://cbe-report.pages.dev/?tab=dash` |
| 2 | รายงานผล | ลิงก์ | `https://cbe-report.pages.dev/?tab=report` |
| 3 | ภาพรวม | ลิงก์ | `https://cbe-report.pages.dev/?tab=score` |
| 4 | สถานะของฉัน | ข้อความ | `สถานะ` |
| 5 | กำหนดส่ง | ข้อความ | `กำหนดส่ง` |
| 6 | ช่วยเหลือ | ข้อความ | `ช่วยเหลือ` |

`?tab=` ใช้ได้ทั้ง dash, report, score, plan, gap, evidence (ผู้รายงาน; ถ้ายังไม่ได้เข้าระบบจะไปหน้า login ก่อนแล้วพาไปหน้านั้น) · บอทรู้จักคำ `สถานะ` `กำหนดส่ง` `ช่วยเหลือ` (พิมพ์เองก็ได้) · ถ้าระบบขัดข้อง บอทจะตอบขอโทษพร้อมเบอร์ 343 แทนการเงียบ

## 7. AI ช่วยตรวจเบื้องต้น (Workers AI · ไม่บังคับ)

ปุ่ม **AI ช่วยตรวจ** ในพื้นที่ผู้ตรวจสอบ (เฉพาะ กปม.) ส่งค่าเกณฑ์ ผลการดำเนินงาน ชื่อหลักฐาน ข้อเสนอแนะ สคร. และผลตามแนวทางปรับปรุงของแต่ละระดับให้ Workers AI อ่าน ผลขึ้นเป็นข้อค้นพบ "AI" ที่ กปม. ยืนยันหรือตัดออกได้เหมือนกฎอื่น ไม่ส่งไฟล์หลักฐาน และผู้รายงานไม่เห็นผล AI

1. Cloudflare → Workers & Pages → โปรเจกต์ → Settings → Bindings → Add → **Workers AI** ชื่อ `AI` แล้วกด Retry deployment
2. (ไม่บังคับ) Variables: `AI_MODEL` (ค่าเริ่มต้น `@cf/google/gemma-4-26b-a4b-it`) และ `AI_DAILY_NEURONS` (ค่าเริ่มต้น 8000)

โควตาฟรี 10,000 Neurons ต่อวัน รีเซ็ต 07:00 น. ระบบหยุดเรียก AI เมื่อถึง `AI_DAILY_NEURONS` และส่ง LINE แจ้ง กปม. เมื่อใช้ถึง 80% ระบบตรวจซ้ำเฉพาะระดับที่เนื้อหาเปลี่ยน ดูการใช้จริงได้ที่ Cloudflare → AI → Workers AI

## 8. ผู้ช่วยเขียนสำหรับผู้รายงาน (Gemini + Workers AI สำรอง)

แผง "ผู้ช่วยเขียน (AI)" ในขั้น ② ผลการดำเนินงาน ช่วยเรียบเรียงตามค่าเกณฑ์ ปรับจากผลปีก่อน และตรวจว่ายังขาดอะไร ผู้รายงานตรวจทานและกดใช้เอง ข้อมูลที่ไม่มีจะเป็นช่อง 【ระบุ …】 และระบบไม่นับว่าพร้อมส่งจนกว่าจะแก้ครบ

1. aistudio.google.com → Get API key → Create API key (แบบฟรีไม่ต้องผูกบัตร) แล้วดูโควตาที่ Usage / Rate limits
2. Cloudflare → Pages โปรเจกต์ → Settings → Variables and Secrets (**Production**)
   - `GEMINI_API_KEY` ชนิด Secret
   - `GEMINI_MODEL` เช่น `gemini-3.8-flash` (ไม่ตั้ง = `gemini-flash-latest` · รุ่น 2.5 ใช้กับคีย์ใหม่ไม่ได้แล้ว)
   - `GEMINI_DAILY_CALLS` ต่ำกว่าโควตารายวันเล็กน้อย (แบบฟรี 20 ครั้ง/วัน → ตั้ง 18)
   - `GEMINI_TIER=paid` เมื่อเปลี่ยนเป็นแบบชำระเงิน (ซ่อนคำเตือนแบบฟรี)
3. **Retry deployment** ค่าที่เพิ่มมีผลเมื่อ deploy ครั้งถัดไป

ไม่มีคีย์ โควตาหมด หรือ Gemini เรียกไม่สำเร็จ ระบบใช้ Workers AI (ข้อ 7) แทนอัตโนมัติ · จำกัด 40 ครั้งต่อคนต่อวัน

## ทดสอบในเครื่อง (ไม่ต้องมี Google / Cloudflare)
`.test/` มีชุดทดสอบที่จำลอง Google Sheets และ Drive (อยู่ใน `.gitignore` เพราะมีข้อมูลจากแบบฟอร์มจริง)
1. รัน `powershell -File tools\serve.ps1`
2. เปิด `http://localhost:8790/.test/worker-test.html` ดูผล 54 ข้อ
3. เปิด `http://localhost:8790/.test/login.html` แล้วเข้าด้วย 1000 / `cbe@1000`
