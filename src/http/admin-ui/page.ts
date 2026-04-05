import { ADMIN_UI_CLIENT } from './client.js';
import { ADMIN_UI_STYLES } from './styles.js';
import { renderAdminViews } from './views/index.js';

export function renderAdminPage(options: { csrfToken: string; logoutToken: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <meta name="theme-color" content="#171514">
  <title>Crispy Control Plane</title>
  <link rel="icon" href="data:,">
  <style>${ADMIN_UI_STYLES}</style>
</head>
<body data-admin-api-base="/admin/api" data-admin-csrf="${escapeHtml(options.csrfToken)}">
  <div class="dashboard-shell">
    <aside class="sidebar" id="admin-sidebar" aria-label="Admin sidebar">
      <div class="sidebar-brand">
        <strong>Crispy Ops</strong>
        <span>Admin workspace</span>
      </div>

      <div class="nav-group">
        <nav class="nav-list" aria-label="Workspace navigation">
          <button type="button" class="nav-item" data-nav-target="overview" aria-current="page">
            <span>Overview</span>
          </button>
          <button type="button" class="nav-item" data-nav-target="jobs">
            <span>Recommendation Jobs</span>
            <span class="nav-meta" id="nav-jobs-badge">0</span>
          </button>
          <button type="button" class="nav-item" data-nav-target="diagnostics">
            <span>Diagnostics</span>
            <span class="nav-meta" id="nav-diagnostics-badge">0</span>
          </button>
          <button type="button" class="nav-item" data-nav-target="accounts">
            <span>Accounts</span>
            <span class="nav-meta" id="nav-accounts-badge">0</span>
          </button>
          <button type="button" class="nav-item" data-nav-target="worker-control">
            <span>Worker Bridge</span>
            <span class="nav-meta" id="nav-bridge-badge">check</span>
          </button>
        </nav>
      </div>

      <div class="sidebar-status">
        <div id="sidebar-running-status">Checking recommendation jobs...</div>
        <div id="sidebar-bridge-status">Checking worker bridge...</div>
      </div>
    </aside>

    <button type="button" class="sidebar-overlay" id="sidebar-overlay" aria-label="Close sidebar"></button>

    <div class="shell-main">
      <header class="topbar">
        <div class="topbar-left">
          <button type="button" class="sidebar-toggle secondary" id="sidebar-toggle" aria-label="Toggle sidebar"><span></span></button>
          <div class="topbar-copy">
            <h1 id="current-view-title">Overview</h1>
            <p id="current-view-description">System health, live worker activity, and quick access to the main control surfaces.</p>
          </div>
        </div>

        <div class="topbar-right">
          <div class="topbar-stat"><strong id="topbar-running-count">0</strong><span>running or queued</span></div>
          <div class="topbar-stat" id="worker-control-pill"><strong>Checking</strong><span>worker bridge</span></div>
          <div class="topbar-stat"><strong id="topbar-last-update">Starting</strong><span>last update</span></div>
          <form method="post" action="/admin/logout" class="logout-form">
            <input type="hidden" name="csrfToken" value="${escapeHtml(options.logoutToken)}">
            <button type="submit" class="secondary">Log out</button>
          </form>
          <button type="button" class="secondary notification-toggle" id="notifications-toggle">
            Notifications
            <span class="nav-meta" id="notifications-unread" hidden>0</span>
          </button>
        </div>
      </header>

      <main class="content-area">
        ${renderAdminViews()}
      </main>
    </div>
  </div>

  <section class="notification-panel" id="notification-panel" hidden>
    <div class="notification-head">
      <div>
        <h3>Notifications</h3>
            <p class="panel-note">Worker, recommendation, and import events.</p>
      </div>
      <button type="button" class="secondary" id="notifications-clear">Mark all read</button>
    </div>
    <div class="notification-feed" id="notification-feed"></div>
  </section>

  <div class="toast-stack" id="toast-stack" aria-live="polite" aria-atomic="true"></div>

  <script>${ADMIN_UI_CLIENT}</script>
</body>
</html>`;
}

export function renderAdminLoginPage(options: { formToken: string; error?: string | null; unavailableReason?: string | null }): string {
  const message = options.unavailableReason || options.error || '';
  const messageClass = options.unavailableReason ? 'login-message error' : options.error ? 'login-message warn' : 'login-message';
  const disabled = options.unavailableReason ? ' disabled' : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <meta name="theme-color" content="#171514">
  <title>Crispy Admin Login</title>
  <link rel="icon" href="data:,">
  <style>${ADMIN_UI_STYLES}</style>
</head>
<body>
  <main class="login-shell">
    <section class="login-card" aria-labelledby="admin-login-title">
      <div class="login-copy">
        <p class="eyebrow">Crispy Ops</p>
        <h1 id="admin-login-title">Admin login</h1>
        <p class="login-note">Sign in with the dedicated admin credentials. The session cookie stays on <code>/admin</code>, is <code>HttpOnly</code>, and expires automatically.</p>
      </div>
      <form method="post" action="/admin/login" class="login-form">
        <input type="hidden" name="formToken" value="${escapeHtml(options.formToken)}">
        <label>
          Username
          <input type="text" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required${disabled}>
        </label>
        <label>
          Password
          <input type="password" name="password" autocomplete="current-password" required${disabled}>
        </label>
        ${message ? `<p class="${messageClass}" role="alert">${escapeHtml(message)}</p>` : ''}
        <button type="submit"${disabled}>Sign in</button>
      </form>
    </section>
  </main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
