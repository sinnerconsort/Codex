// Codex ↔ Lexicon Bridge
// ──────────────────────────────────────────────────────────────────────────────
// Turns Lexicon's gatekeeping into Codex state changes. Runs once per message
// (called from index.js → onMessageReceived, before buildAndInject). No-ops
// cleanly if Lexicon is absent or inactive — Lexicon stays an optional dep.
//
// Two effects:
//   1. ERA SYNC — the active "ERA ▸ <Name>" Lexicon entry (the one whose gate is
//      met) drives Codex's active state. <Name> must match a Codex state name.
//   2. REVEAL REACTION — when a gated/twist Lexicon entry newly fires
//      (entry.chekhov.firedAt set), inject a one-shot writing directive. If the
//      reveal is a "wound" (its scene_types include 'intimate'), also swing the
//      active state to the crack state ("The Seam") for a couple of turns, then
//      restore the era state.
//
// Conventions are general, not Spike-specific: any character whose Lexicon era
// entries are titled "ERA ▸ <StateName> — …" and whose Codex states share those
// names gets full wiring, plus an optional state named "The Seam".

import { getContext } from '../../../../extensions.js';
import { getChatState, getSettings, saveChatData } from './state.js';
import { getStates, getActiveState, setActiveState } from './states.js';

const BRIDGE_DIR_TAG = '⟢';            // sentinel marking bridge-added directives
const ERA_PREFIX = 'ERA ▸';
const CRACK_STATE_NAMES = ['The Seam', 'Seam'];
const SEAM_HOLD_MESSAGES = 2;          // how many turns the crack lingers

// ─── per-chat bridge memory ───────────────────────────────────────────────────
function bridgeMem() {
    const cs = getChatState();
    if (!cs._codexBridge || typeof cs._codexBridge !== 'object') {
        cs._codexBridge = { seenFired: [], lastEraState: null, seamHold: 0, restoreState: null };
    }
    const b = cs._codexBridge;
    if (!Array.isArray(b.seenFired)) b.seenFired = [];
    if (typeof b.seamHold !== 'number') b.seamHold = 0;
    return b;
}

// ─── helpers ──────────────────────────────────────────────────────────────────
function findStateByName(name) {
    if (!name) return null;
    const t = name.trim().toLowerCase();
    return getStates().find(s => (s.name || '').trim().toLowerCase() === t) || null;
}

function findCrackState() {
    const states = getStates();
    for (const nm of CRACK_STATE_NAMES) {
        const hit = states.find(s => (s.name || '').trim().toLowerCase() === nm.toLowerCase());
        if (hit) return hit;
    }
    return null;
}

function parseEraStateName(title) {
    // "ERA ▸ Big Bad — S2, with Drusilla" → "Big Bad"
    const t = String(title || '').trim();
    if (!t.startsWith(ERA_PREFIX)) return null;
    let rest = t.slice(ERA_PREFIX.length).trim();
    rest = rest.split(/\s+[—–-]\s+/)[0].trim();   // cut at em/en/hyphen dash
    return rest || null;
}

function clearBridgeDirectives(cs) {
    if (Array.isArray(cs.writing_directives)) {
        cs.writing_directives = cs.writing_directives.filter(d => !String(d).startsWith(BRIDGE_DIR_TAG));
    }
}

function addBridgeDirective(cs, text) {
    if (!Array.isArray(cs.writing_directives)) cs.writing_directives = [];
    cs.writing_directives.unshift(`${BRIDGE_DIR_TAG} ${text}`);   // prepend → always in the injected top-5
}

// ─── main ─────────────────────────────────────────────────────────────────────
export async function runLexiconBridge() {
    try {
        const api = window.LexiconAPI;
        if (!api || api.isActive?.() === false || typeof api.getEntries !== 'function') return false;
        if (getSettings()?.enabled === false) return false;

        const entries = await api.getEntries({});   // full entries: chekhov, gateConditions, scene_types, revealTier
        if (!Array.isArray(entries)) return false;

        const cs = getChatState();
        const b = bridgeMem();
        let changed = false;

        // start clean — last turn's one-shot directive has done its job
        clearBridgeDirectives(cs);

        // ── 1) ERA SYNC ──────────────────────────────────────────────────────
        // Single-gatekeeper inversion: if Chronicler is present, IT owns which
        // ERA is active (it holds the ladder + pointer; we only read it). The
        // matching "ERA ▸ <Name>" Lexicon entry is selected by Chronicler's
        // active era, and its own gateConditions are ignored for this purpose —
        // no two-master problem. Falls back to the original gate.met behavior
        // when Chronicler is absent, so Codex still works standalone.
        const chronEra = (() => {
            try {
                const api = window.ChroniclerAPI;
                if (!api || api.isActive?.() === false || typeof api.getActiveEra !== 'function') return null;
                const era = api.getActiveEra();
                return era ? String(era).trim().toLowerCase() : null;
            } catch { return null; }
        })();

        const eraEntry = chronEra
            ? entries.find(e =>
                String(e.title || '').startsWith(ERA_PREFIX) &&
                (parseEraStateName(e.title) || '').trim().toLowerCase() === chronEra
              )
            : entries.find(e =>
                String(e.title || '').startsWith(ERA_PREFIX) &&
                Array.isArray(e.gateConditions) && e.gateConditions.some(g => g && g.met)
              );
        if (eraEntry) {
            const target = findStateByName(parseEraStateName(eraEntry.title));
            if (target && b.lastEraState !== target.id) {
                if (b.seamHold <= 0) setActiveState(target.id);   // don't stomp an active crack
                b.lastEraState = target.id;
                changed = true;
            }
        }

        // ── 2) FRESH REVEALS ─────────────────────────────────────────────────
        const fresh = entries.filter(e => {
            if ((e.revealTier || 'background') === 'background') return false;
            if (!e.chekhov?.firedAt) return false;
            return !b.seenFired.includes(e.id);
        });

        if (fresh.length) {
            for (const e of fresh) b.seenFired.push(e.id);
            // most significant reveal leads the directive (twist outranks gated)
            const lead = fresh.slice().sort((a, c) =>
                ((c.revealTier === 'twist') ? 1 : 0) - ((a.revealTier === 'twist') ? 1 : 0))[0];
            const isWound = Array.isArray(lead.scene_types) && lead.scene_types.includes('intimate');
            const who = getContext()?.name2 || 'the character';

            if (isWound) {
                addBridgeDirective(cs,
                    `A guarded, painful truth about ${who} has just surfaced in the story ("${lead.title}"). ` +
                    `Let it crack their composure now — the practiced mask should fail and the rawer self show through. ` +
                    `Do NOT let them recover their usual front this turn.`);
                const crack = findCrackState();
                if (crack && getActiveState()?.id !== crack.id) {
                    if (b.restoreState == null) b.restoreState = getActiveState()?.id || b.lastEraState || null;
                    setActiveState(crack.id);
                    b.seamHold = SEAM_HOLD_MESSAGES;
                }
            } else {
                addBridgeDirective(cs,
                    `A previously hidden fact about ${who} has just come to light ("${lead.title}"). ` +
                    `Let it land and color the scene; don't gloss over it as if it were always known.`);
            }
            changed = true;
        } else if (b.seamHold > 0) {
            // crack hold countdown → recompose to the era state
            b.seamHold -= 1;
            if (b.seamHold <= 0 && b.restoreState) {
                setActiveState(b.restoreState);
                b.restoreState = null;
            }
            changed = true;
        }

        saveChatData();
        return changed;
    } catch (e) {
        console.warn('[Codex] Lexicon bridge failed:', e);
        return false;
    }
}
