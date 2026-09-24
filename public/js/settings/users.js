import { state, escapeHtml } from '../globals.js';
import { formatTimestamp } from './shared.js';

// --- USER MANAGEMENT ---
export const settingsTabUsers = document.getElementById('settings-tab-users');
export const refreshUsersBtn = document.getElementById('refresh-users-btn');
export const usersStatusDiv = document.getElementById('users-status');
export const usersListDiv = document.getElementById('users-list');

export function setUsersStatus(message, type = 'info', showSpinner = false) {
  if (!usersStatusDiv) return;
  usersStatusDiv.textContent = message;
  usersStatusDiv.className = `text-sm mb-3 ${type === 'error' ? 'text-red-400' : 'text-gray-400'}`;
}

export async function refreshUsersList() {
  if (!usersListDiv) return;

  try {
    setUsersStatus('Loading users...', 'info', true);

    const apiBaseUrl = state.API_BASE_URL || window.API_BASE_URL || '';
    const response = await fetch(`${apiBaseUrl}/api/v1/users`);
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
        <div class="flex-1 min-w-0 space-y-1">
          <div class="flex flex-wrap items-center gap-2 mb-1 min-w-0">
            <div class="p-2 rounded-full bg-purple-600/10 text-purple-400 flex-shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <span class="text-white font-bold text-base sm:text-lg break-all sm:break-words">${escapeHtml(user.email)}</span>
            <span class="px-2.5 py-0.5 text-xs font-bold rounded-full uppercase tracking-wider ${user.role === 'admin' ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300'} flex-shrink-0">
              ${escapeHtml(user.role)}
            </span>
          </div>
          <div class="text-sm text-gray-400 space-y-1 pl-0 sm:pl-10">
            <div class="flex items-center gap-2">
              <span class="text-gray-500 text-xs uppercase tracking-tight">Registered:</span>
              <span class="text-gray-300">${formatTimestamp(user.created)}</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-gray-500 text-xs uppercase tracking-tight">Last seen:</span>
              <span class="text-gray-300">${formatTimestamp(user.lastSeen)}</span>
            </div>
            <div class="text-xs text-gray-500 font-mono mt-1 break-all">
              ID: ${escapeHtml(user.userId)}
            </div>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2 self-start sm:self-auto pl-10 sm:pl-0">
          <button class="user-permissions-btn px-3 py-1.5 text-xs font-semibold rounded-lg bg-purple-600/20 text-purple-300 hover:bg-purple-600/40 border border-purple-500/30 transition-colors flex items-center gap-1.5" title="Edit Permissions">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span>Edit Permissions</span>
          </button>
          <button class="user-stats-btn px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600/20 text-blue-300 hover:bg-blue-600/40 border border-blue-500/30 transition-colors flex items-center gap-1.5" title="View Reading Stats">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <span>Stats</span>
          </button>
          ${user.role !== 'admin'
            ? `<button class="user-impersonate-btn px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-500/20 text-amber-300 hover:bg-amber-500/40 border border-amber-500/30 transition-colors flex items-center gap-1.5" title="Log in as user">
                <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                </svg>
                <span>Login as</span>
              </button>`
            : ''}
        </div>
      </div>
    `).join('');

    // Add click handlers to user cards
    document.querySelectorAll('.user-card').forEach(card => {
      const userId = card.dataset.userId;
      const userEmail = card.dataset.userEmail;
      const userRole = card.dataset.userRole;

      // Card body → manage access
      card.addEventListener('click', () => {
        const showUserAccess = state.showUserAccessView || window.showUserAccessView;
        if (typeof showUserAccess === 'function') {
          showUserAccess(userId, userEmail, userRole);
        }
      });

      // Edit Permissions button
      const permBtn = card.querySelector('.user-permissions-btn');
      if (permBtn) {
        permBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const showUserAccess = state.showUserAccessView || window.showUserAccessView;
          if (typeof showUserAccess === 'function') {
            showUserAccess(userId, userEmail, userRole);
          }
        });
      }

      // Stats button
      const statsBtn = card.querySelector('.user-stats-btn');
      if (statsBtn) {
        statsBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const showStats = state.showUserStatsView || window.showUserStatsView;
          if (typeof showStats === 'function') showStats(userId, userEmail);
        });
      }

      // Login-as (impersonate) button
      const impBtn = card.querySelector('.user-impersonate-btn');
      if (impBtn) {
        impBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!confirm(`Log in as ${userEmail}?\n\nYou will see the app exactly as they do (read-only). They will not be notified. An audit entry is recorded.`)) return;
          const start = state.startImpersonation || window.startImpersonation;
          if (typeof start === 'function') start(userId, userEmail);
        });
      }
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

state.settingsTabUsers = settingsTabUsers;
state.refreshUsersBtn = refreshUsersBtn;
state.usersStatusDiv = usersStatusDiv;
state.usersListDiv = usersListDiv;
state.setUsersStatus = setUsersStatus;
state.refreshUsersList = refreshUsersList;

if (typeof window !== 'undefined') {
  window.settingsTabUsers = settingsTabUsers;
  window.refreshUsersBtn = refreshUsersBtn;
  window.usersStatusDiv = usersStatusDiv;
  window.usersListDiv = usersListDiv;
  window.setUsersStatus = setUsersStatus;
  window.refreshUsersList = refreshUsersList;
}