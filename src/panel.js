import { getContext } from '../../../../extensions.js';
import {
    getSettings, getChatState, sanitizeChatState, getCharacterKey,
    saveSettings, saveChatData,
} from './state.js';
import {
    addMemory, updateMemory, deleteMemory, getMemories,
    detectNudgeSignals, recordNudgeShown, draftMemoryFromContext,
} from './memories.js';
import { getActiveState, getStates, setActiveState, addState, updateState, deleteState, loadTemplate } from './states.js';
import { maybeRegenerateSummary } from './relationship.js';
import { buildAndInject } from './injection.js';
import {
    EXT_DISPLAY_NAME, MEMORY_TYPE_META, MEMORY_WEIGHT_META,
    STATE_TEMPLATES,
} from './config.js';

let editingMemory = null;

// ─── Bootstrap ───────────────────────────────────────────────────────────────

export function initPanel() {
    if ($('#codex-fab').length) return;
    createFAB();
    createPanel();
    bindEvents();
}

export function destroyPanel() {
    $('#codex-fab').remove();
    $('#codex-panel').remove();
    $('#codex-nudge').remove();
}

// ─── FAB ─────────────────────────────────────────────────────────────────────

function createFAB() {
    if ($('#codex-fab').length) return;

    const fab = $('<button>', {
        id: 'codex-fab',
        title: 'Codex',
        html: '<i class="fa-solid fa-id-badge" style="pointer-events:none;"></i>',
    }).css({
        position: 'fixed',
        bottom: '180px',
        right: '15px',
        width: '44px',
        height: '44px',
        borderRadius: '50%',
        border: '1px solid rgba(255,255,255,0.15)',
        background: 'rgba(28,28,32,0.85)',
        backdropFilter: 'blur(12px)',
        color: '#ddd',
        fontSize: '18px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        zIndex: '31000',
        boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
    });

    fab.on('click', togglePanel);
    $('#form_sheld').length ? $('#form_sheld').append(fab) : $('body').append(fab);
}

function togglePanel() {
    const $panel = $('#codex-panel');
    if ($panel.is(':visible')) {
        $panel.fadeOut(150);
    } else {
        renderPanel();
        $panel.fadeIn(150);
    }
}

// ─── Panel Shell ─────────────────────────────────────────────────────────────

