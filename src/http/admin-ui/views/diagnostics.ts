export function renderDiagnosticsView(): string {
  return `
    <section class="view" data-view="diagnostics" hidden>
      <div class="view-hero compact">
        <div>
          <div class="view-eyebrow">Hosted state</div>
          <h2>Diagnostics</h2>
          <p>Low-level hosted diagnostics already live on the API server. This workspace composes them for humans.</p>
        </div>
        <div class="hero-actions">
          <button type="button" class="secondary" id="refresh-diagnostics">Refresh diagnostics</button>
        </div>
      </div>

      <section class="panel">
        <div class="panel-body section-stack">
          <div class="stats-grid" id="diag-stats"></div>

          <div class="lookup-grid">
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

          <div class="two-panel-grid diagnostics-grid">
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
    </section>
  `;
}
