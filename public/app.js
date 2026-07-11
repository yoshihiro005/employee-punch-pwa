const state = {
  employee: null,
  employeePin: "",
  adminPin: "",
  employees: [],
  attendance: null,
  testWorkDate: "",
  reportHistory: { prime_contractors: [], site_names: [], work_reports: [] },
  statusObserver: null,
  deferredInstallPrompt: null
};
const DEFAULT_SUMMARY_FOLDER = "C:\\勤怠CSV";

const $ = (id) => document.getElementById(id);
const views = ["loginView", "employeeView", "adminLoginView", "adminView"];

function showView(id) {
  views.forEach((view) => $(view).classList.toggle("is-hidden", view !== id));
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.adminPin) headers["x-admin-pin"] = state.adminPin;
  const response = await fetch(path, { ...options, headers });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) throw new Error(data.error || "通信に失敗しました。");
  return data;
}

function todayLabel(dateText) {
  const date = dateText ? new Date(`${dateText}T00:00:00`) : new Date();
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long"
  }).format(date);
}

function updateClock() {
  $("clockText").textContent = new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date());
}

function deviceInfo() {
  const ua = navigator.userAgent || "";
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isChrome = /Chrome|CriOS/i.test(ua) && !/Edg|OPR|SamsungBrowser/i.test(ua);
  const isLine = /Line\//i.test(ua) || /NAVER\(inapp/i.test(ua);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  return { isAndroid, isIOS, isChrome, isLine, isStandalone };
}

function installGuideHtml() {
  const info = deviceInfo();
  if (info.isStandalone) {
    return `
      <div class="install-guide-head">
        <span class="install-guide-icon">📱</span>
        <h2>ホーム画面に追加済みです</h2>
      </div>
      <p class="install-lead">このままアプリとして使えます。</p>
    `;
  }
  return `
    <div class="install-guide-head">
      <span class="install-guide-icon">📱</span>
      <h2>ホーム画面に追加する方法</h2>
    </div>

    <p class="install-line-note">※LINEから開いている場合は、先に右上のメニューから「Safariで開く」または「Chromeで開く」を選んでください。LINEの画面のままでは追加できません。</p>

    <section class="install-guide-section">
      <h3>【iPhone】</h3>
      <ol class="install-steps">
        <li><span>①</span><p>右下（または下中央）の「共有」ボタン（□から↑が出ているマーク）を押します。</p></li>
        <li><span>②</span><p>「ホーム画面に追加」を選びます。</p></li>
        <li><span>③</span><p>右上の「追加」を押します。</p></li>
      </ol>
    </section>

    <section class="install-guide-section">
      <h3>【Android】</h3>
      <ol class="install-steps">
        <li><span>①</span><p>Chromeで開き、画面右上の「︙」メニューを押します。</p></li>
        <li><span>②</span><p>メニューの中から「ホーム画面に追加」または「アプリをインストール」を探して押します。</p></li>
        <li><span>③</span><p>確認画面が出たら「追加」または「インストール」を押します。</p></li>
      </ol>
    </section>

    <p class="install-lead">ホーム画面にアイコンを追加すると、次回からはアプリのようにワンタップで勤怠を開けます。</p>
  `;
}

function showInstallGuide(message = "") {
  const guide = $("installGuide");
  guide.innerHTML = `${message ? `<p>${escapeHtml(message)}</p>` : ""}${installGuideHtml()}`;
  guide.classList.remove("is-hidden");
}

function updateInstallButton() {
  const info = deviceInfo();
  const button = $("installAppButton");
  if (info.isStandalone) {
    button.textContent = "ホーム画面に追加済み";
    button.disabled = true;
    return;
  }
  button.disabled = false;
  button.textContent = state.deferredInstallPrompt && info.isAndroid ? "アプリをインストール" : "スマホに追加";
}

async function handleInstallClick() {
  const info = deviceInfo();
  if (info.isLine || info.isIOS || !state.deferredInstallPrompt) {
    showInstallGuide();
    return;
  }
  state.deferredInstallPrompt.prompt();
  const choice = await state.deferredInstallPrompt.userChoice;
  state.deferredInstallPrompt = null;
  updateInstallButton();
  if (choice.outcome === "accepted") {
    showInstallGuide("インストールを開始しました。");
  } else {
    showInstallGuide("インストールをキャンセルしました。必要な時にもう一度押してください。");
  }
}

