'use strict';

const fs = require('fs');
const path = require('path');
const watt = require('gigawatts');
const Goblin = require('xcraft-core-goblin');
const {helpers} = require('xcraft-core-transport');
const {resourcesPath} = require('xcraft-core-host');
const busClient = require('xcraft-core-busclient').getGlobal();
const WM = require('xcraft-core-host/lib/wm.js').instance;
const Shredder = require('xcraft-core-shredder');
const {dialog, ipcMain, session} = require('electron');
const goblinName = path.basename(module.parent.filename, '.js');
const {WebSocketChannel, ElectronChannel} = require('goblin-laboratory');
const debounce = require('lodash/debounce');
const localshortcut = require('electron-localshortcut');
const {throttle} = require('lodash');
const wmConfig = require('xcraft-core-etc')().load('goblin-wm');

function isWithinDisplayBounds(x, y) {
  const {screen} = require('electron');

  const displays = screen.getAllDisplays();
  return displays.reduce((result, display) => {
    const area = display.workArea;
    return (
      result ||
      (x >= area.x &&
        y >= area.y &&
        x < area.x + area.width &&
        y < area.y + area.height)
    );
  }, false);
}

function computeWindowsPathWithLatestSymlink(resolvedPath) {
  return resolvedPath
    .replace(/\\S[0-9]+?\\/, '\\latest\\')
    .replace(/\/S[0-9]+?\//, '/latest/');
}

const onCommandsRegistry = (err, quest) => {
  const channel = quest.goblin.getX(`channel`);
  if (channel) {
    channel.sendAction({
      type: 'COMMANDS_REGISTRY',
      commands: quest.resp.getCommandsNames(),
    });
  }
};

const notifyForHordes = (quest) => {
  const sendNetworkStatus = quest.goblin.getX(`sendNetworkStatus`);
  if (!sendNetworkStatus) {
    return;
  }

  let hordes = [];
  try {
    const xHorde = require('xcraft-core-horde');
    hordes = xHorde.getSlaves();
    hordes.forEach((horde) =>
      sendNetworkStatus({
        horde,
        lag: false,
        delta: 0,
        overlay: false,
        noSocket: !xHorde.getSlave(horde).isConnected,
        reason: xHorde.getSlave(horde).lastErrorReason,
      })
    );
  } catch (ex) {
    /* Ignore errors */
  }
};

// Define initial logic values
const logicState = {
  feedSubscriptions: {},
};

// Define logic handlers according rc.json
const logicHandlers = {
  create: (state, action) => {
    return state.set('id', action.get('id'));
  },
};

Goblin.registerQuest(goblinName, 'create', function* (
  quest,
  desktopId,
  labId,
  feeds,
  clientSessionId,
  userId,
  url,
  urlOptions,
  options,
  cookies,
  next
) {
  quest.do();
  //Manage by feed subs
  quest.goblin.setX('feedSubs', {});
  quest.goblin.setX('userId', userId);
  quest.goblin.setX('loginState', {
    login: 'guest',
    rank: 'guest',
    isLogged: false,
  });
  const setLoginState = (state) => {
    quest.goblin.setX('loginState', state);
  };

  quest.goblin.defer(
    quest.sub(
      `*::login-session@${clientSessionId}.<login-state-changed>`,
      function (_, {msg}) {
        setLoginState(msg.data);
      }
    )
  );

  const onQuest = (evt, action) => {
    quest.evt(`<run.requested>`, action);
  };

  const onPerf = (payload) => {
    const sendNetworkStatus = quest.goblin.getX(`sendNetworkStatus`);
    const sendSyncingStatus = quest.goblin.getX(`sendSyncingStatus`);

    if (payload.overlay) {
      payload.message =
        'The client has lost the connection with the server and attempts to reconnect...';
    }

    if (sendSyncingStatus && payload.syncing) {
      sendSyncingStatus(payload);
    } else if (sendNetworkStatus) {
      sendNetworkStatus(payload);
    }
  };

  const onDataTransfer = (evt, action) => {
    const desktopId = quest.goblin.getX('desktopId');
    quest.evt(`<run.requested>`, {
      cmd: 'client.data-transfer',
      data: {id: 'client', labId, desktopId, ...action},
    });
  };

  const onSetLang = (evt, action) => {
    const desktopId = quest.goblin.getX('desktopId');
    quest.evt(`<run.requested>`, {
      cmd: 'client.try-set-locale',
      data: {id: 'client', labId, desktopId, clientSessionId, ...action},
    });
  };

  const onResend = watt(function* () {
    yield quest.me.resendState();
  });

  quest.goblin.setX('labId', labId);
  quest.goblin.setX('clientSessionId', clientSessionId);

  if (cookies) {
    yield session.defaultSession.clearStorageData();
    for (const cookie of cookies) {
      yield session.defaultSession.cookies.set(cookie);
    }
  }

  // Get default window state and bounds
  // based on current display where cursor is present
  const defaultWindowState = WM.getDefaultWindowState();

  // Get stored window state in client-session db
  let windowState = yield quest.cmd('client-session.get-window-state', {
    id: clientSessionId,
    winId: quest.goblin.id,
    defaultState: defaultWindowState,
  });

  // Reset window state if she is out of bounds
  if (
    windowState &&
    !isWithinDisplayBounds(
      windowState.get('bounds.x', 0),
      windowState.get('bounds.y', 0)
    )
  ) {
    windowState = new Shredder(defaultWindowState);
  }

  const windowOptions = {
    ...options,
    ...windowState.get('bounds').toJS(),
    maximized: windowState.get('maximized'),
    fullscreen: windowState.get('fullscreen'),
  };

  if (process.platform === 'linux' && !windowOptions.icon) {
    /* This way should be used only with Linux when app are not bundle
     * (not in AppImage or not provided with a dedicated .desktop file).
     * If it's the case, then you should put an icon.png file with a size
     * of 512x512 in the resources.linux/ directory.
     */
    const icon = path.join(resourcesPath, 'icon.png');
    if (fs.existsSync(icon)) {
      windowOptions.icon = icon;
    }
  }

  const window = WM.create(quest.goblin.id, windowOptions);
  const win = window.win;

  const wmConfig = require('xcraft-core-etc')().load('goblin-wm');
  if (wmConfig.closable === false) {
    win.closable = false;
    //win.webContents.on('before-input-event', inputHandler);
  }

  quest.goblin.setX('instance', win);

  //RUN CMD REQUEST
  const getLoginState = () => quest.goblin.getX('loginState');
  const getUserId = () => quest.goblin.getX('userId');
  quest.goblin.defer(
    quest.sub.local(`*::${quest.goblin.id}.<run.requested>`, function* (
      err,
      {msg, resp}
    ) {
      const _action = helpers.fromXcraftJSON(msg.data)[0];
      try {
        //prevent props injection
        if (_action.data._goblinUser) {
          delete _action.data._goblinUser;
        }
        //by default provide a footprint
        _action.data._goblinUser = Goblin.buildGuestFootprint(
          clientSessionId,
          win.id
        );

        const loginState = getLoginState();
        if (loginState) {
          const {login, isLogged} = loginState;
          if (isLogged) {
            _action.data._goblinUser = `${getUserId()}@${login}@${clientSessionId}@${
              win.id
            }`;
          }
        }

        yield resp.cmd(_action.cmd, _action.data);
      } catch (ex) {
        resp.log.warn(
          `Failed UI command: ${_action.cmd}, ${ex.stack || ex.message || ex}`
        );
      }
    })
  );

  //DOWNLOAD FILE REQUEST
  quest.goblin.defer(
    quest.sub(
      `*::*.<${clientSessionId}-${win.id}-download-file-requested>`,
      function* (_, {msg, resp}, next) {
        const filePath = yield resp.cmd(`wm.get-file-path`, {
          id: quest.goblin.id,
          defaultPath: msg.data.defaultPath,
          fileFilter: msg.data.fileFilter,
        });

        if (!filePath) {
          throw new Error('Not implemented: transport streamer cancellation');
          //FIXME:
          //yield msg.data.xcraftStream.dispose();
        }

        let tempFile = fs.createWriteStream(filePath);

        yield msg.data.xcraftStream.streamer(
          msg.data.routingKey,
          tempFile,
          null,
          next
        );

        tempFile.close();

        if (msg.data.openFile) {
          yield resp.cmd(`client.open-external`, {url: filePath});
        }
      }
    )
  );

  //REGISTER DESKTOP SERVICE SPECIAL TAB SHORTCUTS
  if (desktopId.startsWith('desktop@')) {
    quest.goblin.defer(
      quest.sub.local(`*::${win.id}.<close-tab-requested>`, function* (
        _,
        {resp}
      ) {
        yield resp.cmd('desktop.closeCurrentTab', {id: desktopId});
      })
    );
    quest.goblin.defer(
      quest.sub.local(`*::${win.id}.<close-all-tabs-requested>`, function* (
        _,
        {resp}
      ) {
        yield resp.cmd('desktop.closeAllCurrentTabs', {id: desktopId});
      })
    );
  }

  const onWindowStateChange = debounce(() => {
    if (win) {
      quest.evt(`${clientSessionId}.<window-state-changed>`, {
        state: WM.getWindowState(win),
      });
    }
  }, 500);

  win.on('resize', onWindowStateChange);
  win.on('move', onWindowStateChange);
  win.on('unmaximize', onWindowStateChange);
  win.on('minimize', onWindowStateChange);
  win.on('restore', onWindowStateChange);
  win.on('enter-full-screen', onWindowStateChange);
  win.on('leave-full-screen', onWindowStateChange);

  win.webContents.on('devtools-opened', () => {
    win.webContents.addWorkSpace(path.resolve(__dirname, '../../..'));
  });

  win.on('close', (evt) => {
    evt.preventDefault();

    const onCloseEvt = quest.goblin.getX('onCloseEvt');

    if (onCloseEvt) {
      quest.evt(onCloseEvt, {
        clientSessionId,
        window: win.getBounds(),
        currentUrl: win.webContents.getURL(),
      });
    } else {
      quest.evt(`${clientSessionId}.<window-closed>`, {
        clientSessionId,
        window: win.getBounds(),
        currentUrl: win.webContents.getURL(),
      });
    }
  });

  const wid = win.id;
  const unsubCmdsRegistry = quest.resp.onCommandsRegistry(
    onCommandsRegistry,
    quest
  );

  ///DUPLEX IS IN WS OR IPC
  if (!options.useWS) {
    const channel = new ElectronChannel(win);
    const sendNetworkStatus = throttle(
      (action) => channel.sendAction({type: 'CONNECTION_STATUS', ...action}),
      500
    );
    const sendSyncingStatus = throttle(
      (action) => channel.sendAction({type: 'CONNECTION_STATUS', ...action}),
      500
    );

    quest.goblin.setX(`channel`, channel);
    quest.goblin.setX('sendNetworkStatus', sendNetworkStatus);
    quest.goblin.setX('sendSyncingStatus', sendSyncingStatus);

    //IPC CLIENTS MODE
    ipcMain.on(`${wid}-QUEST`, onQuest);
    ipcMain.on(`${wid}-RESEND`, onResend);
    ipcMain.on(`${wid}-DATA_TRANSFER`, onDataTransfer);
    ipcMain.on(`${wid}-SET_LANG`, onSetLang);

    //REGISTER DISPOSING
    quest.goblin.defer(() => {
      unsubCmdsRegistry();
      ipcMain.removeListener(`${wid}-QUEST`, onQuest);
      ipcMain.removeListener(`${wid}-RESEND`, onResend);
      ipcMain.removeListener(`${wid}-DATA_TRANSFER`, onDataTransfer);
      ipcMain.removeListener(`${wid}-SET_LANG`, onSetLang);
      quest.goblin.delX('channel');
      quest.goblin.delX('sendNetworkStatus');
      quest.goblin.delX('sendSyncingStatus');
      win.destroy();
    });

    url += `?wid=${wid}&labId=${labId}`;
    yield win.loadURL(url, urlOptions);
  } else {
    //WEBSOCKET CLIENTS MODE
    const WebSocket = require('ws');
    const http = require('http');
    const httpServer = http.createServer();

    const wss = new WebSocket.Server({
      noServer: true,
      perMessageDeflate: {
        zlibDeflateOptions: {
          // See zlib defaults.
          chunkSize: 1024,
          memLevel: 7,
          level: 3,
        },
        zlibInflateOptions: {
          chunkSize: 10 * 1024,
        },
        // Below options specified as default values.
        concurrencyLimit: 10, // Limits zlib concurrency for perf.
        threshold: 1024, // Size (in bytes) below which messages
        // should not be compressed.
      },
    });

    httpServer.on('upgrade', function upgrade(request, socket, head) {
      wss.handleUpgrade(request, socket, head, function done(ws) {
        wss.emit('connection', ws, request);
      });
    });

    let port = 8000;
    const _ready = next.parallel();
    httpServer
      .listen(port, function () {
        console.log('HTTP listening:' + port);
        _ready();
      })
      .on('error', function (err) {
        if (err.code === 'EADDRINUSE') {
          port++;
          httpServer.listen(port);
        } else {
          throw err;
        }
      });

    yield next.sync();

    //REGISTER DISPOSING
    quest.goblin.defer(() => {
      unsubCmdsRegistry();
      httpServer.close();
      quest.goblin.delX('channel');
      quest.goblin.delX('sendNetworkStatus');
      quest.goblin.delX('sendSyncingStatus');
      win.destroy();
    });

    wss.on('connection', (win) => {
      const channel = new WebSocketChannel(win);
      const sendNetworkStatus = throttle(
        (action) => channel.sendAction({type: 'CONNECTION_STATUS', ...action}),
        500
      );
      const sendSyncingStatus = throttle(
        (action) => channel.sendAction({type: 'CONNECTION_STATUS', ...action}),
        500
      );

      quest.goblin.setX(`channel`, channel);
      quest.goblin.setX('sendNetworkStatus', sendNetworkStatus);
      quest.goblin.setX('sendSyncingStatus', sendSyncingStatus);

      win.on('message', function (msg) {
        msg = JSON.parse(msg);
        switch (msg.type) {
          case `QUEST`: {
            onQuest(null, msg.data);
            break;
          }
          case `DATA_TRANSFER`: {
            onDataTransfer(null, msg.data);
            break;
          }
          case `SET_LANG`: {
            onSetLang(null, msg.data);
            break;
          }
          case `RESEND`: {
            onResend(null, msg.data);
            break;
          }
        }
      });
    });
    url += `?wss=${port}&labId=${labId}`;
    yield win.loadURL(url, urlOptions);
  }
  quest.goblin.setX('url', url);
  quest.goblin.setX('urlOptions', urlOptions);
  quest.goblin.defer(
    quest.sub.local('greathall::<perf>', (err, {msg}) => onPerf(msg.data))
  );

  yield quest.me.feedSub({desktopId, feeds});
  yield quest.me.beginRender();
  return quest.goblin.id;
});

Goblin.registerQuest(goblinName, 'setUserId', function (quest, userId) {
  quest.goblin.setX('userId', userId);
});

Goblin.registerQuest(goblinName, 'visitURL', function* (
  quest,
  url,
  endOfVisitUrl,
  urlOptions,
  cookies,
  next
) {
  if (!endOfVisitUrl) {
    throw new Error('Cannot visitURL without a valid endOfVisitUrl');
  }
  if (cookies) {
    yield session.defaultSession.clearStorageData();
    for (const cookie of cookies) {
      yield session.defaultSession.cookies.set(cookie);
    }
  }

  const win = quest.goblin.getX('instance');

  const visitEnded = next.parallel();
  win.webContents.on('will-navigate', (event, url) => {
    if (url.endsWith(endOfVisitUrl)) {
      event.preventDefault();
      visitEnded();
    }
  });

  yield win.loadURL(url, urlOptions);
  yield next.sync();
  yield win.loadURL(quest.goblin.getX('url'), quest.goblin.getX('urlOptions'));
  yield quest.me.resendState();
});

Goblin.registerQuest(goblinName, 'get-titlebar', function (quest) {
  const winOptions = WM.getWindowOptions(quest.goblin.id);
  if (winOptions.frame === false) {
    return {
      titlebar: wmConfig.titlebar || 'titlebar',
      titlebarId: wmConfig.titlebarId || null,
    };
  } else {
    return null;
  }
});

Goblin.registerQuest(goblinName, 'set-titlebar', function (quest, title) {
  const win = WM.getWindowInstance(quest.goblin.id);
  if (win) {
    win.setTitle(title);
  }
});

Goblin.registerQuest(goblinName, 'begin-render', function* (quest) {
  const desktopId = quest.goblin.getX('desktopId');
  yield quest.warehouse.syncChanges({feed: desktopId});
  const channel = quest.goblin.getX(`channel`);
  const labId = quest.goblin.getX('labId');
  channel.beginRender(labId);
  onCommandsRegistry(null, quest);
  notifyForHordes(quest);
});

Goblin.registerQuest(goblinName, 'resendState', function* (quest) {
  const desktopId = quest.goblin.getX('desktopId');
  yield quest.me.beginRender();
  yield quest.warehouse.resend({feed: desktopId});
});

Goblin.registerQuest(goblinName, 'feed-sub', function* (
  quest,
  desktopId,
  feeds
) {
  // wire backend feeds
  const win = quest.goblin.getX(`instance`);
  quest.goblin.setX('desktopId', desktopId);

  //sub to warehouse global changed
  const warehouseSub = quest.goblin.getX('warehouseSub');
  if (!warehouseSub) {
    quest.goblin.setX(
      'warehouseSub',
      quest.sub(`*::warehouse.changed`, (err, {msg}) => {
        if (win) {
          quest.goblin.getX(`channel`).sendBackendInfos('warehouse', msg);
        }
      })
    );
  }

  WM.setWindowCurrentFeeds(quest.goblin.id, desktopId, feeds);

  const feedSubs = quest.goblin.getX('feedSubs');
  let skipSub = false;
  for (const feed of Object.keys(feedSubs)) {
    if (feed !== desktopId) {
      //clean previous subs
      const unsub = feedSubs[feed];
      unsub();
      delete feedSubs[feed];
    } else {
      //not a new sub
      skipSub = true;
    }
  }

  if (!skipSub) {
    feedSubs[desktopId] = quest.sub(
      `*::warehouse.<${desktopId}>.changed`,
      (err, {msg}) => {
        if (win) {
          quest.log.info(() => `${desktopId} changed`);
          quest.goblin.getX(`channel`).sendBackendState(msg);
        }
      }
    );
    yield quest.warehouse.subscribe({
      feed: desktopId,
      branches: feeds,
    });
  }
});

Goblin.registerQuest(goblinName, 'nav', function (quest, route) {
  const win = quest.goblin.getX(`instance`);
  if (win) {
    quest.goblin.getX(`channel`).sendPushPath(route);
  }
});

Goblin.registerQuest(goblinName, 'dispatch', function (quest, action) {
  const win = quest.goblin.getX(`instance`);
  if (win) {
    quest.log.info(`dispatching ${action.type}...`);
    quest.goblin.getX(`channel`).sendAction(action);
  }
});

Goblin.registerQuest(goblinName, 'move-to-front', function (quest) {
  const win = quest.goblin.getX(`instance`);
  if (!win) {
    return;
  }
  win.show();
  win.setAlwaysOnTop(true);
  win.setAlwaysOnTop(false);
});

//The native type of the handle is HWND on Windows, NSView* on macOS, and Window (unsigned long) on Linux.
Goblin.registerQuest(goblinName, 'getNativeWindowHandle', function (quest) {
  const win = quest.goblin.getX(`instance`);
  if (win) {
    const buffer = win.getNativeWindowHandle();
    const os = require('os');
    if (os.endianness() === 'LE') {
      return buffer.readInt32LE();
    } else {
      return buffer.readInt32BE();
    }
  }
});

Goblin.registerQuest(goblinName, 'flashFrame', function (quest) {
  const win = quest.goblin.getX(`instance`);
  if (win) {
    win.once('focus', () => win.flashFrame(false));
    win.flashFrame(true);
  }
});

Goblin.registerQuest(goblinName, 'attachDock', function (quest) {
  const win = quest.goblin.getX(`instance`);
  if (win) {
    const {app} = require('electron');
    if (app.dock) {
      if (win.isVisible()) {
        app.dock.show();
      } else {
        app.dock.hide();
      }

      const onHideDock = () => {
        if (!win.isMinimized()) {
          app.dock.hide();
        }
      };
      const onShowDock = () => {
        app.dock.show();
      };

      quest.goblin.setX('onHideDock', onHideDock);
      quest.goblin.setX('onShowDock', onShowDock);

      win.on('hide', onHideDock);
      win.on('show', onShowDock);
    }
  }
});

Goblin.registerQuest(goblinName, 'detachDock', function (quest) {
  const win = quest.goblin.getX(`instance`);
  if (win) {
    const onHideDock = quest.goblin.getX('onHideDock');
    const onShowDock = quest.goblin.getX('onShowDock');

    if (onHideDock && onShowDock) {
      win.removeListener('hide', onHideDock);
      win.removeListener('show', onShowDock);
    }
  }
});

Goblin.registerQuest(goblinName, 'setAppDetails', function (quest, options) {
  const win = quest.goblin.getX(`instance`);
  if (win) {
    win.setAppDetails(Shredder.isShredder(options) ? options.toJS() : options);
  }
});

Goblin.registerQuest(goblinName, 'setTray', function (
  quest,
  title,
  tooltip,
  iconPath,
  menu
  // eventsNamespace,
  // eventsToListen,
) {
  const win = quest.goblin.getX('instance');
  if (!win) {
    quest.log.err('setTray called without window instance !');
    return;
  }

  const resp = busClient.newResponse(goblinName, 'token');
  const clientSessionId = quest.goblin.getX('clientSessionId');
  title = title || wmConfig.windowOptions?.title || 'App';
  const {Tray, Menu, nativeImage} = require('electron');

  const icon = nativeImage.createFromPath(iconPath);
  const tray = new Tray(icon);
  tray.setTitle(title);
  tray.setToolTip(tooltip || title);

  if (menu) {
    const template = menu.map(({label, eventName}) => ({
      label,
      click: () => {
        resp.events.send(`${clientSessionId}.app-tray-${eventName}`);
      },
    }));
    const contextMenu = Menu.buildFromTemplate(template);
    tray.setContextMenu(contextMenu);
  }
  // TODO : Pass an array of eventToListen
  // if (eventsToListen && eventsNamespace) {
  //   for (let eventToListen of typeof eventsToListen === 'string'
  //     ? [eventsToListen]
  //     : eventsToListen) {
  //     tray.on(eventToListen, () => {
  //       quest.evt(`${eventsNamespace}-${eventToListen}`, {});
  //     });
  //   }
  // }
  tray.on('click', () => {
    quest.evt(`${clientSessionId}.app-tray-click`);
  });

  win.tray = tray;
});

Goblin.registerQuest(goblinName, 'removeTray', function (quest) {
  const win = quest.goblin.getX(`instance`);
  if (win && win.tray) {
    win.tray.destroy();
    win.tray = null;
  }
});

Goblin.registerQuest(goblinName, 'trayExists', function (quest) {
  const win = quest.goblin.getX(`instance`);
  return win && !!win.tray;
});

Goblin.registerQuest(
  goblinName,
  'tryAdaptTaskbarToMonolithEnvironment',
  function (quest, appUserModelID, appDisplayName, unpinnable) {
    const win = quest.goblin.getX(`instance`);
    if (win) {
      if (process.platform === 'win32') {
        // we assume electron apps are located inside the 'addins' folder if in monolith environment
        //if (process.execPath.includes('addins')) {
        // TODO: how to improve the check?
        const {app} = require('electron');
        app.setAppUserModelId(appUserModelID);

        const appPathWithLatestSymlink = computeWindowsPathWithLatestSymlink(
          process.execPath
        );

        if (unpinnable) {
          // making an app unpinnable is not provided by electron, but we can mitigate the risks
          // in this mode, no need for the spawn to be forwarded by the shell as the app should show an error message
          win.setAppDetails({
            appId: appUserModelID,
            appIconPath: appPathWithLatestSymlink,
            appIconIndex: 0,
            relaunchCommand: appPathWithLatestSymlink,
            relaunchDisplayName: appDisplayName,
          });
        } else {
          // in this mode, the spawn must be forwarded by the shell, because the app maybe need additional arguments
          const shellPathWithLatestSymlink = computeWindowsPathWithLatestSymlink(
            path.resolve(
              process.execPath,
              '..',
              '..',
              'shell',
              'epsitec-cresus-shell.exe'
            )
          );

          win.setAppDetails({
            appId: appUserModelID,
            appIconPath: appPathWithLatestSymlink,
            appIconIndex: 0,
            relaunchCommand: `${shellPathWithLatestSymlink} --no-splash --launch=${appUserModelID}`,
            relaunchDisplayName: appDisplayName,
          });
        }
        //}
      } else if (process.platform === 'darwin') {
        // TODO
      }
    }
  }
);

Goblin.registerQuest(goblinName, 'get-file-path', function* (
  quest,
  defaultPath,
  fileFilter,
  next
) {
  const win = quest.goblin.getX(`instance`);
  const res = yield dialog.showSaveDialog(
    win,
    {defaultPath, filters: fileFilter},
    next.arg(0)
  );
  if (res.canceled) {
    return null;
  } else {
    return res.filePath;
  }
});

Goblin.registerQuest(goblinName, 'select-file-paths', function* (
  quest,
  title,
  defaultPath,
  fileFilter,
  directory,
  multi,
  next
) {
  const win = quest.goblin.getX(`instance`);
  const properties = [];
  if (directory) {
    properties.push('openDirectory');
  } else {
    properties.push('openFile');
  }
  if (multi) {
    properties.push('multiSelections');
  }
  const res = yield dialog.showOpenDialog(
    win,
    {title, defaultPath, filters: fileFilter, properties},
    next.arg(0)
  );
  if (res.canceled) {
    return null;
  } else {
    return res.filePaths;
  }
});

Goblin.registerQuest(goblinName, 'messageBox', function (
  quest,
  title,
  type,
  message,
  buttons,
  defaultId,
  cancelId,
  next
) {
  const win = quest.goblin.getX(`instance`);
  return dialog.showMessageBoxSync(win, {
    title,
    type,
    message,
    buttons,
    defaultId,
    cancelId,
  });
});

Goblin.registerQuest(goblinName, 'capture-page', function* (
  quest,
  parameters,
  next
) {
  const win = quest.goblin.getX('instance');

  // parameters = {
  //   x:'',
  //   y:'',
  //   width:'',
  //   height:'',
  // };

  const nativeImage = yield win.webContents.capturePage(
    parameters,
    next.arg(0)
  );
  return nativeImage;
});

Goblin.registerQuest(goblinName, 'print-to-pdf', function* (
  quest,
  parameters,
  next
) {
  const win = quest.goblin.getX('instance');

  // parameters = {
  //   marginsType: 0,
  //   printBackground: false,
  //   printSelectionOnly: false,
  //   landscape: false
  // };

  const data = yield win.webContents.printToPDF(parameters, next);
  return data;
});

Goblin.registerQuest(goblinName, 'get-window', function (quest) {
  const win = quest.goblin.getX('instance');
  if (win) {
    return win.getBounds();
  }
  return null;
});

/**
 * WARNING: this function is unsafe and will be removed in a future release
 * Do not use this function if the caller is located on a different node
 */
Goblin.registerQuest(goblinName, 'unsafe-get-window-instance', function (
  quest
) {
  return quest.goblin.getX('instance');
});

Goblin.registerQuest(goblinName, 'set-on-close', function (quest, onCloseEvt) {
  quest.goblin.setX('onCloseEvt', onCloseEvt);
});

Goblin.registerQuest(goblinName, 'close-window', function (
  quest,
  clientSessionId,
  window,
  currentUrl
) {
  quest.evt(`${clientSessionId}.<window-closed>`, {
    clientSessionId,
    window,
    currentUrl,
  });
});

Goblin.registerQuest(goblinName, 'set-window', function (quest, window) {
  const win = quest.goblin.getX('instance');
  if (win) {
    win.setBounds(window);
  }
});

Goblin.registerQuest(goblinName, 'center-window', function (quest) {
  const win = quest.goblin.getX('instance');
  if (win) {
    win.center();
  }
});

Goblin.registerQuest(goblinName, 'hide-window', function (quest) {
  const win = quest.goblin.getX(`instance`);
  if (win) {
    win.hide();
  }
});

Goblin.registerQuest(goblinName, 'maximize-window', function (quest) {
  const win = quest.goblin.getX(`instance`);
  if (win) {
    win.maximize();
  }
});

Goblin.registerQuest(goblinName, 'minimize-window', function (quest) {
  const win = quest.goblin.getX(`instance`);
  if (win) {
    win.minimize();
  }
});

Goblin.registerQuest(goblinName, 'window-is-visible', function (quest) {
  const win = quest.goblin.getX(`instance`);
  if (win) {
    return win.isVisible();
  }
  return null;
});

Goblin.registerQuest(goblinName, 'add-shortcuts', function (quest, shortcuts) {
  const win = quest.goblin.getX('instance');
  // Receive an array of shortcuts
  // shortcut = {
  //  keys: 'Shift+Ctrl+I',
  //  action: string for event to emit or object with {goblinId, questName, args}
  // };
  for (let shortcut of shortcuts) {
    if (process.platform === 'darwin') {
      shortcut.keys = shortcut.keys.replace('Ctrl', 'Command');
    }
    let action;
    // If shortcut action is an event name
    if (typeof shortcut.action === 'string') {
      const busClient = require('xcraft-core-busclient').getGlobal();
      const resp = busClient.newResponse('goblin-vm', 'token');

      action = function () {
        resp.events.send(shortcut.action);
      };
    } else {
      const {goblinId, questName, args} = shortcut.action;
      const goblinAPI = quest.getAPI(goblinId);
      action = watt(function* (next) {
        yield goblinAPI[questName]({...args});
      });
    }
    localshortcut.register(win, shortcut.keys, action);
  }
});

Goblin.registerQuest(goblinName, 'remove-shortcuts', function (
  quest,
  shortcuts
) {
  const win = quest.goblin.getX('instance');
  for (let shortcut of shortcuts) {
    if (process.platform === 'darwin') {
      shortcut.keys = shortcut.keys.replace('Ctrl', 'Command');
    }
    localshortcut.unregister(win, shortcut.keys);
  }
});

Goblin.registerQuest(goblinName, 'remove-all-shortcuts', function (quest) {
  const win = quest.goblin.getX('instance');
  localshortcut.unregisterAll(win);
});

Goblin.registerQuest(goblinName, 'delete', function (quest) {
  quest.goblin.delX(`channel`);
  quest.goblin.delX('sendNetworkStatus');
  quest.goblin.delX('sendSyncingStatus');

  WM.dispose(quest.goblin.id);
  const unsub = quest.goblin.getX('warehouseSub');
  const feedSubs = quest.goblin.getX('feedSubs');
  for (const unsub of Object.values(feedSubs)) {
    if (unsub) {
      unsub();
    }
  }
  if (unsub) {
    unsub();
  }
});

// Create a Goblin with initial state and handlers
module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
