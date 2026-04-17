export function renderDiagnosticsView(): string {
  return `
    <section class="view" data-view="diagnostics" hidden>
      <header class="view-header">
        <h2>Diagnostics</h2>
        <div class="view-header-actions">
          <button type="button" class="secondary" id="clear-blocked-generation-jobs">Clear blocked generation jobs</button>
          <button type="button" class="secondary" id="refresh-diagnostics">Refresh diagnostics</button>
        </div>
      </header>

      <div class="stats-grid" id="diag-stats"></div>

      <div class="lookup-grid">
        <div class="mini-panel">
          <h4>Recommendation delivery</h4>
          <p id="backlog-summary">Loading recommendation delivery diagnostics...</p>
        </div>
        <div class="mini-panel">
          <h4>Generation jobs</h4>
          <p id="generation-summary">Loading recommendation generation jobs...</p>
        </div>
        <div class="mini-panel">
          <h4>Generation failures</h4>
          <p id="generation-failure-summary">Loading generation failure diagnostics...</p>
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

      <div class="two-panel-grid diagnostics-grid">
        <div class="data-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Profile</th>
                <th>Event</th>
                <th>Occurred</th>
                <th>History</th>
              </tr>
            </thead>
            <tbody id="backlog-rows"></tbody>
          </table>
        </div>

        <div class="data-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Profile</th>
                <th>Status</th>
                <th>Worker job</th>
                <th>Generation</th>
                <th>Failures</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody id="generation-rows"></tbody>
          </table>
        </div>

        <div class="data-table-wrap">
          <div class="panel-stack">
            <div class="inline-actions">
              <h4>Generation job detail</h4>
            </div>
            <div id="generation-detail-empty" class="muted">Select a recommendation generation job to inspect its full local state.</div>
            <div id="generation-detail-shell" hidden>
              <div id="generation-detail-summary"></div>
              <pre id="generation-detail-json" class="code-block"></pre>
            </div>
          </div>
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
    </section>
  `;
}
