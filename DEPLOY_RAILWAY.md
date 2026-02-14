# Deploy to Railway

## 1. Push project to GitHub
Railway deploys from a Git repo.

## 2. Create project in Railway
1. New Project
2. Deploy from GitHub repo
3. Select this repository

## 3. Add persistent disk (important for SQLite)
1. In Railway: service -> Settings -> Volumes
2. Add Volume
3. Mount path: `/data`

Without a volume, SQLite data will reset after redeploy/restart.

## 4. Set environment variables
In Railway -> Variables:

- `DB_PATH=/data/budget.db`
- `HOST=0.0.0.0`
- `BACKUP_DIR=/data/backups` (optional, recommended)

`PORT` is injected by Railway automatically.

## 5. Deploy
Railway will use:
- `railway.toml`
- `Procfile`
- `python server.py` start command

## 6. Verify
After deploy open:
- `/` -> app UI
- logowanie PIN działa
- analizy wydatków i wpływów ładują się poprawnie

## One-time cleanup (keep PIN, remove test data)
Run once after deploy (or locally) to clear balance/history/plans and keep current PIN:

```powershell
python reset_state_keep_pin.py --db /data/budget.db
```

## Backups (automatic)
- Przy starcie serwera tworzony jest backup SQLite.
- Potem backup tworzony jest co 24h.
- Retencja: 14 najnowszych plików.
- Domyślna lokalizacja: `<katalog DB>/backups` lub ścieżka z `BACKUP_DIR`.

### Manual restore example
Zatrzymaj usługę, podmień plik DB i uruchom ponownie:

```powershell
cp /data/backups/budget_YYYYMMDD_HHMMSS.db /data/budget.db
```

## Local simulation of Railway env
```powershell
$env:PORT="8080"
$env:DB_PATH="budget.db"
python server.py
```
