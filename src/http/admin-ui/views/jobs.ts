export function renderJobsView(): string {
  return `
    <section class="view" data-view="jobs" hidden>
      <header class="view-header">
        <h2>Recommendation Jobs</h2>
        <div class="view-header-actions">
          <button type="button" class="secondary" id="refresh-jobs">Refresh status</button>
        </div>
      </header>

      <div class="stats-grid" id="job-stats"></div>

      <section class="panel">
        <div class="panel-body">
          <p class="panel-note">Read-only view of recommendation generation jobs tracked by the API server. The worker bridge only reports reachability and worker stats.</p>
        </div>
      </section>

      <div id="job-message" class="message info" hidden></div>

      <div class="two-panel-grid">
        <section class="panel">
          <div class="panel-head">
            <h3>Pending and running</h3>
          </div>
          <div class="panel-body">
            <div id="job-list-active"></div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h3>Recent jobs</h3>
          </div>
          <div class="panel-body">
            <div id="job-list-recent"></div>
          </div>
        </section>
      </div>
    </section>
  `;
}
