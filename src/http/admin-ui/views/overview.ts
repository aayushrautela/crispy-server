export function renderOverviewView(): string {
  return `
    <section class="view is-active" data-view="overview">
      <header class="view-header">
        <h1>Overview</h1>
        <div class="hero-actions">
          <button type="button" data-open-view="jobs">Open worker jobs</button>
          <button type="button" class="secondary" data-run-default-job="recommendations_daily">Run daily recompute</button>
        </div>
      </header>

      <div class="stats-grid" id="overview-summary"></div>

      <div class="overview-grid">
        <section class="panel">
          <div class="panel-head">
          <div class="panel-head">
            <h2>Live activity</h2>
            <button type="button" class="secondary" data-open-view="jobs">Detailed queue</button>
          </div>
          <div class="panel-body">
            <div id="overview-running-jobs"></div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
          <div class="panel-head">
            <h2>Operational pulse</h2>
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
        <div class="panel-head">
          <h2>Quick lanes</h2>
        </div>
        <div class="panel-body quick-grid">
          <button type="button" class="quick-card" data-open-view="jobs">
            Worker Jobs
          </button>
          <button type="button" class="quick-card" data-open-view="diagnostics">
            Diagnostics
          </button>
          <button type="button" class="quick-card" data-open-view="accounts">
            Accounts
          </button>
          <button type="button" class="quick-card" data-open-view="worker-control">
            Worker Control
          </button>
        </div>
      </section>
    </section>
  `;
}
