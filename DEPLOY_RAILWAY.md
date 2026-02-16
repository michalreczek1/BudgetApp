# Deploy to Railway

## 1. Push project to GitHub
Railway deploys from a Git repository.

## 2. Create project in Railway
1. New Project
2. Deploy from GitHub repo
3. Select this repository

## 3. Add persistent disk (required for SQLite)
1. In Railway: service -> Settings -> Volumes
2. Add Volume
3. Mount path: `/data`

Without a mounted volume, SQLite data resets after redeploy/restart.

## 4. Set environment variables
In Railway -> Variables:

- `DB_PATH=/data/budget.db`
- `BACKUP_DIR=/data/backups`
- `HOST=0.0.0.0`
- `REQUIRE_PERSISTENT_STORAGE=1` (recommended)
- `PERSISTENT_MOUNT_PATH=/data` (optional, default `/data`)
- `BACKUP_INTERVAL_SECONDS=21600` (optional, every 6h)
- `BACKUP_RETENTION_COUNT=30` (optional)

`PORT` is injected by Railway automatically.

## 5. Storage safety guard (new)
The server now blocks startup on Railway when persistent storage is not safe:
- `DB_PATH` must be inside `PERSISTENT_MOUNT_PATH`
- the mount path (default `/data`) must be an actual mount point

Emergency bypass (not recommended):
- `ALLOW_EPHEMERAL_DB=1`

## 6. Deploy
Railway uses:
- `railway.toml`
- `Procfile`
- `python server.py` start command

## 7. Verify after deploy
1. Open `/` and log in.
2. Check storage status endpoint:
   - `GET /api/storage/status` (requires auth)
   - expected: `"safe": true`, `"requiredMountPresent": true`, `"dbOnRequiredMount": true`
3. Confirm logs contain mount message and DB path:
   - `Mounting volume ...`
   - `Database: /data/budget.db`

## Backups
Automatic:
- Startup backup on every server start
- Scheduled backups with retention

Manual restore example:
```powershell
cp /data/backups/budget_YYYYMMDD_HHMMSS.db /data/budget.db
```

Manual download (new, requires logged-in session):
- SQLite backup file:
  - `GET /api/backup/download?format=sqlite`
- JSON state snapshot:
  - `GET /api/backup/download?format=json`

You can also download both from the Admin panel in the app UI.

## One-time cleanup (keep PIN, remove state)
```powershell
python reset_state_keep_pin.py --db /data/budget.db
```

## Local simulation
```powershell
$env:PORT="8080"
$env:DB_PATH="budget.db"
python server.py
```

