import { state, escapeHtml } from '../globals.js';

export const escapeHtmlValue = escapeHtml;

export function formatTimestamp(timestamp) {
  if (!timestamp) return 'Never';
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

export function showSettingsMessage(message, type) {
  const statusDiv = document.getElementById('settings-status');
  if (statusDiv) {
    statusDiv.textContent = message;
    statusDiv.className = type === 'success' ? 'text-green-400' : 'text-red-400';
    setTimeout(() => {
      statusDiv.textContent = '';
    }, 3000);
  }
}

state.escapeHtmlValue = escapeHtmlValue;
state.formatTimestamp = formatTimestamp;
state.showSettingsMessage = showSettingsMessage;

if (typeof window !== 'undefined') {
  window.escapeHtmlValue = escapeHtmlValue;
  window.formatTimestamp = formatTimestamp;
  window.showSettingsMessage = showSettingsMessage;
}