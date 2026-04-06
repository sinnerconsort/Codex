/**
 * Codex Public API v1.0
 * Access via: window.CodexAPI (available after Codex init)
 */

import { getSettings, getChatState } from './state.js';
import { getMemories, getInjectableMemories } from './memories.js';
import { getActiveState, getStates } from './states.js';
import { getRelationshipSummary } from './relationship.js';
import { EXT_VERSION } from './config.js';

// ─── Character Methods ───────────────────────────────────────────────────────

function apiGetMemories(type) {
    return getMemories(type ? { type } : {});
}

function apiGetRelationshipSummary() {
    return getRelationshipSummary();
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

// ─── Game Methods (Phase 3 stubs) ────────────────────────────────────────────

function apiGetMeters() {
    const state = getChatState();
    if (!state.game_mode) return null;
    return { ...state.meters };
}

function apiGetMeterBand(name) {
    // Phase 3 implementation
    return null;
}

function apiGetFlags() {
    const state = getChatState();
    if (!state.game_mode) return null;
    return { ...state.flags };
}

function apiGetRoute() {
    const state = getChatState();
    if (!state.game_mode) return null;
    return { ...state.route };
}

function apiGetChoiceTree() {
    const state = getChatState();
    if (!state.game_mode) return null;
    return [...(state.choice_tree || [])];
}

function apiGetTagHistory() {
    const state = getChatState();
    if (!state.game_mode) return null;
    return { ...(state.tag_history || {}) };
}

// ─── Meta ────────────────────────────────────────────────────────────────────

function apiIsActive() {
    return getSettings()?.enabled === true;
}

function apiIsGameMode() {
    return getChatState()?.game_mode === true;
}

// ─── Registration ────────────────────────────────────────────────────────────

export function registerAPI() {
    window.CodexAPI = {
        // Character
        getMemories: apiGetMemories,
        getRelationshipSummary: apiGetRelationshipSummary,
        getActiveState: apiGetActiveState,
        getMessageCount: apiGetMessageCount,

        // Story
        getActiveThreads: apiGetActiveThreads,
        getThreadByName: apiGetThreadByName,
        getWritingDirectives: apiGetWritingDirectives,

        // Game (Phase 3)
        getMeters: apiGetMeters,
        getMeterBand: apiGetMeterBand,
        getFlags: apiGetFlags,
        getRoute: apiGetRoute,
        getChoiceTree: apiGetChoiceTree,
        getTagHistory: apiGetTagHistory,

        // Meta
        isActive: apiIsActive,
        isGameMode: apiIsGameMode,
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
