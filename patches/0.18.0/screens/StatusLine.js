import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React from 'react';
import { Box, Text, useTerminalSize, useTheme } from '../ui.js';
import { formatTokens } from '../terminal-utils/format.js';
import { t } from '../i18n.js';
import { applyPluginFieldsOrder, formatContextUsage, DEFAULT_STATUS_BAR, normalizeStatusBar } from '../tuiDisplayPrefs.js';
import { estimateSessionCostSnapshotCny, isDeepSeekOfficialProvider, isPeakHour } from '../deepseekPricing.js';
import { getActiveBrand } from '../branding.js';
import { ActivityLine, contextPressurePct } from '../components/ActivityLine.js';
import { formatClock } from '../trajectory/format.js';
import { GoalStatusChip } from '../components/GoalTodoPanel.js';
import { formatGoalBudget } from '../channel/goal-command.js';
import { formatJobDuration } from '../dsh-adapter/jobs.js';
/** Stable fallback for stubbed channels: verify/repro harnesses render the
 *  real Chat with partial channel literals that predate the jobs field. */
const NO_BACKGROUND_JOBS = [];
/** 同上：partial channel 字面量可能早于 mainCost/subagentCost 字段（R4 兼容）。 */
/** A reported session cost: `$0.0123` for USD (sub-dollar keeps 4 places,
 *  a session often costs cents), `12.34 EUR` for any other currency. */
export function formatCostReport(report) {
    const digits = report.amount < 1 ? 4 : 2;
    return report.currency === 'USD'
        ? `$${report.amount.toFixed(digits)}`
        : `${report.amount.toFixed(digits)} ${report.currency}`;
}
const NO_MAIN_COST = {};
const NO_SUBAGENT_COST = [];
import { modeDisplayName } from '../sessionModes.js';
import { MiniWake } from '../components/trajectory/MiniWake.js';
import { getTheme, isLightThemeActive } from '../theme.js';
import { ContextBarView } from '../components/ContextBarView.js';
import { TooltipTarget } from '../components/Tooltip.js';
import { compactWorkingDirectory, displayWorkingDirectory, formatProject } from '../sessions/format.js';
import { homeDir } from '../utils/paths.js';
import { USED_SEGMENTS, channelContextOccupancy, attributeBarTokens, barSegments, contextBarBreakdown, contextBarSegmentColors, renderMiniContextBar, renderTpsGauge, renderTpsSparkline, speedColor, tpsStats, } from './StatusMetrics.js';
/**
 * The footer under the prompt input: the segmented context progress bar on
 * its own first line, the
 * status line below (left group: model · tokens · think level · cache · tps
 * gauge/sparkline; right group: git · cwd · title · short session id,
 * right-aligned), and the
 * mode/hint line last. The right side of the footer shows the latest
 * transient notification (errors in red, warnings in amber).
 *
 * Every metric field is hover-aware (fullscreen mouse): dwelling on a field
 * swaps the ctx readout for a mini pressure gauge and parks that field's
 * detailed breakdown on the supplemental row where the idle hint lives —
 * the footer stays one line tall, the detail is a peek, not a layout
 * change. The context bar answers the same way: it carries no labels of its
 * own, so hovering it is how its colors get their names and numbers.
 */
/**
 * The minimal UI's footer config. It ignores every SAVED preference (built from
 * scratch rather than `normalizeStatusBar(channel.statusBar)`) and pins the
 * DECORATION switches OFF — the shared defaults are free to change
 * (`contextBar` became default-on in 2026-09) and the minimal UI must not follow
 * them into the footer.
 *
 * The metric fields keep their `DEFAULT_STATUS_BAR` values on purpose: the
 * minimal UI has ALWAYS shown the default-on metrics (thinking / contextUsage /
 * cache / cost / goal) next to model + cwd — that predates the long-line fold
 * and the context-bar flip, and trimming them further is a product decision,
 * not a regression fix. Module scope: one frozen object, no per-render
 * allocation.
 */
const MINIMAL_UI_STATUS_BAR = Object.freeze({
    ...DEFAULT_STATUS_BAR,
    compact: true,
    model: true,
    cwd: true,
    contextBar: false,
    activity: false,
    trajectory: false,
    shortcutHint: false,
    // Explicit even though it starts from the default: plugin text must never
    // follow a future default flip into the minimal UI.
    pluginFields: false,
});
/** Stable empty default so a footer with no plugin fields allocates nothing
 *  and splices into the groups exactly as before this seam existed. */
const NO_PLUGIN_FIELDS = Object.freeze([]);
/** Semantic tone → theme colour. Footer fields never take literal colours;
 *  `dim` is the muted default and rides `dimColor` instead of a palette key. */
const FIELD_TONE_COLOR = {
    dim: undefined,
    accent: 'professionalBlue',
    success: 'success',
    warning: 'warning',
    error: 'error',
};
/**
 * Render field parts as sibling shrinkable Boxes joined by the Byline
 * separator (` · `). The Box-per-field layout is what makes individual
 * fields hoverable — a Byline inside one Text cannot carry per-field mouse
 * rects — at the cost of truncating each field on its own under pressure
 * instead of truncating the joined string's tail.
 */
