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
    setMessage('Uploading and scanning file...');
    setMessageType('info');
    setScanResult(null);

    const formData = new FormData();
    formData.append('document', file);

    try {
      const response = await axios.post(`${API_URL}/upload`, formData, {
        headers: { 
          'Content-Type': 'multipart/form-data' 
        },
        timeout: 120000 // 2 minutes timeout for large files
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
          scanDuration: response.data.scanDuration,
          scanDurationFormatted: response.data.scanDurationFormatted
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
            scanDurationFormatted: response.data.scanDurationFormatted
          });
        }
      }
    } catch (error) {
      setUploading(false);
      
      if (error.response) {
        // Server responded with error
        setMessage(error.response.data.message || 'Error uploading file');
        setMessageType('error');
        if (error.response.data.viruses) {
          setScanResult({
            infected: true,
            viruses: error.response.data.viruses,
            scanMethod: error.response.data.scanMethod,
            fileSize: error.response.data.fileSize,
            fileSizeFormatted: error.response.data.fileSizeFormatted,
            scanDuration: error.response.data.scanDuration,
            scanDurationFormatted: error.response.data.scanDurationFormatted
          });
        }
      } else if (error.request) {
        // Request made but no response
        setMessage('Unable to connect to server. Please ensure the backend is running.');
        setMessageType('error');
      } else {
        // Something else happened
        setMessage('An unexpected error occurred: ' + error.message);
        setMessageType('error');
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

