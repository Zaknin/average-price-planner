# Codex handover: Average Price Planner v1.3.0

## Deployment target

- Server: `192.168.23.253`
- Directory: `/opt/stock-average-optimizer`
- URL: `http://192.168.23.253:8091`
- Health endpoint: `http://192.168.23.253:8091/healthz`

## Update procedure

1. Back up the current directory.
2. Extract the v1.3.0 package over `/opt/stock-average-optimizer`.
3. Run `docker compose up -d --build`.
4. Confirm `docker compose ps` and the health endpoint.
5. Browser-check:
   - settings are always visible;
   - both sliders cover 5%–100%;
   - the only position can be deleted and is replaced with a blank form;
   - adding a transaction resets only the share amount to 0;
   - the transaction price remains unchanged.

## GitHub

Push this directory to the private repository after local validation. The Pages workflow remains available for a public static deployment if enabled.
