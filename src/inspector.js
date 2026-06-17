/**
 * Codex — Inspector (read-only)
 * --------------------------------------------------------------------------
 * A look behind the curtain. On Termux/mobile there's no console, so this is
 * the eyes for everything Codex tracks in the background: plot threads (with
 * heat/status), the focal character's VAD, recent memories, and the
 * what's-changed / growing-toward framing. It NEVER writes state — purely a
 * window. Build the window before the machinery you'll watch through it.
 *
 * Self-contained on purpose:
 *   - Its own floating button (🔍), draggable, position saved globally.
 *   - Its own overlay sheet (mobile-first, scrollable).
 *   - Its own <style> block (so style.css is never touched).
 *   - One new file + a mount call from index.js. No surgery on panel.js.
 *
 * Forward-compatible: threads are rendered with `kind` (plot/stake) and
 * `direction` (toward/against) already shown. Nothing writes those yet — they
 * read as "—" until the stakes step lands — but the shape is locked now.
 */
import { getContext } from '../../../../extensions.js';
import { getSettings, getChatState, saveSettings } from './state.js';
import { EXT_VERSION } from './config.js';
import {
    MEMORY_TYPE_META, MEMORY_WEIGHT_META,
    THREAD_STATUS_META, THREAD_PRIORITY_META,
} from './config.js';
import { getThreads, getInjectableThreads } from './threads.js';
import { getMemories } from './memories.js';

const FAB_ID     = 'codex-inspector-fab';
const OVERLAY_ID = 'codex-inspector-overlay';
const STYLE_ID   = 'codex-inspector-style';

const HEAT_MAX        = 5;   // mirrors the ledger ceiling; display-only
const RECENT_MEMORIES = 12;  // how many memories the inspector shows
const DRAG_THRESHOLD  = 6;   // px of movement before a press counts as a drag, not a tap

let mounted = false;

// ─── Tiny helpers ─────────────────────────────────────────────────────────────

function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function isOpen() {
    return $(`#${OVERLAY_ID}`).hasClass('cdx-insp-open');
}

// ─── Styles (scoped, injected once) ───────────────────────────────────────────

function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
#${FAB_ID}{
  position:fixed; z-index:10000; width:42px; height:42px; border-radius:50%;
  display:flex; align-items:center; justify-content:center; cursor:pointer;
  font-size:20px; user-select:none; touch-action:none;
  background:var(--SmartThemeBlurTintColor,#1e1e22); color:var(--SmartThemeBodyColor,#ddd);
  border:1px solid rgba(255,255,255,0.18); box-shadow:0 2px 10px rgba(0,0,0,0.45);
  opacity:0.82; transition:opacity .15s;
}
#${FAB_ID}:hover{opacity:1;}
#${FAB_ID}.cdx-dragging{opacity:1; box-shadow:0 4px 16px rgba(0,0,0,0.6);}

