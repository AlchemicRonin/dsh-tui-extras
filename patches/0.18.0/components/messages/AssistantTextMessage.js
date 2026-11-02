import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, NoSelect, Text } from '../../ui.js';
import { BLACK_CIRCLE } from '../../terminal-utils/figures.js';
import { Markdown } from '../Markdown.js';
/**
 * Assistant text message: bullet + markdown body.
 *
 * Deliberately not clickable: the transcript is reading material and the
 * mouse's job there is text selection (user feedback — row hover tints and
 * fold toggling were noise, not affordance).
 */
export function AssistantTextMessage({ text, marginTopOnTurn, isSelected = false, isExpanded = false, }) {
    return (_jsx(Box, { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between", marginTop: marginTopOnTurn ? 1 : 0, width: "100%", backgroundColor: isSelected
            ? 'messageActionsBackground'
            : isExpanded
                ? 'userMessageBackgroundHover'
                : undefined, children: _jsxs(Box, { flexDirection: "row", children: [_jsx(NoSelect, { fromLeftEdge: true, minWidth: 2, children: _jsx(Text, { color: isSelected ? 'suggestion' : 'text', children: BLACK_CIRCLE }) }), _jsx(Box, { flexDirection: "column", children: _jsx(Markdown, { children: text }) })] }) }));
}
