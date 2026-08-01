/**
 * pages/templates.js — Управление шаблонами сообщений.
 * Поддержка: Telegram-форматирование (Markdown), медиа-вложения любого типа,
 * переменные, live-preview, AI-вариации (спин-текст).
 */
import { templatesApi } from '../api.js?v=15';

export async function renderTemplates(app) {
  const content = document.getElementById('page-content');
  const topbarActions = document.getElementById('topbar-actions');

  topbarActions.innerHTML = `<button class="btn btn-primary" id="btn-new-template">+ Новый шаблон</button>`;

  let templates = [];
  try {
    templates = await templatesApi.list();
  } catch (e) {
    app.toast('Ошибка загрузки шаблонов: ' + e.message, 'error');
  }

  content.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <div>
        <div style="font-size:20px;font-weight:700">Шаблоны сообщений</div>
        <div class="text-sm text-muted">${templates.length} шаблон(ов)</div>
      </div>
    </div>

    ${templates.length === 0 ? `
      <div class="empty-state">
        <div class="empty-state-icon">✉️</div>
        <div class="empty-state-title">Нет шаблонов</div>
        <div class="empty-state-text">Создай шаблон — текст с Telegram-форматированием и медиа-вложением</div>
        <button class="btn btn-primary" id="btn-new-empty">Создать шаблон</button>
      </div>
    ` : `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px" id="templates-grid">
        ${templates.map(t => renderTemplateCard(t)).join('')}
      </div>
    `}
  `;

  document.getElementById('btn-new-template')?.addEventListener('click', () => showTemplateModal(app));
  document.getElementById('btn-new-empty')?.addEventListener('click', () => showTemplateModal(app));

  document.querySelectorAll('.template-edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      const t = templates.find(t => t.id === id);
      showTemplateModal(app, t);
    });
  });

  document.querySelectorAll('.template-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      const ok = await app.confirm('Удалить шаблон?');
      if (!ok) return;
      try {
        await templatesApi.delete(id);
        app.toast('Шаблон удалён', 'success');
        renderTemplates(app);
      } catch (e) { app.toast('Ошибка: ' + e.message, 'error'); }
    });
  });

  document.querySelectorAll('.template-preview-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      const t = templates.find(t => t.id === id);
      showPreviewModal(app, t);
    });
  });
}

// ─── Карточка шаблона ──────────────────────────────────────────────────────

function renderTemplateCard(t) {
  const preview = t.content.slice(0, 120) + (t.content.length > 120 ? '...' : '');
  const vars = extractVars(t.content);

  let variations = [];
  try {
    variations = t.variations ? JSON.parse(t.variations) : [];
  } catch (e) {
    variations = [];
  }

  const mediaBadge = t.media_type ? `
    <span class="badge badge-active" style="font-size:10px">
      ${mediaIcon(t.media_type)} ${t.media_type}
    </span>` : '';

  const modeBadge = `
    <span class="badge" style="font-size:10px;background:var(--bg-elevated);color:var(--text-secondary)">
      ${t.parse_mode === 'html' ? 'HTML' : 'Markdown'}
    </span>`;

  const spinBadge = variations.length > 0 ? `
    <span class="badge" style="font-size:10px;background:rgba(56,139,253,0.15);color:var(--accent)">
      🤖 AI: ${variations.length} вар.
    </span>` : '';

  return `
    <div class="card" style="cursor:default;transition:border-color 0.15s,transform 0.15s"
         onmouseover="this.style.borderColor='var(--border-accent)';this.style.transform='translateY(-2px)'"
         onmouseout="this.style.borderColor='var(--border)';this.style.transform=''">
      <div class="card-header" style="margin-bottom:10px">
        <div class="card-title" style="font-size:14px">${escHtml(t.name)}</div>
        <div class="flex gap-8">
          <button class="btn btn-ghost btn-sm template-preview-btn" data-id="${t.id}">👁 Просмотр</button>
          <button class="btn btn-ghost btn-sm template-edit-btn" data-id="${t.id}">✏️ Изменить</button>
          <button class="btn btn-ghost btn-sm template-delete-btn" data-id="${t.id}">🗑</button>
        </div>
      </div>

      <div class="code-preview" style="font-family:monospace;font-size:12px;min-height:60px;max-height:100px;overflow:hidden;white-space:pre-wrap">
        ${escHtml(preview)}
      </div>

      ${t.media_url ? `
        <div style="margin-top:8px;padding:6px 8px;background:var(--bg-elevated);border-radius:6px;font-size:11px;display:flex;align-items:center;gap:6px">
          ${mediaIcon(t.media_type)} <span style="opacity:0.7;">${t.media_type === 'photo' ? 'Фото' : t.media_type === 'video' ? 'Видео' : t.media_type === 'audio' ? 'Аудио' : 'Документ'} прикреплён</span>
        </div>
      ` : ''}

      <div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:5px;align-items:center">
        ${modeBadge}
        ${spinBadge}
        ${mediaBadge}
        ${vars.map(v => `<span class="tag" style="font-size:10px">{${v}}</span>`).join('')}
      </div>

      <div class="text-xs text-muted" style="margin-top:10px">
        Создан: ${new Date(t.created_at).toLocaleDateString('ru')}
      </div>
    </div>
  `;
}

// ─── Редактор шаблона ──────────────────────────────────────────────────────

function showTemplateModal(app, existing = null) {
  const isEdit = !!existing;
  let currentMedia = existing ? {
    url: existing.media_url || null,
    type: existing.media_type || null,
    filename: existing.media_url ? existing.media_url.split('/').pop() : null,
  } : null;

  let localVariations = [];
  try {
    localVariations = existing?.variations ? JSON.parse(existing.variations) : [];
  } catch (e) {
    localVariations = [];
  }

  const { overlay, close } = app.modal({
    title: isEdit ? `✏️ Редактировать: ${existing.name}` : '✉️ Новый шаблон',
    content: `
      <!-- Название -->
      <div class="form-group">
        <label class="form-label">Название шаблона</label>
        <input class="form-input" id="tmpl-name" value="${escHtml(existing?.name || '')}" placeholder="Например: Приветствие">
      </div>

      <!-- Parse mode -->
      <div class="form-group">
        <label class="form-label">Формат текста</label>
        <div style="display:flex;gap:8px">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px">
            <input type="radio" name="parse-mode" value="markdown" ${(!existing || existing.parse_mode !== 'html') ? 'checked' : ''}> Telegram Markdown
          </label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px">
            <input type="radio" name="parse-mode" value="html" ${existing?.parse_mode === 'html' ? 'checked' : ''}> HTML
          </label>
        </div>
      </div>

      <!-- Тулбар форматирования -->
      <div class="form-group">
        <label class="form-label">Текст сообщения</label>
        <div id="tmpl-toolbar" style="display:flex;gap:4px;margin-bottom:6px;flex-wrap:wrap">
          <button type="button" class="fmt-btn" data-wrap="**" data-wrap-end="**" title="Жирный (Ctrl+B)" style="font-weight:700">B</button>
          <button type="button" class="fmt-btn" data-wrap="_" data-wrap-end="_" title="Курсив (Ctrl+I)" style="font-style:italic">I</button>
          <button type="button" class="fmt-btn" data-wrap="__" data-wrap-end="__" title="Подчёркнутый" style="text-decoration:underline">U</button>
          <button type="button" class="fmt-btn" data-wrap="~~" data-wrap-end="~~" title="Зачёркнутый" style="text-decoration:line-through">S</button>
          <button type="button" class="fmt-btn" data-wrap="\`" data-wrap-end="\`" title="Моноширинный" style="font-family:monospace">M</button>
          <button type="button" class="fmt-btn" data-wrap="||" data-wrap-end="||" title="Скрытый текст (Spoiler)">👁‍🗨</button>
          <div style="width:1px;background:var(--border);margin:0 4px"></div>
          <button type="button" class="fmt-btn" data-insert="{first_name}" title="Имя">{name}</button>
          <button type="button" class="fmt-btn" data-insert="{username}" title="Username">@</button>
          <button type="button" class="fmt-btn" data-insert="{date}" title="Дата">📅</button>
        </div>
        <textarea class="form-textarea" id="tmpl-content" rows="8"
          style="font-family:monospace;font-size:13px;resize:vertical"
          placeholder="Привет, {first_name}! **Жирный**, _курсив_, ||спойлер||...">${escHtml(existing?.content || '')}</textarea>
        <div class="form-hint" style="margin-top:4px">
          Markdown: <code>**жирный**</code> <code>_курсив_</code> <code>__подчёркнутый__</code> <code>~~зачёркнутый~~</code> <code>\`моно\`</code> <code>||спойлер||</code>
          &nbsp;·&nbsp; Переменные: <code>{first_name}</code> <code>{username}</code> <code>{date}</code> и свои
        </div>
      </div>

      <!-- Медиа вложение -->
      <div class="form-group">
        <label class="form-label">Медиа-вложение (фото / видео / любой файл)</label>
        <div id="tmpl-dropzone" style="
          border:2px dashed var(--border);border-radius:8px;
          padding:20px;text-align:center;cursor:pointer;
          transition:border-color 0.2s,background 0.2s;
          color:var(--text-muted);font-size:13px;
        ">
          <div id="tmpl-media-preview">
            ${renderMediaPreview(currentMedia)}
          </div>
          <div id="tmpl-drop-hint" style="${currentMedia?.url ? 'display:none' : ''}">
            📎 Перетащи файл сюда или <span style="color:var(--accent);text-decoration:underline">выбери</span>
            <div style="font-size:11px;margin-top:4px;opacity:0.6">Фото, видео, документы, аудио — любые форматы</div>
          </div>
          <input type="file" id="tmpl-media-input" style="display:none" accept="*/*">
        </div>
        ${currentMedia?.url ? `
          <button type="button" id="tmpl-del-media" class="btn btn-ghost btn-sm" style="margin-top:8px;color:var(--red)">
            🗑 Удалить вложение
          </button>
        ` : ''}
      </div>

      <!-- Live preview -->
      <div class="form-group">
        <label class="form-label" style="margin-bottom:6px">Live-предпросмотр</label>
        <div id="tmpl-preview" style="
          background:var(--bg-elevated);
          border-radius:var(--r-md);
          padding:14px;min-height:60px;
          font-size:14px;line-height:1.6;
          white-space:pre-wrap;word-break:break-word;
        "></div>
      </div>

      <!-- AI-Вариации для защиты от спама -->
      <div class="form-group" style="background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--r-lg);padding:16px;margin-top:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div>
            <div style="font-weight:600;font-size:13px;display:flex;align-items:center;gap:6px">
              <span>🤖 AI-Вариации текста</span>
              <span class="badge" id="vars-count-badge" style="background:var(--accent);color:var(--bg-base);font-size:10px;padding:2px 6px">0</span>
            </div>
            <div style="font-size:10px;opacity:0.6;margin-top:2px">Каждый получатель получит случайный уникальный вариант текста</div>
          </div>
          ${isEdit ? `
            <div style="display:flex;align-items:center;gap:8px">
              <input type="number" id="spin-count" value="5" min="2" max="15" style="width:48px;padding:4px;border-radius:4px;border:1px solid var(--border);background:var(--bg-base);color:var(--text-primary);font-size:12px;text-align:center">
              <button type="button" class="btn btn-secondary btn-sm" id="btn-generate-variations">Сгенерировать</button>
            </div>
          ` : '<span style="font-size:11px;color:var(--text-muted)">Сначала создайте шаблон, чтобы генерировать вариации</span>'}
        </div>
        
        <div id="variations-container" style="display:flex;flex-direction:column;gap:8px;max-height:220px;overflow-y:auto;min-height:0"></div>
      </div>
    `,
    footer: `
      <button class="btn btn-secondary" id="tmpl-cancel">Отмена</button>
      <button class="btn btn-primary" id="tmpl-save">${isEdit ? '💾 Сохранить' : '✅ Создать'}</button>
    `,
  });

  const textarea = overlay.querySelector('#tmpl-content');
  const preview = overlay.querySelector('#tmpl-preview');
  const dropzone = overlay.querySelector('#tmpl-dropzone');
  const mediaInput = overlay.querySelector('#tmpl-media-input');
  const mediaPreviewEl = overlay.querySelector('#tmpl-media-preview');
  const dropHint = overlay.querySelector('#tmpl-drop-hint');

  const variationsContainer = overlay.querySelector('#variations-container');
  const varsCountBadge = overlay.querySelector('#vars-count-badge');

  // ── Live preview update ──
  const updatePreview = () => {
    const mode = overlay.querySelector('input[name="parse-mode"]:checked')?.value || 'markdown';
    const text = textarea.value;
    preview.innerHTML = renderMarkdown(text, mode);
  };
  textarea.addEventListener('input', updatePreview);
  overlay.querySelectorAll('input[name="parse-mode"]').forEach(r => r.addEventListener('change', updatePreview));
  updatePreview();

  // ── Format toolbar ──
  overlay.querySelectorAll('.fmt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const wrap = btn.dataset.wrap;
      const wrapEnd = btn.dataset.wrapEnd;
      const insert = btn.dataset.insert;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selected = textarea.value.slice(start, end);

      if (insert) {
        textarea.value = textarea.value.slice(0, start) + insert + textarea.value.slice(end);
        textarea.selectionStart = textarea.selectionEnd = start + insert.length;
      } else if (wrap) {
        const replacement = wrap + (selected || 'текст') + wrapEnd;
        textarea.value = textarea.value.slice(0, start) + replacement + textarea.value.slice(end);
        textarea.selectionStart = start + wrap.length;
        textarea.selectionEnd = start + wrap.length + (selected || 'текст').length;
      }
      textarea.focus();
      updatePreview();
    });
  });

  // ── Media drag-and-drop ──
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.style.borderColor = 'var(--accent)';
    dropzone.style.background = 'rgba(var(--accent-rgb, 56,139,253), 0.05)';
  });
  dropzone.addEventListener('dragleave', () => {
    dropzone.style.borderColor = 'var(--border)';
    dropzone.style.background = '';
  });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.style.borderColor = 'var(--border)';
    dropzone.style.background = '';
    const file = e.dataTransfer.files[0];
    if (file) handleMediaFile(file);
  });
  dropzone.addEventListener('click', (e) => {
    if (e.target.id !== 'tmpl-del-media') mediaInput.click();
  });
  mediaInput.addEventListener('change', () => {
    const file = mediaInput.files[0];
    if (file) handleMediaFile(file);
  });

  let pendingMediaFile = null;

  function handleMediaFile(file) {
    pendingMediaFile = file;
    const localUrl = URL.createObjectURL(file);
    const type = guessMediaType(file.type);
    currentMedia = { url: localUrl, type, filename: file.name, local: true };
    mediaPreviewEl.innerHTML = renderMediaPreview(currentMedia);
    if (dropHint) dropHint.style.display = 'none';

    // Add/update delete button
    let delBtn = overlay.querySelector('#tmpl-del-media');
    if (!delBtn) {
      const div = document.createElement('div');
      div.innerHTML = `<button type="button" id="tmpl-del-media" class="btn btn-ghost btn-sm" style="margin-top:8px;color:var(--red)">🗑 Удалить вложение</button>`;
      dropzone.parentNode.appendChild(div.firstChild);
      delBtn = overlay.querySelector('#tmpl-del-media');
      delBtn.addEventListener('click', removeMedia);
    }
  }

  function removeMedia() {
    pendingMediaFile = null;
    currentMedia = null;
    mediaPreviewEl.innerHTML = '';
    if (dropHint) dropHint.style.display = '';
    overlay.querySelector('#tmpl-del-media')?.remove();
  }

  overlay.querySelector('#tmpl-del-media')?.addEventListener('click', removeMedia);

  // ── AI Spin Variations Render ──
  const renderLocalVariations = () => {
    if (!variationsContainer) return;
    if (varsCountBadge) varsCountBadge.textContent = localVariations.length;

    if (localVariations.length === 0) {
      variationsContainer.innerHTML = `<div style="text-align:center;color:var(--text-muted);font-size:11px;padding:12px 0">Вариаций пока нет. Нажмите «Сгенерировать», чтобы создать уникальные варианты через AI.</div>`;
      return;
    }

    variationsContainer.innerHTML = localVariations.map((val, idx) => `
      <div style="display:flex;gap:8px;align-items:flex-start;background:var(--bg-base);padding:8px 12px;border-radius:6px;border:1px solid var(--border)">
        <span style="font-size:11px;opacity:0.5;margin-top:4px;font-family:monospace">#${idx+1}</span>
        <textarea class="variation-item-text" data-index="${idx}" rows="2" style="flex:1;background:transparent;border:none;color:var(--text-primary);font-size:12px;resize:vertical;font-family:inherit;padding:0;outline:none;line-height:1.4">${escHtml(val)}</textarea>
        <button type="button" class="btn-remove-var" data-index="${idx}" style="background:transparent;border:none;color:var(--red);cursor:pointer;font-size:16px;padding:0 4px;font-weight:bold">×</button>
      </div>
    `).join('');

    // Bind event for deleting
    variationsContainer.querySelectorAll('.btn-remove-var').forEach(btn => {
      btn.onclick = (e) => {
        e.preventDefault();
        const idx = parseInt(btn.dataset.index);
        localVariations.splice(idx, 1);
        renderLocalVariations();
      };
    });

    // Bind event for manual text changes
    variationsContainer.querySelectorAll('.variation-item-text').forEach(ta => {
      ta.oninput = (e) => {
        const idx = parseInt(ta.dataset.index);
        localVariations[idx] = e.target.value;
      };
    });
  };

  renderLocalVariations();

  // Generator handler
  const btnGen = overlay.querySelector('#btn-generate-variations');
  if (btnGen) {
    btnGen.onclick = async (e) => {
      e.preventDefault();
      const countInput = overlay.querySelector('#spin-count');
      const count = parseInt(countInput?.value || '5');

      btnGen.disabled = true;
      btnGen.innerHTML = '<span class="spinner" style="width:12px;height:12px"></span> AI думает...';
      variationsContainer.innerHTML = `<div style="text-align:center;padding:20px"><div class="spinner"></div><div style="font-size:11px;color:var(--text-muted);margin-top:6px">Нейросеть Groq перефразирует текст...</div></div>`;

      try {
        const res = await templatesApi.spin(existing.id, count);
        if (res.ok && res.variations) {
          localVariations = res.variations;
          renderLocalVariations();
          app.toast('Вариации успешно сгенерированы!', 'success');
        } else {
          throw new Error('Ошибка генерации');
        }
      } catch (err) {
        app.toast('Не удалось сгенерировать: ' + err.message, 'error');
        renderLocalVariations();
      } finally {
        btnGen.disabled = false;
        btnGen.innerHTML = 'Сгенерировать';
      }
    };
  }

  overlay.querySelector('#tmpl-cancel').onclick = close;

  // ── Save ──
  overlay.querySelector('#tmpl-save').onclick = async () => {
    const btn = overlay.querySelector('#tmpl-save');
    const name = overlay.querySelector('#tmpl-name').value.trim();
    const text = textarea.value.trim();
    const parseMode = overlay.querySelector('input[name="parse-mode"]:checked')?.value || 'markdown';

    if (!name) { app.toast('Введи название шаблона', 'warn'); return; }
    if (!text) { app.toast('Введи текст сообщения', 'warn'); return; }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Сохранение...';

    try {
      let templateId = existing?.id;
      if (isEdit) {
        await templatesApi.update(existing.id, { name, content: text, parse_mode: parseMode });
      } else {
        const res = await templatesApi.create({ name, content: text, parse_mode: parseMode });
        templateId = res.id;
      }

      // Save variations
      if (templateId) {
        await templatesApi.updateSpin(templateId, localVariations);
      }

      // Upload media if a new file was selected
      if (pendingMediaFile && templateId) {
        await templatesApi.uploadMedia(templateId, pendingMediaFile);
      }

      // Delete media if it was removed (edit mode, had media, now removed)
      if (isEdit && existing.media_url && !currentMedia && !pendingMediaFile) {
        await templatesApi.deleteMedia(existing.id);
      }

      app.toast(isEdit ? 'Шаблон обновлён' : 'Шаблон создан', 'success');
      close();
      renderTemplates(app);
    } catch (e) {
      app.toast('Ошибка: ' + e.message, 'error');
    }

    btn.disabled = false;
    btn.innerHTML = isEdit ? '💾 Сохранить' : '✅ Создать';
  };
}

