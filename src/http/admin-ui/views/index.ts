import { renderAccountsView } from './accounts.js';
import { renderAiLabView } from './ai-lab.js';
import { renderDiagnosticsView } from './diagnostics.js';
import { renderOverviewView } from './overview.js';

export function renderAdminViews(): string {
  return [
    renderOverviewView(),
    renderDiagnosticsView(),
    renderAccountsView(),
    renderAiLabView(),
  ].join('');
}
