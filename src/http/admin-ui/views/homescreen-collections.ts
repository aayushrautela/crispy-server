export function renderHomescreenCollectionsView(): string {
  return `
    <section class="view" data-view="homescreen-collections" hidden>
      <header class="view-header">
        <h2>Curated Collections</h2>
        <div class="view-actions">
          <button type="button" class="secondary" data-homescreen-action="refresh-collections">Refresh</button>
          <button type="button" data-homescreen-action="create-collection">New collection</button>
        </div>
      </header>

      <form class="inline-form" data-homescreen-form="collection-create" hidden>
        <label>Key <input name="key" required></label>
        <label>Title <input name="title" required></label>
        <label>Subtitle <input name="subtitle"></label>
        <label>Provider refs (provider:providerId, one per line) <textarea name="providerRefs" rows="4" placeholder="tmdb:550&#10;tmdb:13"></textarea></label>
        <button type="submit">Save</button>
        <button type="button" class="secondary" data-homescreen-action="cancel-collection">Cancel</button>
      </form>

      <div id="homescreen-collections-status" class="panel-note"></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr><th>Key</th><th>Title</th><th>Source</th><th>Items</th><th></th></tr>
          </thead>
          <tbody id="homescreen-collections-rows"></tbody>
        </table>
      </div>
    </section>
  `;
}
