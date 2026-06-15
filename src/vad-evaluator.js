/**
 * Codex — VAD Emotional Evaluator
 * First user of the evaluator pattern: a background judgment that reads the
 * recent scene and reports the focal character's emotional state on three
 * integer axes (-2…+2), moving in small steps and failing safe to no change.
 *
 * Transport mirrors the house idiom (Echo/Lexicon): a named Connection Profile
 * via ConnectionManagerRequestService when set, else generateRaw on the main
 * connection. Runs AFTER the AI message, so generateRaw doesn't collide.
 */
import { getContext } from '../../../../extensions.js';
import { generateRaw } from '../../../../../script.js';
import { getChatState, saveChatData, getSettings } from './state.js';

let inFlight = false;

// ─── Transport ───────────────────────────────────────────────────────────────

function resolveProfileId(name) {
    try {
        const cm = getContext()?.extensionSettings?.connectionManager;
        if (!cm) return null;
        const p = (cm.profiles || []).find(x => x.name === name || x.id === name);
        return p?.id || null;
    } catch { return null; }
}

async function callModel(prompt, maxTokens = 300) {
    const ctx = getContext();
    const profile = getSettings().selectedProfile;
    // A *named* profile → independent connection. 'current'/'fallback'/unset → main raw gen.
    if (ctx?.ConnectionManagerRequestService && profile && profile !== 'current' && profile !== 'fallback') {
        try {
            const profileId = resolveProfileId(profile);
            if (profileId) {
                const res = await ctx.ConnectionManagerRequestService.sendRequest(
                    profileId,
                    [{ role: 'user', content: prompt }],
                    maxTokens,
                    { extractData: true, includePreset: false, includeInstruct: false },
                    {}
                );
                if (res) return typeof res === 'string' ? res : (res.content ?? '');
            }
        } catch (e) {
            console.warn('[Codex/VAD] profile call failed; using main gen:', e?.message);
        }
    }
    return await generateRaw(prompt, null, false, false, '', maxTokens);
}

// ─── Prompt + parse ──────────────────────────────────────────────────────────

function buildPrompt(recentText, vad) {
    return `You are tracking the emotional state of the focal character in a roleplay, on three axes. Each axis is an INTEGER from -2 to +2.

Axes:
- valence:   -2 very negative … 0 neutral … +2 very positive
- arousal:   -2 very calm/low-energy … 0 neutral … +2 very activated/high-energy
- dominance: -2 helpless/controlled … 0 neutral … +2 fully in control

Current state: valence ${vad.valence}, arousal ${vad.arousal}, dominance ${vad.dominance} (${vad.label || 'neutral'}).

Read the recent messages and report the character's emotional state RIGHT NOW.
- If a real emotional beat occurred, at least one axis should change.
- If the scene is calm or nothing emotional happened, ease values gently toward 0.
- Move in small steps — no more than one beat justifies.
- Judge ONLY from what the prose shows. Do NOT infer from theme, tone words alone, or what might happen next.

Return ONLY valid JSON, no other text, no markdown:
{"valence": <int>, "arousal": <int>, "dominance": <int>, "label": "<one or two words>", "shifted": <true|false>, "confidence": <0.0-1.0>, "reason": "<brief; name the moment>"}

Recent messages:
${recentText}`;
}

function clampAxis(v) { return Math.max(-2, Math.min(2, Math.round(Number(v)))); }

function parse(raw) {
    try {
        const clean = String(raw).replace(/```json|```/g, '').trim();
        const match = clean.match(/\{[\s\S]*\}/);
        const d = JSON.parse(match ? match[0] : clean);
        if (![d.valence, d.arousal, d.dominance].every(v => Number.isFinite(Number(v)))) return null;
        return {
            valence: clampAxis(d.valence),
            arousal: clampAxis(d.arousal),
            dominance: clampAxis(d.dominance),
            label: (typeof d.label === 'string' && d.label.trim()) ? d.label.trim().slice(0, 24) : null,
            confidence: Number.isFinite(Number(d.confidence)) ? Number(d.confidence) : 0.5,
        };
    } catch {
        return null; // fail safe: no decision
    }
}

// Move at most one step toward the target so transitions stay gradual.
function step(cur, target) {
    return cur + Math.max(-1, Math.min(1, target - cur));
}

// ─── Main entry ──────────────────────────────────────────────────────────────

/**
 * Evaluate and update the chat's VAD state. Call once per assistant message
 * (gated by cooldown in the message handler). Fire-and-forget; self-guarded
 * against overlap. Marks the attempt up front so the cooldown holds even on
 * failure, and only moves axes on a confident, well-formed judgment.
 */
export async function runVadEvaluation(recentText, msgIndex) {
    const settings = getSettings();
    if (settings.vad_enabled === false) return;
    if (inFlight || !recentText || !recentText.trim()) return;
    inFlight = true;

    const state = getChatState();
    const vad = state.vad || { valence: 0, arousal: 0, dominance: 0, label: 'neutral', updated_at: null };

    // Mark the attempt now so the cooldown anchor moves even if the call throws.
    vad.updated_at = msgIndex;
    state.vad = vad;
    saveChatData();

    try {
        const raw = await callModel(buildPrompt(recentText, vad), 300);
        const d = parse(raw);
        if (!d) return;
        if (d.confidence < (settings.vad_min_confidence ?? 0.35)) return;

        state.vad = {
            valence: step(vad.valence, d.valence),
            arousal: step(vad.arousal, d.arousal),
            dominance: step(vad.dominance, d.dominance),
            label: d.label || vad.label || 'neutral',
            updated_at: msgIndex,
        };
        saveChatData();
    } catch (e) {
        console.warn('[Codex/VAD] evaluation failed:', e?.message);
    } finally {
        inFlight = false;
    }
}
