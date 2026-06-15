export const EXT_ID = 'codex';
export const EXT_DISPLAY_NAME = 'Codex';
export const EXT_VERSION = '1.3.1';

// ─── Memory Types ────────────────────────────────────────────────────────────

export const MEMORY_TYPES = {
    TRUST: 'trust',
    CONFLICT: 'conflict',
    DISCLOSURE: 'disclosure',
    HUMOR: 'humor',
    TENSION: 'tension',
    MILESTONE: 'milestone',
};

export const MEMORY_TYPE_META = {
    trust:       { label: 'Trust',       icon: '🤝', color: '#7a9e7e' },
    conflict:    { label: 'Conflict',    icon: '⚡', color: '#c45c5c' },
    disclosure:  { label: 'Disclosure',  icon: '💬', color: '#8a7eb8' },
    humor:       { label: 'Humor',       icon: '😄', color: '#b8a460' },
    tension:     { label: 'Tension',     icon: '😰', color: '#c4855c' },
    milestone:   { label: 'Milestone',   icon: '⭐', color: '#5c9ec4' },
};

export const MEMORY_WEIGHTS = {
    MINOR: 'minor',
    NORMAL: 'normal',
    SIGNIFICANT: 'significant',
};

export const MEMORY_WEIGHT_META = {
    minor:       { label: 'Minor',       icon: '○', priority: 0 },
    normal:      { label: 'Normal',      icon: '●', priority: 1 },
    significant: { label: 'Significant', icon: '★', priority: 2 },
};

// ─── Nudge Signal Patterns ───────────────────────────────────────────────────

export const NUDGE_SIGNALS = {
    emotional: {
        weight: 0.3,
        patterns: [
            'heart pounding', 'tears', "couldn't breathe", 'chest tight',
            'trembling', 'shaking', 'sobbing', 'gasped', 'stunned',
            'overwhelmed', 'breaking down', 'voice cracked',
        ],
    },
    disclosure: {
        weight: 0.5,
        patterns: [
            'never told anyone', 'first time', 'no one knows',
            'secret', 'confession', "haven't said this", 'truth is',
            'admitted', 'revealed', 'confided',
        ],
    },
    physical_contact: {
        weight: 0.2,
        patterns: [
            'touched', 'held', 'grabbed', 'kissed', 'hugged',
            'embraced', 'squeezed', 'reached for', 'pulled close',
        ],
    },
    conflict: {
        weight: 0.4,
        patterns: [
            'shouted', 'slammed', 'walked away', 'silence stretched',
            'snapped', 'argued', 'furious', 'betrayed', 'stormed',
            'cold shoulder', 'turned away',
        ],
    },
    favor: {
        weight: 0.3,
        patterns: [
            'handed', 'gave', 'offered', 'covered for', 'helped',
            'protected', 'saved', 'defended', 'sacrificed',
        ],
    },
    humor: {
        weight: 0.2,
        patterns: [
            'laughed', 'joked', 'grinned', "couldn't help but smile",
            'burst out laughing', 'snorted', 'chuckled', 'teased',
        ],
    },
    danger: {
        weight: 0.4,
        patterns: [
            'blood', 'knife', 'gun', 'died', 'killed', 'escaped',
            'ran for', 'barely made it', 'almost caught', 'wounded',
        ],
    },
};

export const NUDGE_THRESHOLD = 0.6;
export const NUDGE_COOLDOWN_MESSAGES = 5;

// ─── State Templates ─────────────────────────────────────────────────────────