function setMessage(text, isError = false) {
  const box = $("messageBox");
  box.textContent = text;
  box.classList.toggle("error", isError);
  box.classList.remove("is-hidden");
}

function historyOptionsHtml(items) {
  return (items || []).map((item) => `<option value="${escapeHtml(item)}"></option>`).join("");
}

function historyButtonsHtml(items, targetId) {
  if (!items?.length) return '<span class="history-chip-empty">過去の候補はまだありません</span>';
  return items.map((item) => `
    <button class="history-chip" type="button" data-report-history-target="${targetId}" data-report-history-value="${escapeHtml(item)}">
      ${escapeHtml(item)}
    </button>
  `).join("");
}

function renderReportHistoryOptions() {
  $("primeContractorHistory").innerHTML = historyOptionsHtml(state.reportHistory.prime_contractors);
  $("siteNameHistory").innerHTML = historyOptionsHtml(state.reportHistory.site_names);
  $("workReportHistory").innerHTML = historyOptionsHtml(state.reportHistory.work_reports);
  $("primeContractorHistoryButtons").innerHTML = historyButtonsHtml(state.reportHistory.prime_contractors, "dailyPrimeContractor");
  $("siteNameHistoryButtons").innerHTML = historyButtonsHtml(state.reportHistory.site_names, "dailySiteName");
  $("workReportHistoryButtons").innerHTML = historyButtonsHtml(state.reportHistory.work_reports, "dailyWorkReport");
}

async function loadReportHistory() {
  if (!state.employee) return;
  state.reportHistory = await api(`/api/report-history?employeeId=${encodeURIComponent(state.employee.id)}&pin=${encodeURIComponent(state.employeePin)}`);
  renderReportHistoryOptions();
}

function renderEmployee() {
  const attendance = state.attendance || {};
  const needsDailyReport = Boolean(attendance.clock_in) && !attendance.clock_out;
  $("employeeName").textContent = `${state.employee.name} さん`;
  $("todayText").textContent = todayLabel(attendance.work_date);
  $("testWorkDate").value = attendance.work_date || state.testWorkDate || "";
  $("statusIn").textContent = attendance.clock_in || "未打刻";
  $("statusOut").textContent = attendance.clock_out || "未打刻";
  $("statusWork").textContent = attendance.work_time || "-";
  $("statusPrimeContractor").textContent = attendance.prime_contractor || "-";
  $("statusSite").textContent = attendance.site_name || "-";
  $("statusReport").textContent = attendance.work_report || "-";
  $("clockInButton").disabled = Boolean(attendance.clock_in);
  $("clockOutButton").disabled = !attendance.clock_in || Boolean(attendance.clock_out);
  $("dailyReportForm").classList.toggle("is-hidden", !needsDailyReport);
  $("dailyReportForm").classList.remove("needs-attention");
  if (needsDailyReport) {
    $("dailyPrimeContractor").value = attendance.prime_contractor || "";
    $("dailySiteName").value = attendance.site_name || "";
    $("dailyWorkReport").value = attendance.work_report || "";
    updateDailyReportCount();
  }
}

async function loginEmployee(employeeId, pin, remember = true) {
  const data = await api("/api/login", {
    method: "POST",
    body: JSON.stringify({ employeeId, pin })
  });
  state.employee = data.employee;
  state.employeePin = pin;
  state.attendance = data.attendance || { work_date: data.today };
  state.testWorkDate = state.attendance.work_date || data.today;
  if (remember) {
    localStorage.setItem("rememberedEmployeeId", employeeId);
    localStorage.setItem("rememberedEmployeePin", pin);
  }
  renderEmployee();
  await loadReportHistory();
  await loadEmployeeMonth();
  updateClock();
  showView("employeeView");
}

