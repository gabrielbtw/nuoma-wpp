---
name: nuoma-debug
description: Debug operational issues with the Nuoma system (worker, scheduler, campaigns, automations). Follows the runbook protocol.
user_invocable: true
---

# /nuoma-debug — Operational Debugging

You are debugging an operational issue in Nuoma WPP.

## Quick diagnostics

### 1. Check process health
```bash
# If using PM2
pm2 status
pm2 logs wa-worker --lines 50
pm2 logs web-app --lines 50
pm2 logs scheduler --lines 50
```

### 2. Check system health via API
```bash
curl -s http://localhost:3000/health | jq .
curl -s http://localhost:3000/logs?limit=20 | jq .
```

### 3. Check database state
```bash
# Worker state
sqlite3 storage/database/nuoma.db "SELECT * FROM worker_state ORDER BY updated_at DESC LIMIT 5;"

# Pending jobs
sqlite3 storage/database/nuoma.db "SELECT type, status, COUNT(*) FROM jobs GROUP BY type, status;"

# Failed jobs
sqlite3 storage/database/nuoma.db "SELECT * FROM jobs WHERE status='failed' ORDER BY updated_at DESC LIMIT 10;"

# Active campaigns
sqlite3 storage/database/nuoma.db "SELECT id, name, status FROM campaigns WHERE status='active';"

# Campaign recipients stuck
sqlite3 storage/database/nuoma.db "SELECT status, COUNT(*) FROM campaign_recipients GROUP BY status;"

# System logs (errors)
sqlite3 storage/database/nuoma.db "SELECT * FROM system_logs WHERE level='error' ORDER BY created_at DESC LIMIT 10;"
```

## Common issues

### Worker not syncing
- Check `worker_state` for status: `disconnected`, `degraded`, `error`
- Check if Chromium profile is intact: `storage/chromium-profile/whatsapp/`
- Restart: `pm2 restart wa-worker`
- If auth lost: run with `CHROMIUM_HEADLESS=false` and re-scan QR

### Campaign stuck
- Check `campaign_recipients` for stuck `processing` status
- Check `jobs` for stuck `processing` jobs (locked_at too old)
- Reset stuck jobs: `UPDATE jobs SET status='pending', locked_at=NULL, locked_by=NULL WHERE status='processing' AND locked_at < datetime('now', '-5 minutes');`

### Scheduler not running
- Check `worker_state` for scheduler entry
- Check scheduler logs for errors
- Restart: `pm2 restart scheduler`

### WhatsApp auth expired
- Stop worker: `pm2 stop wa-worker`
- Run headful: `CHROMIUM_HEADLESS=false npm run start --workspace @nuoma/wa-worker`
- Scan QR code
- Verify auth, then switch back to headless

## After fixing
- Verify dashboard shows `ok` status
- Check that job queue is processing again
- Confirm sync is running (new conversations appearing)
