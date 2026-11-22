const page = new URLSearchParams(location.search).has('settings')
  ? './widget-settings-window.mjs'
  : './widget-player.mjs';
import(page);

