# Getting Started

This guide is the fastest path from clone to first successful sync.

## 1) Prepare environment

```bash
git clone git@github.com:Abdulee/WoOdoo.git
cd WoOdoo
cp .env.example .env
bash scripts/generate-keys.sh --write
```

Open `.env` and set at least:

```env
ADMIN_PASSWORD=your-secure-password
SECRET_KEY=<generated>
FERNET_KEY=<generated>
```

## 2) Start services

```bash
docker compose up -d
docker compose ps
curl http://localhost:8000/api/health
```

Expected result: backend is reachable, and app/frontend containers are running.

## 3) Gather integration credentials

Before opening the wizard, prepare:

### Odoo
- Odoo URL
- Database name
- Username
- API key

### WooCommerce
- Store URL
- Consumer key
- Consumer secret

See [Configuration](configuration.md) for detailed credential acquisition steps.

## 4) Complete Setup Wizard

Open `http://localhost:3000` and complete:

1. Odoo connection setup + test
2. WooCommerce connection setup + test
3. Initial sync job creation

If a test fails, use [Troubleshooting](troubleshooting.md).

## 5) Run first sync

1. Go to **Sync Jobs**
2. Trigger **Run Now** on your job
3. Monitor progress from Dashboard and Sync Logs

## 6) Confirm success

Check:
- Connection Health is healthy
- Sync execution status is completed
- Synced/updated counts are non-zero (unless data is unchanged)

## Next Docs

- [Job Builder](job-builder.md)
- [Sync Engine](sync-engine.md)
- [Webhooks](webhooks.md)
- [Troubleshooting](troubleshooting.md)
