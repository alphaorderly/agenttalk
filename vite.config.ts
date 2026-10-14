import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import tsconfigPaths from 'vite-tsconfig-paths';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
    plugins: [react(), tsconfigPaths(), tailwindcss()],
    server: {
        proxy: {
            // API 서버(server/index.ts)로 프록시. Host 헤더는 localhost 그대로 전달된다.
            '/api': process.env.AGENTTALK_API ?? 'http://127.0.0.1:8787',
        },
    },
});
