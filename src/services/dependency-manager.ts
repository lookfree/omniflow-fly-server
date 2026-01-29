/**
 * Dependency Manager
 * Use Bun to install and manage project dependencies
 */

import { spawn } from 'child_process';
import { access, constants } from 'fs/promises';
import { join } from 'path';
import type { InstallResult } from '../types';

export class DependencyManager {
  private bunBinary = process.env.BUN_BINARY || process.execPath;
  private installing: Map<string, Promise<InstallResult>> = new Map();

  /**
   * Install project dependencies
   */
  async install(projectPath: string): Promise<InstallResult> {
    // Check if already installed
    const nodeModulesPath = join(projectPath, 'node_modules');
    try {
      await access(nodeModulesPath, constants.F_OK);
      console.log(`[DependencyManager] Already installed: ${projectPath}`);
      return { success: true, duration: 0, logs: ['Dependencies already installed'] };
    } catch {
      // Need to install
    }

    // Avoid duplicate installation (same project)
    const existing = this.installing.get(projectPath);
    if (existing) {
      console.log(`[DependencyManager] Waiting for existing install: ${projectPath}`);
      return existing;
    }

    console.log(`[DependencyManager] Installing dependencies: ${projectPath}`);
    const promise = this.runInstall(projectPath);
    this.installing.set(projectPath, promise);

    try {
      return await promise;
    } finally {
      this.installing.delete(projectPath);
    }
  }

  private async runInstall(projectPath: string): Promise<InstallResult> {
    const start = Date.now();
    const logs: string[] = [];

    return new Promise((resolve) => {
      const proc = spawn(this.bunBinary, ['install'], {
        cwd: projectPath,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, CI: 'true' },  // Non-interactive mode
      });

      proc.stdout?.on('data', (data: Buffer) => {
        const msg = data.toString();
        logs.push(msg);
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const msg = data.toString();
        logs.push(msg);
      });

      proc.on('close', (code) => {
        const duration = Date.now() - start;
        const success = code === 0;

        if (success) {
          console.log(`[DependencyManager] Installed in ${duration}ms: ${projectPath}`);
        } else {
          console.error(`[DependencyManager] Install failed with code ${code}: ${projectPath}`);
        }

        resolve({
          success,
          duration,
          logs,
        });
      });

      proc.on('error', (error) => {
        logs.push(`Error: ${error.message}`);
        console.error(`[DependencyManager] Install error: ${error.message}`);
        resolve({
          success: false,
          duration: Date.now() - start,
          logs,
        });
      });
    });
  }

  /**
   * Add new dependency
   */
  async addPackage(
    projectPath: string,
    packageName: string,
    isDev = false
  ): Promise<InstallResult> {
    const start = Date.now();
    const logs: string[] = [];
    const args = ['add', packageName];
    if (isDev) args.push('-D');

    console.log(`[DependencyManager] Adding package: ${packageName} to ${projectPath}`);

    return new Promise((resolve) => {
      const proc = spawn(this.bunBinary, args, {
        cwd: projectPath,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      proc.stdout?.on('data', (data: Buffer) => logs.push(data.toString()));
      proc.stderr?.on('data', (data: Buffer) => logs.push(data.toString()));

      proc.on('close', (code) => {
        const duration = Date.now() - start;
        console.log(`[DependencyManager] Added ${packageName} in ${duration}ms`);
        resolve({
          success: code === 0,
          duration,
          logs,
        });
      });

      proc.on('error', (error) => {
        logs.push(`Error: ${error.message}`);
        resolve({
          success: false,
          duration: Date.now() - start,
          logs,
        });
      });
    });
  }

  /**
   * Remove dependency
   */
  async removePackage(projectPath: string, packageName: string): Promise<InstallResult> {
    const start = Date.now();
    const logs: string[] = [];

    console.log(`[DependencyManager] Removing package: ${packageName} from ${projectPath}`);

    return new Promise((resolve) => {
      const proc = spawn(this.bunBinary, ['remove', packageName], {
        cwd: projectPath,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      proc.stdout?.on('data', (data: Buffer) => logs.push(data.toString()));
      proc.stderr?.on('data', (data: Buffer) => logs.push(data.toString()));

      proc.on('close', (code) => {
        resolve({
          success: code === 0,
          duration: Date.now() - start,
          logs,
        });
      });

      proc.on('error', (error) => {
        logs.push(`Error: ${error.message}`);
        resolve({
          success: false,
          duration: Date.now() - start,
          logs,
        });
      });
    });
  }

  /**
   * Force reinstall dependencies (deletes node_modules first)
   */
  async reinstall(projectPath: string): Promise<InstallResult> {
    const nodeModulesPath = join(projectPath, 'node_modules');
    try {
      const { rm } = await import('fs/promises');
      await rm(nodeModulesPath, { recursive: true, force: true });
      console.log(`[DependencyManager] Removed node_modules: ${projectPath}`);
    } catch {
      // node_modules may not exist
    }

    console.log(`[DependencyManager] Reinstalling dependencies: ${projectPath}`);
    return this.runInstall(projectPath);
  }

  /**
   * Check if dependencies are installed
   */
  async isInstalled(projectPath: string): Promise<boolean> {
    const nodeModulesPath = join(projectPath, 'node_modules');
    try {
      await access(nodeModulesPath, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}

export const dependencyManager = new DependencyManager();
