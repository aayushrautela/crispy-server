export function renderJobsView(): string {
  return `
    <section class="view" data-view="jobs" hidden>
      <header class="view-header">
        <h2>Worker Jobs</h2>
        <div class="view-header-actions">
          <button type="button" class="secondary" id="refresh-jobs">Refresh status</button>
        </div>
      </header>

      <div class="stats-grid" id="job-stats"></div>

      <div class="trigger-grid">
        <form class="trigger-card" data-target="recommendations_daily">
          <h3>Recommendations Daily</h3>
          <p>Kick a recommendation recompute pass from the control plane.</p>
          <div class="checkbox-row">
            <label><input type="checkbox" name="all"> Process all</label>
            <label><input type="checkbox" name="force"> Force recompute</label>
          </div>
          <div class="jobs-toolbar">
            <button type="submit">Start run</button>
          </div>
        </form>

        <form class="trigger-card" data-target="provider_token_maintenance">
          <h3>Provider Token Maintenance</h3>
          <p>Refresh expiring provider tokens for Trakt or Simkl.</p>
          <label>Provider
            <select name="provider">
              <option value="">Any provider</option>
              <option value="trakt">Trakt</option>
              <option value="simkl">Simkl</option>
            </select>
          </label>
          <label>Profile id
            <input type="text" name="profileId" placeholder="optional-profile-id">
          </label>
          <label>Due within hours
            <input type="number" min="0" step="1" name="dueWithinHours" placeholder="24">
          </label>
          <div class="checkbox-row">
            <label><input type="checkbox" name="expiredOnly"> Expired only</label>
            <label><input type="checkbox" name="dryRun"> Dry run</label>
          </div>
          <div class="jobs-toolbar">
            <button type="submit">Run maintenance</button>
          </div>
        </form>
      </div>

      <div id="job-message" class="message info" hidden></div>

      <div class="two-panel-grid">
        <section class="panel">
          <div class="panel-head">
            <h3>Active and queued</h3>
          </div>
          <div class="panel-body">
            <div id="job-list-active"></div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h3>Recent runs</h3>
          </div>
          <div class="panel-body">
            <div id="job-list-recent"></div>
          </div>
        </section>
      </div>
    </section>
  `;
}
