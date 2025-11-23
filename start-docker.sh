#!/bin/bash

# Script to start ClamAV in Docker

echo "🚀 Starting ClamAV in Docker..."
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    echo "   Visit: https://www.docker.com/get-started"
    exit 1
fi

# Check if docker-compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "❌ docker-compose is not installed. Please install docker-compose first."
    exit 1
fi

# Start ClamAV service
echo "📦 Starting ClamAV service..."
docker-compose up -d

echo ""
echo "⏳ Waiting for ClamAV to initialize..."
echo "   This may take 5-10 minutes on first run as ClamAV downloads virus definitions."
echo "   If you were rate-limited, wait 1 hour before trying again."
echo ""

# Use the wait script
if [ -f "./wait-for-clamav.sh" ]; then
    ./wait-for-clamav.sh
else
    # Fallback: simple wait
    echo "Waiting for ClamAV (checking every 10 seconds)..."
    for i in {1..60}; do
        if docker-compose exec -T clamav sh -c "nc -z localhost 3310 2>/dev/null && clamdscan --version > /dev/null 2>&1" 2>/dev/null; then
            echo "✅ ClamAV is ready!"
            break
        fi
        if [ $((i % 6)) -eq 0 ]; then
            echo -n "."
        fi
        sleep 10
    done
fi

echo ""
echo "✅ ClamAV is running!"
echo ""
echo "📋 ClamAV is available at:"
echo "   Host: 127.0.0.1"
echo "   Port: 3310"
echo ""
echo "📝 Useful commands:"
echo "   View logs:        docker-compose logs -f"
echo "   Stop ClamAV:      docker-compose down"
echo "   Restart ClamAV:   docker-compose restart"
echo ""
echo "🚀 Next steps:"
echo "   1. Start backend:    npm start (in project root)"
echo "   2. Start frontend:   cd client && npm start"
echo ""

