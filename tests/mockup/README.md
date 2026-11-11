# ทดสอบระบบ CBE Reporting (mockup/)

## 1. ทดสอบฝั่งเซิร์ฟเวอร์ (ไม่ต้องต่อเน็ต)
```bash
node tests/mockup/run-unit.js
```
| ไฟล์ | ทดสอบ |
|---|---|
| `ai_test.js` | AI ช่วยตรวจ (Workers AI จำลอง): ลายเซ็น, แคช, โควตา, แจ้ง LINE, สิทธิ์ |
| `roles_test.js` | ผู้ใช้หลายบทบาท: เลือกบทบาท, สลับ, ห้ามตรวจงานตนเอง |
| `guide_test.js` | อ่านชีตรวมผลปีก่อน (รูปแบบ CG, DT, HCM) |
| `gem_test.js` | ผู้ช่วยเขียน: Gemini จำลอง, ลองรุ่นถัดไป, สำรอง Workers AI, โควตา |

## 2. ทดสอบหน้าเว็บบนระบบจริง (Playwright)
ต้องต่อเน็ตไป https://cbe-report.pages.dev และมี Playwright (`npm i playwright`)
```bash
cd tests/mockup/live
UID_=1001 node login.js            # เข้าระบบ เก็บ session ไว้ที่ state1001.json (ไม่เข้า git)
cp state1001.json state.json
node run.js s_aiw.js               # รันสถานการณ์ด้วย session ใน state.json
```
- `UID_=1010 node run.js …` ใช้ session ของ 1010 · `VP=390x844` จอมือถือ · `NEW=1` ใช้ `index.html` ในเครื่องแทนหน้าบนเว็บ (ทดสอบก่อน deploy)
- สถานการณ์: `s_aiw.js` ผู้ช่วยเขียน (คำตอบจำลอง) · `s_aiui.js` AI ช่วยตรวจ (จำลอง) · `s_multirole.js` หลายบทบาท (1010) · `s_dash.js` Dashboard ผู้บริหาร (1020) · `s_fix1.js` ยืนยันก่อนส่งตรวจ · `s_gwhy.js` เรียกผู้ช่วยเขียนจริง 1 ครั้งและบอกว่าใช้ Gemini หรือ Workers AI (ใช้โควตาจริง)
- สคริปต์ส่วนใหญ่ดัก `/api/save` ไว้ จึงไม่บันทึกข้อมูลจริง · `s_multirole.js` ยิงคำสั่งที่เซิร์ฟเวอร์ต้องปฏิเสธ (ไม่มีข้อมูลเปลี่ยน)
- บัญชีทดสอบ: 1001 ผู้รายงาน DT · 1010 กปม. + ผู้รายงาน DT · 1020 ผู้บริหาร (รหัสผ่าน cbe@รหัส) — ลบออกจากชีต users ก่อนใช้งานจริง
