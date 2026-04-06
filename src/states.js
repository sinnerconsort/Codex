import { getContext } from '../../../../extensions.js';
import {
    getSettings, getChatState, getCharacterConfig, getCharacterKey,
    generateId, saveSettings, saveChatData,
} from './state.js';
import { STATE_TEMPLATES, DEFAULT_STATE } from './config.js';

// ─── State CRUD ──────────────────────────────────────────────────────────────

/**
 * Get all behavioral states for the current character.
 */
export function getStates() {
    const ctx = getContext();
    const charKey = getCharacterKey(ctx);
    const config = getCharacterConfig(charKey);
    return config.states || [];
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
 */
export function addState(name, express, suppress, isDefault = false) {
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
 * Update an existing state.
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

    if (updates.is_default) {
        for (const s of config.states) s.is_default = false;
        state.is_default = true;
    }

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
    }));

    // Set first state as active
    const chatState = getChatState();
    chatState.active_state = config.states[0]?.id || null;

    saveSettings();
    saveChatData();
    return true;
}
