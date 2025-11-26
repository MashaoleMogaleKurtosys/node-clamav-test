const express = require('express');
const multer = require('multer');
const NodeClam = require('clamscan');
const cors = require('cors');
const { Readable } = require('stream');

const app = express();
const port = process.env.PORT || 3001;

// Virus scanning feature flag (default: true if env var not set)
// Environment variables are always strings, so check for string 'false'
const ENABLE_VIRUS_SCAN = process.env.ENABLE_VIRUS_SCAN 
  ? process.env.ENABLE_VIRUS_SCAN.toLowerCase() !== 'false'
  : true;

// ClamAV connection settings (for Docker TCP connection)
const CLAMAV_HOST ='127.0.0.1';
const CLAMAV_PORT = 4000;

// Enable CORS - allow all domains/origins
app.use(cors({
  origin: '*', // Allow all origins
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  // allowedHeaders not specified - allows all headers by default
  credentials: false // Set to false when using origin: '*'
}));
app.use(express.json());

// Set default timeout middleware for all requests (5 minutes)
app.use((req, res, next) => {
  // Set socket timeout to 5 minutes
  if (req.socket) {
    req.socket.setTimeout(300000); // 5 minutes
  }
  req.setTimeout(300000); // 5 minutes
  
  // Set headers to keep connection alive
  res.setHeader('Connection', 'keep-alive');
  
  next();
});

// Configure Multer for file uploads - using memory storage (files stay in RAM)
const upload = multer({ 
  storage: multer.memoryStorage(),  // ← Files stay in RAM
  limits: {
    fileSize: Infinity
  }
});

// Connection pool per worker to prevent EPIPE errors with PM2 cluster mode
class ClamAVConnectionPool {
  constructor(maxConnections = 5, maxQueueSize = 20) {
    this.pool = [];
    this.inUse = new Set();
    this.maxConnections = maxConnections;
    this.queue = [];
    this.maxQueueSize = maxQueueSize;
    this.initialized = false;
  }

  async _createConnection() {
    const maxRetries = 10;
    const delay = 3000;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const clamscan = await new NodeClam().init({
          clamdscan: {
            host: CLAMAV_HOST,
            port: parseInt(CLAMAV_PORT),
            timeout: 300000, // 5 minutes for large files
          },
          preference: {
            clamdscan: ['host', 'port'],
          },
        });
        
        if (!this.initialized) {
          console.log(`✅ ClamAV connection pool initialized (${CLAMAV_HOST}:${CLAMAV_PORT})`);
          this.initialized = true;
        }
        
        return clamscan;
      } catch (error) {
        if (attempt < maxRetries) {
          const waitTime = delay * attempt;
          console.log(`⚠️  ClamAV connection attempt ${attempt}/${maxRetries} failed, retrying in ${waitTime/1000}s...`);
          console.log(`   Trying to connect to ${CLAMAV_HOST}:${CLAMAV_PORT}`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        } else {
          console.error('❌ Failed to create ClamAV connection after', maxRetries, 'attempts');
          console.error('   Make sure ClamAV Docker container is running: docker-compose up -d');
          console.error('   Check ClamAV logs: docker-compose logs clamav');
          throw error;
        }
      }
    }
  }

  async acquire() {
    return new Promise((resolve, reject) => {
      // Try to get available connection
      let conn = this.pool.find(c => !this.inUse.has(c));
      
      if (conn) {
        this.inUse.add(conn);
        resolve(conn);
        return;
      }

      // Create new connection if under limit
      if (this.pool.length < this.maxConnections) {
        this._createConnection()
          .then(conn => {
            this.pool.push(conn);
            this.inUse.add(conn);
            resolve(conn);
          })
          .catch(reject);
        return;
      }

      // Queue request if pool is full
      if (this.queue.length >= this.maxQueueSize) {
        reject(new Error('Connection pool queue is full. Too many concurrent scan requests.'));
        return;
      }

      this.queue.push({ resolve, reject });
    });
  }

  release(conn) {
    this.inUse.delete(conn);
    
    // Process queued requests
    if (this.queue.length > 0) {
      const { resolve } = this.queue.shift();
      this.inUse.add(conn);
      resolve(conn);
    }
  }

  // Remove bad connection from pool (e.g., after EPIPE error)
  removeConnection(conn) {
    this.inUse.delete(conn);
    const index = this.pool.indexOf(conn);
    if (index > -1) {
      this.pool.splice(index, 1);
      console.log(`⚠️  Removed bad ClamAV connection from pool. Pool size: ${this.pool.length}/${this.maxConnections}`);
    }
  }

  // Check if pool is ready
  isReady() {
    return this.initialized || this.pool.length > 0;
  }
}

