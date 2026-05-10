export function renderRecomputeJobsDetailView(): string {
  return `
    <section class="view" data-view="recompute-job-detail" hidden>
      <header class="view-header">
        <h2>Recompute job detail</h2>
      </header>

      <div class="section-stack">
        <section class="panel">
          <div class="panel-head">
            <div>
              <h3 id="recompute-detail-title">Select a recompute job</h3>
              <p class="panel-note" id="recompute-detail-meta">Open a job from the recompute jobs table to inspect progress and diagnostics.</p>
            </div>
            <div class="jobs-toolbar">
              <button type="button" class="secondary" data-open-view="recompute-jobs">Back to jobs</button>
              <button type="button" class="secondary" id="refresh-recompute-job-detail">Refresh</button>
            </div>
          </div>
          <div class="panel-body section-stack">
            <div id="recompute-detail-message" class="message info" hidden></div>
            <div class="stats-grid" id="recompute-detail-summary"></div>
            <div class="mini-panel" id="recompute-detail-progress">
              <div class="muted">No job selected.</div>
            </div>
            <div class="jobs-toolbar" id="recompute-detail-actions"></div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <div>
              <h3>Diagnostics</h3>
              <p class="panel-note">Target counts, recent failures, checkpoint, and reconciliation output.</p>
            </div>
          </div>
          <div class="panel-body section-stack" id="recompute-detail-diagnostics">
            <div class="empty">No diagnostics loaded.</div>
          </div>
        </section>
      </div>
    </section>
  `;
}
