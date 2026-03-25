export function renderWorkerControlView(): string {
  return `
    <section class="view" data-view="worker-control" hidden>
      <div class="view-hero compact">
        <div>
          <div class="view-eyebrow">Bridge health</div>
          <h2>Worker Control</h2>
          <p>Health and configuration for the API-server-to-worker control link.</p>
        </div>
      </div>

      <section class="panel narrow-panel">
        <div class="panel-body section-stack">
          <div id="bridge-summary" class="mini-panel">
            <h4>Worker control status</h4>
            <p id="bridge-text">Checking worker control configuration...</p>
          </div>
          <div class="mini-panel">
            <h4>Bridge payload</h4>
            <p class="panel-note">This is the raw control-status payload returned by the API server.</p>
          </div>
          <div class="code" id="bridge-json">Loading...</div>
        </div>
      </section>
    </section>
  `;
}
