# Quick Start Guide - Docker Setup

## Prerequisites
- Docker Desktop installed and running
- Node.js 14.18.0+ (for backend and React frontend)

## Quick Start (4 Steps)

### 1. Install Dependencies
```bash
# Install backend dependencies
npm install

# Install frontend dependencies
cd client && npm install && cd ..
```

### 2. Start ClamAV in Docker
```bash
./start-docker.sh
```

Or manually:
```bash
docker-compose up -d
```

**Wait 1-2 minutes** for ClamAV to download virus definitions on first run.

### 3. Start Backend Server (Terminal 1)
```bash
npm start
```

### 4. Start React Frontend (Terminal 2)
```bash
cd client
npm start
```

Open http://localhost:3000 in your browser!

## Verify Everything Works

```bash
# Check ClamAV is running
docker-compose ps

# Test backend health
curl http://localhost:3001/health

# View ClamAV logs
docker-compose logs -f clamav
```

## Stop Services

```bash
# Stop ClamAV
docker-compose down

# Stop backend/frontend: Press Ctrl+C in their terminals
```

## Common Issues

**ClamAV not ready?**
- Wait longer (first run downloads ~100MB of virus definitions)
- Check logs: `docker-compose logs clamav`

**Port already in use?**
- Change ports in `docker-compose.yml` or stop conflicting services

**Backend can't connect to ClamAV?**
- Ensure ClamAV container is running: `docker-compose ps`
- Check ClamAV is listening: `docker-compose logs clamav`
- Restart ClamAV: `docker-compose restart`
- Verify backend is connecting to `127.0.0.1:3310`

