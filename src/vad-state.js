// Codex — VAD → Face Resolver
// ──────────────────────────────────────────────────────────────────────────────
// The last writer of the active-state slot, and the most cautious. Reads the
// settled VAD and picks the behavioral FACE that best fits it. STICKY by design:
// it holds the current face and only swaps when a rival CLEARLY wins (margin) and
// a dwell floor has passed — so a multi-faceted character (Danny vs Jed) can
// shift when the emotional weather really changes, but won't flicker on noise.
//
// Driver discipline (the whole point of the face/era split):
//   • Only ever touches FACE states. ERA-organized characters → stands down.
//   • Never stomps an active Seam hold (the reveal/crack path owns the slot then).
//   • Defers a turn whenever ANY other hand moved the slot (manual tap, era sync,
//     seam restore) — that external choice gets room to breathe before VAD weighs in.
//
// VAD axes are integers in [-2, 2] (see vad-evaluator clampAxis), moving ±1 per
// evaluation with a cooldown — already slow. Leans are coarse signs, so matching
// is robust to the one-step wobble. This function is the only place VAD → mode.

import { getContext } from '../../../../extensions.js';
import { getChatState, getSettings, saveChatData } from './state.js';
import { getActiveState, getFaceStates, setActiveState } from './states.js';
import { STATE_KINDS, LEAN_SIGNS } from './config.js';

// Conservative defaults — sticky, reluctant to swap. Overridable via settings
// (panel exposes these later); read with ?? so they work before that exists.
const DEF_NEUTRAL_BAND = 0;   // |v| <= band → neutral; beyond → signed
const DEF_SWAP_MARGIN  = 1;   // rival must beat the held face by >= this (1 = a
                              //   single decisive axis; dwell is the flicker guard)
const DEF_MIN_DWELL    = 2;   // min messages on a face before VAD may move it
const DEF_MIN_ADOPT    = 1;   // when no face is active, adopt only on real evidence

// ─── pure scoring (exported for testing) ──────────────────────────────────────

export function classifySign(v, band = 0) {
    const n = Number(v) || 0;
    if (n > band) return LEAN_SIGNS.POS;
    if (n < -band) return LEAN_SIGNS.NEG;
    return LEAN_SIGNS.NEUTRAL;
}

// +1 aligned, -1 directly opposed (pos vs neg), 0 for any neutral/any combo.
// 'any' axes are ignored entirely; a neutral VAD axis exerts no pull either way.
export function scoreFace(face, vadSigns) {
    const lean = (face && face.lean) || {};
    let score = 0;
    for (const axis of ['valence', 'arousal', 'dominance']) {
        const want = lean[axis];
        if (!want || want === LEAN_SIGNS.ANY) continue;
        const have = vadSigns[axis];
        if (want === have) { score += 1; continue; }
        const opposed =
            (want === LEAN_SIGNS.POS && have === LEAN_SIGNS.NEG) ||
            (want === LEAN_SIGNS.NEG && have === LEAN_SIGNS.POS);
        if (opposed) score -= 1;
        // anything involving NEUTRAL on either side (and not equal) → 0
    }
    return score;
}

// Score all faces against current VAD; report the best plus the held face's score.
export function evaluateFaces(faces, vad, currentId, band = 0) {
    const vadSigns = {
        valence:   classifySign(vad?.valence, band),
        arousal:   classifySign(vad?.arousal, band),
        dominance: classifySign(vad?.dominance, band),
    };
    let bestFace = null, bestScore = -Infinity, curScore = -Infinity;
    for (const f of faces) {
        const s = scoreFace(f, vadSigns);
        if (f.id === currentId) curScore = s;
        if (s > bestScore) { bestScore = s; bestFace = f; }   // strict > → ties hold incumbent
    }
    return { bestFace, bestScore, curScore, vadSigns };
}

// ─── stateful resolver (called once per message from index.js) ────────────────

export function runFaceResolver() {
    try {
        const settings = getSettings();
        if (settings.enabled === false) return false;
        if (settings.face_auto === false) return false;          // per-feature toggle (default on)

        const faces = getFaceStates();
        if (faces.length < 2) return false;                      // nothing to choose between

        const cs = getChatState();

        // crack hold owns the slot — let the Seam linger its full duration
        if ((cs?._codexBridge?.seamHold || 0) > 0) return false;

        const cur = getActiveState();
        // era-organized character → resolver stands down entirely
        if (cur && cur.kind === STATE_KINDS.ERA) return false;

        const vad = cs.vad || { valence: 0, arousal: 0, dominance: 0 };
        const now = getContext()?.chat?.length ?? 0;
        const curId = cur?.id ?? null;

        // resolver memory: defer a turn whenever the slot changed by any other
        // hand (manual / era / seam) so that choice breathes before VAD weighs in
        if (!cs._codexFace || typeof cs._codexFace !== 'object') {
            cs._codexFace = { seenId: null, anchorLen: now };
        }
        const mem = cs._codexFace;
        if (mem.seenId !== curId) {
            mem.seenId = curId;
            mem.anchorLen = now;
            saveChatData();
            return false;
        }

        const band     = settings.face_neutral_band ?? DEF_NEUTRAL_BAND;
        const margin    = settings.face_swap_margin  ?? DEF_SWAP_MARGIN;
        const minDwell  = settings.face_min_dwell    ?? DEF_MIN_DWELL;
        const minAdopt  = settings.face_min_adopt    ?? DEF_MIN_ADOPT;

        const { bestFace, bestScore, curScore } = evaluateFaces(faces, vad, curId, band);
        if (!bestFace) return false;

        const swapTo = (id) => {
            setActiveState(id);
            mem.seenId = id;
            mem.anchorLen = now;
            saveChatData();
            return true;
        };

        // no FACE currently active (era/null) → adopt the best only on real evidence
        if (!cur || cur.kind !== STATE_KINDS.FACE) {
            return bestScore >= minAdopt ? swapTo(bestFace.id) : false;
        }

        // dwell floor — don't move a face that just took the slot
        if ((now - mem.anchorLen) < minDwell) return false;

        // sticky swap — a rival must CLEARLY beat the held face
        if (bestFace.id !== curId && (bestScore - curScore) >= margin) {
            return swapTo(bestFace.id);
        }

        return false;
    } catch (e) {
        console.warn('[Codex] face resolver failed:', e);
        return false;
    }
}
