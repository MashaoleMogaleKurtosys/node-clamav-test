import React, { useState } from 'react';
import axios from 'axios';
import './FileUpload.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://127.0.0.1:3001';

const FileUpload = () => {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState(''); // 'success', 'error', 'info'
  const [scanResult, setScanResult] = useState(null);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
      setMessage('');
      setMessageType('');
      setScanResult(null);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setMessage('Please select a file first.');
      setMessageType('error');
      return;
    }

    setUploading(true);
    setMessage(`Uploading ${(file.size / 1024 / 1024).toFixed(2)} MB file...`);
    setMessageType('info');
    setScanResult(null);

    const formData = new FormData();
    formData.append('document', file);

    const uploadStartTime = Date.now();
    const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);

    try {
      // Increase timeout for large files: 5 minutes (300000ms) to match server
      const timeout = 300000; // 5 minutes
      
      console.log(`[Upload] Starting upload: ${file.name} (${fileSizeMB} MB)`);
      
      const response = await axios.post(`${API_URL}/upload`, formData, {
        headers: { 
          'Content-Type': 'multipart/form-data' 
        },
        timeout: timeout,
        // Track upload progress
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            const uploadedMB = (progressEvent.loaded / 1024 / 1024).toFixed(2);
            setMessage(`Uploading... ${percentCompleted}% (${uploadedMB} MB / ${fileSizeMB} MB)`);
            console.log(`[Upload] Progress: ${percentCompleted}% (${uploadedMB} MB)`);
          }
        }
      });
      
      const totalDuration = Date.now() - uploadStartTime;
      console.log(`[Upload] Completed in ${(totalDuration / 1000).toFixed(2)}s`, {
        requestId: response.data.requestId,
        totalDuration: response.data.totalDurationFormatted
      });

      setUploading(false);
      
      if (response.data.success) {
        setMessage(response.data.message);
        setMessageType('success');
        setScanResult({
          infected: false,
          fileName: response.data.fileName,
          scanMethod: response.data.scanMethod,
          fileSize: response.data.fileSize,
          fileSizeFormatted: response.data.fileSizeFormatted,
          uploadDuration: response.data.uploadDuration,
          uploadDurationFormatted: response.data.uploadDurationFormatted,
          scanDuration: response.data.scanDuration,
          scanDurationFormatted: response.data.scanDurationFormatted,
          totalDuration: response.data.totalDuration,
          totalDurationFormatted: response.data.totalDurationFormatted,
          requestId: response.data.requestId
        });
      } else {
        setMessage(response.data.message);
        setMessageType('error');
        if (response.data.viruses) {
          setScanResult({
            infected: true,
            viruses: response.data.viruses,
            scanMethod: response.data.scanMethod,
            fileSize: response.data.fileSize,
            fileSizeFormatted: response.data.fileSizeFormatted,
            scanDuration: response.data.scanDuration,
            scanDurationFormatted: response.data.scanDurationFormatted,
            requestId: response.data.requestId
          });
        }
      }
    } catch (error) {
      setUploading(false);
      const errorDuration = Date.now() - uploadStartTime;
      
      console.error('[Upload] Error occurred:', {
        error: error.message,
        code: error.code,
        duration: `${(errorDuration / 1000).toFixed(2)}s`,
        stage: error.response?.data?.stage || 'unknown'
      });
      
      if (error.response) {
        // Server responded with error
        const errorData = error.response.data;
        const requestId = errorData.requestId || 'unknown';
        
        let errorMessage = errorData.message || 'Error uploading file';
        
        // Provide specific error messages based on error type
        if (errorData.stage === 'connection_error') {
          errorMessage = `Connection to virus scanner lost. This may happen with very large files. Request ID: ${requestId}`;
        } else if (errorData.stage === 'timeout_error') {
          errorMessage = `Upload/scan timed out after ${(errorDuration / 1000 / 60).toFixed(1)} minutes. Large files may take longer. Request ID: ${requestId}`;
        } else if (errorData.stage === 'upload_timeout') {
          errorMessage = `Upload timed out. The file may be too large or network connection is slow. Request ID: ${requestId}`;
        } else if (errorData.stage === 'scan_failed') {
          errorMessage = `Virus scan failed: ${errorData.error || 'Unknown error'}. Request ID: ${requestId}`;
        } else if (error.response.status === 503) {
          errorMessage = `Virus scanner is not available. ClamAV may be starting up. Request ID: ${requestId}`;
        }
        
        setMessage(errorMessage);
        setMessageType('error');
        
        if (errorData.viruses) {
          setScanResult({
            infected: true,
            viruses: errorData.viruses,
            scanMethod: errorData.scanMethod,
            fileSize: errorData.fileSize,
            fileSizeFormatted: errorData.fileSizeFormatted,
            scanDuration: errorData.scanDuration,
            scanDurationFormatted: errorData.scanDurationFormatted,
            requestId: requestId
          });
        }
      } else if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        // Request timeout
        const timeoutMinutes = (300000 / 1000 / 60).toFixed(1); // 5 minutes
        setMessage(`Request timed out after ${timeoutMinutes} minutes. The file may be too large or the server is taking longer than expected. Please check server logs or try again with a smaller file.`);
        setMessageType('error');
        console.error('[Upload] Timeout error:', {
          duration: `${(errorDuration / 1000).toFixed(2)}s`,
          fileSize: fileSizeMB + ' MB'
        });
      } else if (error.code === 'ERR_BLOCKED_BY_CLIENT' || 
                 error.message?.includes('ERR_BLOCKED_BY_CLIENT') ||
                 (error.code === 'ERR_NETWORK' && errorDuration < 0.1)) {
        // Browser extension or security software blocking the request
        // ERR_NETWORK with very short duration (<0.1s) usually indicates blocking
        setMessage(`⚠️ Request was blocked by a browser extension or security software. Please: 1) Disable ad blockers (uBlock Origin, AdBlock Plus), 2) Disable privacy extensions (Privacy Badger, Ghostery), 3) Try incognito/private mode, or 4) Whitelist ${API_URL} in your extensions.`);
        setMessageType('error');
        console.error('[Upload] Request blocked by client:', {
          code: error.code,
          message: error.message,
          url: `${API_URL}/upload`,
          duration: `${(errorDuration / 1000).toFixed(2)}s`,
          hint: 'This is usually caused by browser extensions blocking the request. Try disabling extensions or using incognito mode.'
        });
      } else if (error.request) {
        // Request made but no response - network/server issue
        // Check if it's a network error vs server down
        if (error.code === 'ERR_NETWORK' || error.message?.includes('Network Error')) {
          setMessage(`Network error: Unable to connect to server at ${API_URL}. Please check: 1) Server is running (test: curl ${API_URL}/health), 2) No firewall blocking the connection, 3) Browser extensions are not blocking requests, 4) CORS is properly configured.`);
        } else {
          setMessage(`Unable to connect to server. The server may be down or unreachable. Please check that the server is running at ${API_URL} and try again.`);
        }
        setMessageType('error');
        console.error('[Upload] No response from server:', {
          url: `${API_URL}/upload`,
          duration: `${(errorDuration / 1000).toFixed(2)}s`,
          code: error.code,
          message: error.message
        });
      } else {
        // Something else happened
        setMessage(`An unexpected error occurred: ${error.message}. Please try again or contact support.`);
        setMessageType('error');
        console.error('[Upload] Unexpected error:', error);
      }
    }
  };

  const handleReset = () => {
    setFile(null);
    setMessage('');
    setMessageType('');
    setScanResult(null);
    // Reset file input
    const fileInput = document.getElementById('file-input');
    if (fileInput) {
      fileInput.value = '';
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div className="file-upload">
      <div className="upload-area">
        <input
          id="file-input"
          type="file"
          onChange={handleFileChange}
          disabled={uploading}
          className="file-input"
        />
        <label htmlFor="file-input" className="file-label">
          {file ? (
            <div className="file-selected">
              <span className="file-icon">📄</span>
              <div className="file-info">
                <div className="file-name">{file.name}</div>
                <div className="file-size">{formatFileSize(file.size)}</div>
              </div>
            </div>
          ) : (
            <div className="file-placeholder">
              <span className="upload-icon">📤</span>
              <span>Click to select a file</span>
            </div>
          )}
        </label>
      </div>

      <div className="button-group">
        <button 
          onClick={handleUpload} 
          disabled={!file || uploading}
          className="upload-button"
        >
          {uploading ? 'Scanning...' : 'Upload & Scan'}
        </button>
        {file && !uploading && (
          <button 
            onClick={handleReset}
            className="reset-button"
          >
            Clear
          </button>
        )}
      </div>

      {message && (
        <div className={`message message-${messageType}`}>
          <span className="message-icon">
            {messageType === 'success' && '✅'}
            {messageType === 'error' && '❌'}
            {messageType === 'info' && '⏳'}
          </span>
          <span>{message}</span>
        </div>
      )}

      {scanResult && (
        <div className={`scan-result ${scanResult.infected ? 'infected' : 'clean'}`}>
          <h3>Scan Results</h3>
          <div className="result-details">
            <div className="result-item">
              <strong>Status:</strong> 
              <span className={scanResult.infected ? 'status-infected' : 'status-clean'}>
                {scanResult.infected ? '⚠️ INFECTED' : '✓ CLEAN'}
              </span>
            </div>
            {scanResult.fileName && (
              <div className="result-item">
                <strong>File:</strong> {scanResult.fileName}
              </div>
            )}
            {scanResult.fileSizeFormatted && (
              <div className="result-item">
                <strong>File Size:</strong> {scanResult.fileSizeFormatted}
              </div>
            )}
            {scanResult.scanDurationFormatted && (
              <div className="result-item">
                <strong>Scan Duration:</strong> 
                <span className="scan-duration">{scanResult.scanDurationFormatted}</span>
              </div>
            )}
            <div className="result-item">
              <strong>Scan Method:</strong> 
              <span className="scan-method">{scanResult.scanMethod || 'N/A'}</span>
            </div>
            {scanResult.infected && scanResult.viruses && scanResult.viruses.length > 0 && (
              <div className="result-item">
                <strong>Threats Detected:</strong>
                <ul className="virus-list">
                  {scanResult.viruses.map((virus, index) => (
                    <li key={index}>{virus}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default FileUpload;

