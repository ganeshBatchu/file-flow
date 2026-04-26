import React from 'react';
import ReactDOM from 'react-dom/client';
import './browserShim.ts'; // no-op inside Electron, provides mock IPC in browser
import App from './App.tsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>
);
