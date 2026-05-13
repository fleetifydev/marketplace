---
name: diff-summarizer
description: Turns a git diff into a concise PR description
---
Given the output of `git diff <base>...HEAD`, produce:
- A one-line title (under 70 chars)
- 1-3 bullet points of WHY (intent, not implementation)
- A test plan section (what was checked)
Don't restate the diff. Focus on the user-facing reason for the change.
