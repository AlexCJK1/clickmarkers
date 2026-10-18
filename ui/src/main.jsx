import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { start } from './lib/store.js';

start();
createRoot(document.getElementById('root')).render(<App />);
