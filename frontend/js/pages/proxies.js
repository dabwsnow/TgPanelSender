/**
 * pages/proxies.js — Управление прокси-серверами.
 */
import { proxiesApi } from '../api.js?v=15';

export async function renderProxies(app) {
  const content = document.getElementById('page-content');
  const topbarActions = document.getElementById('topbar-actions');

  topbarActions.innerHTML = `
    <button class="btn btn-secondary btn-sm" id="btn-import-proxies">📥 Импорт списком</button>
    <button class="btn btn-primary btn-sm" id="btn-new-proxy">+ Добавить прокси</button>
  `;

  let proxies = [];
  try {
    proxies = await proxiesApi.list();
  } catch (e) {
    app.toast('Ошибка загрузки прокси: ' + e.message, 'error');
  }

  content.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <div>
        <div style="font-size:20px;font-weight:700">Прокси-серверы</div>
        <div class="text-sm text-muted">${proxies.length} настроено</div>
      </div>
    </div>

    ${proxies.length === 0 ? `
      <div class="empty-state">
        <div class="empty-state-icon">🌐</div>
        <div class="empty-state-title">Нет прокси</div>
        <div class="empty-state-text">Добавь прокси-серверы для безопасности работы аккаунтов</div>
        <div style="display:flex;justify-content:center;gap:12px;margin-top:16px">
          <button class="btn btn-secondary" id="btn-import-empty">Импорт списком</button>
          <button class="btn btn-primary" id="btn-new-empty">Добавить прокси</button>
        </div>
      </div>
    ` : `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px" id="proxies-grid">
        ${proxies.map(p => renderProxyCard(p)).join('')}
      </div>
    `}
  `;

  document.getElementById('btn-new-proxy')?.addEventListener('click', () => showProxyModal(app));
  document.getElementById('btn-new-empty')?.addEventListener('click', () => showProxyModal(app));
  document.getElementById('btn-import-proxies')?.addEventListener('click', () => showImportProxiesModal(app));
  document.getElementById('btn-import-empty')?.addEventListener('click', () => showImportProxiesModal(app));

  document.querySelectorAll('.proxy-test-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Тест...';
      try {
        const res = await proxiesApi.test(id);
        if (res.status === 'working') {
          app.toast('Прокси работает!', 'success');
        } else {
          app.toast('Ошибка подключения: ' + (res.error_message || 'Неизвестно'), 'error');
        }
        renderProxies(app);
      } catch (err) {
        app.toast('Ошибка проверки: ' + err.message, 'error');
        renderProxies(app);
      }
    });
  });

  document.querySelectorAll('.proxy-edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      const p = proxies.find(item => item.id === id);
      showProxyModal(app, p);
    });
  });

  document.querySelectorAll('.proxy-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      const ok = await app.confirm('Удалить этот прокси? Все привязанные аккаунты останутся без прокси.');
      if (!ok) return;
      try {
        await proxiesApi.delete(id);
        app.toast('Прокси удалён', 'success');
        renderProxies(app);
      } catch (err) {
        app.toast('Ошибка: ' + err.message, 'error');
      }
    });
  });
}

function renderProxyCard(p) {
  const statusMap = {
    working: { label: 'Работает', class: 'badge-active' },
    dead: { label: 'Мёртв', class: 'badge-error' },
    untested: { label: 'Не проверен', class: 'badge-inactive' }
  };
  const st = statusMap[p.status] || { label: p.status, class: 'badge-inactive' };
  
  const authText = p.username ? `· 👤 ${p.username}` : '';
  const lastCheck = p.last_check_at ? new Date(p.last_check_at).toLocaleString() : 'Никогда';

  return `
    <div class="card flex flex-col justify-between" style="position:relative;gap:12px">
      <div>
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div style="font-weight:700;font-size:16px;color:var(--text-primary)">
            ${p.protocol.toUpperCase()}://${p.host}:${p.port}
          </div>
          <span class="badge ${st.class}">${st.label}</span>
        </div>
        <div class="text-xs text-muted" style="margin-top:4px">
          Добавлен: ${new Date(p.created_at).toLocaleDateString()} ${authText}
        </div>
        ${p.error_message ? `
          <div class="text-xs text-danger" style="margin-top:8px;background:rgba(239,83,80,0.1);padding:6px;border-radius:4px;word-break:break-all">
            ⚠️ ${p.error_message}
          </div>
        ` : ''}
      </div>
      
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;border-top:1px solid var(--border-color);padding-top:12px">
        <span class="text-xs text-muted" style="font-size:10px">Проверен: ${lastCheck}</span>
        <div class="flex gap-8">
          <button class="btn btn-sm btn-secondary proxy-test-btn" data-id="${p.id}">⚡ Тест</button>
          <button class="btn btn-sm btn-secondary proxy-edit-btn" data-id="${p.id}">✏️</button>
          <button class="btn btn-sm btn-danger proxy-delete-btn" data-id="${p.id}">🗑️</button>
        </div>
      </div>
    </div>
  `;
}

function showProxyModal(app, proxy = null) {
  const isEdit = !!proxy;
  
  const contentHtml = `
    <div class="form-group">
      <label class="form-label">Протокол</label>
      <select class="form-input" id="proxy-proto">
        <option value="socks5" ${proxy?.protocol === 'socks5' ? 'selected' : ''}>SOCKS5</option>
        <option value="http" ${proxy?.protocol === 'http' ? 'selected' : ''}>HTTP</option>
      </select>
    </div>

    <div class="form-group">
      <label class="form-label">Хост (IP / Домен)</label>
      <input class="form-input" id="proxy-host" placeholder="192.168.1.100" value="${proxy?.host || ''}">
    </div>

    <div class="form-group">
      <label class="form-label">Порт</label>
      <input class="form-input" id="proxy-port" type="number" placeholder="1080" value="${proxy?.port || ''}" min="1" max="65535">
    </div>

    <div class="form-group">
      <label class="form-label">Логин (опционально)</label>
      <input class="form-input" id="proxy-user" placeholder="user123" value="${proxy?.username || ''}">
    </div>

    <div class="form-group">
      <label class="form-label">Пароль (опционально)</label>
      <input class="form-input" id="proxy-pass" type="password" placeholder="••••••••" value="${proxy?.password || ''}">
    </div>

    <div class="form-group">
      <label class="toggle-wrap" style="cursor:pointer">
        <div>
          <div style="font-size:13px;font-weight:600">Активен</div>
          <div class="text-xs text-muted">Использовать этот прокси для аккаунтов</div>
        </div>
        <div class="toggle">
          <input type="checkbox" id="proxy-active" ${proxy ? (proxy.is_active ? 'checked' : '') : 'checked'}>
          <div class="toggle-track"></div>
          <div class="toggle-thumb"></div>
        </div>
      </label>
    </div>
  `;

  const { overlay, close } = app.modal({
    title: isEdit ? 'Редактировать прокси' : 'Добавить прокси',
    content: contentHtml,
    footer: `
      <button class="btn btn-secondary" id="proxy-modal-cancel">Отмена</button>
      <button class="btn btn-primary" id="proxy-modal-save">${isEdit ? 'Сохранить' : 'Добавить'}</button>
    `
  });

  overlay.querySelector('#proxy-modal-cancel').onclick = close;

  overlay.querySelector('#proxy-modal-save').onclick = async () => {
    const saveBtn = overlay.querySelector('#proxy-modal-save');
    const host = overlay.querySelector('#proxy-host').value.trim();
    const port = parseInt(overlay.querySelector('#proxy-port').value);
    const protocol = overlay.querySelector('#proxy-proto').value;
    const username = overlay.querySelector('#proxy-user').value.trim() || null;
    const password = overlay.querySelector('#proxy-pass').value.trim() || null;
    const is_active = overlay.querySelector('#proxy-active').checked;

    if (!host) { app.toast('Введите хост прокси', 'warn'); return; }
    if (!port || port < 1 || port > 65535) { app.toast('Введите корректный порт (1-65535)', 'warn'); return; }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner"></span> Сохранение...';

    const payload = { host, port, protocol, username, password, is_active };

    try {
      if (isEdit) {
        await proxiesApi.update(proxy.id, payload);
        app.toast('Прокси обновлён', 'success');
      } else {
        await proxiesApi.create(payload);
        app.toast('Прокси добавлен', 'success');
      }
      close();
      renderProxies(app);
    } catch (err) {
      app.toast('Ошибка сохранения: ' + err.message, 'error');
      saveBtn.disabled = false;
      saveBtn.innerHTML = isEdit ? 'Сохранить' : 'Добавить';
    }
  };
}

function showImportProxiesModal(app) {
  const contentHtml = `
    <div class="form-group">
      <label class="form-label">Протокол по умолчанию</label>
      <select class="form-input" id="import-default-proto">
        <option value="socks5">SOCKS5</option>
        <option value="http">HTTP</option>
      </select>
    </div>

    <div class="form-group">
      <label class="form-label">Список прокси (по одному на строку)</label>
      <textarea class="form-textarea" id="import-proxies-list" rows="8" 
                placeholder="185.189.245.53:17240:user335792:9etya2&#10;87.247.153.247:17240:user335792:9etya2"></textarea>
      <div class="form-hint">Формат: ip:port:username:password или ip:port</div>
    </div>
  `;

  const { overlay, close } = app.modal({
    title: 'Массовый импорт прокси',
    content: contentHtml,
    footer: `
      <button class="btn btn-secondary" id="import-modal-cancel">Отмена</button>
      <button class="btn btn-primary" id="import-modal-save">Импортировать</button>
    `
  });

  overlay.querySelector('#import-modal-cancel').onclick = close;

  overlay.querySelector('#import-modal-save').onclick = async () => {
    const saveBtn = overlay.querySelector('#import-modal-save');
    const rawText = overlay.querySelector('#import-proxies-list').value;
    const defaultProto = overlay.querySelector('#import-default-proto').value;

    const lines = rawText.split('\n');
    const parsedList = [];

    for (let line of lines) {
      line = line.trim();
      if (!line) continue;

      let protocol = defaultProto;
      let host = '';
      let port = 0;
      let username = null;
      let password = null;

      let raw = line;
      if (raw.includes('://')) {
        const parts = raw.split('://');
        protocol = parts[0].toLowerCase();
        raw = parts[1];
      }

      const parts = raw.split(':');
      if (parts.length >= 2) {
        host = parts[0];
        port = parseInt(parts[1]);
        if (parts.length >= 4) {
          username = parts[2];
          password = parts[3];
        }
      } else {
        continue;
      }

      if (host && port && !isNaN(port)) {
        parsedList.push({ host, port, protocol, username, password, is_active: true });
      }
    }

    if (parsedList.length === 0) {
      app.toast('Не найдено корректных прокси для импорта', 'warn');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner"></span> Импорт...';

    try {
      const res = await proxiesApi.bulk({ proxies: parsedList });
      app.toast(`Успешно импортировано ${res.added} прокси!`, 'success');
      close();
      renderProxies(app);
    } catch (err) {
      app.toast('Ошибка импорта: ' + err.message, 'error');
      saveBtn.disabled = false;
      saveBtn.innerHTML = 'Импортировать';
    }
  };
}
