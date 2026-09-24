'use strict';

function ts() {
  return new Date().toISOString();
}

function info(msg) {
  console.log(`[${ts()}] [INFO ] ${msg}`);
}

function warn(msg) {
  console.warn(`[${ts()}] [WARN ] ${msg}`);
}

function error(msg) {
  console.error(`[${ts()}] [ERROR] ${msg}`);
}

module.exports = { info, warn, error };