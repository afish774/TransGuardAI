const getHost = () => (typeof window !== 'undefined' && window.location ? window.location.hostname : 'localhost');
const getOrigin = () => (typeof window !== 'undefined' && window.location ? window.location.origin : 'http://localhost:5000');
const getProtocol = () => (typeof window !== 'undefined' && window.location ? window.location.protocol : 'http:');

export const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || getOrigin();
export const MEDIA_MTX_URL = import.meta.env.VITE_MEDIAMTX_URL || `${getProtocol()}//${getHost()}:8889`;
export const MEDIA_MTX_HLS_URL = import.meta.env.VITE_MEDIAMTX_HLS_URL || `${getProtocol()}//${getHost()}:8888`;

