export function renderAiLabView(): string {
  return `<section class="view-panel" data-view="ai-lab" hidden>
  <div class="panel-grid single">
    <article class="panel-card">
      <div class="panel-head">
        <div>
          <p class="eyebrow">AI diagnostics</p>
          <h2>AI test bench</h2>
          <p class="panel-note">Test configured server models without exposing secrets in browser responses.</p>
        </div>
      </div>
      <form id="ai-test-form" class="section-stack">
        <div class="form-grid">
          <label>Configured model or custom model
            <input id="ai-test-model" type="text" list="ai-test-model-options" autocomplete="off" spellcheck="false" placeholder="Select or type a model" required>
            <datalist id="ai-test-model-options"></datalist>
          </label>
        </div>
        <div id="ai-test-config-summary" class="muted">Loading configured AI models...</div>
        <label>Prompt
          <textarea id="ai-test-prompt" rows="8" spellcheck="true" required>Return a JSON object with a short hello message and the current model name.</textarea>
        </label>
        <div class="jobs-toolbar">
          <button type="submit" id="ai-test-submit">Run selected test</button>
          <button type="button" id="ai-test-run-server">Run all server models</button>
        </div>
        <div id="ai-test-message" class="message" hidden></div>
      </form>
    </article>
    <article class="panel-card">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Response</p>
          <h2>Latest result</h2>
          <p class="panel-note">Run summary, safe logs, model output, and sanitized errors.</p>
        </div>
      </div>
      <div id="ai-test-result" class="empty">No AI test has run yet.</div>
    </article>
  </div>
</section>`;
}
