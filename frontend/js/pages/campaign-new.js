/**
 * pages/campaign-new.js — Создание / редактирование кампании.
 * Полноценный конструктор: выбор шаблона, аккаунтов, настройки, управление получателями.
 */
import { campaignsApi, templatesApi, accountsApi } from '../api.js';

export async function renderCampaignNew(app, params = {}) {
  const content = document.getElementById('page-content');
  const topbarActions = document.getElementById('topbar-actions');
  const campaignId = params.id || null;

  topbarActions.innerHTML = `<button class="btn btn-ghost btn-sm" id="btn-back">Назад</button>`;
  document.getElementById('btn-back').onclick = () => app.navigate('campaigns');

  // Загружаем данные параллельно
  let campaign = null, templates = [], accounts = [], recipients = [];
  try {
    [templates, accounts] = await Promise.all([templatesApi.list(), accountsApi.list()]);
    if (campaignId) {
      [campaign, recipients] = await Promise.all([
        campaignsApi.get(campaignId),
        campaignsApi.getRecipients(campaignId),
      ]);
    }
  } catch (e) {
    app.toast('Ошибка загрузки: ' + e.message, 'error');
  }

  const isEdit = !!campaign;
  const selectedAccounts = new Set(campaign?.account_ids || []);

  content.innerHTML = `
    <div style="max-width:900px;margin:0 auto">
      <div style="font-size:20px;font-weight:700;margin-bottom:4px">
        ${isEdit ? campaign.name : 'Новая кампания'}
      </div>
      <div class="text-sm text-muted" style="margin-bottom:24px">
        ${isEdit ? `ID: ${campaignId} · Статус: ${campaign.status}` : 'Настрой кампанию рассылки'}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">

        <!-- Основные настройки -->
        <div class="card">
          <div class="card-title" style="margin-bottom:16px">Основные настройки</div>

          <div class="form-group">
            <label class="form-label">Название кампании</label>
            <input class="form-input" id="camp-name" value="${campaign?.name || ''}" placeholder="Моя рассылка">
          </div>

          <div class="form-group">
            <label class="form-label">Шаблон сообщения</label>
            <select class="form-select" id="camp-template">
              <option value="">— выбери шаблон —</option>
              ${templates.map(t => `
                <option value="${t.id}" ${campaign?.template_id === t.id ? 'selected' : ''}>
                  ${t.name}
                </option>
              `).join('')}
            </select>
          </div>

          <!-- Предпросмотр шаблона -->
          <div id="template-preview-box" style="display:${campaign?.template_id ? 'block' : 'none'}">
            <div class="code-preview" id="template-preview-text" style="font-family:inherit;font-size:12px;max-height:80px;overflow:hidden;margin-bottom:12px">
              ${templates.find(t => t.id === campaign?.template_id)?.content || ''}
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div class="form-group">
              <label class="form-label">Задержка мин (сек)</label>
              <input class="form-input" id="camp-delay-min" type="number" value="${campaign?.delay_min || 5}" min="1">
            </div>
            <div class="form-group">
              <label class="form-label">Задержка макс (сек)</label>
              <input class="form-input" id="camp-delay-max" type="number" value="${campaign?.delay_max || 15}" min="1">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Лимит сообщений в день (на аккаунт)</label>
            <input class="form-input" id="camp-daily-limit" type="number" value="${campaign?.daily_limit || 50}" min="1">
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div class="form-group">
              <label class="form-label">Время старта (HH:MM)</label>
              <input class="form-input" id="camp-start-time" type="time" value="${campaign?.schedule_start || ''}">
              <div class="form-hint">Пусто = сразу</div>
            </div>
            <div class="form-group">
              <label class="form-label">Время остановки (HH:MM)</label>
              <input class="form-input" id="camp-end-time" type="time" value="${campaign?.schedule_end || ''}">
            </div>
          </div>

          <div class="form-group" style="margin-top: 14px;">
            <label class="toggle-wrap" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center;">
              <div>
                <div style="font-size:13px;font-weight:600">Циклическая рассылка</div>
                <div class="text-xs text-muted">Повторять отправку по кругу бесконечно</div>
              </div>
              <div class="toggle">
                <input type="checkbox" id="camp-is-looped" ${campaign?.is_looped ? 'checked' : ''}>
                <div class="toggle-track"></div>
                <div class="toggle-thumb"></div>
              </div>
            </label>
          </div>
          <div class="form-group" id="camp-loop-delay-wrap" style="display:${campaign?.is_looped ? 'block' : 'none'}; margin-top: 10px;">
            <label class="form-label">Пауза между кругами (минут)</label>
            <input class="form-input" id="camp-loop-delay" type="number" value="${campaign?.loop_delay || 60}" min="1">
          </div>
        </div>

        <!-- Аккаунты -->
        <div class="card">
          <div class="card-title" style="margin-bottom:12px">Аккаунты-отправители</div>
          ${accounts.length === 0 ? `
            <div class="empty-state" style="padding:20px">
              <div class="empty-state-icon" style="font-size:28px"></div>
              <div class="empty-state-title">Нет аккаунтов</div>
              <button class="btn btn-sm btn-primary" onclick="app.navigate('accounts')">Добавить</button>
            </div>
          ` : `
            <div style="display:flex;flex-direction:column;gap:8px;max-height:340px;overflow-y:auto" id="account-selector">
              ${accounts.map(acc => {
                const name = [acc.first_name, acc.last_name].filter(Boolean).join(' ') || acc.phone;
                const checked = selectedAccounts.has(acc.id);
                const isActive = acc.status === 'active';
                return `
                  <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg-elevated);border-radius:var(--r-md);cursor:pointer;border:1px solid ${checked ? 'var(--accent)' : 'var(--border)'};transition:border-color 0.15s" class="acc-label">
                    <input type="checkbox" class="acc-checkbox" data-id="${acc.id}" ${checked ? 'checked' : ''} ${!isActive ? 'disabled' : ''} style="display:none">
                    <div style="width:10px;height:10px;border-radius:50%;border:2px solid ${checked ? 'var(--accent)' : 'var(--border)'};background:${checked ? 'var(--accent)' : 'transparent'};flex-shrink:0;transition:all 0.15s" class="acc-check-dot"></div>
                    <div class="account-avatar" style="width:30px;height:30px;font-size:11px;flex-shrink:0;background:linear-gradient(135deg,var(--accent),var(--teal))">
                      ${name[0]?.toUpperCase() || '?'}
                    </div>
                    <div style="flex:1;min-width:0">
                      <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${name}</div>
                      <div class="text-xs text-muted">${acc.phone}</div>
                    </div>
                    <span class="badge badge-${acc.status}" style="font-size:9px">${acc.status === 'active' ? 'OK' : acc.status}</span>
                  </label>
                `;
              }).join('')}
            </div>
            <div class="text-xs text-muted" style="margin-top:8px" id="selected-count">
              Выбрано: ${selectedAccounts.size} аккаунт(ов)
            </div>
          `}
        </div>
      </div>

      <!-- Получатели -->
      ${isEdit ? `
      <div class="card" style="margin-bottom:16px">
        <div class="card-header" style="margin-bottom:12px">
          <div class="card-title">Получатели</div>
          <div class="flex gap-8">
            <span class="badge badge-active">${recipients.length} добавлено</span>
          </div>
        </div>

        <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" id="btn-add-manual">Добавить вручную</button>
          <button class="btn btn-secondary btn-sm" id="btn-add-from-account">Из чатов аккаунта</button>
          <button class="btn btn-secondary btn-sm" id="btn-upload-file">Загрузить файл (TXT/CSV)</button>
          <input type="file" id="recipients-file" accept=".txt,.csv" style="display:none">
          <div style="flex:1"></div>
          <select class="form-select" id="filter-status" style="width:auto;padding:6px 28px 6px 10px;font-size:12px">
            <option value="">Все статусы</option>
            <option value="pending">Ожидают</option>
            <option value="sent">Отправлено</option>
            <option value="failed">Ошибка</option>
            <option value="blocked">Заблокированы</option>
          </select>
        </div>

        <div class="table-wrap">
          <table id="recipients-table">
            <thead>
              <tr>
                <th>Получатель</th>
                <th>Статус</th>
                <th>Отправлено</th>
                <th>Ошибка</th>
                <th style="width:40px"></th>
              </tr>
            </thead>
            <tbody id="recipients-tbody">
              ${renderRecipientsRows(recipients)}
            </tbody>
          </table>
        </div>
        ${recipients.length === 0 ? `
          <div class="empty-state" style="padding:30px">
            <div class="empty-state-icon" style="font-size:32px"></div>
            <div class="empty-state-title">Нет получателей</div>
            <div class="empty-state-text">Добавь получателей вручную или загрузи файл</div>
          </div>
        ` : ''}
      </div>
      ` : ''}

      <!-- Сохранить -->
      <div class="flex gap-8" style="justify-content:flex-end">
        <button class="btn btn-secondary" id="btn-cancel-camp">Отмена</button>
        <button class="btn btn-primary" id="btn-save-camp">
          ${isEdit ? 'Сохранить изменения' : 'Создать кампанию'}
        </button>
      </div>
    </div>
  `;

  // ─── Template preview ────────────────────────────────────────
  document.getElementById('camp-template').addEventListener('change', (e) => {
    const t = templates.find(t => t.id === parseInt(e.target.value));
    const box = document.getElementById('template-preview-box');
    const text = document.getElementById('template-preview-text');
    if (t) {
      box.style.display = 'block';
      text.textContent = t.content;
    } else {
      box.style.display = 'none';
    }
  });

  // ─── Account checkboxes ───────────────────────────────────────
  document.querySelectorAll('.acc-label').forEach(label => {
    label.addEventListener('click', () => {
      const checkbox = label.querySelector('.acc-checkbox');
      if (checkbox.disabled) return;
      checkbox.checked = !checkbox.checked;
      const dot = label.querySelector('.acc-check-dot');
      if (checkbox.checked) {
        selectedAccounts.add(parseInt(checkbox.dataset.id));
        label.style.borderColor = 'var(--accent)';
        dot.style.background = 'var(--accent)';
        dot.style.borderColor = 'var(--accent)';
      } else {
        selectedAccounts.delete(parseInt(checkbox.dataset.id));
        label.style.borderColor = 'var(--border)';
        dot.style.background = 'transparent';
        dot.style.borderColor = 'var(--border)';
      }
      document.getElementById('selected-count').textContent = `Выбрано: ${selectedAccounts.size} аккаунт(ов)`;
    });
  });

  // ─── Recipients management (edit mode) ───────────────────────
  if (isEdit) {
    document.getElementById('btn-add-manual').addEventListener('click', () => {
      showAddRecipientsModal(app, campaignId, () => reloadRecipients());
    });

    document.getElementById('btn-upload-file').addEventListener('click', () => {
      document.getElementById('recipients-file').click();
    });

    document.getElementById('btn-add-from-account').addEventListener('click', () => {
      // Кандидаты — выбранные для кампании аккаунты, иначе все
      const pickFrom = accounts.filter(a =>
        selectedAccounts.size ? selectedAccounts.has(a.id) : true
      );
      if (pickFrom.length === 0) {
        app.toast('Сначала выбери аккаунт для кампании', 'warn');
        return;
      }
      showFromAccountModal(app, campaignId, pickFrom, () => reloadRecipients());
    });

    document.getElementById('recipients-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const res = await campaignsApi.uploadRecipients(campaignId, file);
        app.toast(`Добавлено ${res.added} получателей`, 'success');
        reloadRecipients();
      } catch (err) { app.toast('Ошибка: ' + err.message, 'error'); }
    });

    document.getElementById('filter-status').addEventListener('change', async (e) => {
      const filtered = await campaignsApi.getRecipients(campaignId, e.target.value ? { status: e.target.value } : {});
      document.getElementById('recipients-tbody').innerHTML = renderRecipientsRows(filtered);
      bindDeleteBtns();
    });

    const reloadRecipients = async () => {
      const all = await campaignsApi.getRecipients(campaignId);
      document.getElementById('recipients-tbody').innerHTML = renderRecipientsRows(all);
      document.querySelector('.badge-active').textContent = `${all.length} добавлено`;
      bindDeleteBtns();
    };

    const bindDeleteBtns = () => {
      document.querySelectorAll('.rec-delete-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          await campaignsApi.deleteRecipient(campaignId, parseInt(btn.dataset.id));
          reloadRecipients();
        });
      });
    };
    bindDeleteBtns();
  }

  // Loop delay toggle
  document.getElementById('camp-is-looped').addEventListener('change', (e) => {
    document.getElementById('camp-loop-delay-wrap').style.display = e.target.checked ? 'block' : 'none';
  });

  // ─── Save / Cancel ────────────────────────────────────────────
  document.getElementById('btn-cancel-camp').onclick = () => app.navigate('campaigns');

  document.getElementById('btn-save-camp').onclick = async () => {
    const btn = document.getElementById('btn-save-camp');
    const name = document.getElementById('camp-name').value.trim();
    const templateId = parseInt(document.getElementById('camp-template').value);
    const accountIds = [...selectedAccounts];

    if (!name)       { app.toast('Введи название', 'warn'); return; }
    if (!templateId) { app.toast('Выбери шаблон', 'warn'); return; }
    if (!accountIds.length) { app.toast('Выбери хотя бы один аккаунт', 'warn'); return; }

    const payload = {
      name,
      template_id:    templateId,
      account_ids:    accountIds,
      delay_min:      parseInt(document.getElementById('camp-delay-min').value) || 5,
      delay_max:      parseInt(document.getElementById('camp-delay-max').value) || 15,
      daily_limit:    parseInt(document.getElementById('camp-daily-limit').value) || 50,
      schedule_start: document.getElementById('camp-start-time').value || null,
      schedule_end:   document.getElementById('camp-end-time').value || null,
      is_looped:      document.getElementById('camp-is-looped').checked,
      loop_delay:     parseInt(document.getElementById('camp-loop-delay').value) || 60,
    };

    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Сохраняю...';
    try {
      if (isEdit) {
        await campaignsApi.update(campaignId, payload);
        app.toast('Кампания обновлена', 'success');
      } else {
        const res = await campaignsApi.create(payload);
        app.toast('Кампания создана', 'success');
        app.navigate('campaign-new', { id: res.id });
        return;
      }
    } catch (e) { app.toast('Ошибка: ' + e.message, 'error'); }
    btn.disabled = false;
    btn.textContent = isEdit ? 'Сохранить изменения' : 'Создать кампанию';
  };
}

