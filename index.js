/**
 * The Codex v2.0 — Character State Engine
 * Per-chat character psychology with global identity persistence.
 * World grouping, collapsible Cast UI, relationship tracking.
 * Part of the Lexicon → Codex → Chronicler pipeline.
 */
import {
    getContext,
    extension_settings,
} from '../../../extensions.js';

import {
    eventSource,
    event_types,
    saveSettingsDebounced,
    saveChatDebounced,
    chat_metadata,
    generateRaw,
    setExtensionPrompt,
} from '../../../../script.js';

// ═══════════════════════════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

const EXT_ID = 'codex';
const EXT_NAME = 'The Codex';
const EXT_VERSION = '2.0.0';
const INJECT_KEY = 'codex_directives';

// ═══════════════════════════════════════════════════════════════════════════════
//  DATA MODELS
// ═══════════════════════════════════════════════════════════════════════════════

/** Global character identity — who they ARE. Survives across chats. */
function newGlobalCharacter(name, source = 'manual') {
    return {
        id: `codex_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now()}`,
        name,
        aliases: [],
        core: '',
        source,
        world: 'Uncategorized',
        linkedLexiconEntries: [],
        lexiconEntryId: '',
        baseRelationships: {},
        createdAt: Date.now(),
    };
}

/** Per-chat character state — who they are RIGHT NOW. Unique to each conversation. */
function newChatState() {
    return {
        currentMood: '',
        activeGoal: '',
        stance: '',
        hiding: '',
        fear: '',
        recentMemory: '',
        directive: '',
        activeTraits: [],
        dormantTraits: [],
        relationships: {},
        secretsAtRisk: 0,
        lastUpdated: 0,
        updateCount: 0,
        scenesSinceUpdate: 0,
    };
}

const DEFAULT_SETTINGS = {
    enabled: true,
    selectedProfile: 'current',
    updateMode: 'on_mention',
    updateEveryN: 3,
    sceneDetection: 'ai',
    maxSimultaneousUpdates: 3,
    enableOffscreen: false,
    offscreenFrequency: 5,
    injectionDepth: 1,
    injectRelationships: true,
    maxDirectiveLength: 500,
    useLexicon: true,
    trackSecretsAtRisk: true,
    characters: {},       // Global character identities keyed by id
    worlds: [],           // Known world/group names
    collapsedWorlds: [],  // Which world groups are collapsed in UI
    settingsVersion: 2,
};

const DEFAULT_CHAT = {
    characterStates: {},   // Per-chat psychology keyed by character id
    activeCharacters: [],
    manuallyPinned: [],
    activeWorlds: [],      // Which world groups are relevant to this chat
    characterHistory: [],
    lastUpdateAt: 0,
    lastUpdateTime: 0,
};

// ═══════════════════════════════════════════════════════════════════════════════
//  STATE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

function getSettings() {
    if (!extension_settings[EXT_ID]) extension_settings[EXT_ID] = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    const s = extension_settings[EXT_ID];
    for (const k in DEFAULT_SETTINGS) { if (s[k] === undefined) s[k] = DEFAULT_SETTINGS[k]; }
    if (!s.characters || typeof s.characters !== 'object') s.characters = {};
    if (!Array.isArray(s.worlds)) s.worlds = [];
    if (!Array.isArray(s.collapsedWorlds)) s.collapsedWorlds = [];
    return s;
}

function getChat() {
    if (!chat_metadata) return JSON.parse(JSON.stringify(DEFAULT_CHAT));
    if (!chat_metadata[EXT_ID]) chat_metadata[EXT_ID] = JSON.parse(JSON.stringify(DEFAULT_CHAT));
    const c = chat_metadata[EXT_ID];
    for (const k in DEFAULT_CHAT) { if (c[k] === undefined) c[k] = JSON.parse(JSON.stringify(DEFAULT_CHAT[k])); }
    if (!c.characterStates || typeof c.characterStates !== 'object') c.characterStates = {};
    if (!Array.isArray(c.activeCharacters)) c.activeCharacters = [];
    if (!Array.isArray(c.manuallyPinned)) c.manuallyPinned = [];
    if (!Array.isArray(c.activeWorlds)) c.activeWorlds = [];
    if (!Array.isArray(c.characterHistory)) c.characterHistory = [];
    return c;
}

/** Get the per-chat state for a character, creating from template if needed */
function getChatStateFor(charId) {
    const chat = getChat();
    if (!chat.characterStates[charId]) {
        chat.characterStates[charId] = newChatState();
        // Seed relationships from global base
        const global = getSettings().characters[charId];
        if (global?.baseRelationships) {
            chat.characterStates[charId].relationships = JSON.parse(JSON.stringify(global.baseRelationships));
        }
    }
    return chat.characterStates[charId];
}

/** Get merged view of a character (global identity + per-chat state) */
function getFullCharacter(charId) {
    const global = getSettings().characters[charId];
    if (!global) return null;
    const state = getChatStateFor(charId);
    return { ...global, ...state, id: global.id, name: global.name };
}

function getAllGlobalCharacters() {
    return Object.values(getSettings().characters || {});
}

function getCharacterByName(name) {
    const chars = getSettings().characters;
    return Object.values(chars).find(c => c.name.toLowerCase() === name.toLowerCase()) || null;
}

function getActiveCharacters() {
    const chat = getChat();
    return (chat.activeCharacters || []).map(id => getFullCharacter(id)).filter(Boolean);
}

function addHistoryEntry(charName, field, oldVal, newVal) {
    const chat = getChat();
    chat.characterHistory.push({
        timestamp: Date.now(), characterName: charName, field,
        oldValue: String(oldVal || '').substring(0, 80),
        newValue: String(newVal || '').substring(0, 80)
    });
    if (chat.characterHistory.length > 300) chat.characterHistory = chat.characterHistory.slice(-300);
}

// ── V1 Migration ──

