# Deploy na Proxmox

Ta aplikacja ma dzialac tylko na Proxmox. Deploy na Railway jest celowo wylaczony:

- `railway.toml` zostal usuniety,
- `Procfile` zostal usuniety,
- serwer odmawia startu po wykryciu srodowiska Railway, chyba ze jawnie ustawisz awaryjne `ALLOW_RAILWAY_DEPLOY=1`.

## Zalecany uklad

- VM albo LXC na Proxmox z Pythonem 3.11+.
- Katalog aplikacji, np. `/opt/budget-app`.
- Trwala baza SQLite poza katalogiem kodu, np. `/var/lib/budget-app/budget.db`.
- Backupy w `/var/lib/budget-app/backups`.
- Reverse proxy lokalnie w sieci domowej, np. Nginx albo Caddy.

## Zmienne srodowiskowe

```bash
APP_TIMEZONE=Europe/Warsaw
HOST=127.0.0.1
PORT=8080
DB_PATH=/var/lib/budget-app/budget.db
BACKUP_DIR=/var/lib/budget-app/backups
BACKUP_INTERVAL_SECONDS=21600
BACKUP_RETENTION_COUNT=30
```

Jesli aplikacja ma byc dostepna bez reverse proxy tylko w sieci lokalnej, ustaw `HOST=0.0.0.0` i ogranicz dostep firewallem do zaufanej sieci.

## Uruchomienie reczne

```bash
cd /opt/budget-app
python3 server.py --host 127.0.0.1 --port 8080 --db /var/lib/budget-app/budget.db
```

## Systemd

Przykladowy unit:

```ini
[Unit]
Description=Budget App
After=network.target

[Service]
WorkingDirectory=/opt/budget-app
Environment=APP_TIMEZONE=Europe/Warsaw
Environment=HOST=127.0.0.1
Environment=PORT=8080
Environment=DB_PATH=/var/lib/budget-app/budget.db
Environment=BACKUP_DIR=/var/lib/budget-app/backups
ExecStart=/usr/bin/python3 /opt/budget-app/server.py
Restart=on-failure
RestartSec=5
User=budgetapp
Group=budgetapp

[Install]
WantedBy=multi-user.target
```

Po zapisaniu:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now budget-app
sudo systemctl status budget-app
```

## Reverse proxy

Przyklad Nginx:

```nginx
server {
    listen 80;
    server_name budget.local;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

## Weryfikacja

1. Otworz aplikacje z adresu Proxmox/reverse proxy.
2. Zaloguj sie PIN-em.
3. Sprawdz panel `Najem` widoczny pod kafelkami salda.
4. Wejdz w `Rok` i `Podatki`.
5. Sprawdz endpoint statusu po zalogowaniu:

```text
GET /api/storage/status
```

Oczekiwane:

- `"railway": false`,
- baza wskazuje sciezke z `DB_PATH`,
- backupy wskazuja `BACKUP_DIR`.
