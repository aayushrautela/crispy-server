export function renderSearchSuggestionsView(): string {
  return `<section class="view-panel" data-view="search-suggestions" hidden>
  <div class="panel-grid single">
    <article class="panel-card">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Search typeahead</p>
          <h2>Curated suggestions</h2>
          <p class="panel-note">Suggestions are keyword names served from the database, so the search box never spends TMDB quota while typing. Refreshing replaces one source's rows wholesale; a refresh that fails upstream leaves the previous set in place.</p>
        </div>
        <button type="button" id="search-suggestions-reload">Reload state</button>
      </div>
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Entries</th>
              <th>Last refreshed</th>
              <th>Upstream stamp</th>
              <th>By</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="search-suggestions-rows">
            <tr><td colspan="6" class="muted">Loading suggestion state...</td></tr>
          </tbody>
        </table>
      </div>
      <div id="search-suggestions-status" class="panel-note">Trending rotates weekly; classics only re-crawls when its upstream list actually changed.</div>
    </article>
  </div>
</section>`;
}
