/**
 * pages/joins.js — Управление общей базой чатов, их распределением
 * и мониторинг авто-вступлений.
 */
import { joinsApi, accountsApi } from '../api.js?v=15';

export async function renderJoins(app) {
  const content = document.getElementById('page-content');
  const topbarActions = document.getElementById('topbar-actions');

  topbarActions.innerHTML = ''; // Очистим действия в шапке

  content.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <div>
        <div style="font-size:20px;font-weight:700">Авто-вступление в чаты</div>
        <div class="text-sm text-muted">Управляй общей базой чатов и очередями вступления</div>
      </div>
    </div>

    <!-- Табы -->
    <div class="details-tabs">
      <button class="details-tab-btn active" data-tab="global-base">📁 Общая база чатов</button>
      <button class="details-tab-btn" data-tab="monitoring">🤖 Мониторинг вступлений</button>
    </div>

    <!-- Контент табов -->
    <div id="joins-tab-content"></div>
  `;

  // Переключение табов
  const tabBtns = content.querySelectorAll('.details-tab-btn');
  tabBtns.forEach(btn => {
    btn.onclick = () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      if (tab === 'global-base') {
        renderGlobalBaseTab(app);
      } else {
        renderMonitoringTab(app);
      }
    };
  });

  // Дефолтный таб
  renderGlobalBaseTab(app);
}

// ─── Вкладка: Общая база чатов ──────────────────────────────────────────────

async function renderGlobalBaseTab(app) {
  const container = document.getElementById('joins-tab-content');
  container.innerHTML = `<div style="text-align:center;padding:40px"><span class="spinner"></span> Загрузка базы...</div>`;

  let globalChats = [];
  try {
    globalChats = await joinsApi.getGlobal();
  } catch (e) {
    app.toast('Ошибка загрузки базы чатов: ' + e.message, 'error');
  }

  container.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(320px, 1fr));gap:20px;align-items:start">
      <!-- Панель добавления -->
      <div class="card" style="padding:16px">
        <div style="font-weight:700;margin-bottom:12px;font-size:14px">📥 Добавить ссылки</div>
        <div class="form-group" style="margin-bottom:12px">
          <label class="form-label" style="font-size:11px">Список ссылок (по одной на строку)</label>
          <textarea class="form-textarea" id="add-links-input" rows="8" style="font-size:12px" placeholder="https://t.me/chat_name&#10;@another_chat&#10;t.me/+hash_code&#10;https://t.me/addlist/aSGFhI8MaFE3YzQ8"></textarea>
          <div class="form-hint" style="font-size:11px">Можно добавлять папки (t.me/addlist/...) — они сохранятся папкой целиком, а их чаты подтянутся автоматически.</div>
        </div>
        <button class="btn btn-primary" id="btn-add-global-links" style="width:100%">Добавить в базу</button>
      </div>

      <!-- Список базы -->
      <div class="card" style="padding:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px">
          <div style="font-weight:700;font-size:14px">📁 База чатов (${globalChats.length})</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            ${globalChats.length > 0 ? `
              <button class="btn btn-secondary btn-sm" id="btn-clear-global-base" style="color:var(--red)">🗑 Очистить базу</button>
              <button class="btn btn-primary btn-sm" id="btn-distribute-modal">🤖 Распределить по аккаунтам</button>
            ` : ''}
          </div>
        </div>

        ${globalChats.length === 0 ? `
          <div style="text-align:center;padding:40px;color:var(--text-muted);font-size:13px">
            Общая база пуста. Добавь ссылки слева.
          </div>
        ` : `
          <div style="max-height:450px;overflow:auto;border:1px solid var(--border);border-radius:var(--r-md)">
            <table class="table" style="font-size:12px">
              <thead>
                <tr>
                  <th style="width:50px">#</th>
                  <th>Ссылка</th>
                  <th style="width:140px">Добавлен</th>
                  <th style="width:50px"></th>
                </tr>
              </thead>
              <tbody>
                ${globalChats.map((c, idx) => `
                  <tr>
                    <td>${idx + 1}</td>
                    <td style="font-family:monospace">
                      ${c.is_folder ? `
                        <span class="badge badge-active" style="font-size:10px">📁 Папка</span>
                        <div style="margin-top:2px">${escHtml(c.folder_title || 'Папка')}
                          <span class="text-muted">(${c.folder_chats_count ?? 0} чат.)</span></div>
                        <button class="btn btn-ghost btn-sm btn-toggle-folder" data-slug="${escHtml(c.folder_slug)}"
                                style="padding:0;font-size:11px;color:var(--accent)">▸ Показать чаты</button>
                        <div class="folder-chats" data-slug="${escHtml(c.folder_slug)}" style="display:none;margin-top:6px"></div>
                        <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${escHtml(c.chat_link)}</div>
                      ` : escHtml(c.chat_link)}
                    </td>
                    <td class="text-muted">${new Date(c.created_at).toLocaleDateString('ru')} ${new Date(c.created_at).toLocaleTimeString('ru', {hour:'2-digit', minute:'2-digit'})}</td>
                    <td>
                      <button class="btn btn-ghost btn-sm btn-delete-global-chat" data-id="${c.id}" style="color:var(--red);padding:2px 6px">×</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    </div>
  `;

  // Обработчики
  container.querySelector('#btn-add-global-links').onclick = async () => {
    const textEl = container.querySelector('#add-links-input');
    const links = textEl.value.trim();
    if (!links) { app.toast('Введите ссылки для добавления', 'warn'); return; }

    try {
      const res = await joinsApi.addGlobal(links);
      app.toast(`Добавлено: ${res.added}` + (res.folders_read ? `, прочитано папок: ${res.folders_read}` : ''), 'success');
      textEl.value = '';
      renderGlobalBaseTab(app);
    } catch (e) {
      app.toast('Ошибка: ' + e.message, 'error');
    }
  };

  const btnClear = container.querySelector('#btn-clear-global-base');
  if (btnClear) {
    btnClear.onclick = async () => {
      const ok = await app.confirm('Вы действительно хотите очистить всю общую базу чатов?');
      if (!ok) return;
      try {
        await joinsApi.clearGlobal();
        app.toast('Общая база очищена', 'success');
        renderGlobalBaseTab(app);
      } catch (e) { app.toast('Ошибка: ' + e.message, 'error'); }
    };
  }

  container.querySelectorAll('.btn-delete-global-chat').forEach(btn => {
    btn.onclick = async () => {
      const id = parseInt(btn.dataset.id);
      try {
        await joinsApi.deleteGlobal(id);
        renderGlobalBaseTab(app);
      } catch (e) { app.toast('Ошибка: ' + e.message, 'error'); }
    };
  });

  // Разворачивание списка чатов внутри папки (ленивая загрузка)
  container.querySelectorAll('.btn-toggle-folder').forEach(btn => {
    btn.onclick = async () => {
      const slug = btn.dataset.slug;
      const box = container.querySelector(`.folder-chats[data-slug="${slug}"]`);
      if (!box) return;

      if (box.style.display !== 'none') {
        box.style.display = 'none';
        btn.textContent = '▸ Показать чаты';
        return;
      }

      btn.textContent = '▾ Скрыть чаты';
      box.style.display = 'block';
      if (box.dataset.loaded !== '1') {
        box.innerHTML = '<span class="spinner" style="width:12px;height:12px;border-width:2px"></span> Загрузка...';
        try {
          const res = await joinsApi.folderChats(slug);
          const chats = res.chats || [];
          box.dataset.loaded = '1';
          box.innerHTML = chats.length === 0
            ? '<div class="text-muted" style="font-size:11px">Список пуст. Нажми «Обновить», если есть подключённый аккаунт.</div>'
            : `<ul style="margin:0;padding-left:16px;font-size:11px">${chats.map(c => `
                <li>
                  ${c.username ? `<a href="https://t.me/${escHtml(c.username)}" target="_blank" style="color:var(--accent)">${escHtml(c.chat_title)}</a>` : escHtml(c.chat_title)}
                  <span class="text-muted">· ${c.chat_type === 'channel' ? 'канал' : 'группа'}${c.is_private ? ' · приватный' : ''}</span>
                </li>`).join('')}</ul>
              <button class="btn btn-ghost btn-sm btn-refresh-folder" data-link="${escHtml(res.folder?.link || '')}" style="padding:0;font-size:10px;color:var(--text-muted);margin-top:4px">🔄 Обновить состав</button>`;

          const rb = box.querySelector('.btn-refresh-folder');
          if (rb) rb.onclick = async () => {
            rb.textContent = 'Обновление...';
            try {
              await joinsApi.refreshFolder(rb.dataset.link);
              app.toast('Состав папки обновлён', 'success');
              renderGlobalBaseTab(app);
            } catch (e) { app.toast('Ошибка: ' + e.message, 'error'); rb.textContent = '🔄 Обновить состав'; }
          };
        } catch (e) {
          box.innerHTML = `<div class="text-red" style="font-size:11px">Ошибка загрузки: ${escHtml(e.message)}</div>`;
        }
      }
    };
  });

  const btnDist = container.querySelector('#btn-distribute-modal');
  if (btnDist) {
    btnDist.onclick = () => showDistributeModal(app, globalChats.length);
  }
}

// ─── Модалка распределения общей базы ──────────────────────────────────────

async function showDistributeModal(app, totalLinks) {
  let accounts = [];
  try {
    accounts = await accountsApi.list();
    // Оставляем только активные аккаунты
    accounts = accounts.filter(a => a.status === 'active' && !a.is_spam_blocked);
  } catch (e) {
    app.toast('Не удалось загрузить список аккаунтов: ' + e.message, 'error');
    return;
  }

  if (accounts.length === 0) {
    app.toast('Нет активных аккаунтов для распределения', 'warn');
    return;
  }

  const { overlay, close } = app.modal({
    title: '🤖 Распределить базу чатов',
    content: `
      <div style="font-size:13px;margin-bottom:16px;color:var(--text-secondary)">
        Всего чатов в базе: <strong>${totalLinks}</strong>. Выбери аккаунты, по которым нужно распределить эти чаты:
      </div>

      <!-- Аккаунты -->
      <div class="form-group" style="max-height:180px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:8px;margin-bottom:16px">
        ${accounts.map(a => `
          <label style="display:flex;align-items:center;gap:8px;padding:6px;cursor:pointer;font-size:13px">
            <input type="checkbox" class="dist-acc-cb" value="${a.id}" checked>
            <span>${escHtml(a.phone)} (${escHtml(a.first_name || 'Без имени')})</span>
          </label>
        `).join('')}
      </div>

      <!-- Режим -->
      <div class="form-group">
        <label class="form-label">Режим распределения</label>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:6px">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px">
            <input type="radio" name="dist-mode" value="all" checked>
            <div>
              <strong>Всем аккаунтам одинаково</strong>
              <div style="font-size:11px;opacity:0.6">Каждый аккаунт получит всю базу чатов (${totalLinks} вступлений на каждый аккаунт)</div>
            </div>
          </label>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px">
            <input type="radio" name="dist-mode" value="split">
            <div>
              <strong>Разделить поровну</strong>
              <div style="font-size:11px;opacity:0.6">База будет разделена поровну без пересечений чатов (например, по ~${Math.ceil(totalLinks / accounts.length)} чатов на аккаунт)</div>
            </div>
          </label>
        </div>
      </div>
    `,
    footer: `
      <button class="btn btn-secondary" id="btn-dist-cancel">Отмена</button>
      <button class="btn btn-primary" id="btn-dist-apply">Применить</button>
    `
  });

  overlay.querySelector('#btn-dist-cancel').onclick = close;

  overlay.querySelector('#btn-dist-apply').onclick = async () => {
    const checkedCbs = overlay.querySelectorAll('.dist-acc-cb:checked');
    const accountIds = Array.from(checkedCbs).map(cb => parseInt(cb.value));
    const mode = overlay.querySelector('input[name="dist-mode"]:checked').value;

    if (accountIds.length === 0) {
      app.toast('Выбери хотя бы один аккаунт', 'warn');
      return;
    }

    const btn = overlay.querySelector('#btn-dist-apply');
    btn.disabled = true;
    btn.textContent = 'Распределение...';

    try {
      const res = await joinsApi.distribute(accountIds, mode);
      app.toast(`Успешно распределено вступлений: ${res.distributed}`, 'success');
      close();
    } catch (e) {
      app.toast('Ошибка распределения: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Применить';
    }
  };
}

// ─── Вкладка: Мониторинг вступлений ─────────────────────────────────────────

async function renderMonitoringTab(app) {
  const container = document.getElementById('joins-tab-content');
  container.innerHTML = `<div style="text-align:center;padding:40px"><span class="spinner"></span> Загрузка мониторинга...</div>`;

  let accounts = [];
  try {
    accounts = await accountsApi.list();
    // Оставляем только активные аккаунты
    accounts = accounts.filter(a => a.status === 'active' && !a.is_spam_blocked);
  } catch (e) {
    app.toast('Ошибка загрузки аккаунтов: ' + e.message, 'error');
    return;
  }

  if (accounts.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:13px">Нет активных аккаунтов для отображения мониторинга.</div>`;
    return;
  }

  // Подгрузим детальные статусы очередей по каждому аккаунту
  const accountsData = [];
  for (const acc of accounts) {
    try {
      const details = await accountsApi.getJoins(acc.id);
      const pendingCount = details.joins.filter(j => j.status === 'pending').length;
      const joinedCount = details.joins.filter(j => j.status === 'joined').length;
      const failedCount = details.joins.filter(j => j.status === 'failed').length;
      const totalCount = details.joins.length;

      accountsData.push({
        acc,
        is_running: details.is_running,
        stats: { pendingCount, joinedCount, failedCount, totalCount }
      });
    } catch (e) {
      // Пропускаем ошибки по конкретному аккаунту
    }
  }

  container.innerHTML = `
    <div class="card" style="padding:16px">
      <div style="font-weight:700;margin-bottom:16px;font-size:14px">🤖 Мониторинг задач авто-вступления</div>
      <div class="table-wrap">
        <table class="table" style="font-size:13px">
          <thead>
            <tr>
              <th>Аккаунт</th>
              <th>Состояние воркера</th>
              <th>Всего в очереди</th>
              <th>Прогресс</th>
              <th style="width:280px">Действия</th>
            </tr>
          </thead>
          <tbody>
            ${accountsData.map(d => {
              const acc = d.acc;
              const stats = d.stats;
              const percentage = stats.totalCount > 0 ? Math.round((stats.joinedCount / stats.totalCount) * 100) : 0;
              return `
                <tr>
                  <td>
                    <strong>${escHtml(acc.phone)}</strong>
                    <div style="font-size:11px;opacity:0.6">${escHtml(acc.first_name || 'Без имени')}</div>
                  </td>
                  <td>
                    ${d.is_running ? `
                      <span class="badge badge-active" style="display:inline-flex;align-items:center;gap:6px">
                        <span class="spinner" style="width:10px;height:10px;border-width:2px"></span> Выполняется
                      </span>
                    ` : `
                      <span class="badge" style="background:var(--bg-elevated);color:var(--text-muted)">Остановлен</span>
                    `}
                  </td>
                  <td><strong>${stats.totalCount}</strong></td>
                  <td>
                    <div style="display:flex;align-items:center;gap:8px">
                      <div style="flex:1;height:6px;background:var(--border);border-radius:3px;min-width:80px;overflow:hidden">
                        <div style="height:100%;background:var(--accent);width:${percentage}%"></div>
                      </div>
                      <span style="font-size:11px;font-weight:700">${stats.joinedCount} из ${stats.totalCount} (${percentage}%)</span>
                    </div>
                    <div style="font-size:10px;opacity:0.7;margin-top:2px">
                      Ожидает: ${stats.pendingCount} &nbsp;·&nbsp; Ошибки: ${stats.failedCount}
                    </div>
                  </td>
                  <td>
                    <div style="display:flex;gap:6px">
                      <button class="btn btn-secondary btn-sm btn-joins-edit" data-id="${acc.id}">Очередь</button>
                      ${d.is_running ? `
                        <button class="btn btn-danger btn-sm btn-joins-stop" data-id="${acc.id}">Остановить</button>
                      ` : `
                        <button class="btn btn-primary btn-sm btn-joins-start" data-id="${acc.id}">▶ Запустить</button>
                      `}
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Обработчики мониторинга
  container.querySelectorAll('.btn-joins-start').forEach(btn => {
    btn.onclick = async () => {
      const id = parseInt(btn.dataset.id);
      // Покажем мини-диалог настроек
      const delayMin = 30;
      const delayMax = 60;
      try {
        await accountsApi.startJoins(id, delayMin, delayMax);
        app.toast('Авто-вступление запущено', 'success');
        renderMonitoringTab(app);
      } catch (e) {
        app.toast('Ошибка: ' + e.message, 'error');
      }
    };
  });

  container.querySelectorAll('.btn-joins-stop').forEach(btn => {
    btn.onclick = async () => {
      const id = parseInt(btn.dataset.id);
      try {
        await accountsApi.stopJoins(id);
        app.toast('Авто-вступление остановлено', 'success');
        renderMonitoringTab(app);
      } catch (e) {
        app.toast('Ошибка: ' + e.message, 'error');
      }
    };
  });

  container.querySelectorAll('.btn-joins-edit').forEach(btn => {
    btn.onclick = () => {
      const id = parseInt(btn.dataset.id);
      showAccountQueueModal(app, id);
    };
  });
}

// ─── Очередь конкретного аккаунта (Модалка) ────────────────────────────────

async function showAccountQueueModal(app, accountId) {
  let details = null;
  try {
    details = await accountsApi.getJoins(accountId);
  } catch (e) {
    app.toast('Ошибка: ' + e.message, 'error');
    return;
  }

  const { overlay, close } = app.modal({
    title: `📋 Очередь аккаунта #${accountId}`,
    content: `
      <div class="form-group" style="margin-bottom:16px">
        <label class="form-label">Добавить ссылки в очередь аккаунта</label>
        <textarea class="form-textarea" id="acc-links-input" rows="4" style="font-size:12px" placeholder="t.me/chat_name\nt.me/+invite_hash"></textarea>
        <button class="btn btn-secondary btn-sm" id="btn-acc-links-add" style="margin-top:8px">Добавить в очередь</button>
      </div>

      <div style="font-weight:700;font-size:13px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between">
        <span>Список очереди (${details.joins.length})</span>
        ${details.joins.length > 0 ? `<button class="btn btn-ghost btn-sm" id="btn-acc-queue-clear" style="color:var(--red);padding:2px 6px">🗑 Очистить</button>` : ''}
      </div>

      <div style="max-height:220px;overflow-y:auto;border:1px solid var(--border);border-radius:6px">
        ${details.joins.length === 0 ? `
          <div style="text-align:center;padding:20px;color:var(--text-muted);font-size:12px">Очередь пуста</div>
        ` : `
          <table class="table" style="font-size:11px">
            <thead>
              <tr>
                <th>Ссылка</th>
                <th>Статус</th>
                <th>Ошибка / Вход</th>
              </tr>
            </thead>
            <tbody>
              ${details.joins.map(j => `
                <tr>
                  <td style="font-family:monospace">${escHtml(j.chat_link)}</td>
                  <td>
                    ${j.status === 'joined' ? '<span class="text-green" style="font-weight:bold">Вступил</span>' : ''}
                    ${j.status === 'pending' ? '<span class="text-muted">Ожидает</span>' : ''}
                    ${j.status === 'joining' ? '<span class="text-accent spinner" style="width:10px;height:10px;border-width:2px"></span>' : ''}
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
        `}
      </div>
    `,
    footer: `<button class="btn btn-secondary" id="btn-acc-queue-close">Закрыть</button>`
  });

  overlay.querySelector('#btn-acc-queue-close').onclick = close;

  // Кнопка добавления в очередь
  overlay.querySelector('#btn-acc-links-add').onclick = async () => {
    const input = overlay.querySelector('#acc-links-input');
    const text = input.value.trim();
    if (!text) return;
    try {
      await accountsApi.addJoins(accountId, text);
      app.toast('Добавлено в очередь аккаунта', 'success');
      close();
      showAccountQueueModal(app, accountId);
    } catch (e) {
      app.toast('Ошибка: ' + e.message, 'error');
    }
  };

  // Кнопка очистки очереди
  const btnClear = overlay.querySelector('#btn-acc-queue-clear');
  if (btnClear) {
    btnClear.onclick = async () => {
      try {
        await accountsApi.clearJoins(accountId);
        app.toast('Очередь аккаунта очищена', 'success');
        close();
        showAccountQueueModal(app, accountId);
      } catch (e) {
        app.toast('Ошибка: ' + e.message, 'error');
      }
    };
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
