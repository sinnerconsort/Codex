import { getChatState, generateId, saveChatData } from './state.js';
import { THREAD_STATUSES, THREAD_STATUS_CYCLE } from './config.js';
import { getActiveState } from './states.js';

const MAX_THREADS = 12;
const MAX_HISTORY = 30;

// ─── Ledger maintenance tuning (v1.3) ────────────────────────────────────────
// The "invisible hand". Threads the story keeps touching stay warm and can rise;
// threads nobody reinforces cool off, step down, and eventually go dormant
// (paused) so they drop out of the prompt — "fell off the ledger = furniture."
// Nothing is ever auto-deleted or auto-resolved. Dormant threads stay in the
// list and wake the instant they're mentioned again. Primary threads never go
// dormant. This object is the only knob-box; tune here.
const LEDGER = {
    MAX_HEAT:        5,   // ceiling on the attention counter
    HEAT_ON_MENTION: 2,   // heat gained when a thread is referenced
    PROMOTE_HEAT:    4,   // heat at which a 'building' thread auto-rises to 'escalating'
    COOL_EVERY:      3,   // lose 1 heat per this many silent turns
    STALE_DEMOTE:    8,   // silent turns before a thread steps DOWN one status
    STALE_DORMANT:   16,  // silent turns before a (secondary) thread auto-pauses
    MIN_NAME_TOKEN:  4,   // ignore name words shorter than this when matching mentions
};

// ─── Disposition weighting (v1.4) ────────────────────────────────────────────
// Decay isn't a fixed clock — it's paced by HOW THE CHARACTER FEELS (VAD) and
// what they're disposed toward. An agitated/helpless character holds onto
// threads (they linger); a calm/in-control one lets them go (they fade). A
// thread the active state *fixates on* resists decay; one it *ignores* fades
// fast. With neutral mood and no leanings set, pace = 1.0 (plain v1.3 aging).
const DISPOSITION = {
    MOOD_PER_AGITATION: 0.12, // each point of (arousal − dominance) slows decay this much
    PACE_MIN:           0.25, // floor: even maximally agitated, threads still age
    PACE_MAX:           2.5,  // ceiling: calm + ignored fades fast, not instant
    FIXATE_FACTOR:      0.4,  // active disposition fixates on this thread → lingers
    IGNORE_FACTOR:      2.0,  // active disposition ignores this thread → fades fast
};

// ─── CRUD ────────────────────────────────────────────────────────────────────

/**
 * Add a new plot thread to the current chat.
 */
export function addThread(name, description = '', priority = 'secondary', status = THREAD_STATUSES.BUILDING) {
    const state = getChatState();
    if (!Array.isArray(state.threads)) state.threads = [];

    if (state.threads.length >= MAX_THREADS) {
        return null; // Caller should toast — too many open threads is its own problem
    }

    const thread = {
        id: generateId('thr'),
        name: name.trim(),
        description: description.trim(),
        status,
        priority,
        created_at: new Date().toISOString(),
        // v1.3 ledger fields
        heat: 0,
        silent: 0,
        last_seen_msg: null,
        created_msg: null,
        decay_accum: 0,        // v1.4: paced staleness accumulator
    };

    state.threads.push(thread);
    saveChatData();
    return thread;
}

/**
 * Update an existing thread.
 */
export function updateThread(threadId, updates) {
    const state = getChatState();
    const thread = state.threads?.find(t => t.id === threadId);
    if (!thread) return null;

    if (updates.name !== undefined) thread.name = updates.name.trim();
    if (updates.description !== undefined) thread.description = updates.description.trim();
    if (updates.status !== undefined) thread.status = updates.status;
    if (updates.priority !== undefined) thread.priority = updates.priority;

    // A manual touch counts as reinforcement — warm it and reset the clock.
    thread.silent = 0;
    if (typeof thread.heat === 'number') {
        thread.heat = Math.min(LEDGER.MAX_HEAT, thread.heat + 1);
    }

    saveChatData();
    return thread;
}

/**
 * Delete a thread outright (no history entry).
 */
export function deleteThread(threadId) {
    const state = getChatState();
    if (!Array.isArray(state.threads)) return false;

    const idx = state.threads.findIndex(t => t.id === threadId);
    if (idx === -1) return false;

    state.threads.splice(idx, 1);
    saveChatData();
    return true;
}

