import axios from 'axios';
import { useAuthStore } from '../store/authStore';

// In a real app, this should come from a .env file
// Using the deployed backend URL or local IP depending on environment
export const API_URL = 'https://nex.ces-pl.com/api';

export const apiClient = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add a request interceptor to inject the token
apiClient.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().token;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Add a response interceptor to handle 401s (logout on token expiration)
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // Log the error response for debugging
    if (error.response) {
      console.warn(`API Error [${error.response.status}] on ${error.config?.url}:`, error.response.data);
    } else {
      console.warn(`API Network Error on ${error.config?.url}:`, error.message);
    }

    if (error.response?.status === 401) {
      useAuthStore.getState().logout();
    }
    return Promise.reject(error);
  }
);
