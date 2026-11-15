/**
 * The whole surface the dashboard gets from the desktop shell: four functions.
 * No Node, no ipcRenderer, no file access leaks into the page.
 */
import { contextBridge, ipcRenderer } from 'electron';

const bridge = {
  pickFile: (title: string): Promise<string | null> => ipcRenderer.invoke('pick-file', title),
  pickFolder: (title: string): Promise<string | null> => ipcRenderer.invoke('pick-folder', title),
  showInFolder: (path: string): Promise<void> => ipcRenderer.invoke('show-in-folder', path),
  applyDesktopSettings: (): Promise<void> => ipcRenderer.invoke('apply-desktop-settings'),
};

export type Bridge = typeof bridge;

contextBridge.exposeInMainWorld('jobpilot', bridge);
