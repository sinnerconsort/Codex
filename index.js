/**
 * The Codex v3 — Character State Engine
 * Layer 1: Identity foundation (archetype, core traits, habits, mannerisms)
 * Layer 2: Tiered secrets (surface/core/buried) with behavioral tells
 * Full-page character dossier UI. Three population modes: autopsy/collab/manual.
 * Per-chat psychology. World grouping. Lexicon integration.
 */
import { getContext, extension_settings } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced, saveChatDebounced, chat_metadata, generateRaw, setExtensionPrompt } from '../../../../script.js';

const EXT_ID = 'codex', EXT_NAME = 'The Codex', EXT_VERSION = '3.0.0', INJECT_KEY = 'codex_directives';

const JOURNAL_FORMATS = ['diary', 'journal', 'scrapbook', 'captains_log', 'ledger', 'field_notes', 'letters_unsent', 'photographs'];

// ═══ DATA MODELS ═══

function newGlobalCharacter(name, source = 'manual') {
    return {
        id: `codex_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now()}`,
        name, aliases: [], core: '', source, world: 'Uncategorized',
        linkedLexiconEntries: [], lexiconEntryId: '',
        archetype: '', emotionalCore: '', coreTraits: [],
        habits: [], mannerisms: [], growthPermission: 'drift',
        secrets: [], baseRelationships: {}, createdAt: Date.now(),
        // v3: Voice
        voiceProfile: { register: '', vocabulary: '', sentencePattern: '', avoids: '', sampleCadence: '' },
        // v3: Journal
        journalFormat: '',   // diary|journal|scrapbook|captains_log|ledger|field_notes|letters_unsent|photographs
        journalStyle: '',    // prose instruction for how they write
    };
}

function newChatState() {
    return {
        currentMood: '', activeGoal: '', stance: '', hiding: '', fear: '',
        recentMemory: '', directive: '', activeTraits: [], dormantTraits: [],
        relationships: {}, emotionalTrajectory: [], trustLevels: {},
        coreDrift: 0, secretWillingness: {}, secretsAtRisk: 0,
        lastUpdated: 0, updateCount: 0, scenesSinceUpdate: 0,
        // v3: Journal entries
        journal: [],  // [{content, timestamp, messageIndex, significance, tags, pivotal}]
    };
}

const DEFAULT_SETTINGS = {
    enabled: true, selectedProfile: 'current', updateMode: 'on_mention',
    updateEveryN: 3, sceneDetection: 'ai', maxSimultaneousUpdates: 3,
    enableOffscreen: false, offscreenFrequency: 5, injectionDepth: 1,
    injectRelationships: true, maxDirectiveLength: 500,
    useLexicon: true, trackSecretsAtRisk: true,
    journalInjectionCount: 2,  // how many journal entries to inject per turn
    characters: {}, worlds: [], collapsedWorlds: [], settingsVersion: 4,
};

const DEFAULT_CHAT = {
    characterStates: {}, activeCharacters: [], manuallyPinned: [],
    activeWorlds: [], characterHistory: [], lastUpdateAt: 0, lastUpdateTime: 0,
};

// ═══ STATE ═══

function getSettings() {
    if (!extension_settings[EXT_ID]) extension_settings[EXT_ID] = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    const s = extension_settings[EXT_ID];
    for (const k in DEFAULT_SETTINGS) { if (s[k] === undefined) s[k] = DEFAULT_SETTINGS[k]; }
    if (!s.characters || typeof s.characters !== 'object') s.characters = {};
    return s;
}

function getChat() {
    if (!chat_metadata) return JSON.parse(JSON.stringify(DEFAULT_CHAT));
    if (!chat_metadata[EXT_ID]) chat_metadata[EXT_ID] = JSON.parse(JSON.stringify(DEFAULT_CHAT));
    const c = chat_metadata[EXT_ID];
    for (const k in DEFAULT_CHAT) { if (c[k] === undefined) c[k] = JSON.parse(JSON.stringify(DEFAULT_CHAT[k])); }
    return c;
}

function getChatStateFor(id) {
    const c = getChat();
    if (!c.characterStates[id]) {
        c.characterStates[id] = newChatState();
        const g = getSettings().characters[id];
        if (g?.baseRelationships) c.characterStates[id].relationships = JSON.parse(JSON.stringify(g.baseRelationships));
    }
    return c.characterStates[id];
}

function getFullChar(id) {
    const g = getSettings().characters[id]; if (!g) return null;
    const s = getChatStateFor(id);
    return { ...g, ...s, id: g.id, name: g.name, world: g.world, core: g.core, aliases: g.aliases, archetype: g.archetype, emotionalCore: g.emotionalCore, coreTraits: g.coreTraits, habits: g.habits, mannerisms: g.mannerisms, secrets: g.secrets, growthPermission: g.growthPermission };
}

function getAllGlobal() { return Object.values(getSettings().characters || {}); }
function getByName(n) { return Object.values(getSettings().characters).find(c => c.name.toLowerCase() === n.toLowerCase()) || null; }
function getActiveChars() { return (getChat().activeCharacters || []).map(id => getFullChar(id)).filter(Boolean); }
function addHistory(name, field, oldV, newV) { const c = getChat(); c.characterHistory.push({ timestamp: Date.now(), characterName: name, field, oldValue: String(oldV || '').substring(0, 80), newValue: String(newV || '').substring(0, 80) }); if (c.characterHistory.length > 300) c.characterHistory = c.characterHistory.slice(-300); }

function migrateData() {
    const s = getSettings(); if (s.settingsVersion >= 4) return;
    for (const ch of Object.values(s.characters)) {
        if (!ch.archetype) ch.archetype = ''; if (!ch.emotionalCore) ch.emotionalCore = '';
        if (!Array.isArray(ch.coreTraits)) ch.coreTraits = []; if (!Array.isArray(ch.habits)) ch.habits = [];
        if (!Array.isArray(ch.mannerisms)) ch.mannerisms = []; if (!Array.isArray(ch.secrets)) ch.secrets = [];
        if (!ch.growthPermission) ch.growthPermission = 'drift'; if (!ch.world) ch.world = 'Uncategorized';
        // v3 fields
        if (!ch.voiceProfile) ch.voiceProfile = { register: '', vocabulary: '', sentencePattern: '', avoids: '', sampleCadence: '' };
        if (!ch.journalFormat) ch.journalFormat = '';
        if (!ch.journalStyle) ch.journalStyle = '';
        for (const f of ['currentMood','activeGoal','stance','hiding','fear','recentMemory','directive','activeTraits','dormantTraits','relationships','secretsAtRisk','active','detectedVia','lastActiveMessage','lastUpdated','updateCount','scenesSinceUpdate']) delete ch[f];
    }
    s.settingsVersion = 4;
}

function saveGlobal() { saveSettingsDebounced(); }
function saveChatData() { if (chat_metadata) saveChatDebounced(); }

// ═══ AI ═══

async function callAI(prompt, maxTokens = 500) {
    const ctx = getContext(), s = getSettings();
    if (ctx?.ConnectionManagerRequestService) {
        const pid = resolveProfile(s.selectedProfile, ctx);
        if (pid) {
            try {
                const r = await ctx.ConnectionManagerRequestService.sendRequest(pid, [{ role: 'user', content: prompt }], maxTokens, { extractData: true, includePreset: true, includeInstruct: false }, {});
                if (r?.content) return r.content;
                if (typeof r === 'string' && r.trim()) return r;
                try { const raw = await ctx.ConnectionManagerRequestService.sendRequest(pid, [{ role: 'user', content: prompt }], maxTokens, { extractData: false, includePreset: true, includeInstruct: false }, {}); const m = raw?.choices?.[0]?.message; if (m?.content) return m.content; if (m?.reasoning) return m.reasoning; } catch {}
            } catch (e) { toastr.warning('API: ' + e.message, 'Codex', { timeOut: 4000 }); }
        }
    }
    try { const r = await generateRaw(prompt, null, false, false, '', maxTokens); if (r) return r; } catch {}
    return null;
}

function resolveProfile(n, ctx) { const cm = ctx?.extensionSettings?.connectionManager; if (!cm) return null; if (!n || n === 'current') return cm.selectedProfile; return cm.profiles?.find(p => p.name === n)?.id ?? cm.selectedProfile; }
function getRecentCtx(n = 3) { const ctx = getContext(); if (!ctx?.chat?.length) return ''; return ctx.chat.slice(-n).map(m => `${m.is_user ? (ctx.name1 || 'User') : (ctx.name2 || 'AI')}: ${(m.mes || '').substring(0, 400)}`).join('\n\n'); }

// ═══ PROFILING ═══

