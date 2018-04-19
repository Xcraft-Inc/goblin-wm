'use strict';

const path = require('path');
const Goblin = require('xcraft-core-goblin');
const {helpers} = require('xcraft-core-transport');
const transit = require('transit-immutable-js');
const {BrowserWindow, ipcMain} = require('electron');
const goblinName = path.basename(module.parent.filename, '.js');

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

const sendBackendState = (window, data, transport) => {
  const transitState = transit.toJSON(data);

  if (transport.name === 'electron') {
    transport.send('NEW_BACKEND_STATE', transitState, 'main');
    return;
  }

  if (transport.name === 'ws') {
    transport.send(
      JSON.stringify({
        type: 'NEW_BACKEND_STATE',
        transitState,
      })
    );
    return;
  }
};

const sendPushPath = (window, path, transport) => {
  if (transport.name === 'electron') {
    transport.send('PUSH_PATH', path, 'main');
    return;
  }

  if (transport.name === 'ws') {
    transport.send(
      JSON.stringify({
        type: 'PUSH_PATH',
        path,
      })
    );
    return;
  }
};

const sendAction = (window, action, transport) => {
  if (transport.name === 'electron') {
    transport.send('DISPATCH_IN_APP', action);
    return;
  }

  if (transport.name === 'ws') {
    transport.send(
      JSON.stringify({
        type: 'DISPATCH_IN_APP',
        action,
      })
    );
    return;
  }
};

Goblin.registerQuest(goblinName, 'create', function*(
  quest,
  labId,
  url,
  options,
  next
) {
  quest.do();
  const onLaboratoryReady = (evt, id) => {
    quest.cmd('laboratory._ready', {id, wid: quest.goblin.id});
  };

  const onQuest = (evt, action) => {
    const _action = helpers.fromXcraftJSON(action)[0];
    quest.cmd(_action.cmd, _action.data);
  };

  const onResend = evt => {
    quest.cmd('warehouse.resend', {
      feed: quest.goblin.id,
    });
  };

  ipcMain.on('LABORATORY_READY', onLaboratoryReady);
  ipcMain.on('QUEST', onQuest);
  ipcMain.on('RESEND', onResend);

  quest.goblin.defer(() => {
    ipcMain.removeListener('LABORATORY_READY', onLaboratoryReady);
    ipcMain.removeListener('QUEST', onQuest);
    ipcMain.removeListener('RESEND', onResend);
  });

  if (!options.useWS) {
    const win = new BrowserWindow({width: 1280, height: 720});

    if (process.platform === 'darwin') {
      const {Menu, app, shell} = require('electron');
      const defaultMenu = require('electron-default-menu');
      const menu = defaultMenu(app, shell);
      app.setApplicationMenu(Menu.buildFromTemplate(menu));
    }

    quest.goblin.setX('instances', win);
    quest.goblin.setX(`transport-for-window`, {
      name: 'electron',
      send: win.webContents.send.bind(win.webContents),
    });

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

    // wait finish load
    yield next.sync();
    return quest.goblin.id;
  } else {
    //WEBSOCKET CLIENTS MODE
    const WebSocket = require('ws');
    const wss = new WebSocket.Server({port: 8000});

    if (options.target === 'electron-renderer') {
      const electronWin = new BrowserWindow();

      if (options.openDevTools) {
        electronWin.webContents.openDevTools();
      }

      electronWin.loadURL(url);
    }

    let win = yield wss.once('connection', next.arg(0));
    quest.goblin.setX(`transport-for-window`, {
      name: 'ws',
      send: win.send.bind(win),
    });
    quest.do({win});

    win.on('message', function(data) {
      data = JSON.parse(data);
      switch (data.type) {
        case 'LABORATORY_READY':
          onLaboratoryReady(null, data.labId);
          break;
        case 'QUEST': {
          onQuest(null, data.action);
          break;
        }
      }
    });

    win.on('close', function() {
      //quest.cmd ('wm.win.delete', {id});
      //quest.cmd ('laboratory.delete', {id: labId});
    });

    return quest.goblin.id;
  }
});

Goblin.registerQuest(goblinName, 'feed-sub', function*(quest, wid, feeds) {
  // wire backend feeds
  const win = quest.goblin.getX(`instances`);
  const winFeed = wid;
  quest.goblin.defer(
    quest.sub(`*::warehouse.${winFeed}.changed`, (err, msg) => {
      quest.log.info(`${winFeed} changed`);
      sendBackendState(
        win,
        msg.data,
        quest.goblin.getX(`transport-for-window`)
      );
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
    sendPushPath(win, route, quest.goblin.getX(`transport-for-window`));
  }
});

Goblin.registerQuest(goblinName, 'dispatch', function(quest, action) {
  const win = quest.goblin.getX(`instances`);
  if (win) {
    quest.log.info(`dispatching ${action.type}...`);
    sendAction(win, action, quest.goblin.getX(`transport-for-window`));
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
