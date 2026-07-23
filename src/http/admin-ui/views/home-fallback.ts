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
            <label>Locale mode
              <select name="localeMode" data-home-field="localeMode" required>
                <option value="auto" selected>Auto (use viewer profile)</option>
                <option value="en">Force English</option>
                <option value="specific">Specific locale</option>
              </select>
            </label>
            <label data-home-field="overrideLocaleWrap" hidden>Specific locale<select name="overrideLocale">
              <option value="en">English</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
              <option value="de">German</option>
              <option value="it">Italian</option>
              <option value="pt">Portuguese</option>
              <option value="pt-BR">Portuguese (Brazil)</option>
              <option value="ru">Russian</option>
              <option value="ja">Japanese</option>
              <option value="ko">Korean</option>
              <option value="zh">Chinese</option>
              <option value="zh-CN">Chinese (Simplified)</option>
              <option value="zh-TW">Chinese (Traditional)</option>
              <option value="hi">Hindi</option>
              <option value="pl">Polish</option>
              <option value="nl">Dutch</option>
              <option value="tr">Turkish</option>
              <option value="ar">Arabic</option>
              <option value="sv">Swedish</option>
              <option value="da">Danish</option>
              <option value="fi">Finnish</option>
              <option value="no">Norwegian</option>
              <option value="cs">Czech</option>
              <option value="el">Greek</option>
              <option value="he">Hebrew</option>
              <option value="th">Thai</option>
              <option value="vi">Vietnamese</option>
              <option value="id">Indonesian</option>
              <option value="ro">Romanian</option>
              <option value="uk">Ukrainian</option>
              <option value="fa">Persian</option>
              <option value="bn">Bengali</option>
              <option value="ta">Tamil</option>
              <option value="te">Telugu</option>
              <option value="ml">Malayalam</option>
              <option value="fil">Filipino</option>
            </select></label>
            <label data-home-field="regionOverrideWrap" hidden>Region override<select name="regionOverride">
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
