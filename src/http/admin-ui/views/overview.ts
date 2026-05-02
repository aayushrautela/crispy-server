export function renderOverviewView(): string {
  return `
    <section class="view" data-view="overview">
      <header class="view-header">
        <h2>Overview</h2>
      </header>

      <div class="stats-grid" id="overview-summary"></div>

      <div class="overview-grid">
        <section class="panel">
          <div class="panel-head">
            <h3>Live activity</h3>
          </div>
          <div class="panel-body" id="overview-running-jobs"></div>
        </section>

        <div class="overview-side-stack">
          <section class="panel">
            <div class="panel-head">
              <h3>Worker bridge</h3>
            </div>
            <div class="panel-body" id="overview-bridge"></div>
          </section>

          <section class="panel">
            <div class="panel-head">
              <h3>Diagnostics</h3>
            </div>
            <div class="panel-body" id="overview-diagnostics"></div>
          </section>

          <section class="panel">
            <div class="panel-head">
              <h3>Recent events</h3>
            </div>
            <div class="panel-body" id="overview-notifications"></div>
          </section>
        </div>
      </div>
    </section>
  `;
}
