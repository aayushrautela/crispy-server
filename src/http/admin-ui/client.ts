export const ADMIN_UI_CLIENT = String.raw`
(() => {
  const VIEW_META = {
    overview: {
      title: 'Overview',
      description: 'System health, live worker activity, and quick access to the main control surfaces.',
    },
    diagnostics: {
      title: 'Diagnostics',
      description: 'Backlog, lag, and import health in a workspace that stays readable.',
    },
    accounts: {
      title: 'Account Inspector',
      description: 'Resolve accounts, choose profiles, and keep profile operations in a dedicated workspace.',
    },
    'recompute-jobs': {
      title: 'Recompute Jobs',
      description: 'Create, monitor, and control bulk recommendation recompute jobs.',
    },
    'recompute-job-detail': {
      title: 'Recompute Job Detail',
      description: 'Inspect recompute progress, diagnostics, and job controls.',
    },
    'ai-lab': {
      title: 'AI Lab',
      description: 'Test configured AI targets, models, prompts, and one-time BYOK credentials.',
    },
  };

  const apiBase = String((document.body && document.body.getAttribute('data-admin-api-base')) || '/admin/api').replace(/\/$/, '');
  const adminCsrf = String((document.body && document.body.getAttribute('data-admin-csrf')) || '');

  const state = {
    activeView: 'overview',
    diagnosticsBusy: false,
    lookupBusy: false,
    notificationsOpen: false,
    lastUpdatedAt: null,
    diagnosticsPayload: null,
    notifications: [],
    unreadCount: 0,
    toasts: [],
    toastCounter: 0,
    selectedAccount: null,
    selectedProfile: null,
    selectedRecomputeJobId: null,
    recomputeJobs: [],
    pollersStarted: false,
    intervals: {
      diagnostics: 30000,
      recomputeJobs: 10000,
    },
  };

  const elements = {
    body: document.body,
    views: Array.from(document.querySelectorAll('[data-view]')),
    navButtons: Array.from(document.querySelectorAll('[data-nav-target]')),
    openViewButtons: Array.from(document.querySelectorAll('[data-open-view]')),
    refreshTargetButtons: Array.from(document.querySelectorAll('[data-refresh-target]')),
    sidebarToggle: document.getElementById('sidebar-toggle'),
    sidebarOverlay: document.getElementById('sidebar-overlay'),
    notificationsToggle: document.getElementById('notifications-toggle'),
    notificationsPanel: document.getElementById('notification-panel'),
    notificationsClear: document.getElementById('notifications-clear'),
    notificationsUnread: document.getElementById('notifications-unread'),
    notificationFeed: document.getElementById('notification-feed'),
    toastStack: document.getElementById('toast-stack'),
    currentViewTitle: document.getElementById('current-view-title'),
    currentViewDescription: document.getElementById('current-view-description'),
    topbarRunningCount: document.getElementById('topbar-running-count'),
    topbarLastUpdate: document.getElementById('topbar-last-update'),
    sidebarRunningStatus: document.getElementById('sidebar-running-status'),
    navDiagnosticsBadge: document.getElementById('nav-diagnostics-badge'),
    navAccountsBadge: document.getElementById('nav-accounts-badge'),
    navRecomputeJobsBadge: document.getElementById('nav-recompute-jobs-badge'),
    recomputeJobsFilterForm: document.getElementById('recompute-jobs-filter-form'),
    recomputeJobsStatus: document.getElementById('recompute-jobs-status'),
    recomputeJobsScope: document.getElementById('recompute-jobs-scope'),
    recomputeJobsLimit: document.getElementById('recompute-jobs-limit'),
    recomputeJobsSummary: document.getElementById('recompute-jobs-summary'),
    recomputeJobsRows: document.getElementById('recompute-jobs-rows'),
    recomputeJobsMessage: document.getElementById('recompute-jobs-message'),
    refreshRecomputeJobs: document.getElementById('refresh-recompute-jobs'),
    openRecomputeCreate: document.getElementById('open-recompute-create'),
    recomputeCreateModal: document.getElementById('recompute-create-modal'),
    recomputeCreateClose: document.getElementById('recompute-create-close'),
    recomputeCreateCancel: document.getElementById('recompute-create-cancel'),
    recomputeCreateForm: document.getElementById('recompute-create-form'),
    recomputeCreateScope: document.getElementById('recompute-create-scope'),
    recomputeCreateTargets: document.getElementById('recompute-create-targets'),
    recomputeCreateTargetsRow: document.getElementById('recompute-create-targets-row'),
    recomputeCreateReason: document.getElementById('recompute-create-reason'),
    recomputeCreateConfirm: document.getElementById('recompute-create-confirm'),
    recomputeCreateConfirmRow: document.getElementById('recompute-create-confirm-row'),
    recomputeCreateConfirmHelp: document.getElementById('recompute-create-confirm-help'),
    recomputeCreateMessage: document.getElementById('recompute-create-message'),
    recomputeDetailTitle: document.getElementById('recompute-detail-title'),
    recomputeDetailMeta: document.getElementById('recompute-detail-meta'),
    recomputeDetailMessage: document.getElementById('recompute-detail-message'),
    recomputeDetailSummary: document.getElementById('recompute-detail-summary'),
    recomputeDetailProgress: document.getElementById('recompute-detail-progress'),
    recomputeDetailActions: document.getElementById('recompute-detail-actions'),
    recomputeDetailDiagnostics: document.getElementById('recompute-detail-diagnostics'),
    refreshRecomputeJobDetail: document.getElementById('refresh-recompute-job-detail'),
    overviewSummary: document.getElementById('overview-summary'),
    overviewRunningJobs: document.getElementById('overview-running-jobs'),
    overviewDiagnostics: document.getElementById('overview-diagnostics'),
    overviewNotifications: document.getElementById('overview-notifications'),
    refreshDiagnostics: document.getElementById('refresh-diagnostics'),
    diagStats: document.getElementById('diag-stats'),
    backlogSummary: document.getElementById('backlog-summary'),
    outboxSummary: document.getElementById('outbox-summary'),
    importSummary: document.getElementById('import-summary'),
    serviceOutboxSummary: document.getElementById('service-outbox-summary'),
    serviceOutboxRows: document.getElementById('service-outbox-rows'),
    serviceOutboxFilterForm: document.getElementById('service-outbox-filter-form'),
    serviceOutboxCorrelationId: document.getElementById('service-outbox-correlation-id'),
    serviceOutboxProfileId: document.getElementById('service-outbox-profile-id'),
    serviceOutboxStatus: document.getElementById('service-outbox-status'),
    backlogRows: document.getElementById('backlog-rows'),
    importRows: document.getElementById('import-rows'),
    lookupForm: document.getElementById('account-lookup-form'),
    lookupEmail: document.getElementById('lookup-email'),
    lookupMessage: document.getElementById('lookup-message'),
    accountSummary: document.getElementById('account-summary'),
    profileList: document.getElementById('profile-list'),
    profileDetailEmpty: document.getElementById('profile-detail-empty'),
    profileDetailShell: document.getElementById('profile-detail-shell'),
    profileDetailTitle: document.getElementById('profile-detail-title'),
    profileDetailMeta: document.getElementById('profile-detail-meta'),
    profileDetailMessage: document.getElementById('profile-detail-message'),
    profileDetailBody: document.getElementById('profile-detail-body'),
    refreshProfileDetail: document.getElementById('refresh-profile-detail'),
    aiTestForm: document.getElementById('ai-test-form'),
    aiTestMode: document.getElementById('ai-test-mode'),
    aiTestModel: document.getElementById('ai-test-model'),
    aiTestModelOptions: document.getElementById('ai-test-model-options'),
    aiTestApiKey: document.getElementById('ai-test-api-key'),
    aiTestApiKeyRow: document.getElementById('ai-test-api-key-row'),
    aiTestPrompt: document.getElementById('ai-test-prompt'),
    aiTestSubmit: document.getElementById('ai-test-submit'),
    aiTestRunServer: document.getElementById('ai-test-run-server'),
    aiTestRunByok: document.getElementById('ai-test-run-byok'),
    aiTestRunAll: document.getElementById('ai-test-run-all'),
    aiTestConfigSummary: document.getElementById('ai-test-config-summary'),
    aiTestMessage: document.getElementById('ai-test-message'),
    aiTestResult: document.getElementById('ai-test-result'),
  };

  const aiLabState = {
    config: null,
    configLoaded: false,
  };

  bindNavigation();
  bindGlobalActions();
  bindForms();
  bindNotifications();
  bindSidebar();
  updateView(readHashView() || 'overview', false);
  renderNotificationFeed();
  renderToasts();
  renderOverview();
  void initialize();

  async function initialize() {
    await loadDiagnostics({ silent: true });
    await loadRecomputeJobs({ silent: true });
    const parsed = parseHashView(window.location.hash);
    if (parsed.jobId) await loadRecomputeJobDetail(parsed.jobId, { silent: true });
    await loadAiConfig();
    startPolling();
  }

  function bindNavigation() {
    for (const button of elements.navButtons) {
      button.addEventListener('click', () => {
        const target = button.getAttribute('data-nav-target');
        if (!target) return;
        updateView(target, true);
      });
    }

    for (const button of elements.openViewButtons) {
      button.addEventListener('click', () => {
        const target = button.getAttribute('data-open-view');
        if (!target) return;
        updateView(target, true);
      });
    }

    window.addEventListener('hashchange', () => {
      const value = readHashView();
      if (value && value !== state.activeView) {
        const parsed = parseHashView(value);
        updateView(parsed.view, false);
        if (parsed.jobId) void loadRecomputeJobDetail(parsed.jobId);
      }
    });
  }

  function bindGlobalActions() {
    for (const button of elements.refreshTargetButtons) {
      button.addEventListener('click', () => {
        const target = button.getAttribute('data-refresh-target');
        if (target === 'overview') {
          void loadDiagnostics();
        }
      });
    }

    if (elements.refreshDiagnostics) {
      elements.refreshDiagnostics.addEventListener('click', () => { void loadDiagnostics(); });
    }
    if (elements.refreshRecomputeJobs) {
      elements.refreshRecomputeJobs.addEventListener('click', () => { void loadRecomputeJobs(); });
    }
    if (elements.refreshRecomputeJobDetail) {
      elements.refreshRecomputeJobDetail.addEventListener('click', () => {
        if (state.selectedRecomputeJobId) void loadRecomputeJobDetail(state.selectedRecomputeJobId);
      });
    }
    if (elements.openRecomputeCreate) {
      elements.openRecomputeCreate.addEventListener('click', openRecomputeCreateModal);
    }
    if (elements.recomputeCreateClose) elements.recomputeCreateClose.addEventListener('click', closeRecomputeCreateModal);
    if (elements.recomputeCreateCancel) elements.recomputeCreateCancel.addEventListener('click', closeRecomputeCreateModal);
    if (elements.refreshProfileDetail) {
      elements.refreshProfileDetail.addEventListener('click', () => {
        if (!state.selectedAccount || !state.selectedProfile) return;
        void inspectProfile(state.selectedAccount.accountId, state.selectedProfile.id);
      });
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void loadDiagnostics({ silent: true });
      }
    });

    document.addEventListener('click', (event) => {
      if (!(event.target instanceof HTMLElement)) return;
      if (!state.notificationsOpen) return;
      const panel = elements.notificationsPanel;
      const toggle = elements.notificationsToggle;
      if (!panel || !toggle) return;
      if (panel.contains(event.target) || toggle.contains(event.target)) return;
      state.notificationsOpen = false;
      syncNotificationsPanel();
    });
  }

  function bindForms() {
    if (elements.lookupForm) {
      elements.lookupForm.addEventListener('submit', (event) => {
        event.preventDefault();
        void lookupAccount();
      });
    }
    if (elements.aiTestForm) {
      elements.aiTestForm.addEventListener('submit', (event) => {
        event.preventDefault();
        void runAiTest('selected');
      });
    }
    if (elements.serviceOutboxFilterForm) {
      elements.serviceOutboxFilterForm.addEventListener('submit', (event) => {
        event.preventDefault();
        void loadDiagnostics();
      });
    }
    if (elements.recomputeJobsFilterForm) {
      elements.recomputeJobsFilterForm.addEventListener('submit', (event) => {
        event.preventDefault();
        void loadRecomputeJobs();
      });
    }
    if (elements.recomputeCreateForm) {
      elements.recomputeCreateForm.addEventListener('submit', (event) => {
        event.preventDefault();
        void createRecomputeJob();
      });
    }
    if (elements.recomputeCreateScope) {
      elements.recomputeCreateScope.addEventListener('change', syncRecomputeCreateForm);
      syncRecomputeCreateForm();
    }
    if (elements.aiTestMode) {
      elements.aiTestMode.addEventListener('change', syncAiModeControls);
    }
    if (elements.aiTestRunServer) {
      elements.aiTestRunServer.addEventListener('click', () => { void runAiTest('server'); });
    }
    if (elements.aiTestRunByok) {
      elements.aiTestRunByok.addEventListener('click', () => { void runAiTest('byok'); });
    }
    if (elements.aiTestRunAll) {
      elements.aiTestRunAll.addEventListener('click', () => { void runAiTest('all'); });
    }
  }

  function bindNotifications() {
    if (elements.notificationsToggle) {
      elements.notificationsToggle.addEventListener('click', () => {
        state.notificationsOpen = !state.notificationsOpen;
        if (state.notificationsOpen) {
          markNotificationsRead();
        }
        syncNotificationsPanel();
      });
    }

    if (elements.notificationsClear) {
      elements.notificationsClear.addEventListener('click', () => {
        markNotificationsRead();
        renderNotificationFeed();
        syncNotificationsPanel();
      });
    }
  }

  function bindSidebar() {
    if (elements.sidebarToggle) {
      elements.sidebarToggle.addEventListener('click', () => {
        elements.body.classList.toggle('sidebar-open');
      });
    }
    if (elements.sidebarOverlay) {
      elements.sidebarOverlay.addEventListener('click', () => {
        elements.body.classList.remove('sidebar-open');
      });
    }
  }

  function updateView(viewId, updateHash) {
    if (!VIEW_META[viewId]) {
      viewId = 'overview';
    }
    state.activeView = viewId;
    for (const view of elements.views) {
      const isActive = view.getAttribute('data-view') === viewId;
      view.hidden = !isActive;
      view.classList.toggle('is-active', isActive);
    }
    for (const button of elements.navButtons) {
      const active = button.getAttribute('data-nav-target') === viewId;
      if (active) {
        button.setAttribute('aria-current', 'page');
      } else {
        button.removeAttribute('aria-current');
      }
    }

    const meta = VIEW_META[viewId];
    if (elements.currentViewTitle) {
      elements.currentViewTitle.textContent = meta.title;
    }
    if (elements.currentViewDescription) {
      elements.currentViewDescription.textContent = meta.description;
    }
    if (updateHash) {
      history.replaceState(null, '', '#' + viewId);
    }
    elements.body.classList.remove('sidebar-open');
  }

  function readHashView() {
    const value = String(window.location.hash || '').replace(/^#/, '');
    const parsed = parseHashView(value);
    return VIEW_META[parsed.view] ? parsed.view : '';
  }

  function parseHashView(hash) {
    const value = String(hash || '').replace(/^#/, '');
    if (value.startsWith('recompute-job-detail:')) {
      const jobId = value.replace('recompute-job-detail:', '');
      return { view: 'recompute-job-detail', jobId: decodeURIComponent(jobId) };
    }
    return { view: value, jobId: null };
  }

  function apiPath(path) {
    return apiBase + path;
  }

  function startPolling() {
    if (state.pollersStarted) return;
    state.pollersStarted = true;
    window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      void loadDiagnostics({ silent: true });
    }, state.intervals.diagnostics);
    window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      if (state.activeView === 'recompute-jobs' || hasActiveRecomputeJobs()) {
        void loadRecomputeJobs({ silent: true });
      }
      if (state.activeView === 'recompute-job-detail' && state.selectedRecomputeJobId) {
        void loadRecomputeJobDetail(state.selectedRecomputeJobId, { silent: true });
      }
    }, state.intervals.recomputeJobs);
  }

  async function fetchJson(url, options) {
    const method = String((options && options.method) || 'GET').toUpperCase();
    const response = await fetch(url, {
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        ...(options && options.body ? { 'content-type': 'application/json' } : {}),
        ...(method !== 'GET' && method !== 'HEAD' && adminCsrf ? { 'x-admin-csrf': adminCsrf } : {}),
      },
      ...options,
    });
    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text };
      }
    }
    if (!response.ok) {
      const message = payload && typeof payload.message === 'string'
        ? payload.message
        : payload && typeof payload.error === 'string'
          ? payload.error
          : 'Request failed';
      const error = new Error(message);
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  async function safeFetchJson(url, options) {
    try {
      return await fetchJson(url, options);
    } catch (error) {
      return {
        error: error && error.message ? error.message : 'Request failed',
        details: error && error.payload ? error.payload : null,
      };
    }
  }

  async function loadDiagnostics(options) {
    setBusy('diagnosticsBusy', true);
    try {
      const result = await Promise.all([
        fetchJson(apiPath('/diagnostics/recommendations/outbox?limit=8')),
        fetchJson(apiPath('/diagnostics/imports/connections?limit=8&refreshFailuresOnly=false')),
        fetchJson(apiPath('/diagnostics/recommendations/service-outbox' + serviceOutboxQueryString())),
      ]);
      const payload = {
        outbox: result[0],
        imports: result[1],
        serviceOutbox: result[2],
      };
      state.diagnosticsPayload = payload;
      renderDiagnostics(payload.outbox, payload.imports, payload.serviceOutbox);
      updateDiagnosticsChrome(payload);
      stampUpdated();
      return payload;
    } catch (error) {
      state.diagnosticsPayload = null;
      if (elements.diagStats) {
        elements.diagStats.innerHTML = '';
      }
      if (elements.backlogSummary) elements.backlogSummary.textContent = error.message || 'Failed to load diagnostics.';
      if (elements.outboxSummary) elements.outboxSummary.textContent = 'Unavailable';
      if (elements.importSummary) elements.importSummary.textContent = 'Unavailable';
      if (elements.backlogRows) elements.backlogRows.innerHTML = emptyTableRow('Diagnostics unavailable.', 4);
      if (elements.importRows) elements.importRows.innerHTML = emptyTableRow('Import diagnostics unavailable.', 5);
      if (elements.serviceOutboxSummary) elements.serviceOutboxSummary.textContent = 'Unavailable';
      if (elements.serviceOutboxRows) elements.serviceOutboxRows.innerHTML = emptyTableRow('Service outbox diagnostics unavailable.', 5);
      if (elements.navDiagnosticsBadge) elements.navDiagnosticsBadge.textContent = '!';
      if (!(options && options.silent)) {
        pushNotification('warn', 'Diagnostics degraded', error.message || 'Unable to refresh diagnostics.', true);
      }
      return null;
    } finally {
      setBusy('diagnosticsBusy', false);
      renderOverview();
    }
  }

  function updateDiagnosticsChrome(payload) {
    const undelivered = payload && payload.outbox && Array.isArray(payload.outbox.undelivered) ? payload.outbox.undelivered : [];
    const providerDiagnostics = payload && payload.imports && Array.isArray(payload.imports.providerDiagnostics) ? payload.imports.providerDiagnostics : [];
    const warningCount = providerDiagnostics.filter((row) => !!row.lastRefreshError).length
      + (undelivered.length > 0 ? 1 : 0);
    if (elements.navDiagnosticsBadge) {
      elements.navDiagnosticsBadge.textContent = String(warningCount);
    }
    if (elements.topbarRunningCount) {
      elements.topbarRunningCount.textContent = String(warningCount);
    }
    if (elements.sidebarRunningStatus) {
      elements.sidebarRunningStatus.textContent = warningCount
        ? String(warningCount) + ' diagnostics need attention.'
        : 'Recommendation outbox and import diagnostics are clear.';
    }
  }

  function serviceOutboxQueryString() {
    const params = new URLSearchParams();
    params.set('limit', '25');
    const correlationId = String((elements.serviceOutboxCorrelationId && elements.serviceOutboxCorrelationId.value) || '').trim();
    const profileId = String((elements.serviceOutboxProfileId && elements.serviceOutboxProfileId.value) || '').trim();
    const status = String((elements.serviceOutboxStatus && elements.serviceOutboxStatus.value) || '').trim();
    if (correlationId) params.set('correlationId', correlationId);
    if (profileId) params.set('profileId', profileId);
    if (status) params.set('status', status);
    return '?' + params.toString();
  }

  function recomputeJobsQueryString() {
    const params = new URLSearchParams();
    const status = String((elements.recomputeJobsStatus && elements.recomputeJobsStatus.value) || '').trim();
    const scope = String((elements.recomputeJobsScope && elements.recomputeJobsScope.value) || '').trim();
    const limit = String((elements.recomputeJobsLimit && elements.recomputeJobsLimit.value) || '25').trim();
    if (status) params.set('status', status);
    if (scope) params.set('scope', scope);
    if (limit) params.set('limit', limit);
    const query = params.toString();
    return query ? '?' + query : '';
  }

  async function loadRecomputeJobs(options) {
    if (!elements.recomputeJobsRows) return null;
    if (elements.refreshRecomputeJobs) elements.refreshRecomputeJobs.disabled = true;
    if (!(options && options.silent)) setMessage(elements.recomputeJobsMessage, 'info', 'Loading recompute jobs...');
    try {
      const payload = await fetchJson(apiPath('/recommendations/recompute-jobs' + recomputeJobsQueryString()));
      const jobs = normalizeRecomputeJobs(payload);
      state.recomputeJobs = jobs;
      renderRecomputeJobs(jobs, payload);
      setMessage(elements.recomputeJobsMessage, '', '');
      updateRecomputeJobsBadge(jobs);
      stampUpdated();
      renderOverview();
      return payload;
    } catch (error) {
      setMessage(elements.recomputeJobsMessage, 'error', error.message || 'Unable to load recompute jobs.');
      if (elements.recomputeJobsRows) elements.recomputeJobsRows.innerHTML = emptyTableRow('Recompute jobs unavailable.', 6);
      pushNotification('error', 'Recompute jobs unavailable', error.message || 'Unable to load recompute jobs.', true);
      return null;
    } finally {
      if (elements.refreshRecomputeJobs) elements.refreshRecomputeJobs.disabled = false;
    }
  }

  function normalizeRecomputeJobs(payload) {
    if (!payload) return [];
    if (Array.isArray(payload.jobs)) return payload.jobs;
    if (Array.isArray(payload.items)) return payload.items;
    if (Array.isArray(payload.recomputeJobs)) return payload.recomputeJobs;
    if (Array.isArray(payload)) return payload;
    return [];
  }

  function renderRecomputeJobs(jobs, payload) {
    const counts = summarizeRecomputeJobs(jobs);
    if (elements.recomputeJobsSummary) {
      elements.recomputeJobsSummary.innerHTML = [
        statCard('Jobs returned', jobs.length, 'current filter window'),
        statCard('Active', counts.active, 'queued, running, or paused'),
        statCard('Failures', counts.failed, 'failed or cancelled'),
      ].join('');
    }
    if (elements.recomputeJobsRows) {
      elements.recomputeJobsRows.innerHTML = jobs.length
        ? jobs.map(renderRecomputeJobRow).join('')
        : emptyTableRow('No recompute jobs matched.', 6);
      bindRecomputeJobTableActions();
    }
  }

  function renderRecomputeJobRow(job) {
    const jobId = recomputeJobId(job);
    const progress = recomputeProgress(job);
    return '<tr>'
      + '<td><strong>' + escapeHtml(jobId || 'unknown-job') + '</strong><br><span class="muted">' + escapeHtml(String(job.reason || job.note || 'no reason')) + '</span></td>'
      + '<td>' + escapeHtml(String(job.scope || job.targetScope || 'unknown')) + '</td>'
      + '<td>' + badge(String(job.status || 'unknown'), statusTone(String(job.status || 'unknown'))) + '</td>'
      + '<td>' + escapeHtml(progress.label) + '</td>'
      + '<td>' + escapeHtml(formatDate(job.createdAt || job.requestedAt || 'n/a')) + '</td>'
      + '<td><div class="jobs-toolbar">'
        + '<button type="button" class="secondary" data-open-recompute-job="' + escapeHtml(jobId) + '">Open</button>'
        + recomputeActionButton(jobId, job.status, 'pause')
        + recomputeActionButton(jobId, job.status, 'resume')
        + recomputeActionButton(jobId, job.status, 'cancel')
        + recomputeActionButton(jobId, job.status, 'reconcile')
      + '</div></td>'
      + '</tr>';
  }

  function recomputeActionButton(jobId, status, action) {
    if (!jobId) return '';
    const normalized = String(status || '').toLowerCase();
    const enabled = action === 'pause' ? ['queued', 'running'].includes(normalized)
      : action === 'resume' ? normalized === 'paused'
        : action === 'cancel' ? ['queued', 'running', 'paused'].includes(normalized)
          : ['queued', 'running', 'paused', 'failed'].includes(normalized);
    return '<button type="button" class="ghost" data-recompute-job-action="' + escapeHtml(action) + '" data-recompute-job-id="' + escapeHtml(jobId) + '"' + (enabled ? '' : ' disabled') + '>' + escapeHtml(action) + '</button>';
  }

  function bindRecomputeJobTableActions() {
    const openButtons = Array.from(document.querySelectorAll('[data-open-recompute-job]'));
    for (const button of openButtons) {
      button.addEventListener('click', () => {
        const jobId = button.getAttribute('data-open-recompute-job');
        if (!jobId) return;
        history.replaceState(null, '', '#recompute-job-detail:' + encodeURIComponent(jobId));
        updateView('recompute-job-detail', false);
        void loadRecomputeJobDetail(jobId);
      });
    }
    bindRecomputeActionButtons(document);
  }

  function bindRecomputeActionButtons(container) {
    const buttons = Array.from(container.querySelectorAll('[data-recompute-job-action]'));
    for (const button of buttons) {
      button.onclick = async () => {
        const action = button.getAttribute('data-recompute-job-action');
        const jobId = button.getAttribute('data-recompute-job-id');
        if (!action || !jobId) return;
        await runRecomputeJobAction(jobId, action, button);
      };
    }
  }

  async function runRecomputeJobAction(jobId, action, button) {
    if (button) button.disabled = true;
    const messageEl = state.activeView === 'recompute-job-detail' ? elements.recomputeDetailMessage : elements.recomputeJobsMessage;
    setMessage(messageEl, 'info', action + ' requested for recompute job ' + jobId + '...');
    try {
      await fetchJson(apiPath('/recommendations/recompute-jobs/' + encodeURIComponent(jobId) + '/' + encodeURIComponent(action)), { method: 'POST' });
      setMessage(messageEl, 'success', 'Recompute job ' + action + ' request accepted.');
      pushNotification('success', 'Recompute job updated', action + ' request accepted for ' + jobId + '.', true);
      await loadRecomputeJobs({ silent: true });
      if (state.selectedRecomputeJobId === jobId) await loadRecomputeJobDetail(jobId, { silent: true });
    } catch (error) {
      const description = describeApiError(error, 'Unable to update recompute job.');
      setMessage(messageEl, 'error', description);
      pushNotification('error', 'Recompute action failed', description, true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function loadRecomputeJobDetail(jobId, options) {
    state.selectedRecomputeJobId = jobId;
    if (!elements.recomputeDetailSummary) return null;
    if (!(options && options.silent)) setMessage(elements.recomputeDetailMessage, 'info', 'Loading recompute job...');
    try {
      const payload = await fetchJson(apiPath('/recommendations/recompute-jobs/' + encodeURIComponent(jobId)));
      const job = payload && payload.job ? payload.job : payload;
      renderRecomputeJobDetail(job || { id: jobId }, payload);
      setMessage(elements.recomputeDetailMessage, '', '');
      stampUpdated();
      return payload;
    } catch (error) {
      setMessage(elements.recomputeDetailMessage, 'error', error.message || 'Unable to load recompute job.');
      pushNotification('error', 'Recompute job unavailable', error.message || 'Unable to load recompute job.', true);
      return null;
    }
  }

  function renderRecomputeJobDetail(job, payload) {
    const jobId = recomputeJobId(job) || state.selectedRecomputeJobId || 'unknown-job';
    const progress = recomputeProgress(job);
    if (elements.recomputeDetailTitle) elements.recomputeDetailTitle.textContent = 'Job ' + jobId;
    if (elements.recomputeDetailMeta) elements.recomputeDetailMeta.textContent = String(job.scope || job.targetScope || 'unknown scope') + ' · ' + String(job.status || 'unknown status');
    if (elements.recomputeDetailSummary) {
      elements.recomputeDetailSummary.innerHTML = [
        statCard('Status', job.status || 'unknown', 'current job state'),
        statCard('Progress', progress.label, progress.percent + '% complete'),
        statCard('Failures', job.failedTargets || job.failedCount || 0, 'target failures'),
      ].join('');
    }
    if (elements.recomputeDetailProgress) {
      elements.recomputeDetailProgress.innerHTML = '<h4>Progress</h4><div class="kv-grid">'
        + kvPair('Queued', String(job.queuedTargets || job.queuedCount || '0'))
        + kvPair('Processed', String(job.processedTargets || job.processedCount || job.completedTargets || '0'))
        + kvPair('Total', String(job.totalTargets || job.targetCount || '0'))
        + kvPair('Updated', formatDate(job.updatedAt || job.createdAt || 'n/a'))
        + '</div>';
    }
    if (elements.recomputeDetailActions) {
      elements.recomputeDetailActions.innerHTML = recomputeActionButton(jobId, job.status, 'pause')
        + recomputeActionButton(jobId, job.status, 'resume')
        + recomputeActionButton(jobId, job.status, 'cancel')
        + recomputeActionButton(jobId, job.status, 'reconcile');
      bindRecomputeActionButtons(elements.recomputeDetailActions);
    }
    if (elements.recomputeDetailDiagnostics) {
      elements.recomputeDetailDiagnostics.innerHTML = '<div class="kv-grid">'
        + kvPair('Reason', job.reason || job.note || 'n/a')
        + kvPair('Created', formatDate(job.createdAt || 'n/a'))
        + kvPair('Started', job.startedAt ? formatDate(job.startedAt) : 'n/a')
        + kvPair('Finished', job.finishedAt ? formatDate(job.finishedAt) : 'n/a')
        + '</div><pre class="mini-panel">' + escapeHtml(JSON.stringify(payload || job, null, 2)) + '</pre>';
    }
  }

  function recomputeJobId(job) {
    return String((job && (job.id || job.jobId || job.bulkJobId)) || '');
  }

  function recomputeProgress(job) {
    const total = Number((job && (job.totalTargets || job.targetCount || job.totalCount)) || 0);
    const done = Number((job && (job.processedTargets || job.processedCount || job.completedTargets || job.completedCount)) || 0);
    const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((done / total) * 100))) : 0;
    return { percent, label: total > 0 ? String(done) + ' / ' + String(total) : String(done) + ' processed' };
  }

  function summarizeRecomputeJobs(jobs) {
    return jobs.reduce((summary, job) => {
      const status = String(job.status || '').toLowerCase();
      if (['queued', 'running', 'paused'].includes(status)) summary.active += 1;
      if (['failed', 'cancelled', 'canceled'].includes(status)) summary.failed += 1;
      return summary;
    }, { active: 0, failed: 0 });
  }

  function hasActiveRecomputeJobs() {
    return summarizeRecomputeJobs(state.recomputeJobs || []).active > 0;
  }

  function updateRecomputeJobsBadge(jobs) {
    if (elements.navRecomputeJobsBadge) elements.navRecomputeJobsBadge.textContent = String(summarizeRecomputeJobs(jobs).active);
  }

  function openRecomputeCreateModal() {
    if (elements.recomputeCreateModal) elements.recomputeCreateModal.hidden = false;
    syncRecomputeCreateForm();
  }

  function closeRecomputeCreateModal() {
    if (elements.recomputeCreateModal) elements.recomputeCreateModal.hidden = true;
  }

  function syncRecomputeCreateForm() {
    const scope = String((elements.recomputeCreateScope && elements.recomputeCreateScope.value) || 'explicit-targets');
    const allUsers = scope === 'all-users';
    if (elements.recomputeCreateTargetsRow) elements.recomputeCreateTargetsRow.hidden = allUsers;
    if (elements.recomputeCreateConfirmRow) elements.recomputeCreateConfirmRow.hidden = !allUsers;
    if (elements.recomputeCreateConfirmHelp) elements.recomputeCreateConfirmHelp.hidden = !allUsers;
  }

  function parseRecomputeTargets(value) {
    const lines = String(value || '').split(/\r?\n/);
    const targets = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (!line) continue;
      const parts = line.split(',').map((part) => part.trim()).filter(Boolean);
      if (parts.length !== 2) {
        return { error: 'Line ' + String(index + 1) + ' must contain accountId,profileId.' };
      }
      targets.push({ accountId: parts[0], profileId: parts[1] });
    }
    return { targets };
  }

  async function createRecomputeJob() {
    const scope = String((elements.recomputeCreateScope && elements.recomputeCreateScope.value) || 'explicit-targets');
    const reason = String((elements.recomputeCreateReason && elements.recomputeCreateReason.value) || 'admin-ui-bulk-recompute').trim();
    const confirmation = String((elements.recomputeCreateConfirm && elements.recomputeCreateConfirm.value) || '').trim();
    const allUsers = scope === 'all-users';
    const parsedTargets = allUsers ? { targets: [] } : parseRecomputeTargets(elements.recomputeCreateTargets && elements.recomputeCreateTargets.value);
    if (parsedTargets.error) {
      setMessage(elements.recomputeCreateMessage, 'error', parsedTargets.error);
      return;
    }
    if (!allUsers && parsedTargets.targets.length === 0) {
      setMessage(elements.recomputeCreateMessage, 'error', 'Enter at least one accountId,profileId target pair.');
      return;
    }
    if (allUsers && confirmation !== 'RECOMPUTE_ALL_USERS') {
      setMessage(elements.recomputeCreateMessage, 'error', 'Type RECOMPUTE_ALL_USERS exactly to create an all-users job.');
      return;
    }
    setMessage(elements.recomputeCreateMessage, 'info', 'Creating recompute job...');
    try {
      const body = allUsers
        ? { scope: { type: 'all_users' }, reason, confirmation }
        : { scope: { type: 'explicit_targets' }, targets: parsedTargets.targets, reason };
      const payload = await fetchJson(apiPath('/recommendations/recompute-jobs'), { method: 'POST', body: JSON.stringify(body) });
      const job = payload && payload.job ? payload.job : payload;
      const jobId = recomputeJobId(job);
      setMessage(elements.recomputeCreateMessage, 'success', 'Created recompute job' + (jobId ? ' ' + jobId : '') + '.');
      pushNotification('success', 'Recompute job created', jobId ? 'Created job ' + jobId + '.' : 'Created recompute job.', true);
      if (elements.recomputeCreateForm) elements.recomputeCreateForm.reset();
      syncRecomputeCreateForm();
      closeRecomputeCreateModal();
      await loadRecomputeJobs({ silent: true });
      if (jobId) {
        history.replaceState(null, '', '#recompute-job-detail:' + encodeURIComponent(jobId));
        updateView('recompute-job-detail', false);
        await loadRecomputeJobDetail(jobId, { silent: true });
      }
    } catch (error) {
      const description = describeApiError(error, 'Unable to create recompute job.');
      setMessage(elements.recomputeCreateMessage, 'error', description);
      pushNotification('error', 'Recompute job create failed', description, true);
    }
  }

  async function lookupAccount() {
    const email = String((elements.lookupEmail && elements.lookupEmail.value) || '').trim();
    if (!email) {
      setMessage(elements.lookupMessage, 'error', 'Enter an account email first.');
      return;
    }

    state.lookupBusy = true;
    if (elements.lookupForm) {
      elements.lookupForm.classList.add('loading');
    }
    setMessage(elements.lookupMessage, 'info', 'Resolving account and profiles...');
    if (elements.profileList) {
      elements.profileList.innerHTML = '';
    }
    if (elements.accountSummary) {
      elements.accountSummary.hidden = true;
    }
    if (elements.navAccountsBadge) {
      elements.navAccountsBadge.textContent = '0';
    }
    clearProfileWorkspace();

    try {
      const accountResponse = await fetchJson(apiPath('/accounts/lookup-by-email/' + encodeURIComponent(email)));
      const account = accountResponse.account;
      const profilesResponse = await fetchJson(apiPath('/accounts/' + encodeURIComponent(account.accountId) + '/profiles'));
      const profiles = Array.isArray(profilesResponse.profiles) ? profilesResponse.profiles : [];
      state.selectedAccount = account;
      state.selectedProfile = null;
      renderAccountSummary(account, profiles.length, email);

      if (elements.profileList) {
        if (profiles.length === 0) {
          elements.profileList.innerHTML = emptyState('No profiles found for this account.');
        } else {
          elements.profileList.innerHTML = profiles.map((profile) => renderProfileCard(account, profile)).join('');
          bindProfileSelectButtons(account, profiles);
          if (elements.navAccountsBadge) {
            elements.navAccountsBadge.textContent = String(profiles.length);
          }
        }
      }
      setMessage(elements.lookupMessage, 'success', 'Resolved account and loaded profiles.');
      updateView('accounts', true);
      pushNotification('success', 'Account resolved', 'Loaded ' + profiles.length + ' profiles for ' + (account.email || email) + '.', false);
    } catch (error) {
      setMessage(elements.lookupMessage, 'error', error.message || 'Unable to resolve account.');
      if (elements.navAccountsBadge) {
        elements.navAccountsBadge.textContent = '0';
      }
      pushNotification('error', 'Account lookup failed', error.message || 'Unable to resolve account.', true);
    } finally {
      state.lookupBusy = false;
      if (elements.lookupForm) {
        elements.lookupForm.classList.remove('loading');
      }
    }
  }

  function bindProfileSelectButtons(account, profiles) {
    const buttons = Array.from(document.querySelectorAll('[data-select-profile]'));
    for (const button of buttons) {
      button.addEventListener('click', () => {
        const profileId = button.getAttribute('data-select-profile');
        if (!profileId) return;
        const profile = profiles.find((item) => String(item.id) === profileId);
        if (!profile) return;
        state.selectedAccount = account;
        state.selectedProfile = profile;
        highlightSelectedProfile(profileId);
        void inspectProfile(account.accountId, profileId);
      });
    }
  }

  function highlightSelectedProfile(profileId) {
    const cards = Array.from(document.querySelectorAll('[data-profile-card]'));
    for (const card of cards) {
      const selected = card.getAttribute('data-profile-card') === profileId;
      card.classList.toggle('selected', selected);
    }
  }

  function clearProfileWorkspace() {
    state.selectedProfile = null;
    if (elements.profileDetailEmpty) elements.profileDetailEmpty.hidden = false;
    if (elements.profileDetailShell) elements.profileDetailShell.hidden = true;
    if (elements.profileDetailBody) elements.profileDetailBody.innerHTML = '';
    if (elements.profileDetailTitle) elements.profileDetailTitle.textContent = 'Profile workspace';
    if (elements.profileDetailMeta) elements.profileDetailMeta.textContent = 'No profile selected.';
    setMessage(elements.profileDetailMessage, '', '');
  }

  async function inspectProfile(accountId, profileId) {
    if (!elements.profileDetailBody) return;
    if (elements.profileDetailEmpty) elements.profileDetailEmpty.hidden = true;
    if (elements.profileDetailShell) elements.profileDetailShell.hidden = false;
    if (elements.profileDetailTitle) {
      elements.profileDetailTitle.textContent = state.selectedProfile && state.selectedProfile.name ? state.selectedProfile.name : 'Profile workspace';
    }
    if (elements.profileDetailMeta) {
      const accountText = state.selectedAccount ? (state.selectedAccount.email || state.selectedAccount.accountId) : accountId;
      const profileText = state.selectedProfile ? state.selectedProfile.id : profileId;
      elements.profileDetailMeta.textContent = 'Account ' + accountText + ' · profile ' + profileText;
    }
    setMessage(elements.profileDetailMessage, '', '');
    elements.profileDetailBody.innerHTML = '<div class="muted">Loading provider state, imports, watch data, and recommendations...</div>';

    try {
      const results = await Promise.all([
        safeFetchJson(apiPath('/accounts/' + encodeURIComponent(accountId) + '/profiles/' + encodeURIComponent(profileId) + '/imports/overview')),
        safeFetchJson(apiPath('/accounts/' + encodeURIComponent(accountId) + '/profiles/' + encodeURIComponent(profileId) + '/taste-profile?sourceKey=' + encodeURIComponent('default'))),
        safeFetchJson(apiPath('/accounts/' + encodeURIComponent(accountId) + '/profiles/' + encodeURIComponent(profileId) + '/recommendations?sourceKey=' + encodeURIComponent('default') + '&algorithmVersion=' + encodeURIComponent('v3.2.1'))),
        safeFetchJson(apiPath('/accounts/' + encodeURIComponent(accountId) + '/profiles/' + encodeURIComponent(profileId) + '/watch-history?limit=8')),
        safeFetchJson(apiPath('/accounts/' + encodeURIComponent(accountId) + '/profiles/' + encodeURIComponent(profileId) + '/continue-watching?limit=6')),
        safeFetchJson(apiPath('/accounts/' + encodeURIComponent(accountId) + '/profiles/' + encodeURIComponent(profileId) + '/watchlist?limit=8')),
        safeFetchJson(apiPath('/accounts/' + encodeURIComponent(accountId) + '/profiles/' + encodeURIComponent(profileId) + '/ratings?limit=8')),
        safeFetchJson(apiPath('/accounts/' + encodeURIComponent(accountId) + '/profiles/' + encodeURIComponent(profileId) + '/calendar')),
        safeFetchJson(apiPath('/accounts/' + encodeURIComponent(accountId) + '/profiles/' + encodeURIComponent(profileId) + '/calendar/this-week')),
        safeFetchJson(apiPath('/accounts/' + encodeURIComponent(accountId) + '/profiles/' + encodeURIComponent(profileId) + '/episodic-follow?limit=8')),
      ]);

      elements.profileDetailBody.innerHTML = [
        renderImportOverview(results[0]),
        renderMediaSection('Recent watch history', results[3], 'history'),
        renderMediaSection('Continue watching', results[4], 'continue'),
        renderMediaSection('Watchlist', results[5], 'watchlist'),
        renderMediaSection('Ratings', results[6], 'ratings'),
        renderCalendarSection(results[7]),
        renderThisWeekSection(results[8]),
        renderEpisodicFollowSection(results[9]),
        renderTasteProfileSection(results[1]),
        renderRecommendationsSection(results[2]),
      ].join('');

      bindProfileActionButtons(accountId, profileId, elements.profileDetailBody);
      pushNotification('info', 'Profile workspace loaded', 'Loaded profile ' + profileId + ' with imports, watch data, and recommendations.', false);
    } catch (error) {
      elements.profileDetailBody.innerHTML = '<div class="message error">' + escapeHtml(error.message || 'Unable to inspect profile.') + '</div>';
      pushNotification('error', 'Profile load failed', error.message || 'Unable to inspect profile.', true);
    }
  }

  function renderProfileCard(account, profile) {
    return '<div class="profile-card" data-profile-card="' + escapeHtml(profile.id) + '">'
      + '<strong>' + escapeHtml(profile.name || profile.id) + '</strong>'
      + '<div class="muted">Profile id: ' + escapeHtml(profile.id) + '</div>'
      + '<div class="profile-meta">'
      + badge(profile.isKids ? 'kids profile' : 'standard profile', profile.isKids ? 'warn' : 'info')
      + badge('updated ' + formatDate(profile.updatedAt || 'unknown'), 'info')
      + '</div>'
      + '<div class="jobs-toolbar profile-card-actions">'
      + '<button class="secondary" type="button" data-select-profile="' + escapeHtml(profile.id) + '" data-account-id="' + escapeHtml(account.accountId) + '">Open profile ops</button>'
      + '</div>'
      + '</div>';
  }

  function bindProfileActionButtons(accountId, profileId, container) {
    const messageEl = elements.profileDetailMessage;

    const importButtons = Array.from(container.querySelectorAll('[data-start-import]'));
    for (const button of importButtons) {
      button.onclick = async () => {
        const provider = button.getAttribute('data-start-import');
        if (!provider) return;
        button.disabled = true;
        setMessage(messageEl, 'info', 'Starting ' + provider + ' import...');
        try {
          const payload = await fetchJson(apiPath('/accounts/' + encodeURIComponent(accountId) + '/profiles/' + encodeURIComponent(profileId) + '/imports/start'), {
            method: 'POST',
            body: JSON.stringify({ provider: provider }),
          });
          if (payload.authUrl) {
            setHtmlMessage(messageEl, 'info', 'Authorization required for ' + escapeHtml(provider) + '. <a href="' + escapeHtml(String(payload.authUrl)) + '" target="_blank" rel="noopener noreferrer">Open provider auth</a>.');
            pushNotification('warn', 'Provider auth required', 'Authorization is required before ' + provider + ' import can continue.', true);
          } else {
            setMessage(messageEl, 'success', 'Queued ' + provider + ' import for this profile.');
            pushNotification('success', 'Import queued', 'Queued ' + provider + ' import for profile ' + profileId + '.', true);
          }
          await inspectProfile(accountId, profileId);
        } catch (error) {
          const description = describeApiError(error, 'Unable to start import.');
          setMessage(messageEl, 'error', description);
          pushNotification('error', 'Import start failed', description, true);
        } finally {
          button.disabled = false;
        }
      };
    }

    const refreshButtons = Array.from(container.querySelectorAll('[data-refresh-provider-token]'));
    for (const button of refreshButtons) {
      button.onclick = async () => {
        const provider = button.getAttribute('data-refresh-provider-token');
        if (!provider) return;
        button.disabled = true;
        setMessage(messageEl, 'info', 'Refreshing ' + provider + ' token...');
        try {
          const payload = await fetchJson(apiPath('/accounts/' + encodeURIComponent(accountId) + '/profiles/' + encodeURIComponent(profileId) + '/providers/' + encodeURIComponent(provider) + '/refresh-token'), {
            method: 'POST',
          });
          const refreshed = payload && payload.refreshed === true;
          setMessage(messageEl, 'success', refreshed ? 'Refreshed ' + provider + ' token.' : 'Checked ' + provider + ' token state.');
          pushNotification('success', 'Token refreshed', 'Refreshed ' + provider + ' token for profile ' + profileId + '.', true);
          await inspectProfile(accountId, profileId);
        } catch (error) {
          const description = describeApiError(error, 'Unable to refresh provider token.');
          setMessage(messageEl, 'error', description);
          pushNotification('error', 'Token refresh failed', description, true);
        } finally {
          button.disabled = false;
        }
      };
    }

    const disconnectButtons = Array.from(container.querySelectorAll('[data-disconnect-provider]'));
    for (const button of disconnectButtons) {
      button.onclick = async () => {
        const provider = button.getAttribute('data-disconnect-provider');
        if (!provider) return;
        button.disabled = true;
        setMessage(messageEl, 'info', 'Disconnecting ' + provider + '...');
        try {
          await fetchJson(apiPath('/accounts/' + encodeURIComponent(accountId) + '/profiles/' + encodeURIComponent(profileId) + '/providers/' + encodeURIComponent(provider) + '/connection'), {
            method: 'DELETE',
          });
          setMessage(messageEl, 'success', 'Disconnected ' + provider + '.');
          pushNotification('info', 'Provider disconnected', 'Disconnected ' + provider + ' for profile ' + profileId + '.', true);
          await inspectProfile(accountId, profileId);
        } catch (error) {
          const description = describeApiError(error, 'Unable to disconnect provider.');
          setMessage(messageEl, 'error', description);
          pushNotification('error', 'Disconnect failed', description, true);
        } finally {
          button.disabled = false;
        }
      };
    }

    const recomputeButtons = Array.from(container.querySelectorAll('[data-recompute-profile]'));
    for (const button of recomputeButtons) {
      button.onclick = async () => {
        button.disabled = true;
        setMessage(messageEl, 'info', 'Queueing recommendation recompute...');
        try {
          const payload = await fetchJson(apiPath('/accounts/' + encodeURIComponent(accountId) + '/profiles/' + encodeURIComponent(profileId) + '/recommendations/recompute'), {
            method: 'POST',
            body: JSON.stringify({ note: 'admin-ui-profile-workspace' }),
          });
          const correlationId = payload && payload.correlationId ? String(payload.correlationId) : 'unknown';
          const diagnosticsPath = payload && payload.diagnosticsUrl ? String(payload.diagnosticsUrl) : '/admin/api/diagnostics/recommendations/service-outbox?correlationId=' + encodeURIComponent(correlationId);
          setHtmlMessage(messageEl, 'success', 'Queued recommendation recompute. Correlation ID: <code>' + escapeHtml(correlationId) + '</code>. <a href="' + escapeHtml(diagnosticsPath) + '" target="_blank" rel="noopener noreferrer">Open diagnostics JSON</a>.');
          if (elements.serviceOutboxCorrelationId) elements.serviceOutboxCorrelationId.value = correlationId;
          pushNotification('success', 'Recompute queued', 'Queued recommendation recompute for profile ' + profileId + '.', true);
          await loadDiagnostics({ silent: true });
        } catch (error) {
          const description = describeApiError(error, 'Unable to queue recommendation recompute.');
          setMessage(messageEl, 'error', description);
          pushNotification('error', 'Recompute failed', description, true);
        } finally {
          button.disabled = false;
        }
      };
    }

    const refreshViewButtons = Array.from(container.querySelectorAll('[data-refresh-profile-view]'));
    for (const button of refreshViewButtons) {
      button.onclick = async () => {
        button.disabled = true;
        try {
          await inspectProfile(accountId, profileId);
        } finally {
          button.disabled = false;
        }
      };
    }
  }

  function renderDiagnostics(outbox, imports, serviceOutbox) {
    const undelivered = Array.isArray(outbox.undelivered) ? outbox.undelivered : [];
    const providerDiagnostics = Array.isArray(imports.providerDiagnostics) ? imports.providerDiagnostics : [];
    const refreshFailures = providerDiagnostics.filter((row) => !!row.lastRefreshError).length;
    const expiringSoon = providerDiagnostics.filter((row) => row.accessTokenExpiresAt).length;

    if (elements.diagStats) {
      elements.diagStats.innerHTML = [
        statCard('Undelivered events', undelivered.length, undelivered.length ? 'needs orchestration attention' : 'delivery is caught up'),
        statCard('Outbox undelivered', countArray(outbox.undelivered), lagText(outbox.lag)),
        statCard('Import refresh failures', refreshFailures, expiringSoon + ' with expiry timestamps'),
      ].join('');
    }

    if (elements.backlogSummary) {
      elements.backlogSummary.textContent = undelivered.length
        ? String(undelivered.length) + ' recommendation events are still undelivered.'
        : 'Recommendation delivery is caught up.';
    }
    if (elements.outboxSummary) {
      elements.outboxSummary.textContent = lagText(outbox.lag);
    }
    if (elements.importSummary) {
      elements.importSummary.textContent = providerDiagnostics.length
        ? refreshFailures + ' current provider sessions have refresh issues across ' + providerDiagnostics.length + ' providers.'
        : 'No provider diagnostics returned.';
    }
    if (elements.backlogRows) {
      elements.backlogRows.innerHTML = undelivered.length
        ? undelivered.map((row) => '<tr><td><strong>' + escapeHtml(String(row.profileId || 'unknown-profile')) + '</strong></td><td>' + escapeHtml(String(row.eventType || 'unknown')) + '</td><td>' + escapeHtml(String(row.occurredAt || 'n/a')) + '</td><td>' + escapeHtml(String(row.historyGeneration || 'n/a')) + '</td></tr>').join('')
        : emptyTableRow('No undelivered recommendation events.', 4);
    }
    if (elements.importRows) {
      elements.importRows.innerHTML = providerDiagnostics.length
        ? providerDiagnostics.map((row) => '<tr><td>'
          + '<strong>' + escapeHtml(String(row.profileId || 'unknown-profile')) + '</strong><br>'
          + '<span class="muted">' + escapeHtml(String(row.provider || 'unknown-provider')) + '</span>'
          + '</td><td>' + badge(String(row.state || 'unknown'), statusTone(String(row.state || 'unknown'))) + '</td><td>' + escapeHtml(String(row.externalUsername || row.providerUserId || 'n/a')) + '</td><td>' + escapeHtml(String(row.accessTokenExpiresAt || 'n/a')) + '</td><td>' + escapeHtml(String(row.lastRefreshError || 'none')) + '</td></tr>').join('')
        : emptyTableRow('No provider diagnostics.', 5);
    }

    const serviceEvents = serviceOutbox && Array.isArray(serviceOutbox.events) ? serviceOutbox.events : [];
    const serviceSummary = serviceOutbox && serviceOutbox.summary ? serviceOutbox.summary : null;
    if (elements.serviceOutboxSummary) {
      elements.serviceOutboxSummary.textContent = serviceSummary
        ? String(serviceSummary.total || 0) + ' recompute events returned: ' + String(serviceSummary.pending || 0) + ' pending, ' + String(serviceSummary.processing || 0) + ' processing, ' + String(serviceSummary.dispatched || 0) + ' dispatched, ' + String(serviceSummary.failed || 0) + ' failed.'
        : 'No service outbox summary returned.';
    }
    if (elements.serviceOutboxRows) {
      elements.serviceOutboxRows.innerHTML = serviceEvents.length
        ? serviceEvents.map((row) => '<tr><td><strong>' + escapeHtml(String(row.profileId || 'unknown-profile')) + '</strong><br><span class="muted">' + escapeHtml(String(row.userId || 'unknown-account')) + '</span></td><td>' + escapeHtml(String(row.reason || 'n/a')) + '</td><td>' + badge(String(row.status || 'unknown'), statusTone(String(row.status || 'unknown'))) + '</td><td>' + escapeHtml(String(row.correlationId || 'none')) + '</td><td>' + escapeHtml(String(row.createdAt || 'n/a')) + '</td></tr>').join('')
        : emptyTableRow('No recompute service outbox events matched.', 5);
    }
  }

  function setBusy(key, value) {
    state[key] = value;
    if (key === 'diagnosticsBusy' && elements.refreshDiagnostics) {
      elements.refreshDiagnostics.disabled = value;
    }
  }

  function setMessage(element, kind, text) {
    if (!element) return;
    if (!text) {
      element.hidden = true;
      return;
    }
    element.hidden = false;
    element.className = 'message ' + kind;
    element.textContent = text;
  }

  function setHtmlMessage(element, kind, html) {
    if (!element) return;
    if (!html) {
      element.hidden = true;
      return;
    }
    element.hidden = false;
    element.className = 'message ' + kind;
    element.innerHTML = html;
  }

  function describeApiError(error, fallback) {
    const message = error && error.message ? error.message : fallback;
    const payload = error && error.payload ? error.payload : null;
    const details = payload && payload.details ? payload.details : null;
    const detailParts = [];

    if (details && typeof details === 'object' && !Array.isArray(details)) {
      if (typeof details.providerStatus === 'number') {
        detailParts.push('upstream status ' + String(details.providerStatus));
      } else if (typeof details.upstreamStatusCode === 'number') {
        detailParts.push('upstream status ' + String(details.upstreamStatusCode));
      }
      if (typeof details.requestPath === 'string' && details.requestPath) {
        detailParts.push('request ' + details.requestPath);
      }
      if (typeof details.responseBody === 'string' && details.responseBody.trim()) {
        detailParts.push('response ' + summarizeErrorText(details.responseBody));
      }
    }

    return detailParts.length ? message + ' (' + detailParts.join('; ') + ')' : message;
  }

  function summarizeErrorText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 220);
  }

  function statCard(label, value, subtext) {
    return '<div class="stat-card"><div class="stat-label">' + escapeHtml(String(label)) + '</div><div class="stat-value">' + escapeHtml(String(value)) + '</div><div class="stat-subtext">' + escapeHtml(String(subtext || '')) + '</div></div>';
  }

  function emptyState(text) {
    return '<div class="empty">' + escapeHtml(text) + '</div>';
  }

  function emptyTableRow(text, span) {
    return '<tr><td colspan="' + span + '" class="muted">' + escapeHtml(text) + '</td></tr>';
  }

  function badge(value, tone) {
    const className = tone ? 'badge ' + tone : 'badge';
    return '<span class="' + escapeHtml(className) + '">' + escapeHtml(value) + '</span>';
  }

  function renderImportOverview(result) {
    if (result && result.error) {
      return sectionCard('Provider + import state', '<div class="message error">' + escapeHtml(result.error) + '</div>');
    }

    const watchDataState = result && result.watchDataState ? result.watchDataState : null;
    const jobs = result && Array.isArray(result.jobs) ? result.jobs : [];
    const providers = result && Array.isArray(result.providers) ? result.providers : [];

    const providerCards = providers.length
      ? '<div class="provider-grid">' + providers.map((provider) => renderProviderCard(provider)).join('') + '</div>'
      : emptyState('No provider states returned.');

    const jobsMarkup = jobs.length
      ? '<div class="section-stack">' + jobs.slice(0, 4).map((job) => renderImportJobCard(job)).join('') + '</div>'
      : emptyState('No import jobs yet for this profile.');

    return sectionCard('Provider + import state',
      '<div class="inline-actions">'
        + '<button type="button" class="secondary" data-refresh-profile-view="true">Refresh profile panel</button>'
        + '<button type="button" data-recompute-profile="true">Queue recommendation recompute</button>'
        + '<button type="button" data-start-import="trakt">Import Trakt watch data</button>'
        + '<button type="button" data-start-import="simkl">Import Simkl watch data</button>'
      + '</div>'
      + '<div class="kv-grid">'
        + kvPair('Current origin', watchDataState && watchDataState.currentOrigin ? watchDataState.currentOrigin : 'native')
        + kvPair('History generation', watchDataState && watchDataState.historyGeneration !== undefined ? String(watchDataState.historyGeneration) : 'n/a')
        + kvPair('Last import provider', watchDataState && watchDataState.lastImportProvider ? watchDataState.lastImportProvider : 'none')
        + kvPair('Last import completed', watchDataState && watchDataState.lastImportCompletedAt ? formatDate(watchDataState.lastImportCompletedAt) : 'n/a')
      + '</div>'
      + providerCards
      + '<div class="section-spacer">' + jobsMarkup + '</div>'
    );
  }

  function renderProviderCard(provider) {
    const connection = provider && provider.connection ? provider.connection : null;
    const tokenStatus = provider && provider.tokenStatus ? provider.tokenStatus : null;
    const connected = provider && provider.connected === true;
    const canRefresh = tokenStatus && tokenStatus.canRefresh === true;
    const refreshActionEnabled = connected && canRefresh;
    const tone = connected ? statusTone(tokenStatus && tokenStatus.tokenState ? tokenStatus.tokenState : 'connected') : 'warn';
    return '<div class="provider-card">'
      + '<div><strong>' + escapeHtml(String(provider.provider || 'provider')) + '</strong></div>'
      + '<div class="inline-actions">'
      + badge(connected ? 'connected' : 'not connected', tone)
      + (tokenStatus && tokenStatus.tokenState ? badge(tokenStatus.tokenState, statusTone(tokenStatus.tokenState)) : '')
      + '</div>'
      + '<div class="kv-grid">'
        + kvPair('User', connection ? (connection.externalUsername || connection.providerUserId || 'connected') : 'not connected')
        + kvPair('Expires', tokenStatus && tokenStatus.accessTokenExpiresAt ? formatDate(tokenStatus.accessTokenExpiresAt) : 'n/a')
        + kvPair('Last refresh', tokenStatus && tokenStatus.lastRefreshAt ? formatDate(tokenStatus.lastRefreshAt) : 'n/a')
        + kvPair('Refresh error', tokenStatus && tokenStatus.lastRefreshError ? tokenStatus.lastRefreshError : (provider.error || 'none'))
        + kvPair('Refresh support', connected ? (canRefresh ? 'available' : 'missing refresh token') : 'n/a')
        + kvPair('Recommended delay', formatRefreshDelay(tokenStatus && tokenStatus.recommendedRefreshDelayMs))
      + '</div>'
      + '<div class="inline-actions">'
        + '<button type="button" class="ghost" title="Force refresh this provider token now" data-refresh-provider-token="' + escapeHtml(String(provider.provider || '')) + '"' + (refreshActionEnabled ? '' : ' disabled') + '>Refresh token</button>'
        + '<button type="button" class="ghost" data-disconnect-provider="' + escapeHtml(String(provider.provider || '')) + '"' + (connected ? '' : ' disabled') + '>Disconnect</button>'
      + '</div>'
    + '</div>';
  }

  function renderImportJobCard(job) {
    const errorSummary = describeImportJobError(job && job.errorJson);
    const warnings = listImportJobWarnings(job);
    return '<div class="section-card">'
      + '<div class="inline-actions">'
        + badge(String(job.status || 'unknown'), statusTone(String(job.status || 'unknown')))
        + badge(String(job.provider || 'provider'), 'info')
      + '</div>'
      + '<div class="kv-grid">'
        + kvPair('Requested', formatDate(job.createdAt || 'n/a'))
        + kvPair('Started', job.startedAt ? formatDate(job.startedAt) : 'n/a')
        + kvPair('Finished', job.finishedAt ? formatDate(job.finishedAt) : 'n/a')
        + kvPair('Job id', job.id || 'n/a')
      + '</div>'
      + (errorSummary ? '<div class="message error">' + escapeHtml(errorSummary) + '</div>' : '')
      + (warnings.length ? '<div class="message warn">' + escapeHtml('Warnings: ' + warnings.join(' | ')) + '</div>' : '')
    + '</div>';
  }

  function describeImportJobError(errorJson) {
    if (!errorJson || typeof errorJson !== 'object' || Array.isArray(errorJson)) {
      return '';
    }

    const parts = [];
    if (typeof errorJson.message === 'string' && errorJson.message.trim()) {
      parts.push(errorJson.message.trim());
    }
    if (typeof errorJson.code === 'string' && errorJson.code.trim()) {
      parts.push('code ' + errorJson.code.trim());
    }
    if (typeof errorJson.requestId === 'string' && errorJson.requestId.trim()) {
      parts.push('request ' + errorJson.requestId.trim());
    }

    const details = errorJson.details;
    if (details && typeof details === 'object' && !Array.isArray(details)) {
      if (typeof details.providerStatus === 'number') {
        parts.push('upstream status ' + String(details.providerStatus));
      }
      if (typeof details.requestPath === 'string' && details.requestPath) {
        parts.push('request path ' + details.requestPath);
      }
      if (typeof details.responseBody === 'string' && details.responseBody.trim()) {
        parts.push('response ' + summarizeErrorText(details.responseBody));
      }
    }

    return parts.join(' | ');
  }

  function listImportJobWarnings(job) {
    const summaryWarnings = job && job.summaryJson && Array.isArray(job.summaryJson.warnings)
      ? job.summaryJson.warnings
      : [];
    const checkpointWarnings = job && job.checkpointJson && Array.isArray(job.checkpointJson.warnings)
      ? job.checkpointJson.warnings
      : [];
    const warnings = summaryWarnings.concat(checkpointWarnings).filter((value) => typeof value === 'string' && value.trim());
    return Array.from(new Set(warnings.map((value) => String(value).trim()))).slice(0, 4);
  }

  function renderMediaSection(title, result, kind) {
    if (result && result.error) {
      return sectionCard(title, '<div class="message error">' + escapeHtml(result.error) + '</div>');
    }

    const items = result && Array.isArray(result.items) ? result.items : [];
    if (items.length === 0) {
      return sectionCard(title, emptyState('No ' + title.toLowerCase() + ' yet.'));
    }

    return sectionCard(title, '<div class="item-list">' + items.map((item) => renderMediaRow(item, kind)).join('') + '</div>');
  }

  function renderEpisodicFollowSection(result) {
    if (result && result.error) {
      return sectionCard('Episodic Follow (Diagnostic)', '<div class="message error">' + escapeHtml(result.error) + '</div>');
    }
    const items = result && Array.isArray(result.items) ? result.items : [];
    if (items.length === 0) {
      return sectionCard('Episodic Follow (Diagnostic)', emptyState('No episodic follow items for this profile.'));
    }
    return sectionCard('Episodic Follow (Diagnostic)', '<div class="item-list">' + items.map((item) => {
      const media = item && item.show ? item.show : null;
      const hasCanonicalNextEpisode = Boolean(item && item.nextEpisodeMediaKey);
      const hasSeasonEpisode = item && item.nextEpisodeSeasonNumber != null && item.nextEpisodeEpisodeNumber != null;
      const episodeLabel =
        hasSeasonEpisode
          ? 'S' + item.nextEpisodeSeasonNumber + 'E' + item.nextEpisodeEpisodeNumber
          : item && item.nextEpisodeAbsoluteEpisodeNumber != null
            ? 'E' + item.nextEpisodeAbsoluteEpisodeNumber
            : '';
      const nextPrimary =
        hasCanonicalNextEpisode
          ? (item.nextEpisodeAirDate ? 'next ' + formatDate(item.nextEpisodeAirDate) : 'next resolved')
          : (item.nextEpisodeAirDate ? 'next unresolved' : 'next n/a');
      const nextSecondary =
        hasCanonicalNextEpisode
          ? [episodeLabel, item.nextEpisodeTitle].filter(Boolean).join(' • ')
          : (item.nextEpisodeAirDate ? 'raw date ' + formatDate(item.nextEpisodeAirDate) : '');
      return '<div class="item-row">'
        + '<strong>' + escapeHtml(mediaTitle(media)) + '</strong>'
        + '<div class="muted">' + escapeHtml(item.reason || 'no reason captured') + '</div>'
        + '<div class="item-meta">'
          + '<span>' + escapeHtml(nextPrimary) + '</span>'
          + '<span>last interacted ' + escapeHtml(item.lastInteractedAt ? formatDate(item.lastInteractedAt) : 'n/a') + '</span>'
        + '</div>'
        + (nextSecondary ? '<div class="muted">' + escapeHtml(nextSecondary) + '</div>' : '')
      + '</div>';
    }).join('') + '</div>');
  }

  function renderCalendarSection(result) {
    if (result && result.error) {
      return sectionCard('Calendar', '<div class="message error">' + escapeHtml(result.error) + '</div>');
    }
    const items = result && Array.isArray(result.items) ? result.items : [];
    if (items.length === 0) {
      return sectionCard('Calendar', emptyState('No canonical calendar items for this profile.'));
    }

    const orderedBuckets = ['up_next', 'this_week', 'upcoming', 'recently_released', 'no_scheduled'];
    const labels = {
      up_next: 'Up Next',
      this_week: 'This Week',
      upcoming: 'Upcoming',
      recently_released: 'Recently Released',
      no_scheduled: 'No Scheduled',
    };
    const groups = orderedBuckets
      .map((bucket) => ({ bucket: bucket, items: items.filter((item) => item && item.bucket === bucket) }))
      .filter((group) => group.items.length > 0);

    return sectionCard('Calendar', '<div class="section-stack">' + groups.map((group) => {
      return '<div class="section-card"><strong>' + escapeHtml(labels[group.bucket] || group.bucket) + '</strong>'
        + '<div class="item-list">' + group.items.map((item) => renderCalendarRow(item)).join('') + '</div></div>';
    }).join('') + '</div>');
  }

  function renderThisWeekSection(result) {
    if (result && result.error) {
      return sectionCard('This Week', '<div class="message error">' + escapeHtml(result.error) + '</div>');
    }
    const items = result && Array.isArray(result.items) ? result.items : [];
    if (items.length === 0) {
      return sectionCard('This Week', emptyState('No canonical this-week items for this profile.'));
    }
    return sectionCard('This Week', '<div class="item-list">' + items.map((item) => renderCalendarRow(item)).join('') + '</div>');
  }

  function renderCalendarRow(item) {
    const media = item && item.media ? item.media : null;
    const relatedShow = item && item.relatedShow ? item.relatedShow : null;
    const meta = [];
    const episodeBits = [];
    if (media && media.seasonNumber != null) episodeBits.push('S' + media.seasonNumber);
    if (media && media.episodeNumber != null) episodeBits.push('E' + media.episodeNumber);
    if (item && item.airDate) meta.push('airs ' + formatDate(item.airDate));
    meta.push('watched ' + ((item && item.watched) ? 'yes' : 'no'));

    return '<div class="item-row">'
      + '<strong>' + escapeHtml(mediaTitle(relatedShow || media)) + '</strong>'
      + '<div class="muted">' + escapeHtml([episodeBits.join(' '), media && media.episodeTitle ? media.episodeTitle : mediaSubtitle(media)].filter(Boolean).join(' • ') || 'No extra metadata') + '</div>'
      + '<div class="item-meta">' + meta.map((value) => '<span>' + escapeHtml(value) + '</span>').join('') + '</div>'
    + '</div>';
  }

  function renderTasteProfileSection(result) {
    if (result && result.error) {
      return sectionCard('Taste profile', '<div class="message error">' + escapeHtml(result.error) + '</div>');
    }
    const tasteProfile = result && result.tasteProfile ? result.tasteProfile : result;
    if (!tasteProfile || tasteProfile === null) {
      return sectionCard('Taste profile', emptyState('No taste profile stored yet.'));
    }
    return sectionCard('Taste profile',
      '<div class="kv-grid">'
        + kvPair('Source key', tasteProfile.sourceKey || 'default')
        + kvPair('Updated', tasteProfile.updatedAt ? formatDate(tasteProfile.updatedAt) : 'n/a')
        + kvPair('Watching pace', tasteProfile.watchingPace || 'n/a')
        + kvPair('Version', tasteProfile.version !== undefined ? String(tasteProfile.version) : 'n/a')
      + '</div>'
      + (tasteProfile.aiSummary ? '<div class="section-card"><strong>AI summary</strong><div class="muted section-copy">' + escapeHtml(tasteProfile.aiSummary) + '</div></div>' : '')
    );
  }

  function renderRecommendationsSection(result) {
    if (result && result.error) {
      return sectionCard('Recommendations', '<div class="message error">' + escapeHtml(result.error) + '</div>');
    }
    const recommendations = result && result.recommendations ? result.recommendations : result;
    if (!recommendations || recommendations === null) {
      return sectionCard('Recommendations', emptyState('No recommendation snapshot stored yet.'));
    }
    const sections = Array.isArray(recommendations.sections) ? recommendations.sections : [];
    return sectionCard('Recommendations',
      '<div class="kv-grid">'
        + kvPair('Source key', recommendations.sourceKey || 'default')
        + kvPair('Algorithm', recommendations.algorithmVersion || 'v3.2.1')
        + kvPair('Generated', recommendations.generatedAt ? formatDate(recommendations.generatedAt) : 'n/a')
        + kvPair('Sections', String(sections.length))
      + '</div>'
      + (sections.length
        ? '<div class="section-stack">' + sections.slice(0, 3).map((section) => '<div class="section-card"><strong>' + escapeHtml(section.title || section.id || 'Section') + '</strong><div class="muted section-copy">' + escapeHtml(renderRecommendationItems(section.items || [])) + '</div></div>').join('') + '</div>'
        : emptyState('Recommendation snapshot has no sections.'))
    );
  }

  function renderRecommendationItems(items) {
    return items.slice(0, 5).map((item) => {
      const media = item && item.media ? item.media : null;
      const reason = item && item.reason ? ' - ' + item.reason : '';
      return mediaTitle(media) + reason;
    }).join('\n');
  }

  function renderMediaRow(item, kind) {
    const media = item && item.media ? item.media : null;
    const meta = [];
    if (kind === 'history' && item && item.watchedAt) meta.push('watched ' + formatDate(item.watchedAt));
    if (kind === 'continue' && item && item.lastActivityAt) meta.push('last played ' + formatDate(item.lastActivityAt));
    if (kind === 'watchlist' && item && item.addedAt) meta.push('added ' + formatDate(item.addedAt));
    if (kind === 'ratings' && item && item.rating && item.rating.ratedAt) meta.push('rated ' + formatDate(item.rating.ratedAt));
    if (kind === 'ratings' && item && item.rating) meta.push('score ' + String(item.rating.value));
    if (kind === 'continue' && item && item.progress) meta.push('progress ' + formatProgress(item.progress));

    return '<div class="item-row">'
      + '<strong>' + escapeHtml(mediaTitle(media)) + '</strong>'
      + '<div class="muted">' + escapeHtml(mediaSubtitle(media)) + '</div>'
      + '<div class="item-meta">' + meta.map((value) => '<span>' + escapeHtml(value) + '</span>').join('') + '</div>'
    + '</div>';
  }

  function mediaTitle(media) {
    if (!media) return 'Unknown title';
    return media.title || media.subtitle || media.mediaKey || 'Unknown title';
  }

  function mediaSubtitle(media) {
    if (!media) return 'No metadata available';
    const parts = [];
    if (media.subtitle) parts.push(media.subtitle);
    if (media.releaseYear) parts.push(String(media.releaseYear));
    else if (media.releaseDate) parts.push(String(media.releaseDate).slice(0, 10));
    if (media.runtimeMinutes) parts.push(String(media.runtimeMinutes) + ' min');
    return parts.length ? parts.join(' · ') : 'No extra metadata';
  }

  function formatProgress(progress) {
    if (!progress) return 'n/a';
    if (typeof progress.progressPercent === 'number') {
      return Math.round(progress.progressPercent) + '%';
    }
    if (typeof progress.positionSeconds === 'number' && typeof progress.durationSeconds === 'number' && progress.durationSeconds > 0) {
      return Math.round((progress.positionSeconds / progress.durationSeconds) * 100) + '%';
    }
    return 'n/a';
  }

  function sectionCard(title, body) {
    return '<div class="mini-panel"><h4>' + escapeHtml(title) + '</h4><div class="section-body">' + body + '</div></div>';
  }

  function renderAccountSummary(account, profileCount, lookupEmail) {
    if (!elements.accountSummary) return;
    const pricingTier = String(account.pricingTier || 'free');
    elements.accountSummary.hidden = false;
    elements.accountSummary.innerHTML = '<h4>Account</h4>'
      + '<div class="kv-grid">'
      + kvPair('Account id', account.accountId)
      + kvPair('Email', account.email || lookupEmail)
      + kvPair('Profiles', String(profileCount))
      + kvPair('Pricing tier', pricingTier)
      + '</div>'
      + '<form id="account-pricing-tier-form" class="section-stack">'
      + '<label>Pricing tier'
      + '<select id="account-pricing-tier">'
      + pricingTierOption('free', pricingTier)
      + pricingTierOption('lite', pricingTier)
      + pricingTierOption('pro', pricingTier)
      + pricingTierOption('ultra', pricingTier)
      + '</select>'
      + '</label>'
      + '<div class="jobs-toolbar"><button type="submit">Save pricing tier</button></div>'
      + '</form>';
    bindPricingTierForm(account, profileCount, lookupEmail);
  }

  function pricingTierOption(value, selectedValue) {
    return '<option value="' + escapeHtml(value) + '"' + (value === selectedValue ? ' selected' : '') + '>' + escapeHtml(value) + '</option>';
  }

  function bindPricingTierForm(account, profileCount, lookupEmail) {
    const form = document.getElementById('account-pricing-tier-form');
    const select = document.getElementById('account-pricing-tier');
    if (!form || !select) return;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      setMessage(elements.lookupMessage, 'info', 'Saving pricing tier...');
      try {
        const payload = await fetchJson(apiPath('/accounts/' + encodeURIComponent(account.accountId) + '/pricing-tier'), {
          method: 'PATCH',
          body: JSON.stringify({ pricingTier: select.value }),
        });
        const pricingTier = payload && payload.pricingTier ? payload.pricingTier : select.value;
        state.selectedAccount = { ...account, pricingTier };
        renderAccountSummary(state.selectedAccount, profileCount, lookupEmail);
        setMessage(elements.lookupMessage, 'success', 'Pricing tier updated.');
        pushNotification('success', 'Pricing tier updated', 'Set ' + (account.email || lookupEmail || account.accountId) + ' to ' + pricingTier + '.', false);
      } catch (error) {
        setMessage(elements.lookupMessage, 'error', error.message || 'Unable to update pricing tier.');
        pushNotification('error', 'Pricing tier update failed', error.message || 'Unable to update pricing tier.', true);
      } finally {
        if (button) button.disabled = false;
      }
    });
  }

  async function loadAiConfig() {
    if (!elements.aiTestForm) return null;
    try {
      const payload = await fetchJson(apiPath('/ai/config'));
      aiLabState.config = payload;
      aiLabState.configLoaded = true;
      renderAiConfig(payload);
      syncAiModeControls();
      return payload;
    } catch (error) {
      aiLabState.config = null;
      aiLabState.configLoaded = false;
      if (elements.aiTestConfigSummary) {
        elements.aiTestConfigSummary.textContent = describeApiError(error, 'Unable to load AI configuration.');
      }
      return null;
    }
  }

  function renderAiConfig(config) {
    const targets = configuredAiTargets(config, 'all');
    if (elements.aiTestModelOptions) {
      const seen = new Set();
      elements.aiTestModelOptions.innerHTML = targets
        .filter((target) => {
          const key = target.mode + ':' + target.model;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((target) => '<option value="' + escapeHtml(target.model) + '">' + escapeHtml(aiTargetLabel(target)) + '</option>')
        .join('');
    }
    if (elements.aiTestConfigSummary) {
      const serverCount = configuredAiTargets(config, 'server').length;
      const byokCount = configuredAiTargets(config, 'byok').length;
      const serverStatus = config && config.server && config.server.available ? 'available' : 'missing AI_SERVER_API_KEY';
      elements.aiTestConfigSummary.textContent = 'Server AI: ' + serverStatus + ' (' + serverCount + ' configured models). OpenRouter BYOK: ' + byokCount + ' suggested models.';
    }
    if (elements.aiTestRunServer && config && config.server) {
      elements.aiTestRunServer.disabled = config.server.available !== true || configuredAiTargets(config, 'server').length === 0;
    }
    if (elements.aiTestRunByok) {
      elements.aiTestRunByok.disabled = configuredAiTargets(config, 'byok').length === 0;
    }
    if (elements.aiTestRunAll) {
      elements.aiTestRunAll.disabled = targets.length === 0;
    }
  }

  function syncAiModeControls() {
    const mode = String((elements.aiTestMode && elements.aiTestMode.value) || 'server');
    if (elements.aiTestApiKeyRow) {
      elements.aiTestApiKeyRow.hidden = mode !== 'byok';
    }
    if (elements.aiTestApiKey && mode !== 'byok') {
      elements.aiTestApiKey.value = '';
    }
  }

  function configuredAiTargets(config, scope) {
    if (!config) return [];
    const targets = [];
    if ((scope === 'server' || scope === 'all') && config.server && config.server.available === true && Array.isArray(config.server.models)) {
      for (const item of config.server.models) {
        if (!item || !item.model) continue;
        targets.push({ mode: 'server', tier: item.tier || '', feature: item.feature || '', model: item.model });
      }
    }
    if ((scope === 'byok' || scope === 'all') && config.byok && config.byok.available === true && Array.isArray(config.byok.models)) {
      for (const item of config.byok.models) {
        if (!item || !item.model) continue;
        targets.push({ mode: 'byok', feature: item.feature || '', model: item.model });
      }
    }
    return targets;
  }

  function aiTargetLabel(target) {
    const parts = [target.mode === 'server' ? 'Server AI' : 'OpenRouter BYOK'];
    if (target.tier) parts.push(target.tier);
    if (target.feature) parts.push(target.feature);
    parts.push(target.model);
    return parts.join(' · ');
  }

  function selectedAiTarget() {
    const mode = String((elements.aiTestMode && elements.aiTestMode.value) || 'server');
    const model = String((elements.aiTestModel && elements.aiTestModel.value) || '').trim();
    if (!model) return null;
    const matches = configuredAiTargets(aiLabState.config, mode).filter((target) => target.model === model);
    if (matches.length > 0) return matches[0];
    return { mode, model };
  }

  function uniqueAiTargets(targets) {
    const seen = new Set();
    return targets.filter((target) => {
      const key = target.mode + ':' + String(target.tier || '') + ':' + String(target.feature || '') + ':' + target.model;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async function runAiTest(scope) {
    const prompt = String((elements.aiTestPrompt && elements.aiTestPrompt.value) || '').trim();
    const apiKey = String((elements.aiTestApiKey && elements.aiTestApiKey.value) || '');
    const requestedScope = scope || 'selected';

    if (!prompt) {
      setMessage(elements.aiTestMessage, 'error', 'Enter a prompt first.');
      return;
    }

    if (!aiLabState.configLoaded) {
      await loadAiConfig();
    }

    let targets = [];
    if (requestedScope === 'selected') {
      const target = selectedAiTarget();
      if (!target) {
        setMessage(elements.aiTestMessage, 'error', 'Enter or select a model first.');
        return;
      }
      targets = [target];
    } else {
      targets = configuredAiTargets(aiLabState.config, requestedScope);
    }
    targets = uniqueAiTargets(targets).slice(0, 20);

    if (targets.length === 0) {
      setMessage(elements.aiTestMessage, 'error', 'No configured targets are available for this run.');
      return;
    }
    if (targets.some((target) => target.mode === 'byok') && !apiKey.trim()) {
      setMessage(elements.aiTestMessage, 'error', 'Enter a one-time OpenRouter API key for BYOK targets.');
      return;
    }

    setAiBusy(true);
    setMessage(elements.aiTestMessage, 'info', 'Running ' + targets.length + ' AI test' + (targets.length === 1 ? '' : 's') + '...');
    if (elements.aiTestResult) elements.aiTestResult.innerHTML = '<div class="muted">Waiting for provider responses...</div>';

    try {
      const payload = await fetchJson(apiPath('/ai/test'), {
        method: 'POST',
        body: JSON.stringify({
          prompt: prompt,
          targets: targets,
          apiKey: targets.some((target) => target.mode === 'byok') ? apiKey : undefined,
        }),
      });
      if (elements.aiTestApiKey) elements.aiTestApiKey.value = '';
      renderAiTestResult(payload);
      const summary = payload && payload.summary ? payload.summary : {};
      setMessage(elements.aiTestMessage, 'success', 'AI run completed: ' + String(summary.success || 0) + ' succeeded, ' + String(summary.error || 0) + ' failed.');
      pushNotification('success', 'AI run completed', 'Ran ' + String(summary.total || targets.length) + ' configured target(s).', false);
    } catch (error) {
      const description = describeApiError(error, 'Unable to run AI test.');
      if (elements.aiTestApiKey) elements.aiTestApiKey.value = '';
      setMessage(elements.aiTestMessage, 'error', description);
      if (elements.aiTestResult) elements.aiTestResult.innerHTML = '<div class="message error">' + escapeHtml(description) + '</div>';
      pushNotification('error', 'AI test failed', description, true);
    } finally {
      setAiBusy(false);
    }
  }

  function setAiBusy(busy) {
    const controls = [elements.aiTestSubmit, elements.aiTestRunServer, elements.aiTestRunByok, elements.aiTestRunAll];
    for (const control of controls) {
      if (control) control.disabled = busy;
    }
    if (!busy && aiLabState.config) renderAiConfig(aiLabState.config);
  }

  function renderAiTestResult(payload) {
    if (!elements.aiTestResult) return;
    const summary = payload && payload.summary ? payload.summary : {};
    const results = payload && Array.isArray(payload.results) ? payload.results : [];
    elements.aiTestResult.innerHTML = '<div class="kv-grid">'
      + kvPair('Run ID', payload && payload.runId ? payload.runId : 'n/a')
      + kvPair('Started', payload && payload.startedAt ? formatDate(payload.startedAt) : 'n/a')
      + kvPair('Completed', payload && payload.completedAt ? formatDate(payload.completedAt) : 'n/a')
      + kvPair('Summary', String(summary.success || 0) + ' succeeded · ' + String(summary.error || 0) + ' failed · ' + String(summary.total || results.length) + ' total')
      + '</div>'
      + '<div class="section-stack">'
      + results.map(renderAiTargetResult).join('')
      + '</div>';
  }

  function renderAiTargetResult(item) {
    const status = item && item.status ? item.status : 'unknown';
    const providerDetails = renderAiProviderErrorDetails(item && item.providerError);
    const body = item && item.status === 'success'
      ? '<pre class="code-block">' + escapeHtml(JSON.stringify(item.result == null ? null : item.result, null, 2)) + '</pre>'
      : '<div class="message error">' + escapeHtml(item && item.error ? item.error : 'No result returned.') + '</div>' + providerDetails;
    const logs = item && Array.isArray(item.logs) && item.logs.length > 0
      ? '<pre class="code-block">' + escapeHtml(item.logs.join('\n')) + '</pre>'
      : '<div class="muted">No logs.</div>';
    return '<article class="panel-card">'
      + '<div class="panel-head"><div><p class="eyebrow">' + escapeHtml(item && item.mode === 'server' ? 'Server AI' : 'OpenRouter BYOK') + '</p>'
      + '<h3>' + escapeHtml(item && item.model ? item.model : 'Unknown model') + '</h3>'
      + '<p class="panel-note">' + escapeHtml(aiTargetLabel(item || {})) + '</p></div>'
      + '<span class="status-pill ' + escapeHtml(statusTone(status)) + '">' + escapeHtml(status) + '</span></div>'
      + '<div class="kv-grid">'
      + kvPair('Duration', String(item && item.durationMs != null ? item.durationMs : 0) + ' ms')
      + kvPair('Feature', item && item.feature ? item.feature : 'custom')
      + kvPair('Tier', item && item.tier ? item.tier : 'n/a')
      + '</div>'
      + '<h4>Logs</h4>' + logs
      + '<h4>Result</h4>' + body
      + '</article>';
  }

  function renderAiProviderErrorDetails(details) {
    if (!details || typeof details !== 'object') return '';
    const parts = [];
    if (details.provider) parts.push(kvPair('Provider', details.provider));
    if (details.providerStatus !== undefined) parts.push(kvPair('Provider status', details.providerStatus));
    if (details.failureKind) parts.push(kvPair('Failure kind', details.failureKind));
    if (details.providerErrorCode) parts.push(kvPair('Provider code', details.providerErrorCode));
    if (details.providerErrorParam) parts.push(kvPair('Provider param', details.providerErrorParam));
    if (details.retryAfterSeconds !== undefined) parts.push(kvPair('Retry after', String(details.retryAfterSeconds) + 's'));
    if (details.errorMessage) parts.push(kvPair('Provider message', details.errorMessage));
    if (details.responseBody) parts.push(kvPair('Provider response', summarizeErrorText(details.responseBody)));
    if (parts.length === 0) return '';
    return '<h4>Provider error details</h4><div class="kv-grid">' + parts.join('') + '</div>';
  }

  function kvPair(label, value) {
    return '<div class="kv-pair"><span class="label">' + escapeHtml(label) + '</span><span class="value">' + escapeHtml(value == null ? 'n/a' : String(value)) + '</span></div>';
  }

  function statusTone(value) {
    switch (String(value || '')) {
      case 'connected':
      case 'valid':
      case 'success':
      case 'succeeded':
      case 'succeeded_with_warnings':
        return 'ok';
      case 'expiring':
      case 'queued':
      case 'running':
      case 'oauth_pending':
      case 'pending':
        return 'info';
      case 'expired':
      case 'revoked':
      case 'cancelled':
      case 'canceled':
        return 'warn';
      case 'failed':
      case 'error':
      case 'missing_access_token':
        return 'err';
      default:
        return '';
    }
  }

  function lagText(lag) {
    if (!lag || typeof lag !== 'object') return 'No lag summary.';
    return 'undelivered=' + String(lag.undeliveredCount || 0) + ', oldest=' + String(lag.oldestUndeliveredAt || 'n/a');
  }

  function formatDate(value) {
    if (!value) return 'n/a';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString();
  }

  function formatRefreshDelay(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return 'n/a';
    }
    if (value <= 0) {
      return 'eligible now';
    }

    const seconds = Math.round(value / 1000);
    if (seconds < 60) return 'in ' + seconds + 's';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return 'in ' + minutes + 'm';
    const hours = Math.round(minutes / 60);
    if (hours < 24) return 'in ' + hours + 'h';
    const days = Math.round(hours / 24);
    return 'in ' + days + 'd';
  }

  function formatTimeAgo(value) {
    if (!value) return 'never';
    const diff = Date.now() - value;
    if (diff < 5000) return 'just now';
    const seconds = Math.round(diff / 1000);
    if (seconds < 60) return seconds + 's ago';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + 'm ago';
    const hours = Math.round(minutes / 60);
    if (hours < 24) return hours + 'h ago';
    const days = Math.round(hours / 24);
    return days + 'd ago';
  }

  function countArray(value) {
    return Array.isArray(value) ? value.length : 0;
  }

  function sum(values) {
    return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function maybeNotifyBridge(payload, silent) {
    const workerControl = payload && payload.workerControl ? payload.workerControl : {};
    const signature = String(workerControl.configured) + ':' + String(workerControl.reachable) + ':' + String(workerControl.error || '');
    if (state.bridgeSignature === null) {
      state.bridgeSignature = signature;
      return;
    }
    if (signature === state.bridgeSignature) {
      return;
    }
    state.bridgeSignature = signature;
    if (silent) return;
    if (workerControl.configured !== true) {
      pushNotification('warn', 'Worker bridge not configured', 'Set the worker bridge environment variables to enable worker reachability checks.', true);
    } else if (workerControl.reachable === true) {
      pushNotification('success', 'Worker bridge reachable', 'The API server can talk to the recommendation worker again.', true);
    } else {
      pushNotification('error', 'Worker bridge unreachable', workerControl.error || 'The bridge is configured but the worker cannot be reached.', true);
    }
  }

  function pushNotification(kind, title, text, toast) {
    const item = {
      id: 'n-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8),
      kind: kind,
      title: title,
      text: text,
      createdAt: Date.now(),
      read: state.notificationsOpen,
    };
    state.notifications.unshift(item);
    state.notifications = state.notifications.slice(0, 30);
    if (!item.read) {
      state.unreadCount += 1;
    }
    renderNotificationFeed();
    if (toast) {
      state.toastCounter += 1;
      state.toasts.unshift({
        id: 't-' + state.toastCounter,
        kind: kind,
        title: title,
        text: text,
      });
      state.toasts = state.toasts.slice(0, 4);
      renderToasts();
      const toastId = 't-' + state.toastCounter;
      window.setTimeout(() => {
        state.toasts = state.toasts.filter((entry) => entry.id !== toastId);
        renderToasts();
      }, 4200);
    }
    renderOverview();
  }

  function markNotificationsRead() {
    for (const notification of state.notifications) {
      notification.read = true;
    }
    state.unreadCount = 0;
    renderNotificationFeed();
  }

  function renderNotificationFeed() {
    if (elements.notificationFeed) {
      if (!state.notifications.length) {
        elements.notificationFeed.innerHTML = emptyState('No notifications yet. Diagnostics and control-plane events will land here.');
      } else {
        elements.notificationFeed.innerHTML = state.notifications.map((item) => {
          return '<article class="notification-item ' + (item.read ? '' : 'unread') + '">'
            + '<div class="notification-item-head">'
            + '<strong>' + escapeHtml(item.title) + '</strong>'
            + badge(item.kind, item.kind)
            + '</div>'
            + '<p>' + escapeHtml(item.text) + '</p>'
            + '<div class="item-meta meta-spaced"><span>' + escapeHtml(formatTimeAgo(item.createdAt)) + '</span></div>'
            + '</article>';
        }).join('');
      }
    }
    if (elements.notificationsUnread) {
      elements.notificationsUnread.hidden = state.unreadCount === 0;
      elements.notificationsUnread.textContent = String(state.unreadCount);
    }
  }

  function renderToasts() {
    if (!elements.toastStack) return;
    elements.toastStack.innerHTML = state.toasts.map((item) => {
      return '<article class="toast ' + escapeHtml(item.kind) + '">'
        + '<strong>' + escapeHtml(item.title) + '</strong>'
        + '<p>' + escapeHtml(item.text) + '</p>'
        + '</article>';
    }).join('');
  }

  function syncNotificationsPanel() {
    if (elements.notificationsPanel) {
      elements.notificationsPanel.hidden = !state.notificationsOpen;
    }
  }

  function stampUpdated() {
    state.lastUpdatedAt = Date.now();
    if (elements.topbarLastUpdate) {
      elements.topbarLastUpdate.textContent = formatTimeAgo(state.lastUpdatedAt);
    }
  }

  function renderOverview() {
    renderOverviewSummary();
    renderOverviewRunningJobs();
    renderOverviewBridge();
    renderOverviewDiagnostics();
    renderOverviewNotifications();
    if (elements.topbarLastUpdate && state.lastUpdatedAt) {
      elements.topbarLastUpdate.textContent = formatTimeAgo(state.lastUpdatedAt);
    }
  }

  function renderOverviewSummary() {
    if (!elements.overviewSummary) return;
    const diagnostics = state.diagnosticsPayload;
    const imports = diagnostics && diagnostics.imports ? diagnostics.imports : { providerDiagnostics: [] };
    const refreshFailures = imports && Array.isArray(imports.providerDiagnostics)
      ? imports.providerDiagnostics.filter((row) => !!row.lastRefreshError).length
      : 0;

    elements.overviewSummary.innerHTML = [
      statCard('Outbox undelivered', diagnostics && diagnostics.outbox ? countArray(diagnostics.outbox.undelivered) : 0, diagnostics && diagnostics.outbox ? lagText(diagnostics.outbox.lag) : 'waiting'),
      statCard('Import warnings', refreshFailures, countArray(imports.providerDiagnostics) + ' providers tracked'),
      statCard('Diagnostics', refreshFailures + (diagnostics && diagnostics.outbox && countArray(diagnostics.outbox.undelivered) > 0 ? 1 : 0), 'items needing attention'),
    ].join('');
  }

  function renderOverviewRunningJobs() {
    if (!elements.overviewRunningJobs) return;
    const diagnostics = state.diagnosticsPayload;
    if (!diagnostics) {
      elements.overviewRunningJobs.innerHTML = emptyState('Diagnostics have not loaded yet.');
      return;
    }
    const outbox = diagnostics.outbox && diagnostics.outbox.lag ? diagnostics.outbox.lag : null;
    const imports = diagnostics.imports && Array.isArray(diagnostics.imports.providerDiagnostics) ? diagnostics.imports.providerDiagnostics : [];
    const refreshFailures = imports.filter((row) => !!row.lastRefreshError).length;
    elements.overviewRunningJobs.innerHTML = '<div class="kv-grid">'
      + kvPair('Outbox lag', lagText(outbox))
      + kvPair('Import refresh failures', String(refreshFailures))
      + kvPair('Provider diagnostics', String(imports.length))
      + '</div>';
  }

  function renderOverviewBridge() {
    if (!elements.overviewBridge) return;
    const workerControl = state.bridgePayload && state.bridgePayload.workerControl ? state.bridgePayload.workerControl : null;
    if (!workerControl) {
      elements.overviewBridge.innerHTML = emptyState('Worker bridge has not reported yet.');
      return;
    }
    const tone = workerControl.reachable ? 'ok' : workerControl.configured ? 'err' : 'warn';
    elements.overviewBridge.innerHTML =
      '<div class="inline-actions">' + badge(workerControl.reachable ? 'reachable' : workerControl.configured ? 'unreachable' : 'not configured', tone) + '</div>'
      + '<div class="kv-grid">'
      + kvPair('Configured', workerControl.configured ? 'yes' : 'no')
      + kvPair('Reachable', workerControl.reachable ? 'yes' : 'no')
      + kvPair('Worker clock', workerControl.serverTime ? formatDate(workerControl.serverTime) : 'n/a')
      + kvPair('Error', workerControl.error || 'none')
      + '</div>';
  }

  function renderOverviewDiagnostics() {
    if (!elements.overviewDiagnostics) return;
    const diagnostics = state.diagnosticsPayload;
    if (!diagnostics) {
      elements.overviewDiagnostics.innerHTML = emptyState('Diagnostics have not loaded yet.');
      return;
    }
    const imports = diagnostics.imports && Array.isArray(diagnostics.imports.providerDiagnostics) ? diagnostics.imports.providerDiagnostics : [];
    const outbox = diagnostics.outbox && diagnostics.outbox.lag ? diagnostics.outbox.lag : null;
    const refreshFailures = imports.filter((row) => !!row.lastRefreshError).length;
    elements.overviewDiagnostics.innerHTML =
      '<div class="kv-grid">'
      + kvPair('Refresh failures', String(refreshFailures))
      + kvPair('Outbox lag', lagText(outbox))
      + '</div>';
  }

  function renderOverviewNotifications() {
    if (!elements.overviewNotifications) return;
    const items = state.notifications.slice(0, 3);
    if (!items.length) {
      elements.overviewNotifications.innerHTML = emptyState('Notifications will appear here as diagnostics and profile actions change.');
      return;
    }
    elements.overviewNotifications.innerHTML = '<div class="notification-feed notification-feed-inline">'
      + items.map((item) => '<article class="notification-item ' + (item.read ? '' : 'unread') + '">'
        + '<div class="notification-item-head"><strong>' + escapeHtml(item.title) + '</strong>' + badge(item.kind, item.kind) + '</div>'
        + '<p>' + escapeHtml(item.text) + '</p>'
        + '<div class="item-meta meta-spaced"><span>' + escapeHtml(formatTimeAgo(item.createdAt)) + '</span></div>'
      + '</article>').join('')
      + '</div>';
  }
})();
`;
