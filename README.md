# pss-employee-presence

PSS standalone app for employee presence tracking.

- **Port:** 3011
- **Service name:** `employee-presence`
- **basePath:** `/employee-presence`
- **Route:** `http://10.0.0.75:3000/employee-presence/`

See [`NEW_STANDALONE_APP.md`](./NEW_STANDALONE_APP.md) for the architecture invariants
and full build/deploy workflow. Reference apps: `../pss-matl-cert/`, `../pss-assembly-viewer/`.

## Local dev

```bash
cd app
npm install
npm run dev      # → http://localhost:3011/employee-presence/
```

## Build & push

```bash
./build.sh       # cross-builds linux/arm64, pushes :<sha> and :latest to ghcr.io
```

## Deploy (Pi)

```bash
cd /opt/pss-employee-presence
git pull
docker compose -f docker-compose.app.yml pull
docker compose -f docker-compose.app.yml up -d
```

## Task tracking

This project uses [beads (`bd`)](https://github.com/) for task tracking.

```bash
bd ready          # available work
bd show <id>      # issue detail
bd close <id>     # complete
```