#${OVERLAY_ID}{
  position:fixed; inset:0; z-index:10001; display:none;
  background:rgba(0,0,0,0.55); backdrop-filter:blur(2px);
}
#${OVERLAY_ID}.cdx-insp-open{display:flex; align-items:flex-end; justify-content:center;}
@media(min-width:700px){ #${OVERLAY_ID}.cdx-insp-open{align-items:center;} }

#${OVERLAY_ID} .cdx-insp-sheet{
  width:100%; max-width:680px; max-height:88vh; overflow-y:auto;
  background:var(--SmartThemeBlurTintColor,#17171b); color:var(--SmartThemeBodyColor,#e6e6e6);
  border:1px solid rgba(255,255,255,0.12); border-radius:14px 14px 0 0;
  box-shadow:0 -4px 28px rgba(0,0,0,0.5); padding:14px 14px 28px;
}
@media(min-width:700px){ #${OVERLAY_ID} .cdx-insp-sheet{border-radius:14px;} }

.cdx-insp-head{display:flex; align-items:center; gap:10px; position:sticky; top:0;
  background:inherit; padding-bottom:10px; margin-bottom:4px; border-bottom:1px solid rgba(255,255,255,0.08);}
.cdx-insp-head h3{margin:0; font-size:1.05em; flex:1;}
.cdx-insp-head .cdx-ver{opacity:0.5; font-size:0.75em; font-weight:normal;}
.cdx-insp-iconbtn{cursor:pointer; font-size:1.1em; padding:4px 8px; border-radius:8px;
  border:1px solid rgba(255,255,255,0.14); background:rgba(255,255,255,0.04); user-select:none;}
.cdx-insp-iconbtn:hover{background:rgba(255,255,255,0.1);}

.cdx-insp-sec{margin-top:16px;}
.cdx-insp-sec > .cdx-insp-label{font-size:0.72em; letter-spacing:0.08em; text-transform:uppercase;
  opacity:0.55; margin-bottom:7px;}
.cdx-insp-empty{opacity:0.4; font-style:italic; font-size:0.88em;}

.cdx-chips{display:flex; flex-wrap:wrap; gap:6px;}
.cdx-chip{font-size:0.82em; padding:3px 9px; border-radius:999px;
  background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1);}
.cdx-chip b{font-weight:600;}

.cdx-thread{border:1px solid rgba(255,255,255,0.1); border-radius:10px; padding:9px 11px;
  margin-bottom:8px; background:rgba(255,255,255,0.025);}
.cdx-thread.cdx-dim{opacity:0.5;}
.cdx-thread-top{display:flex; align-items:center; gap:7px; flex-wrap:wrap;}
.cdx-thread-name{font-weight:600; flex:1; min-width:120px;}
.cdx-badge{font-size:0.72em; padding:1px 7px; border-radius:6px; border:1px solid rgba(255,255,255,0.16);
  white-space:nowrap;}
.cdx-thread-desc{font-size:0.85em; opacity:0.75; margin-top:5px; line-height:1.4;}
.cdx-thread-meta{display:flex; align-items:center; gap:12px; margin-top:7px; font-size:0.76em; opacity:0.7;}
.cdx-heat{display:flex; align-items:center; gap:2px;}
.cdx-heat .pip{width:9px; height:9px; border-radius:2px; background:rgba(255,255,255,0.14);}
.cdx-heat .pip.on{background:#c45c5c;}

.cdx-mem{display:flex; gap:8px; padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.06); font-size:0.88em;}
.cdx-mem:last-child{border-bottom:none;}
.cdx-mem-ico{flex:0 0 auto;}
.cdx-mem-txt{line-height:1.4;}
.cdx-mem-w{opacity:0.55; font-size:0.85em; margin-left:4px;}

.cdx-kv{font-size:0.9em; line-height:1.5;}
.cdx-kv b{opacity:0.7; font-weight:600;}
.cdx-dir-list{margin:0; padding-left:18px; font-size:0.88em; line-height:1.5;}
`;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
}

// ─── Renderers ─────────────────────────────────────────────────────────────

function renderSnapshot() {
    try {
        const st = getChatState();
        const vad = st.vad || { valence: 0, arousal: 0, dominance: 0, label: 'neutral' };
        const threads = getThreads() || [];
        const active = threads.filter(t => t.status !== 'paused' && t.status !== 'resolved').length;
        const mems = (st.memories || []).length;
        const dirs = (st.writing_directives || []).length;
        const sign = n => (n > 0 ? `+${n}` : `${n}`);
        return `
        <div class="cdx-insp-sec">
          <div class="cdx-insp-label">Snapshot</div>
          <div class="cdx-chips">
            <span class="cdx-chip">😶 <b>${esc(vad.label || 'neutral')}</b></span>
            <span class="cdx-chip">V <b>${sign(vad.valence)}</b></span>
            <span class="cdx-chip">A <b>${sign(vad.arousal)}</b></span>
            <span class="cdx-chip">D <b>${sign(vad.dominance)}</b></span>
            <span class="cdx-chip">🧵 <b>${active}</b>/${threads.length} threads</span>
            <span class="cdx-chip">💭 <b>${mems}</b> memories</span>
            <span class="cdx-chip">✍ <b>${dirs}</b> directives</span>
          </div>
        </div>`;
    } catch (e) {
        return `<div class="cdx-insp-sec"><div class="cdx-insp-empty">Snapshot unavailable: ${esc(e.message)}</div></div>`;
    }
}

function heatPips(heat) {
    const n = Math.max(0, Math.min(HEAT_MAX, Number(heat) || 0));
    let pips = '';
    for (let i = 0; i < HEAT_MAX; i++) pips += `<span class="pip${i < n ? ' on' : ''}"></span>`;
    return `<span class="cdx-heat" title="heat ${n}/${HEAT_MAX}">🔥 ${pips}</span>`;
}

function directionBadge(direction) {
    // Forward-compat: nothing writes this yet. Shown so the schema is visible now.
    if (direction === 'toward')  return `<span class="cdx-badge" style="color:#7a9e7e">↗ toward</span>`;
    if (direction === 'against') return `<span class="cdx-badge" style="color:#c45c5c">↘ against</span>`;
    return `<span class="cdx-badge" style="opacity:0.4">— dir</span>`;
}

function kindBadge(kind) {
    if (kind === 'stake') return `<span class="cdx-badge" style="color:#8a7eb8">◆ stake</span>`;
    if (kind === 'plot')  return `<span class="cdx-badge" style="opacity:0.7">● plot</span>`;
    return `<span class="cdx-badge" style="opacity:0.4">— kind</span>`;
}

function renderThreads() {
    try {
        const all = getThreads() || [];
        if (!all.length) {
            return `<div class="cdx-insp-sec"><div class="cdx-insp-label">Threads</div>
                    <div class="cdx-insp-empty">No threads tracked yet.</div></div>`;
        }
        // Active first (in the same ranked order injection uses), then the rest dimmed.
        let ranked = [];
        try { ranked = getInjectableThreads(99) || []; } catch { ranked = []; }
        const rankedIds = new Set(ranked.map(t => t.id));
        const rest = all.filter(t => !rankedIds.has(t.id));
        const ordered = [...ranked, ...rest];

        const cards = ordered.map(t => {
            const meta = THREAD_STATUS_META[t.status] || { label: t.status || '?', icon: '•', color: '#888' };
            const pri = THREAD_PRIORITY_META[t.priority] || { icon: '' };
            const dim = (t.status === 'paused' || t.status === 'resolved') ? ' cdx-dim' : '';
            const desc = t.description ? `<div class="cdx-thread-desc">${esc(t.description)}</div>` : '';
            return `
            <div class="cdx-thread${dim}">
              <div class="cdx-thread-top">
                <span title="${esc(meta.desc || meta.label)}" style="color:${meta.color}">${meta.icon}</span>
                <span class="cdx-thread-name">${esc(pri.icon ? pri.icon + ' ' : '')}${esc(t.name)}</span>
                ${kindBadge(t.kind)}
                ${directionBadge(t.direction)}
              </div>
              ${desc}
              <div class="cdx-thread-meta">
                <span style="color:${meta.color}">${esc(meta.label)}</span>
                ${heatPips(t.heat)}
                <span title="silent turns">🕯 ${Number(t.silent) || 0}</span>
              </div>
            </div>`;
        }).join('');

        return `<div class="cdx-insp-sec"><div class="cdx-insp-label">Threads (${all.length})</div>${cards}</div>`;
    } catch (e) {
        return `<div class="cdx-insp-sec"><div class="cdx-insp-empty">Threads unavailable: ${esc(e.message)}</div></div>`;
    }
}

function renderMemories() {
    try {
        const mems = (getMemories() || []).slice(-RECENT_MEMORIES).reverse();
        if (!mems.length) {
            return `<div class="cdx-insp-sec"><div class="cdx-insp-label">Recent memories</div>
                    <div class="cdx-insp-empty">No memories yet.</div></div>`;
        }
        const rows = mems.map(m => {
            const tm = MEMORY_TYPE_META[m.type] || { icon: '•', color: '#888', label: m.type || '?' };
            const wm = MEMORY_WEIGHT_META[m.weight] || { icon: '' };
            return `
            <div class="cdx-mem">
              <span class="cdx-mem-ico" style="color:${tm.color}" title="${esc(tm.label)}">${tm.icon}</span>
              <span class="cdx-mem-txt">${esc(m.text)}<span class="cdx-mem-w" title="${esc(m.weight || '')}">${wm.icon}</span></span>
            </div>`;
        }).join('');
        return `<div class="cdx-insp-sec"><div class="cdx-insp-label">Recent memories</div>${rows}</div>`;
    } catch (e) {
        return `<div class="cdx-insp-sec"><div class="cdx-insp-empty">Memories unavailable: ${esc(e.message)}</div></div>`;
    }
}

function renderDirection() {
    try {
        const st = getChatState();
        const changed = (st.whats_changed || '').trim();
        const growing = (st.growing_toward || '').trim();
        const dirs = st.writing_directives || [];
        let html = `<div class="cdx-insp-sec"><div class="cdx-insp-label">Direction</div>`;
        html += `<div class="cdx-kv"><b>What's changed:</b> ${changed ? esc(changed) : '<span class="cdx-insp-empty">—</span>'}</div>`;
        html += `<div class="cdx-kv" style="margin-top:4px;"><b>Growing toward:</b> ${growing ? esc(growing) : '<span class="cdx-insp-empty">—</span>'}</div>`;
        if (dirs.length) {
            html += `<div style="margin-top:8px;"><b style="opacity:0.7;font-size:0.85em;">Writing directives</b>
                     <ul class="cdx-dir-list">${dirs.map(d => `<li>${esc(d)}</li>`).join('')}</ul></div>`;
        }
        html += `</div>`;
        return html;
    } catch (e) {
        return `<div class="cdx-insp-sec"><div class="cdx-insp-empty">Direction unavailable: ${esc(e.message)}</div></div>`;
    }
}

