export function renderHomeFallbackView(): string {
  return `
    <section class="view" data-view="home-fallback" hidden>
      <div class="panel">
        <div class="panel-head">
          <h3>Home Fallback Rails</h3>
          <div class="panel-actions">
            <button type="button" class="secondary" data-home-action="refresh-fallback">Refresh</button>
            <button type="button" data-home-action="create-fallback">New rail</button>
          </div>
        </div>
        <div id="home-fallback-status" class="panel-note"></div>
        <form class="stack-form" data-home-form="fallback-create" hidden>
          <div class="form-grid">
            <label>Locale mode
              <select name="localeMode" data-home-field="localeMode" required>
                <option value="auto" selected>Auto (use viewer profile)</option>
                <option value="en">Force English</option>
                <option value="specific">Specific locale</option>
              </select>
            </label>
            <label data-home-field="overrideLocaleWrap" hidden>Specific locale<select name="overrideLocale">
              <option value="en">en</option>
              <option value="es">es</option>
              <option value="fr">fr</option>
              <option value="de">de</option>
              <option value="hi">hi</option>
              <option value="pl">pl</option>
              <option value="ja">ja</option>
              <option value="ko">ko</option>
            </select></label>
            <label data-home-field="regionOverrideWrap" hidden>Region override<select name="regionOverride">
              <option value="">Any (use viewer region)</option>
              <option value="US">US</option>
              <option value="GB">GB</option>
              <option value="IN">IN</option>
              <option value="PL">PL</option>
              <option value="JP">JP</option>
              <option value="KR">KR</option>
              <option value="DE">DE</option>
              <option value="FR">FR</option>
            </select></label>
            <label>Section type<select name="sectionType" required>
              <option value="contentRail">contentRail</option>
              <option value="heroCarousel">heroCarousel</option>
              <option value="categoryTabs">categoryTabs</option>
              <option value="collectionRail">collectionRail</option>
            </select></label>
            <label>Source<select name="sourceId" required data-home-field="sourceId">
              <option value="">— select source —</option>
            </select></label>
            <label>Title<input name="title" placeholder="Trending Movies" required /></label>
            <label>Subtitle<input name="subtitle" placeholder="Popular right now" /></label>
            <label>Rank<input name="rank" type="number" value="0" /></label>
            <label>Refresh minutes<input name="refreshMinutes" type="number" placeholder="optional" /></label>
          </div>
          <div class="form-config" data-home-field="source-config"></div>
          <div class="panel-note" data-home-field="slug-preview"></div>
          <div class="inline-actions">
            <button type="button" class="secondary" data-home-action="preview-fallback">Preview</button>
            <button type="submit">Save</button>
            <button type="button" class="secondary" data-home-action="cancel-fallback">Cancel</button>
          </div>
        </form>
        <div class="panel-note" data-home-field="preview-status" hidden></div>
        <div class="preview-grid" data-home-field="preview-items"></div>
        <table class="data-table">
          <thead><tr><th>List</th><th>Mode</th><th>Section</th><th>Rank</th><th>Title</th><th>Source</th><th>Refreshed</th><th></th></tr></thead>
          <tbody id="home-fallback-rows"></tbody>
        </table>
      </div>
    </section>
  `;
}
