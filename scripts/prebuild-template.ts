#!/usr/bin/env bun
/**
 * Pre-build template script
 * Run during Docker build to pre-install template dependencies
 */

import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { execSync } from 'child_process';

// Build to /app/template (persistent), copy to /data/sites/_template at runtime
const TEMPLATE_DIR = '/app/template';

// Template package.json with npm package (not file: symlink)
const packageJson = {
  name: 'template',
  private: true,
  version: '0.1.0',
  type: 'module',
  scripts: {
    dev: 'vite',
    build: 'tsc && vite build',
    preview: 'vite preview',
  },
  dependencies: {
    // Core React
    'react': '^18.2.0',
    'react-dom': '^18.2.0',
    'react-router-dom': '^6.0.0',

    // Styling utilities
    'clsx': '^2.0.0',
    'tailwind-merge': '^2.0.0',
    'class-variance-authority': '^0.7.0',
    'tw-animate-css': '^1.0.0',

    // Radix UI primitives (shadcn/ui base)
    '@radix-ui/react-accordion': '^1.0.0',
    '@radix-ui/react-alert-dialog': '^1.0.0',
    '@radix-ui/react-aspect-ratio': '^1.0.0',
    '@radix-ui/react-avatar': '^1.0.0',
    '@radix-ui/react-checkbox': '^1.0.0',
    '@radix-ui/react-collapsible': '^1.0.0',
    '@radix-ui/react-context-menu': '^2.0.0',
    '@radix-ui/react-dialog': '^1.0.0',
    '@radix-ui/react-dropdown-menu': '^2.0.0',
    '@radix-ui/react-hover-card': '^1.0.0',
    '@radix-ui/react-icons': '^1.0.0',
    '@radix-ui/react-label': '^2.0.0',
    '@radix-ui/react-menubar': '^1.0.0',
    '@radix-ui/react-navigation-menu': '^1.0.0',
    '@radix-ui/react-popover': '^1.0.0',
    '@radix-ui/react-progress': '^1.0.0',
    '@radix-ui/react-radio-group': '^1.0.0',
    '@radix-ui/react-scroll-area': '^1.0.0',
    '@radix-ui/react-select': '^2.0.0',
    '@radix-ui/react-separator': '^1.0.0',
    '@radix-ui/react-slider': '^1.0.0',
    '@radix-ui/react-slot': '^1.0.0',
    '@radix-ui/react-switch': '^1.0.0',
    '@radix-ui/react-tabs': '^1.0.0',
    '@radix-ui/react-toast': '^1.0.0',
    '@radix-ui/react-toggle': '^1.0.0',
    '@radix-ui/react-toggle-group': '^1.0.0',
    '@radix-ui/react-tooltip': '^1.0.0',

    // Common shadcn/ui dependencies
    'lucide-react': '^0.400.0',
    'cmdk': '^1.0.0',
    'sonner': '^1.0.0',
    'vaul': '^0.9.0',
    'input-otp': '^1.0.0',
    'embla-carousel-react': '^8.0.0',
    'react-resizable-panels': '^2.0.0',
    'react-day-picker': '^8.0.0',
    'recharts': '^2.0.0',

    // Form & validation
    'react-hook-form': '^7.0.0',
    '@hookform/resolvers': '^3.0.0',
    'zod': '^3.0.0',

    // State & utilities
    'zustand': '^4.0.0',
    'date-fns': '^3.0.0',
    'axios': '^1.0.0',
    'framer-motion': '^11.0.0',
    'next-themes': '^0.3.0',
  },
  devDependencies: {
    '@babel/core': '^7.23.0',
    '@babel/plugin-syntax-typescript': '^7.23.0',
    '@types/react': '^18.2.37',
    '@types/react-dom': '^18.2.15',
    '@vitejs/plugin-react': '^4.2.0',
    '@tailwindcss/postcss': '^4.0.0',
    '@tailwindcss/vite': '^4.0.0',
    '@tailwindcss/typography': '^0.5.0',
    'tailwindcss': '^4.0.0',
    'postcss-import': '^16.0.0',
    'typescript': '^5.2.2',
    'vite': '^5.0.0',
    '@lookfree0822/vite-plugin-jsx-tagger': '^0.1.0',
  },
};

