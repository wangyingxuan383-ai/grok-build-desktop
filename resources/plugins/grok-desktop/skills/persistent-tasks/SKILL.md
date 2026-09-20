---
name: persistent-tasks
description: Create, inspect, edit, pause or cancel persistent future work in Grok Build Desktop when the user asks for a reminder, a schedule, monitoring, or to continue later.
---

Use the session-bound grok_desktop MCP tools for persistent scheduling. Discover the actual tools before acting. Native /loop runs only inside its CLI session and is not a substitute for persistent Windows tasks.

Only create a task for an explicit future-execution intent in the user's request or an explicitly invoked workflow. Do not schedule merely because follow-up could be useful. Set futureIntent to true only for that intent.

Choose current-session to continue this conversation; choose standalone for independent work. Current-session work waits for its owner to become idle; overlapping triggers coalesce. Set contextPolicy to fresh for a standalone task that needs clean context on each run, or reuse to retain its task conversation. Current-session requires reuse. Earlier sessions and run history are preserved. Capture a concrete prompt with enough context for the chosen destination. Specify an IANA time zone, a timestamp with UTC offset for a one-off run, or a daily/weekly wall-clock time. Ask only when missing information affects the schedule or task.

Inspect existing tasks and update a matching task instead of creating duplicates. Use returned task IDs for future changes. Report the task ID, destination/session, workspace, timezone and next run, and the real registration status. A registration error is not a successfully scheduled task; explain the returned error. Do not generate schtasks commands or edit internal task JSON.

Use automation_runs to inspect execution and automation_cancel_run to stop a run; pausing a task affects future triggers. Use automation_delete for removal. Respect the session's Plan/Agent/Auto mode. Never invent tools, hook proofs, live-verification evidence, or results. A tool denied due to missing CLI caller identity is unavailable until the CLI integration is verified; do not bypass it with shell or child agents.
