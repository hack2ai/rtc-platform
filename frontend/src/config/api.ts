import axios, { AxiosInstance, AxiosResponse, AxiosError } from 'axios';
import { firebaseAuth } from './firebase';

const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api';
const API_URL = typeof window !== 'undefined' && window.location.protocol === 'https:'
  ? '/api-proxy'
  : configuredApiUrl;

class ApiClient {
  private instance: AxiosInstance;
  constructor() {
    this.instance = axios.create({ baseURL: API_URL, timeout: 30000, headers: { 'Content-Type': 'application/json' } });
    this.instance.interceptors.request.use(async (config) => {
      const user = firebaseAuth.currentUser;
      if (user) { const token = await user.getIdToken(); config.headers.Authorization = `Bearer ${token}`; }
      return config;
    });
    this.instance.interceptors.response.use(
      (r: AxiosResponse) => r,
      (error: AxiosError<{ error?: string }>) => {
        if (error.response?.status === 401 && typeof window !== 'undefined') { firebaseAuth.signOut(); window.location.href = '/login'; }
        return Promise.reject(error);
      }
    );
  }
  get<T>(url: string, params?: object) { return this.instance.get<T>(url, { params }); }
  post<T>(url: string, data?: object) { return this.instance.post<T>(url, data); }
  put<T>(url: string, data?: object) { return this.instance.put<T>(url, data); }
  delete<T>(url: string) { return this.instance.delete<T>(url); }
}

export const api = new ApiClient();
