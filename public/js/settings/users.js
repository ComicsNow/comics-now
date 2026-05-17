// --- USER MANAGEMENT ---
const settingsTabUsers = document.getElementById('settings-tab-users');
const refreshUsersBtn = document.getElementById('refresh-users-btn');
const usersStatusDiv = document.getElementById('users-status');
const usersListDiv = document.getElementById('users-list');

function setUsersStatus(message, type = 'info', showSpinner = false) {
  if (!usersStatusDiv) return;
  usersStatusDiv.textContent = message;
  usersStatusDiv.className = `text-sm mb-3 ${type === 'error' ? 'text-red-400' : 'text-gray-400'}`;
}

async function refreshUsersList() {
  if (!usersListDiv) return;

  try {
    setUsersStatus('Loading users...', 'info', true);

    const response = await fetch(`${API_BASE_URL}/api/v1/users`);
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.message || 'Failed to load users');
    }

    const users = data.users || [];

    if (users.length === 0) {
      usersListDiv.innerHTML = '<p class="text-gray-400 text-center py-4">No users found</p>';
      setUsersStatus('No users registered', 'info', false);
      return;
    }

    setUsersStatus(`${users.length} user${users.length === 1 ? '' : 's'} registered`, 'info', false);

    usersListDiv.innerHTML = users.map(user => `
      <div class="user-card bg-gray-800/50 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border border-gray-700/50 hover:border-purple-500/50 transition-all group cursor-pointer" data-user-id="${escapeHtml(user.userId)}" data-user-email="${escapeHtml(user.email)}" data-user-role="${escapeHtml(user.role)}">
        <div class="flex-1 space-y-1">
          <div class="flex items-center gap-3 mb-1">
            <div class="p-2 rounded-full bg-purple-600/10 text-purple-400">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <span class="text-white font-bold text-lg">${escapeHtml(user.email)}</span>
            <span class="px-2.5 py-0.5 text-xs font-bold rounded-full uppercase tracking-wider ${user.role === 'admin' ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300'}">
              ${escapeHtml(user.role)}
            </span>
          </div>
          <div class="text-sm text-gray-400 space-y-1 pl-10">
            <div class="flex items-center gap-2">
              <span class="text-gray-500 text-xs uppercase tracking-tight">Registered:</span>
              <span class="text-gray-300">${formatTimestamp(user.created)}</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-gray-500 text-xs uppercase tracking-tight">Last seen:</span>
              <span class="text-gray-300">${formatTimestamp(user.lastSeen)}</span>
            </div>
            <div class="text-xs text-gray-600 font-mono mt-1 opacity-60">
              ID: ${escapeHtml(user.userId)}
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2 self-start sm:self-auto pl-10 sm:pl-0">
          ${user.role !== 'admin' 
            ? '<span class="text-purple-400 group-hover:translate-x-1 transition-transform">Manage Access →</span>' 
            : '<span class="text-gray-500 italic text-sm">Full Admin Access</span>'}
        </div>
      </div>
    `).join('');

    // Add click handlers to user cards
    document.querySelectorAll('.user-card').forEach(card => {
      card.addEventListener('click', () => {
        const userId = card.dataset.userId;
        const userEmail = card.dataset.userEmail;
        const userRole = card.dataset.userRole;
        showUserAccessView(userId, userEmail, userRole);
      });
    });

  } catch (error) {

    setUsersStatus(`Failed to load users: ${error.message}`, 'error', false);
    usersListDiv.innerHTML = '<p class="text-red-400 text-center py-4">Failed to load users</p>';
  }
}

// Initialize users tab
if (settingsTabUsers) {
  settingsTabUsers.addEventListener('click', () => {
    refreshUsersList();
  });
}

if (refreshUsersBtn) {
  refreshUsersBtn.addEventListener('click', () => {
    refreshUsersList();
  });
}