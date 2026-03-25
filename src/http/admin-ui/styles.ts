export const ADMIN_UI_STYLES = `
  :root {
    color-scheme: dark;
    --bg: #171514;
    --sidebar: #1b1817;
    --surface: #211e1c;
    --surface-strong: #2a2623;
    --surface-soft: #24211f;
    --line: #3a332e;
    --line-soft: #4a413a;
    --ink: #f3eee8;
    --muted: #b7aea6;
    --accent: #c8744f;
    --accent-soft: rgba(200, 116, 79, 0.14);
    --ok: #88a27e;
    --warn: #d4a15d;
    --err: #cb6b61;
    --shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
  }

  * {
    box-sizing: border-box;
  }

  html {
    background: var(--bg);
  }

  body {
    margin: 0;
    min-height: 100vh;
    background: var(--bg);
    color: var(--ink);
    font-family: "IBM Plex Sans", "Aptos", "Noto Sans", sans-serif;
    line-height: 1.5;
  }

  button,
  input,
  select,
  textarea {
    font: inherit;
  }

  button {
    appearance: none;
    border: 1px solid transparent;
    border-radius: 8px;
    background: var(--accent);
    color: #fff7f1;
    padding: 8px 12px;
    min-height: 38px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    cursor: pointer;
    transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease;
  }

  button:hover:not(:disabled) {
    background: #d3825d;
  }

  button:disabled {
    opacity: 0.55;
    cursor: wait;
  }

  button.secondary {
    background: var(--surface);
    border-color: var(--line);
    color: var(--ink);
  }

  button.secondary:hover:not(:disabled) {
    background: var(--surface-strong);
    border-color: var(--line-soft);
  }

  button.ghost {
    background: transparent;
    border-color: var(--line);
    color: var(--ink);
  }

  button.ghost:hover:not(:disabled) {
    background: var(--surface);
    border-color: var(--line-soft);
  }

  button.warn {
    background: #7a5a2f;
    color: #fff4e2;
  }

  button.warn:hover:not(:disabled) {
    background: #8b6736;
  }

  button.danger {
    background: #8e473f;
    color: #fff0ed;
  }

  button.danger:hover:not(:disabled) {
    background: #a5534a;
  }

  input,
  select,
  textarea {
    width: 100%;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: #1c1918;
    color: var(--ink);
    padding: 10px 12px;
    transition: border-color 140ms ease, box-shadow 140ms ease;
  }

  input::placeholder,
  textarea::placeholder {
    color: #8f857d;
  }

  input:focus,
  select:focus,
  textarea:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(200, 116, 79, 0.18);
  }

  textarea {
    min-height: 72px;
    resize: vertical;
  }

  label {
    display: grid;
    gap: 6px;
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
  }

  strong {
    font-weight: 600;
  }

  .dashboard-shell {
    min-height: 100vh;
    display: grid;
    grid-template-columns: 252px minmax(0, 1fr);
    background: var(--bg);
  }

  .sidebar {
    position: sticky;
    top: 0;
    height: 100vh;
    display: grid;
    grid-template-rows: auto 1fr auto;
    gap: 18px;
    padding: 24px 16px;
    border-right: 1px solid var(--line);
    background: var(--sidebar);
  }

  .sidebar-brand {
    display: grid;
    gap: 4px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--line);
  }

  .sidebar-brand strong {
    font-size: 18px;
  }

  .sidebar-brand span {
    font-size: 13px;
    color: var(--muted);
  }

  .nav-group {
    min-height: 0;
  }

  .nav-list {
    display: grid;
    gap: 4px;
  }

  .nav-item {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    color: var(--ink);
    display: flex;
    align-items: center;
    justify-content: space-between;
    text-align: left;
  }

  .nav-item:hover:not(:disabled) {
    background: var(--surface);
    border-color: var(--line);
  }

  .nav-item[aria-current="page"] {
    background: var(--surface-strong);
    border-color: var(--line-soft);
  }

  .nav-meta {
    min-width: 20px;
    padding-left: 8px;
    color: var(--muted);
    font-size: 12px;
    line-height: 1.4;
    text-align: center;
  }

  .sidebar-status {
    display: grid;
    gap: 10px;
    padding-top: 16px;
    border-top: 1px solid var(--line);
    color: var(--muted);
    font-size: 13px;
  }

  .shell-main {
    min-width: 0;
    display: grid;
    grid-template-rows: auto 1fr;
  }

  .topbar {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 20px 28px;
    border-bottom: 1px solid var(--line);
    background: rgba(23, 21, 20, 0.98);
  }

  .topbar-left {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    min-width: 0;
  }

  .topbar-copy {
    min-width: 0;
  }

  .topbar-copy h1 {
    margin: 0;
    font-size: 28px;
    line-height: 1.15;
  }

  .topbar-copy p {
    margin: 6px 0 0;
    color: var(--muted);
    font-size: 14px;
  }

  .topbar-right {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 10px;
  }

  .topbar-stat {
    min-height: 38px;
    padding: 8px 12px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
    display: grid;
    gap: 2px;
    align-content: center;
  }

  .topbar-stat strong {
    display: block;
    font-size: 15px;
    line-height: 1.2;
  }

  .topbar-stat span {
    color: var(--muted);
    font-size: 12px;
  }

  .notification-toggle {
    white-space: nowrap;
  }

  .sidebar-toggle {
    display: none;
    position: relative;
    width: 40px;
    min-width: 40px;
    padding: 0;
  }

  .sidebar-toggle span,
  .sidebar-toggle span::before,
  .sidebar-toggle span::after {
    display: block;
    width: 16px;
    height: 2px;
    border-radius: 2px;
    background: currentColor;
    content: "";
  }

  .sidebar-toggle span {
    position: relative;
  }

  .sidebar-toggle span::before {
    position: absolute;
    top: -5px;
    left: 0;
  }

  .sidebar-toggle span::after {
    position: absolute;
    top: 5px;
    left: 0;
  }

  .content-area {
    min-width: 0;
    padding: 24px 28px 32px;
  }

  .view {
    display: grid;
    gap: 20px;
    align-content: start;
  }

  .view-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }

  .view-header h1,
  .view-header h2 {
    margin: 0;
    font-size: 22px;
    line-height: 1.2;
  }

  .view-header-actions,
  .jobs-toolbar,
  .worker-toolbar,
  .inline-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }

  .panel {
    min-width: 0;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--surface);
    overflow: hidden;
  }

  .panel-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding: 16px 18px;
    border-bottom: 1px solid var(--line);
    background: var(--surface-soft);
  }

  .panel-head h2,
  .panel-head h3,
  .panel-head h4 {
    margin: 0;
    font-size: 17px;
    line-height: 1.25;
  }

  .panel-body {
    min-width: 0;
    padding: 18px;
  }

  .panel-note,
  .muted,
  .item-meta,
  .profile-meta,
  .section-copy {
    color: var(--muted);
    font-size: 13px;
  }

  .section-stack,
  .data-grid,
  .profile-ops,
  .profile-detail-body,
  .profile-list,
  .item-list {
    display: grid;
    gap: 14px;
    min-width: 0;
  }

  .overview-grid,
  .two-panel-grid,
  .accounts-layout {
    display: grid;
    gap: 18px;
    min-width: 0;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .accounts-layout {
    grid-template-columns: minmax(320px, 360px) minmax(0, 1fr);
    align-items: start;
  }

  .profile-directory,
  .profile-workspace {
    min-height: 100%;
  }

  .profile-workspace,
  .profile-detail-shell {
    min-width: 0;
  }

  .profile-empty-state {
    min-height: 320px;
    display: flex;
    align-items: center;
  }

  .profile-detail-head {
    align-items: flex-start;
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
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  }

  .stats-grid {
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  }

  .lookup-grid,
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
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface-soft);
  }

  .quick-card {
    width: 100%;
    padding: 16px;
    justify-content: flex-start;
    align-items: flex-start;
    text-align: left;
    display: grid;
    gap: 6px;
    background: var(--surface-soft);
    color: var(--ink);
    border-color: var(--line);
  }

  .quick-card:hover:not(:disabled) {
    background: var(--surface-strong);
    border-color: var(--line-soft);
  }

  .quick-card strong {
    font-size: 16px;
  }

  .quick-card span {
    color: var(--muted);
    font-size: 13px;
  }

  .stat-card,
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

  .stat-label,
  .kv-pair .label {
    color: var(--muted);
    font-size: 12px;
    font-weight: 600;
  }

  .stat-label {
    margin-bottom: 8px;
  }

  .stat-value {
    font-size: 30px;
    line-height: 1.05;
    margin-bottom: 6px;
  }

  .stat-subtext,
  .kv-pair .value {
    color: var(--muted);
    font-size: 13px;
  }

  .kv-pair .value {
    display: block;
    margin-top: 6px;
    color: var(--ink);
    line-height: 1.4;
  }

  .mini-panel h4,
  .trigger-card h3,
  .job-title h3,
  .profile-card strong,
  .section-card strong,
  .provider-card strong,
  .item-row strong {
    display: block;
    margin: 0;
    font-size: 15px;
  }

  .trigger-card p {
    margin: 8px 0 14px;
    min-height: 42px;
  }

  .checkbox-row {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    margin-top: 12px;
  }

  .checkbox-row label {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-weight: 500;
  }

  .checkbox-row input {
    width: 16px;
    height: 16px;
    padding: 0;
    margin: 0;
  }

  .message {
    margin-top: 12px;
    padding: 12px 14px;
    border: 1px solid var(--line);
    border-radius: 8px;
    font-size: 13px;
  }

  .message.info {
    background: rgba(200, 116, 79, 0.08);
    border-color: rgba(200, 116, 79, 0.24);
  }

  .message.success {
    background: rgba(136, 162, 126, 0.1);
    border-color: rgba(136, 162, 126, 0.28);
  }

  .message.error {
    background: rgba(203, 107, 97, 0.1);
    border-color: rgba(203, 107, 97, 0.28);
  }

  .data-table-wrap {
    min-width: 0;
    overflow: auto;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface-soft);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  th,
  td {
    padding: 12px 14px;
    text-align: left;
    vertical-align: top;
    border-bottom: 1px solid var(--line);
  }

  th {
    position: sticky;
    top: 0;
    background: #2b2623;
    color: var(--muted);
    font-size: 12px;
    font-weight: 600;
  }

  .code {
    max-height: 280px;
    overflow: auto;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: #181615;
    padding: 14px;
    font-family: "IBM Plex Mono", "Cascadia Code", Consolas, monospace;
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--surface);
    color: var(--muted);
    font-size: 12px;
    line-height: 1.4;
  }

  .badge.ok,
  .badge.success {
    border-color: rgba(136, 162, 126, 0.32);
    background: rgba(136, 162, 126, 0.1);
    color: #d4e3cd;
  }

  .badge.info,
  .badge.running,
  .badge.queued {
    border-color: rgba(200, 116, 79, 0.32);
    background: rgba(200, 116, 79, 0.1);
    color: #efc0ab;
  }

  .badge.warn,
  .badge.canceled,
  .badge.cancelled,
  .badge.expired,
  .badge.revoked {
    border-color: rgba(212, 161, 93, 0.32);
    background: rgba(212, 161, 93, 0.1);
    color: #f3d6aa;
  }

  .badge.err,
  .badge.error,
  .badge.failed {
    border-color: rgba(203, 107, 97, 0.32);
    background: rgba(203, 107, 97, 0.1);
    color: #f4c6c0;
  }

  .job-card {
    display: grid;
    gap: 14px;
  }

  .job-head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
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
    color: var(--muted);
  }

  .job-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .progress {
    height: 8px;
    border-radius: 4px;
    background: #181615;
    overflow: hidden;
  }

  .progress-bar {
    display: block;
    height: 100%;
    background: var(--accent);
  }

  .profile-card.selected {
    border-color: rgba(200, 116, 79, 0.42);
    background: #2b2521;
  }

  .profile-card-actions,
  .section-spacer,
  .section-body,
  .meta-spaced,
  .section-copy {
    margin-top: 10px;
  }

  .empty {
    width: 100%;
    padding: 18px;
    border: 1px dashed var(--line-soft);
    border-radius: 8px;
    color: var(--muted);
    text-align: center;
    background: rgba(255, 255, 255, 0.02);
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
    top: 82px;
    right: 20px;
    width: min(360px, calc(100vw - 32px));
    max-height: min(520px, calc(100vh - 104px));
    display: grid;
    grid-template-rows: auto 1fr;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: #1c1a18;
    box-shadow: var(--shadow);
    overflow: hidden;
    z-index: 40;
  }

  .notification-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
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

  .notification-feed-inline {
    padding: 0;
    overflow: visible;
  }

  .notification-item,
  .toast {
    padding: 12px 14px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface-soft);
  }

  .notification-item.unread {
    border-color: rgba(200, 116, 79, 0.34);
    background: rgba(200, 116, 79, 0.08);
  }

  .notification-item-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
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
    top: 82px;
    right: 20px;
    width: min(360px, calc(100vw - 32px));
    z-index: 45;
    pointer-events: none;
  }

  .toast {
    pointer-events: auto;
    box-shadow: var(--shadow);
  }

  .toast.info {
    border-left: 4px solid var(--accent);
  }

  .toast.success {
    border-left: 4px solid var(--ok);
  }

  .toast.error {
    border-left: 4px solid var(--err);
  }

  .toast.warn {
    border-left: 4px solid var(--warn);
  }

  .sidebar-overlay {
    display: none;
  }

  [hidden] {
    display: none !important;
  }

  @media (max-width: 1180px) {
    .dashboard-shell {
      grid-template-columns: minmax(0, 1fr);
    }

    .sidebar {
      position: fixed;
      top: 0;
      left: 0;
      bottom: 0;
      width: min(320px, 88vw);
      height: 100vh;
      z-index: 30;
      left: calc(-1 * min(320px, 88vw));
      transition: left 180ms ease;
      box-shadow: var(--shadow);
    }

    body.sidebar-open .sidebar {
      left: 0;
    }

    .sidebar-toggle {
      display: inline-flex;
    }

    .sidebar-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.38);
      z-index: 25;
    }

    body.sidebar-open .sidebar-overlay {
      display: block;
    }

    .accounts-layout,
    .overview-grid,
    .two-panel-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 720px) {
    .topbar,
    .content-area {
      padding-left: 16px;
      padding-right: 16px;
    }

    .topbar {
      flex-direction: column;
    }

    .topbar-left,
    .topbar-right,
    .view-header {
      width: 100%;
    }

    .topbar-right,
    .view-header {
      flex-direction: column;
      align-items: stretch;
    }

    .view-header-actions,
    .jobs-toolbar,
    .worker-toolbar,
    .inline-actions {
      width: 100%;
    }

    .view-header-actions > *,
    .jobs-toolbar > *,
    .worker-toolbar > *,
    .inline-actions > * {
      flex: 1 1 auto;
    }

    .panel-head,
    .profile-detail-head,
    .notification-head {
      flex-direction: column;
      align-items: stretch;
    }

    .notification-panel,
    .toast-stack {
      right: 12px;
      width: min(360px, calc(100vw - 24px));
    }

    .stats-grid,
    .quick-grid,
    .trigger-grid,
    .lookup-grid,
    .provider-grid,
    .kv-grid {
      grid-template-columns: 1fr;
    }
  }
`;
