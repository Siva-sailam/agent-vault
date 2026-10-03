import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './App.css';
import { Storefront } from './Storefront';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Storefront />
  </StrictMode>,
);