function createPanel() {
    if ($('#codex-panel').length) return;

    const panel = $(`
    <div id="codex-panel" class="codex-panel" style="display:none;">

      <div class="cdx-header">
        <span class="cdx-char-name" id="cdx-char-name"></span>
        <div class="cdx-header-actions">
          <button class="cdx-icon-btn" id="cdx-settings-toggle" title="Settings">⚙️</button>
          <button class="cdx-icon-btn" id="cdx-close">✕</button>
        </div>
      </div>

      <!-- ── Main Profile View ── -->
      <div class="cdx-main" id="cdx-main">

        <!-- What's Changed -->
        <div class="cdx-field-section">
          <div class="cdx-field-label">What's different now?</div>
          <textarea id="cdx-whats-changed" class="cdx-field-input" rows="2"
            placeholder="How have they changed since the start? What's the card no longer getting right?"></textarea>
        </div>

        <!-- Memories -->
        <div class="cdx-field-section">
          <div class="cdx-field-bar">
            <span class="cdx-field-label">What they remember <span id="cdx-mem-count" class="cdx-dim"></span></span>
            <button class="cdx-text-btn" id="cdx-add-memory">+ add</button>
          </div>
          <div id="cdx-mem-list" class="cdx-mem-list"></div>
        </div>

        <!-- Growing Toward -->
        <div class="cdx-field-section">
          <div class="cdx-field-label">Where are they heading?</div>
          <textarea id="cdx-growing-toward" class="cdx-field-input" rows="2"
            placeholder="What's shifting under the surface? What direction is the character moving in?"></textarea>
        </div>

      </div>

      <!-- ── Memory Quick-Add ── -->
      <div class="cdx-quick-add" id="cdx-quick-add" style="display:none;">
        <textarea id="cdx-qa-text" rows="2" class="cdx-field-input" placeholder="What happened?"></textarea>
        <div class="cdx-qa-row">
          <div class="cdx-qa-chips" id="cdx-qa-type-chips"></div>
          <div class="cdx-qa-actions">
            <select id="cdx-qa-weight" class="cdx-mini-select">
              ${Object.entries(MEMORY_WEIGHT_META).map(([k, v]) =>
                `<option value="${k}">${v.icon} ${v.label}</option>`
              ).join('')}
            </select>
            <button class="cdx-btn-primary" id="cdx-qa-save">Save</button>
            <button class="cdx-icon-btn" id="cdx-qa-cancel">✕</button>
          </div>
        </div>
      </div>

      <!-- ── Settings (slides over main) ── -->
      <div class="cdx-settings" id="cdx-settings" style="display:none;">
        <div class="cdx-field-bar">
          <span class="cdx-field-label">Settings</span>
          <button class="cdx-icon-btn" id="cdx-settings-close">✕</button>
        </div>

        <label class="cdx-check"><input type="checkbox" id="cdx-s-enabled" /> Enable Codex</label>
        <label class="cdx-check"><input type="checkbox" id="cdx-s-nudge" /> Memory nudge notifications</label>

        <div class="cdx-setting-row">
          <span>Memories in prompt</span>
          <span id="cdx-maxmem-val">5</span>
          <input type="range" id="cdx-s-maxmem" min="1" max="10" value="5" />
        </div>
        <div class="cdx-setting-row">
          <span>Injection depth</span>
          <span id="cdx-depth-val">2</span>
          <input type="range" id="cdx-s-depth" min="0" max="6" value="2" />
        </div>

        <!-- Behavioral Modes (power user) -->
        <div class="cdx-modes-section">
          <div class="cdx-field-bar" style="margin-top:14px;">
            <span class="cdx-field-label">Behavioral Modes</span>
            <button class="cdx-text-btn" id="cdx-add-mode">+ add</button>
          </div>
          <div class="cdx-hint">Optional. For characters with distinct personas (e.g. public face vs private self). Active mode injects alongside the three fields above.</div>
          <div id="cdx-modes-list" class="cdx-modes-list"></div>
          <select id="cdx-template-select" class="cdx-mini-select" style="margin-top:6px;">
            <option value="">Load template…</option>
            ${Object.entries(STATE_TEMPLATES).map(([k, v]) =>
              `<option value="${k}">${v.name}</option>`
            ).join('')}
          </select>
        </div>

        <!-- Mode Editor (inline, hidden) -->
        <div id="cdx-mode-editor" style="display:none; margin-top:10px;">
          <input type="text" id="cdx-me-name" class="cdx-field-input" placeholder="Mode name (e.g. Public Persona)" />
          <textarea id="cdx-me-express" class="cdx-field-input" rows="2" placeholder="How they act in this mode…"></textarea>
          <textarea id="cdx-me-suppress" class="cdx-field-input" rows="2" placeholder="What the AI should NOT assume…"></textarea>
          <div class="cdx-qa-actions">
            <label class="cdx-check"><input type="checkbox" id="cdx-me-default" /> Default</label>
            <button class="cdx-btn-primary cdx-btn-sm" id="cdx-me-save">Save</button>
            <button class="cdx-icon-btn" id="cdx-me-cancel">✕</button>
          </div>
        </div>

        <button class="cdx-text-btn cdx-danger" id="cdx-clear-memories" style="margin-top:16px;">Clear all memories</button>
      </div>

    </div>
    `);

    panel.css({
        position: 'fixed',
        bottom: '60px',
        right: '15px',
        width: 'min(340px, calc(100vw - 30px))',
        maxHeight: '75vh',
        borderRadius: '12px',
        border: '1px solid rgba(255,255,255,0.1)',
        background: 'rgba(22,22,26,0.92)',
        backdropFilter: 'blur(16px)',
        color: '#ddd',
        zIndex: '31001',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
    });

    $('#form_sheld').length ? $('#form_sheld').append(panel) : $('body').append(panel);
}

// ─── Event Binding ───────────────────────────────────────────────────────────

