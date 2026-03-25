export const ADMIN_UI_STYLES = `
  :root {
    --bg: #efe6d7;
    --bg-deep: #dfcfb7;
    --panel: rgba(255, 250, 241, 0.88);
    --panel-strong: #fffaf1;
    --panel-muted: rgba(247, 239, 225, 0.86);
    --sidebar: rgba(55, 42, 31, 0.94);
    --sidebar-soft: rgba(255, 244, 226, 0.08);
    --ink: #1f1a15;
    --muted: #6f6458;
    --line: rgba(84, 61, 39, 0.16);
    --accent: #c45d34;
    --accent-strong: #9f401d;
    --accent-soft: rgba(196, 93, 52, 0.12);
    --ok: #2d7d52;
    --info: #2b699a;
    --warn: #a36a18;
    --err: #a03c39;
    --shadow: 0 24px 70px rgba(71, 45, 23, 0.14);
    --shadow-soft: 0 16px 34px rgba(71, 45, 23, 0.1);
  }

  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; min-height: 100%; }

  body {
    font-family: Georgia, "Iowan Old Style", "Palatino Linotype", serif;
    color: var(--ink);
    background:
      radial-gradient(circle at top left, rgba(232, 190, 127, 0.4), transparent 26%),
      radial-gradient(circle at bottom right, rgba(161, 82, 46, 0.18), transparent 24%),
      linear-gradient(180deg, #f8f1e4 0%, var(--bg) 56%, var(--bg-deep) 100%);
  }

  body::before {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    background-image:
      linear-gradient(rgba(123, 91, 58, 0.035) 1px, transparent 1px),
      linear-gradient(90deg, rgba(123, 91, 58, 0.03) 1px, transparent 1px);
    background-size: 32px 32px;
    opacity: 0.55;
  }

  button, input, select, textarea { font: inherit; }

  .dashboard-shell {
    position: relative;
    display: grid;
    grid-template-columns: 292px minmax(0, 1fr);
    gap: 20px;
    min-height: 100vh;
    padding: 20px;
  }

  .sidebar {
    position: sticky;
    top: 20px;
    display: grid;
    gap: 18px;
    align-self: start;
    max-height: calc(100vh - 40px);
    overflow: auto;
    padding: 22px 18px 18px;
    border: 1px solid rgba(255, 242, 225, 0.08);
    border-radius: 28px;
    background:
      linear-gradient(180deg, rgba(68, 52, 39, 0.98), rgba(44, 33, 23, 0.98));
    box-shadow: var(--shadow);
    color: #f7ead9;
    z-index: 20;
  }

  .sidebar-brand {
    display: grid;
    gap: 6px;
    padding-bottom: 16px;
    border-bottom: 1px solid rgba(255, 242, 225, 0.08);
  }

  .brand-kicker,
  .nav-section-title,
  .status-label,
  .stat-label,
  label,
  .pill,
  .badge,
  .topbar-chip,
  .nav-item small {
    font-family: "Trebuchet MS", "Gill Sans", sans-serif;
  }

  .brand-kicker {
    letter-spacing: 0.16em;
    text-transform: uppercase;
    font-size: 11px;
    color: rgba(247, 234, 217, 0.72);
  }

  .sidebar-brand strong {
    font-size: 28px;
    line-height: 0.95;
    font-weight: 600;
  }

  .sidebar-brand span {
    color: rgba(247, 234, 217, 0.72);
    font-size: 13px;
  }

  .nav-group {
    display: grid;
    gap: 10px;
  }

  .nav-section-title {
    font-size: 11px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: rgba(247, 234, 217, 0.56);
    padding: 0 10px;
  }

  .nav-list {
    display: grid;
    gap: 8px;
  }

  .nav-item {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    border: 1px solid transparent;
    border-radius: 18px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    box-shadow: none;
    text-align: left;
  }

  .nav-item > span {
    display: grid;
    gap: 4px;
  }

  .nav-item strong {
    font-size: 15px;
    font-weight: 600;
  }

  .nav-item small {
    color: rgba(247, 234, 217, 0.66);
    font-size: 12px;
  }

  .nav-item:hover,
  .nav-item[aria-current="page"] {
    background: linear-gradient(135deg, rgba(255, 245, 231, 0.14), rgba(196, 93, 52, 0.18));
    border-color: rgba(255, 242, 225, 0.08);
    transform: none;
  }

  .nav-item[aria-current="page"] .nav-badge {
    background: rgba(255, 242, 225, 0.18);
    color: #fff6ea;
  }

  .nav-badge {
    min-width: 34px;
    padding: 4px 8px;
    border-radius: 999px;
    background: rgba(255, 242, 225, 0.1);
    color: rgba(247, 234, 217, 0.82);
    font-size: 11px;
    text-align: center;
  }

  .sidebar-status {
    display: grid;
    gap: 10px;
    margin-top: auto;
  }

  .status-card {
    padding: 14px;
    border-radius: 18px;
    background: rgba(255, 244, 226, 0.08);
    border: 1px solid rgba(255, 242, 225, 0.08);
  }

  .status-label {
    display: block;
    margin-bottom: 6px;
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: rgba(247, 234, 217, 0.56);
  }

  .status-value {
    font-size: 14px;
    color: #fff4e3;
  }

  .shell-main {
    min-width: 0;
    display: grid;
    gap: 16px;
    align-content: start;
  }

  .topbar {
    position: sticky;
    top: 20px;
    z-index: 15;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    padding: 14px 18px;
    border: 1px solid var(--line);
    border-radius: 24px;
    background: rgba(255, 248, 239, 0.84);
    backdrop-filter: blur(14px);
    box-shadow: var(--shadow-soft);
  }

  .topbar-left,
  .topbar-right {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .sidebar-toggle {
    display: none;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border-radius: 14px;
    box-shadow: none;
  }

  .sidebar-toggle span,
  .sidebar-toggle span::before,
  .sidebar-toggle span::after {
    display: block;
    width: 18px;
    height: 2px;
    border-radius: 999px;
    background: currentColor;
    content: "";
    position: relative;
  }

  .sidebar-toggle span::before { top: -6px; position: absolute; }
  .sidebar-toggle span::after { top: 6px; position: absolute; }

  .topbar-copy {
    min-width: 0;
  }

  .topbar-copy h1 {
    margin: 0;
    font-size: 28px;
    line-height: 1;
    font-weight: 600;
  }

  .topbar-copy p {
    margin: 4px 0 0;
    color: var(--muted);
    font-size: 13px;
  }

  .topbar-right {
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .topbar-chip,
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: rgba(255, 252, 247, 0.92);
    color: var(--muted);
    font-size: 12px;
  }

  .topbar-chip strong {
    color: var(--ink);
    font-weight: 600;
  }

  .notification-toggle {
    position: relative;
    box-shadow: none;
  }

  .notification-dot {
    position: absolute;
    top: 6px;
    right: 8px;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--accent);
    color: #fff6ea;
    font-size: 11px;
    line-height: 18px;
    text-align: center;
  }

  .content-area {
    min-width: 0;
    display: grid;
    gap: 18px;
  }

  .view {
    display: grid;
    gap: 18px;
    min-width: 0;
  }

  .view-hero {
    display: flex;
    justify-content: space-between;
    align-items: end;
    gap: 16px;
    padding: 24px 26px;
    border: 1px solid var(--line);
    border-radius: 28px;
    background: linear-gradient(135deg, rgba(255, 250, 241, 0.96), rgba(246, 233, 214, 0.88));
    box-shadow: var(--shadow);
  }

  .view-hero.compact {
    padding-top: 20px;
    padding-bottom: 20px;
  }

  .view-eyebrow {
    letter-spacing: 0.18em;
    text-transform: uppercase;
    font-size: 11px;
    color: var(--muted);
    font-family: "Trebuchet MS", "Gill Sans", sans-serif;
  }

  .view-hero h2,
  .panel-head h2,
  .panel-head h3 {
    margin: 6px 0 0;
    font-size: clamp(24px, 3vw, 42px);
    line-height: 0.98;
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
    border-radius: 24px;
    background: var(--panel);
    box-shadow: var(--shadow-soft);
    backdrop-filter: blur(12px);
    overflow: hidden;
    min-width: 0;
  }

  .panel-head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: center;
    padding: 18px 20px 16px;
    border-bottom: 1px solid var(--line);
    background: rgba(255, 248, 239, 0.62);
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
    border-radius: 18px;
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
    border-radius: 12px;
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
    border: none;
    border-radius: 999px;
    background: var(--accent);
    color: #fff7f3;
    padding: 10px 16px;
    font-size: 14px;
    cursor: pointer;
    transition: transform 120ms ease, opacity 120ms ease, box-shadow 120ms ease, background 120ms ease;
    box-shadow: 0 10px 22px rgba(182, 77, 46, 0.18);
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
    border-radius: 14px;
    border: 1px solid transparent;
    font-size: 13px;
  }

  .message.info { background: rgba(56, 113, 156, 0.08); border-color: rgba(56, 113, 156, 0.16); }
  .message.success { background: rgba(47, 122, 77, 0.09); border-color: rgba(47, 122, 77, 0.18); }
  .message.error { background: rgba(160, 60, 57, 0.09); border-color: rgba(160, 60, 57, 0.18); }

  .data-table-wrap {
    overflow: auto;
    border: 1px solid rgba(91, 70, 48, 0.12);
    border-radius: 18px;
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
    border-radius: 16px;
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
    background: linear-gradient(90deg, #d8863b, var(--accent));
    border-radius: 999px;
    transition: width 180ms ease;
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
    border-radius: 18px;
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
    border-radius: 24px;
    background: rgba(255, 249, 241, 0.96);
    backdrop-filter: blur(18px);
    box-shadow: var(--shadow);
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
    border-radius: 16px;
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
    box-shadow: var(--shadow-soft);
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
      top: 12px;
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
    .view-hero {
      width: 100%;
      flex-direction: column;
      align-items: stretch;
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
