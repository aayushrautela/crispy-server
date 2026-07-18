export function renderHomescreenDefaultView(): string {
  return `
    <section class="view" data-view="homescreen-default" hidden>
      <header class="view-header">
        <h2>Default Home</h2>
        <div class="view-actions">
          <button type="button" class="secondary" data-homescreen-action="preview-default">Preview cache</button>
          <button type="button" data-homescreen-action="regenerate-default">Regenerate</button>
        </div>
      </header>

      <form class="inline-form" data-homescreen-form="default-regenerate">
        <label>Locale <input name="locale" value="all"></label>
        <label>Region <input name="region" placeholder="US"></label>
        <button type="submit">Regenerate now</button>
      </form>

      <div id="homescreen-default-status" class="panel-note"></div>
      <div class="panel">
        <div class="panel-head"><h3 id="homescreen-default-title">Cached default home</h3></div>
        <div class="panel-body" id="homescreen-default-preview"></div>
      </div>
    </section>
  `;
}
