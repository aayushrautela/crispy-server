import { renderAccountsView } from './accounts.js';
import { renderDiagnosticsView } from './diagnostics.js';
import { renderJobsView } from './jobs.js';
import { renderOverviewView } from './overview.js';
import { renderWorkerControlView } from './worker-control.js';

export function renderAdminViews(): string {
  return [
    renderOverviewView(),
    renderJobsView(),
    renderDiagnosticsView(),
    renderAccountsView(),
    renderWorkerControlView(),
  ].join('');
}
