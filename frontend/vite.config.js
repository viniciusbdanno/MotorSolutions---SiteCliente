import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    watch: {
      ignored: [`${import.meta.dirname}/imagem/**`],
    },
  },
});