function renderBody() {
    const ctx = getContext();
    const charName = ctx?.name2 || 'Character';
    return `
    <div class="cdx-insp-sheet">
      <div class="cdx-insp-head">
        <h3>🔍 Codex Inspector <span class="cdx-ver">v${esc(EXT_VERSION)} · ${esc(charName)}</span></h3>
        <span class="cdx-insp-iconbtn" id="cdx-insp-refresh" title="Refresh">⟳</span>
        <span class="cdx-insp-iconbtn" id="cdx-insp-close" title="Close">✕</span>
      </div>
      ${renderSnapshot()}
      ${renderThreads()}
      ${renderMemories()}
      ${renderDirection()}
    </div>`;
}

// ─── Open / close / refresh ───────────────────────────────────────────────────

function rerender() {
    const overlay = $(`#${OVERLAY_ID}`);
    if (!overlay.length) return;
    overlay.html(renderBody());
    overlay.find('#cdx-insp-close').on('click', closeInspector);
    overlay.find('#cdx-insp-refresh').on('click', (e) => { e.stopPropagation(); rerender(); });
}

function openInspector() {
    if (!document.getElementById(OVERLAY_ID)) return;
    rerender();
    $(`#${OVERLAY_ID}`).addClass('cdx-insp-open');
}

function closeInspector() {
    $(`#${OVERLAY_ID}`).removeClass('cdx-insp-open');
}

