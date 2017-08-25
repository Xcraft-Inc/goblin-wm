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
  'win.create': (state, action) => {
    const id = action.get ('id');
    const win = action.get ('win');
    return state.set (`instances.wid-${id}`, win);
  },
  _saveUnsubscribe: (state, action) => {
    return state.set (`feedSubscriptions.wid-${action.get ('id')}`, {
      unsub: action.get ('unsub'),
      branches: action.get ('branches'),
    });
  },
  'win.delete': (state, action) => {
    const id = action.get ('id');
    const newState = state
      .del (`instances.wid-${id}`)
      .del (`feedSubscriptions.wid-${id}`);

    return newState;
  },
};

const previousStates = {};
const fullStateNeeded = {};
const sendBackendState = (window, state, transport) => {
  let payload;
  if (previousStates[window.id] && !fullStateNeeded[window.id]) {
    payload = diff (previousStates[window.id], state);
  } else {
    payload = diff (fromJS ({}), state);
    fullStateNeeded[window.id] = false;
  }
  previousStates[window.id] = state;

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

Goblin.registerQuest (goblinName, 'init', function (quest) {
  const onLaboratoryReady = (evt, id, wid) => {
    quest.cmd ('laboratory._ready', {id, wid});
  };

  const onQuest = (evt, action) => {
    quest.cmd (action.cmd, action.args);
  };

  const onResend = (evt, wid) => {
    quest.cmd ('warehouse.resend', {
      feed: wid,
    });
    fullStateNeeded[wid] = true;
  };

  ipcMain.on ('LABORATORY_READY', onLaboratoryReady);
  ipcMain.on ('QUEST', onQuest);
  ipcMain.on ('RESEND', onResend);

  quest.goblin.defer (() => {
    ipcMain.removeListener ('LABORATORY_READY', onLaboratoryReady);
    ipcMain.removeListener ('QUEST', onQuest);
    ipcMain.removeListener ('RESEND', onResend);
  });
});

Goblin.registerQuest (goblinName, 'win.create', function* (
  quest,
  labId,
  url,
  options,
  next
) {
  if (!options.useWS) {
    const win = new BrowserWindow ();

    quest.goblin.setX (`transport-for-window-${win.id}`, {
      name: 'electron',
      send: win.webContents.send.bind (win.webContents),
    });

    if (options.openDevTools) {
      win.webContents.openDevTools ();
    }

    const id = win.id;
    quest.do ({win: win, id});

    const nextLoad = next.parallel ();
    const unsubLoad = quest.sub (`wm.win.${id}.loaded`, (...args) => {
      unsubLoad ();
      return nextLoad (...args);
    });

    win.on ('close', evt => {
      evt.preventDefault ();
      quest.cmd ('wm.win.delete', {id});
      quest.cmd ('laboratory.delete', {id: labId});
    });

    //wire finish load
    win.webContents.once ('did-finish-load', () => {
      quest.evt (`win.${id}.loaded`);
    });

    win.loadURL (url);

    // wait finish load
    yield next.sync ();
    return id;
  } else {
    const id = 'web';
    const WebSocket = require ('ws');
    const wss = new WebSocket.Server ({port: 8000});
    const win = yield wss.once ('connection', next);

    quest.goblin.setX (`transport-for-window-${id}`, {
      name: 'ws',
      send: win.send,
    });
    quest.do ({win, id});

    win.on ('message', function (data) {
      data = JSON.parse (data);
      switch (data.type) {
        case 'LABORATORY_READY':
          quest.cmd ('laboratory._ready', {id: data.id, wid: data.wid});
          break;
        case 'QUEST':
          quest.cmd (data.action.cmd, data.action.args);
          break;
      }
    });

    win.on ('close', function () {
      quest.cmd ('wm.win.delete', {id});
      quest.cmd ('laboratory.delete', {id: labId});
    });

    return id;
  }
});

Goblin.registerQuest (goblinName, 'win.feed.sub', function (quest, wid, feeds) {
  // wire backend feeds
  const win = quest.goblin.getState ().get (`instances.wid-${wid}`);
  const winFeed = wid;

  const unsubFeed = quest.sub (`warehouse.${winFeed}.changed`, (err, msg) => {
    quest.log.info (`${winFeed} changed`);
    sendBackendState (
      win,
      msg.data,
      quest.goblin.getX (`transport-for-window-${win.id}`)
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

Goblin.registerQuest (goblinName, 'win.nav', function (quest, id, route) {
  const state = quest.goblin.getState ();
  const win = state.get (`instances.wid-${id}`);
  if (win) {
    quest.log.info (`navigating to ${route}...`);
    sendPushPath (
      win,
      route,
      quest.goblin.getX (`transport-for-window-${win.id}`)
    );
  }
});

Goblin.registerQuest (goblinName, 'win.dispatch', function (quest, id, action) {
  const state = quest.goblin.getState ();
  const win = state.get (`instances.wid-${id}`);
  if (win) {
    quest.log.info (`dispatching ${action.type}...`);
    sendAction (
      win,
      action,
      quest.goblin.getX (`transport-for-window-${win.id}`)
    );
  }
});

Goblin.registerQuest (goblinName, 'win.delete', function (quest, id) {
  const state = quest.goblin.getState ();
  const win = state.get (`instances.wid-${id}`);
  if (win) {
    quest.goblin.delX (`transport-for-window-${win.id}`);
    win.destroy ();
    delete fullStateNeeded[id];
    delete previousStates[id];
    state.get (`feedSubscriptions.wid-${id}.unsub`) ();
  } else {
    quest.log.warn (`Window with id:${id} doesn't exist`);
  }
  quest.do ();
});

Goblin.registerQuest (goblinName, 'win.list', function (quest) {
  const state = quest.goblin.getState ();
  state.get ('instances').forEach ((v, k) => {
    const branches = state.get (`feedSubscriptions.${k}.branches`).toJS ();
    quest.log.info (`window: ${k}`);
    quest.log.info (`-> branches: ${branches.join (', ')}`);
  });
});

// Singleton
module.exports = Goblin.configure (goblinName, logicState, logicHandlers);
Goblin.createSingle (goblinName);
