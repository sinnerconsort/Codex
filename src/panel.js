import { getContext } from '../../../../extensions.js';
import { eventSource, event_types } from '../../../../../script.js';
import {
    getSettings, getChatState, sanitizeChatState, getCharacterKey,
    saveSettings, saveChatData,
} from './state.js';
import {
    addMemory, updateMemory, deleteMemory, getMemories,
    detectNudgeSignals, recordNudgeShown, draftMemoryFromContext,
} from './memories.js';
import { getActiveState, getStates, setActiveState, addState, updateState, deleteState, loadTemplate } from './states.js';
import { buildAndInject } from './injection.js';
import {
    getThreads, addThread, updateThread, deleteThread, resolveThread, getThreadHistory,
} from './threads.js';
import {
    EXT_DISPLAY_NAME, MEMORY_TYPE_META, MEMORY_WEIGHT_META,
    STATE_TEMPLATES, STATE_KINDS, STATE_KIND_META, LEAN_SIGN_META,
    THREAD_STATUS_META, THREAD_STATUS_CYCLE, THREAD_PRIORITY_META,
    THREAD_KINDS, THREAD_KIND_META, THREAD_DIRECTIONS, THREAD_DIRECTION_META,
} from './config.js';

let editingMemory = null;

// ─── Bootstrap ───────────────────────────────────────────────────────────────

export function initPanel() {
    if ($('#codex-fab').length) return;
    injectPanelChipStyles();
    createFAB();
    createPanel();
    bindEvents();
    bindLiveRefresh();
}

// Repaint the auto-updating readouts (VAD meters, thread heat/quiet, memories)
// as messages arrive — but ONLY while the panel is open, and ONLY the read-only
// lists, never the editable textareas (so it can't clobber what you're typing).
// VAD is a background call that resolves a beat late, so we also nudge once on a
// short delay to catch its result rather than show last turn's value.
let liveRefreshBound = false;
function bindLiveRefresh() {
    if (liveRefreshBound) return;
    liveRefreshBound = true;
    const repaint = () => {
        if (!$('#codex-panel').is(':visible')) return;
        try { renderMemories(); renderThreads(); renderVad(); } catch (e) { /* non-critical */ }
    };
    eventSource.on(event_types.MESSAGE_RECEIVED, () => {
        repaint();                 // immediate: thread heat/quiet move now
        setTimeout(repaint, 2500); // delayed: catch the async VAD result
    });
}

// Pill-shaped, labelled chips for the quick-add forms. Injected at runtime so
// style.css stays untouched. `.cdx-type-chip` in style.css is a fixed 28px
// circle — fine for bare icons, but it crushes text labels. These rules add a
// `.cdx-pill-chip` variant (auto-width, wraps, icon+label) and a clearer
// active fill. Higher specificity (.cdx-qa-chips .cdx-pill-chip) guarantees the
// override beats the base circle rule regardless of load order.
function injectPanelChipStyles() {
    if (document.getElementById('codex-panel-chipstyle')) return;
    const css = `
.cdx-chip-group { margin-top: 8px; }
.cdx-chip-group-label {
  font-size: 0.72em; letter-spacing: 0.06em; text-transform: uppercase;
  opacity: 0.55; margin-bottom: 4px;
}
.cdx-qa-chips .cdx-pill-chip {
  width: auto; height: auto; border-radius: 999px;
  padding: 4px 11px; font-size: 0.8em; line-height: 1.2;
  gap: 5px; white-space: nowrap;
}
.cdx-qa-chips .cdx-pill-chip.cdx-type-active {
  background: rgba(138,126,184,0.38);
  border-color: rgba(138,126,184,0.85);
  color: #fff; font-weight: 600;
  box-shadow: inset 0 0 0 1px rgba(138,126,184,0.5);
}
/* style.css hides row actions until :hover — invisible on touch. Keep them
   visible so edit/delete/resolve are reachable on mobile. */
.codex-panel .cdx-mem-actions { opacity: 0.65; }
.codex-panel .cdx-mem-item:hover .cdx-mem-actions { opacity: 1; }`;
    const style = document.createElement('style');
    style.id = 'codex-panel-chipstyle';
    style.textContent = css;
    document.head.appendChild(style);
}

