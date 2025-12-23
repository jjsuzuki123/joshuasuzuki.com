// === Config ===
// Use your single HTTP API base
const API_BASE = 'https://nk1byjfld0.execute-api.us-east-1.amazonaws.com';

const LOGIN_ENDPOINT = `${API_BASE}/admin/login`;
const MESSAGES_ENDPOINT = `${API_BASE}/admin/messages`;
const DELETE_ENDPOINT = (id) => `${API_BASE}/admin/messages/${encodeURIComponent(id)}`;

// === DOM references ===
const loginView = document.getElementById('login-view');
const entriesView = document.getElementById('entries-view');

const loginForm = document.getElementById('login-form');
const passwordInput = document.getElementById('password');
const loginStatusEl = document.getElementById('login-status');

const entriesBody = document.getElementById('entries-body');
const entriesStatusEl = document.getElementById('entries-status');
const entriesCountEl = document.getElementById('entries-count');
const refreshBtn = document.getElementById('refresh-entries');

let authToken = null;

// === Auth token helpers ===
function setAuthToken(token) {
  authToken = token;
  if (token) {
    try {
      localStorage.setItem('adminToken', token);
    } catch (e) {
      console.warn('Unable to persist token', e);
    }
  } else {
    try {
      localStorage.removeItem('adminToken');
    } catch (e) {
      console.warn('Unable to clear token', e);
    }
  }
}

function getAuthToken() {
  if (authToken) return authToken;
  try {
    const stored = localStorage.getItem('adminToken');
    if (stored) authToken = stored;
  } catch (e) {
    console.warn('Unable to read token from storage', e);
  }
  return authToken;
}

// === View helpers ===
function showLoginView(message) {
  loginView.classList.remove('hidden');
  entriesView.classList.add('hidden');
  if (message) {
    loginStatusEl.textContent = message;
  }
}

function showEntriesView() {
  loginView.classList.add('hidden');
  entriesView.classList.remove('hidden');
}

// === Login handler ===
if (loginForm) {
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    loginStatusEl.textContent = 'Logging in...';

    const password = passwordInput.value || '';

    try {
      const res = await fetch(LOGIN_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      });

      if (!res.ok) {
        if (res.status === 401) {
          loginStatusEl.textContent = 'Incorrect password.';
        } else {
          loginStatusEl.textContent = `Login failed (HTTP ${res.status}).`;
        }
        return;
      }

      const data = await res.json();
      if (!data.token) {
        loginStatusEl.textContent = 'No token returned from server.';
        return;
      }

      setAuthToken(data.token);
      loginStatusEl.textContent = '';
      passwordInput.value = '';

      showEntriesView();
      await loadEntries();
    } catch (error) {
      console.error('Login error', error);
      loginStatusEl.textContent = 'Unexpected error logging in.';
    }
  });
}

// === Load entries ===
async function loadEntries() {
  const token = getAuthToken();
  if (!token) {
    showLoginView('Session expired. Please log in again.');
    return;
  }

  entriesStatusEl.textContent = 'Loading entries...';

  try {
    const res = await fetch(MESSAGES_ENDPOINT, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (res.status === 401) {
      setAuthToken(null);
      showLoginView('Session expired. Please log in again.');
      return;
    }

    if (!res.ok) {
      entriesStatusEl.textContent = `Failed to load entries (HTTP ${res.status}).`;
      return;
    }

    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];

    renderEntries(items);
    entriesStatusEl.textContent = items.length ? '' : 'No entries found.';
  } catch (error) {
    console.error('Error loading entries', error);
    entriesStatusEl.textContent = 'Unexpected error loading entries.';
  }
}

function renderEntries(items) {
  entriesBody.innerHTML = '';

  if (!items.length) {
    entriesBody.innerHTML = `
      <tr>
        <td colspan="5">No entries yet.</td>
      </tr>
    `;
    if (entriesCountEl) entriesCountEl.textContent = '0 entries';
    return;
  }

  for (const item of items) {
    const tr = document.createElement('tr');

    const createdCell = document.createElement('td');
    createdCell.textContent = item.createdAt || '';
    tr.appendChild(createdCell);

    const nameCell = document.createElement('td');
    nameCell.textContent = item.name || '';
    tr.appendChild(nameCell);

    const emailCell = document.createElement('td');
    emailCell.textContent = item.email || '';
    tr.appendChild(emailCell);

    const messageCell = document.createElement('td');
    messageCell.classList.add('message-cell');
    messageCell.textContent = item.message || '';
    tr.appendChild(messageCell);

    const actionsCell = document.createElement('td');
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Delete';
    deleteBtn.className = 'delete-btn';
    deleteBtn.dataset.id = item.id || '';
    actionsCell.appendChild(deleteBtn);
    tr.appendChild(actionsCell);

    entriesBody.appendChild(tr);
  }

  if (entriesCountEl) {
    entriesCountEl.textContent = `${items.length} entr${items.length === 1 ? 'y' : 'ies'}`;
  }
}

// === Delete entry ===
async function deleteEntry(id) {
  const token = getAuthToken();
  if (!token) {
    showLoginView('Session expired. Please log in again.');
    return;
  }

  if (!id) return;

  const confirmDelete = window.confirm('Delete this entry? This cannot be undone.');
  if (!confirmDelete) return;

  entriesStatusEl.textContent = 'Deleting entry...';

  try {
    const res = await fetch(DELETE_ENDPOINT(id), {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (res.status === 401) {
      setAuthToken(null);
      showLoginView('Session expired. Please log in again.');
      return;
    }

    if (!res.ok && res.status !== 204) {
      const body = await res.text();
      entriesStatusEl.textContent = `Failed to delete entry (HTTP ${res.status}). ${body || ''}`;
      return;
    }
    
    // Reload entries after delete
    await loadEntries();
  } catch (error) {
    console.error('Error deleting entry', error);
    entriesStatusEl.textContent = 'Unexpected error deleting entry.';
  }
}

// === Event wiring ===

// Refresh button
if (refreshBtn) {
  refreshBtn.addEventListener('click', () => {
    loadEntries();
  });
}

// Delegate delete button clicks
if (entriesBody) {
  entriesBody.addEventListener('click', (event) => {
    const target = event.target;
    if (target && target.classList.contains('delete-btn')) {
      const id = target.dataset.id;
      deleteEntry(id);
    }
  });
}

// Auto-try to show entries if we already have a token
(function init() {
  const existingToken = getAuthToken();
  if (existingToken) {
    showEntriesView();
    loadEntries();
  }
})();
