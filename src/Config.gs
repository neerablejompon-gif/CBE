/**
 * ค่าคงที่ของระบบ ค่าที่เปลี่ยนตามสภาพแวดล้อมเก็บใน Script Properties (ดู README)
 */
var APP = {
  name: 'CBE Reporting',
  sessionTtlSec: 6 * 60 * 60,
  maxLoginFail: 5,
  lockMinutes: 15,
  pwIterations: 4000,
  pwMinLength: 10,
  maxUploadBytes: 10 * 1024 * 1024,
  allowedExt: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'jpg', 'jpeg', 'png'],
  months: ['ต.ค.', 'พ.ย.', 'ธ.ค.', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.'],
  statuses: ['draft', 'submitted', 'returned', 'approved']
};

/** ตารางในสเปรดชีตฐานข้อมูล: ชื่อชีท → คอลัมน์ (แถวที่ 1 เป็นหัวตาราง) */
var TABLES = {
  users: ['id', 'email', 'name', 'role', 'enablers', 'pw_hash', 'pw_salt', 'must_change', 'active', 'failed', 'locked_until', 'created_at', 'last_login'],
  enablers: ['code', 'no', 'drive', 'name', 'en', 'owner', 'budget', 'target', 'incomplete', 'folder_id', 'report_file_id', 'sort'],
  topics: ['id', 'enabler', 'no', 'name', 'weight', 'sort'],
  subtopics: ['key', 'enabler', 'topic_id', 'no', 'name', 'weight', 'self_score', 'audit_score', 'status', 'submitted_at', 'updated_at', 'updated_by', 'folder_id', 'sort'],
  levels: ['id', 'sub_key', 'level', 'criteria', 'narrative', 'folder_id', 'updated_at', 'updated_by'],
  steps: ['id', 'sub_key', 'level', 'sort', 'gap', 'step', 'unit', 'target', 'plan', 'result', 'updated_at'],
  requirements: ['id', 'sub_key', 'level', 'sort', 'text', 'has'],
  evidence: ['id', 'sub_key', 'level', 'req_id', 'name', 'drive_id', 'mime', 'size', 'uploaded_by', 'uploaded_at', 'deleted'],
  comments: ['id', 'sub_key', 'author', 'role', 'text', 'resolved', 'created_at'],
  activities: ['id', 'sub_key', 'level', 'name', 'start', 'end', 'progress', 'output', 'created_by', 'updated_at'],
  settings: ['key', 'value'],
  audit_log: ['at', 'user', 'role', 'enabler', 'action', 'detail']
};

var DEFAULT_SETTINGS = {
  fy: '2569',
  report_month: '11',
  report_deadline: '2026-10-31',
  tl_fy: '2570',
  tl_open: '2026-10-15',
  tl_close: '2026-11-15',
  tl_from: '0',
  tl_to: '11',
  tl_locked: '[]',
  root_folder_id: '1HivoxPWFgQ3DH5ZmNOqYZshCUh59_VGN',
  source_sheet_id: '1k5D_YOgOx-e8f6QYOzUvJYsVSTRkY9388fyeI_PqrXs',
  contact: 'กองประเมินผล โทร 343'
};

function prop_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}
