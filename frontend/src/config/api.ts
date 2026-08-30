import axios, { AxiosInstance, AxiosResponse, AxiosError } from 'axios';
import { firebaseAuth } from './firebase';

const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api';
const API_URL = typeof window !== 'undefined' && window.location.protocol === 'https:'
  ? '/api-proxy'
  : configuredApiUrl;

const REQUEST_TIMEOUT_MS = 15000;
const TOKEN_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (error) => { window.clearTimeout(timer); reject(error); },
    );
  });
}

class ApiClient {
  private instance: AxiosInstance;

  constructor() {
    this.instance = axios.create({
      baseURL: API_URL,
      timeout: REQUEST_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json' },
    });

    this.instance.interceptors.request.use(async (config) => {
      const user = firebaseAuth.currentUser;
      if (!user) return config;

      const token = await withTimeout(
        user.getIdToken(),
        TOKEN_TIMEOUT_MS,
        'Firebase authentication timed out. Please reload and sign in again.',
      );
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
      return config;
    });

    this.instance.interceptors.response.use(
      (r: AxiosResponse) => r,
      (error: AxiosError<{ error?: string }>) => {
        if (error.response?.status === 401 && typeof window !== 'undefined') {
          void firebaseAuth.signOut();
          window.location.href = '/login';
        }
        return Promise.reject(error);
      },
    );
  }

  get<T>(url: string, params?: object) { return this.instance.get<T>(url, { params }); }
  post<T>(url: string, data?: object) { return this.instance.post<T>(url, data); }
  put<T>(url: string, data?: object) { return this.instance.put<T>(url, data); }
  delete<T>(url: string) { return this.instance.delete<T>(url); }
}

export const api = new ApiClient();
