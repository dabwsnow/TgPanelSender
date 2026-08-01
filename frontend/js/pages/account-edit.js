import { accountsApi } from '../api.js?v=16';

export async function renderAccountEdit(app, { id }) {
  const content = document.getElementById('page-content');
  const topbarActions = document.getElementById('topbar-actions');

  let acc;
  try {
    acc = await accountsApi.get(id);
  } catch (e) {
    app.toast('Аккаунт не найден', 'error');
    app.navigate('accounts');
    return;
  }

  let proxies = [];
  try {
    const { proxiesApi } = await import('../api.js?v=15');
    proxies = await proxiesApi.list();
  } catch (e) {}

  const name = [acc.first_name, acc.last_name].filter(Boolean).join(' ') || acc.phone;

  topbarActions.innerHTML = `
    <button class="btn btn-ghost btn-sm" id="btn-back">Назад</button>
    <button class="btn btn-sm btn-secondary" id="btn-spam-check">Проверить спам</button>
    <button class="btn btn-sm btn-danger" id="btn-delete-acc">Удалить</button>
  `;

  content.innerHTML = `
    <!-- Вкладки навигации по аккаунту -->
    <div class="details-tabs">
      <button class="details-tab-btn active" id="tab-btn-settings">Настройки и Автоответчик</button>
      <button class="details-tab-btn" id="tab-btn-chats">Диалоги и чаты</button>
      <button class="details-tab-btn" id="tab-btn-groups">Группы и Вступление</button>
    </div>

    <!-- Вкладка настроек и автоответчика -->
    <div id="tab-settings-content" style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <!-- Профиль -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">Профиль Telegram</div>
          <div class="flex gap-8 items-center">
            <span class="badge badge-${acc.status}">${acc.status}</span>
            ${acc.connected ? '<span class="badge badge-active">Online</span>' : '<span class="badge badge-inactive">Offline</span>'}
          </div>
        </div>

        <!-- Аватар -->
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px;padding:16px;background:var(--bg-elevated);border-radius:var(--r-md)">
          <div id="avatar-preview" style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--teal));display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:700;flex-shrink:0;overflow:hidden">
            ${acc.avatar_path ? `<img src="${acc.avatar_path}" style="width:100%;height:100%;object-fit:cover">` : name[0]?.toUpperCase() || '?'}
          </div>
          <div>
            <div style="font-size:15px;font-weight:600">${name}</div>
            <div class="text-sm text-muted">${acc.phone}</div>
            <label class="btn btn-sm btn-secondary" style="margin-top:6px;cursor:pointer">
              Сменить аватар
              <input type="file" id="avatar-file" accept="image/*" style="display:none">
            </label>
          </div>
        </div>

        <form id="profile-form">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="form-group">
              <label class="form-label">Имя</label>
              <input class="form-input" id="p-first-name" value="${acc.first_name || ''}" placeholder="Имя">
            </div>
            <div class="form-group">
              <label class="form-label">Фамилия</label>
              <input class="form-input" id="p-last-name" value="${acc.last_name || ''}" placeholder="Фамилия">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Username</label>
            <input class="form-input" id="p-username" value="${acc.username || ''}" placeholder="@username">
          </div>
          <div class="form-group">
            <label class="form-label">Биография</label>
            <textarea class="form-textarea" id="p-bio" placeholder="Текст биографии...">${acc.bio || ''}</textarea>
          </div>
          <button type="submit" class="btn btn-primary" style="width:100%">Сохранить профиль</button>
        </form>
      </div>

      <!-- Правая колонка -->
      <div style="display:flex;flex-direction:column;gap:16px">

        <!-- Статистика -->
        <div class="card">
          <div class="card-title" style="margin-bottom:12px">Статистика</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div style="background:var(--bg-elevated);border-radius:var(--r-md);padding:12px;text-align:center">
              <div style="font-size:22px;font-weight:700;color:var(--accent-light)">${acc.messages_sent}</div>
              <div class="text-xs text-muted">Всего отправлено</div>
            </div>
            <div style="background:var(--bg-elevated);border-radius:var(--r-md);padding:12px;text-align:center">
              <div style="font-size:22px;font-weight:700;color:var(--teal)">${acc.messages_today}</div>
              <div class="text-xs text-muted">Сегодня</div>
            </div>
          </div>
          ${acc.spam_checked_at ? `<div class="text-xs text-muted" style="margin-top:8px;text-align:center">Последняя проверка: ${new Date(acc.spam_checked_at).toLocaleString('ru')}</div>` : ''}
          ${!acc.connected ? `
            <button class="btn btn-secondary btn-sm" style="width:100%;margin-top:10px" id="btn-reconnect">
              Переподключить
            </button>
          ` : ''}
        </div>

        <!-- Прокси -->
        <div class="card">
          <div class="card-title" style="margin-bottom:12px">Прокси-сервер</div>
          <div class="form-group" style="margin-bottom:12px">
            <select class="form-input" id="acc-proxy-id">
              <option value="">Без прокси</option>
              ${proxies.map(p => `<option value="${p.id}" ${p.id === acc.proxy_id ? 'selected' : ''}>${p.protocol.toUpperCase()}://${p.host}:${p.port} (${p.status})</option>`).join('')}
            </select>
          </div>
          <button class="btn btn-secondary btn-sm" id="btn-save-proxy" style="width:100%">Сохранить прокси</button>
        </div>

        <!-- Автоответчик -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">Автоответчик</div>
          </div>

          <label class="toggle-wrap" style="margin-bottom:12px">
            <div>
              <div style="font-size:13px;font-weight:600">Включить автоответчик</div>
              <div class="text-xs text-muted">Автоматически отвечать на входящие</div>
            </div>
            <div class="toggle">
              <input type="checkbox" id="ar-enabled" ${acc.autoresponder_enabled ? 'checked' : ''}>
              <div class="toggle-track"></div>
              <div class="toggle-thumb"></div>
            </div>
          </label>

          <div class="form-group">
            <label class="form-label">Текст ответа</label>
            <textarea class="form-textarea" id="ar-message" rows="3" placeholder="Привет, {first_name}! Я сейчас не в сети...">${acc.autoresponder_message || ''}</textarea>
            <div class="form-hint">Переменные: {first_name} {last_name} {username} {name} {date} {time}</div>
          </div>
          <div class="form-group">
            <label class="form-label">Задержка перед ответом (сек)</label>
            <input class="form-input" id="ar-delay" type="number" value="${acc.autoresponder_delay || 5}" min="0" max="3600">
          </div>
          <div class="form-group">
            <label class="form-label">Ключевые слова-триггеры</label>
            <div class="tags-input-wrap" id="keywords-wrap">
              ${(acc.autoresponder_keywords || []).map(k =>
                `<span class="tag">${k}<span class="tag-remove" data-kw="${k}">×</span></span>`
              ).join('')}
              <input class="tags-input" id="keyword-input" placeholder="Введи слово + Enter...">
            </div>
            <div class="form-hint">Пусто = отвечать всем. Нажми Enter для добавления.</div>
          </div>
          <button class="btn btn-primary" style="width:100%" id="btn-save-ar">Сохранить автоответчик</button>
        </div>

        <!-- Спам история -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">История проверок спама</div>
          </div>
          <div id="spam-history-list">
            <div style="text-align:center;padding:20px"><div class="spinner"></div></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Вкладка Живых чатов Telegram -->
    <div id="tab-chats-content" style="display:none">
      ${!acc.connected ? `
        <div class="empty-state">
          <div class="empty-state-icon">⚠️</div>
          <div class="empty-state-title">Аккаунт не подключён</div>
          <div class="empty-state-text">Для просмотра и ведения чатов необходимо, чтобы статус аккаунта был "Online"</div>
          <button class="btn btn-primary" id="chats-reconnect-btn">Подключить аккаунт</button>
        </div>
      ` : `
        <div class="chat-container">
          <!-- Левая часть: список диалогов -->
          <div class="chat-sidebar">
            <div class="chat-sidebar-header">
              <input class="chat-sidebar-search" id="chat-search-input" placeholder="Поиск по имени или @username...">
            </div>
            <div class="chat-sidebar-list" id="chat-list-items">
              <div style="text-align:center;padding:40px"><div class="spinner"></div></div>
            </div>
          </div>
          <!-- Правая часть: окно переписки -->
          <div class="chat-window" id="chat-window-area">
            <div class="chat-empty-state">
              <div class="chat-empty-state-icon">💬</div>
              <div style="font-weight:600;font-size:15px">Выберите диалог</div>
              <div class="text-sm text-muted">История переписки отобразится здесь</div>
            </div>
          </div>
        </div>
      `}
    </div>

    <!-- Вкладка групп и вступлений -->
    <div id="tab-groups-content" style="display:none;grid-template-columns:1fr 1fr;gap:16px">
      <!-- Список текущих групп -->
      <div class="card" style="display:flex;flex-direction:column;height:calc(100vh - 200px)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <div class="card-title">Группы и каналы аккаунта</div>
          <button class="btn btn-secondary btn-sm" id="btn-acc-leave-all" style="color:var(--red)">🗑 Выйти из всех</button>
        </div>
        <div id="acc-groups-list" style="flex:1;overflow-y:auto;border:1px solid var(--border);border-radius:var(--r-md)">
          <div style="text-align:center;padding:20px;color:var(--text-muted)">Нажмите «Диалоги и чаты» сначала или обновите список</div>
        </div>
        <button class="btn btn-primary" id="btn-acc-groups-refresh" style="margin-top:10px">🔄 Обновить список</button>
      </div>

      <!-- Индивидуальная очередь вступлений -->
      <div class="card" style="display:flex;flex-direction:column;height:calc(100vh - 200px)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <div class="card-title">Очередь авто-вступлений</div>
          <div id="acc-joins-badge-wrap"></div>
        </div>
        
        <!-- Добавление -->
        <div class="form-group" style="margin-bottom:10px">
          <textarea class="form-textarea" id="acc-tab-joins-input" rows="3" style="font-size:12px" placeholder="Введи ссылки на чаты (по одной на строку)..."></textarea>
          <button class="btn btn-secondary btn-sm" id="btn-acc-tab-joins-add" style="margin-top:6px;width:100%">Добавить в очередь</button>
        </div>

        <div id="acc-tab-joins-list" style="flex:1;overflow-y:auto;border:1px solid var(--border);border-radius:var(--r-md);margin-bottom:10px"></div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <button class="btn btn-secondary" id="btn-acc-tab-joins-clear" style="color:var(--red)">Очистить очередь</button>
          <button class="btn btn-primary" id="btn-acc-tab-joins-toggle">▶ Запустить</button>
        </div>
      </div>
    </div>
  `;

  // Back
  document.getElementById('btn-back').onclick = () => app.navigate('accounts');

  // Spam check
  document.getElementById('btn-spam-check').onclick = async () => {
    app.toast('Проверка спам-блока...', 'info');
    try {
      const res = await accountsApi.spamCheck(id);
      app.toast(res.is_blocked ? 'Обнаружен спам-блок!' : 'Спам-блока нет', res.is_blocked ? 'warn' : 'success');
      loadSpamHistory();
    } catch (e) { app.toast('Ошибка: ' + e.message, 'error'); }
  };

  // Delete
  document.getElementById('btn-delete-acc').onclick = async () => {
    const ok = await app.confirm(`Удалить аккаунт ${name}? Это действие необратимо.`);
    if (!ok) return;
    try {
      await accountsApi.delete(id);
      app.toast('Аккаунт удалён', 'success');
      app.navigate('accounts');
    } catch (e) { app.toast('Ошибка: ' + e.message, 'error'); }
  };

  // Reconnect
  document.getElementById('btn-reconnect')?.addEventListener('click', async () => {
    app.toast('Переподключение...', 'info');
    try {
      const res = await accountsApi.connect(id);
      app.toast(res.connected ? 'Подключено!' : ('Не удалось подключить: ' + (res.error || 'причина неизвестна')),
                res.connected ? 'success' : 'error');
      renderAccountEdit(app, { id });
    } catch (e) { app.toast('Ошибка: ' + e.message, 'error'); }
  });

  // Save proxy
  document.getElementById('btn-save-proxy').onclick = async () => {
    const btn = document.getElementById('btn-save-proxy');
    const val = document.getElementById('acc-proxy-id').value;
    const proxyId = val ? parseInt(val) : null;
    
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    
    try {
      await accountsApi.updateProxy(id, proxyId);
      app.toast('Прокси успешно привязан! Для применения изменений рекомендуется переподключить аккаунт.', 'success');
    } catch (err) {
      app.toast('Ошибка: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = 'Сохранить прокси';
    }
  };

  // Save profile
  document.getElementById('profile-form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Сохраняю...';
    try {
      await accountsApi.updateProfile(id, {
        first_name: document.getElementById('p-first-name').value || null,
        last_name:  document.getElementById('p-last-name').value || null,
        username:   document.getElementById('p-username').value.replace('@', '') || null,
        bio:        document.getElementById('p-bio').value || null,
      });
      app.toast('Профиль обновлён', 'success');
    } catch (e) { app.toast('Ошибка: ' + e.message, 'error'); }
    btn.disabled = false; btn.textContent = 'Сохранить профиль';
  };

  // Avatar upload
  document.getElementById('avatar-file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await accountsApi.uploadAvatar(id, file);
      app.toast('Аватар обновлён', 'success');
      const preview = document.getElementById('avatar-preview');
      const url = URL.createObjectURL(file);
      preview.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover">`;
    } catch (e) { app.toast('Ошибка: ' + e.message, 'error'); }
  };

  // Keywords tags input
  const keywords = [...(acc.autoresponder_keywords || [])];
  const keyInput = document.getElementById('keyword-input');
  const wrap = document.getElementById('keywords-wrap');

  const addKeyword = (kw) => {
    kw = kw.trim();
    if (!kw || keywords.includes(kw)) return;
    keywords.push(kw);
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.innerHTML = `${kw}<span class="tag-remove">×</span>`;
    tag.querySelector('.tag-remove').onclick = () => {
      keywords.splice(keywords.indexOf(kw), 1);
      tag.remove();
    };
    wrap.insertBefore(tag, keyInput);
  };

  keyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addKeyword(keyInput.value); keyInput.value = ''; }
    if (e.key === 'Backspace' && !keyInput.value && keywords.length) {
      keywords.pop();
      wrap.querySelectorAll('.tag').forEach((t, i) => { if (i === wrap.querySelectorAll('.tag').length - 1) t.remove(); });
    }
  });

  wrap.querySelectorAll('.tag-remove').forEach(btn => {
    btn.onclick = (e) => {
      const kw = btn.dataset.kw;
      keywords.splice(keywords.indexOf(kw), 1);
      btn.closest('.tag').remove();
    };
  });

  // Save autoresponder
  document.getElementById('btn-save-ar').onclick = async () => {
    const btn = document.getElementById('btn-save-ar');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    try {
      await accountsApi.updateAutoResponder(id, {
        enabled:  document.getElementById('ar-enabled').checked,
        message:  document.getElementById('ar-message').value,
        delay:    parseInt(document.getElementById('ar-delay').value) || 5,
        keywords,
      });
      app.toast('Автоответчик сохранён', 'success');
    } catch (e) { app.toast('Ошибка: ' + e.message, 'error'); }
    btn.disabled = false; btn.textContent = 'Сохранить автоответчик';
  };

  // Spam history
  async function loadSpamHistory() {
    const list = document.getElementById('spam-history-list');
    try {
      const history = await accountsApi.spamHistory(id);
      if (!history.length) {
        list.innerHTML = '<div class="text-sm text-muted" style="text-align:center;padding:16px">Нет истории проверок</div>';
        return;
      }
      list.innerHTML = history.slice(0, 10).map(h => `
        <div class="flex items-center gap-8" style="padding:8px 0;border-bottom:1px solid var(--border)">
          <span>[${h.is_blocked ? 'БЛОК' : 'ОК'}]</span>
          <div style="flex:1">
            <div style="font-size:12px;font-weight:600;color:${h.is_blocked ? 'var(--red)' : 'var(--green)'}">
              ${h.is_blocked ? 'Заблокирован' : 'Чисто'}
            </div>
            <div class="text-xs text-muted">${new Date(h.checked_at).toLocaleString('ru')}</div>
          </div>
        </div>
      `).join('');
    } catch {
      list.innerHTML = '<div class="text-sm text-muted" style="text-align:center;padding:16px">Ошибка загрузки</div>';
    }
  }
  loadSpamHistory();

  // ─── Табы ────────────────────────────────────────────────────────
  const tabBtnSettings = document.getElementById('tab-btn-settings');
  const tabBtnChats = document.getElementById('tab-btn-chats');
  const tabBtnGroups = document.getElementById('tab-btn-groups');
  const tabSettingsContent = document.getElementById('tab-settings-content');
  const tabChatsContent = document.getElementById('tab-chats-content');
  const tabGroupsContent = document.getElementById('tab-groups-content');

  tabBtnSettings.onclick = () => {
    tabBtnSettings.classList.add('active');
    tabBtnChats.classList.remove('active');
    tabBtnGroups.classList.remove('active');
    tabSettingsContent.style.display = 'grid';
    tabChatsContent.style.display = 'none';
    tabGroupsContent.style.display = 'none';
  };

  tabBtnChats.onclick = () => {
    tabBtnSettings.classList.remove('active');
    tabBtnChats.classList.add('active');
    tabBtnGroups.classList.remove('active');
    tabSettingsContent.style.display = 'none';
    tabChatsContent.style.display = 'block';
    tabGroupsContent.style.display = 'none';
    if (acc.connected) {
      loadChats();
    }
  };

  tabBtnGroups.onclick = () => {
    tabBtnSettings.classList.remove('active');
    tabBtnChats.classList.remove('active');
    tabBtnGroups.classList.add('active');
    tabSettingsContent.style.display = 'none';
    tabChatsContent.style.display = 'none';
    tabGroupsContent.style.display = 'grid';
    loadAccountGroups();
    loadAccountJoins();
  };

  // ─── Логика Групп и Вступлений ──────────────────────────────────────────
  async function loadAccountGroups() {
    const list = document.getElementById('acc-groups-list');
    list.innerHTML = '<div style="text-align:center;padding:40px"><div class="spinner"></div><div style="font-size:11px;color:var(--text-muted);margin-top:6px">Запрос диалогов из Telegram...</div></div>';
    
    try {
      const res = await accountsApi.groups(id);
      if (!res.ok || !res.groups) {
        list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)">Не удалось загрузить группы</div>';
        return;
      }
      if (res.groups.length === 0) {
        list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)">Аккаунт не состоит в группах</div>';
        return;
      }
      list.innerHTML = `
        <table class="table" style="font-size:12px">
          <thead>
            <tr>
              <th>Название</th>
              <th style="width:120px">Тип</th>
              <th style="width:70px"></th>
            </tr>
          </thead>
          <tbody>
            ${res.groups.map(g => `
              <tr>
                <td>
                  <strong>${escHtml(g.name)}</strong>
                  ${g.username ? `<div style="font-size:10px;opacity:0.6">@${g.username}</div>` : ''}
                </td>
                <td class="text-muted">${g.is_channel ? 'Канал' : 'Группа'}</td>
                <td>
                  <button class="btn btn-ghost btn-sm btn-acc-leave-group" data-chat-id="${g.id}" style="color:var(--red);padding:2px 6px">Выйти</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;

      list.querySelectorAll('.btn-acc-leave-group').forEach(btn => {
        btn.onclick = async () => {
          const cid = parseInt(btn.dataset.chatId);
          btn.disabled = true;
          btn.textContent = 'Выход...';
          try {
            await accountsApi.leaveGroup(id, cid);
            app.toast('Вышли из группы', 'success');
            loadAccountGroups();
          } catch (e) {
            app.toast('Ошибка: ' + e.message, 'error');
            btn.disabled = false;
            btn.textContent = 'Выйти';
          }
        };
      });

    } catch (e) {
      list.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted)">Ошибка: ${e.message}</div>`;
    }
  }

  document.getElementById('btn-acc-groups-refresh').onclick = loadAccountGroups;

  document.getElementById('btn-acc-leave-all').onclick = async () => {
    const ok = await app.confirm('Вы действительно хотите выйти из ВСЕХ групп и каналов этого аккаунта?');
    if (!ok) return;
    const btn = document.getElementById('btn-acc-leave-all');
    btn.disabled = true; btn.textContent = 'Выхожу...';
    try {
      const res = await accountsApi.leaveAllGroups(id);
      app.toast(`Успешно вышли из чатов: ${res.left}`, 'success');
      loadAccountGroups();
    } catch (e) {
      app.toast('Ошибка: ' + e.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = '🗑 Выйти из всех';
    }
  };

  // 2. Joins logic
  let joinsRunning = false;
  async function loadAccountJoins() {
    const list = document.getElementById('acc-tab-joins-list');
    list.innerHTML = '<div style="text-align:center;padding:20px"><div class="spinner"></div></div>';
    
    try {
      const res = await accountsApi.getJoins(id);
      if (!res.ok) return;
      joinsRunning = res.is_running;
      
      const badgeWrap = document.getElementById('acc-joins-badge-wrap');
      const activeCount = res.joins.filter(j => j.status === 'pending').length;
      badgeWrap.innerHTML = res.is_running ? 
        `<span class="badge badge-active"><span class="spinner" style="width:10px;height:10px;border-width:2px;margin-right:4px"></span> Выполняется (осталось: ${activeCount})</span>` :
        `<span class="badge" style="background:var(--bg-elevated);color:var(--text-muted)">Остановлен (в очереди: ${activeCount})</span>`;

      const toggleBtn = document.getElementById('btn-acc-tab-joins-toggle');
      toggleBtn.className = res.is_running ? 'btn btn-danger' : 'btn btn-primary';
      toggleBtn.textContent = res.is_running ? '🛑 Остановить' : '▶ Запустить';

      if (res.joins.length === 0) {
        list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:12px">Очередь вступлений пуста</div>';
        return;
      }

      list.innerHTML = `
        <table class="table" style="font-size:11px">
          <thead>
            <tr>
              <th>Ссылка</th>
              <th>Статус</th>
              <th>Вход / Ошибка</th>
            </tr>
          </thead>
          <tbody>
            ${res.joins.map(j => `
              <tr>
                <td style="font-family:monospace">${escHtml(j.chat_link)}</td>
                <td>
                  ${j.status === 'joined' ? '<span class="text-green" style="font-weight:bold">Вступил</span>' : ''}
                  ${j.status === 'pending' ? '<span class="text-muted">Ожидает</span>' : ''}
                  ${j.status === 'joining' ? '<span class="text-accent spinner" style="width:8px;height:8px;border-width:2px"></span>' : ''}
                  ${j.status === 'failed' ? '<span class="text-red">Ошибка</span>' : ''}
                </td>
                <td>
                  ${j.error_message ? `<span style="color:var(--red);font-size:10px">${escHtml(j.error_message)}</span>` : ''}
                  ${j.joined_at ? `<span class="text-muted">${new Date(j.joined_at).toLocaleTimeString('ru', {hour:'2-digit', minute:'2-digit'})}</span>` : ''}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;

    } catch (e) {
      list.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted)">Ошибка: ${e.message}</div>`;
    }
  }

  document.getElementById('btn-acc-tab-joins-add').onclick = async () => {
    const input = document.getElementById('acc-tab-joins-input');
    const text = input.value.trim();
    if (!text) return;
    try {
      await accountsApi.addJoins(id, text);
      input.value = '';
      app.toast('Добавлено в очередь', 'success');
      loadAccountJoins();
    } catch (e) {
      app.toast('Ошибка: ' + e.message, 'error');
    }
  };

  document.getElementById('btn-acc-tab-joins-clear').onclick = async () => {
    try {
      await accountsApi.clearJoins(id);
      app.toast('Очередь очищена', 'success');
      loadAccountJoins();
    } catch (e) { app.toast('Ошибка: ' + e.message, 'error'); }
  };

  document.getElementById('btn-acc-tab-joins-toggle').onclick = async () => {
    try {
      if (joinsRunning) {
        await accountsApi.stopJoins(id);
        app.toast('Авто-вступление остановлено', 'success');
      } else {
        await accountsApi.startJoins(id, 30, 60);
        app.toast('Авто-вступление запущено', 'success');
      }
      loadAccountJoins();
    } catch (e) {
      app.toast('Ошибка: ' + e.message, 'error');
    }
  };

  // Переподключение в окне чатов
  document.getElementById('chats-reconnect-btn')?.addEventListener('click', async () => {
    app.toast('Переподключение...', 'info');
    try {
      const res = await accountsApi.connect(id);
      app.toast(res.connected ? 'Подключено!' : ('Не удалось подключить: ' + (res.error || 'причина неизвестна')),
                res.connected ? 'success' : 'error');
      renderAccountEdit(app, { id });
    } catch (e) { app.toast('Ошибка: ' + e.message, 'error'); }
  });

  // ─── Логика чатов ────────────────────────────────────────────────
  let chatsList = [];
  let activeChatId = null;

  async function loadChats() {
    const listContainer = document.getElementById('chat-list-items');
    if (!listContainer) return;
    listContainer.innerHTML = '<div style="text-align:center;padding:40px"><div class="spinner"></div></div>';
    
    try {
      const res = await accountsApi.chats(id);
      if (!res.ok || !res.chats) {
        listContainer.innerHTML = '<div class="text-sm text-muted" style="padding:20px;text-align:center">Не удалось загрузить чаты</div>';
        return;
      }
      chatsList = res.chats;
      renderChatsList(chatsList);
      setupChatsSearch();
    } catch (e) {
      listContainer.innerHTML = `<div class="text-sm text-muted" style="padding:20px;text-align:center">Ошибка: ${e.message}</div>`;
    }
  }

  function renderChatsList(list) {
    const listContainer = document.getElementById('chat-list-items');
    if (!listContainer) return;
    if (list.length === 0) {
      listContainer.innerHTML = '<div class="text-sm text-muted" style="padding:20px;text-align:center">Диалогов не найдено</div>';
      return;
    }

    listContainer.innerHTML = list.map(chat => {
      const dateStr = chat.date ? new Date(chat.date).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }) : '';
      const avatarColor = strColor(chat.id.toString());
      const firstLetter = chat.name ? chat.name[0].toUpperCase() : '?';
      const isActive = activeChatId === chat.id.toString() ? 'active' : '';

      return `
        <div class="chat-item ${isActive}" data-chat-id="${chat.id}" data-chat-name="${chat.name || ''}" data-chat-username="${chat.username || ''}">
          <div class="chat-item-avatar" style="background: ${avatarColor}">
            ${firstLetter}
          </div>
          <div class="chat-item-body">
            <div class="chat-item-header">
              <span class="chat-item-name">${chat.name || 'Без имени'}</span>
              <span class="chat-item-time">${dateStr}</span>
            </div>
            <div class="chat-item-header">
              <span class="chat-item-msg">${chat.last_message || ''}</span>
              ${chat.unread_count > 0 ? `<span class="chat-item-badge">${chat.unread_count}</span>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Навешиваем клик на элементы чата
    listContainer.querySelectorAll('.chat-item').forEach(el => {
      el.onclick = () => {
        const chatId = el.dataset.chatId;
        const name = el.dataset.chatName;
        const username = el.dataset.chatUsername;
        loadChatMessages(chatId, name, username);
      };
    });
  }

  function setupChatsSearch() {
    const searchInp = document.getElementById('chat-search-input');
    if (!searchInp) return;
    searchInp.oninput = (e) => {
      const query = e.target.value.toLowerCase().trim();
      const filtered = chatsList.filter(chat => 
        (chat.name && chat.name.toLowerCase().includes(query)) ||
        (chat.username && chat.username.toLowerCase().includes(query))
      );
      renderChatsList(filtered);
    };
  }

  async function loadChatMessages(chatId, chatName, chatUsername) {
    activeChatId = chatId;
    
    document.querySelectorAll('.chat-item').forEach(el => {
      el.classList.toggle('active', el.dataset.chatId === chatId.toString());
    });

    const windowArea = document.getElementById('chat-window-area');
    if (!windowArea) return;
    
    // Показываем лоадер в окне сообщений
    windowArea.innerHTML = `
      <div class="chat-window-header">
        <div>
          <div class="chat-window-title">${chatName || 'Без имени'}</div>
          ${chatUsername ? `<div class="chat-window-subtitle">@${chatUsername}</div>` : ''}
        </div>
      </div>
      <div class="chat-window-messages" id="chat-messages-container">
        <div style="margin: auto;"><div class="spinner"></div></div>
      </div>
      <div class="chat-window-input-area">
        <input class="chat-input" id="chat-message-input" placeholder="Напишите сообщение..." disabled>
        <button class="btn btn-primary" id="chat-send-btn" disabled>Отправить</button>
      </div>
    `;

    try {
      const res = await accountsApi.chatMessages(id, chatId);
      if (!res.ok || !res.messages) {
        throw new Error('Не удалось загрузить сообщения');
      }

      renderMessages(res.messages, chatName, chatUsername, chatId);
    } catch (e) {
      document.getElementById('chat-messages-container').innerHTML = `
        <div style="margin: auto; color: var(--text-muted); font-size:13px">Ошибка: ${e.message}</div>
      `;
    }
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function renderMessages(messages, chatName, chatUsername, chatId) {
    const msgContainer = document.getElementById('chat-messages-container');
    if (!msgContainer) return;

    if (messages.length === 0) {
      msgContainer.innerHTML = '<div style="margin: auto; color: var(--text-muted); font-size: 13px">История сообщений пуста</div>';
    } else {
      msgContainer.innerHTML = messages.map(msg => {
        const timeStr = msg.date ? new Date(msg.date).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }) : '';
        const alignment = msg.out ? 'out' : 'in';
        
        let mediaHtml = '';
        if (msg.media) {
          const m = msg.media;
          if (m.url) {
            // Файл уже скачан, отображаем его
            if (m.type === 'photo') {
              mediaHtml = `<div class="chat-media-wrap"><img src="${m.url}" style="max-width: 100%; max-height: 250px; border-radius: 8px; margin-bottom: 6px; display: block;"></div>`;
            } else if (m.type === 'video') {
              mediaHtml = `<div class="chat-media-wrap"><video src="${m.url}" controls style="max-width: 100%; max-height: 250px; border-radius: 8px; margin-bottom: 6px; display: block;"></video></div>`;
            } else if (m.type === 'voice' || m.type === 'audio') {
              mediaHtml = `<div class="chat-media-wrap"><audio src="${m.url}" controls style="max-width: 100%; margin-bottom: 6px; display: block;"></audio></div>`;
            } else {
              mediaHtml = `<div class="chat-media-wrap"><a href="${m.url}" download class="media-download-link" style="display:flex;align-items:center;gap:8px;padding:8px;background:rgba(255,255,255,0.05);border-radius:6px;margin-bottom:6px;font-size:12px;"><span style="font-size:20px;">📁</span> <div style="min-width:0;flex:1;"><div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${m.info.filename || 'Файл'}</div><div style="font-size:10px;opacity:0.6;">${formatBytes(m.info.size)}</div></div></a></div>`;
            }
          } else {
            // Кнопка для скачивания
            let label = 'Скачать файл';
            let icon = '📁';
            if (m.type === 'photo') { label = 'Скачать фото'; icon = '🖼️'; }
            else if (m.type === 'video') { label = 'Скачать видео'; icon = '🎥'; }
            else if (m.type === 'voice') { label = 'Скачать голосовое'; icon = '🎤'; }
            else if (m.type === 'audio') { label = 'Скачать аудио'; icon = '🎵'; }

            const sizeLabel = m.info.size ? ` (${formatBytes(m.info.size)})` : '';
            const filenameLabel = m.info.filename ? `<div style="font-size:10px;opacity:0.6;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${m.info.filename}</div>` : '';

            mediaHtml = `
              <div class="chat-media-wrap" id="media-placeholder-${msg.id}">
                <button class="btn btn-secondary btn-sm media-download-btn" data-msg-id="${msg.id}" data-media-type="${m.type}" data-filename="${m.info.filename || ''}" style="width:100%;display:flex;align-items:center;gap:8px;justify-content:center;padding:8px;border-radius:6px;margin-bottom:6px;font-size:12px;cursor:pointer;background:rgba(255,255,255,0.1);color:var(--text-primary);">
                  <span>${icon}</span>
                  <div style="text-align:left;min-width:0;flex:1;">
                    <div style="font-weight:600;">${label}${sizeLabel}</div>
                    ${filenameLabel}
                  </div>
                </button>
              </div>
            `;
          }
        }

        return `
          <div class="chat-msg-bubble ${alignment}">
            ${!msg.out ? `<div class="chat-msg-sender">${msg.sender_name}</div>` : ''}
            ${mediaHtml}
            ${msg.text ? `<div>${msg.text}</div>` : ''}
            <div class="chat-msg-time">${timeStr}</div>
          </div>
        `;
      }).join('');
    }

    // Прокрутка вниз
    msgContainer.scrollTop = msgContainer.scrollHeight;

    // Навешиваем клик на кнопки скачивания медиа
    msgContainer.querySelectorAll('.media-download-btn').forEach(btn => {
      btn.onclick = async (e) => {
        e.preventDefault();
        const msgId = btn.dataset.msgId;
        const mediaType = btn.dataset.mediaType;
        const filename = btn.dataset.filename;
        const placeholder = document.getElementById(`media-placeholder-${msgId}`);
        if (!placeholder) return;

        placeholder.innerHTML = `<div style="display:flex;align-items:center;gap:8px;padding:8px;font-size:12px;color:var(--text-muted);"><div class="spinner" style="width:14px;height:14px;"></div> Скачивание из Telegram...</div>`;

        try {
          const res = await accountsApi.downloadMedia(id, chatId, msgId);
          if (!res.ok || !res.url) {
            throw new Error('Ошибка загрузки');
          }

          if (mediaType === 'photo') {
            placeholder.innerHTML = `<img src="${res.url}" style="max-width: 100%; max-height: 250px; border-radius: 8px; margin-bottom: 6px; display: block;">`;
          } else if (mediaType === 'video') {
            placeholder.innerHTML = `<video src="${res.url}" controls style="max-width: 100%; max-height: 250px; border-radius: 8px; margin-bottom: 6px; display: block;"></video>`;
          } else if (mediaType === 'voice' || mediaType === 'audio') {
            placeholder.innerHTML = `<audio src="${res.url}" controls style="max-width: 100%; margin-bottom: 6px; display: block;"></audio>`;
          } else {
            placeholder.innerHTML = `<a href="${res.url}" download class="media-download-link" style="display:flex;align-items:center;gap:8px;padding:8px;background:rgba(255,255,255,0.05);border-radius:6px;margin-bottom:6px;font-size:12px;"><span style="font-size:20px;">📁</span> <div style="min-width:0;flex:1;"><div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${filename || 'Файл'}</div><div style="font-size:10px;opacity:0.6;">Файл скачан</div></div></a>`;
          }
          msgContainer.scrollTop = msgContainer.scrollHeight;
        } catch (err) {
          app.toast('Ошибка скачивания: ' + err.message, 'error');
          placeholder.innerHTML = `
            <div style="color:var(--red);font-size:11px;margin-bottom:4px;">Ошибка. Попробуйте еще раз.</div>
            <button class="btn btn-secondary btn-sm media-download-btn" data-msg-id="${msgId}" data-media-type="${mediaType}" data-filename="${filename}" style="width:100%;display:flex;align-items:center;gap:8px;justify-content:center;padding:8px;border-radius:6px;margin-bottom:6px;font-size:12px;cursor:pointer;background:rgba(255,255,255,0.1);color:var(--text-primary);">
              <span>📁</span> Повторить скачивание
            </button>
          `;
          placeholder.querySelector('.media-download-btn').onclick = btn.onclick;
        }
      };
    });

    // Активируем инпут
    const inp = document.getElementById('chat-message-input');
    const sendBtn = document.getElementById('chat-send-btn');
    if (inp && sendBtn) {
      inp.removeAttribute('disabled');
      sendBtn.removeAttribute('disabled');
      inp.focus();

      const sendMsgFn = async () => {
        const text = inp.value.trim();
        if (!text) return;
        
        inp.disabled = true;
        sendBtn.disabled = true;

        try {
          await accountsApi.sendMessage(id, chatId, text);
          inp.value = '';
          const freshRes = await accountsApi.chatMessages(id, chatId);
          if (freshRes.ok && freshRes.messages) {
            renderMessages(freshRes.messages, chatName, chatUsername, chatId);
          }
        } catch (e) {
          app.toast('Ошибка отправки: ' + e.message, 'error');
        } finally {
          inp.disabled = false;
          sendBtn.disabled = false;
          inp.focus();
        }
      };

      sendBtn.onclick = sendMsgFn;
      inp.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          sendMsgFn();
        }
      };
    }
  }

  // Генератор цвета для аватарок
  function strColor(str) {
    const colors = [
      '#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed', '#db2777', '#0d9488', '#4f46e5'
    ];
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }
}

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
