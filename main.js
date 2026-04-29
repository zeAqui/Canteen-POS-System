const { app, BrowserWindow, shell, Menu, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const http = require('http');

const PORT     = 3000;
const PASSWORD = 'abc@123';

let mainWindow    = null;
let serverProcess = null;
let isQuitting    = false;

// ── Server ─────────────────────────────────────────────────────────────────
const MAX_RESTARTS  = 10;
const RESTART_DELAY = 2000;
let restartCount = 0;

function startServer() {
  const serverPath = path.join(__dirname, 'server.js');
  serverProcess = fork(serverPath, [], {
    env: { ...process.env, PORT: String(PORT) },
    silent: false
  });
  serverProcess.on('error', (err) => console.error('Server error:', err));
  serverProcess.on('exit', (code) => {
    console.log('Server exited with code:', code);
    if (!isQuitting && restartCount < MAX_RESTARTS) {
      restartCount++;
      console.log(`Restarting server (attempt ${restartCount})...`);
      setTimeout(startServer, RESTART_DELAY);
    } else if (restartCount >= MAX_RESTARTS) {
      console.error('Server failed too many times. Giving up.');
    }
  });
  serverProcess.on('spawn', () => { restartCount = 0; });
}

function waitForServer(callback, retries) {
  if (retries === undefined) retries = 20;
  http.get('http://localhost:' + PORT, function() {
    callback();
  }).on('error', function() {
    if (retries > 0) {
      setTimeout(function() { waitForServer(callback, retries - 1); }, 500);
    } else {
      callback();
    }
  });
}

// ── Password via renderer prompt ───────────────────────────────────────────
function askPassword(action, callback) {
  if (!mainWindow) { callback(false); return; }
  mainWindow.webContents
    .executeJavaScript('window.__pwPrompt(' + JSON.stringify(action) + ')')
    .then(function(pwd) { callback(pwd === PASSWORD); })
    .catch(function()   { callback(false); });
}

// ── Shortcut registration ──────────────────────────────────────────────────
function registerBlockingShortcuts() {
  const blocked = [
    'Super', 'Meta', 'Alt+Tab', 'Alt+F4', 'Alt+Space',
    'Alt+Escape', 'Ctrl+Escape', 'Ctrl+Alt+Tab', 'Win', 'F11',
  ];
  blocked.forEach(function(sc) {
    try { globalShortcut.register(sc, function() { /* swallow */ }); } catch(e) {}
  });
}

function unregisterBlockingShortcuts() {
  globalShortcut.unregisterAll();
}

// ── Window ─────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width:     1024,
    height:    768,
    minWidth:  700,
    minHeight: 500,
    title: 'Canteen POS System — Ivoclar',
    icon: path.join(__dirname, 'assets/icon.ico'),
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true
    },
    autoHideMenuBar: true,
    show: false
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadURL('http://localhost:' + PORT);

  mainWindow.once('ready-to-show', function() {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.setFullScreen(true);
    registerBlockingShortcuts();
  });

  mainWindow.webContents.setWindowOpenHandler(function(details) {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // ── UI Crash / Resilience handlers ────────────────────────────────────
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('Renderer crashed:', details.reason);
    if (!isQuitting) {
      setTimeout(() => {
        if (mainWindow) {
          mainWindow.loadURL('http://localhost:' + PORT);
        } else {
          createWindow();
        }
      }, 1000);
    }
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Page failed to load:', errorDescription);
    if (!isQuitting) {
      setTimeout(() => mainWindow && mainWindow.loadURL('http://localhost:' + PORT), 2000);
    }
  });

  mainWindow.webContents.on('unresponsive', () => {
    console.warn('Window unresponsive — reloading...');
    if (!isQuitting) mainWindow.reload();
  });

  // ── IPC: Exit button from renderer ────────────────────────────────────
  ipcMain.on('request-exit', function() {
    if (isQuitting) return;
    askPassword('exit the application', function(ok) {
      if (ok) {
        isQuitting = true;
        unregisterBlockingShortcuts();
        if (serverProcess) { serverProcess.kill(); serverProcess = null; }
        app.quit();
      } else {
        if (mainWindow) mainWindow.setFullScreen(true);
      }
    });
  });

  // ── Close button (title bar X) ────────────────────────────────────────
  mainWindow.on('close', function(e) {
    if (isQuitting) return;
    e.preventDefault();
    askPassword('close the application', function(ok) {
      if (ok) {
        isQuitting = true;
        unregisterBlockingShortcuts();
        if (serverProcess) { serverProcess.kill(); serverProcess = null; }
        app.quit();
      } else {
        if (mainWindow) mainWindow.setFullScreen(true);
      }
    });
  });

  // ── Leaving fullscreen ────────────────────────────────────────────────
  mainWindow.on('leave-full-screen', function() {
    if (isQuitting) return;
    askPassword('exit fullscreen', function(ok) {
      if (!ok && mainWindow) mainWindow.setFullScreen(true);
    });
  });

  // ── Minimize ──────────────────────────────────────────────────────────
  mainWindow.on('minimize', function(e) {
    if (isQuitting) return;
    if (mainWindow) mainWindow.setFullScreen(true);
    askPassword('minimize the application', function(ok) {
      if (ok && mainWindow) {
        mainWindow.setFullScreen(false);
        mainWindow.minimize();
      }
    });
  });

  // ── Resize attempt while not fullscreen ───────────────────────────────
  mainWindow.on('will-resize', function(e) {
    if (!isQuitting && !mainWindow.isFullScreen()) {
      e.preventDefault();
    }
  });

  mainWindow.on('focus', function() {
    if (!isQuitting) registerBlockingShortcuts();
  });

  mainWindow.on('closed', function() {
    mainWindow = null;
    ipcMain.removeAllListeners('request-exit');
  });
}

app.whenReady().then(function() {
  // ── Auto-start on Windows boot ─────────────────────────────────────────
  app.setLoginItemSettings({
    openAtLogin: true,
    name: 'Canteen POS System'
  });

  startServer();
  waitForServer(function() { createWindow(); });
});

app.on('window-all-closed', function() {
  unregisterBlockingShortcuts();
  if (serverProcess) { serverProcess.kill(); serverProcess = null; }
  app.quit();
});

app.on('activate', function() {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', function() {
  unregisterBlockingShortcuts();
  if (serverProcess) { serverProcess.kill(); serverProcess = null; }
});

app.on('will-quit', function() {
  unregisterBlockingShortcuts();
});
