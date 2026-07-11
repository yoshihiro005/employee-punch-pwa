const express = require("express");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { DatabaseSync } = require("node:sqlite");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ADMIN_PIN = process.env.ADMIN_PIN || "2468";
const DEFAULT_EXPORT_DIR = process.env.EXPORT_DIR || "C:\\勤怠CSV";
const APP_TIME_ZONE = "Asia/Tokyo";
const LEGACY_DB_PATH = path.join(__dirname, "data", "attendance.sqlite");
const DEFAULT_DATA_DIR = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "employee-punch-pwa");
const DB_PATH = process.env.DB_PATH || path.join(DEFAULT_DATA_DIR, "attendance.sqlite");
const DATA_DIR = path.dirname(DB_PATH);
const DEMO_EMPLOYEES = [
  ["1001", "山田 太郎", "1001"],
  ["1002", "佐藤 花子", "1002"],
  ["1003", "鈴木 一郎", "1003"]
];

fs.mkdirSync(DATA_DIR, { recursive: true });

function databaseSnapshot(dbPath) {
  if (!fs.existsSync(dbPath)) return { exists: false, employeeCount: 0, demoOnly: false };
  let snapshotDb;
  try {
    snapshotDb = new DatabaseSync(dbPath, { readOnly: true });
    const table = snapshotDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'employees'").get();
    if (!table) return { exists: true, employeeCount: 0, demoOnly: false };
    const employees = snapshotDb.prepare("SELECT id, name, pin FROM employees ORDER BY id").all();
    const demoOnly = employees.length === DEMO_EMPLOYEES.length
      && employees.every((employee, index) => (
        employee.id === DEMO_EMPLOYEES[index][0]
        && employee.name === DEMO_EMPLOYEES[index][1]
        && employee.pin === DEMO_EMPLOYEES[index][2]
      ));
    return { exists: true, employeeCount: employees.length, demoOnly };
  } catch (_error) {
    return { exists: true, employeeCount: 0, demoOnly: false };
  } finally {
    if (snapshotDb) snapshotDb.close();
  }
}

function preserveExistingDatabase() {
  if (DB_PATH === LEGACY_DB_PATH || !fs.existsSync(LEGACY_DB_PATH)) return;
  const current = databaseSnapshot(DB_PATH);
  const legacy = databaseSnapshot(LEGACY_DB_PATH);
  if (!current.exists) {
    fs.copyFileSync(LEGACY_DB_PATH, DB_PATH);
    return;
  }
  if (current.demoOnly && (legacy.employeeCount > current.employeeCount || !legacy.demoOnly)) {
    const backupPath = `${DB_PATH}.demo-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    fs.copyFileSync(DB_PATH, backupPath);
    fs.copyFileSync(LEGACY_DB_PATH, DB_PATH);
  }
}

preserveExistingDatabase();

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    pin TEXT NOT NULL DEFAULT '0000',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id TEXT NOT NULL,
    work_date TEXT NOT NULL,
    clock_in TEXT,
    clock_out TEXT,
    clock_in_recorded_at TEXT,
    clock_out_recorded_at TEXT,
    work_minutes INTEGER,
    prime_contractor TEXT NOT NULL DEFAULT '',
    site_name TEXT NOT NULL DEFAULT '',
    work_report TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    correction_stamp TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(employee_id, work_date),
    FOREIGN KEY(employee_id) REFERENCES employees(id)
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attendance_id INTEGER,
    employee_id TEXT NOT NULL,
    action TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT,
    changed_by TEXT NOT NULL,
    changed_at TEXT NOT NULL,
    FOREIGN KEY(attendance_id) REFERENCES attendance(id)
  );
`);

const employeeCount = db.prepare("SELECT COUNT(*) AS count FROM employees").get().count;
const employeeColumns = db.prepare("PRAGMA table_info(employees)").all().map((column) => column.name);
if (!employeeColumns.includes("pin")) {
  db.exec("ALTER TABLE employees ADD COLUMN pin TEXT NOT NULL DEFAULT '0000'");
  db.exec("UPDATE employees SET pin = id WHERE pin = '0000'");
}

if (employeeCount === 0 && process.env.SEED_DEMO_EMPLOYEES === "1") {
  const seed = db.prepare("INSERT INTO employees (id, name, pin) VALUES (?, ?, ?)");
  DEMO_EMPLOYEES.forEach(([id, name, pin]) => seed.run(id, name, pin));
}

const attendanceColumns = db.prepare("PRAGMA table_info(attendance)").all().map((column) => column.name);
if (!attendanceColumns.includes("prime_contractor")) {
  db.exec("ALTER TABLE attendance ADD COLUMN prime_contractor TEXT NOT NULL DEFAULT ''");
}
if (!attendanceColumns.includes("site_name")) {
  db.exec("ALTER TABLE attendance ADD COLUMN site_name TEXT NOT NULL DEFAULT ''");
}
if (!attendanceColumns.includes("work_report")) {
  db.exec("ALTER TABLE attendance ADD COLUMN work_report TEXT NOT NULL DEFAULT ''");
}
if (!attendanceColumns.includes("correction_stamp")) {
  db.exec("ALTER TABLE attendance ADD COLUMN correction_stamp TEXT NOT NULL DEFAULT ''");
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders(res) {
    res.setHeader("Cache-Control", "no-cache");
  }
}));