async function punch(type, extra = {}) {
  try {
    const data = await api("/api/punch", {
      method: "POST",
      body: JSON.stringify({ employeeId: state.employee.id, pin: state.employeePin, type, test_work_date: state.testWorkDate, ...extra })
    });
    state.attendance = data.attendance;
    renderEmployee();
    await loadEmployeeMonth();
    if (type === "out") await loadReportHistory();
    setMessage(data.message);
  } catch (error) {
    setMessage(error.message, true);
  }
}

async function loadEmployeeDay(workDate) {
  if (!state.employee || !workDate) return;
  const data = await api(`/api/employee/attendance?employeeId=${encodeURIComponent(state.employee.id)}&pin=${encodeURIComponent(state.employeePin)}&from=${workDate}&to=${workDate}`);
  state.testWorkDate = workDate;
  state.attendance = data.rows[0] || { work_date: workDate };
  renderEmployee();
  setMessage(`テスト用の日付を ${workDate} に変更しました。`);
}

function showDailyReportForm() {
  $("dailyPrimeContractor").value = state.attendance?.prime_contractor || "";
  $("dailySiteName").value = state.attendance?.site_name || "";
  $("dailyWorkReport").value = state.attendance?.work_report || "";
  updateDailyReportCount();
  $("dailyReportForm").classList.remove("is-hidden");
  setMessage("下の黄色い枠「退勤前にここへ入力」に、元請名・現場名・作業内容を入力してください。");
  $("dailyReportForm").scrollIntoView({ behavior: "smooth", block: "center" });
  $("dailyPrimeContractor").focus();
}

function updateDailyReportCount() {
  $("dailyReportCount").textContent = `${$("dailyWorkReport").value.length} / 100文字`;
}

