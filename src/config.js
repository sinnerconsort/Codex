export const EXT_ID = 'codex';
export const EXT_DISPLAY_NAME = 'Codex';
export const EXT_VERSION = '1.0.0';

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

export const DEFAULT_SETTINGS = {
    enabled: true,
    selectedProfile: 'current',
    injectionDepth: 2,
    maxMemoriesInject: 5,
    enableNudge: true,
    relationshipAutoGen: true,
    // Per-card character configs
    characters: {},
    settingsVersion: 1,
};

export const DEFAULT_CHAT_STATE = {
    // Character — the three fields
    whats_changed: '',             // Diff against the card — what's evolved
    growing_toward: '',            // Direction of change — where the character is heading
    memories: [],
    // Legacy / power-user
    relationship_summary: '',
    relationship_auto: true,
    active_state: null,
    // Story (Phase 2)
    threads: [],
    writing_directives: [
        'Not every moment is plot-relevant. Characters have mundane needs and idle moments.',
        'Details mentioned in passing should not recur unless plot-relevant',
        'Scale dramatic weight proportionally to actual stakes',
    ],
    thread_history: [],
    // Game mode (Phase 3)
    game_mode: false,
    meters: { affinity: 50, tension: 15, standing: 30, wildcard: null },
    flags: {},
    route: { name: null, locked: false, phase: 1, candidates: [] },
    choice_tree: [],
    tag_history: {},
    // Meta
    last_nudge_at: 0,
};

export const DEFAULT_CHARACTER_CONFIG = {
    states: [],
    default_state: null,
};
