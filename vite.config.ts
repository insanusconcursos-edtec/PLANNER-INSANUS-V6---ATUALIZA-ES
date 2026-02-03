import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Carrega variáveis de ambiente baseadas no modo (ex: .env, .env.production)
  const env = loadEnv(mode, '.', '');

  return {
    plugins: [react()],
    build: {
      outDir: 'dist',
      sourcemap: false
    },
    define: {
      // Define process.env globalmente para evitar "ReferenceError: process is not defined"
      // Também garante que API_KEY seja uma string, mesmo que vazia, para evitar crash no new GoogleGenAI
      'process.env': {
        NODE_ENV: JSON.stringify(mode),
        API_KEY: JSON.stringify(env.API_KEY || "") 
      },
      // Fallback específico para acessos diretos process.env.API_KEY
      'process.env.API_KEY': JSON.stringify(env.API_KEY || "")
    }
  }
})