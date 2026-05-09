export function renderDiagnosticsView(): string {
  return `
    <section class="view" data-view="diagnostics" hidden>
      <header class="view-header">
        <h2>Diagnostics</h2>
        <div class="view-header-actions">
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
          <h4>Outbox lag</h4>
          <p id="outbox-summary">Loading recommendation outbox lag...</p>
        </div>
        <div class="mini-panel">
          <h4>Service outbox</h4>
          <p id="service-outbox-summary">Loading service outbox diagnostics...</p>
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
      <div class="mini-panel">
        <h4>Service outbox filters</h4>
        <form class="inline-actions" id="service-outbox-filter-form">
          <input type="text" id="service-outbox-correlation-id" placeholder="Correlation ID" autocomplete="off" />
          <input type="text" id="service-outbox-profile-id" placeholder="Profile ID" autocomplete="off" />
          <select id="service-outbox-status">
            <option value="">Any status</option>
            <option value="pending">pending</option>
            <option value="processing">processing</option>
            <option value="dispatched">dispatched</option>
            <option value="failed">failed</option>
          </select>
          <button type="submit" class="secondary">Apply filters</button>
        </form>
      </div>

      <div class="data-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Profile</th>
              <th>Reason</th>
              <th>Status</th>
              <th>Correlation</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody id="service-outbox-rows"></tbody>
        </table>
      </div>
    </section>
  `;
}