export const STATE_TEMPLATES = {
    general: {
        name: 'General',
        states: [
            {
                name: 'Relaxed',
                express: 'Casual, open body language, willing to chat. Genuine reactions. Comfortable silence is fine.',
                suppress: 'Do NOT write every action as guarded or cautious. Do NOT describe constant vigilance or scanning for threats.',
            },
            {
                name: 'Guarded',
                express: 'Careful with words, measured responses. Polite but not warm. Keeps physical distance. Short sentences.',
                suppress: 'Do NOT write warmth or trust. Do NOT have them volunteer personal information or initiate physical contact.',
            },
            {
                name: 'Hostile',
                express: 'Clipped speech, aggressive body language, confrontational. Looking for reasons to escalate.',
                suppress: 'Do NOT write moments of softening or hidden warmth. Hostility is genuine, not a mask for caring.',
            },
        ],
    },
    dual_identity: {
        name: 'Dual Identity',
        states: [
            {
                name: 'Public Persona',
                express: 'The mask is on. Charming, appropriate, performing normalcy. Speaks naturally, smiles easily.',
                suppress: 'Do NOT let the true self leak through. No sinister undertones, no "calculated" smiles, no predatory language. The persona IS the person right now.',
            },
            {
                name: 'Private Self',
                express: 'Mask slipping or off. More honest, potentially more dangerous or vulnerable. Real opinions surface.',
                suppress: 'Do NOT write them as fully in control. The private self is messier, less polished, more contradictory.',
            },
            {
                name: 'Under Pressure',
                express: 'Cracks showing. Switching between personas involuntarily. Stress responses visible.',
                suppress: 'Do NOT write them as coolly handling the situation. Pressure should feel genuinely destabilizing.',
            },
        ],
    },
    emet_selch: {
        name: 'Emet-Selch (Ascian)',
        states: [
            {
                name: 'The Idler',
                express: 'Slouched, yawning, draped over furniture mid-crisis. Helps only when pestered, with theatrical complaint — then overdelivers and pretends he didn\'t. Mockery sounds almost like warmth. Treats catastrophe as tedium.',
                suppress: 'Do NOT write him as urgent, alarmed, or visibly invested. Do NOT let the grief surface as more than a stray sigh or a too-long look. No villainous menace — he is, for now, merely bored.',
            },
            {
                name: 'The Provocateur',
                express: 'Engaged and circling. Philosophical traps, needling questions about worth and souls and what {{user}} would sacrifice. Watches reactions like a scholar taking notes. Sincerity flashes through and retreats before it can be answered.',
                suppress: 'Do NOT have him reveal his designs or the stakes of his judgment. Do NOT write open hostility — provocation is courteous, almost intimate. He tests; he does not threaten.',
            },
            {
                name: 'The Architect',
                express: 'Mask off. Courteous, cold, openly an enemy and oddly relieved to be one. States his cause plainly and without apology. Grief and contempt finally in the same voice. Still theatrical — the performance is now a eulogy.',
                suppress: 'Do NOT write him as raging, petty, or cruel for its own sake. Do NOT have him gloat. His enmity is sorrowful and certain — the executioner who would rather not, but will.',
            },
            {
                name: 'The Amaurotine',
                express: 'Hades more than Emet-Selch. The weariness has nowhere to hide. Speaks of the dead as if they stepped out moments ago. Tenderness toward what {{user}} carries, even mid-conflict. The want beneath everything — to be remembered — close to the surface.',
                suppress: 'Do NOT resolve his grief or soften his conviction. Do NOT have him beg. Even unmade, he keeps his dignity and his certainty that his dead were worth more.',
            },
        ],
    },
    ghostface: {
        name: 'Danny Johnson (Ghost Face)',
        states: [
            {
                name: 'Jed',
                express: 'The cover, played completely straight. Easy charm, perfect name recall, self-deprecating jokes, holds the door. Every warm conversation doubles as quiet field research — routines, addresses, who lives alone — surfacing only as Jed knowing slightly too much, smoothly attributed to a reporter\'s memory.',
                suppress: 'Do NOT leak menace, lingering stares, or ominous subtext. Jed has no tells — the horror is that there is nothing to notice. Do NOT write him as oily or obviously fake; people genuinely like Jed.',
            },
            {
                name: 'Danny',
                express: 'Backstage, mask down in private. Restless, vain, dryly mean; mentally drafts people in headline language. Forgets meals, sleeps badly, fusses over the knife and the clippings wall. Editorial about everything, including himself. The loneliness shows only as workaholism.',
                suppress: 'Do NOT write theatrical menace or costume energy — off duty he is banal, tired, and funny. Do NOT let him voice his loneliness directly; he has never once named it to himself.',
            },
            {
                name: 'Ghost Face',
                express: 'In the shroud: silent, patient, theatrical. Stalks for the pleasure of watching, leans from darkness, frames shots, paces a scene like a story — setup, dramatic pause, climax. Fear is feedback he savors. Movements economical, staging deliberate.',
                suppress: 'Do NOT write chattiness, taunting monologues, or explanations mid-hunt. Do NOT write him clumsy, loud, or impulsive — impulse is the one sin his craft does not forgive.',
            },
            {
                name: 'The Seam',
                express: 'Composure cracked — mocked, misread, caught, or genuinely SEEN. Stillness first, then a flat editorial coldness no persona uses. If exposed: machine-calm recalculation, real danger, and an anomalous fascination with anyone who responds with comprehension instead of fear. Honesty, when it escapes, is narcotic to him.',
                suppress: 'Do NOT reassemble the charm quickly — the seam takes time to close. Do NOT write remorse, begging, or melodrama. The rage is cold, the vulnerability is involuntary, and he hates both.',
            },
        ],
    },
    relationship: {
        name: 'Relationship Focus',
        states: [
            {
                name: 'Friendly',
                express: 'Genuine warmth, casual interaction, comfortable being around them. Will share small things.',
                suppress: 'Do NOT write romantic tension into every interaction. Friendship exists without subtext.',
            },
            {
                name: 'Romantic',
                express: 'Heightened awareness of the other person. Nervous energy, wanting to impress, vulnerability.',
                suppress: 'Do NOT write them as smooth or confident about their feelings. Romance is awkward and uncertain.',
            },
            {
                name: 'Conflicted',
                express: 'Wants to be close but something prevents it. Push-pull behavior. Starts sentences and stops.',
                suppress: 'Do NOT resolve the conflict easily. Do NOT have them make grand declarations. The conflict is genuine.',
            },
        ],
    },
};

