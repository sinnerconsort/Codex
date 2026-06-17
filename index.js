/**
 * Codex v1.3 — Character & Story Engine
 * Thin entry point — imports from src/ modules
 */
import {
    getContext,
    extension_settings,
} from '../../../extensions.js';

import {
    eventSource,
    event_types,
} from '../../../../script.js';

import { EXT_ID, EXT_DISPLAY_NAME, EXT_VERSION } from './src/config.js';
import { getSettings, sanitizeSettings, sanitizeChatState, loadChatData, getChatState } from './src/state.js';
import { buildAndInject, clearInjection } from './src/injection.js';
import { detectNudgeSignals, draftMemoryFromContext } from './src/memories.js';
import { initPanel, destroyPanel, showNudge } from './src/panel.js';
import { registerAPI, unregisterAPI } from './src/api.js';
import { maintainThreads, getThreads } from './src/threads.js';
import { runVadEvaluation } from './src/vad-evaluator.js';
import { runLexiconBridge } from './src/lexicon-bridge.js';
import { importCharacterStates, exportCharacterStates } from './src/state-import.js';

// ═══════════════════════════════════════════════════════════════════════════════
//  EXTENSION SETTINGS DRAWER
// ═══════════════════════════════════════════════════════════════════════════════

function addExtensionSettingsPanel() {
    const s = getSettings();
    const html = `
    <div class="inline-drawer" id="codex-ext-drawer">
      <div class="inline-drawer-toggle inline-drawer-header">
        <b>📋 ${EXT_DISPLAY_NAME} — Character & Story Engine</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
      </div>
      <div class="inline-drawer-content">
        <label class="checkbox_label">
          <input type="checkbox" id="codex-master-toggle" ${s.enabled ? 'checked' : ''} />
          <span>Enable Codex</span>
        </label>
        <p style="margin:6px 0 0;opacity:0.7;font-size:0.85em;line-height:1.4;">
          Codex tracks character memories, evolution, and behavioral modes.
          Open the 📋 button to manage character data.
        </p>
        <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
          <button class="menu_button" id="codex-import-states" title="Import behavioral states (JSON) for the loaded character">⬆ Import States</button>
          <button class="menu_button" id="codex-export-states" title="Export the loaded character's states to a JSON file">⬇ Export States</button>
          <input type="file" id="codex-import-states-file" accept=".json,application/json" style="display:none;" />
        </div>
        <p style="margin:4px 0 0;opacity:0.55;font-size:0.78em;line-height:1.35;">
          Import replaces the current character's modes (open their chat first).
        </p>
      </div>
    </div>`;

    $('#extensions_settings2').append(html);

    $('#codex-master-toggle').on('change', function () {
        const s = getSettings();
        s.enabled = this.checked;
        import('./src/state.js').then(m => m.saveSettings());
        if (s.enabled) {
            initPanel();
            loadChatData();
            sanitizeChatState();
            buildAndInject();
            registerAPI();
        } else {
            clearInjection();
            destroyPanel();
            unregisterAPI();
        }
    });

    // ── Import / Export states (portable JSON) ───────────────────────────────
    $('#codex-import-states').on('click', () => $('#codex-import-states-file').click());

    $('#codex-import-states-file').on('change', function () {
        const file = this.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const res = importCharacterStates(String(ev.target?.result || ''), 'replace');
            if (res.success) {
                buildAndInject();
                // NOTE: do NOT destroyPanel()/initPanel() here — re-running the panel's
                // bindEvents() double-binds its delegated document handlers (the panel
                // would then open and instantly close). togglePanel() re-renders on open,
                // so the new modes appear next time the panel is opened.
                toastr.success(
                    `Imported ${res.count} state${res.count === 1 ? '' : 's'}${res.name ? ` — ${res.name}` : ''}. Open the Codex panel ▸ Modes to see them.`,
                    'Codex'
                );
            } else {
                toastr.error(res.error || 'Import failed', 'Codex', { timeOut: 7000 });
            }
        };
        reader.readAsText(file);
        this.value = '';   // allow re-importing the same file
    });

    $('#codex-export-states').on('click', () => {
        try {
            const json = exportCharacterStates();
            const ctx = getContext();
            const safe = (ctx?.name2 || 'character').replace(/[^a-z0-9_-]+/gi, '_');
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${safe}.codex-states.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (e) {
            toastr.error(`Export failed: ${e.message}`, 'Codex', { timeOut: 7000 });
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MESSAGE HANDLER — Ledger upkeep + Nudge Detection
// ═══════════════════════════════════════════════════════════════════════════════

async function onMessageReceived() {
    const settings = getSettings();
    if (!settings.enabled) return;

    const ctx = getContext();
    const hasChat = !!ctx?.chat?.length;
    const lastMsg = hasChat ? ctx.chat[ctx.chat.length - 1] : null;
    const msgIndex = hasChat ? ctx.chat.length - 1 : 0;

    // ── Lexicon bridge ───────────────────────────────────────────────────────
    // Sync the active era → Codex state, and convert freshly-fired Lexicon
    // reveals into one-shot directives. Runs before buildAndInject so its
    // changes are reflected this cycle. No-ops if Lexicon isn't present.
    await runLexiconBridge();

    // ── Ledger upkeep ────────────────────────────────────────────────────────
    // Reinforce threads the latest exchange touched; age the rest so neglected
    // threads cool, step down, and eventually drop out of injection. Scans both
    // sides of the exchange so a user-introduced reference counts too.
    if (hasChat) {
        try {
            const recentText = ctx.chat.slice(-2).map(m => m?.mes || '').join('\n');
            maintainThreads(recentText, msgIndex);
        } catch (e) {
            console.warn('[Codex] thread maintenance failed:', e);
        }
    }

    // Rebuild injection on every message to keep context fresh — now reflects
    // the freshly-aged ledger.
    buildAndInject();

    // ── VAD emotional evaluator ──────────────────────────────────────────────
    // Background judgment of how the focal character feels. AI messages only,
    // cooldown-gated. Fire-and-forget; the evaluator self-guards against overlap
    // and fails safe to no change. Read by Voice (tone) and the ledger (weight).
    if (settings.vad_enabled !== false && lastMsg && !lastMsg.is_user) {
        const lastEval = getChatState().vad?.updated_at;
        const sinceEval = (typeof lastEval === 'number') ? msgIndex - lastEval : Infinity;
        if (sinceEval >= (settings.vad_cooldown ?? 2)) {
            const sceneText = ctx.chat.slice(-3).map(m => m?.mes || '').join('\n');
            runVadEvaluation(sceneText, msgIndex);
        }
    }

    // ── Memory nudge ─────────────────────────────────────────────────────────
    if (!settings.enableNudge) return;
    if (!lastMsg || lastMsg.is_user) return; // Only scan AI responses

    const result = detectNudgeSignals(lastMsg.mes || '', msgIndex);

    if (result?.shouldNudge) {
        // Draft a memory from recent context
        const recentMsgs = ctx.chat.slice(-2);
        const draftText = draftMemoryFromContext(recentMsgs, ctx.name2);
        showNudge(draftText, result.dominantType, msgIndex);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════════════════════

jQuery(async () => {
    try {
        console.log(`[${EXT_ID}] v${EXT_VERSION} init…`);

        if (!extension_settings[EXT_ID]) extension_settings[EXT_ID] = {};
        sanitizeSettings();

        try {
            addExtensionSettingsPanel();
        } catch (e) {
            console.warn('[Codex] Settings panel:', e);
        }

        const settings = getSettings();
        if (!settings.enabled) {
            console.log('[Codex] Disabled');
            return;
        }

        initPanel();

        const ctx = getContext();
        if (ctx?.chat?.length > 0) {
            loadChatData();
            sanitizeChatState();
            buildAndInject();
        }

        eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);

        eventSource.on(event_types.CHAT_CHANGED, () => {
            loadChatData();
            sanitizeChatState();
            buildAndInject();
        });

        registerAPI();

        // Mobile/no-console peek: run `javascript:Codex.threads()` in the address
        // bar to see each thread's status/heat/silence, or Codex.maintain() to
        // force a maintenance pass against the last exchange.
        window.Codex = {
            threads: () => getThreads().map(t => ({
                name: t.name, status: t.status, priority: t.priority,
                heat: t.heat ?? 0, silent: t.silent ?? 0,
            })),
            vad: () => getChatState().vad,
            maintain: () => {
                const c = getContext();
                const text = (c?.chat || []).slice(-2).map(m => m?.mes || '').join('\n');
                return maintainThreads(text, (c?.chat?.length || 1) - 1);
            },
            bridge: () => runLexiconBridge(),
            exportStates: () => exportCharacterStates(),
            importStates: (json) => importCharacterStates(json, 'replace'),
        };

        console.log(`[Codex] ✅ v${EXT_VERSION} ready`);
        toastr.success(`Codex v${EXT_VERSION} loaded`, '', { timeOut: 2000 });

    } catch (err) {
        console.error('[Codex] ❌ Init:', err);
        toastr.error(`Codex failed: ${err.message}`, '', { timeOut: 8000 });
    }
});