// Placeholder vite.config.ts (will be overwritten per project)
const viteConfig = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { jsxTaggerPlugin } from '@lookfree0822/vite-plugin-jsx-tagger';

export default defineConfig({
  base: '/p/_template/',
  plugins: [
    jsxTaggerPlugin({
      idPrefix: '_templat',
      removeInProduction: false,
    }),
    react(),
    tailwindcss(),
  ],
  server: {
    host: true,
    allowedHosts: 'all',
  },
  build: {
    sourcemap: true,
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
`;

const tsConfig = {
  compilerOptions: {
    target: 'ES2020',
    useDefineForClassFields: true,
    lib: ['ES2020', 'DOM', 'DOM.Iterable'],
    module: 'ESNext',
    skipLibCheck: true,
    moduleResolution: 'bundler',
    allowImportingTsExtensions: true,
    resolveJsonModule: true,
    isolatedModules: true,
    noEmit: true,
    jsx: 'react-jsx',
    strict: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
    noFallthroughCasesInSwitch: true,
    baseUrl: '.',
    paths: {
      '@/*': ['./src/*'],
    },
  },
  include: ['src'],
  references: [{ path: './tsconfig.node.json' }],
};

const tsConfigNode = {
  compilerOptions: {
    composite: true,
    skipLibCheck: true,
    module: 'ESNext',
    moduleResolution: 'bundler',
    allowSyntheticDefaultImports: true,
  },
  include: ['vite.config.ts'],
};

// Tailwind v4 uses CSS-based config, but JS config is still supported for content paths
const tailwindConfig = `/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
};
`;

const postcssConfig = `export default {
  plugins: {
    'postcss-import': {},
    '@tailwindcss/postcss': {},
  },
};
`;

const indexHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Template</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;

const globalsCss = `@import 'tailwindcss';
`;

const mainTsx = `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`;

const appTsx = `export default function App() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      <div className="container mx-auto py-20">
        <h1 className="text-4xl font-bold text-gray-900 text-center">
          Template
        </h1>
      </div>
    </div>
  );
}
`;

const viteEnvDts = `/// <reference types="vite/client" />
`;

async function main() {
  console.log('[Prebuild] Creating template directory...');

  // Create directories
  await mkdir(TEMPLATE_DIR, { recursive: true });
  await mkdir(join(TEMPLATE_DIR, 'src', 'styles'), { recursive: true });

  // Write files
  const files = [
    ['package.json', JSON.stringify(packageJson, null, 2)],
    ['vite.config.ts', viteConfig],
    ['tsconfig.json', JSON.stringify(tsConfig, null, 2)],
    ['tsconfig.node.json', JSON.stringify(tsConfigNode, null, 2)],
    ['tailwind.config.js', tailwindConfig],
    ['postcss.config.js', postcssConfig],
    ['index.html', indexHtml],
    ['src/main.tsx', mainTsx],
    ['src/App.tsx', appTsx],
    ['src/vite-env.d.ts', viteEnvDts],
    ['src/styles/globals.css', globalsCss],
  ];

  for (const [path, content] of files) {
    const fullPath = join(TEMPLATE_DIR, path);
    await writeFile(fullPath, content, 'utf-8');
    console.log(`[Prebuild] Created: ${path}`);
  }

  // Install dependencies
  console.log('[Prebuild] Installing dependencies...');
  execSync('bun install', { cwd: TEMPLATE_DIR, stdio: 'inherit' });

  console.log('[Prebuild] Template ready!');
}

main().catch(console.error);
