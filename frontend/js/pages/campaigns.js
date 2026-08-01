/**
 * pages/campaigns.js — Список кампаний рассылки.
 */
import { campaignsApi } from '../api.js';

const STATUS_MAP = {
  draft:     { label: 'Черновик',  cls: 'badge-draft' },
  running:   { label: 'Запущена',  cls: 'badge-running' },
  paused:    { label: 'Пауза',     cls: 'badge-paused' },
  completed: { label: 'Завершена', cls: 'badge-completed' },
  stopped:   { label: 'Остановлена', cls: 'badge-stopped' },
};

export async function renderCampaigns(app) {
  const content = document.getElementById('page-content');
  const topbarActions = document.getElementById('topbar-actions');

  topbarActions.innerHTML = `<button class="btn btn-primary" id="btn-new-campaign">Новая кампания</button>`;

  let campaigns = [];
  try {
    campaigns = await campaignsApi.list();
  } catch (e) {
    app.toast('Ошибка загрузки: ' + e.message, 'error');
  }

  content.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <div>
        <div style="font-size:20px;font-weight:700">Кампании рассылки</div>
        <div class="text-sm text-muted">${campaigns.length} кампани(й)</div>
      </div>
    </div>

    ${campaigns.length === 0 ? `
      <div class="empty-state">
        <div class="empty-state-icon"></div>
        <div class="empty-state-title">Нет кампаний</div>
        <div class="empty-state-text">Создай кампанию рассылки — выбери аккаунты, шаблон и получателей</div>
        <button class="btn btn-primary" id="btn-new-empty">Создать кампания</button>
      </div>
    ` : `
      <div style="display:flex;flex-direction:column;gap:12px">
        ${campaigns.map(c => renderCampaignRow(c)).join('')}
      </div>
    `}
  `;

  document.getElementById('btn-new-campaign')?.addEventListener('click', () => app.navigate('campaign-new'));
  document.getElementById('btn-new-empty')?.addEventListener('click', () => app.navigate('campaign-new'));

  // Кнопки действий по каждой кампании
  document.querySelectorAll('.camp-open-btn').forEach(btn => {
    btn.addEventListener('click', () => app.navigate('campaign-new', { id: parseInt(btn.dataset.id) }));
  });

  document.querySelectorAll('.camp-start-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      try {
        await campaignsApi.start(id);
        app.toast('Кампания запущена', 'success');
        renderCampaigns(app);
      } catch (err) { app.toast('Ошибка: ' + err.message, 'error'); }
    });
  });

  document.querySelectorAll('.camp-stop-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      try {
        await campaignsApi.stop(id);
        app.toast('Кампания остановлена', 'warn');
        renderCampaigns(app);
      } catch (err) { app.toast('Ошибка: ' + err.message, 'error'); }
    });
  });

  document.querySelectorAll('.camp-pause-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      try {
        await campaignsApi.pause(id);
        app.toast('Кампания на паузе', 'info');
        renderCampaigns(app);
      } catch (err) { app.toast('Ошибка: ' + err.message, 'error'); }
    });
  });

  document.querySelectorAll('.camp-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      const ok = await app.confirm('Удалить кампанию? Все данные о получателях будут потеряны.');
      if (!ok) return;
      try {
        await campaignsApi.delete(id);
        app.toast('Кампания удалена', 'success');
        renderCampaigns(app);
      } catch (err) { app.toast('Ошибка: ' + err.message, 'error'); }
    });
  });

  // Авто-обновление каждые 10 сек если есть запущенные
  if (campaigns.some(c => c.status === 'running')) {
    setTimeout(() => {
      // Проверяем что мы всё ещё на этой странице
      if (document.querySelector('.camp-start-btn')) renderCampaigns(app);
    }, 10_000);
  }
}

function renderCampaignRow(c) {
  const status = STATUS_MAP[c.status] || { label: c.status, cls: 'badge-inactive' };
  const totalRecipients = c.recipient_count || 0;
  const sent = c.total_sent || 0;
  const progress = totalRecipients > 0 ? Math.round((sent / totalRecipients) * 100) : 0;

  const isRunning = c.status === 'running';
  const isDraft = c.status === 'draft';
  const canStart = ['draft', 'paused', 'stopped'].includes(c.status);

  return `
    <div class="card" style="transition:border-color 0.15s">
      <div style="display:flex;align-items:center;gap:16px">
        <!-- Icon -->
        <div style="width:46px;height:46px;border-radius:var(--r-md);background:${isRunning ? 'var(--teal-dim)' : 'var(--accent-dim)'};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold;flex-shrink:0;color:var(--text-primary)">
          ${isRunning ? 'RUN' : isDraft ? 'DRF' : 'CMP'}
        </div>

        <!-- Info -->
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
            <div style="font-size:15px;font-weight:600">${c.name}</div>
            <span class="badge ${status.cls}">${status.label}</span>
            ${c.is_running ? '<span class="badge badge-running">LIVE</span>' : ''}
          </div>
          <div class="text-xs text-muted" style="margin-bottom:8px">
            Шаблон: ${c.template_name || 'Без шаблона'} ·
            Аккаунты: ${c.account_ids?.length || 0} ·
            Получатели: ${totalRecipients}
            ${c.schedule_start ? ` · Время: ${c.schedule_start}–${c.schedule_end}` : ''}
            ${c.daily_limit ? ` · Лимит: ${c.daily_limit}/день` : ''}
          </div>

          ${totalRecipients > 0 ? `
            <div style="display:flex;align-items:center;gap:10px">
              <div class="progress-bar-wrap" style="flex:1">
                <div class="progress-bar-fill" style="width:${progress}%"></div>
              </div>
              <div class="text-xs" style="color:var(--text-secondary);white-space:nowrap">
                ${sent}/${totalRecipients} (${progress}%)
              </div>
            </div>
            <div class="flex gap-12 mt-4">
              <span class="text-xs" style="color:var(--green)">Отправлено: ${c.total_sent}</span>
              <span class="text-xs" style="color:var(--red)">Ошибок: ${c.total_failed}</span>
              <span class="text-xs" style="color:var(--amber)">Блок: ${c.total_blocked}</span>
            </div>
          ` : `
            <div class="text-xs text-muted">Нет получателей — добавь перед запуском</div>
          `}
        </div>

        <!-- Actions -->
        <div class="flex gap-8" style="flex-shrink:0">
          ${canStart ? `<button class="btn btn-success btn-sm camp-start-btn" data-id="${c.id}">Запустить</button>` : ''}
          ${isRunning ? `<button class="btn btn-sm camp-pause-btn" data-id="${c.id}" style="background:var(--amber-dim);color:var(--amber)">Пауза</button>` : ''}
          ${isRunning ? `<button class="btn btn-danger btn-sm camp-stop-btn" data-id="${c.id}">Стоп</button>` : ''}
          <button class="btn btn-ghost btn-sm camp-open-btn" data-id="${c.id}">Открыть</button>
          <button class="btn btn-ghost btn-sm camp-delete-btn" data-id="${c.id}">Удалить</button>
        </div>
      </div>
    </div>
  `;
}