function bindEvents() {
    $(document).on('click', '#cdx-close', () => $('#codex-panel').fadeOut(150));

    // Settings toggle
    $(document).on('click', '#cdx-settings-toggle', () => {
        if ($('#cdx-settings').is(':visible')) {
            $('#cdx-settings').slideUp(150);
            $('#cdx-main').slideDown(150);
        } else {
            renderSettings();
            $('#cdx-main').slideUp(150);
            $('#cdx-settings').slideDown(150);
        }
    });
    $(document).on('click', '#cdx-settings-close', () => {
        $('#cdx-settings').slideUp(150);
        $('#cdx-main').slideDown(150);
    });

    // ── Three fields — auto-save on blur ─────────────────────────────────
    $(document).on('blur', '#cdx-whats-changed', function () {
        const state = getChatState();
        state.whats_changed = $(this).val().trim();
        saveChatData();
        buildAndInject();
    });

    $(document).on('blur', '#cdx-growing-toward', function () {
        const state = getChatState();
        state.growing_toward = $(this).val().trim();
        saveChatData();
        buildAndInject();
    });

    // ── Memory quick-add ─────────────────────────────────────────────────
    $(document).on('click', '#cdx-add-memory', () => openQuickAdd(null));
    $(document).on('click', '#cdx-qa-save', saveFromQuickAdd);
    $(document).on('click', '#cdx-qa-cancel', closeQuickAdd);

    $(document).on('click', '.cdx-type-chip', function () {
        $('.cdx-type-chip').removeClass('cdx-type-active');
        $(this).addClass('cdx-type-active');
    });

    $(document).on('click', '.cdx-mem-edit', function () {
        const id = $(this).data('id');
        const mem = getMemories().find(m => m.id === id);
        if (mem) openQuickAdd(mem);
    });

    $(document).on('click', '.cdx-mem-delete', function () {
        const id = $(this).data('id');
        if (!confirm('Delete this memory?')) return;
        deleteMemory(id);
        renderMemories();
        buildAndInject();
    });

    $(document).on('click', '.cdx-mem-weight-btn', function () {
        const id = $(this).data('id');
        const mem = getMemories().find(m => m.id === id);
        if (!mem) return;
        const cycle = { minor: 'normal', normal: 'significant', significant: 'minor' };
        updateMemory(id, { weight: cycle[mem.weight] || 'normal' });
        renderMemories();
        buildAndInject();
    });

    // ── Settings ─────────────────────────────────────────────────────────
    $(document).on('change', '#cdx-s-enabled', function () {
        getSettings().enabled = this.checked;
        saveSettings();
        if (this.checked) buildAndInject();
    });
    $(document).on('change', '#cdx-s-nudge', function () {
        getSettings().enableNudge = this.checked;
        saveSettings();
    });
    $(document).on('input', '#cdx-s-maxmem', function () {
        const v = parseInt(this.value);
        getSettings().maxMemoriesInject = v;
        $('#cdx-maxmem-val').text(v);
        saveSettings();
        buildAndInject();
    });
    $(document).on('input', '#cdx-s-depth', function () {
        const v = parseInt(this.value);
        getSettings().injectionDepth = v;
        $('#cdx-depth-val').text(v);
        saveSettings();
        buildAndInject();
    });
    $(document).on('click', '#cdx-clear-memories', () => {
        if (!confirm('Clear ALL memories? Cannot be undone.')) return;
        const state = getChatState();
        state.memories = [];
        saveChatData();
        renderMemories();
        buildAndInject();
    });

    // ── Behavioral Modes (power user, in settings) ───────────────────────
    $(document).on('click', '#cdx-add-mode', () => openModeEditor(null));
    $(document).on('click', '#cdx-me-save', saveModeFromEditor);
    $(document).on('click', '#cdx-me-cancel', closeModeEditor);

    $(document).on('click', '.cdx-mode-activate', function () {
        const id = $(this).data('id');
        setActiveState(id);
        renderModes();
        buildAndInject();
    });
    $(document).on('click', '.cdx-mode-edit', function () {
        const id = $(this).data('id');
        const state = getStates().find(s => s.id === id);
        if (state) openModeEditor(state);
    });
    $(document).on('click', '.cdx-mode-delete', function () {
        const id = $(this).data('id');
        if (!confirm('Delete this mode?')) return;
        deleteState(id);
        renderModes();
        buildAndInject();
    });
    $(document).on('click', '#cdx-mode-deactivate', () => {
        setActiveState(null);
        renderModes();
        buildAndInject();
    });

    $(document).on('change', '#cdx-template-select', function () {
        const key = $(this).val();
        if (!key) return;
        if (!confirm(`Load "${STATE_TEMPLATES[key]?.name}" modes? Replaces existing.`)) {
            $(this).val('');
            return;
        }
        loadTemplate(key);
        $(this).val('');
        renderModes();
        buildAndInject();
        toastr.success('Modes loaded');
    });
}

