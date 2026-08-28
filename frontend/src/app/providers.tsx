'use client';
import React from 'react';
import { Provider } from 'react-redux';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { store } from '../store';
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 1000*60*5, retry: 1, refetchOnWindowFocus: false } } });
export function Providers({ children }: { children: React.ReactNode }) {
  return <Provider store={store}><QueryClientProvider client={queryClient}>{children}</QueryClientProvider></Provider>;
}
