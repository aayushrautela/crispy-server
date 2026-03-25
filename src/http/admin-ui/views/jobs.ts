export function renderJobsView(): string {
  return `
    <section class="view" data-view="jobs" hidden>
      <div class="view-hero compact">
        <div>
          <div class="view-eyebrow">Worker orchestration</div>
          <h2>Worker Jobs</h2>
          <p>Trigger, watch, cancel, and clean up jobs without leaving the dashboard shell.</p>
        </div>
        <div class="hero-actions">
          <button type="button" class="secondary" id="refresh-jobs">Refresh status</button>
        </div>
      </div>

      <section class="panel">
        <div class="panel-body">
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
              <p>Refresh expiring provider tokens for Trakt or Simkl through the worker-control surface.</p>
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
        </div>
      </section>

      <div class="two-panel-grid">
        <section class="panel">
          <div class="panel-head">
            <div>
              <h3>Active + queued</h3>
              <p class="panel-note">Execution happens on the worker; orchestration and inspection live here.</p>
            </div>
          </div>
          <div class="panel-body">
            <div id="job-list-active"></div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <div>
              <h3>Recent runs</h3>
              <p class="panel-note">Completed and canceled jobs stay visible until deleted.</p>
            </div>
          </div>
          <div class="panel-body">
            <div id="job-list-recent"></div>
          </div>
        </section>
      </div>
    </section>
  `;
}
