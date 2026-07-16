# Update an existing OpenStock deployment to v1.3.0

Upload `average-price-planner-v1.3.0.tar.gz` to `/tmp`, then run:

```bash
cd /opt/stock-average-optimizer

sudo cp -a \
  /opt/stock-average-optimizer \
  "/opt/stock-average-optimizer.backup-$(date +%Y%m%d-%H%M%S)"

sudo tar -xzf \
  /tmp/average-price-planner-v1.3.0.tar.gz \
  -C /opt/stock-average-optimizer

sudo chown -R "$USER":"$USER" /opt/stock-average-optimizer

docker compose up -d --build

docker compose ps
curl -fsS http://192.168.23.253:8091/healthz
echo
```

Open `http://192.168.23.253:8091` and press `Ctrl+F5` once.

Browser-stored holdings and plans remain in place because the storage key is unchanged.
