(() => {
  const db = () => window.firebaseDb || window.db;
  const byId = (id) => document.getElementById(id);
  const state = { employees: [], shifts: [], attendance: [], payroll: [], reportRows: [], editingShiftId: null, unsubscribers: [] };
  const collections = { employees: 'employees', shifts: 'shifts', attendance: 'attendance', payroll: 'payroll' };

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const money = (value) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0);
  const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  const validTime = (value) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value || '');
  const timeMinutes = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  const dateValue = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
    const [year, month, day] = value.split('-').map(Number);
    const parsed = new Date(year, month - 1, day, 12);
    return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
  };
  const parseLocal = (date, time) => {
    if (!dateValue(date) || !validTime(time)) return null;
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    const parsed = new Date(year, month - 1, day, hour, minute, 0, 0);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };
  const addDays = (date, days) => {
    const [year, month, day] = date.split('-').map(Number);
    const parsed = new Date(year, month - 1, day + days, 12);
    return localDate(parsed);
  };
  const localDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  };
  const formatStamp = (iso) => {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    return localDate(date) + ' ' + String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
  };
  const hoursBetween = (start, end, breakMinutes = 0) => round2(Math.max(0, (end.getTime() - start.getTime()) / 3600000 - Number(breakMinutes || 0) / 60));
  function notify(message, type = 'info') {
    if (typeof window.showToast === 'function') window.showToast(message, type);
    else window.alert(message);
  }
  function employeeName(id) {
    const employee = state.employees.find((item) => item.id === id);
    return employee ? employee.name : 'Unknown employee';
  }
  function fillEmployeeSelects() {
    ['shift-employee', 'attendance-employee', 'payroll-employee'].forEach((id) => {
      const select = byId(id);
      if (!select) return;
      const current = select.value;
      select.innerHTML = '<option value="">Select employee</option>' + state.employees
        .filter((employee) => id === 'shift-employee' ? employee.status !== 'inactive' : true)
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
        .map((employee) => '<option value="' + escapeHtml(employee.id) + '">' + escapeHtml(employee.name) + (employee.status === 'inactive' ? ' (inactive)' : '') + '</option>').join('');
      if (state.employees.some((employee) => employee.id === current)) select.value = current;
    });
  }
  function renderShifts() {
    const tbody = byId('shifts-tbody');
    if (!tbody) return;
    const rows = [...state.shifts].sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)));
    tbody.innerHTML = rows.length ? rows.map((shift) => {
      const start = new Date(shift.startAt);
      const end = new Date(shift.endAt);
      return '<tr><td>' + escapeHtml(shift.employeeName || employeeName(shift.employeeId)) + '</td><td>' + escapeHtml(shift.shiftDate) + '</td><td>' + escapeHtml(formatStamp(shift.startAt).slice(11) + '–' + formatStamp(shift.endAt).slice(11)) + (shift.endDate !== shift.shiftDate ? '<br><small>Ends ' + escapeHtml(shift.endDate) + '</small>' : '') + '</td><td>' + hoursBetween(start, end) + ' h</td><td class="employee-actions"><button type="button" class="btn-action btn-action--reply" data-shift-action="edit" data-id="' + escapeHtml(shift.id) + '">Edit</button><button type="button" class="btn-action btn-action--delete" data-shift-action="delete" data-id="' + escapeHtml(shift.id) + '">Delete</button></td></tr>';
    }).join('') : '<tr><td colspan="5" class="employee-empty">No shifts scheduled.</td></tr>';
  }
  function renderAttendance() {
    const tbody = byId('attendance-tbody');
    if (!tbody) return;
    const rows = [...state.attendance].sort((a, b) => String(b.clockInAt).localeCompare(String(a.clockInAt)));
    tbody.innerHTML = rows.length ? rows.map((record) => '<tr><td>' + escapeHtml(record.employeeName || employeeName(record.employeeId)) + '</td><td>' + escapeHtml(formatStamp(record.clockInAt)) + '</td><td>' + escapeHtml(formatStamp(record.clockOutAt)) + '</td><td>' + money(record.hours) + ' h</td><td><span class="employee-status employee-status--' + (record.status === 'approved' ? 'active' : 'inactive') + '">' + escapeHtml(record.status || 'pending') + '</span></td><td class="employee-actions"><button type="button" class="btn-action btn-action--reply" data-attendance-action="toggle" data-id="' + escapeHtml(record.id) + '">' + (record.status === 'approved' ? 'Set pending' : 'Approve') + '</button><button type="button" class="btn-action btn-action--delete" data-attendance-action="delete" data-id="' + escapeHtml(record.id) + '">Delete</button></td></tr>').join('') : '<tr><td colspan="6" class="employee-empty">No time records.</td></tr>';
  }
  function renderPayroll() {
    const tbody = byId('payroll-tbody');
    if (!tbody) return;
    const rows = [...state.payroll].sort((a, b) => String(b.period).localeCompare(String(a.period)));
    tbody.innerHTML = rows.length ? rows.map((record) => '<tr><td>' + escapeHtml(record.period) + '</td><td>' + escapeHtml(record.employeeName || employeeName(record.employeeId)) + '</td><td>' + money(record.totalHours) + '</td><td>' + money(record.regularHours) + '</td><td>' + money(record.overtimeHours) + '</td><td>' + money(record.grossPay) + '</td><td>' + money(record.netPay) + '</td></tr>').join('') : '<tr><td colspan="7" class="employee-empty">No payroll records saved.</td></tr>';
  }
  function resetShiftForm() {
    byId('shift-form')?.reset();
    state.editingShiftId = null;
    const button = byId('shift-save-btn');
    if (button) button.textContent = 'Add shift';
  }
  function shiftRange(date, startTime, endTime) {
    const start = parseLocal(date, startTime);
    if (!start) return null;
    const endDate = timeMinutes(endTime) <= timeMinutes(startTime) ? addDays(date, 1) : date;
    const end = parseLocal(endDate, endTime);
    if (!end || end <= start) return null;
    const duration = (end - start) / 3600000;
    if (duration > 18) throw new Error('A shift cannot exceed 18 hours. Please split unusually long shifts.');
    return { start, end, endDate, duration };
  }
  async function saveShift(event) {
    event.preventDefault();
    const database = db();
    const employeeId = byId('shift-employee').value;
    const employee = state.employees.find((item) => item.id === employeeId);
    const date = byId('shift-date').value;
    const startTime = byId('shift-start').value.trim();
    const endTime = byId('shift-end').value.trim();
    if (!database || !employee) return notify('Select an employee and confirm Firestore is available.', 'error');
    if (!validTime(startTime) || !validTime(endTime) || !dateValue(date)) return notify('Enter a valid date and 24-hour times such as 09:00 or 22:30.', 'error');
    let range;
    try { range = shiftRange(date, startTime, endTime); } catch (error) { return notify(error.message, 'error'); }
    if (!range) return notify('Could not calculate this shift. Check its date and times.', 'error');

    const overlap = state.shifts.some((shift) => {
      if (shift.employeeId !== employeeId || shift.id === state.editingShiftId) return false;
      const existingStart = new Date(shift.startAt).getTime();
      const existingEnd = new Date(shift.endAt).getTime();
      return range.start.getTime() < existingEnd && range.end.getTime() > existingStart;
    });
    if (overlap) return notify('This employee already has an overlapping shift.', 'error');

    const payload = {
      employeeId, employeeName: employee.name, shiftDate: date, endDate: range.endDate,
      startTime, endTime, startAt: range.start.toISOString(), endAt: range.end.toISOString(),
      role: byId('shift-role').value.trim(), notes: byId('shift-notes').value.trim(),
      durationHours: round2(range.duration), updatedAt: new Date().toISOString()
    };
    try {
      if (state.editingShiftId) await database.collection(collections.shifts).doc(state.editingShiftId).update(payload);
      else {
        payload.createdAt = new Date().toISOString();
        await database.collection(collections.shifts).add(payload);
      }
      resetShiftForm();
      notify('Shift saved.', 'success');
    } catch (error) {
      console.error('[Shift save]', error);
      notify(error.code === 'permission-denied' ? 'Access denied. Configure the Firebase admin claim and rules.' : 'Could not save shift.', 'error');
    }
  }
  async function handleShiftAction(event) {
    const button = event.target.closest('[data-shift-action]');
    if (!button) return;
    const shift = state.shifts.find((item) => item.id === button.dataset.id);
    if (!shift) return;
    if (button.dataset.shiftAction === 'edit') {
      state.editingShiftId = shift.id;
      byId('shift-employee').value = shift.employeeId;
      byId('shift-date').value = shift.shiftDate;
      byId('shift-start').value = shift.startTime;
      byId('shift-end').value = shift.endTime;
      byId('shift-role').value = shift.role || '';
      byId('shift-notes').value = shift.notes || '';
      byId('shift-save-btn').textContent = 'Update shift';
      byId('shift-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (button.dataset.shiftAction === 'delete' && window.confirm('Delete this scheduled shift?')) {
      try {
        await db().collection(collections.shifts).doc(shift.id).delete();
        notify('Shift deleted.', 'success');
      } catch (error) {
        console.error('[Shift delete]', error);
        notify('Could not delete shift.', 'error');
      }
    }
  }
  function resetAttendanceForm() {
    byId('attendance-form')?.reset();
    byId('attendance-break').value = '0';
    byId('attendance-status').value = 'approved';
  }
  async function saveAttendance(event) {
    event.preventDefault();
    const database = db();
    const employeeId = byId('attendance-employee').value;
    const employee = state.employees.find((item) => item.id === employeeId);
    const workDate = byId('attendance-date').value;
    const inTime = byId('attendance-in').value.trim();
    const outTime = byId('attendance-out').value.trim();
    const breakMinutes = Number(byId('attendance-break').value);
    if (!database || !employee) return notify('Select an employee and confirm Firestore is available.', 'error');
    if (!dateValue(workDate) || !validTime(inTime) || !validTime(outTime)) return notify('Enter a valid work date and times in HH:MM 24-hour format.', 'error');
    if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 720) return notify('Break must be between 0 and 720 whole minutes.', 'error');

    let outDate = byId('attendance-out-date').value;
    if (!outDate) outDate = timeMinutes(outTime) <= timeMinutes(inTime) ? addDays(workDate, 1) : workDate;
    if (!dateValue(outDate) || outDate < workDate) return notify('Clock-out date cannot be earlier than the work date.', 'error');
    const clockIn = parseLocal(workDate, inTime);
    const clockOut = parseLocal(outDate, outTime);
    if (!clockIn || !clockOut || clockOut <= clockIn) return notify('Clock-out must occur after clock-in. For overnight shifts, use the next-day date or leave it blank for automatic handling.', 'error');
    const rawHours = (clockOut - clockIn) / 3600000;
    if (rawHours > 18) return notify('A time record cannot exceed 18 hours. Split the record and check the punches.', 'error');
    if (breakMinutes / 60 >= rawHours) return notify('Unpaid break must be shorter than the recorded shift.', 'error');

    const payload = {
      employeeId, employeeName: employee.name, workDate, clockOutDate: outDate,
      clockInTime: inTime, clockOutTime: outTime,
      clockInAt: clockIn.toISOString(), clockOutAt: clockOut.toISOString(),
      breakMinutes, hours: hoursBetween(clockIn, clockOut, breakMinutes),
      status: byId('attendance-status').value, updatedAt: new Date().toISOString()
    };
    try {
      payload.createdAt = new Date().toISOString();
      await database.collection(collections.attendance).add(payload);
      resetAttendanceForm();
      notify('Time record saved.', 'success');
    } catch (error) {
      console.error('[Attendance save]', error);
      notify(error.code === 'permission-denied' ? 'Access denied. Configure the Firebase admin claim and rules.' : 'Could not save time record.', 'error');
    }
  }
  async function handleAttendanceAction(event) {
    const button = event.target.closest('[data-attendance-action]');
    if (!button) return;
    const record = state.attendance.find((item) => item.id === button.dataset.id);
    if (!record) return;
    try {
      if (button.dataset.attendanceAction === 'toggle') {
        const status = record.status === 'approved' ? 'pending' : 'approved';
        await db().collection(collections.attendance).doc(record.id).update({ status, updatedAt: new Date().toISOString() });
        notify(status === 'approved' ? 'Time record approved.' : 'Time record set to pending.', 'success');
      } else if (button.dataset.attendanceAction === 'delete' && window.confirm('Delete this time record?')) {
        await db().collection(collections.attendance).doc(record.id).delete();
        notify('Time record deleted.', 'success');
      }
    } catch (error) {
      console.error('[Attendance action]', error);
      notify('Could not update this time record. Check administrator access.', 'error');
    }
  }

  function weekKey(date) {
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
    const offset = (day.getDay() + 6) % 7;
    day.setDate(day.getDate() - offset);
    return localDate(day);
  }
  function calculatePay(records, payType, basePay, standardHours, multiplier, bonus, penalty) {
    const sorted = records.filter((record) => record.status === 'approved' && record.clockInAt && record.clockOutAt)
      .sort((a, b) => String(a.clockInAt).localeCompare(String(b.clockInAt)));
    const weeklyTotals = new Map();
    let regularHours = 0;
    let overtimeHours = 0;
    let totalHours = 0;
    sorted.forEach((record) => {
      const start = new Date(record.clockInAt);
      const key = weekKey(start);
      const before = weeklyTotals.get(key) || 0;
      const hours = Math.max(0, Number(record.hours) || 0);
      const regular = Math.min(hours, Math.max(0, 40 - before));
      const overtime = Math.max(0, hours - regular);
      weeklyTotals.set(key, before + hours);
      regularHours += regular;
      overtimeHours += overtime;
      totalHours += hours;
    });
    regularHours = round2(regularHours);
    overtimeHours = round2(overtimeHours);
    totalHours = round2(totalHours);
    const hourlyEquivalent = payType === 'monthly' ? basePay / standardHours : basePay;
    const regularPay = payType === 'monthly' ? basePay : regularHours * basePay;
    const overtimePay = overtimeHours * hourlyEquivalent * multiplier;
    const grossPay = round2(regularPay + overtimePay + bonus);
    const netPay = round2(grossPay - penalty);
    return { totalHours, regularHours, overtimeHours, hourlyEquivalent: round2(hourlyEquivalent), regularPay: round2(regularPay), overtimePay: round2(overtimePay), bonus: round2(bonus), penalty: round2(penalty), grossPay, netPay };
  }
  async function savePayroll(event) {
    event.preventDefault();
    const database = db();
    const employeeId = byId('payroll-employee').value;
    const employee = state.employees.find((item) => item.id === employeeId);
    const period = byId('payroll-period').value;
    const payType = byId('payroll-type').value;
    const basePay = Number(byId('payroll-base').value);
    const standardHours = Number(byId('payroll-standard-hours').value);
    const multiplier = Number(byId('payroll-ot-multiplier').value);
    const bonus = Number(byId('payroll-bonus').value);
    const penalty = Number(byId('payroll-penalty').value);
    if (!database || !employee || !/^\d{4}-\d{2}$/.test(period)) return notify('Choose an employee and valid pay month.', 'error');
    if (![basePay, standardHours, multiplier, bonus, penalty].every(Number.isFinite) || basePay < 0 || standardHours <= 0 || multiplier < 1 || multiplier > 3 || bonus < 0 || penalty < 0) return notify('Enter valid non-negative pay values, positive standard hours and an overtime multiplier from 1 to 3.', 'error');

    const [year, month] = period.split('-').map(Number);
    const periodStart = year + '-' + String(month).padStart(2, '0') + '-01';
    const periodEnd = localDate(new Date(year, month, 0, 12));
    const records = state.attendance.filter((record) => record.employeeId === employeeId && record.workDate >= periodStart && record.workDate <= periodEnd);
    const calculated = calculatePay(records, payType, basePay, standardHours, multiplier, bonus, penalty);
    if (penalty > calculated.grossPay) return notify('Penalty cannot exceed gross pay; review the entered values.', 'error');
    const record = {
      employeeId, employeeName: employee.name, period, periodStart, periodEnd, payType,
      basePay: round2(basePay), standardHours: round2(standardHours), overtimeMultiplier: multiplier,
      ...calculated, currency: 'configured-by-business', calculatedAt: new Date().toISOString()
    };
    byId('payroll-result').textContent = 'Hours: ' + money(record.totalHours) + ' · Regular: ' + money(record.regularHours) + ' · Overtime: ' + money(record.overtimeHours) + ' · Regular/base pay: ' + money(record.regularPay) + ' · Overtime pay: ' + money(record.overtimePay) + ' · Bonus: ' + money(record.bonus) + ' · Penalty: ' + money(record.penalty) + ' · Net pay: ' + money(record.netPay);
    try {
      await database.collection(collections.payroll).doc(employeeId + '_' + period).set({ ...record, updatedAt: new Date().toISOString() });
      notify('Payroll calculated and saved. Verify local payroll rules before payment.', 'success');
    } catch (error) {
      console.error('[Payroll save]', error);
      notify(error.code === 'permission-denied' ? 'Access denied. Configure the Firebase admin claim and rules.' : 'Could not save payroll.', 'error');
    }
  }

  function generateReport(event) {
    if (event) event.preventDefault();
    const from = byId('report-from').value;
    const to = byId('report-to').value;
    if (!dateValue(from) || !dateValue(to) || from > to) return notify('Choose a valid date range where From is on or before Through.', 'error');
    const rows = state.employees.map((employee) => {
      const attendance = state.attendance.filter((record) => record.employeeId === employee.id && record.status === 'approved' && record.workDate >= from && record.workDate <= to);
      const hours = round2(attendance.reduce((sum, record) => sum + (Number(record.hours) || 0), 0));
      const payroll = state.payroll.filter((record) => record.employeeId === employee.id && record.periodStart <= to && record.periodEnd >= from);
      const netPay = round2(payroll.reduce((sum, record) => sum + (Number(record.netPay) || 0), 0));
      return { employeeId: employee.id, name: employee.name, role: employee.role || '', status: employee.status || 'active', hours, netPay };
    }).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    state.reportRows = rows;
    byId('report-summary').textContent = 'Period ' + from + ' to ' + to + ' · Employees: ' + rows.length + ' · Approved hours: ' + money(rows.reduce((sum, row) => sum + row.hours, 0)) + ' · Saved payroll net: ' + money(rows.reduce((sum, row) => sum + row.netPay, 0));
    byId('report-tbody').innerHTML = rows.length ? rows.map((row) => '<tr><td>' + escapeHtml(row.name) + '<br><small>' + escapeHtml(row.role) + '</small></td><td>' + escapeHtml(row.status) + '</td><td>' + money(row.hours) + '</td><td>' + money(row.netPay) + '</td></tr>').join('') : '<tr><td colspan="4" class="employee-empty">No employees in this report.</td></tr>';
  }
  function exportReport() {
    if (!state.reportRows.length) return notify('Generate a report before exporting CSV.', 'error');
    const from = byId('report-from').value;
    const to = byId('report-to').value;
    const csvCell = (value) => '"' + String(value ?? '').replace(/"/g, '""') + '"';
    const rows = [['Employee ID', 'Employee', 'Role', 'Status', 'Approved hours', 'Saved payroll net'], ...state.reportRows.map((row) => [row.employeeId, row.name, row.role, row.status, row.hours, row.netPay])];
    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'cafe-staff-report-' + from + '-to-' + to + '.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function listen(name, onData) {
    const database = db();
    if (!database) return;
    const unsubscribe = database.collection(collections[name]).onSnapshot((snapshot) => {
      state[name] = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      onData();
    }, (error) => {
      console.error('[Staff operations ' + name + ']', error);
      notify(error.code === 'permission-denied' ? 'Access denied to ' + name + '. Deploy admin-only Firestore rules and configure the admin claim.' : 'Could not load ' + name + '.', 'error');
    });
    state.unsubscribers.push(unsubscribe);
  }
  function startListeners() {
    state.unsubscribers.forEach((unsubscribe) => unsubscribe());
    state.unsubscribers = [];
    listen('employees', () => { fillEmployeeSelects(); if (byId('report-from').value && byId('report-to').value) generateReport(); });
    listen('shifts', renderShifts);
    listen('attendance', () => { renderAttendance(); if (byId('report-from').value && byId('report-to').value) generateReport(); });
    listen('payroll', () => { renderPayroll(); if (byId('report-from').value && byId('report-to').value) generateReport(); });
  }
  document.addEventListener('DOMContentLoaded', () => {
    if (!byId('staff-operations-title')) return;
    byId('shift-form').addEventListener('submit', saveShift);
    byId('shift-reset-btn').addEventListener('click', resetShiftForm);
    byId('shifts-tbody').addEventListener('click', handleShiftAction);
    byId('attendance-form').addEventListener('submit', saveAttendance);
    byId('attendance-tbody').addEventListener('click', handleAttendanceAction);
    byId('attendance-clockout-next').addEventListener('click', () => {
      const date = byId('attendance-date').value;
      if (date) byId('attendance-out-date').value = addDays(date, 1);
      notify('Clock-out date set to the next day.', 'info');
    });
    byId('payroll-form').addEventListener('submit', savePayroll);
    byId('payroll-employee').addEventListener('change', () => {
      const employee = state.employees.find((item) => item.id === byId('payroll-employee').value);
      if (employee && employee.hourlyRate != null && byId('payroll-type').value === 'hourly') byId('payroll-base').value = employee.hourlyRate;
    });
    byId('payroll-type').addEventListener('change', () => {
      const employee = state.employees.find((item) => item.id === byId('payroll-employee').value);
      if (!employee) return;
      if (byId('payroll-type').value === 'hourly' && employee.hourlyRate != null) byId('payroll-base').value = employee.hourlyRate;
      if (byId('payroll-type').value === 'monthly' && employee.monthlySalary != null) byId('payroll-base').value = employee.monthlySalary;
    });
    byId('report-form').addEventListener('submit', generateReport);
    byId('report-export').addEventListener('click', exportReport);

    const auth = window.firebaseAuth || window.auth;
    if (auth && typeof auth.onAuthStateChanged === 'function') {
      auth.onAuthStateChanged((user) => {
        if (user) startListeners();
        else {
          state.unsubscribers.forEach((unsubscribe) => unsubscribe());
          state.unsubscribers = [];
          Object.keys(collections).forEach((key) => { state[key] = []; });
          fillEmployeeSelects();
          renderShifts(); renderAttendance(); renderPayroll();
        }
      });
    } else {
      window.addEventListener('load', () => {
        const lateAuth = window.firebaseAuth || window.auth;
        if (lateAuth && typeof lateAuth.onAuthStateChanged === 'function') lateAuth.onAuthStateChanged((user) => { if (user) startListeners(); });
      }, { once: true });
    }
  });
})();
