import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

// Prevent scrolling on number inputs from changing the value
document.addEventListener('wheel', () => {
  if (document.activeElement.type === 'number') {
    document.activeElement.blur();
  }
});
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
