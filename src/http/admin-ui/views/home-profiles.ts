export function renderHomeProfilesView(): string {
  return `
    <section class="view" data-view="home-profiles" hidden>
      <div class="panel">
        <div class="panel-head">
          <h3>Profile Home</h3>
        </div>
        <form class="inline-form" data-home-form="profile-lookup">
          <input name="accountId" placeholder="accountId" required />
          <input name="profileId" placeholder="profileId" required />
          <button type="submit">Inspect</button>
        </form>
        <div id="home-profiles-status" class="panel-note"></div>
        <div class="panel-head"><h3 id="home-profiles-title">Resolved home</h3></div>
        <div class="panel-body" id="home-profiles-preview"></div>
        <form class="inline-form" data-home-form="profile-mode" hidden>
          <select name="mode">
            <option value="recommended">recommended</option>
            <option value="custom">custom</option>
          </select>
          <button type="submit">Set mode</button>
          <button type="button" data-home-action="recompute-profile">Recompute</button>
        </form>
      </div>
    </section>
  `;
}
