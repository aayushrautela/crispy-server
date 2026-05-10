export function renderRecomputeJobsCreateModal(): string {
  return `
    <div class="modal-backdrop" id="recompute-create-modal" hidden>
      <section class="panel modal-card" role="dialog" aria-modal="true" aria-labelledby="recompute-create-title">
        <div class="panel-head">
          <div>
            <h3 id="recompute-create-title">Create recompute job</h3>
            <p class="panel-note">Queue recommendation recompute work for explicit account/profile pairs or every eligible user.</p>
          </div>
          <button type="button" class="secondary" id="recompute-create-close">Close</button>
        </div>
        <div class="panel-body section-stack">
          <div id="recompute-create-message" class="message info" hidden></div>
          <form id="recompute-create-form" class="section-stack">
            <label>Scope
              <select id="recompute-create-scope" name="scope" required>
                <option value="explicit-targets">Explicit account/profile pairs</option>
                <option value="all-users">All users</option>
              </select>
            </label>
            <label id="recompute-create-targets-row">Targets
              <textarea id="recompute-create-targets" name="targets" rows="5" placeholder="One accountId,profileId pair per line"></textarea>
            </label>
            <label>Reason
              <input id="recompute-create-reason" name="reason" type="text" maxlength="180" placeholder="admin-ui-bulk-recompute">
            </label>
            <label id="recompute-create-confirm-row" hidden>All-users confirmation
              <input id="recompute-create-confirm" name="confirmation" type="text" autocomplete="off" placeholder="Type RECOMPUTE_ALL_USERS">
            </label>
            <div class="message warn" id="recompute-create-confirm-help" hidden>All-users jobs require typing <strong>RECOMPUTE_ALL_USERS</strong> exactly before submission.</div>
            <div class="jobs-toolbar">
              <button type="submit" id="recompute-create-submit">Create job</button>
              <button type="button" class="secondary" id="recompute-create-cancel">Cancel</button>
            </div>
          </form>
        </div>
      </section>
    </div>
  `;
}
