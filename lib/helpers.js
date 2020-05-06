function getWindowState(window) {
  let bounds = window.getNormalBounds();
  return {
    bounds,
    maximized: window.isMaximized(),
    fullscreen: window.isFullScreen(),
  };
}

function getDefaultWindowState(winOptions) {
  return {
    bounds: {
      x: winOptions.x,
      y: winOptions.y,
      width: winOptions.width,
      height: winOptions.height,
    },
    maximized: false,
    fullscreen: false,
  };
}

module.exports = {
  getWindowState,
  getDefaultWindowState,
};
