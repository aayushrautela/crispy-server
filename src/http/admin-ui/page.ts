import { ADMIN_UI_CLIENT } from './client.js';
import { ADMIN_UI_STYLES } from './styles.js';
import { renderAdminViews } from './views/index.js';

export function renderAdminPage(): string {
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
<body data-admin-api-base="/admin/api">
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
            <span>Worker Jobs</span>
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
            <span>Worker Control</span>
            <span class="nav-meta" id="nav-bridge-badge">check</span>
          </button>
        </nav>
      </div>

      <div class="sidebar-status">
        <div id="sidebar-running-status">Checking worker queue...</div>
        <div id="sidebar-bridge-status">Checking worker control...</div>
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
          <div class="topbar-stat" id="worker-control-pill"><strong>Checking</strong><span>worker status</span></div>
          <div class="topbar-stat"><strong id="topbar-last-update">Starting</strong><span>last update</span></div>
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
        <p class="panel-note">Worker and control-plane events.</p>
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
