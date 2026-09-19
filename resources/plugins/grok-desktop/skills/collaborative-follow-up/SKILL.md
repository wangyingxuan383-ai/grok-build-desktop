---
name: collaborative-follow-up
description: A reusable workflow for researching a task, delegating independent work with native Grok subagents, verifying results, and scheduling an explicitly requested follow-up.
---

1. Read the user's scope and the Desktop capabilities tool. Distinguish configured components, injected integrations, observed calls and live acceptance. Unknown is not success.
2. Research first, then choose independent bounded subtasks. Use the CLI's discovered native spawn_subagent tool; do not create a second scheduler or invent availability. Select isolation explicitly. Persona/worktree hints are not enforced isolation unless reported as verified.
3. Track native subagent IDs separately from child session IDs. Read results with the native result tool, send follow-ups only when the CLI exposes the message tool, and cancel with the supported native operation. A prose claim is not a verified result.
4. Perform GUI work in the parent session. Prefer a purpose-built connector, then a structured browser tool, then Windows Computer Use. Desktop MCP authority is not inherited by child agents; return their GUI work to the parent. Obey server-side disabled states and the desktop lease.
5. Check artifacts and actual final state. Reuse the current conversation, task history and permission settings. Create a persistent follow-up only if explicitly requested, following persistent-tasks. Otherwise finish with the verified result and remaining limits.
