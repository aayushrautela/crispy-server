export function renderAccountsView(): string {
  return `
    <section class="view" data-view="accounts" hidden>
      <header class="view-header compact">
        <h1>Account Inspector</h1>
      </header>

      <div class="accounts-layout">
        <section class="panel profile-directory">
          <div class="panel-head">
          <div class="panel-head">
            <h2>Lookup</h2>
          </div>
          </div>
          <div class="panel-body section-stack">
            <form id="account-lookup-form">
              <label>Account email
                <input type="text" id="lookup-email" placeholder="person@example.com" required>
              </label>
              <div class="jobs-toolbar">
                <button type="submit">Resolve account</button>
              </div>
            </form>
            <div id="lookup-message" class="message info" hidden></div>
            <div id="account-summary" class="mini-panel" hidden></div>
            <div id="profile-list" class="profile-list"></div>
          </div>
        </section>

        <section class="panel profile-workspace">
          <div id="profile-detail-empty" class="panel-body profile-empty-state">
            <div class="empty">Resolve an account and choose a profile to load profile operations here.</div>
          </div>

          <div id="profile-detail-shell" hidden>
            <div class="panel-head profile-detail-head">
              <div>
                <h3 id="profile-detail-title">Profile workspace</h3>
                <p id="profile-detail-meta">No profile selected.</p>
              </div>
              <div class="hero-actions">
                <button type="button" class="secondary" id="refresh-profile-detail">Refresh profile view</button>
              </div>
            </div>
            <div class="panel-body section-stack">
              <div id="profile-detail-message" class="message info" hidden></div>
              <div id="profile-detail-body" class="profile-detail-body"></div>
            </div>
          </div>
        </section>
      </div>
    </section>
  `;
}
