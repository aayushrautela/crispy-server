export function renderHomescreenTemplatesView(): string {
  return `
    <section class="view" data-view="homescreen-templates" hidden>
      <header class="view-header">
        <h2>Home Templates</h2>
        <div class="view-actions">
          <button type="button" class="secondary" data-homescreen-action="refresh-templates">Refresh</button>
          <button type="button" data-homescreen-action="create-template">New template</button>
        </div>
      </header>

      <form class="inline-form" data-homescreen-form="template-create" hidden>
        <label>Key <input name="key" required></label>
        <label>Locale <input name="locale" value="all" required></label>
        <label>Title <input name="title"></label>
        <label>Section keys (comma separated) <input name="sectionKeys" placeholder="tmdb-trending-hero,tmdb-popular-movies" required></label>
        <label class="checkbox"><input type="checkbox" name="isActive" checked> Active</label>
        <button type="submit">Save</button>
        <button type="button" class="secondary" data-homescreen-action="cancel-template">Cancel</button>
      </form>

      <div id="homescreen-templates-status" class="panel-note"></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr><th>Key</th><th>Locale</th><th>Title</th><th>Sections</th><th>Active</th><th></th></tr>
          </thead>
          <tbody id="homescreen-templates-rows"></tbody>
        </table>
      </div>
    </section>
  `;
}
