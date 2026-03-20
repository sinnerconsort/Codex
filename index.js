/**
 * The Codex v1.0 — Character State Engine
 * Live NPC psychology: mood, goals, stance, secrets, relationships, behavioral directives.
 * Part of the Lexicon → Codex → Chronicler pipeline.
 * Single-file build — Spark's proven mobile pattern.
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
const EXT_VERSION = '1.0.0';
const INJECT_KEY = 'codex_directives';

const UPDATE_MODES = {
    EVERY_MESSAGE: 'every_message',
    ON_MENTION: 'on_mention',
    EVERY_N: 'every_n',
    MANUAL: 'manual',
};

const DETECTION_MODES = {
    AI: 'ai',
    KEYWORD: 'keyword',
    MANUAL: 'manual',
};

const DEFAULT_PAGE = {
    id: '',
    name: '',
    aliases: [],
    core: '',
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
    linkedLexiconEntries: [],
    secretsAtRisk: 0,
    active: false,
    detectedVia: 'manual',
    lastActiveMessage: 0,
    lastUpdated: 0,
    updateCount: 0,
    scenesSinceUpdate: 0,
    source: 'manual',
    lexiconEntryId: '',
};

const DEFAULT_SETTINGS = {
    enabled: true,
    selectedProfile: 'current',
    updateMode: UPDATE_MODES.ON_MENTION,
    updateEveryN: 3,
    sceneDetection: DETECTION_MODES.AI,
    maxSimultaneousUpdates: 3,
    enableOffscreen: false,
    offscreenFrequency: 5,
    injectionDepth: 1,
    injectRelationships: true,
    maxDirectiveLength: 500,
    useLexicon: true,
    trackSecretsAtRisk: true,
    characters: {},
    settingsVersion: 1,
};

const DEFAULT_CHAT_STATE = {
    activeCharacters: [],
    manuallyPinned: [],
    sceneContext: '',
    lastUpdateAt: 0,
    lastUpdateTime: 0,
    characterHistory: [],
};

// ═══════════════════════════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════════════════════════

function getSettings() {
    if (!extension_settings[EXT_ID]) extension_settings[EXT_ID] = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    return extension_settings[EXT_ID];
}

function getChatState() {
    if (!chat_metadata) return JSON.parse(JSON.stringify(DEFAULT_CHAT_STATE));
    if (!chat_metadata[EXT_ID]) chat_metadata[EXT_ID] = JSON.parse(JSON.stringify(DEFAULT_CHAT_STATE));
    return chat_metadata[EXT_ID];
}

function sanitizeSettings() {
    const s = getSettings();
    for (const key in DEFAULT_SETTINGS) { if (s[key] === undefined) s[key] = DEFAULT_SETTINGS[key]; }
    if (!s.characters || typeof s.characters !== 'object') s.characters = {};
    // Migrate existing character pages
    for (const id of Object.keys(s.characters)) migrateCharacterPage(s.characters[id]);
}

function sanitizeChatState() {
    const cs = getChatState();
    for (const key in DEFAULT_CHAT_STATE) { if (cs[key] === undefined) cs[key] = JSON.parse(JSON.stringify(DEFAULT_CHAT_STATE[key])); }
    if (!Array.isArray(cs.activeCharacters)) cs.activeCharacters = [];
    if (!Array.isArray(cs.manuallyPinned)) cs.manuallyPinned = [];
    if (!Array.isArray(cs.characterHistory)) cs.characterHistory = [];
}

function migrateCharacterPage(page) {
    for (const key in DEFAULT_PAGE) { if (page[key] === undefined) page[key] = DEFAULT_PAGE[key]; }
    if (!Array.isArray(page.aliases)) page.aliases = [];
    if (!Array.isArray(page.activeTraits)) page.activeTraits = [];
    if (!Array.isArray(page.dormantTraits)) page.dormantTraits = [];
    if (!page.relationships || typeof page.relationships !== 'object') page.relationships = {};
    if (!Array.isArray(page.linkedLexiconEntries)) page.linkedLexiconEntries = [];
}

function generatePageId(name) {
    return `codex_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now()}`;
}

function getAllCharacters() {
    return Object.values(getSettings().characters || {});
}

function getCharacter(nameOrId) {
    const chars = getSettings().characters;
    if (chars[nameOrId]) return chars[nameOrId];
    return Object.values(chars).find(c => c.name.toLowerCase() === nameOrId.toLowerCase()) || null;
}

function getActiveCharacters() {
    const cs = getChatState();
    const settings = getSettings();
    return (cs.activeCharacters || []).map(id => settings.characters[id]).filter(Boolean);
}

function addHistoryEntry(charName, field, oldVal, newVal) {
    const cs = getChatState();
    cs.characterHistory.push({ timestamp: Date.now(), characterName: charName, field, oldValue: String(oldVal || '').substring(0, 80), newValue: String(newVal || '').substring(0, 80) });
    if (cs.characterHistory.length > 300) cs.characterHistory = cs.characterHistory.slice(-300);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PERSISTENCE
// ═══════════════════════════════════════════════════════════════════════════════

function saveSettings() { saveSettingsDebounced(); }
function saveChatData() { if (chat_metadata) saveChatDebounced(); }

// ═══════════════════════════════════════════════════════════════════════════════
//  AI COMMUNICATION
// ═══════════════════════════════════════════════════════════════════════════════

async function callAI(prompt, maxTokens = 500) {
    const ctx = getContext();
    const settings = getSettings();

    // Try Connection Manager first
    if (ctx?.ConnectionManagerRequestService) {
        const profileId = resolveProfileId(settings.selectedProfile, ctx);
        if (profileId) {
            try {
                const response = await ctx.ConnectionManagerRequestService.sendRequest(
                    profileId, [{ role: 'user', content: prompt }], maxTokens,
                    { extractData: true, includePreset: true, includeInstruct: false }, {}
                );
                if (response?.content) return response.content;
                console.warn('[Codex] CMRS returned empty content');
            } catch (err) {
                console.warn('[Codex] CMRS failed:', err.message);
                toastr.warning(`Codex API call failed: ${err.message}`, 'Codex', { timeOut: 4000 });
            }
        } else {
            console.warn('[Codex] Could not resolve profile:', settings.selectedProfile);
        }
    }

    // Fallback to generateRaw
    try {
        const result = await generateRaw(prompt, null, false, false, '', maxTokens);
        if (result) return result;
    } catch (err) {
        console.error('[Codex] generateRaw also failed:', err);
        toastr.error('Codex: All API methods failed', 'Codex', { timeOut: 5000 });
    }
    return null;
}

function resolveProfileId(profileName, ctx) {
    const cm = ctx?.extensionSettings?.connectionManager;
    if (!cm) return null;
    if (!profileName || profileName === 'current') return cm.selectedProfile;
    return cm.profiles?.find(p => p.name === profileName)?.id ?? cm.selectedProfile;
}

function getRecentContext(count = 3) {
    const ctx = getContext();
    if (!ctx?.chat?.length) return '';
    return ctx.chat.slice(-count).map(msg => {
        const name = msg.is_user ? (ctx.name1 || 'User') : (ctx.name2 || 'AI');
        return `${name}: ${(msg.mes || '').substring(0, 400)}`;
    }).join('\n\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SCENE DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

async function detectActiveCharacters() {
    const settings = getSettings();
    const cs = getChatState();
    const allChars = getAllCharacters();
    if (!allChars.length) return [];

    if (settings.sceneDetection === DETECTION_MODES.MANUAL) {
        return cs.activeCharacters || [];
    }

    if (settings.sceneDetection === DETECTION_MODES.KEYWORD) {
        return detectByKeyword(allChars);
    }

    // AI detection
    return await detectByAI(allChars);
}

function detectByKeyword(allChars) {
    const ctx = getContext();
    const recentText = (ctx?.chat || []).slice(-3).map(m => m.mes || '').join(' ').toLowerCase();
    const detected = [];
    for (const char of allChars) {
        // Exact full name + exact alias matches only — this is a dumb fallback
        // AI detection handles partial names, nicknames, and pronouns properly
        const names = [char.name, ...(char.aliases || [])];
        if (names.some(n => n.length > 2 && recentText.includes(n.toLowerCase()))) {
            detected.push(char.id);
        }
    }
    return detected;
}

async function detectByAI(allChars) {
    const context = getRecentContext(3);
    if (!context.trim()) return [];

    const charList = allChars.map(c => {
        const aka = c.aliases?.length ? ` (also: ${c.aliases.join(', ')})` : '';
        return `- ${c.name}${aka}`;
    }).join('\n');

    const prompt = `Which of these characters are PRESENT in the current scene? A character is present if they are speaking, being spoken to, physically there, or directly interacting.

KNOWN CHARACTERS:
${charList}

RECENT MESSAGES:
${context}

Return ONLY a JSON array of character names who are present: ["Name1", "Name2"]
Include ONLY characters actively in the scene, not merely mentioned historically.
Return [] if none are clearly present.`;

    try {
        const response = await callAI(prompt, 200);
        const parsed = parseJsonArray(response);
        if (!Array.isArray(parsed)) return detectByKeyword(allChars); // fallback

        // Map names back to IDs
        return parsed.map(name => {
            const char = allChars.find(c =>
                c.name.toLowerCase() === name.toLowerCase() ||
                c.aliases?.some(a => a.toLowerCase() === name.toLowerCase())
            );
            return char?.id;
        }).filter(Boolean);
    } catch (err) {
        console.warn('[Codex] AI detection failed, using keyword fallback:', err);
        return detectByKeyword(allChars);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LEXICON INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════════

async function checkSecretsAtRisk(character) {
    if (!window.LexiconAPI?.isActive?.()) return 0;
    if (!character.linkedLexiconEntries?.length) return 0;

    let atRisk = 0;
    for (const entryId of character.linkedLexiconEntries) {
        try {
            const state = await window.LexiconAPI.getNarrativeState(entryId);
            if (state?.action === 'HINT' || state?.action === 'INJECT') atRisk++;
        } catch { /* skip */ }
    }
    return atRisk;
}

