/**
 * Codex v1.0 — Character & Story Engine
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
import { getSettings, sanitizeSettings, sanitizeChatState, loadChatData } from './src/state.js';
import { buildAndInject, clearInjection } from './src/injection.js';
import { detectNudgeSignals, draftMemoryFromContext } from './src/memories.js';
import { initPanel, destroyPanel, showNudge } from './src/panel.js';
import { registerAPI, unregisterAPI } from './src/api.js';

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
          Codex tracks character memories, relationship state, and behavioral modes.
          Open the 📋 button to manage character data.
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
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MESSAGE HANDLER — Nudge Detection
// ═══════════════════════════════════════════════════════════════════════════════

async function onMessageReceived() {
    const settings = getSettings();
    if (!settings.enabled) return;

    // Rebuild injection on every message to keep context fresh
    buildAndInject();

    // Check for memory nudge
    if (!settings.enableNudge) return;

    const ctx = getContext();
    if (!ctx?.chat?.length) return;

    const lastMsg = ctx.chat[ctx.chat.length - 1];
    if (!lastMsg || lastMsg.is_user) return; // Only scan AI responses

    const msgIndex = ctx.chat.length - 1;
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

        console.log(`[Codex] ✅ v${EXT_VERSION} ready`);
        toastr.success(`Codex v${EXT_VERSION} loaded`, '', { timeOut: 2000 });

    } catch (err) {
        console.error('[Codex] ❌ Init:', err);
        toastr.error(`Codex failed: ${err.message}`, '', { timeOut: 8000 });
    }
});