// ─── Предпросмотр ──────────────────────────────────────────────────────────

function showPreviewModal(app, t) {
  const vars = extractVars(t.content);
  let variations = [];
  try {
    variations = t.variations ? JSON.parse(t.variations) : [];
  } catch (e) {
    variations = [];
  }

  const inputFields = vars.map(v => `
    <div class="form-group" style="margin-bottom:8px">
      <label class="form-label" style="font-size:11px">{${v}}</label>
      <input class="form-input" style="padding:6px 10px;font-size:13px" class="preview-var-input" data-var="${v}" placeholder="${v}">
    </div>
  `).join('');

  const mediaSec = t.media_url ? `
    <div style="margin-bottom:12px">
      ${t.media_type === 'photo' ? `<img src="${t.media_url}" style="max-width:100%;max-height:220px;border-radius:8px;display:block">` : ''}
      ${t.media_type === 'video' ? `<video src="${t.media_url}" controls style="max-width:100%;border-radius:8px;display:block"></video>` : ''}
      ${t.media_type === 'audio' ? `<audio src="${t.media_url}" controls style="width:100%"></audio>` : ''}
      ${t.media_type === 'document' ? `<div style="padding:10px;background:var(--bg-elevated);border-radius:6px;font-size:12px">📁 ${t.media_url.split('/').pop()}</div>` : ''}
    </div>
  ` : '';

  const { overlay } = app.modal({
    title: `👁 Предпросмотр: ${escHtml(t.name)}`,
    content: `
      ${variations.length > 0 ? `
        <div class="form-group" style="margin-bottom:12px">
          <label class="form-label">Посмотреть вариацию (всего: ${variations.length})</label>
          <select id="preview-variation-select" class="form-input" style="padding:6px 10px;font-size:13px">
            <option value="-1">Исходный текст шаблона</option>
            ${variations.map((v, idx) => `<option value="${idx}">Вариант #${idx+1}</option>`).join('')}
          </select>
        </div>
      ` : ''}

      ${vars.length > 0 ? `
        <div style="margin-bottom:12px">
          <label class="form-label">Подставь переменные для проверки</label>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px;margin-top:8px">
            ${inputFields}
          </div>
        </div>
        <div class="divider"></div>
      ` : ''}
      <label class="form-label" style="margin-bottom:8px;display:block">Результат</label>
      ${mediaSec}
      <div id="preview-result" style="
        background:var(--bg-elevated);border-radius:var(--r-md);
        padding:14px;font-size:14px;line-height:1.6;
        white-space:pre-wrap;word-break:break-word;min-height:60px;
      ">
        ${renderMarkdown(t.content, t.parse_mode || 'markdown')}
      </div>
      <div class="text-xs text-muted" style="margin-top:8px">Режим: ${t.parse_mode === 'html' ? 'HTML' : 'Telegram Markdown'}</div>
    `,
  });

  const updatePreview = () => {
    let select = overlay.querySelector('#preview-variation-select');
    let text = t.content;
    if (select && select.value !== '-1') {
      const idx = parseInt(select.value);
      text = variations[idx] || t.content;
    }
    overlay.querySelectorAll('[data-var]').forEach(inp => {
      text = text.replaceAll(`{${inp.dataset.var}}`, inp.value || `{${inp.dataset.var}}`);
    });
    overlay.querySelector('#preview-result').innerHTML = renderMarkdown(text, t.parse_mode || 'markdown');
  };

  overlay.querySelectorAll('[data-var]').forEach(inp => inp.addEventListener('input', updatePreview));
  overlay.querySelector('#preview-variation-select')?.addEventListener('change', updatePreview);
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function renderMediaPreview(media) {
  if (!media?.url) return '';
  const type = media.type;
  if (type === 'photo') {
    return `<img src="${media.url}" style="max-height:120px;max-width:100%;border-radius:6px;display:block;margin:0 auto 6px">`;
  }
  if (type === 'video') {
    return `<video src="${media.url}" style="max-height:120px;max-width:100%;border-radius:6px;display:block;margin:0 auto 6px" controls></video>`;
  }
  if (type === 'audio') {
    return `<audio src="${media.url}" controls style="width:100%;margin-bottom:6px"></audio>`;
  }
  return `<div style="display:flex;align-items:center;gap:8px;padding:8px;background:var(--bg-base);border-radius:6px;margin-bottom:6px;font-size:12px">
    <span style="font-size:24px">📁</span>
    <div style="min-width:0;flex:1;text-align:left">
      <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(media.filename || 'Файл')}</div>
      <div style="font-size:10px;opacity:0.6">Документ</div>
    </div>
  </div>`;
}

function guessMediaType(mime) {
  if (mime.startsWith('image/')) return 'photo';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

function mediaIcon(type) {
  if (type === 'photo') return '🖼️';
  if (type === 'video') return '🎥';
  if (type === 'audio') return '🎵';
  return '📁';
}

/**
 * Простой рендерер Telegram Markdown для live-preview в браузере.
 * Не для отправки — только для визуальной обратной связи в интерфейсе.
 */
function renderMarkdown(text, mode) {
  if (!text) return '';
  if (mode === 'html') {
    // Для HTML режима — просто показываем как есть (уже HTML)
    return text;
  }

  let html = escHtml(text);
  // Spoiler ||text||
  html = html.replace(/\|\|(.+?)\|\|/gs, '<span style="background:var(--text-secondary);color:var(--text-secondary);border-radius:3px;padding:0 2px;cursor:pointer" title="Спойлер (нажми)">$1</span>');
  // Bold **text**
  html = html.replace(/\*\*(.+?)\*\*/gs, '<strong>$1</strong>');
  // Underline __text__
  html = html.replace(/__(.+?)__/gs, '<u>$1</u>');
  // Italic _text_
  html = html.replace(/_(.+?)_/gs, '<em>$1</em>');
  // Strikethrough ~~text~~
  html = html.replace(/~~(.+?)~~/gs, '<s>$1</s>');
  // Mono `text`
  html = html.replace(/`(.+?)`/gs, '<code style="background:var(--bg-elevated);border-radius:3px;padding:1px 4px;font-size:12px">$1</code>');

  return html;
}

function extractVars(content) {
  return [...new Set([...content.matchAll(/\{(\w+)\}/g)].map(m => m[1]))];
}

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
