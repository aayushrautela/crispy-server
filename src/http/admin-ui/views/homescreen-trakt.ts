export function renderHomescreenTraktView(): string {
  return `
    <section class="view" data-view="homescreen-trakt" hidden>
      <header class="view-header">
        <h2>Trakt Imports</h2>
        <div class="view-actions">
          <button type="button" class="secondary" data-homescreen-action="refresh-trakt">Refresh</button>
          <button type="button" data-homescreen-action="create-trakt">New trakt import</button>
        </div>
      </header>

      <form class="inline-form" data-homescreen-form="trakt-create" hidden>
        <label>Slug <input name="slug" required></label>
        <label>Title <input name="title"></label>
        <label>Trakt list id <input name="traktListId"></label>
        <label>Template key <input name="templateKey" value="default" required></label>
        <label class="checkbox"><input type="checkbox" name="active" checked> Active</label>
        <button type="submit">Save</button>
        <button type="button" class="secondary" data-homescreen-action="cancel-trakt">Cancel</button>
      </form>

      <div id="homescreen-trakt-status" class="panel-note"></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr><th>Slug</th><th>Title</th><th>Template</th><th>Active</th><th></th></tr>
          </thead>
          <tbody id="homescreen-trakt-rows"></tbody>
        </table>
      </div>
    </section>
  `;
}
