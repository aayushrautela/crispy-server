import { renderAccountsView } from './accounts.js';
import { renderAiLabView } from './ai-lab.js';
import { renderDiagnosticsView } from './diagnostics.js';
import { renderOverviewView } from './overview.js';
import { renderHomeDefaultView } from './home-default.js';
import { renderHomeProfilesView } from './home-profiles.js';

export function renderAdminViews(): string {
  return [
    renderOverviewView(),
    renderDiagnosticsView(),
    renderAccountsView(),
    renderAiLabView(),
    renderHomeDefaultView(),
    renderHomeProfilesView(),
  ].join('');
}
