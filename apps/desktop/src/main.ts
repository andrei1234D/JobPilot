/**
 * Electron main process.
 *
 * The desktop app is a thin shell: it starts the same Fastify server the
 * browser version uses (in-process, on the fixed loopback port the extension
 * expects) and shows the same React build in a window. What it adds is what a
 * web page cannot do: a tray icon with the number of follow-ups due, a morning
 * notification, start-with-Windows, and native file pickers.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserWindow, Menu, Notification, Tray, app, dialog, ipcMain, nativeImage, shell, type IpcMainInvokeEvent } from 'electron';
import { AlreadyRunningError, defaultHome, startServer, type RunningServer } from '@jobpilot/server';
import { SettingsSchema, TodaySchema, type Settings, type Today } from '@jobpilot/shared';

const APP_ID = 'dev.jobpilot.desktop';
const startHidden = process.argv.includes('--hidden');
const smokeTest = process.argv.includes('--smoke-test');

app.setName('JobPilot');
// Keep Chromium's own profile out of the folder that holds settings.json.
app.setPath('userData', join(defaultHome(), 'electron'));
app.commandLine.appendSwitch('disk-cache-size', String(10 * 1024 * 1024));

/** Bundled resources: next to the exe when packaged, in the repo when run with `electron .`. */
function resource(name: 'web' | 'sample-data' | 'assets'): string {
  if (app.isPackaged) return join(process.resourcesPath, name);
  const repo = join(__dirname, '..', '..', '..');
  return name === 'web' ? join(repo, 'apps', 'web', 'dist') : name === 'assets' ? join(repo, 'apps', 'desktop', 'assets') : join(repo, 'sample-data');
}

let server: RunningServer | null = null;
let baseUrl = '';
let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let lastNotifiedDay = '';
let trayHintShown = false;

async function api<T>(path: string, parse: (value: unknown) => T): Promise<T | null> {
  try {
    const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(4000) });
    return response.ok ? parse(await response.json()) : null;
  } catch {
    return null;
  }
}

const getToday = (): Promise<Today | null> => api('/api/today', (value) => TodaySchema.parse(value));
const getSettings = (): Promise<Settings | null> => api('/api/settings', (value) => SettingsSchema.parse((value as { settings: unknown }).settings));

// ------------------------------------------------------------------ window

function showWindow(path?: string): void {
  if (!window) {
    createWindow(path);
    return;
  }
  if (path) void window.loadURL(`${baseUrl}${path}`);
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function createWindow(path = '/'): void {
  window = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 980,
    minHeight: 620,
    show: false,
    title: 'JobPilot',
    icon: join(resource('assets'), 'icon.png'),
    backgroundColor: '#f9f9f7',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.once('ready-to-show', () => {
    if (!startHidden && !smokeTest) window?.show();
  });

  // The window only ever shows the local dashboard. Every other link opens in the real browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(baseUrl)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    }
  });

  // Closing the window keeps JobPilot in the tray, so the morning notification still fires.
  window.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    window?.hide();
    if (!trayHintShown && Notification.isSupported()) {
      trayHintShown = true;
      new Notification({ title: 'JobPilot is still running', body: 'It stays in the tray. Right-click the tray icon to quit.', silent: true }).show();
    }
  });
  window.on('closed', () => {
    window = null;
  });
  void window.loadURL(`${baseUrl}${path}`);
}

// -------------------------------------------------------------------- tray

/** Draws the count on top of the icon in the renderer (a canvas), because the main process has no 2D API. */
async function badgeIcon(count: number, size: number): Promise<Electron.NativeImage | null> {
  if (!window || window.webContents.isLoading()) return null;
  const script = `(async () => {
    const size = ${size}, count = ${count};
    const image = new Image();
    image.src = '/icon.svg';
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const g = canvas.getContext('2d');
    g.drawImage(image, 0, 0, size, size);
    const r = size * 0.3;
    g.beginPath(); g.arc(size - r, size - r, r, 0, Math.PI * 2);
    g.fillStyle = '#d03b3b'; g.fill();
    g.fillStyle = '#ffffff'; g.font = '700 ' + Math.round(r * 1.5) + 'px Segoe UI, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(count > 9 ? '9+' : String(count), size - r, size - r + size * 0.02);
    return canvas.toDataURL('image/png');
  })()`;
  try {
    const dataUrl = (await window.webContents.executeJavaScript(script)) as string;
    return nativeImage.createFromDataURL(dataUrl);
  } catch {
    return null;
  }
}

async function refreshTray(): Promise<void> {
  if (!tray) return;
  const today = await getToday();
  const due = today?.followUpsDue.length ?? 0;
  const needs = today ? today.needs.length + (today.batch?.needs.length ?? 0) - today.checked.length : 0;
  tray.setToolTip(today ? `JobPilot: ${due} follow-up${due === 1 ? '' : 's'} due, ${Math.max(0, needs)} need you` : 'JobPilot');

  const base = nativeImage.createFromPath(join(resource('assets'), 'tray.png'));
  const badged = due > 0 ? await badgeIcon(due, 32) : null;
  tray.setImage(badged ?? base);
  if (window && process.platform === 'win32') {
    const overlay = due > 0 ? await badgeIcon(due, 32) : null;
    window.setOverlayIcon(overlay, due > 0 ? `${due} follow-ups due` : '');
  }

  const settings = await getSettings();
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: due > 0 ? `${due} follow-up${due === 1 ? '' : 's'} due today` : 'No follow-ups due today', enabled: false },
      { type: 'separator' },
      { label: 'Open JobPilot', click: () => showWindow() },
      { label: 'Today', click: () => showWindow('/') },
      { label: 'Pipeline', click: () => showWindow('/pipeline') },
      { label: 'Refresh', click: () => void reloadLogs() },
      { type: 'separator' },
      {
        label: 'Start with Windows',
        type: 'checkbox',
        checked: settings?.startWithWindows ?? false,
        click: (item) => void saveStartWithWindows(item.checked),
      },
      { type: 'separator' },
      { label: 'Quit', click: () => quit() },
    ]),
  );
}

