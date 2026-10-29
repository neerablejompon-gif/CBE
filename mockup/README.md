# CBE Report Platform

ระบบรายงานผล Core Business Enablers 8 ตัวชี้วัด (เกณฑ์ SE-AM) ธีมน้ำเงิน-ขาว Glassmorphism / Liquid glass เป็นไฟล์ HTML เดียว (vanilla JS ไม่มีไลบรารีภายนอก) ใช้ได้ 2 แบบ:

- **Mockup:** เปิด `index.html` พร้อม `data.js` / `data-2570.js` ในเครื่อง เลือกบัญชีทดลองตามบทบาท การแก้ไขเก็บใน localStorage
- **ระบบจริง:** Cloudflare Pages + `_worker.js` อ่านเขียน Google Sheets ผ่าน service account ล็อกอินด้วย Cloudflare Access ดูวิธีติดตั้งใน [DEPLOY.md](DEPLOY.md)

## สิ่งที่มีในระบบ

| ส่วน | รายละเอียด |
|---|---|
| ปีบัญชี | 2570 = ปีปัจจุบัน (แบบฟอร์มใหม่) · 2569 = ปิดรอบ ดูได้อย่างเดียว |
| สิทธิ์ | กปม. (ตรวจ/อนุมัติ), ผู้บริหาร (ดูอย่างเดียว), ผู้รายงานเห็นเฉพาะตัวชี้วัดของตน · SM/CM และ KM/IM แก้ได้เฉพาะส่วนของตน |
| งานของฉัน / Dashboard | งานค้าง, คะแนนเทียบเป้า, กราฟผลสะสม, คะแนนคาดการณ์ 3 ระดับ |
| รายงานผล | ทีละขั้น: ① ความคืบหน้า (ลงผลรายเดือนอัตโนมัติจากยอดสะสม/เช็กลิสต์) ② ผลการดำเนินงาน ③ หลักฐาน + แนบไฟล์ ④ แผนปรับปรุง GAP |
| ล็อกเดือน | ผลเดือนก่อนล็อกหลังรอบรายงาน กปม. ปลดล็อกให้แก้ย้อนหลังได้รายระดับ |
| พื้นที่ผู้ตรวจสอบ | 3 ช่อง + คีย์ลัด, ตรวจสอบเบื้องต้นอัตโนมัติ (กฎ 10 ข้อ) ให้ กปม. ยืนยัน/ตัดข้อค้นพบ แล้วอนุมัติหรือส่งกลับ |
| คะแนนรวม | SCM = SM + CM และ KM&IM = KM + IM คิดแยกแต่ละส่วนแล้วรวมตามน้ำหนัก |

## ไฟล์

| ไฟล์ | หน้าที่ |
|---|---|
| `index.html` | ตัวแอปทั้งหมด |
| `_worker.js` | API ระบบจริง (Cloudflare Pages advanced mode) |
| `tools/build-new-forms.ps1` | สร้างแบบฟอร์มรูปแบบใหม่จากแบบฟอร์มเดิม |
| `tools/newforms-to-json.ps1` | แบบฟอร์มใหม่ → `data-2570.js` (สำหรับ mockup) |
| `tools/forms-to-json.ps1` | แบบฟอร์มเดิม → `data.js` (ปี 2569 + โครงสร้างตัวชี้วัด) |
| `tools/serve.ps1` | เซิร์ฟเวอร์ในเครื่อง http://localhost:8790/ |

ไฟล์ข้อมูล (`data.js`, `data-*.js`) **ไม่เก็บใน repo** เพราะมีเนื้อหารายงานจริง ระบบจริงดึงจาก Google Sheets / Drive แทน

## เปิด mockup ในเครื่อง (Windows PowerShell)

```powershell
powershell -ExecutionPolicy Bypass -File mockup\tools\forms-to-json.ps1 -Forms "<โฟลเดอร์แบบฟอร์มเดิม>" -Seed src\Seed.gs -Out mockup\data.js
powershell -ExecutionPolicy Bypass -File mockup\tools\newforms-to-json.ps1 -Dir "New Form" -Fy 2570 -Out mockup\data-2570.js
powershell -ExecutionPolicy Bypass -File mockup\tools\serve.ps1
```

## ข้อสมมติที่ต้องยืนยัน

- ปี 2570 ใช้เกณฑ์และเป้าหมาย SE-AM 2569 ไปก่อน จนกว่าคู่มือ 2570 จะออก
- แบบฟอร์ม CM ไม่มีน้ำหนักประเด็นย่อยและแผนดำเนินงาน จึงใช้น้ำหนักเฉลี่ยชั่วคราว
- ผลประเมินย้อนหลังมีเฉพาะ RM
