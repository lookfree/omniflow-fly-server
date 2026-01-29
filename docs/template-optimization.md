# Template-based Project Creation Optimization

## Problem

Current project creation takes **25-52 seconds**, mainly due to:
- `bun install` takes 20-45 seconds per project
- Each new project installs dependencies from scratch

## Solution: Template Project Pre-warming

Pre-create a template project with all dependencies installed. New projects copy from template instead of reinstalling.

### Expected Performance

| Step | Before | After |
|------|--------|-------|
| Create directory | ~1s | ~1s |
| Generate scaffold | ~1-2s | **0s** (copied) |
| Install dependencies | **20-45s** | **0s** (copied) |
| Copy node_modules | N/A | ~3-5s |
| Write user files | ~1s | ~1s |
| Start Vite | ~2-5s | ~2-5s |
| **Total** | **25-52s** | **7-12s** |

## Implementation

### 1. Template Manager Service

```typescript
// src/services/template-manager.ts

import { mkdir, cp, access, constants } from 'fs/promises';
import { join } from 'path';
import { generateScaffold } from './scaffolder';
import { dependencyManager } from './dependency-manager';

const DATA_DIR = process.env.DATA_DIR || '/data/sites';
const TEMPLATE_ID = '_template';

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

    // Check if template already exists with node_modules
    const nodeModulesPath = join(this.templatePath, 'node_modules');
    try {
      await access(nodeModulesPath, constants.F_OK);
      console.log('[TemplateManager] Template already exists, skipping initialization');
      this.templateReady = true;
      return;
    } catch {
      // Template doesn't exist, create it
    }

    // Create template directory
    await mkdir(this.templatePath, { recursive: true });

    // Generate scaffold files
    const scaffold = generateScaffold({
      projectId: TEMPLATE_ID,
      projectName: 'Template',
      files: [],
    });

    if (!scaffold.success) {
      throw new Error('Failed to generate template scaffold');
    }

    // Write scaffold files
    for (const file of scaffold.files) {
      const filePath = join(this.templatePath, file.path);
      const { mkdir: mkdirAsync, writeFile } = await import('fs/promises');
      const { dirname } = await import('path');
      await mkdirAsync(dirname(filePath), { recursive: true });
      await writeFile(filePath, file.content, 'utf-8');
    }

    // Install dependencies (one-time cost)
    console.log('[TemplateManager] Installing template dependencies...');
    const start = Date.now();
    const result = await dependencyManager.install(this.templatePath);

    if (!result.success) {
      throw new Error('Failed to install template dependencies');
    }

    console.log(`[TemplateManager] Template ready in ${Date.now() - start}ms`);
    this.templateReady = true;
  }

  /**
   * Create a new project by copying from template
   */
  async createFromTemplate(projectId: string): Promise<string> {
    if (!this.templateReady) {
      await this.initialize();
    }

    const projectPath = join(DATA_DIR, projectId);

    console.log(`[TemplateManager] Copying template to ${projectId}...`);
    const start = Date.now();

    // Copy entire template directory
    await cp(this.templatePath, projectPath, { recursive: true });

    console.log(`[TemplateManager] Template copied in ${Date.now() - start}ms`);
    return projectPath;
  }

  /**
   * Check if template is ready
   */
  isReady(): boolean {
    return this.templateReady;
  }
}

export const templateManager = new TemplateManager();
```

### 2. Update Project Manager

```typescript
// In project-manager.ts, update createProject method:

async createProject(config: ProjectConfig): Promise<CreateProjectResult> {
  const projectPath = this.getProjectPath(config.projectId);

  // Use template if available (fast path)
  if (templateManager.isReady()) {
    // Copy from template (~3-5s)
    await templateManager.createFromTemplate(config.projectId);

    // Write user's source files only
    if (config.files && config.files.length > 0) {
      for (const file of config.files) {
        const filePath = join(projectPath, file.path);
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, file.content, 'utf-8');
      }
    }
  } else {
    // Fallback to original method (slow path)
    await mkdir(projectPath, { recursive: true });

    const scaffold = generateScaffold(config);
    for (const file of scaffold.files) {
      const filePath = join(projectPath, file.path);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, file.content, 'utf-8');
    }

    // Install dependencies (slow!)
    await dependencyManager.install(projectPath);
  }

  // Start Vite Dev Server
  const instance = await viteManager.start(config.projectId, projectPath);

  return {
    projectPath,
    port: instance.port,
    previewUrl: `http://localhost:${instance.port}`,
    hmrUrl: `ws://localhost:${instance.port}`,
  };
}
```

### 3. Initialize on Startup

```typescript
// In src/index.ts, add initialization:

import { templateManager } from './services/template-manager';

// Initialize template on startup (background)
templateManager.initialize().catch(err => {
  console.error('[Startup] Failed to initialize template:', err);
});
```

## Alternative: Symbolic Link for node_modules

If disk space is a concern, use symlinks instead of copying:

```typescript
async createFromTemplate(projectId: string): Promise<string> {
  const projectPath = join(DATA_DIR, projectId);

  // Copy scaffold files only (without node_modules)
  await cp(this.templatePath, projectPath, {
    recursive: true,
    filter: (src) => !src.includes('node_modules'),
  });

  // Symlink node_modules
  const { symlink } = await import('fs/promises');
  await symlink(
    join(this.templatePath, 'node_modules'),
    join(projectPath, 'node_modules'),
    'dir'
  );

  return projectPath;
}
```

**Pros:**
- Instant creation (~1s)
- Saves disk space

**Cons:**
- All projects share same dependencies
- Can't add project-specific packages

## Recommendation

Use **full copy approach** for production:
1. More robust (isolated dependencies)
2. Still fast enough (~5-10s total)
3. No symlink issues on different filesystems

Use **symlink approach** for development/testing where speed is critical.