function migrateFromV1() {
    const s = getSettings();
    if (s.settingsVersion >= 2) return;

    // V1 stored per-chat state in global characters — move it to chat_metadata
    for (const [id, char] of Object.entries(s.characters)) {
        // Strip per-chat fields out of global, keep only identity
        const chatFields = ['currentMood', 'activeGoal', 'stance', 'hiding', 'fear',
            'recentMemory', 'directive', 'activeTraits', 'dormantTraits', 'relationships',
            'secretsAtRisk', 'active', 'detectedVia', 'lastActiveMessage', 'lastUpdated',
            'updateCount', 'scenesSinceUpdate'];

        // If we have an active chat, seed the per-chat state from v1 data
        if (chat_metadata) {
            const chat = getChat();
            if (!chat.characterStates[id]) {
                const state = newChatState();
                for (const f of chatFields) {
                    if (char[f] !== undefined) state[f] = char[f];
                }
                chat.characterStates[id] = state;
            }
        }

        // Clean global — keep only identity fields
        for (const f of chatFields) { delete char[f]; }

        // Ensure world tag
        if (!char.world) char.world = 'Uncategorized';
        if (!char.baseRelationships) char.baseRelationships = {};
    }

    s.settingsVersion = 2;
    console.log('[Codex] Migrated from v1 to v2');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PERSISTENCE
// ═══════════════════════════════════════════════════════════════════════════════

function saveGlobal() { saveSettingsDebounced(); }
function saveChatData() { if (chat_metadata) saveChatDebounced(); }

// ═══════════════════════════════════════════════════════════════════════════════
//  AI COMMUNICATION
// ═══════════════════════════════════════════════════════════════════════════════

async function callAI(prompt, maxTokens = 500) {
    const ctx = getContext();
    const settings = getSettings();

    if (ctx?.ConnectionManagerRequestService) {
        const profileId = resolveProfileId(settings.selectedProfile, ctx);
        if (profileId) {
            try {
                const response = await ctx.ConnectionManagerRequestService.sendRequest(
                    profileId, [{ role: 'user', content: prompt }], maxTokens,
                    { extractData: true, includePreset: true, includeInstruct: false }, {}
                );
                if (response?.content) return response.content;
                if (typeof response === 'string' && response.trim()) return response;

                // GLM thinking mode fallback: content empty, reasoning has the data
                try {
                    const raw = await ctx.ConnectionManagerRequestService.sendRequest(
                        profileId, [{ role: 'user', content: prompt }], maxTokens,
                        { extractData: false, includePreset: true, includeInstruct: false }, {}
                    );
                    const msg = raw?.choices?.[0]?.message;
                    if (msg?.content) return msg.content;
                    if (msg?.reasoning) {
                        toastr.warning('Codex: Disable reasoning in utility profile for better results', '', { timeOut: 4000 });
                        return msg.reasoning;
                    }
                } catch {}
            } catch (err) {
                console.warn('[Codex] CMRS failed:', err.message);
                toastr.warning(`API failed: ${err.message}`, 'Codex', { timeOut: 4000 });
            }
        }
    }

    try {
        const result = await generateRaw(prompt, null, false, false, '', maxTokens);
        if (result) return result;
    } catch (err) {
        console.error('[Codex] generateRaw failed:', err);
    }
    return null;
}

function resolveProfileId(name, ctx) {
    const cm = ctx?.extensionSettings?.connectionManager;
    if (!cm) return null;
    if (!name || name === 'current') return cm.selectedProfile;
    return cm.profiles?.find(p => p.name === name)?.id ?? cm.selectedProfile;
}

function getRecentContext(count = 3) {
    const ctx = getContext();
    if (!ctx?.chat?.length) return '';
    return ctx.chat.slice(-count).map(msg => {
        const who = msg.is_user ? (ctx.name1 || 'User') : (ctx.name2 || 'AI');
        return `${who}: ${(msg.mes || '').substring(0, 400)}`;
    }).join('\n\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SCENE DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

async function detectActiveCharacters() {
    const settings = getSettings();
    const chat = getChat();
    const allChars = getAllGlobalCharacters();
    if (!allChars.length) return [];
    if (settings.sceneDetection === 'manual') return chat.activeCharacters || [];

    // Filter to characters from active worlds (if any are set)
    const relevantChars = chat.activeWorlds.length > 0
        ? allChars.filter(c => chat.activeWorlds.includes(c.world))
        : allChars;

    if (!relevantChars.length) return [];
    if (settings.sceneDetection === 'keyword') return detectByKeyword(relevantChars);
    return await detectByAI(relevantChars);
}

function detectByKeyword(chars) {
    const ctx = getContext();
    const text = (ctx?.chat || []).slice(-3).map(m => m.mes || '').join(' ').toLowerCase();
    return chars.filter(c => {
        const names = [c.name, ...(c.aliases || [])];
        return names.some(n => n.length > 2 && text.includes(n.toLowerCase()));
    }).map(c => c.id);
}

async function detectByAI(chars) {
    const context = getRecentContext(3);
    if (!context.trim()) return [];

    const charList = chars.map(c => {
        const aka = c.aliases?.length ? ` (also: ${c.aliases.join(', ')})` : '';
        return `- ${c.name}${aka}`;
    }).join('\n');

    const prompt = `Which characters are PRESENT in the current scene? Present = speaking, being spoken to, physically there, or directly interacting.

KNOWN CHARACTERS:
${charList}

RECENT MESSAGES:
${context}

Return ONLY a JSON array of names: ["Name1", "Name2"]
Return [] if none are present.`;

    try {
        const response = await callAI(prompt, 200);
        const parsed = parseJsonArray(response);
        if (!Array.isArray(parsed)) return detectByKeyword(chars);
        return parsed.map(name =>
            chars.find(c => c.name.toLowerCase() === name.toLowerCase() ||
                c.aliases?.some(a => a.toLowerCase() === name.toLowerCase()))?.id
        ).filter(Boolean);
    } catch {
        return detectByKeyword(chars);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LEXICON INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════════

async function checkSecretsAtRisk(charId) {
    const global = getSettings().characters[charId];
    if (!window.LexiconAPI?.isActive?.() || !global?.linkedLexiconEntries?.length) return 0;
    let atRisk = 0;
    for (const entryId of global.linkedLexiconEntries) {
        try {
            const state = await window.LexiconAPI.getNarrativeState(entryId);
            if (state?.action === 'HINT' || state?.action === 'INJECT') atRisk++;
        } catch {}
    }
    return atRisk;
}

function buildSecretContext(name, oldRisk, newRisk) {
    if (newRisk === 0) return '';
    if (newRisk > oldRisk && oldRisk === 0)
        return `\nSECRETS AT RISK: One of ${name}'s secrets is being hinted at. They should be subtly more guarded.`;
    if (newRisk > oldRisk)
        return `\nSECRETS AT RISK: ${newRisk} secrets exposed. Damage control mode.`;
    return `\nSECRETS AT RISK: ${newRisk} secret(s) referenced. Maintain guardedness.`;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  UPDATE ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

let isUpdating = false;

async function runUpdateCycle(options = {}) {
    if (isUpdating && !options.force) return;
    isUpdating = true;

    try {
        const settings = getSettings();
        const chat = getChat();
        const ctx = getContext();

        const activeIds = await detectActiveCharacters();
        const pinned = chat.manuallyPinned || [];
        const mergedIds = [...new Set([...activeIds, ...pinned])];
        chat.activeCharacters = mergedIds;

        // Ensure per-chat states exist for all active characters
        for (const id of mergedIds) getChatStateFor(id);

        const toUpdate = mergedIds.slice(0, settings.maxSimultaneousUpdates);

        if (options.force) {
            toastr.info(`${activeIds.length} detected + ${pinned.length} pinned → updating ${toUpdate.length}`, 'Codex', { timeOut: 3000 });
        }

        for (const charId of toUpdate) {
            const global = settings.characters[charId];
            if (!global?.core) continue;
            await updateCharacterState(charId, options.force);
        }

        if (settings.enableOffscreen) {
            const msgCount = ctx?.chat?.length || 0;
            if ((msgCount - (chat.lastUpdateAt || 0)) >= settings.offscreenFrequency) {
                const offscreen = getAllGlobalCharacters().filter(c =>
                    !mergedIds.includes(c.id) && c.core
                ).slice(0, 2);
                for (const c of offscreen) await updateCharacterOffscreen(c.id);
            }
        }

        injectDirectives();
        chat.lastUpdateAt = ctx?.chat?.length || 0;
        chat.lastUpdateTime = Date.now();
        saveGlobal(); saveChatData();
        dispatchEvent();
    } catch (err) {
        console.error('[Codex] Update cycle failed:', err);
    } finally {
        isUpdating = false;
    }
}

async function updateCharacterState(charId, verbose = false) {
    const global = getSettings().characters[charId];
    const state = getChatStateFor(charId);
    const context = getRecentContext(3);
    const settings = getSettings();

    if (verbose) toastr.info(`Updating ${global.name}...`, 'Codex', { timeOut: 2000 });

    let secretCtx = '';
    if (settings.useLexicon && settings.trackSecretsAtRisk) {
        const oldRisk = state.secretsAtRisk;
        const newRisk = await checkSecretsAtRisk(charId);
        if (newRisk !== oldRisk) {
            secretCtx = buildSecretContext(global.name, oldRisk, newRisk);
            state.secretsAtRisk = newRisk;
        }
    }

    let relCtx = '';
    if (Object.keys(state.relationships).length > 0) {
        relCtx = '\n\nRELATIONSHIPS:\n' + Object.entries(state.relationships)
            .map(([n, r]) => `  ${n}: ${r.stance} (tension ${r.tension}/10)`).join('\n');
    }

    const prompt = `You are maintaining the living psychology of a character. Update their internal state based on what just happened.

CHARACTER: ${global.name}
CORE IDENTITY: ${(global.core || '').substring(0, 1500)}

CURRENT STATE:
  Mood: ${state.currentMood || 'unknown'}
  Goal: ${state.activeGoal || 'none set'}
  Stance: ${state.stance || 'neutral'}
  Hiding: ${state.hiding || 'nothing'}
  Fear: ${state.fear || 'none'}
  Recent memory: ${state.recentMemory || 'none'}
  Active traits: ${(state.activeTraits || []).join(', ') || 'none'}
  Dormant traits: ${(state.dormantTraits || []).join(', ') || 'none'}
${relCtx}${secretCtx}

WHAT JUST HAPPENED:
${context}

Return ONLY valid JSON, no markdown fences, no explanation:
{"currentMood":"1-4 words","activeGoal":"one sentence","stance":"...","hiding":"...or nothing","fear":"...or none","recentMemory":"one sentence","activeTraits":["2-4"],"dormantTraits":["2-4"],"directive":"2-3 sentences: body language, tone, speech, behavior","relationshipUpdates":{"CharName":{"stance":"...","tension":0-10}}}`;

    try {
        const response = await callAI(prompt, 600);
        if (!response) { if (verbose) toastr.error(`No response for ${global.name}`, 'Codex'); return; }

        const data = parseJsonObject(response);
        if (!data) {
            if (verbose) toastr.warning(`Parse failed for ${global.name}: ${response.substring(0, 60)}...`, 'Codex', { timeOut: 5000 });
            return;
        }

        let count = 0;
        for (const f of ['currentMood', 'activeGoal', 'stance', 'hiding', 'fear', 'recentMemory', 'directive']) {
            if (data[f] && data[f] !== state[f]) {
                addHistoryEntry(global.name, f, state[f], data[f]);
                state[f] = data[f]; count++;
            }
        }
        if (Array.isArray(data.activeTraits)) { state.activeTraits = data.activeTraits; count++; }
        if (Array.isArray(data.dormantTraits)) { state.dormantTraits = data.dormantTraits; count++; }

        if (data.relationshipUpdates && typeof data.relationshipUpdates === 'object') {
            for (const [name, upd] of Object.entries(data.relationshipUpdates)) {
                if (!state.relationships[name]) state.relationships[name] = { stance: '', tension: 5, history: '' };
                if (upd.stance) {
                    addHistoryEntry(global.name, `rel:${name}`, state.relationships[name].stance, upd.stance);
                    state.relationships[name].stance = upd.stance;
                }
                if (upd.tension !== undefined) state.relationships[name].tension = Math.max(0, Math.min(10, upd.tension));
            }
        }

        state.lastUpdated = Date.now();
        state.updateCount++;
        state.scenesSinceUpdate = 0;
        if (verbose) toastr.success(`${global.name}: mood → ${state.currentMood}`, 'Codex', { timeOut: 2000 });
    } catch (err) {
        console.error(`[Codex] Update failed for ${global.name}:`, err);
        if (verbose) toastr.error(`${global.name}: ${err.message}`, 'Codex');
    }
}

async function updateCharacterOffscreen(charId) {
    const global = getSettings().characters[charId];
    const state = getChatStateFor(charId);
    const context = getRecentContext(2);

    const prompt = `CHARACTER: ${global.name} (NOT in scene)
Last state: ${state.currentMood || 'unknown'}, goal: ${state.activeGoal || 'unknown'}
Story context: ${context}

How would they react offscreen? Return JSON only:
{"currentMood":"...","activeGoal":"...","recentMemory":"...","directive":"1-2 sentences"}`;

    try {
        const response = await callAI(prompt, 300);
        const data = parseJsonObject(response);
        if (!data) return;
        if (data.currentMood) { addHistoryEntry(global.name, 'mood (offscreen)', state.currentMood, data.currentMood); state.currentMood = data.currentMood; }
        if (data.activeGoal) state.activeGoal = data.activeGoal;
        if (data.recentMemory) state.recentMemory = data.recentMemory;
        if (data.directive) state.directive = data.directive;
        state.lastUpdated = Date.now();
    } catch {}
}

// ═══════════════════════════════════════════════════════════════════════════════
//  INJECTION
// ═══════════════════════════════════════════════════════════════════════════════

function injectDirectives() {
    const settings = getSettings();
    const active = getActiveCharacters();
    if (!active.length) { try { setExtensionPrompt(INJECT_KEY, '', 1, 0, false); } catch {} return; }

    const blocks = active.filter(c => c.directive).map(c => {
        let b = `[CHARACTER STATE — ${c.name}]\n${c.directive.substring(0, settings.maxDirectiveLength)}`;
        if (c.hiding && c.hiding !== 'nothing') b += `\nHiding: ${c.hiding}`;
        if (c.activeGoal) b += `\nGoal: ${c.activeGoal}`;
        if (settings.injectRelationships && Object.keys(c.relationships || {}).length > 0) {
            const rel = Object.entries(c.relationships)
                .filter(([n]) => active.some(a => a.name === n))
                .map(([n, r]) => `${n}: ${r.stance}`).join('; ');
            if (rel) b += `\nRelationships: ${rel}`;
        }
        return b;
    });

    if (blocks.length > 0) {
        setExtensionPrompt(INJECT_KEY, blocks.join('\n\n'), 1, settings.injectionDepth, false);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  IMPORT PIPELINES
// ═══════════════════════════════════════════════════════════════════════════════

async function importFromLexicon(worldName) {
    if (!window.LexiconAPI?.isActive?.()) { toastr.warning('Lexicon not active', 'Codex'); return 0; }
    try {
        const entries = await window.LexiconAPI.getEntries({ category: 'Character' });
        if (!entries.length) { toastr.info('No Character entries in Lexicon', 'Codex'); return 0; }

        const settings = getSettings();
        const world = worldName || 'Lexicon Import';
        if (!settings.worlds.includes(world)) settings.worlds.push(world);

        let count = 0;
        for (const entry of entries) {
            if (Object.values(settings.characters).some(c => c.lexiconEntryId === entry.id)) continue;
            const char = newGlobalCharacter(entry.title, 'lexicon');
            char.core = (entry.content || '').substring(0, 3000);
            char.lexiconEntryId = entry.id;
            char.linkedLexiconEntries = [entry.id];
            char.world = world;
            settings.characters[char.id] = char;
            count++;
        }

        if (count > 0) {
            saveGlobal();
            toastr.success(`Imported ${count} characters → ${world}`, 'Codex', { timeOut: 4000 });
            for (const char of Object.values(settings.characters)) {
                if (char.source === 'lexicon' && char.world === world) {
                    const state = getChatStateFor(char.id);
                    if (!state.currentMood) await generateInitialState(char.id);
                }
            }
            saveGlobal(); saveChatData();
        }
        return count;
    } catch (err) {
        toastr.error('Lexicon import failed', 'Codex');
        return 0;
    }
}

async function importFromSTCards(worldName) {
    const ctx = getContext();
    const settings = getSettings();
    if (!ctx?.characters?.length) { toastr.info('No characters loaded', 'Codex'); return 0; }

    const world = worldName || 'ST Cards';
    if (!settings.worlds.includes(world)) settings.worlds.push(world);

    let count = 0;
    for (const card of ctx.characters) {
        if (!card?.name) continue;
        if (Object.values(settings.characters).some(c => c.name === card.name)) continue;
        const desc = (card.data?.description || card.description || '').substring(0, 2000);
        const personality = (card.data?.personality || card.personality || '').substring(0, 1000);
        const core = [desc, personality].filter(Boolean).join('\n\n');
        if (!core.trim()) continue;

        const char = newGlobalCharacter(card.name, 'character_card');
        char.core = core;
        char.world = world;
        settings.characters[char.id] = char;
        count++;
    }

    if (count > 0) {
        saveGlobal();
        toastr.success(`Imported ${count} cards → ${world}`, 'Codex');
        for (const char of Object.values(settings.characters)) {
            if (char.source === 'character_card' && char.world === world) {
                const state = getChatStateFor(char.id);
                if (!state.currentMood) await generateInitialState(char.id);
            }
        }
        saveGlobal(); saveChatData();
    }
    return count;
}

async function generateInitialState(charId) {
    const global = getSettings().characters[charId];
    if (!global?.core) return;
    const state = getChatStateFor(charId);

    toastr.info(`Analyzing ${global.name}...`, 'Codex', { timeOut: 2000 });

    const prompt = `Extract the psychological state of this character for roleplay.

CHARACTER: ${global.name}
DESCRIPTION: ${global.core.substring(0, 1500)}

Return ONLY valid JSON, no markdown fences:
{"currentMood":"default emotional state","activeGoal":"what they want","stance":"how they approach interactions","hiding":"what they conceal or nothing","fear":"core vulnerability","activeTraits":["3-4 dominant traits"],"dormantTraits":["3-4 hidden traits"],"aliases":["nicknames, titles, shortened names"],"directive":"2-3 sentences: default behavior, body language, speech style"}`;

    try {
        const response = await callAI(prompt, 600);
        if (!response) { toastr.error(`No response for ${global.name}`, 'Codex', { timeOut: 5000 }); return; }

        const data = parseJsonObject(response);
        if (!data) {
            toastr.warning(`Parse failed for ${global.name}: ${response.substring(0, 60)}...`, 'Codex', { timeOut: 5000 });
            return;
        }

        let n = 0;
        for (const k of ['currentMood', 'activeGoal', 'stance', 'hiding', 'fear', 'directive']) {
            if (data[k]) { state[k] = data[k]; n++; }
        }
        if (Array.isArray(data.activeTraits)) { state.activeTraits = data.activeTraits; n++; }
        if (Array.isArray(data.dormantTraits)) { state.dormantTraits = data.dormantTraits; n++; }
        if (Array.isArray(data.aliases) && data.aliases.length) { global.aliases = data.aliases; n++; }

        if (n > 0) toastr.success(`${global.name}: ${n} fields set`, 'Codex', { timeOut: 2000 });
    } catch (err) {
        toastr.error(`Failed: ${global.name}: ${err.message}`, 'Codex');
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TRIGGER
// ═══════════════════════════════════════════════════════════════════════════════

function shouldUpdate() {
    const s = getSettings();
    const c = getChat();
    if (!s.enabled || s.updateMode === 'manual') return false;
    if (!Object.keys(s.characters).length) return false;
    if (s.updateMode === 'every_message' || s.updateMode === 'on_mention') return true;
    if (s.updateMode === 'every_n') {
        const ctx = getContext();
        return ((ctx?.chat?.length || 0) - (c.lastUpdateAt || 0)) >= (s.updateEveryN || 3);
    }
    return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

function registerAPI() {
    window.CodexAPI = {
        version: EXT_VERSION,
        isActive: () => getSettings()?.enabled === true,
        getCharacterState: (name) => {
            const g = getCharacterByName(name);
            return g ? getFullCharacter(g.id) : null;
        },
        getActiveCharacters: () => getActiveCharacters(),
        getAllDirectives: () => getActiveCharacters().filter(c => c.directive).map(c => ({ name: c.name, directive: c.directive })),
        getRelationship: (c1, c2) => {
            const g = getCharacterByName(c1);
            if (!g) return null;
            const state = getChatStateFor(g.id);
            return state.relationships?.[c2] ? { ...state.relationships[c2] } : null;
        },
        isSecretAtRisk: (name) => {
            const g = getCharacterByName(name);
            if (!g) return { atRisk: 0, entries: [] };
            return { atRisk: getChatStateFor(g.id).secretsAtRisk, entries: g.linkedLexiconEntries };
        },
        getAllCharacters: () => getAllGlobalCharacters().map(g => getFullCharacter(g.id)),
        getCharacterHistory: (name, limit = 20) =>
            (getChat().characterHistory || []).filter(h => h.characterName === name).slice(-limit),
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function parseJsonArray(t) {
    if (!t) return null;
    const m = t.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim().match(/\[[\s\S]*?\]/);
    if (!m) return null;
    try { const p = JSON.parse(m[0]); return Array.isArray(p) ? p : null; } catch { return null; }
}

function parseJsonObject(t) {
    if (!t) return null;
    const c = t.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const s = c.indexOf('{'), e = c.lastIndexOf('}');
    if (s === -1 || e <= s) return null;
    try { const p = JSON.parse(c.substring(s, e + 1)); return typeof p === 'object' && !Array.isArray(p) ? p : null; } catch { return null; }
}

function xss(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function dispatchEvent() { document.dispatchEvent(new CustomEvent('codex:updated')); }

// ═══════════════════════════════════════════════════════════════════════════════
//  FAB
// ═══════════════════════════════════════════════════════════════════════════════

function createFAB() {
    if ($('#codex-fab').length) return;
    const fab = $('<button>', { id: 'codex-fab', title: EXT_NAME, html: '<i class="fa-solid fa-users" style="pointer-events:none;"></i>' })
        .css({ position:'fixed', bottom:'180px', right:'15px', width:'44px', height:'44px', borderRadius:'50%',
            border:'2px solid var(--SmartThemeBodyColor,rgba(255,255,255,0.3))', background:'var(--SmartThemeBlurTintColor,rgba(20,20,35,0.9))',
            color:'var(--SmartThemeBodyColor,#e8e0d0)', fontSize:'16px', display:'flex', alignItems:'center', justifyContent:'center',
            cursor:'pointer', zIndex:'31000', boxShadow:'0 2px 12px rgba(0,0,0,0.5)', padding:'0', margin:'0', pointerEvents:'auto', overflow:'visible' });

    const targets = ['#form_sheld','#sheld','#chat','body'];
    for (const sel of targets) { const t = $(sel); if (t.length) { t.append(fab); t.css('overflow','visible'); break; } }

    let isDrag=false, wasDrag=false, sX, sY, sR, sB;
    fab.on('click', (e) => { if(wasDrag){wasDrag=false;return;} e.preventDefault(); e.stopPropagation(); togglePanel(); });
    fab[0].addEventListener('touchstart',(e)=>{isDrag=true;wasDrag=false;const t=e.touches[0];sX=t.clientX;sY=t.clientY;const r=fab[0].getBoundingClientRect();sR=window.innerWidth-r.right;sB=window.innerHeight-r.bottom;},{passive:true});
    fab[0].addEventListener('touchmove',(e)=>{if(!isDrag)return;const t=e.touches[0];const dx=t.clientX-sX,dy=t.clientY-sY;if(Math.abs(dx)>8||Math.abs(dy)>8){wasDrag=true;e.preventDefault();fab.css({right:Math.max(4,sR-dx)+'px',bottom:Math.max(4,sB-dy)+'px'});}},{passive:false});
    fab[0].addEventListener('touchend',(e)=>{isDrag=false;if(!wasDrag){e.preventDefault();togglePanel();}wasDrag=false;},{passive:false});
    setInterval(()=>{if(getSettings().enabled&&!$('#codex-fab').length)createFAB();},3000);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PANEL
// ═══════════════════════════════════════════════════════════════════════════════

function createPanel() {
    if ($('#codex-panel').length) return;
    $('body').append(`
<div id="codex-panel" class="codex-panel" style="display:none;">
  <div class="codex-header">
    <span class="codex-title"><i class="fa-solid fa-users"></i> ${EXT_NAME} <span class="codex-vtag">v2</span></span>
    <div class="codex-header-btns">
      <button class="codex-icon-btn" id="codex-refresh" title="Update now"><i class="fa-solid fa-arrows-rotate"></i></button>
      <button class="codex-icon-btn" id="codex-close" title="Close"><i class="fa-solid fa-xmark"></i></button>
    </div>
  </div>
  <div class="codex-tabs">
    <button class="codex-tab active" data-tab="cast">Cast</button>
    <button class="codex-tab" data-tab="relationships">Relations</button>
    <button class="codex-tab" data-tab="history">History</button>
    <button class="codex-tab" data-tab="import">Import</button>
    <button class="codex-tab" data-tab="settings">Settings</button>
  </div>
  <div class="codex-pane" id="codex-pane-cast"><div id="codex-cast-list" class="codex-cast-list"><div class="codex-empty">No characters. Use Import tab.</div></div></div>
  <div class="codex-pane" id="codex-pane-relationships" style="display:none;"><div id="codex-rel-list"><div class="codex-empty">No relationships.</div></div></div>
  <div class="codex-pane" id="codex-pane-history" style="display:none;"><div class="codex-history-header"><span>State Change Log</span><button class="codex-btn codex-btn-sm" id="codex-history-clear">Clear</button></div><div id="codex-history-list"><div class="codex-empty">No changes.</div></div></div>
  <div class="codex-pane" id="codex-pane-import" style="display:none;">
    <div class="codex-import-section">
      <div class="codex-import-title">📚 From Lexicon</div>
      <input type="text" id="codex-import-world" class="codex-input" placeholder="World/group name (e.g. Elysium)" />
      <button class="codex-btn codex-btn-primary" id="codex-import-lexicon"><i class="fa-solid fa-book-open"></i> Import from Lexicon</button>
    </div>
    <div class="codex-import-section">
      <div class="codex-import-title">🎭 From ST Cards</div>
      <button class="codex-btn codex-btn-primary" id="codex-import-cards"><i class="fa-solid fa-id-card"></i> Import from Cards</button>
    </div>
    <div class="codex-import-section">
      <div class="codex-import-title">✏️ Add Manually</div>
      <input type="text" id="codex-m-name" class="codex-input" placeholder="Name" />
      <textarea id="codex-m-core" class="codex-input" rows="3" placeholder="Core description..."></textarea>
      <input type="text" id="codex-m-aliases" class="codex-input" placeholder="Aliases (comma separated)" />
      <input type="text" id="codex-m-world" class="codex-input" placeholder="World/group" />
      <button class="codex-btn codex-btn-primary" id="codex-m-save"><i class="fa-solid fa-plus"></i> Create</button>
    </div>
  </div>
  <div class="codex-pane codex-settings-pane" id="codex-pane-settings" style="display:none;">
    <div class="codex-sg"><label class="codex-check"><input type="checkbox" id="codex-s-enabled" /> <b>Enable Codex</b></label></div>
    <div class="codex-sg"><div class="codex-sl"><b>Update Frequency</b></div>
      <label class="codex-check"><input type="radio" name="codex-update" value="every_message" /> Every message</label>
      <label class="codex-check"><input type="radio" name="codex-update" value="on_mention" /> On mention</label>
      <label class="codex-check"><input type="radio" name="codex-update" value="every_n" /> Every N</label>
      <div id="codex-n-row" style="display:none;margin-left:20px;"><input type="number" id="codex-s-n" min="1" max="20" value="3" style="width:50px;" /></div>
      <label class="codex-check"><input type="radio" name="codex-update" value="manual" /> Manual</label></div>
    <div class="codex-sg"><div class="codex-sl"><b>Scene Detection</b></div>
      <label class="codex-check"><input type="radio" name="codex-detect" value="ai" /> AI (best)</label>
      <label class="codex-check"><input type="radio" name="codex-detect" value="keyword" /> Keyword</label>
      <label class="codex-check"><input type="radio" name="codex-detect" value="manual" /> Manual</label></div>
    <div class="codex-sg"><div class="codex-sl"><b>Max updates</b> <span id="codex-max-val">3</span></div><input type="range" id="codex-s-max" min="1" max="6" value="3" /></div>
    <div class="codex-sg"><label class="codex-check"><input type="checkbox" id="codex-s-offscreen" /> Offscreen evolution</label></div>
    <div class="codex-sg"><div class="codex-sl"><b>Injection depth</b> <span id="codex-depth-val">1</span></div><input type="range" id="codex-s-depth" min="0" max="6" value="1" /></div>
    <div class="codex-sg"><label class="codex-check"><input type="checkbox" id="codex-s-rels" /> Include relationships</label></div>
    <div class="codex-sg"><div class="codex-sl"><b>Connection profile</b></div><select id="codex-s-profile"><option value="current">Current</option></select></div>
    <div class="codex-sg"><label class="codex-check"><input type="checkbox" id="codex-s-lexicon" /> Lexicon integration</label></div>
    <div class="codex-sg"><label class="codex-check"><input type="checkbox" id="codex-s-secrets" /> Track secrets at risk</label></div>
    <div class="codex-sg"><button class="codex-btn codex-btn-danger" id="codex-clear-all"><i class="fa-solid fa-trash"></i> Clear all characters</button></div>
  </div>
</div>`);
    bindPanelEvents();
}

function destroyUI() { $('#codex-fab, #codex-panel').remove(); }
function togglePanel() { $('#codex-panel').is(':visible') ? $('#codex-panel').fadeOut(150) : openPanel(); }
function openPanel() { $('#codex-panel').fadeIn(150); gotoTab($('.codex-tab.active').data('tab') || 'cast'); }
function gotoTab(name) {
    $('.codex-tab').removeClass('active'); $(`.codex-tab[data-tab="${name}"]`).addClass('active');
    $('.codex-pane').hide(); $(`#codex-pane-${name}`).show();
    if (name === 'cast') renderCast();
    if (name === 'relationships') renderRelationships();
    if (name === 'history') renderHistory();
    if (name === 'settings') renderSettings();
}

// ── Events ──

function bindPanelEvents() {
    $('#codex-close').on('click', () => $('#codex-panel').fadeOut(150));
    $(document).on('click', '.codex-tab[data-tab]', function() { gotoTab($(this).data('tab')); });

    $('#codex-refresh').on('click', async () => {
        // Regenerate blank characters first
        const chars = getAllGlobalCharacters();
        const blank = chars.filter(c => c.core && !getChatStateFor(c.id).currentMood);
        if (blank.length) {
            toastr.info(`Generating ${blank.length} blank states...`, 'Codex');
            for (const c of blank) await generateInitialState(c.id);
            saveGlobal(); saveChatData();
        }
        await runUpdateCycle({ force: true });
        renderCast();
    });

    // Import
    $('#codex-import-lexicon').on('click', async () => {
        const world = ($('#codex-import-world').val() || '').trim() || undefined;
        const n = await importFromLexicon(world);
        if (n > 0) renderCast();
    });
    $('#codex-import-cards').on('click', async () => {
        const world = ($('#codex-import-world').val() || '').trim() || undefined;
        const n = await importFromSTCards(world);
        if (n > 0) renderCast();
    });
    $('#codex-m-save').on('click', async () => {
        const name = $('#codex-m-name').val().trim();
        if (!name) { toastr.warning('Enter a name'); return; }
        const s = getSettings();
        const char = newGlobalCharacter(name, 'manual');
        char.core = $('#codex-m-core').val().trim();
        char.aliases = $('#codex-m-aliases').val().split(',').map(s => s.trim()).filter(Boolean);
        char.world = $('#codex-m-world').val().trim() || 'Uncategorized';
        if (!s.worlds.includes(char.world)) s.worlds.push(char.world);
        s.characters[char.id] = char;
        saveGlobal();
        if (char.core) await generateInitialState(char.id);
        saveGlobal(); saveChatData();
        $('#codex-m-name,#codex-m-core,#codex-m-aliases,#codex-m-world').val('');
        toastr.success(`${name} added`); gotoTab('cast');
    });

    // Settings
    $('#codex-s-enabled').on('change', function() { getSettings().enabled = this.checked; saveGlobal(); if (!this.checked) { try{setExtensionPrompt(INJECT_KEY,'',1,0,false);}catch{} } });
    $(document).on('change', 'input[name="codex-update"]', function() { getSettings().updateMode = this.value; saveGlobal(); $('#codex-n-row').toggle(this.value==='every_n'); });
    $(document).on('change', 'input[name="codex-detect"]', function() { getSettings().sceneDetection = this.value; saveGlobal(); });
    $('#codex-s-n').on('change', function() { getSettings().updateEveryN = parseInt(this.value)||3; saveGlobal(); });
    $('#codex-s-max').on('input', function() { getSettings().maxSimultaneousUpdates = parseInt(this.value); $('#codex-max-val').text(this.value); saveGlobal(); });
    $('#codex-s-offscreen').on('change', function() { getSettings().enableOffscreen = this.checked; saveGlobal(); });
    $('#codex-s-depth').on('input', function() { getSettings().injectionDepth = parseInt(this.value); $('#codex-depth-val').text(this.value); saveGlobal(); });
    $('#codex-s-rels').on('change', function() { getSettings().injectRelationships = this.checked; saveGlobal(); });
    $('#codex-s-profile').on('change', function() { getSettings().selectedProfile = this.value; saveGlobal(); });
    $('#codex-s-lexicon').on('change', function() { getSettings().useLexicon = this.checked; saveGlobal(); });
    $('#codex-s-secrets').on('change', function() { getSettings().trackSecretsAtRisk = this.checked; saveGlobal(); });
    $('#codex-clear-all').on('click', () => { if(!confirm('Clear ALL characters?'))return; getSettings().characters={}; getSettings().worlds=[]; getChat().characterStates={}; getChat().activeCharacters=[]; getChat().manuallyPinned=[]; saveGlobal(); saveChatData(); renderCast(); toastr.info('Cleared'); });
    $('#codex-history-clear').on('click', () => { getChat().characterHistory=[]; saveChatData(); renderHistory(); });

    // Cast actions (delegated)
    $(document).on('click', '.codex-char-delete', function() {
        const id = $(this).data('id');
        if(!confirm('Remove this character?'))return;
        delete getSettings().characters[id];
        delete getChat().characterStates[id];
        const c = getChat();
        c.activeCharacters = c.activeCharacters.filter(i=>i!==id);
        c.manuallyPinned = c.manuallyPinned.filter(i=>i!==id);
        saveGlobal(); saveChatData(); renderCast();
    });
    $(document).on('click', '.codex-char-toggle', function() {
        const id = $(this).data('id');
        const c = getChat();
        if(!Array.isArray(c.manuallyPinned)) c.manuallyPinned=[];
        if(c.activeCharacters.includes(id)){
            c.activeCharacters=c.activeCharacters.filter(i=>i!==id);
            c.manuallyPinned=c.manuallyPinned.filter(i=>i!==id);
        } else {
            c.activeCharacters.push(id);
            if(!c.manuallyPinned.includes(id)) c.manuallyPinned.push(id);
        }
        saveChatData(); renderCast();
    });
    // Edit toggle
    $(document).on('click', '.codex-char-edit', function(e) {
        e.stopPropagation();
        const id = $(this).data('id');
        const form = $(`.codex-char-edit-form[data-id="${id}"]`);
        // Close any other open forms
        $('.codex-char-edit-form').not(form).slideUp(100);
        form.slideToggle(150);
    });
    // Edit save
    $(document).on('click', '.codex-edit-save', function(e) {
        e.stopPropagation();
        const id = $(this).data('id');
        const form = $(`.codex-char-edit-form[data-id="${id}"]`);
        const s = getSettings();
        const char = s.characters[id];
        if (!char) return;

        const newWorld = form.find('.codex-edit-world').val().trim() || 'Uncategorized';
        const newAliases = form.find('.codex-edit-aliases').val().split(',').map(a => a.trim()).filter(Boolean);
        const newName = form.find('.codex-edit-name').val().trim();

        if (newName && newName !== char.name) char.name = newName;
        char.aliases = newAliases;
        const oldWorld = char.world;
        char.world = newWorld;

        // Update worlds list
        if (!s.worlds.includes(newWorld)) s.worlds.push(newWorld);
        // Clean empty worlds
        const usedWorlds = new Set(Object.values(s.characters).map(c => c.world));
        s.worlds = s.worlds.filter(w => usedWorlds.has(w));

        saveGlobal();
        toastr.success(`${char.name} updated${oldWorld !== newWorld ? ` → ${newWorld}` : ''}`, 'Codex', { timeOut: 2000 });
        renderCast();
    });
    // World group collapse toggle
    $(document).on('click', '.codex-world-header', function() {
        const world = $(this).data('world');
        const s = getSettings();
        if(s.collapsedWorlds.includes(world)) s.collapsedWorlds=s.collapsedWorlds.filter(w=>w!==world);
        else s.collapsedWorlds.push(world);
        saveGlobal(); renderCast();
    });

    document.addEventListener('codex:updated', () => {
        if($('#codex-pane-cast').is(':visible')) renderCast();
        if($('#codex-pane-relationships').is(':visible')) renderRelationships();
    });
}

// ── Render: Cast (with collapsible world groups) ──

function renderCast() {
    const allChars = getAllGlobalCharacters();
    if (!allChars.length) { $('#codex-cast-list').html('<div class="codex-empty">No characters. Use Import tab.</div>'); return; }

    const chat = getChat();
    const settings = getSettings();
    const collapsed = settings.collapsedWorlds || [];

    // Group by world
    const groups = {};
    for (const g of allChars) {
        const w = g.world || 'Uncategorized';
        if (!groups[w]) groups[w] = [];
        groups[w].push(g);
    }

    let html = '';
    for (const [world, chars] of Object.entries(groups)) {
        const isCollapsed = collapsed.includes(world);
        const activeCount = chars.filter(c => chat.activeCharacters.includes(c.id)).length;
        html += `<div class="codex-world-header" data-world="${xss(world)}">
            <i class="fa-solid fa-chevron-${isCollapsed ? 'right' : 'down'}"></i>
            <span class="codex-world-name">${xss(world)}</span>
            <span class="codex-world-count">${chars.length} chars${activeCount > 0 ? ` · ${activeCount} active` : ''}</span>
        </div>`;

        if (!isCollapsed) {
            html += '<div class="codex-world-group">';
            for (const g of chars) {
                const state = getChatStateFor(g.id);
                const isActive = chat.activeCharacters.includes(g.id);
                const isPinned = (chat.manuallyPinned || []).includes(g.id);
                const traits = (state.activeTraits || []).slice(0, 4).map(t => `<span class="codex-trait codex-trait-active">${xss(t)}</span>`).join('');
                const dormant = (state.dormantTraits || []).slice(0, 3).map(t => `<span class="codex-trait codex-trait-dormant">${xss(t)}</span>`).join('');
                const secretBadge = state.secretsAtRisk > 0 ? `<span class="codex-badge codex-badge-danger">⚠ ${state.secretsAtRisk} at risk</span>` : '';
                const pinBadge = isPinned ? '<span class="codex-badge codex-badge-pinned">📌</span>' : '';
                const statusBadge = isActive ? '<span class="codex-badge codex-badge-active">● in scene</span>' : '<span class="codex-badge codex-badge-inactive">○ off</span>';

                html += `<div class="codex-char-card ${isActive ? 'codex-char-active' : ''}" data-id="${xss(g.id)}">
  <div class="codex-char-header">
    <span class="codex-char-name">${xss(g.name)}</span>
    ${statusBadge} ${pinBadge} ${secretBadge}
    <span class="codex-badge codex-badge-source">${g.source}</span>
    <div class="codex-char-btns">
      <button class="codex-icon-btn codex-char-edit" data-id="${xss(g.id)}" title="Edit"><i class="fa-solid fa-pen"></i></button>
      <button class="codex-icon-btn codex-char-toggle" data-id="${xss(g.id)}" title="${isActive?'Remove':'Add'}"><i class="fa-solid fa-${isActive?'eye-slash':'eye'}"></i></button>
      <button class="codex-icon-btn codex-char-delete" data-id="${xss(g.id)}" title="Delete"><i class="fa-solid fa-trash"></i></button>
    </div>
  </div>
  ${state.currentMood ? `<div class="codex-char-mood">Mood: <b>${xss(state.currentMood)}</b></div>` : ''}
  ${state.activeGoal ? `<div class="codex-char-goal">Goal: ${xss(state.activeGoal)}</div>` : ''}
  ${state.stance ? `<div class="codex-char-stance">Stance: ${xss(state.stance)}</div>` : ''}
  ${state.hiding && state.hiding !== 'nothing' ? `<div class="codex-char-hiding">Hiding: ${xss(state.hiding)}</div>` : ''}
  ${traits || dormant ? `<div class="codex-char-traits">${traits} ${dormant}</div>` : ''}
  ${state.directive ? `<div class="codex-char-directive">${xss(state.directive.substring(0, 200))}${state.directive.length > 200 ? '…' : ''}</div>` : ''}
  <div class="codex-char-edit-form" data-id="${xss(g.id)}" style="display:none;">
    <label class="codex-edit-label">World/Group</label>
    <input type="text" class="codex-edit-input codex-edit-world" value="${xss(g.world || '')}" placeholder="World name" />
    <label class="codex-edit-label">Aliases <span style="opacity:0.5">(comma separated)</span></label>
    <input type="text" class="codex-edit-input codex-edit-aliases" value="${xss((g.aliases||[]).join(', '))}" placeholder="Nicknames, titles..." />
    <label class="codex-edit-label">Name</label>
    <input type="text" class="codex-edit-input codex-edit-name" value="${xss(g.name)}" />
    <button class="codex-btn codex-btn-primary codex-edit-save" data-id="${xss(g.id)}"><i class="fa-solid fa-check"></i> Save</button>
  </div>
</div>`;
            }
            html += '</div>';
        }
    }

    $('#codex-cast-list').html(html);
}

// ── Render: Relationships ──

function renderRelationships() {
    const allChars = getAllGlobalCharacters();
    const rels = [];
    for (const g of allChars) {
        const state = getChatStateFor(g.id);
        for (const [target, r] of Object.entries(state.relationships || {})) {
            rels.push({ from: g.name, to: target, stance: r.stance, tension: r.tension });
        }
    }
    if (!rels.length) { $('#codex-rel-list').html('<div class="codex-empty">No relationships.</div>'); return; }

    $('#codex-rel-list').html(rels.map(r => {
        const pct = (r.tension / 10) * 100;
        const col = r.tension > 7 ? '#c45c5c' : r.tension > 4 ? '#b8a460' : '#7a9e7e';
        return `<div class="codex-rel-card"><div class="codex-rel-names"><b>${xss(r.from)}</b> → <b>${xss(r.to)}</b></div>
<div class="codex-rel-stance">${xss(r.stance)}</div>
<div class="codex-rel-tension"><span>Tension: ${r.tension}/10</span><div class="codex-tension-bar"><div class="codex-tension-fill" style="width:${pct}%;background:${col};"></div></div></div></div>`;
    }).join(''));
}

// ── Render: History ──

function renderHistory() {
    const history = getChat().characterHistory || [];
    if (!history.length) { $('#codex-history-list').html('<div class="codex-empty">No changes.</div>'); return; }
    $('#codex-history-list').html([...history].reverse().slice(0, 100).map(h => {
        const t = new Date(h.timestamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
        return `<div class="codex-history-entry"><span class="codex-hist-time">${t}</span> <b>${xss(h.characterName)}</b> <span class="codex-hist-field">${xss(h.field)}</span>: <span class="codex-hist-old">${xss(h.oldValue)}</span> → <span class="codex-hist-new">${xss(h.newValue)}</span></div>`;
    }).join(''));
}

// ── Render: Settings ──

function renderSettings() {
    const s = getSettings();
    const ctx = getContext();
    $('#codex-s-enabled').prop('checked', s.enabled);
    $(`input[name="codex-update"][value="${s.updateMode}"]`).prop('checked', true);
    $('#codex-n-row').toggle(s.updateMode === 'every_n');
    $('#codex-s-n').val(s.updateEveryN);
    $(`input[name="codex-detect"][value="${s.sceneDetection}"]`).prop('checked', true);
    $('#codex-s-max').val(s.maxSimultaneousUpdates); $('#codex-max-val').text(s.maxSimultaneousUpdates);
    $('#codex-s-offscreen').prop('checked', s.enableOffscreen);
    $('#codex-s-depth').val(s.injectionDepth); $('#codex-depth-val').text(s.injectionDepth);
    $('#codex-s-rels').prop('checked', s.injectRelationships);
    $('#codex-s-lexicon').prop('checked', s.useLexicon);
    $('#codex-s-secrets').prop('checked', s.trackSecretsAtRisk);
    const $p = $('#codex-s-profile').empty().append('<option value="current">Current</option>');
    (ctx?.extensionSettings?.connectionManager?.profiles || []).forEach(p => $p.append(`<option value="${p.name}">${p.name}</option>`));
    $p.val(s.selectedProfile);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  EXTENSION SETTINGS PANEL
// ═══════════════════════════════════════════════════════════════════════════════

function addExtSettingsPanel() {
    const s = getSettings();
    $('#extensions_settings2').append(`<div class="inline-drawer" id="codex-ext-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>📖 ${EXT_NAME}</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content"><label class="checkbox_label"><input type="checkbox" id="codex-master-toggle" ${s.enabled?'checked':''}/><span>Enable Codex</span></label><p style="margin:6px 0 0;opacity:0.7;font-size:0.85em;">Per-chat NPC psychology. Open <i class="fa-solid fa-users"></i> to manage.</p></div></div>`);
    $('#codex-master-toggle').on('change', function() {
        getSettings().enabled = this.checked; saveGlobal();
        if (this.checked) { createFAB(); createPanel(); registerAPI(); }
        else { try{setExtensionPrompt(INJECT_KEY,'',1,0,false);}catch{} destroyUI(); }
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════════════════════

jQuery(async () => {
    try {
        console.log(`[${EXT_ID}] ${EXT_NAME} v${EXT_VERSION} init…`);
        if (!extension_settings[EXT_ID]) extension_settings[EXT_ID] = {};
        getSettings(); // ensure defaults
        migrateFromV1();
        try { addExtSettingsPanel(); } catch (e) { console.warn('[Codex] Settings:', e); }

        if (!getSettings().enabled) { console.log('[Codex] Disabled'); return; }

        createFAB();
        createPanel();
        if (getContext()?.chat?.length > 0) getChat(); // ensure chat state

        eventSource.on(event_types.MESSAGE_RECEIVED, async () => {
            if (getSettings().enabled && shouldUpdate()) await runUpdateCycle();
        });
        eventSource.on(event_types.CHAT_CHANGED, () => {
            getChat(); // init per-chat state for new chat
            if (getSettings().enabled && shouldUpdate()) setTimeout(() => runUpdateCycle(), 500);
        });

        registerAPI();
        console.log(`[Codex] ✅ v${EXT_VERSION} ready`);
        toastr.success(`${EXT_NAME} v${EXT_VERSION}`, '', { timeOut: 2000 });
    } catch (err) {
        console.error('[Codex] ❌', err);
        toastr.error(`Codex failed: ${err.message}`);
    }
});
