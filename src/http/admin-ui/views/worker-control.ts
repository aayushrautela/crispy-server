export function renderWorkerControlView(): string {
  return `
    <section class="view" data-view="worker-control" hidden>
      <header class="view-header">
        <h2>Worker Bridge</h2>
      </header>

      <div class="narrow-panel">
        <section class="panel">
          <div class="panel-head">
            <h3>Worker bridge status</h3>
          </div>
          <div class="panel-body">
            <p id="bridge-text">Checking worker bridge configuration...</p>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h3>Bridge payload</h3>
          </div>
          <div class="panel-body">
            <div class="code" id="bridge-json">Loading...</div>
          </div>
        </section>
      </div>
    </section>
  `;
}
