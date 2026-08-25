(() => {
  const root = document.querySelector('[data-operations-root]');
  if (!root) return;

  const projectId = root.dataset.projectId;
  if (!projectId) return;

  const apiBase = `/api/v1/projects/${projectId}/optimization`;
  const refreshStatus = root.querySelector('[data-refresh-status]');
  const runStatus = root.querySelector('[data-run-status]');
  const policyForm = root.querySelector('[data-policy-form]');
  const policyStatus = root.querySelector('[data-policy-status]');
  const refreshButton = root.querySelector('[data-refresh-operations]');
  const runButton = root.querySelector('[data-run-optimization]');

  function setStatus(element, message) {
    if (element) element.textContent = message;
  }

  function setMetric(selector, value) {
    const element = root.querySelector(selector);
    if (element && value !== undefined && value !== null) {
      element.textContent = String(value);
    }
  }

  function sumCounts(counts) {
    if (!counts || typeof counts !== 'object') return 0;
    return Object.values(counts).reduce(
      (sum, value) => sum + (typeof value === 'number' ? value : 0),
      0,
    );
  }

  function applyOverview(data) {
    if (!data || typeof data !== 'object') return;
    setMetric('[data-metric-effective-state]', data.effectiveAutopilotState);
    setMetric('[data-metric-today-runs]', data.todayRunCount);
    setMetric('[data-metric-inbox-count]', sumCounts(data.inboxCounts));
    setMetric('[data-metric-draft-pr]', data.pipelineCounts?.DRAFT_PR);
    setMetric('[data-metric-observing]', data.pipelineCounts?.OBSERVING);
    setMetric('[data-metric-feedback-sample]', data.feedbackSummary?.sampleCount);
    if (data.generatedAt) {
      setStatus(refreshStatus, `快照刷新时间：${new Date(data.generatedAt).toISOString()}`);
    }
  }

  async function refreshOverview() {
    if (document.visibilityState !== 'visible') return;
    try {
      const response = await fetch(`${apiBase}/operations`, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`OVERVIEW_${response.status}`);
      const body = await response.json();
      applyOverview(body.data);
      // Overview polling never hydrates the policy form, so a data-dirty form is preserved.
      if (policyForm?.dataset.dirty === 'true') {
        setStatus(policyStatus, '存在未保存的本地策略修改；状态刷新未覆盖这些字段。');
      }
    } catch {
      setStatus(refreshStatus, '状态刷新失败；保留当前已渲染的持久化快照。');
    }
  }

  async function triggerManualRun() {
    if (!runButton) return;
    runButton.disabled = true;
    setStatus(runStatus, '正在提交手动 Optimization Run…');
    try {
      const manualRequestId = crypto.randomUUID();
      const response = await fetch(`${apiBase}/runs`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ manualRequestId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error?.code ?? `RUN_${response.status}`);
      const run = body.data ?? {};
      const runId = run.id ?? run.runId ?? 'accepted';
      const status = run.status ?? 'ACCEPTED';
      setStatus(runStatus, `Run 已接受：${runId} · ${status}`);
      // Do not advance pipeline UI optimistically. A later persisted overview refresh owns that state.
    } catch (error) {
      setStatus(runStatus, `手动 Run 提交失败：${error instanceof Error ? error.message : 'UNKNOWN'}`);
    } finally {
      runButton.disabled = false;
    }
  }

  function setCheckbox(name, value) {
    const input = policyForm?.elements.namedItem(name);
    if (input instanceof HTMLInputElement) input.checked = Boolean(value);
  }

  function setNumber(name, value) {
    const input = policyForm?.elements.namedItem(name);
    if (input instanceof HTMLInputElement && typeof value === 'number') {
      input.value = String(value);
    }
  }

  function hydratePolicy(policy) {
    if (!policyForm || !policy || typeof policy !== 'object') return;
    setCheckbox('enabled', policy.enabled);
    setNumber('dailyDraftPrLimit', policy.dailyDraftPrLimit);
    setNumber('maxConcurrentRuns', policy.maxConcurrentRuns);
    setCheckbox('requireFreshEvidence', policy.requireFreshEvidence);
    setNumber('minimumEvidenceCoverage', policy.minimumEvidenceCoverage);
    setCheckbox('pauseOnVerificationFailure', policy.pauseOnVerificationFailure);
    setCheckbox('killSwitch', policy.killSwitch);
    if (policy.updatedAt) root.dataset.policyUpdatedAt = new Date(policy.updatedAt).toISOString();
    policyForm.dataset.dirty = 'false';
  }

  async function loadPolicy({ replaceDirty = false } = {}) {
    if (!policyForm) return;
    if (policyForm.dataset.dirty === 'true' && !replaceDirty) return;
    const response = await fetch(`${apiBase}/autopilot-policy`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`POLICY_${response.status}`);
    const body = await response.json();
    if (body.data) hydratePolicy(body.data);
  }

  function policyPayload() {
    if (!policyForm) return null;
    const enabled = policyForm.elements.namedItem('enabled');
    const dailyDraftPrLimit = policyForm.elements.namedItem('dailyDraftPrLimit');
    const maxConcurrentRuns = policyForm.elements.namedItem('maxConcurrentRuns');
    const requireFreshEvidence = policyForm.elements.namedItem('requireFreshEvidence');
    const minimumEvidenceCoverage = policyForm.elements.namedItem('minimumEvidenceCoverage');
    const pauseOnVerificationFailure = policyForm.elements.namedItem('pauseOnVerificationFailure');
    const killSwitch = policyForm.elements.namedItem('killSwitch');
    if (
      !(enabled instanceof HTMLInputElement)
      || !(dailyDraftPrLimit instanceof HTMLInputElement)
      || !(maxConcurrentRuns instanceof HTMLInputElement)
      || !(requireFreshEvidence instanceof HTMLInputElement)
      || !(minimumEvidenceCoverage instanceof HTMLInputElement)
      || !(pauseOnVerificationFailure instanceof HTMLInputElement)
      || !(killSwitch instanceof HTMLInputElement)
    ) return null;

    return {
      enabled: enabled.checked,
      dailyDraftPrLimit: Number(dailyDraftPrLimit.value),
      maxConcurrentRuns: Number(maxConcurrentRuns.value),
      requireFreshEvidence: requireFreshEvidence.checked,
      minimumEvidenceCoverage: Number(minimumEvidenceCoverage.value),
      pauseOnVerificationFailure: pauseOnVerificationFailure.checked,
      killSwitch: killSwitch.checked,
    };
  }

  async function savePolicy(event) {
    event.preventDefault();
    if (!policyForm) return;
    const policy = policyPayload();
    if (!policy || !policyForm.reportValidity()) return;
    if (!window.confirm('确认创建新的不可变 Autopilot Policy Revision？')) return;

    const saveButton = policyForm.querySelector('[data-policy-save]');
    if (saveButton) saveButton.disabled = true;
    setStatus(policyStatus, '正在保存 Policy Revision…');

    try {
      const response = await fetch(`${apiBase}/autopilot-policy/revisions`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          expectedUpdatedAt: root.dataset.policyUpdatedAt || null,
          policy,
        }),
      });

      if (response.status === 409) {
        await loadPolicy({ replaceDirty: true });
        setStatus(policyStatus, '策略已被其他 Revision 更新；已载入最新持久化策略，请重新审核后再保存。');
        return;
      }

      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus(policyStatus, body?.error?.code === 'OPERATIONS_ACTOR_UNAVAILABLE'
          ? '认证操作员身份不可用，策略未修改。'
          : `策略保存失败：${body?.error?.code ?? response.status}`);
        return;
      }

      if (body.data?.appliedPolicyUpdatedAt) {
        root.dataset.policyUpdatedAt = body.data.appliedPolicyUpdatedAt;
      }
      policyForm.dataset.dirty = 'false';
      await loadPolicy({ replaceDirty: true });
      setStatus(policyStatus, body.data?.status === 'IDEMPOTENT_REPLAY'
        ? '该 Revision 请求已存在，当前策略未重复修改。'
        : 'Policy Revision 已保存。');
    } catch {
      setStatus(policyStatus, '策略保存失败；当前表单未获得成功确认。');
    } finally {
      if (saveButton) saveButton.disabled = false;
    }
  }

  if (policyForm) {
    const markDirty = () => {
      policyForm.dataset.dirty = 'true';
    };
    policyForm.addEventListener('input', markDirty);
    policyForm.addEventListener('change', markDirty);
    policyForm.addEventListener('submit', savePolicy);
  }

  refreshButton?.addEventListener('click', refreshOverview);
  runButton?.addEventListener('click', triggerManualRun);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshOverview();
  });

  setInterval(() => {
    if (document.visibilityState === 'visible') void refreshOverview();
  }, 30_000);
})();
