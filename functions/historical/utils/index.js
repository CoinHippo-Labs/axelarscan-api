// import config
const config = require('config-yml');

const log = (level, from, message, data) => {
  // generate log message
  const log_message = `${level === 'error' ? 'ERR' : level === 'warn' ? 'WARN' : level === 'debug' ? 'DBG' : 'INF'} [${from?.toUpperCase()}] ${message}\n${typeof data === 'string' ? data : typeof data === 'object' && data ? JSON.stringify(data, null, 2) : data}`;

  // normalize level
  level = level?.toLowerCase();

  switch (level) {
    case 'error':
      console.error(log_message);
      break;
    case 'warn':
      console.warn(log_message);
      break;
    case 'debug':
      if (config?.log_level === 'debug') {
        console.debug(log_message);
      }
      break;
    default:
      console.log(log_message);
      break;
  };
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const to_json = s => {
  if (s) {
    if (typeof s === 'object') return s;
    try {
      return JSON.parse(s);
    } catch (error) {}
  }
  return null;
};

module.exports = {
  log,
  sleep,
  to_json,
};