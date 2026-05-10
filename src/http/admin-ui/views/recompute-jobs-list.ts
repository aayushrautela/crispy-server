import { renderRecomputeJobsCreateModal } from './recompute-jobs-create-modal.js';

export function renderRecomputeJobsListView(): string {
  return `
    <section class="view" data-view="recompute-jobs" hidden>
      <header class="view-header">
        <h2>Recommendation recompute jobs</h2>
      </header>

      <div class="section-stack">
        <section class="panel">
          <div class="panel-head">
            <div>
              <h3>Bulk recompute queue</h3>
              <p class="panel-note">Create jobs, filter recent runs, and monitor active progress.</p>
            </div>
            <div class="jobs-toolbar">
              <button type="button" class="secondary" id="refresh-recompute-jobs">Refresh</button>
              <button type="button" id="open-recompute-create">Create recompute job</button>
            </div>
          </div>
          <div class="panel-body section-stack">
            <div id="recompute-jobs-message" class="message info" hidden></div>
            <form id="recompute-jobs-filter-form" class="jobs-toolbar">
              <label>Status
                <select id="recompute-jobs-status">
                  <option value="">Any</option>
                  <option value="queued">Queued</option>
                  <option value="running">Running</option>
                  <option value="paused">Paused</option>
                  <option value="completed">Completed</option>
                  <option value="failed">Failed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>
              <label>Scope
                <select id="recompute-jobs-scope">
                  <option value="">Any</option>
                  <option value="profiles">Profiles</option>
                  <option value="accounts">Accounts</option>
                  <option value="all-users">All users</option>
                </select>
              </label>
              <label>Limit
                <input id="recompute-jobs-limit" type="number" min="1" max="100" value="25">
              </label>
              <button type="submit" class="secondary">Apply filters</button>
            </form>
            <div class="stats-grid" id="recompute-jobs-summary"></div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Scope</th>
                    <th>Status</th>
                    <th>Progress</th>
                    <th>Requested</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody id="recompute-jobs-rows">
                  <tr><td colspan="6" class="muted">Loading recompute jobs...</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>

      ${renderRecomputeJobsCreateModal()}
    </section>
  `;
}
