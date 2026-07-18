export function renderHomeFallbackView(): string {
  return `
    <section class="view" data-view="home-fallback" hidden>
      <div class="panel">
        <div class="panel-head">
          <h3>Home Fallback Templates</h3>
          <div class="panel-actions">
            <button type="button" class="secondary" data-home-action="refresh-fallback">Refresh</button>
            <button type="button" data-home-action="create-fallback">New template</button>
          </div>
        </div>
        <form class="inline-form" data-home-form="fallback-create" hidden>
          <input name="listKey" placeholder="listKey" required />
          <select name="sectionType" required>
            <option value="heroCarousel">heroCarousel</option>
            <option value="contentRail">contentRail</option>
            <option value="categoryTabs">categoryTabs</option>
            <option value="collectionRail">collectionRail</option>
          </select>
          <input name="title" placeholder="title" required />
          <input name="provider" placeholder="provider" required />
          <input name="providerId" placeholder="providerId" required />
          <select name="mediaType" required>
            <option value="movie">movie</option>
            <option value="tv">tv</option>
          </select>
          <input name="rank" type="number" placeholder="rank" value="0" />
          <button type="submit">Save</button>
          <button type="button" class="secondary" data-home-action="cancel-fallback">Cancel</button>
        </form>
        <div id="home-fallback-status" class="panel-note"></div>
        <table class="data-table">
          <thead><tr><th>List</th><th>Section</th><th>Rank</th><th>Title</th><th>Provider</th><th>Id</th><th>Type</th><th></th></tr></thead>
          <tbody id="home-fallback-rows"></tbody>
        </table>
      </div>
    </section>
  `;
}
