'use client';
import React, { useEffect } from 'react';
import { Provider } from 'react-redux';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { store } from '../store';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const MEDIA_PERMISSION_TIMEOUT_MS = 10000;

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;

    const mediaDevices = navigator.mediaDevices;
    const originalGetUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);

    mediaDevices.getUserMedia = (constraints: MediaStreamConstraints) => new Promise<MediaStream>((resolve, reject) => {
      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new DOMException(
          'Camera/microphone permission timed out. The meeting will continue without local media.',
          'NotAllowedError',
        ));
      }, MEDIA_PERMISSION_TIMEOUT_MS);

      originalGetUserMedia(constraints).then(
        (stream) => {
          if (settled) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }
          settled = true;
          window.clearTimeout(timer);
          resolve(stream);
        },
        (error) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          reject(error);
        },
      );
    });

    return () => {
      mediaDevices.getUserMedia = originalGetUserMedia;
    };
  }, []);

  return <Provider store={store}><QueryClientProvider client={queryClient}>{children}</QueryClientProvider></Provider>;
}
