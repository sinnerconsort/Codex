import { getChatState, generateId, saveChatData } from './state.js';
import {
    NUDGE_SIGNALS, NUDGE_THRESHOLD, NUDGE_COOLDOWN_MESSAGES,
    MEMORY_WEIGHTS,
} from './config.js';

const MAX_MEMORIES = 30;

// ─── CRUD ────────────────────────────────────────────────────────────────────

/**
 * Add a new memory to the current chat.
 * @param {string} text - The memory text
 * @param {string} type - Memory type (trust, conflict, etc.)
 * @param {string} weight - minor, normal, significant
 * @param {number} [messageIndex] - Current message index
 * @returns {object} The created memory
 */
export function addMemory(text, type = 'trust', weight = 'normal', messageIndex = null) {
    const state = getChatState();
    if (!Array.isArray(state.memories)) state.memories = [];

    const memory = {
        id: generateId('mem'),
        text: text.trim(),
        type,
        weight,
        message_index: messageIndex,
        timestamp: new Date().toISOString(),
    };

    state.memories.push(memory);

    // Enforce cap
    if (state.memories.length > MAX_MEMORIES) {
        pruneMemories(state);
    }

    saveChatData();
    return memory;
}

/**
 * Update an existing memory.
 */
export function updateMemory(memoryId, updates) {
    const state = getChatState();
    const memory = state.memories?.find(m => m.id === memoryId);
    if (!memory) return null;

    if (updates.text !== undefined) memory.text = updates.text.trim();
    if (updates.type !== undefined) memory.type = updates.type;
    if (updates.weight !== undefined) memory.weight = updates.weight;

    saveChatData();
    return memory;
}

/**
 * Delete a memory by ID.
 */
export function deleteMemory(memoryId) {
    const state = getChatState();
    if (!Array.isArray(state.memories)) return false;

    const idx = state.memories.findIndex(m => m.id === memoryId);
    if (idx === -1) return false;

    state.memories.splice(idx, 1);
    saveChatData();
    return true;
}

/**
 * Get all memories, optionally filtered.
 */
export function getMemories(filter = {}) {
    const state = getChatState();
    let memories = [...(state.memories || [])];

    if (filter.type) {
        memories = memories.filter(m => m.type === filter.type);
    }
    if (filter.weight) {
        memories = memories.filter(m => m.weight === filter.weight);
    }

    return memories;
}

/**
 * Get memories suitable for injection, sorted by priority.
 * Significant first, then normal, then minor. Within each tier, most recent first.
 */
export function getInjectableMemories(maxCount = 5) {
    const state = getChatState();
    const memories = [...(state.memories || [])];

    const priorityMap = {
        significant: 2,
        normal: 1,
        minor: 0,
    };

    return memories
        .sort((a, b) => {
            const pa = priorityMap[a.weight] ?? 1;
            const pb = priorityMap[b.weight] ?? 1;
            if (pb !== pa) return pb - pa;
            // Within same priority, most recent first
            const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
            return tb - ta;
        })
        .slice(0, maxCount);
}

// ─── Pruning ─────────────────────────────────────────────────────────────────

/**
 * Prune memories to stay under the cap.
 * Removes oldest minor memories first, then oldest normal.
 * Never auto-prunes significant memories.
 */
function pruneMemories(state) {
    while (state.memories.length > MAX_MEMORIES) {
        // Find oldest minor
        const minorIdx = findOldestByWeight(state.memories, 'minor');
        if (minorIdx !== -1) {
            state.memories.splice(minorIdx, 1);
            continue;
        }
        // Find oldest normal
        const normalIdx = findOldestByWeight(state.memories, 'normal');
        if (normalIdx !== -1) {
            state.memories.splice(normalIdx, 1);
            continue;
        }
        // If only significant remain and we're still over, stop — don't prune significant
        break;
    }
}

function findOldestByWeight(memories, weight) {
    let oldest = -1;
    let oldestTime = Infinity;
    for (let i = 0; i < memories.length; i++) {
        if (memories[i].weight !== weight) continue;
        const t = memories[i].timestamp ? new Date(memories[i].timestamp).getTime() : 0;
        if (t < oldestTime) {
            oldestTime = t;
            oldest = i;
        }
    }
    return oldest;
}

// ─── Nudge Detection ─────────────────────────────────────────────────────────

/**
 * Scan text for notable moment signals.
 * Returns { shouldNudge, totalWeight, dominantType, signals } or null.
 */
export function detectNudgeSignals(text, currentMsgIndex) {
    const state = getChatState();

    // Cooldown check
    if (state.last_nudge_at && (currentMsgIndex - state.last_nudge_at) < NUDGE_COOLDOWN_MESSAGES) {
        return null;
    }

    if (!text || text.length < 20) return null;

    const lower = text.toLowerCase();
    let totalWeight = 0;
    const fired = [];

    for (const [signalType, config] of Object.entries(NUDGE_SIGNALS)) {
        let matched = false;
        for (const pattern of config.patterns) {
            if (lower.includes(pattern)) {
                matched = true;
                break;
            }
        }
        if (matched) {
            totalWeight += config.weight;
            fired.push(signalType);
        }
    }

    if (totalWeight < NUDGE_THRESHOLD) return null;

    // Map signal types to memory types
    const typeMap = {
        emotional: 'tension',
        disclosure: 'disclosure',
        physical_contact: 'milestone',
        conflict: 'conflict',
        favor: 'trust',
        humor: 'humor',
        danger: 'tension',
    };

    const dominantSignal = fired.sort((a, b) =>
        (NUDGE_SIGNALS[b]?.weight || 0) - (NUDGE_SIGNALS[a]?.weight || 0)
    )[0];

    return {
        shouldNudge: true,
        totalWeight,
        dominantType: typeMap[dominantSignal] || 'trust',
        signals: fired,
    };
}

/**
 * Record that a nudge was shown (for cooldown tracking).
 */
export function recordNudgeShown(messageIndex) {
    const state = getChatState();
    state.last_nudge_at = messageIndex;
    saveChatData();
}

/**
 * Auto-draft a memory from recent messages.
 * Extracts a condensed summary from the last 2 messages.
 */
export function draftMemoryFromContext(recentMessages, characterName) {
    if (!recentMessages || !recentMessages.length) return '';

    // Take last 2 messages, extract key actions/dialogue
    const relevant = recentMessages.slice(-2);
    const parts = relevant.map(msg => {
        const text = (msg.mes || '').substring(0, 200).replace(/\n+/g, ' ').trim();
        return text;
    }).filter(Boolean);

    if (!parts.length) return '';

    // Simple condensation: take first sentence from each
    const condensed = parts.map(p => {
        const firstSentence = p.match(/^[^.!?]+[.!?]/)?.[0] || p.substring(0, 80);
        return firstSentence.trim();
    }).join(' ');

    return condensed.substring(0, 200);
}
