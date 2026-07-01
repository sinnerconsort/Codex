// Codex — Character State import/export (portable JSON)
// ──────────────────────────────────────────────────────────────────────────────
// Lets a character's behavioral states travel as a file instead of a config.js
// edit. Targets the CURRENTLY LOADED character (same as loadTemplate). Accepts:
//   { "name": "...", "states": [ { name, express, suppress, is_default?, kind?, lean?, leanings? } ] }
// or a bare array of those state objects.
//
// v1.4-portable — the format now carries `kind` and `lean` so ERA states (the
// timeline cards the Chronicler era bridge drives) survive a round-trip. Before
// this, import/export silently dropped `kind`, so every imported state came back
// a FACE and the era bridge could never find an era state to swing. Fields are
// optional and back-compatible: `kind` defaults to 'face', each `lean` axis to
// 'any'. Old files (no kind/lean) import exactly as they did before.

import { getContext } from '../../../../extensions.js';
import {
    getCharacterKey, getCharacterConfig, getChatState,
    generateId, saveSettings, saveChatData,
} from './state.js';

// Kept dependency-free on purpose (no config.js import) so the portable layer
// can't break on a constants refactor. These mirror STATE_KINDS / LEAN_SIGNS.
const VALID_KINDS = new Set(['face', 'era']);
const LEAN_AXES = ['valence', 'arousal', 'dominance'];
const VALID_LEAN = new Set(['neg', 'neutral', 'pos', 'any']);

function normalizeLeanings(l) {
    if (!l || typeof l !== 'object') return null;
    return {
        fixates: Array.isArray(l.fixates) ? l.fixates.filter(Boolean) : [],
        ignores: Array.isArray(l.ignores) ? l.ignores.filter(Boolean) : [],
    };
}

// A FACE's VAD lean region — each axis a sign ('neg'|'neutral'|'pos') or 'any'.
// ERA states ignore lean, but carrying a valid one is harmless.
function normalizeLean(l) {
    const out = { valence: 'any', arousal: 'any', dominance: 'any' };
    if (l && typeof l === 'object') {
        for (const ax of LEAN_AXES) if (VALID_LEAN.has(l[ax])) out[ax] = l[ax];
    }
    return out;
}
function leanIsDefault(l) {
    return !l || LEAN_AXES.every(ax => !l[ax] || l[ax] === 'any');
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
                    // v1.4-portable: carry kind + lean through so era cards survive.
                    kind: VALID_KINDS.has(s.kind) ? s.kind : 'face',
                    lean: normalizeLean(s.lean),
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
            // always emit kind (meaningful); emit lean only when it's set (keeps files clean)
            kind: (s.kind === 'era') ? 'era' : 'face',
            ...(leanIsDefault(s.lean) ? {} : {
                lean: {
                    valence: s.lean.valence || 'any',
                    arousal: s.lean.arousal || 'any',
                    dominance: s.lean.dominance || 'any',
                },
            }),
            ...(s.leanings ? { leanings: s.leanings } : {}),
        })),
    };
    return JSON.stringify(out, null, 2);
}