app.get("/reset-cache", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html>
<html lang="ja">
  <head><meta charset="utf-8"><title>キャッシュ削除</title></head>
  <body>
    <p>キャッシュを削除しています...</p>
    <script>
      Promise.all([
        'serviceWorker' in navigator ? navigator.serviceWorker.getRegistrations().then((items) => Promise.all(items.map((item) => item.unregister()))) : Promise.resolve(),
        'caches' in window ? caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))) : Promise.resolve()
      ]).then(() => {
        location.replace('/?cache=' + Date.now());
      });
    </script>
  </body>
</html>`);
});

function tokyoDateTimeParts(date = new Date()) {
  const values = {};
  new Intl.DateTimeFormat("ja-JP", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date).forEach((part) => {
    if (part.type !== "literal") values[part.type] = part.value;
  });
  return values;
}

function nowParts() {
  const parts = tokyoDateTimeParts();
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${parts.hour}:${parts.minute}`;
  return {
    date,
    time,
    stamp: `${date} ${time}:${parts.second}`
  };
}

function monthRange(month) {
  const match = /^(\d{4})-(\d{2})$/.exec(month || "");
  if (!match) throw new Error("月は YYYY-MM 形式で指定してください。");
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const start = new Date(year, monthIndex - 1, 21);
  const end = new Date(year, monthIndex, 20);
  return {
    start: formatDate(start),
    end: formatDate(end)
  };
}

function currentClosingRange() {
  const today = tokyoDateTimeParts();
  const year = Number(today.year);
  const month = Number(today.month) - 1;
  const day = Number(today.day);
  const start = day >= 21 ? new Date(year, month, 21) : new Date(year, month - 1, 21);
  const end = day >= 21 ? new Date(year, month + 1, 20) : new Date(year, month, 20);
  return {
    start: formatDate(start),
    end: formatDate(end)
  };
}

