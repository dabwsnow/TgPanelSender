/**
 * app.js — SPA роутер и глобальные утилиты.
 * Управляет навигацией между страницами, тостами и модалками.
 */

import { renderDashboard }   from './pages/dashboard.js';
import { renderAccounts }    from './pages/accounts.js?v=16';
import { renderAccountEdit } from './pages/account-edit.js?v=16';
import { renderTemplates }   from './pages/templates.js?v=16';
import { renderCampaigns }   from './pages/campaigns.js?v=16';
import { renderCampaignNew } from './pages/campaign-new.js?v=16';
import { renderJoins }       from './pages/joins.js?v=16';
import { renderProxies }     from './pages/proxies.js?v=16';
import { settingsApi }       from './api.js?v=16';

// ─── Роутер ──────────────────────────────────────────────────────
const routes = {
  dashboard:    { label: 'Дашборд',         render: () => renderDashboard(app) },
  accounts:     { label: 'Аккаунты',        render: () => renderAccounts(app) },
  'account-edit': { label: 'Аккаунт',       render: (p) => renderAccountEdit(app, p) },
  templates:    { label: 'Шаблоны',         render: () => renderTemplates(app) },
  campaigns:    { label: 'Кампании',        render: () => renderCampaigns(app) },
  'campaign-new': { label: 'Новая кампания', render: (p) => renderCampaignNew(app, p) },
  joins:        { label: 'Вступление',       render: () => renderJoins(app) },
  proxies:      { label: 'Прокси',          render: () => renderProxies(app) },
};

let currentRoute = null;

// Глобальный объект приложения
const app = {
  // ─── Навигация ────────────────────────────────────────────────
  navigate(route, params = {}) {
    currentRoute = { route, params };
    this.updateSidebar(route);
    this.updateTopbar(route, params);

    const content = document.getElementById('page-content');
    content.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:200px"><div class="spinner"></div></div>';

    const routeDef = routes[route];
    if (routeDef) {
      routeDef.render(params);
    } else {
      content.innerHTML = '<div class="empty-state"><div class="empty-state-icon"></div><div class="empty-state-title">Страница не найдена</div></div>';
    }
  },

  updateSidebar(activeRoute) {
    document.querySelectorAll('.nav-item[data-route]').forEach(el => {
      el.classList.toggle('active', el.dataset.route === activeRoute);
    });
  },

  updateTopbar(route, params) {
    const topbarTitle = document.getElementById('topbar-title');
    const routeDef = routes[route];
    if (topbarTitle && routeDef) {
      topbarTitle.textContent = routeDef.label;
    }
  },

  // ─── Toast ───────────────────────────────────────────────────
  toast(msg, type = 'info', duration = 3500) {
    const icons = { success: '[OK] ', error: '[ERR] ', warn: '[WARN] ', info: '[INFO] ' };
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="toast-icon" style="font-family:monospace;font-weight:bold">${icons[type]}</span><span class="toast-msg">${msg}</span>`;
    container.appendChild(el);
    setTimeout(() => el.remove(), duration);
  },

  // ─── Modal ───────────────────────────────────────────────────
  modal({ title, content, footer = null, onClose = null } = {}) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">${title}</div>
          <button class="modal-close" id="modal-close-btn">✕</button>
        </div>
        <div class="modal-body">${content}</div>
        ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
      </div>
    `;

    const close = () => {
      overlay.style.animation = 'fadeIn 0.15s ease reverse';
      setTimeout(() => overlay.remove(), 150);
      if (onClose) onClose();
    };

    overlay.querySelector('#modal-close-btn').onclick = close;
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    document.body.appendChild(overlay);
    return { overlay, close };
  },

  // ─── Confirm dialog ──────────────────────────────────────────
  confirm(message) {
    return new Promise(resolve => {
      const { overlay, close } = this.modal({
        title: 'Подтверждение',
        content: `<p style="font-size:14px;color:var(--text-secondary)">${message}</p>`,
        footer: `
          <button class="btn btn-secondary" id="confirm-no">Отмена</button>
          <button class="btn btn-danger" id="confirm-yes">Удалить</button>
        `,
      });
      overlay.querySelector('#confirm-yes').onclick = () => { close(); resolve(true); };
      overlay.querySelector('#confirm-no').onclick  = () => { close(); resolve(false); };
    });
  },
};

