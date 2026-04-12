import { extension_settings } from '../../../../extensions.js';
import { chat_metadata, saveSettingsDebounced, saveChatDebounced } from '../../../../../script.js';
import {
    EXT_ID, DEFAULT_SETTINGS, DEFAULT_CHAT_STATE, DEFAULT_CHARACTER_CONFIG,
} from './config.js';

// ─── Core Getters ─────────────────────────────────────────────────────────────

export function getSettings() {
    if (!extension_settings[EXT_ID]) {
        extension_settings[EXT_ID] = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    }
    return extension_settings[EXT_ID];
}

export function getChatState() {
    if (!chat_metadata) return JSON.parse(JSON.stringify(DEFAULT_CHAT_STATE));
    if (!chat_metadata[EXT_ID]) {
        chat_metadata[EXT_ID] = JSON.parse(JSON.stringify(DEFAULT_CHAT_STATE));
    }
    return chat_metadata[EXT_ID];
}

// ─── Character Config ────────────────────────────────────────────────────────

export function getCharacterConfig(charKey) {
    if (!charKey) return JSON.parse(JSON.stringify(DEFAULT_CHARACTER_CONFIG));
    const settings = getSettings();
    if (!settings.characters) settings.characters = {};
    if (!settings.characters[charKey]) {
        settings.characters[charKey] = JSON.parse(JSON.stringify(DEFAULT_CHARACTER_CONFIG));
    }
    return settings.characters[charKey];
}

// ─── Sanitization ─────────────────────────────────────────────────────────────

export function sanitizeSettings() {
    const s = getSettings();
    for (const key in DEFAULT_SETTINGS) {
        if (s[key] === undefined) s[key] = DEFAULT_SETTINGS[key];
    }
    if (!s.characters || typeof s.characters !== 'object') {
        s.characters = {};
    }
}

export function sanitizeChatState() {
    try {
        const state = getChatState();
        for (const key in DEFAULT_CHAT_STATE) {
            if (state[key] === undefined) {
                state[key] = JSON.parse(JSON.stringify(DEFAULT_CHAT_STATE[key]));
            }
        }
        if (!Array.isArray(state.memories)) state.memories = [];
        if (typeof state.whats_changed !== 'string') state.whats_changed = '';
        if (typeof state.growing_toward !== 'string') state.growing_toward = '';
        if (typeof state.relationship_summary !== 'string') state.relationship_summary = '';
        if (!Array.isArray(state.threads)) state.threads = [];
        if (!Array.isArray(state.writing_directives)) {
            state.writing_directives = [...DEFAULT_CHAT_STATE.writing_directives];
        }
        if (!Array.isArray(state.thread_history)) state.thread_history = [];
        if (!Array.isArray(state.choice_tree)) state.choice_tree = [];
        if (typeof state.tag_history !== 'object' || state.tag_history === null) {
            state.tag_history = {};
        }
        if (typeof state.flags !== 'object' || state.flags === null) {
            state.flags = {};
        }
    } catch (e) {
        console.warn('[Codex] sanitizeChatState failed:', e);
    }
}

// ─── Key Helpers ──────────────────────────────────────────────────────────────

export function getCharacterKey(ctx) {
    if (!ctx) return null;
    const charId = ctx.characterId ?? ctx.this_chid;
    const name = (ctx.name2 || 'unknown').replace(/[^a-zA-Z0-9_]/g, '_');
    return charId != null ? `char_${charId}_${name}` : null;
}

export function generateId(prefix = 'cdx') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

// ─── Persistence ──────────────────────────────────────────────────────────────

export function saveSettings() {
    saveSettingsDebounced();
}

export function saveChatData() {
    if (!chat_metadata) return;
    saveChatDebounced();
}

export function loadChatData() {
    return getChatState();
}