async function reloadLogs(): Promise<void> {
  await fetch(`${baseUrl}/api/reload`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => undefined);
  await refreshTray();
}

async function saveStartWithWindows(enabled: boolean): Promise<void> {
  await fetch(`${baseUrl}/api/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ startWithWindows: enabled }) }).catch(() => undefined);
  await applyDesktopSettings();
}

/** Applies the settings only the desktop shell can act on. */
async function applyDesktopSettings(): Promise<void> {
  const settings = await getSettings();
  if (!settings) return;
  // Only a packaged app registers itself; a dev run would register electron.exe.
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: settings.startWithWindows, args: ['--hidden'] });
  await refreshTray();
}

// ------------------------------------------------------------ notification

async function morningCheck(): Promise<void> {
  const settings = await getSettings();
  if (!settings?.morningNotification || !Notification.isSupported()) return;
  const now = new Date();
  const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const day = now.toDateString();
  // Fire once per day, at or after the chosen time (so waking the PC at 09:30 still notifies).
  if (clock < settings.morningNotification || lastNotifiedDay === day) return;
  lastNotifiedDay = day;
  const today = await getToday();
  if (!today) return;
  const due = today.followUpsDue.length;
  const needs = Math.max(0, today.needs.length + (today.batch?.needs.length ?? 0) - today.checked.length);
  if (due === 0 && needs === 0) return;
  const notification = new Notification({
    title: 'JobPilot: your morning',
    body: `${due} follow-up${due === 1 ? '' : 's'} due, ${needs} item${needs === 1 ? '' : 's'} need you`,
  });
  notification.on('click', () => showWindow('/'));
  notification.show();
}

// --------------------------------------------------------------------- ipc

/** Only the dashboard itself may use the bridge. */
function trusted(event: IpcMainInvokeEvent): boolean {
  return event.senderFrame !== null && event.senderFrame.url.startsWith(baseUrl);
}

function registerIpc(): void {
  ipcMain.handle('pick-file', async (event, title: unknown) => {
    if (!trusted(event) || !window) return null;
    const result = await dialog.showOpenDialog(window, { title: String(title), properties: ['openFile'], filters: [{ name: 'Markdown or JSON', extensions: ['md', 'json', 'txt'] }, { name: 'All files', extensions: ['*'] }] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle('pick-folder', async (event, title: unknown) => {
    if (!trusted(event) || !window) return null;
    const result = await dialog.showOpenDialog(window, { title: String(title), properties: ['openDirectory'] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle('show-in-folder', (event, path: unknown) => {
    if (trusted(event) && typeof path === 'string' && existsSync(path)) shell.showItemInFolder(path);
  });
  ipcMain.handle('apply-desktop-settings', async (event) => {
    if (trusted(event)) await applyDesktopSettings();
  });
}

// --------------------------------------------------------------- lifecycle

function quit(): void {
  quitting = true;
  app.quit();
}

async function boot(): Promise<void> {
  if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
  try {
    server = await startServer({ sampleDir: resource('sample-data'), webDir: resource('web'), version: app.getVersion() });
    baseUrl = server.url;
    server.store.on('change', () => void refreshTray());
  } catch (error) {
    if (error instanceof AlreadyRunningError) {
      // `pnpm start` is already serving on the port: show that instance instead of failing.
      baseUrl = error.url;
    } else {
      dialog.showErrorBox('JobPilot could not start', String(error));
      app.exit(1);
      return;
    }
  }

  registerIpc();
  createWindow();
  tray = new Tray(nativeImage.createFromPath(join(resource('assets'), 'tray.png')));
  tray.on('click', () => showWindow());
  window?.webContents.once('did-finish-load', () => {
    void applyDesktopSettings();
    if (smokeTest) void runSmokeTest();
  });
  setInterval(() => void morningCheck(), 60_000);
  setInterval(() => void refreshTray(), 15 * 60_000);
  setTimeout(() => void morningCheck(), 5000);
}

/** `JobPilot.exe --smoke-test`: start, load the dashboard, check the API, exit 0 or 1. Used by CI. */
async function runSmokeTest(): Promise<void> {
  const today = await getToday();
  const title = await window?.webContents.executeJavaScript('document.title').catch(() => '');
  const ok = today !== null && title === 'JobPilot';
  console.info(ok ? `smoke test ok: ${today.followUpsDue.length} follow-ups due` : 'smoke test FAILED');
  quitting = true;
  await server?.close().catch(() => undefined);
  app.exit(ok ? 0 : 1);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.on('window-all-closed', () => {
    // Stay alive in the tray.
  });
  app.on('before-quit', () => {
    quitting = true;
    void server?.close();
  });
  void app.whenReady().then(boot);
}
