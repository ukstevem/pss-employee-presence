# AI assistant — read me first

You are working on **pss-employee-presence**, a new PSS standalone app being scaffolded
from the template at `NEW_STANDALONE_APP.md` (in this repo's root).

## First steps every session
1. Run `bd prime` — this project uses **beads (bd)** for task tracking.
2. Read `NEW_STANDALONE_APP.md` end-to-end. It contains every file
   template you need (Dockerfile, docker-compose.app.yml,
   next.config.ts, .dockerignore, build.sh, etc.) plus the architecture
   invariants you must not break (port, service name, basePath,
   platform_net, canonical .env, .dockerignore).
3. The bare app name is **`employee-presence`** (used as the basePath route and
   the docker service name). Reserve a port in
   `../platform-portal/docs/PORTS.md` before scaffolding.

## Tooling rules
- Use `bd create` / `bd update --claim` / `bd close` for task tracking.
  Do NOT use TodoWrite or markdown TODO lists.
- Use `bd remember` for persistent insights. Do NOT use MEMORY.md files.
- Session close protocol: `git status` → `git add` → `git commit` →
  `git push`. Work isn't done until pushed.

## Reference apps
Mirror the patterns in `../pss-matl-cert/` and `../pss-assembly-viewer/`
when in doubt.
