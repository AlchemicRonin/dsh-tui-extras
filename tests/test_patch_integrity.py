#!/usr/bin/env python3
"""Static regression checks for the versioned dsh-TUI patchset."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parent.parent
PATCH = ROOT / "patches" / "0.18.0"


class PatchIntegrityTests(unittest.TestCase):
    def test_expected_files_exist(self):
        expected = [
            "components/GoalTodoPanel.js",
            "components/Markdown.js",
            "components/MessageList.js",
            "components/PromptInput.js",
            "components/messages/AssistantTextMessage.js",
            "components/messages/AssistantToolUseMessage.js",
            "screens/StatusLine.js",
        ]
        for name in expected:
            with self.subTest(name=name):
                self.assertTrue((PATCH / name).is_file(), name)

    def test_scroll_lock_is_present(self):
        source = (PATCH / "components/MessageList.js").read_text(encoding="utf-8")
        self.assertIn("detachedRef", source)
        self.assertIn("lastScrollTopRef", source)
        self.assertIn("&& !detachedRef.current", source)

    def test_interrupt_hint_is_hidden_while_interrupting_stays(self):
        source = (PATCH / "screens/StatusLine.js").read_text(encoding="utf-8")
        self.assertIn("statusline-hint-interrupting", source)
        self.assertNotIn("statusline-hint-working", source)

    def test_path_chips_are_present(self):
        source = (PATCH / "components/PromptInput.js").read_text(encoding="utf-8")
        self.assertIn("pathPattern", source)
        self.assertIn("file:\\/\\/", source)

    def test_terminal_body_stays_capped(self):
        source = (PATCH / "components/messages/AssistantToolUseMessage.js").read_text(encoding="utf-8")
        self.assertIn("headerIsTerminal && isExpanded", source)

    def test_path_paste_padding_is_present(self):
        source = (PATCH / "components/PromptInput.js").read_text(encoding="utf-8")
        self.assertIn("padPathPaste", source)


if __name__ == "__main__":
    unittest.main()