function toggleInspector() {
    isOpen() ? closeInspector() : openInspector();
}

/** Called by index.js after state changes; only re-renders if the sheet is open. */
export function refreshInspector() {
    if (isOpen()) rerender();
}

// ─── FAB (draggable, tap-to-open) ─────────────────────────────────────────────

function placeFab(fab) {
    const saved = getSettings().inspector_fab;
    if (saved && typeof saved.top === 'number' && typeof saved.left === 'number') {
        fab.style.top = `${saved.top}px`;
        fab.style.left = `${saved.left}px`;
        fab.style.right = 'auto';
        fab.style.bottom = 'auto';
    } else {
        // Default: right edge, lower third — out of the way of the 📋 panel FAB.
        fab.style.top = `${Math.round(window.innerHeight * 0.62)}px`;
        fab.style.right = '12px';
        fab.style.left = 'auto';
        fab.style.bottom = 'auto';
    }
}

function wireFabDrag(fab) {
    let dragging = false, moved = false, startX = 0, startY = 0, offX = 0, offY = 0;

    const onMove = (e) => {
        if (!dragging) return;
        const p = e.touches ? e.touches[0] : e;
        const dx = p.clientX - startX, dy = p.clientY - startY;
        if (!moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) { moved = true; fab.classList.add('cdx-dragging'); }
        if (!moved) return;
        e.preventDefault();
        let left = p.clientX - offX, top = p.clientY - offY;
        // Keep on-screen.
        left = Math.max(2, Math.min(window.innerWidth - fab.offsetWidth - 2, left));
        top  = Math.max(2, Math.min(window.innerHeight - fab.offsetHeight - 2, top));
        fab.style.left = `${left}px`; fab.style.top = `${top}px`;
        fab.style.right = 'auto'; fab.style.bottom = 'auto';
    };

    const onUp = () => {
        if (!dragging) return;
        dragging = false;
        fab.classList.remove('cdx-dragging');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (moved) {
            const r = fab.getBoundingClientRect();
            const s = getSettings();
            s.inspector_fab = { top: Math.round(r.top), left: Math.round(r.left) };
            saveSettings();
        } else {
            toggleInspector(); // it was a tap, not a drag
        }
    };

    const onDown = (e) => {
        const p = e.touches ? e.touches[0] : e;
        dragging = true; moved = false;
        startX = p.clientX; startY = p.clientY;
        const r = fab.getBoundingClientRect();
        offX = p.clientX - r.left; offY = p.clientY - r.top;
        window.addEventListener('pointermove', onMove, { passive: false });
        window.addEventListener('pointerup', onUp);
    };

    fab.addEventListener('pointerdown', onDown);
}

// ─── Mount / unmount ───────────────────────────────────────────────────────

export function initInspector() {
    try {
        // Idempotent: clean any prior mount first (hot-reload friendly).
        destroyInspector();
        injectStyles();

        const fab = document.createElement('div');
        fab.id = FAB_ID;
        fab.textContent = '🔍';
        fab.title = 'Codex Inspector';
        document.body.appendChild(fab);
        placeFab(fab);
        wireFabDrag(fab);

        const overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        document.body.appendChild(overlay);
        // Tap the dim backdrop (not the sheet) to close.
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closeInspector(); });

        mounted = true;
    } catch (e) {
        console.warn('[Codex/Inspector] init failed:', e);
    }
}

export function destroyInspector() {
    document.getElementById(FAB_ID)?.remove();
    document.getElementById(OVERLAY_ID)?.remove();
    mounted = false;
}
