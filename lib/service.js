'use strict';

const path = require('path');
const watt = require('gigawatts');
const Goblin = require('xcraft-core-goblin');
const {helpers} = require('xcraft-core-transport');
const {BrowserWindow, ipcMain} = require('electron');
const goblinName = path.basename(module.parent.filename, '.js');
const {WebSocketChannel, ElectronChannel} = require('goblin-laboratory');

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
  function*(quest, labId, url, options, next) {
    quest.do();

    quest.goblin.defer(
      quest.sub(`*::*.run.requested`, function*(err, {msg}) {
        const _action = helpers.fromXcraftJSON(msg.data)[0];
        try {
          yield quest.cmd(_action.cmd, _action.data);

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
      quest.evt(`run.requested`, {
        cmd: 'client.data-transfer',
        data: {id: 'client', labId, ...action},
      });
    };

    const onResend = watt(function*() {
      yield quest.warehouse.resend({feed: quest.goblin.getX('desktopId')});
      onCommandsRegistry();
      const channel = quest.goblin.getX(`channel`);
      channel.beginRender(labId);
    });

    const unsubCmdsRegistry = quest.resp.onCommandsRegistry(onCommandsRegistry);
    ipcMain.on('QUEST', onQuest);
    ipcMain.on('RESEND', onResend);
    ipcMain.on('DATA_TRANSFER', onDataTransfer);

    quest.goblin.defer(() => {
      unsubCmdsRegistry();
      ipcMain.removeListener('QUEST', onQuest);
      ipcMain.removeListener('RESEND', onResend);
      ipcMain.removeListener('DATA_TRANSFER', onDataTransfer);
    });

    quest.goblin.setX('labId', labId);

    const getBrowserWindowOptions = () => {
      const wmConfig = require('xcraft-core-etc')().load('goblin-wm');
      const winOptions = wmConfig.windowOptions || {};
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
      const win = new BrowserWindow(winOptions);

      win.webContents.on('devtools-opened', () => {
        win.webContents.addWorkSpace(path.resolve(__dirname, '../../..'));
      });

      if (process.env.NODE_ENV === 'production') {
        win.setMenuBarVisibility(false);
        win.setAutoHideMenuBar(true);
        const {Menu, app, shell} = require('electron');
        const defaultMenu = require('electron-default-menu');
        const menu = defaultMenu(app, shell)
          .filter(menu => menu.role !== 'help')
          .map(menu => {
            menu.submenu = menu.submenu.filter(
              submenu =>
                !['CmdOrCtrl+R', 'Ctrl+Shift+I', 'Alt+Command+I'].includes(
                  submenu.accelerator
                )
            );
            return menu;
          });
        app.setApplicationMenu(Menu.buildFromTemplate(menu));
      }

      quest.goblin.setX('instances', win);
      quest.goblin.setX(`channel`, new ElectronChannel(win));

      if (options.openDevTools) {
        win.webContents.openDevTools();
      }

      const nextLoad = next.parallel();
      const unsubLoad = quest.sub(`${quest.goblin.id}.loaded`, (...args) => {
        unsubLoad();
        return nextLoad(...args);
      });

      win.on('close', evt => {
        evt.preventDefault();
        quest.evt(`${labId}.window-closed`);
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
        const electronWin = new BrowserWindow(winOptions);

        electronWin.webContents.on('devtools-opened', () => {
          electronWin.webContents.addWorkSpace(
            path.resolve(__dirname, '../../..')
          );
        });

        if (options.openDevTools) {
          electronWin.webContents.openDevTools();
        }

        electronWin.loadURL(url);
      }

      let firstPass = true;
      const _next = next.parallel();

      wss.on('connection', win => {
        quest.goblin.setX('instances', win);
        quest.goblin.setX(`channel`, new WebSocketChannel(win));

        win.on('message', function(data) {
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
          }
        });

        win.on('close', function() {
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

Goblin.registerQuest(goblinName, 'begin-render', function*(quest) {
  const desktopId = quest.goblin.getX('desktopId');
  yield quest.warehouse.syncChanges({feed: desktopId});
  const channel = quest.goblin.getX(`channel`);
  const labId = quest.goblin.getX('labId');
  channel.beginRender(labId);
});

Goblin.registerQuest(
  goblinName,
  'feed-sub',
  function*(quest, wid, feeds) {
    // wire backend feeds
    const win = quest.goblin.getX(`instances`);
    const winFeed = wid;
    quest.goblin.setX('desktopId', wid);
    quest.goblin.defer(
      quest.sub(`*::warehouse.${winFeed}.changed`, (err, {msg}) => {
        if (win) {
          quest.log.info(`${winFeed} changed`);
          quest.goblin.getX(`channel`).sendBackendState(msg);
        }
      })
    );

    //sub to warehouse global changed, for
    quest.goblin.defer(
      quest.sub(`*::warehouse.changed`, (err, {msg}) => {
        if (win) {
          quest.goblin.getX(`channel`).sendBackendInfos('warehouse', msg);
        }
      })
    );

    yield quest.cmd('warehouse.subscribe', {
      feed: winFeed,
      branches: feeds,
    });
  },
  ['*::warehouse.*.changed', '*::warehouse.changed']
);

Goblin.registerQuest(goblinName, 'nav', function(quest, route) {
  const win = quest.goblin.getX(`instances`);
  if (win) {
    quest.log.info(`navigating to ${route}...`);
    quest.goblin.getX(`channel`).sendPushPath(route);
  }
});

Goblin.registerQuest(goblinName, 'dispatch', function(quest, action) {
  const win = quest.goblin.getX(`instances`);
  if (win) {
    quest.log.info(`dispatching ${action.type}...`);
    quest.goblin.getX(`channel`).sendAction(action);
  }
});

Goblin.registerQuest(goblinName, 'move-to-front', function(quest) {
  const win = quest.goblin.getX(`instances`);
  if (win) {
    win.show();
    win.setAlwaysOnTop(true);
    win.setAlwaysOnTop(false);
  }
});

Goblin.registerQuest(goblinName, 'delete', function(quest) {
  const win = quest.goblin.getX(`instances`);
  if (win) {
    win.destroy();
  }
  quest.evt('win.closed');
});

// Create a Goblin with initial state and handlers
module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
