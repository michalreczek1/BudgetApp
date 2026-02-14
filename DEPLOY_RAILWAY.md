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

`PORT` is injected by Railway automatically.

## 5. Deploy
Railway will use:
- `railway.toml`
- `Procfile`
- `python server.py` start command

## 6. Verify
After deploy open:
- `/` -> app UI
- `/api/state` -> JSON state

## Local simulation of Railway env
```powershell
$env:PORT="8080"
$env:DB_PATH="budget.db"
python server.py
```