function renderRecipientsRows(recipients) {
  const STATUS_MAP = {
    pending:  { label: 'Ожидает', cls: 'badge-inactive' },
    sent:     { label: 'Отправлено', cls: 'badge-completed' },
    failed:   { label: 'Ошибка', cls: 'badge-error' },
    blocked:  { label: 'Блок', cls: 'badge-spam' },
    skipped:  { label: 'Пропущен', cls: 'badge-paused' },
  };
  if (!recipients.length) return '';
  return recipients.map(r => {
    const s = STATUS_MAP[r.status] || { label: r.status, cls: '' };
    return `
      <tr>
        <td style="font-weight:500">${r.identifier}</td>
        <td><span class="badge ${s.cls}">${s.label}</span></td>
        <td class="text-xs text-muted">${r.sent_at ? new Date(r.sent_at).toLocaleString('ru') : '—'}</td>
        <td class="text-xs text-muted" style="max-width:150px;overflow:hidden;text-overflow:ellipsis">${r.error_message || '—'}</td>
        <td>
          <button class="btn btn-ghost btn-sm rec-delete-btn" data-id="${r.id}" title="Удалить">✕</button>
        </td>
      </tr>
    `;
  }).join('');
}

function showAddRecipientsModal(app, campaignId, onDone) {
  const { overlay, close } = app.modal({
    title: 'Добавить получателей',
    content: `
      <div class="form-group">
        <label class="form-label">Список получателей</label>
        <textarea class="form-textarea" id="rec-list" rows="8"
          placeholder="Введи каждого получателя на отдельной строке:&#10;@username&#10;+79001234567&#10;@another_user"></textarea>
        <div class="form-hint">Username (@...) или номер телефона (+7...) — по одному на строку</div>
      </div>
    `,
    footer: `
      <button class="btn btn-secondary" id="rec-cancel">Отмена</button>
      <button class="btn btn-primary" id="rec-add">Добавить</button>
    `,
  });

  overlay.querySelector('#rec-cancel').onclick = close;
  overlay.querySelector('#rec-add').onclick = async () => {
    const btn = overlay.querySelector('#rec-add');
    const text = overlay.querySelector('#rec-list').value;
    const identifiers = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (!identifiers.length) { app.toast('Список пустой', 'warn'); return; }

    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    try {
      const res = await campaignsApi.addRecipients(campaignId, { identifiers });
      app.toast(`Добавлено ${res.added} получателей`, 'success');
      close();
      if (onDone) onDone();
    } catch (e) { app.toast('Ошибка: ' + e.message, 'error'); }
    btn.disabled = false;
  };
}

