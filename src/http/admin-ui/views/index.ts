import { renderAccountsView } from './accounts.js';
import { renderDiagnosticsView } from './diagnostics.js';
import { renderOverviewView } from './overview.js';

export function renderAdminViews(): string {
  return [
    renderOverviewView(),
    renderDiagnosticsView(),
    renderAccountsView(),
  ].join('');
}
