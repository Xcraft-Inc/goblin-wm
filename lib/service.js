'use strict';

const path = require ('path');
const Goblin = require ('xcraft-core-goblin');
const {fromJS} = require ('immutable');
const transit = require ('transit-immutable-js');
const {BrowserWindow, ipcMain} = require ('electron');
const diff = require ('immutablediff');
const goblinName = path.basename (module.parent.filename, '.js');

// Define initial logic values
const logicState = {
  instances: {},
  feedSubscriptions: {},
};

// Define logic handlers according rc.json
const logicHandlers = {
  create: (state, action) => {
    const win = action.get ('win');
    return state.set (`instances`, win);
  },
  _saveUnsubscribe: (state, action) => {
    return state.set (`feedSubscriptions`, {
      unsub: action.get ('unsub'),
      branches: action.get ('branches'),
    });
  },
};

let previousStates = null;
let fullStateNeeded = false;
const sendBackendState = (window, state, transport) => {
  let payload;
  if (previousStates && !fullStateNeeded) {
    payload = diff (previousStates, state);
  } else {
    payload = diff (fromJS ({}), state);
    fullStateNeeded = false;
  }
  previousStates = state;

  if (transport.name === 'electron') {
    transport.send ('NEW_BACKEND_STATE', transit.toJSON (payload), 'main');
    return;
  }

  if (transport.name === 'ws') {
    transport.send (
      JSON.stringify ({
        type: 'NEW_BACKEND_STATE',
        transitState: transit.toJSON (payload),
      })
    );
    return;
  }
};

const sendPushPath = (window, path, transport) => {
  if (transport.name === 'electron') {
    transport.send ('PUSH_PATH', path, 'main');
    return;
  }

  if (transport.name === 'ws') {
    transport.send (
      JSON.stringify ({
        type: 'PUSH_PATH',
        path,
      })
    );
    return;
  }
};

const sendAction = (window, action, transport) => {
  if (transport.name === 'electron') {
    transport.send ('DISPATCH_IN_APP', action);
    return;
  }

  if (transport.name === 'ws') {
    transport.send (
      JSON.stringify ({
        type: 'DISPATCH_IN_APP',
        action,
      })
    );
    return;
  }
};

Goblin.registerQuest (goblinName, 'create', function* (
  quest,
  labId,
  url,
  options,
  next
) {
  const onLaboratoryReady = (evt, id, wid) => {
    quest.cmd ('laboratory._ready', {id, wid: quest.goblin.id});
  };

  const onQuest = (evt, action) => {
    quest.cmd (action.cmd, action.args);
  };

  const onResend = evt => {
    quest.cmd ('warehouse.resend', {
      feed: quest.goblin.id,
    });
    fullStateNeeded = true;
  };

  ipcMain.on ('LABORATORY_READY', onLaboratoryReady);
  ipcMain.on ('QUEST', onQuest);
  ipcMain.on ('RESEND', onResend);

  quest.goblin.defer (() => {
    ipcMain.removeListener ('LABORATORY_READY', onLaboratoryReady);
    ipcMain.removeListener ('QUEST', onQuest);
    ipcMain.removeListener ('RESEND', onResend);
  });

  if (!options.useWS) {
    const win = new BrowserWindow ();

    quest.goblin.setX (`transport-for-window`, {
      name: 'electron',
      send: win.webContents.send.bind (win.webContents),
    });

    if (options.openDevTools) {
      win.webContents.openDevTools ();
    }
    quest.do ({win: win});

    const nextLoad = next.parallel ();
    const unsubLoad = quest.sub (`${quest.goblin.id}.loaded`, (...args) => {
      unsubLoad ();
      return nextLoad (...args);
    });

    win.on ('close', evt => {
      evt.preventDefault ();
      quest.me.delete ();
      quest.cmd ('laboratory.delete', {id: labId});
    });

    //wire finish load
    win.webContents.once ('did-finish-load', () => {
      quest.evt (`loaded`);
    });

    win.loadURL (url);

    // wait finish load
    yield next.sync ();
    return quest.goblin.id;
  } else {
    //WEBSOCKET CLIENTS MODE
    const WebSocket = require ('ws');
    const wss = new WebSocket.Server ({port: 8000});

    if (options.target === 'electron-renderer') {
      const electronWin = new BrowserWindow ();

      if (options.openDevTools) {
        electronWin.webContents.openDevTools ();
      }

      electronWin.loadURL (url);
    }

    let win = yield wss.once ('connection', next.arg (0));
    quest.goblin.setX (`transport-for-window`, {
      name: 'ws',
      send: win.send.bind (win),
    });
    quest.do ({win});

    win.on ('message', function (data) {
      data = JSON.parse (data);
      switch (data.type) {
        case 'LABORATORY_READY':
          quest.cmd ('laboratory._ready', {id: data.labId, wid: data.wid});
          break;
        case 'QUEST':
          quest.cmd (data.action.cmd, data.action.args);
          break;
      }
    });

    win.on ('close', function () {
      //quest.cmd ('wm.win.delete', {id});
      //quest.cmd ('laboratory.delete', {id: labId});
    });

    return quest.goblin.id;
  }
});

Goblin.registerQuest (goblinName, 'feed-sub', function (quest, wid, feeds) {
  // wire backend feeds
  const win = quest.goblin.getState ().get (`instances`);
  const winFeed = wid;

  const unsubFeed = quest.sub (`warehouse.${winFeed}.changed`, (err, msg) => {
    quest.log.info (`${winFeed} changed`);
    sendBackendState (
      win,
      msg.data,
      quest.goblin.getX (`transport-for-window`)
    );
  });

  quest.dispatch ('_saveUnsubscribe', {
    id: wid,
    unsub: unsubFeed,
    branches: feeds,
  });

  quest.cmd ('warehouse.subscribe', {
    feed: winFeed,
    branches: feeds,
  });
});

Goblin.registerQuest (goblinName, 'nav', function (quest, route) {
  const state = quest.goblin.getState ();
  const win = state.get (`instances`);
  if (win) {
    quest.log.info (`navigating to ${route}...`);
    sendPushPath (win, route, quest.goblin.getX (`transport-for-window`));
  }
});

Goblin.registerQuest (goblinName, 'dispatch', function (quest, action) {
  const state = quest.goblin.getState ();
  const win = state.get (`instances`);
  if (win) {
    quest.log.info (`dispatching ${action.type}...`);
    sendAction (win, action, quest.goblin.getX (`transport-for-window`));
  }
});

Goblin.registerQuest (goblinName, 'list', function (quest) {
  const state = quest.goblin.getState ();
  state.get ('instances').forEach ((v, k) => {
    const branches = state.get (`feedSubscriptions.branches`).toJS ();
    quest.log.info (`window: ${k}`);
    quest.log.info (`-> branches: ${branches.join (', ')}`);
  });
});

Goblin.registerQuest (goblinName, 'delete', function (quest) {
  const state = quest.goblin.getState ();
  const win = state.get (`instances`);
  if (win) {
    quest.goblin.delX (`transport-for-window`);
    win.destroy ();
    fullStateNeeded = null;
    previousStates = false;
    state.get (`feedSubscriptions.unsub`) ();
  }
});

// Create a Goblin with initial state and handlers
module.exports = Goblin.configure (goblinName, logicState, logicHandlers);