// One connection pool per PM2 worker
const connectionPool = new ClamAVConnectionPool(5, 20);

// Initialize at least one connection on startup
const initClamScan = async () => {
  try {
    await connectionPool._createConnection().then(conn => {
      connectionPool.pool.push(conn);
    });
  } catch (error) {
    console.error('Failed to initialize ClamAV connection pool:', error);
    console.warn('⚠️  ClamAV is not available. Server will start but scanning may not work until ClamAV is available.');
  }
};

// Fast scanning using scanStream (recommended for performance)
// Accepts a buffer and creates a stream from it
// Creates a fresh connection per request to avoid EPIPE errors with PM2 cluster mode
const scanWithStream = async (fileBuffer, requestId = '') => {
  let conn = null;
  
  try {
    // Acquire connection from pool (or create new one)
    conn = await connectionPool.acquire();
    
    return new Promise((resolve, reject) => {
      // Time stream creation/processing
      const streamStartTime = Date.now();
      
      // Create a readable stream from the buffer
      const fileStream = Readable.from(fileBuffer);
      
      const streamProcessingTime = Date.now() - streamStartTime;
      
      // Time the actual scan
      const scanStartTime = Date.now();
      
      // scanStream: Pass the file stream directly
      conn.scanStream(fileStream, (err, object) => {
        const scanDuration = Date.now() - scanStartTime;
        const totalDuration = Date.now() - streamStartTime;
        
        // Always release connection back to pool
        if (conn) {
          connectionPool.release(conn);
        }
        
        if (err) {
          // If EPIPE or connection error, remove bad connection from pool
          if (err.code === 'EPIPE' || err.code === 'ECONNRESET') {
            console.error(`[${requestId}] scanStream EPIPE/ECONNRESET error - removing bad connection:`, err.message);
            connectionPool.removeConnection(conn);
          } else {
            console.error(`[${requestId}] scanStream error:`, err.message, err.code);
          }
          reject(err);
          return;
        }
      
      // Check for "UNKNOWN COMMAND" error - this means stream scanning isn't working over TCP
      if (object && object.resultString === 'UNKNOWN COMMAND') {
        console.warn('⚠️  scanStream returned UNKNOWN COMMAND - stream scanning may not be supported over TCP');
        // Return a result that will trigger fallback
        resolve({
          isInfected: false,
          viruses: [],
          method: 'clamdscan (stream - failed)',
          streamProcessingTime: streamProcessingTime,
          scanDuration: scanDuration,
          totalDuration: totalDuration,
          rawResult: object,
          needsFallback: true
        });
        return;
      }
      
      // Check for infection - the clamscan library may return different structures
      // Check multiple possible properties
      const hasViruses = (object.viruses && Array.isArray(object.viruses) && object.viruses.length > 0) ||
                        (object.virus && object.virus.length > 0);
      const isInfectedFlag = object.isInfected === true || 
                            object.isInfected === 'true' ||
                            object.isInfected === 1 ||
                            object.infected === true;
      
      // Also check if the file name contains virus info (some formats return it this way)
      const hasVirusInName = object.file && typeof object.file === 'string' && 
                            (object.file.includes('FOUND') || object.file.includes('Infected'));
      
      const isInfected = isInfectedFlag || hasViruses || hasVirusInName;
      
      // Extract viruses from various possible locations
      let viruses = [];
      if (object.viruses && Array.isArray(object.viruses)) {
        viruses = object.viruses;
      } else if (object.virus) {
        viruses = Array.isArray(object.virus) ? object.virus : [object.virus];
      } else if (hasVirusInName && object.file) {
        // Extract virus name from file string if present
        const match = object.file.match(/FOUND:\s*(.+)/i);
        if (match) viruses = [match[1].trim()];
      }
      
      if (isInfected && viruses.length === 0) {
        // If marked as infected but no viruses array, create one
        viruses.push('Threat detected');
      }
      
        console.log(`[${requestId}] Stream infection check - isInfected: ${isInfected}, viruses count: ${viruses.length}`);
        
        resolve({
          isInfected,
          viruses,
          method: 'clamdscan (stream)', // Uses ClamAV daemon via TCP
          streamProcessingTime: streamProcessingTime,
          scanDuration: scanDuration,
          totalDuration: totalDuration,
          rawResult: object // Include raw result for debugging
        });
      });
    });
  } catch (error) {
    // Release connection if we got it but failed before scan
    if (conn) {
      connectionPool.release(conn);
    }
    throw error;
  }
};

