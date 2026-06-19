import { getContext } from '../../../../extensions.js';
import {
    getSettings, getChatState, getCharacterConfig, getCharacterKey,
    generateId, saveSettings, saveChatData,
} from './state.js';
import {
    STATE_TEMPLATES, DEFAULT_STATE, STATE_KINDS, LEAN_SIGNS, DEFAULT_LEAN,
} from './config.js';

// ─── Normalization (defensive back-fill on read) ─────────────────────────────
// Pre-split states have no `kind` or `lean`. Rather than a one-shot migration
// (which could mis-fire silently on mobile), every state is self-healed on read:
// missing/invalid `kind` → 'face', missing/invalid `lean` axes → 'any'. Idempotent.

const VALID_KINDS = new Set(Object.values(STATE_KINDS));        // 'face' | 'era'
const VALID_SIGNS = new Set(Object.values(LEAN_SIGNS));         // neg | neutral | pos | any

function normalizeLean(lean) {
    const out = { ...DEFAULT_LEAN };
    if (lean && typeof lean === 'object') {
        for (const axis of ['valence', 'arousal', 'dominance']) {
            if (VALID_SIGNS.has(lean[axis])) out[axis] = lean[axis];
        }
    }
    return out;
}

/**
 * Mutate a single state in place so it always carries a valid kind + lean.
 * Returns true if anything changed (so callers can decide whether to persist).
 */
function normalizeState(s) {
    if (!s || typeof s !== 'object') return false;
    let changed = false;

    if (!VALID_KINDS.has(s.kind)) {
        s.kind = STATE_KINDS.FACE;
        changed = true;
    }

    const fixedLean = normalizeLean(s.lean);
    if (JSON.stringify(fixedLean) !== JSON.stringify(s.lean)) {
        s.lean = fixedLean;
        changed = true;
    }

    return changed;
}

// ─── State CRUD ──────────────────────────────────────────────────────────────

/**
 * Get all behavioral states for the current character.
 * Self-heals every state to carry a valid `kind` + `lean` on the way out, and
 * persists once if any back-fill actually happened (so old chats upgrade quietly).
 */
export function getStates() {
    const ctx = getContext();
    const charKey = getCharacterKey(ctx);
    const config = getCharacterConfig(charKey);
    if (!Array.isArray(config.states)) return [];

    let mutated = false;
    for (const s of config.states) {
        if (normalizeState(s)) mutated = true;
    }
    if (mutated) saveSettings();

    return config.states;
}

/**
 * Get only FACE states — the masks driven by VAD lean / reveals / manual.
 */
export function getFaceStates() {
    return getStates().filter(s => s.kind === STATE_KINDS.FACE);
}

/**
 * Get only ERA states — the timeline cards driven by the Chronicler era bridge.
 */
export function getEraStates() {
    return getStates().filter(s => s.kind === STATE_KINDS.ERA);
}

/**
 * Get the currently active state object.
 * Returns null if no state is set or the state ID doesn't match any defined state.
 */
export function getActiveState() {
    const chatState = getChatState();
    const states = getStates();

    if (!chatState.active_state) {
        // Try default
        const defaultState = states.find(s => s.is_default);
        return defaultState || null;
    }

    return states.find(s => s.id === chatState.active_state) || null;
}

/**
 * Set the active behavioral state by ID.
 */
export function setActiveState(stateId) {
    const chatState = getChatState();
    chatState.active_state = stateId;
    saveChatData();
}

/**
 * Add a new behavioral state for the current character.
 * `opts` may carry { kind, lean } — defaults to a face with an 'any' lean.
 */
export function addState(name, express, suppress, isDefault = false, opts = {}) {
    const ctx = getContext();
    const charKey = getCharacterKey(ctx);
    if (!charKey) return null;

    const config = getCharacterConfig(charKey);
    if (!Array.isArray(config.states)) config.states = [];

    const state = {
        id: generateId('state'),
        name: name.trim(),
        express: express.trim(),
        suppress: suppress.trim(),
        is_default: isDefault,
        kind: VALID_KINDS.has(opts.kind) ? opts.kind : STATE_KINDS.FACE,
        lean: normalizeLean(opts.lean),
    };

    // If this is default, clear other defaults
    if (isDefault) {
        for (const s of config.states) s.is_default = false;
    }

    config.states.push(state);
    saveSettings();
    return state;
}

/**
 * Update an existing state. Accepts name/express/suppress/is_default plus the
 * new kind/lean. An era state's lean is meaningless but harmless to store.
 */
export function updateState(stateId, updates) {
    const ctx = getContext();
    const charKey = getCharacterKey(ctx);
    if (!charKey) return null;

    const config = getCharacterConfig(charKey);
    const state = config.states?.find(s => s.id === stateId);
    if (!state) return null;

    if (updates.name !== undefined) state.name = updates.name.trim();
    if (updates.express !== undefined) state.express = updates.express.trim();
    if (updates.suppress !== undefined) state.suppress = updates.suppress.trim();

    if (updates.kind !== undefined && VALID_KINDS.has(updates.kind)) {
        state.kind = updates.kind;
    }
    if (updates.lean !== undefined) {
        state.lean = normalizeLean(updates.lean);
    }

    if (updates.is_default) {
        for (const s of config.states) s.is_default = false;
        state.is_default = true;
    }

    // Keep the row valid no matter what came in
    normalizeState(state);

    saveSettings();
    return state;
}

/**
 * Delete a state. If it was active, clear active_state.
 */
export function deleteState(stateId) {
    const ctx = getContext();
    const charKey = getCharacterKey(ctx);
    if (!charKey) return false;

    const config = getCharacterConfig(charKey);
    if (!Array.isArray(config.states)) return false;

    const idx = config.states.findIndex(s => s.id === stateId);
    if (idx === -1) return false;

    config.states.splice(idx, 1);

    // Clear active if it was this state
    const chatState = getChatState();
    if (chatState.active_state === stateId) {
        chatState.active_state = null;
        saveChatData();
    }

    saveSettings();
    return true;
}

/**
 * Load states from a template, replacing existing states.
 * Templates may carry per-state kind/lean; absent → face with an 'any' lean.
 */
export function loadTemplate(templateKey) {
    const template = STATE_TEMPLATES[templateKey];
    if (!template) return false;

    const ctx = getContext();
    const charKey = getCharacterKey(ctx);
    if (!charKey) return false;

    const config = getCharacterConfig(charKey);
    config.states = template.states.map((s, i) => ({
        id: generateId('state'),
        name: s.name,
        express: s.express,
        suppress: s.suppress,
        is_default: i === 0,
        kind: VALID_KINDS.has(s.kind) ? s.kind : STATE_KINDS.FACE,
        lean: normalizeLean(s.lean),
    }));

    // Set first state as active
    const chatState = getChatState();
    chatState.active_state = config.states[0]?.id || null;

    saveSettings();
    saveChatData();
    return true;
}
