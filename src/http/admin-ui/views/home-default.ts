export function renderHomeDefaultView(): string {
  return `
    <section class="view" data-view="home-default" hidden>
      <div class="panel">
        <div class="panel-head">
          <h3>Home Default Rails</h3>
          <div class="panel-actions">
            <button type="button" class="secondary" data-home-action="refresh-default">Refresh</button>
            <button type="button" data-home-action="create-default">New rail</button>
          </div>
        </div>
        <div id="home-default-status" class="panel-note"></div>
        <form class="stack-form" data-home-form="default-create" hidden>
          <div class="form-grid">
            <label>Source
              <select name="sourceId" data-home-field="sourceId" required>
                <option value="">— select source —</option>
              </select>
            </label>
            <label>List
              <select name="presetId" data-home-field="presetId" required>
                <option value="">— select list —</option>
              </select>
            </label>
            <label data-home-field="regionOverrideWrap">Region override<select name="regionOverride">
              <option value="">Any (use viewer region)</option>
              <option value="US">United States</option>
              <option value="GB">United Kingdom</option>
              <option value="IN">India</option>
              <option value="CA">Canada</option>
              <option value="AU">Australia</option>
              <option value="DE">Germany</option>
              <option value="FR">France</option>
              <option value="ES">Spain</option>
              <option value="IT">Italy</option>
              <option value="BR">Brazil</option>
              <option value="MX">Mexico</option>
              <option value="JP">Japan</option>
              <option value="KR">South Korea</option>
              <option value="CN">China</option>
              <option value="RU">Russia</option>
              <option value="NL">Netherlands</option>
              <option value="PL">Poland</option>
              <option value="SE">Sweden</option>
              <option value="NO">Norway</option>
              <option value="DK">Denmark</option>
              <option value="FI">Finland</option>
              <option value="TR">Turkey</option>
              <option value="AE">United Arab Emirates</option>
              <option value="SA">Saudi Arabia</option>
              <option value="ZA">South Africa</option>
              <option value="ID">Indonesia</option>
              <option value="TH">Thailand</option>
              <option value="VN">Vietnam</option>
              <option value="PH">Philippines</option>
            </select></label>
            <label>Section type<select name="sectionType" required>
              <option value="contentRail">contentRail</option>
              <option value="heroCarousel">heroCarousel</option>
              <option value="categoryTabs">categoryTabs</option>
              <option value="collectionRail">collectionRail</option>
            </select></label>
            <label>Title<input name="title" placeholder="Trending Movies" required /></label>
            <label>Subtitle<input name="subtitle" placeholder="Popular right now" /></label>
            <label>Rank<input name="rank" type="number" value="0" /></label>
            <label>Refresh minutes<input name="refreshMinutes" type="number" placeholder="optional" /></label>
          </div>
          <div class="form-config" data-home-field="source-config"></div>
          <div class="panel-note" data-home-field="slug-preview"></div>
          <div class="inline-actions">
            <button type="button" class="secondary" data-home-action="preview-default">Preview</button>
            <button type="submit">Save</button>
            <button type="button" class="secondary" data-home-action="cancel-default">Cancel</button>
          </div>
        </form>
        <div class="panel-note" data-home-field="preview-status" hidden></div>
        <div class="preview-grid" data-home-field="preview-items"></div>
        <table class="data-table">
          <thead><tr><th>List</th><th>Section</th><th>Rank</th><th>Title</th><th>Source</th><th>Refreshed</th><th></th></tr></thead>
          <tbody id="home-default-rows"></tbody>
        </table>
      </div>
    </section>
  `;
}