async function profileAutopsy(charId) {
    const g = getSettings().characters[charId]; if (!g?.core) return;
    toastr.info('Deep-reading ' + g.name + '...', 'Codex', { timeOut: 3000 });
    // Adaptive budgets based on source text length
    const coreLen = g.core.length;
    const inputCap = coreLen > 10000 ? 8000 : coreLen > 5000 ? 5000 : 3500;
    const outputTokens = coreLen > 10000 ? 3500 : coreLen > 5000 ? 2800 : 2000;
    const prompt = 'Analyze this character for a roleplay engine. Return ONLY the JSON object below — no commentary, no explanations, no restructuring, no thinking out loud. Start your response with { and end with }.\n\nCHARACTER: ' + g.name + '\nSOURCE:\n' + g.core.substring(0, inputCap) + '\n\nReturn ONLY valid JSON:\n{"archetype":"behavioral description not a label","emotionalCore":"deepest vulnerability","coreTraits":["4-5 traits"],"habits":["3-4 things they DO"],"mannerisms":["3-4 speech/body tells"],"aliases":["nicknames"],"secrets":[{"content":"...","tier":"surface|core|buried","behavioralTell":"...","ifRevealed":"..."}],"currentMood":"default state","activeGoal":"...","stance":"...","hiding":"...","fear":"...","activeTraits":["3-4"],"dormantTraits":["3-4"],"directive":"2-3 sentences: behavior, body language, speech","voiceProfile":{"register":"tone/energy","vocabulary":"word choices, metaphor domains","sentencePattern":"how they structure speech","avoids":"what they never say","sampleCadence":"1-2 example sentences in their voice"},"journalFormat":"diary|journal|scrapbook|captains_log|ledger|field_notes|letters_unsent|photographs","journalStyle":"how they write privately","voiceProfile":{"register":"tone/energy","vocabulary":"word choices, metaphor domains","sentencePattern":"how they structure speech","avoids":"what they never say","sampleCadence":"1-2 example sentences in their voice"},"journalFormat":"diary|journal|scrapbook|captains_log|ledger|field_notes|letters_unsent|photographs","journalStyle":"how they write privately","baseRelationships":{"Name":{"stance":"...","tension":0-10}}}';
    try {
        const r = await callAI(prompt, outputTokens);
        if (!r) { toastr.error('No response for ' + g.name, 'Codex'); return; }
        const data = parseJson(r);
        if (!data) { toastr.warning('Parse failed: ' + r.substring(0, 60), 'Codex', { timeOut: 5000 }); return; }
        applyProfile(charId, data);
        toastr.success(g.name + ' profiled', 'Codex', { timeOut: 2000 });
    } catch (e) { toastr.error(g.name + ': ' + e.message, 'Codex'); }
}

async function profileCollab(charId, hints) {
    const g = getSettings().characters[charId]; if (!g?.core) return;
    toastr.info('Collaborating on ' + g.name + '...', 'Codex', { timeOut: 3000 });
    const coreLen = g.core.length;
    const inputCap = coreLen > 10000 ? 6000 : coreLen > 5000 ? 4000 : 3000;
    const outputTokens = coreLen > 10000 ? 3500 : coreLen > 5000 ? 2800 : 2000;
    const prompt = 'Build a profile using source text AND user guidance. Return ONLY the JSON object below — no commentary, start with { end with }.\n\nCHARACTER: ' + g.name + '\nSOURCE:\n' + g.core.substring(0, inputCap) + '\n\nUSER NOTES:\n' + hints + '\n\nReturn ONLY valid JSON:\n{"archetype":"...","emotionalCore":"...","coreTraits":["4-5"],"habits":["3-4"],"mannerisms":["3-4"],"aliases":["..."],"secrets":[{"content":"...","tier":"surface|core|buried","behavioralTell":"...","ifRevealed":"..."}],"currentMood":"...","activeGoal":"...","stance":"...","hiding":"...","fear":"...","activeTraits":["3-4"],"dormantTraits":["3-4"],"directive":"2-3 sentences","baseRelationships":{"Name":{"stance":"...","tension":0-10}}}';
    try {
        const r = await callAI(prompt, outputTokens);
        if (!r) { toastr.error('No response', 'Codex'); return; }
        const data = parseJson(r);
        if (!data) { toastr.warning('Parse failed', 'Codex', { timeOut: 5000 }); return; }
        applyProfile(charId, data);
        toastr.success(g.name + ' profiled (collab)', 'Codex', { timeOut: 2000 });
    } catch (e) { toastr.error(e.message, 'Codex'); }
}

function applyProfile(charId, data) {
    const g = getSettings().characters[charId], state = getChatStateFor(charId);
    if (data.archetype) g.archetype = data.archetype;
    if (data.emotionalCore) g.emotionalCore = data.emotionalCore;
    if (Array.isArray(data.coreTraits)) g.coreTraits = data.coreTraits;
    if (Array.isArray(data.habits)) g.habits = data.habits;
    if (Array.isArray(data.mannerisms)) g.mannerisms = data.mannerisms;
    if (Array.isArray(data.aliases) && data.aliases.length) g.aliases = data.aliases;
    // v3: Voice profile
    if (data.voiceProfile && typeof data.voiceProfile === 'object') {
        if (!g.voiceProfile) g.voiceProfile = {};
        for (const k of ['register', 'vocabulary', 'sentencePattern', 'avoids', 'sampleCadence']) {
            if (data.voiceProfile[k]) g.voiceProfile[k] = data.voiceProfile[k];
        }
    }
    // v3: Journal format + style
    if (data.journalFormat && JOURNAL_FORMATS.includes(data.journalFormat)) g.journalFormat = data.journalFormat;
    else if (data.journalFormat && typeof data.journalFormat === 'string') g.journalFormat = data.journalFormat.toLowerCase().replace(/[^a-z_]/g, '_');
    if (data.journalStyle) g.journalStyle = data.journalStyle;
    if (Array.isArray(data.secrets)) {
        g.secrets = data.secrets.map(s => ({
            content: s.content || '', tier: ['surface', 'core', 'buried'].includes(s.tier) ? s.tier : 'surface',
            behavioralTell: s.behavioralTell || '', ifRevealed: s.ifRevealed || '',
            linkedLexiconEntry: '', willingness: s.tier === 'buried' ? 0 : s.tier === 'core' ? 2 : 5,
        }));
    }
    if (data.baseRelationships && typeof data.baseRelationships === 'object') {
        g.baseRelationships = {};
        for (const [n, r] of Object.entries(data.baseRelationships)) g.baseRelationships[n] = { stance: r.stance || '', tension: Math.max(0, Math.min(10, r.tension || 5)) };
        state.relationships = JSON.parse(JSON.stringify(g.baseRelationships));
    }
    for (const k of ['currentMood', 'activeGoal', 'stance', 'hiding', 'fear', 'directive']) { if (data[k]) state[k] = data[k]; }
    if (Array.isArray(data.activeTraits)) state.activeTraits = data.activeTraits;
    if (Array.isArray(data.dormantTraits)) state.dormantTraits = data.dormantTraits;
    if (state.currentMood) state.emotionalTrajectory = [state.currentMood];
    saveGlobal(); saveChatData();
}

/** After profiling a world, extract cross-character relationships in one call */
async function extractRelationships(worldName) {
    const s = getSettings();
    const worldChars = Object.values(s.characters).filter(c => c.world === worldName && c.core);
    if (worldChars.length < 2) return;

    toastr.info('Mapping relationships for ' + worldName + '...', 'Codex', { timeOut: 3000 });

    const charSummaries = worldChars.map(c => {
        const existing = Object.keys(c.baseRelationships || {}).join(', ');
        return c.name + ': ' + (c.archetype || c.core.substring(0, 150)) + (existing ? ' (known ties: ' + existing + ')' : '');
    }).join('\n');

    const prompt = 'Given these characters from the same world, identify relationships between them based on their descriptions. Only include relationships that are implied or stated — do not invent connections.\n\nCHARACTERS:\n' + charSummaries + '\n\nReturn ONLY valid JSON — an array of relationships:\n[{"from":"Name1","to":"Name2","stance":"how Name1 feels about Name2","tension":0-10,"mutual":false}]\nSet mutual:true if the stance applies both ways. Return [] if no relationships are evident.';

    try {
        const r = await callAI(prompt, 1500);
        if (!r) return;
        const cleaned = r.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
        const arr = parseJsonArray(cleaned) || JSON.parse(cleaned);
        if (!Array.isArray(arr)) return;

        let count = 0;
        for (const rel of arr) {
            if (!rel.from || !rel.to || !rel.stance) continue;
            const fromChar = worldChars.find(c => c.name.toLowerCase() === rel.from.toLowerCase());
            const toChar = worldChars.find(c => c.name.toLowerCase() === rel.to.toLowerCase());
            if (!fromChar || !toChar) continue;

            const tension = Math.max(0, Math.min(10, rel.tension || 5));
            if (!fromChar.baseRelationships[rel.to]) {
                fromChar.baseRelationships[rel.to] = { stance: rel.stance, tension };
                count++;
            }
            if (rel.mutual && !toChar.baseRelationships[rel.from]) {
                toChar.baseRelationships[rel.from] = { stance: rel.stance, tension };
                count++;
            }
        }

        if (count > 0) {
            // Seed into per-chat state too
            for (const ch of worldChars) {
                const state = getChatStateFor(ch.id);
                state.relationships = JSON.parse(JSON.stringify(ch.baseRelationships));
            }
            saveGlobal(); saveChatData();
            toastr.success(count + ' relationships mapped in ' + worldName, 'Codex', { timeOut: 3000 });
        }
    } catch (e) {
        console.warn('[Codex] Relationship extraction failed:', e);
    }
}

// ═══ DETECTION ═══

