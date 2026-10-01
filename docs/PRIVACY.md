# Privacy and local data

Credentials are stored using Windows protection. Conversation history, drafts, images, scheduling instructions and usage records stay in local application data unless an explicit generation, tool or export request sends them to its configured service.

Usage statistics store counts and provenance, not prompt text. Conversation history stores message text separately. Deleting a conversation can retain anonymous usage totals; images are retained unless file deletion is explicitly selected. File cleanup checks registered ownership and changed content.

HTML previews use an opaque sandbox and an offline content policy. The manual browser uses an isolated partition and can retain site login data; current-site data can be cleared explicitly. Manual terminals inherit the user's development environment but do not receive application-injected secrets.

Public repository documents describe product behavior. Local handovers, machine paths, private acceptance evidence and conversation excerpts belong in ignored `local/`, `docs/local/` or `docs/private/` directories. Do not attach unredacted logs, credentials or private project content to public issues.
