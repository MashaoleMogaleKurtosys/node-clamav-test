#!/bin/bash

# Script to wait for ClamAV to be fully ready

echo "⏳ Waiting for ClamAV to be ready..."
echo ""

max_wait=600  # 10 minutes max
elapsed=0
check_interval=5

while [ $elapsed -lt $max_wait ]; do
    # Check if port is open and clamd is responding
    if docker-compose exec -T clamav sh -c "nc -z localhost 3310 2>/dev/null && clamdscan --version > /dev/null 2>&1" 2>/dev/null; then
        echo ""
        echo "✅ ClamAV is ready and responding!"
        exit 0
    fi
    
    # Show progress every 30 seconds
    if [ $((elapsed % 30)) -eq 0 ]; then
        echo -n "."
    fi
    
    sleep $check_interval
    elapsed=$((elapsed + check_interval))
done

echo ""
echo "⚠️  ClamAV did not become ready within $max_wait seconds"
echo "   Check logs: docker-compose logs clamav"
echo "   ClamAV may be downloading virus definitions (this can take several minutes)"
exit 1

