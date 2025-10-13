// --- AUTHENTICATION & LOGOUT ---

/**
 * Handle user logout
 * Redirects to Cloudflare Access logout endpoint which clears the HttpOnly cookies
 */
function handleLogout() {
  if (confirm('Are you sure you want to log out?')) {
    // Clear local storage
    localStorage.clear();

    // Clear IndexedDB for offline data
    if (window.offlineManager) {
      window.offlineManager.clearAllDownloads().catch(() => {
        // Failed to clear offline data
      });
    }

    // Redirect to Cloudflare Access logout endpoint
    // This will clear the HttpOnly cookies that JavaScript cannot access
    // After logout, redirect back to the app
    const returnUrl = window.location.origin + window.location.pathname;
    const teamDomain = window.APP_CONFIG?.cloudflareTeamDomain;

    if (teamDomain) {
      window.location.href = `https://${teamDomain}/cdn-cgi/access/logout?redirect_url=${encodeURIComponent(returnUrl)}`;
    } else {
      // Fallback if team domain not configured
      window.location.href = returnUrl;
    }
  }
}

/**
 * Initialize auth UI based on user context
 * Show/hide logout button based on auth status
 */
function initAuthUI() {
  const logoutButton = document.getElementById('logout-button');

  if (!logoutButton) {
    return;
  }

  // Check auth status from APP_CONFIG (injected by server)
  const authEnabled = window.APP_CONFIG?.authEnabled === true;

  if (authEnabled) {
    logoutButton.classList.remove('hidden');
  } else {
    logoutButton.classList.add('hidden');
  }
}

// Initialize auth UI when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAuthUI);
} else {
  initAuthUI();
}
