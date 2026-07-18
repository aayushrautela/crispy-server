import { renderAccountsView } from './accounts.js';
import { renderAiLabView } from './ai-lab.js';
import { renderDiagnosticsView } from './diagnostics.js';
import { renderOverviewView } from './overview.js';
import { renderRecomputeJobsDetailView } from './recompute-jobs-detail.js';
import { renderRecomputeJobsListView } from './recompute-jobs-list.js';
import { renderHomescreenTemplatesView } from './homescreen-templates.js';
import { renderHomescreenCollectionsView } from './homescreen-collections.js';
import { renderHomescreenTraktView } from './homescreen-trakt.js';
import { renderHomescreenDefaultView } from './homescreen-default.js';
import { renderHomescreenProfilesView } from './homescreen-profiles.js';

export function renderAdminViews(): string {
  return [
    renderOverviewView(),
    renderDiagnosticsView(),
    renderAccountsView(),
    renderRecomputeJobsListView(),
    renderRecomputeJobsDetailView(),
    renderAiLabView(),
    renderHomescreenTemplatesView(),
    renderHomescreenCollectionsView(),
    renderHomescreenTraktView(),
    renderHomescreenDefaultView(),
    renderHomescreenProfilesView(),
  ].join('');
}
