import React from 'react';
import './App.css';
import FileUpload from './components/FileUpload';

function App() {
  return (
    <div className="App">
      <div className="container">
        <h1>Document Scanner</h1>
        <p className="subtitle">Upload your documents for virus scanning</p>
        <FileUpload />
      </div>
    </div>
  );
}

export default App;