// ─── Render Panel ────────────────────────────────────────────────────────────

function renderPanel() {
    const ctx = getContext();
    const chatState = getChatState();
    const charName = ctx?.name2 || 'Character';

    $('#cdx-char-name').text(charName);
    $('#cdx-whats-changed').val(chatState.whats_changed || '');
    $('#cdx-growing-toward').val(chatState.growing_toward || '');

    renderMemories();
}

// ─── Memory Rendering ────────────────────────────────────────────────────────

function renderMemories() {
    const memories = getMemories();
    $('#cdx-mem-count').text(`(${memories.length})`);

    if (!memories.length) {
        $('#cdx-mem-list').html(`<div class="cdx-empty">Memories build up as you chat, or add them manually.</div>`);
        return;
    }

    const sorted = [...memories].sort((a, b) => {
        const pw = { significant: 2, normal: 1, minor: 0 };
        const diff = (pw[b.weight] || 1) - (pw[a.weight] || 1);
        if (diff !== 0) return diff;
        return (new Date(b.timestamp || 0)) - (new Date(a.timestamp || 0));
    });

    const html = sorted.map(m => {
        const wm = MEMORY_WEIGHT_META[m.weight] || MEMORY_WEIGHT_META.normal;
        const tm = MEMORY_TYPE_META[m.type] || MEMORY_TYPE_META.trust;
        return `
        <div class="cdx-mem-item">
            <button class="cdx-mem-weight-btn" data-id="${m.id}" title="Tap to cycle: minor/normal/significant">${wm.icon}</button>
            <div class="cdx-mem-body">
                <div class="cdx-mem-text">${xss(m.text)}</div>
                <span class="cdx-mem-type" style="color:${tm.color}">${tm.icon}</span>
            </div>
            <div class="cdx-mem-actions">
                <button class="cdx-icon-btn cdx-mem-edit" data-id="${m.id}">✎</button>
                <button class="cdx-icon-btn cdx-mem-delete" data-id="${m.id}">🗑</button>
            </div>
        </div>`;
    }).join('');

    $('#cdx-mem-list').html(html);
}

// ─── Memory Quick-Add ────────────────────────────────────────────────────────

function openQuickAdd(memory) {
    editingMemory = memory;

    const typeChips = Object.entries(MEMORY_TYPE_META).map(([k, v]) => {
        const active = (memory?.type || 'trust') === k ? 'cdx-type-active' : '';
        return `<button class="cdx-type-chip ${active}" data-type="${k}" title="${v.label}">${v.icon}</button>`;
    }).join('');

    $('#cdx-qa-type-chips').html(typeChips);
    $('#cdx-qa-text').val(memory?.text || '');
    $('#cdx-qa-weight').val(memory?.weight || 'normal');
    $('#cdx-quick-add').slideDown(150);
    setTimeout(() => $('#cdx-qa-text').focus(), 160);
}

function closeQuickAdd() {
    editingMemory = null;
    $('#cdx-quick-add').slideUp(150);
    $('#cdx-qa-text').val('');
}

function saveFromQuickAdd() {
    const text = $('#cdx-qa-text').val().trim();
    if (!text) { toastr.warning('Write something to remember'); return; }

    const type = $('.cdx-type-chip.cdx-type-active').data('type') || 'trust';
    const weight = $('#cdx-qa-weight').val() || 'normal';
    const ctx = getContext();
    const msgIdx = ctx?.chat?.length || 0;

    if (editingMemory) {
        updateMemory(editingMemory.id, { text, type, weight });
    } else {
        addMemory(text, type, weight, msgIdx);
    }

    closeQuickAdd();
    renderMemories();
    buildAndInject();
}

// ─── Settings Rendering ──────────────────────────────────────────────────────

function renderSettings() {
    const settings = getSettings();
    $('#cdx-s-enabled').prop('checked', settings.enabled);
    $('#cdx-s-nudge').prop('checked', settings.enableNudge !== false);
    $('#cdx-s-maxmem').val(settings.maxMemoriesInject || 5);
    $('#cdx-maxmem-val').text(settings.maxMemoriesInject || 5);
    $('#cdx-s-depth').val(settings.injectionDepth || 2);
    $('#cdx-depth-val').text(settings.injectionDepth || 2);
    $('#cdx-template-select').val('');
    renderModes();
}

