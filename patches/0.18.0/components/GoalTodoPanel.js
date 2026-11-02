import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React from 'react';
import { Box, Text, useAnimationFrame } from '../ui.js';
import wrapText, { wrapTextLines } from '../ink/wrap-text.js';
import { t } from '../i18n.js';
import { primaryComboString } from '../utils/keymap.js';
import { formatGoalBudget, formatGoalBudgetCompact } from '../channel/goal-command.js';
import { useTooltip } from './Tooltip.js';
import { stringWidth } from '../ink/stringWidth.js';
/** Maximum todo rows shown before the overflow line. */
const MAX_TODOS = 8;
const PHASE_LABEL = {
    active: '● active',
    paused: '⏸ paused',
    blocked: '⛔ blocked',
    complete: '✓ complete',
};
/** Compact phase marker for the status-footer chip. */
const PHASE_GLYPH = {
    active: '●',
    paused: '⏸',
    blocked: '⛔',
    complete: '✓',
};
function phaseColor(phase) {
    if (phase === 'active')
        return 'success';
    if (phase === 'paused')
        return 'warning';
    if (phase === 'blocked')
        return 'error';
    return undefined;
}
/** `47s` under a minute, `3m12s` after — same shape as the subagent cards. */
function formatDuration(ms) {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60}s`;
}
/**
 * Compact goal chip for the status footer: phase glyph + rounds (a goal a
 * backend budgets by tokens: tokens used / budget instead), colored by
 * phase. `minimal` swaps the glyph for a text form, per the minimal-mode
 * no-emoji contract.
 */
export function GoalStatusChip({ goal, minimal = false }) {
    const progress = goal.budget === undefined ? `${goal.roundsStarted}/${goal.maxGoalRounds}` : formatGoalBudgetCompact(goal.budget);
    return (_jsx(Text, { color: phaseColor(goal.phase), dimColor: goal.phase === 'complete', children: minimal
            ? `goal ${progress}`
            : `${PHASE_GLYPH[goal.phase]} ${progress}` }));
}
function PhaseBadge({ phase, roundsStarted, maxGoalRounds, budget, elapsed, }) {
    const color = phaseColor(phase);
    if (budget !== undefined) {
        return (_jsxs(Text, { color: color, bold: phase !== 'complete', dimColor: phase === 'complete', wrap: "truncate", children: [PHASE_LABEL[phase], " \u00B7 ", formatGoalBudget(budget)] }));
    }
    return (_jsxs(Text, { color: color, bold: phase !== 'complete', dimColor: phase === 'complete', wrap: "truncate", children: [PHASE_LABEL[phase], " \u00B7 ", roundsStarted, "/", maxGoalRounds, " ", progressBarRatio(maxGoalRounds > 0 ? roundsStarted / maxGoalRounds : 0, 6), elapsed !== undefined ? ` · ${elapsed}` : ''] }));
}
function TodoGlyph({ status }) {
    switch (status) {
        case 'in_progress':
            return _jsx(Text, { color: "suggestion", children: "\u25CF " });
        case 'completed':
            return _jsx(Text, { dimColor: true, children: "\u2713 " });
        default:
            return _jsx(Text, { dimColor: true, children: "\u25CB " });
    }
}
/** Compact one-line progress bar. */
function progressBarRatio(ratio, width = 8) {
    const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
    const filled = Math.max(0, Math.min(width, Math.round(width * clamped)));
    return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}
/** Compact one-line progress bar for the todo header. */
function todoProgressBar(done, total, width = 8) {
    return total > 0 ? progressBarRatio(done / total, width) : '';
}
/** Parse the producer's free-form job progress (`3/10`, `72%`, `72.5 %`). */
function jobProgressInfo(progress) {
    if (progress === undefined || progress === '')
        return undefined;
    const text = String(progress).trim();
    const fraction = /^(\d+)\s*\/\s*(\d+)$/.exec(text);
    if (fraction !== null) {
        const current = Number(fraction[1]);
        const total = Number(fraction[2]);
        if (total > 0)
            return { ratio: current / total, text };
    }
    const percent = /^(\d+(?:\.\d+)?)\s*%$/.exec(text);
    if (percent !== null) {
        const value = Number(percent[1]);
        if (value >= 0 && value <= 100)
            return { ratio: value / 100, text };
    }
    return undefined;
}
/** One compact line for the first active background job/download. */
function JobSummary({ jobs }) {
    const job = jobs[0];
    const info = jobProgressInfo(job.progress);
    return (_jsxs(Box, { flexDirection: "row", height: 1, children: [_jsx(Text, { dimColor: true, children: "\u2699 " }), _jsx(Box, { flexGrow: 1, flexShrink: 1, children: _jsx(Text, { wrap: "truncate", children: job.label }) }), info !== undefined
                ? _jsxs(Text, { color: "accent", children: [" ", progressBarRatio(info.ratio, 8), " ", info.text] })
                : _jsx(Text, { dimColor: true, children: " \u2026" }), jobs.length > 1 ? _jsx(Text, { dimColor: true, children: ` +${jobs.length - 1}` }) : null] }));
}
/**
 * Mind-map style branch prefix: `├─` for every row but the last, which
 * closes with `└─`. The whole panel reads as one tree — the goal is the
 * root and each todo hangs off it.
 */
function BranchPrefix({ last }) {
    return _jsx(Text, { dimColor: true, children: last ? '└─ ' : '├─ ' });
}
/** 目标首行前缀；display width 运行时算（emoji 宽度随终端数据源变化）。 */
const GOAL_GLYPH = '🎯 ';
/** blocked 原因行前缀（与 §16 的树形装饰同宽）。 */
const BLOCKED_BAR = '│ ';
/**
 * 面板内容宽：面板宽减去左右 padding 各 1。所有折行/截断都以显示单元
 * 宽（stringWidth）为准，不用 JS 字符串长度。
 */
export function goalPanelContentWidth(width) {
    return Math.max(4, width - 2);
}
/** 目标折行宽：去掉首行 glyph 前缀，再留 1 格余量防 ink 二次折行。 */
export function goalObjectiveWidth(contentWidth) {
    return Math.max(4, contentWidth - stringWidth(GOAL_GLYPH) - 1);
}
/** blocked 原因折行宽：去掉竖线前缀，同样留 1 格余量。 */
export function goalBlockedWidth(contentWidth) {
    return Math.max(4, contentWidth - stringWidth(BLOCKED_BAR) - 1);
}
/** todo 折行：单条最多 2 行，超出部分拼回一行截断加省略号（现状语义）。 */
export function wrapTodoLines(content, width) {
    const wrapped = wrapTextLines(content, width).map(line => line.text);
    if (wrapped.length <= 2)
        return wrapped;
    return [wrapped[0], wrapText(wrapped.slice(1).join(''), width, 'truncate')];
}
/**
 * panel 形态的行模型：目标/状态/blocked/折叠头/todo 全部拍平成逐行数据。
 * 面板可滚动，因此 todo 不再按高度截断（没有 `…N more`）——所有条目都
 * 进入模型，渲染时只挂载视口内的行。折叠时只保留固定行。
 */
export function buildGoalPanelRows(input) {
    const { goal, todos, jobs = [], showTodoSection, collapsed, contentWidth, todoWidth } = input;
    const rows = [];
    if (goal !== undefined) {
        const objectiveWidth = goalObjectiveWidth(contentWidth);
        const objectiveLines = wrapTextLines(goal.objective, objectiveWidth);
        objectiveLines.forEach((line, index) => {
            rows.push({
                kind: 'objective', text: line.text, first: index === 0,
                // Signed content-end column is the renderer's copy contract: a
                // negative value restores the separator omitted at an exact fill.
                softWrapContinuation: line.continuation
                    ? (line.gap ? -1 : 1) * (stringWidth(GOAL_GLYPH) + stringWidth(objectiveLines[index - 1].text))
                    : undefined,
            });
        });
        rows.push({ kind: 'status' });
        if (goal.phase === 'blocked' && goal.blockedReason !== undefined) {
            rows.push({ kind: 'gap' });
            const blockedLines = wrapTextLines(goal.blockedReason.message, goalBlockedWidth(contentWidth));
            blockedLines.forEach((line, index) => {
                rows.push({
                    kind: 'blocked', text: line.text,
                    softWrapContinuation: line.continuation
                        ? (line.gap ? -1 : 1) * (stringWidth(BLOCKED_BAR) + stringWidth(blockedLines[index - 1].text))
                        : undefined,
                });
            });
        }
    }
    if (showTodoSection)
        rows.push({ kind: 'header' });
    if (jobs.length > 0)
        rows.push({ kind: 'jobs', jobs });
    if (!showTodoSection || collapsed)
        return rows;
    // 全部 todo 进入模型（D-9 修订：可滚动后不再用 `…N more` 隐藏条目）。
    // 视口只挂载 slice 出来的行，列表再长也不会撑破盒高。
    todos.forEach((todo, index) => {
        const last = index === todos.length - 1;
        wrapTodoLines(todo.content, todoWidth).forEach((text, lineIndex) => {
            rows.push({
                kind: 'todo',
                text,
                status: todo.status,
                first: lineIndex === 0,
                last,
            });
        });
    });
    return rows;
}
/** panel 视口行数：height 含顶部 padding（height>1 时占 1 行；缺省不窗口化）。 */
export function goalPanelViewportRows(height) {
    return height === undefined ? Number.POSITIVE_INFINITY : Math.max(1, height - (height > 1 ? 1 : 0));
}
/**
 * Live goal + todo panel above the prompt input. Data rides on the channel:
 * `channel.goal` is folded from `goal/change` context events and
 * `channel.todos` from `todo/write` whole-list snapshots, so every model
 * update re-renders this panel in real time (no polling). Renders nothing
 * while both slots are empty.
 *
 * The todo section folds two ways: completed rows fold automatically once
 * the agent goes idle (the header's `✓ done/total` count keeps the
 * summary), and `collapsed` folds the whole section to that single header
 * line any time — including mid-turn, where the line still previews the
 * in-progress task. `onToggle` is the click affordance for the header row;
 * the ctrl/cmd+q hotkey in Chat drives the same state.
 *
 * Goal elapsed time is the panel's own wall clock (started when the goal
 * id first appears, frozen on completion) — deliberately not derived from
 * session-event timestamps.
 */
export function GoalTodoPanel({ channel, collapsed = false, onToggle, idleDismissal = false, variant = 'default', visible = true, wrapWidth, width, height, scrollRef, }) {
    const goal = channel.goal;
    const objectiveRef = React.useRef(null);
    const goalTooltip = useTooltip(() => {
        // panel 形态目标完整可见、滚动就是全文入口——不挂 hover 全文（D-7）；
        // default 形态（chat 页底部 chrome）的 tooltip 原样保留。
        if (variant === 'panel')
            return '';
        const width = objectiveRef.current?.yogaNode?.getComputedWidth() ?? 0;
        if (goal === undefined || width <= 0)
            return '';
        return stringWidth(goal.objective) > width || goal.objective.includes('\n')
            ? goal.objective
            : '';
    });
    const allTodos = channel.todos ?? [];
    const doneCount = allTodos.filter(todo => todo.status === 'completed').length;
    // Completed rows are useful progress while a turn is running, but become
    // stale footer noise once the agent is idle. Keep unfinished work visible;
    // the header count carries the done summary either way.
    // panel 形态不自动隐藏完成行：侧栏折叠头常驻显示 ✓ done/total，用户
    // 「点开」是显式展开动作——idle 时把完成行过滤光就是「明明有 9 个、
    // 点开一条都没有」（完成行以 dim 呈现，进度语义不丢）。default 形态
    // （chat 页底部 chrome）保留原 auto-fold。
    const todos = variant === 'panel'
        ? allTodos
        : channel.working
            ? allTodos
            : allTodos.filter(todo => todo.status !== 'completed');
    // Local goal timer: remember when this goal id first rendered. Written in
    // render (idempotent lazy ref init) so a fresh mount with a live goal
    // starts counting immediately.
    const startRef = React.useRef(undefined);
    if (goal !== undefined && startRef.current?.id !== goal.id) {
        startRef.current = { id: goal.id, at: Date.now() };
    }
    const [now, setNow] = React.useState(() => Date.now());
    // Hover tint for the clickable todo fold header (mouse affordance).
    const [headerHovered, setHeaderHovered] = React.useState(false);
    const goalOpen = goal !== undefined && goal.phase !== 'complete';
    // Panel 形态：计时挂在共享动画时钟上（ClockProvider 单一定时源，
    // 终端失焦自动降频），visible=false 时传 null——零订阅。时钟只负责
    // 驱动重渲染；读数仍按墙钟（Date.now()）算，隐藏期间计时冻结的只是
    // 显示，重新打开立刻显示真实经过时间（mountPolicy=enabled 下面板
    // 保持挂载，startRef 不会重置）。
    const [clockRef] = useAnimationFrame(variant === 'panel' && goalOpen && visible ? 1000 : null);
    React.useEffect(() => {
        // default 形态保留原来的本地 1s 计时（底部 chrome 的既有行为）。
        if (variant === 'panel')
            return;
        // Tick only while the goal is open; a complete goal freezes the last
        // elapsed reading instead of counting past the finish line.
        if (goal === undefined || goal.phase === 'complete')
            return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [goal, variant]);
    const elapsed = goal !== undefined && startRef.current !== undefined
        ? formatDuration((variant === 'panel' ? Date.now() : now) - startRef.current.at)
        : undefined;
    // All-completed idle snapshot with no goal: nothing left to narrate —
    // the whole panel folds away (historical behavior).
    const anyUnfinished = allTodos.some(todo => todo.status !== 'completed');
    const showTodoSection = allTodos.length > 0 &&
        (channel.working || anyUnfinished || goal !== undefined || variant === 'panel');
    const activeJobs = (channel.backgroundJobs ?? []).filter(job => job.status === 'running' || job.status === 'stopping');
    const showJobsSection = activeJobs.length > 0;
    // ── panel 几何 / 滚动（default 形态不读这些值） ─────────────────────────
    // 宽度、折行与视口全部按显示单元计；直接挂载（缺省 width/height）时退化
    // 为不窗口化，行为与旧面板一致，夹具可以直接断言行模型。
    const [scrollTop, setScrollTop] = React.useState(0);
    const panelWidth = width ?? (wrapWidth !== undefined ? wrapWidth + 8 : 80);
    const contentWidth = goalPanelContentWidth(panelWidth);
    const todoWidth = wrapWidth !== undefined && wrapWidth > 4 ? wrapWidth : Math.max(10, panelWidth - 8);
    const viewportRows = goalPanelViewportRows(height);
    const panelRows = variant === 'panel'
        ? buildGoalPanelRows({ goal, todos, jobs: activeJobs, showTodoSection, collapsed, contentWidth, todoWidth })
        : undefined;
    const maxScroll = panelRows === undefined
        ? 0
        : Math.max(0, panelRows.length - viewportRows);
    // 渲染永远用 clamp 后的 top：state 短暂超过 maxScroll 也不会画出空白。
    const top = Math.min(scrollTop, maxScroll);
    const scrollBy = React.useCallback((delta) => {
        // 折叠头可能被滚出视口，onMouseLeave 不再触发——这里主动清 hover 底色。
        setHeaderHovered(false);
        setScrollTop(current => Math.max(0, Math.min(maxScroll, current + delta)));
    }, [maxScroll]);
    React.useImperativeHandle(scrollRef, () => ({ scrollBy }), [scrollBy]);
    // 切换会话或 goal 复位；同 id 的 revision 更新保留滚动位置。
    React.useEffect(() => {
        setScrollTop(0);
        setHeaderHovered(false);
    }, [channel.sessionId, goal?.id]);
    // 内容变短 / 折叠 / resize：只收敛 offset，不强制归零。
    React.useEffect(() => {
        setScrollTop(current => Math.min(current, maxScroll));
    }, [maxScroll]);
    if (goal === undefined && !showTodoSection && !showJobsSection)
        return null;
    // Collapsed preview: the live task when one runs, else the next open row.
    const preview = allTodos.find(todo => todo.status === 'in_progress')
        ?? allTodos.find(todo => todo.status !== 'completed');
    // 折叠头两种形态共用同一份结构/行为（点击、hover、▸/▾、✓ done/total、
    // 折叠预览），避免面板形态与 chat 页形态漂移。
    const foldHeader = (key) => (_jsxs(Box, { flexDirection: "row", height: 1, onClick: onToggle, onMouseEnter: () => setHeaderHovered(true), onMouseLeave: () => setHeaderHovered(false), backgroundColor: headerHovered ? 'userMessageBackgroundHover' : undefined, children: [_jsxs(Text, { dimColor: true, children: [collapsed ? '▸' : '▾', " "] }), _jsxs(Text, { dimColor: true, children: ["\u2713 ", doneCount, "/", allTodos.length, allTodos.length > 0 ? ` ${todoProgressBar(doneCount, allTodos.length)}` : ''] }), collapsed && preview !== undefined && (_jsx(Box, { flexGrow: 1, flexShrink: 1, marginLeft: 1, children: preview.status === 'in_progress' ? (_jsxs(Text, { wrap: "truncate", children: [_jsx(Text, { color: "suggestion", children: "\u25CF " }), preview.content] })) : (_jsxs(Text, { wrap: "truncate", dimColor: true, children: ["\u25CB ", preview.content] })) }))] }, key));
    if (variant === 'panel' && panelRows !== undefined) {
        const objectiveIndent = ' '.repeat(stringWidth(GOAL_GLYPH));
        return (_jsx(Box, { ref: clockRef, flexDirection: "column", width: width, height: height, paddingLeft: 1, paddingRight: 1, paddingTop: height !== undefined && height > 1 ? 1 : 0, overflow: "hidden", backgroundColor: "toolCardBackground", onWheel: (event) => {
                if (event.deltaY !== 0)
                    scrollBy(event.deltaY > 0 ? 1 : -1);
            }, children: panelRows.slice(top, top + viewportRows).map((row, index) => {
                switch (row.kind) {
                    case 'objective':
                        // 折行是渲染前预算好的（wrapTextLines），每行显式 height={1}；
                        // 续行用等宽空格对齐首行正文。前提是终端与 stringWidth 对 🎯 的
                        // 宽度取法一致：终端把它记成 1 格时，首行正文会比续行左移一格
                        // （宽度表差异，面板侧无法同时对齐两种终端）。
                        return (_jsxs(Box, { flexDirection: "row", height: 1, softWrapContinuation: row.softWrapContinuation, children: [_jsx(Box, { noSelect: true, marginLeft: -1, paddingLeft: 1, children: _jsx(Text, { color: "suggestion", children: row.first ? GOAL_GLYPH : objectiveIndent }) }), _jsx(Text, { bold: true, wrap: "truncate", children: row.text })] }, index));
                    case 'status':
                        // 状态独占一行，不再和目标争宽（窄面板下 truncate 兜底）。
                        return (_jsx(Box, { flexDirection: "row", height: 1, children: _jsx(PhaseBadge, { phase: goal.phase, roundsStarted: goal.roundsStarted, maxGoalRounds: goal.maxGoalRounds, budget: goal.budget, elapsed: elapsed }) }, index));
                    case 'gap':
                        return _jsx(Box, { height: 1 }, index);
                    case 'blocked':
                        return (_jsxs(Box, { flexDirection: "row", height: 1, softWrapContinuation: row.softWrapContinuation, children: [_jsx(Box, { noSelect: true, marginLeft: -1, paddingLeft: 1, children: _jsx(Text, { dimColor: true, children: BLOCKED_BAR }) }), _jsx(Text, { color: "error", wrap: "truncate", children: row.text })] }, index));
                    case 'header':
                        return foldHeader(index);
                    case 'jobs':
                        return _jsx(JobSummary, { jobs: row.jobs }, index);
                    case 'todo':
                        return (_jsxs(Box, { flexDirection: "row", height: 1, children: [row.first ? (_jsxs(_Fragment, { children: [_jsx(BranchPrefix, { last: row.last }), _jsx(TodoGlyph, { status: row.status })] })) : (_jsx(Text, { dimColor: true, children: row.last ? '     ' : '\u2502    ' })), _jsx(Text, { wrap: "truncate", dimColor: row.status === 'completed', children: row.text })] }, index));
                }
            }) }));
    }
    // ── default 形态的行预算（panel 形态渲染全部 todo，不走这段） ──
    const budget = MAX_TODOS;
    // 折行形态（宿主传 wrapWidth 时）：每条 todo 占 1~2 行，预算按「行」
    // 折算——放不下的整条让位给「…N more」，不撑破盒高。cap：折出 >2 行时
    // 保留第一行、其余拼回一行截断加省略号（wrapText truncate）。
    // 单行形态（chat 页现状）：与原 slice 语义逐字节一致。
    const display = [];
    if (wrapWidth !== undefined && wrapWidth > 4) {
        let used = 0;
        for (const todo of todos) {
            const lines = wrapTodoLines(todo.content, wrapWidth);
            if (display.length > 0 && used + lines.length > budget)
                break;
            display.push({ todo, lines });
            used += lines.length;
        }
    }
    else {
        for (const todo of todos.slice(0, budget))
            display.push({ todo, lines: [todo.content] });
    }
    const visibleTodos = display;
    const hidden = todos.length - display.length;
    return (_jsxs(Box, { flexDirection: "column", paddingLeft: 2, paddingRight: 2, paddingTop: 1, backgroundColor: "toolCardBackground", children: [goal !== undefined && (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Box, { flexDirection: "row", width: "100%", height: 1, children: [_jsx(Text, { color: "suggestion", children: GOAL_GLYPH }), _jsx(Box, { ref: objectiveRef, flexGrow: 1, flexShrink: 1, ...goalTooltip, children: _jsx(Text, { bold: true, wrap: "truncate", children: goal.objective }) }), _jsx(Box, { flexShrink: 0, marginLeft: 1, children: _jsx(PhaseBadge, { phase: goal.phase, roundsStarted: goal.roundsStarted, maxGoalRounds: goal.maxGoalRounds, budget: goal.budget, elapsed: elapsed }) })] }), goal.phase === 'blocked' && goal.blockedReason !== undefined && (_jsxs(Box, { flexDirection: "row", marginTop: 1, height: 1, children: [_jsx(Text, { dimColor: true, children: BLOCKED_BAR }), _jsx(Text, { color: "error", wrap: "truncate", children: goal.blockedReason.message })] }))] })), showJobsSection && _jsx(JobSummary, { jobs: activeJobs }), showTodoSection && (_jsxs(Box, { flexDirection: "column", children: [foldHeader(), !collapsed && (_jsxs(Box, { flexDirection: "column", children: [visibleTodos.map((item, index) => {
                                const last = index === visibleTodos.length - 1 && hidden === 0;
                                return item.lines.map((line, li) => (_jsxs(Box, { flexDirection: "row", height: 1, children: [li === 0 ? (_jsxs(_Fragment, { children: [_jsx(BranchPrefix, { last: last }), _jsx(TodoGlyph, { status: item.todo.status })] })) : (_jsx(Text, { dimColor: true, children: last ? '     ' : '\u2502    ' })), _jsx(Text, { wrap: "truncate", dimColor: item.todo.status === 'completed', children: line })] }, li)));
                            }), hidden > 0 && (_jsxs(Box, { flexDirection: "row", height: 1, children: [_jsx(BranchPrefix, { last: true }), _jsxs(Text, { dimColor: true, children: ["\u2026 ", hidden, " more"] })] }))] }))] }))] }));
}
