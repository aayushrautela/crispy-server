export const ADMIN_UI_CLIENT = String.raw`
(() => {
  const VIEW_META = {
    overview: {
      title: 'Overview',
      description: 'System health, live worker activity, and quick access to the main control surfaces.',
    },
    jobs: {
      title: 'Worker Jobs',
      description: 'Trigger runs, watch progress, and manage the queue without expanding the whole page.',
    },
    diagnostics: {
      title: 'Diagnostics',
      description: 'Backlog, lag, and import health in a workspace that stays readable.',
    },
    accounts: {
      title: 'Account Inspector',
      description: 'Resolve accounts, choose profiles, and keep profile operations in a dedicated workspace.',
    },
    'worker-control': {
      title: 'Worker Control',
      description: 'Bridge health and the raw control payload from the API server to the worker.',
    },
  };

  const apiBase = String((document.body && document.body.getAttribute('data-admin-api-base')) || '/admin/api').replace(/\/$/, '');

  const state = {
    activeView: 'overview',
    jobsBusy: false,
    diagnosticsBusy: false,
    lookupBusy: false,
    bridgeBusy: false,
    notificationsOpen: false,
    lastUpdatedAt: null,
    jobsPayload: null,
    diagnosticsPayload: null,
    bridgePayload: null,
    notifications: [],
    unreadCount: 0,
    toasts: [],
    toastCounter: 0,
    selectedAccount: null,
    selectedProfile: null,
    jobsSnapshot: new Map(),
    jobsLoadedOnce: false,
    bridgeSignature: null,
    pollersStarted: false,
    intervals: {
      jobs: 8000,
      diagnostics: 30000,
      bridge: 15000,
    },
  };

  const elements = {
    body: document.body,
    views: Array.from(document.querySelectorAll('[data-view]')),
    navButtons: Array.from(document.querySelectorAll('[data-nav-target]')),
    openViewButtons: Array.from(document.querySelectorAll('[data-open-view]')),
    refreshTargetButtons: Array.from(document.querySelectorAll('[data-refresh-target]')),
    defaultJobButtons: Array.from(document.querySelectorAll('[data-run-default-job]')),
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
    bridgePill: document.getElementById('worker-control-pill'),
    sidebarRunningStatus: document.getElementById('sidebar-running-status'),
    sidebarBridgeStatus: document.getElementById('sidebar-bridge-status'),
    navJobsBadge: document.getElementById('nav-jobs-badge'),
    navDiagnosticsBadge: document.getElementById('nav-diagnostics-badge'),
    navAccountsBadge: document.getElementById('nav-accounts-badge'),
    navBridgeBadge: document.getElementById('nav-bridge-badge'),
    overviewSummary: document.getElementById('overview-summary'),
    overviewRunningJobs: document.getElementById('overview-running-jobs'),
    overviewBridge: document.getElementById('overview-bridge'),
    overviewDiagnostics: document.getElementById('overview-diagnostics'),
    overviewNotifications: document.getElementById('overview-notifications'),
    refreshJobs: document.getElementById('refresh-jobs'),
    refreshDiagnostics: document.getElementById('refresh-diagnostics'),
    jobStats: document.getElementById('job-stats'),
    diagStats: document.getElementById('diag-stats'),
    activeJobs: document.getElementById('job-list-active'),
    recentJobs: document.getElementById('job-list-recent'),
    jobMessage: document.getElementById('job-message'),
    backlogSummary: document.getElementById('backlog-summary'),
    outboxSummary: document.getElementById('outbox-summary'),
    importSummary: document.getElementById('import-summary'),
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
    bridgeText: document.getElementById('bridge-text'),
    bridgeJson: document.getElementById('bridge-json'),
  };

  const triggerForms = Array.from(document.querySelectorAll('form[data-target]'));

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
    await Promise.all([loadBridgeStatus({ silent: true }), loadJobs({ silent: true }), loadDiagnostics({ silent: true })]);
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
        updateView(value, false);
      }
    });
  }

  function bindGlobalActions() {
    for (const button of elements.refreshTargetButtons) {
      button.addEventListener('click', () => {
        const target = button.getAttribute('data-refresh-target');
        if (target === 'overview') {
          void Promise.all([loadBridgeStatus(), loadJobs(), loadDiagnostics()]);
        }
      });
    }

    for (const button of elements.defaultJobButtons) {
      button.addEventListener('click', async () => {
        const target = button.getAttribute('data-run-default-job');
        if (!target) return;
        button.disabled = true;
        try {
          await triggerJob({ target: target, options: {} }, null);
          updateView('jobs', true);
        } finally {
          button.disabled = false;
        }
      });
    }

    if (elements.refreshJobs) {
      elements.refreshJobs.addEventListener('click', () => { void loadJobs(); });
    }
    if (elements.refreshDiagnostics) {
      elements.refreshDiagnostics.addEventListener('click', () => { void loadDiagnostics(); });
    }
    if (elements.refreshProfileDetail) {
      elements.refreshProfileDetail.addEventListener('click', () => {
        if (!state.selectedAccount || !state.selectedProfile) return;
        void inspectProfile(state.selectedAccount.accountId, state.selectedProfile.id);
      });
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void loadBridgeStatus({ silent: true });
        void loadJobs({ silent: true });
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
    for (const form of triggerForms) {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const target = form.getAttribute('data-target');
        if (!target) return;
        const payload = collectTriggerPayload(form, target);
        void triggerJob(payload, form);
      });
    }

    if (elements.lookupForm) {
      elements.lookupForm.addEventListener('submit', (event) => {
        event.preventDefault();
        void lookupAccount();
      });
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
    return VIEW_META[value] ? value : '';
  }

  function apiPath(path) {
    return apiBase + path;
  }

  function startPolling() {
    if (state.pollersStarted) return;
    state.pollersStarted = true;
    window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      void loadJobs({ silent: true });
    }, state.intervals.jobs);
    window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      void loadDiagnostics({ silent: true });
    }, state.intervals.diagnostics);
    window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      void loadBridgeStatus({ silent: true });
    }, state.intervals.bridge);
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        ...(options && options.body ? { 'content-type': 'application/json' } : {}),
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
      const message = payload && typeof payload.error === 'string' ? payload.error : 'Request failed';
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

  async function loadBridgeStatus(options) {
    state.bridgeBusy = true;
    try {
      const payload = await fetchJson(apiPath('/worker/control-status'));
      state.bridgePayload = payload;
      renderBridgeStatus(payload);
      maybeNotifyBridge(payload, options && options.silent === true);
      stampUpdated();
      return payload;
    } catch (error) {
      const fallback = { workerControl: { configured: true, reachable: false, error: error.message || 'Unable to read worker status.' } };
      state.bridgePayload = fallback;
      renderBridgeStatus(fallback, error);
      if (!(options && options.silent)) {
        pushNotification('error', 'Worker control unavailable', error.message || 'Unable to read worker control status.', true);
      }
      return fallback;
    } finally {
      state.bridgeBusy = false;
      renderOverview();
    }
  }

  function renderBridgeStatus(payload, error) {
    const workerControl = payload && payload.workerControl ? payload.workerControl : {};
    const configured = workerControl.configured === true;
    const reachable = workerControl.reachable === true;
    if (!configured) {
      updateBridgeTexts('Worker status: not configured', 'Set RECOMMENDATION_ENGINE_WORKER_BASE_URL and RECOMMENDATION_ENGINE_WORKER_API_KEY to enable worker control.', 'setup');
    } else if (reachable) {
      updateBridgeTexts(
        'Worker status: reachable',
        'API server can reach the recommendation engine worker-control surface.' + (workerControl.serverTime ? ' Worker clock: ' + formatDate(workerControl.serverTime) + '.' : ''),
        'live'
      );
    } else {
      updateBridgeTexts(
        'Worker status: unreachable',
        workerControl.error || 'Worker control is configured, but the API server cannot reach the worker right now.',
        'down'
      );
    }
    if (elements.bridgeJson) {
      elements.bridgeJson.textContent = JSON.stringify(error && error.payload ? error.payload : payload, null, 2);
    }
  }

  function updateBridgeTexts(pillText, detailText, navText) {
    if (elements.bridgePill) {
      const parts = pillText.split(': ');
      elements.bridgePill.innerHTML = '<strong>' + escapeHtml(parts[1] || pillText) + '</strong><span>worker status</span>';
    }
    if (elements.bridgeText) {
      elements.bridgeText.textContent = detailText;
    }
    if (elements.sidebarBridgeStatus) {
      elements.sidebarBridgeStatus.textContent = detailText;
    }
    if (elements.navBridgeBadge) {
      elements.navBridgeBadge.textContent = navText;
    }
  }

  async function loadJobs(options) {
    setBusy('jobsBusy', true);
    try {
      const payload = await fetchJson(apiPath('/worker/jobs/status'));
      const activeJobs = Array.isArray(payload.activeJobs) ? payload.activeJobs : [];
      const queuedJobs = Array.isArray(payload.queuedJobs) ? payload.queuedJobs : [];
      const recentJobs = Array.isArray(payload.recentJobs) ? payload.recentJobs : [];
      state.jobsPayload = payload;
      renderJobStats(payload);
      renderJobs(activeJobs.concat(queuedJobs), elements.activeJobs, true);
      renderJobs(recentJobs, elements.recentJobs, false);
      updateJobChrome(payload);
      detectJobTransitions(payload, options && options.silent === true);
      if (!(options && options.silent)) {
        setMessage(elements.jobMessage, 'info', 'Worker job state refreshed.');
      }
      stampUpdated();
      return payload;
    } catch (error) {
      state.jobsPayload = null;
      renderJobStats(null);
      if (elements.activeJobs) {
        elements.activeJobs.innerHTML = emptyState('Worker job control is unavailable.');
      }
      if (elements.recentJobs) {
        elements.recentJobs.innerHTML = emptyState('No recent worker data available.');
      }
      updateJobChrome(null);
      setMessage(elements.jobMessage, 'error', error.message || 'Failed to load worker jobs.');
      if (!(options && options.silent)) {
        pushNotification('error', 'Worker jobs unavailable', error.message || 'Failed to load worker jobs.', true);
      }
      void loadBridgeStatus({ silent: true });
      return null;
    } finally {
      setBusy('jobsBusy', false);
      renderOverview();
    }
  }

  function updateJobChrome(payload) {
    const activeJobs = payload && Array.isArray(payload.activeJobs) ? payload.activeJobs : [];
    const queuedJobs = payload && Array.isArray(payload.queuedJobs) ? payload.queuedJobs : [];
    const count = activeJobs.length + queuedJobs.length;
    if (elements.topbarRunningCount) {
      elements.topbarRunningCount.textContent = String(count);
    }
    if (elements.navJobsBadge) {
      elements.navJobsBadge.textContent = String(count);
    }
    if (elements.sidebarRunningStatus) {
      elements.sidebarRunningStatus.textContent = count
        ? count + ' jobs in flight. Next up: ' + String((queuedJobs[0] && queuedJobs[0].target) || (activeJobs[0] && activeJobs[0].target) || 'unknown')
        : 'No running or queued worker jobs.';
    }
  }

  async function loadDiagnostics(options) {
    setBusy('diagnosticsBusy', true);
    try {
      const result = await Promise.all([
        fetchJson(apiPath('/diagnostics/recommendations/work-state?limit=8')),
        fetchJson(apiPath('/diagnostics/recommendations/outbox?limit=8')),
        fetchJson(apiPath('/diagnostics/imports/connections?limit=8&refreshFailuresOnly=false')),
      ]);
      const payload = {
        workState: result[0],
        outbox: result[1],
        imports: result[2],
      };
      state.diagnosticsPayload = payload;
      renderDiagnostics(payload.workState, payload.outbox, payload.imports);
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
    const backlog = payload && payload.workState && Array.isArray(payload.workState.backlog) ? payload.workState.backlog : [];
    const providerAccounts = payload && payload.imports && Array.isArray(payload.imports.providerAccounts) ? payload.imports.providerAccounts : [];
    const warningCount = providerAccounts.filter((row) => Number(row.refreshFailureCount || 0) > 0).length + sum(backlog.map((row) => Number(row.pendingCount || 0) > 0 ? 1 : 0));
    if (elements.navDiagnosticsBadge) {
      elements.navDiagnosticsBadge.textContent = String(warningCount);
    }
  }

  async function triggerJob(payload, form) {
    if (form) setFormDisabled(form, true);
    setMessage(elements.jobMessage, 'info', 'Sending worker trigger request...');
    try {
      const response = await fetchJson(apiPath('/worker/jobs/trigger'), {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const text = response.message || 'Worker job request sent.';
      setMessage(elements.jobMessage, 'success', text);
      pushNotification('success', 'Worker job requested', text, true);
      await loadJobs({ silent: true });
    } catch (error) {
      setMessage(elements.jobMessage, 'error', error.message || 'Unable to trigger worker job.');
      pushNotification('error', 'Trigger failed', error.message || 'Unable to trigger worker job.', true);
    } finally {
      if (form) setFormDisabled(form, false);
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
      if (elements.accountSummary) {
        elements.accountSummary.hidden = false;
        elements.accountSummary.innerHTML = '<h4>Account</h4>'
          + '<div class="kv-grid">'
          + kvPair('Account id', account.accountId)
          + kvPair('Email', account.email || email)
          + kvPair('Profiles', String(profiles.length))
          + '</div>';
      }

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
        safeFetchJson(apiPath('/accounts/' + encodeURIComponent(accountId) + '/profiles/' + encodeURIComponent(profileId) + '/taste-profile?sourceKey=default')),
        safeFetchJson(apiPath('/accounts/' + encodeURIComponent(accountId) + '/profiles/' + encodeURIComponent(profileId) + '/recommendations?sourceKey=default')),
        safeFetchJson(apiPath('/accounts/' + encodeURIComponent(accountId) + '/profiles/' + encodeURIComponent(profileId) + '/watch-history?limit=8')),
        safeFetchJson(apiPath('/accounts/' + encodeURIComponent(accountId) + '/profiles/' + encodeURIComponent(profileId) + '/continue-watching?limit=6')),
        safeFetchJson(apiPath('/accounts/' + encodeURIComponent(accountId) + '/profiles/' + encodeURIComponent(profileId) + '/watchlist?limit=8')),
        safeFetchJson(apiPath('/accounts/' + encodeURIComponent(accountId) + '/profiles/' + encodeURIComponent(profileId) + '/ratings?limit=8')),
        safeFetchJson(apiPath('/accounts/' + encodeURIComponent(accountId) + '/profiles/' + encodeURIComponent(profileId) + '/tracked-series?limit=8')),
      ]);

      elements.profileDetailBody.innerHTML = [
        renderImportOverview(results[0]),
        renderMediaSection('Recent watch history', results[3], 'history'),
        renderMediaSection('Continue watching', results[4], 'continue'),
        renderMediaSection('Watchlist', results[5], 'watchlist'),
        renderMediaSection('Ratings', results[6], 'ratings'),
        renderTrackedSeriesSection(results[7]),
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
          await fetchJson(apiPath('/accounts/' + encodeURIComponent(accountId) + '/profiles/' + encodeURIComponent(profileId) + '/providers/' + encodeURIComponent(provider) + '/refresh-token'), {
            method: 'POST',
          });
          setMessage(messageEl, 'success', 'Refreshed ' + provider + ' token.');
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

  function renderDiagnostics(workState, outbox, imports) {
    const activeLeases = Array.isArray(workState.activeLeases) ? workState.activeLeases : [];
    const staleLeases = Array.isArray(workState.staleLeases) ? workState.staleLeases : [];
    const backlog = Array.isArray(workState.backlog) ? workState.backlog : [];
    const providerAccounts = Array.isArray(imports.providerAccounts) ? imports.providerAccounts : [];
    const refreshFailures = providerAccounts.filter((row) => Number(row.refreshFailureCount || 0) > 0).length;
    const expiringSoon = providerAccounts.filter((row) => row.accessTokenExpiresAt).length;

    if (elements.diagStats) {
      elements.diagStats.innerHTML = [
        statCard('Active leases', activeLeases.length, staleLeases.length + ' stale'),
        statCard('Backlog buckets', backlog.length, sum(backlog.map((row) => Number(row.pendingCount || 0))) + ' pending'),
        statCard('Outbox undelivered', countArray(outbox.undelivered), lagText(outbox.lag)),
        statCard('Import refresh failures', refreshFailures, expiringSoon + ' with expiry timestamps'),
      ].join('');
    }

    if (elements.backlogSummary) {
      elements.backlogSummary.textContent = backlog.length
        ? 'Largest pending bucket: ' + String(backlog[0].sourceKey || 'default') + ' with ' + String(backlog[0].pendingCount || 0) + ' items.'
        : 'No backlog buckets right now.';
    }
    if (elements.outboxSummary) {
      elements.outboxSummary.textContent = lagText(outbox.lag);
    }
    if (elements.importSummary) {
      elements.importSummary.textContent = connections.length
        ? refreshFailures + ' connections show refresh failures across ' + connections.length + ' recent rows.'
        : 'No recent import connections returned.';
    }
    if (elements.backlogRows) {
      elements.backlogRows.innerHTML = backlog.length
        ? backlog.map((row) => '<tr><td>' + escapeHtml(String(row.sourceKey || 'default')) + '</td><td>' + escapeHtml(String(row.pendingCount || 0)) + '</td><td>' + escapeHtml(String(row.activeLeaseCount || 0)) + '</td><td>' + escapeHtml(String(row.oldestPendingAt || 'n/a')) + '</td></tr>').join('')
        : emptyTableRow('No backlog rows.', 4);
    }
    if (elements.importRows) {
      elements.importRows.innerHTML = connections.length
        ? connections.map((row) => '<tr><td>'
          + '<strong>' + escapeHtml(String(row.accountId || 'unknown-account')) + '</strong><br>'
          + '<span class="muted">' + escapeHtml(String(row.profileId || 'unknown-profile')) + ' · ' + escapeHtml(String(row.provider || 'unknown-provider')) + '</span>'
          + '</td><td>' + badge(String(row.status || 'unknown'), statusTone(String(row.status || 'unknown'))) + '</td><td>' + escapeHtml(String(row.externalUsername || row.providerUserId || 'n/a')) + '</td><td>' + escapeHtml(String(row.accessTokenExpiresAt || 'n/a')) + '</td><td>' + escapeHtml(String(row.refreshFailureCount || 0)) + '</td></tr>').join('')
        : emptyTableRow('No import connection diagnostics.', 5);
    }
  }

  function renderJobStats(payload) {
    if (!elements.jobStats) return;
    if (!payload) {
      elements.jobStats.innerHTML = [
        statCard('Active jobs', '0', 'bridge unavailable'),
        statCard('Queued jobs', '0', 'bridge unavailable'),
        statCard('Recent jobs', '0', 'bridge unavailable'),
        statCard('Worker clock', '--', 'no worker response'),
      ].join('');
      return;
    }

    const activeJobs = Array.isArray(payload.activeJobs) ? payload.activeJobs : [];
    const queuedJobs = Array.isArray(payload.queuedJobs) ? payload.queuedJobs : [];
    const recentJobs = Array.isArray(payload.recentJobs) ? payload.recentJobs : [];
    const successCount = recentJobs.filter((job) => job.status === 'success').length;

    elements.jobStats.innerHTML = [
      statCard('Active jobs', activeJobs.length, activeJobs.filter((job) => job.cancelRequestedAt).length + ' cancel requested'),
      statCard('Queued jobs', queuedJobs.length, queuedJobs.length ? 'next: ' + escapeHtml(String(queuedJobs[0].target || 'unknown')) : 'no queue'),
      statCard('Recent successes', successCount, recentJobs.length + ' recent total'),
      statCard('Worker clock', formatDate(payload.serverTime), payload.serverTime || 'n/a'),
    ].join('');
  }

  function renderJobs(jobs, target, includeQueueContext) {
    if (!target) return;
    if (!jobs || jobs.length === 0) {
      target.innerHTML = emptyState(includeQueueContext ? 'No active or queued worker jobs.' : 'No recent worker jobs.');
      return;
    }

    target.innerHTML = jobs.map((job) => renderJobCard(job, includeQueueContext)).join('');
    bindJobActions();
  }

  function renderJobCard(job, includeQueueContext) {
    const percent = job && job.progress && typeof job.progress.percent === 'number' ? Math.max(0, Math.min(100, job.progress.percent)) : 0;
    const args = Array.isArray(job.args) && job.args.length ? job.args.join(' ') : '(no args)';
    const queueText = includeQueueContext && job.queuePosition ? 'Queue position ' + job.queuePosition : null;
    const meta = [
      'id ' + job.id,
      'script ' + job.script,
      job.pid ? 'pid ' + job.pid : null,
      queueText,
      job.startedAt ? 'started ' + formatDate(job.startedAt) : 'created ' + formatDate(job.createdAt),
    ].filter(Boolean).map((item) => '<span>' + escapeHtml(item) + '</span>').join('');

    const actions = [];
    if (job.status === 'running' || job.status === 'queued') {
      actions.push('<button class="warn" type="button" data-cancel-job="' + escapeHtml(job.id) + '">Cancel</button>');
    }
    if (job.status === 'success' || job.status === 'error' || job.status === 'canceled') {
      actions.push('<button class="ghost" type="button" data-delete-job="' + escapeHtml(job.id) + '">Delete</button>');
    }

    return '<article class="job-card">'
      + '<div class="job-head">'
      + '  <div class="job-title">'
      + '    <div class="badge ' + escapeHtml(job.status) + '">' + escapeHtml(job.status) + '</div>'
      + '    <h3>' + escapeHtml(job.target) + '</h3>'
      + '    <div class="job-meta">' + meta + '</div>'
      + '  </div>'
      + '  <div class="job-actions">' + actions.join('') + '</div>'
      + '</div>'
      + '<div><strong>' + escapeHtml(job.progress && job.progress.phase || 'No phase') + '</strong><div class="muted">' + escapeHtml(job.progress && job.progress.message || 'No message') + '</div></div>'
      + '<div class="progress"><span class="progress-bar" style="width:' + percent + '%"></span></div>'
      + '<div class="job-meta">'
      + '  <span>processed ' + escapeHtml(String(job.progress && job.progress.processed || 0)) + '</span>'
      + '  <span>skipped ' + escapeHtml(String(job.progress && job.progress.skipped || 0)) + '</span>'
      + '  <span>errors ' + escapeHtml(String(job.progress && job.progress.errors || 0)) + '</span>'
      + '</div>'
      + '<div class="code">' + escapeHtml(args + '\n\nstdout:\n' + ((job.stdoutTail || []).join('\n') || '(empty)') + '\n\nstderr:\n' + ((job.stderrTail || []).join('\n') || '(empty)')) + '</div>'
      + '</article>';
  }

  function bindJobActions() {
    const cancelButtons = Array.from(document.querySelectorAll('[data-cancel-job]'));
    for (const button of cancelButtons) {
      button.onclick = async () => {
        const jobId = button.getAttribute('data-cancel-job');
        if (!jobId) return;
        button.disabled = true;
        try {
          const payload = await fetchJson(apiPath('/worker/jobs/' + encodeURIComponent(jobId) + '/cancel'), { method: 'POST' });
          setMessage(elements.jobMessage, 'success', payload.message || 'Cancellation requested.');
          pushNotification('warn', 'Job cancellation requested', payload.message || ('Requested cancellation for ' + jobId + '.'), true);
          await loadJobs({ silent: true });
        } catch (error) {
          setMessage(elements.jobMessage, 'error', error.message || 'Unable to cancel job.');
          pushNotification('error', 'Cancel failed', error.message || 'Unable to cancel job.', true);
        } finally {
          button.disabled = false;
        }
      };
    }

    const deleteButtons = Array.from(document.querySelectorAll('[data-delete-job]'));
    for (const button of deleteButtons) {
      button.onclick = async () => {
        const jobId = button.getAttribute('data-delete-job');
        if (!jobId) return;
        button.disabled = true;
        try {
          const payload = await fetchJson(apiPath('/worker/jobs/' + encodeURIComponent(jobId)), { method: 'DELETE' });
          setMessage(elements.jobMessage, 'success', payload.message || 'Job deleted.');
          pushNotification('info', 'Job deleted', payload.message || ('Deleted ' + jobId + '.'), true);
          await loadJobs({ silent: true });
        } catch (error) {
          setMessage(elements.jobMessage, 'error', error.message || 'Unable to delete job.');
          pushNotification('error', 'Delete failed', error.message || 'Unable to delete job.', true);
        } finally {
          button.disabled = false;
        }
      };
    }
  }

  function collectTriggerPayload(form, target) {
    const formData = new FormData(form);
    const options = {};
    for (const [key, value] of formData.entries()) {
      if (typeof value !== 'string') continue;
      const text = value.trim();
      if (!text) continue;
      if (key === 'dueWithinHours') {
        options[key] = Number(text);
      } else {
        options[key] = text;
      }
    }
    const checkboxes = form.querySelectorAll('input[type="checkbox"]');
    for (const checkbox of checkboxes) {
      if (checkbox.checked) {
        options[checkbox.name] = true;
      }
    }
    return { target: target, options: options };
  }

  function setFormDisabled(form, disabled) {
    const fields = Array.from(form.querySelectorAll('input, select, textarea, button'));
    for (const field of fields) {
      field.disabled = disabled;
    }
  }

  function setBusy(key, value) {
    state[key] = value;
    if (key === 'jobsBusy' && elements.refreshJobs) {
      elements.refreshJobs.disabled = value;
    }
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
      + '</div>'
      + '<div class="inline-actions">'
        + '<button type="button" class="ghost" data-refresh-provider-token="' + escapeHtml(String(provider.provider || '')) + '"' + (connected ? '' : ' disabled') + '>Refresh token</button>'
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

  function renderTrackedSeriesSection(result) {
    if (result && result.error) {
      return sectionCard('Tracked series', '<div class="message error">' + escapeHtml(result.error) + '</div>');
    }
    const items = result && Array.isArray(result.items) ? result.items : [];
    if (items.length === 0) {
      return sectionCard('Tracked series', emptyState('No tracked series for this profile.'));
    }
    return sectionCard('Tracked series', '<div class="item-list">' + items.map((item) => {
      const media = item && item.show ? item.show : null;
      return '<div class="item-row">'
        + '<strong>' + escapeHtml(mediaTitle(media)) + '</strong>'
        + '<div class="muted">' + escapeHtml(item.reason || 'no reason captured') + '</div>'
        + '<div class="item-meta">'
          + '<span>next ' + escapeHtml(item.nextEpisodeAirDate ? formatDate(item.nextEpisodeAirDate) : 'n/a') + '</span>'
          + '<span>last interacted ' + escapeHtml(item.lastInteractedAt ? formatDate(item.lastInteractedAt) : 'n/a') + '</span>'
        + '</div>'
      + '</div>';
    }).join('') + '</div>');
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
        + kvPair('Algorithm', recommendations.algorithmVersion || 'default')
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
    return media.title || media.subtitle || media.mediaKey || media.id || 'Unknown title';
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

  function detectJobTransitions(payload, silent) {
    const current = new Map();
    const jobs = []
      .concat(Array.isArray(payload.activeJobs) ? payload.activeJobs : [])
      .concat(Array.isArray(payload.queuedJobs) ? payload.queuedJobs : [])
      .concat(Array.isArray(payload.recentJobs) ? payload.recentJobs : []);

    for (const job of jobs) {
      current.set(job.id, job.status);
      if (!state.jobsLoadedOnce) continue;
      const previous = state.jobsSnapshot.get(job.id);
      if (!previous) {
        if (!silent) {
          pushNotification('info', 'New worker job', job.target + ' entered as ' + job.status + '.', job.status === 'running' || job.status === 'queued');
        }
        continue;
      }
      if (previous !== job.status) {
        const tone = job.status === 'success' ? 'success' : job.status === 'error' ? 'error' : job.status === 'canceled' ? 'warn' : 'info';
        pushNotification(tone, 'Job ' + job.status, job.target + ' changed from ' + previous + ' to ' + job.status + '.', job.status === 'success' || job.status === 'error' || job.status === 'canceled');
      }
    }

    state.jobsSnapshot = current;
    state.jobsLoadedOnce = true;
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
      pushNotification('warn', 'Worker control not configured', 'Set the worker bridge environment variables to enable control features.', true);
    } else if (workerControl.reachable === true) {
      pushNotification('success', 'Worker control reachable', 'The API server can talk to the worker again.', true);
    } else {
      pushNotification('error', 'Worker control unreachable', workerControl.error || 'The bridge is configured but the worker cannot be reached.', true);
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
        elements.notificationFeed.innerHTML = emptyState('No notifications yet. Live worker and control-plane events will land here.');
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
    const jobsPayload = state.jobsPayload;
    const diagnostics = state.diagnosticsPayload;
    const activeJobs = jobsPayload && Array.isArray(jobsPayload.activeJobs) ? jobsPayload.activeJobs : [];
    const queuedJobs = jobsPayload && Array.isArray(jobsPayload.queuedJobs) ? jobsPayload.queuedJobs : [];
    const workState = diagnostics && diagnostics.workState ? diagnostics.workState : { backlog: [], activeLeases: [] };
    const imports = diagnostics && diagnostics.imports ? diagnostics.imports : { providerAccounts: [] };
    const bridge = state.bridgePayload && state.bridgePayload.workerControl ? state.bridgePayload.workerControl : null;
    const refreshFailures = imports && Array.isArray(imports.providerAccounts)
      ? imports.providerAccounts.filter((row) => Number(row.refreshFailureCount || 0) > 0).length
      : 0;

    elements.overviewSummary.innerHTML = [
      statCard('Running now', activeJobs.length, queuedJobs.length + ' queued behind them'),
      statCard('Backlog buckets', countArray(workState.backlog), sum((workState.backlog || []).map((row) => Number(row.pendingCount || 0))) + ' pending'),
      statCard('Import warnings', refreshFailures, countArray(imports.providerAccounts) + ' accounts scanned'),
      statCard('Worker bridge', bridge ? (bridge.reachable ? 'live' : bridge.configured ? 'down' : 'setup') : 'check', state.lastUpdatedAt ? 'updated ' + formatTimeAgo(state.lastUpdatedAt) : 'waiting'),
    ].join('');
  }

  function renderOverviewRunningJobs() {
    if (!elements.overviewRunningJobs) return;
    const jobsPayload = state.jobsPayload;
    const jobs = []
      .concat(jobsPayload && Array.isArray(jobsPayload.activeJobs) ? jobsPayload.activeJobs : [])
      .concat(jobsPayload && Array.isArray(jobsPayload.queuedJobs) ? jobsPayload.queuedJobs : [])
      .slice(0, 3);
    if (!jobs.length) {
      elements.overviewRunningJobs.innerHTML = emptyState('No running or queued jobs right now.');
      return;
    }
    elements.overviewRunningJobs.innerHTML = jobs.map((job) => renderJobCard(job, true)).join('');
    bindJobActions();
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
    const backlog = diagnostics.workState && Array.isArray(diagnostics.workState.backlog) ? diagnostics.workState.backlog : [];
    const imports = diagnostics.imports && Array.isArray(diagnostics.imports.providerAccounts) ? diagnostics.imports.providerAccounts : [];
    const outbox = diagnostics.outbox && diagnostics.outbox.lag ? diagnostics.outbox.lag : null;
    const refreshFailures = imports.filter((row) => Number(row.refreshFailureCount || 0) > 0).length;
    elements.overviewDiagnostics.innerHTML =
      '<div class="kv-grid">'
      + kvPair('Backlog buckets', String(backlog.length))
      + kvPair('Pending items', String(sum(backlog.map((row) => Number(row.pendingCount || 0)))))
      + kvPair('Refresh failures', String(refreshFailures))
      + kvPair('Outbox lag', lagText(outbox))
      + '</div>';
  }

  function renderOverviewNotifications() {
    if (!elements.overviewNotifications) return;
    const items = state.notifications.slice(0, 3);
    if (!items.length) {
      elements.overviewNotifications.innerHTML = emptyState('Notifications will appear here as jobs and bridge states change.');
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