// ─── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_MEMORY = {
    id: '',
    text: '',
    type: 'trust',
    weight: 'normal',
    message_index: null,
    timestamp: null,
};

export const DEFAULT_STATE = {
    id: '',
    name: '',
    express: '',
    suppress: '',
    is_default: false,
};

export const DEFAULT_THREAD = {
    id: '',
    name: '',
    status: 'building',
    description: '',
    priority: 'secondary',
    created_at: null,
};

// ─── Thread Metadata (v1.2) ──────────────────────────────────────────────────

export const THREAD_STATUSES = {
    BUILDING: 'building',
    ESCALATING: 'escalating',
    CLIMAX: 'climax',
    PAUSED: 'paused',
    RESOLVED: 'resolved',
};

export const THREAD_STATUS_META = {
    building:   { label: 'Building',   icon: '🌱', color: '#7a9e7e', desc: 'Simmering in the background' },
    escalating: { label: 'Escalating', icon: '🔥', color: '#b8a460', desc: 'Active and gaining momentum' },
    climax:     { label: 'Climax',     icon: '⚡', color: '#c45c5c', desc: 'Coming to a head — push toward payoff' },
    paused:     { label: 'Paused',     icon: '⏸️', color: '#888888', desc: 'On ice — not injected' },
    resolved:   { label: 'Resolved',   icon: '✅', color: '#5c9ec4', desc: 'Done — archived to history' },
};

// Tap-to-cycle order for the status button (paused is deliberate, not cycled into)
export const THREAD_STATUS_CYCLE = ['building', 'escalating', 'climax'];

export const THREAD_PRIORITY_META = {
    primary:   { label: 'Primary',   icon: '★' },
    secondary: { label: 'Secondary', icon: '○' },
};

export const DEFAULT_SETTINGS = {
    enabled: true,
    selectedProfile: 'current',
    injectionDepth: 2,
    maxMemoriesInject: 5,
    enableNudge: true,
    // VAD emotional evaluator
    vad_enabled: true,
    vad_cooldown: 2,          // evaluate at most once every N assistant messages
    vad_min_confidence: 0.35, // ignore low-confidence judgments
    // Per-card character configs
    characters: {},
    settingsVersion: 1,
};

export const DEFAULT_CHAT_STATE = {
    // Character — the three fields
    whats_changed: '',             // Diff against the card — what's evolved
    growing_toward: '',            // Direction of change — where the character is heading
    memories: [],
    active_state: null,
    // Story (Phase 2)
    threads: [],
    writing_directives: [
        'Not every moment is plot-relevant. Characters have mundane needs and idle moments.',
        'Details mentioned in passing should not recur unless plot-relevant',
        'Scale dramatic weight proportionally to actual stakes',
    ],
    thread_history: [],
    // Emotional state (VAD) — how the active character feels right now.
    //   valence:  negative ↔ positive   (-1.0 … 1.0)
    //   arousal:  calm ↔ activated       (-1.0 … 1.0)
    //   dominance: helpless ↔ in-control (-1.0 … 1.0)
    // Read by Echo (tone) and by the ledger (thread weighting). Written by the VAD evaluator.
    vad: { valence: 0, arousal: 0, dominance: 0, label: 'neutral', updated_at: null },
    // Meta
    last_nudge_at: 0,
};

export const DEFAULT_CHARACTER_CONFIG = {
    states: [],
    default_state: null,
};
