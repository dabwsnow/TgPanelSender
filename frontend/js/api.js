/**
 * api.js — HTTP-клиент для работы с бекендом.
 * Все запросы к API идут через этот модуль.
 * Чтобы добавить новый метод — просто добавь функцию ниже.
 */

const BASE = '/api';

// ─── Базовый fetch ────────────────────────────────────────────────
async function request(method, path, body = null, isFormData = false) {
  const token = localStorage.getItem('admin_token') || '';
  const opts = {
    method,
    headers: isFormData ? {} : { 'Content-Type': 'application/json' },
  };
  if (token) {
    opts.headers['X-Admin-Token'] = token;
  }
  if (body) opts.body = isFormData ? body : JSON.stringify(body);

  const res = await fetch(BASE + path, opts);

  if (res.status === 401) {
    localStorage.removeItem('admin_token');
    location.reload();
    throw new Error('Необходима авторизация');
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = data?.detail || data?.message || `HTTP ${res.status}`;
    throw new Error(Array.isArray(msg) ? msg.map(e => e.msg).join(', ') : msg);
  }
  return data;
}

const get  = (path)        => request('GET',    path);
const post = (path, body)  => request('POST',   path, body);
const put  = (path, body)  => request('PUT',    path, body);
const del  = (path)        => request('DELETE', path);
const postForm = (path, fd) => request('POST',  path, fd, true);

// ════════════════════════════════════════════════════════════════
// Accounts API
// ════════════════════════════════════════════════════════════════
export const accountsApi = {
  list:           ()            => get('/accounts'),
  get:            (id)          => get(`/accounts/${id}`),
  delete:         (id)          => del(`/accounts/${id}`),
  connect:        (id)          => post(`/accounts/${id}/connect`),

  sendCode:       (data)        => post('/accounts/send-code', data),
  verifyCode:     (data)        => post('/accounts/verify-code', data),
  verify2fa:      (data)        => post('/accounts/verify-2fa', data),

  importSession:  (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return postForm('/accounts/import-session', fd);
  },

  importTData:    (file, password = '') => {
    const fd = new FormData();
    fd.append('file', file);
    if (password) fd.append('password', password);
    return postForm('/accounts/import-tdata', fd);
  },

  importBulk:     (file, password = '') => {
    const fd = new FormData();
    fd.append('file', file);
    const q = password ? `?password=${encodeURIComponent(password)}` : '';
    return postForm('/accounts/import-bulk' + q, fd);
  },

  updateProfile:  (id, data)    => put(`/accounts/${id}/profile`, data),
  updateAutoResponder: (id, data) => put(`/accounts/${id}/autoresponder`, data),

  uploadAvatar:   (id, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return postForm(`/accounts/${id}/avatar`, fd);
  },

  spamCheck:      (id)          => post(`/accounts/${id}/spam-check`),
  spamCheckAll:   ()            => post('/accounts/spam-check-all'),
  spamHistory:    (id)          => get(`/accounts/${id}/spam-history`),
  distributeProxies: (data = {}) => post('/accounts/proxy/distribute', data),

  chats:          (id)          => get(`/accounts/${id}/chats`),
  chatMessages:   (id, chatId)  => get(`/accounts/${id}/chats/${chatId}/messages`),
  sendMessage:    (id, chatId, text) => post(`/accounts/${id}/chats/${chatId}/send`, { text }),
  downloadMedia:  (id, chatId, msgId) => get(`/accounts/${id}/chats/${chatId}/messages/${msgId}/media`),

  groups:         (id)          => get(`/accounts/${id}/groups`),
  leaveGroup:     (id, chatId)  => post(`/accounts/${id}/groups/leave?chat_id=${chatId}`),
  leaveAllGroups: (id)          => post(`/accounts/${id}/groups/leave-all`),

  getJoins:       (id)          => get(`/accounts/${id}/joins`),
  addJoins:       (id, links)   => post(`/accounts/${id}/joins`, { links }),
  clearJoins:     (id)          => del(`/accounts/${id}/joins`),
  startJoins:     (id, delay_min, delay_max) => post(`/accounts/${id}/joins/start`, { delay_min, delay_max }),
  stopJoins:      (id)          => post(`/accounts/${id}/joins/stop`),
  updateProxy:    (id, proxyId) => put(`/accounts/${id}/proxy`, { proxy_id: proxyId }),
};

