(() => {
  const root = document.querySelector('[data-search-console-root]');
  if (!root) return;
  const projectId = root.dataset.projectId;
  if (!projectId) return;

  const apiBase = `/api/projects/${encodeURIComponent(projectId)}/search-console`;
  const status = root.querySelector('[data-search-console-status]');
  const picker = root.querySelector('[data-search-console-property-picker]');
  const select = root.querySelector('[data-search-console-property]');
  const setStatus = (message) => { if (status) status.textContent = message; };
  const responseBody = (response) => response.json().catch(() => ({}));

  async function startOAuth(button) {
    if (button) button.disabled = true;
    setStatus('正在跳转至 Google 授权页面…');
    try {
      const response = await fetch(`${apiBase}/oauth/start`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: '{}' });
      const body = await responseBody(response);
      if (!response.ok || typeof body?.data?.authorizationUrl !== 'string') throw new Error(body?.error?.code ?? `OAUTH_${response.status}`);
      window.location.assign(body.data.authorizationUrl);
    } catch (error) {
      setStatus(`无法开始 Google 授权：${error instanceof Error ? error.message : 'UNKNOWN'}`);
      if (button) button.disabled = false;
    }
  }

  async function loadProperties(button) {
    if (!(select instanceof HTMLSelectElement)) return;
    if (button) button.disabled = true;
    setStatus('正在读取该 Google Account 可访问的 Property…');
    try {
      const response = await fetch(`${apiBase}/properties`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
      const body = await responseBody(response);
      if (!response.ok || !Array.isArray(body?.data)) throw new Error(body?.error?.code ?? `PROPERTIES_${response.status}`);
      select.replaceChildren();
      for (const property of body.data) {
        if (!property || typeof property.siteUrl !== 'string') continue;
        const option = document.createElement('option');
        option.value = property.siteUrl;
        option.textContent = `${property.siteUrl} (${property.permissionLevel ?? 'readable'})`;
        select.append(option);
      }
      if (!select.options.length) { setStatus('该 Google Account 没有可读的 Search Console Property。'); return; }
      if (picker) picker.hidden = false;
      setStatus('请选择与当前项目匹配的 Property，然后确认。');
    } catch (error) {
      setStatus(`无法读取 Property：${error instanceof Error ? error.message : 'UNKNOWN'}`);
    } finally { if (button) button.disabled = false; }
  }

  async function bindProperty(button) {
    if (!(select instanceof HTMLSelectElement) || !select.value) return;
    if (button) button.disabled = true;
    setStatus('正在保存 Property 选择…');
    try {
      const response = await fetch(`${apiBase}/property`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ propertyUri: select.value }) });
      const body = await responseBody(response);
      if (!response.ok) throw new Error(body?.error?.code ?? `PROPERTY_${response.status}`);
      window.location.reload();
    } catch (error) {
      setStatus(`无法保存 Property：${error instanceof Error ? error.message : 'UNKNOWN'}`);
      if (button) button.disabled = false;
    }
  }

  async function disconnect(button) {
    if (!window.confirm('确定断开此项目的 Google Search Console 连接吗？同步将停止。')) return;
    if (button) button.disabled = true;
    setStatus('正在断开连接…');
    try {
      const response = await fetch(`${apiBase}/connection`, { method: 'DELETE', headers: { Accept: 'application/json' } });
      if (!response.ok) { const body = await responseBody(response); throw new Error(body?.error?.code ?? `DISCONNECT_${response.status}`); }
      window.location.reload();
    } catch (error) {
      setStatus(`无法断开连接：${error instanceof Error ? error.message : 'UNKNOWN'}`);
      if (button) button.disabled = false;
    }
  }

  root.querySelector('[data-search-console-connect]')?.addEventListener('click', (event) => void startOAuth(event.currentTarget));
  root.querySelector('[data-search-console-reconnect]')?.addEventListener('click', (event) => void startOAuth(event.currentTarget));
  root.querySelector('[data-search-console-properties]')?.addEventListener('click', (event) => void loadProperties(event.currentTarget));
  root.querySelector('[data-search-console-bind-property]')?.addEventListener('click', (event) => void bindProperty(event.currentTarget));
  root.querySelector('[data-search-console-disconnect]')?.addEventListener('click', (event) => void disconnect(event.currentTarget));
})();