async function submitDailyReport(event) {
  event.preventDefault();
  const primeContractor = $("dailyPrimeContractor").value.trim();
  const siteName = $("dailySiteName").value.trim();
  const workReport = $("dailyWorkReport").value.trim();
  if (!primeContractor) {
    setMessage("黄色い枠の中の「元請名」欄に、今日の元請名を入力してください。", true);
    $("dailyReportForm").classList.add("needs-attention");
    $("dailyPrimeContractor").focus();
    $("dailyReportForm").scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  if (!siteName) {
    setMessage("黄色い枠の中の「現場名」欄に、今日の現場名を入力してください。", true);
    $("dailyReportForm").classList.add("needs-attention");
    $("dailySiteName").focus();
    $("dailyReportForm").scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  if (!workReport) {
    setMessage("黄色い枠の中の「作業内容」欄に、今日の作業内容を100文字以内で入力してください。", true);
    $("dailyReportForm").classList.add("needs-attention");
    $("dailyWorkReport").focus();
    $("dailyReportForm").scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  if (primeContractor.length > 50 || siteName.length > 50) {
    setMessage("元請名と現場名は50文字以内で入力してください。", true);
    $("dailyReportForm").classList.add("needs-attention");
    $("dailyReportForm").scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  if (workReport.length > 100) {
    setMessage("作業内容は100文字以内で入力してください。", true);
    $("dailyReportForm").classList.add("needs-attention");
    $("dailyWorkReport").focus();
    $("dailyReportForm").scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  $("dailyReportForm").classList.remove("needs-attention");
  await punch("out", { prime_contractor: primeContractor, site_name: siteName, work_report: workReport });
}

function statusBadge(status) {
  if (status === "complete") return '<span class="badge">完了</span>';
  if (status === "missing_out") return '<span class="badge warn">未退勤</span>';
  if (status === "error_out_only") return '<span class="badge error">エラー</span>';
  return '<span class="badge">未入力</span>';
}

function setActiveStatusEmployee(employeeId) {
  document.querySelectorAll(".employee-name-tab").forEach((button) => {
    const active = button.dataset.statusTarget === employeeId;
    button.classList.toggle("is-active", active);
    if (active) button.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  });
}

function closingRangeFor(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  const start = day >= 21 ? new Date(year, month, 21) : new Date(year, month - 1, 21);
  const end = day >= 21 ? new Date(year, month + 1, 20) : new Date(year, month, 20);
  return { start: formatDateInput(start), end: formatDateInput(end) };
}

function formatDateInput(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function loadEmployeeMonth() {
  if (!state.employee) return;
  const range = closingRangeFor();
  const data = await api(`/api/employee/attendance?employeeId=${encodeURIComponent(state.employee.id)}&pin=${encodeURIComponent(state.employeePin)}&from=${range.start}&to=${range.end}`);
  $("employeeMonthRange").textContent = `${data.range.start} 〜 ${data.range.end}`;
  $("employeeMonthList").innerHTML = data.rows.map(employeeMonthRowHtml).join("");
}

function employeeMonthRowHtml(row) {
  return `
    <article class="employee-month-item" data-employee-date="${escapeHtml(row.work_date)}">
      <div class="employee-month-head">
        <strong>${escapeHtml(row.work_date)}</strong>
        ${statusBadge(row.status)}
      </div>
      <div class="meta-grid">
        <span>出勤: ${escapeHtml(row.clock_in || "-")}</span>
        <span>退勤: ${escapeHtml(row.clock_out || "-")}</span>
        <span>勤務: ${escapeHtml(row.work_time || "-")}</span>
        <span>元請名: ${escapeHtml(row.prime_contractor || "-")}</span>
        <span>現場名: ${escapeHtml(row.site_name || "-")}</span>
        <span>作業内容: ${escapeHtml(row.work_report || "-")}</span>
        <span>備考: ${escapeHtml(row.note || "-")}</span>
      </div>
      ${row.correction_stamp ? `<div class="correction-stamp">${escapeHtml(row.correction_stamp)}</div>` : ""}
      <form class="employee-edit-grid" data-employee-correction="${escapeHtml(row.work_date)}">
        <label>出勤<input type="time" name="clock_in" value="${escapeHtml(row.clock_in || "")}"></label>
        <label>退勤<input type="time" name="clock_out" value="${escapeHtml(row.clock_out || "")}"></label>
        <label>元請名<input type="text" name="prime_contractor" maxlength="50" list="primeContractorHistory" value="${escapeHtml(row.prime_contractor || "")}"></label>
        <label>現場名<input type="text" name="site_name" maxlength="50" list="siteNameHistory" value="${escapeHtml(row.site_name || "")}"></label>
        <label>作業内容<input type="text" name="work_report" maxlength="100" list="workReportHistory" value="${escapeHtml(row.work_report || "")}"></label>
        <label>備考<input type="text" name="note" value="${escapeHtml(row.note || "")}" placeholder="押し忘れ等"></label>
        <button class="small-button" type="submit">修正保存</button>
      </form>
    </article>
  `;
}

async function saveEmployeeCorrection(form) {
  const workDate = form.dataset.employeeCorrection;
  const payload = {
    employeeId: state.employee.id,
    pin: state.employeePin,
    work_date: workDate,
    clock_in: form.elements.clock_in.value,
    clock_out: form.elements.clock_out.value,
    prime_contractor: form.elements.prime_contractor.value,
    site_name: form.elements.site_name.value,
    work_report: form.elements.work_report.value,
    note: form.elements.note.value
  };
  try {
    const result = await api("/api/employee/attendance", {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    if (workDate === state.attendance?.work_date) {
      state.attendance = result.attendance;
      renderEmployee();
    }
    await loadEmployeeMonth();
    await loadReportHistory();
    setMessage(result.message);
  } catch (error) {
    setMessage(error.message, true);
  }
}

async function loadEmployees() {
  state.employees = await api("/api/admin/employees");
  $("employeeList").innerHTML = state.employees.map((employee) => `
    <article class="list-item">
      <form class="employee-manage-form" data-employee-edit="${escapeHtml(employee.id)}">
        <label>社員ID<input name="id" value="${escapeHtml(employee.id)}" required></label>
        <label>氏名<input name="name" value="${escapeHtml(employee.name)}" required></label>
        <label>個人PIN<input name="pin" inputmode="numeric" value="${escapeHtml(employee.pin)}" required></label>
        <label class="check-row">
          <input name="active" type="checkbox" ${employee.active ? "checked" : ""}>
          <span>有効</span>
        </label>
        <button type="submit">保存</button>
      </form>
    </article>
  `).join("");
  const options = ['<option value="">全社員</option>', ...state.employees.map((employee) => (
    `<option value="${escapeHtml(employee.id)}">${escapeHtml(employee.id)} ${escapeHtml(employee.name)}</option>`
  ))].join("");
  $("recordEmployee").innerHTML = options;
  $("manualEmployee").innerHTML = state.employees.map((employee) => (
    `<option value="${escapeHtml(employee.id)}">${escapeHtml(employee.id)} ${escapeHtml(employee.name)}</option>`
  )).join("");
}

async function saveEmployeeManagement(form) {
  const currentId = form.dataset.employeeEdit;
  await api(`/api/admin/employees/${encodeURIComponent(currentId)}`, {
    method: "PUT",
    body: JSON.stringify({
      id: form.elements.id.value,
      name: form.elements.name.value,
      pin: form.elements.pin.value,
      active: form.elements.active.checked
    })
  });
  await loadEmployees();
}

async function loadEmployeeStatus() {
  const params = new URLSearchParams();
  if ($("statusFrom").value) params.set("from", $("statusFrom").value);
  if ($("statusTo").value) params.set("to", $("statusTo").value);
  const rows = await api(`/api/admin/attendance?${params.toString()}`);
  const grouped = new Map(state.employees.map((employee) => [employee.id, { employee, rows: [] }]));
  rows.forEach((row) => {
    if (!grouped.has(row.employee_id)) {
      grouped.set(row.employee_id, { employee: { id: row.employee_id, name: row.name }, rows: [] });
    }
    grouped.get(row.employee_id).rows.push(row);
  });

  const groups = Array.from(grouped.values());
  $("statusEmployeeTabs").innerHTML = groups.map(({ employee }, index) => `
    <button class="employee-name-tab ${index === 0 ? "is-active" : ""}" type="button" data-status-target="${escapeHtml(employee.id)}">
      ${escapeHtml(employee.name)}
    </button>
  `).join("");

  $("statusList").innerHTML = groups.map(({ employee, rows: employeeRows }) => {
    const complete = employeeRows.filter((row) => row.status === "complete").length;
    const missingOut = employeeRows.filter((row) => row.status === "missing_out").length;
    const errors = employeeRows.filter((row) => row.status === "error_out_only").length;
    const totalMinutes = employeeRows.reduce((sum, row) => sum + (row.work_minutes || 0), 0);
    const totalTime = `${Math.floor(totalMinutes / 60)}:${String(totalMinutes % 60).padStart(2, "0")}`;
    const days = employeeRows.length ? employeeRows.map(statusDayHtml).join("") : '<article class="status-day-item">この期間の打刻はありません。</article>';
    return `
      <section id="statusEmployee-${escapeHtml(employee.id)}" class="employee-status-card" data-status-employee-card="${escapeHtml(employee.id)}">
        <div>
          <p class="item-title">${escapeHtml(employee.id)} ${escapeHtml(employee.name)}</p>
          <div class="meta-grid">
            <span>勤務日数: ${complete}日</span>
            <span>総勤務時間: ${escapeHtml(totalTime)}</span>
            <span>未退勤: ${missingOut}件</span>
            <span>エラー: ${errors}件</span>
          </div>
        </div>
        <div class="status-day-list">${days}</div>
      </section>
    `;
  }).join("");
  observeStatusEmployeeCards();
}

function jumpToStatusEmployee(employeeId) {
  setActiveStatusEmployee(employeeId);
  document.getElementById(`statusEmployee-${employeeId}`)?.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function observeStatusEmployeeCards() {
  if (state.statusObserver) state.statusObserver.disconnect();
  const cards = document.querySelectorAll("[data-status-employee-card]");
  state.statusObserver = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (visible) setActiveStatusEmployee(visible.target.dataset.statusEmployeeCard);
  }, {
    root: null,
    rootMargin: "-120px 0px -45% 0px",
    threshold: [0.2, 0.5, 0.8]
  });
  cards.forEach((card) => state.statusObserver.observe(card));
}

function statusDayHtml(row) {
  return `
    <article class="status-day-item">
      <div class="status-day-head">
        <strong>${escapeHtml(row.work_date)}</strong>
        ${statusBadge(row.status)}
      </div>
      <div class="meta-grid">
        <span>出勤: ${escapeHtml(row.clock_in || "-")}</span>
        <span>退勤: ${escapeHtml(row.clock_out || "-")}</span>
        <span>勤務: ${escapeHtml(row.work_time || "-")}</span>
        <span>元請名: ${escapeHtml(row.prime_contractor || "-")}</span>
        <span>現場名: ${escapeHtml(row.site_name || "-")}</span>
        <span>作業内容: ${escapeHtml(row.work_report || "-")}</span>
        <span>備考: ${escapeHtml(row.note || "-")}</span>
      </div>
      ${row.correction_stamp ? `<div class="correction-stamp">${escapeHtml(row.correction_stamp)}</div>` : ""}
    </article>
  `;
}

async function loadRecords() {
  const params = new URLSearchParams();
  if ($("recordEmployee").value) params.set("employeeId", $("recordEmployee").value);
  if ($("recordFrom").value) params.set("from", $("recordFrom").value);
  if ($("recordTo").value) params.set("to", $("recordTo").value);
  const rows = await api(`/api/admin/attendance?${params.toString()}`);
  $("recordList").innerHTML = rows.length ? rows.map(recordHtml).join("") : '<article class="record-item">打刻データはありません。</article>';
  document.querySelectorAll("[data-edit-record]").forEach((button) => {
    button.addEventListener("click", () => editRecord(rows.find((row) => String(row.id) === button.dataset.editRecord)));
  });
}

function recordHtml(row) {
  return `
    <article class="record-item">
      <p class="item-title">${escapeHtml(row.work_date)} ${escapeHtml(row.employee_id)} ${escapeHtml(row.name)} ${statusBadge(row.status)}</p>
      <div class="meta-grid">
        <span>出勤: ${escapeHtml(row.clock_in || "-")}</span>
        <span>退勤: ${escapeHtml(row.clock_out || "-")}</span>
        <span>勤務: ${escapeHtml(row.work_time || "-")}</span>
        <span>元請名: ${escapeHtml(row.prime_contractor || "-")}</span>
        <span>現場名: ${escapeHtml(row.site_name || "-")}</span>
        <span>作業内容: ${escapeHtml(row.work_report || "-")}</span>
        <span>備考: ${escapeHtml(row.note || "-")}</span>
      </div>
      ${row.correction_stamp ? `<div class="correction-stamp">${escapeHtml(row.correction_stamp)}</div>` : ""}
      <div class="record-actions">
        <button type="button" data-edit-record="${row.id}">修正</button>
      </div>
    </article>
  `;
}

function editRecord(row) {
  $("manualAttendanceId").value = row.id;
  $("manualEmployee").value = row.employee_id;
  $("manualDate").value = row.work_date;
  $("manualIn").value = row.clock_in || "";
  $("manualOut").value = row.clock_out || "";
  $("manualPrimeContractor").value = row.prime_contractor || "";
  $("manualSiteName").value = row.site_name || "";
  $("manualWorkReport").value = row.work_report || "";
  $("manualNote").value = row.note || "";
  $("manualDate").scrollIntoView({ behavior: "smooth", block: "center" });
}

function clearManualForm() {
  $("manualAttendanceId").value = "";
  $("manualDate").value = new Date().toISOString().slice(0, 10);
  $("manualIn").value = "";
  $("manualOut").value = "";
  $("manualPrimeContractor").value = "";
  $("manualSiteName").value = "";
  $("manualWorkReport").value = "";
  $("manualNote").value = "";
}

async function saveManualRecord() {
  const payload = {
    employee_id: $("manualEmployee").value,
    work_date: $("manualDate").value,
    clock_in: $("manualIn").value,
    clock_out: $("manualOut").value,
    prime_contractor: $("manualPrimeContractor").value,
    site_name: $("manualSiteName").value,
    work_report: $("manualWorkReport").value,
    note: $("manualNote").value
  };
  const id = $("manualAttendanceId").value;
  await api(id ? `/api/admin/attendance/${id}` : "/api/admin/attendance", {
    method: id ? "PUT" : "POST",
    body: JSON.stringify(payload)
  });
  clearManualForm();
  await loadRecords();
  if (state.employee) await loadReportHistory();
}

async function loadSummary() {
  const month = $("summaryMonth").value;
  const data = await api(`/api/admin/summary?month=${encodeURIComponent(month)}`);
  $("summaryRange").textContent = `${data.range.start} 〜 ${data.range.end}`;
  $("summaryList").innerHTML = data.rows.map((row) => `
    <article class="summary-item">
      <p class="item-title">${escapeHtml(row.employee_id)} ${escapeHtml(row.name)}</p>
      <div class="meta-grid">
        <span>勤務日数: ${row.work_days}日</span>
        <span>総勤務時間: ${escapeHtml(row.total_time)}</span>
        <span>未退勤: ${row.missing_out_days}件</span>
        <span>エラー: ${row.error_days}件</span>
      </div>
    </article>
  `).join("");
}

async function saveSummaryCsv() {
  const status = $("summarySaveStatus");
  status.textContent = "保存中です...";
  try {
    const result = await api("/api/admin/summary/save", {
      method: "POST",
      body: JSON.stringify({
        month: $("summaryMonth").value,
        folderPath: $("summaryFolder").value
      })
    });
    status.textContent = `${result.filePath} に保存しました。`;
    localStorage.setItem("summaryFolder", $("summaryFolder").value);
  } catch (error) {
    status.textContent = error.message;
  }
}

async function pickAndSaveSummaryCsv() {
  const status = $("summarySaveStatus");
  if (!window.showDirectoryPicker) {
    status.textContent = "このブラウザではフォルダ選択に対応していません。保存先フォルダを入力して保存してください。";
    return;
  }

  const month = $("summaryMonth").value;
  const filename = `attendance-summary-${month}.csv`;
  status.textContent = "フォルダを選択してください...";

  try {
    const directoryHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    const response = await fetch(`/api/admin/summary.csv?month=${encodeURIComponent(month)}`, {
      headers: { "x-admin-pin": state.adminPin }
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "CSVの取得に失敗しました。");
    }
    const csv = await response.blob();
    const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(csv);
    await writable.close();
    $("summaryFolder").value = directoryHandle.name;
    localStorage.setItem("summaryFolder", directoryHandle.name);
    status.textContent = `${directoryHandle.name}\\${filename} に保存しました。`;
  } catch (error) {
    if (error.name === "AbortError") {
      status.textContent = "保存をキャンセルしました。";
      return;
    }
    status.textContent = error.message;
  }
}

function exportCsv() {
  const params = new URLSearchParams();
  if ($("recordEmployee").value) params.set("employeeId", $("recordEmployee").value);
  if ($("recordFrom").value) params.set("from", $("recordFrom").value);
  if ($("recordTo").value) params.set("to", $("recordTo").value);
  params.set("pin", state.adminPin);
  window.location.href = `/api/admin/export.csv?${params.toString()}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await loginEmployee($("employeeId").value, $("employeePin").value, $("rememberEmployee").checked);
  } catch (error) {
    alert(error.message);
  }
});

$("logoutButton").addEventListener("click", () => {
  state.employee = null;
  state.employeePin = "";
  state.attendance = null;
  state.testWorkDate = "";
  state.reportHistory = { prime_contractors: [], site_names: [], work_reports: [] };
  renderReportHistoryOptions();
  $("employeeId").value = "";
  $("employeePin").value = "";
  localStorage.removeItem("rememberedEmployeeId");
  localStorage.removeItem("rememberedEmployeePin");
  showView("loginView");
});

$("clockInButton").addEventListener("click", () => punch("in"));
$("clockOutButton").addEventListener("click", showDailyReportForm);
$("applyTestDateButton").addEventListener("click", async () => {
  try {
    await loadEmployeeDay($("testWorkDate").value);
  } catch (error) {
    setMessage(error.message, true);
  }
});
$("dailyWorkReport").addEventListener("input", updateDailyReportCount);
$("dailyReportForm").addEventListener("submit", submitDailyReport);
$("cancelDailyReportButton").addEventListener("click", () => $("dailyReportForm").classList.add("is-hidden"));
$("dailyReportForm").addEventListener("click", (event) => {
  const button = event.target.closest("[data-report-history-target]");
  if (!button) return;
  const target = $(button.dataset.reportHistoryTarget);
  target.value = button.dataset.reportHistoryValue || "";
  if (target.id === "dailyWorkReport") updateDailyReportCount();
  target.focus();
});
$("reloadEmployeeMonthButton").addEventListener("click", loadEmployeeMonth);
$("employeeMonthList").addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-employee-correction]");
  if (!form) return;
  event.preventDefault();
  await saveEmployeeCorrection(form);
});
$("installAppButton").addEventListener("click", handleInstallClick);
$("showAdminLogin").addEventListener("click", () => showView("adminLoginView"));
$("openAdminFromEmployee").addEventListener("click", () => showView("adminLoginView"));
document.querySelector(".back-login").addEventListener("click", () => showView(state.employee ? "employeeView" : "loginView"));

$("adminLoginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  state.adminPin = $("adminPin").value;
  try {
    await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ pin: state.adminPin })
    });
    await loadEmployees();
    clearManualForm();
    showView("adminView");
  } catch (error) {
    state.adminPin = "";
    alert(error.message);
  }
});

$("adminLogoutButton").addEventListener("click", () => {
  state.adminPin = "";
  showView(state.employee ? "employeeView" : "loginView");
});

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", async () => {
    document.querySelectorAll(".tab").forEach((button) => button.classList.toggle("is-active", button === tab));
    document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.add("is-hidden"));
    $(`${tab.dataset.tab}Tab`).classList.remove("is-hidden");
    if (tab.dataset.tab === "status") await loadEmployeeStatus();
    if (tab.dataset.tab === "records") await loadRecords();
    if (tab.dataset.tab === "summary") await loadSummary();
  });
});

$("employeeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await api("/api/admin/employees", {
    method: "POST",
    body: JSON.stringify({ id: $("newEmployeeId").value, name: $("newEmployeeName").value, pin: $("newEmployeePin").value })
  });
  $("newEmployeeId").value = "";
  $("newEmployeeName").value = "";
  $("newEmployeePin").value = "";
  await loadEmployees();
});

$("employeeList").addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-employee-edit]");
  if (!form) return;
  event.preventDefault();
  try {
    await saveEmployeeManagement(form);
  } catch (error) {
    alert(error.message);
  }
});

$("recordSearchForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await loadRecords();
});

$("statusSearchForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await loadEmployeeStatus();
});

$("statusEmployeeTabs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-status-target]");
  if (!button) return;
  jumpToStatusEmployee(button.dataset.statusTarget);
});

$("manualRecordForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveManualRecord();
});

$("manualClearButton").addEventListener("click", clearManualForm);
$("csvButton").addEventListener("click", exportCsv);

$("summaryForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await loadSummary();
});

$("summarySaveForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveSummaryCsv();
});

$("pickSummaryFolderButton").addEventListener("click", pickAndSaveSummaryCsv);

setInterval(updateClock, 1000);

const month = new Date();
$("summaryMonth").value = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
$("manualDate").value = new Date().toISOString().slice(0, 10);
$("summaryFolder").value = localStorage.getItem("summaryFolder") || DEFAULT_SUMMARY_FOLDER;
const initialStatusRange = closingRangeFor();
$("statusFrom").value = initialStatusRange.start;
$("statusTo").value = initialStatusRange.end;
updateInstallButton();
if (deviceInfo().isLine) showInstallGuide();

const rememberedEmployeeId = localStorage.getItem("rememberedEmployeeId");
const rememberedEmployeePin = localStorage.getItem("rememberedEmployeePin");
if (rememberedEmployeeId && rememberedEmployeePin) {
  $("employeeId").value = rememberedEmployeeId;
  $("employeePin").value = rememberedEmployeePin;
  loginEmployee(rememberedEmployeeId, rememberedEmployeePin, true).catch(() => {
    localStorage.removeItem("rememberedEmployeeId");
    localStorage.removeItem("rememberedEmployeePin");
    showView("loginView");
  });
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  state.deferredInstallPrompt = event;
  updateInstallButton();
});

window.addEventListener("appinstalled", () => {
  state.deferredInstallPrompt = null;
  updateInstallButton();
  showInstallGuide("ホーム画面への追加が完了しました。");
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js");
  });
}
