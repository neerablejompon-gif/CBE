# ติดตั้งระบบจริง: Cloudflare Pages + Google Sheets (Service Account)

```
ผู้ใช้ → Cloudflare Access (ล็อกอินอีเมลองค์กร)
      → Cloudflare Pages: index.html + _worker.js
      → _worker.js ──service account──→ Google Sheets (แบบฟอร์ม 10 ไฟล์ + ชีตระบบ) / Google Drive (ไฟล์หลักฐาน)
```

- **ชีตแบบฟอร์ม (10 ไฟล์):** เป็นฐานข้อมูลเกณฑ์ แผน และเป้าหมาย ระบบเขียนผลรายเดือน ผลการดำเนินงาน และหลักฐานกลับลงฟอร์มให้อัตโนมัติ
- **ชีตระบบ "CBE System":** เก็บผู้ใช้/สิทธิ์ สถานะการส่งตรวจ ข้อมูลทุกช่องที่แก้ในระบบ และ Audit trail
- **ใช้ระบบเป็นช่องทางแก้หลัก:** ถ้าแก้ในชีตแบบฟอร์มโดยตรง ระดับที่เคยบันทึกผ่านระบบแล้วจะยังแสดงค่าจากระบบ

## 1. Google Cloud: สร้าง Service Account
1. เปิด https://console.cloud.google.com แล้วสร้างโปรเจกต์ใหม่ เช่น `cbe-report`
2. ไปที่ **APIs & Services → Library** แล้วเปิด **Google Sheets API** และ **Google Drive API**
3. ไปที่ **IAM & Admin → Service Accounts → Create service account** ตั้งชื่อเช่น `cbe-worker` ไม่ต้องให้ role ใด ๆ
4. เปิด service account ที่สร้าง แล้วไปที่ **Keys → Add key → JSON** ระบบจะดาวน์โหลดไฟล์กุญแจลงเครื่อง
   - เก็บไฟล์นี้เป็นความลับ ห้ามใส่ใน GitHub ห้ามส่งทางแชต
   - ถ้าองค์กรบล็อกการสร้างกุญแจ (`iam.disableServiceAccountKeyCreation`) ต้องให้ผู้ดูแล Google Cloud ขององค์กรอนุญาตก่อน
5. จดอีเมลของ service account ไว้ใช้ในขั้นถัดไป หน้าตาแบบ `cbe-worker@cbe-report.iam.gserviceaccount.com`

## 2. Google Drive: เตรียมชีต
1. **แปลงแบบฟอร์มเป็น Google Sheets:** อัปโหลด `New Form/*.xlsx` ทั้ง 10 ไฟล์ขึ้น Drive แล้วเปิดแต่ละไฟล์ เลือก **ไฟล์ → บันทึกเป็น Google ชีต**
   - ใช้ไฟล์ Google ชีตที่ได้ ไม่ใช่ .xlsx เดิม
   - ห้ามเปลี่ยนชื่อแท็บ `1.สรุปรายงานผู้บริหาร` และ `2.ผลตามเกณฑ์และ GAP`
2. **สร้าง Google ชีตใหม่ชื่อ "CBE System"** มี 4 แท็บ แถวที่ 1 เป็นหัวตาราง:

   | แท็บ | หัวตาราง (A, B, C, …) | ใส่อะไร |
   |---|---|---|
   | `users` | email · role · ind · part · name | หนึ่งแถวต่อผู้ใช้ |
   | `forms` | fy · code · id | หนึ่งแถวต่อแบบฟอร์ม |
   | `state` | fy · store · key · value · by · at | เว้นว่าง ระบบเขียนเอง |
   | `log` | at · email · who · what | เว้นว่าง ระบบเขียนเอง |

   **แท็บ `users`**
   - **role:** `audit` (กปม.), `exec` (ผู้บริหาร) หรือ `reporter`
   - **ind (เฉพาะ reporter):** `CG` `SP` `RM` `SCM` `DT` `HCM` `KMIM` `IA`
   - **part:** ใส่เฉพาะผู้รายงานรายส่วน คือ `SM` `CM` (ของ SCM) หรือ `KM` `IM` (ของ KMIM) ถ้าเว้นว่างจะแก้ได้ทั้งตัวชี้วัด

   ```
   email                     role      ind   part  name
   auditor@org.go.th         audit                 กปม.
   ceo@org.go.th             exec                  ผู้บริหาร
   sm.owner@org.go.th        reporter  SCM   SM    ผู้รายงาน SM
   rm.owner@org.go.th        reporter  RM          ผู้รายงาน RM
   ```

   **แท็บ `forms`**
   - **id:** รหัสชีตในลิงก์ `docs.google.com/spreadsheets/d/<id>/edit`
   - **code:** `CG` `SP` `RM` `SM` `CM` `DT` `HCM` `KM` `IM` `IA` (10 แถว ใส่ fy เป็น `2570`)
   - **แถวที่ 11 สำหรับปี 2569:** fy เว้นว่าง code = `ARCHIVE` id = รหัสไฟล์ `data.js` ใน Drive
     - สร้าง `data.js` ด้วย `tools/forms-to-json.ps1` (ใส่ `-KeepNames` ถ้าต้องการชื่อจริง) แล้วอัปโหลดขึ้น Drive
     - รหัสไฟล์คือส่วน `<id>` ในลิงก์ `drive.google.com/file/d/<id>/view`