async function detectActive() {
    const s = getSettings(), c = getChat(), all = getAllGlobal(); if (!all.length) return [];
    if (s.sceneDetection === 'manual') return c.activeCharacters || [];
    
    // Auto-detect relevant worlds from current character card name
    let rel;
    if (c.activeWorlds?.length > 0) {
        rel = all.filter(ch => c.activeWorlds.includes(ch.world));
    } else {
        // Try to detect world from current character card
        const ctx = getContext();
        const cardName = ctx?.name2 || '';
        const matchedChar = all.find(ch => ch.name === cardName || ch.aliases?.includes(cardName));
        if (matchedChar?.world && matchedChar.world !== 'Uncategorized') {
            // Scope to matched character's world + any manually pinned characters
            const pinned = (c.manuallyPinned || []);
            rel = all.filter(ch => ch.world === matchedChar.world || pinned.includes(ch.id));
        } else {
            // No world detected — use all (legacy behavior)
            rel = all;
        }
    }
    
    if (!rel.length) return []; if (s.sceneDetection === 'keyword') return detectKW(rel);
    return await detectAI(rel);
}
function detectKW(chars) { const t = (getContext()?.chat || []).slice(-3).map(m => m.mes || '').join(' ').toLowerCase(); return chars.filter(c => [c.name, ...(c.aliases || [])].some(n => n.length > 2 && t.includes(n.toLowerCase()))).map(c => c.id); }
async function detectAI(chars) {
    const ctx = getRecentCtx(3); if (!ctx.trim()) return [];
    const list = chars.map(c => { const a = c.aliases?.length ? ' (also: ' + c.aliases.join(', ') + ')' : ''; return '- ' + c.name + a; }).join('\n');
    try { const r = await callAI('Which characters are PRESENT?\n\nKNOWN:\n' + list + '\n\nRECENT:\n' + ctx + '\n\nReturn ONLY: ["Name1"]', 200); const p = parseJsonArray(r); if (!Array.isArray(p)) return detectKW(chars); return p.map(n => chars.find(c => c.name.toLowerCase() === n.toLowerCase() || c.aliases?.some(a => a.toLowerCase() === n.toLowerCase()))?.id).filter(Boolean); } catch { return detectKW(chars); }
}

// ═══ UPDATE ENGINE ═══

let isUpdating = false;
async function runUpdate(opts = {}) {
    if (isUpdating && !opts.force) return; isUpdating = true;
    try {
        const s = getSettings(), c = getChat(), ctx = getContext();
        const det = await detectActive(), pin = c.manuallyPinned || [];
        const merged = [...new Set([...det, ...pin])]; c.activeCharacters = merged;
        for (const id of merged) getChatStateFor(id);
        const toUp = merged.slice(0, s.maxSimultaneousUpdates);
        if (opts.force) toastr.info('Updating ' + toUp.length + '...', 'Codex', { timeOut: 2000 });
        for (const id of toUp) { if (!s.characters[id]?.core) continue; await updateState(id, opts.force); }
        // v3: Decay journal significance for all active characters
        for (const id of merged) decayJournalEntries(id);
        injectDirectives(); c.lastUpdateAt = ctx?.chat?.length || 0; c.lastUpdateTime = Date.now();
        saveGlobal(); saveChatData(); document.dispatchEvent(new CustomEvent('codex:updated'));
    } catch (e) { console.error('[Codex]', e); } finally { isUpdating = false; }
}

async function updateState(charId, verbose = false) {
    const g = getSettings().characters[charId], state = getChatStateFor(charId), s = getSettings();
    if (verbose) toastr.info('Updating ' + g.name + '...', 'Codex', { timeOut: 2000 });
    let secretCtx = '';
    if (s.useLexicon && s.trackSecretsAtRisk) { const old = state.secretsAtRisk; let nw = 0; if (window.LexiconAPI?.isActive?.() && g.linkedLexiconEntries?.length) { for (const eid of g.linkedLexiconEntries) { try { const ls = await window.LexiconAPI.getNarrativeState(eid); if (ls?.action === 'HINT' || ls?.action === 'INJECT') nw++; } catch {} } } if (nw !== old) { state.secretsAtRisk = nw; if (nw > 0) secretCtx = '\nSECRETS AT RISK: ' + nw + ' exposed.'; } }
    let secPrompt = '';
    if (g.secrets?.length) secPrompt = '\n\nSECRETS:\n' + g.secrets.map((sec, i) => { const w = state.secretWillingness?.[i] ?? sec.willingness ?? 3; return '  [' + sec.tier.toUpperCase() + '] ' + sec.content + ' (will: ' + w + '/10, tell: ' + (sec.behavioralTell || 'none') + ')'; }).join('\n');
    let relCtx = ''; if (Object.keys(state.relationships).length > 0) relCtx = '\n\nRELATIONSHIPS:\n' + Object.entries(state.relationships).map(([n, r]) => '  ' + n + ': ' + r.stance + ' (tension ' + r.tension + '/10)').join('\n');
    const prompt = 'Update character psychology.\n\nCHARACTER: ' + g.name + '\nARCHETYPE: ' + (g.archetype || 'n/a') + '\nCORE: ' + (g.emotionalCore || 'n/a') + '\nANCHOR TRAITS: ' + ((g.coreTraits || []).join(', ') || 'n/a') + '\n\nSTATE:\n  Mood: ' + (state.currentMood || '?') + ' | Goal: ' + (state.activeGoal || '?') + '\n  Stance: ' + (state.stance || '?') + ' | Hiding: ' + (state.hiding || '?') + '\n  Trajectory: ' + ((state.emotionalTrajectory || []).slice(-5).join(' > ') || 'none') + relCtx + secPrompt + secretCtx + '\n\nWHAT HAPPENED:\n' + getRecentCtx(3) + '\n\nReturn ONLY JSON:\n{"currentMood":"1-4 words","activeGoal":"...","stance":"...","hiding":"...","fear":"...","recentMemory":"one sentence","activeTraits":["2-4"],"dormantTraits":["2-4"],"directive":"2-3 sentences: behavior, tells, habits","relationshipUpdates":{"Name":{"stance":"...","tension":0-10}},"trustUpdates":{"Name":0-10},"secretWillingnessUpdates":{"0":0-10},"journalEntry":"1-2 sentences in character voice as their private writings","journalSignificance":0-10}';
    try {
        const r = await callAI(prompt, 900); if (!r) { if (verbose) toastr.error('No response: ' + g.name, 'Codex'); return; }
        const data = parseJson(r); if (!data) { if (verbose) toastr.warning('Parse fail: ' + g.name, 'Codex', { timeOut: 5000 }); return; }
        for (const f of ['currentMood', 'activeGoal', 'stance', 'hiding', 'fear', 'recentMemory', 'directive']) { if (data[f] && data[f] !== state[f]) { addHistory(g.name, f, state[f], data[f]); state[f] = data[f]; } }
        if (Array.isArray(data.activeTraits)) state.activeTraits = data.activeTraits;
        if (Array.isArray(data.dormantTraits)) state.dormantTraits = data.dormantTraits;
        if (data.currentMood && data.currentMood !== (state.emotionalTrajectory || []).slice(-1)[0]) { if (!Array.isArray(state.emotionalTrajectory)) state.emotionalTrajectory = []; state.emotionalTrajectory.push(data.currentMood); if (state.emotionalTrajectory.length > 20) state.emotionalTrajectory = state.emotionalTrajectory.slice(-20); }
        if (data.relationshipUpdates) for (const [n, u] of Object.entries(data.relationshipUpdates)) { if (!state.relationships[n]) state.relationships[n] = { stance: '', tension: 5 }; if (u.stance) { addHistory(g.name, 'rel:' + n, state.relationships[n].stance, u.stance); state.relationships[n].stance = u.stance; } if (u.tension !== undefined) state.relationships[n].tension = Math.max(0, Math.min(10, u.tension)); }
        if (data.trustUpdates) { if (!state.trustLevels) state.trustLevels = {}; for (const [n, v] of Object.entries(data.trustUpdates)) state.trustLevels[n] = Math.max(0, Math.min(10, v)); }
        if (data.secretWillingnessUpdates) { if (!state.secretWillingness) state.secretWillingness = {}; for (const [i, v] of Object.entries(data.secretWillingnessUpdates)) state.secretWillingness[parseInt(i)] = Math.max(0, Math.min(10, v)); }
        // v3: Journal entry
        if (data.journalEntry && data.journalEntry.trim()) {
            if (!Array.isArray(state.journal)) state.journal = [];
            state.journal.push({ content: data.journalEntry.trim(), timestamp: Date.now(), messageIndex: (getContext()?.chat?.length || 0), significance: Math.max(0, Math.min(10, data.journalSignificance || 5)), pivotal: (data.journalSignificance || 0) >= 9, tags: [] });
            if (state.journal.length > 50) state.journal = state.journal.slice(-50);
        }
        state.lastUpdated = Date.now(); state.updateCount++; state.scenesSinceUpdate = 0;
        if (verbose) toastr.success(g.name + ': ' + state.currentMood, 'Codex', { timeOut: 2000 });
    } catch (e) { if (verbose) toastr.error(g.name + ': ' + e.message, 'Codex'); }
}

// ═══ JOURNAL SELECTION ═══

