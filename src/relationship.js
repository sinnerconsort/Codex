import { getContext } from '../../../../extensions.js';
import { getChatState, saveChatData } from './state.js';
import { getMemories, getInjectableMemories } from './memories.js';
import { MEMORY_TYPE_META } from './config.js';

// ─── Summary Management ──────────────────────────────────────────────────────

/**
 * Get the current relationship summary.
 */
export function getRelationshipSummary() {
    const state = getChatState();
    return state.relationship_summary || '';
}

/**
 * Set the relationship summary manually (user edit).
 */
export function setRelationshipSummary(text) {
    const state = getChatState();
    state.relationship_summary = text.trim();
    state.relationship_auto = false; // User took manual control
    saveChatData();
}

/**
 * Regenerate the relationship summary from accumulated memories.
 * Template-based — no AI call.
 */
export function regenerateSummary() {
    const ctx = getContext();
    const charName = ctx?.name2 || 'the character';
    const state = getChatState();
    const memories = getMemories();

    if (!memories.length) {
        state.relationship_summary = `No shared history with ${charName} yet.`;
        state.relationship_auto = true;
        saveChatData();
        return state.relationship_summary;
    }

    // Count memory types
    const typeCounts = {};
    for (const m of memories) {
        typeCounts[m.type] = (typeCounts[m.type] || 0) + 1;
    }

    // Find dominant type
    const sorted = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
    const dominant = sorted[0]?.[0];
    const secondary = sorted[1]?.[0];

    // Compute relationship temperature
    const trustScore = (typeCounts.trust || 0) + (typeCounts.disclosure || 0) + (typeCounts.humor || 0);
    const tensionScore = (typeCounts.conflict || 0) + (typeCounts.tension || 0);
    const net = trustScore - tensionScore;

    let temperature;
    if (net <= -3) temperature = 'deeply strained';
    else if (net <= -1) temperature = 'tense and uncertain';
    else if (net <= 1) temperature = 'cautiously developing';
    else if (net <= 3) temperature = 'warm and growing';
    else if (net <= 5) temperature = 'strong and trusting';
    else temperature = 'deeply bonded';

    // Get significant memories for highlights
    const highlights = memories
        .filter(m => m.weight === 'significant')
        .slice(-3)
        .map(m => m.text);

    // Build summary
    const parts = [];

    parts.push(`Relationship with ${charName}: ${temperature}.`);

    // Describe the dynamic
    const totalMemories = memories.length;
    if (dominant) {
        const meta = MEMORY_TYPE_META[dominant];
        const desc = getDynamicDescription(dominant, secondary, typeCounts);
        if (desc) parts.push(desc);
    }

    // Add highlights
    if (highlights.length) {
        parts.push(`Key moments: ${highlights.join('. ')}.`);
    }

    // Message count context
    const msgCount = ctx?.chat?.length || 0;
    if (msgCount > 0) {
        parts.push(`(${totalMemories} memories over ${msgCount} messages)`);
    }

    state.relationship_summary = parts.join(' ');
    state.relationship_auto = true;
    saveChatData();
    return state.relationship_summary;
}

// ─── Dynamic Descriptions ────────────────────────────────────────────────────

function getDynamicDescription(dominant, secondary, counts) {
    const descriptions = {
        trust: 'Built on reliability and mutual support.',
        conflict: 'Marked by friction and unresolved disagreements.',
        disclosure: 'Growing through shared vulnerabilities and honesty.',
        humor: 'Bonded through shared laughter and lightness.',
        tension: 'Held together by an undercurrent of unease.',
        milestone: 'Defined by turning points and significant moments.',
    };

    let desc = descriptions[dominant] || '';

    // Add secondary flavor if present
    if (secondary && counts[secondary] >= 2) {
        const secondaryFlavors = {
            trust: 'Underpinned by moments of trust.',
            conflict: 'Complicated by occasional clashes.',
            disclosure: 'Deepened by personal revelations.',
            humor: 'Lightened by moments of humor.',
            tension: 'Shadowed by underlying tension.',
            milestone: 'Punctuated by meaningful events.',
        };
        desc += ' ' + (secondaryFlavors[secondary] || '');
    }

    return desc;
}

/**
 * Check if the summary should be regenerated based on memory changes.
 * Called after memory add/remove to auto-update if in auto mode.
 */
export function maybeRegenerateSummary() {
    const state = getChatState();
    if (state.relationship_auto) {
        regenerateSummary();
    }
}
