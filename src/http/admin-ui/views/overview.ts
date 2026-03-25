export function renderOverviewView(): string {
  return `
    <section class="view is-active" data-view="overview">
      <header class="view-header">
        <h2>Overview</h2>
        <div class="view-header-actions">
          <button type="button" data-open-view="jobs">Open worker jobs</button>
          <button type="button" class="secondary" data-run-default-job="recommendations_daily">Run daily recompute</button>
        </div>
      </header>

      <div class="stats-grid" id="overview-summary"></div>

      <div class="overview-grid">
        <section class="panel">
          <div class="panel-head">
            <h3>Live activity</h3>
            <button type="button" class="secondary" data-open-view="jobs">Detailed queue</button>
          </div>
          <div class="panel-body">
            <div id="overview-running-jobs"></div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h3>System state</h3>
            <button type="button" class="secondary" data-refresh-target="overview">Refresh</button>
          </div>
          <div class="panel-body section-stack">
            <div id="overview-bridge"></div>
            <div id="overview-diagnostics"></div>
            <div id="overview-notifications"></div>
          </div>
        </section>
      </div>

      <section class="panel">
        <div class="panel-head">
          <h3>Shortcuts</h3>
        </div>
        <div class="panel-body quick-grid">
          <button type="button" class="quick-card" data-open-view="jobs">
            <strong>Worker Jobs</strong>
            <span>Queue status, recent runs, and triggers.</span>
          </button>
          <button type="button" class="quick-card" data-open-view="diagnostics">
            <strong>Diagnostics</strong>
            <span>Backlog, outbox, and import health.</span>
          </button>
          <button type="button" class="quick-card" data-open-view="accounts">
            <strong>Accounts</strong>
            <span>Lookup profiles and load account data.</span>
          </button>
          <button type="button" class="quick-card" data-open-view="worker-control">
            <strong>Worker Control</strong>
            <span>Bridge reachability and raw payload.</span>
          </button>
        </div>
      </section>
    </section>
  `;
}