// ─── Behavioral Modes (Settings section) ─────────────────────────────────────

function renderModes() {
    const states = getStates();
    const active = getActiveState();
    const $list = $('#cdx-modes-list');

    if (!states.length) {
        $list.html('<div class="cdx-empty">No modes defined. Use templates or create your own.</div>');
        return;
    }

    const html = states.map(s => {
        const isActive = active && s.id === active.id;
        return `
        <div class="cdx-mode-item ${isActive ? 'cdx-mode-active' : ''}">
            <button class="cdx-mode-activate" data-id="${s.id}" title="Tap to activate">
                ${isActive ? '◉' : '○'} ${xss(s.name)}${s.is_default ? ' ★' : ''}
            </button>
            <div class="cdx-mode-item-actions">
                <button class="cdx-icon-btn cdx-mode-edit" data-id="${s.id}">✎</button>
                <button class="cdx-icon-btn cdx-mode-delete" data-id="${s.id}">🗑</button>
            </div>
        </div>`;
    }).join('');

    const deactivate = active
        ? '<button class="cdx-text-btn cdx-dim" id="cdx-mode-deactivate" style="margin-top:4px;">Clear active mode</button>'
        : '';

    $list.html(html + deactivate);
}

function openModeEditor(state) {
    $('#cdx-me-name').val(state?.name || '');
    $('#cdx-me-express').val(state?.express || '');
    $('#cdx-me-suppress').val(state?.suppress || '');
    $('#cdx-me-default').prop('checked', state?.is_default || false);
    $('#cdx-mode-editor').data('editing-id', state?.id || null).slideDown(150);
}

function closeModeEditor() {
    $('#cdx-mode-editor').slideUp(150);
}

function saveModeFromEditor() {
    const name = $('#cdx-me-name').val().trim();
    const express = $('#cdx-me-express').val().trim();
    const suppress = $('#cdx-me-suppress').val().trim();
    const isDefault = $('#cdx-me-default').prop('checked');
    const editingId = $('#cdx-mode-editor').data('editing-id');

    if (!name) { toastr.warning('Mode needs a name'); return; }

    if (editingId) {
        updateState(editingId, { name, express, suppress, is_default: isDefault });
    } else {
        const s = addState(name, express, suppress, isDefault);
        if (s && isDefault) setActiveState(s.id);
    }

    closeModeEditor();
    renderModes();
    buildAndInject();
}

// ─── Nudge ───────────────────────────────────────────────────────────────────

export function showNudge(draftText, suggestedType, messageIndex) {
    $('#codex-nudge').remove();

    const nudge = $(`
        <div id="codex-nudge" class="codex-nudge">
            <span class="cdx-nudge-text">💭 Something happened</span>
            <button class="cdx-nudge-btn cdx-nudge-save" id="cdx-nudge-save">Remember</button>
            <button class="cdx-nudge-btn" id="cdx-nudge-dismiss">✕</button>
        </div>
    `);

    nudge.css({
        position: 'fixed',
        bottom: '70px',
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '6px 14px',
        borderRadius: '20px',
        background: 'rgba(28,28,32,0.92)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.15)',
        color: '#ddd',
        fontSize: '13px',
        zIndex: '31002',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
    });

    $('body').append(nudge);
    recordNudgeShown(messageIndex);

    const timer = setTimeout(() => nudge.fadeOut(300, () => nudge.remove()), 10000);

    nudge.find('#cdx-nudge-save').on('click', () => {
        clearTimeout(timer);
        nudge.remove();
        $('#codex-panel').fadeIn(150);
        renderPanel();
        openQuickAdd(null);
        $('#cdx-qa-text').val(draftText);
        $('.cdx-type-chip').removeClass('cdx-type-active');
        $(`.cdx-type-chip[data-type="${suggestedType}"]`).addClass('cdx-type-active');
    });

    nudge.find('#cdx-nudge-dismiss').on('click', () => {
        clearTimeout(timer);
        nudge.fadeOut(300, () => nudge.remove());
    });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function xss(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
