import { getChatState, generateId, saveChatData } from './state.js';
import { THREAD_STATUSES } from './config.js';

const MAX_THREADS = 12;
const MAX_HISTORY = 30;

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
 * Sorted primary-first, then by narrative urgency (climax > escalating > building).
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
            return (statusWeight[b.status] ?? 0) - (statusWeight[a.status] ?? 0);
        })
        .slice(0, maxCount);
}

export function getThreadHistory() {
    const state = getChatState();
    return [...(state.thread_history || [])];
}
