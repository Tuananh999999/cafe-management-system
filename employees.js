(() => {
  const collectionName = 'employees';
  let employees = [];
  let editingId = null;
  let unsubscribeEmployees = null;

  const byId = (id) => document.getElementById(id);
  const db = () => window.firebaseDb || window.db;
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));

  function notify(message, type = 'info') {
    if (typeof window.showToast === 'function') {
      window.showToast(message, type);
      return;
    }
    window.alert(message);
  }

  function renderEmployees() {
    const tbody = byId('employees-tbody');
    if (!tbody) return;
    const query = (byId('employee-search')?.value || '').trim().toLowerCase();
    const filtered = employees.filter((employee) => [
      employee.name, employee.email, employee.phone, employee.role, employee.status
    ].some((value) => String(value || '').toLowerCase().includes(query)));

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="employee-empty">No employees found.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map((employee) => {
      const status = employee.status === 'inactive' ? 'Inactive' : 'Active';
      return `<tr>
        <td><strong>${escapeHtml(employee.name)}</strong></td>
        <td>${escapeHtml(employee.email)}</td>
        <td>${escapeHtml(employee.phone || '—')}</td>
        <td>${escapeHtml(employee.role)}</td>
        <td><span class="employee-status employee-status--${status.toLowerCase()}">${status}</span></td>
        <td class="employee-actions">
          <button type="button" class="btn-action btn-action--reply" data-employee-action="edit" data-employee-id="${escapeHtml(employee.id)}">Edit</button>
          <button type="button" class="btn-action btn-action--cancel" data-employee-action="toggle" data-employee-id="${escapeHtml(employee.id)}">${status === 'Active' ? 'Deactivate' : 'Activate'}</button>
          <button type="button" class="btn-action btn-action--delete" data-employee-action="delete" data-employee-id="${escapeHtml(employee.id)}">Delete</button>
        </td>
      </tr>`;
    }).join('');
  }

  function resetForm() {
    const form = byId('employee-form');
    if (form) form.reset();
    editingId = null;
    byId('employee-form-title').textContent = 'Add employee';
    byId('employee-save-btn').textContent = 'Save employee';
    byId('employee-cancel-edit-btn').hidden = true;
    byId('employee-status').value = 'active';
    byId('employee-hourly-rate').value = '';
  }

  function editEmployee(employee) {
    editingId = employee.id;
    byId('employee-name').value = employee.name || '';
    byId('employee-email').value = employee.email || '';
    byId('employee-phone').value = employee.phone || '';
    byId('employee-role').value = employee.role || '';
    byId('employee-hire-date').value = employee.hireDate || '';
    byId('employee-hourly-rate').value = employee.hourlyRate ?? '';
    byId('employee-status').value = employee.status || 'active';
    byId('employee-form-title').textContent = 'Edit employee';
    byId('employee-save-btn').textContent = 'Update employee';
    byId('employee-cancel-edit-btn').hidden = false;
    byId('employee-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function saveEmployee(event) {
    event.preventDefault();
    const database = db();
    if (!database || typeof database.collection !== 'function') {
      notify('Firestore is unavailable. Please refresh and try again.', 'error');
      return;
    }

    const name = byId('employee-name').value.trim();
    const email = byId('employee-email').value.trim().toLowerCase();
    const phone = byId('employee-phone').value.trim();
    const role = byId('employee-role').value.trim();
    const hireDate = byId('employee-hire-date').value;
    const rateRaw = byId('employee-hourly-rate').value;
    const hourlyRate = Number(rateRaw);
    const status = byId('employee-status').value;

    if (name.length < 2) {
      notify('Employee name must contain at least 2 characters.', 'error');
      byId('employee-name').focus();
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      notify('Enter a valid employee email address.', 'error');
      byId('employee-email').focus();
      return;
    }
    if (!role) {
      notify('Please select or enter a job role.', 'error');
      byId('employee-role').focus();
      return;
    }
    if (rateRaw !== '' && (!Number.isFinite(hourlyRate) || hourlyRate < 0)) {
      notify('Hourly rate must be a non-negative number.', 'error');
      byId('employee-hourly-rate').focus();
      return;
    }

    const payload = {
      name, email, phone, role, hireDate,
      hourlyRate: rateRaw === '' ? null : hourlyRate,
      status,
      updatedAt: new Date().toISOString()
    };
    const saveButton = byId('employee-save-btn');
    saveButton.disabled = true;
    const oldLabel = saveButton.textContent;
    saveButton.textContent = 'Saving…';

    try {
      if (editingId) {
        await database.collection(collectionName).doc(editingId).update(payload);
        notify('Employee updated successfully.', 'success');
      } else {
        payload.createdAt = new Date().toISOString();
        await database.collection(collectionName).add(payload);
        notify('Employee added successfully.', 'success');
      }
      resetForm();
    } catch (error) {
      console.error('[Employee save]', error);
      notify(error.code === 'permission-denied'
        ? 'Access denied. An administrator account with the required Firebase admin claim is needed.'
        : 'Could not save employee. Check your connection and try again.', 'error');
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = oldLabel;
    }
  }

  async function handleTableAction(event) {
    const button = event.target.closest('[data-employee-action]');
    if (!button) return;
    const employee = employees.find((item) => item.id === button.dataset.employeeId);
    if (!employee) return;

    if (button.dataset.employeeAction === 'edit') {
      editEmployee(employee);
      return;
    }

    const database = db();
    if (!database) {
      notify('Firestore is unavailable.', 'error');
      return;
    }

    if (button.dataset.employeeAction === 'toggle') {
      const nextStatus = employee.status === 'inactive' ? 'active' : 'inactive';
      try {
        await database.collection(collectionName).doc(employee.id).update({
          status: nextStatus,
          updatedAt: new Date().toISOString()
        });
        notify(nextStatus === 'active' ? 'Employee activated.' : 'Employee deactivated.', 'success');
      } catch (error) {
        console.error('[Employee status]', error);
        notify('Could not change employee status. Check your permissions.', 'error');
      }
    }

    if (button.dataset.employeeAction === 'delete') {
      if (!window.confirm(`Delete employee "${employee.name}"? This cannot be undone.`)) return;
      try {
        await database.collection(collectionName).doc(employee.id).delete();
        if (editingId === employee.id) resetForm();
        notify('Employee deleted.', 'success');
      } catch (error) {
        console.error('[Employee delete]', error);
        notify('Could not delete employee. Check your permissions.', 'error');
      }
    }
  }

  function startEmployeeListener() {
    const database = db();
    if (!database || typeof database.collection !== 'function') {
      notify('Firestore is unavailable. Employee management could not start.', 'error');
      return;
    }
    if (unsubscribeEmployees) unsubscribeEmployees();
    unsubscribeEmployees = database.collection(collectionName).orderBy('name').onSnapshot((snapshot) => {
      employees = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      renderEmployees();
    }, (error) => {
      console.error('[Employee list]', error);
      const tbody = byId('employees-tbody');
      if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="employee-empty">Unable to load employees. Check administrator permissions and Firestore rules.</td></tr>';
      notify(error.code === 'permission-denied'
        ? 'Employee access denied. Configure the Firebase admin custom claim for this account.'
        : 'Unable to load employees.', 'error');
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const form = byId('employee-form');
    const tbody = byId('employees-tbody');
    const search = byId('employee-search');
    if (!form || !tbody) return;

    form.addEventListener('submit', saveEmployee);
    tbody.addEventListener('click', handleTableAction);
    search?.addEventListener('input', renderEmployees);
    byId('employee-cancel-edit-btn')?.addEventListener('click', resetForm);

    const auth = window.firebaseAuth || window.auth;
    if (auth && typeof auth.onAuthStateChanged === 'function') {
      auth.onAuthStateChanged((user) => {
        if (user) startEmployeeListener();
        else if (unsubscribeEmployees) {
          unsubscribeEmployees();
          unsubscribeEmployees = null;
          employees = [];
          renderEmployees();
        }
      });
    }
  });
})();
