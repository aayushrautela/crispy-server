import type { FastifyInstance } from 'fastify';

const ADMIN_PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Crispy Control Plane</title>
  <link rel="icon" href="data:,">
  <style>
    :root {
      --bg: #f5efe2;
      --panel: rgba(255, 250, 240, 0.86);
      --panel-strong: #fffaf0;
      --ink: #1f1b16;
      --muted: #6c6257;
      --line: rgba(76, 60, 44, 0.18);
      --accent: #b64d2e;
      --accent-soft: #efe0cf;
      --ok: #2f7a4d;
      --warn: #a36a18;
      --err: #a03c39;
      --shadow: 0 18px 60px rgba(78, 52, 28, 0.14);
    }

    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; min-height: 100%; }
    body {
      font-family: Georgia, "Iowan Old Style", "Palatino Linotype", serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(230, 188, 129, 0.35), transparent 28%),
        radial-gradient(circle at bottom right, rgba(182, 77, 46, 0.18), transparent 24%),
        linear-gradient(180deg, #f9f4ea 0%, #f2e9d9 52%, #efe4d2 100%);
    }

    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      background-image:
        linear-gradient(rgba(127, 98, 68, 0.035) 1px, transparent 1px),
        linear-gradient(90deg, rgba(127, 98, 68, 0.03) 1px, transparent 1px);
      background-size: 32px 32px;
      opacity: 0.65;
    }

    .shell {
      position: relative;
      max-width: 1440px;
      margin: 0 auto;
      padding: 32px 20px 48px;
    }

    .hero {
      display: grid;
      gap: 16px;
      margin-bottom: 28px;
      padding: 22px 24px;
      border: 1px solid var(--line);
      border-radius: 24px;
      background: linear-gradient(135deg, rgba(255, 250, 240, 0.94), rgba(248, 237, 219, 0.88));
      box-shadow: var(--shadow);
    }

    .eyebrow {
      letter-spacing: 0.18em;
      text-transform: uppercase;
      font-size: 11px;
      color: var(--muted);
      font-family: "Trebuchet MS", "Gill Sans", sans-serif;
    }

    h1 {
      margin: 0;
      font-size: clamp(32px, 4vw, 56px);
      line-height: 0.98;
      font-weight: 600;
    }

    .hero p {
      margin: 0;
      max-width: 820px;
      color: var(--muted);
      font-size: 15px;
    }

    .hero-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: rgba(255, 250, 240, 0.8);
      font-size: 12px;
      color: var(--muted);
      font-family: "Trebuchet MS", "Gill Sans", sans-serif;
    }

    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1.8fr) minmax(280px, 0.95fr);
      gap: 22px;
      align-items: start;
    }

    .stack {
      display: grid;
      gap: 22px;
    }

    .panel {
      border: 1px solid var(--line);
      border-radius: 22px;
      background: var(--panel);
      box-shadow: var(--shadow);
      backdrop-filter: blur(10px);
      overflow: hidden;
    }

    .panel-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      padding: 18px 20px 14px;
      border-bottom: 1px solid var(--line);
      background: rgba(255, 250, 240, 0.55);
    }

    .panel-head h2, .panel-head h3 {
      margin: 0;
      font-size: 19px;
      font-weight: 600;
    }

    .panel-body {
      padding: 18px 20px 20px;
    }

    .panel-note {
      margin: 6px 0 0;
      color: var(--muted);
      font-size: 13px;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 14px;
    }

    .stat-card {
      padding: 16px;
      border-radius: 18px;
      background: rgba(255, 250, 240, 0.9);
      border: 1px solid rgba(91, 70, 48, 0.12);
    }

    .stat-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.16em;
      color: var(--muted);
      margin-bottom: 8px;
      font-family: "Trebuchet MS", "Gill Sans", sans-serif;
    }

    .stat-value {
      font-size: 34px;
      line-height: 1;
      margin-bottom: 6px;
    }

    .stat-subtext {
      font-size: 13px;
      color: var(--muted);
    }

    .jobs-toolbar, .worker-toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
    }

    .trigger-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: 14px;
      margin-top: 16px;
    }

    .trigger-card {
      border: 1px solid rgba(91, 70, 48, 0.12);
      border-radius: 18px;
      padding: 16px;
      background: rgba(255, 250, 240, 0.9);
    }

    .trigger-card h3 {
      margin: 0 0 8px;
      font-size: 16px;
    }

    .trigger-card p {
      margin: 0 0 14px;
      color: var(--muted);
      font-size: 13px;
      min-height: 54px;
    }

    label {
      display: grid;
      gap: 6px;
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
      font-family: "Trebuchet MS", "Gill Sans", sans-serif;
    }

    input, select, textarea {
      width: 100%;
      border: 1px solid rgba(91, 70, 48, 0.16);
      border-radius: 12px;
      background: rgba(255, 252, 247, 0.95);
      color: var(--ink);
      padding: 10px 12px;
      font: inherit;
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
      font: inherit;
      font-size: 14px;
      cursor: pointer;
      transition: transform 120ms ease, opacity 120ms ease, box-shadow 120ms ease;
      box-shadow: 0 10px 22px rgba(182, 77, 46, 0.18);
    }

    button.secondary {
      background: rgba(255, 250, 240, 0.88);
      color: var(--ink);
      border: 1px solid rgba(91, 70, 48, 0.14);
      box-shadow: none;
    }

    button.ghost {
      background: transparent;
      color: var(--accent);
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

    .data-grid {
      display: grid;
      gap: 14px;
    }

    .mini-panel {
      border: 1px solid rgba(91, 70, 48, 0.12);
      border-radius: 18px;
      padding: 14px;
      background: rgba(255, 250, 240, 0.82);
    }

    .mini-panel h4 {
      margin: 0 0 6px;
      font-size: 15px;
    }

    .mini-panel p {
      margin: 0;
      color: var(--muted);
      font-size: 13px;
    }

    .data-table-wrap {
      overflow: auto;
      border: 1px solid rgba(91, 70, 48, 0.12);
      border-radius: 18px;
      background: rgba(255, 250, 240, 0.84);
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
      max-height: 220px;
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
      font-family: "Trebuchet MS", "Gill Sans", sans-serif;
    }

    .badge.running { background: rgba(56, 113, 156, 0.1); color: #285d8b; }
    .badge.success { background: rgba(47, 122, 77, 0.12); color: var(--ok); }
    .badge.error { background: rgba(160, 60, 57, 0.12); color: var(--err); }
    .badge.canceled { background: rgba(163, 106, 24, 0.12); color: var(--warn); }
    .badge.queued { background: rgba(107, 98, 87, 0.12); color: var(--muted); }

    .job-card {
      border: 1px solid rgba(91, 70, 48, 0.12);
      border-radius: 20px;
      padding: 16px;
      background: rgba(255, 250, 240, 0.9);
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

    .job-title h3 {
      margin: 0;
      font-size: 17px;
    }

    .job-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      font-size: 12px;
      color: var(--muted);
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

    .job-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .empty {
      padding: 18px;
      border-radius: 18px;
      background: rgba(255, 250, 240, 0.8);
      border: 1px dashed rgba(91, 70, 48, 0.22);
      color: var(--muted);
      text-align: center;
    }

    .lookup-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 14px;
    }

    .profile-list {
      display: grid;
      gap: 10px;
      margin-top: 14px;
    }

    .profile-card {
      border: 1px solid rgba(91, 70, 48, 0.12);
      border-radius: 16px;
      padding: 14px;
      background: rgba(255, 250, 240, 0.86);
    }

    .profile-card strong {
      display: block;
      margin-bottom: 6px;
      font-size: 15px;
    }

    .profile-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 8px;
    }

    .profile-ops {
      display: grid;
      gap: 14px;
      margin-top: 12px;
    }

    .inline-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
    }

    .provider-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
      margin-top: 12px;
    }

    .provider-card {
      border: 1px solid rgba(91, 70, 48, 0.12);
      border-radius: 16px;
      padding: 14px;
      background: rgba(255, 250, 240, 0.86);
      display: grid;
      gap: 10px;
    }

    .section-stack {
      display: grid;
      gap: 12px;
      margin-top: 12px;
    }

    .section-card {
      border: 1px solid rgba(91, 70, 48, 0.12);
      border-radius: 16px;
      padding: 12px;
      background: rgba(255, 250, 240, 0.74);
      display: grid;
      gap: 10px;
    }

    .item-list {
      display: grid;
      gap: 10px;
      margin-top: 12px;
    }

    .item-row {
      padding: 12px;
      border-radius: 14px;
      background: rgba(255, 250, 240, 0.78);
      border: 1px solid rgba(91, 70, 48, 0.1);
    }

    .item-row strong {
      display: block;
      margin-bottom: 4px;
      font-size: 14px;
    }

    .item-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 8px;
      color: var(--muted);
      font-size: 12px;
    }

    .kv-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 10px;
      margin-top: 12px;
    }

    .kv-pair {
      padding: 10px 12px;
      border: 1px solid rgba(91, 70, 48, 0.1);
      border-radius: 14px;
      background: rgba(255, 250, 240, 0.74);
    }

    .kv-pair .label {
      display: block;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--muted);
      font-family: "Trebuchet MS", "Gill Sans", sans-serif;
    }

    .kv-pair .value {
      display: block;
      font-size: 13px;
      margin-top: 4px;
      line-height: 1.4;
    }

    .muted {
      color: var(--muted);
      font-size: 13px;
    }

    .loading {
      opacity: 0.7;
      pointer-events: none;
    }

    .badge.ok { background: rgba(47, 122, 77, 0.12); color: var(--ok); }
    .badge.info { background: rgba(56, 113, 156, 0.1); color: #285d8b; }
    .badge.warn { background: rgba(163, 106, 24, 0.12); color: var(--warn); }
    .badge.err { background: rgba(160, 60, 57, 0.12); color: var(--err); }

    @media (max-width: 1080px) {
      .layout { grid-template-columns: 1fr; }
    }

    @media (max-width: 720px) {
      .shell { padding: 18px 14px 32px; }
      .hero, .panel-head, .panel-body { padding-left: 16px; padding-right: 16px; }
      h1 { font-size: 32px; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <section class="hero">
      <div class="eyebrow">Crispy Control Plane</div>
      <h1>Worker ops move here. The engine becomes compute-only.</h1>
      <p>
        This admin surface lives on the API server so account ownership, diagnostics, profile inspection,
        and worker orchestration stay in one place. The recommendation engine is treated as a worker node,
        not a second backend brain.
      </p>
      <div class="hero-meta">
        <div class="pill">Control plane: API server</div>
        <div class="pill">Worker control: recommendation engine job surface</div>
        <div class="pill" id="worker-control-pill">Worker status: checking</div>
      </div>
    </section>

    <div class="layout">
      <div class="stack">
        <section class="panel">
          <div class="panel-head">
            <div>
              <h2>Worker Jobs</h2>
              <p class="panel-note">Trigger, cancel, and inspect in-memory worker jobs while the control plane still transitions.</p>
            </div>
            <div class="jobs-toolbar">
              <button class="secondary" id="refresh-jobs">Refresh status</button>
            </div>
          </div>
          <div class="panel-body">
            <div class="stats-grid" id="job-stats"></div>
            <div class="trigger-grid">
              <form class="trigger-card" data-target="recommendations_daily">
                <h3>Recommendations Daily</h3>
                <p>Kick a recommendation recompute pass from the control plane.</p>
                <div class="checkbox-row">
                  <label><input type="checkbox" name="all"> Process all</label>
                  <label><input type="checkbox" name="force"> Force recompute</label>
                </div>
                <div class="jobs-toolbar" style="margin-top: 14px;">
                  <button type="submit">Start run</button>
                </div>
              </form>

              <form class="trigger-card" data-target="provider_token_maintenance">
                <h3>Provider Token Maintenance</h3>
                <p>Refresh expiring provider tokens for Trakt or Simkl through the worker-control surface.</p>
                <label>Provider
                  <select name="provider">
                    <option value="">Any provider</option>
                    <option value="trakt">Trakt</option>
                    <option value="simkl">Simkl</option>
                  </select>
                </label>
                <label>Profile id
                  <input type="text" name="profileId" placeholder="optional-profile-id">
                </label>
                <label>Due within hours
                  <input type="number" min="0" step="1" name="dueWithinHours" placeholder="24">
                </label>
                <div class="checkbox-row">
                  <label><input type="checkbox" name="expiredOnly"> Expired only</label>
                  <label><input type="checkbox" name="dryRun"> Dry run</label>
                </div>
                <div class="jobs-toolbar" style="margin-top: 14px;">
                  <button type="submit">Run maintenance</button>
                </div>
              </form>

            </div>
            <div id="job-message" class="message info" hidden></div>
            <div class="data-grid" style="margin-top: 22px;">
              <div>
                <div class="panel-head" style="padding-left: 0; padding-right: 0; background: none; border-bottom: none;">
                  <div>
                    <h3>Active + queued</h3>
                    <p class="panel-note">Execution happens on the worker; orchestration and inspection live here.</p>
                  </div>
                </div>
                <div id="job-list-active"></div>
              </div>
              <div>
                <div class="panel-head" style="padding-left: 0; padding-right: 0; background: none; border-bottom: none;">
                  <div>
                    <h3>Recent runs</h3>
                    <p class="panel-note">Completed and canceled jobs stay visible until deleted.</p>
                  </div>
                </div>
                <div id="job-list-recent"></div>
              </div>
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <div>
              <h2>Diagnostics</h2>
              <p class="panel-note">Low-level hosted diagnostics already live on the API server. This page composes them for humans.</p>
            </div>
            <div class="worker-toolbar">
              <button class="secondary" id="refresh-diagnostics">Refresh diagnostics</button>
            </div>
          </div>
          <div class="panel-body">
            <div class="stats-grid" id="diag-stats"></div>
            <div class="lookup-grid" style="margin-top: 18px;">
              <div class="mini-panel">
                <h4>Recommendation backlog</h4>
                <p id="backlog-summary">Loading work-state backlog...</p>
              </div>
              <div class="mini-panel">
                <h4>Outbox lag</h4>
                <p id="outbox-summary">Loading recommendation outbox lag...</p>
              </div>
              <div class="mini-panel">
                <h4>Import refresh risk</h4>
                <p id="import-summary">Loading import diagnostics...</p>
              </div>
            </div>

            <div class="data-grid" style="margin-top: 20px;">
              <div class="data-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Recommendation backlog</th>
                      <th>Pending</th>
                      <th>Active</th>
                      <th>Oldest</th>
                    </tr>
                  </thead>
                  <tbody id="backlog-rows"></tbody>
                </table>
              </div>

              <div class="data-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Account + profile</th>
                      <th>Status</th>
                      <th>Provider user</th>
                      <th>Expires</th>
                      <th>Refresh failures</th>
                    </tr>
                  </thead>
                  <tbody id="import-rows"></tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div class="stack">
        <section class="panel">
          <div class="panel-head">
            <div>
              <h2>Account Inspector</h2>
              <p class="panel-note">Resolve email to account, inspect provider/import state, review watch data, and trigger profile-level import actions.</p>
            </div>
          </div>
          <div class="panel-body">
            <form id="account-lookup-form">
              <label>Account email
                <input type="text" id="lookup-email" placeholder="person@example.com" required>
              </label>
              <div class="jobs-toolbar" style="margin-top: 14px;">
                <button type="submit">Resolve account</button>
              </div>
            </form>
            <div id="lookup-message" class="message info" hidden></div>
            <div id="account-summary" class="mini-panel" style="margin-top: 16px;" hidden></div>
            <div id="profile-list" class="profile-list"></div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <div>
              <h2>Worker Control</h2>
              <p class="panel-note">Health and configuration for the API-server-to-worker control link.</p>
            </div>
          </div>
          <div class="panel-body">
            <div id="bridge-summary" class="mini-panel">
              <h4>Worker control status</h4>
              <p id="bridge-text">Checking worker control configuration...</p>
            </div>
            <div class="code" id="bridge-json" style="margin-top: 14px;">Loading...</div>
          </div>
        </section>
      </div>
    </div>
  </div>

  <script>
    const state = {
      jobsBusy: false,
      diagnosticsBusy: false,
      lookupBusy: false,
    };

    const elements = {
      bridgePill: document.getElementById('worker-control-pill'),
      bridgeText: document.getElementById('bridge-text'),
      bridgeJson: document.getElementById('bridge-json'),
      refreshJobs: document.getElementById('refresh-jobs'),
      refreshDiagnostics: document.getElementById('refresh-diagnostics'),
      jobStats: document.getElementById('job-stats'),
      diagStats: document.getElementById('diag-stats'),
      activeJobs: document.getElementById('job-list-active'),
      recentJobs: document.getElementById('job-list-recent'),
      jobMessage: document.getElementById('job-message'),
      backlogSummary: document.getElementById('backlog-summary'),
      outboxSummary: document.getElementById('outbox-summary'),
      importSummary: document.getElementById('import-summary'),
      backlogRows: document.getElementById('backlog-rows'),
      importRows: document.getElementById('import-rows'),
      lookupForm: document.getElementById('account-lookup-form'),
      lookupEmail: document.getElementById('lookup-email'),
      lookupMessage: document.getElementById('lookup-message'),
      accountSummary: document.getElementById('account-summary'),
      profileList: document.getElementById('profile-list'),
    };

    const triggerForms = Array.from(document.querySelectorAll('form[data-target]'));

    for (const form of triggerForms) {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const target = form.getAttribute('data-target');
        if (!target) return;
        const payload = collectTriggerPayload(form, target);
        void triggerJob(payload, form);
      });
    }

    elements.refreshJobs.addEventListener('click', () => { void loadJobs(); });
    elements.refreshDiagnostics.addEventListener('click', () => { void loadDiagnostics(); });
    elements.lookupForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void lookupAccount();
    });

    void Promise.all([loadBridgeStatus(), loadJobs(), loadDiagnostics()]);

    async function fetchJson(url, options) {
      const response = await fetch(url, {
        credentials: 'same-origin',
        headers: {
          accept: 'application/json',
          ...(options && options.body ? { 'content-type': 'application/json' } : {}),
        },
        ...options,
      });
      const text = await response.text();
      let payload = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = { raw: text };
        }
      }
      if (!response.ok) {
        const message = payload && typeof payload.error === 'string' ? payload.error : 'Request failed';
        const error = new Error(message);
        error.payload = payload;
        throw error;
      }
      return payload;
    }

    async function safeFetchJson(url, options) {
      try {
        return await fetchJson(url, options);
      } catch (error) {
        return {
          error: error && error.message ? error.message : 'Request failed',
          details: error && error.payload ? error.payload : null,
        };
      }
    }

    async function loadBridgeStatus() {
      try {
        const payload = await fetchJson('/admin/api/worker/control-status');
        const workerControl = payload && payload.workerControl ? payload.workerControl : {};
        const configured = workerControl.configured === true;
        const reachable = workerControl.reachable === true;
        if (!configured) {
          elements.bridgePill.textContent = 'Worker status: not configured';
          elements.bridgeText.textContent = 'Set RECOMMENDATION_ENGINE_WORKER_BASE_URL and RECOMMENDATION_ENGINE_WORKER_API_KEY to enable worker control.';
        } else if (reachable) {
          elements.bridgePill.textContent = 'Worker status: reachable';
          elements.bridgeText.textContent = 'API server can reach the recommendation engine worker-control surface.'
            + (workerControl.serverTime ? ' Worker clock: ' + formatDate(workerControl.serverTime) + '.' : '');
        } else {
          elements.bridgePill.textContent = 'Worker status: unreachable';
          elements.bridgeText.textContent = workerControl.error || 'Worker control is configured, but the API server cannot reach the worker right now.';
        }
        elements.bridgeJson.textContent = JSON.stringify(payload, null, 2);
      } catch (error) {
        elements.bridgePill.textContent = 'Worker status: unavailable';
        elements.bridgeText.textContent = error.message || 'Unable to read worker control status.';
        elements.bridgeJson.textContent = JSON.stringify(error.payload || { error: error.message }, null, 2);
      }
    }

    async function loadJobs() {
      setBusy('jobsBusy', true);
      try {
        const payload = await fetchJson('/admin/api/worker/jobs/status');
        renderJobStats(payload);
        renderJobs(payload.activeJobs.concat(payload.queuedJobs || []), elements.activeJobs, true);
        renderJobs(payload.recentJobs || [], elements.recentJobs, false);
        setMessage(elements.jobMessage, 'info', 'Worker job state refreshed.');
      } catch (error) {
        renderJobStats(null);
        elements.activeJobs.innerHTML = emptyState('Worker job control is unavailable.');
        elements.recentJobs.innerHTML = emptyState('No recent worker data available.');
        setMessage(elements.jobMessage, 'error', error.message || 'Failed to load worker jobs.');
        void loadBridgeStatus();
      } finally {
        setBusy('jobsBusy', false);
      }
    }

    async function loadDiagnostics() {
      setBusy('diagnosticsBusy', true);
      try {
        const [workState, outbox, imports] = await Promise.all([
          fetchJson('/admin/api/diagnostics/recommendations/work-state?limit=8'),
          fetchJson('/admin/api/diagnostics/recommendations/outbox?limit=8'),
          fetchJson('/admin/api/diagnostics/imports/connections?limit=8&refreshFailuresOnly=false'),
        ]);
        renderDiagnostics(workState, outbox, imports);
      } catch (error) {
        elements.diagStats.innerHTML = '';
        elements.backlogSummary.textContent = error.message || 'Failed to load diagnostics.';
        elements.outboxSummary.textContent = 'Unavailable';
        elements.importSummary.textContent = 'Unavailable';
        elements.backlogRows.innerHTML = emptyTableRow('Diagnostics unavailable.', 4);
        elements.importRows.innerHTML = emptyTableRow('Import diagnostics unavailable.', 5);
      } finally {
        setBusy('diagnosticsBusy', false);
      }
    }

    async function triggerJob(payload, form) {
      setFormDisabled(form, true);
      setMessage(elements.jobMessage, 'info', 'Sending worker trigger request...');
      try {
        const response = await fetchJson('/admin/api/worker/jobs/trigger', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setMessage(elements.jobMessage, 'success', response.message || 'Worker job request sent.');
        await loadJobs();
      } catch (error) {
        setMessage(elements.jobMessage, 'error', error.message || 'Unable to trigger worker job.');
      } finally {
        setFormDisabled(form, false);
      }
    }

    async function lookupAccount() {
      const email = String(elements.lookupEmail.value || '').trim();
      if (!email) {
        setMessage(elements.lookupMessage, 'error', 'Enter an account email first.');
        return;
      }

      state.lookupBusy = true;
      elements.lookupForm.classList.add('loading');
      setMessage(elements.lookupMessage, 'info', 'Resolving account and profiles...');
      elements.profileList.innerHTML = '';
      elements.accountSummary.hidden = true;

      try {
        const accountResponse = await fetchJson('/admin/api/accounts/lookup-by-email/' + encodeURIComponent(email));
        const account = accountResponse.account;
        const profilesResponse = await fetchJson('/admin/api/accounts/' + encodeURIComponent(account.accountId) + '/profiles');
        const profiles = Array.isArray(profilesResponse.profiles) ? profilesResponse.profiles : [];
        elements.accountSummary.hidden = false;
        elements.accountSummary.innerHTML = '<h4>Account</h4>'
          + '<div class="kv-grid">'
          + kvPair('Account id', account.accountId)
          + kvPair('Email', account.email || email)
          + kvPair('Profiles', String(profiles.length))
          + '</div>';

        if (profiles.length === 0) {
          elements.profileList.innerHTML = emptyState('No profiles found for this account.');
        } else {
          elements.profileList.innerHTML = profiles.map((profile) => renderProfileCard(account, profile)).join('');
          bindProfileInspectButtons(account.accountId);
        }
        setMessage(elements.lookupMessage, 'success', 'Resolved account and loaded profiles.');
      } catch (error) {
        setMessage(elements.lookupMessage, 'error', error.message || 'Unable to resolve account.');
      } finally {
        state.lookupBusy = false;
        elements.lookupForm.classList.remove('loading');
      }
    }

    async function inspectProfile(accountId, profileId, container) {
      const messageEl = document.getElementById(container.id + '-message');
      if (messageEl) {
        setMessage(messageEl, '', '');
      }
      container.innerHTML = '<div class="muted">Loading provider state, imports, watch data, and recommendations...</div>';
      try {
        const [importsOverview, taste, recommendations, history, continueWatching, watchlist, ratings, trackedSeries] = await Promise.all([
          safeFetchJson('/admin/api/accounts/' + encodeURIComponent(accountId) + '/profiles/' + encodeURIComponent(profileId) + '/imports/overview'),
          safeFetchJson('/admin/api/accounts/' + encodeURIComponent(accountId) + '/profiles/' + encodeURIComponent(profileId) + '/taste-profile?sourceKey=default'),
          safeFetchJson('/admin/api/accounts/' + encodeURIComponent(accountId) + '/profiles/' + encodeURIComponent(profileId) + '/recommendations?sourceKey=default'),
          safeFetchJson('/admin/api/accounts/' + encodeURIComponent(accountId) + '/profiles/' + encodeURIComponent(profileId) + '/watch-history?limit=8'),
          safeFetchJson('/admin/api/accounts/' + encodeURIComponent(accountId) + '/profiles/' + encodeURIComponent(profileId) + '/continue-watching?limit=6'),
          safeFetchJson('/admin/api/accounts/' + encodeURIComponent(accountId) + '/profiles/' + encodeURIComponent(profileId) + '/watchlist?limit=8'),
          safeFetchJson('/admin/api/accounts/' + encodeURIComponent(accountId) + '/profiles/' + encodeURIComponent(profileId) + '/ratings?limit=8'),
          safeFetchJson('/admin/api/accounts/' + encodeURIComponent(accountId) + '/profiles/' + encodeURIComponent(profileId) + '/tracked-series?limit=8'),
        ]);

        container.innerHTML = [
          renderImportOverview(importsOverview),
          renderMediaSection('Recent watch history', history, 'history'),
          renderMediaSection('Continue watching', continueWatching, 'continue'),
          renderMediaSection('Watchlist', watchlist, 'watchlist'),
          renderMediaSection('Ratings', ratings, 'ratings'),
          renderTrackedSeriesSection(trackedSeries),
          renderTasteProfileSection(taste),
          renderRecommendationsSection(recommendations),
        ].join('');
        bindProfileActionButtons(accountId, profileId, container);
      } catch (error) {
        container.innerHTML = '<div class="message error">' + escapeHtml(error.message || 'Unable to inspect profile.') + '</div>';
      }
    }

    function renderProfileCard(account, profile) {
      const targetId = 'profile-inspect-' + escapeHtml(profile.id).replace(/[^a-zA-Z0-9_-]/g, '_');
      const messageId = targetId + '-message';
      return '<div class="profile-card">'
        + '<strong>' + escapeHtml(profile.name || profile.id) + '</strong>'
        + '<div class="muted">Profile id: ' + escapeHtml(profile.id) + '</div>'
        + '<div class="profile-meta">'
        + badge(profile.isKids ? 'kids profile' : 'standard profile', profile.isKids ? 'warn' : 'info')
        + badge('updated ' + formatDate(profile.updatedAt || 'unknown'), 'info')
        + '</div>'
        + '<div class="jobs-toolbar" style="margin-top: 12px;">'
        + '<button class="secondary" type="button" data-inspect-profile="' + escapeHtml(profile.id) + '" data-account-id="' + escapeHtml(account.accountId) + '" data-target="' + targetId + '">Open profile ops</button>'
        + '</div>'
        + '<div id="' + messageId + '" class="message info" hidden></div>'
        + '<div id="' + targetId + '" class="profile-ops"></div>'
        + '</div>';
    }

    function bindProfileInspectButtons(accountId) {
      const buttons = Array.from(document.querySelectorAll('[data-inspect-profile]'));
      for (const button of buttons) {
        button.addEventListener('click', () => {
          const profileId = button.getAttribute('data-inspect-profile');
          const target = button.getAttribute('data-target');
          if (!profileId || !target) return;
          const container = document.getElementById(target);
          if (!container) return;
          void inspectProfile(accountId, profileId, container);
        });
      }
    }

    function bindProfileActionButtons(accountId, profileId, container) {
      const messageEl = document.getElementById(container.id + '-message');

      const importButtons = Array.from(container.querySelectorAll('[data-start-import]'));
      for (const button of importButtons) {
        button.onclick = async () => {
          const provider = button.getAttribute('data-start-import');
          if (!provider) return;
          button.disabled = true;
          setMessage(messageEl, 'info', 'Starting ' + provider + ' import...');
          try {
            const payload = await fetchJson('/admin/api/accounts/' + encodeURIComponent(accountId) + '/profiles/' + encodeURIComponent(profileId) + '/imports/start', {
              method: 'POST',
              body: JSON.stringify({ provider }),
            });
            if (payload.authUrl) {
              setHtmlMessage(messageEl, 'info', 'Authorization required for ' + escapeHtml(provider) + '. <a href="' + escapeHtml(String(payload.authUrl)) + '" target="_blank" rel="noopener noreferrer">Open provider auth</a>.');
            } else {
              setMessage(messageEl, 'success', 'Queued ' + provider + ' import for this profile.');
            }
            await inspectProfile(accountId, profileId, container);
          } catch (error) {
            setMessage(messageEl, 'error', error.message || 'Unable to start import.');
          } finally {
            button.disabled = false;
          }
        };
      }

      const refreshButtons = Array.from(container.querySelectorAll('[data-refresh-provider-token]'));
      for (const button of refreshButtons) {
        button.onclick = async () => {
          const provider = button.getAttribute('data-refresh-provider-token');
          if (!provider) return;
          button.disabled = true;
          setMessage(messageEl, 'info', 'Refreshing ' + provider + ' token...');
          try {
            await fetchJson('/admin/api/accounts/' + encodeURIComponent(accountId) + '/profiles/' + encodeURIComponent(profileId) + '/providers/' + encodeURIComponent(provider) + '/refresh-token', {
              method: 'POST',
            });
            setMessage(messageEl, 'success', 'Refreshed ' + provider + ' token.');
            await inspectProfile(accountId, profileId, container);
          } catch (error) {
            setMessage(messageEl, 'error', error.message || 'Unable to refresh provider token.');
          } finally {
            button.disabled = false;
          }
        };
      }

      const refreshViewButtons = Array.from(container.querySelectorAll('[data-refresh-profile-view]'));
      for (const button of refreshViewButtons) {
        button.onclick = async () => {
          button.disabled = true;
          try {
            await inspectProfile(accountId, profileId, container);
          } finally {
            button.disabled = false;
          }
        };
      }
    }

    function renderDiagnostics(workState, outbox, imports) {
      const activeLeases = Array.isArray(workState.activeLeases) ? workState.activeLeases : [];
      const staleLeases = Array.isArray(workState.staleLeases) ? workState.staleLeases : [];
      const backlog = Array.isArray(workState.backlog) ? workState.backlog : [];
      const connections = Array.isArray(imports.connections) ? imports.connections : [];
      const refreshFailures = connections.filter((row) => row.refreshFailureCount > 0).length;
      const expiringSoon = connections.filter((row) => row.accessTokenExpiresAt).length;

      elements.diagStats.innerHTML = [
        statCard('Active leases', activeLeases.length, staleLeases.length + ' stale'),
        statCard('Backlog buckets', backlog.length, sum(backlog.map((row) => Number(row.pendingCount || 0))) + ' pending'),
        statCard('Outbox undelivered', countArray(outbox.undelivered), lagText(outbox.lag)),
        statCard('Import refresh failures', refreshFailures, expiringSoon + ' with expiry timestamps'),
      ].join('');

      elements.backlogSummary.textContent = backlog.length
        ? 'Largest pending bucket: ' + escapeHtml(String(backlog[0].sourceKey || 'default')) + ' with ' + String(backlog[0].pendingCount || 0) + ' items.'
        : 'No backlog buckets right now.';

      elements.outboxSummary.textContent = lagText(outbox.lag);
      elements.importSummary.textContent = connections.length
        ? refreshFailures + ' connections show refresh failures across ' + connections.length + ' recent rows.'
        : 'No recent import connections returned.';

      elements.backlogRows.innerHTML = backlog.length
        ? backlog.map((row) => '<tr><td>' + escapeHtml(String(row.sourceKey || 'default')) + '</td><td>' + escapeHtml(String(row.pendingCount || 0)) + '</td><td>' + escapeHtml(String(row.activeLeaseCount || 0)) + '</td><td>' + escapeHtml(String(row.oldestPendingAt || 'n/a')) + '</td></tr>').join('')
        : emptyTableRow('No backlog rows.', 4);

      elements.importRows.innerHTML = connections.length
        ? connections.map((row) => '<tr><td>'
          + '<strong>' + escapeHtml(String(row.accountId || 'unknown-account')) + '</strong><br>'
          + '<span class="muted">' + escapeHtml(String(row.profileId || 'unknown-profile')) + ' · ' + escapeHtml(String(row.provider || 'unknown-provider')) + '</span>'
          + '</td><td>' + badge(String(row.status || 'unknown'), statusTone(String(row.status || 'unknown'))) + '</td><td>' + escapeHtml(String(row.externalUsername || row.providerUserId || 'n/a')) + '</td><td>' + escapeHtml(String(row.accessTokenExpiresAt || 'n/a')) + '</td><td>' + escapeHtml(String(row.refreshFailureCount || 0)) + '</td></tr>').join('')
        : emptyTableRow('No import connection diagnostics.', 5);
    }

    function renderJobStats(payload) {
      if (!payload) {
        elements.jobStats.innerHTML = [
          statCard('Active jobs', '0', 'bridge unavailable'),
          statCard('Queued jobs', '0', 'bridge unavailable'),
          statCard('Recent jobs', '0', 'bridge unavailable'),
          statCard('Worker clock', '--', 'no worker response'),
        ].join('');
        return;
      }

      const activeJobs = Array.isArray(payload.activeJobs) ? payload.activeJobs : [];
      const queuedJobs = Array.isArray(payload.queuedJobs) ? payload.queuedJobs : [];
      const recentJobs = Array.isArray(payload.recentJobs) ? payload.recentJobs : [];
      const successCount = recentJobs.filter((job) => job.status === 'success').length;

      elements.jobStats.innerHTML = [
        statCard('Active jobs', activeJobs.length, activeJobs.filter((job) => job.cancelRequestedAt).length + ' cancel requested'),
        statCard('Queued jobs', queuedJobs.length, queuedJobs.length ? 'next: ' + escapeHtml(String(queuedJobs[0].target || 'unknown')) : 'no queue'),
        statCard('Recent successes', successCount, recentJobs.length + ' recent total'),
        statCard('Worker clock', formatDate(payload.serverTime), payload.serverTime || 'n/a'),
      ].join('');
    }

    function renderJobs(jobs, target, includeQueueContext) {
      if (!jobs || jobs.length === 0) {
        target.innerHTML = emptyState(includeQueueContext ? 'No active or queued worker jobs.' : 'No recent worker jobs.');
        return;
      }

      target.innerHTML = jobs.map((job) => renderJobCard(job, includeQueueContext)).join('');
      bindJobActions();
    }

    function renderJobCard(job, includeQueueContext) {
      const percent = job && job.progress && typeof job.progress.percent === 'number' ? Math.max(0, Math.min(100, job.progress.percent)) : 0;
      const args = Array.isArray(job.args) && job.args.length ? job.args.join(' ') : '(no args)';
      const queueText = includeQueueContext && job.queuePosition ? 'Queue position ' + job.queuePosition : null;
      const meta = [
        'id ' + job.id,
        'script ' + job.script,
        job.pid ? 'pid ' + job.pid : null,
        queueText,
        job.startedAt ? 'started ' + formatDate(job.startedAt) : 'created ' + formatDate(job.createdAt),
      ].filter(Boolean).map((item) => '<span>' + escapeHtml(item) + '</span>').join('');

      const actions = [];
      if (job.status === 'running' || job.status === 'queued') {
        actions.push('<button class="warn" type="button" data-cancel-job="' + escapeHtml(job.id) + '">Cancel</button>');
      }
      if (job.status === 'success' || job.status === 'error' || job.status === 'canceled') {
        actions.push('<button class="ghost" type="button" data-delete-job="' + escapeHtml(job.id) + '">Delete</button>');
      }

      return '<article class="job-card">'
        + '<div class="job-head">'
        + '  <div class="job-title">'
        + '    <div class="badge ' + escapeHtml(job.status) + '">' + escapeHtml(job.status) + '</div>'
        + '    <h3>' + escapeHtml(job.target) + '</h3>'
        + '    <div class="job-meta">' + meta + '</div>'
        + '  </div>'
        + '  <div class="job-actions">' + actions.join('') + '</div>'
        + '</div>'
        + '<div><strong>' + escapeHtml(job.progress && job.progress.phase || 'No phase') + '</strong><div class="muted">' + escapeHtml(job.progress && job.progress.message || 'No message') + '</div></div>'
        + '<div class="progress"><span style="width:' + percent + '%"></span></div>'
        + '<div class="job-meta">'
        + '  <span>processed ' + escapeHtml(String(job.progress && job.progress.processed || 0)) + '</span>'
        + '  <span>skipped ' + escapeHtml(String(job.progress && job.progress.skipped || 0)) + '</span>'
        + '  <span>errors ' + escapeHtml(String(job.progress && job.progress.errors || 0)) + '</span>'
        + '</div>'
        + '<div class="code">' + escapeHtml(args + '\\n\\nstdout:\\n' + ((job.stdoutTail || []).join('\\n') || '(empty)') + '\\n\\nstderr:\\n' + ((job.stderrTail || []).join('\\n') || '(empty)')) + '</div>'
        + '</article>';
    }

    function bindJobActions() {
      const cancelButtons = Array.from(document.querySelectorAll('[data-cancel-job]'));
      for (const button of cancelButtons) {
        button.onclick = async () => {
          const jobId = button.getAttribute('data-cancel-job');
          if (!jobId) return;
          button.disabled = true;
          try {
            const payload = await fetchJson('/admin/api/worker/jobs/' + encodeURIComponent(jobId) + '/cancel', { method: 'POST' });
            setMessage(elements.jobMessage, 'success', payload.message || 'Cancellation requested.');
            await loadJobs();
          } catch (error) {
            setMessage(elements.jobMessage, 'error', error.message || 'Unable to cancel job.');
          } finally {
            button.disabled = false;
          }
        };
      }

      const deleteButtons = Array.from(document.querySelectorAll('[data-delete-job]'));
      for (const button of deleteButtons) {
        button.onclick = async () => {
          const jobId = button.getAttribute('data-delete-job');
          if (!jobId) return;
          button.disabled = true;
          try {
            const payload = await fetchJson('/admin/api/worker/jobs/' + encodeURIComponent(jobId), { method: 'DELETE' });
            setMessage(elements.jobMessage, 'success', payload.message || 'Job deleted.');
            await loadJobs();
          } catch (error) {
            setMessage(elements.jobMessage, 'error', error.message || 'Unable to delete job.');
          } finally {
            button.disabled = false;
          }
        };
      }
    }

    function collectTriggerPayload(form, target) {
      const formData = new FormData(form);
      const options = {};
      for (const [key, value] of formData.entries()) {
        if (typeof value !== 'string') continue;
        const text = value.trim();
        if (!text) continue;
        if (key === 'dueWithinHours') {
          options[key] = Number(text);
        } else {
          options[key] = text;
        }
      }
      const checkboxes = form.querySelectorAll('input[type="checkbox"]');
      for (const checkbox of checkboxes) {
        if (checkbox.checked) {
          options[checkbox.name] = true;
        }
      }
      return { target, options };
    }

    function setFormDisabled(form, disabled) {
      const fields = Array.from(form.querySelectorAll('input, select, textarea, button'));
      for (const field of fields) {
        field.disabled = disabled;
      }
    }

    function setBusy(key, value) {
      state[key] = value;
      if (key === 'jobsBusy') {
        elements.refreshJobs.disabled = value;
      }
      if (key === 'diagnosticsBusy') {
        elements.refreshDiagnostics.disabled = value;
      }
    }

    function setMessage(element, kind, text) {
      if (!element) {
        return;
      }
      if (!text) {
        element.hidden = true;
        return;
      }
      element.hidden = false;
      element.className = 'message ' + kind;
      element.textContent = text;
    }

    function statCard(label, value, subtext) {
      return '<div class="stat-card"><div class="stat-label">' + escapeHtml(String(label)) + '</div><div class="stat-value">' + escapeHtml(String(value)) + '</div><div class="stat-subtext">' + escapeHtml(String(subtext || '')) + '</div></div>';
    }

    function emptyState(text) {
      return '<div class="empty">' + escapeHtml(text) + '</div>';
    }

    function emptyTableRow(text, span) {
      return '<tr><td colspan="' + span + '" class="muted">' + escapeHtml(text) + '</td></tr>';
    }

    function badge(value, tone) {
      const className = tone ? 'badge ' + tone : 'badge';
      return '<span class="' + escapeHtml(className) + '">' + escapeHtml(value) + '</span>';
    }

    function renderImportOverview(result) {
      if (result && result.error) {
        return sectionCard('Provider + import state', '<div class="message error">' + escapeHtml(result.error) + '</div>');
      }

      const watchDataState = result && result.watchDataState ? result.watchDataState : null;
      const jobs = result && Array.isArray(result.jobs) ? result.jobs : [];
      const providers = result && Array.isArray(result.providers) ? result.providers : [];

      const providerCards = providers.length
        ? '<div class="provider-grid">' + providers.map((provider) => renderProviderCard(provider)).join('') + '</div>'
        : emptyState('No provider states returned.');

      const jobsMarkup = jobs.length
        ? '<div class="section-stack">' + jobs.slice(0, 4).map((job) => renderImportJobCard(job)).join('') + '</div>'
        : emptyState('No import jobs yet for this profile.');

      return sectionCard('Provider + import state',
        '<div class="inline-actions">'
          + '<button type="button" class="secondary" data-refresh-profile-view="true">Refresh profile panel</button>'
          + '<button type="button" data-start-import="trakt">Import Trakt history + watchlist</button>'
          + '<button type="button" data-start-import="simkl">Import Simkl history + watchlist</button>'
        + '</div>'
        + '<div class="kv-grid">'
          + kvPair('Current origin', watchDataState && watchDataState.currentOrigin ? watchDataState.currentOrigin : 'native')
          + kvPair('History generation', watchDataState && watchDataState.historyGeneration !== undefined ? String(watchDataState.historyGeneration) : 'n/a')
          + kvPair('Last import provider', watchDataState && watchDataState.lastImportProvider ? watchDataState.lastImportProvider : 'none')
          + kvPair('Last import completed', watchDataState && watchDataState.lastImportCompletedAt ? formatDate(watchDataState.lastImportCompletedAt) : 'n/a')
        + '</div>'
        + providerCards
        + '<div style="margin-top: 12px;">' + jobsMarkup + '</div>'
      );
    }

    function renderProviderCard(provider) {
      const connection = provider && provider.connection ? provider.connection : null;
      const tokenStatus = provider && provider.tokenStatus ? provider.tokenStatus : null;
      const connected = provider && provider.connected === true;
      const tone = connected ? statusTone(tokenStatus && tokenStatus.tokenState ? tokenStatus.tokenState : 'connected') : 'warn';
      return '<div class="provider-card">'
        + '<div><strong>' + escapeHtml(String(provider.provider || 'provider')) + '</strong></div>'
        + '<div class="inline-actions">'
        + badge(connected ? 'connected' : 'not connected', tone)
        + (tokenStatus && tokenStatus.tokenState ? badge(tokenStatus.tokenState, statusTone(tokenStatus.tokenState)) : '')
        + '</div>'
        + '<div class="kv-grid">'
          + kvPair('User', connection ? (connection.externalUsername || connection.providerUserId || 'connected') : 'not connected')
          + kvPair('Expires', tokenStatus && tokenStatus.accessTokenExpiresAt ? formatDate(tokenStatus.accessTokenExpiresAt) : 'n/a')
          + kvPair('Last refresh', tokenStatus && tokenStatus.lastRefreshAt ? formatDate(tokenStatus.lastRefreshAt) : 'n/a')
          + kvPair('Refresh error', tokenStatus && tokenStatus.lastRefreshError ? tokenStatus.lastRefreshError : (provider.error || 'none'))
        + '</div>'
        + '<div class="inline-actions">'
          + '<button type="button" class="ghost" data-refresh-provider-token="' + escapeHtml(String(provider.provider || '')) + '"' + (connected ? '' : ' disabled') + '>Refresh token</button>'
        + '</div>'
      + '</div>';
    }

    function renderImportJobCard(job) {
      return '<div class="section-card">'
        + '<div class="inline-actions">'
          + badge(String(job.status || 'unknown'), statusTone(String(job.status || 'unknown')))
          + badge(String(job.provider || 'provider'), 'info')
        + '</div>'
        + '<div class="kv-grid">'
          + kvPair('Requested', formatDate(job.createdAt || 'n/a'))
          + kvPair('Started', job.startedAt ? formatDate(job.startedAt) : 'n/a')
          + kvPair('Finished', job.finishedAt ? formatDate(job.finishedAt) : 'n/a')
          + kvPair('Job id', job.id || 'n/a')
        + '</div>'
      + '</div>';
    }

    function renderMediaSection(title, result, kind) {
      if (result && result.error) {
        return sectionCard(title, '<div class="message error">' + escapeHtml(result.error) + '</div>');
      }

      const items = result && Array.isArray(result.items) ? result.items : [];
      if (items.length === 0) {
        return sectionCard(title, emptyState('No ' + title.toLowerCase() + ' yet.'));
      }

      return sectionCard(title, '<div class="item-list">' + items.map((item) => renderMediaRow(item, kind)).join('') + '</div>');
    }

    function renderTrackedSeriesSection(result) {
      if (result && result.error) {
        return sectionCard('Tracked series', '<div class="message error">' + escapeHtml(result.error) + '</div>');
      }
      const items = result && Array.isArray(result.items) ? result.items : [];
      if (items.length === 0) {
        return sectionCard('Tracked series', emptyState('No tracked series for this profile.'));
      }
      return sectionCard('Tracked series', '<div class="item-list">' + items.map((item) => {
        const media = item && item.show ? item.show : null;
        return '<div class="item-row">'
          + '<strong>' + escapeHtml(mediaTitle(media)) + '</strong>'
          + '<div class="muted">' + escapeHtml(item.reason || 'no reason captured') + '</div>'
          + '<div class="item-meta">'
            + '<span>next ' + escapeHtml(item.nextEpisodeAirDate ? formatDate(item.nextEpisodeAirDate) : 'n/a') + '</span>'
            + '<span>last interacted ' + escapeHtml(item.lastInteractedAt ? formatDate(item.lastInteractedAt) : 'n/a') + '</span>'
          + '</div>'
        + '</div>';
      }).join('') + '</div>');
    }

    function renderTasteProfileSection(result) {
      if (result && result.error) {
        return sectionCard('Taste profile', '<div class="message error">' + escapeHtml(result.error) + '</div>');
      }
      const tasteProfile = result && result.tasteProfile ? result.tasteProfile : result;
      if (!tasteProfile || tasteProfile === null) {
        return sectionCard('Taste profile', emptyState('No taste profile stored yet.'));
      }
      return sectionCard('Taste profile',
        '<div class="kv-grid">'
          + kvPair('Source key', tasteProfile.sourceKey || 'default')
          + kvPair('Updated', tasteProfile.updatedAt ? formatDate(tasteProfile.updatedAt) : 'n/a')
          + kvPair('Watching pace', tasteProfile.watchingPace || 'n/a')
          + kvPair('Version', tasteProfile.version !== undefined ? String(tasteProfile.version) : 'n/a')
        + '</div>'
        + (tasteProfile.aiSummary ? '<div class="section-card"><strong>AI summary</strong><div class="muted" style="margin-top:8px;">' + escapeHtml(tasteProfile.aiSummary) + '</div></div>' : '')
      );
    }

    function renderRecommendationsSection(result) {
      if (result && result.error) {
        return sectionCard('Recommendations', '<div class="message error">' + escapeHtml(result.error) + '</div>');
      }
      const recommendations = result && result.recommendations ? result.recommendations : result;
      if (!recommendations || recommendations === null) {
        return sectionCard('Recommendations', emptyState('No recommendation snapshot stored yet.'));
      }
      const sections = Array.isArray(recommendations.sections) ? recommendations.sections : [];
      return sectionCard('Recommendations',
        '<div class="kv-grid">'
          + kvPair('Source key', recommendations.sourceKey || 'default')
          + kvPair('Algorithm', recommendations.algorithmVersion || 'default')
          + kvPair('Generated', recommendations.generatedAt ? formatDate(recommendations.generatedAt) : 'n/a')
          + kvPair('Sections', String(sections.length))
        + '</div>'
        + (sections.length
          ? '<div class="section-stack">' + sections.slice(0, 3).map((section) => '<div class="section-card"><strong>' + escapeHtml(section.title || section.id || 'Section') + '</strong><div class="muted" style="margin-top:8px;">' + escapeHtml(renderRecommendationItems(section.items || [])) + '</div></div>').join('') + '</div>'
          : emptyState('Recommendation snapshot has no sections.'))
      );
    }

    function renderRecommendationItems(items) {
      return items.slice(0, 5).map((item) => {
        const media = item && item.media ? item.media : null;
        const reason = item && item.reason ? ' - ' + item.reason : '';
        return mediaTitle(media) + reason;
      }).join('\\n');
    }

    function renderMediaRow(item, kind) {
      const media = item && item.media ? item.media : null;
      const meta = [];
      if (kind === 'history' && item && item.watchedAt) meta.push('watched ' + formatDate(item.watchedAt));
      if (kind === 'continue' && item && item.lastActivityAt) meta.push('last played ' + formatDate(item.lastActivityAt));
      if (kind === 'watchlist' && item && item.addedAt) meta.push('added ' + formatDate(item.addedAt));
      if (kind === 'ratings' && item && item.rating && item.rating.ratedAt) meta.push('rated ' + formatDate(item.rating.ratedAt));
      if (kind === 'ratings' && item && item.rating) meta.push('score ' + String(item.rating.value));
      if (kind === 'continue' && item && item.progress) meta.push('progress ' + formatProgress(item.progress));

      return '<div class="item-row">'
        + '<strong>' + escapeHtml(mediaTitle(media)) + '</strong>'
        + '<div class="muted">' + escapeHtml(mediaSubtitle(media)) + '</div>'
        + '<div class="item-meta">' + meta.map((value) => '<span>' + escapeHtml(value) + '</span>').join('') + '</div>'
      + '</div>';
    }

    function mediaTitle(media) {
      if (!media) return 'Unknown title';
      return media.title || media.subtitle || media.mediaKey || media.id || 'Unknown title';
    }

    function mediaSubtitle(media) {
      if (!media) return 'No metadata available';
      const parts = [];
      if (media.subtitle) parts.push(media.subtitle);
      if (media.releaseYear) parts.push(String(media.releaseYear));
      else if (media.releaseDate) parts.push(String(media.releaseDate).slice(0, 10));
      if (media.runtimeMinutes) parts.push(String(media.runtimeMinutes) + ' min');
      return parts.length ? parts.join(' · ') : 'No extra metadata';
    }

    function formatProgress(progress) {
      if (!progress) return 'n/a';
      if (typeof progress.progressPercent === 'number') {
        return Math.round(progress.progressPercent) + '%';
      }
      if (typeof progress.positionSeconds === 'number' && typeof progress.durationSeconds === 'number' && progress.durationSeconds > 0) {
        return Math.round((progress.positionSeconds / progress.durationSeconds) * 100) + '%';
      }
      return 'n/a';
    }

    function sectionCard(title, body) {
      return '<div class="mini-panel"><h4>' + escapeHtml(title) + '</h4><div style="margin-top: 10px;">' + body + '</div></div>';
    }

    function kvPair(label, value) {
      return '<div class="kv-pair"><span class="label">' + escapeHtml(label) + '</span><span class="value">' + escapeHtml(value == null ? 'n/a' : String(value)) + '</span></div>';
    }

    function setHtmlMessage(element, kind, html) {
      if (!element) {
        return;
      }
      if (!html) {
        element.hidden = true;
        return;
      }
      element.hidden = false;
      element.className = 'message ' + kind;
      element.innerHTML = html;
    }

    function statusTone(value) {
      switch (String(value || '')) {
        case 'connected':
        case 'valid':
        case 'success':
        case 'succeeded':
        case 'succeeded_with_warnings':
          return 'ok';
        case 'expiring':
        case 'queued':
        case 'running':
        case 'oauth_pending':
        case 'pending':
          return 'info';
        case 'expired':
        case 'revoked':
        case 'cancelled':
        case 'canceled':
          return 'warn';
        case 'failed':
        case 'error':
        case 'missing_access_token':
          return 'err';
        default:
          return '';
      }
    }

    function lagText(lag) {
      if (!lag || typeof lag !== 'object') return 'No lag summary.';
      return 'undelivered=' + String(lag.undeliveredCount || 0) + ', oldest=' + String(lag.oldestUndeliveredAt || 'n/a');
    }

    function formatDate(value) {
      if (!value) return 'n/a';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      return date.toLocaleString();
    }

    function countArray(value) {
      return Array.isArray(value) ? value.length : 0;
    }

    function sum(values) {
      return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
    }

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }
  </script>
</body>
</html>`;

export async function registerAdminUiRoutes(app: FastifyInstance): Promise<void> {
  app.get('/admin', async (request, reply) => {
    await app.requireAdminUi(request, reply);
    reply.header('cache-control', 'no-store');
    reply.type('text/html; charset=utf-8');
    return ADMIN_PAGE;
  });
}
