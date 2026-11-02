import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useState } from 'react';
import { getLang, subscribeLang, t } from '../i18n.js';
import { Box, Text, useTerminalSize } from '../ui.js';
import { normalizeIdePath } from '../dsh-adapter/ide-channel.js';
import { Divider } from './design-system/Divider.js';
import { UserPromptMessage } from './messages/UserPromptMessage.js';
import { TeamMessageBubble } from './messages/TeamMessageBubble.js';
import { AssistantTextLeafRow, ThinkingLeafRow, ToolLeafRow } from './messages/TranscriptLeaves.js';
import { liveOutputMaxLines, liveOutputRows } from './messages/liveOutputLines.js';
import { SubagentMessage } from './Chat/SubagentMessage.js';
import { JobCard } from './Chat/JobCard.js';
import { JobGroupHeader } from './Chat/JobGroupHeader.js';
import { isMinimalUiMode } from '../minimalUiMode.js';
import { noteFrameCause, noteListGeometry } from '../ink/geometry-trace.js';
import { getTerminalFlushTick } from '../ink/flush-tick.js';
import { TurnInterruptedRow } from './TurnInterruptedRow.js';
import { TurnUsageRow } from './TurnUsageRow.js';
import { LogoV2 } from './LogoV2.js';
import { StreamingMarkdown } from './StreamingMarkdown.js';
import { MessageMetadata } from './messages/MessageMetadata.js';
import { stripNarration } from '../utils/narration.js';
import { foldLongLines } from '../utils/fold-long-lines.js';
import { stringWidth } from '../ink/stringWidth.js';
import { truncateToWidth } from '../ink/truncateToWidth.js';
import { clipPreview } from '../ink/timeline-rail.js';
import { getRevealVersion, revealLengthOf, revealTextOf } from './smoothReveal.js';
import { useRevealVersion } from '../hooks/useRevealVersion.js';
import { TranscriptImages } from './messages/TranscriptImages.js';
import { primaryComboString } from '../utils/keymap.js';
/**
 * Transcript rows rendered with the dsh-TUI message layout: user prompts
 * on a grey bubble with a `❯` pointer, assistant text with a `●` bullet and
 * markdown, thinking as a live three-line/full toggle then a settled
 * `⚓ Thinking` row with the localized ctrl+o expand hint, and tool calls as
 * status-dot cards.
 * `expanded` (Ctrl+O) shows full reasoning + full tool
 * args/results; `expandedRows` (message-selection mode, Enter) expands single
 * rows; `selectedId` highlights the selected row.
 */
/** Render cap for very long sessions: older rows fold behind a Divider until
 *  Ctrl+E expands them.
 *  120 (was 300): opening a long session paints the whole cap into the
 *  main-screen scrollback (historyPaint), and each row's first markdown
 *  lex + wrap costs ~2-5ms — 300 rows saturated the main thread for ~6s
 *  on open (measured, 800-row inline session). 120 rows ≈ 4-5 screens of
 *  paint (<1s) with the rest behind the show-previous divider. The transcript
 *  is a viewport, not a printout; load-earlier restores older rows. */
const RENDERED_ROW_CAP = 120;
/** Threshold of the `auto` jobGroupFold policy: a run of this many (or
 *  more) FULLY SETTLED jobs folds into its own summary line. Two jobs are
 *  still a pair worth reading card by card — the group rail alone already
 *  saves their separator lines there. `always` uses 2, `never` uses none.
 *  Ctrl+O and a click on the summary reopen any group; clicking again folds
 *  it back. */
const JOB_GROUP_FOLD_MIN = 3;
// --- layout virtualization constants -------------------------------------
// Offscreen rows render as fixed-height spacers whose heights come from the
// previous commit's Yoga layout, so the pure-JS Yoga engine never walks
// their subtrees. Spacers preserve the scroll geometry (content height,
// sticky follow, scrollbar) of a fully-mounted list.
/** Lines of extra content mounted above/below the visible window. */
const OVERSCAN_LINES = 8;
/** Fallback row height before the first measurement (terminal lines). */
const DEFAULT_ROW_HEIGHT = 2;
/** Cold-start estimate of the header block above the rows; corrected by the
 *  first layout measurement. */
const DEFAULT_HEADER_LINES = 14;
/** Stable fallbacks for the stream-view toggle props: verify/repro harnesses
 *  and embedders render MessageList with prop sets that predate them, and the
 *  render must not throw (same rule as Chat's stubbed channel APIs). Module
 *  scope keeps the identities stable so MemoRow's shallow compare and the
 *  toggle callback's deps never churn. */
const NO_STREAM_VIEW_TOGGLED = new Set();
const NOOP_TOGGLE_STREAM_VIEW = (_rowId) => { };
// --- smooth-streaming display text -----------------------------------------
// Render-phase reads of the shared reveal cursors (see smoothReveal.ts for
// why the cursors live outside React). `active` gates cursor CREATION to
// live-arrived content (streaming rows, live-settled rows marked `fresh`,
// replayed history paints complete); once created, a cursor keeps revealing
// until it catches up — settling mid-reveal must not snap (that is the
// "non-streaming delivery becomes a smooth flow" contract).
/** A row that opens a turn on the rail and the pinned header: a user row,
 *  but not an Agent Teams peer message (never the human's prompt). */
function isTurnRow(row) {
    return row.kind === 'user' && row.label !== 'team-message';
}
/** The sender a team-message row shows (empty when the event named none);
 *  undefined for every other row, which renders as the human's prompt. */
function teamSenderOf(row) {
    return row.label === 'team-message' ? row.sender ?? '' : undefined;
}
/** Keep a settled text-only reply visible when narration is its whole body. */
function assistantDisplayText(row) {
    const text = row.text ?? '';
    const stripped = stripNarration(text);
    return row.streaming !== true && (row.images?.length ?? 0) === 0 && stripped.trim() === ''
        ? text
        : stripped;
}
function assistantRevealText(row, enabled) {
    const stripped = assistantDisplayText(row);
    return revealTextOf(`a${row.id}`, stripped, {
        enabled,
        active: row.streaming === true || row.fresh === true,
    });
}
function reasoningRevealText(row, enabled) {
    return revealTextOf(`r${row.id}`, row.text, { enabled, active: row.streaming === true });
}
/** Display length only (layout signature; no slice allocation). */
function revealDisplayLen(row, enabled) {
    if (row.kind === 'assistant') {
        const stripped = assistantDisplayText(row);
        return revealLengthOf(`a${row.id}`, stripped, {
            enabled,
            active: row.streaming === true || row.fresh === true,
        });
    }
    if (row.kind === 'reasoning') {
        return revealLengthOf(`r${row.id}`, row.text, { enabled, active: row.streaming === true });
    }
    return row.text.length;
}
/**
 * Display form of an IDE-selection path (T-FIX-01): when the path lives
 * under the session cwd, strip that prefix so the indicator line reads
 * `src/a.ts` instead of a long absolute path (UAT finding — the extension
 * anchors at its workspace root while the TUI session cwd is the git
 * worktree root, so raw paths are long and redundant). Pure display layer:
 * the `<attached-file>` block keeps its absolute path for the model.
 *
 * Comparison reuses normalizeIdePath (the ide-channel lock matcher's
 * normalizer: backslashes folded to forward slashes, trailing slashes
 * stripped, case folded on case-insensitive filesystems) so Windows forms
 * like `d:/x` vs `D:\X` still match. Prefix hits return the remainder
 * (`src/a.ts`); everything else — outside cwd, empty/undefined cwd, or the
 * path being the cwd itself — returns the input unchanged. NOT basename:
 * that would drop the directory context and collide on same-named files.
 * `caseInsensitive` is parameterized so verifiers can pin either mode on
 * any host.
 */
export function displaySelectionPath(path, sessionCwd, caseInsensitive = process.platform === 'win32' || process.platform === 'darwin') {
    if (sessionCwd === undefined || sessionCwd === '')
        return path;
    // Shared normalizer (lock matching uses the same): backslashes fold to
    // forward slashes, trailing slashes stripped — transforms that preserve
    // character positions, so slicing the canonical path at the cwd's length
    // keeps the file's own casing in the displayed relative string. Folding
    // decides only WHETHER the prefix matches, never what gets sliced off.
    const pathNorm = normalizeIdePath(path, false);
    const cwdNorm = normalizeIdePath(sessionCwd, false);
    if (cwdNorm === '' || cwdNorm.length >= pathNorm.length)
        return path;
    // The POSIX root `/` is a prefix of every absolute path without a further
    // separator — `/repo/file.ts` under cwd `/` displays as `repo/file.ts`.
    // (A `startsWith('/' + '/')` check would never match; coderabbit review.)
    if (cwdNorm === '/') {
        return pathNorm.startsWith('/') ? pathNorm.slice(1) : path;
    }
    const foldedPath = normalizeIdePath(pathNorm, caseInsensitive);
    const foldedCwd = normalizeIdePath(cwdNorm, caseInsensitive);
    if (!foldedPath.startsWith(`${foldedCwd}/`))
        return path;
    return pathNorm.slice(cwdNorm.length + 1);
}
/**
 * Per-kind layout signature PARTS: the O(1) identity of every input that
 * decides a row's rendered HEIGHT (see sigRef in MessageList). Fields are
 * scoped to the row's own renderer — a global flat signature
 * over-invalidates (a diffLayout switch must not drop user-message
 * heights). Text uses length as the proxy: full-text hashing per row per
 * frame would defeat virtualization's budget, and a same-length miss only
 * degrades to the previous behavior.
 *
 * Returns a PARTS VECTOR instead of a joined string: the caller compares
 * slot-by-slot against the cached vector (all primitives), allocating only
 * when a row's inputs actually changed. Building a joined string per row
 * per render was O(rows) allocation churn on every scroll tick — the GC
 * share of the long-session scroll profile.
 *
 * The vector is a MODULE-LEVEL SCRATCH BUFFER: single-threaded synchronous
 * render makes reuse safe, and the unchanged case (the overwhelming
 * majority) allocates nothing. Callers that retain the vector must copy
 * (parts.slice()).
 */
const signatureScratch = [];
/** Status code for the job-group fingerprint (a hash input only — the values
 *  just have to be distinct per status). */
