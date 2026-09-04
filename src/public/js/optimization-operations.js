(() => {
  const root = document.querySelector('[data-operations-root]');
  if (!root) return;

  const projectId = root.dataset.projectId;
  if (!projectId) return;

  const apiBase = `/api/v1/projects/${projectId}/optimization`;
  const csrfToken = root.dataset.csrfToken ?? '';
  const refreshStatus = root.querySelector('[data-refresh-status]');
  const runStatus = root.querySelector('[data-run-status]');
  const policyForm = root.querySelector('[data-policy-form]');
  const policyStatus = root.querySelector('[data-policy-status]');
  const refreshButton = root.querySelector('[data-refresh-operations]');
  const runButton = root.querySelector('[data-run-optimization]');
  const automationDefinitions = root.querySelector('[data-automation-definitions]');
  const automationRuns = root.querySelector('[data-automation-runs]');
  const automationReconcile = root.querySelector('[data-automation-reconcile]');
  const automationStatus = root.querySelector('[data-automation-status]');

  function setStatus(element, message) {
    if (element) element.textContent = message;
  }

  function setAutomationStatus(message) {
    setStatus(automationStatus, message);
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

  function mutationHeaders() {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
    };
  }

  function responseError(body, response, prefix) {
    return body?.error?.code ?? `${prefix}_${response.status}`;
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
    if (!csrfToken) {
      setStatus(runStatus, '认证会话不可用，手动 Run 未提交。');
      return;
    }
    runButton.disabled = true;
    setStatus(runStatus, '正在提交手动 Optimization Run…');
    try {
      const manualRequestId = crypto.randomUUID();
      const response = await fetch(`${apiBase}/runs`, {
        method: 'POST',
        headers: mutationHeaders(),
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

  function createTextElement(tag, text, className) {
    const element = document.createElement(tag);
    element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function automationDefinitionPatch(form) {
    const enabled = form.elements.namedItem('enabled');
    const scheduleCron = form.elements.namedItem('scheduleCron');
    const maxAttempts = form.elements.namedItem('maxAttempts');
    const timeoutMs = form.elements.namedItem('timeoutMs');
    if (
      !(enabled instanceof HTMLInputElement)
      || !(scheduleCron instanceof HTMLInputElement)
      || !(maxAttempts instanceof HTMLInputElement)
      || !(timeoutMs instanceof HTMLInputElement)
    ) return null;

    return {
      enabled: enabled.checked,
      scheduleCron: scheduleCron.value.trim() || null,
      maxAttempts: Number(maxAttempts.value),
      timeoutMs: Number(timeoutMs.value),
    };
  }

  async function patchAutomationDefinition(definitionId, form, saveButton) {
    if (!csrfToken) {
      setAutomationStatus('认证会话不可用，Automation 设置当前只读。');
      return;
    }
    const patch = automationDefinitionPatch(form);
    if (!patch || !form.reportValidity()) return;
    saveButton.disabled = true;
    setAutomationStatus('正在保存 Automation Definition…');
    try {
      const response = await fetch(`${apiBase}/automation-definitions/${definitionId}`, {
        method: 'PATCH',
        headers: mutationHeaders(),
        body: JSON.stringify(patch),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseError(body, response, 'AUTOMATION_DEFINITION'));
      setAutomationStatus('Automation Definition 已保存。');
      await loadAutomationControlPanel();
    } catch (error) {
      setAutomationStatus(`Automation Definition 保存失败：${error instanceof Error ? error.message : 'UNKNOWN'}`);
    } finally {
      saveButton.disabled = false;
    }
  }

  async function startAutomationRun(definitionId, button) {
    if (!csrfToken) {
      setAutomationStatus('认证会话不可用，Run now 未提交。');
      return;
    }
    button.disabled = true;
    setAutomationStatus('正在启动 Automation Run…');
    try {
      const response = await fetch(`${apiBase}/automation-runs`, {
        method: 'POST',
        headers: mutationHeaders(),
        body: JSON.stringify({
          definitionId,
          requestKey: crypto.randomUUID(),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseError(body, response, 'AUTOMATION_RUN'));
      setAutomationStatus(`Automation Run 已接受：${body.data?.id ?? 'accepted'}`);
      await loadAutomationControlPanel();
    } catch (error) {
      setAutomationStatus(`Run now 失败：${error instanceof Error ? error.message : 'UNKNOWN'}`);
    } finally {
      button.disabled = false;
    }
  }

  async function retryAutomationRun(runId, button) {
    if (!csrfToken) {
      setAutomationStatus('认证会话不可用，Retry 未提交。');
      return;
    }
    button.disabled = true;
    setAutomationStatus('正在重试 Automation Run…');
    try {
      const response = await fetch(`${apiBase}/automation-runs/${runId}/retry`, {
        method: 'POST',
        headers: mutationHeaders(),
        body: JSON.stringify({}),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseError(body, response, 'AUTOMATION_RETRY'));
      setAutomationStatus(`Retry 已接受：${runId}`);
      await loadAutomationControlPanel();
    } catch (error) {
      setAutomationStatus(`Retry 失败：${error instanceof Error ? error.message : 'UNKNOWN'}`);
    } finally {
      button.disabled = false;
    }
  }

  async function reconcileAutomationSchedules() {
    if (!automationReconcile) return;
    if (!csrfToken) {
      setAutomationStatus('认证会话不可用，Reconcile 当前不可执行。');
      return;
    }
    automationReconcile.disabled = true;
    setAutomationStatus('正在 Reconcile Automation schedules…');
    try {
      const response = await fetch(`${apiBase}/automation-definitions/reconcile`, {
        method: 'POST',
        headers: mutationHeaders(),
        body: JSON.stringify({}),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseError(body, response, 'AUTOMATION_RECONCILE'));
      setAutomationStatus('Automation schedules 已完成 Reconcile。');
      await loadAutomationControlPanel();
    } catch (error) {
      setAutomationStatus(`Reconcile 失败：${error instanceof Error ? error.message : 'UNKNOWN'}`);
    } finally {
      automationReconcile.disabled = false;
    }
  }

  function renderAutomationDefinitions(definitions) {
    if (!automationDefinitions) return;
    automationDefinitions.replaceChildren();
    if (!Array.isArray(definitions) || definitions.length === 0) {
      automationDefinitions.append(createTextElement('div', '暂无 Automation Definitions。', 'empty'));
      return;
    }

    const list = document.createElement('div');
    list.className = 'operations-inbox-list';
    for (const definition of definitions) {
      if (!definition || typeof definition !== 'object' || typeof definition.id !== 'string') continue;
      const article = document.createElement('article');
      article.className = 'operations-inbox-item';
      const heading = document.createElement('div');
      heading.className = 'operations-inline';
      heading.append(
        createTextElement('strong', String(definition.key ?? definition.id)),
        createTextElement('code', String(definition.actionType ?? 'UNKNOWN_ACTION')),
      );
      article.append(heading);

      const form = document.createElement('form');
      form.className = 'operations-policy-form';

      const enabledLabel = document.createElement('label');
      enabledLabel.className = 'field checkbox-field';
      enabledLabel.append(createTextElement('span', 'Enabled'));
      const enabled = document.createElement('input');
      enabled.type = 'checkbox';
      enabled.name = 'enabled';
      enabled.checked = Boolean(definition.enabled);
      enabledLabel.append(enabled);

      const cronLabel = document.createElement('label');
      cronLabel.className = 'field';
      cronLabel.append(createTextElement('span', 'Cron'));
      const cron = document.createElement('input');
      cron.type = 'text';
      cron.name = 'scheduleCron';
      cron.maxLength = 256;
      cron.value = typeof definition.scheduleCron === 'string' ? definition.scheduleCron : '';
      cron.placeholder = '无定时计划';
      cronLabel.append(cron);

      const attemptsLabel = document.createElement('label');
      attemptsLabel.className = 'field';
      attemptsLabel.append(createTextElement('span', 'Max attempts'));
      const attempts = document.createElement('input');
      attempts.type = 'number';
      attempts.name = 'maxAttempts';
      attempts.min = '1';
      attempts.max = '10';
      attempts.required = true;
      attempts.value = String(definition.maxAttempts ?? 1);
      attemptsLabel.append(attempts);

      const timeoutLabel = document.createElement('label');
      timeoutLabel.className = 'field';
      timeoutLabel.append(createTextElement('span', 'Timeout ms'));
      const timeout = document.createElement('input');
      timeout.type = 'number';
      timeout.name = 'timeoutMs';
      timeout.min = '1000';
      timeout.max = '3600000';
      timeout.required = true;
      timeout.value = String(definition.timeoutMs ?? 1000);
      timeoutLabel.append(timeout);

      const fields = document.createElement('div');
      fields.className = 'form-grid';
      fields.append(enabledLabel, cronLabel, attemptsLabel, timeoutLabel);
      form.append(fields);

      const actions = document.createElement('div');
      actions.className = 'operations-policy-actions';
      const save = createTextElement('button', '保存设置', 'btn');
      save.type = 'submit';
      const runNow = createTextElement('button', 'Run now', 'btn btn-primary');
      runNow.type = 'button';
      if (!csrfToken) {
        save.disabled = true;
        runNow.disabled = true;
      }
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        void patchAutomationDefinition(definition.id, form, save);
      });
      runNow.addEventListener('click', () => void startAutomationRun(definition.id, runNow));
      actions.append(save, runNow);
      form.append(actions);
      article.append(form);
      list.append(article);
    }
    automationDefinitions.append(list);
  }

  function renderAutomationRuns(runs) {
    if (!automationRuns) return;
    automationRuns.replaceChildren();
    if (!Array.isArray(runs) || runs.length === 0) {
      automationRuns.append(createTextElement('div', '暂无 Automation Runs。', 'empty'));
      return;
    }

    const list = document.createElement('div');
    list.className = 'operations-inbox-list';
    for (const run of runs) {
      if (!run || typeof run !== 'object' || typeof run.id !== 'string') continue;
      const article = document.createElement('article');
      article.className = 'operations-inbox-item';
      const heading = document.createElement('div');
      heading.className = 'operations-inline';
      heading.append(
        createTextElement('span', String(run.status ?? 'UNKNOWN'), 'badge'),
        createTextElement('strong', run.id),
      );
      article.append(heading);
      article.append(createTextElement('p', `Attempt: ${run.attempt ?? 'UNKNOWN'}`));
      article.append(createTextElement('p', `Deadline: ${run.deadlineAt ?? 'NONE'}`, 'muted'));
      article.append(createTextElement('p', `Last error: ${run.lastErrorCode ?? 'NONE'}`, 'muted'));

      const actions = document.createElement('div');
      actions.className = 'operations-inline';
      const detail = createTextElement('a', '查看 Run 详情', 'text-link');
      detail.href = `${apiBase}/automation-runs/${run.id}`;
      actions.append(detail);
      if (run.status === 'FAILED') {
        const retry = createTextElement('button', 'Retry', 'btn');
        retry.type = 'button';
        retry.disabled = !csrfToken;
        retry.addEventListener('click', () => void retryAutomationRun(run.id, retry));
        actions.append(retry);
      }
      article.append(actions);
      list.append(article);
    }
    automationRuns.append(list);
  }

  async function loadAutomationControlPanel() {
    if (!automationDefinitions && !automationRuns) return;
    try {
      const [definitionResponse, runResponse] = await Promise.all([
        fetch(`${apiBase}/automation-definitions`, {
          headers: { Accept: 'application/json' },
        }),
        fetch(`${apiBase}/automation-runs?limit=20`, {
          headers: { Accept: 'application/json' },
        }),
      ]);
      const [definitionBody, runBody] = await Promise.all([
        definitionResponse.json().catch(() => ({})),
        runResponse.json().catch(() => ({})),
      ]);
      if (!definitionResponse.ok) {
        throw new Error(responseError(definitionBody, definitionResponse, 'AUTOMATION_DEFINITIONS'));
      }
      if (!runResponse.ok) {
        throw new Error(responseError(runBody, runResponse, 'AUTOMATION_RUNS'));
      }
      renderAutomationDefinitions(definitionBody.data);
      renderAutomationRuns(runBody.data);
      setAutomationStatus(csrfToken
        ? 'Automation authority 已从持久化后端读取；命令仍由后端 RBAC 校验。'
        : 'Automation authority 已读取；认证会话不可用，当前控制面只读。');
    } catch (error) {
      setAutomationStatus(`Automation Control Panel 读取失败：${error instanceof Error ? error.message : 'UNKNOWN'}`);
      if (automationDefinitions) {
        automationDefinitions.replaceChildren(createTextElement('div', 'Definitions 不可用。', 'empty'));
      }
      if (automationRuns) {
        automationRuns.replaceChildren(createTextElement('div', 'Recent Runs 不可用。', 'empty'));
      }
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
  automationReconcile?.addEventListener('click', () => void reconcileAutomationSchedules());

  if (!csrfToken) {
    if (automationReconcile) automationReconcile.disabled = true;
    setAutomationStatus('认证会话不可用，Automation Control Panel 当前只读。');
  }

  void loadAutomationControlPanel();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshOverview();
  });

  setInterval(() => {
    if (document.visibilityState === 'visible') void refreshOverview();
  }, 30_000);
})();
