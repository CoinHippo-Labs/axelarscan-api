// import config
const config = require('config-yml');

const log = (level, from, message, data = {}) => {
  try {
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
        if (config?.log_level === 'debug' || process.env.LOG_LEVEL === 'debug' || !process.env.ENVIRONMENT) {
          console.debug(log_message);
        }
        break;
      default:
        console.log(log_message);
        break;
    };
  } catch (error) {}
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = {
  log,
  sleep,
};