function jobStatusCode(status) {
    switch (status) {
        case 'running': return 1;
        case 'stopping': return 2;
        case 'completed': return 3;
        case 'failed': return 4;
        case 'killed': return 5;
        default: return 7;
    }
}
function signatureParts(row, columns, expanded, expandedRows, streamViewToggledRows, thinkingVisible, thinkingFold, diffLayout, foldTerminalCommand, model, failureHintRowId, failureHint, displayTextLen, sessionCwd, fullscreen) {
    signatureScratch.length = 0;
    // Universal height inputs: width reflows every row; kind switches height
    // semantics wholesale; text length drives wrapping. `displayTextLen` is the
    // REVEALED length while smooth streaming is painting (the height follows
    // what is on screen, not what has arrived).
    signatureScratch.push(columns, row.kind, displayTextLen);
    const images = row.images;
    signatureScratch.push(images?.length ?? 0);
    if (images?.length === 1) {
        signatureScratch.push(images[0].width, images[0].height);
    }
    switch (row.kind) {
        case 'assistant':
            // Streaming vs settled swaps renderers; Ctrl+O/per-row expand adds the
            // metadata row (model only renders expanded — keeps an idle /model
            // switch from touching settled rows).
            signatureScratch.push(row.streaming === true, expanded, expandedRows.has(row.id), expanded ? model : '');
            break;
        case 'reasoning':
            // thinkingFold (preview vs full), its per-row live override, and the
            // visibility filter all change the card's height.
            signatureScratch.push(row.streaming === true, row.thinkingOpen === true, expanded, expandedRows.has(row.id), streamViewToggledRows.has(row.id), thinkingVisible, thinkingFold);
            break;
        case 'tool': {
            const tool = row.tool;
            signatureScratch.push(expanded, expandedRows.has(row.id), diffLayout, 
            // Terminal header folding changes the header's height the same way
            // diffLayout changes the body's — without it, a /settings toggle
            // leaves already-mounted tool cards at their stale cached height.
            foldTerminalCommand, tool?.status ?? '', tool?.resultText?.length ?? 0, tool?.resultFull?.length ?? 0, tool?.errorText?.length ?? 0, 
            // Source-fold disclosure and the uncapped terminal exit/signal tail
            // change the card's height when they (dis)appear — the window fold
            // drops payloads and a settled terminal view adds its verdict lines.
            row.folded === true, tool?.resultView?.card ?? '', row.id === failureHintRowId ? failureHint ?? '' : '', 
            // Live output rows of a running call (omitted header + lines): the
            // count saturates once the tail fills the card's window, so a
            // steady stream stops invalidating the cached height.
            tool?.status === 'running'
                ? liveOutputRows(tool.liveOutput, tool.liveOutputDropped ?? 0, liveOutputMaxLines(expanded || expandedRows.has(row.id), fullscreen))
                : 0);
            break;
        }
        case 'subagent':
            // 卡片高度输入：running→settled 折叠 waterfall+tool 行（5→1 行），
            // failed 增加 error 行。缺这些字段的话 offscreen 结算后 cached
            // height 永不过期 → 滚回 blank band / 滚不到底。
            signatureScratch.push(row.subagent?.status ?? '', row.subagent?.toolCalls.length ?? 0, row.subagent?.outputLines.length ?? 0, row.subagent?.error?.length ?? 0);
            break;
        case 'job': {
            // Command expansion and group folding change the row height; output
            // stays within a fixed two-row tail, independent of command expansion.
            const group = row.jobGroup;
            signatureScratch.push(expanded, expandedRows.has(row.id), row.job?.status ?? '', 
            // Script text, including blank-line changes, determines expanded height.
            row.job?.label ?? '', row.job?.outputLines.length ?? 0, row.job?.detail?.length ?? 0, row.job?.progress?.length ?? 0, 
            // The waterfall wraps its tail and keeps the last rows, so how much
            // text those tail lines carry decides how many rows actually paint.
            row.job === undefined
                ? ''
                : row.job.outputLines.slice(-2).map(line => `${line.text.length}:${line.gapBefore === true}`).join(','), 
            // The group head adds a summary; folded groups hide their card bodies.
            group !== undefined, group?.head === true, group?.folded === true);
            break;
        }
        case 'compact':
            // Folded one-liner vs full summary text.
            signatureScratch.push(expanded, expandedRows.has(row.id));
            break;
        case 'turn-summary':
            // Immutable payload, single truncate-end line: the kind switch alone
            // covers the height semantics (content never changes after creation).
            break;
        case 'user':
            // T06: the selection indicator line above the bubble adds one rendered
            // row whose text wraps with width — its presence and content length
            // are height inputs. Missing this would leave offscreen spacer heights
            // stale when the field arrives (scroll jump, DESIGN R4).
            // T-FIX-01: the indicator renders the cwd-relative display path, so
            // the signature hashes THAT string — a cwd switch (/workspace) that
            // changes the display form must invalidate the cached height too.
            // width is the display-CELL width (emoji / CJK / combining / ANSI
            // differ from JS length), not the JS string length — two paths with
            // equal length but different terminal widths must not share a cached
            // height (coderabbit review, repo width convention).
            signatureScratch.push(row.selectionAttached === undefined ? 0 : 1, stringWidth(displaySelectionPath(row.selectionAttached?.path ?? '', sessionCwd)), String(row.selectionAttached?.lines ?? ''), 
            // A team message adds its sender line above the body.
            teamSenderOf(row) ?? '');
            // Long-line fold: expanding a folded row swaps the folded preview for
            // the raw line (thousands of rows), so both expansion switches are
            // height inputs on user rows too — same rationale as the default arm.
            signatureScratch.push(expanded, expandedRows.has(row.id));
            break;
        default:
            // notice / interrupt / local / local-output: height follows
            // text + columns alone (selection/background never change height) —
            // EXCEPT the long-line fold: expanding a folded row swaps ~10 rows of
            // folded text for the raw line (thousands), so both expansion switches
            // are height inputs here too. Without them the stale cached height
            // feeds topPad/bottomPad and the offsets scan, and the expanded tail
            // can end up unreachable behind a wrong scroll range.
            signatureScratch.push(expanded, expandedRows.has(row.id));
            break;
    }
    return signatureScratch;
}
export function MessageList({ rows, expanded, expandedRows, selectedId, onToggleRow, streamViewToggledRows = NO_STREAM_VIEW_TOGGLED, onToggleStreamView = NOOP_TOGGLE_STREAM_VIEW, model, diffLayout = 'auto', thinkingFold = 'preview', jobGroupFold = 'auto', toolBackground = 'none', foldTerminalCommand = false, turnUsageRow = false, smoothStreaming = false, activityFrames, showAll, onToggleAll, onLoadOlder, olderHistory, thinkingVisible = true, historyPaintEnabled = true, fullscreen = false, registerRowRef, scrollHandle, forceMountRowId, newSinceRowId, onUnseenCount, onTimeline, failureHintRowId, failureHint, onOpenSubagent, onOpenSubagentView, onOpenJobs, onWatchJobOutput, onOpenFile, sessionCwd, onPreviewImage, suppressImageGraphics = false, }) {
    const lang = React.useSyncExternalStore(subscribeLang, getLang);
    const hiddenCount = rows.length - RENDERED_ROW_CAP;
    // The thinking filter runs BEFORE virtualization so window indices line up.
    //
    // Fingerprint memo: every scroll tick re-rendered this pipeline even when
    // nothing changed — slice + filter allocate a fresh rows-length array and
    // the margins pre-pass allocates a Map with one entry per row (3200-row
    // session ⇒ ~200KB churn per 16ms tick, the GC share of the scroll
    // profile). The inputs are all identity-stable across ticks: channel.rows
    // is a live in-place array (identity changes only on rewind/new session),
    // showAll/thinkingVisible are React state. Rows APPENDED in place keep the
    // identity — the cache must key on rows.length too (streaming appends).
    const visibleRowsCacheRef = React.useRef(null);
    /** Generation counter for the visibleRows cache (timeline memo key). */
    const visGenRef = React.useRef(0);
    const visibleCache = visibleRowsCacheRef.current;
    // Streaming-bit fingerprint: in-place `streaming = false` writes (turn
    // settle) are invisible to the rows-identity/length key above, but an
    // assistant row that settles with EMPTY text crosses the empty-assistant
    // filter boundary (visible-while-streaming → filtered-when-settled).
    // Allocation-free scan; rebuild only when a bit actually flipped.
    let streamBitsSame = visibleCache !== null && visibleCache.streamBits.length === rows.length;
    if (streamBitsSame) {
        const bits = visibleCache.streamBits;
        for (let i = 0; i < rows.length; i++) {
            if (bits[i] !== (rows[i].streaming === true ? 1 : 0)) {
                streamBitsSame = false;
                break;
            }
        }
    }
    // Job-group fingerprint: job statuses land IN PLACE (`row.job` is
    // re-assigned by the projection, the row array never moves) and the expand
    // toggles live in a Set — none of that shows up in the rows identity or
    // length key above, yet both decide whether a consecutive-job run folds,
    // and a folded run REMOVES its members from the visible window. One
    // allocation-free pass over the row list (only job rows feed the hash).
    let jobsSig = (expanded ? 1 : 0) * 7 + (jobGroupFold === 'always' ? 1 : jobGroupFold === 'never' ? 2 : 3);
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (row.kind !== 'job' || row.job === undefined)
            continue;
        jobsSig = (jobsSig * 33 + row.id + jobStatusCode(row.job.status) + (expandedRows.has(row.id) ? 7 : 0)) | 0;
    }
    if (visibleCache === null ||
        visibleCache.rows !== rows ||
        visibleCache.rowsLength !== rows.length ||
        visibleCache.showAll !== (showAll || hiddenCount <= 0) ||
        visibleCache.thinkingVisible !== thinkingVisible ||
        visibleCache.jobsSig !== jobsSig ||
        visibleCache.turnRowOn !== turnUsageRow ||
        !streamBitsSame) {
        const sliced = showAll || hiddenCount <= 0
            ? rows
            : rows.slice(hiddenCount);
        // Empty settled assistant rows (PR #383's duplicate-dot bug): when the
        // model calls a tool without producing text, the assistant/message event
        // carries empty text — rendered as a lone `●` bullet dangling above the
        // tool card. Filter them BEFORE virtualization (not by rendering null in
        // TranscriptRow): a null row never mounts, never enters paintedOnce, and
        // would stall the main-screen history-paint batch loop forever. A row
        // that is STILL STREAMING keeps its place even with empty text — the
        // live dot is the "model is answering" affordance and content may yet
        // arrive.
        // Filtering, measurement and rendering share the same display text.
        // A settled narration-only reply has real content; only truly empty
        // text-only rows disappear. Image-only rows retain their own content.
        const rendersEmptyAssistant = (row) => row.kind === 'assistant' &&
            row.streaming !== true &&
            assistantDisplayText(row).trim() === '' &&
            (row.images?.length ?? 0) === 0;
        let hasEmptyAssistant = false;
        for (const row of sliced) {
            if (rendersEmptyAssistant(row)) {
                hasEmptyAssistant = true;
                break;
            }
        }
        // The transcript can arrive FROZEN end to end: the session projection
        // freezes both the row array and every row object (session-projection.ts
        // `Object.freeze(rows.map(row => Object.freeze({ ...row })))`), so the
        // pass-through branch below must COPY rather than alias it. The group
        // decoration further down is render-local derived state: it rides
        // shallow copies inside this writable array, never the shared row
        // objects (an in-place write throws on a frozen row and takes the TUI
        // down at startup — the resume/replay first frame delivers exactly
        // that shape).
        let out = hasEmptyAssistant
            ? sliced.filter(row => !rendersEmptyAssistant(row) &&
                (thinkingVisible || row.kind !== 'reasoning'))
            : thinkingVisible
                ? sliced.slice()
                : sliced.filter(row => row.kind !== 'reasoning');
        // Turn-usage rows (settings `dsh-tui.turnUsageRow`, default off): a
        // pure PRESENTATION gate — filtering here (not render-null) keeps the
        // row out of the window entirely, so no cached height or mounted node
        // survives the toggle. The ledger data itself is collected regardless.
        if (!turnUsageRow)
            out = out.filter(row => row.kind !== 'turn-summary');
        // --- consecutive-job groups ------------------------------------------
        // A batch of run_in_background calls lands as N adjacent job cards (the
        // projection pushes the whole roster in one sync) and EVERY card pays
        // the 1-row block margin — a pile of near-identical rows for work nobody
        // reads card by card. Read ≥2 adjacent job rows as ONE group instead:
        // members drop the blank line between them, hang off a shared chain
        // rail, and the head row carries the run summary. A fully settled run
        // (≥ JOB_GROUP_FOLD_MIN) folds into that summary alone.
        //
        // Folded members are removed HERE, before virtualization, so window
        // indices line up (same rule as the thinking filter). The fold is the
        // ordinary per-row expand gesture: clicking the summary — or Ctrl+O —
        // reopens the run, clicking again folds it back.
        //
        // Runs are detected in the VISIBLE list, so a run whose head fell behind
        // the RENDERED_ROW_CAP fold window is read from the first visible member
        // (the header then counts what is on screen — never a headerless rail).
        const foldedMembers = new Set();
        for (let i = 0; i < out.length; i++) {
            const head = out[i];
            if (head.kind !== 'job' || head.job === undefined)
                continue;
            let end = i;
            while (end + 1 < out.length) {
                const next = out[end + 1];
                if (next.kind !== 'job' || next.job === undefined)
                    break;
                end++;
            }
            const count = end - i + 1;
            if (count < 2) {
                // A lone card renders exactly as it did before groups existed (no
                // rail, its own block margin). Nothing to clear: the decoration
                // lives on per-pass shallow copies, never on the shared rows.
                i = end;
                continue;
            }
            let running = 0;
            let completed = 0;
            let failed = 0;
            let killed = 0;
            let startedAt = Number.POSITIVE_INFINITY;
            let endedAt;
            for (let k = i; k <= end; k++) {
                const job = out[k].job;
                switch (job.status) {
                    case 'running':
                    case 'stopping':
                        running++;
                        break;
                    case 'completed':
                        completed++;
                        break;
                    case 'killed':
                        killed++;
                        break;
                    default:
                        failed++;
                }
                startedAt = Math.min(startedAt, job.startedAt);
                if (job.finishedAt !== undefined)
                    endedAt = Math.max(endedAt ?? job.finishedAt, job.finishedAt);
            }
            // A live member means the run is not over: no duration to freeze.
            if (running > 0)
                endedAt = undefined;
            // Fold policy (settings `dsh-tui.jobGroupFold`): `auto` waits for the
            // whole run to settle, `always` folds a run of 2+ immediately (live
            // members included — the header still reports what is running), and
            // `never` leaves the decision to a header click. Ctrl+O force-expands
            // every run; the header click lands in expandedRows.
            const foldMin = jobGroupFold === 'always' ? 2 : JOB_GROUP_FOLD_MIN;
            const folded = jobGroupFold !== 'never' && count >= foldMin &&
                (jobGroupFold === 'always' || running === 0) && !expanded && !expandedRows.has(head.id);
            for (let k = i; k <= end; k++) {
                // Copy-on-write: decorate a shallow copy. `out[k].jobGroup = …` in
                // place throws on the frozen rows the session projection delivers
                // (resume/replay), crashing the TUI at startup.
                out[k] = {
                    ...(out[k]),
                    jobGroup: {
                        head: k === i,
                        last: k === end,
                        count,
                        folded,
                        running,
                        completed,
                        failed,
                        killed,
                        startedAt,
                        ...(endedAt === undefined ? {} : { endedAt }),
                    },
                };
            }
            if (folded) {
                for (let k = i + 1; k <= end; k++)
                    foldedMembers.add(out[k].id);
            }
            i = end;
        }
        const visibleOut = foldedMembers.size === 0 ? out : out.filter(row => !foldedMembers.has(row.id));
        // Every rendered block gets a 1-row top margin except the first. Pre-pass
        // over the FULL list so a windowed row keeps the exact spacing it would
        // have in a fully-mounted list. Group members are the exception: they sit
        // flush under their head, which is the separator line the group removes.
        const margins = new Map();
        {
            let prev;
            for (const row of visibleOut) {
                const member = row.jobGroup !== undefined && !row.jobGroup.head;
                margins.set(row.id, prev !== undefined && !member);
                prev = row.kind;
            }
        }
        const streamBits = new Uint8Array(rows.length);
        for (let i = 0; i < rows.length; i++)
            streamBits[i] = rows[i].streaming === true ? 1 : 0;
        visibleRowsCacheRef.current = {
            rows,
            rowsLength: rows.length,
            showAll: showAll || hiddenCount <= 0,
            thinkingVisible,
            out: visibleOut,
            margins,
            streamBits,
            jobsSig,
            turnRowOn: turnUsageRow,
        };
        visGenRef.current++;
    }
    const visibleRows = visibleRowsCacheRef.current.out;
    const margins = visibleRowsCacheRef.current.margins;
    // Selection keeps its highlight; expanding a row adds no band of its own.
    // A tool card supplies the configured tool-card surface (and its diff line
    // tints) from the inside; the band itself stays limited to selection.
    const rowBackground = (rowId) => {
        const isSelected = selectedId === rowId;
        if (isSelected)
            return 'messageActionsBackground';
        return undefined;
    };
    // --- layout virtualization ---------------------------------------------
    const { columns, rows: termRows } = useTerminalSize();
    // Smooth-reveal wakeups: the scheduler's tick bumps this hook, re-running
    // MessageList so the revealed `text`/line-count reads below feed fresh
    // values through the same MemoRow-prop pipeline an arriving chunk uses —
    // memo miss → re-render → post-commit height re-measure. Without this
    // subscription a reveal living in child state would change row heights
    // invisibly to the virtualization (stale cached heights → blank bands).
    // DefaultLane on purpose (useRevealVersion): a useSyncExternalStore wakeup
    // would force a SyncLane render per 33ms tick, and each such commit ending
    // with streaming work still pending feeds React's nested-update counter
    // until error #185 kills the process (beta.3).
    useRevealVersion();
    // Measured row heights, remembered after a row unmounts so virtualization
    // can compute total content height. Bounded: row ids grow monotonically
    // and rows are never removed from the transcript (foldRows keeps the
    // row), so without a cap this Map grew by one entry per row forever.
    // Eviction is FIFO (oldest row first); a forgotten height falls back to
    // DEFAULT_ROW_HEIGHT, which only perturbs deep scrollback estimates.
    const HEIGHTS_CACHE_MAX = 5000;
    const heightsRef = React.useRef(new Map());
    /** Geometry version: bumped at EVERY heightsRef mutation so downstream
     *  memos (timeline tops) can key on it instead of re-deriving offsets. */
    const heightsVersionRef = React.useRef(0);
    const localRefs = React.useRef(new Map());
    /** Row ids that have been mounted (and therefore painted into the
     *  terminal) at least once. The sticky window may skip a row ONLY after
     *  this: an unpainted row above the window has no scrollback copy, so
     *  skipping it would erase it from the user's history entirely — preset
     *  history at boot (session resume) landed exactly there. Cleared when
     *  the list head changes identity (rewind / new session / loadOlder
     *  prepends restored rows that must paint again). */
    const paintedOnceRef = React.useRef(new Set());
    const paintedBaseRef = React.useRef(undefined);
    /** Window-expansion hold: after the window WIDENS (new rows mounted),
     *  refuse to tighten until a frame containing that layout has actually
     *  been FLUSHED to the terminal (flush-tick based, issue #574). React
     *  commits and terminal writes are decoupled — the throttled deferred
     *  leading edge lets a later commit supersede the wide one inside the
     *  same task, so a wall-clock hold (the old 120ms timer) expires during
     *  long cold-cache layout work (~190ms on the repro) and the measure-tick
     *  re-render still drops the rows before a single byte of them was
     *  written; never-mounted rows have no scrollback copy and preset history
     *  vanishes. Once flushed, tightening is visually free: those rows sit in
     *  scrollback and the diff skips them. */
    const lastStartRef = React.useRef(-1);
    const holdFlushTickRef = React.useRef(-1);
    /** True when frame-budgeted history painting still has batches left
     *  (main-screen open): the layout effect schedules the next slice. */
    const paintPendingRef = React.useRef(false);
    const paintTimerRef = React.useRef(null);
    /** Persistent history-paint edge: how far batched painting has advanced
     *  (index into visibleRows). -1 = not painting / reset (list head change:
     *  rewind, new session, loadOlder — must repaint from scratch). */
    const paintEdgeRef = React.useRef(-1);
    const listHeadId = visibleRows[0]?.id;
    if (listHeadId !== undefined && paintedBaseRef.current !== undefined && listHeadId !== paintedBaseRef.current) {
        paintedOnceRef.current = new Set();
        // History repaints from scratch after a head change too (rewind /
        // loadOlder prepends rows that must paint again).
        paintEdgeRef.current = -1;
    }
    if (listHeadId !== undefined)
        paintedBaseRef.current = listHeadId;
    /** Content-space offset of visibleRows[0] (header + dividers), measured. */
    const baseRef = React.useRef(null);
    const measureTimerRef = React.useRef(null);
    const [, setMeasureTick] = React.useState(0);
    const [, setScrollTick] = React.useState(0);
    // Holding a manual viewport against tail growth: once the user scrolls
    // up, content arriving at the bottom must not re-pin the transcript.
    const detachedRef = React.useRef(false);
    const lastScrollTopRef = React.useRef(null);
    React.useEffect(() => () => {
        if (measureTimerRef.current !== null) {
            clearTimeout(measureTimerRef.current);
            measureTimerRef.current = null;
        }
        if (paintTimerRef.current !== null) {
            clearTimeout(paintTimerRef.current);
            paintTimerRef.current = null;
        }
    }, []);
    // A width change reflows every row — all measurements are stale.
    const lastColumns = React.useRef(columns);
    if (lastColumns.current !== columns) {
        lastColumns.current = columns;
        heightsRef.current.clear();
        heightsVersionRef.current++;
        baseRef.current = null;
    }
    // --- layout signature: stale-height invalidation ------------------------
    // heightsRef entries outlive the commits that measured them, but many
    // state changes rewrite a row's height WITHOUT a columns change: Ctrl+O
    // (expanded), single-row expand (expandedRows), reasoning stream→fold,
    // a tool result/error/footnote arriving, diff layout switch, assistant
    // text growth, thinking visibility. A cached height from before such a
    // change feeds topPad/bottomPad spacers, the offsets scan, and the
    // ScrollBox clamps with geometry that no longer exists — blank bands,
    // overlapping rows, wrong scrollTop after toggles (the audit's stale
    // height cache). Track the inputs that decide each row's height; changes
    // invalidate the cache, except text-only growth of an active stream keeps
    // its last measured estimate until the mounted row is re-measured. The
    // window extension remounts invalidated rows for useLayoutEffect to measure.
    // Text identity uses length as an O(1) proxy — per-frame full-text
    // hashing over every row would defeat virtualization's budget, and a
    // same-length miss only degrades to the previous behavior.
    //
    // VECTORS, not strings: the cache stores the parts VECTOR and the
    // comparison is slot-by-slot — the unchanged case (every settled row on
    // every scroll tick) allocates nothing. A joined string per row per
    // render was O(rows) garbage per tick (3200-row session ⇒ several MB/s
    // into minor GC; the GC share of the scroll profile).
    const sigRef = React.useRef(new Map());
    let growingStreamNeedsMeasure = false;
    {
        const sigs = sigRef.current;
        for (let i = 0; i < visibleRows.length; i++) {
            const row = visibleRows[i];
            // Per-kind signature: only the inputs that row's OWN renderer consumes.
            // A global flat array (every field × every row) over-invalidates — a
            // /settings diffLayout switch used to drop every user/assistant/
            // reasoning height at once, remounting the widened window over rows
            // whose rendering never changed (Yoga spike + measure churn for
            // nothing). Base parts cover the universal height inputs.
            const parts = signatureParts(row, columns, expanded, expandedRows, streamViewToggledRows, thinkingVisible, thinkingFold, diffLayout, foldTerminalCommand, model, failureHintRowId, failureHint, revealDisplayLen(row, smoothStreaming), sessionCwd, fullscreen);
            const cachedParts = sigs.get(row.id);
            let same = false;
            if (cachedParts !== undefined && cachedParts.length === parts.length) {
                same = true;
                for (let s = 0; s < parts.length; s++) {
                    if (parts[s] !== cachedParts[s]) {
                        same = false;
                        break;
                    }
                }
            }
            if (same)
                continue;
            if (sigs.size >= HEIGHTS_CACHE_MAX) {
                const oldest = sigs.keys().next().value;
                if (oldest !== undefined)
                    sigs.delete(oldest);
            }
            // Copy out of the module-level scratch buffer — the next row reuses it.
            sigs.set(row.id, parts.slice());
            // Keep a streaming row's last measured extent when only its text grows.
            // If it leaves the mount window before the next measurement, falling
            // back to DEFAULT_ROW_HEIGHT would manufacture a content collapse.
            const growingStream = row.streaming === true && cachedParts !== undefined &&
                parts.length === cachedParts.length &&
                typeof parts[2] === 'number' && typeof cachedParts[2] === 'number' && parts[2] >= cachedParts[2] &&
                parts.every((part, index) => index === 2 || part === cachedParts[index]);
            // Keep a mounted row's estimate until the fresh Yoga read: falling back
            // here could eject still-visible rows from this render's mount window.
            // An unmounted row really paints the fallback spacer until it remounts.
            // Retaining an estimate must never skip the next fresh measurement.
            if (localRefs.current.has(row.id))
                growingStreamNeedsMeasure = true;
            else if (!growingStream)
                heightsRef.current.delete(row.id);
            heightsVersionRef.current++;
        }
    }
    // Scrolling bypasses React (imperative DOM scrollTop): subscribe so the
    // window follows the viewport.
    React.useEffect(() => {
        if (!scrollHandle)
            return;
        detachedRef.current = false;
        lastScrollTopRef.current = null;
        const tick = () => {
            const top = scrollHandle.getScrollTop();
            const max = Math.max(0, scrollHandle.getScrollHeight() - scrollHandle.getViewportHeight());
            if (lastScrollTopRef.current !== null && top < lastScrollTopRef.current - 1)
                detachedRef.current = true;
            if (top >= max - 1)
                detachedRef.current = false;
            lastScrollTopRef.current = top;
            setScrollTick(t => t + 1);
        };
        const unsubscribe = scrollHandle.subscribe(tick);
        tick();
        return unsubscribe;
    }, [scrollHandle]);
    // Cached rail/header preview per user row (see the timeline block for why
    // the length guard exists alongside the id key).
    const previewCacheRef = React.useRef(new Map());
    const heightOf = (row) => heightsRef.current.get(row.id) ?? DEFAULT_ROW_HEIGHT;
    // Reused offsets buffer: the prefix-scan itself must run every render
    // (heightsRef mutates in the measure effect), but the ARRAY need not be
    // fresh — offsets never escapes this render scope. A new 3200-slot array
    // per scroll tick was pure GC fodder.
    const offsetsBufRef = React.useRef([]);
    const offsets = offsetsBufRef.current;
    offsets.length = visibleRows.length;
    let total = 0;
    for (let i = 0; i < visibleRows.length; i++) {
        offsets[i] = total;
        total += heightOf(visibleRows[i]);
    }
    // Predict the anchor's signed offset delta before scanning the mount window.
    // A remeasured offscreen spacer must return its provisional shrink, not leave
    // the reader permanently over-corrected. Scan against the corrected position
    // so the anchor stays mounted; the layout effect refines that prediction
    // from fresh Yoga before paint. Never fight following, wheel debt, or a
    // position the user changed. A row below the viewport top (the header's
    // fallback pick) does not own the reader's position.
    const anchorRef = React.useRef(null);
    const scrollTopRaw = scrollHandle?.getScrollTop() ?? 0;
    const pending = scrollHandle?.getPendingDelta() ?? 0;
    const viewport = scrollHandle?.getViewportHeight() ?? 24;
    const sticky = (scrollHandle?.isSticky() ?? true) && !detachedRef.current;
    const base = baseRef.current ?? DEFAULT_HEADER_LINES;
    const prevAnchor = anchorRef.current;
    let anchorCorrection = 0;
    if (scrollHandle && prevAnchor !== null && prevAnchor.top <= prevAnchor.scrollTop &&
        !sticky && pending === 0 && scrollTopRaw === prevAnchor.scrollTop) {
        const anchored = visibleRows[prevAnchor.index];
        if (anchored !== undefined && anchored.id === prevAnchor.id) {
            anchorCorrection = prevAnchor.top - (base + (offsets[prevAnchor.index] ?? 0));
        }
    }
    const scrollTop = Math.max(0, scrollTopRaw - anchorCorrection);
    // Mount the union of the committed position and any in-flight pending
    // delta, plus overscan; when sticky, always reach the tail (streaming row).
    const relTop = Math.min(scrollTop, scrollTop + pending) - OVERSCAN_LINES - base;
    const relBottom = Math.max(scrollTop, scrollTop + pending) + viewport + OVERSCAN_LINES - base;
    let start = 0;
    while (start < visibleRows.length && offsets[start] + heightOf(visibleRows[start]) <= relTop)
        start++;
    // Resize invalidates cached heights, so a manual scrollTop can overshoot
    // the entire estimated list. Keep its last row mounted to re-measure:
    // an empty window has no measurement wakeup and collapses scrollHeight,
    // leaving the transcript blank and the gutter believing nothing scrolls.
    if (start === visibleRows.length && start > 0)
        start--;
    let end = start;
    while (end < visibleRows.length && offsets[end] < relBottom)
        end++;
    if (sticky || !scrollHandle)
        end = visibleRows.length;
    // Pinned to bottom: the tail row must stay mounted EVERY pass. The
    // streaming row's measured height only lands in heightsRef when it
    // survives mounted across two consecutive commits (useLayoutEffect reads
    // the previous Yoga pass). If an underestimated `total` ever lets relTop
    // overshoot it, start=len unmounts everything → content collapses to the
    // header → follow yanks scrollTop to 0 → next pass remounts all → follow
    // back to the real bottom: a self-sustaining ping-pong that blanks the
    // transcript mid-stream.
    if (sticky && visibleRows.length > 0) {
        // Sticky (follow-bottom): the viewport shows the TAIL of the content —
        // mount exactly the tail window the floor walk covers, not everything
        // from the scrollTop scan. Main-screen ScrollBox reports its viewport
        // as the CONTENT height (the terminal itself is the scroller), so both
        // the scan and an unclamped floor walk mount EVERY row in long
        // sessions — and React's commit traverses every fiber of every mounted
        // row per frame (measured as the dominant long-session stall). The
        // user only ever sees terminal rows: clamp the walk-back coverage to
        // the TERMINAL viewport plus overscan.
        start = Math.min(start, visibleRows.length - 1);
        // Blank-band guard: sticky scrollTop tracks the renderer's FRESH Yoga
        // scrollHeight, while these offsets use per-row heights measured one to
        // two commits late. During fast streaming the accurate scrollTop scans
        // deeper through the underestimated offsets than the real viewport does,
        // unmounting rows that are still on screen (visible spacer band). Walk
        // backwards from the tail with the known heights and mount at least one
        // terminal viewport plus overscan of content above it, so the window
        // can never open a gap inside what the user is looking at.
        let covered = Math.min(viewport, termRows) + OVERSCAN_LINES;
        let floor = visibleRows.length - 1;
        while (floor > 0 && covered > 0) {
            covered -= heightOf(visibleRows[floor]);
            floor--;
        }
        // The walk exhausted the whole list: every row is within coverage —
        // floor+1 here would drop row 0 (its content then has no terminal copy
        // anywhere; preset history lost its head — CI repro-inline-scrollback).
        start = floor === 0 && covered > 0 ? 0 : floor + 1;
        // Paint-at-least-once: extend the window over any row that has never
        // been mounted. A row the window skips keeps only its terminal/scrollback
        // copy — a row that was never painted has NO copy anywhere, so preset
        // history (session resume, repro-inline-scrollback's #39 family) would
        // vanish from the user's scrollback. Extending mounts everything above
        // on the first frame (topPad 0, full paint), then the set fills and the
        // window tightens to the tail.
        // MAIN-SCREEN ONLY (historyPaintEnabled): the alt-screen has no
        // scrollback — a row outside the window has no "copy" to preserve, and
        // mounting the whole fold window on open lexed/highlighted/laid out
        // hundreds of markdown rows the user never sees (measured: 4.3s of
        // saturated main thread before first paint on a 960-row session; the
        // virtualization window re-mounts rows on demand as they scroll in).
        // FRAME-BUDGETED: mounting the whole window in ONE commit saturated the
        // main thread for seconds (measured 6s wall with ZERO frames in the
        // first second on an 800-row inline open — every input queued behind
        // the React render). Extend in batches of ~2 viewports of measured
        // height per commit instead; the pending-batch effect schedules the
        // next slice, so the app paints, drains input, and stays interactive
        // while history streams in above the fold (opencode-style progressive
        // transcript hydration; the terminal accepts rows whenever they land).
        const paintedOnce = paintedOnceRef.current;
        let paintPending = false;
        if (historyPaintEnabled) {
            // Persistent batch edge: the sticky floor-walk RESETS start to the
            // tail every frame, so a per-frame budget walk from `start` re-spends
            // its whole budget on already-painted rows and never reaches deeper
            // unpainted ones (measured: an infinite 0.3ms/frame batch loop).
            // Remember how far painting has advanced; each batch extends THAT
            // edge upward by the budget.
            if (paintEdgeRef.current < 0)
                paintEdgeRef.current = start;
            let firstUnpainted = -1;
            for (let i = 0; i < paintEdgeRef.current; i++) {
                if (!paintedOnce.has(visibleRows[i].id)) {
                    firstUnpainted = i;
                    break;
                }
            }
            if (firstUnpainted !== -1) {
                // Budget: extend the paint edge upward by ~half a viewport of
                // measured content per commit (height estimates; unknown rows fall
                // back to DEFAULT_ROW_HEIGHT and over-mount slightly — harmless).
                // Measured: larger batches (2 viewports) put 50ms+ of first-wrap
                // yoga into one frame; half a viewport keeps batches near the
                // 16ms frame budget while still finishing an 800-row open in
                // well under two seconds of background batches.
                let budget = Math.min(viewport, termRows) / 2 + OVERSCAN_LINES;
                let j = paintEdgeRef.current;
                while (j > firstUnpainted && budget > 0) {
                    j--;
                    budget -= heightOf(visibleRows[j]);
                }
                paintEdgeRef.current = j;
                start = Math.min(start, j);
                paintPending = j > 0;
            }
        }
        else {
            paintEdgeRef.current = -1;
        }
        paintPendingRef.current = paintPending;
        // Unknown-height extension (layout signature, see sigRef): a row whose
        // cached height was just INVALIDATED must remount to re-measure even
        // when it sits outside the window — its spacer otherwise falls back to
        // DEFAULT_ROW_HEIGHT until the row scrolls back into view, leaving the
        // content geometry wrong for exactly that long (blank band after
        // Ctrl+O, unreachable scroll bottom after a tool result lands). One
        // remount per change; the measure tick + hold then tighten again.
        // Guard 1: only rows that have actually MOUNTED here once qualify
        // (paintedOnce fills from localRefs post-commit) — a brand-new
        // streaming row has never been measured, and extending over it would
        // mount everything below the window every frame while the user reads
        // scrolled-up (virtualization defeated, per-frame full mount = the
        // long-session stall). New rows keep the original path: their height
        // lands once the window reaches them.
        // Guard 2: rows actively STREAMING are skipped too. A streaming row's
        // signature invalidates EVERY chunk (text length grows), so a painted
        // streaming row below/above the window remounted per chunk — full
        // markdown re-lex + wrap of the whole growing text, invisible to the
        // user reading history (measured: 3s of streaming while scrolled up
        // burned 2.5s of yoga and +84MB heap). Its height is in flux anyway;
        // the final settle invalidates once more and remounts exactly once.
        for (let i = 0; i < start; i++) {
            if (visibleRows[i].streaming === true)
                continue;
            const rowId = visibleRows[i].id;
            if (!heightsRef.current.has(rowId) && paintedOnceRef.current.has(rowId)) {
                start = i;
                break;
            }
        }
        // Expansion hold — AFTER the extension so it tracks the FINAL window:
        // never tighten past a widen until a frame with that layout has been
        // flushed (getTerminalFlushTick advanced since the widen). A mount
        // followed by the measure-tick re-render that drops the row paints only
        // the DROPPED layout, and the row's painted-once mark (set at the first
        // commit) is a lie; holding until the flush makes the mark real.
        if (lastStartRef.current >= 0 &&
            start > lastStartRef.current &&
            getTerminalFlushTick() === holdFlushTickRef.current) {
            start = lastStartRef.current;
        }
        if (lastStartRef.current < 0 || start < lastStartRef.current) {
            holdFlushTickRef.current = getTerminalFlushTick();
        }
        lastStartRef.current = start;
    }
    // Tail-side invalidated-height extension (see the start-side loop above
    // for the rationale and both guards): rows BELOW the window whose height
    // was just invalidated remount to re-measure, so bottomPad keeps real
    // geometry while the user reads scrolled-up content and the tail streams.
    // Runs for non-sticky views; sticky mounts the tail anyway. Streaming
    // rows are skipped — THIS loop is the measured hot path of the
    // read-while-streaming stall (the streaming tail row sits below the
    // window and invalidated per chunk).
    for (let i = end; i < visibleRows.length; i++) {
        if (visibleRows[i].streaming === true)
            continue;
        const rowId = visibleRows[i].id;
        if (!heightsRef.current.has(rowId) && paintedOnceRef.current.has(rowId))
            end = i + 1;
    }
    if (forceMountRowId !== undefined && forceMountRowId !== null) {
        const idx = visibleRows.findIndex(row => row.id === forceMountRowId);
        if (idx !== -1) {
            start = Math.min(start, idx);
            end = Math.max(end, idx + 1);
        }
    }
    // The failure footnote is row content, not a seek request. Pinning its
    // row also mounted EVERY later tool card until the trajectory was opened,
    // defeating virtualization for the rest of a tool-heavy conversation.
    // It reappears when scrolled into view; only forceMountRowId widens for a seek.
    const topPad = offsets[start] ?? 0;
    const mountedBottom = end < visibleRows.length ? offsets[end] : total;
    const bottomPad = total - mountedBottom;
    noteListGeometry({
        start,
        end,
        topPad,
        bottomPad,
        total,
        base,
        sticky,
        pending,
        viewport,
        termRows,
        columns,
        rowCount: visibleRows.length,
    });
    // New-messages pill count: rows past the seen-anchor whose top edge is
    // still below the viewport bottom. Same rows-space math as the window
    // (offsets are rows-space, scrollTop content-space — subtract the header
    // base). Decrements as the user scrolls down through the new rows; 0 once
    // every new row has appeared on screen. Reported post-commit (parent
    // setState with an unchanged value is a React no-op, so the per-render
    // effect only re-renders on actual count changes).
    let unseenCount = 0;
    if (newSinceRowId !== null && newSinceRowId !== undefined) {
        const firstNew = visibleRows.findIndex(row => row.id > newSinceRowId);
        if (firstNew !== -1) {
            const seenBottom = scrollTop + viewport - base;
            for (let i = firstNew; i < visibleRows.length; i++) {
                if (offsets[i] >= seenBottom)
                    unseenCount++;
            }
        }
    }
    const lastUnseenReportRef = React.useRef(-1);
    React.useEffect(() => {
        if (unseenCount !== lastUnseenReportRef.current) {
            lastUnseenReportRef.current = unseenCount;
            onUnseenCount?.(unseenCount);
        }
    });
    // Conversation timeline snapshot: one entry per user turn (stable id +
    // content-space text top + preview), plus the viewport-derived targets
    // consumed by BOTH the sticky prompt header (active) and the transcript
    // turn rail (active highlight, ▲/▼). Top-anchored semantics (Grok
    // timeline): active = the LAST turn whose prompt top is at-or-above the
    // viewport top — the turn whose content owns the top row, "the turn
    // being read" — with the first turn standing in while pre-turn content
    // (logo / loaded-context) owns the top. The highlight moves only when a
    // turn boundary crosses the viewport top, never when a later prompt
    // merely becomes visible lower on screen, so it cannot leap when
    // nudging off the bottom and the header/rail can never disagree. The
    // projected top (scrollTop + pending) is used so boundary crossings
    // register during wheel bursts, not one drain frame late. Same
    // rows-space math as the mount window (offsets are rows-space,
    // scrollTop content-space — add the header base). downId additionally
    // requires the turn's top ≤ maxScroll: the renderer clamps scrollTop
    // there, so a turn past it could never own the top row, and naming it
    // would make ▼ repeat itself forever (the stuck-▼ bug). Reported
    // post-commit, only when the signature changes.
    let timelineTurns = [];
    let activeTurnIndex = null;
    let pinnedTurnIndex = null;
    let upTurnIndex = null;
    let downTurnIndex = null;
    const timelineMemoRef = React.useRef(null);
    {
        // Split into (a) a GEOMETRY-memoized turns list and (b) a per-frame
        // allocation-free target scan. Before the split this block rebuilt on
        // EVERY scroll tick: an 800-object turns array, an 800-entry
        // measuredTops Map, and the report effect's turns.map().join('|')
        // signature — several hundred KB of churn per second of scrolling on a
        // tool-heavy session.
        //
        // (a) turns/tops/folded change ONLY when geometry changes: row heights
        // (heightsVersion — bumped at every heightsRef mutation), the visible
        // window's content (visGen — bumped when the visibleRows cache
        // rebuilds), the measured header base, or the rows array growing. Key
        // on those and the language used by image-only previews.
        const memo = timelineMemoRef.current;
        const memoKey = `${visGenRef.current}:${heightsVersionRef.current}:${base}:${rows.length}:${columns}:${lang}`;
        if (memo === null || memo.key !== memoKey) {
            const previewCache = previewCacheRef.current;
            if (previewCache.size > 2000)
                previewCache.clear();
            // Measured tops for turns INSIDE the fold window (user rows are never
            // filtered by the thinking toggle, so a user row absent from
            // visibleRows is exactly a folded one).
            const measuredTops = new Map();
            for (let i = 0; i < visibleRows.length; i++) {
                const row = visibleRows[i];
                if (!isTurnRow(row))
                    continue;
                measuredTops.set(row.id, base + offsets[i] + (margins.get(row.id) === true ? 1 : 0));
            }
            // Walk ALL rows (not the fold window): the rail must cover the whole
            // conversation — a tool-heavy session packs 300 rows into a handful
            // of turns, and window-only turns made the rail show "2-3 nodes".
            // Folded turns carry folded:true + top:-1; their tops are unknown
            // until revealed (they are all ABOVE the viewport, so active/down
            // over measured turns is unaffected; ▲ may name a folded turn — its
            // click goes through the reveal path, not scrollTo).
            const turns = [];
            for (const row of rows) {
                if (!isTurnRow(row))
                    continue;
                let cached = previewCache.get(row.id);
                const imageCount = row.images?.length ?? 0;
                if (cached === undefined || cached.len !== row.text.length || cached.imageCount !== imageCount || cached.lang !== lang) {
                    cached = {
                        len: row.text.length,
                        imageCount,
                        lang,
                        preview: row.text === '' && imageCount > 0
                            ? t('transcript-image-message', { count: imageCount })
                            : clipPreview(row.text),
                    };
                    previewCache.set(row.id, cached);
                }
                const textTop = measuredTops.get(row.id);
                if (textTop !== undefined) {
                    turns.push({ id: row.id, top: textTop, preview: cached.preview });
                }
                else {
                    turns.push({ id: row.id, top: -1, preview: cached.preview, folded: true });
                }
            }
            timelineMemoRef.current = { key: memoKey, turns };
        }
        timelineTurns = timelineMemoRef.current.turns;
        // (b) per-frame target scan — pure integer comparisons over the
        // memoized list; viewTop is projected (scrollTop + pending) so
        // boundary crossings register during wheel bursts, not one drain
        // frame late. downId additionally requires top ≤ maxScroll: the
        // renderer clamps scrollTop there, so a turn past it could never own
        // the top row, and naming it would make ▼ repeat itself forever.
        const viewTop = scrollTop + pending;
        const maxScroll = Math.max(0, (scrollHandle?.getScrollHeight() ?? 0) - viewport);
        for (let i = 0; i < timelineTurns.length; i++) {
            const t = timelineTurns[i];
            if (t.folded === true) {
                // Above the fold ⇒ strictly above the viewport: a legal ▲ target.
                upTurnIndex = i;
                continue;
            }
            if (t.top <= viewTop)
                activeTurnIndex = i;
            if (t.top < viewTop)
                upTurnIndex = i;
            if (downTurnIndex === null && t.top > viewTop && t.top <= maxScroll) {
                downTurnIndex = i;
            }
        }
        if (timelineTurns.length > 0 && activeTurnIndex === null)
            activeTurnIndex = 0;
        if (activeTurnIndex !== null) {
            const active = timelineTurns[activeTurnIndex];
            if (active.folded === true || active.top < viewTop)
                pinnedTurnIndex = activeTurnIndex;
        }
    }
    const timeline = {
        turns: timelineTurns,
        activeId: activeTurnIndex === null ? null : timelineTurns[activeTurnIndex].id,
        pinnedId: pinnedTurnIndex === null ? null : timelineTurns[pinnedTurnIndex].id,
        upId: upTurnIndex === null ? null : timelineTurns[upTurnIndex].id,
        downId: downTurnIndex === null ? null : timelineTurns[downTurnIndex].id,
    };
    const lastTimelineReportRef = React.useRef(null);
    React.useEffect(() => {
        // Value-level dedup, not geometry-key-level: the memo key pins to
        // heightsVersion, which a GROWING streamed row bumps on every commit,
        // so a key-pinned signature re-reports an identical snapshot every
        // commit of a long stream. Each report is a setState dispatched into
        // Chat from this passive effect; it lands as pending residue at commit
        // end, keeping the commit dirty and feeding React's nested-update
        // counter (50 consecutive dirty commits → error #185, the beta.3
        // crash). The O(turns) compare below is integer/string-reference
        // compares only — cheap next to the joined-string signature the memo
        // key replaced, and it fires exactly when the snapshot content changes.
        const prev = lastTimelineReportRef.current;
        if (prev !== null &&
            prev.activeId === timeline.activeId &&
            prev.pinnedId === timeline.pinnedId &&
            prev.upId === timeline.upId &&
            prev.downId === timeline.downId &&
            prev.turns.length === timeline.turns.length &&
            prev.turns.every((t, i) => {
                const n = timeline.turns[i];
                return t.id === n.id && t.top === n.top && t.folded === n.folded && t.preview === n.preview;
            }))
            return;
        lastTimelineReportRef.current = timeline;
        onTimeline?.(timeline);
    });
    // Scroll anchoring, commit half of the render-time pass above.
    // Post-commit: measure mounted rows, derive the content-space base from
    // the first mounted row's Yoga top, and clamp render-time scrollTop to the
    // mounted coverage so burst scrolls never show blank spacer.
    React.useLayoutEffect(() => {
        let changed = false;
        // Mounted ⇒ painted: record rows eligible for window skipping.
        const paintedOnce = paintedOnceRef.current;
        for (const id of localRefs.current.keys()) {
            if (!paintedOnce.has(id))
                paintedOnce.add(id);
        }
        for (const [id, el] of localRefs.current) {
            const h = el.yogaNode?.getComputedHeight();
            if (h !== undefined && h > 0 && heightsRef.current.get(id) !== h) {
                if (heightsRef.current.size >= HEIGHTS_CACHE_MAX) {
                    const oldest = heightsRef.current.keys().next().value;
                    if (oldest !== undefined)
                        heightsRef.current.delete(oldest);
                }
                heightsRef.current.set(id, h);
                heightsVersionRef.current++;
                changed = true;
            }
        }
        const firstMounted = visibleRows[start];
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- runtime guard: empty list window
        const firstEl = firstMounted ? localRefs.current.get(firstMounted.id) : undefined;
        const top = firstEl?.yogaNode?.getComputedTop();
        if (top !== undefined) {
            const measured = top - (offsets[start] ?? 0);
            if (baseRef.current !== measured) {
                baseRef.current = measured;
                changed = true;
            }
        }
        if (scrollHandle) {
            // Fresh bounds must move with a prefix's real height, too: an estimated
            // max can otherwise clamp away a positive correction larger than overscan.
            const mountedTop = top ?? base + topPad;
            const lastMounted = visibleRows[end - 1];
            const lastYoga = lastMounted ? localRefs.current.get(lastMounted.id)?.yogaNode : undefined;
            const mountedEnd = lastYoga === undefined
                ? base + mountedBottom
                : lastYoga.getComputedTop() + lastYoga.getComputedHeight();
            if (sticky || (start === 0 && end >= visibleRows.length)) {
                // Sticky still needs the MIN clamp: the first wheel-up breaks sticky
                // on the DOM (ScrollBox.scrollBy) several frames before React
                // commits a new mount window, and the drain frames in between paint
                // unmounted spacer rows as a blank band. Clamping to the currently
                // mounted top shows the edge content until React catches up - same
                // behavior as the steady-state scroll path. The MAX clamp stays
                // disabled: sticky follow pushes scrollTop to each frame's new
                // maxScroll, which a stale mounted max would clamp away.
                const min = start > 0 ? Math.max(0, mountedTop - viewport) : undefined;
                scrollHandle.setClampBounds(min, undefined);
            }
            else {
                // With no top spacer, the mounted header must remain reachable at Home.
                const min = start > 0 ? Math.max(0, mountedTop - viewport) : 0;
                // Upper clamp only while unmounted content remains below the window
                // (bottomPad spacer): it exists to pin the paint to the mounted edge
                // during burst scrolls that outrun React's window re-render. Once the
                // tail is fully mounted (bottomPad 0) there IS no unmounted gap — the
                // estimated `mountedBottom` can sit a line short of the real Yoga
                // extent (engine flex-basis cache vs final child layout drift, see
                // render-node-to-output's scrollHeight floor), and an estimated clamp
                // would then cull the last line at every non-sticky paint — the
                // scrolled-away-and-back tail loss. Leave the max open; the renderer
                // still caps at the frame's real maxScroll.
                scrollHandle.setClampBounds(min, bottomPad <= 0 ? undefined : Math.max(min, mountedEnd - viewport));
            }
            // Yoga is fresh even when this render retained an old height estimate.
            // Refine the prediction before paint, not on the later measure tick, and
            // recheck input intent in case scrolling moved between render and commit.
            const anchorBase = baseRef.current ?? base;
            let anchoredTop = scrollHandle.getScrollTop();
            if (prevAnchor !== null && prevAnchor.top <= prevAnchor.scrollTop &&
                visibleRows[prevAnchor.index]?.id === prevAnchor.id &&
                !scrollHandle.isSticky() && scrollHandle.getPendingDelta() === 0 &&
                anchoredTop === prevAnchor.scrollTop) {
                const measuredTop = localRefs.current.get(prevAnchor.id)?.yogaNode?.getComputedTop();
                const correction = measuredTop === undefined ? anchorCorrection : prevAnchor.top - measuredTop;
                if (correction !== 0) {
                    scrollHandle.anchorBy(-correction);
                    anchoredTop = scrollHandle.getScrollTop();
                }
            }
            else if (anchorCorrection !== 0) {
                changed = true;
            }
            // Pick and record in the same fresh coordinates as the correction.
            // Recording old offsets after a fresh read would consume that delta again.
            let pick = start;
            let pickedTop = anchorBase + (offsets[start] ?? 0);
            for (let i = start; i < end; i++) {
                const row = visibleRows[i];
                const rowTop = localRefs.current.get(row.id)?.yogaNode?.getComputedTop() ?? anchorBase + (offsets[i] ?? 0);
                if (i === start || rowTop <= anchoredTop) {
                    pick = i;
                    pickedTop = rowTop;
                }
                if (rowTop > anchoredTop)
                    break;
            }
            const picked = visibleRows[pick];
            anchorRef.current = picked === undefined
                ? null
                : { id: picked.id, index: pick, top: pickedTop, scrollTop: anchoredTop };
        }
        if ((changed || growingStreamNeedsMeasure) && measureTimerRef.current === null) {
            // Layout corrections can cascade for many rows. Yield to the next
            // macrotask so React does not count the valid convergence as nested
            // updates when a streaming/reveal commit is already in flight.
            measureTimerRef.current = setTimeout(() => {
                measureTimerRef.current = null;
                noteFrameCause('measure');
                setMeasureTick(t => t + 1);
            }, 0);
        }
        // History-paint continuation (main-screen open): more never-painted
        // batches remain — schedule the next slice on the macrotask queue so
        // pending input events (wheel, keys) drain between batches and the app
        // stays interactive while preset history streams in. A timeout of 0 is
        // enough: each batch's mount+measure work is bounded (~2 viewports),
        // unlike the previous single-commit full mount that saturated the main
        // thread for seconds.
        if (paintPendingRef.current && paintTimerRef.current === null) {
            paintTimerRef.current = setTimeout(() => {
                paintTimerRef.current = null;
                if (!paintPendingRef.current)
                    return;
                noteFrameCause('measure');
                setMeasureTick(t => t + 1);
            }, 0);
        }
    });
    // useCallback: the reference feeds MemoRow's shallow compare; a fresh
    // closure per render would defeat every row's memo.
    const setRowRef = React.useCallback((rowId, el) => {
        if (el)
            localRefs.current.set(rowId, el);
        else
            localRefs.current.delete(rowId);
        registerRowRef?.(rowId, el);
    }, [registerRowRef]);
    return (_jsxs(_Fragment, { children: [(olderHistory === true || rows.some(row => row.folded)) && (_jsx(ClickableDivider, { title: t('load-earlier'), onClick: onLoadOlder })), !showAll && hiddenCount > 0 && (_jsx(ClickableDivider, { title: t('show-previous-messages', { n: hiddenCount, key: primaryComboString('showAll') }), onClick: onToggleAll })), topPad > 0 && _jsx(Box, { height: topPad, flexShrink: 0 }), visibleRows
                .slice(start, end)
                .map((row) => {
                // The pre-pass result keeps windowed rows at full-mount
                // spacing; only the very first row of the whole list has none.
                const marginTopOnTurn = margins.get(row.id) === true;
                const tool = row.tool;
                const subagent = row.kind === 'subagent' ? row.subagent : undefined;
                const job = row.kind === 'job' ? row.job : undefined;
                const jobGroup = row.kind === 'job' ? row.jobGroup : undefined;
                const revealVersion = smoothStreaming && row.kind === 'tool' && row.fresh === true &&
                    row.tool?.status === 'running' && row.tool.resultView === undefined
                    ? getRevealVersion()
                    : 0;
                // Smooth reveal feeds the SAME flattened text prop a chunk feeds,
                // and keeps the streaming layout alive until the reveal catches up
                // (settling mid-reveal must not snap — a one-shot non-streaming
                // delivery still paints as a flow).
                let displayText = row.text;
                let displayStreaming = row.streaming === true;
                if (row.kind === 'assistant' && smoothStreaming) {
                    const stripped = assistantDisplayText(row);
                    displayText = revealTextOf(`a${row.id}`, stripped, {
                        enabled: true,
                        active: displayStreaming || row.fresh === true,
                    });
                    displayStreaming = displayStreaming || displayText.length !== stripped.length;
                }
                else if (row.kind === 'assistant') {
                    displayText = assistantDisplayText(row);
                }
                else if (row.kind === 'reasoning' && smoothStreaming) {
                    displayText = revealTextOf(`r${row.id}`, row.text, { enabled: true, active: displayStreaming });
                }
                return (_jsx(MemoRow, { rowId: row.id, kind: row.kind, text: displayText, interruptBackend: row.interruptBackend, images: row.images, textFull: row.kind === 'reasoning' ? row.text : undefined, executionTarget: row.executionTarget, selectionAttached: row.selectionAttached, sender: teamSenderOf(row), streaming: displayStreaming, thinkingOpen: row.thinkingOpen === true, durationMs: row.durationMs, reasoningTokens: row.reasoningTokens, time: row.time, marginTopOnTurn: marginTopOnTurn, isSelected: selectedId === row.id, isExpanded: expandedRows.has(row.id), expanded: expanded, model: model, diffLayout: diffLayout, thinkingFold: thinkingFold, toolBackground: toolBackground, foldTerminalCommand: foldTerminalCommand, smoothStreaming: smoothStreaming, fresh: row.fresh === true, revealVersion: revealVersion, activityFrames: activityFrames, background: rowBackground(row.id), toolCallId: tool?.callId, toolName: tool?.name, toolArgsText: tool?.argsText, toolArgsFull: tool?.argsFull, toolStatus: tool?.status, toolResultText: tool?.resultText, toolResultFull: tool?.resultFull, toolErrorText: tool?.errorText, toolFootnote: failureHintRowId === row.id ? failureHint : undefined, toolCallView: tool?.callView, toolResultView: tool?.resultView, toolStartedAt: tool?.startedAt, toolDurationMs: tool?.durationMs, toolSourceFolded: row.folded === true, toolLiveOutput: tool?.liveOutput, toolLiveOutputDropped: tool?.liveOutputDropped, fullscreen: fullscreen, turnUsage: row.turnUsage, subagent: subagent, job: job, jobGroup: jobGroup, onToggleRow: onToggleRow, onToggleStreamView: onToggleStreamView, streamViewToggled: streamViewToggledRows.has(row.id), onOpenSubagent: onOpenSubagent, onOpenSubagentView: onOpenSubagentView, onOpenJobs: onOpenJobs, onWatchJobOutput: onWatchJobOutput, onOpenFile: onOpenFile, sessionCwd: sessionCwd, onPreviewImage: onPreviewImage, suppressImageGraphics: suppressImageGraphics, setRowRef: setRowRef }, row.id));
            }), bottomPad > 0 && _jsx(Box, { height: bottomPad, flexShrink: 0 })] }));
}
/** Load-earlier / show-previous divider row with a mouse hover tint — the
 *  clickability is otherwise invisible (audit C-04). */