export function destroyPanel() {
    $(document).off('.codexFab');
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
        touchAction: 'none',
    });

    // Mount with a containing-block probe. Themes that put transform/filter/
    // backdrop-filter on #form_sheld (or an ancestor) trap position:fixed
    // descendants — saved drag coordinates then blow the container open
    // (the "stretched text box" bug). Probe: pin to viewport 0,0 and check
    // where we actually landed; if trapped, fall back to <body>.
    const host = $('#form_sheld').length ? $('#form_sheld') : $('body');
    host.append(fab);
    fab.css({ left: '0px', top: '0px', right: 'auto', bottom: 'auto' });
    const probe = fab[0].getBoundingClientRect();
    if (Math.abs(probe.left) > 1 || Math.abs(probe.top) > 1) {
        $(document.body).append(fab);   // append = move; listeners survive
        console.warn('[Codex] #form_sheld is a transformed containing block — FAB mounted on <body> instead');
    }
    fab.css({ left: '', top: '', right: '15px', bottom: '180px' });   // default anchor

    // Restore saved position (clamped — viewport may have changed)
    const saved = getSettings().fabPosition;
    if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
        const pad = 10, w = 44, h = 44;
        const x = Math.max(pad, Math.min(window.innerWidth - w - pad, saved.left));
        const y = Math.max(pad, Math.min(window.innerHeight - h - pad, saved.top));
        fab.css({ left: x + 'px', top: y + 'px', right: 'auto', bottom: 'auto' });
    }

    makeFabDraggable(fab);
}

