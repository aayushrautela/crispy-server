export function renderOverviewView(): string {
  return `
    <section class="view is-active" data-view="overview">
      <div class="view-hero">
        <div>
          <div class="view-eyebrow">Crispy Control Plane</div>
          <h2>Overview</h2>
          <p>Keep the worker visible, keep diagnostics tight, and move through the control plane without losing the page to a giant stack.</p>
        </div>
        <div class="hero-actions">
          <button type="button" data-open-view="jobs">Open worker jobs</button>
          <button type="button" class="secondary" data-run-default-job="recommendations_daily">Run daily recompute</button>
        </div>
      </div>

      <div class="stats-grid" id="overview-summary"></div>

      <div class="overview-grid">
        <section class="panel">
          <div class="panel-head">
            <div>
              <h3>Live activity</h3>
              <p class="panel-note">Running and queued work stays visible here with real progress.</p>
            </div>
            <button type="button" class="secondary" data-open-view="jobs">Detailed queue</button>
          </div>
          <div class="panel-body">
            <div id="overview-running-jobs"></div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <div>
              <h3>Operational pulse</h3>
              <p class="panel-note">Bridge state, backlog pressure, and recent events at a glance.</p>
            </div>
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
          <div>
            <h3>Quick lanes</h3>
            <p class="panel-note">Jump into the right workspace instead of building a longer page.</p>
          </div>
        </div>
        <div class="panel-body quick-grid">
          <button type="button" class="quick-card" data-open-view="jobs">
            <strong>Worker Jobs</strong>
            <span>Trigger runs, watch phases, cancel queued work.</span>
          </button>
          <button type="button" class="quick-card" data-open-view="diagnostics">
            <strong>Diagnostics</strong>
            <span>Watch backlog, outbox lag, and import health.</span>
          </button>
          <button type="button" class="quick-card" data-open-view="accounts">
            <strong>Accounts</strong>
            <span>Resolve an account, inspect profiles, trigger imports.</span>
          </button>
          <button type="button" class="quick-card" data-open-view="worker-control">
            <strong>Worker Control</strong>
            <span>See whether the API server can still talk to the worker.</span>
          </button>
        </div>
      </section>
    </section>
  `;
}