function ClickableDivider({ title, onClick }) {
    const [hovered, setHovered] = useState(false);
    return (_jsx(Box, { marginTop: 1, onClick: onClick, onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false), backgroundColor: hovered ? 'userMessageBackgroundHover' : undefined, children: _jsx(Divider, { title: title }) }));
}
function TranscriptRow({ rowId, kind, text, interruptBackend, images, textFull, executionTarget, selectionAttached, sender, sessionCwd, streaming, thinkingOpen, durationMs, reasoningTokens, time, marginTopOnTurn, isSelected, isExpanded, expanded, model, diffLayout, smoothStreaming, fresh, revealVersion, thinkingFold, toolBackground, foldTerminalCommand, activityFrames, background, toolCallId, toolName, toolArgsText, toolArgsFull, toolStatus, toolResultText, toolResultFull, toolErrorText, toolFootnote, toolCallView, toolResultView, toolStartedAt, toolDurationMs, toolSourceFolded, toolLiveOutput, toolLiveOutputDropped, fullscreen, turnUsage, subagent, job, jobGroup, onToggleRow, onToggleStreamView, streamViewToggled, onOpenSubagent, onOpenSubagentView, onOpenJobs, onWatchJobOutput, onOpenFile, onPreviewImage, suppressImageGraphics, setRowRef, }) {
    const ref = React.useCallback((el) => {
        setRowRef(rowId, el);
    }, [setRowRef, rowId]);
    // 可折叠行（工具卡/思考/compact 摘要）共用：点击切换展开，全宽行右侧
    // 空白（屏幕缓冲未写入单元格）不触发——点击空白想选字/拖拽时不再误触
    // 展开/收起（审计 C-03/cellIsBlank 零消费）。纯文本行（user/assistant）
    // 平时不可点：转录是阅读区（用户反馈），折叠语义留给带视觉指示的行——
    // 唯一例外是**被折叠的超长单行**：那时整行就是展开开关（见 foldClickable）。
    const foldOnClick = React.useCallback((event) => {
        if (event.cellIsBlank)
            return;
        onToggleRow(rowId);
    }, [onToggleRow, rowId]);
    // 当前回合仍展开的 reasoning 行：点击在三行预览/全文间切换。它反转
    // thinkingFold 的默认值，回合落定后语义自动回到 foldOnClick。
    const streamViewOnClick = React.useCallback((event) => {
        if (event.cellIsBlank)
            return;
        onToggleStreamView(rowId);
    }, [onToggleStreamView, rowId]);
    // 任务组：点击组头行折叠/展开整组（与工具卡的折叠同一套手势：行点击 =
    // expandedRows 切换，Ctrl+O 展开全部）。
    const toggleJobGroup = React.useCallback(() => {
        onToggleRow(rowId);
    }, [onToggleRow, rowId]);
    // 子代理卡：点击打开详情场景（不是折叠）。
    const openSubagent = React.useCallback(() => {
        if (subagent !== undefined)
            onOpenSubagent?.(subagent.agentId);
    }, [onOpenSubagent, subagent]);
    // compact 摘要折叠行 hover 轻指示（∴ 提亮，不刷背景）。
    const [compactHovered, setCompactHovered] = useState(false);
    // Long single lines are clipped before layout (utils/fold-long-lines.ts):
    // one 300k-char paste or minified-JS line otherwise wraps into thousands of
    // visual rows and that per-frame wrap — not the row count — dominates the
    // frame. Ctrl+O (global) AND a row click (per-row, the same `expandedRows`
    // gesture message-selection mode uses) both paint the raw text again.
    // Reasoning rows are deliberately excluded: their preview is already a fixed
    // three-row ticker. Tool cards fold inside their own header/body
    // (AssistantToolUseMessage), whose text never rides this prop.
    // `lang` is a dependency because the fold marker is localized: a row that
    // re-renders unchanged after /lang must not keep the previous language.
    const lang = getLang();
    const foldable = kind !== 'reasoning' && kind !== 'tool';
    const folded = React.useMemo(() => (foldable ? foldLongLines(text) : { text, hiddenChars: 0, foldedLines: 0 }), [foldable, text, lang]);
    const displayText = expanded || isExpanded ? text : folded.text;
    // Mouse toggle: only a row that ACTUALLY hides something is clickable (an
    // ordinary message stays inert so plain clicks and drag-selection keep
    // working there). A streaming row is clickable too — the same contract the
    // tool card has while running: the click paints the full ARRIVED text, and
    // the reveal keeps growing it.
    const foldClickable = foldable && folded.hiddenChars > 0;
    switch (kind) {
        case 'user':
            return (_jsxs(Box, { flexDirection: "column", ref: ref, onClick: foldClickable ? foldOnClick : undefined, children: [selectionAttached && (_jsxs(Text, { dimColor: true, children: ['⧉ ', t('selection-attached', {
                                lines: selectionAttached.lines,
                                count: selectionAttached.lines,
                                path: displaySelectionPath(selectionAttached.path, sessionCwd),
                            })] })), text !== '' && sender !== undefined && (_jsx(TeamMessageBubble, { sender: sender, text: displayText, marginTopOnTurn: marginTopOnTurn, isSelected: isSelected })), text !== '' && sender === undefined && (_jsx(UserPromptMessage, { text: displayText, marginTopOnTurn: marginTopOnTurn, isSelected: isSelected })), images !== undefined && (_jsx(Box, { marginTop: text === '' && marginTopOnTurn ? 1 : 0, children: _jsx(TranscriptImages, { images: images, onPreview: onPreviewImage, suppressGraphics: suppressImageGraphics }) }))] }));
        case 'assistant':
            return streaming ? (_jsxs(Box, { alignItems: "flex-start", flexDirection: "row", marginTop: marginTopOnTurn ? 1 : 0, width: "100%", backgroundColor: background, ref: ref, onClick: foldClickable ? foldOnClick : undefined, children: [_jsx(Box, { minWidth: 2, children: _jsx(Text, { color: "text", children: "\u25CF" }) }), _jsxs(Box, { flexDirection: "column", children: [_jsx(StreamingMarkdown, { children: displayText }), images !== undefined && _jsx(TranscriptImages, { images: images, indent: 0, onPreview: onPreviewImage, suppressGraphics: suppressImageGraphics })] })] })) : (_jsxs(Box, { width: "100%", flexDirection: "column", backgroundColor: background, ref: ref, onClick: foldClickable ? foldOnClick : undefined, children: [expanded && (_jsx(Box, { flexDirection: "row", justifyContent: "flex-end", gap: 1, marginTop: 1, children: _jsx(MessageMetadata, { timestamp: time, model: model }) })), _jsx(AssistantTextLeafRow, { text: displayText, marginTopOnTurn: marginTopOnTurn, isSelected: isSelected, isExpanded: isExpanded }), images !== undefined && _jsx(TranscriptImages, { images: images, onPreview: onPreviewImage, suppressGraphics: suppressImageGraphics })] }));
        case 'reasoning': {
            // The setting chooses the live default; a row click reverses it. Global
            // or per-row transcript expansion always wins and shows the full text.
            const turnOpen = streaming || thinkingOpen;
            const streamPreview = turnOpen && !expanded && !isExpanded &&
                (streamViewToggled ? thinkingFold === 'full' : thinkingFold === 'preview');
            return (_jsx(Box, { flexDirection: "column", ref: ref, children: _jsx(ThinkingLeafRow, { thinking: text, textFull: textFull, marginTopOnTurn: marginTopOnTurn, streaming: streaming, preview: streamPreview, 
                    // Settled rows keep the fold-on-settle default and expand via
                    // expandedRows/Ctrl+O; a current-turn row is preview or full.
                    verbose: isExpanded || expanded || (turnOpen && !streamPreview), durationMs: durationMs, reasoningTokens: reasoningTokens, isSelected: isSelected, onClick: turnOpen ? streamViewOnClick : foldOnClick }) }));
        }
        case 'tool': {
            if (toolCallId === undefined ||
                toolName === undefined ||
                toolArgsText === undefined ||
                toolStatus === undefined ||
                toolStartedAt === undefined) {
                return null;
            }
            // Rebuilt per render from the flattened props — cheap object literal,
            // and AssistantToolUseMessage is only reached when memo let us through.
            const tool = {
                callId: toolCallId,
                name: toolName,
                argsText: toolArgsText,
                argsFull: toolArgsFull,
                status: toolStatus,
                resultText: toolResultText,
                resultFull: toolResultFull,
                errorText: toolErrorText,
                callView: toolCallView,
                resultView: toolResultView,
                startedAt: toolStartedAt,
                durationMs: toolDurationMs,
                ...(toolLiveOutput === undefined ? {} : { liveOutput: toolLiveOutput }),
                ...(toolLiveOutputDropped === undefined ? {} : { liveOutputDropped: toolLiveOutputDropped }),
            };
            return (_jsx(Box, { flexDirection: "column", ref: ref, children: _jsx(ToolLeafRow, { tool: tool, marginTopOnTurn: marginTopOnTurn, verbose: isExpanded || expanded, isSelected: isSelected, isExpanded: isExpanded, footnote: toolFootnote, diffLayout: diffLayout, toolBackground: toolBackground, smoothReveal: smoothStreaming, fresh: fresh, revealVersion: revealVersion, foldTerminalCommand: foldTerminalCommand, onClick: foldOnClick, onOpenFile: onOpenFile, images: images, onPreviewImage: onPreviewImage, suppressImageGraphics: suppressImageGraphics, sourceFolded: toolSourceFolded, fullscreen: fullscreen }) }));
        }
        case 'notice':
            return (_jsx(Box, { marginTop: 1, ref: ref, onClick: foldClickable ? foldOnClick : undefined, children: _jsx(Divider, { title: ` ${displayText} ` }) }));
        case 'interrupt':
            return (_jsx(Box, { marginTop: 1, ref: ref, children: _jsx(TurnInterruptedRow, { backendLabel: interruptBackend }) }));
        case 'turn-summary':
            // The turn's closing ledger: a quiet RIGHT-aligned
            // emblem — metadata does not lead the reading flow. No top margin, it
            // belongs to the block above. width="100%" is what makes flex-end mean
            // the transcript's right margin (an auto-width row has nothing to push
            // against).
            if (turnUsage === undefined)
                return null;
            return (_jsx(Box, { paddingLeft: 2, width: "100%", flexDirection: "row", justifyContent: "flex-end", ref: ref, children: _jsx(TurnUsageRow, { usage: turnUsage }) }));
        case 'local':
            // `!` mode command echo.
            return (_jsx(Box, { marginTop: 1, backgroundColor: background, ref: ref, onClick: foldClickable ? foldOnClick : undefined, children: _jsxs(Text, { color: "bashBorder", children: ["!", executionTarget ? ` [${executionTarget}]` : '', " ", displayText] }) }));
        case 'local-output':
            return (_jsx(Box, { paddingLeft: 2, backgroundColor: background, ref: ref, onClick: foldClickable ? foldOnClick : undefined, children: _jsx(Text, { dimColor: true, children: displayText }) }));
        case 'compact':
            // The post-compaction summary defaults to a folded one-liner with a
            // text preview; Ctrl+O (global), message-selection Enter, or a click
            // reveals the full summary.
            return (_jsx(Box, { marginTop: marginTopOnTurn ? 1 : 0, paddingLeft: 2, backgroundColor: background, ref: ref, onClick: foldOnClick, onMouseEnter: () => setCompactHovered(true), onMouseLeave: () => setCompactHovered(false), children: expanded || isExpanded ? (_jsx(Text, { dimColor: true, children: text })) : (_jsxs(Text, { dimColor: true, italic: true, color: compactHovered ? 'text' : undefined, children: [_jsx(Text, { color: compactHovered ? 'text' : undefined, children: "\u2234" }), ' ', t('compact-summary-folded'), " \u00B7 ", compactPreview(displayText), ' ', t('hint-expand-ctrl-o', { key: primaryComboString('transcript') })] })) }));
        case 'subagent':
            if (!subagent)
                return null;
            return (_jsx(Box, { flexDirection: "column", ref: ref, children: _jsx(SubagentMessage, { subagent: subagent, marginTopOnTurn: marginTopOnTurn, activityFrames: activityFrames, isExpanded: isExpanded, onClick: openSubagent, onOpenView: onOpenSubagentView === undefined ? undefined : () => onOpenSubagentView(subagent.agentId, rowId) }) }));
        case 'job': {
            if (!job)
                return null;
            // A grouped run renders as ONE block: the head row carries the summary
            // line, members hang off the shared rail, and a FOLDED run keeps only
            // that summary (its members were dropped from the window upstream).
            const groupHead = jobGroup !== undefined && jobGroup.head;
            return (_jsxs(Box, { flexDirection: "column", 
                // The head's block margin moves UP to the group (the summary line
                // is what separates the run from what precedes it); the card under
                // it must not add a second blank line.
                marginTop: groupHead && marginTopOnTurn ? 1 : 0, ref: ref, children: [groupHead && _jsx(JobGroupHeader, { group: jobGroup, onToggle: toggleJobGroup }), groupHead && jobGroup.folded ? null : (_jsx(JobCard, { job: job, expanded: isExpanded !== expanded, onToggle: toggleJobGroup, marginTopOnTurn: groupHead ? false : marginTopOnTurn, 
                        // Clicking a card opens the panel focused on THAT job, not the roster head.
                        onClick: onOpenJobs === undefined ? undefined : () => onOpenJobs(job.id), onWatchOutput: onWatchJobOutput }))] }));
        }
    }
}
/** Folded compact-summary preview: whitespace flattened, capped with an
 *  ellipsis so the fold line never wraps. `limit` is terminal cells, so
 *  CJK wide chars count double and never split mid-glyph. */
function compactPreview(text, limit = 60) {
    const flat = text.replace(/\s+/g, ' ').trim();
    return stringWidth(flat) <= limit ? flat : `${truncateToWidth(flat, limit - 1)}…`;
}
const MemoRow = React.memo(TranscriptRow);
/**
 * The header block pinned above the transcript: the DeepSeek pixel whale
 * with the wordmark, tagline, model/effort and cwd (`LogoV2`), plus the
 * welcome line. It scrolls away with the transcript once the conversation
 * fills the viewport.
 */
export function LogoHeader({ model, effort, cwd, fontId, whale = true, whaleIdle = true, whaleGirl = false, brand, starred = false, onStarClick, working = false, skipIntro = false, }) {
    // The minimal UI drops the whole splash (whale art AND wordmark) — only the
    // transcript and a bare status bar remain.
    if (isMinimalUiMode())
        return null;
    return (_jsx(Box, { flexDirection: "column", marginBottom: 1, children: _jsx(LogoV2, { model: model, effort: effort, cwd: cwd, fontId: fontId, whale: whale, whaleIdle: whaleIdle, whaleGirl: whaleGirl, brand: brand, starred: starred, onStarClick: onStarClick, working: working, skipIntro: skipIntro }) }));
}
