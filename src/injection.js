import { getContext } from '../../../../extensions.js';
import { setExtensionPrompt } from '../../../../../script.js';
import { getSettings, getChatState } from './state.js';
import { getInjectableMemories } from './memories.js';
import { getActiveState } from './states.js';
import { getRelationshipSummary } from './relationship.js';

const INJECT_KEY = 'codex_character';

// Import prompt type constant
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
 * Build and inject the full Codex prompt block.
 * Called whenever state changes (memory added, state toggled, etc.)
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
    const msgCount = ctx?.chat?.length || 0;

    const sections = [];

    // ── Header ───────────────────────────────────────────────────────────
    sections.push(`[Codex — ${charName} | ${msgCount} messages]`);

    // ── Behavioral State ─────────────────────────────────────────────────
    const activeState = getActiveState();
    if (activeState) {
        let stateBlock = `\nState: ${activeState.name}`;
        if (activeState.express) {
            stateBlock += `\nEXPRESS: ${activeState.express}`;
        }
        if (activeState.suppress) {
            stateBlock += `\nSUPPRESS: ${activeState.suppress}`;
        }
        sections.push(stateBlock);
    }

    // ── Relationship Summary ─────────────────────────────────────────────
    const summary = getRelationshipSummary();
    if (summary) {
        sections.push(`\n${summary}`);
    }

    // ── Key Memories ─────────────────────────────────────────────────────
    const memories = getInjectableMemories(settings.maxMemoriesInject || 5);
    if (memories.length) {
        const memLines = memories.map(m => `- ${m.text}`).join('\n');
        sections.push(`\nKey moments:\n${memLines}`);
    }

    // ── Story Threads (Phase 2 — inject if any exist) ────────────────────
    const threads = (chatState.threads || []).filter(t =>
        t.status !== 'paused' && t.status !== 'resolved'
    );
    if (threads.length) {
        const threadLines = threads.map(t => {
            const statusIcon = { building: '🟡', active: '🔴', resolving: '🟢' }[t.status] || '⚪';
            const priorityNote = t.priority === 'primary' ? ' — advance this' : '';
            return `${statusIcon} ${t.name} (${t.status})${priorityNote}${t.description ? ': ' + t.description : ''}`;
        }).join('\n');
        sections.push(`\n[Active Threads]\n${threadLines}`);
    }

    // ── Writing Directives ───────────────────────────────────────────────
    const directives = chatState.writing_directives || [];
    if (directives.length) {
        const dirLines = directives.slice(0, 8).map(d => `- ${d}`).join('\n');
        sections.push(`\n[Writing]\n${dirLines}`);
    }

    // ── Assemble and inject ──────────────────────────────────────────────
    const injection = sections.join('\n');

    if (injection.trim().length > 0) {
        setExtensionPrompt(
            INJECT_KEY,
            injection,
            PROMPT_TYPE_IN_CHAT,
            settings.injectionDepth || 2,
            false
        );
    } else {
        clearInjection();
    }
}

/**
 * Clear the Codex injection.
 */
export function clearInjection() {
    try {
        setExtensionPrompt(INJECT_KEY, '', PROMPT_TYPE_IN_CHAT, 0, false);
    } catch (e) {
        // Ignore
    }
}