function makeFabDraggable($fab) {
    const LONG_PRESS_DURATION = 200;   // ms held before drag starts
    const MOVE_THRESHOLD = 10;         // px moved before drag starts

    let isDragging = false;
    let startTime = 0;
    let startX = 0, startY = 0;        // pointer at start
    let fabX = 0, fabY = 0;            // fab offset at start

    // RAF-batched position updates for smooth dragging
    let rafId = null;
    let pendingX = null, pendingY = null;
    function flushPosition() {
        if (pendingX !== null && pendingY !== null) {
            $fab.css({ left: pendingX + 'px', top: pendingY + 'px', right: 'auto', bottom: 'auto' });
            pendingX = null; pendingY = null;
        }
        rafId = null;
    }

    function clamp(x, y) {
        const pad = 10;
        const w = $fab.outerWidth() || 44;
        const h = $fab.outerHeight() || 44;
        return [
            Math.max(pad, Math.min(window.innerWidth - w - pad, x)),
            Math.max(pad, Math.min(window.innerHeight - h - pad, y)),
        ];
    }

    function beginGesture(clientX, clientY) {
        startTime = Date.now();
        startX = clientX;
        startY = clientY;
        const r = $fab[0].getBoundingClientRect();   // viewport coords, always
        fabX = r.left;
        fabY = r.top;
        isDragging = false;
    }

    function moveGesture(clientX, clientY) {
        const dx = clientX - startX;
        const dy = clientY - startY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const held = Date.now() - startTime;

        if (!isDragging && (held > LONG_PRESS_DURATION || dist > MOVE_THRESHOLD)) {
            isDragging = true;
            $fab.addClass('dragging');
        }
        if (!isDragging) return false;

        const [x, y] = clamp(fabX + dx, fabY + dy);
        pendingX = x; pendingY = y;
        if (!rafId) rafId = requestAnimationFrame(flushPosition);
        return true;
    }

    function endGesture() {
        $fab.removeClass('dragging');
        if (isDragging) {
            isDragging = false;
            const r = $fab[0].getBoundingClientRect();
            getSettings().fabPosition = { left: Math.round(r.left), top: Math.round(r.top) };
            saveSettings();
            return true;    // consumed as a drag
        }
        return false;       // it was a tap
    }

    // ── Touch ──
    $fab.on('touchstart', function (e) {
        const t = e.originalEvent.touches[0];
        beginGesture(t.clientX, t.clientY);
    });
    $fab.on('touchmove', function (e) {
        const t = e.originalEvent.touches[0];
        if (moveGesture(t.clientX, t.clientY)) e.preventDefault();   // block scroll while dragging
    });
    $fab.on('touchend', function (e) {
        const wasDrag = endGesture();
        e.preventDefault();              // suppress the ghost click either way
        if (!wasDrag) togglePanel();     // tap = toggle
    });

    // ── Mouse (desktop) ──
    let mouseDown = false;
    $fab.on('mousedown', function (e) {
        e.preventDefault();
        mouseDown = true;
        beginGesture(e.clientX, e.clientY);
    });
    $(document).on('mousemove.codexFab', function (e) {
        if (!mouseDown) return;
        moveGesture(e.clientX, e.clientY);
    });
    $(document).on('mouseup.codexFab', function () {
        if (!mouseDown) return;
        mouseDown = false;
        if (!endGesture()) togglePanel();
    });
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

        <!-- Plot Threads (v1.2) -->
        <div class="cdx-field-section">
          <div class="cdx-field-bar">
            <span class="cdx-field-label">Open plot threads <span id="cdx-thr-count" class="cdx-dim"></span></span>
            <button class="cdx-text-btn" id="cdx-add-thread">+ add</button>
          </div>
          <div id="cdx-thr-list" class="cdx-mem-list"></div>
        </div>

        <!-- Emotional state (VAD) -->
        <div class="cdx-field-section" id="cdx-vad-section">
          <div class="cdx-field-label">Emotional state <span id="cdx-vad-label" class="cdx-dim"></span></div>
          <div id="cdx-vad-bars"></div>
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

      <!-- ── Thread Quick-Add ── -->
      <div class="cdx-quick-add" id="cdx-thr-add" style="display:none;">
        <input type="text" id="cdx-ta-name" class="cdx-field-input" placeholder="Thread name (e.g. The missing heir)" />
        <textarea id="cdx-ta-desc" rows="2" class="cdx-field-input" placeholder="What's this thread about? Where could it go?"></textarea>

        <!-- Kind: plot line vs character stake -->
        <div class="cdx-chip-group">
          <div class="cdx-chip-group-label">Kind</div>
          <div class="cdx-qa-chips" id="cdx-ta-kind-chips"></div>
        </div>

        <!-- Stake-only: who holds it + which way it's been pushed lately -->
        <div id="cdx-ta-stake-fields" style="display:none;">
          <input type="text" id="cdx-ta-holder" class="cdx-field-input" style="margin-top:8px;" placeholder="Who holds this? (blank = the main character)" />
          <div class="cdx-chip-group">
            <div class="cdx-chip-group-label">Lately — moved toward or against it?</div>
            <div class="cdx-qa-chips" id="cdx-ta-dir-chips"></div>
          </div>
        </div>

        <!-- Status -->
        <div class="cdx-chip-group">
          <div class="cdx-chip-group-label">Status</div>
          <div class="cdx-qa-chips" id="cdx-ta-status-chips"></div>
        </div>

        <div class="cdx-qa-row" style="justify-content:flex-end;margin-top:10px;">
          <label class="cdx-check" title="Primary threads get forward-motion priority"><input type="checkbox" id="cdx-ta-primary" /> ★ Primary</label>
          <button class="cdx-btn-primary" id="cdx-ta-save">Save</button>
          <button class="cdx-icon-btn" id="cdx-ta-cancel">✕</button>
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

        <label class="cdx-check"><input type="checkbox" id="cdx-s-vad" /> Track emotional state (VAD)</label>
        <div class="cdx-setting-row">
          <span>VAD check cadence</span>
          <span id="cdx-vadcd-val">2</span>
          <input type="range" id="cdx-s-vadcd" min="1" max="6" value="2" />
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

          <div class="cdx-field-bar" style="margin-top:8px;">
            <span class="cdx-field-label" style="margin:0;">Type</span>
            <span id="cdx-me-kind-chips" style="display:flex;flex-wrap:wrap;gap:5px;">
              ${Object.entries(STATE_KIND_META).map(([k, v]) =>
                `<button type="button" class="cdx-type-chip cdx-skind-chip" data-kind="${k}" title="${v.desc}" style="width:auto;height:24px;padding:0 10px;border-radius:12px;font-size:11px;">${v.icon} ${v.label}</button>`
              ).join('')}
            </span>
          </div>

          <div id="cdx-me-lean-wrap" style="margin-top:6px;box-sizing:border-box;max-width:100%;overflow-x:hidden;">
            <div class="cdx-hint" style="margin:0 0 4px;">Reacts to: the VAD region where this face surfaces. <b>·</b> = ignore axis. Sparse leans work best.</div>
            <div style="display:flex;flex-wrap:wrap;gap:8px 14px;">
              ${['valence', 'arousal', 'dominance'].map(axis => `
              <span style="display:flex;align-items:center;gap:5px;">
                <span class="cdx-dim" style="font-size:11px;text-transform:capitalize;min-width:62px;">${axis}</span>
                <span style="display:flex;gap:4px;">
                  ${['neg', 'neutral', 'pos', 'any'].map(sign =>
                    `<button type="button" class="cdx-type-chip cdx-lean-chip" data-axis="${axis}" data-sign="${sign}" title="${LEAN_SIGN_META[sign].desc}" style="width:24px;height:24px;font-size:11px;">${LEAN_SIGN_META[sign].label}</button>`
                  ).join('')}
                </span>
              </span>`).join('')}
            </div>
          </div>
          <div class="cdx-hint">Disposition (optional): threads matching <b>fixates</b> linger &amp; build pressure; <b>ignores</b> fade fast.</div>
          <input type="text" id="cdx-me-fixates" class="cdx-field-input" placeholder="Fixates on (comma-separated: the locked door, her past)" />
          <input type="text" id="cdx-me-ignores" class="cdx-field-input" placeholder="Ignores (comma-separated: phone, small talk)" />
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
        // Chips are scoped per form (memory types vs thread statuses)
        $(this).siblings('.cdx-type-chip').removeClass('cdx-type-active');
        $(this).addClass('cdx-type-active');
    });

    // ── Plot threads (v1.2) ──────────────────────────────────────────────
    $(document).on('click', '#cdx-add-thread', () => openThreadAdd(null));
    $(document).on('click', '#cdx-ta-save', saveFromThreadAdd);
    $(document).on('click', '#cdx-ta-cancel', closeThreadAdd);

    // Picking the Kind reveals/hides the stake-only fields (holder + direction).
    $(document).on('click', '.cdx-kind-chip', function () {
        const isStake = $(this).data('kind') === THREAD_KINDS.STAKE;
        $('#cdx-ta-stake-fields').toggle(!!isStake);
    });

    // Mode editor — pick Face/Era; the VAD lean editor shows for faces only.
    $(document).on('click', '.cdx-skind-chip', function () {
        $('#cdx-me-kind-chips .cdx-skind-chip').removeClass('cdx-type-active');
        $(this).addClass('cdx-type-active');
        $('#cdx-me-lean-wrap').toggle($(this).data('kind') === STATE_KINDS.FACE);
    });

    // Mode editor — VAD lean is single-select per axis.
    $(document).on('click', '.cdx-lean-chip', function () {
        const axis = $(this).data('axis');
        $(`.cdx-lean-chip[data-axis="${axis}"]`).removeClass('cdx-type-active');
        $(this).addClass('cdx-type-active');
    });

    // Tap status icon to cycle building → escalating → climax
    $(document).on('click', '.cdx-thr-status-btn', function () {
        const id = $(this).data('id');
        const thread = getThreads().find(t => t.id === id);
        if (!thread) return;
        const cycle = THREAD_STATUS_CYCLE;
        const cur = cycle.indexOf(thread.status);
        const next = cycle[(cur + 1) % cycle.length] || cycle[0]; // paused exits via edit form
        updateThread(id, { status: next });
        renderThreads();
        buildAndInject();
    });

    $(document).on('click', '.cdx-thr-edit', function () {
        const id = $(this).data('id');
        const thread = getThreads().find(t => t.id === id);
        if (thread) openThreadAdd(thread);
    });

    $(document).on('click', '.cdx-thr-resolve', function () {
        const id = $(this).data('id');
        if (resolveThread(id)) {
            toastr.success('Thread resolved → history');
            renderThreads();
            buildAndInject();
        }
    });

    $(document).on('click', '.cdx-thr-delete', function () {
        const id = $(this).data('id');
        if (deleteThread(id)) {
            renderThreads();
            buildAndInject();
        }
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
    $(document).on('change', '#cdx-s-vad', function () {
        getSettings().vad_enabled = this.checked;
        saveSettings();
        renderVad();
    });
    $(document).on('input', '#cdx-s-vadcd', function () {
        const v = parseInt(this.value);
        getSettings().vad_cooldown = v;
        $('#cdx-vadcd-val').text(v);
        saveSettings();
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
    renderThreads();
    renderVad();
}

// ─── VAD Readout ─────────────────────────────────────────────────────────────

function renderVad() {
    const settings = getSettings();
    const vad = getChatState().vad || { valence: 0, arousal: 0, dominance: 0, label: 'neutral' };
    $('#cdx-vad-section').toggle(settings.vad_enabled !== false);
    $('#cdx-vad-label').html(vad.label ? `· ${xss(vad.label)}` : '');

    const row = (name, val) => {
        const v = Number(val) || 0;
        const pct = ((v + 2) / 4) * 100;
        const sign = v > 0 ? `+${v}` : `${v}`;
        return `<div style="display:flex;align-items:center;gap:8px;margin:3px 0;font-size:0.8em;">
            <span style="width:62px;opacity:0.65;">${name}</span>
            <span style="position:relative;flex:1;height:4px;background:rgba(255,255,255,0.12);border-radius:2px;">
              <span style="position:absolute;top:0;left:50%;width:1px;height:4px;background:rgba(255,255,255,0.25);"></span>
              <span style="position:absolute;top:-2px;left:calc(${pct}% - 4px);width:8px;height:8px;border-radius:50%;background:#9ad;"></span>
            </span>
            <span style="width:22px;text-align:right;opacity:0.55;">${sign}</span>
        </div>`;
    };
    $('#cdx-vad-bars').html(row('valence', vad.valence) + row('arousal', vad.arousal) + row('dominance', vad.dominance));
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
        return `<button class="cdx-type-chip cdx-pill-chip ${active}" data-type="${k}" title="${v.label}">${v.icon} ${v.label}</button>`;
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

// ─── Thread Rendering (v1.2) ─────────────────────────────────────────────────

let editingThread = null;

function renderThreads() {
    const threads = getThreads();
    const resolvedCount = getThreadHistory().length;
    const countLabel = resolvedCount > 0
        ? `(${threads.length} open, ${resolvedCount} resolved)`
        : `(${threads.length})`;
    $('#cdx-thr-count').text(threads.length || resolvedCount ? countLabel : '');

    if (!threads.length) {
        $('#cdx-thr-list').html(`<div class="cdx-empty">No open threads. Add plot lines you want the story to keep moving.</div>`);
        return;
    }

    const statusWeight = { climax: 3, escalating: 2, building: 1, paused: 0 };
    const sorted = [...threads].sort((a, b) => {
        const pa = a.priority === 'primary' ? 1 : 0;
        const pb = b.priority === 'primary' ? 1 : 0;
        if (pb !== pa) return pb - pa;
        return (statusWeight[b.status] ?? 0) - (statusWeight[a.status] ?? 0);
    });

    const html = sorted.map(t => {
        const sm = THREAD_STATUS_META[t.status] || THREAD_STATUS_META.building;
        const isPaused = t.status === 'paused';
        const star = t.priority === 'primary' ? '★ ' : '';
        const heat = Math.max(0, Math.min(5, t.heat ?? 0));
        const heatPips = '●'.repeat(heat) + '○'.repeat(5 - heat);
        const silent = t.silent ?? 0;

        // v1.4 stakes: show a ◆ badge (with holder) and, if pushed lately, a direction arrow.
        const isStake = t.kind === THREAD_KINDS.STAKE;
        const km = THREAD_KIND_META[t.kind] || THREAD_KIND_META.plot;
        const dm = THREAD_DIRECTION_META[t.direction] || THREAD_DIRECTION_META.neutral;
        const stakeBadge = isStake
            ? `<span class="cdx-mem-type" style="color:${km.color}" title="${km.desc}">${km.icon} ${xss(t.holder || 'stake')}</span>`
            : '';
        const dirBadge = (isStake && t.direction !== THREAD_DIRECTIONS.NEUTRAL)
            ? `<span class="cdx-mem-type" style="color:${dm.color}" title="${dm.desc}">${dm.icon} ${dm.label}</span>`
            : '';
        // Silence is now visible text, not tooltip-only (mobile has no hover).
        const quiet = silent > 0
            ? `<span class="cdx-dim" style="font-size:0.72em;margin-left:6px;">· ${silent} quiet</span>`
            : '';

        return `
        <div class="cdx-mem-item" style="${isPaused ? 'opacity:0.5;' : ''}">
            <button class="cdx-mem-weight-btn cdx-thr-status-btn" data-id="${t.id}" title="${sm.label} — tap to cycle · pause via ✎">${sm.icon}</button>
            <div class="cdx-mem-body">
                <div class="cdx-mem-text"><b>${star}${xss(t.name)}</b>${t.description ? ' — ' + xss(t.description) : ''}</div>
                ${stakeBadge}${dirBadge}<span class="cdx-mem-type" style="color:${sm.color}">${sm.label}</span>
                <span class="cdx-dim" style="font-size:0.72em;margin-left:6px;letter-spacing:1px;" title="heat ${heat}/5 · ${silent} turn(s) since touched">${heatPips}</span>${quiet}
            </div>
            <div class="cdx-mem-actions">
                <button class="cdx-icon-btn cdx-thr-resolve" data-id="${t.id}" title="Resolve (archive)">✓</button>
                <button class="cdx-icon-btn cdx-thr-edit" data-id="${t.id}">✎</button>
                <button class="cdx-icon-btn cdx-thr-delete" data-id="${t.id}">🗑</button>
            </div>
        </div>`;
    }).join('');

    $('#cdx-thr-list').html(html);
}

function openThreadAdd(thread) {
    editingThread = thread;

    const chips = Object.entries(THREAD_STATUS_META)
        .filter(([k]) => k !== 'resolved') // Resolving is the ✓ button, not a status pick
        .map(([k, v]) => {
            const active = (thread?.status || 'building') === k ? 'cdx-type-active' : '';
            return `<button class="cdx-type-chip cdx-pill-chip cdx-thr-chip ${active}" data-status="${k}" title="${v.desc}">${v.icon} ${v.label}</button>`;
        }).join('');

    $('#cdx-ta-status-chips').html(chips);

    // Kind chips (plot / stake)
    const curKind = thread?.kind === THREAD_KINDS.STAKE ? THREAD_KINDS.STAKE : THREAD_KINDS.PLOT;
    const kindChips = Object.entries(THREAD_KIND_META).map(([k, v]) => {
        const active = curKind === k ? 'cdx-type-active' : '';
        return `<button class="cdx-type-chip cdx-pill-chip cdx-kind-chip ${active}" data-kind="${k}" title="${v.desc}">${v.icon} ${v.label}</button>`;
    }).join('');
    $('#cdx-ta-kind-chips').html(kindChips);

    // Direction chips (toward / neutral / against) — stake-only
    const curDir = (thread?.direction === THREAD_DIRECTIONS.TOWARD || thread?.direction === THREAD_DIRECTIONS.AGAINST)
        ? thread.direction : THREAD_DIRECTIONS.NEUTRAL;
    const dirOrder = [THREAD_DIRECTIONS.TOWARD, THREAD_DIRECTIONS.NEUTRAL, THREAD_DIRECTIONS.AGAINST];
    const dirChips = dirOrder.map(k => {
        const v = THREAD_DIRECTION_META[k];
        const active = curDir === k ? 'cdx-type-active' : '';
        return `<button class="cdx-type-chip cdx-pill-chip cdx-dir-chip ${active}" data-dir="${k}" title="${v.desc}">${v.icon} ${v.label}</button>`;
    }).join('');
    $('#cdx-ta-dir-chips').html(dirChips);

    $('#cdx-ta-holder').val(thread?.holder || '');
    $('#cdx-ta-stake-fields').toggle(curKind === THREAD_KINDS.STAKE);

    $('#cdx-ta-name').val(thread?.name || '');
    $('#cdx-ta-desc').val(thread?.description || '');
    $('#cdx-ta-primary').prop('checked', thread?.priority === 'primary');
    $('#cdx-thr-add').slideDown(150);
    setTimeout(() => $('#cdx-ta-name').focus(), 160);
}

function closeThreadAdd() {
    editingThread = null;
    $('#cdx-thr-add').slideUp(150);
    $('#cdx-ta-name').val('');
    $('#cdx-ta-desc').val('');
    $('#cdx-ta-holder').val('');
    $('#cdx-ta-stake-fields').hide();
}

function saveFromThreadAdd() {
    const name = $('#cdx-ta-name').val().trim();
    if (!name) { toastr.warning('Threads need a name'); return; }

    const description = $('#cdx-ta-desc').val().trim();
    const status = $('.cdx-thr-chip.cdx-type-active').data('status') || 'building';
    const priority = $('#cdx-ta-primary').prop('checked') ? 'primary' : 'secondary';

    const kind = $('.cdx-kind-chip.cdx-type-active').data('kind') || THREAD_KINDS.PLOT;
    const isStake = kind === THREAD_KINDS.STAKE;
    const direction = isStake ? ($('.cdx-dir-chip.cdx-type-active').data('dir') || THREAD_DIRECTIONS.NEUTRAL) : THREAD_DIRECTIONS.NEUTRAL;
    const holder = isStake ? $('#cdx-ta-holder').val().trim() : '';

    if (editingThread) {
        updateThread(editingThread.id, { name, description, status, priority, kind, direction, holder });
    } else {
        const created = addThread(name, description, priority, status, { kind, direction, holder });
        if (!created) {
            toastr.warning('Too many open threads — resolve or delete some first');
            return;
        }
    }

    closeThreadAdd();
    renderThreads();
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
    $('#cdx-s-vad').prop('checked', settings.vad_enabled !== false);
    $('#cdx-s-vadcd').val(settings.vad_cooldown || 2);
    $('#cdx-vadcd-val').text(settings.vad_cooldown || 2);
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

    const SIGN = { neg: '–', neutral: '0', pos: '+' };
    const html = states.map(s => {
        const isActive = active && s.id === active.id;
        const isEra = s.kind === STATE_KINDS.ERA;

        // disposition leanings (fixates / ignores) — thread-pacing bias
        const disp = s.leanings || {};
        const fx = (disp.fixates || []).filter(Boolean);
        const ig = (disp.ignores || []).filter(Boolean);

        // VAD lean summary (faces only) — e.g. "V+ D+"
        const vl = s.lean || {};
        const vadParts = isEra ? [] : ['valence', 'arousal', 'dominance']
            .filter(a => vl[a] && vl[a] !== 'any')
            .map(a => `${a[0].toUpperCase()}${SIGN[vl[a]] || ''}`);

        const hints = [];
        if (vadParts.length) hints.push(`↻ ${vadParts.join(' ')}`);
        if (fx.length) hints.push(`↑ ${xss(fx.join(', '))}`);
        if (ig.length) hints.push(`↓ ${xss(ig.join(', '))}`);
        const hintLine = hints.length
            ? `<div class="cdx-hint" style="margin:1px 0 4px 8px;font-size:0.72em;">${hints.join(' · ')}</div>`
            : '';

        const badge = isEra ? ` ${STATE_KIND_META.era.icon}` : '';
        return `
        <div class="cdx-mode-item ${isActive ? 'cdx-mode-active' : ''}">
            <button class="cdx-mode-activate" data-id="${s.id}" title="Tap to activate">
                ${isActive ? '◉' : '○'} ${xss(s.name)}${s.is_default ? ' ★' : ''}${badge}
            </button>
            <div class="cdx-mode-item-actions">
                <button class="cdx-icon-btn cdx-mode-edit" data-id="${s.id}">✎</button>
                <button class="cdx-icon-btn cdx-mode-delete" data-id="${s.id}">🗑</button>
            </div>
        </div>${hintLine}`;
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
    $('#cdx-me-fixates').val((state?.leanings?.fixates || []).join(', '));
    $('#cdx-me-ignores').val((state?.leanings?.ignores || []).join(', '));
    $('#cdx-me-default').prop('checked', state?.is_default || false);

    // Kind chips (face / era) — default face
    const kind = (state?.kind === STATE_KINDS.ERA) ? STATE_KINDS.ERA : STATE_KINDS.FACE;
    $('#cdx-me-kind-chips .cdx-skind-chip').removeClass('cdx-type-active');
    $(`#cdx-me-kind-chips .cdx-skind-chip[data-kind="${kind}"]`).addClass('cdx-type-active');

    // VAD lean chips — one active sign per axis, default 'any'
    const lean = state?.lean || {};
    ['valence', 'arousal', 'dominance'].forEach(axis => {
        const sign = ['neg', 'neutral', 'pos', 'any'].includes(lean[axis]) ? lean[axis] : 'any';
        $(`.cdx-lean-chip[data-axis="${axis}"]`).removeClass('cdx-type-active');
        $(`.cdx-lean-chip[data-axis="${axis}"][data-sign="${sign}"]`).addClass('cdx-type-active');
    });
    $('#cdx-me-lean-wrap').toggle(kind === STATE_KINDS.FACE);

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

    const csv = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
    const leanings = { fixates: csv($('#cdx-me-fixates').val()), ignores: csv($('#cdx-me-ignores').val()) };

    const kind = $('#cdx-me-kind-chips .cdx-skind-chip.cdx-type-active').data('kind') || STATE_KINDS.FACE;
    const lean = {};
    ['valence', 'arousal', 'dominance'].forEach(axis => {
        lean[axis] = $(`.cdx-lean-chip[data-axis="${axis}"].cdx-type-active`).data('sign') || 'any';
    });

    if (!name) { toastr.warning('Mode needs a name'); return; }

    if (editingId) {
        updateState(editingId, { name, express, suppress, is_default: isDefault, leanings, kind, lean });
    } else {
        const s = addState(name, express, suppress, isDefault, { leanings, kind, lean });
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