/** Pick the N most relevant journal entries for injection */
function selectJournalEntries(charId, count) {
    const state = getChatStateFor(charId);
    if (!Array.isArray(state.journal) || !state.journal.length) return [];
    const msgIndex = getContext()?.chat?.length || 0;
    return state.journal
        .filter(j => j.significance > 1 || j.pivotal)
        .map(j => {
            const age = Math.max(1, msgIndex - (j.messageIndex || 0));
            const recencyBoost = Math.max(0.2, 1 - (age / 100));
            const score = (j.pivotal ? 10 : j.significance) * recencyBoost;
            return { ...j, score };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, count);
}

/** Decay journal significance over time */
function decayJournalEntries(charId) {
    const state = getChatStateFor(charId);
    if (!Array.isArray(state.journal)) return;
    const msgIndex = getContext()?.chat?.length || 0;
    for (const entry of state.journal) {
        if (entry.pivotal) continue; // pivotal entries never decay
        const age = msgIndex - (entry.messageIndex || 0);
        if (age > 0 && age % 10 === 0 && entry.significance > 1) {
            entry.significance = Math.max(1, entry.significance - 1);
        }
    }
}

// ═══ INJECTION ═══

function injectDirectives() {
    const s = getSettings(), active = getActiveChars();
    if (!active.length) { try { setExtensionPrompt(INJECT_KEY, '', 1, 0, false); } catch {} return; }
    const blocks = active.filter(c => c.directive).map(c => {
        let b = '';
        
        // v3: Journal entries (injected BEFORE directive for voice priming)
        const journalEntries = selectJournalEntries(c.id, s.journalInjectionCount || 2);
        if (journalEntries.length) {
            b += '[' + c.name + ' — RECENT MEMORY]\n';
            b += journalEntries.map(j => '"' + j.content + '"').join('\n');
            b += '\n\n';
        }
        
        b += '[CHARACTER STATE — ' + c.name + ']\n' + c.directive.substring(0, s.maxDirectiveLength);
        
        // v3: Voice profile
        const vp = c.voiceProfile;
        if (vp && (vp.register || vp.sampleCadence)) {
            let voice = '\nVoice: ';
            if (vp.register) voice += vp.register;
            if (vp.sentencePattern) voice += '. ' + vp.sentencePattern;
            if (vp.avoids) voice += '. Avoids: ' + vp.avoids;
            if (vp.sampleCadence) voice += '\nCadence example: "' + vp.sampleCadence + '"';
            b += voice;
        }
        
        if (c.hiding && c.hiding !== 'nothing') b += '\nHiding: ' + c.hiding;
        if (c.activeGoal) b += '\nGoal: ' + c.activeGoal;
        const tells = (c.secrets || []).filter(sec => sec.behavioralTell).map(sec => sec.behavioralTell);
        if (tells.length) b += '\nTells: ' + tells.join('; ');
        if (s.injectRelationships && Object.keys(c.relationships || {}).length > 0) {
            const rel = Object.entries(c.relationships).filter(([n]) => active.some(a => a.name === n)).map(([n, r]) => n + ': ' + r.stance).join('; ');
            if (rel) b += '\nRels: ' + rel;
        }
        return b;
    });
    if (blocks.length > 0) setExtensionPrompt(INJECT_KEY, blocks.join('\n\n'), 1, s.injectionDepth, false);
}

// ═══ IMPORT ═══

async function importFromLexicon(worldName) {
    if (!window.LexiconAPI?.isActive?.()) { toastr.warning('Lexicon not active', 'Codex'); return 0; }
    const entries = await window.LexiconAPI.getEntries({ category: 'Character' });
    if (!entries.length) { toastr.info('No Character entries', 'Codex'); return 0; }
    const s = getSettings(), world = worldName || 'Lexicon Import';
    if (!s.worlds.includes(world)) s.worlds.push(world);
    let count = 0;
    for (const e of entries) {
        if (Object.values(s.characters).some(c => c.lexiconEntryId === e.id)) continue;
        const ch = newGlobalCharacter(e.title, 'lexicon');
        ch.core = (e.content || '').substring(0, 12000); ch.lexiconEntryId = e.id;
        ch.linkedLexiconEntries = [e.id]; ch.world = world;
        s.characters[ch.id] = ch; count++;
    }
    if (count > 0) {
        saveGlobal(); toastr.success('Imported ' + count + ' -> ' + world, 'Codex', { timeOut: 3000 });
        for (const ch of Object.values(s.characters)) {
            if (ch.source === 'lexicon' && ch.world === world && !getChatStateFor(ch.id).currentMood)
                await profileAutopsy(ch.id);
        }
        await extractRelationships(world);
        saveGlobal(); saveChatData();
    }
    return count;
}

async function importFromSTCards(worldName) {
    const ctx = getContext(), s = getSettings();
    if (!ctx?.characters?.length) { toastr.info('No characters loaded', 'Codex'); return 0; }
    const world = worldName || 'ST Cards';
    if (!s.worlds.includes(world)) s.worlds.push(world);
    let count = 0;
    for (const card of ctx.characters) {
        if (!card?.name) continue;
        if (Object.values(s.characters).some(c => c.name === card.name)) continue;
        const desc = (card.data?.description || card.description || '').substring(0, 8000);
        const personality = (card.data?.personality || card.personality || '').substring(0, 1500);
        const core = [desc, personality].filter(Boolean).join('\n\n');
        if (!core.trim()) continue;
        const ch = newGlobalCharacter(card.name, 'character_card');
        ch.core = core; ch.world = world;
        s.characters[ch.id] = ch; count++;
    }
    if (count > 0) {
        saveGlobal(); toastr.success('Imported ' + count + ' cards -> ' + world, 'Codex', { timeOut: 3000 });
        for (const ch of Object.values(s.characters)) {
            if (ch.source === 'character_card' && ch.world === world && !getChatStateFor(ch.id).currentMood)
                await profileAutopsy(ch.id);
        }
        await extractRelationships(world);
        saveGlobal(); saveChatData();
    }
    return count;
}

async function importSingleCard(cardName, worldName) {
    const ctx = getContext(), s = getSettings();
    if (!ctx?.characters?.length) { toastr.info('No characters loaded', 'Codex'); return 0; }
    const card = ctx.characters.find(c => c?.name === cardName);
    if (!card) { toastr.warning('Card not found: ' + cardName, 'Codex'); return 0; }
    if (Object.values(s.characters).some(c => c.name === card.name)) { toastr.info(card.name + ' already imported', 'Codex'); return 0; }

    const desc = (card.data?.description || card.description || '').substring(0, 8000);
    const personality = (card.data?.personality || card.personality || '').substring(0, 1500);
    const scenario = (card.data?.scenario || card.scenario || '').substring(0, 500);
    const core = [desc, personality, scenario].filter(Boolean).join('\n\n');
    if (!core.trim()) { toastr.warning('Card has no description', 'Codex'); return 0; }

    const world = worldName || 'ST Cards';
    if (!s.worlds.includes(world)) s.worlds.push(world);
    const ch = newGlobalCharacter(card.name, 'character_card');
    ch.core = core; ch.world = world;
    s.characters[ch.id] = ch;
    saveGlobal();
    await profileAutopsy(ch.id);
    saveGlobal(); saveChatData();
    toastr.success(card.name + ' imported -> ' + world, 'Codex', { timeOut: 3000 });
    return 1;
}

function populateCardPicker() {
    const ctx = getContext(), $picker = $('#codex-card-picker');
    $picker.empty().append('<option value="">Select a character...</option>');
    if (!ctx?.characters?.length) return;
    const existing = new Set(Object.values(getSettings().characters).map(c => c.name));
    for (const card of ctx.characters) {
        if (!card?.name) continue;
        const imported = existing.has(card.name);
        $picker.append('<option value="' + xss(card.name) + '"' + (imported ? ' disabled style="opacity:0.4;"' : '') + '>' + xss(card.name) + (imported ? ' (imported)' : '') + '</option>');
    }
}

function shouldUpdate() {
    const s = getSettings(), c = getChat();
    if (!s.enabled || s.updateMode === 'manual' || !Object.keys(s.characters).length) return false;
    if (s.updateMode === 'every_message' || s.updateMode === 'on_mention') return true;
    if (s.updateMode === 'every_n') return ((getContext()?.chat?.length || 0) - (c.lastUpdateAt || 0)) >= (s.updateEveryN || 3);
    return false;
}

// ═══ API ═══

function registerAPI() {
    window.CodexAPI = {
        version: EXT_VERSION, isActive: () => getSettings()?.enabled === true,
        getCharacterState: (n) => { const g = getByName(n); return g ? getFullChar(g.id) : null; },
        getActiveCharacters: () => getActiveChars(),
        getAllDirectives: () => getActiveChars().filter(c => c.directive).map(c => ({ name: c.name, directive: c.directive })),
        getRelationship: (c1, c2) => { const g = getByName(c1); if (!g) return null; return getChatStateFor(g.id).relationships?.[c2] || null; },
        isSecretAtRisk: (n) => { const g = getByName(n); if (!g) return { atRisk: 0 }; return { atRisk: getChatStateFor(g.id).secretsAtRisk, entries: g.linkedLexiconEntries }; },
        getAllCharacters: () => getAllGlobal().map(g => getFullChar(g.id)),
        getCharacterHistory: (n, lim = 20) => (getChat().characterHistory || []).filter(h => h.characterName === n).slice(-lim),
        // v3: Journal
        getCharacterJournal: (n, lim = 10) => { const g = getByName(n); if (!g) return []; return (getChatStateFor(g.id).journal || []).slice(-lim); },
        getSignificantMemories: (n) => { const g = getByName(n); if (!g) return []; return (getChatStateFor(g.id).journal || []).filter(j => j.significance >= 7 || j.pivotal); },
        getVoiceProfile: (n) => { const g = getByName(n); return g?.voiceProfile || null; },
    };
}

// ═══ HELPERS ═══

function parseJsonArray(t) { if (!t) return null; const m = t.replace(/```json\s*/gi, '').replace(/```/g, '').trim().match(/\[[\s\S]*?\]/); if (!m) return null; try { const p = JSON.parse(m[0]); return Array.isArray(p) ? p : null; } catch { return null; } }
function parseJson(t) { if (!t) return null; const c = t.replace(/```json\s*/gi, '').replace(/```/g, '').trim(); const s = c.indexOf('{'), e = c.lastIndexOf('}'); if (s === -1 || e <= s) return null; try { const p = JSON.parse(c.substring(s, e + 1)); return typeof p === 'object' && !Array.isArray(p) ? p : null; } catch { return null; } }
function xss(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// ═══ EXPAND TEXTAREA OVERLAY ═══

function createExpandOverlay() {
    if ($('#codex-expand-overlay').length) return;
    $('body').append('<div id="codex-expand-overlay" class="codex-expand-overlay" style="display:none;"><div class="codex-expand-header"><span class="codex-expand-title">Edit</span><button class="codex-btn codex-btn-primary" id="codex-expand-done"><i class="fa-solid fa-check"></i> Done</button></div><textarea id="codex-expand-textarea" class="codex-expand-textarea"></textarea></div>');
    let sourceEl = null;
    $(document).on('click', '.codex-expand-btn', function (e) {
        e.preventDefault(); e.stopPropagation();
        const target = $(this).data('target');
        sourceEl = target ? $(target) : $(this).siblings('textarea, input').first();
        if (!sourceEl.length) sourceEl = $(this).parent().find('textarea, input').first();
        if (!sourceEl.length) return;
        const label = $(this).data('label') || 'Edit';
        $('#codex-expand-textarea').val(sourceEl.val());
        $('.codex-expand-title').text(label);
        $('#codex-expand-overlay').fadeIn(150);
        $('#codex-expand-textarea').focus();
    });
    $('#codex-expand-done').on('click', function () {
        if (sourceEl?.length) sourceEl.val($('#codex-expand-textarea').val()).trigger('change');
        $('#codex-expand-overlay').fadeOut(150);
        sourceEl = null;
    });
}

// ═══ FAB ═══

function createFAB() {
    if ($('#codex-fab').length) return;
    const fab = $('<button>', { id: 'codex-fab', title: EXT_NAME, html: '<i class="fa-solid fa-users" style="pointer-events:none;"></i>' }).css({ position: 'fixed', bottom: '180px', right: '15px', width: '44px', height: '44px', borderRadius: '50%', border: '2px solid var(--SmartThemeBodyColor,rgba(255,255,255,0.3))', background: 'var(--SmartThemeBlurTintColor,rgba(20,20,35,0.9))', color: 'var(--SmartThemeBodyColor,#e8e0d0)', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: '31000', boxShadow: '0 2px 12px rgba(0,0,0,0.5)', padding: '0', margin: '0' });
    for (const sel of ['#form_sheld', '#sheld', '#chat', 'body']) { const t = $(sel); if (t.length) { t.append(fab); t.css('overflow', 'visible'); break; } }
    let isDrag = false, wasDrag = false, sX, sY, sR, sB;
    fab.on('click', e => { if (wasDrag) { wasDrag = false; return; } e.preventDefault(); e.stopPropagation(); togglePanel(); });
    fab[0].addEventListener('touchstart', e => { isDrag = true; wasDrag = false; const t = e.touches[0]; sX = t.clientX; sY = t.clientY; const r = fab[0].getBoundingClientRect(); sR = window.innerWidth - r.right; sB = window.innerHeight - r.bottom; }, { passive: true });
    fab[0].addEventListener('touchmove', e => { if (!isDrag) return; const t = e.touches[0], dx = t.clientX - sX, dy = t.clientY - sY; if (Math.abs(dx) > 8 || Math.abs(dy) > 8) { wasDrag = true; e.preventDefault(); fab.css({ right: Math.max(4, sR - dx) + 'px', bottom: Math.max(4, sB - dy) + 'px' }); } }, { passive: false });
    fab[0].addEventListener('touchend', e => { isDrag = false; if (!wasDrag) { e.preventDefault(); togglePanel(); } wasDrag = false; }, { passive: false });
    setInterval(() => { if (getSettings().enabled && !$('#codex-fab').length) createFAB(); }, 3000);
}

// ═══ PANEL ═══

let currentDossier = null;

function createPanel() {
    if ($('#codex-panel').length) return;
    $('body').append('<div id="codex-panel" class="codex-panel" style="display:none;"><div class="codex-header"><span class="codex-title"><i class="fa-solid fa-users"></i> ' + EXT_NAME + ' <span class="codex-vtag">v3</span></span><div class="codex-header-btns"><button class="codex-icon-btn" id="codex-refresh" title="Update"><i class="fa-solid fa-arrows-rotate"></i></button><button class="codex-icon-btn" id="codex-close"><i class="fa-solid fa-xmark"></i></button></div></div><div class="codex-tabs"><button class="codex-tab active" data-tab="cast">Cast</button><button class="codex-tab" data-tab="relationships">Relations</button><button class="codex-tab" data-tab="history">History</button><button class="codex-tab" data-tab="import">Import</button><button class="codex-tab" data-tab="settings">Settings</button></div><div class="codex-pane" id="codex-pane-cast"><div id="codex-cast-list"></div></div><div class="codex-pane" id="codex-pane-dossier" style="display:none;"><div id="codex-dossier-content"></div></div><div class="codex-pane" id="codex-pane-relationships" style="display:none;"><div id="codex-rel-list"></div></div><div class="codex-pane" id="codex-pane-history" style="display:none;"><div class="codex-history-header"><span>Log</span><button class="codex-btn codex-btn-sm" id="codex-history-clear">Clear</button></div><div id="codex-history-list"></div></div><div class="codex-pane" id="codex-pane-import" style="display:none;"><div class="codex-import-section"><b>From Lexicon</b><input type="text" id="codex-import-world" class="codex-input" placeholder="World name"/><button class="codex-btn codex-btn-primary" id="codex-import-lexicon">Import from Lexicon</button></div><div class="codex-import-section"><b>From ST Character Cards</b><p style="font-size:11px;opacity:0.5;margin:2px 0 6px;">Pick a card or import all.</p><select id="codex-card-picker" class="codex-input"><option value="">Select a character...</option></select><button class="codex-btn codex-btn-primary" id="codex-import-one-card">Import Selected</button><button class="codex-btn" id="codex-import-cards" style="margin-top:4px;">Import All Cards</button></div><div class="codex-import-section"><b>Manual</b><input type="text" id="codex-m-name" class="codex-input" placeholder="Name"/><textarea id="codex-m-core" class="codex-input" rows="3" placeholder="Description"></textarea><button class="codex-expand-btn codex-icon-btn" data-target="#codex-m-core" data-label="Description" title="Expand"><i class="fa-solid fa-expand"></i></button><input type="text" id="codex-m-aliases" class="codex-input" placeholder="Aliases (comma separated)"/><input type="text" id="codex-m-world" class="codex-input" placeholder="World"/><button class="codex-btn codex-btn-primary" id="codex-m-save">Create</button></div></div><div class="codex-pane codex-settings-pane" id="codex-pane-settings" style="display:none;"><div class="codex-sg"><label class="codex-check"><input type="checkbox" id="codex-s-enabled"/> <b>Enable</b></label></div><div class="codex-sg"><b>Update:</b> <label class="codex-check"><input type="radio" name="codex-update" value="every_message"/> Every msg</label><label class="codex-check"><input type="radio" name="codex-update" value="on_mention"/> Mention</label><label class="codex-check"><input type="radio" name="codex-update" value="every_n"/> Every N</label><label class="codex-check"><input type="radio" name="codex-update" value="manual"/> Manual</label></div><div class="codex-sg"><b>Detection:</b> <label class="codex-check"><input type="radio" name="codex-detect" value="ai"/> AI</label><label class="codex-check"><input type="radio" name="codex-detect" value="keyword"/> KW</label><label class="codex-check"><input type="radio" name="codex-detect" value="manual"/> Manual</label></div><div class="codex-sg"><b>Max</b> <span id="codex-max-val">3</span><input type="range" id="codex-s-max" min="1" max="6" value="3"/></div><div class="codex-sg"><b>Depth</b> <span id="codex-depth-val">1</span><input type="range" id="codex-s-depth" min="0" max="6" value="1"/></div><div class="codex-sg"><label class="codex-check"><input type="checkbox" id="codex-s-rels"/> Relationships</label></div><div class="codex-sg"><b>Profile</b><select id="codex-s-profile"><option value="current">Current</option></select></div><div class="codex-sg"><label class="codex-check"><input type="checkbox" id="codex-s-lexicon"/> Lexicon</label></div><div class="codex-sg"><button class="codex-btn codex-btn-danger" id="codex-clear-all">Clear all</button></div></div></div>');
    bindEvents();
}

function togglePanel() { $('#codex-panel').is(':visible') ? $('#codex-panel').fadeOut(150) : openPanel(); }
function openPanel() { $('#codex-panel').fadeIn(150); currentDossier = null; gotoTab('cast'); }
function gotoTab(name) { currentDossier = null; $('.codex-tab').removeClass('active'); $('.codex-tab[data-tab="' + name + '"]').addClass('active'); $('.codex-pane').hide(); $('#codex-pane-' + name).show(); if (name === 'cast') renderCast(); if (name === 'relationships') renderRels(); if (name === 'history') renderHistory(); if (name === 'settings') renderSettings(); if (name === 'import') populateCardPicker(); }
function openDossier(id) { currentDossier = id; $('.codex-pane').hide(); $('#codex-pane-dossier').show(); renderDossier(id); }

// ═══ RENDER: CAST ═══

function renderCast() {
    const all = getAllGlobal(), chat = getChat(), s = getSettings();
    if (!all.length) { $('#codex-cast-list').html('<div class="codex-empty">No characters.</div>'); return; }
    const groups = {};
    for (const g of all) { const w = g.world || 'Uncategorized'; if (!groups[w]) groups[w] = []; groups[w].push(g); }
    let html = '';
    for (const [world, chars] of Object.entries(groups)) {
        const col = (s.collapsedWorlds || []).includes(world);
        const ac = chars.filter(c => chat.activeCharacters.includes(c.id)).length;
        html += '<div class="codex-world-header" data-world="' + xss(world) + '"><i class="fa-solid fa-chevron-' + (col ? 'right' : 'down') + '"></i><span class="codex-world-name">' + xss(world) + '</span><span class="codex-world-count">' + chars.length + (ac ? ' \u00b7 ' + ac + ' active' : '') + '</span><button class="codex-icon-btn codex-world-rename" data-world="' + xss(world) + '" title="Rename group"><i class="fa-solid fa-pen-to-square"></i></button></div>';
        if (!col) {
            html += '<div class="codex-world-group">';
            for (const g of chars) {
                const st = getChatStateFor(g.id), isA = chat.activeCharacters.includes(g.id), isP = (chat.manuallyPinned || []).includes(g.id);
                html += '<div class="codex-cast-card ' + (isA ? 'codex-char-active' : '') + '" data-id="' + xss(g.id) + '"><div class="codex-cast-row"><span class="codex-cast-name">' + xss(g.name) + '</span>' + (isA ? '<span class="codex-badge codex-badge-active">\u25CF</span>' : '') + (isP ? '<span class="codex-badge codex-badge-pinned">\uD83D\uDCCC</span>' : '') + (g.archetype ? '<span class="codex-cast-arch">' + xss(g.archetype.substring(0, 35)) + '</span>' : '') + '<div class="codex-cast-btns"><button class="codex-icon-btn codex-char-toggle" data-id="' + xss(g.id) + '"><i class="fa-solid fa-' + (isA ? 'eye-slash' : 'eye') + '"></i></button></div></div>' + (st.currentMood ? '<div class="codex-cast-mood">' + xss(st.currentMood) + '</div>' : '<div class="codex-cast-mood codex-empty-inline">tap to open dossier</div>') + '</div>';
            }
            html += '</div>';
        }
    }
    $('#codex-cast-list').html(html);
}

// ═══ RENDER: DOSSIER ═══

function renderDossier(charId) {
    const g = getSettings().characters[charId];
    if (!g) { $('#codex-dossier-content').html('<div class="codex-empty">Not found.</div>'); return; }
    const state = getChatStateFor(charId), chat = getChat(), isA = chat.activeCharacters.includes(charId);
    const traj = (state.emotionalTrajectory || []).slice(-8).join(' \u2192 ');
    const traits = (state.activeTraits || []).map(t => '<span class="codex-trait codex-trait-active">' + xss(t) + '</span>').join('');
    const dormant = (state.dormantTraits || []).map(t => '<span class="codex-trait codex-trait-dormant">' + xss(t) + '</span>').join('');
    const habits = (g.habits || []).map(h => '<span class="codex-habit-pill">' + xss(h) + '</span>').join('');
    const manners = (g.mannerisms || []).map(m => '<span class="codex-habit-pill">' + xss(m) + '</span>').join('');

    let secretsHtml = '<div class="codex-empty">None defined.</div>';
    if (g.secrets?.length) {
        secretsHtml = g.secrets.map(function(sec, i) {
            const w = state.secretWillingness?.[i] ?? sec.willingness ?? 3;
            const tc = sec.tier === 'buried' ? '#8b4555' : sec.tier === 'core' ? '#b8a460' : '#7a9e7e';
            return '<div class="codex-secret-card" style="border-left-color:' + tc + ';"><div class="codex-secret-header"><span class="codex-badge" style="background:' + tc + '22;border-color:' + tc + '55;color:' + tc + ';">' + sec.tier.toUpperCase() + '</span> will: ' + w + '/10</div><div>' + xss(sec.content) + '</div>' + (sec.behavioralTell ? '<div class="codex-secret-tell">Tell: ' + xss(sec.behavioralTell) + '</div>' : '') + (sec.ifRevealed ? '<div class="codex-secret-reveal">If revealed: ' + xss(sec.ifRevealed) + '</div>' : '') + '</div>';
        }).join('');
    }

    let relsHtml = '<div class="codex-empty">None.</div>';
    const relCount = Object.keys(state.relationships || {}).length;
    if (relCount) {
        relsHtml = Object.entries(state.relationships).map(function(entry) {
            var n = entry[0], r = entry[1];
            const pct = (r.tension / 10) * 100, col = r.tension > 7 ? '#c45c5c' : r.tension > 4 ? '#b8a460' : '#7a9e7e';
            const trust = state.trustLevels?.[n];
            return '<div class="codex-rel-card"><b>' + xss(n) + '</b>: ' + xss(r.stance) + '<div class="codex-tension-bar"><div class="codex-tension-fill" style="width:' + pct + '%;background:' + col + ';"></div></div><span style="font-size:10px;opacity:0.5;">t:' + r.tension + '/10' + (trust !== undefined ? ' trust:' + trust : '') + '</span></div>';
        }).join('');
    }

    const secCount = (g.secrets || []).length;
    const journalCount = (state.journal || []).length;

    // v3: Voice profile display
    const vp = g.voiceProfile || {};
    let voiceHtml = '<div class="codex-empty">Not profiled yet.</div>';
    if (vp.register || vp.sampleCadence) {
        voiceHtml = '';
        if (vp.register) voiceHtml += '<div class="codex-dossier-section"><div class="codex-dossier-label">REGISTER</div><div>' + xss(vp.register) + '</div></div>';
        if (vp.vocabulary) voiceHtml += '<div class="codex-dossier-section"><div class="codex-dossier-label">VOCABULARY</div><div>' + xss(vp.vocabulary) + '</div></div>';
        if (vp.sentencePattern) voiceHtml += '<div class="codex-dossier-section"><div class="codex-dossier-label">PATTERN</div><div>' + xss(vp.sentencePattern) + '</div></div>';
        if (vp.avoids) voiceHtml += '<div class="codex-dossier-section"><div class="codex-dossier-label">AVOIDS</div><div>' + xss(vp.avoids) + '</div></div>';
        if (vp.sampleCadence) voiceHtml += '<div class="codex-dossier-section"><div class="codex-dossier-label">CADENCE</div><div class="codex-journal-entry"><i>' + xss(vp.sampleCadence) + '</i></div></div>';
    }

    // v3: Journal display
    let journalHtml = '<div class="codex-empty">No entries yet. Entries are created automatically during character updates.</div>';
    if (journalCount > 0) {
        const jFormat = g.journalFormat || 'journal';
        journalHtml = '<div class="codex-journal-format">' + xss(jFormat) + (g.journalStyle ? ' — ' + xss(g.journalStyle) : '') + '</div>';
        journalHtml += (state.journal || []).slice().reverse().slice(0, 20).map(function(j) {
            const t = new Date(j.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const sig = j.significance || 0;
            const sigBar = '<span class="codex-sig-dots">' + Array.from({length: 10}, function(_, k) { return '<span class="codex-sig-dot' + (k < sig ? ' codex-sig-active' : '') + (j.pivotal ? ' codex-sig-pivotal' : '') + '"></span>'; }).join('') + '</span>';
            return '<div class="codex-journal-entry' + (j.pivotal ? ' codex-journal-pivotal' : '') + '"><div class="codex-journal-meta">' + t + ' ' + sigBar + (j.pivotal ? ' <span class="codex-badge codex-badge-pinned">pivotal</span>' : '') + '</div><div class="codex-journal-text">' + xss(j.content) + '</div></div>';
        }).join('');
    }

    const h = '<div class="codex-dossier">'
        + '<div class="codex-dossier-back" id="codex-dossier-back"><i class="fa-solid fa-arrow-left"></i> Back</div>'
        + '<div class="codex-dossier-name">' + xss(g.name) + ' ' + (isA ? '<span class="codex-badge codex-badge-active">\u25CF in scene</span>' : '') + '</div>'
        + '<div class="codex-dossier-meta">' + xss(g.world) + ' \u00b7 ' + g.source + ' \u00b7 ' + ((g.aliases || []).join(', ') || 'no aliases') + '</div>'

        // ── Identity (collapsible)
        + '<div class="codex-collapsible">'
        + '<div class="codex-collapsible-header" data-section="identity"><i class="fa-solid fa-chevron-down"></i> IDENTITY</div>'
        + '<div class="codex-collapsible-body">'
        + '<div class="codex-dossier-section"><div class="codex-dossier-label">ARCHETYPE</div><div class="codex-dossier-value">' + xss(g.archetype || 'Not set') + '</div></div>'
        + '<div class="codex-dossier-section"><div class="codex-dossier-label">EMOTIONAL CORE</div><div class="codex-dossier-value codex-val-hiding">' + xss(g.emotionalCore || 'Not set') + '</div></div>'
        + '<div class="codex-dossier-section"><div class="codex-dossier-label">CORE TRAITS</div><div>' + ((g.coreTraits || []).map(t => '<span class="codex-trait codex-trait-active">' + xss(t) + '</span>').join('') || 'none') + '</div></div>'
        + (habits ? '<div class="codex-dossier-section"><div class="codex-dossier-label">HABITS</div><div class="codex-pills">' + habits + '</div></div>' : '')
        + (manners ? '<div class="codex-dossier-section"><div class="codex-dossier-label">MANNERISMS</div><div class="codex-pills">' + manners + '</div></div>' : '')
        + '</div></div>'

        // ── Current State (collapsible, open by default)
        + '<div class="codex-collapsible">'
        + '<div class="codex-collapsible-header codex-section-open" data-section="state"><i class="fa-solid fa-chevron-down"></i> CURRENT STATE</div>'
        + '<div class="codex-collapsible-body">'
        + '<div class="codex-dossier-section"><div class="codex-dossier-label">MOOD</div><div class="codex-dossier-value"><b>' + xss(state.currentMood || '?') + '</b></div></div>'
        + (traj ? '<div class="codex-dossier-section"><div class="codex-dossier-label">TRAJECTORY</div><div class="codex-dossier-value codex-trajectory">' + xss(traj) + '</div></div>' : '')
        + '<div class="codex-dossier-section"><div class="codex-dossier-label">GOAL</div><div>' + xss(state.activeGoal || 'none') + '</div></div>'
        + '<div class="codex-dossier-section"><div class="codex-dossier-label">STANCE</div><div>' + xss(state.stance || 'neutral') + '</div></div>'
        + '<div class="codex-dossier-section"><div class="codex-dossier-label">HIDING</div><div class="codex-val-hiding">' + xss(state.hiding || 'nothing') + '</div></div>'
        + (traits || dormant ? '<div class="codex-dossier-section"><div class="codex-dossier-label">TRAITS</div><div>' + traits + ' ' + dormant + '</div></div>' : '')
        + (state.directive ? '<div class="codex-dossier-section"><div class="codex-dossier-label">DIRECTIVE</div><div class="codex-char-directive">' + xss(state.directive) + '</div></div>' : '')
        + '</div></div>'

        // ── Secrets (collapsible)
        + '<div class="codex-collapsible">'
        + '<div class="codex-collapsible-header" data-section="secrets"><i class="fa-solid fa-chevron-right"></i> SECRETS <span class="codex-section-count">' + secCount + '</span></div>'
        + '<div class="codex-collapsible-body" style="display:none;">'
        + secretsHtml
        + '</div></div>'

        // ── Relationships (collapsible)
        + '<div class="codex-collapsible">'
        + '<div class="codex-collapsible-header" data-section="rels"><i class="fa-solid fa-chevron-right"></i> RELATIONSHIPS <span class="codex-section-count">' + relCount + '</span></div>'
        + '<div class="codex-collapsible-body" style="display:none;">'
        + relsHtml
        + '</div></div>'

        // ── Voice (collapsible)
        + '<div class="codex-collapsible">'
        + '<div class="codex-collapsible-header" data-section="voice"><i class="fa-solid fa-chevron-right"></i> VOICE</div>'
        + '<div class="codex-collapsible-body" style="display:none;">'
        + voiceHtml
        + '</div></div>'

        // ── Journal (collapsible)
        + '<div class="codex-collapsible">'
        + '<div class="codex-collapsible-header" data-section="journal"><i class="fa-solid fa-chevron-right"></i> JOURNAL <span class="codex-section-count">' + journalCount + '</span></div>'
        + '<div class="codex-collapsible-body" style="display:none;">'
        + journalHtml
        + '</div></div>'

        // ── Actions (always visible)
        + '<div class="codex-dossier-divider"></div>'
        + '<div class="codex-dossier-actions">'
        + '<button class="codex-btn codex-btn-primary codex-dossier-autopsy" data-id="' + xss(charId) + '"><i class="fa-solid fa-microscope"></i> Autopsy</button>'
        + '<button class="codex-btn codex-btn-primary codex-dossier-collab" data-id="' + xss(charId) + '"><i class="fa-solid fa-handshake"></i> Collab</button>'
        + '<button class="codex-btn codex-dossier-edit" data-id="' + xss(charId) + '"><i class="fa-solid fa-pen"></i> Edit</button>'
        + '<button class="codex-btn codex-btn-danger codex-char-delete" data-id="' + xss(charId) + '"><i class="fa-solid fa-trash"></i> Delete</button>'
        + '</div>'
        + '<div class="codex-collab-form" data-id="' + xss(charId) + '" style="display:none;"><textarea class="codex-input" id="codex-collab-hints" rows="4" placeholder="Your notes about this character..."></textarea><button class="codex-expand-btn codex-icon-btn" data-target="#codex-collab-hints" data-label="Collab Notes" title="Expand"><i class="fa-solid fa-expand"></i></button><button class="codex-btn codex-btn-primary codex-collab-go" data-id="' + xss(charId) + '">Generate</button></div>'
        + '<div class="codex-edit-form" data-id="' + xss(charId) + '" style="display:none;"><label class="codex-edit-label">World</label><input class="codex-input codex-ef-world" value="' + xss(g.world || '') + '"/><label class="codex-edit-label">Aliases</label><input class="codex-input codex-ef-aliases" value="' + xss((g.aliases || []).join(', ')) + '"/><label class="codex-edit-label">Archetype</label><input class="codex-input codex-ef-archetype" value="' + xss(g.archetype || '') + '"/><label class="codex-edit-label">Emotional Core</label><input class="codex-input codex-ef-ecore" value="' + xss(g.emotionalCore || '') + '"/><label class="codex-edit-label">Core Traits</label><input class="codex-input codex-ef-ctraits" value="' + xss((g.coreTraits || []).join(', ')) + '"/><label class="codex-edit-label">Growth</label><select class="codex-input codex-ef-growth"><option value="locked"' + (g.growthPermission === 'locked' ? ' selected' : '') + '>Locked</option><option value="drift"' + (g.growthPermission === 'drift' ? ' selected' : '') + '>Drift</option><option value="transform"' + (g.growthPermission === 'transform' ? ' selected' : '') + '>Transform</option></select><button class="codex-btn codex-btn-primary codex-edit-save" data-id="' + xss(charId) + '">Save</button></div>'
        + '</div>';

    $('#codex-dossier-content').html(h);
}

// ═══ RENDER: RELS, HISTORY, SETTINGS ═══

function renderRels() {
    const chat = getChat(), s = getSettings();
    const activeIds = chat.activeCharacters || [];
    
    // Determine active worlds from active characters
    const activeWorlds = new Set();
    for (const id of activeIds) {
        const g = s.characters[id];
        if (g?.world) activeWorlds.add(g.world);
    }
    
    // Build world filter dropdown
    const allWorlds = [...new Set(Object.values(s.characters).map(c => c.world).filter(Boolean))];
    const filterWorld = $('#codex-rel-filter').val() || 'active';
    
    let filterHtml = '<div class="codex-rel-filter-row"><select id="codex-rel-filter" class="codex-input" style="font-size:11px;padding:4px 6px;"><option value="active">Active worlds only</option><option value="all">All worlds</option>';
    for (const w of allWorlds) filterHtml += '<option value="' + xss(w) + '">' + xss(w) + '</option>';
    filterHtml += '</select></div>';
    
    // Filter characters by selected world scope
    let chars;
    if (filterWorld === 'all') {
        chars = getAllGlobal();
    } else if (filterWorld === 'active') {
        chars = getAllGlobal().filter(c => activeWorlds.has(c.world) || activeIds.includes(c.id));
    } else {
        chars = getAllGlobal().filter(c => c.world === filterWorld);
    }
    
    const rels = [];
    for (const g of chars) {
        const st = getChatStateFor(g.id);
        for (const [n, r] of Object.entries(st.relationships || {})) {
            rels.push({ from: g.name, to: n, stance: r.stance, tension: r.tension, world: g.world });
        }
    }
    
    if (!rels.length) {
        $('#codex-rel-list').html(filterHtml + '<div class="codex-empty">' + (filterWorld === 'active' && !activeIds.length ? 'No active characters. Start a scene first.' : 'No relationships in this scope.') + '</div>');
        return;
    }
    
    $('#codex-rel-list').html(filterHtml + rels.map(r => {
        const p = (r.tension / 10) * 100, c = r.tension > 7 ? '#c45c5c' : r.tension > 4 ? '#b8a460' : '#7a9e7e';
        return '<div class="codex-rel-card"><b>' + xss(r.from) + '</b> \u2192 <b>' + xss(r.to) + '</b>: ' + xss(r.stance) + '<div class="codex-tension-bar"><div class="codex-tension-fill" style="width:' + p + '%;background:' + c + ';"></div></div></div>';
    }).join(''));
}

function renderHistory() {
    const h = getChat().characterHistory || [];
    if (!h.length) { $('#codex-history-list').html('<div class="codex-empty">None.</div>'); return; }
    $('#codex-history-list').html([...h].reverse().slice(0, 80).map(e => { const t = new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); return '<div class="codex-history-entry"><span class="codex-hist-time">' + t + '</span> <b>' + xss(e.characterName) + '</b> ' + xss(e.field) + ': <span class="codex-hist-old">' + xss(e.oldValue) + '</span> \u2192 <span class="codex-hist-new">' + xss(e.newValue) + '</span></div>'; }).join(''));
}

function renderSettings() {
    const s = getSettings(), ctx = getContext();
    $('#codex-s-enabled').prop('checked', s.enabled);
    $('input[name="codex-update"][value="' + s.updateMode + '"]').prop('checked', true);
    $('input[name="codex-detect"][value="' + s.sceneDetection + '"]').prop('checked', true);
    $('#codex-s-max').val(s.maxSimultaneousUpdates); $('#codex-max-val').text(s.maxSimultaneousUpdates);
    $('#codex-s-depth').val(s.injectionDepth); $('#codex-depth-val').text(s.injectionDepth);
    $('#codex-s-rels').prop('checked', s.injectRelationships); $('#codex-s-lexicon').prop('checked', s.useLexicon);
    const $p = $('#codex-s-profile').empty().append('<option value="current">Current</option>');
    (ctx?.extensionSettings?.connectionManager?.profiles || []).forEach(p => $p.append('<option value="' + p.name + '">' + p.name + '</option>'));
    $p.val(s.selectedProfile);
}

// ═══ EVENTS ═══

function bindEvents() {
    $('#codex-close').on('click', () => $('#codex-panel').fadeOut(150));
    $(document).on('click', '.codex-tab[data-tab]', function () { gotoTab($(this).data('tab')); });
    $('#codex-refresh').on('click', async () => {
        const blank = getAllGlobal().filter(c => c.core && !getChatStateFor(c.id).currentMood);
        if (blank.length) { toastr.info('Profiling ' + blank.length + '...', 'Codex'); for (const c of blank) await profileAutopsy(c.id); saveGlobal(); saveChatData(); }
        await runUpdate({ force: true }); renderCast();
    });
    $('#codex-import-lexicon').on('click', async () => { const w = ($('#codex-import-world').val() || '').trim() || undefined; const n = await importFromLexicon(w); if (n > 0) renderCast(); });
    $('#codex-import-cards').on('click', async () => { const w = ($('#codex-import-world').val() || '').trim() || undefined; const n = await importFromSTCards(w); if (n > 0) { populateCardPicker(); renderCast(); } });
    $('#codex-import-one-card').on('click', async () => {
        const name = $('#codex-card-picker').val();
        if (!name) { toastr.warning('Select a character first', 'Codex'); return; }
        const w = ($('#codex-import-world').val() || '').trim() || undefined;
        const n = await importSingleCard(name, w);
        if (n > 0) { populateCardPicker(); renderCast(); }
    });
    $('#codex-m-save').on('click', async () => {
        const name = $('#codex-m-name').val().trim(); if (!name) { toastr.warning('Name required'); return; }
        const s = getSettings(), ch = newGlobalCharacter(name, 'manual');
        ch.core = $('#codex-m-core').val().trim(); ch.world = $('#codex-m-world').val().trim() || 'Uncategorized';
        ch.aliases = ($('#codex-m-aliases').val() || '').split(',').map(a => a.trim()).filter(Boolean);
        if (!s.worlds.includes(ch.world)) s.worlds.push(ch.world);
        s.characters[ch.id] = ch; saveGlobal();
        if (ch.core) await profileAutopsy(ch.id);
        saveGlobal(); saveChatData(); $('#codex-m-name,#codex-m-core,#codex-m-world,#codex-m-aliases').val(''); gotoTab('cast');
    });
    // Settings
    $('#codex-s-enabled').on('change', function () { getSettings().enabled = this.checked; saveGlobal(); });
    $(document).on('change', 'input[name="codex-update"]', function () { getSettings().updateMode = this.value; saveGlobal(); });
    $(document).on('change', 'input[name="codex-detect"]', function () { getSettings().sceneDetection = this.value; saveGlobal(); });
    $('#codex-s-max').on('input', function () { getSettings().maxSimultaneousUpdates = parseInt(this.value); $('#codex-max-val').text(this.value); saveGlobal(); });
    $('#codex-s-depth').on('input', function () { getSettings().injectionDepth = parseInt(this.value); $('#codex-depth-val').text(this.value); saveGlobal(); });
    $('#codex-s-rels').on('change', function () { getSettings().injectRelationships = this.checked; saveGlobal(); });
    $('#codex-s-profile').on('change', function () { getSettings().selectedProfile = this.value; saveGlobal(); });
    $('#codex-s-lexicon').on('change', function () { getSettings().useLexicon = this.checked; saveGlobal(); });
    $('#codex-clear-all').on('click', () => { if (!confirm('Clear ALL?')) return; getSettings().characters = {}; getSettings().worlds = []; getChat().characterStates = {}; getChat().activeCharacters = []; getChat().manuallyPinned = []; saveGlobal(); saveChatData(); renderCast(); });
    $('#codex-history-clear').on('click', () => { getChat().characterHistory = []; saveChatData(); renderHistory(); });
    $(document).on('change', '#codex-rel-filter', () => renderRels());
    // Cast
    $(document).on('click', '.codex-cast-card', function (e) { if ($(e.target).closest('.codex-icon-btn').length) return; openDossier($(this).data('id')); });
    $(document).on('click', '.codex-char-toggle', function (e) { e.stopPropagation(); const id = $(this).data('id'), c = getChat(); if (!Array.isArray(c.manuallyPinned)) c.manuallyPinned = []; if (c.activeCharacters.includes(id)) { c.activeCharacters = c.activeCharacters.filter(i => i !== id); c.manuallyPinned = c.manuallyPinned.filter(i => i !== id); } else { c.activeCharacters.push(id); if (!c.manuallyPinned.includes(id)) c.manuallyPinned.push(id); } saveChatData(); renderCast(); });
    $(document).on('click', '.codex-world-header', function (e) { if ($(e.target).closest('.codex-world-rename').length) return; const w = $(this).data('world'), s = getSettings(); if (s.collapsedWorlds.includes(w)) s.collapsedWorlds = s.collapsedWorlds.filter(x => x !== w); else s.collapsedWorlds.push(w); saveGlobal(); renderCast(); });
    $(document).on('click', '.codex-world-rename', function (e) {
        e.stopPropagation();
        const oldWorld = $(this).data('world');
        const newWorld = prompt('Rename "' + oldWorld + '" to:', oldWorld);
        if (!newWorld || newWorld.trim() === '' || newWorld.trim() === oldWorld) return;
        const name = newWorld.trim(), s = getSettings();
        for (const ch of Object.values(s.characters)) { if (ch.world === oldWorld) ch.world = name; }
        s.worlds = s.worlds.map(w => w === oldWorld ? name : w);
        if (s.collapsedWorlds.includes(oldWorld)) s.collapsedWorlds = s.collapsedWorlds.map(w => w === oldWorld ? name : w);
        saveGlobal(); toastr.success('Renamed to ' + name, 'Codex'); renderCast();
    });
    // Dossier
    $(document).on('click', '#codex-dossier-back', () => gotoTab('cast'));
    $(document).on('click', '.codex-collapsible-header', function () {
        const body = $(this).next('.codex-collapsible-body');
        const icon = $(this).find('i');
        body.slideToggle(150);
        icon.toggleClass('fa-chevron-down fa-chevron-right');
    });
    $(document).on('click', '.codex-dossier-autopsy', async function () { await profileAutopsy($(this).data('id')); renderDossier($(this).data('id')); });
    $(document).on('click', '.codex-dossier-collab', function () { $('.codex-collab-form[data-id="' + $(this).data('id') + '"]').slideToggle(150); });
    $(document).on('click', '.codex-collab-go', async function () { const id = $(this).data('id'), hints = $('#codex-collab-hints').val().trim(); if (!hints) { toastr.warning('Write hints first'); return; } await profileCollab(id, hints); renderDossier(id); });
    $(document).on('click', '.codex-dossier-edit', function () { $('.codex-edit-form[data-id="' + $(this).data('id') + '"]').slideToggle(150); });
    $(document).on('click', '.codex-edit-save', function () {
        const id = $(this).data('id'), s = getSettings(), g = s.characters[id]; if (!g) return;
        const form = $('.codex-edit-form[data-id="' + id + '"]');
        g.world = form.find('.codex-ef-world').val().trim() || 'Uncategorized';
        g.aliases = form.find('.codex-ef-aliases').val().split(',').map(a => a.trim()).filter(Boolean);
        g.archetype = form.find('.codex-ef-archetype').val().trim();
        g.emotionalCore = form.find('.codex-ef-ecore').val().trim();
        g.coreTraits = form.find('.codex-ef-ctraits').val().split(',').map(t => t.trim()).filter(Boolean);
        g.growthPermission = form.find('.codex-ef-growth').val();
        // v3: Voice + Journal
        if (!g.voiceProfile) g.voiceProfile = {};
        const vReg = form.find('.codex-ef-vregister').val().trim();
        const vCad = form.find('.codex-ef-vcadence').val().trim();
        if (vReg) g.voiceProfile.register = vReg;
        if (vCad) g.voiceProfile.sampleCadence = vCad;
        g.journalFormat = form.find('.codex-ef-jformat').val() || '';
        if (!s.worlds.includes(g.world)) s.worlds.push(g.world);
        s.worlds = s.worlds.filter(w => Object.values(s.characters).some(c => c.world === w));
        saveGlobal(); toastr.success(g.name + ' updated', 'Codex'); renderDossier(id);
    });
    $(document).on('click', '.codex-char-delete', function () { const id = $(this).data('id'); if (!confirm('Delete?')) return; delete getSettings().characters[id]; delete getChat().characterStates[id]; const c = getChat(); c.activeCharacters = c.activeCharacters.filter(i => i !== id); c.manuallyPinned = c.manuallyPinned.filter(i => i !== id); saveGlobal(); saveChatData(); if (currentDossier === id) gotoTab('cast'); else renderCast(); });
    document.addEventListener('codex:updated', () => { if ($('#codex-pane-cast').is(':visible')) renderCast(); if (currentDossier) renderDossier(currentDossier); });
}

// ═══ EXT SETTINGS + INIT ═══

function addExtPanel() {
    const s = getSettings();
    $('#extensions_settings2').append('<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>\uD83D\uDCD6 ' + EXT_NAME + '</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content"><label class="checkbox_label"><input type="checkbox" id="codex-master-toggle" ' + (s.enabled ? 'checked' : '') + '/><span>Enable Codex</span></label></div></div>');
    $('#codex-master-toggle').on('change', function () { getSettings().enabled = this.checked; saveGlobal(); if (this.checked) { createFAB(); createPanel(); createExpandOverlay(); registerAPI(); } else { try { setExtensionPrompt(INJECT_KEY, '', 1, 0, false); } catch {} $('#codex-fab,#codex-panel').remove(); } });
}

jQuery(async () => {
    try {
        console.log('[Codex] v' + EXT_VERSION + ' init');
        getSettings(); migrateData();
        try { addExtPanel(); } catch (e) { console.warn('[Codex]', e); }
        if (!getSettings().enabled) return;
        createFAB(); createPanel(); createExpandOverlay();
        if (getContext()?.chat?.length > 0) getChat();
        eventSource.on(event_types.MESSAGE_RECEIVED, async () => { if (getSettings().enabled && shouldUpdate()) await runUpdate(); });
        eventSource.on(event_types.CHAT_CHANGED, () => { getChat(); if (getSettings().enabled && shouldUpdate()) setTimeout(() => runUpdate(), 500); });
        registerAPI();
        console.log('[Codex] v' + EXT_VERSION + ' ready');
        toastr.success(EXT_NAME + ' v' + EXT_VERSION, '', { timeOut: 2000 });
    } catch (e) { console.error('[Codex]', e); toastr.error('Codex: ' + e.message); }
});
