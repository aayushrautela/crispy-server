import { renderAccountsView } from './accounts.js';
import { renderAiLabView } from './ai-lab.js';
import { renderDiagnosticsView } from './diagnostics.js';
import { renderOverviewView } from './overview.js';
import { renderRecomputeJobsDetailView } from './recompute-jobs-detail.js';
import { renderRecomputeJobsListView } from './recompute-jobs-list.js';

export function renderAdminViews(): string {
  return [
    renderOverviewView(),
    renderDiagnosticsView(),
    renderAccountsView(),
    renderRecomputeJobsListView(),
    renderRecomputeJobsDetailView(),
    renderAiLabView(),
  ].join('');
}