function FieldLine({ parts, hoverProps, }) {
    const visible = parts.filter(part => part.node !== null && part.node !== undefined && part.node !== false);
    return (_jsx(_Fragment, { children: visible.map((part, index) => (_jsxs(React.Fragment, { children: [index > 0 ? _jsx(Text, { dimColor: true, wrap: "truncate", children: " \u00B7 " }) : null, _jsx(Box, { flexShrink: part.flexShrink ?? 1, ...(part.id === undefined ? {} : hoverProps(part.id)), ...(part.onClick === undefined ? {} : { onClick: part.onClick }), children: part.tooltip === undefined || part.tooltip === '' ? (_jsx(Text, { wrap: "truncate", children: part.node })) : (_jsx(TooltipTarget, { content: part.tooltip, children: _jsx(Text, { wrap: "truncate", children: part.node }) })) })] }, part.key))) }));
}
/** Admit one host-normalized plugin field into a `FieldPart`. The id (and
 *  therefore the hover affordance) exists only when the plugin declared a
 *  detail: a field with nothing to say on hover must not catch the pointer. */
function toFieldPart(field) {
    const id = `plugin:${field.key}`;
    const color = FIELD_TONE_COLOR[field.tone];
    return {
        key: id,
        ...(field.detail === undefined ? {} : { id }),
        ...(field.onClick === undefined ? {} : { onClick: field.onClick }),
        node: color === undefined
            ? _jsx(Text, { dimColor: true, children: field.text })
            : _jsx(Text, { color: color, children: field.text }),
    };
}
export function StatusLine({ channel, selectionActive = false, helpOpen = false, backendMode, modelPicker, effortPicker, wake, activity: projectedActivity, pluginFields, }) {
    const { columns } = useTerminalSize();
    const [themeName] = useTheme();
    const [hover, setHover] = React.useState(null);
    const hoverProps = React.useCallback((id) => ({
        onMouseEnter: () => setHover(id),
        // Guarded leave: a late leave from a field the pointer already left must
        // not clobber the field it entered.
        onMouseLeave: () => setHover(current => (current === id ? null : current)),
    }), []);
    const statusBar = channel.minimalUi
        // The minimal UI overrides every field switch: model + cwd only, so the
        // footer can never grow decorations regardless of saved preferences.
        ? MINIMAL_UI_STATUS_BAR
        : normalizeStatusBar(channel.statusBar);
    // Plugin fields pass three gates: the user switch (off also in the minimal
    // UI), the user's ordered list (empty = none, `*` = all unchanged, groups =
    // ordered and re-slotted), and their own `minColumns`. Everything below
    // splices them into the SAME groups the built-ins use, so the empty case is
    // a no-op.
    const pluginFieldsVisible = statusBar.pluginFields && channel.minimalUi !== true;
    const visibleFields = pluginFieldsVisible
        ? applyPluginFieldsOrder(pluginFields ?? NO_PLUGIN_FIELDS, statusBar.pluginFieldsOrder)
            .filter(field => columns >= field.minColumns)
        : NO_PLUGIN_FIELDS;
    const inSlot = (slot) => visibleFields.filter(field => field.slot === slot).map(toFieldPart);
    // Provider workspaces expose a remote display path alongside a host alias;
    // only the local target has identical cwd/displayCwd values to fold.
    const currentCwd = displayWorkingDirectory(channel);
    const displayCwd = channel.displayCwd === channel.cwd
        ? formatProject(currentCwd, homeDir())
        : currentCwd;
    const usage = channel.lastUsage;
    // ONE occupancy reading behind every ctx surface in this footer (the field,
    // its hover gauge, the segmented bar, the working line's pressure prefix):
    // DSH's own `contextPressure` projection when the composition mounts the
    // token meter, else the last request's billed sample. `usage` above stays the
    // source for the cache/cost fields — "what the last request cost" and "how
    // full the window is now" are different questions.
    const occupancy = channelContextOccupancy(channel);
    const contextUsed = occupancy?.usedTokens;
    const contextWindow = occupancy?.contextWindow;
    const contextParts = [];
    if (statusBar.thinking && channel.reasoningEffort !== undefined) {
        contextParts.push({
            key: 'effort',
            // The hover id rides only with the click target: the segment's whole
            // detail line IS the affordance (level + /effort), so promising it
            // without the picker behind it would be a lie.
            ...(effortPicker === undefined ? {} : { id: 'effort', onClick: effortPicker.onOpen }),
            node: _jsx(Text, { color: "inactiveShimmer", children: channel.reasoningEffort }),
        });
    }
    const modeNeedsExplicitMarker = channel.mode.plan === true
        || channel.mode.sandbox === 'danger-full-access'
        || channel.mode.approval === 'never';
    const modeMarked = channel.modeIndex > 0 || modeNeedsExplicitMarker;
    // Backend-native permission modes are a SAFETY readout (bypassPermissions
    // = every confirmation switched off), so the segment outranks the
    // `statusBar.mode` field switch: it shows whenever the backend reports a
    // mode, even at the default `mode: false`. The one thing it cannot outrank
    // is the minimal UI (`minimalUi === true` pins the footer to model + cwd —
    // the user's explicit choice must not be displaced). With no backend mode
    // (DSH) the rule stays byte-identical to before: `statusBar.mode` AND
    // modeMarked.
    if (backendMode === undefined
        ? statusBar.mode && modeMarked
        : channel.minimalUi !== true) {
        // Backend modes carry their own colour rule — the two destructive ids
        // warn, plan keeps its own colour, everything else (the unmarked base
        // mode included) renders muted; the DSH atoms never leak in. Without a
        // backend mode the DSH rule stands: warning colour for anything that
        // needs an explicit marker, plan keeps its own.
        const modeColour = backendMode === undefined
            ? channel.mode.plan === true
                ? 'planMode'
                : modeMarked ? 'warning' : 'inactiveShimmer'
            : backendMode.id === 'bypassPermissions' || backendMode.id === 'dontAsk'
                ? 'warning'
                : backendMode.id === 'plan' ? 'planMode' : 'inactiveShimmer';
        contextParts.push({
            key: 'mode',
            ...(backendMode === undefined ? {} : { id: 'mode', onClick: backendMode.onOpen }),
            node: (_jsx(Text, { color: modeColour, children: backendMode === undefined ? modeDisplayName(channel.mode) : backendMode.name })),
        });
    }
    const formattedContext = statusBar.contextUsage
        ? formatContextUsage(contextUsed, contextWindow, statusBar.compact)
        : undefined;
    // The ctx field's two faces: the idle readout, and the hover state — an
    // in-place pressure bar (the user-liked "text becomes a bar" morph).
    //
    // WIDTH-STABLE BY CONSTRUCTION: the idle variable part is
    // `P + " (" + C + ")"` (either order; P = percent text, C = counts) —
    // len(P)+len(C)+3 cells. The hover variant is `▕+bar+▏ + " " + P` —
    // 3+barLen+len(P) cells. Sizing barLen = len(C) makes them equal, so the
    // morph swaps glyphs in place and NO sibling field, separator, or the
    // right-aligned group moves a single cell (the first attempt used a fixed
    // 10-cell gauge and made the whole row jump).
    const ctxParts = (() => {
        if (formattedContext === undefined)
            return undefined;
        const open = formattedContext.indexOf(' (');
        if (open < 0)
            return undefined;
        const first = formattedContext.slice(0, open);
        const second = formattedContext.slice(open + 2, -1);
        if (first.endsWith('%'))
            return { percent: first, counts: second };
        if (second.endsWith('%'))
            return { percent: second, counts: first };
        return undefined;
    })();
    const ctxHoverBarWidth = ctxParts?.counts.length ?? 0;
    const ctxNode = formattedContext === undefined
        ? undefined
        : hover === 'ctx' &&
            ctxParts !== undefined &&
            ctxHoverBarWidth > 0 &&
            contextUsed !== undefined &&
            contextWindow !== undefined
            ? (_jsxs(Text, { color: "inactiveShimmer", children: [_jsx(Text, { dimColor: true, children: "ctx " }), renderMiniContextBar(contextUsed, contextWindow, ctxHoverBarWidth), ' ', ctxParts.percent] }))
            : (_jsxs(Text, { color: "inactiveShimmer", children: [_jsx(Text, { dimColor: true, children: "ctx " }), formattedContext] }));
    if (statusBar.cache) {
        const cacheRate = formatCacheHitRate(usage);
        if (cacheRate !== undefined) {
            contextParts.push({
                key: 'cache',
                id: 'cache',
                node: (_jsxs(Text, { color: "inactiveShimmer", children: [_jsx(Text, { dimColor: true, children: t('status-cache-label') }), cacheRate] })),
            });
        }
    }
    let tpsPart;
    if (statusBar.tps && channel.tps !== undefined) {
        if (channel.working && channel.tpsSamples.length === 0) {
            tpsPart = {
                key: 'tps',
                id: 'tps',
                node: (_jsxs(Text, { children: [renderTpsGauge(channel.tps, channel.tps), ' ', _jsxs(Text, { dimColor: true, children: [Math.round(channel.tps), " tps"] })] })),
            };
        }
        else if (channel.tpsSamples.length > 0) {
            const peak = Math.max(...channel.tpsSamples.map(sample => sample.tps), channel.tps);
            tpsPart = {
                key: 'tps',
                id: 'tps',
                node: (_jsxs(Text, { children: [channel.working
                            ? renderTpsGauge(channel.tps, peak)
                            : renderTpsSparkline(channel.tpsSamples), ' ', speedColor(channel.tps, `${Math.round(channel.tps)}`), " tps"] })),
            };
        }
        else {
            tpsPart = {
                key: 'tps',
                id: 'tps',
                node: _jsxs(Text, { dimColor: true, children: [Math.round(channel.tps), " t/s"] }),
            };
        }
    }
    const selectionBadge = formatSelectionBadge(channel.selection);
    // The short id names the backend's own session, the id `--resume`
    // takes. A DSH session's id is its agent id; stub channels
    // without a session ref fall back to the agent id.
    const sessionShortId = channel.sessionRef?.sessionId ?? channel.agentId;
    // Background-job chip (ctx.jobs; /jobs): live count of running/stopping
    // jobs, shown only while non-zero — a silent zero is not information.
    // Not preference-gated: it is transient situational state like the goal
    // chip, not chrome. Hover lists the live jobs with elapsed times.
    // Marker is ●, NOT ⚙ (U+2699 is EA-ambiguous: ink measures 1 cell, CJK
    // terminal fonts paint 2 → the count overlaps the glyph).
    const liveJobs = (channel.backgroundJobs ?? NO_BACKGROUND_JOBS).filter(job => job.status === 'running' || job.status === 'stopping');
    const jobsPart = liveJobs.length === 0
        ? undefined
        : {
            key: 'jobs',
            id: 'jobs',
            node: (_jsxs(Text, { color: "toolDotTask", children: ['● ', liveJobs.length] })),
        };
    // The placeholder's backend is still opening: say so up front, so the
    // frame drawn before DSH's synchronous load is not a silent one.
    const startingPart = channel.ready === false && channel.startupFailure === undefined
        ? {
            key: 'starting',
            node: _jsx(Text, { color: "warning", children: t('status-starting', { backend: channel.backendCapabilities?.backendLabel ?? 'DSH' }) }),
        }
        : undefined;
    const builtinLeft = [
        ...(startingPart !== undefined ? [startingPart] : []),
        ...(statusBar.model
            ? [{ key: 'model', id: 'model', flexShrink: 0, ...(modelPicker === undefined ? {} : { onClick: modelPicker.onOpen }), node: _jsx(Text, { color: "inactiveShimmer", children: channel.modelDisplay ?? channel.model }) }]
            : []),
        ...(tpsPart !== undefined ? [tpsPart] : []),
        ...(jobsPart !== undefined ? [jobsPart] : []),
        ...contextParts,
        ...(statusBar.tokens
            ? [{
                    key: 'tokens',
                    id: 'tokens',
                    node: (_jsxs(Text, { color: "inactiveShimmer", children: [formatTokens(channel.tokens.input), "\u2192", formatTokens(channel.tokens.output)] })),
                }]
            : []),
        // Estimated session spend (≈¥): only for official DeepSeek providers.
        // Visible once there is a priced amount or at least one unpriced token (a
        // fresh, fully priced zero session keeps hiding ¥0.00 as noise; unpriced
        // usage still needs the 未计价 marker). The estimate merges the main
        // session (by model) with the subagents' own durable usage, so delegating
        // work no longer silently undercounts. The trailing 峰/谷 marker shows
        // the current billing window; the total>0 shape is unchanged. Hover shows
        // the breakdown.
        // A backend that reports its own session cost (Claude `total_cost_usd`)
        // wins over the local DeepSeek estimate: the reported figure is the bill.
        ...(statusBar.cost && channel.costReport !== undefined
            ? [{
                    key: 'cost',
                    id: 'cost',
                    node: (_jsxs(Text, { color: "inactiveShimmer", children: [channel.costReport.source === 'estimate' ? t('status-cost-label') : '', formatCostReport(channel.costReport)] })),
                }]
            : []),
        ...(statusBar.cost && channel.costReport === undefined && isDeepSeekOfficialProvider(channel.provider)
            ? (() => {
                const estimate = estimateSessionCostSnapshotCny({
                    provider: channel.provider,
                    main: channel.mainCost ?? NO_MAIN_COST,
                    subagents: channel.subagentCost ?? NO_SUBAGENT_COST,
                    fallbackTokens: channel.tokens,
                    fallbackModel: channel.model,
                });
                return estimate !== undefined && (estimate.total > 0 || estimate.unpricedTokens > 0)
                    ? [{
                            key: 'cost',
                            id: 'cost',
                            node: (_jsxs(Text, { color: "inactiveShimmer", children: [t('status-cost-label'), estimate.total > 0
                                        ? _jsxs(_Fragment, { children: ["\u00A5", estimate.total.toFixed(2), " ", t(isPeakHour() ? 'cost-now-peak' : 'cost-now-idle')] })
                                        : _jsxs(_Fragment, { children: [" ", t('cost-unpriced', { tokens: formatTokens(estimate.unpricedTokens) })] })] })),
                        }]
                    : [];
            })()
            : []),
    ];
    const builtinRight = [
        // Live IDE-selection badge first: it tracks the user's in-editor gesture,
        // the freshest signal in the footer (T-FIX-02). Absent without an IDE —
        // no placeholder, matching the official Claude Code footer.
        ...(selectionBadge !== undefined
            ? [{
                    key: 'ideSelection',
                    node: (_jsx(Text, { color: "ide", wrap: "truncate", children: selectionBadge })),
                }]
            : []),
        // Goal chip first: session-level state outranks repo/location details.
        ...(statusBar.goal && channel.goal !== undefined
            ? [{
                    key: 'goal',
                    id: 'goal',
                    node: _jsx(GoalStatusChip, { goal: channel.goal, minimal: channel.minimalUi }),
                }]
            : []),
        ...(statusBar.gitBranch && channel.gitBranch
            ? [
                {
                    key: 'git',
                    id: 'git',
                    node: _jsx(Text, { color: "professionalBlue", children: channel.gitBranch }),
                },
            ]
            : []),
        ...(statusBar.cwd
            ? [{
                    key: 'cwd',
                    id: 'cwd',
                    flexShrink: 2,
                    node: (_jsx(Text, { color: "inactiveShimmer", children: statusBar.compact ? compactCwd(channel, displayCwd) : displayCwd })),
                }]
            : []),
        ...(statusBar.sessionTitle && channel.sessionTitle
            ? [{
                    key: 'title',
                    id: 'title',
                    // The title truncates mid-word when the right-aligned group
                    // overflows; the tooltip carries the full string.
                    tooltip: channel.sessionTitle,
                    node: _jsx(Text, { dimColor: true, children: channel.sessionTitle }),
                }]
            : []),
        // Short id last: a provenance tag trails the content it identifies, and
        // the 8-char form is what the session log filename starts with, so a
        // truncated rendering still names the right log for --resume.
        ...(statusBar.sessionId && sessionShortId
            ? [{
                    key: 'sessionId',
                    id: 'sessionId',
                    node: _jsx(Text, { dimColor: true, children: `#${sessionShortId.slice(0, 8)}` }),
                }]
            : []),
    ];
    // Plugin fields join the built-in groups by slot — no third group, no new
    // Box. `left-tail` and `right-head` do not move any host cell; `right-tail`
    // pushes the right group left, which is that slot's explicit cost.
    const leftFields = [...builtinLeft, ...inSlot('left-tail')];
    const rightFields = [
        ...inSlot('right-head'),
        ...builtinRight,
        ...inSlot('right-tail'),
    ];
    const hint = selectionActive
        ? t('statusline-hint-select')
        : channel.working
            // An interrupt already requested but not yet converged: "esc to
            // interrupt" would promise an action the channel ignores by contract
            // (and a wedged turn can hold this state forever). Say what the state
            // is instead, so the key never looks dead.
            ? (channel.cancelPending
                ? t('statusline-hint-interrupting')
                : '')
            : statusBar.shortcutHint && !helpOpen
                ? t('statusline-hint-shortcuts')
                : '';
    const activity = projectedActivity;
    const showActivity = statusBar.activity &&
        !channel.working &&
        activity !== undefined &&
        activity.line !== '' &&
        activity.phase !== 'idle';
    const showTrajectory = statusBar.trajectory && wake !== undefined;
    // The root Box below paints paddingX={1} inside width={columns}, so the
    // content area is `columns - 2` cells wide — size the bar from the same
    // arithmetic or its right edge falls 2 columns short of the status row's
    // (the v0.8.0 paddingX 2→1 tightening left the old `columns - 4` stale).
    const barWidth = columns - 2;
    // 空段的深色兜底：deepseek 档冷灰、claude 档暖墨（品牌档见 branding.ts）。
    // 明暗问色板而不是比主题名：浅色主题不一定叫 `light`（pink-day、用户/插件
    // 色板也可以是浅色），只有真彩/ANSI 的深色默认档才需要显式的 free 段色。
    const barColors = isLightThemeActive(themeName)
        ? undefined
        : getActiveBrand() === 'claude'
            ? { freeFill: '#24221F', freeText: '#B8B2A8' }
            : { freeFill: '#2E3440', freeText: '#8D95A6' };
    const barVisible = statusBar.contextBar &&
        channel.contextBarEnabled &&
        barWidth >= 14 &&
        contextUsed !== undefined &&
        contextWindow !== undefined;
    // The supplemental-row readout for the hovered field: replaces the idle
    // hint (never the activity line) while the pointer dwells on a field.
    const detail = buildHoverDetail(hover, visibleFields, channel, occupancy, usage, columns, barColors, backendMode, modelPicker, contextBarSegmentColors(getTheme(themeName)));
    const trailer = detail !== null
        ? detail
        : hint !== ''
            ? _jsx(Text, { color: "inactiveShimmer", children: hint })
            : null;
    const compactFields = [...leftFields, ...rightFields];
    const fullLeftFields = [
        ...leftFields,
        ...(ctxNode !== undefined ? [{ key: 'context', id: 'ctx', node: ctxNode }] : []),
    ];
    const hasStatusFields = compactFields.length > 0 || ctxNode !== undefined;
    // The supplemental row is PERMANENTLY mounted (height pinned to 1)
    // whenever the footer carries hoverable chrome — mounting it from nothing
    // on hover is what made the footer grow mid-gesture and shoved the
    // transcript up (user feedback). Idle it may sit blank: a stable footer
    // outranks a reclaimable row, and hovering only ever swaps this line's
    // content. The minimal UI keeps the old contract — no hover details, the
    // row appears only for real content (which its defaults never produce).
    const showSupplementalRow = (!channel.minimalUi && (hasStatusFields || barVisible)) ||
        showActivity ||
        showTrajectory ||
        hint !== '';
    return (_jsx(Box, { paddingX: 1, width: columns, flexShrink: 0, children: _jsxs(Box, { flexDirection: "column", width: "100%", children: [barVisible ? (_jsx(ContextBarView, { segments: channel.contextSegments, breakdown: channel.contextBreakdown, usedTokens: contextUsed ?? 0, contextWindow: contextWindow ?? 0, width: barWidth, colors: barColors, onHover: hovered => setHover(current => hovered ? 'bar' : current === 'bar' ? null : current) })) : null, hasStatusFields ? statusBar.compact ? (_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", gap: 2, children: [_jsx(Box, { flexGrow: 1, flexShrink: 1, flexDirection: "row", overflow: "hidden", children: _jsx(FieldLine, { parts: compactFields, hoverProps: hoverProps }) }), ctxNode !== undefined ? (_jsx(Box, { flexShrink: 0, ...hoverProps('ctx'), children: _jsx(Text, { wrap: "truncate", children: ctxNode }) })) : null] })) : (_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", gap: 2, children: [_jsx(Box, { flexGrow: 1, flexShrink: 1, flexDirection: "row", overflow: "hidden", children: _jsx(FieldLine, { parts: fullLeftFields, hoverProps: hoverProps }) }), _jsx(Box, { justifyContent: "flex-end", flexShrink: 2, flexDirection: "row", overflow: "hidden", children: _jsx(FieldLine, { parts: rightFields, hoverProps: hoverProps }) })] })) : null, showSupplementalRow ? _jsxs(Box, { height: 1, overflow: "hidden", flexDirection: "row", justifyContent: "space-between", gap: 2, children: [_jsxs(Box, { flexDirection: "row", flexGrow: 1, justifyContent: showActivity && trailer !== null ? 'space-between' : 'flex-start', gap: 2, children: [showActivity && activity !== undefined ? (_jsx(ActivityLine, { activity: activity, activityFrames: channel.activityFrames, warnPct: contextPressurePct(occupancy), warnDanger: (contextPressurePct(occupancy) ?? 0) >= 95 })) : trailer, showActivity ? trailer : null] }), showTrajectory && wake !== undefined ? (_jsx(MiniWake, { band: wake.band, hint: wake.hint, working: channel.working, onOpen: wake.onOpen, hoverHint: wake.hoverHint })) : null] }) : null] }) }));
}
/**
 * The supplemental-row readout for a hovered footer field. Technical label
 * tokens (ctx, free, read, sys…) stay unlocalized like the footer fields
 * themselves; sentences go through t(). Returns null when nothing is
 * hovered (or the hover outlived its data, which the field gating makes
 * near-impossible).
 */
