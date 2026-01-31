/**
 * Template Manager
 * Pre-warms template project to accelerate new project creation
 *
 * Optimization results:
 * - Original approach: 25-52 seconds (mainly bun install)
 * - Optimized approach: 7-12 seconds (copy template + start Vite)
 */

import { mkdir, cp, access, constants, writeFile, rm } from 'fs/promises';
import { join, dirname } from 'path';
import { generateScaffold, generateDefaultAppTsx } from './scaffolder';
import { dependencyManager } from './dependency-manager';

// fly-server public domain for direct HMR WebSocket connection
const FLY_PUBLIC_HOST = process.env.FLY_PUBLIC_HOST || 'omniflow-preview.fly.dev';
const IS_HTTPS = FLY_PUBLIC_HOST.includes('fly.dev') || process.env.FLY_HTTPS === 'true';

const DATA_DIR = process.env.DATA_DIR || '/data/sites';
const TEMPLATE_ID = '_template';
// Pre-built template location (created during Docker build)
const PREBUILT_TEMPLATE_DIR = '/app/template';

export class TemplateManager {
  private templatePath = join(DATA_DIR, TEMPLATE_ID);
  private templateReady = false;
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize template project on startup
   * Creates scaffold and installs dependencies once
   */
  async initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._initialize();
    return this.initPromise;
  }

  private async _initialize(): Promise<void> {
    console.log('[TemplateManager] Initializing template project...');
    const start = Date.now();

    // Check if template already exists with node_modules
    const nodeModulesPath = join(this.templatePath, 'node_modules');
    try {
      await access(nodeModulesPath, constants.F_OK);
      console.log('[TemplateManager] Template already exists, skipping initialization');
      this.templateReady = true;
      return;
    } catch {
      // Template doesn't exist, try to copy from pre-built
    }

    try {
      // Check if pre-built template exists (from Docker build)
      const prebuiltNodeModules = join(PREBUILT_TEMPLATE_DIR, 'node_modules');
      let hasPrebuilt = false;
      try {
        await access(prebuiltNodeModules, constants.F_OK);
        hasPrebuilt = true;
      } catch {
        // No pre-built template
      }

      if (hasPrebuilt) {
        // Fast path: copy pre-built template (includes node_modules)
        console.log('[TemplateManager] Copying pre-built template...');
        await mkdir(DATA_DIR, { recursive: true });
        await cp(PREBUILT_TEMPLATE_DIR, this.templatePath, { recursive: true });
        console.log(`[TemplateManager] Pre-built template copied in ${Date.now() - start}ms`);
        this.templateReady = true;
        return;
      }

      // Fallback: generate template from scratch
      console.log('[TemplateManager] No pre-built template, generating from scratch...');

      // Create template directory
      await mkdir(this.templatePath, { recursive: true });

      // Generate scaffold files
      const scaffold = generateScaffold({
        projectId: TEMPLATE_ID,
        projectName: 'Template',
        files: [],
      });

      if (!scaffold.success || !scaffold.files) {
        throw new Error('Failed to generate template scaffold');
      }

      // Write scaffold files
      for (const file of scaffold.files) {
        const filePath = join(this.templatePath, file.path);
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, file.content, 'utf-8');
      }

      // Write default App.tsx
      const appPath = join(this.templatePath, 'src', 'App.tsx');
      await writeFile(appPath, generateDefaultAppTsx('Template'), 'utf-8');

      // Install dependencies (one-time cost)
      console.log('[TemplateManager] Installing template dependencies...');
      const installStart = Date.now();
      const result = await dependencyManager.install(this.templatePath);

      if (!result.success) {
        throw new Error('Failed to install template dependencies');
      }

      console.log(
        `[TemplateManager] Dependencies installed in ${Date.now() - installStart}ms`
      );

      this.templateReady = true;
      console.log(
        `[TemplateManager] Template ready in ${Date.now() - start}ms`
      );
    } catch (error) {
      console.error('[TemplateManager] Failed to initialize template:', error);
      // Clean up failed template
      try {
        await rm(this.templatePath, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  /**
   * Create a new project by copying from template
   * Much faster than creating from scratch (~3-5s vs 25-45s)
   */
  async createFromTemplate(projectId: string): Promise<string> {
    if (!this.templateReady) {
      await this.initialize();
    }

    const projectPath = join(DATA_DIR, projectId);

    console.log(`[TemplateManager] Copying template to ${projectId}...`);
    const start = Date.now();

    // Remove existing project directory if it exists (prevents "same source/dest" error)
    try {
      await rm(projectPath, { recursive: true, force: true });
    } catch {
      // Directory may not exist, ignore
    }

    // Verify template exists before copying, reinitialize if needed
    const templateNodeModules = join(this.templatePath, 'node_modules');
    try {
      await access(templateNodeModules, constants.F_OK);
    } catch {
      // Template was deleted or corrupted, reinitialize from pre-built
      console.log('[TemplateManager] Template missing, reinitializing from pre-built...');
      this.templateReady = false;
      this.initPromise = null;
      await this.initialize();
    }

    // Copy entire template directory (includes node_modules)
    // Symlinks are preserved - they point to /app/packages/vite-plugin-jsx-tagger
    // which exists in the Docker image
    await cp(this.templatePath, projectPath, { recursive: true });

    // Generate correct vite.config.ts for this projectId (avoid bun install later)
    await this.writeViteConfig(projectPath, projectId);

    console.log(
      `[TemplateManager] Template copied in ${Date.now() - start}ms`
    );
    return projectPath;
  }

  /**
   * Check if template is ready
   */
  isReady(): boolean {
    return this.templateReady;
  }

  /**
   * Get template path
   */
  getTemplatePath(): string {
    return this.templatePath;
  }

  /**
   * Write correct vite.config.ts for a specific projectId
   * This ensures the project can start immediately without bun install
   */
  private async writeViteConfig(projectPath: string, projectId: string): Promise<void> {
    const configPath = join(projectPath, 'vite.config.ts');
    const idPrefix = projectId.slice(0, 8);
    const basePath = `/p/${projectId}/`;

    const config = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { jsxTaggerPlugin } from '@lookfree0822/vite-plugin-jsx-tagger';

export default defineConfig({
  base: '${basePath}',
  plugins: [
    // JSX Tagger must be before React plugin for visual editing
    jsxTaggerPlugin({
      idPrefix: '${idPrefix}',
      removeInProduction: false,
    }),
    react(),
  ],
  server: {
    host: true,
    allowedHosts: 'all',
    hmr: {
      protocol: '${IS_HTTPS ? 'wss' : 'ws'}',
      host: '${FLY_PUBLIC_HOST}',
      clientPort: ${IS_HTTPS ? 443 : 3000},
      path: '/hmr/${projectId}',
      overlay: true,
    },
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

    await writeFile(configPath, config, 'utf-8');
  }

  /**
   * Force rebuild template (useful for updates)
   */
  async rebuild(): Promise<void> {
    console.log('[TemplateManager] Rebuilding template...');

    // Remove existing template
    try {
      await rm(this.templatePath, { recursive: true, force: true });
    } catch {
      // Ignore if doesn't exist
    }

    this.templateReady = false;
    this.initPromise = null;

    // Reinitialize
    await this.initialize();
  }
}

export const templateManager = new TemplateManager();
