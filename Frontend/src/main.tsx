/** Entry point: global styles (tokens first), then the app. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.js';
import './design-system/tokens/tokens.css';
import './design-system/tokens/base.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