function buildSecretContext(character, oldRisk, newRisk) {
    if (newRisk === 0) return '';
    if (newRisk > oldRisk) {
        if (oldRisk === 0) return `\nSECRETS AT RISK: One of ${character.name}'s secrets is now being hinted at in the narrative. They should become subtly more guarded.`;
        return `\nSECRETS AT RISK: ${newRisk} of ${character.name}'s secrets are now exposed or being hinted at. They are in damage control mode.`;
    }
    return `\nSECRETS AT RISK: ${newRisk} secret(s) are being referenced in the story. Maintain appropriate guardedness.`;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CHARACTER UPDATE ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

let isUpdating = false;

async function runUpdateCycle(options = {}) {
    if (isUpdating && !options.force) return;
    isUpdating = true;

    try {
        const settings = getSettings();
        const cs = getChatState();
        const ctx = getContext();

        // Detect who's in the scene
        const activeIds = await detectActiveCharacters();
        
        // Merge with manually pinned characters (manual override survives detection)
        const pinned = cs.manuallyPinned || [];
        const mergedIds = [...new Set([...activeIds, ...pinned])];
        cs.activeCharacters = mergedIds;

        // Mark characters active/inactive using MERGED list (includes pins)
        for (const char of getAllCharacters()) {
            char.active = mergedIds.includes(char.id);
            if (char.active) {
                char.detectedVia = pinned.includes(char.id) ? 'manual' : settings.sceneDetection;
                char.lastActiveMessage = ctx?.chat?.length || 0;
            }
            if (!char.active) char.scenesSinceUpdate++;
        }

        // Update active characters from MERGED list (up to limit)
        const toUpdate = mergedIds.slice(0, settings.maxSimultaneousUpdates);
        
        if (options.force) {
            toastr.info(`Detected ${activeIds.length} + ${pinned.length} pinned = ${mergedIds.length} active. Updating ${toUpdate.length}...`, 'Codex', { timeOut: 3000 });
        }
        
        for (const charId of toUpdate) {
            const char = settings.characters[charId];
            if (!char) continue;
            // Skip characters with no core text
            if (!char.core) { 
                if (options.force) toastr.warning(`${char.name} has no core text — skipping`, 'Codex', { timeOut: 3000 });
                continue; 
            }
            await updateCharacterState(char, options.force);
        }

        // Offscreen updates if enabled
        if (settings.enableOffscreen) {
            const messageCount = ctx?.chat?.length || 0;
            const messagesSinceUpdate = messageCount - (cs.lastUpdateAt || 0);
            if (messagesSinceUpdate >= settings.offscreenFrequency) {
                const offscreen = getAllCharacters().filter(c => !c.active && c.core);
                for (const char of offscreen.slice(0, 2)) {
                    await updateCharacterOffscreen(char);
                }
            }
        }

        // Build and inject directives
        injectDirectives();

        cs.lastUpdateAt = ctx?.chat?.length || 0;
        cs.lastUpdateTime = Date.now();

        saveSettings();
        saveChatData();
        dispatchUpdateEvent();

    } catch (err) {
        console.error('[Codex] Update cycle failed:', err);
    } finally {
        isUpdating = false;
    }
}

async function updateCharacterState(char, verbose = false) {
    const context = getRecentContext(3);
    const settings = getSettings();

    if (verbose) toastr.info(`Updating ${char.name}...`, 'Codex', { timeOut: 2000 });

    // Check Lexicon secrets
    let secretContext = '';
    if (settings.useLexicon && settings.trackSecretsAtRisk) {
        const oldRisk = char.secretsAtRisk;
        const newRisk = await checkSecretsAtRisk(char);
        if (newRisk !== oldRisk) {
            secretContext = buildSecretContext(char, oldRisk, newRisk);
            char.secretsAtRisk = newRisk;
        }
    }

    // Build relationship context
    let relContext = '';
    if (Object.keys(char.relationships).length > 0) {
        relContext = '\n\nRELATIONSHIPS:\n' + Object.entries(char.relationships)
            .map(([name, r]) => `  ${name}: ${r.stance} (tension ${r.tension}/10)`)
            .join('\n');
    }

    const prompt = `You are maintaining the living psychology of a character in an ongoing roleplay story. Update their internal state based on what just happened.

CHARACTER: ${char.name}
CORE IDENTITY: ${(char.core || '').substring(0, 1500)}

CURRENT STATE:
  Mood: ${char.currentMood || 'unknown'}
  Goal: ${char.activeGoal || 'none set'}
  Stance: ${char.stance || 'neutral'}
  Hiding: ${char.hiding || 'nothing'}
  Fear: ${char.fear || 'none'}
  Recent memory: ${char.recentMemory || 'none'}
  Active traits: ${(char.activeTraits || []).join(', ') || 'none set'}
  Dormant traits: ${(char.dormantTraits || []).join(', ') || 'none set'}
${relContext}${secretContext}

WHAT JUST HAPPENED:
${context}

Update their state. Return ONLY valid JSON with no other text, no markdown fences, no explanation:
{
  "currentMood": "1-4 words",
  "activeGoal": "one sentence",
  "stance": "how they're approaching the current interaction",
  "hiding": "what they're concealing, or 'nothing'",
  "fear": "what worries them right now, or 'none'",
  "recentMemory": "one sentence — what just registered most",
  "activeTraits": ["2-4 traits that should surface now"],
  "dormantTraits": ["2-4 traits that are suppressed"],
  "directive": "2-3 sentences telling the AI EXACTLY how to play them. Be specific about body language, tone, speech patterns, what they're doing.",
  "relationshipUpdates": { "CharName": { "stance": "...", "tension": 0-10 } }
}`;

    try {
        const response = await callAI(prompt, 600);
        if (!response) {
            if (verbose) toastr.error(`No response for ${char.name}`, 'Codex', { timeOut: 4000 });
            return;
        }
        
        const data = parseJsonObject(response);
        if (!data) {
            if (verbose) toastr.warning(`Parse failed for ${char.name}: ${(response || '').substring(0, 60)}...`, 'Codex', { timeOut: 5000 });
            console.warn(`[Codex] Unparseable update for ${char.name}:`, response?.substring(0, 200));
            return;
        }

        // Apply updates with history tracking
        const fields = ['currentMood', 'activeGoal', 'stance', 'hiding', 'fear', 'recentMemory', 'directive'];
        for (const f of fields) {
            if (data[f] && data[f] !== char[f]) {
                addHistoryEntry(char.name, f, char[f], data[f]);
                char[f] = data[f];
            }
        }
        if (Array.isArray(data.activeTraits)) char.activeTraits = data.activeTraits;
        if (Array.isArray(data.dormantTraits)) char.dormantTraits = data.dormantTraits;

        // Relationship updates
        if (data.relationshipUpdates && typeof data.relationshipUpdates === 'object') {
            for (const [name, update] of Object.entries(data.relationshipUpdates)) {
                if (!char.relationships[name]) char.relationships[name] = { stance: '', tension: 5, history: '' };
                if (update.stance) {
                    addHistoryEntry(char.name, `rel:${name}`, char.relationships[name].stance, update.stance);
                    char.relationships[name].stance = update.stance;
                }
                if (update.tension !== undefined) char.relationships[name].tension = Math.max(0, Math.min(10, update.tension));
            }
        }

        char.lastUpdated = Date.now();
        char.updateCount++;
        char.scenesSinceUpdate = 0;
        
        if (verbose) toastr.success(`${char.name} updated — mood: ${char.currentMood}`, 'Codex', { timeOut: 2000 });

    } catch (err) {
        console.error(`[Codex] Update failed for ${char.name}:`, err);
        if (verbose) toastr.error(`Update error for ${char.name}: ${err.message}`, 'Codex', { timeOut: 5000 });
    }
}

async function updateCharacterOffscreen(char) {
    const context = getRecentContext(2);
    const prompt = `CHARACTER: ${char.name} (NOT in current scene)
Last state: ${char.currentMood || 'unknown'}, goal: ${char.activeGoal || 'unknown'}
What's happening in the story: ${context}

How would ${char.name} be reacting offscreen? Return brief JSON:
{"currentMood":"...","activeGoal":"...","recentMemory":"what they've heard or done offscreen","directive":"1-2 sentences for when they next appear"}`;

    try {
        const response = await callAI(prompt, 300);
        const data = parseJsonObject(response);
        if (!data) return;

        if (data.currentMood) { addHistoryEntry(char.name, 'currentMood (offscreen)', char.currentMood, data.currentMood); char.currentMood = data.currentMood; }
        if (data.activeGoal) char.activeGoal = data.activeGoal;
        if (data.recentMemory) char.recentMemory = data.recentMemory;
        if (data.directive) char.directive = data.directive;
        char.lastUpdated = Date.now();
    } catch (err) {
        console.warn(`[Codex] Offscreen update failed for ${char.name}:`, err);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  INJECTION
// ═══════════════════════════════════════════════════════════════════════════════

function injectDirectives() {
    const settings = getSettings();
    const active = getActiveCharacters();
    if (!active.length) { clearInjection(); return; }

    const blocks = active.filter(c => c.directive).map(c => {
        let block = `[CHARACTER STATE — ${c.name}]\n${c.directive.substring(0, settings.maxDirectiveLength)}`;
        if (c.hiding && c.hiding !== 'nothing') block += `\nHiding: ${c.hiding}`;
        if (c.activeGoal) block += `\nGoal: ${c.activeGoal}`;
        if (settings.injectRelationships && Object.keys(c.relationships).length > 0) {
            const relStr = Object.entries(c.relationships)
                .filter(([name]) => active.some(a => a.name === name))
                .map(([name, r]) => `${name}: ${r.stance}`)
                .join('; ');
            if (relStr) block += `\nRelationships: ${relStr}`;
        }
        return block;
    });

    if (blocks.length > 0) {
        setExtensionPrompt(INJECT_KEY, blocks.join('\n\n'), 1, settings.injectionDepth, false);
    } else {
        clearInjection();
    }
}

function clearInjection() {
    try { setExtensionPrompt(INJECT_KEY, '', 1, 0, false); } catch {}
}

// ═══════════════════════════════════════════════════════════════════════════════
//  IMPORT PIPELINES
// ═══════════════════════════════════════════════════════════════════════════════

async function importFromLexicon() {
    if (!window.LexiconAPI?.isActive?.()) {
        toastr.warning('Lexicon is not active', 'Codex'); return 0;
    }
    try {
        const entries = await window.LexiconAPI.getEntries({ category: 'Character' });
        if (!entries.length) { toastr.info('No Character-category entries found in Lexicon', 'Codex'); return 0; }

        const settings = getSettings();
        let count = 0;
        for (const entry of entries) {
            // Skip if already imported
            if (Object.values(settings.characters).some(c => c.lexiconEntryId === entry.id)) continue;

            const page = createBlankPage(entry.title, 'lexicon');
            page.core = (entry.content || '').substring(0, 3000);
            page.lexiconEntryId = entry.id;
            page.linkedLexiconEntries = [entry.id];
            settings.characters[page.id] = page;
            count++;
        }

        if (count > 0) {
            saveSettings();
            toastr.success(`Imported ${count} characters from Lexicon — generating initial states...`, 'Codex', { timeOut: 4000 });
            // Generate initial psychology for each new import
            for (const char of Object.values(settings.characters)) {
                if (char.source === 'lexicon' && !char.currentMood) {
                    await generateInitialState(char);
                }
            }
            saveSettings();
        }
        return count;
    } catch (err) {
        console.error('[Codex] Lexicon import failed:', err);
        toastr.error('Lexicon import failed', 'Codex'); return 0;
    }
}

async function importFromSTCards() {
    const ctx = getContext();
    const settings = getSettings();
    if (!ctx?.characters?.length) { toastr.info('No characters loaded', 'Codex'); return 0; }

    let count = 0;
    for (const char of ctx.characters) {
        if (!char?.name) continue;
        // Skip if already exists
        if (Object.values(settings.characters).some(c => c.name === char.name)) continue;

        const desc = (char.data?.description || char.description || '').substring(0, 2000);
        const personality = (char.data?.personality || char.personality || '').substring(0, 1000);
        const core = [desc, personality].filter(Boolean).join('\n\n');
        if (!core.trim()) continue;

        const page = createBlankPage(char.name, 'character_card');
        page.core = core;
        settings.characters[page.id] = page;
        count++;
    }

    if (count > 0) {
        saveSettings();
        toastr.success(`Imported ${count} characters from ST cards`, 'Codex', { timeOut: 3000 });
        for (const char of Object.values(settings.characters)) {
            if (char.source === 'character_card' && !char.currentMood) {
                await generateInitialState(char);
            }
        }
        saveSettings();
    }
    return count;
}

function createBlankPage(name, source = 'manual') {
    const page = JSON.parse(JSON.stringify(DEFAULT_PAGE));
    page.id = generatePageId(name);
    page.name = name;
    page.source = source;
    page.lastUpdated = Date.now();
    return page;
}

async function generateInitialState(char) {
    if (!char.core) { console.warn(`[Codex] No core text for ${char.name}, skipping`); return; }
    
    toastr.info(`Analyzing ${char.name}...`, 'Codex', { timeOut: 2000 });
    
    const prompt = `Given this character description, extract their likely initial psychological state. This is for a roleplay story — think about who they are beneath the surface.

CHARACTER: ${char.name}
DESCRIPTION: ${char.core.substring(0, 1500)}

Return ONLY valid JSON with no other text, no markdown fences, no explanation:
{
  "currentMood": "their likely default emotional state",
  "activeGoal": "what they generally want",
  "stance": "how they typically approach interactions",
  "hiding": "what they might conceal, or 'nothing'",
  "fear": "their core fear or vulnerability",
  "activeTraits": ["3-4 dominant personality traits"],
  "dormantTraits": ["3-4 traits that exist but don't always show"],
  "aliases": ["any nicknames, titles, or shortened names from the description"],
  "directive": "2-3 sentences describing their default behavior — how they carry themselves, speak, and interact"
}`;

    try {
        const response = await callAI(prompt, 600);
        if (!response) {
            toastr.error(`No response for ${char.name} — check connection profile`, 'Codex', { timeOut: 5000 });
            return;
        }
        
        const data = parseJsonObject(response);
        if (!data) {
            toastr.warning(`Couldn't parse response for ${char.name}. Raw: ${(response || '').substring(0, 80)}...`, 'Codex', { timeOut: 6000 });
            console.warn('[Codex] Unparseable response for', char.name, ':', response?.substring(0, 200));
            return;
        }

        let fieldsSet = 0;
        for (const key of ['currentMood', 'activeGoal', 'stance', 'hiding', 'fear', 'directive']) {
            if (data[key]) { char[key] = data[key]; fieldsSet++; }
        }
        if (Array.isArray(data.activeTraits)) { char.activeTraits = data.activeTraits; fieldsSet++; }
        if (Array.isArray(data.dormantTraits)) { char.dormantTraits = data.dormantTraits; fieldsSet++; }
        if (Array.isArray(data.aliases) && data.aliases.length > 0) { char.aliases = data.aliases; fieldsSet++; }
        
        if (fieldsSet > 0) {
            toastr.success(`${char.name}: ${fieldsSet} fields populated`, 'Codex', { timeOut: 2000 });
        } else {
            toastr.warning(`${char.name}: JSON parsed but no usable fields`, 'Codex', { timeOut: 4000 });
        }
    } catch (err) {
        console.error(`[Codex] Initial state generation failed for ${char.name}:`, err);
        toastr.error(`Failed for ${char.name}: ${err.message}`, 'Codex', { timeOut: 5000 });
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TRIGGER LOGIC
// ═══════════════════════════════════════════════════════════════════════════════

function shouldUpdate() {
    const settings = getSettings();
    const cs = getChatState();
    const ctx = getContext();
    if (!settings.enabled) return false;
    if (settings.updateMode === UPDATE_MODES.MANUAL) return false;
    if (!getAllCharacters().length) return false;

    const messageCount = ctx?.chat?.length || 0;
    if (settings.updateMode === UPDATE_MODES.EVERY_MESSAGE) return true;
    if (settings.updateMode === UPDATE_MODES.ON_MENTION) return true; // detection handles filtering
    if (settings.updateMode === UPDATE_MODES.EVERY_N) {
        return (messageCount - (cs.lastUpdateAt || 0)) >= (settings.updateEveryN || 3);
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
        getCharacterState: (name) => { const c = getCharacter(name); return c ? { ...c } : null; },
        getActiveCharacters: () => getActiveCharacters().map(c => ({ ...c })),
        getAllDirectives: () => getActiveCharacters().filter(c => c.directive).map(c => ({ name: c.name, directive: c.directive })),
        getRelationship: (char1, char2) => {
            const c = getCharacter(char1);
            return c?.relationships?.[char2] ? { ...c.relationships[char2] } : null;
        },
        isSecretAtRisk: (name) => {
            const c = getCharacter(name);
            if (!c) return { atRisk: 0, entries: [] };
            return { atRisk: c.secretsAtRisk, entries: c.linkedLexiconEntries };
        },
        getAllCharacters: () => getAllCharacters().map(c => ({ ...c })),
        getCharacterHistory: (name, limit = 20) => {
            const cs = getChatState();
            return (cs.characterHistory || []).filter(h => h.characterName === name).slice(-limit);
        },
    };
    console.log('[Codex] Public API registered → window.CodexAPI');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function parseJsonArray(text) {
    if (!text) return null;
    const cleaned = text.trim().replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const match = cleaned.match(/\[[\s\S]*?\]/);
    if (!match) return null;
    try { const p = JSON.parse(match[0]); return Array.isArray(p) ? p : null; } catch { return null; }
}

function parseJsonObject(text) {
    if (!text) return null;
    const cleaned = text.trim().replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const start = cleaned.indexOf('{'), end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try { const p = JSON.parse(cleaned.substring(start, end + 1)); return typeof p === 'object' && !Array.isArray(p) ? p : null; } catch { return null; }
}

function xss(str) { return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function dispatchUpdateEvent() { document.dispatchEvent(new CustomEvent('codex:updated')); }

// ═══════════════════════════════════════════════════════════════════════════════
//  FAB — Spark pattern
// ═══════════════════════════════════════════════════════════════════════════════

function createFAB() {
    if ($('#codex-fab').length) return;

    const fab = $('<button>', {
        id: 'codex-fab',
        title: 'The Codex — Character State Engine',
        html: '<i class="fa-solid fa-users" style="pointer-events:none;"></i>'
    }).css({
        position: 'fixed', bottom: '180px', right: '15px',
        width: '44px', height: '44px', borderRadius: '50%',
        border: '2px solid var(--SmartThemeBodyColor, rgba(255,255,255,0.3))',
        background: 'var(--SmartThemeBlurTintColor, rgba(20,20,35,0.9))',
        color: 'var(--SmartThemeBodyColor, #e8e0d0)',
        fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', zIndex: '31000', boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
        padding: '0', margin: '0', pointerEvents: 'auto', overflow: 'visible',
    });

    const targets = ['#form_sheld', '#sheld', '#chat', 'body'];
    let attached = false;
    for (const sel of targets) { const t = $(sel); if (t.length) { t.append(fab); t.css('overflow', 'visible'); attached = true; break; } }
    if (!attached) $('body').append(fab);

    let isDragging = false, wasDragged = false, startX, startY, startRight, startBottom;
    fab.on('click', (e) => { if (wasDragged) { wasDragged = false; return; } e.preventDefault(); e.stopPropagation(); togglePanel(); });
    fab[0].addEventListener('touchstart', (e) => { isDragging = true; wasDragged = false; const t = e.touches[0]; startX = t.clientX; startY = t.clientY; const r = fab[0].getBoundingClientRect(); startRight = window.innerWidth - r.right; startBottom = window.innerHeight - r.bottom; }, { passive: true });
    fab[0].addEventListener('touchmove', (e) => { if (!isDragging) return; const t = e.touches[0]; const dx = t.clientX - startX, dy = t.clientY - startY; if (Math.abs(dx) > 8 || Math.abs(dy) > 8) { wasDragged = true; e.preventDefault(); fab.css({ right: Math.max(4, startRight - dx) + 'px', bottom: Math.max(4, startBottom - dy) + 'px' }); } }, { passive: false });
    fab[0].addEventListener('touchend', (e) => { isDragging = false; if (!wasDragged) { e.preventDefault(); togglePanel(); } wasDragged = false; }, { passive: false });

    setInterval(() => { if (getSettings().enabled && !$('#codex-fab').length) createFAB(); }, 3000);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PANEL UI
// ═══════════════════════════════════════════════════════════════════════════════

let editingCharId = null;

function createPanel() {
    if ($('#codex-panel').length) return;

    const html = `
<div id="codex-panel" class="codex-panel" style="display:none;">
  <div class="codex-header">
    <span class="codex-title"><i class="fa-solid fa-users"></i> ${EXT_NAME} <span class="codex-vtag">v1</span></span>
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

  <!-- CAST TAB -->
  <div class="codex-pane" id="codex-pane-cast">
    <div id="codex-cast-list" class="codex-cast-list"><div class="codex-empty">No characters yet. Use the Import tab to add some.</div></div>
  </div>

  <!-- RELATIONSHIPS TAB -->
  <div class="codex-pane" id="codex-pane-relationships" style="display:none;">
    <div id="codex-rel-list" class="codex-rel-list"><div class="codex-empty">No relationships tracked yet.</div></div>
  </div>

  <!-- HISTORY TAB -->
  <div class="codex-pane" id="codex-pane-history" style="display:none;">
    <div class="codex-history-header"><span>State Change Log</span><button class="codex-btn codex-btn-sm" id="codex-history-clear">Clear</button></div>
    <div id="codex-history-list" class="codex-history-list"><div class="codex-empty">No changes recorded yet.</div></div>
  </div>

  <!-- IMPORT TAB -->
  <div class="codex-pane" id="codex-pane-import" style="display:none;">
    <div class="codex-import-section">
      <div class="codex-import-title">📚 From Lexicon</div>
      <p class="codex-hint">Import Character-category entries from Lexicon. Requires Lexicon to be active with imported lorebook entries.</p>
      <button class="codex-btn codex-btn-primary" id="codex-import-lexicon"><i class="fa-solid fa-book-open"></i> Import from Lexicon</button>
    </div>
    <div class="codex-import-section">
      <div class="codex-import-title">🎭 From ST Character Cards</div>
      <p class="codex-hint">Import characters from loaded ST character cards.</p>
      <button class="codex-btn codex-btn-primary" id="codex-import-cards"><i class="fa-solid fa-id-card"></i> Import from Cards</button>
    </div>
    <div class="codex-import-section">
      <div class="codex-import-title">✏️ Add Manually</div>
      <div class="codex-manual-form">
        <input type="text" id="codex-m-name" placeholder="Character name" />
        <textarea id="codex-m-core" rows="4" placeholder="Core description — who they are, their personality, their role..."></textarea>
        <input type="text" id="codex-m-aliases" placeholder="Aliases (comma separated)" />
        <button class="codex-btn codex-btn-primary" id="codex-m-save"><i class="fa-solid fa-plus"></i> Create Character</button>
      </div>
    </div>
  </div>

  <!-- SETTINGS TAB -->
  <div class="codex-pane codex-settings-pane" id="codex-pane-settings" style="display:none;">
    <div class="codex-sg"><label class="codex-check"><input type="checkbox" id="codex-s-enabled" /> <b>Enable Codex</b></label></div>
    <div class="codex-sg">
      <div class="codex-sl"><b>Update Frequency</b></div>
      <label class="codex-check"><input type="radio" name="codex-update" value="every_message" /> Every message</label>
      <label class="codex-check"><input type="radio" name="codex-update" value="on_mention" /> On character mention</label>
      <label class="codex-check"><input type="radio" name="codex-update" value="every_n" /> Every N messages</label>
      <div id="codex-every-n-row" style="display:none;margin-left:20px;"><input type="number" id="codex-s-n" min="1" max="20" value="3" style="width:50px;" /> between updates</div>
      <label class="codex-check"><input type="radio" name="codex-update" value="manual" /> Manual only</label>
    </div>
    <div class="codex-sg">
      <div class="codex-sl"><b>Scene Detection</b></div>
      <label class="codex-check"><input type="radio" name="codex-detect" value="ai" /> AI detection (best, extra API call)</label>
      <label class="codex-check"><input type="radio" name="codex-detect" value="keyword" /> Keyword matching (free)</label>
      <label class="codex-check"><input type="radio" name="codex-detect" value="manual" /> Manual only</label>
    </div>
    <div class="codex-sg"><div class="codex-sl"><b>Max simultaneous updates</b> <span id="codex-max-val">3</span></div><input type="range" id="codex-s-max" min="1" max="6" value="3" /></div>
    <div class="codex-sg"><label class="codex-check"><input type="checkbox" id="codex-s-offscreen" /> Evolve characters offscreen</label><div class="codex-hint">Characters not in scene still react to events.</div></div>
    <div class="codex-sg"><div class="codex-sl"><b>Injection depth</b> <span id="codex-depth-val">1</span></div><input type="range" id="codex-s-depth" min="0" max="6" value="1" /></div>
    <div class="codex-sg"><label class="codex-check"><input type="checkbox" id="codex-s-rels" /> Include relationships in injection</label></div>
    <div class="codex-sg"><div class="codex-sl"><b>Connection profile</b></div><select id="codex-s-profile"><option value="current">Current connection</option></select><div class="codex-hint">Point at a cheap model.</div></div>
    <div class="codex-sg"><label class="codex-check"><input type="checkbox" id="codex-s-lexicon" /> Use Lexicon integration</label></div>
    <div class="codex-sg"><label class="codex-check"><input type="checkbox" id="codex-s-secrets" /> Track secrets at risk</label></div>
    <div class="codex-sg"><button class="codex-btn codex-btn-danger" id="codex-clear-all"><i class="fa-solid fa-trash"></i> Clear all characters</button></div>
  </div>
</div>`;
    $('body').append(html);
    bindPanelEvents();
}

function destroyUI() { $('#codex-fab').remove(); $('#codex-panel').remove(); }
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

// ─── Panel Events ─────────────────────────────────────────────────────────────

function bindPanelEvents() {
    $('#codex-close').on('click', () => $('#codex-panel').fadeOut(150));
    $('#codex-refresh').on('click', async () => {
        const settings = getSettings();
        const chars = getAllCharacters();
        
        // First: regenerate initial states for any characters with blank fields
        const blankChars = chars.filter(c => c.core && !c.currentMood && !c.directive);
        if (blankChars.length > 0) {
            toastr.info(`Generating states for ${blankChars.length} blank character(s)...`, 'Codex', { timeOut: 3000 });
            for (const char of blankChars) {
                await generateInitialState(char);
            }
            saveSettings();
        }
        
        // Then: run normal update cycle
        toastr.info('Running update cycle...', 'Codex', { timeOut: 2000 });
        await runUpdateCycle({ force: true });
        renderCast();
    });
    $(document).on('click', '.codex-tab[data-tab]', function () { gotoTab($(this).data('tab')); });

    // Import
    $('#codex-import-lexicon').on('click', async () => { const n = await importFromLexicon(); if (n > 0) renderCast(); });
    $('#codex-import-cards').on('click', async () => { const n = await importFromSTCards(); if (n > 0) renderCast(); });
    $('#codex-m-save').on('click', () => {
        const name = $('#codex-m-name').val().trim();
        const core = $('#codex-m-core').val().trim();
        if (!name) { toastr.warning('Enter a name'); return; }
        const settings = getSettings();
        const page = createBlankPage(name, 'manual');
        page.core = core;
        page.aliases = $('#codex-m-aliases').val().split(',').map(s => s.trim()).filter(Boolean);
        settings.characters[page.id] = page;
        saveSettings();
        toastr.success(`${name} added to the Codex`);
        if (core) generateInitialState(page).then(() => { saveSettings(); renderCast(); });
        $('#codex-m-name, #codex-m-core, #codex-m-aliases').val('');
        gotoTab('cast');
    });

    // Settings
    $('#codex-s-enabled').on('change', function () { getSettings().enabled = this.checked; saveSettings(); if (!this.checked) clearInjection(); });
    $(document).on('change', 'input[name="codex-update"]', function () { getSettings().updateMode = this.value; saveSettings(); $('#codex-every-n-row').toggle(this.value === 'every_n'); });
    $(document).on('change', 'input[name="codex-detect"]', function () { getSettings().sceneDetection = this.value; saveSettings(); });
    $('#codex-s-n').on('change', function () { getSettings().updateEveryN = parseInt(this.value) || 3; saveSettings(); });
    $('#codex-s-max').on('input', function () { getSettings().maxSimultaneousUpdates = parseInt(this.value); $('#codex-max-val').text(this.value); saveSettings(); });
    $('#codex-s-offscreen').on('change', function () { getSettings().enableOffscreen = this.checked; saveSettings(); });
    $('#codex-s-depth').on('input', function () { getSettings().injectionDepth = parseInt(this.value); $('#codex-depth-val').text(this.value); saveSettings(); });
    $('#codex-s-rels').on('change', function () { getSettings().injectRelationships = this.checked; saveSettings(); });
    $('#codex-s-profile').on('change', function () { getSettings().selectedProfile = this.value; saveSettings(); });
    $('#codex-s-lexicon').on('change', function () { getSettings().useLexicon = this.checked; saveSettings(); });
    $('#codex-s-secrets').on('change', function () { getSettings().trackSecretsAtRisk = this.checked; saveSettings(); });
    $('#codex-clear-all').on('click', () => { if (!confirm('Clear ALL characters?')) return; getSettings().characters = {}; saveSettings(); clearInjection(); renderCast(); toastr.info('All characters cleared'); });
    $('#codex-history-clear').on('click', () => { getChatState().characterHistory = []; saveChatData(); renderHistory(); });

    // Cast card actions (delegated)
    $(document).on('click', '.codex-char-delete', function () {
        const id = $(this).data('id');
        if (!confirm('Remove this character?')) return;
        delete getSettings().characters[id];
        saveSettings(); renderCast();
    });
    $(document).on('click', '.codex-char-toggle', function () {
        const id = $(this).data('id');
        const cs = getChatState();
        if (!Array.isArray(cs.manuallyPinned)) cs.manuallyPinned = [];
        
        if (cs.activeCharacters.includes(id)) {
            // Remove from active AND from manual pins
            cs.activeCharacters = cs.activeCharacters.filter(i => i !== id);
            cs.manuallyPinned = cs.manuallyPinned.filter(i => i !== id);
        } else {
            // Add to active AND to manual pins so it survives detection
            cs.activeCharacters.push(id);
            if (!cs.manuallyPinned.includes(id)) cs.manuallyPinned.push(id);
        }
        const char = getSettings().characters[id];
        if (char) char.active = cs.activeCharacters.includes(id);
        saveChatData(); saveSettings(); renderCast();
    });

    document.addEventListener('codex:updated', () => {
        if ($('#codex-pane-cast').is(':visible')) renderCast();
        if ($('#codex-pane-relationships').is(':visible')) renderRelationships();
    });
}

// ─── Render: Cast ─────────────────────────────────────────────────────────────

function renderCast() {
    const chars = getAllCharacters();
    if (!chars.length) { $('#codex-cast-list').html('<div class="codex-empty">No characters yet. Use the Import tab.</div>'); return; }

    const cs = getChatState();
    const html = chars.map(c => {
        const isActive = cs.activeCharacters?.includes(c.id);
        const isPinned = (cs.manuallyPinned || []).includes(c.id);
        const traits = (c.activeTraits || []).slice(0, 4).map(t => `<span class="codex-trait codex-trait-active">${xss(t)}</span>`).join('');
        const dormant = (c.dormantTraits || []).slice(0, 3).map(t => `<span class="codex-trait codex-trait-dormant">${xss(t)}</span>`).join('');
        const secretBadge = c.secretsAtRisk > 0 ? `<span class="codex-badge codex-badge-danger">⚠ ${c.secretsAtRisk} secret${c.secretsAtRisk > 1 ? 's' : ''} at risk</span>` : '';
        const sourceBadge = `<span class="codex-badge codex-badge-source">${c.source}</span>`;
        const pinnedBadge = isPinned ? '<span class="codex-badge codex-badge-pinned">📌 pinned</span>' : '';
        const statusBadge = isActive ? '<span class="codex-badge codex-badge-active">● in scene</span>' : '<span class="codex-badge codex-badge-inactive">○ offscreen</span>';

        return `
<div class="codex-char-card ${isActive ? 'codex-char-active' : ''}" data-id="${xss(c.id)}">
  <div class="codex-char-header">
    <span class="codex-char-name">${xss(c.name)}</span>
    ${statusBadge} ${pinnedBadge}
    ${secretBadge} ${sourceBadge}
    <div class="codex-char-btns">
      <button class="codex-icon-btn codex-char-toggle" data-id="${xss(c.id)}" title="${isActive ? 'Remove from scene' : 'Add to scene'}"><i class="fa-solid fa-${isActive ? 'eye-slash' : 'eye'}"></i></button>
      <button class="codex-icon-btn codex-char-delete" data-id="${xss(c.id)}" title="Delete"><i class="fa-solid fa-trash"></i></button>
    </div>
  </div>
  ${c.currentMood ? `<div class="codex-char-mood">Mood: <b>${xss(c.currentMood)}</b></div>` : ''}
  ${c.activeGoal ? `<div class="codex-char-goal">Goal: ${xss(c.activeGoal)}</div>` : ''}
  ${c.stance ? `<div class="codex-char-stance">Stance: ${xss(c.stance)}</div>` : ''}
  ${c.hiding && c.hiding !== 'nothing' ? `<div class="codex-char-hiding">Hiding: ${xss(c.hiding)}</div>` : ''}
  ${traits || dormant ? `<div class="codex-char-traits">${traits} ${dormant}</div>` : ''}
  ${c.directive ? `<div class="codex-char-directive">${xss(c.directive.substring(0, 200))}${c.directive.length > 200 ? '…' : ''}</div>` : ''}
</div>`;
    }).join('');

    $('#codex-cast-list').html(html);
}

// ─── Render: Relationships ────────────────────────────────────────────────────

function renderRelationships() {
    const chars = getAllCharacters();
    const rels = [];
    for (const c of chars) {
        for (const [targetName, r] of Object.entries(c.relationships || {})) {
            rels.push({ from: c.name, to: targetName, stance: r.stance, tension: r.tension });
        }
    }
    if (!rels.length) { $('#codex-rel-list').html('<div class="codex-empty">No relationships tracked.</div>'); return; }

    const html = rels.map(r => {
        const tensionPct = (r.tension / 10) * 100;
        const tensionColor = r.tension > 7 ? '#c45c5c' : r.tension > 4 ? '#b8a460' : '#7a9e7e';
        return `
<div class="codex-rel-card">
  <div class="codex-rel-names"><b>${xss(r.from)}</b> → <b>${xss(r.to)}</b></div>
  <div class="codex-rel-stance">${xss(r.stance)}</div>
  <div class="codex-rel-tension">
    <span>Tension: ${r.tension}/10</span>
    <div class="codex-tension-bar"><div class="codex-tension-fill" style="width:${tensionPct}%;background:${tensionColor};"></div></div>
  </div>
</div>`;
    }).join('');

    $('#codex-rel-list').html(html);
}

// ─── Render: History ──────────────────────────────────────────────────────────

function renderHistory() {
    const history = getChatState().characterHistory || [];
    if (!history.length) { $('#codex-history-list').html('<div class="codex-empty">No changes recorded.</div>'); return; }

    const html = [...history].reverse().slice(0, 100).map(h => {
        const time = new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `<div class="codex-history-entry">
  <span class="codex-hist-time">${time}</span>
  <b>${xss(h.characterName)}</b>
  <span class="codex-hist-field">${xss(h.field)}</span>:
  <span class="codex-hist-old">${xss(h.oldValue)}</span> → <span class="codex-hist-new">${xss(h.newValue)}</span>
</div>`;
    }).join('');

    $('#codex-history-list').html(html);
}

// ─── Render: Settings ─────────────────────────────────────────────────────────

function renderSettings() {
    const s = getSettings();
    const ctx = getContext();
    $('#codex-s-enabled').prop('checked', s.enabled);
    $(`input[name="codex-update"][value="${s.updateMode}"]`).prop('checked', true);
    $('#codex-every-n-row').toggle(s.updateMode === 'every_n');
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

function addExtensionSettingsPanel() {
    const s = getSettings();
    const html = `<div class="inline-drawer" id="codex-ext-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>📖 ${EXT_NAME} — Character State Engine</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content"><label class="checkbox_label"><input type="checkbox" id="codex-master-toggle" ${s.enabled ? 'checked' : ''} /><span>Enable Codex</span></label><p style="margin:6px 0 0;opacity:0.7;font-size:0.85em;line-height:1.4;">The Codex tracks live NPC psychology — mood, goals, secrets, relationships. Characters evolve scene by scene instead of repeating the same traits. Open the <i class="fa-solid fa-users"></i> button to manage the cast.</p></div></div>`;
    $('#extensions_settings2').append(html);
    $('#codex-master-toggle').on('change', function () {
        const s = getSettings(); s.enabled = this.checked; saveSettings();
        if (s.enabled) { createFAB(); createPanel(); registerAPI(); }
        else { clearInjection(); destroyUI(); }
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════════════════════

jQuery(async () => {
    try {
        console.log(`[${EXT_ID}] ${EXT_NAME} v${EXT_VERSION} init…`);
        if (!extension_settings[EXT_ID]) extension_settings[EXT_ID] = {};
        sanitizeSettings();
        try { addExtensionSettingsPanel(); } catch (e) { console.warn('[Codex] Settings panel:', e); }

        const settings = getSettings();
        if (!settings.enabled) { console.log('[Codex] Disabled'); return; }

        createFAB();
        createPanel();

        const ctx = getContext();
        if (ctx?.chat?.length > 0) { sanitizeChatState(); }

        eventSource.on(event_types.MESSAGE_RECEIVED, async () => {
            if (getSettings().enabled && shouldUpdate()) await runUpdateCycle();
        });
        eventSource.on(event_types.CHAT_CHANGED, () => {
            sanitizeChatState();
            if (getSettings().enabled && shouldUpdate()) setTimeout(() => runUpdateCycle(), 500);
        });

        registerAPI();
        console.log(`[Codex] ✅ v${EXT_VERSION} ready`);
        toastr.success(`${EXT_NAME} v${EXT_VERSION} loaded`, '', { timeOut: 2000 });
    } catch (err) {
        console.error('[Codex] ❌ Init:', err);
        toastr.error(`Codex failed: ${err.message}`, '', { timeOut: 8000 });
    }
});
