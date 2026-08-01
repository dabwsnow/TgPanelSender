import { accountsApi, proxiesApi } from '../api.js?v=15';

const STATUS_LABELS = {
  active:       'Активен',
  inactive:     'Неактивен',
  connecting:   'Подключение',
  flood_wait:   'Флуд-лимит',
  spam_blocked: 'Спам-блок',
  error:        'Ошибка',
};

function statusBadge(status) {
  const map = {
    active:       'badge-active',
    inactive:     'badge-inactive',
    connecting:   'badge-connecting',
    flood_wait:   'badge-flood',
    spam_blocked: 'badge-spam',
    error:        'badge-error',
  };
  return `<span class="badge ${map[status] || 'badge-inactive'}">${STATUS_LABELS[status] || status}</span>`;
}

function avatarLetter(acc) {
  return (acc.first_name || acc.phone || '?')[0].toUpperCase();
}

export async function renderAccounts(app) {
  const content = document.getElementById('page-content');
  const topbarActions = document.getElementById('topbar-actions');

  topbarActions.innerHTML = `
    <button class="btn btn-secondary btn-sm" id="btn-distribute-proxies">Раздать прокси всем</button>
    <button class="btn btn-secondary btn-sm" id="btn-check-all">Проверить все</button>
    <button class="btn btn-primary" id="btn-add-account">Добавить аккаунт</button>`;

  let accounts = [];
  try {
    accounts = await accountsApi.list();
  } catch (e) {
    app.toast('Ошибка загрузки аккаунтов: ' + e.message, 'error');
  }

  content.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <div>
        <div style="font-size:20px;font-weight:700">Аккаунты</div>
        <div class="text-sm text-muted">${accounts.length} аккаунт(ов) добавлено</div>
      </div>
      <div class="flex gap-8">
        <input class="form-input" id="search-accounts" placeholder="Поиск..." style="width:220px">
      </div>
    </div>

    ${accounts.length === 0 ? `
      <div class="empty-state">
        <div class="empty-state-icon"></div>
        <div class="empty-state-title">Нет аккаунтов</div>
        <div class="empty-state-text">Добавь Telegram аккаунт для начала работы</div>
        <button class="btn btn-primary" id="btn-add-empty">Добавить аккаунт</button>
      </div>
    ` : `
      <div class="accounts-grid" id="accounts-grid">
        ${accounts.map(acc => renderAccountCard(acc)).join('')}
      </div>
    `}
  `;

  // Search filter
  document.getElementById('search-accounts')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('.account-card').forEach(card => {
      card.style.display = card.dataset.search?.includes(q) ? '' : 'none';
    });
  });

  // Open account
  document.querySelectorAll('.account-card').forEach(card => {
    card.addEventListener('click', () => {
      app.navigate('account-edit', { id: parseInt(card.dataset.id) });
    });
  });

  // Actions
  const handleAddAccount = async () => {
    let list = [];
    try { list = await proxiesApi.list(); } catch(e) {}
    showAddAccountModal(app, list);
  };
  document.getElementById('btn-add-account')?.addEventListener('click', handleAddAccount);
  document.getElementById('btn-add-empty')?.addEventListener('click', handleAddAccount);

  // Раздать прокси всем аккаунтам
  document.getElementById('btn-distribute-proxies')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const prev = btn.textContent;
    btn.innerHTML = '<span class="spinner"></span>';
    try {
      const res = await accountsApi.distributeProxies();
      app.toast(`Прокси назначены: ${res.assigned} аккаунт(ов)` +
        (res.proxies_used ? `, задействовано прокси: ${res.proxies_used}` : ''), 'success');
    } catch (err) {
      app.toast('Ошибка раздачи прокси: ' + err.message, 'error');
    }
    btn.disabled = false;
    btn.textContent = prev;
  });

  // Проверить все аккаунты сразу
  document.getElementById('btn-check-all')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const prev = btn.textContent;
    btn.innerHTML = '<span class="spinner"></span> Проверка...';
    try {
      const res = await accountsApi.spamCheckAll();
      const blocked = res.results.filter(r => r.is_blocked === true).length;
      const failed  = res.results.filter(r => r.checked === false).length;
      app.toast(`Проверено ${res.total}. Блок: ${blocked}, не удалось: ${failed}`, 'success');
      renderAccounts(app);
    } catch (err) {
      app.toast('Ошибка проверки: ' + err.message, 'error');
      btn.disabled = false;
      btn.textContent = prev;
    }
  });

  // Проверить один аккаунт из карточки
  document.querySelectorAll('.account-check-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      btn.disabled = true;
      const prev = btn.textContent;
      btn.innerHTML = '<span class="spinner"></span>';
      try {
        const res = await accountsApi.spamCheck(id);
        if (res.checked === false) {
          app.toast('Не удалось проверить: ' + (res.details || 'аккаунт не подключён'), 'error');
        } else if (res.is_blocked) {
          app.toast('Аккаунт в спам-блоке', 'error');
        } else {
          app.toast('Спам-блока нет', 'success');
        }
        renderAccounts(app);
      } catch (err) {
        app.toast('Ошибка: ' + err.message, 'error');
        btn.disabled = false;
        btn.textContent = prev;
      }
    });
  });
}

function renderAccountCard(acc) {
  const name = [acc.first_name, acc.last_name].filter(Boolean).join(' ') || acc.phone;
  return `
    <div class="account-card ${acc.is_spam_blocked ? 'spam-blocked' : ''}"
         data-id="${acc.id}"
         data-search="${(name + acc.phone + (acc.username || '')).toLowerCase()}">
      <div class="account-avatar" style="background:${strColor(acc.phone)}">
        ${avatarLetter(acc)}
        <span class="status-dot ${acc.status}"></span>
      </div>
      <div class="account-info">
        <div class="account-name">${name}</div>
        <div class="account-phone">${acc.phone} ${acc.username ? '· @' + acc.username : ''}</div>
        <div class="account-meta">
          ${statusBadge(acc.status)}
          ${acc.autoresponder_enabled ? '<span class="badge badge-active" style="font-size:10px">Автоответ</span>' : ''}
          <span class="account-stat">Отправлено: ${acc.messages_sent}</span>
          ${acc.messages_today > 0 ? `<span class="account-stat text-accent">Сегодня: ${acc.messages_today}</span>` : ''}
        </div>
      </div>
      <button class="btn btn-secondary btn-sm account-check-btn" data-id="${acc.id}"
              title="Проверить аккаунт">Проверить</button>
      <div style="font-size:18px;color:var(--text-muted)">></div>
    </div>
  `;
}

// ─── Модалка добавления аккаунта (3-шаговая + импорт файлов) ─────────────────────
function showAddAccountModal(app, proxies = []) {
  let activeTab = 'phone'; // 'phone' | 'session' | 'tdata'
  let step = 1;
  let phoneCodeHash = '';
  let phone = '';
  let selectedProxyId = null;

  const getPhoneContent = () => {
    if (step === 1) return `
      <div style="text-align:center;margin-bottom:20px">
        <div style="font-size:13px;color:var(--text-muted)">Шаг 1 из 3 — Номер телефона</div>
      </div>
      <div class="form-group">
        <label class="form-label">Номер телефона (с кодом страны)</label>
        <input class="form-input" id="inp-phone" placeholder="+79001234567" type="tel"
               style="font-size:18px;text-align:center;letter-spacing:2px">
        <div class="form-hint">Telegram пришлёт код подтверждения</div>
      </div>
      <div class="form-group">
        <label class="form-label">Прокси для подключения (опционально)</label>
        <select class="form-input" id="inp-proxy-id">
          <option value="">Без прокси</option>
          ${proxies.map(p => `<option value="${p.id}">${p.protocol.toUpperCase()}://${p.host}:${p.port} (${p.status})</option>`).join('')}
        </select>
      </div>
    `;
    if (step === 2) return `
      <div style="text-align:center;margin-bottom:20px">
        <div style="font-size:13px;color:var(--text-muted)">Шаг 2 из 3 — Код подтверждения</div>
        <div style="font-size:12px;margin-top:4px;color:var(--accent-light)">Код отправлен на <b>${phone}</b></div>
      </div>
      <div class="form-group">
        <label class="form-label">Код из Telegram</label>
        <input class="form-input" id="inp-code" placeholder="12345" type="text" maxlength="6"
               style="font-size:24px;text-align:center;letter-spacing:8px">
        <div class="form-hint">Код пришёл в приложение Telegram или в SMS</div>
      </div>
    `;
    if (step === 3) return `
      <div style="text-align:center;margin-bottom:20px">
        <div style="font-size:13px;color:var(--text-muted)">Шаг 3 из 3 — Пароль 2FA</div>
      </div>
      <div class="form-group">
        <label class="form-label">Пароль 2FA</label>
        <input class="form-input" id="inp-2fa" placeholder="Введи пароль..." type="password">
      </div>
    `;
  };

  const getSessionContent = () => `
    <div style="text-align:center;margin-bottom:20px">
      <div style="font-size:13px;color:var(--text-muted)">Загрузи файл .session (SQLite сессия Telethon или StringSession)</div>
    </div>
    <div class="form-group">
      <label class="form-label">Файл сессии (.session)</label>
      <div class="upload-zone" id="session-upload-zone">
        <div class="upload-zone-icon"></div>
        <div class="upload-zone-text" id="session-file-name">Нажми или перетащи файл .session сюда</div>
      </div>
      <input type="file" id="inp-session-file" accept=".session" style="display:none">
    </div>
  `;

  const getTDataContent = () => `
    <div style="text-align:center;margin-bottom:20px">
      <div style="font-size:13px;color:var(--text-muted)">Загрузи .zip архив папки tdata из Telegram Desktop</div>
    </div>
    <div class="form-group">
      <label class="form-label">Архив tdata (.zip)</label>
      <div class="upload-zone" id="tdata-upload-zone">
        <div class="upload-zone-icon"></div>
        <div class="upload-zone-text" id="tdata-file-name">Нажми или перетащи .zip архив папки tdata</div>
      </div>
      <input type="file" id="inp-tdata-file" accept=".zip" style="display:none">
    </div>
    <div class="form-group">
      <label class="form-label">Код-пароль (если установлен в Telegram Desktop)</label>
      <input class="form-input" id="inp-tdata-password" placeholder="Пароль от Telegram Desktop (если есть)" type="password">
    </div>
  `;

  const getFullContent = () => `
    <div class="flex gap-8 mb-16" style="border-bottom: 1px solid var(--border); padding-bottom: 12px; justify-content: center;">
      <button class="btn btn-ghost btn-sm tab-btn ${activeTab === 'phone' ? 'active' : ''}" data-tab="phone" ${step > 1 ? 'disabled style="opacity:0.5"' : ''}>По номеру</button>
      <button class="btn btn-ghost btn-sm tab-btn ${activeTab === 'session' ? 'active' : ''}" data-tab="session" ${step > 1 ? 'disabled style="opacity:0.5"' : ''}>Файл .session</button>
      <button class="btn btn-ghost btn-sm tab-btn ${activeTab === 'tdata' ? 'active' : ''}" data-tab="tdata" ${step > 1 ? 'disabled style="opacity:0.5"' : ''}>Архив TData</button>
    </div>
    <div id="tab-content">
      ${activeTab === 'phone' ? getPhoneContent() : activeTab === 'session' ? getSessionContent() : getTDataContent()}
    </div>
  `;

  const { overlay, close } = app.modal({
    title: 'Добавить аккаунт',
    content: getFullContent(),
    footer: `
      <button class="btn btn-secondary" id="add-acc-cancel">Отмена</button>
      <button class="btn btn-primary" id="add-acc-next">Отправить код</button>
    `,
  });

  const bindEvents = () => {
    // Tab switching
    overlay.querySelectorAll('.tab-btn').forEach(btn => {
      btn.onclick = () => {
        if (step > 1) return;
        activeTab = btn.dataset.tab;
        updateModal();
      };
    });

    const footerBtn = overlay.querySelector('#add-acc-next');

    if (activeTab === 'phone') {
      footerBtn.style.display = '';
      footerBtn.textContent = step === 1 ? 'Отправить код' : step === 2 ? 'Подтвердить' : 'Войти';
    } else {
      footerBtn.style.display = '';
      footerBtn.textContent = 'Импортировать';
    }

    // Session upload logic
    if (activeTab === 'session') {
      const zone = overlay.querySelector('#session-upload-zone');
      const input = overlay.querySelector('#inp-session-file');
      zone.onclick = () => input.click();
      input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
          overlay.querySelector('#session-file-name').innerHTML = `Выбран файл: <b>${file.name}</b> (${Math.round(file.size / 1024)} KB)`;
          zone.style.borderColor = 'var(--accent)';
        }
      };
    }

    // TData upload logic
    if (activeTab === 'tdata') {
      const zone = overlay.querySelector('#tdata-upload-zone');
      const input = overlay.querySelector('#inp-tdata-file');
      zone.onclick = () => input.click();
      input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
          overlay.querySelector('#tdata-file-name').innerHTML = `Выбран файл: <b>${file.name}</b> (${Math.round(file.size / 1024)} KB)`;
          zone.style.borderColor = 'var(--accent)';
        }
      };
    }
  };

  const updateModal = () => {
    overlay.querySelector('.modal-body').innerHTML = getFullContent();
    bindEvents();
  };

  bindEvents();

  overlay.querySelector('#add-acc-cancel').onclick = close;

  overlay.querySelector('#add-acc-next').onclick = async () => {
    const btn = overlay.querySelector('#add-acc-next');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    try {
      if (activeTab === 'phone') {
        if (step === 1) {
          let rawPhone = overlay.querySelector('#inp-phone').value.trim();
          if (!rawPhone) throw new Error('Введи номер телефона');
          phone = rawPhone.replace(/[\s\-\(\)]/g, '');

          const proxyVal = overlay.querySelector('#inp-proxy-id').value;
          selectedProxyId = proxyVal ? parseInt(proxyVal) : null;

          const res = await accountsApi.sendCode({ phone, proxy_id: selectedProxyId });
          phoneCodeHash = res.phone_code_hash;
          step = 2;
          updateModal();
        } else if (step === 2) {
          const code = overlay.querySelector('#inp-code').value.trim();
          if (!code) throw new Error('Введи код');

          const res = await accountsApi.verifyCode({
            phone,
            code,
            phone_code_hash: phoneCodeHash,
            proxy_id: selectedProxyId
          });

          if (res.requires_2fa) {
            step = 3;
            updateModal();
          } else {
            app.toast('Аккаунт успешно добавлен!', 'success');
            close();
            renderAccounts(app);
          }
        } else if (step === 3) {
          const password = overlay.querySelector('#inp-2fa').value;
          await accountsApi.verify2fa({ phone, password });
          app.toast('Аккаунт успешно добавлен!', 'success');
          close();
          renderAccounts(app);
        }
      } else if (activeTab === 'session') {
        const fileInput = overlay.querySelector('#inp-session-file');
        const file = fileInput.files[0];
        if (!file) throw new Error('Выбери файл .session');

        app.toast('Импорт сессии...', 'info');
        const res = await accountsApi.importSession(file);
        app.toast(`Аккаунт успешно импортирован!`, 'success');
        close();
        renderAccounts(app);
      } else if (activeTab === 'tdata') {
        const fileInput = overlay.querySelector('#inp-tdata-file');
        const file = fileInput.files[0];
        if (!file) throw new Error('Выбери .zip архив tdata папки');

        const password = overlay.querySelector('#inp-tdata-password').value || '';
        app.toast('Импорт TData...', 'info');
        const res = await accountsApi.importTData(file, password);
        app.toast(`Аккаунт успешно импортирован!`, 'success');
        close();
        renderAccounts(app);
      }
    } catch (e) {
      app.toast('Ошибка: ' + e.message, 'error');
    }

    btn.disabled = false;
    if (activeTab === 'phone') {
      btn.textContent = step === 1 ? 'Отправить код' : step === 2 ? 'Подтвердить' : 'Войти';
    } else {
      btn.textContent = 'Импортировать';
    }
  };
}

// Генерирует цвет на основе строки (черно-белые и серые тона)
function strColor(str) {
  const colors = [
    'linear-gradient(135deg,#333333,#666666)',
    'linear-gradient(135deg,#555555,#888888)',
    'linear-gradient(135deg,#777777,#aaaaaa)',
    'linear-gradient(135deg,#222222,#555555)',
    'linear-gradient(135deg,#444444,#777777)',
    'linear-gradient(135deg,#666666,#999999)',
    'linear-gradient(135deg,#888888,#bbbbbb)',
  ];
  let hash = 0;
  for (const c of str) hash = (hash << 5) - hash + c.charCodeAt(0);
  return colors[Math.abs(hash) % colors.length];
}
