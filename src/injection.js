import { getContext } from '../../../../extensions.js';
import { setExtensionPrompt } from '../../../../../script.js';
import { getSettings, getChatState } from './state.js';
import { getInjectableMemories } from './memories.js';
import { getInjectableThreads } from './threads.js';
import { getActiveState } from './states.js';

const INJECT_KEY = 'codex_character';

let PROMPT_TYPE_IN_CHAT = 1;
try {
    const { extension_prompt_types } = await import('../../../../../script.js');
    if (extension_prompt_types?.IN_CHAT !== undefined) {
        PROMPT_TYPE_IN_CHAT = extension_prompt_types.IN_CHAT;
    }
} catch {
    // Numeric fallback
}

/**
 * Build and inject the Codex prompt block.
 * Three-field framing: what's changed, memories, growing toward.
 * Behavioral states layer on top if defined.
 */
export function buildAndInject() {
    const settings = getSettings();
    if (!settings.enabled) {
        clearInjection();
        return;
    }

    const ctx = getContext();
    const chatState = getChatState();
    const charName = ctx?.name2 || 'Character';

    const parts = [];

    // ── Header ───────────────────────────────────────────────────────────
    parts.push(`[Codex — ${charName}]`);

    // ── Behavioral State (if active — power user feature) ────────────────
    const activeState = getActiveState();
    if (activeState) {
        let stateBlock = `Mode: ${activeState.name}`;
        if (activeState.express) stateBlock += `\n${activeState.express}`;
        if (activeState.suppress) stateBlock += `\n${activeState.suppress}`;
        parts.push(stateBlock);
    }

    // ── What's Changed (the diff against the card) ───────────────────────
    const whatsChanged = (chatState.whats_changed || '').trim();
    if (whatsChanged) {
        parts.push(`What's changed: ${whatsChanged}`);
    }

    // ── Memories ─────────────────────────────────────────────────────────
    const memories = getInjectableMemories(settings.maxMemoriesInject || 5);
    if (memories.length) {
        const memText = memories.map(m => m.text).join('. ');
        parts.push(`Remembers: ${memText}.`);
    }

    // ── Open Plot Threads (v1.2) ─────────────────────────────────────────
    const threads = getInjectableThreads(5);
    if (threads.length) {
        const threadLines = threads.map(t => {
            const star = t.priority === 'primary' ? '★ ' : '';
            const desc = t.description ? `: ${t.description}` : '';
            return `- ${star}${t.name} [${t.status}]${desc}`;
        });
        const guidance = 'Weave open threads into scenes when natural. '
            + 'Building threads simmer in the background; escalating threads should gain momentum; '
            + 'climax threads push toward payoff. ★ threads deserve forward motion. '
            + 'Never resolve a thread in a single beat.';
        parts.push(`Open plot threads:\n${threadLines.join('\n')}\n(${guidance})`);
    }

    // ── Growing Toward ───────────────────────────────────────────────────
    const growingToward = (chatState.growing_toward || '').trim();
    if (growingToward) {
        parts.push(`Growing toward: ${growingToward}`);
    }

    // ── Writing Directives ───────────────────────────────────────────────
    const directives = chatState.writing_directives || [];
    if (directives.length) {
        parts.push(directives.slice(0, 5).map(d => `- ${d}`).join('\n'));
    }

    // ── Assemble ─────────────────────────────────────────────────────────
    // Only inject if we have something beyond just the header
    if (parts.length <= 1) {
        clearInjection();
        return;
    }

    const injection = parts.join('\n\n');

    setExtensionPrompt(
        INJECT_KEY,
        injection,
        PROMPT_TYPE_IN_CHAT,
        settings.injectionDepth || 2,
        false
    );
}

export function clearInjection() {
    try {
        setExtensionPrompt(INJECT_KEY, '', PROMPT_TYPE_IN_CHAT, 0, false);
    } catch (e) {
        // Ignore
    }
}