// ════════════════════════════════════════════════════════════════
// Templates API
// ════════════════════════════════════════════════════════════════
export const templatesApi = {
  list:    ()            => get('/templates'),
  get:     (id)          => get(`/templates/${id}`),
  create:  (data)        => post('/templates', data),
  update:  (id, data)    => put(`/templates/${id}`, data),
  delete:  (id)          => del(`/templates/${id}`),

  uploadMedia: (id, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return postForm(`/templates/${id}/media`, fd);
  },
  deleteMedia: (id)      => del(`/templates/${id}/media`),
  preview: (content, variables) => post('/templates/preview', { content, variables }),
  spin: (id, count) => post(`/templates/${id}/spin`, { count }),
  updateSpin: (id, variations) => put(`/templates/${id}/spin`, { variations }),
  clearSpin: (id) => del(`/templates/${id}/spin`),
};

// ════════════════════════════════════════════════════════════════
// Campaigns API
// ════════════════════════════════════════════════════════════════
export const campaignsApi = {
  list:    ()            => get('/campaigns'),
  get:     (id)          => get(`/campaigns/${id}`),
  create:  (data)        => post('/campaigns', data),
  update:  (id, data)    => put(`/campaigns/${id}`, data),
  delete:  (id)          => del(`/campaigns/${id}`),

  start:   (id)          => post(`/campaigns/${id}/start`),
  stop:    (id)          => post(`/campaigns/${id}/stop`),
  pause:   (id)          => post(`/campaigns/${id}/pause`),

  addRecipients:    (id, data)  => post(`/campaigns/${id}/recipients`, data),
  getRecipients:    (id, params) => get(`/campaigns/${id}/recipients${params ? '?' + new URLSearchParams(params) : ''}`),
  deleteRecipient:  (cid, rid)  => del(`/campaigns/${cid}/recipients/${rid}`),

  addRecipientsFromAccount: (id, accountId) => post(`/campaigns/${id}/recipients/from-account`, { account_id: accountId }),

  uploadRecipients: (id, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return postForm(`/campaigns/${id}/recipients/upload`, fd);
  },

  getStats: (id) => get(`/campaigns/${id}/stats`),
};

// ════════════════════════════════════════════════════════════════
// Settings API
// ════════════════════════════════════════════════════════════════
export const settingsApi = {
  get:    ()     => get('/settings'),
  update: (data) => put('/settings', data),
  stats:  ()     => get('/settings/stats'),
};

// ════════════════════════════════════════════════════════════════
// Joins API
// ════════════════════════════════════════════════════════════════
export const joinsApi = {
  getGlobal:     ()             => get('/joins/global'),
  addGlobal:     (links)        => post('/joins/global', { links }),
  clearGlobal:   ()             => del('/joins/global'),
  deleteGlobal:  (id)           => del(`/joins/global/${id}`),
  distribute:    (accountIds, mode) => post('/joins/global/distribute', { account_ids: accountIds, mode }),
  folderChats:   (slug)         => get(`/joins/folders/${slug}/chats`),
  refreshFolder: (link)         => post('/joins/folders/refresh', { link }),
};

// ════════════════════════════════════════════════════════════════
// Proxies API
// ════════════════════════════════════════════════════════════════
export const proxiesApi = {
  list:    ()            => get('/proxies'),
  create:  (data)        => post('/proxies', data),
  update:  (id, data)    => put(`/proxies/${id}`, data),
  delete:  (id)          => del(`/proxies/${id}`),
  test:    (id)          => post(`/proxies/${id}/test`),
  bulk:    (data)        => post('/proxies/bulk', data),
};
