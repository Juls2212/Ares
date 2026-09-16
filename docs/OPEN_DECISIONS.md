# Open Decisions

Only unresolved matters appear here. Approved Phase 0 decisions are not reopened.

| Decision | Current approved position | Why open | Resolve by | Likely options and impact | Blocks Phase 1 |
| --- | --- | --- | --- | --- | --- |
| Windows PostgreSQL provisioning | PostgreSQL is mandatory; development uses Docker Compose. | Packaging deployment model is not yet chosen. | Before packaging. | Bundled/local managed provisioning vs documented external prerequisite; affects installer, support, and upgrades. | No. |
| Production OpenAI credential storage | Development uses environment variables; `safeStorage` will be evaluated for user-provided credentials. | Settings and packaging flow are later work. | Settings and packaging phases. | `safeStorage`-protected user entry vs another approved secure OS-backed approach; affects migration and recovery. | No. |
| Exact OpenAI model identifiers | OpenAI is planned for interpretation, Speech-to-Text, and Text-to-Speech. | Model availability can change. | Respective AI and voice implementation phases. | Select supported models at implementation time; affects capability, quality, cost, and testing fixtures. | No. |
| Notification recovery after close | Main owns notifications while running. | Background/restart behavior and packaging constraints are undefined. | Notification implementation before packaging. | No recovery, next-launch reconciliation, or an approved platform mechanism; affects reminder expectations. | No. |
| Definitive frontend design | Functional structure is documented; visual design is deferred. | It depends on user-supplied visual references and approval. | Before definitive frontend implementation. | Approved visual models determine layout and styling; affects renderer implementation only. | No. |
| Spoken confirmation after MVP | Visible UI confirmation is mandatory for Level 2 actions. | Spoken confirmation is explicitly optional later work. | After initial MVP, if requested. | Keep visible-only or add an approved voice-confirmation design; affects voice safety validation. | No. |

No additional unresolved issue was discovered during Phase 0 documentation. Recurring events, destructive file behavior, advanced organization classification, and arbitrary application control are excluded rather than open decisions.
