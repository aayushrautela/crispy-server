export const ADMIN_UI_STYLES = `
  :root {
    --bg: #0f172a;
    --panel: #1e293b;
    --panel-strong: #334155;
    --panel-muted: #1e293b;
    --sidebar: #0f172a;
    --sidebar-soft: #1e293b;
    --ink: #f1f5f9;
    --muted: #94a3b8;
    --line: #334155;
    --accent: #38bdf8;
    --accent-strong: #0284c7;
    --accent-soft: rgba(56, 189, 248, 0.12);
    --ok: #10b981;
    --info: #3b82f6;
    --warn: #f59e0b;
    --err: #ef4444;
    --shadow: none;
    --shadow-soft: none;
  }

  * { box-sizing: border-box; }
  html, body {
    font-family: system-ui, -apple-system, sans-serif;
    color: var(--ink);
    background: var(--bg);
  }



  

  button, input, select, textarea {
    width: 100%;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--bg);
    color: var(--ink);
    padding: 8px 12px;
  }

  .dashboard-shell {
    display: flex;
    min-height: 100vh;
  }

  .sidebar {
    width: 250px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    padding: 24px 16px;
    border-right: 1px solid var(--line);
    background: var(--bg);
    height: 100vh;
    position: sticky;
    top: 0;
  }

  .sidebar-brand {
    display: grid;
    gap: 6px;
    padding-bottom: 16px;
    border-bottom: 1px solid rgba(255, 242, 225, 0.08);
  }



  .view-header h1 {
    font-size: 24px;
    margin: 0;
    font-weight: 600;
  }

  .panel-head h2,
  .panel-head h3 {
    font-size: 20px;
    line-height: 1.1;
  }

  .view-hero p,
  .panel-note {
    margin: 8px 0 0;
    max-width: 780px;
    color: var(--muted);
    font-size: 14px;
  }

  .hero-actions,
  .jobs-toolbar,
  .worker-toolbar,
  .inline-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }

  .panel {
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--panel);
    overflow: hidden;
  }

  .panel-head {
    padding: 16px 20px;
    border-bottom: 1px solid var(--line);
    background: var(--panel);
  }

  .panel-body {
    padding: 18px 20px 20px;
    min-width: 0;
  }

  .section-stack,
  .data-grid,
  .profile-ops,
  .profile-detail-body {
    display: grid;
    gap: 14px;
    min-width: 0;
  }

  .overview-grid,
  .two-panel-grid,
  .accounts-layout {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 18px;
    min-width: 0;
  }

  .accounts-layout {
    grid-template-columns: minmax(320px, 0.9fr) minmax(0, 1.35fr);
    align-items: start;
  }

  .profile-directory,
  .profile-workspace {
    min-height: 100%;
  }

  .profile-workspace {
    min-width: 0;
  }

  .profile-empty-state {
    min-height: 320px;
    display: flex;
    align-items: center;
  }

  .profile-detail-head {
    align-items: start;
  }

  .quick-grid,
  .trigger-grid,
  .stats-grid,
  .lookup-grid,
  .provider-grid,
  .kv-grid {
    display: grid;
    gap: 14px;
  }

  .quick-grid {
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  }

  .trigger-grid {
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  }

  .stats-grid {
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  }

  .lookup-grid {
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  }

  .provider-grid {
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  }

  .kv-grid {
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  }

  .quick-card,
  .trigger-card,
  .stat-card,
  .mini-panel,
  .profile-card,
  .provider-card,
  .section-card,
  .job-card,
  .item-row,
  .kv-pair {
    border: 1px solid rgba(91, 70, 48, 0.12);
    border-radius: 6px;
    background: rgba(255, 250, 241, 0.9);
  }

  .quick-card {
    display: grid;
    gap: 8px;
    padding: 18px;
    text-align: left;
    box-shadow: none;
  }

  .quick-card strong {
    font-size: 18px;
  }

  .quick-card span {
    color: var(--muted);
    font-size: 13px;
  }

  .quick-card:hover {
    transform: translateY(-2px);
  }

  .stat-card {
    padding: 16px;
  }

  .stat-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    color: var(--muted);
    margin-bottom: 8px;
  }

  .stat-value {
    font-size: 34px;
    line-height: 1;
    margin-bottom: 6px;
  }

  .stat-subtext {
    color: var(--muted);
    font-size: 13px;
  }

  .mini-panel,
  .profile-card,
  .provider-card,
  .section-card,
  .item-row,
  .kv-pair,
  .trigger-card,
  .job-card {
    padding: 14px;
  }

  .mini-panel h4,
  .trigger-card h3,
  .job-title h3,
  .profile-card strong,
  .section-card strong {
    margin: 0;
    font-size: 16px;
  }

  .mini-panel p,
  .trigger-card p,
  .muted,
  .item-meta,
  .profile-meta {
    color: var(--muted);
    font-size: 13px;
  }

  .trigger-card p {
    margin-top: 8px;
    margin-bottom: 14px;
    min-height: 54px;
  }

  label {
    gap: 6px;
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
    display: grid;
  }

  input, select, textarea {
    width: 100%;
    border: 1px solid rgba(91, 70, 48, 0.16);
    border-radius: 6px;
    background: rgba(255, 252, 247, 0.95);
    color: var(--ink);
    padding: 10px 12px;
  }

  textarea { min-height: 72px; resize: vertical; }

  .checkbox-row {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    margin-top: 12px;
  }

  .checkbox-row label {
    display: inline-flex;
    flex-direction: row;
    align-items: center;
    gap: 8px;
    text-transform: none;
    letter-spacing: normal;
    font-size: 13px;
  }

  button {
    border: 1px solid transparent;
    border-radius: 6px;
    background: var(--panel-strong);
    color: var(--ink);
    padding: 6px 12px;
    font-size: 13px;
    cursor: pointer;
  }

  button.secondary {
    background: rgba(255, 250, 240, 0.92);
    color: var(--ink);
    border: 1px solid rgba(91, 70, 48, 0.14);
    box-shadow: none;
  }

  button.ghost {
    background: transparent;
    color: var(--accent-strong);
    border: 1px solid rgba(182, 77, 46, 0.24);
    box-shadow: none;
  }

  button.warn {
    background: var(--warn);
    color: #fff7f3;
  }

  button.danger {
    background: var(--err);
    color: #fff7f3;
  }

  button:disabled {
    opacity: 0.55;
    cursor: wait;
    transform: none;
  }

  button:hover:not(:disabled) {
    transform: translateY(-1px);
  }

  .message {
    margin-top: 12px;
    padding: 12px 14px;
    border-radius: 6px;
    border: 1px solid transparent;
    font-size: 13px;
  }

  .message.info { background: rgba(56, 113, 156, 0.08); border-color: rgba(56, 113, 156, 0.16); }
  .message.success { background: rgba(47, 122, 77, 0.09); border-color: rgba(47, 122, 77, 0.18); }
  .message.error { background: rgba(160, 60, 57, 0.09); border-color: rgba(160, 60, 57, 0.18); }

  .data-table-wrap {
    overflow: auto;
    border: 1px solid rgba(91, 70, 48, 0.12);
    border-radius: 6px;
    background: rgba(255, 250, 240, 0.84);
    min-width: 0;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  th, td {
    text-align: left;
    padding: 12px 14px;
    border-bottom: 1px solid rgba(91, 70, 48, 0.08);
    vertical-align: top;
  }

  th {
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted);
    background: rgba(247, 239, 225, 0.86);
    position: sticky;
    top: 0;
  }

  .code {
    font-family: "SFMono-Regular", "Cascadia Code", Consolas, monospace;
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-word;
    background: rgba(255, 250, 240, 0.92);
    border: 1px solid rgba(91, 70, 48, 0.12);
    border-radius: 6px;
    padding: 14px;
    max-height: 280px;
    overflow: auto;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 999px;
    background: rgba(89, 69, 48, 0.08);
    color: var(--muted);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }

  .badge.ok, .badge.success { background: rgba(47, 122, 77, 0.12); color: var(--ok); }
  .badge.info, .badge.running { background: rgba(56, 113, 156, 0.1); color: var(--info); }
  .badge.warn, .badge.canceled, .badge.cancelled { background: rgba(163, 106, 24, 0.12); color: var(--warn); }
  .badge.err, .badge.error { background: rgba(160, 60, 57, 0.12); color: var(--err); }
  .badge.queued { background: rgba(107, 98, 87, 0.12); color: var(--muted); }

  .job-card {
    display: grid;
    gap: 14px;
  }

  .job-head {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    justify-content: space-between;
    align-items: start;
  }

  .job-title {
    display: grid;
    gap: 8px;
  }

  .job-meta,
  .item-meta,
  .profile-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    font-size: 12px;
  }

  .job-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .progress {
    height: 10px;
    border-radius: 999px;
    background: rgba(89, 69, 48, 0.08);
    overflow: hidden;
  }

  .progress > span {
    display: block;
    height: 100%;
    background: var(--accent);
  }

  .profile-list,
  .item-list {
    display: grid;
    gap: 10px;
  }

  .profile-card strong,
  .item-row strong {
    display: block;
    margin-bottom: 4px;
  }

  .kv-pair .label {
    display: block;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--muted);
  }

  .kv-pair .value {
    display: block;
    font-size: 13px;
    margin-top: 4px;
    line-height: 1.4;
  }

  .empty {
    width: 100%;
    padding: 18px;
    border-radius: 6px;
    background: rgba(255, 250, 240, 0.8);
    border: 1px dashed rgba(91, 70, 48, 0.22);
    color: var(--muted);
    text-align: center;
  }

  .loading {
    opacity: 0.7;
    pointer-events: none;
  }

  .narrow-panel {
    max-width: 960px;
  }

  .notification-panel {
    position: fixed;
    top: 90px;
    right: 20px;
    width: min(360px, calc(100vw - 32px));
    max-height: min(520px, calc(100vh - 120px));
    display: grid;
    grid-template-rows: auto 1fr;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: rgba(255, 249, 241, 0.96);
    
    box-shadow: none;
    overflow: hidden;
    z-index: 40;
  }

  .notification-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 16px 18px;
    border-bottom: 1px solid var(--line);
  }

  .notification-head h3 {
    margin: 0;
    font-size: 18px;
  }

  .notification-feed,
  .toast-stack {
    display: grid;
    gap: 10px;
  }

  .notification-feed {
    padding: 14px;
    overflow: auto;
  }

  .notification-item,
  .toast {
    padding: 12px 14px;
    border-radius: 6px;
    border: 1px solid rgba(91, 70, 48, 0.1);
    background: rgba(255, 250, 241, 0.92);
  }

  .notification-item.unread {
    border-color: rgba(196, 93, 52, 0.24);
    background: rgba(255, 242, 230, 0.96);
  }

  .notification-item-head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: center;
    margin-bottom: 6px;
  }

  .notification-item strong,
  .toast strong {
    font-size: 14px;
  }

  .notification-item p,
  .toast p {
    margin: 0;
    color: var(--muted);
    font-size: 13px;
  }

  .toast-stack {
    position: fixed;
    top: 90px;
    right: 20px;
    width: min(360px, calc(100vw - 32px));
    z-index: 45;
    pointer-events: none;
  }

  .toast {
    pointer-events: auto;
    box-shadow: none;
  }

  .toast.info { border-left: 4px solid var(--info); }
  .toast.success { border-left: 4px solid var(--ok); }
  .toast.error { border-left: 4px solid var(--err); }
  .toast.warn { border-left: 4px solid var(--warn); }

  .sidebar-overlay {
    display: none;
  }

  [hidden] { display: none !important; }

  @media (max-width: 1180px) {
    .accounts-layout,
    .overview-grid,
    .two-panel-grid {
      grid-template-columns: 1fr;
    }

    .dashboard-shell {
      grid-template-columns: 1fr;
    }

    .sidebar {
      position: fixed;
      top: 0;
      left: 0;
      bottom: 0;
      width: min(320px, 88vw);
      max-height: none;
      border-radius: 0 28px 28px 0;
      transform: translateX(calc(-100% - 16px));
      transition: transform 180ms ease;
    }

    body.sidebar-open .sidebar {
      transform: translateX(0);
    }

    .sidebar-toggle {
      display: inline-flex;
    }

    .sidebar-overlay {
      position: fixed;
      inset: 0;
      background: rgba(27, 18, 10, 0.34);
      z-index: 19;
    }

    body.sidebar-open .sidebar-overlay {
      display: block;
    }

    .topbar {
    position: sticky;
    top: 0;
    z-index: 15;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 24px;
    border-bottom: 1px solid var(--line);
    background: var(--bg);
  }
  }

  @media (max-width: 720px) {
    .dashboard-shell {
      padding: 12px;
      gap: 12px;
    }

    .topbar,
    .view-hero,
    .panel-head,
    .panel-body {
      padding-left: 16px;
      padding-right: 16px;
    }

    .topbar {
      align-items: start;
    }

    .topbar-left,
    .topbar-right,
    .view-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
  }

    .topbar-right {
      justify-content: flex-start;
    }

    .notification-panel,
    .toast-stack {
      right: 12px;
      width: min(360px, calc(100vw - 24px));
    }
  }
`;
