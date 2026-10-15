# Project memory

Before significant changes read docs/memory.md, docs/business-rules.md and docs/architecture.md. Update memory after verified changes. The user has authorized implementation through phase 6. Do not implement the Windows agent or Tauri packaging prematurely. Money is integer PEN cents; controller extras are ONE_TIME_PER_SESSION. No deletion of financial history. All writes require authorization and audit in the same PostgreSQL transaction. Realtime events must be emitted only after commit and remain a notification layer over REST.
