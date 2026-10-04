import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { useClient } from '@solana/react';
import './index.css';
import './App.css';
import { Storefront } from './Storefront';
import { Providers } from './providers';
import type { AppClient } from './providers';

function Root() {
  const client = useClient<AppClient>();
  return <Storefront client={client} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers>
      <Root />
    </Providers>
  </StrictMode>,
);