// ─── Sidebar HTML ─────────────────────────────────────────────────
function renderLayout() {
  document.body.innerHTML = `
    <div class="app-layout">
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-logo">
          <div class="sidebar-logo-icon" style="font-weight:800;font-size:14px;letter-spacing:-1px">TG</div>
          <div>
            <div class="sidebar-logo-text">TGPanel</div>
            <div class="sidebar-logo-badge">Telegram Sender</div>
          </div>
        </div>

        <nav class="sidebar-nav">
          <div class="nav-section-label">Главное</div>
          <div class="nav-item" data-route="dashboard">
            <span class="icon"></span> Дашборд
          </div>
          <div class="nav-item" data-route="accounts">
            <span class="icon"></span> Аккаунты
            <span class="nav-badge" id="badge-accounts">0</span>
          </div>

          <div class="nav-section-label">Рассылка</div>
          <div class="nav-item" data-route="campaigns">
            <span class="icon"></span> Кампании
            <span class="nav-badge" id="badge-campaigns">0</span>
          </div>
          <div class="nav-item" data-route="templates">
            <span class="icon"></span> Шаблоны
          </div>
          <div class="nav-item" data-route="joins">
            <span class="icon"></span> Вступление
          </div>

          <div class="nav-section-label">Система</div>
          <div class="nav-item" data-route="proxies">
            <span class="icon"></span> Прокси
          </div>
          <div class="nav-item" id="nav-settings">
            <span class="icon"></span> Настройки
          </div>
        </nav>

        <div class="sidebar-footer">
          <div class="sidebar-footer-item" id="nav-api-docs">
            <span></span> API Документация
          </div>
        </div>
      </aside>

      <div class="main-content">
        <header class="topbar">
          <span id="topbar-title" class="topbar-title">Дашборд</span>
          <div class="topbar-actions" id="topbar-actions"></div>
        </header>
        <main class="page-body" id="page-content"></main>
      </div>
    </div>

    <div id="toast-container"></div>
  `;

  // Навигация по клику на sidebar
  document.querySelectorAll('.nav-item[data-route]').forEach(el => {
    el.addEventListener('click', () => app.navigate(el.dataset.route));
  });

  // Настройки
  document.getElementById('nav-settings').addEventListener('click', () => {
    showSettingsModal();
  });

  // API Docs
  document.getElementById('nav-api-docs').addEventListener('click', () => {
    window.open('/api/docs', '_blank');
  });
}

// ─── Модалка настроек ─────────────────────────────────────────────
async function showSettingsModal() {
  let settings = {};
  try { settings = await settingsApi.get(); } catch {}

  const { overlay, close } = app.modal({
    title: 'Настройки TGPanel',
    content: `
      <div class="form-group">
        <label class="form-label">Интервал проверки спам-блока (мин)</label>
        <input class="form-input" id="s-spam-interval" type="number" value="${settings.spam_check_interval || 30}" min="5">
      </div>
      <div class="form-group">
        <label class="form-label">Дневной лимит сообщений (по умолчанию)</label>
        <input class="form-input" id="s-daily-limit" type="number" value="${settings.default_daily_limit || 50}" min="1">
      </div>
      <div class="form-group">
        <label class="form-label">Задержка между сообщениями (сек)</label>
        <div style="display:flex;gap:8px">
          <input class="form-input" id="s-delay-min" type="number" value="${settings.default_delay_min || 5}" min="1" placeholder="Мин">
          <input class="form-input" id="s-delay-max" type="number" value="${settings.default_delay_max || 15}" min="1" placeholder="Макс">
        </div>
      </div>
    `,
    footer: `
      <button class="btn btn-secondary" id="settings-cancel">Закрыть</button>
      <button class="btn btn-primary" id="settings-save">Сохранить</button>
    `,
  });

  overlay.querySelector('#settings-cancel').onclick = close;
  overlay.querySelector('#settings-save').onclick = async () => {
    try {
      await settingsApi.update({
        spam_check_interval: overlay.querySelector('#s-spam-interval').value,
        default_daily_limit: overlay.querySelector('#s-daily-limit').value,
        default_delay_min:   overlay.querySelector('#s-delay-min').value,
        default_delay_max:   overlay.querySelector('#s-delay-max').value,
      });
      app.toast('Настройки сохранены', 'success');
      close();
    } catch (e) {
      app.toast('Ошибка: ' + e.message, 'error');
    }
  };
}

// ─── Обновление бейджей в сайдбаре ───────────────────────────────
async function updateBadges() {
  try {
    const stats = await settingsApi.stats();
    const badgeAcc = document.getElementById('badge-accounts');
    const badgeCamp = document.getElementById('badge-campaigns');
    if (badgeAcc) {
      badgeAcc.textContent = stats.accounts.total;
      badgeAcc.className = 'nav-badge' + (stats.accounts.spam_blocked > 0 ? ' red' : '');
    }
    if (badgeCamp) {
      badgeCamp.textContent = stats.campaigns.total;
    }
  } catch {}
}

// ─── Инициализация ────────────────────────────────────────────────
renderLayout();
app.navigate('dashboard');
updateBadges();
// Обновляем бейджи каждые 30 сек
setInterval(updateBadges, 30_000);

export { app };