3. **แชร์ทุกไฟล์ให้อีเมล service account:**
   - ชีตแบบฟอร์ม 10 ไฟล์ และ CBE System: สิทธิ์ **ผู้แก้ไข**
   - `data.js`: สิทธิ์ **ผู้มีสิทธิ์อ่าน**
4. **โฟลเดอร์ไฟล์หลักฐาน (ไม่บังคับ):** ต้องเป็น **ไดรฟ์ที่แชร์ (Shared Drive)** ของ Google Workspace เพราะ service account ไม่มีพื้นที่เก็บไฟล์ของตัวเอง
   - เพิ่ม service account เป็น **ผู้จัดการเนื้อหา** ของไดรฟ์นั้น แล้วจดรหัสโฟลเดอร์ไว้
   - ถ้าไม่ตั้งค่าส่วนนี้ ปุ่มแนบไฟล์จะแจ้งว่ายังไม่ได้ตั้งค่า แต่ส่วนอื่นใช้งานได้ตามปกติ

## 3. Cloudflare Pages: ขึ้นเว็บ
1. push โฟลเดอร์ `mockup/` ขึ้น GitHub
   - `.gitignore` กันไฟล์ข้อมูลไว้แล้ว ระบบจริงดึงข้อมูลจากชีต ไม่ใช้ไฟล์ข้อมูลใน repo
2. ไปที่ Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** แล้วเลือก repo
   - **Build command:** เว้นว่าง
   - **Build output directory:** `mockup`
3. ไปที่ **Settings → Variables and Secrets (Production)** แล้วเพิ่ม:

   | ชื่อ | ชนิด | ค่า |
   |---|---|---|
   | `GOOGLE_SA` | **Secret** | วางเนื้อหาไฟล์กุญแจ JSON ทั้งไฟล์ |
   | `SYSTEM_SHEET_ID` | Text | รหัสชีต CBE System |
   | `ACCESS_TEAM` | Text | ชื่อทีม Zero Trust (ส่วนหน้า `.cloudflareaccess.com`) |
   | `ACCESS_AUD` | Text | AUD tag จากขั้นที่ 4 |
   | `FILES_FOLDER_ID` | Text | รหัสโฟลเดอร์หลักฐาน (ไม่บังคับ) |
   | `CUR_FY` | Text | `2570` |

4. กด **Retry deployment** ให้ค่าใหม่มีผล

## 4. Cloudflare Access: จำกัดคนเข้า
1. ไปที่ **Zero Trust → Access → Applications → Add an application → Self-hosted**
2. ใส่โดเมนของเว็บ เช่น `cbe-report.pages.dev` (และโดเมนองค์กร ถ้าผูกไว้)
3. ตั้ง **Policy = Allow** ให้เฉพาะ **Emails ending in** `@org.go.th` หรือรายชื่ออีเมล
   - วิธีล็อกอินใช้ One-time PIN ทางอีเมล หรือ Google / Microsoft ขององค์กรก็ได้
4. บันทึก แล้วคัดลอก **Application Audience (AUD) Tag** ไปใส่ `ACCESS_AUD`

Worker ตรวจลายเซ็น JWT ของ Access ทุกคำขอข้อมูล ถ้าไม่มีหรือปลอมมา ระบบจะไม่ส่งข้อมูลให้ จากนั้นสิทธิ์ทั้งหมดตรวจที่เซิร์ฟเวอร์ตามแท็บ `users`:
- ผู้รายงานเห็นเฉพาะตัวชี้วัดของตน และแก้ได้เฉพาะส่วนของตน
- แก้ได้เฉพาะตอนสถานะเป็นร่างหรือถูกส่งกลับ
- ผลเดือนก่อนแก้ได้ถึงวันที่ 10 ของเดือนถัดไป หลังจากนั้นต้องให้ กปม. ปลดล็อก
- ผู้บริหารดูได้อย่างเดียว

## 5. ตรวจหลังติดตั้ง
- **ทดสอบแต่ละบทบาท:** เข้าด้วยบัญชี กปม. ผู้บริหาร และผู้รายงาน ต้องเห็นเมนูตามสิทธิ์
- **ทดสอบการบันทึก:** ให้ผู้รายงานกรอกผล 1 ช่อง แล้วดูแท็บ `state` และ `log` ใน CBE System กับแถวผลในชีตแบบฟอร์ม ต้องมีข้อมูลเข้า
- **ถ้าเปิดแล้วขึ้น "บัญชี … ยังไม่ได้รับสิทธิ์":** เพิ่มอีเมลนั้นในแท็บ `users` แล้วรอไม่เกิน 1 นาที ระบบแคชรายชื่อไว้ 60 วินาที
- **ถ้าขึ้น error 1102 (Worker exceeded resource limits):** แพ็กเกจฟรีให้ CPU 10ms ต่อคำขอ ให้เปลี่ยนเป็น Workers Paid ($5/เดือน)

## ทดสอบในเครื่อง (ไม่ต้องมี Google / Cloudflare)
`.test/` มีชุดทดสอบที่จำลอง Google Sheets, Drive และ Access (อยู่ใน `.gitignore` เพราะมีข้อมูลจากแบบฟอร์มจริง)
1. รัน `powershell -File tools\serve.ps1`
2. เปิด `http://localhost:8790/.test/worker-test.html` ดูผล 44 ข้อ
3. เปิด `http://localhost:8790/.test/login.html?email=sm@x.go.th` เพื่อลองหน้าเว็บจริงในบทบาทผู้รายงาน SM
