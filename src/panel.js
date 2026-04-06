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
let editingState = null;

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
        title: 'Codex — Character & Story Engine',
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
        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
    });

    fab.on('click', togglePanel);
    $('#form_sheld').length ? $('#form_sheld').append(fab) : $('body').append(fab);
}

function togglePanel() {
    const $panel = $('#codex-panel');
    if ($panel.is(':visible')) {
        $panel.fadeOut(150);
    } else {
        renderActiveTab();
        $panel.fadeIn(150);
    }
}

// ─── Panel Shell ─────────────────────────────────────────────────────────────

function createPanel() {
    if ($('#codex-panel').length) return;

    const typeOptions = Object.entries(MEMORY_TYPE_META).map(([k, v]) =>
        `<option value="${k}">${v.icon} ${v.label}</option>`
    ).join('');

    const weightOptions = Object.entries(MEMORY_WEIGHT_META).map(([k, v]) =>
        `<option value="${k}">${v.icon} ${v.label}</option>`
    ).join('');

    const templateOptions = Object.entries(STATE_TEMPLATES).map(([k, v]) =>
        `<option value="${k}">${v.name}</option>`
    ).join('');

    const panel = $(`
    <div id="codex-panel" class="codex-panel" style="display:none;">
      <div class="codex-header">
        <span class="codex-title">📋 ${EXT_DISPLAY_NAME}</span>
        <button class="codex-close" id="codex-close">✕</button>
      </div>

      <div class="codex-tabs">
        <button class="codex-tab codex-tab-active" data-tab="character">Character</button>
        <button class="codex-tab" data-tab="story">Story</button>
        <button class="codex-tab" data-tab="settings">Settings</button>
      </div>

      <!-- ── CHARACTER TAB ── -->
      <div class="codex-pane" id="codex-pane-character">

        <!-- State Selector -->
        <div class="codex-section">
          <div class="codex-section-header">
            <span>Behavioral State</span>
            <select id="codex-state-select" class="codex-select"></select>
          </div>
          <div id="codex-state-display" class="codex-state-display"></div>
          <div class="codex-btn-row">
            <button class="codex-btn codex-btn-sm" id="codex-add-state">+ New State</button>
            <button class="codex-btn codex-btn-sm" id="codex-edit-state">Edit</button>
            <button class="codex-btn codex-btn-sm codex-btn-danger" id="codex-delete-state">Delete</button>
            <select id="codex-template-select" class="codex-select codex-select-sm">
              <option value="">Load template…</option>
              ${templateOptions}
            </select>
          </div>
        </div>

        <!-- State Editor (hidden by default) -->
        <div id="codex-state-editor" class="codex-section" style="display:none;">
          <div class="codex-section-header"><span id="codex-state-editor-title">New State</span></div>
          <label>Name</label>
          <input type="text" id="codex-se-name" placeholder="e.g. Relaxed, Hunting, Public Persona…" />
          <label>EXPRESS <span class="codex-hint">(what traits ARE active now)</span></label>
          <textarea id="codex-se-express" rows="3" placeholder="Warm, genuine humor, makes eye contact…"></textarea>
          <label>SUPPRESS <span class="codex-hint">(what the AI should NOT assume)</span></label>
          <textarea id="codex-se-suppress" rows="3" placeholder="Do NOT write calculating behavior. Do NOT imply hidden motives…"></textarea>
          <label class="codex-check"><input type="checkbox" id="codex-se-default" /> Set as default state</label>
          <div class="codex-btn-row">
            <button class="codex-btn codex-btn-primary" id="codex-se-save">Save State</button>
            <button class="codex-btn" id="codex-se-cancel">Cancel</button>
          </div>
        </div>

        <!-- Relationship Summary -->
        <div class="codex-section">
          <div class="codex-section-header">
            <span>Relationship</span>
            <div class="codex-btn-row-inline">
              <button class="codex-btn codex-btn-sm" id="codex-rel-edit" title="Edit">✏️</button>
              <button class="codex-btn codex-btn-sm" id="codex-rel-regen" title="Regenerate from memories">🔄</button>
            </div>
          </div>
          <div id="codex-rel-display" class="codex-rel-display"></div>
          <div id="codex-rel-editor" style="display:none;">
            <textarea id="codex-rel-text" rows="3"></textarea>
            <div class="codex-btn-row">
              <button class="codex-btn codex-btn-primary codex-btn-sm" id="codex-rel-save">Save</button>
              <button class="codex-btn codex-btn-sm" id="codex-rel-cancel">Cancel</button>
            </div>
          </div>
        </div>

        <!-- Memories -->
        <div class="codex-section">
          <div class="codex-section-header">
            <span>Memories <span id="codex-mem-count" class="codex-count"></span></span>
            <button class="codex-btn codex-btn-sm" id="codex-add-memory">+ Add</button>
          </div>
          <div id="codex-mem-list" class="codex-mem-list"></div>
        </div>

        <!-- Memory Editor (hidden by default) -->
        <div id="codex-mem-editor" class="codex-section" style="display:none;">
          <div class="codex-section-header"><span id="codex-mem-editor-title">Add Memory</span></div>
          <label>What happened?</label>
          <textarea id="codex-me-text" rows="2" placeholder="e.g. Danny admitted he doesn't sleep well…"></textarea>
          <div class="codex-inline-row">
            <div>
              <label>Type</label>
              <select id="codex-me-type">${typeOptions}</select>
            </div>
            <div>
              <label>Weight</label>
              <select id="codex-me-weight">${weightOptions}</select>
            </div>
          </div>
          <div class="codex-btn-row">
            <button class="codex-btn codex-btn-primary" id="codex-me-save">Save Memory</button>
            <button class="codex-btn" id="codex-me-cancel">Cancel</button>
          </div>
        </div>

      </div>

      <!-- ── STORY TAB (Phase 2 placeholder) ── -->
      <div class="codex-pane" id="codex-pane-story" style="display:none;">
        <div class="codex-placeholder">
          <p>📖 Story tracking coming in Phase 2</p>
          <p class="codex-hint">Thread management, writing directives, and plot pacing.</p>
        </div>
      </div>

      <!-- ── SETTINGS TAB ── -->
      <div class="codex-pane" id="codex-pane-settings" style="display:none;">
        <div class="codex-section">
          <label class="codex-check">
            <input type="checkbox" id="codex-s-enabled" />
            <b>Enable Codex</b>
          </label>
        </div>
        <div class="codex-section">
          <label class="codex-check">
            <input type="checkbox" id="codex-s-nudge" />
            <b>Memory nudge notifications</b>
          </label>
          <div class="codex-hint">Shows a prompt when notable moments are detected in AI responses.</div>
        </div>
        <div class="codex-section">
          <label class="codex-check">
            <input type="checkbox" id="codex-s-autorel" />
            Auto-regenerate relationship summary
          </label>
          <div class="codex-hint">Updates the summary when memories change. Disable to keep manual edits.</div>
        </div>
        <div class="codex-section">
          <div class="codex-setting-label"><b>Max memories in injection</b> <span id="codex-maxmem-val">5</span></div>
          <input type="range" id="codex-s-maxmem" min="1" max="10" value="5" />
        </div>
        <div class="codex-section">
          <div class="codex-setting-label"><b>Injection depth</b> <span id="codex-depth-val">2</span>
            <span class="codex-hint">(higher = earlier in context)</span>
          </div>
          <input type="range" id="codex-s-depth" min="0" max="6" value="2" />
        </div>
        <div class="codex-section">
          <button class="codex-btn codex-btn-danger" id="codex-clear-memories">Clear All Memories</button>
        </div>
      </div>

    </div>
    `);

    panel.css({
        position: 'fixed',
        bottom: '60px',
        right: '15px',
        width: '340px',
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
    // Panel close
    $(document).on('click', '#codex-close', () => $('#codex-panel').fadeOut(150));

    // Tabs
    $(document).on('click', '.codex-tab', function () {
        const tab = $(this).data('tab');
        $('.codex-tab').removeClass('codex-tab-active');
        $(this).addClass('codex-tab-active');
        $('.codex-pane').hide();
        $(`#codex-pane-${tab}`).show();
        renderActiveTab();
    });

    // ── State events ─────────────────────────────────────────────────────
    $(document).on('change', '#codex-state-select', function () {
        const stateId = $(this).val();
        if (stateId) {
            setActiveState(stateId);
            renderStateDisplay();
            buildAndInject();
        }
    });

    $(document).on('click', '#codex-add-state', () => openStateEditor(null));
    $(document).on('click', '#codex-edit-state', () => {
        const active = getActiveState();
        if (active) openStateEditor(active);
        else toastr.info('No state selected to edit');
    });
    $(document).on('click', '#codex-delete-state', () => {
        const active = getActiveState();
        if (!active) return;
        if (!confirm(`Delete state "${active.name}"?`)) return;
        deleteState(active.id);
        renderStateSection();
        buildAndInject();
        toastr.info('State deleted');
    });

    $(document).on('click', '#codex-se-save', saveStateFromEditor);
    $(document).on('click', '#codex-se-cancel', closeStateEditor);

    $(document).on('change', '#codex-template-select', function () {
        const key = $(this).val();
        if (!key) return;
        if (!confirm(`Load "${STATE_TEMPLATES[key]?.name}" template? This replaces existing states.`)) {
            $(this).val('');
            return;
        }
        loadTemplate(key);
        $(this).val('');
        renderStateSection();
        buildAndInject();
        toastr.success('Template loaded');
    });

    // ── Relationship events ──────────────────────────────────────────────
    $(document).on('click', '#codex-rel-edit', () => {
        $('#codex-rel-display').hide();
        $('#codex-rel-editor').show();
        $('#codex-rel-text').val(getRelationshipSummary());
    });
    $(document).on('click', '#codex-rel-save', () => {
        setRelationshipSummary($('#codex-rel-text').val());
        $('#codex-rel-editor').hide();
        $('#codex-rel-display').show();
        renderRelationship();
        buildAndInject();
    });
    $(document).on('click', '#codex-rel-cancel', () => {
        $('#codex-rel-editor').hide();
        $('#codex-rel-display').show();
    });
    $(document).on('click', '#codex-rel-regen', () => {
        regenerateSummary();
        renderRelationship();
        buildAndInject();
        toastr.success('Summary regenerated');
    });

    // ── Memory events ────────────────────────────────────────────────────
    $(document).on('click', '#codex-add-memory', () => openMemoryEditor(null));
    $(document).on('click', '#codex-me-save', saveMemoryFromEditor);
    $(document).on('click', '#codex-me-cancel', closeMemoryEditor);

    $(document).on('click', '.codex-mem-edit', function () {
        const id = $(this).data('id');
        const memories = getMemories();
        const mem = memories.find(m => m.id === id);
        if (mem) openMemoryEditor(mem);
    });

    $(document).on('click', '.codex-mem-delete', function () {
        const id = $(this).data('id');
        if (!confirm('Delete this memory?')) return;
        deleteMemory(id);
        maybeRegenerateSummary();
        renderMemories();
        renderRelationship();
        buildAndInject();
    });

    // ── Settings events ──────────────────────────────────────────────────
    $(document).on('change', '#codex-s-enabled', function () {
        getSettings().enabled = this.checked;
        saveSettings();
        if (this.checked) buildAndInject();
    });
    $(document).on('change', '#codex-s-nudge', function () {
        getSettings().enableNudge = this.checked;
        saveSettings();
    });
    $(document).on('change', '#codex-s-autorel', function () {
        const state = getChatState();
        state.relationship_auto = this.checked;
        saveChatData();
        if (this.checked) {
            regenerateSummary();
            renderRelationship();
            buildAndInject();
        }
    });
    $(document).on('input', '#codex-s-maxmem', function () {
        const v = parseInt(this.value);
        getSettings().maxMemoriesInject = v;
        $('#codex-maxmem-val').text(v);
        saveSettings();
        buildAndInject();
    });
    $(document).on('input', '#codex-s-depth', function () {
        const v = parseInt(this.value);
        getSettings().injectionDepth = v;
        $('#codex-depth-val').text(v);
        saveSettings();
        buildAndInject();
    });
    $(document).on('click', '#codex-clear-memories', () => {
        if (!confirm('Clear ALL memories for this chat? This cannot be undone.')) return;
        const state = getChatState();
        state.memories = [];
        state.relationship_summary = '';
        saveChatData();
        renderMemories();
        renderRelationship();
        buildAndInject();
        toastr.info('All memories cleared');
    });
}

// ─── Tab Rendering ───────────────────────────────────────────────────────────

function renderActiveTab() {
    const active = $('.codex-tab-active').data('tab');
    if (active === 'character') renderCharacterTab();
    else if (active === 'settings') renderSettingsTab();
}

function renderCharacterTab() {
    renderStateSection();
    renderRelationship();
    renderMemories();
}

// ─── State Rendering ─────────────────────────────────────────────────────────

function renderStateSection() {
    const states = getStates();
    const active = getActiveState();
    const $select = $('#codex-state-select').empty();

    if (!states.length) {
        $select.append('<option value="">(no states defined)</option>');
        $('#codex-state-display').html('<div class="codex-hint">Define behavioral states to control how the character acts. Use a template to get started.</div>');
        return;
    }

    for (const s of states) {
        const selected = active && s.id === active.id ? 'selected' : '';
        $select.append(`<option value="${s.id}" ${selected}>${s.name}${s.is_default ? ' (default)' : ''}</option>`);
    }

    renderStateDisplay();
}

function renderStateDisplay() {
    const active = getActiveState();
    if (!active) {
        $('#codex-state-display').html('<div class="codex-hint">No state selected.</div>');
        return;
    }

    const html = `
        <div class="codex-state-block">
            ${active.express ? `<div class="codex-state-line"><span class="codex-state-tag codex-express-tag">EXPRESS</span> ${xss(active.express)}</div>` : ''}
            ${active.suppress ? `<div class="codex-state-line"><span class="codex-state-tag codex-suppress-tag">SUPPRESS</span> ${xss(active.suppress)}</div>` : ''}
        </div>
    `;
    $('#codex-state-display').html(html);
}

// ─── State Editor ────────────────────────────────────────────────────────────

function openStateEditor(state) {
    editingState = state;
    $('#codex-state-editor-title').text(state ? `Edit: ${state.name}` : 'New State');
    $('#codex-se-name').val(state?.name || '');
    $('#codex-se-express').val(state?.express || '');
    $('#codex-se-suppress').val(state?.suppress || '');
    $('#codex-se-default').prop('checked', state?.is_default || false);
    $('#codex-state-editor').slideDown(150);
}

function closeStateEditor() {
    editingState = null;
    $('#codex-state-editor').slideUp(150);
}

function saveStateFromEditor() {
    const name = $('#codex-se-name').val().trim();
    const express = $('#codex-se-express').val().trim();
    const suppress = $('#codex-se-suppress').val().trim();
    const isDefault = $('#codex-se-default').prop('checked');

    if (!name) { toastr.warning('State needs a name'); return; }
    if (!express && !suppress) { toastr.warning('Add at least an EXPRESS or SUPPRESS directive'); return; }

    if (editingState) {
        updateState(editingState.id, { name, express, suppress, is_default: isDefault });
    } else {
        const newState = addState(name, express, suppress, isDefault);
        if (newState && isDefault) setActiveState(newState.id);
    }

    closeStateEditor();
    renderStateSection();
    buildAndInject();
    toastr.success(`State "${name}" saved`);
}

// ─── Relationship Rendering ──────────────────────────────────────────────────

function renderRelationship() {
    const summary = getRelationshipSummary();
    if (summary) {
        $('#codex-rel-display').html(`<div class="codex-rel-text">${xss(summary)}</div>`);
    } else {
        $('#codex-rel-display').html('<div class="codex-hint">No relationship data yet. Add memories to build a relationship summary.</div>');
    }
}

// ─── Memory Rendering ────────────────────────────────────────────────────────

function renderMemories() {
    const memories = getMemories();
    const $list = $('#codex-mem-list');
    const $count = $('#codex-mem-count');

    $count.text(`(${memories.length}/30)`);

    if (!memories.length) {
        $list.html('<div class="codex-hint">No memories yet. Click + Add or wait for a nudge during roleplay.</div>');
        return;
    }

    // Sort: significant first, then normal, then minor. Within each, newest first.
    const sorted = [...memories].sort((a, b) => {
        const pw = { significant: 2, normal: 1, minor: 0 };
        const diff = (pw[b.weight] || 1) - (pw[a.weight] || 1);
        if (diff !== 0) return diff;
        const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return tb - ta;
    });

    const html = sorted.map(m => {
        const typeMeta = MEMORY_TYPE_META[m.type] || { icon: '●', label: m.type };
        const weightMeta = MEMORY_WEIGHT_META[m.weight] || { icon: '●' };

        return `
        <div class="codex-mem-item">
            <div class="codex-mem-top">
                <span class="codex-mem-weight">${weightMeta.icon}</span>
                <span class="codex-mem-text">${xss(m.text)}</span>
            </div>
            <div class="codex-mem-meta">
                <span class="codex-badge" style="border-color:${typeMeta.color}">${typeMeta.icon} ${typeMeta.label}</span>
                <span class="codex-mem-actions">
                    <button class="codex-icon-btn codex-mem-edit" data-id="${m.id}" title="Edit">✏️</button>
                    <button class="codex-icon-btn codex-mem-delete" data-id="${m.id}" title="Delete">🗑️</button>
                </span>
            </div>
        </div>`;
    }).join('');

    $list.html(html);
}

// ─── Memory Editor ───────────────────────────────────────────────────────────

function openMemoryEditor(memory) {
    editingMemory = memory;
    $('#codex-mem-editor-title').text(memory ? 'Edit Memory' : 'Add Memory');
    $('#codex-me-text').val(memory?.text || '');
    $('#codex-me-type').val(memory?.type || 'trust');
    $('#codex-me-weight').val(memory?.weight || 'normal');
    $('#codex-mem-editor').slideDown(150);
}

function closeMemoryEditor() {
    editingMemory = null;
    $('#codex-mem-editor').slideUp(150);
    $('#codex-me-text').val('');
}

function saveMemoryFromEditor() {
    const text = $('#codex-me-text').val().trim();
    const type = $('#codex-me-type').val();
    const weight = $('#codex-me-weight').val();

    if (!text) { toastr.warning('Memory needs text'); return; }

    const ctx = getContext();
    const msgIdx = ctx?.chat?.length || 0;

    if (editingMemory) {
        updateMemory(editingMemory.id, { text, type, weight });
    } else {
        addMemory(text, type, weight, msgIdx);
    }

    closeMemoryEditor();
    maybeRegenerateSummary();
    renderMemories();
    renderRelationship();
    buildAndInject();
    toastr.success('Memory saved');
}

// ─── Settings Rendering ──────────────────────────────────────────────────────

function renderSettingsTab() {
    const settings = getSettings();
    const chatState = getChatState();
    $('#codex-s-enabled').prop('checked', settings.enabled);
    $('#codex-s-nudge').prop('checked', settings.enableNudge !== false);
    $('#codex-s-autorel').prop('checked', chatState.relationship_auto !== false);
    $('#codex-s-maxmem').val(settings.maxMemoriesInject || 5);
    $('#codex-maxmem-val').text(settings.maxMemoriesInject || 5);
    $('#codex-s-depth').val(settings.injectionDepth || 2);
    $('#codex-depth-val').text(settings.injectionDepth || 2);
}

// ─── Nudge Notification ──────────────────────────────────────────────────────

/**
 * Show a memory nudge notification. Called from the message handler in index.js.
 */
export function showNudge(draftText, suggestedType, messageIndex) {
    // Remove existing nudge
    $('#codex-nudge').remove();

    const typeMeta = MEMORY_TYPE_META[suggestedType] || MEMORY_TYPE_META.trust;

    const nudge = $(`
        <div id="codex-nudge" class="codex-nudge">
            <span class="codex-nudge-text">💭 Notable moment?</span>
            <button class="codex-btn codex-btn-sm codex-btn-primary" id="codex-nudge-save">Save Memory</button>
            <button class="codex-btn codex-btn-sm" id="codex-nudge-dismiss">Dismiss</button>
        </div>
    `);

    nudge.css({
        position: 'fixed',
        bottom: '70px',
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '8px 16px',
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

    // Auto-dismiss after 10 seconds
    const timer = setTimeout(() => nudge.fadeOut(300, () => nudge.remove()), 10000);

    nudge.find('#codex-nudge-save').on('click', () => {
        clearTimeout(timer);
        nudge.remove();
        // Open panel to memory editor with pre-filled draft
        $('#codex-panel').fadeIn(150);
        openMemoryEditor(null);
        $('#codex-me-text').val(draftText);
        $('#codex-me-type').val(suggestedType);
    });

    nudge.find('#codex-nudge-dismiss').on('click', () => {
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
