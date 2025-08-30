import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './styles/index.css';
import { ClickToComponent } from 'click-to-react-component';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Sentry from '@sentry/react';
// Install VS Code iframe keyboard bridge when running inside an iframe
import './vscode/bridge';

import {
  useLocation,
  useNavigationType,
  createRoutesFromChildren,
  matchRoutes,
} from 'react-router-dom';

Sentry.init({
  dsn: 'https://1065a1d276a581316999a07d5dffee26@o4509603705192449.ingest.de.sentry.io/4509605576441937',
  tracesSampleRate: 1.0,
  environment: import.meta.env.MODE === 'development' ? 'dev' : 'production',
  integrations: [
    Sentry.reactRouterV6BrowserTracingIntegration({
      useEffect: React.useEffect,
      useLocation,
      useNavigationType,
      createRoutesFromChildren,
      matchRoutes,
    }),
  ],
});
Sentry.setTag('source', 'frontend');

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      // Only retry network errors or 5xx, and keep it low to avoid bursts
      retry(failureCount, error: any) {
        const status = error?.status ?? error?.response?.status;
        const is4xx = status && status >= 400 && status < 500;
        return !is4xx && failureCount < 2;
      },
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <Sentry.ErrorBoundary fallback={<p>An error has occurred</p>} showDialog>
        <ClickToComponent />
        <App />
        {/* <ReactQueryDevtools initialIsOpen={false} /> */}
      </Sentry.ErrorBoundary>
    </QueryClientProvider>
  </React.StrictMode>
);
