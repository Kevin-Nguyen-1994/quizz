# TiL Quiz production operations

## Database backup

Create and verify an online SQLite backup without stopping the server:

```powershell
pnpm backup:database
```

Daily backups are stored in `data\backups\daily`; only the 30 newest verified
files are retained. Operational output is appended to `logs\backup.log`.

Install or update the daily 22:30 SYSTEM task from an elevated PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ops\install-backup-task.ps1
```

## Database restore procedure

Do not restore over a running SQLite database.

1. Select a backup and verify it without changing production:

   ```powershell
   node server\scripts\backup-database.mjs --verify-only "D:\KEVIN\quizz\data\backups\daily\quizz-YYYY-MM-DD-HHMMSS.db"
   ```

2. Stop the `TiL Quiz Server` Scheduled Task and confirm port 3000 is no longer
   listening.
3. Move `data\quizz.db` and any `quizz.db-wal`/`quizz.db-shm` files together
   into a timestamped recovery directory. Do not leave old WAL/SHM sidecars
   beside the restored database.
4. Copy the verified backup to `data\quizz.db` while the server is stopped.
5. Start `TiL Quiz Server`, then check the database, local HTTP, and public HTTPS.

The restore steps are intentionally manual so a backup can never overwrite the
production database while it is open.

## Frontend build, deploy, and rollback

`pnpm build` writes the frontend only to `artifacts\client-dist`. Production
continues serving `client\dist` until an explicit deployment:

```powershell
pnpm deploy:frontend
```

The deploy script saves the previous `client\dist` under
`deployments\frontend`, swaps the staged build into place, and validates the
page plus one generated asset. A failed smoke test restores the previous
directory automatically.

Rollback to the most recent saved version:

```powershell
pnpm rollback:frontend
```

Rollback to a specific saved directory:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ops\deploy-frontend.ps1 -RollbackVersion "YYYY-MM-DD-HHMMSS-fff"
```

At least three successful frontend versions are retained. Replacing static
files does not require a backend restart.

## Backend build isolation, deploy, and rollback

Normal builds never write the production backend runtime:

```powershell
pnpm build:server
```

The compiled artifact is recreated at `artifacts\server-dist`. Production is
started from `runtime\server\index.js`, so `pnpm build` and `pnpm build:server`
cannot change the code loaded by the Scheduled Task.

Install or update the `TiL Quiz Server` SYSTEM task from an elevated
PowerShell after a runtime has first been placed in `runtime\server`:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ops\install-server-task.ps1
```

Deploy the staged backend from an elevated PowerShell during a maintenance
window:

```powershell
pnpm deploy:backend
```

The deploy command refuses to continue while an Assignment attempt is in
progress, saves the current runtime under `deployments\backend`, swaps only the
backend files, restarts the existing task, and checks HTTP plus Socket.IO. A
failed smoke test restores the previous backend automatically. It never
restores or rolls back the database.

Rollback to the newest retained backend version:

```powershell
pnpm rollback:backend
```

Rollback to a named version:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ops\deploy-backend.ps1 -RollbackVersion "YYYY-MM-DD-HHMMSS-fff"
```

At least three backend versions are retained. `-ForceActiveAttempts` exists for
an explicitly approved emergency maintenance window; do not use it for routine
deployments.
