'use strict';
const fs = require('fs');
const path = require('path');
const watt = require('gigawatts');
const Goblin = require('xcraft-core-goblin');
const {helpers} = require('xcraft-core-transport');
const busClient = require('xcraft-core-busclient').getGlobal();
const resp = busClient.newResponse('goblin-vm', 'token');
const {dialog, BrowserWindow, ipcMain} = require('electron');
const goblinName = path.basename(module.parent.filename, '.js');
const {WebSocketChannel, ElectronChannel} = require('goblin-laboratory');
const {getWindowState, getDefaultWindowState} = require('./helpers.js');
const debounce = require('lodash/debounce');
const localshortcut = require('electron-localshortcut');

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

Goblin.registerQuest(
  goblinName,
  'create',
  function* (quest, labId, clientSessionId, url, options, next) {
    quest.do();
    //Manage by feed subs
    quest.goblin.setX('feedSubs', {});

    quest.goblin.defer(
      quest.sub(`*::*.${quest.goblin.id}.download-file-requested`, function* (
        _,
        {msg, resp},
        next
      ) {
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
          msg.data.appId,
          tempFile,
          null,
          next
        );
        if (msg.data.openFile) {
          yield resp.cmd(`client.open-external`, {url: filePath});
        }
      })
    );

    quest.goblin.defer(
      quest.sub(`*::${quest.goblin.id}.run.requested`, function* (
        err,
        {msg, resp}
      ) {
        const _action = helpers.fromXcraftJSON(msg.data)[0];
        try {
          yield resp.cmd(_action.cmd, _action.data);

          if (options.enableTestAutomationLogguer) {
            //Experimental:
            //Provide some copy/pastable log line for creating tests files
            //Actually we manipulate data for being context aware with some parameters,
            //labId desktopId...
            //But, in most case, you must use return values for injecting correct ids
            //in next calls.
            const testData = Object.keys(_action.data).reduce(
              (testData, key) => {
                if (key === 'id') {
                  testData[key] = `${_action.data[key].replace(
                    /desktop@.*/,
                    '${desktopId}'
                  )}`;
                  return testData;
                }
                if (key === 'labId') {
                  testData[key] = '`${labId}`';
                  return testData;
                }
                testData[key] = _action.data[key];
                return testData;
              },
              {}
            );

            console.log(
              `yield quest.cmd ('${_action.cmd}',${JSON.stringify(testData)})`
            );
          }
        } catch (ex) {
          quest.log.warn(
            `Failed UI command: ${_action.cmd}, ${ex.stack || ex.message || ex}`
          );
        }
      })
    );

    const onQuest = (evt, action) => {
      quest.evt(`run.requested`, action);
    };

    const onCommandsRegistry = () => {
      const channel = quest.goblin.getX(`channel`);
      if (channel) {
        channel.sendAction({
          type: 'COMMANDS_REGISTRY',
          commands: quest.resp.getCommandsNames(),
        });
      }
    };

    const onDataTransfer = (evt, action) => {
      const desktopId = quest.goblin.getX('desktopId');
      quest.evt(`run.requested`, {
        cmd: 'client.data-transfer',
        data: {id: 'client', labId, desktopId, ...action},
      });
    };

    const onSetLang = (evt, action) => {
      const desktopId = quest.goblin.getX('desktopId');
      quest.evt(`run.requested`, {
        cmd: 'client.try-set-locale',
        data: {id: 'client', labId, desktopId, ...action},
      });
    };

    const onResend = watt(function* () {
      yield quest.warehouse.resend({feed: quest.goblin.getX('desktopId')});
      onCommandsRegistry();
      const channel = quest.goblin.getX(`channel`);
      channel.beginRender(labId);
    });

    quest.goblin.setX('labId', labId);

    const getBrowserWindowOptions = () => {
      const wmConfig = require('xcraft-core-etc')().load('goblin-wm');
      const winOptions = wmConfig.windowOptions || {};

      winOptions.webPreferences = {
        // contextIsolation: false,
        nodeIntegration: true,
        // webviewTag: 'nodeIntegration', // 'nodeIntegration' si mis sinon true
      };

      if (!winOptions.width && !winOptions.height) {
        const {screen} = require('electron');
        const point = screen.getCursorScreenPoint();
        const {workArea} = screen.getDisplayNearestPoint(point);
        quest.log.info(`Work area: ${workArea.width}x${workArea.height}`);
        // Use 80% of work area
        const factor = 0.8;
        let width = workArea.width * factor;
        let height = workArea.height * factor;
        // If the window is smaller than 1280x720, use 100% of work area
        if (width < 1280 || height < 720) {
          width = workArea.width;
          height = workArea.height;
        }
        winOptions.width = parseInt(width);
        winOptions.height = parseInt(height);
        winOptions.x = parseInt(
          workArea.x + workArea.width / 2 - winOptions.width / 2
        );
        winOptions.y = parseInt(
          workArea.y + workArea.height / 2 - winOptions.height / 2
        );
      }
      quest.log.info(
        `Browser window: ${winOptions.width}x${winOptions.height}`
      );
      return winOptions;
    };

    if (!options.useWS) {
      const winOptions = getBrowserWindowOptions();
      const allBrowserWindow = BrowserWindow.getAllWindows();
      // Close devtools in other windows
      // prevent the fact that devtools work in only one window at a time...
      allBrowserWindow.forEach((window) => {
        window.webContents.closeDevTools();
      });

      if (!winOptions.title) {
        winOptions.title = options.title;
      }

      //restore window state
      const windowState = yield quest.cmd('client-session.get-window-state', {
        id: clientSessionId,
        winId: quest.goblin.id,
        defaultState: getDefaultWindowState(winOptions),
      });
      if (windowState) {
        //TODO: invalidate bad bounds
        winOptions.x = windowState.get('bounds.x');
        winOptions.y = windowState.get('bounds.y');
        winOptions.width = windowState.get('bounds.width');
        winOptions.height = windowState.get('bounds.height');
      }

      const win = new BrowserWindow(winOptions);
      const onWindowStateChange = debounce(() => {
        quest.evt(`${clientSessionId}.window-state-changed`, {
          state: getWindowState(win),
        });
      }, 500);

      win.on('resize', onWindowStateChange);
      win.on('move', onWindowStateChange);
      win.on('unmaximize', onWindowStateChange);
      win.on('minimize', onWindowStateChange);
      win.on('restore', onWindowStateChange);
      win.on('enter-full-screen', onWindowStateChange);
      win.on('leave-full-screen', onWindowStateChange);

      const wid = win.id;
      const unsubCmdsRegistry = quest.resp.onCommandsRegistry(
        onCommandsRegistry
      );
      ipcMain.on(`${wid}-QUEST`, onQuest);
      ipcMain.on(`${wid}-RESEND`, onResend);
      ipcMain.on(`${wid}-DATA_TRANSFER`, onDataTransfer);
      ipcMain.on(`${wid}-SET_LANG`, onSetLang);
      quest.goblin.defer(() => {
        unsubCmdsRegistry();
        ipcMain.removeListener(`${wid}-QUEST`, onQuest);
        ipcMain.removeListener(`${wid}-RESEND`, onResend);
        ipcMain.removeListener(`${wid}-DATA_TRANSFER`, onDataTransfer);
        ipcMain.removeListener(`${wid}-SET_LANG`, onSetLang);
      });
      win.webContents.on('devtools-opened', () => {
        win.webContents.addWorkSpace(path.resolve(__dirname, '../../..'));
      });

      if (process.env.NODE_ENV === 'production') {
        win.setMenuBarVisibility(false);
        win.autoHideMenuBar = true;
        const {Menu, app, shell} = require('electron');
        const defaultMenu = require('electron-default-menu');
        const menu = defaultMenu(app, shell)
          .filter((menu) => menu.role !== 'help')
          .map((menu) => {
            menu.submenu = menu.submenu.filter(
              (submenu) =>
                !['CmdOrCtrl+R', 'Ctrl+Shift+I', 'Alt+Command+I'].includes(
                  submenu.accelerator
                )
            );
            return menu;
          });
        app.applicationMenu = Menu.buildFromTemplate(menu);
      }

      quest.goblin.setX('instances', win);
      quest.goblin.setX(`channel`, new ElectronChannel(win));

      if (options.openDevTools) {
        win.webContents.on('did-frame-finish-load', () => {
          win.webContents.openDevTools();
        });
      }

      const nextLoad = next.parallel();
      const unsubLoad = quest.sub(`${quest.goblin.id}.loaded`, (...args) => {
        unsubLoad();
        return nextLoad(...args);
      });

      win.on('close', (evt) => {
        evt.preventDefault();
        quest.evt(`${clientSessionId}.window-closed`, {
          window: evt.sender.getBounds(),
        });
      });

      //wire finish load
      win.webContents.once('did-finish-load', () => {
        quest.evt(`loaded`);
      });

      win.loadURL(url);
    } else {
      //WEBSOCKET CLIENTS MODE
      const WebSocket = require('ws');
      const wss = new WebSocket.Server({port: 8000});

      if (options.target === 'electron-renderer') {
        const winOptions = getBrowserWindowOptions();
        const allBrowserWindow = BrowserWindow.getAllWindows();
        // Close devtools in other windows
        // prevent the fact that devtools work in only one window at a time...
        allBrowserWindow.forEach((window) => {
          window.webContents.closeDevTools();
        });
        if (!winOptions.title) {
          winOptions.title = options.title;
        }
        const electronWin = new BrowserWindow(winOptions);

        electronWin.webContents.on('devtools-opened', () => {
          electronWin.webContents.addWorkSpace(
            path.resolve(__dirname, '../../..')
          );
        });

        if (options.openDevTools) {
          electronWin.webContents.on('did-frame-finish-load', () => {
            electronWin.webContents.openDevTools();
          });
        }

        electronWin.loadURL(url);
      }

      let firstPass = true;
      const _next = next.parallel();

      wss.on('connection', (win) => {
        quest.goblin.setX('instances', win);
        quest.goblin.setX(`channel`, new WebSocketChannel(win));

        win.on('message', function (data) {
          data = JSON.parse(data);
          switch (data.type) {
            case 'QUEST': {
              onQuest(null, data.data);
              break;
            }
            case 'DATA_TRANSFER': {
              onDataTransfer(null, data.data);
              break;
            }
            case 'SET_LANG': {
              onSetLang(null, data.data);
              break;
            }
          }
        });

        win.on('close', function () {
          //quest.cmd ('wm.win.delete', {id});
          //quest.cmd ('laboratory.delete', {id: labId});
        });

        quest.evt(`loaded`);

        if (firstPass) {
          firstPass = false;
          _next();
        } else {
          onResend();
        }
      });
    }

    yield next.sync();

    onCommandsRegistry();

    return quest.goblin.id;
  },
  ['*::*.run.requested']
);