// Добавление получателей из чатов конкретного аккаунта (папки/группы)
function showFromAccountModal(app, campaignId, accountsList, onDone) {
  const { overlay, close } = app.modal({
    title: 'Получатели из чатов аккаунта',
    content: `
      <div class="form-group">
        <label class="form-label">Аккаунт</label>
        <select class="form-select" id="from-acc-select" style="width:100%">
          ${accountsList.map(a => `<option value="${a.id}">${(a.phone || '')}${a.first_name ? ' — ' + a.first_name : ''}</option>`).join('')}
        </select>
        <div class="form-hint">В получатели попадут все группы/каналы, где состоит аккаунт — включая чаты из папок, куда он вступил.</div>
      </div>
    `,
    footer: `
      <button class="btn btn-secondary" id="fa-cancel">Отмена</button>
      <button class="btn btn-primary" id="fa-add">Добавить</button>
    `,
  });

  overlay.querySelector('#fa-cancel').onclick = close;
  overlay.querySelector('#fa-add').onclick = async () => {
    const btn = overlay.querySelector('#fa-add');
    const accId = parseInt(overlay.querySelector('#from-acc-select').value);
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    try {
      const res = await campaignsApi.addRecipientsFromAccount(campaignId, accId);
      app.toast(`Добавлено получателей: ${res.added} (из ${res.total_chats} чатов)`, 'success');
      close();
      if (onDone) onDone();
    } catch (e) {
      app.toast('Ошибка: ' + e.message, 'error');
      btn.disabled = false; btn.textContent = 'Добавить';
    }
  };
}
