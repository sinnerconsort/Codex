// Codex — Character State import/export (portable JSON)
// ──────────────────────────────────────────────────────────────────────────────
// Lets a character's behavioral states travel as a file instead of a config.js
// edit. Targets the CURRENTLY LOADED character (same as loadTemplate). Accepts:
//   { "name": "...", "states": [ { name, express, suppress, is_default?, leanings? } ] }
// or a bare array of those state objects.

import { getContext } from '../../../../extensions.js';
import {
    getCharacterKey, getCharacterConfig, getChatState,
    generateId, saveSettings, saveChatData,
} from './state.js';

function normalizeLeanings(l) {
    if (!l || typeof l !== 'object') return null;
    return {
        fixates: Array.isArray(l.fixates) ? l.fixates.filter(Boolean) : [],
        ignores: Array.isArray(l.ignores) ? l.ignores.filter(Boolean) : [],
    };
}

/**
 * Import states for the current character.
 * @param {string} jsonString
 * @param {'replace'|'merge'} [mode='replace']
 * @returns {{success:boolean, count?:number, name?:string, error?:string}}
 */
export function importCharacterStates(jsonString, mode = 'replace') {
    try {
        const data = JSON.parse(jsonString);
        const raw = Array.isArray(data) ? data
            : (Array.isArray(data?.states) ? data.states : null);
        if (!raw) throw new Error('Expected {"states":[...]} or a states array');

        const states = raw
            .filter(s => s && typeof s.name === 'string' && s.name.trim())
            .map(s => {
                const lean = normalizeLeanings(s.leanings);
                return {
                    id: generateId('state'),
                    name: s.name.trim(),
                    express: String(s.express || '').trim(),
                    suppress: String(s.suppress || '').trim(),
                    is_default: !!s.is_default,
                    ...(lean ? { leanings: lean } : {}),
                };
            });
        if (!states.length) throw new Error('No valid states (each needs a name)');
        if (!states.some(s => s.is_default)) states[0].is_default = true;

        const ctx = getContext();
        const key = getCharacterKey(ctx);
        if (!key) throw new Error('No character loaded — open the character chat first');

        const config = getCharacterConfig(key);
        if (mode === 'merge' && Array.isArray(config.states)) {
            const have = new Set(config.states.map(s => (s.name || '').toLowerCase()));
            config.states = [...config.states, ...states.filter(s => !have.has(s.name.toLowerCase()))];
        } else {
            config.states = states;
        }

        // activate the default
        const def = config.states.find(s => s.is_default) || config.states[0];
        getChatState().active_state = def ? def.id : null;

        saveSettings();
        saveChatData();
        return { success: true, count: states.length, name: (data && data.name) || null };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * Export the current character's states as a portable JSON string.
 */
export function exportCharacterStates() {
    const ctx = getContext();
    const key = getCharacterKey(ctx);
    const config = getCharacterConfig(key);
    const out = {
        name: `${ctx?.name2 || 'Character'} states`,
        states: (config.states || []).map(s => ({
            name: s.name,
            express: s.express,
            suppress: s.suppress,
            is_default: !!s.is_default,
            ...(s.leanings ? { leanings: s.leanings } : {}),
        })),
    };
    return JSON.stringify(out, null, 2);
}