function dateList(start, end) {
  const dates = [];
  const current = new Date(`${start}T00:00:00`);
  const last = new Date(`${end}T00:00:00`);
  while (current <= last) {
    dates.push(formatDate(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function minutesBetween(start, end) {
  if (!start || !end) return null;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const minutes = eh * 60 + em - (sh * 60 + sm);
  return minutes >= 0 ? minutes : null;
}

function validateDailyReport(primeContractor, siteName, workReport) {
  if (!primeContractor) return "元請名を入力してください。";
  if (!siteName) return "現場名を入力してください。";
  if (!workReport) return "作業内容を入力してください。";
  if (primeContractor.length > 50) return "元請名は50文字以内で入力してください。";
  if (siteName.length > 50) return "現場名は50文字以内で入力してください。";
  if (workReport.length > 100) return "作業内容は100文字以内で入力してください。";
  return "";
}

function reportHistory(employeeId) {
  const recentValues = (column) => db.prepare(`
    SELECT ${column} AS value, MAX(COALESCE(clock_out_recorded_at, updated_at, work_date)) AS latest
    FROM attendance
    WHERE employee_id = ? AND TRIM(${column}) <> ''
    GROUP BY ${column}
    ORDER BY latest DESC
    LIMIT 5
  `).all(employeeId).map((row) => row.value);
  return {
    prime_contractors: recentValues("prime_contractor"),
    site_names: recentValues("site_name"),
    work_reports: recentValues("work_report")
  };
}

function rowStatus(row) {
  if (row.clock_in && row.clock_out) return "complete";
  if (row.clock_in && !row.clock_out) return "missing_out";
  if (!row.clock_in && row.clock_out) return "error_out_only";
  return "empty";
}

function statusLabel(status) {
  const labels = {
    complete: "完了",
    missing_out: "未退勤",
    error_out_only: "エラー（退勤のみ）",
    empty: "未入力"
  };
  return labels[status] || status;
}

function attendanceView(row) {
  if (!row) return null;
  return {
    ...row,
    status: rowStatus(row),
    work_time: row.work_minutes == null ? "" : `${Math.floor(row.work_minutes / 60)}:${String(row.work_minutes % 60).padStart(2, "0")}`
  };
}

function blankAttendance(employee, workDate) {
  return attendanceView({
    id: null,
    employee_id: employee.id,
    name: employee.name,
    work_date: workDate,
    clock_in: null,
    clock_out: null,
    clock_in_recorded_at: null,
    clock_out_recorded_at: null,
    work_minutes: null,
    prime_contractor: "",
    site_name: "",
    work_report: "",
    note: "",
    correction_stamp: "",
    created_at: null,
    updated_at: null
  });
}

function getAttendanceById(id) {
  return db.prepare(`
    SELECT a.*, e.name
    FROM attendance a
    JOIN employees e ON e.id = a.employee_id
    WHERE a.id = ?
  `).get(id);
}

function getSummary(month) {
  const range = monthRange(month);
  const rows = db.prepare(`
    SELECT
      e.id AS employee_id,
      e.name,
      COUNT(CASE WHEN a.clock_in IS NOT NULL THEN 1 END) AS work_days,
      COALESCE(SUM(CASE WHEN a.clock_in IS NOT NULL AND a.clock_out IS NOT NULL THEN a.work_minutes ELSE 0 END), 0) AS total_minutes,
      SUM(CASE WHEN a.clock_in IS NOT NULL AND a.clock_out IS NULL THEN 1 ELSE 0 END) AS missing_out_days,
      SUM(CASE WHEN a.clock_in IS NULL AND a.clock_out IS NOT NULL THEN 1 ELSE 0 END) AS error_days
    FROM employees e
    LEFT JOIN attendance a ON a.employee_id = e.id AND a.work_date BETWEEN ? AND ?
    WHERE e.active = 1
    GROUP BY e.id, e.name
    ORDER BY e.id
  `).all(range.start, range.end);
  const detailRows = db.prepare(`
    SELECT a.employee_id, e.name, a.work_date, a.clock_in, a.clock_out, a.work_minutes,
           a.prime_contractor, a.site_name, a.work_report, a.note, a.clock_in_recorded_at, a.clock_out_recorded_at
    FROM attendance a
    JOIN employees e ON e.id = a.employee_id
    WHERE a.work_date BETWEEN ? AND ?
    ORDER BY a.work_date, a.employee_id
  `).all(range.start, range.end);
  return {
    range,
    rows: rows.map((row) => ({
      ...row,
      total_time: `${Math.floor(row.total_minutes / 60)}:${String(row.total_minutes % 60).padStart(2, "0")}`
    })),
    detailRows: detailRows.map(attendanceView)
  };
}

function summaryCsv(summary) {
  const header = ["社員ID", "氏名", "集計開始日", "集計終了日", "勤務日数", "総勤務時間", "総勤務分", "未退勤日数", "エラー日数"];
  const rows = summary.rows.map((row) => [
    row.employee_id,
    row.name,
    summary.range.start,
    summary.range.end,
    row.work_days,
    row.total_time,
    row.total_minutes,
    row.missing_out_days,
    row.error_days
  ]);
  const detailHeader = ["社員ID", "氏名", "日付", "出勤時刻", "退勤時刻", "勤務時間", "元請名", "現場名", "作業内容", "備考", "出勤打刻日時", "退勤打刻日時", "状態"];
  const detailRows = summary.detailRows.map((row) => [
    row.employee_id,
    row.name,
    row.work_date,
    row.clock_in || "",
    row.clock_out || "",
    row.work_time || "",
    row.prime_contractor || "",
    row.site_name || "",
    row.work_report || "",
    row.note || "",
    row.clock_in_recorded_at || "",
    row.clock_out_recorded_at || "",
    statusLabel(row.status)
  ]);
  return [
    header,
    ...rows,
    [],
    ["日別明細"],
    detailHeader,
    ...detailRows
  ].map((cols) => cols.map(csvCell).join(",")).join("\r\n");
}

function requireAdmin(req, res, next) {
  const queryPin = typeof req.query.pin === "string" ? req.query.pin : "";
  if (req.headers["x-admin-pin"] !== ADMIN_PIN && queryPin !== ADMIN_PIN) {
    res.status(401).json({ error: "管理者PINが必要です。" });
    return;
  }
  next();
}

app.post("/api/login", (req, res) => {
  const employeeId = String(req.body.employeeId || "").trim();
  const pin = String(req.body.pin || "").trim();
  const employee = db.prepare("SELECT id, name, pin FROM employees WHERE id = ? AND active = 1").get(employeeId);
  if (!employee) {
    res.status(404).json({ error: "社員IDが見つかりません。" });
    return;
  }
  if (employee.pin !== pin) {
    res.status(401).json({ error: "社員IDまたは個人PINが違います。" });
    return;
  }
  const today = nowParts().date;
  const attendance = db.prepare("SELECT * FROM attendance WHERE employee_id = ? AND work_date = ?").get(employee.id, today);
  res.json({ employee: { id: employee.id, name: employee.name }, today, attendance: attendanceView(attendance) });
});

app.post("/api/punch", (req, res) => {
  const employeeId = String(req.body.employeeId || "").trim();
  const pin = String(req.body.pin || "").trim();
  const type = String(req.body.type || "");
  const primeContractor = String(req.body.prime_contractor || "").trim();
  const siteName = String(req.body.site_name || "").trim();
  const workReport = String(req.body.work_report || "").trim();
  const employee = db.prepare("SELECT id, name, pin FROM employees WHERE id = ? AND active = 1").get(employeeId);
  if (!employee) {
    res.status(404).json({ error: "社員IDが見つかりません。" });
    return;
  }
  if (employee.pin !== pin) {
    res.status(401).json({ error: "社員IDまたは個人PINが違います。" });
    return;
  }
  if (!["in", "out"].includes(type)) {
    res.status(400).json({ error: "打刻種別が正しくありません。" });
    return;
  }

  const now = nowParts();
  let row = db.prepare("SELECT * FROM attendance WHERE employee_id = ? AND work_date = ?").get(employeeId, now.date);

  if (type === "in") {
    if (row?.clock_in) {
      res.status(409).json({ error: "本日はすでに出勤打刻済みです。" });
      return;
    }
    if (row?.clock_out) {
      res.status(409).json({ error: "退勤のみの記録があります。管理者に修正を依頼してください。" });
      return;
    }
    if (!row) {
      db.prepare(`
        INSERT INTO attendance (employee_id, work_date, clock_in, clock_in_recorded_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(employeeId, now.date, now.time, now.stamp, now.stamp);
    }
  }

  if (type === "out") {
    const reportError = validateDailyReport(primeContractor, siteName, workReport);
    if (reportError) {
      res.status(400).json({ error: reportError });
      return;
    }
    if (!row?.clock_in) {
      res.status(409).json({ error: "出勤打刻がありません。管理者に修正を依頼してください。" });
      return;
    }
    if (row.clock_out) {
      res.status(409).json({ error: "本日はすでに退勤打刻済みです。" });
      return;
    }
    const workMinutes = minutesBetween(row.clock_in, now.time);
    db.prepare(`
      UPDATE attendance
      SET clock_out = ?, clock_out_recorded_at = ?, work_minutes = ?, prime_contractor = ?, site_name = ?, work_report = ?, updated_at = ?
      WHERE id = ?
    `).run(now.time, now.stamp, workMinutes, primeContractor, siteName, workReport, now.stamp, row.id);
  }

  row = db.prepare("SELECT * FROM attendance WHERE employee_id = ? AND work_date = ?").get(employeeId, now.date);
  db.prepare(`
    INSERT INTO audit_logs (attendance_id, employee_id, action, before_json, after_json, changed_by, changed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(row.id, employeeId, type === "in" ? "clock_in" : "clock_out", null, JSON.stringify(row), "employee", now.stamp);

  res.json({
    message: type === "in" ? "出勤を記録しました。" : "退勤を記録しました。",
    employee: { id: employee.id, name: employee.name },
    today: now.date,
    attendance: attendanceView(row)
  });
});

app.get("/api/employee/attendance", (req, res) => {
  const employeeId = String(req.query.employeeId || "").trim();
  const pin = String(req.query.pin || "").trim();
  const employee = db.prepare("SELECT id, name, pin FROM employees WHERE id = ? AND active = 1").get(employeeId);
  if (!employee) {
    res.status(404).json({ error: "社員IDが見つかりません。" });
    return;
  }
  if (employee.pin !== pin) {
    res.status(401).json({ error: "社員IDまたは個人PINが違います。" });
    return;
  }
  const defaultRange = currentClosingRange();
  const from = String(req.query.from || defaultRange.start).trim();
  const to = String(req.query.to || defaultRange.end).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    res.status(400).json({ error: "日付が正しくありません。" });
    return;
  }

  const rows = db.prepare(`
    SELECT a.*, e.name
    FROM attendance a
    JOIN employees e ON e.id = a.employee_id
    WHERE a.employee_id = ? AND a.work_date BETWEEN ? AND ?
    ORDER BY a.work_date
  `).all(employeeId, from, to);
  const byDate = new Map(rows.map((row) => [row.work_date, attendanceView(row)]));
  res.json({
    employee: { id: employee.id, name: employee.name },
    range: { start: from, end: to },
    rows: dateList(from, to).map((date) => byDate.get(date) || blankAttendance(employee, date))
  });
});

app.get("/api/report-history", (req, res) => {
  const employeeId = String(req.query.employeeId || "").trim();
  const pin = String(req.query.pin || "").trim();
  const employee = db.prepare("SELECT id, pin FROM employees WHERE id = ? AND active = 1").get(employeeId);
  if (!employee) {
    res.status(404).json({ error: "社員IDが見つかりません。" });
    return;
  }
  if (employee.pin !== pin) {
    res.status(401).json({ error: "社員IDまたは個人PINが違います。" });
    return;
  }
  res.json(reportHistory(employeeId));
});

app.put("/api/employee/attendance", (req, res) => {
  const employeeId = String(req.body.employeeId || "").trim();
  const pin = String(req.body.pin || "").trim();
  const workDate = String(req.body.work_date || "").trim();
  const clockIn = String(req.body.clock_in || "").trim() || null;
  const clockOut = String(req.body.clock_out || "").trim() || null;
  const primeContractor = String(req.body.prime_contractor || "").trim();
  const siteName = String(req.body.site_name || "").trim();
  const workReport = String(req.body.work_report || "").trim();
  const note = String(req.body.note || "").trim();
  const employee = db.prepare("SELECT id, name, pin FROM employees WHERE id = ? AND active = 1").get(employeeId);
  if (!employee || !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
    res.status(400).json({ error: "社員IDまたは日付が正しくありません。" });
    return;
  }
  if (employee.pin !== pin) {
    res.status(401).json({ error: "社員IDまたは個人PINが違います。" });
    return;
  }
  if (primeContractor.length > 50 || siteName.length > 50 || workReport.length > 100) {
    res.status(400).json({ error: "元請名と現場名は50文字以内、作業内容は100文字以内で入力してください。" });
    return;
  }
  if (!clockIn && !clockOut && !primeContractor && !siteName && !workReport && !note) {
    res.status(400).json({ error: "出勤時刻、退勤時刻、備考のいずれかを入力してください。" });
    return;
  }

  const before = db.prepare("SELECT * FROM attendance WHERE employee_id = ? AND work_date = ?").get(employeeId, workDate);
  const now = nowParts().stamp;
  const workMinutes = minutesBetween(clockIn, clockOut);
  const correctionStamp = `修正 ${now} ${employee.name}`;

  db.prepare(`
    INSERT INTO attendance (employee_id, work_date, clock_in, clock_out, work_minutes, prime_contractor, site_name, work_report, note, correction_stamp, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(employee_id, work_date) DO UPDATE SET
      clock_in = excluded.clock_in,
      clock_out = excluded.clock_out,
      work_minutes = excluded.work_minutes,
      prime_contractor = excluded.prime_contractor,
      site_name = excluded.site_name,
      work_report = excluded.work_report,
      note = excluded.note,
      correction_stamp = excluded.correction_stamp,
      updated_at = excluded.updated_at
  `).run(employeeId, workDate, clockIn, clockOut, workMinutes, primeContractor, siteName, workReport, note, correctionStamp, now);

  const row = getAttendanceById(db.prepare("SELECT id FROM attendance WHERE employee_id = ? AND work_date = ?").get(employeeId, workDate).id);
  db.prepare(`
    INSERT INTO audit_logs (attendance_id, employee_id, action, before_json, after_json, changed_by, changed_at)
    VALUES (?, ?, 'employee_correction', ?, ?, ?, ?)
  `).run(row.id, employeeId, before ? JSON.stringify(before) : null, JSON.stringify(row), employee.name, now);

  res.json({
    message: "修正を保存しました。修正印を刻印しました。",
    attendance: attendanceView(row)
  });
});

app.post("/api/admin/login", (req, res) => {
  if (String(req.body.pin || "") !== ADMIN_PIN) {
    res.status(401).json({ error: "管理者PINが違います。" });
    return;
  }
  res.json({ ok: true });
});

app.get("/api/admin/employees", requireAdmin, (_req, res) => {
  const rows = db.prepare("SELECT id, name, pin, active FROM employees ORDER BY id").all();
  res.json(rows);
});

app.post("/api/admin/employees", requireAdmin, (req, res) => {
  const id = String(req.body.id || "").trim();
  const name = String(req.body.name || "").trim();
  const pin = String(req.body.pin || "").trim();
  if (!id || !name || !pin) {
    res.status(400).json({ error: "社員ID、氏名、個人PINを入力してください。" });
    return;
  }
  db.prepare(`
    INSERT INTO employees (id, name, pin, active)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, pin = excluded.pin, active = 1
  `).run(id, name, pin);
  res.json({ id, name, pin, active: 1 });
});

app.put("/api/admin/employees/:id", requireAdmin, (req, res) => {
  const currentId = String(req.params.id || "").trim();
  const id = String(req.body.id || "").trim();
  const name = String(req.body.name || "").trim();
  const pin = String(req.body.pin || "").trim();
  const active = req.body.active ? 1 : 0;
  if (!currentId || !id || !name || !pin) {
    res.status(400).json({ error: "社員ID、氏名、個人PINを入力してください。" });
    return;
  }
  const existing = db.prepare("SELECT id FROM employees WHERE id = ?").get(currentId);
  if (!existing) {
    res.status(404).json({ error: "社員が見つかりません。" });
    return;
  }
  const duplicate = db.prepare("SELECT id FROM employees WHERE id = ? AND id <> ?").get(id, currentId);
  if (duplicate) {
    res.status(409).json({ error: "変更後の社員IDはすでに使われています。" });
    return;
  }

  db.exec("BEGIN");
  try {
    if (id !== currentId) {
      db.prepare("UPDATE employees SET id = ?, name = ?, pin = ?, active = ? WHERE id = ?").run(id, name, pin, active, currentId);
      db.prepare("UPDATE attendance SET employee_id = ? WHERE employee_id = ?").run(id, currentId);
      db.prepare("UPDATE audit_logs SET employee_id = ? WHERE employee_id = ?").run(id, currentId);
    } else {
      db.prepare("UPDATE employees SET name = ?, pin = ?, active = ? WHERE id = ?").run(name, pin, active, currentId);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    res.status(500).json({ error: `社員情報の更新に失敗しました: ${error.message}` });
    return;
  }

  res.json({ id, name, pin, active });
});

app.get("/api/admin/attendance", requireAdmin, (req, res) => {
  const employeeId = String(req.query.employeeId || "").trim();
  const from = String(req.query.from || "").trim();
  const to = String(req.query.to || "").trim();
  const params = [];
  const where = [];
  if (employeeId) {
    where.push("a.employee_id = ?");
    params.push(employeeId);
  }
  if (from) {
    where.push("a.work_date >= ?");
    params.push(from);
  }
  if (to) {
    where.push("a.work_date <= ?");
    params.push(to);
  }
  const sql = `
    SELECT a.*, e.name
    FROM attendance a
    JOIN employees e ON e.id = a.employee_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY a.work_date DESC, a.employee_id
    LIMIT 500
  `;
  res.json(db.prepare(sql).all(...params).map(attendanceView));
});

app.put("/api/admin/attendance/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const before = getAttendanceById(id);
  if (!before) {
    res.status(404).json({ error: "打刻データが見つかりません。" });
    return;
  }
  const clockIn = String(req.body.clock_in || "").trim() || null;
  const clockOut = String(req.body.clock_out || "").trim() || null;
  const primeContractor = String(req.body.prime_contractor || "").trim();
  const siteName = String(req.body.site_name || "").trim();
  const workReport = String(req.body.work_report || "").trim();
  const note = String(req.body.note || "").trim();
  if (primeContractor.length > 50 || siteName.length > 50 || workReport.length > 100) {
    res.status(400).json({ error: "元請名と現場名は50文字以内、作業内容は100文字以内で入力してください。" });
    return;
  }
  const now = nowParts().stamp;
  const workMinutes = minutesBetween(clockIn, clockOut);
  const correctionStamp = `修正 ${now} 管理者`;
  db.prepare(`
    UPDATE attendance
    SET clock_in = ?, clock_out = ?, work_minutes = ?, prime_contractor = ?, site_name = ?, work_report = ?, note = ?, correction_stamp = ?, updated_at = ?
    WHERE id = ?
  `).run(clockIn, clockOut, workMinutes, primeContractor, siteName, workReport, note, correctionStamp, now, id);
  const after = getAttendanceById(id);
  db.prepare(`
    INSERT INTO audit_logs (attendance_id, employee_id, action, before_json, after_json, changed_by, changed_at)
    VALUES (?, ?, 'admin_update', ?, ?, 'admin', ?)
  `).run(id, before.employee_id, JSON.stringify(before), JSON.stringify(after), now);
  res.json(attendanceView(after));
});

app.post("/api/admin/attendance", requireAdmin, (req, res) => {
  const employeeId = String(req.body.employee_id || "").trim();
  const workDate = String(req.body.work_date || "").trim();
  const clockIn = String(req.body.clock_in || "").trim() || null;
  const clockOut = String(req.body.clock_out || "").trim() || null;
  const primeContractor = String(req.body.prime_contractor || "").trim();
  const siteName = String(req.body.site_name || "").trim();
  const workReport = String(req.body.work_report || "").trim();
  const note = String(req.body.note || "").trim();
  const employee = db.prepare("SELECT id FROM employees WHERE id = ?").get(employeeId);
  if (!employee || !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
    res.status(400).json({ error: "社員IDまたは日付が正しくありません。" });
    return;
  }
  if (primeContractor.length > 50 || siteName.length > 50 || workReport.length > 100) {
    res.status(400).json({ error: "元請名と現場名は50文字以内、作業内容は100文字以内で入力してください。" });
    return;
  }
  const now = nowParts().stamp;
  const workMinutes = minutesBetween(clockIn, clockOut);
  const correctionStamp = `修正 ${now} 管理者`;
  db.prepare(`
    INSERT INTO attendance (employee_id, work_date, clock_in, clock_out, work_minutes, prime_contractor, site_name, work_report, note, correction_stamp, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(employee_id, work_date) DO UPDATE SET
      clock_in = excluded.clock_in,
      clock_out = excluded.clock_out,
      work_minutes = excluded.work_minutes,
      prime_contractor = excluded.prime_contractor,
      site_name = excluded.site_name,
      work_report = excluded.work_report,
      note = excluded.note,
      correction_stamp = excluded.correction_stamp,
      updated_at = excluded.updated_at
  `).run(employeeId, workDate, clockIn, clockOut, workMinutes, primeContractor, siteName, workReport, note, correctionStamp, now);
  const row = db.prepare("SELECT id FROM attendance WHERE employee_id = ? AND work_date = ?").get(employeeId, workDate);
  const after = getAttendanceById(row.id);
  db.prepare(`
    INSERT INTO audit_logs (attendance_id, employee_id, action, before_json, after_json, changed_by, changed_at)
    VALUES (?, ?, 'admin_create_or_replace', NULL, ?, 'admin', ?)
  `).run(row.id, employeeId, JSON.stringify(after), now);
  res.json(attendanceView(after));
});

app.get("/api/admin/summary", requireAdmin, (req, res) => {
  try {
    res.json(getSummary(String(req.query.month || "")));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/admin/summary.csv", requireAdmin, (req, res) => {
  const month = String(req.query.month || "").trim();
  try {
    const summary = getSummary(month);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=attendance-summary-${month}.csv`);
    res.send(`\uFEFF${summaryCsv(summary)}`);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/admin/summary/save", requireAdmin, (req, res) => {
  const folderPath = String(req.body.folderPath || DEFAULT_EXPORT_DIR).trim();
  const month = String(req.body.month || "").trim();
  if (!folderPath) {
    res.status(400).json({ error: "保存先フォルダを入力してください。" });
    return;
  }
  const targetDir = path.isAbsolute(folderPath)
    ? folderPath
    : path.resolve(__dirname, folderPath);

  let summary;
  try {
    summary = getSummary(month);
  } catch (error) {
    res.status(400).json({ error: error.message });
    return;
  }

  try {
    fs.mkdirSync(targetDir, { recursive: true });
    const filename = `attendance-summary-${month}.csv`;
    const filePath = path.join(targetDir, filename);
    fs.writeFileSync(filePath, `\uFEFF${summaryCsv(summary)}`, "utf8");
    res.json({ ok: true, filePath, filename, range: summary.range });
  } catch (error) {
    res.status(500).json({ error: `CSV保存に失敗しました: ${error.message}` });
    return;
  }
});

app.get("/api/admin/audit/:attendanceId", requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT *
    FROM audit_logs
    WHERE attendance_id = ?
    ORDER BY changed_at DESC, id DESC
  `).all(Number(req.params.attendanceId));
  res.json(rows);
});

app.get("/api/admin/export.csv", requireAdmin, (req, res) => {
  const employeeId = String(req.query.employeeId || "").trim();
  const from = String(req.query.from || "").trim();
  const to = String(req.query.to || "").trim();
  const params = [];
  const where = [];
  if (employeeId) {
    where.push("a.employee_id = ?");
    params.push(employeeId);
  }
  if (from) {
    where.push("a.work_date >= ?");
    params.push(from);
  }
  if (to) {
    where.push("a.work_date <= ?");
    params.push(to);
  }
  const rows = db.prepare(`
    SELECT a.employee_id, e.name, a.work_date, a.clock_in, a.clock_out, a.work_minutes,
           a.prime_contractor, a.site_name, a.work_report, a.note, a.clock_in_recorded_at, a.clock_out_recorded_at
    FROM attendance a
    JOIN employees e ON e.id = a.employee_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY a.work_date, a.employee_id
  `).all(...params);
  const header = ["社員ID", "氏名", "日付", "出勤時刻", "退勤時刻", "勤務時間", "元請名", "現場名", "作業内容", "備考", "出勤打刻日時", "退勤打刻日時", "状態"];
  const csv = [header, ...rows.map((row) => [
    row.employee_id,
    row.name,
    row.work_date,
    row.clock_in || "",
    row.clock_out || "",
    row.work_minutes == null ? "" : `${Math.floor(row.work_minutes / 60)}:${String(row.work_minutes % 60).padStart(2, "0")}`,
    row.prime_contractor || "",
    row.site_name || "",
    row.work_report || "",
    row.note || "",
    row.clock_in_recorded_at || "",
    row.clock_out_recorded_at || "",
    statusLabel(rowStatus(row))
  ])].map((cols) => cols.map(csvCell).join(",")).join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=attendance.csv");
  res.send(`\uFEFF${csv}`);
});

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Attendance PWA running at http://localhost:${PORT}`);
  console.log(`Admin PIN: ${ADMIN_PIN}`);
});