/** `5h 68% · 7d 87%` for the subscription windows a backend reported. */
function formatRateLimit(rateLimit) {
    const windows = rateLimit?.windows ?? [];
    if (windows.length === 0)
        return undefined;
    const label = (name) => name === 'five_hour'
        ? t('status-rate-limit-five-hour')
        : name === 'seven_day' ? t('status-rate-limit-seven-day') : name;
    return windows.map(window => `${label(window.name)} ${Math.round(window.utilization * 100)}%`).join(' · ');
}
function buildHoverDetail(hover, fields, channel, occupancy, usage, columns, barColors, backendMode, modelPicker, usedColors) {
    if (hover === null)
        return null;
    // Plugin fields first: their detail is verbatim host-sanitized text. A field
    // that vanished mid-hover (disposed, reloaded, filtered out) is simply not
    // found and falls through to null — the idle hint returns by the same
    // guarded-leave rule the built-ins use.
    if (hover.startsWith('plugin:')) {
        const field = fields.find(candidate => `plugin:${candidate.key}` === hover);
        return field?.detail === undefined
            ? null
            : _jsx(Text, { color: "inactiveShimmer", children: field.detail });
    }
    const contextUsed = occupancy?.usedTokens;
    // The hover surfaces report the SAME occupancy the field/bar above show; the
    // 'model' chip below stays a pure route-capacity readout.
    const window = occupancy?.contextWindow;
    const dim = (label) => _jsx(Text, { dimColor: true, children: label });
    if (hover === 'bar') {
        if (window === undefined || window <= 0 || contextUsed === undefined)
            return null;
        // The bar's text-free design pays off here: this line is its legend, so
        // every entry leads with a chip of the very color it names, and the numbers
        // are the shares the fills above were drawn from — attributed to the
        // occupancy, so five entries plus `free` make up the window.
        const { entries, separator } = contextBarBreakdown(attributeBarTokens(barSegments(channel.contextSegments, channel.contextBreakdown), contextUsed), contextUsed, window, columns, { used: usedColors, freeFill: barColors?.freeFill });
        if (entries.length === 0)
            return null;
        return (_jsx(Text, { wrap: "truncate", children: entries.map((entry, index) => (_jsxs(React.Fragment, { children: [index > 0 ? dim(separator) : null, _jsx(Text, { backgroundColor: entry.color, children: " " }), entry.label] }, entry.key))) }));
    }
    switch (hover) {
        case 'ctx': {
            if (contextUsed === undefined || window === undefined || window <= 0)
                return null;
            const free = Math.max(0, window - contextUsed);
            // The hover payoff for the ctx ask: percent + counts + free, then the
            // segment breakdown as the truncate-able tail (no bar — the row's
            // in-place morph and the segment bar above already carry the gauge).
            // Match the bar's attributed shares, including its measured-used
            // fallback when no content category can be attributed.
            const sizes = attributeBarTokens(barSegments(channel.contextSegments, channel.contextBreakdown), contextUsed);
            const hasComposition = USED_SEGMENTS.some(segment => sizes[segment.key] > 0);
            const segments = hasComposition
                ? USED_SEGMENTS.map(segment => `${segment.labels[1] ?? segment.key} ${formatTokens(sizes[segment.key])}`).join(' · ')
                : `${t('context-bar-used')} ${formatTokens(contextUsed)}`;
            return (_jsxs(Text, { wrap: "truncate", children: [((contextUsed / window) * 100).toFixed(1), "% \u00B7", ' ', formatTokens(contextUsed), "/", formatTokens(window), " \u00B7 ", dim('free '), formatTokens(free), ' · ', segments] }));
        }
        case 'mode': {
            // Only the mode segment carries the hover id (its click target); the
            // detail names the field and the affordance at the moment of asking.
            // A backend-owned mode names itself (the DSH spec would only ever show
            // the DSH cycle's own label here).
            return (_jsxs(Text, { wrap: "truncate", children: [dim('mode '), backendMode?.name ?? modeDisplayName(channel.mode), " \u00B7 ", t('status-detail-mode')] }));
        }
        case 'effort': {
            // The think-level segment's whole detail line IS the affordance (the
            // hover id rides with the click target — see the field above), so the
            // case is unreachable without the picker behind it.
            return (_jsxs(Text, { wrap: "truncate", children: [dim('effort '), channel.reasoningEffort, " \u00B7 ", t('status-detail-effort')] }));
        }
        case 'cache': {
            const rate = formatCacheHitRate(usage);
            if (usage === undefined || rate === undefined)
                return null;
            // The cache split is optional on the wire (`cacheReadTokens?` /
            // `cacheWriteTokens?`), and a route that never writes the prompt cache
            // reports a zero or omits the field — every DeepSeek route does one or
            // the other. A zero component says nothing the rate does not, and
            // rendering the absence as `0` asserts a number no provider sent.
            return (_jsxs(Text, { wrap: "truncate", children: [dim('cache '), rate, usage.cacheRead > 0
                        ? _jsxs(_Fragment, { children: [' · ', dim('read '), formatTokens(usage.cacheRead)] })
                        : null, usage.cacheWrite > 0
                        ? _jsxs(_Fragment, { children: [' · ', dim('write '), formatTokens(usage.cacheWrite)] })
                        : null, ' · ', dim('input '), formatTokens(usage.input)] }));
        }
        case 'tps': {
            if (channel.tps === undefined)
                return null;
            const stats = tpsStats(channel.tpsSamples, Date.now());
            return (_jsxs(Text, { wrap: "truncate", children: [dim('tps '), Math.round(channel.tps), " \u00B7 ", dim('avg60 '), stats.avg.toFixed(1), " \u00B7", ' ', dim('mean '), stats.mean.toFixed(1), " \u00B7 ", dim('p95 '), stats.p95.toFixed(1)] }));
        }
        case 'tokens': {
            const { input, output, cacheRead, cacheWrite } = channel.tokens;
            // The hover answers "what moved" in one place — session
            // totals with the cache split (uncached in/out stay separate from
            // cache movement; zeros render nothing rather than a fabricated 0),
            // the window the totals sit in, WHEN the last request was sampled,
            // and the last COMPLETED turn's mini summary (kept after the turn
            // ends — per-turn and cumulative never blend into one number).
            const last = channel.turnUsage;
            return (_jsxs(Text, { wrap: "truncate", children: [dim('in '), formatTokens(input), " \u00B7 ", dim('out '), formatTokens(output), cacheRead > 0 ? _jsxs(_Fragment, { children: [' · ', dim('cache read '), formatTokens(cacheRead)] }) : null, cacheWrite > 0 ? _jsxs(_Fragment, { children: [' · ', dim('cache write '), formatTokens(cacheWrite)] }) : null, ' · ', dim('total '), formatTokens(input + output + cacheRead + cacheWrite), window !== undefined && window > 0 ? _jsxs(_Fragment, { children: [' · ', dim('ctx '), formatTokens(window)] }) : null, usage !== undefined
                        ? _jsxs(_Fragment, { children: [' · ', t('usage-sampled-at', { time: formatClock(usage.at) })] })
                        : null, last !== undefined
                        ? _jsxs(_Fragment, { children: [' · ', t('usage-last-turn'), " \u2191", formatTokens(last.input), " \u2193", formatTokens(last.output), last.cacheKnown && last.cacheRead + last.cacheWrite > 0
                                    ? _jsxs(_Fragment, { children: [" ", t('usage-cache-segment', { parts: `${formatTokens(last.cacheRead)}/${formatTokens(last.cacheWrite)}` })] })
                                    : null, last.retries > 0 ? _jsxs(_Fragment, { children: [" \u00B7 ", t('usage-retry-segment', { n: last.retries })] }) : null] })
                        : null] }));
        }
        case 'cost': {
            const report = channel.costReport;
            if (report !== undefined) {
                const { input, output, cacheRead } = channel.tokens;
                // Subscription windows the backend reported ride along: the bill and
                // the plan's remaining room answer the same "what did this cost" glance.
                const usage = formatRateLimit(channel.rateLimit);
                return (_jsxs(Text, { wrap: "truncate", children: [formatCostReport(report), " \u00B7 ", dim('in '), formatTokens(input), ' · ', dim('out '), formatTokens(output), " \u00B7 ", dim('cache '), formatTokens(cacheRead), ' · ', t(report.source === 'backend' ? 'cost-source-backend' : 'status-cost-note'), usage === undefined ? null : _jsxs(_Fragment, { children: [' · ', t('status-rate-limit', { usage })] })] }));
            }
            const estimate = estimateSessionCostSnapshotCny({
                provider: channel.provider,
                main: channel.mainCost ?? NO_MAIN_COST,
                subagents: channel.subagentCost ?? NO_SUBAGENT_COST,
                fallbackTokens: channel.tokens,
                fallbackModel: channel.model,
            });
            // Same visibility contract as the field: a priced amount or unpriced
            // tokens (with the 未计价 row) both warrant the breakdown; the old
            // total>0 gate hid the only explanation for an all-unpriced session.
            if (estimate === undefined || (estimate.total <= 0 && estimate.unpricedTokens <= 0))
                return null;
            const { input, output, cacheRead } = channel.tokens;
            return (_jsxs(Text, { wrap: "truncate", children: [dim('≈¥'), estimate.total.toFixed(2), " \u00B7 ", dim('peak '), "\u00A5", estimate.peak.toFixed(2), ' · ', dim('idle '), "\u00A5", estimate.idle.toFixed(2), " \u00B7 ", dim('in '), formatTokens(input), ' · ', dim('out '), formatTokens(output), " \u00B7 ", dim('cache '), formatTokens(cacheRead), ' · ', t('cost-split-main', { cost: estimate.main.toFixed(2) }), ' · ', t('cost-split-subagent', { cost: estimate.subagent.toFixed(2) }), estimate.unpricedTokens > 0
                        ? _jsxs(_Fragment, { children: [' · ', t('cost-unpriced', { tokens: formatTokens(estimate.unpricedTokens) })] })
                        : null, ' · ', t('status-cost-note')] }));
        }
        case 'goal': {
            const goal = channel.goal;
            if (goal === undefined)
                return null;
            // A budgeted goal (a backend that measures tokens/time) reads its
            // spend instead of the rounds.
            return goal.budget === undefined ? (_jsxs(Text, { wrap: "truncate", children: [dim('goal '), goal.phase, " \u00B7 ", dim('r'), goal.roundsStarted, "/", goal.maxGoalRounds, " \u00B7", ' ', goal.objective] })) : (_jsxs(Text, { wrap: "truncate", children: [dim('goal '), goal.phase, " \u00B7 ", formatGoalBudget(goal.budget), " \u00B7", ' ', goal.objective] }));
        }
        case 'jobs': {
            const live = (channel.backgroundJobs ?? NO_BACKGROUND_JOBS).filter(job => job.status === 'running' || job.status === 'stopping');
            if (live.length === 0)
                return null;
            const shown = live.slice(0, 3);
            const rest = live.length - shown.length;
            return (_jsxs(Text, { wrap: "truncate", children: [dim('jobs '), shown.map(job => `${job.id} ${job.label} (${formatJobDuration(job)})`).join(' · '), rest > 0 ? ` · +${rest}` : ''] }));
        }
        case 'model': {
            // When a display name masks the raw id (modelDisplay maps a
            // friendly/alias name), the hover shows BOTH — the requested alias the
            // user picked and the raw id the route runs. Identical strings render
            // once; nothing is invented when no mapping is known.
            return (_jsxs(Text, { wrap: "truncate", children: [dim('model '), channel.modelDisplay ?? channel.model, channel.modelDisplay !== undefined && channel.modelDisplay !== channel.model
                        ? _jsxs(_Fragment, { children: [' (', channel.model, ')'] })
                        : null, ' · ', dim('provider '), channel.provider, channel.contextWindow !== undefined
                        ? _jsxs(_Fragment, { children: [" \u00B7 ", dim('ctx '), formatTokens(channel.contextWindow)] })
                        : null, modelPicker !== undefined
                        ? _jsxs(_Fragment, { children: [" \u00B7 ", t('status-detail-model')] })
                        : null] }));
        }
        case 'git': {
            if (channel.gitBranch === undefined)
                return null;
            return (_jsxs(Text, { wrap: "truncate", children: [dim('git '), channel.gitBranch] }));
        }
        case 'sessionId':
            return (_jsxs(Text, { wrap: "truncate", children: [dim('# '), channel.sessionRef?.sessionId ?? channel.agentId, " \u00B7 ", t('status-detail-session-id')] }));
        case 'cwd':
            return (_jsxs(Text, { wrap: "truncate", children: [dim('cwd '), displayWorkingDirectory(channel)] }));
        case 'title':
            return (_jsxs(Text, { wrap: "truncate", children: [dim('title '), channel.sessionTitle] }));
        default:
            return null;
    }
}
/** Return the prompt-cache hit rate, or nothing when usage is unavailable. */
export function formatCacheHitRate(usage) {
    if (usage === undefined)
        return undefined;
    const total = usage.input + usage.cacheRead + usage.cacheWrite;
    if (!Number.isFinite(total) || total <= 0)
        return undefined;
    return `${((usage.cacheRead / total) * 100).toFixed(1)}%`;
}
/**
 * The prompt footer's live IDE-selection badge (T-FIX-02), mirroring Claude
 * Code's `⧉ N lines selected`: English only (like every other footer field),
 * singular/plural aware, line count from the snapshot's 0-based inclusive
 * range. `undefined` (no IDE yet / cleared by an isEmpty notification)
 * renders no field at all — a manually launched session never shows a
 * placeholder. Exported for scripts/verify-ide-channel.tsx.
 */
export function formatSelectionBadge(selection) {
    if (selection === undefined || selection.isEmpty === true)
        return undefined;
    const lines = selection.endLine - selection.startLine + 1;
    return `⧉ ${lines} ${lines === 1 ? 'line' : 'lines'} selected`;
}
function basename(path) {
    const parts = path.split(/[\\/]/);
    return parts[parts.length - 1] ?? path;
}
/** Compact footer cwd: the plain project name until the session moves, then a
 *  breadcrumb that keeps the project as the anchor (`project›relative`) and
 *  names the directory a move out of the project landed in. The anchor is
 *  dimmed so the relative half reads as position, not as part of the name. */
function compactCwd(channel, displayCwd) {
    const breadcrumb = compactWorkingDirectory(channel, homeDir());
    if (breadcrumb === undefined)
        return basename(displayCwd);
    return (_jsxs(_Fragment, { children: [_jsx(Text, { dimColor: true, children: breadcrumb.anchor }), `${breadcrumb.separator}${breadcrumb.target}`] }));
}
