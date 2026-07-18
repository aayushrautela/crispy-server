export function renderHomescreenProfilesView(): string {
  return `
    <section class="view" data-view="homescreen-profiles" hidden>
      <header class="view-header">
        <h2>Profile Home</h2>
      </header>

      <form class="inline-form" data-homescreen-form="profile-lookup">
        <label>Account id <input name="accountId" required></label>
        <label>Profile id <input name="profileId" required></label>
        <button type="submit">Inspect</button>
      </form>

      <div id="homescreen-profiles-status" class="panel-note"></div>
      <div class="panel">
        <div class="panel-head"><h3 id="homescreen-profiles-title">Resolved home</h3></div>
        <div class="panel-body" id="homescreen-profiles-preview"></div>
      </div>

      <form class="inline-form" data-homescreen-form="profile-mode" hidden>
        <label>Home mode
          <select name="mode">
            <option value="recommended">recommended</option>
            <option value="custom">custom</option>
          </select>
        </label>
        <button type="submit">Set mode</button>
        <button type="button" class="secondary" data-homescreen-action="recompute-profile">Recompute</button>
      </form>
    </section>
  `;
}
