import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS=1 (pnpm dev:phone) serves a self-signed certificate so a phone on the LAN gets a secure
// context, which iOS requires before it shares tilt data.
const https = process.env.HTTPS === '1';
const server = `http://localhost:${process.env.SERVER_PORT ?? 8080}`;

export default defineConfig({
  plugins: [react(), ...(https ? [basicSsl()] : [])],
  server: {
    host: true, // listen on the LAN too, so a phone can reach the dev server
    allowedHosts: ['.ngrok-free.app', '.ngrok.app', '.trycloudflare.com', '.lhr.life'],
    proxy: {
      '/api': server,
      '/ws': { target: server.replace('http', 'ws'), ws: true },
    },
  },
});
