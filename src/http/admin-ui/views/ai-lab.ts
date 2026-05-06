export function renderAiLabView(): string {
  return `<section class="view-panel" data-view="ai-lab" hidden>
  <div class="panel-grid single">
    <article class="panel-card">
      <div class="panel-head">
        <div>
          <p class="eyebrow">AI diagnostics</p>
          <h2>AI test bench</h2>
          <p class="panel-note">Send a prompt through configured AI credentials without exposing secrets in the browser response.</p>
        </div>
      </div>
      <form id="ai-test-form" class="section-stack">
        <div class="form-grid">
          <label>Provider
            <select id="ai-test-provider">
              <option value="openrouter">OpenRouter BYOK</option>
              <option value="server">Server AI</option>
            </select>
          </label>
          <label>Credential source
            <select id="ai-test-credential-source">
              <option value="server">Server key</option>
              <option value="custom">One-time API key</option>
            </select>
          </label>
          <label>Model
            <input id="ai-test-model" type="text" autocomplete="off" spellcheck="false" placeholder="openai/gpt-4o-mini" required>
          </label>
          <label>One-time API key
            <input id="ai-test-api-key" type="password" autocomplete="off" spellcheck="false" placeholder="Only sent for this request">
          </label>
        </div>
        <label>Prompt
          <textarea id="ai-test-prompt" rows="8" spellcheck="true" required>Return a JSON object with a short hello message and the current model name.</textarea>
        </label>
        <div class="jobs-toolbar">
          <button type="submit" id="ai-test-submit">Run AI test</button>
        </div>
        <div id="ai-test-message" class="message" hidden></div>
      </form>
    </article>
    <article class="panel-card">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Response</p>
          <h2>Latest result</h2>
          <p class="panel-note">Provider metadata and returned JSON payload.</p>
        </div>
      </div>
      <div id="ai-test-result" class="empty">No AI test has run yet.</div>
    </article>
  </div>
</section>`;
}
