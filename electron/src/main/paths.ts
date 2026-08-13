import { app } from 'electron';
import { join } from 'node:path';

/** В разработке это папка electron/, в собранном приложении — app.asar. */
export const assetPath = (...parts: string[]): string => join(app.getAppPath(), 'assets', ...parts);

export const rendererPath = (...parts: string[]): string => join(app.getAppPath(), 'dist', 'renderer', ...parts);

export const preloadPath = (): string => join(app.getAppPath(), 'dist', 'preload', 'index.js');
