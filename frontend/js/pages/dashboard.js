/**
 * pages/dashboard.js — Главная страница с аналитикой и статистикой.
 */
import { settingsApi, accountsApi } from '../api.js';

export async function renderDashboard(app) {
  const content = document.getElementById('page-content');

  let stats = { accounts: {}, campaigns: {}, messages: {}, templates: {} };
  let accounts = [];

  try {
    [stats, accounts] = await Promise.all([settingsApi.stats(), accountsApi.list()]);
  } catch (e) {
    app.toast('Ошибка загрузки данных: ' + e.message, 'error');
  }

  const spamAccounts = accounts.filter(a => a.is_spam_blocked);
  const activeAccounts = accounts.filter(a => a.status === 'active');

  content.innerHTML = `
    <!-- Stats Grid -->
    <div class="stats-grid">
      <div class="stat-card accent">
        <div class="stat-icon"></div>
        <div class="stat-value">${stats.accounts?.total ?? 0}</div>
        <div class="stat-label">Аккаунтов</div>
        <div class="stat-change up">${stats.accounts?.active ?? 0} активных</div>
      </div>
      <div class="stat-card green">
        <div class="stat-icon"></div>
        <div class="stat-value">${(stats.messages?.total_sent ?? 0).toLocaleString()}</div>
        <div class="stat-label">Отправлено всего</div>
        <div class="stat-change up">${stats.messages?.sent_today ?? 0} сегодня</div>
      </div>
      <div class="stat-card teal">
        <div class="stat-icon"></div>
        <div class="stat-value">${stats.campaigns?.total ?? 0}</div>
        <div class="stat-label">Кампаний</div>
        <div class="stat-change ${(stats.campaigns?.running ?? 0) > 0 ? 'up' : ''}">
          ${(stats.campaigns?.running ?? 0) > 0 ? stats.campaigns.running + ' запущено' : 'нет активных'}
        </div>
      </div>
      <div class="stat-card ${(stats.accounts?.spam_blocked ?? 0) > 0 ? 'red' : 'amber'}">
        <div class="stat-icon"></div>
        <div class="stat-value">${stats.accounts?.spam_blocked ?? 0}</div>
        <div class="stat-label">Спам-блоков</div>
        <div class="stat-change ${(stats.accounts?.spam_blocked ?? 0) > 0 ? 'down' : ''}">
          ${(stats.accounts?.spam_blocked ?? 0) > 0 ? 'Требует внимания' : 'Всё чисто'}
        </div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px">
      <!-- Аккаунты активные -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">Активные аккаунты</div>
          <button class="btn btn-sm btn-secondary" id="dash-go-accounts">Все аккаунты</button>
        </div>
        ${activeAccounts.length === 0 ? `
          <div class="empty-state" style="padding:30px">
            <div class="empty-state-icon"></div>
            <div class="empty-state-title">Нет активных аккаунтов</div>
            <button class="btn btn-primary btn-sm" id="dash-add-account">Добавить</button>
          </div>
        ` : `
          <div style="display:flex;flex-direction:column;gap:8px">
            ${activeAccounts.slice(0, 5).map(acc => `
              <div class="flex items-center gap-8" style="padding:8px 0;border-bottom:1px solid var(--border)">
                <div class="account-avatar" style="width:34px;height:34px;font-size:13px">
                  ${acc.first_name ? acc.first_name[0] : '?'}
                  <span class="status-dot ${acc.status}" style="position:absolute;bottom:0;right:0;border:2px solid var(--bg-surface)"></span>
                </div>
                <div style="flex:1;min-width:0">
                  <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                    ${acc.first_name || ''} ${acc.last_name || ''}
                    ${acc.username ? `<span class="text-muted text-sm">@${acc.username}</span>` : ''}
                  </div>
                  <div class="text-xs text-muted">${acc.phone}</div>
                </div>
                <div class="text-xs text-muted" style="text-align:right">
                  <div>Отправлено: ${acc.messages_sent}</div>
                  <div>Сегодня: ${acc.messages_today}</div>
                </div>
              </div>
            `).join('')}
            ${activeAccounts.length > 5 ? `<div class="text-sm text-muted" style="text-align:center;padding-top:4px">+${activeAccounts.length - 5} ещё</div>` : ''}
          </div>
        `}
      </div>

      <!-- Спам-блоки -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">Проблемные аккаунты</div>
          <span class="badge ${spamAccounts.length > 0 ? 'badge-spam' : 'badge-active'}">
            ${spamAccounts.length > 0 ? spamAccounts.length + ' блоков' : 'OK'}
          </span>
        </div>
        ${spamAccounts.length === 0 ? `
          <div class="empty-state" style="padding:30px">
            <div class="empty-state-icon" style="font-size:36px"></div>
            <div class="empty-state-title">Спам-блоков нет</div>
            <div class="empty-state-text">Все аккаунты работают нормально</div>
          </div>
        ` : `
          <div style="display:flex;flex-direction:column;gap:8px">
            ${spamAccounts.map(acc => `
              <div class="flex items-center gap-8" style="padding:8px;background:var(--red-dim);border-radius:var(--r-md)">
                <div style="flex:1">
                  <div style="font-size:13px;font-weight:600">${acc.first_name || ''} ${acc.last_name || ''}</div>
                  <div class="text-xs text-muted">${acc.phone}</div>
                </div>
                <span class="badge badge-spam">SPAM</span>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    </div>

    <!-- Быстрые действия -->
    <div class="card">
      <div class="card-title" style="margin-bottom:16px">Быстрые действия</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <button class="btn btn-primary" id="q-add-account">Добавить аккаунт</button>
        <button class="btn btn-secondary" id="q-new-campaign">Новая кампания</button>
        <button class="btn btn-secondary" id="q-new-template">Создать шаблон</button>
        <button class="btn btn-secondary" id="q-spam-check-all">Проверить все на спам</button>
      </div>
    </div>
  `;

  // Event handlers
  document.getElementById('dash-go-accounts')?.addEventListener('click', () => app.navigate('accounts'));
  document.getElementById('dash-add-account')?.addEventListener('click', () => {
    app.navigate('accounts');
    setTimeout(() => document.getElementById('btn-add-account')?.click(), 300);
  });
  document.getElementById('q-add-account')?.addEventListener('click', () => app.navigate('accounts'));
  document.getElementById('q-new-campaign')?.addEventListener('click', () => app.navigate('campaign-new'));
  document.getElementById('q-new-template')?.addEventListener('click', () => app.navigate('templates'));
  document.getElementById('q-spam-check-all')?.addEventListener('click', async () => {
    app.toast('Запуск проверки всех аккаунтов...', 'info');
    for (const acc of accounts) {
      try {
        await accountsApi.spamCheck(acc.id);
      } catch {}
    }
    app.toast('Проверка завершена', 'success');
    renderDashboard(app);
  });
}
