import { jsx as _jsx } from "react/jsx-runtime";
import React from 'react';
import { marked } from 'marked';
import { Box, Text, useTheme } from '../ui.js';
import { getTheme } from '../theme.js';
import { appendBlockText, configureMarked, formatToken, stripPromptXMLTags } from '../terminal-utils/markdown.js';
import { getCliHighlightPromise } from '../terminal-utils/cliHighlight.js';
import { isMermaidLang } from '../terminal-utils/mermaid.js';
import { isMathBlockToken, isMathToken } from '../terminal-utils/math.js';
import { getMathRendering, subscribeMathRendering } from '../tuiDisplayPrefs.js';
import { MarkdownTable } from './MarkdownTable.js';
import { CodeBlockFrame } from './CodeBlockFrame.js';
import { MermaidDiagram } from './MermaidDiagram.js';
import { InlineMathParagraph } from './InlineMathParagraph.js';
import { MathBlock } from './MathBlock.js';
/**
 * Hang decoration for the ANSI text runs: a terminal-wrapped continuation
 * lines up under its line's quote rails, list marker or indentation
 * instead of falling back to column 0. One shared object, because the
 * style diff and the measure/paint caches compare it by reference.
 */
const HANG_DECORATION = { hang: true };
// ---- token 缓存 ----
//
// marked.lexer 在组件重挂载时是最贵的开销；消息内容不可变，相同文本
// 必然产出相同 token，因此以原文为 key 缓存。
//
// 容量控制不能只看条数：Token 的 raw/text 字段是输入字符串的切片，
// 会钉住整段输入常驻内存；流式渲染时输入逐帧增长，若只按条数限流，
// LRU 会保留大量接近最终形态的快照（1MB 消息 ≈ 500 条 × 1MB ≈
// 500MB）。这里用字符预算限制保留量，超长内容干脆不缓存（重挂载时
// 重跑 lexer，极少发生且远比常驻便宜）。
const TOKEN_CACHE_CAPACITY = 200;
const TOKEN_CACHE_CHAR_BUDGET = 200_000;
const TOKEN_CACHE_MAX_SOURCE_LENGTH = 20_000;
const TEXT_BLOCK_BUDGET = 8192;
const tokenCache = new Map();
let tokenCacheChars = 0;
// 语法探针：全文都没有结构标记时才跳过 lexer，不能仅凭纯文本前缀
// 忽略后面的公式或 Markdown。`$` 与 `\` 覆盖 LaTeX 公式定界符。
const MD_SYNTAX_MARKERS = /[#*`|[>\-_~$\\]|\n\n|^\d+\. |\n\d+\. /;
function looksLikePlainText(s) {
    return !MD_SYNTAX_MARKERS.test(s);
}
function lexWithCache(content, allowCache) {
    // 快速路径：纯文本直接合成单个段落 token，不触碰 lexer。
    if (looksLikePlainText(content)) {
        return [
            {
                type: 'paragraph',
                raw: content,
                text: content,
                tokens: [{ type: 'text', raw: content, text: content }],
            },
        ];
    }
    if (!allowCache)
        return marked.lexer(content);
    // 直接用内容字符串做 key：V8 在字符串头缓存哈希，首次插入后 Map
    // 查找无需再算哈希，也比 sha256 少一次摘要分配与碰撞风险。
    const hit = tokenCache.get(content);
    if (hit) {
        tokenCache.delete(content); // 提升为最近使用
        tokenCache.set(content, hit);
        return hit;
    }
    const tokens = marked.lexer(content);
    if (content.length > TOKEN_CACHE_MAX_SOURCE_LENGTH)
        return tokens;
    // Evict oldest entries (Map preserves insertion order) until both the
    // count and char budgets fit. The previous full clear() nuked the whole
    // cache every time a long session crossed 200 blocks — every subsequent
    // row remount then re-ran the lexer (scroll-through-a-long-session
    // stutter); evicting only what the newcomer displaces keeps the working
    // set warm.
    while (tokenCache.size >= TOKEN_CACHE_CAPACITY ||
        tokenCacheChars + content.length > TOKEN_CACHE_CHAR_BUDGET) {
        const oldest = tokenCache.keys().next().value;
        if (oldest === undefined)
            break;
        tokenCache.delete(oldest);
        tokenCacheChars -= oldest.length;
    }
    tokenCache.set(content, tokens);
    tokenCacheChars += content.length;
    return tokens;
}
/**
 * Tokens that render as their own layout node (a width-aware component)
 * instead of joining the ANSI text run. StreamingMarkdown consults the same
 * predicate: a standalone node has a fixed one-row gap to its neighbours
 * rather than the newline-derived spacing of text blocks. Top-level
 * fenced code is one too (CodeBlockFrame).
 */
export function isStandaloneToken(token) {
    return (token.type === 'table' ||
        token.type === 'code' ||
        isMermaidToken(token) ||
        isMathBlockToken(token));
}
/** Whether a paragraph holds inline math anywhere in its inline tokens. */
function hasInlineMath(token) {
    for (const child of token.tokens ?? []) {
        if (isMathToken(child) || hasInlineMath(child))
            return true;
    }
    return false;
}
function isMermaidToken(token) {
    return token.type === 'code' && isMermaidLang(token.lang);
}
/**
 * 把 lexer 产出的 token 列表转成 React 节点序列：table、mermaid 与公式块
 * 独立渲染，其余 token 的 ANSI 文本按完整块分批拼接，只去整段首尾空白。
 */
function renderTokensToNodes(tokens, highlight, dimColor, inlineMathImages) {
    const nodes = [];
    let ansiText = '';
    let textParts = [];
    let afterOwnNode = false;
    const flushAnsiText = () => {
        if (!ansiText && textParts.length === 0)
            return;
        if (textParts.length === 0) {
            nodes.push(_jsx(Text, { dimColor: dimColor, decoration: HANG_DECORATION, children: ansiText.trim() }, nodes.length));
        }
        else {
            textParts.push(ansiText);
            let first = 0;
            let last = textParts.length - 1;
            while (first < last && textParts[first].trimStart() === '')
                first++;
            while (last > first && textParts[last].trimEnd() === '')
                last--;
            textParts[first] = textParts[first].trimStart();
            textParts[last] = textParts[last].trimEnd();
            // Each internal boundary replaces exactly one source newline with a
            // column-child boundary. Only the whole text span trims outer space.
            nodes.push(_jsx(Box, { flexDirection: "column", children: textParts.slice(first, last + 1).map((part, index) => (_jsx(Text, { dimColor: dimColor, decoration: HANG_DECORATION, children: index + first < last ? part.slice(0, -1) : part }, index))) }, nodes.length));
        }
        ansiText = '';
        textParts = [];
    };
    for (const token of tokens) {
        const ownNodeBefore = afterOwnNode;
        afterOwnNode = false;
        if (token.type === 'table') {
            flushAnsiText();
            nodes.push(_jsx(MarkdownTable, { token: token, highlight: highlight }, nodes.length));
        }
        else if (inlineMathImages && token.type === 'paragraph' && hasInlineMath(token)) {
            flushAnsiText();
            nodes.push(_jsx(InlineMathParagraph, { token: token, highlight: highlight }, nodes.length));
            afterOwnNode = true;
        }
        else if (ownNodeBefore && token.type === 'space') {
            // The blank line after a paragraph that became its own node is the
            // column gap now; as text it would flush as an empty node (an extra
            // gap row). In a text run the same newline is trimmed at the flush.
        }
        else if (isMathBlockToken(token)) {
            flushAnsiText();
            nodes.push(_jsx(MathBlock, { token: token, dimColor: dimColor }, nodes.length));
        }
        else if (isMermaidToken(token)) {
            flushAnsiText();
            nodes.push(_jsx(MermaidDiagram, { token: token, highlight: highlight, dimColor: dimColor }, nodes.length));
        }
        else if (token.type === 'code') {
            // Top-level fences get the CodeBlockFrame (header/rail/padding);
            // the mermaid branch above keeps diagram fences routed to
            // MermaidDiagram (whose fallback re-enters the frame), and code
            // nested in lists/quotes keeps formatToken's ANSI path.
            flushAnsiText();
            nodes.push(_jsx(CodeBlockFrame, { token: token, highlight: highlight, dimColor: dimColor }, nodes.length));
        }
        else {
            // appendBlockText inserts the row break after the (newline-free) hr
            // divider when the next block does not open its own line.
            ansiText = appendBlockText(ansiText, formatToken(token, 0, null, null, highlight));
            // A top-level token boundary keeps inline formatting and code fences
            // intact while letting the painter cull finished offscreen text blocks.
            if (ansiText.length >= TEXT_BLOCK_BUDGET && ansiText.endsWith('\n')) {
                textParts.push(ansiText);
                ansiText = '';
            }
        }
    }
    flushAnsiText();
    return nodes;
}
/**
 * 混合渲染 Markdown 内容：表格用带边框的 flexbox 组件，其余内容由
 * formatToken 生成 ANSI 字符串放入 Text。高亮对象异步就绪后自动刷新。
 *
 * memo by content: finished transcript blocks render with the SAME string
 * identity for the whole session (StreamingMarkdown keeps its stable prefix
 * identity-stable precisely to hit this); without the memo every parent
 * re-render re-ran the full token→ANSI→yoga pipeline for every settled
 * block — the dominant long-output stall (string-width via wrap-ansi, 60%+
 * of CPU in streaming profiles).
 */
function MarkdownImpl({ children, dimColor = false, cacheTokens = true, inlineMathImages = true, stripPromptTags = true }) {
    const [highlight, setHighlight] = React.useState(null);
    // Inline math is baked into the ANSI text, so the switch must invalidate
    // the memo below (MathBlock nodes subscribe on their own).
    const mathRendering = React.useSyncExternalStore(subscribeMathRendering, getMathRendering);
    // 渲染结果把主题色烤进 ANSI（链接 accent、行内代码 permission、列表点…）。
    // 消费主题上下文让这个 memo 组件在换主题时也重渲染（context 更新绕过
    // React.memo）；memo 依赖取**调色板身份**而非名字——`auto` 明暗翻转时名字
    // 不变但色板换了，只按名字会漏。
    const [themeName] = useTheme();
    const palette = getTheme(themeName);
    React.useEffect(() => {
        let mounted = true;
        void getCliHighlightPromise().then((loaded) => {
            if (mounted)
                setHighlight(loaded);
        });
        return () => {
            mounted = false;
        };
    }, []);
    configureMarked();
    const renderedNodes = React.useMemo(() => {
        const source = stripPromptTags ? stripPromptXMLTags(children) : children;
        return renderTokensToNodes(lexWithCache(source, cacheTokens), highlight, dimColor, 
        // Dimmed text (thinking) cannot dim an image, so it keeps Unicode.
        inlineMathImages && mathRendering === 'image' && !dimColor);
    }, [children, dimColor, highlight, cacheTokens, mathRendering, inlineMathImages, palette, stripPromptTags]);
    return (_jsx(Box, { flexDirection: "column", gap: 1, children: renderedNodes }));
}
/**
 * Memoized Markdown: skips the whole token→ANSI→layout pipeline when the
 * content string is the same reference (see MarkdownImpl's doc comment).
 */
export const Markdown = React.memo(MarkdownImpl, (prev, next) => prev.children === next.children &&
    prev.dimColor === next.dimColor &&
    prev.cacheTokens === next.cacheTokens &&
    prev.inlineMathImages === next.inlineMathImages &&
    prev.stripPromptTags === next.stripPromptTags);