/**
 * Resolve a thread: archive it to thread_history and remove it from the
 * active list. Resolved threads stop injecting but stay reviewable.
 */
export function resolveThread(threadId) {
    const state = getChatState();
    if (!Array.isArray(state.threads)) return false;

    const idx = state.threads.findIndex(t => t.id === threadId);
    if (idx === -1) return false;

    const [thread] = state.threads.splice(idx, 1);
    thread.status = THREAD_STATUSES.RESOLVED;
    thread.resolved_at = new Date().toISOString();

    if (!Array.isArray(state.thread_history)) state.thread_history = [];
    state.thread_history.push(thread);
    if (state.thread_history.length > MAX_HISTORY) {
        state.thread_history = state.thread_history.slice(-MAX_HISTORY);
    }

    saveChatData();
    return true;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export function getThreads() {
    const state = getChatState();
    return [...(state.threads || [])];
}

/**
 * Threads that should reach the prompt: not paused, not resolved.
 * Sorted primary-first, then by narrative urgency (climax > escalating > building),
 * then by heat so a thread the story is actively poking ranks above a cold peer.
 */
export function getInjectableThreads(maxCount = 5) {
    const state = getChatState();
    const statusWeight = { climax: 2, escalating: 1, building: 0 };

    return (state.threads || [])
        .filter(t => t.status !== THREAD_STATUSES.PAUSED && t.status !== THREAD_STATUSES.RESOLVED)
        .sort((a, b) => {
            const pa = a.priority === 'primary' ? 1 : 0;
            const pb = b.priority === 'primary' ? 1 : 0;
            if (pb !== pa) return pb - pa;
            const sw = (statusWeight[b.status] ?? 0) - (statusWeight[a.status] ?? 0);
            if (sw !== 0) return sw;
            return (b.heat ?? 0) - (a.heat ?? 0);
        })
        .slice(0, maxCount);
}

export function getThreadHistory() {
    const state = getChatState();
    return [...(state.thread_history || [])];
}

// ─── Ledger maintenance (v1.3) ───────────────────────────────────────────────

const RX_CACHE = new Map();
function escapeRx(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Match the full thread name as a phrase, OR any meaningful word from it.
function buildMatcher(thread) {
    const name = (thread.name || '').toLowerCase().trim();
    if (!name) return null;
    if (RX_CACHE.has(name)) return RX_CACHE.get(name);

    const parts = [escapeRx(name)];
    for (const tok of name.split(/[^a-z0-9]+/i)) {
        if (tok.length >= LEDGER.MIN_NAME_TOKEN) parts.push(`\\b${escapeRx(tok)}\\b`);
    }
    const rx = new RegExp(parts.join('|'), 'i');
    RX_CACHE.set(name, rx);
    return rx;
}

function threadMentioned(thread, lowerText) {
    const rx = buildMatcher(thread);
    return rx ? rx.test(lowerText) : false;
}

function stepStatus(status, dir) {
    const i = THREAD_STATUS_CYCLE.indexOf(status);
    if (i === -1) return status; // paused/resolved/unknown — leave alone
    const next = Math.min(THREAD_STATUS_CYCLE.length - 1, Math.max(0, i + dir));
    return THREAD_STATUS_CYCLE[next];
}

// Does the active character's disposition fixate on / ignore this thread?
// Reads optional `leanings: { fixates: [...], ignores: [...] }` on the active state.
function leaningFactor(thread) {
    let st = null;
    try { st = getActiveState(); } catch { st = null; }
    const lean = st && st.leanings;
    if (!lean) return 1.0;
    const hay = `${thread.name || ''} ${thread.description || ''}`.toLowerCase();
    const hit = list => Array.isArray(list) && list.some(k => k && hay.includes(String(k).toLowerCase()));
    if (hit(lean.fixates)) return DISPOSITION.FIXATE_FACTOR;
    if (hit(lean.ignores)) return DISPOSITION.IGNORE_FACTOR;
    return 1.0;
}

// How fast THIS thread ages this turn, given the character's mood (VAD) and
// disposition toward it. <1 lingers (anxious / fixated), >1 fades (calm / ignored).
function decayPace(thread) {
    const vad = getChatState().vad || { arousal: 0, dominance: 0 };
    const agitation = (Number(vad.arousal) || 0) - (Number(vad.dominance) || 0); // −4…4
    let pace = 1 - DISPOSITION.MOOD_PER_AGITATION * agitation;                    // agitated → slower
    pace *= leaningFactor(thread);
    return Math.max(DISPOSITION.PACE_MIN, Math.min(DISPOSITION.PACE_MAX, pace));
}

/**
 * Per-message ledger upkeep. Call once per message (on MESSAGE_RECEIVED) with
 * the recent message text and the current chat index.
 *   • Mentioned threads → reset silence, warm up, wake from dormancy, maybe promote.
 *   • Ignored threads   → accrue silence, cool down, step down at STALE_DEMOTE,
 *                          go dormant at STALE_DORMANT (secondary threads only).
 * Mutates and persists the thread list. Returns a small summary for debugging.
 */
export function maintainThreads(text = '', msgIndex = 0) {
    const state = getChatState();
    if (!Array.isArray(state.threads) || !state.threads.length) return null;

    const lower = (text || '').toLowerCase();
    const summary = { reinforced: [], promoted: [], demoted: [], dormant: [], revived: [] };
    let changed = false;

    for (const t of state.threads) {
        if (t.status === THREAD_STATUSES.RESOLVED) continue;

        // Backfill ledger fields for threads created before v1.3 / first run.
        if (typeof t.heat !== 'number') { t.heat = 0; changed = true; }
        if (typeof t.silent !== 'number') { t.silent = 0; changed = true; }
        if (typeof t.decay_accum !== 'number') { t.decay_accum = t.silent || 0; changed = true; }
        if (t.created_msg == null) { t.created_msg = msgIndex; changed = true; }

        const mentioned = lower && threadMentioned(t, lower);

        if (mentioned) {
            t.silent = 0;
            t.decay_accum = 0;
            t.last_seen_msg = msgIndex;
            t.heat = Math.min(LEDGER.MAX_HEAT, t.heat + LEDGER.HEAT_ON_MENTION);
            summary.reinforced.push(t.name);
            changed = true;

            // The story touched a dormant thread — wake it back up.
            if (t.status === THREAD_STATUSES.PAUSED) {
                t.status = THREAD_STATUSES.BUILDING;
                summary.revived.push(t.name);
            }
            // Sustained attention nudges a background thread into motion — but
            // never straight to climax. Payoff stays a deliberate choice.
            if (t.status === THREAD_STATUSES.BUILDING && t.heat >= LEDGER.PROMOTE_HEAT) {
                t.status = THREAD_STATUSES.ESCALATING;
                summary.promoted.push(t.name);
            }
            continue;
        }

        // Ignored this turn → cool with age, paced by mood + disposition.
        if (t.status === THREAD_STATUSES.PAUSED) continue; // already furniture

        const prev = Math.floor(t.decay_accum);
        t.silent += 1;
        t.decay_accum += decayPace(t);
        const eff = Math.floor(t.decay_accum);   // effective (paced) staleness
        changed = true;

        const isPrimary = t.priority === 'primary';

        // Heat cools each time effective staleness crosses a COOL_EVERY boundary.
        if (t.heat > 0 && Math.floor(eff / LEDGER.COOL_EVERY) > Math.floor(prev / LEDGER.COOL_EVERY)) {
            t.heat = Math.max(0, t.heat - 1);
        }

        // Secondary 'building' threads go dormant when effective staleness first
        // crosses the dormancy line. Primary threads never vanish.
        if (!isPrimary && t.status === THREAD_STATUSES.BUILDING &&
            eff >= LEDGER.STALE_DORMANT && prev < LEDGER.STALE_DORMANT) {
            t.status = THREAD_STATUSES.PAUSED;        // fell off the ledger → furniture
            summary.dormant.push(t.name);
        } else if (Math.floor(eff / LEDGER.STALE_DEMOTE) > Math.floor(prev / LEDGER.STALE_DEMOTE)) {
            const lowered = stepStatus(t.status, -1); // climax → escalating → building
            if (lowered !== t.status) {
                t.status = lowered;
                summary.demoted.push(t.name);
            }
        }
    }

    if (changed) saveChatData();
    return summary;
}
