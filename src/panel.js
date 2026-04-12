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
import { getRelationshipSummary, setRelationshipSummary, regenerateSummary, maybeRegenerateSummary } from './relationship.js';
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
        transition: 'transform 0.15s ease',
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

      <!-- Header -->
      <div class="cdx-header">
        <span class="cdx-char-name" id="cdx-char-name"></span>
        <div class="cdx-header-actions">
          <button class="cdx-icon-btn" id="cdx-settings-toggle" title="Settings">⚙️</button>
          <button class="cdx-icon-btn" id="cdx-close" title="Close">✕</button>
        </div>
      </div>

      <!-- Main View (profile page) -->
      <div class="cdx-main" id="cdx-main">

        <!-- Mood Chips -->
        <div class="cdx-mood-section" id="cdx-mood-section"></div>

        <!-- Relationship -->
        <div class="cdx-relationship" id="cdx-relationship"></div>

        <!-- Memories -->
        <div class="cdx-memories-section">
          <div class="cdx-section-bar">
            <span class="cdx-section-label">Memories <span id="cdx-mem-count" class="cdx-dim"></span></span>
            <button class="cdx-text-btn" id="cdx-add-memory">+ add</button>
          </div>
          <div id="cdx-mem-list" class="cdx-mem-list"></div>
        </div>

      </div>

      <!-- Memory Quick-Add (slides up when adding) -->
      <div class="cdx-quick-add" id="cdx-quick-add" style="display:none;">
        <textarea id="cdx-qa-text" rows="2" placeholder="What happened?"></textarea>
        <div class="cdx-qa-row">
          <div class="cdx-qa-chips" id="cdx-qa-type-chips"></div>
          <div class="cdx-qa-actions">
            <select id="cdx-qa-weight" class="cdx-mini-select">
              ${Object.entries(MEMORY_WEIGHT_META).map(([k, v]) =>
                `<option value="${k}">${v.icon} ${v.label}</option>`
              ).join('')}
            </select>
            <button class="cdx-btn-save" id="cdx-qa-save">Save</button>
            <button class="cdx-icon-btn" id="cdx-qa-cancel">✕</button>
          </div>
        </div>
      </div>

      <!-- State Customizer (hidden, shown via gear on mood chip) -->
      <div class="cdx-state-editor" id="cdx-state-editor" style="display:none;">
        <div class="cdx-section-bar">
          <span class="cdx-section-label" id="cdx-se-title">Edit Mood</span>
          <button class="cdx-icon-btn" id="cdx-se-close">✕</button>
        </div>
        <input type="text" id="cdx-se-name" placeholder="Name (e.g. Relaxed)" class="cdx-input" />
        <textarea id="cdx-se-express" rows="2" placeholder="How they act in this mood…" class="cdx-input"></textarea>
        <textarea id="cdx-se-suppress" rows="2" placeholder="What the AI should NOT assume…" class="cdx-input"></textarea>
        <div class="cdx-qa-actions">
          <label class="cdx-check-sm"><input type="checkbox" id="cdx-se-default" /> Default</label>
          <button class="cdx-btn-save" id="cdx-se-save">Save</button>
          <button class="cdx-text-btn cdx-danger" id="cdx-se-delete" style="display:none;">Delete</button>
        </div>
      </div>

      <!-- Relationship Editor (slides up when editing) -->
      <div class="cdx-rel-editor" id="cdx-rel-editor" style="display:none;">
        <textarea id="cdx-rel-text" rows="3" class="cdx-input" placeholder="Describe the relationship…"></textarea>
        <div class="cdx-qa-actions">
          <button class="cdx-btn-save" id="cdx-rel-save">Save</button>
          <button class="cdx-icon-btn" id="cdx-rel-cancel">✕</button>
        </div>
      </div>

      <!-- Settings Panel (slides over main) -->
      <div class="cdx-settings" id="cdx-settings" style="display:none;">
        <div class="cdx-section-bar">
          <span class="cdx-section-label">Settings</span>
          <button class="cdx-icon-btn" id="cdx-settings-close">✕</button>
        </div>

        <label class="cdx-check-sm"><input type="checkbox" id="cdx-s-enabled" /> Enable Codex</label>
        <label class="cdx-check-sm"><input type="checkbox" id="cdx-s-nudge" /> Memory nudge notifications</label>
        <label class="cdx-check-sm"><input type="checkbox" id="cdx-s-autorel" /> Auto-update relationship summary</label>

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

        <div class="cdx-setting-row" style="margin-top:12px;">
          <span>Quick Setup</span>
          <select id="cdx-template-select" class="cdx-mini-select">
            <option value="">Load mood template…</option>
            ${Object.entries(STATE_TEMPLATES).map(([k, v]) =>
              `<option value="${k}">${v.name}</option>`
            ).join('')}
          </select>
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
        const vis = $('#cdx-settings').is(':visible');
        if (vis) {
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

    // ── Mood chips ───────────────────────────────────────────────────────
    $(document).on('click', '.cdx-mood-chip', function () {
        const stateId = $(this).data('id');
        if (stateId === 'add_new') {
            openStateEditor(null);
            return;
        }
        setActiveState(stateId);
        renderMoods();
        buildAndInject();
    });

    // Long-press / edit gear on mood chip
    $(document).on('click', '.cdx-mood-edit', function (e) {
        e.stopPropagation();
        const stateId = $(this).closest('.cdx-mood-chip').data('id');
        const states = getStates();
        const state = states.find(s => s.id === stateId);
        if (state) openStateEditor(state);
    });

    // State editor
    $(document).on('click', '#cdx-se-save', saveStateFromEditor);
    $(document).on('click', '#cdx-se-close', closeStateEditor);
    $(document).on('click', '#cdx-se-delete', () => {
        const id = $('#cdx-state-editor').data('editing-id');
        if (!id) return;
        if (!confirm('Delete this mood?')) return;
        deleteState(id);
        closeStateEditor();
        renderMoods();
        buildAndInject();
    });

    // ── Relationship ─────────────────────────────────────────────────────
    $(document).on('click', '#cdx-rel-edit-btn', () => {
        $('#cdx-rel-text').val(getRelationshipSummary());
        $('#cdx-rel-editor').slideDown(150);
    });
    $(document).on('click', '#cdx-rel-regen-btn', () => {
        regenerateSummary();
        renderRelationship();
        buildAndInject();
    });
    $(document).on('click', '#cdx-rel-save', () => {
        setRelationshipSummary($('#cdx-rel-text').val());
        $('#cdx-rel-editor').slideUp(150);
        renderRelationship();
        buildAndInject();
    });
    $(document).on('click', '#cdx-rel-cancel', () => {
        $('#cdx-rel-editor').slideUp(150);
    });

    // ── Memory quick-add ─────────────────────────────────────────────────
    $(document).on('click', '#cdx-add-memory', () => openQuickAdd(null));
    $(document).on('click', '#cdx-qa-save', saveFromQuickAdd);
    $(document).on('click', '#cdx-qa-cancel', closeQuickAdd);

    // Type chips in quick-add
    $(document).on('click', '.cdx-type-chip', function () {
        $('.cdx-type-chip').removeClass('cdx-type-active');
        $(this).addClass('cdx-type-active');
    });

    // Memory inline actions
    $(document).on('click', '.cdx-mem-edit', function () {
        const id = $(this).data('id');
        const mem = getMemories().find(m => m.id === id);
        if (mem) openQuickAdd(mem);
    });
    $(document).on('click', '.cdx-mem-delete', function () {
        const id = $(this).data('id');
        if (!confirm('Delete this memory?')) return;
        deleteMemory(id);
        maybeRegenerateSummary();
        renderMemories();
        renderRelationship();
        buildAndInject();
    });
    // Memory weight cycle on tap
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
    $(document).on('change', '#cdx-s-autorel', function () {
        getChatState().relationship_auto = this.checked;
        saveChatData();
        if (this.checked) { regenerateSummary(); renderRelationship(); buildAndInject(); }
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
    $(document).on('change', '#cdx-template-select', function () {
        const key = $(this).val();
        if (!key) return;
        if (!confirm(`Load "${STATE_TEMPLATES[key]?.name}" moods? This replaces existing moods.`)) {
            $(this).val('');
            return;
        }
        loadTemplate(key);
        $(this).val('');
        renderMoods();
        buildAndInject();
        toastr.success('Moods loaded');
    });
    $(document).on('click', '#cdx-clear-memories', () => {
        if (!confirm('Clear ALL memories? Cannot be undone.')) return;
        const state = getChatState();
        state.memories = [];
        state.relationship_summary = '';
        saveChatData();
        renderMemories();
        renderRelationship();
        buildAndInject();
    });
}

// ─── Render All ──────────────────────────────────────────────────────────────

function renderPanel() {
    const ctx = getContext();
    const charName = ctx?.name2 || 'Character';
    const memories = getMemories();
    const states = getStates();

    $('#cdx-char-name').text(charName);

    // Show welcome state if completely empty
    if (!states.length && !memories.length) {
        renderWelcome(charName);
        return;
    }

    renderMoods();
    renderRelationship();
    renderMemories();
}

function renderWelcome(charName) {
    $('#cdx-mood-section').html(`
        <div class="cdx-welcome">
            <div class="cdx-welcome-text">Ready to learn about <b>${xss(charName)}</b></div>
            <div class="cdx-welcome-hint">Memories build naturally as you chat. Set up moods to control how they act.</div>
            <div class="cdx-welcome-actions">
                ${Object.entries(STATE_TEMPLATES).map(([k, v]) =>
                    `<button class="cdx-welcome-btn" data-template="${k}">${v.name}</button>`
                ).join('')}
            </div>
        </div>
    `);

    // Bind welcome template buttons
    $('.cdx-welcome-btn').off('click').on('click', function () {
        const key = $(this).data('template');
        loadTemplate(key);
        renderPanel();
        buildAndInject();
        toastr.success('Moods loaded — tap to switch');
    });

    renderRelationship();
    renderMemories();
}

// ─── Mood Chips ──────────────────────────────────────────────────────────────

function renderMoods() {
    const states = getStates();
    const active = getActiveState();

    if (!states.length) {
        $('#cdx-mood-section').html(`
            <div class="cdx-mood-empty">
                <button class="cdx-text-btn" id="cdx-mood-setup">Set up moods</button>
            </div>
        `);
        $(document).off('click', '#cdx-mood-setup').on('click', '#cdx-mood-setup', () => {
            openStateEditor(null);
        });
        return;
    }

    const chips = states.map(s => {
        const isActive = active && s.id === active.id;
        return `
            <div class="cdx-mood-chip ${isActive ? 'cdx-mood-active' : ''}" data-id="${s.id}">
                <span class="cdx-mood-label">${xss(s.name)}</span>
                <span class="cdx-mood-edit" title="Edit">✎</span>
            </div>
        `;
    }).join('');

    const addChip = `<div class="cdx-mood-chip cdx-mood-add" data-id="add_new">+</div>`;

    $('#cdx-mood-section').html(`<div class="cdx-mood-row">${chips}${addChip}</div>`);

    // Show active state's directives as a subtle preview
    if (active) {
        const preview = active.express
            ? active.express.substring(0, 80) + (active.express.length > 80 ? '…' : '')
            : '';
        if (preview) {
            $('#cdx-mood-section').append(`<div class="cdx-mood-preview">${xss(preview)}</div>`);
        }
    }
}

// ─── State Editor ────────────────────────────────────────────────────────────

function openStateEditor(state) {
    $('#cdx-se-title').text(state ? `Edit: ${state.name}` : 'New Mood');
    $('#cdx-se-name').val(state?.name || '');
    $('#cdx-se-express').val(state?.express || '');
    $('#cdx-se-suppress').val(state?.suppress || '');
    $('#cdx-se-default').prop('checked', state?.is_default || false);
    $('#cdx-se-delete').toggle(!!state);
    $('#cdx-state-editor').data('editing-id', state?.id || null);
    $('#cdx-main').slideUp(150);
    $('#cdx-state-editor').slideDown(150);
}

function closeStateEditor() {
    $('#cdx-state-editor').slideUp(150);
    $('#cdx-main').slideDown(150);
}

function saveStateFromEditor() {
    const name = $('#cdx-se-name').val().trim();
    const express = $('#cdx-se-express').val().trim();
    const suppress = $('#cdx-se-suppress').val().trim();
    const isDefault = $('#cdx-se-default').prop('checked');
    const editingId = $('#cdx-state-editor').data('editing-id');

    if (!name) { toastr.warning('Give it a name'); return; }

    if (editingId) {
        updateState(editingId, { name, express, suppress, is_default: isDefault });
    } else {
        const newState = addState(name, express, suppress, isDefault);
        if (newState) setActiveState(newState.id);
    }

    closeStateEditor();
    renderMoods();
    buildAndInject();
}

// ─── Relationship ────────────────────────────────────────────────────────────

function renderRelationship() {
    const summary = getRelationshipSummary();
    const memories = getMemories();

    if (!summary && !memories.length) {
        $('#cdx-relationship').html(`
            <div class="cdx-rel-empty cdx-dim">Memories will shape how ${xss(getContext()?.name2 || 'they')} see you.</div>
        `);
        return;
    }

    const displayText = summary || 'No relationship summary yet.';

    $('#cdx-relationship').html(`
        <div class="cdx-rel-block">
            <div class="cdx-rel-text">${xss(displayText)}</div>
            <div class="cdx-rel-actions">
                <button class="cdx-icon-btn cdx-dim" id="cdx-rel-edit-btn" title="Edit">✏️</button>
                <button class="cdx-icon-btn cdx-dim" id="cdx-rel-regen-btn" title="Regenerate">🔄</button>
            </div>
        </div>
    `);
}

// ─── Memories ────────────────────────────────────────────────────────────────

function renderMemories() {
    const memories = getMemories();
    $('#cdx-mem-count').text(`(${memories.length}/30)`);

    if (!memories.length) {
        $('#cdx-mem-list').html(`<div class="cdx-dim cdx-mem-empty">Memories appear here as you chat, or add them manually.</div>`);
        return;
    }

    // Sort: significant → normal → minor, newest first within each
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
            <button class="cdx-mem-weight-btn" data-id="${m.id}" title="Tap to cycle weight">${wm.icon}</button>
            <div class="cdx-mem-body">
                <div class="cdx-mem-text">${xss(m.text)}</div>
                <span class="cdx-mem-type" style="color:${tm.color}">${tm.icon} ${tm.label}</span>
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

    // Build type chips
    const typeChips = Object.entries(MEMORY_TYPE_META).map(([k, v]) => {
        const active = (memory?.type || 'trust') === k ? 'cdx-type-active' : '';
        return `<button class="cdx-type-chip ${active}" data-type="${k}" title="${v.label}">${v.icon}</button>`;
    }).join('');

    $('#cdx-qa-type-chips').html(typeChips);
    $('#cdx-qa-text').val(memory?.text || '');
    $('#cdx-qa-weight').val(memory?.weight || 'normal');
    $('#cdx-quick-add').slideDown(150);
    $('#cdx-qa-text').focus();
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
    maybeRegenerateSummary();
    renderMemories();
    renderRelationship();
    buildAndInject();
}

// ─── Settings ────────────────────────────────────────────────────────────────

function renderSettings() {
    const settings = getSettings();
    const chatState = getChatState();
    $('#cdx-s-enabled').prop('checked', settings.enabled);
    $('#cdx-s-nudge').prop('checked', settings.enableNudge !== false);
    $('#cdx-s-autorel').prop('checked', chatState.relationship_auto !== false);
    $('#cdx-s-maxmem').val(settings.maxMemoriesInject || 5);
    $('#cdx-maxmem-val').text(settings.maxMemoriesInject || 5);
    $('#cdx-s-depth').val(settings.injectionDepth || 2);
    $('#cdx-depth-val').text(settings.injectionDepth || 2);
    $('#cdx-template-select').val('');
}

// ─── Nudge Notification ──────────────────────────────────────────────────────

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
        animation: 'cdx-nudge-in 0.3s ease-out',
    });

    $('body').append(nudge);
    recordNudgeShown(messageIndex);

    const timer = setTimeout(() => nudge.fadeOut(300, () => nudge.remove()), 10000);

    nudge.find('#cdx-nudge-save').on('click', () => {
        clearTimeout(timer);
        nudge.remove();
        // Open panel with quick-add pre-filled
        $('#codex-panel').fadeIn(150);
        renderPanel();
        openQuickAdd(null);
        $('#cdx-qa-text').val(draftText);
        // Set the suggested type chip active
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