Goblin.registerQuest(goblinName, 'begin-render', function* (quest) {
  const desktopId = quest.goblin.getX('desktopId');
  yield quest.warehouse.syncChanges({feed: desktopId});
  const channel = quest.goblin.getX(`channel`);
  const labId = quest.goblin.getX('labId');
  channel.beginRender(labId);
});

Goblin.registerQuest(
  goblinName,
  'feed-sub',
  function* (quest, wid, feeds) {
    // wire backend feeds
    const win = quest.goblin.getX(`instances`);
    const winFeed = wid;
    quest.goblin.setX('desktopId', wid);

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

    const feedSubs = quest.goblin.getX('feedSubs');
    let skipSub = false;
    for (const feed of Object.keys(feedSubs)) {
      if (feed !== wid) {
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
      feedSubs[wid] = quest.sub(
        `*::warehouse.${winFeed}.changed`,
        (err, {msg}) => {
          if (win) {
            quest.log.info(`${winFeed} changed`);
            quest.goblin.getX(`channel`).sendBackendState(msg);
          }
        }
      );
      yield quest.warehouse.subscribe({
        feed: winFeed,
        branches: feeds,
      });
    }
  },
  ['*::warehouse.*.changed', '*::warehouse.changed']
);

Goblin.registerQuest(goblinName, 'nav', function (quest, route) {
  const win = quest.goblin.getX(`instances`);
  if (win) {
    quest.log.info(`navigating to ${route}...`);
    quest.goblin.getX(`channel`).sendPushPath(route);
  }
});

Goblin.registerQuest(goblinName, 'dispatch', function (quest, action) {
  const win = quest.goblin.getX(`instances`);
  if (win) {
    quest.log.info(`dispatching ${action.type}...`);
    quest.goblin.getX(`channel`).sendAction(action);
  }
});

Goblin.registerQuest(goblinName, 'move-to-front', function (quest) {
  const win = quest.goblin.getX(`instances`);
  if (win) {
    win.show();
    win.setAlwaysOnTop(true);
    win.setAlwaysOnTop(false);
  }
});

Goblin.registerQuest(goblinName, 'get-file-path', function* (
  quest,
  defaultPath,
  fileFilter,
  next
) {
  const win = quest.goblin.getX(`instances`);
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
  next
) {
  const win = quest.goblin.getX(`instances`);
  const res = yield dialog.showOpenDialog(
    win,
    {title, defaultPath, filters: fileFilter},
    next.arg(0)
  );
  if (res.canceled) {
    return null;
  } else {
    return res.filePaths;
  }
});

Goblin.registerQuest(goblinName, 'delete', function (quest) {
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
  const win = quest.goblin.getX(`instances`);
  if (win) {
    win.destroy();
  }
  quest.evt('win.closed');
});

Goblin.registerQuest(goblinName, 'capture-page', function* (
  quest,
  parameters,
  next
) {
  const win = quest.goblin.getX('instances');

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
  const win = quest.goblin.getX('instances');

  // parameters = {
  //   marginsType: 0,
  //   printBackground: false,
  //   printSelectionOnly: false,
  //   landscape: false
  // };

  const data = yield win.webContents.printToPDF(parameters, next);
  return data;
});

Goblin.registerQuest(goblinName, 'set-window', function (quest, window) {
  const win = quest.goblin.getX('instances');
  win.setBounds(window);
});

Goblin.registerQuest(goblinName, 'add-shortcuts', function (quest, shortcuts) {
  const win = quest.goblin.getX('instances');
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
      action = function () {
        resp.events.send(shortcut.action);
      };
    } else {
      const {goblinId, questName, args} = shortcut.action;
      const goblinAPI = quest.getAPI(goblinId);
      action = watt(function* (next) {
        yield goblinAPI[questName]({...args}, next);
      });
    }
    localshortcut.register(win, shortcut.keys, action);
  }
});

Goblin.registerQuest(goblinName, 'remove-shortcuts', function (
  quest,
  shortcuts
) {
  const win = quest.goblin.getX('instances');
  for (let shortcut of shortcuts) {
    if (process.platform === 'darwin') {
      shortcut.keys = shortcut.keys.replace('Ctrl', 'Command');
    }
    localshortcut.unregister(win, shortcut.keys);
  }
});

Goblin.registerQuest(goblinName, 'remove-all-shortcuts', function (quest) {
  const win = quest.goblin.getX('instances');
  localshortcut.unregisterAll(win);
});

// Create a Goblin with initial state and handlers
module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
