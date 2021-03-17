'use strict';

const WM_INSTANCE_KEY = Symbol.for('goblin-wm.window-manager');

class Window {
  constructor(wm, options) {
    const {BrowserWindow, screen} = require('electron');
    //copy config
    this.wm = wm;
    this.winOptions = {...this.wm.config.windowOptions};

    //Override with options
    Object.entries(options).forEach(([option, value]) => {
      if (value !== undefined) {
        this.winOptions[option] = value;
      }
    });

    this.winOptions.webPreferences = {
      nodeIntegration: true,
    };

    if (!this.winOptions.width && !this.winOptions.height) {
      const point = screen.getCursorScreenPoint();
      const {workArea} = screen.getDisplayNearestPoint(point);

      // Use 80% of work area
      const factor = 0.8;
      let width = workArea.width * factor;
      let height = workArea.height * factor;
      // If the window is smaller than 1280x720, use 100% of work area
      if (width < 1280 || height < 720) {
        width = workArea.width;
        height = workArea.height;
      }
      this.winOptions.width = parseInt(width);
      this.winOptions.height = parseInt(height);
      this.winOptions.x = parseInt(
        workArea.x + workArea.width / 2 - this.winOptions.width / 2
      );
      this.winOptions.y = parseInt(
        workArea.y + workArea.height / 2 - this.winOptions.height / 2
      );
    }

    //VIBRANCY SUPPORT
    let vibrancy;
    try {
      vibrancy = require('windows-swca');
    } catch (ex) {
      if (ex.code !== 'MODULE_NOT_FOUND') {
        throw ex;
      } else if (this.wm.config.vibrancyOptions) {
        console.warn(
          'WM: electron-vibrancy not available and vibrancyOptions is set'
        );
      }
    }

    if (vibrancy && this.wm.config.vibrancyOptions !== null) {
      this.winOptions.backgroundColor = '#00000000';
    }

    if (options.modal && options.parentId) {
      this.winOptions.parent = wm[options.parentId];
      this.winOptions.modal = true;
    }

    //avoid display blank page
    this.winOptions.show = false;

    this.win = new BrowserWindow(this.winOptions);

    this.win.setMenuBarVisibility(false);
    this.win.autoHideMenuBar = true;

    this.win.once('ready-to-show', () => {
      this.win.show();
    });

    //ENABLE VIBRANCY
    if (vibrancy && this.wm.config.vibrancyOptions !== null) {
      this.win.setMenuBarVisibility(false);
      vibrancy.SetWindowCompositionAttribute(
        this.win.getNativeWindowHandle(),
        vibrancy.ACCENT_STATE.ACCENT_ENABLE_BLURBEHIND,
        0x01000000
      );
    }

    if (options.openDevTools) {
      this.win.webContents.on('did-frame-finish-load', () => {
        this.win.webContents.openDevTools();
      });
    }
  }

  setState(windowState) {
    if (windowState) {
      //TODO: invalidate bad bounds
      this.win.setPosition(
        windowState.get('bounds.x'),
        windowState.get('bounds.y'),
        true
      );
      this.win.setSize(
        windowState.get('bounds.width'),
        windowState.get('bounds.height'),
        true
      );
    }
  }

  dispose() {
    this.win.close();
    if (!this.win.isDestroyed()) {
      this.win.destroy();
    }
  }
}

class WindowManager {
  constructor() {
    console.log('WM init...');
    const {Menu, app, shell} = require('electron');
    this.app = app;
    const wmConfig = require('xcraft-core-etc')().load('goblin-wm');
    const busClient = require('xcraft-core-busclient').getGlobal();
    this._resp = busClient.newResponse('goblin-vm', 'token');
    this.config = wmConfig;
    this._services = {};
    this._windows = {};

    const defaultMenu = require('electron-default-menu');
    const menu = defaultMenu(app, shell)
      .filter((menu) => menu.role !== 'help')
      .map((menu) => {
        if (menu.label === 'Window') {
          delete menu.submenu[1].role;
          menu.submenu[1].label = 'Close tab';
          menu.submenu[1].click = function (menuItem, window) {
            const busClient = require('xcraft-core-busclient').getGlobal();
            const resp = busClient.newResponse('goblin-vm', 'token');
            resp.events.send(`${window.id}.<close-tab-requested>`);
          };
          menu.submenu.push({
            label: 'Close all tabs',
            accelerator: 'CmdOrCtrl+Shift+W',
            click: function (menuItem, window) {
              const busClient = require('xcraft-core-busclient').getGlobal();
              const resp = busClient.newResponse('goblin-vm', 'token');
              resp.events.send(`${window.id}.<close-all-tabs-requested>`);
            },
          });
        }

        if (process.env.NODE_ENV !== 'development') {
          menu.submenu = menu.submenu.filter(
            (submenu) =>
              !['CmdOrCtrl+R', 'Ctrl+Shift+I', 'Alt+Command+I'].includes(
                submenu.accelerator
              )
          );
        }

        return menu;
      });
    app.applicationMenu = Menu.buildFromTemplate(menu);

    this.displaySplash();
  }

  displaySplash() {
    //SPLASH THE MAIN WINDOW
    //TODO: configurable spash
    const window = this.create(
      'splash',
      {
        width: 400,
        height: 200,
        center: true,
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        show: true,
        autoHideMenuBar: true,
        title: this.app.getName(),
        frame: false,
        backgroundColor: '#1e3d5b',
        alwaysOnTop: true,
      },
      null
    );
    const path = require('path');
    window.win.loadFile(path.join(__dirname, './splash.html'));

    const locale = this.app.getLocale();
    window.win.webContents.on('did-finish-load', () => {
      window.win.webContents.send('progress', {step: 'waiting', locale});
      this._resp.events.subscribe(`*::client.progressed`, (msg) => {
        window.win.webContents.send('progress', {step: msg.data, locale});
      });
    });
  }

  create(windowId, options) {
    const {BrowserWindow} = require('electron');
    //DEVELOPPER STUFF
    const allBrowserWindow = BrowserWindow.getAllWindows();
    // Close devtools in other windows
    // prevent the fact that devtools work in only one window at a time...
    allBrowserWindow.forEach((window) => {
      window.webContents.closeDevTools();
    });
    const window = new Window(this, options);
    this._services[windowId] = window;

    //dispose splash when the next created window appear
    if (windowId !== 'splash' && this._services.splash) {
      window.win.webContents.once('did-finish-load', () => {
        setTimeout(() => this.dispose('splash'), this.config.splashDelay);
      });
    }
    return window;
  }

  getWindowInstance(windowId) {
    return this._services[windowId].win;
  }

  getWindowOptions(windowId) {
    return this._services[windowId].winOptions;
  }

  dispose(windowId) {
    const window = this._services[windowId];
    window.dispose();
    delete this._services[windowId];
  }
}

const globalSymbols = Object.getOwnPropertySymbols(global);
const hasInstance = globalSymbols.indexOf(WM_INSTANCE_KEY) > -1;
if (!hasInstance) {
  global[WM_INSTANCE_KEY] = new WindowManager();
}

const singleton = {};

Object.defineProperty(singleton, 'instance', {
  get: function () {
    return global[WM_INSTANCE_KEY];
  },
});

Object.freeze(singleton);
module.exports = singleton;
