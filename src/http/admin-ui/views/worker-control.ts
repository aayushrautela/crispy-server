export function renderWorkerControlView(): string {
  return `
    <section class="view" data-view="worker-control" hidden>
      <header class="view-header compact">
        <h2>Worker Control</h2>
      </header>

      <section class="panel narrow-panel">
        <div class="panel-body section-stack">
          <div id="bridge-summary" class="mini-panel">
            <h4>Worker control status</h4>
            <p id="bridge-text">Checking worker control configuration...</p>
          </div>
          <div class="mini-panel">
            <h4>Bridge payload</h4>
          </div>
          <div class="code" id="bridge-json">Loading...</div>
        </div>
      </section>
    </section>
  `;
}
