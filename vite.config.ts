import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // As pastas geradas pelo build ficam fora da observação: no Google Drive, a gravação delas derrubava o servidor de desenvolvimento.
  server: { port: 5180, strictPort: true, host: true, watch: { ignored: ['**/dist/**', '**/dist-demo/**'] } },
  preview: { port: 5180, strictPort: true, host: true },
  // Bibliotecas em arquivos próprios: mudam pouco, ficam em cache no navegador e o pacote do sistema fica menor.
  build: { rollupOptions: { output: { manualChunks: { react: ['react', 'react-dom'], supabase: ['@supabase/supabase-js'] } } } },
})
