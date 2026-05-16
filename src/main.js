const { app, BrowserWindow, Tray, Menu, globalShortcut, screen, nativeImage } = require('electron');
const path = require('path');

let win = null;
let tray = null;

// Hide from dock — this is a menu bar utility, not a regular app
app.dock?.hide();

function createWindow() {
    const display = screen.getPrimaryDisplay();
    const { width, height } = display.workAreaSize;
    const winWidth = 380;
    const winHeight = 540;
    const margin = 16;

    win = new BrowserWindow({
        width: winWidth,
        height: winHeight,
        x: width - winWidth - margin,
        y: height - winHeight - margin,
        frame: false,
        transparent: true,
        resizable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        show: false,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    // Float above fullscreen apps too — useful when VS Code is fullscreen
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setAlwaysOnTop(true, 'floating');

    win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

    win.on('blur', () => {
        // Keep visible but let user click through to editor when not focused
        // Comment out the next line if you want it to hide on blur instead
    });
}

function toggleWindow() {
    if (!win) createWindow();
    if (win.isVisible()) {
        win.hide();
    } else {
        win.show();
        win.focus();
    }
}

function buildTray() {
    // 16x16 transparent PNG with a simple "play" glyph encoded as base64
    // Using a template image so it adapts to light/dark menu bar automatically
    const iconBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAYUlEQVQ4jWNgGAWjYBSMgv8M' +
        '/xnQwH8GBgYGRiwK/zMyMjJgU8zEgAUwMTExYFPMyMjIQNAARkZGBoIGMDIyMhA0gJGRkYGg' +
        'AYyMjAwEDWBkZGQgaAAjIyMDQQMABwoBAW5kxJoAAAAASUVORK5CYII=',
        'base64'
    );
    const icon = nativeImage.createFromBuffer(iconBuffer);
    icon.setTemplateImage(true);

    tray = new Tray(icon);
    tray.setToolTip('Vibe Break — ⌘⇧P to toggle');

    const menu = Menu.buildFromTemplate([
        { label: 'Show / hide game', accelerator: 'Cmd+Shift+P', click: toggleWindow },
        { type: 'separator' },
        {
            label: 'About', click: () => {
                const { shell } = require('electron');
                shell.openExternal('https://github.com');
            }
        },
        { label: 'Quit', accelerator: 'Cmd+Q', click: () => app.quit() },
    ]);
    tray.setContextMenu(menu);
    tray.on('click', toggleWindow);
}

app.whenReady().then(() => {
    buildTray();
    createWindow();

    const ok = globalShortcut.register('CommandOrControl+Shift+G', toggleWindow);
    if (!ok) {
        console.error('Failed to register global hotkey ⌘⇧P — likely taken by another app.');
    }
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});

// Don't quit when window closes — this app lives in the menu bar
app.on('window-all-closed', (e) => {
    e.preventDefault?.();
});