// Main scanning function - accepts file buffer
// Uses stream scanning only (no fallback)
// Retries on EPIPE errors with fresh connection
const scanFile = async (fileBuffer, fileSize, requestId = '', retryCount = 0) => {
  const maxRetries = 2;
  
  try {
    // Use stream scanning (via TCP)
    console.log(`[${requestId}] Scanning file via stream... (${(fileSize / 1024).toFixed(2)} KB)${retryCount > 0 ? ` [Retry ${retryCount}/${maxRetries}]` : ''}`);
    const result = await scanWithStream(fileBuffer, requestId);
    
    // Check if we got "UNKNOWN COMMAND" error
    if (result.needsFallback || (result.rawResult && result.rawResult.resultString === 'UNKNOWN COMMAND')) {
      throw new Error('Stream scanning returned UNKNOWN COMMAND - ClamAV stream scanning may not be supported');
    }
    
    return {
      ...result,
      fileSize: fileSize
    };
  } catch (error) {
    // Retry on EPIPE/ECONNRESET errors (connection issues)
    if ((error.code === 'EPIPE' || error.code === 'ECONNRESET') && retryCount < maxRetries) {
      console.warn(`[${requestId}] Connection error (${error.code}), retrying with fresh connection... (attempt ${retryCount + 1}/${maxRetries})`);
      // Wait a bit before retrying
      await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
      return scanFile(fileBuffer, fileSize, requestId, retryCount + 1);
    }
    
    console.error(`[${requestId}] Stream scan failed:`, error.message, error.code);
    throw error;
  }
};

// Initialize ClamScan on server start
initClamScan().catch(err => {
  console.error('Failed to initialize ClamAV:', err);
  console.warn('');
  console.warn('⚠️  ClamAV is not available. Please ensure:');
  console.warn('   1. Docker Desktop is running');
  console.warn('   2. ClamAV container is started: ./start-docker.sh or docker-compose up -d');
  console.warn('   3. ClamAV is ready (wait 1-2 minutes on first run)');
  console.warn('');
  console.warn('Server will start but scanning may not work until ClamAV is available.');
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    clamavReady: connectionPool.isReady(),
    poolSize: connectionPool.pool.length,
    connectionsInUse: connectionPool.inUse.size,
    queueLength: connectionPool.queue.length
  });
});

