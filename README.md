# Document Scanner - Node.js & React Prototype

A full-stack application for uploading and scanning documents for viruses using ClamAV. Features fast stream-based scanning with automatic fallback mechanisms.

## 🚀 Features

- **File Upload**: Upload documents via a modern React interface
- **Fast Scanning**: Uses `scanStream` for optimal performance
- **Automatic Fallback**: Falls back to file-based scanning if stream scanning fails
- **Real-time Feedback**: Visual feedback during upload and scanning
- **Infected File Handling**: Automatically quarantines infected files
- **Clean UI**: Modern, responsive design

## 📋 Prerequisites

Before you can use this project, you need to install the following:

### 1. **Docker and Docker Compose**

This project uses Docker to run ClamAV, so you don't need to install ClamAV directly on your system.

**Install Docker:**
- **macOS**: Download from [Docker Desktop for Mac](https://www.docker.com/products/docker-desktop)
- **Windows**: Download from [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop)
- **Linux**: Follow instructions for your distribution at [Docker Docs](https://docs.docker.com/get-docker/)

**Verify Docker Installation:**
```bash
docker --version
docker-compose --version
```

### 2. **Node.js and npm** (for React frontend)

- **Node.js**: Version 14.18.0 or higher (recommended: 16.x or 18.x)
- **npm**: Version 6.x or higher (comes with Node.js)

**Check your installation:**
```bash
node --version
npm --version
```

**Note**: 
- The backend runs in Docker, but you'll need Node.js locally to run the React frontend
- If you have Node.js < 14.18.0, the project uses `react-scripts` 4.x for compatibility
- **Recommended**: Upgrade to Node.js 16.x or 18.x for best compatibility:
  ```bash
  # Using nvm (Node Version Manager)
  nvm install 18
  nvm use 18
  
  # Or download from https://nodejs.org/
  ```

## 🛠️ Installation & Setup

### Step 1: Navigate to Project Directory
```bash
cd "test clamav"
```

### Step 2: Install Dependencies

**Install Backend Dependencies:**
```bash
npm install
```

**Install Frontend Dependencies:**
```bash
cd client
npm install
cd ..
```

### Step 3: Start ClamAV in Docker

**Option A: Using the convenience script (Recommended)**
```bash
./start-docker.sh
```

**Option B: Using docker-compose directly**
```bash
# Start ClamAV service
docker-compose up -d

# Check logs to see when ClamAV is ready
docker-compose logs -f clamav
```

**Important**: On first run, ClamAV will download virus definitions (this can take 1-2 minutes). Wait until you see "ClamAV is ready!" or check logs with `docker-compose logs clamav`.

### Step 4: Verify ClamAV is Running

```bash
# Check ClamAV container status
docker-compose ps

# View ClamAV logs
docker-compose logs -f clamav
```

## 🚀 Running the Application

### Development Mode

You need to run three services:

**1. ClamAV (in Docker - already started):**
- Running on: `127.0.0.1:3310`

**2. Backend Server (Terminal 1):**
```bash
npm start
# Or for auto-reload:
npm run dev
```
- Backend API: `http://localhost:3001`
- Health Check: `http://localhost:3001/health`

**3. React Frontend (Terminal 2):**
```bash
cd client
npm start
```
- Frontend: `http://localhost:3000` (opens automatically)

### Production Mode

**Build React App:**
```bash
cd client
npm run build
cd ..
```

**Start Production Services:**
```bash
# Start ClamAV in Docker
docker-compose up -d

# Start backend (in production mode)
NODE_ENV=production npm start
```

### Stopping Services

```bash
# Stop ClamAV
docker-compose down

# Stop and remove volumes (cleans up ClamAV data)
docker-compose down -v

# Stop backend/frontend: Press Ctrl+C in their respective terminals
```

## 📁 Project Structure

```
test clamav/
├── server.js              # Express backend server
├── package.json           # Backend dependencies
├── uploads/              # Temporary upload directory (auto-created)
├── quarantine/           # Infected files directory (auto-created)
├── README.md             # This file
└── client/               # React frontend
    ├── public/
    │   └── index.html
    ├── src/
    │   ├── App.js
    │   ├── App.css
    │   ├── index.js
    │   ├── index.css
    │   └── components/
    │       ├── FileUpload.js
    │       └── FileUpload.css
    └── package.json
```

## 🔧 How It Works

### Scanning Process:

1. **File Upload**: User selects a file via React UI
2. **Multer Processing**: File is saved temporarily to `uploads/` directory
3. **Fast Stream Scan**: Attempts to scan using `scanStream()` method (fastest)
4. **Fallback**: If stream scan fails, falls back to `isInfected()` file-based scan
5. **Result Handling**:
   - **Clean**: File remains in uploads (can be processed further)
   - **Infected**: File moved to `quarantine/` directory
6. **Response**: Frontend displays scan results

### Performance Optimization:

- **Stream Scanning**: Uses `scanStream()` for large files - processes file in chunks without loading entire file into memory
- **Daemon Connection**: Prefers ClamAV daemon (clamd) over command-line tool for faster scanning
- **Connection Reuse**: ClamScan instance is initialized once and reused

## 🔍 API Endpoints

### `POST /upload`
Upload and scan a document.

**Request:**
- Method: `POST`
- Content-Type: `multipart/form-data`
- Body: Form data with `document` field containing the file

**Response (Success - Clean File):**
```json
{
  "success": true,
  "message": "File is clean and safe",
  "infected": false,
  "fileName": "example.pdf",
  "scanMethod": "stream"
}
```

**Response (Infected File):**
```json
{
  "success": false,
  "message": "File is infected and has been quarantined",
  "infected": true,
  "viruses": ["EICAR-Test-File"],
  "scanMethod": "stream"
}
```

### `GET /health`
Check server and ClamAV status.

**Response:**
```json
{
  "status": "ok",
  "clamavReady": true
}
```

## ⚠️ Troubleshooting

### ClamAV Not Found / Connection Failed

**Error**: `Virus scanner is not available`

**Solutions:**
1. Check if Docker containers are running: `docker-compose ps`
2. Check ClamAV logs: `docker-compose logs clamav`
3. Ensure ClamAV container is healthy: `docker-compose ps` (should show "healthy")
4. Restart services: `docker-compose restart`
5. Rebuild containers: `docker-compose up -d --build`

### ClamAV Taking Too Long to Start

**Issue**: First-time startup takes a while (downloading virus definitions)

**Solutions:**
- Wait 1-2 minutes on first run
- Check progress: `docker-compose logs -f clamav`
- You'll see "ClamAV is ready!" when it's done
- Virus definitions are cached in Docker volume for faster subsequent starts

### Docker Connection Issues

**Error**: Cannot connect to ClamAV service

**Solutions:**
1. Verify network: `docker network ls` (should see `scanner-network`)
2. Check if ClamAV is listening: `docker-compose exec clamav netstat -tuln | grep 3310`
3. Test connection from backend container: `docker-compose exec backend ping -c 1 clamav`
4. Restart services: `docker-compose restart`

### Port Already in Use

**Error**: Port 3001 or 3310 already in use

**Solutions:**
```bash
# Change ports in docker-compose.yml or use different ports
# Update environment variables:
CLAMAV_PORT=3311 docker-compose up -d
PORT=3002 docker-compose up -d
```

### Slow Scanning

- First scan after container start may be slower (virus definitions loading)
- Large files may take longer - consider implementing file size limits
- Check ClamAV performance: `docker-compose logs clamav`

## 🔒 Security Considerations

- **File Size Limits**: Currently set to 100MB (configurable in `server.js`)
- **File Type Validation**: Consider adding file type restrictions in production
- **Rate Limiting**: Consider adding rate limiting for production use
- **Authentication**: Add authentication/authorization for production
- **HTTPS**: Use HTTPS in production
- **Quarantine**: Infected files are automatically quarantined

## 📝 Environment Variables

You can configure the application using environment variables:

**Backend (in docker-compose.yml or .env):**
```bash
PORT=3001                    # Backend server port
CLAMAV_HOST=clamav          # ClamAV service hostname (use 'clamav' in Docker, '127.0.0.1' locally)
CLAMAV_PORT=3310            # ClamAV TCP port
```

**Frontend:**
```bash
REACT_APP_API_URL=http://localhost:3001  # Backend API URL
```

Create a `.env` file in the root directory:
```
PORT=3001
CLAMAV_HOST=clamav
CLAMAV_PORT=3310
```

**Note**: The backend connects to ClamAV at `127.0.0.1:3310` by default (ClamAV runs in Docker and exposes port 3310 to the host).

## 🧪 Testing with EICAR Test File

The EICAR test file is a safe test file that all antivirus software recognize as a virus (for testing purposes):

```bash
echo "X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*" > eicar.txt
```

Upload this file through the UI to test the scanning functionality.

## 📚 Additional Resources

- [ClamAV Official Documentation](https://docs.clamav.net/)
- [clamscan npm package](https://www.npmjs.com/package/clamscan)
- [Multer Documentation](https://github.com/expressjs/multer)
- [React Documentation](https://react.dev/)

## 🤝 Contributing

Feel free to submit issues and enhancement requests!

## 📄 License

ISC


