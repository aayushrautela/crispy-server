import { ADMIN_UI_CLIENT } from './client.js';
import { ADMIN_UI_STYLES } from './styles.js';
import { renderAdminViews } from './views/index.js';

export function renderAdminPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Crispy Control Plane</title>
  <link rel="icon" href="data:,">
  <style>${ADMIN_UI_STYLES}</style>
</head>
<body>
  <div class="dashboard-shell">
    <aside class="sidebar" id="admin-sidebar" aria-label="Admin sidebar">
      <div class="sidebar-brand">
        <div class="brand-kicker">Crispy Control Plane</div>
        <strong>Crispy Ops</strong>
        <span>API-hosted admin shell inspired by dashboard workflows, without dragging in a full template stack.</span>
      </div>

      <div class="nav-group">
        <div class="nav-section-title">Workspaces</div>
        <nav class="nav-list" aria-label="Workspace navigation">
          <button type="button" class="nav-item" data-nav-target="overview" aria-current="page">
            <span>
              <strong>Overview</strong>
              <small>Health, activity, quick lanes</small>
            </span>
            <span class="nav-badge">Home</span>
          </button>
          <button type="button" class="nav-item" data-nav-target="jobs">
            <span>
              <strong>Worker Jobs</strong>
              <small>Triggers, progress, queue control</small>
            </span>
            <span class="nav-badge" id="nav-jobs-badge">0</span>
          </button>
          <button type="button" class="nav-item" data-nav-target="diagnostics">
            <span>
              <strong>Diagnostics</strong>
              <small>Backlog, lag, token health</small>
            </span>
            <span class="nav-badge" id="nav-diagnostics-badge">0</span>
          </button>
          <button type="button" class="nav-item" data-nav-target="accounts">
            <span>
              <strong>Accounts</strong>
              <small>Lookup accounts and profile ops</small>
            </span>
            <span class="nav-badge" id="nav-accounts-badge">Find</span>
          </button>
          <button type="button" class="nav-item" data-nav-target="worker-control">
            <span>
              <strong>Worker Control</strong>
              <small>Bridge state and raw payload</small>
            </span>
            <span class="nav-badge" id="nav-bridge-badge">Check</span>
          </button>
        </nav>
      </div>

      <div class="sidebar-status">
        <div class="status-card">
          <span class="status-label">Running jobs</span>
          <div class="status-value" id="sidebar-running-status">Checking worker queue...</div>
        </div>
        <div class="status-card">
          <span class="status-label">Worker link</span>
          <div class="status-value" id="sidebar-bridge-status">Checking worker control...</div>
        </div>
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
          <div class="topbar-chip"><strong id="topbar-running-count">0</strong><span>running or queued</span></div>
          <div class="topbar-chip" id="worker-control-pill"><strong>Checking</strong><span>worker status</span></div>
          <div class="topbar-chip"><strong id="topbar-last-update">Starting</strong><span>last refresh</span></div>
          <button type="button" class="secondary notification-toggle" id="notifications-toggle">
            Notifications
            <span class="notification-dot" id="notifications-unread" hidden>0</span>
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
        <p class="panel-note">Meaningful worker and control-plane events only.</p>
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