// Upload and scan endpoint
app.post('/upload', upload.single('document'), async (req, res) => {
  // Generate request ID for tracking
  const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const requestStartTime = Date.now();
  
  // Helper function for logging with request ID
  const log = (level, message, data = {}) => {
    const timestamp = new Date().toISOString();
    const logData = { requestId, timestamp, ...data };
    console[level](`[${requestId}] ${message}`, Object.keys(logData).length > 2 ? logData : '');
  };

  log('log', '📥 Upload request received', {
    ip: req.ip,
    userAgent: req.get('user-agent'),
    contentType: req.get('content-type')
  });

  // Set request and response timeout to 5 minutes for large file processing
  // Must set both req and res timeouts, and do it early
  if (req.socket) {
    req.socket.setTimeout(300000); // 5 minutes
  }
  req.setTimeout(300000); // 5 minutes
  
  // Set headers to keep connection alive for long-running scans
  res.setHeader('Connection', 'keep-alive');
  
  // Handle request timeout
  req.on('timeout', () => {
    log('error', '⏱️  Request timeout after 5 minutes');
    if (!res.headersSent) {
      res.status(408).json({
        success: false,
        requestId,
        message: 'Request timeout. Large file uploads may take longer than 5 minutes.',
        error: 'Request timeout',
        stage: 'upload_timeout'
      });
    }
  });

  // Handle client disconnect
  req.on('close', () => {
    const duration = Date.now() - requestStartTime;
    log('warn', '⚠️  Client disconnected before request completed', { duration: `${(duration / 1000).toFixed(2)}s` });
  });

  if (!req.file) {
    log('warn', '❌ No file uploaded');
    return res.status(400).json({ 
      success: false,
      requestId,
      message: 'No file uploaded',
      error: 'No file provided'
    });
  }

  // Initialize ClamAV only if scanning is enabled
  if (ENABLE_VIRUS_SCAN) {
    if (!connectionPool.isReady()) {
      log('log', '🔄 ClamAV not ready, initializing connection pool...');
      try {
        await initClamScan();
        log('log', '✅ ClamAV connection pool initialized');
      } catch (error) {
        log('error', '❌ Failed to initialize ClamAV', { error: error.message });
        return res.status(503).json({ 
          success: false,
          requestId,
          message: 'Virus scanner is not available. ClamAV may still be starting up or virus definitions are downloading. Please wait a few minutes and try again.',
          error: error.message,
          hint: 'Check ClamAV logs: docker-compose logs clamav',
          stage: 'clamav_init_failed'
        });
      }
    }
  }

  // Format file size helper (needed in try and catch blocks)
  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };
  
  // Format duration helper (needed in try and catch blocks)
  const formatDuration = (ms) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  try {
    // Get file size from buffer
    const fileSize = req.file.size || req.file.buffer.length;
    const uploadDuration = Date.now() - requestStartTime;
    
    log('log', '📦 File received', {
      fileName: req.file.originalname,
      fileSize: `${(fileSize / 1024 / 1024).toFixed(2)} MB`,
      uploadDuration: `${(uploadDuration / 1000).toFixed(2)}s`
    });
    
    // Warn if file is empty
    if (fileSize === 0) {
      log('warn', '⚠️  File is 0 bytes - upload may have failed', { fileName: req.file.originalname });
      return res.status(400).json({
        success: false,
        requestId,
        message: 'File is empty (0 bytes). Please check your file upload.',
        error: 'File size is 0 bytes',
        stage: 'validation_failed'
      });
    }
    
    // Check for file size limitation (clamscan library uses 32-bit integer, max ~2GB)
    const MAX_FILE_SIZE_FOR_SCAN = 2147483647; // Maximum 32-bit signed integer (2GB - 1 byte)
    if (ENABLE_VIRUS_SCAN && fileSize > MAX_FILE_SIZE_FOR_SCAN) {
      const maxSizeFormatted = formatFileSize(MAX_FILE_SIZE_FOR_SCAN);
      log('warn', '⚠️  File exceeds maximum scannable size', {
        fileName: req.file.originalname,
        fileSize: formatFileSize(fileSize),
        maxSize: maxSizeFormatted
      });
      return res.status(400).json({
        success: false,
        requestId,
        message: `File size (${formatFileSize(fileSize)}) exceeds maximum scannable size of ${maxSizeFormatted}`,
        error: 'File too large for virus scanning',
        fileSize: fileSize,
        fileSizeFormatted: formatFileSize(fileSize),
        maxScannableSize: MAX_FILE_SIZE_FOR_SCAN,
        maxScannableSizeFormatted: maxSizeFormatted,
        hint: 'The clamscan library has a 2GB limit due to 32-bit integer constraints. Files larger than 2GB cannot be scanned via stream. Set ENABLE_VIRUS_SCAN=false to upload without scanning.',
        stage: 'validation_failed'
      });
    }
    
    let responseData;
    
    if (ENABLE_VIRUS_SCAN) {
      // Scanning enabled - scan the file buffer
      const scanStartTime = Date.now();
      log('log', '🔍 Starting virus scan', {
        fileName: req.file.originalname,
        fileSize: `${(fileSize / 1024 / 1024).toFixed(2)} MB`
      });
      
      let scanResult;
      try {
        scanResult = await scanFile(req.file.buffer, fileSize, requestId);
        const scanDuration = Date.now() - scanStartTime;
        log('log', '✅ Virus scan completed', {
          fileName: req.file.originalname,
          scanDuration: `${(scanDuration / 1000).toFixed(2)}s`,
          infected: scanResult.isInfected,
          virusesFound: scanResult.viruses?.length || 0
        });
      } catch (scanError) {
        const scanDuration = Date.now() - scanStartTime;
        log('error', '❌ Virus scan failed', {
          fileName: req.file.originalname,
          scanDuration: `${(scanDuration / 1000).toFixed(2)}s`,
          error: scanError.message,
          errorCode: scanError.code,
          stage: 'scan_failed'
        });
        throw scanError;
      }
      
      // Prepare response with all performance metrics
      const totalRequestDuration = Date.now() - requestStartTime;
      responseData = {
        success: !scanResult.isInfected,
        requestId,
        message: scanResult.isInfected ? 'File is infected' : 'File is clean and safe',
        infected: scanResult.isInfected,
        scanEnabled: true,
        fileName: req.file.originalname,
        scanMethod: scanResult.method,
        fileSize: fileSize,
        fileSizeFormatted: formatFileSize(fileSize),
        // Performance metrics
        uploadDuration: uploadDuration,
        uploadDurationFormatted: formatDuration(uploadDuration),
        scanDuration: scanResult.scanDuration || 0,
        scanDurationFormatted: formatDuration(scanResult.scanDuration || 0),
        totalDuration: totalRequestDuration,
        totalDurationFormatted: formatDuration(totalRequestDuration)
      };

      if (scanResult.isInfected) {
        responseData.viruses = scanResult.viruses;
        log('warn', '⚠️  File is infected', {
          fileName: req.file.originalname,
          viruses: scanResult.viruses,
          totalDuration: formatDuration(totalRequestDuration)
        });
        return res.status(400).json(responseData);
      } else {
        log('log', '✅ File is clean - sending success response', {
          fileName: req.file.originalname,
          totalDuration: formatDuration(totalRequestDuration)
        });
        return res.status(200).json(responseData);
      }
    } else {
      // Scanning disabled - just process stream and measure time
      console.log(`Processing file (scan disabled): ${req.file.originalname} (${(fileSize / 1024).toFixed(2)} KB)`);
      
      const streamStartTime = Date.now();
      // Create and process stream from buffer
      const fileStream = Readable.from(req.file.buffer);
      
      // Consume the stream to measure processing time
      await new Promise((resolve, reject) => {
        fileStream.on('data', () => {}); // Consume data
        fileStream.on('end', resolve);
        fileStream.on('error', reject);
      });
      
      const streamProcessingTime = Date.now() - streamStartTime;
      
      // Prepare response with stream processing metrics only
      responseData = {
        success: true,
        message: 'File processed successfully (virus scanning disabled)',
        infected: false,
        scanEnabled: false,
        fileName: req.file.originalname,
        scanMethod: 'none',
        fileSize: fileSize,
        fileSizeFormatted: formatFileSize(fileSize),
        // Performance metrics (only stream processing)
        streamProcessingTime: streamProcessingTime,
        streamProcessingTimeFormatted: formatDuration(streamProcessingTime),
        scanDuration: 0,
        scanDurationFormatted: '0ms',
        totalDuration: streamProcessingTime,
        totalDurationFormatted: formatDuration(streamProcessingTime)
      };
      
      console.log(`File processed: ${req.file.originalname} (${formatFileSize(fileSize)}) - Stream: ${formatDuration(streamProcessingTime)}, Scan: disabled`);
      return res.status(200).json(responseData);
    }
  } catch (error) {
    const totalDuration = Date.now() - requestStartTime;
    const errorDetails = {
      error: error.message,
      errorCode: error.code,
      errorStack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      totalDuration: formatDuration(totalDuration),
      stage: 'processing_error'
    };
    
    log('error', '❌ Processing error occurred', errorDetails);
    
    // Determine error type and provide helpful message
    let errorMessage = ENABLE_VIRUS_SCAN ? 'Error scanning file' : 'Error processing file';
    let statusCode = 500;
    
    if (error.code === 'EPIPE' || error.code === 'ECONNRESET') {
      errorMessage = 'Connection to virus scanner was lost. The file may be too large or the scanner may be overloaded. Please try again.';
      statusCode = 503;
      errorDetails.stage = 'connection_error';
    } else if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
      errorMessage = 'Scan operation timed out. Large files may take longer than expected. Please try again or contact support.';
      statusCode = 504;
      errorDetails.stage = 'timeout_error';
    }
    
    if (!res.headersSent) {
      return res.status(statusCode).json({ 
        success: false,
        requestId,
        message: errorMessage,
        ...errorDetails
      });
    } else {
      log('error', '⚠️  Response already sent, cannot send error response');
    }
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ 
        success: false,
        message: 'File too large. Maximum size is 100MB.' 
      });
    }
  }
  res.status(500).json({ 
    success: false,
    message: 'Internal server error',
    error: err.message 
  });
});

// Set server timeout to 5 minutes (300000ms) for large file uploads/scans
const server = app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
  console.log(`Upload endpoint: http://localhost:${port}/upload`);
  console.log(`Health check: http://localhost:${port}/health`);
});

// Set server timeout to 5 minutes
server.timeout = 300000; // 5 minutes in milliseconds

// Set keep-alive timeout
server.keepAliveTimeout = 300000; // 5 minutes

