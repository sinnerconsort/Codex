/**
 * Codex Public API v1.1
 * Access via: window.CodexAPI (available after Codex init)
 */

import { getSettings, getChatState } from './state.js';
import { getMemories } from './memories.js';
import { getActiveState } from './states.js';
import { EXT_VERSION } from './config.js';

// ─── Character Methods ───────────────────────────────────────────────────────

function apiGetMemories(type) {
    return getMemories(type ? { type } : {});
}

function apiGetActiveState() {
    const state = getActiveState();
    if (!state) return null;
    return { name: state.name, express: state.express, suppress: state.suppress };
}

function apiGetMessageCount() {
    try {
        const { getContext } = require('../../../../extensions.js');
        return getContext()?.chat?.length || 0;
    } catch {
        return 0;
    }
}

// ─── Story Methods ───────────────────────────────────────────────────────────

function apiGetActiveThreads() {
    const state = getChatState();
    return (state.threads || []).filter(t =>
        t.status !== 'paused' && t.status !== 'resolved'
    );
}

function apiGetThreadByName(name) {
    const state = getChatState();
    return (state.threads || []).find(t =>
        t.name.toLowerCase() === name.toLowerCase()
    ) || null;
}

function apiGetWritingDirectives() {
    const state = getChatState();
    return [...(state.writing_directives || [])];
}

// ─── Meta ────────────────────────────────────────────────────────────────────

function apiIsActive() {
    return getSettings()?.enabled === true;
}

// ─── Registration ────────────────────────────────────────────────────────────

export function registerAPI() {
    window.CodexAPI = {
        // Character
        getMemories: apiGetMemories,
        getActiveState: apiGetActiveState,
        getMessageCount: apiGetMessageCount,

        // Story
        getActiveThreads: apiGetActiveThreads,
        getThreadByName: apiGetThreadByName,
        getWritingDirectives: apiGetWritingDirectives,

        // Meta
        isActive: apiIsActive,
        version: EXT_VERSION,
    };
    console.log('[Codex] Public API registered → window.CodexAPI');
}

export function unregisterAPI() {
    if (window.CodexAPI) {
        delete window.CodexAPI;
        console.log('[Codex] Public API unregistered');
    }
}
