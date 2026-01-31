/**
 * Project Manager
 * Unified management of project creation, update, deletion and preview
 */

import { mkdir, writeFile, readFile, rm, readdir, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { viteManager } from './vite-manager';
import { dependencyManager } from './dependency-manager';
import { templateManager } from './template-manager';
import { generateScaffold, generateDefaultAppTsx } from './scaffolder';
import type {
  ProjectConfig,
  ProjectFile,
  ProjectStatus,
  FileUpdate,
  CreateProjectResult,
  ApiResponse,
} from '../types';

const DATA_DIR = process.env.DATA_DIR || '/data/sites';

export class ProjectManager {
  /**
   * Create new project
   * Optimization: Use template project to speed up creation (7-12s vs original 25-52s)
   */
  async createProject(config: ProjectConfig): Promise<CreateProjectResult> {
    const projectPath = this.getProjectPath(config.projectId);
    const start = Date.now();

    // Try to use template for fast creation (recommended)
    if (templateManager.isReady()) {
      console.log(`[ProjectManager] Using template for fast creation: ${config.projectId}`);

      // Copy from template (~3-5s, includes node_modules)
      await templateManager.createFromTemplate(config.projectId);

      // Write user's source code files (skip config files from template)
      if (config.files && config.files.length > 0) {
        // Skip files that should use template's version (have correct dependencies & config)
        const skipFiles = [
          'package.json',
          'vite.config.ts',
          'bun.lock',
          'bun.lockb',
          'postcss.config.js',
          'postcss.config.cjs',
          'postcss.config.mjs',
          'tailwind.config.js',
          'tailwind.config.ts',
          'tailwind.config.mjs',
          'tsconfig.json',
          'tsconfig.node.json',
        ];
        let writtenCount = 0;
        const skippedFiles: string[] = [];
        let userPackageJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null = null;

        for (const file of config.files) {
          // Skip config files to preserve template's correct dependency setup
          if (skipFiles.includes(file.path)) {
            skippedFiles.push(file.path);
            // Extract user's package.json for dependency merging
            if (file.path === 'package.json') {
              try {
                userPackageJson = JSON.parse(file.content);
              } catch {
                // Invalid JSON, ignore
              }
            }
            continue;
          }
          const filePath = join(projectPath, file.path);
          await mkdir(dirname(filePath), { recursive: true });
          await writeFile(filePath, file.content, 'utf-8');
          writtenCount++;
        }

        // Merge user's extra dependencies into template's package.json
        if (userPackageJson) {
          const extraDeps = await this.mergeUserDependencies(projectPath, userPackageJson);
          if (extraDeps.length > 0) {
            console.log(`[ProjectManager] Installing extra user dependencies: ${extraDeps.join(', ')}`);
            // Use ensure() instead of install() to force bun install even if node_modules exists
            await dependencyManager.ensure(projectPath);
          }
        }

        // Log skipped files for future optimization
        if (skippedFiles.length > 0) {
          console.log(`[ProjectManager] Wrote ${writtenCount} user files`);
          console.log(`[ProjectManager] Skipped config files (using template): ${skippedFiles.join(', ')}`);
        } else {
          console.log(`[ProjectManager] Wrote ${writtenCount} user files`);
        }
      } else {
        // Write default App.tsx
        const appPath = join(projectPath, 'src', 'App.tsx');
        await writeFile(appPath, generateDefaultAppTsx(config.projectName), 'utf-8');
      }

      console.log(`[ProjectManager] Project created from template in ${Date.now() - start}ms`);
    } else {
      // Fallback to original method (slow, used when template is not ready)
      console.log(`[ProjectManager] Template not ready, using slow path: ${config.projectId}`);

      // Create project directory
      await mkdir(projectPath, { recursive: true });

      // Generate scaffold files
      const scaffold = generateScaffold(config);
      if (!scaffold.success) {
        throw new Error('Failed to generate scaffold');
      }

      // Write scaffold files
      for (const file of scaffold.files) {
        const filePath = join(projectPath, file.path);
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, file.content, 'utf-8');
      }

      // Write default App.tsx
      const appPath = join(projectPath, 'src', 'App.tsx');
      await writeFile(appPath, generateDefaultAppTsx(config.projectName), 'utf-8');

      console.log(`[ProjectManager] Created project: ${config.projectId}`);

      // Install dependencies (this is the slowest step, 20-45s)
      const installResult = await dependencyManager.install(projectPath);
      if (!installResult.success) {
        console.error(`[ProjectManager] Failed to install dependencies:`, installResult.logs);
        throw new Error('Failed to install dependencies');
      }
    }

    // Start Vite Dev Server (~2-5s)
    const instance = await viteManager.start(config.projectId, projectPath);

    console.log(`[ProjectManager] Total creation time: ${Date.now() - start}ms`);

    return {
      projectPath,
      port: instance.port,
      previewUrl: `http://localhost:${instance.port}`,
      hmrUrl: `ws://localhost:${instance.port}`,
    };
  }

  /**
   * Get project status
   */
  async getStatus(projectId: string): Promise<ProjectStatus> {
    const projectPath = this.getProjectPath(projectId);

    try {
      const stats = await stat(projectPath);
      if (!stats.isDirectory()) {
        return {
          exists: false,
          devServerRunning: false,
          fileCount: 0,
        };
      }

      const instance = viteManager.getInstance(projectId);
      const fileCount = await this.countFiles(projectPath);

      return {
        exists: true,
        devServerRunning: instance?.status === 'running',
        port: instance?.port,
        fileCount,
        lastModified: stats.mtime,
      };
    } catch {
      return {
        exists: false,
        devServerRunning: false,
        fileCount: 0,
      };
    }
  }

  /**
   * Update project files
   */
  async updateFiles(projectId: string, updates: FileUpdate[]): Promise<void> {
    const projectPath = this.getProjectPath(projectId);

    for (const update of updates) {
      const filePath = join(projectPath, update.path);
      // Default to 'update' operation (compatible with backend not passing operation field)
      const operation = update.operation || 'update';

      switch (operation) {
        case 'create':
        case 'update':
          await mkdir(dirname(filePath), { recursive: true });
          await writeFile(filePath, update.content, 'utf-8');
          console.log(`[ProjectManager] ${operation}: ${update.path}`);
          break;

        case 'delete':
          try {
            await rm(filePath);
            console.log(`[ProjectManager] Deleted: ${update.path}`);
          } catch {
            // File may not exist
          }
          break;
      }
    }

    // Mark project as active
    viteManager.markActive(projectId);
  }

  /**
   * Read project file
   */
  async readFile(projectId: string, filePath: string): Promise<string | null> {
    const fullPath = join(this.getProjectPath(projectId), filePath);
    try {
      return await readFile(fullPath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * List project files
   */
  async listFiles(projectId: string, subPath = ''): Promise<string[]> {
    const dirPath = join(this.getProjectPath(projectId), subPath);
    const files: string[] = [];

    try {
      const entries = await readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const relativePath = subPath ? `${subPath}/${entry.name}` : entry.name;

        // Skip node_modules and .git
        if (entry.name === 'node_modules' || entry.name === '.git') continue;

        if (entry.isDirectory()) {
          const subFiles = await this.listFiles(projectId, relativePath);
          files.push(...subFiles);
        } else {
          files.push(relativePath);
        }
      }
    } catch {
      // Directory may not exist
    }

    return files;
  }

  /**
   * Start project preview
   */
  async startPreview(projectId: string): Promise<{ port: number; url: string }> {
    const projectPath = this.getProjectPath(projectId);

    // Ensure dependencies are installed
    await dependencyManager.install(projectPath);

    // Start Vite
    const instance = await viteManager.start(projectId, projectPath);

    return {
      port: instance.port,
      url: `http://localhost:${instance.port}`,
    };
  }

  /**
   * Stop project preview
   */
  async stopPreview(projectId: string): Promise<void> {
    await viteManager.stop(projectId);
  }

  /**
   * Delete project
   */
  async deleteProject(projectId: string): Promise<void> {
    // Stop Vite
    await viteManager.stop(projectId);

    // Delete project directory
    const projectPath = this.getProjectPath(projectId);
    try {
      await rm(projectPath, { recursive: true, force: true });
      console.log(`[ProjectManager] Deleted project: ${projectId}`);
    } catch (error) {
      console.error(`[ProjectManager] Failed to delete project ${projectId}:`, error);
      throw error;
    }
  }

  /**
   * Reinstall dependencies (force)
   * Deletes node_modules and runs bun install
   */
  async reinstallDependencies(projectId: string): Promise<void> {
    const projectPath = this.getProjectPath(projectId);

    // Stop Vite before reinstalling
    await viteManager.stop(projectId);

    // Force reinstall
    const result = await dependencyManager.reinstall(projectPath);
    if (!result.success) {
      console.error(`[ProjectManager] Reinstall failed:`, result.logs);
      throw new Error('Failed to reinstall dependencies');
    }

    // Restart Vite
    await viteManager.start(projectId, projectPath);
    console.log(`[ProjectManager] Reinstalled and restarted: ${projectId}`);
  }

  /**
   * Add dependency
   */
  async addDependency(projectId: string, packageName: string, isDev = false): Promise<void> {
    const projectPath = this.getProjectPath(projectId);
    const result = await dependencyManager.addPackage(projectPath, packageName, isDev);

    if (!result.success) {
      throw new Error(`Failed to add package: ${packageName}`);
    }
  }

  /**
   * Remove dependency
   */
  async removeDependency(projectId: string, packageName: string): Promise<void> {
    const projectPath = this.getProjectPath(projectId);
    const result = await dependencyManager.removePackage(projectPath, packageName);

    if (!result.success) {
      throw new Error(`Failed to remove package: ${packageName}`);
    }
  }

  /**
   * Get project path
   */
  getProjectPath(projectId: string): string {
    // Security check: Prevent path traversal
    const safeId = projectId.replace(/[^a-zA-Z0-9_-]/g, '');
    return join(DATA_DIR, safeId);
  }

  /**
   * Merge user's extra dependencies into template's package.json
   * Returns list of extra dependencies that were added
   */
  private async mergeUserDependencies(
    projectPath: string,
    userPkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
  ): Promise<string[]> {
    const pkgPath = join(projectPath, 'package.json');
    const extraDeps: string[] = [];

    try {
      const templatePkg = JSON.parse(await readFile(pkgPath, 'utf-8'));

      // Template's core dependencies that should not be overwritten
      // These are pre-installed in the template for fast startup
      const coreDeps = new Set([
        // Core React
        'react', 'react-dom', 'react-router-dom',
        // Styling
        'clsx', 'tailwind-merge', 'class-variance-authority', 'tw-animate-css',
        // All Radix UI primitives
        '@radix-ui/react-accordion', '@radix-ui/react-alert-dialog', '@radix-ui/react-aspect-ratio',
        '@radix-ui/react-avatar', '@radix-ui/react-checkbox', '@radix-ui/react-collapsible',
        '@radix-ui/react-context-menu', '@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu',
        '@radix-ui/react-hover-card', '@radix-ui/react-icons', '@radix-ui/react-label',
        '@radix-ui/react-menubar', '@radix-ui/react-navigation-menu', '@radix-ui/react-popover',
        '@radix-ui/react-progress', '@radix-ui/react-radio-group', '@radix-ui/react-scroll-area',
        '@radix-ui/react-select', '@radix-ui/react-separator', '@radix-ui/react-slider',
        '@radix-ui/react-slot', '@radix-ui/react-switch', '@radix-ui/react-tabs',
        '@radix-ui/react-toast', '@radix-ui/react-toggle', '@radix-ui/react-toggle-group',
        '@radix-ui/react-tooltip',
        // Common shadcn/ui dependencies
        'lucide-react', 'cmdk', 'sonner', 'vaul', 'input-otp',
        'embla-carousel-react', 'react-resizable-panels', 'react-day-picker', 'recharts',
        // Form & validation
        'react-hook-form', '@hookform/resolvers', 'zod',
        // State & utilities
        'zustand', 'date-fns', 'axios', 'framer-motion', 'next-themes',
        // Dev dependencies
        '@babel/core', '@babel/plugin-syntax-typescript',
        '@types/react', '@types/react-dom', '@vitejs/plugin-react',
        '@tailwindcss/postcss', '@tailwindcss/vite', '@tailwindcss/typography', 'tailwindcss', 'postcss-import',
        'typescript', 'vite', '@lookfree0822/vite-plugin-jsx-tagger',
      ]);

      // Merge user's dependencies (excluding core)
      if (userPkg.dependencies) {
        for (const [name, version] of Object.entries(userPkg.dependencies)) {
          if (!coreDeps.has(name) && !templatePkg.dependencies?.[name]) {
            templatePkg.dependencies = templatePkg.dependencies || {};
            templatePkg.dependencies[name] = version;
            extraDeps.push(name);
          }
        }
      }

      // Merge user's devDependencies (excluding core)
      if (userPkg.devDependencies) {
        for (const [name, version] of Object.entries(userPkg.devDependencies)) {
          if (!coreDeps.has(name) && !templatePkg.devDependencies?.[name]) {
            templatePkg.devDependencies = templatePkg.devDependencies || {};
            templatePkg.devDependencies[name] = version;
            extraDeps.push(`${name} (dev)`);
          }
        }
      }

      // Write merged package.json if there are extra deps
      if (extraDeps.length > 0) {
        await writeFile(pkgPath, JSON.stringify(templatePkg, null, 2), 'utf-8');
      }
    } catch (error) {
      console.error('[ProjectManager] Failed to merge dependencies:', error);
    }

    return extraDeps;
  }

  /**
   * Count files
   */
  private async countFiles(dirPath: string): Promise<number> {
    let count = 0;

    try {
      const entries = await readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;

        if (entry.isDirectory()) {
          count += await this.countFiles(join(dirPath, entry.name));
        } else {
          count++;
        }
      }
    } catch {
      // Ignore errors
    }

    return count;
  }
}

export const projectManager = new ProjectManager();
