# Update an existing self-hosted deployment to v1.3.0

Upload `average-price-planner-v1.3.0.tar.gz` to the Docker host, then set the deployment directory and local interface address before running the update:

```bash
export DEPLOY_DIR=/path/to/average-price-planner
export BIND_ADDRESS=YOUR_LAN_ADDRESS

cd "$DEPLOY_DIR"

sudo cp -a \
  "$DEPLOY_DIR" \
  "${DEPLOY_DIR}.backup-$(date +%Y%m%d-%H%M%S)"

sudo tar -xzf \
  /tmp/average-price-planner-v1.3.0.tar.gz \
  -C "$DEPLOY_DIR"

sudo chown -R "$USER":"$USER" "$DEPLOY_DIR"

docker compose up -d --build

docker compose ps
curl -fsS "http://${BIND_ADDRESS}:8091/healthz"
echo
```

Open `http://${BIND_ADDRESS}:8091` and press `Ctrl+F5` once.

Browser-stored holdings and plans remain in place because the storage key is unchanged.
