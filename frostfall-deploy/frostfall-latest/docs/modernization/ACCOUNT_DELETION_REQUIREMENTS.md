# Frostfall Realms — Account-deletion requirement

**Requested:** November 16, 2026. **Status:** accepted for implementation; **not implemented in P4**. The original hosted portal has no self-service account deletion, although it has world-data deletion/reset controls. Those controls are not equivalent to account deletion.

## Acceptance criteria

1. Settings → Account must offer an accessible **Delete Account** action separate from **Delete World** and **Reset Settings**. This is a destructive privileged action, not a one-click operation.
2. Before deletion, the user can export **all owned worlds**, all articles/archived records, all manuscripts and revision history, canon branches/assertions/sources/findings, maps, images, and any other stored personal data. Warn if export is partial or fails. Never claim backup success before the download is validated.
3. Clearly enumerate worlds solely owned by the user, worlds with collaborators, worlds owned by someone else in which the user is a member, and authored material. Block deletion for any shared world that requires ownership reassignment or explicit deletion; do not silently destroy collaborators' work.
4. Require a recent session, reauthentication via supported credential provider, and a typed confirmation. For OAuth accounts, use a secure supported reauth path rather than assuming a password exists.
5. Server-owned, rate-limited, authenticated deletion workflow: verify access token server-side, verify the user ID from the session (never from request body), and use protected server credentials for Auth deletion. No service-role secret is ever exposed in client code. Deny third-party targets and log the action without exposing manuscripts or private lore.
6. Use an idempotent deletion job/state machine and irreversible-step checks, with explicit error/reporting paths. Address portraits/storage assets, public object URLs, collaboration invitations, API key material, analytics/session data, and external integrations. Identify all FK, RLS, and storage policies in the **deployed** schema before writing any destructive SQL.
7. A completed deletion revokes sessions and removes the Auth identity and personal records, subject to documented legal retention. Users receive a confirmation and accurate description of what is retained, if anything.
8. Verify owner, collaborator, viewer, OAuth, password, shared-world, and partial-failure cases with **staging** accounts. The endpoint must never be enabled merely because a UI test passes.

## Blockers before implementation

- The live database, storage bucket layout, auth providers, and collaboration schema have **not** been inspected; the supplied historical `schema.sql` is not proof of the deployed schema.
- P2 and P3 Supabase migrations are **not** yet verified as applied to staging or production.
- Need authenticated staging test users, a verified complete export/import path, and restore-tested backup before destructive testing.

**Do not deploy a mock delete button. Do not remove a Supabase Auth user until owned and shared data have an explicit policy and the deletion job is verified end to end.**
