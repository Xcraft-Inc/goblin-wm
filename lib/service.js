'use strict';

const path = require('path');
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

Goblin.registerQuest(goblinName, 'create', function*(
  quest,
  labId,
  url,
  options,
  next
) {
  quest.do();

  const onQuest = (evt, action) => {
    const _action = helpers.fromXcraftJSON(action)[0];
    quest.cmd(_action.cmd, _action.data);

    if (options.enableTestAutomationLogguer) {
      //Experimental:
      //Provide some copy/pastable log line for creating tests files
      //Actually we manipulate data for being context aware with some parameters,
      //labId desktopId...
      //But, in most case, you must use return values for injecting correct ids
      //in next calls.
      const testData = Object.keys(_action.data).reduce((testData, key) => {
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
      }, {});

      console.log(
        `yield quest.cmd ('${_action.cmd}',${JSON.stringify(testData)})`
      );
    }
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

  const onResend = () => {
    quest.cmd('warehouse.resend', {feed: quest.goblin.id});
    onCommandsRegistry();
  };

  const unsubCmdsRegistry = quest.resp.onCommandsRegistry(onCommandsRegistry);
  ipcMain.on('QUEST', onQuest);
  ipcMain.on('RESEND', onResend);

  quest.goblin.defer(() => {
    unsubCmdsRegistry();
    ipcMain.removeListener('QUEST', onQuest);
    ipcMain.removeListener('RESEND', onResend);
  });

  if (!options.useWS) {
    const win = new BrowserWindow({width: 1280, height: 720});

    win.webContents.on('devtools-opened', () => {
      win.webContents.addWorkSpace(path.resolve(__dirname, '../../..'));
    });

    if (process.platform === 'darwin') {
      const {Menu, app, shell} = require('electron');
      const defaultMenu = require('electron-default-menu');
      const menu = defaultMenu(app, shell);
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
      quest.release(labId);
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
      const electronWin = new BrowserWindow();

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
});

Goblin.registerQuest(goblinName, 'feed-sub', function*(quest, wid, feeds) {
  // wire backend feeds
  const win = quest.goblin.getX(`instances`);
  const winFeed = wid;
  quest.goblin.defer(
    quest.sub(`*::warehouse.${winFeed}.changed`, (err, msg) => {
      if (win) {
        quest.log.info(`${winFeed} changed`);
        quest.goblin.getX(`channel`).sendBackendState(msg);
      }
    })
  );

  //sub to warehouse global changed, for
  quest.goblin.defer(
    quest.sub(`*::warehouse.changed`, (err, msg) => {
      if (win) {
        quest.goblin.getX(`channel`).sendBackendInfos('warehouse', msg);
      }
    })
  );

  yield quest.cmd('warehouse.subscribe', {
    feed: winFeed,
    branches: feeds,
  });
});

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

Goblin.registerQuest(goblinName, 'delete', function(quest) {
  const win = quest.goblin.getX(`instances`);
  if (win) {
    win.destroy();
  }
  quest.evt('win.closed');
});

// Create a Goblin with initial state and handlers
module.exports = Goblin.configure(goblinName, logicState, logicHandlers);
