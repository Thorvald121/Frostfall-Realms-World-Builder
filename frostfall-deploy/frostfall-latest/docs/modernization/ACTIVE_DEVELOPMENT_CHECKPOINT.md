# Frostfall Realms — active modernization checkpoint

2026-11-17 · P7 World Studio shell · based on GitHub `modernization/p6-github-integration-20261116` commit `3bc783cdb31c3dd16c3d7a40b044a0cfe6d49eb0`.

- P1–P6 are integrated into GitHub and deployed in production on Vercel from the P6 branch; GitHub `main` remains legacy. P7 changes are packaged for the separate `feature/p7-world-studio-shell-20261117` branch and **not yet deployed**.
- Source of truth: `Thorvald121/Frostfall-Realms-World-Builder`, app directory `frostfall-deploy/frostfall-latest/`. Connected GitHub API identity `velessec` cannot push to it; Windows Git user `Thorvald121` can publish.
- P7: real React shell replaces the legacy dashboard, groups navigation, reduces category clutter, preserves existing tools, nine themes, per-module color identity and theme selector. No DB mutation or dependency edits.
- Live Supabase `yininaosnfpowhhauuxe` contains 8 worlds/168 articles: 165 Aelvarin, 2 Karak-Izdar, 1 Mangoss, 0 Chairondis (selected in user screenshots). The Chairondis owner does not currently have access to the other seven worlds; respect RLS and do not reassign ownership automatically. P2/P3 migrations and execution-grant hardening were already applied with a private in-DB snapshot.
- P7 authoring tests: 84/84 Node tests, 76 modules parsed, 106 local imports, 5 CSS parsed. Complete Next build and deployed browser acceptance still outstanding.
- Blockers before further promotion: authenticated browser acceptance, a durable independent production backup, reconcile committed schema migrations, legacy `user_worlds` view SECURITY DEFINER, and old main branch merge strategy.
- Keep production data; never interpret 0 records in an empty world as account-wide data loss. No account deletion button until secure implementation exists.
