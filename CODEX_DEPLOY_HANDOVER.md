# Self-hosted Docker handover: Average Price Planner v1.3.0

## Deployment target

- Directory: choose a local path on the Docker host.
- Bind address: set `BIND_ADDRESS` in `.env` to one LAN address assigned to that host.
- Port: set `PORT` in `.env` (defaults to `8091`).
- Health endpoint: `http://<BIND_ADDRESS>:<PORT>/healthz`.

## Update procedure

1. Back up the current directory.
2. Extract the v1.3.0 package over the selected deployment directory.
3. Run `docker compose up -d --build`.
4. Confirm `docker compose ps` and the health endpoint.
5. Browser-check:
   - settings are always visible;
   - both sliders cover 5%–100%;
   - the only position can be deleted and is replaced with a blank form;
   - adding a transaction resets only the share amount to 0;
   - the transaction price remains unchanged.

## GitHub

Push this directory to the public repository after local validation. The Pages workflow deploys the static frontend separately from any self-hosted Docker instance.
