#!/bin/bash

# Quick script to check if ClamAV is running and accessible

echo "🔍 Checking ClamAV status..."
echo ""

# Check if Docker is running
if ! docker info &> /dev/null; then
    echo "❌ Docker is not running!"
    echo "   Please start Docker Desktop first."
    exit 1
fi

echo "✅ Docker is running"
echo ""

# Check if ClamAV container exists
if ! docker ps -a | grep -q clamav-scanner; then
    echo "❌ ClamAV container not found"
    echo "   Start it with: ./start-docker.sh"
    exit 1
fi

# Check if ClamAV container is running
if docker ps | grep -q clamav-scanner; then
    echo "✅ ClamAV container is running"
else
    echo "⚠️  ClamAV container exists but is not running"
    echo "   Start it with: docker-compose up -d"
    exit 1
fi

echo ""

# Test connection to ClamAV
echo "🔌 Testing connection to ClamAV (127.0.0.1:3310)..."
if timeout 2 bash -c "echo > /dev/tcp/127.0.0.1/3310" 2>/dev/null; then
    echo "✅ ClamAV is accessible on port 3310"
    echo ""
    echo "🎉 ClamAV is ready! You can start the backend server now."
else
    echo "❌ Cannot connect to ClamAV on port 3310"
    echo ""
    echo "   This might mean:"
    echo "   - ClamAV is still starting up (wait 1-2 minutes)"
    echo "   - Check logs: docker-compose logs clamav"
    echo ""
    exit 1
fi

