const config = require('config-yml');

const {
  log_level,
} = { ...config };

const log = (
  level = 'info',
  from,
  message,
  data = {},
) => {
  try {
    // normalize level
    level = level.toLowerCase();

    // generate log message
    const log_message = `${level === 'error' ? 'ERR' : level === 'warn' ? 'WARN' : level === 'debug' ? 'DBG' : 'INF'} [${from?.toUpperCase()}] ${message}\n${typeof data === 'string' ? data : typeof data === 'object' ? JSON.stringify(data, null, 2) : data}`;

    switch (level) {
      case 'error':
        console.error(log_message);
        break;
      case 'warn':
        console.warn(log_message);
        break;
      case 'debug':
        if (log_level === 'debug' || process.env.LOG_LEVEL === 'debug' || !process.env.ENVIRONMENT) {
          console.debug(log_message);
        }
        break;
      default:
        console.log(log_message);
        break;
    }
  } catch (error) {}
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = {
  log,
  sleep,
};