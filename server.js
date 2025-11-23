const express = require('express');
const multer = require('multer');
const NodeClam = require('clamscan');
const cors = require('cors');
const { Readable } = require('stream');

const app = express();
const port = process.env.PORT || 3001;

// Virus scanning feature flag (default: true for backward compatibility)
const ENABLE_VIRUS_SCAN = true;

// ClamAV connection settings (for Docker TCP connection)
const CLAMAV_HOST ='127.0.0.1';
const CLAMAV_PORT = 4000;

// Enable CORS for React frontend
app.use(cors());
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

// Initialize ClamScan with fallback options
let clamscanInstance = null;

// Retry initialization with exponential backoff
const initClamScanWithRetry = async (maxRetries = 10, delay = 3000) => {
  if (clamscanInstance) {
    return clamscanInstance;
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Explicit TCP connection config for Docker ClamAV container
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

      clamscanInstance = clamscan;
      console.log(`✅ ClamAV initialized successfully (${CLAMAV_HOST}:${CLAMAV_PORT})`);
      return clamscan;
    } catch (error) {
      if (attempt < maxRetries) {
        const waitTime = delay * attempt;
        console.log(`⚠️  ClamAV connection attempt ${attempt}/${maxRetries} failed, retrying in ${waitTime/1000}s...`);
        console.log(`   Trying to connect to ${CLAMAV_HOST}:${CLAMAV_PORT}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        console.error('❌ Failed to initialize ClamAV after', maxRetries, 'attempts');
        console.error('   Make sure ClamAV Docker container is running: docker-compose up -d');
        console.error('   Check ClamAV logs: docker-compose logs clamav');
        throw error;
      }
    }
  }
};

const initClamScan = () => initClamScanWithRetry();

// Fast scanning using scanStream (recommended for performance)
// Accepts a buffer and creates a stream from it
const scanWithStream = async (fileBuffer) => {
  return new Promise((resolve, reject) => {
    // Time stream creation/processing
    const streamStartTime = Date.now();
    
    // Create a readable stream from the buffer
    const fileStream = Readable.from(fileBuffer);
    
    const streamProcessingTime = Date.now() - streamStartTime;
    
    // Time the actual scan
    const scanStartTime = Date.now();
    
    // scanStream: Pass the file stream directly
    clamscanInstance.scanStream(fileStream, (err, object) => {
      const scanDuration = Date.now() - scanStartTime;
      const totalDuration = Date.now() - streamStartTime;
      
      if (err) {
        console.error('scanStream error:', err);
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
      
      console.log(`Stream infection check - isInfected: ${isInfected}, viruses count: ${viruses.length}`);
      
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
};

// Main scanning function - accepts file buffer
// Uses stream scanning only (no fallback)
const scanFile = async (fileBuffer, fileSize) => {
  try {
    // Use stream scanning (via TCP)
    console.log(`Scanning file via stream... (${(fileSize / 1024).toFixed(2)} KB)`);
    const result = await scanWithStream(fileBuffer);
    
    // Check if we got "UNKNOWN COMMAND" error
    if (result.needsFallback || (result.rawResult && result.rawResult.resultString === 'UNKNOWN COMMAND')) {
      throw new Error('Stream scanning returned UNKNOWN COMMAND - ClamAV stream scanning may not be supported');
    }
    
    return {
      ...result,
      fileSize: fileSize
    };
  } catch (error) {
    console.error('Stream scan failed:', error.message);
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
    clamavReady: clamscanInstance !== null 
  });
});

// Upload and scan endpoint
app.post('/upload', upload.single('document'), async (req, res) => {
  // Set request and response timeout to 5 minutes for large file processing
  // Must set both req and res timeouts, and do it early
  if (req.socket) {
    req.socket.setTimeout(300000); // 5 minutes
  }
  req.setTimeout(300000); // 5 minutes
  
  // Set headers to keep connection alive for long-running scans
  res.setHeader('Connection', 'keep-alive');
  
  if (!req.file) {
    return res.status(400).json({ 
      success: false,
      message: 'No file uploaded' 
    });
  }

  // Initialize ClamAV only if scanning is enabled
  if (ENABLE_VIRUS_SCAN) {
    if (!clamscanInstance) {
      try {
        // Try to initialize with more retries and longer delays
        await initClamScanWithRetry(10, 3000); // 10 retries, 3s initial delay
      } catch (error) {
        return res.status(503).json({ 
          success: false,
          message: 'Virus scanner is not available. ClamAV may still be starting up or virus definitions are downloading. Please wait a few minutes and try again.',
          error: error.message,
          hint: 'Check ClamAV logs: docker-compose logs clamav'
        });
      }
    }
  }

  try {
    // Get file size from buffer
    const fileSize = req.file.size || req.file.buffer.length;
    
    // Format file size
    const formatFileSize = (bytes) => {
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    };
    
    // Format duration
    const formatDuration = (ms) => {
      if (ms < 1000) return `${ms}ms`;
      return `${(ms / 1000).toFixed(2)}s`;
    };
    
    // Warn if file is empty
    if (fileSize === 0) {
      console.warn(`⚠️  WARNING: File ${req.file.originalname} is 0 bytes! This may indicate an upload problem.`);
      return res.status(400).json({
        success: false,
        message: 'File is empty (0 bytes). Please check your file upload.',
        error: 'File size is 0 bytes'
      });
    }
    
    // Check for file size limitation (clamscan library uses 32-bit integer, max ~2GB)
    const MAX_FILE_SIZE_FOR_SCAN = 2147483647; // Maximum 32-bit signed integer (2GB - 1 byte)
    if (ENABLE_VIRUS_SCAN && fileSize > MAX_FILE_SIZE_FOR_SCAN) {
      const maxSizeFormatted = formatFileSize(MAX_FILE_SIZE_FOR_SCAN);
      console.warn(`⚠️  WARNING: File ${req.file.originalname} (${formatFileSize(fileSize)}) exceeds maximum scannable size of ${maxSizeFormatted}`);
      return res.status(400).json({
        success: false,
        message: `File size (${formatFileSize(fileSize)}) exceeds maximum scannable size of ${maxSizeFormatted}`,
        error: 'File too large for virus scanning',
        fileSize: fileSize,
        fileSizeFormatted: formatFileSize(fileSize),
        maxScannableSize: MAX_FILE_SIZE_FOR_SCAN,
        maxScannableSizeFormatted: maxSizeFormatted,
        hint: 'The clamscan library has a 2GB limit due to 32-bit integer constraints. Files larger than 2GB cannot be scanned via stream. Set ENABLE_VIRUS_SCAN=false to upload without scanning.'
      });
    }
    
    let responseData;
    
    if (ENABLE_VIRUS_SCAN) {
      // Scanning enabled - scan the file buffer
      console.log(`Scanning file: ${req.file.originalname} (${(fileSize / 1024).toFixed(2)} KB)`);
      
      // Measure the actual scan duration from start to finish
      const actualScanStartTime = Date.now();
      const scanResult = await scanFile(req.file.buffer, fileSize);
      const actualScanDuration = Date.now() - actualScanStartTime;
      
      // Prepare response with all performance metrics
      // Use the actual measured duration instead of the internal scanDuration
      responseData = {
        success: !scanResult.isInfected,
        message: scanResult.isInfected ? 'File is infected' : 'File is clean and safe',
        infected: scanResult.isInfected,
        scanEnabled: true,
        fileName: req.file.originalname,
        scanMethod: scanResult.method,
        fileSize: fileSize,
        fileSizeFormatted: formatFileSize(fileSize),
        // Performance metrics - use actual measured duration
        streamProcessingTime: scanResult.streamProcessingTime || 0,
        streamProcessingTimeFormatted: formatDuration(scanResult.streamProcessingTime || 0),
        scanDuration: actualScanDuration, // Use actual measured duration
        scanDurationFormatted: formatDuration(actualScanDuration),
        totalDuration: actualScanDuration,
        totalDurationFormatted: formatDuration(actualScanDuration)
      };

      if (scanResult.isInfected) {
        responseData.viruses = scanResult.viruses;
        console.log(`File infected: ${req.file.originalname} (${formatFileSize(fileSize)}) - Scan Duration: ${formatDuration(actualScanDuration)}`);
        return res.status(400).json(responseData);
      } else {
        console.log(`File clean: ${req.file.originalname} (${formatFileSize(fileSize)}) - Scan Duration: ${formatDuration(actualScanDuration)}`);
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
    console.error('Processing error:', error);
    
    return res.status(500).json({ 
      success: false,
      message: ENABLE_VIRUS_SCAN ? 'Error scanning file' : 'Error processing file',
      error: error.message
    });
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

