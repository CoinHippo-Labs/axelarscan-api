const moment = require('moment');

const { isString } = require('./string');

const log = (level = 'info', from, message, data = {}) => {
  // terminal colors
  const LIGHT_BLUE = '\033[0;94m', LIGHT_YELLOW = '\033[0;93m', GRAY = '\033[0;90m', CYAN = '\033[0;36m', YELLOW = '\033[0;33m', GREEN = '\033[0;32m', RED = '\033[0;31m', NO_COLOR = '\033[0m';
  try {
    // normalize level
    level = level.toLowerCase();
    // generate log message
    const log_message = ['local', 'test'].includes(from) ?
      `${GRAY}${moment().format('YYYY-MM-DDTHH:mm:ssZ')}${NO_COLOR} ${level === 'error' ? `${RED}ERR` : level === 'warn' ? `${YELLOW}WARN` : level === 'debug' ? `${GREEN}DBG` : `${GREEN}INF`}${NO_COLOR} ${LIGHT_BLUE}[${from?.toUpperCase()}]${NO_COLOR} ${LIGHT_YELLOW}${message}${NO_COLOR} ${isString(data) ? data : typeof data === 'object' ? JSON.stringify(data, null, 2) : data}` :
      `${level === 'error' ? 'ERR' : level === 'warn' ? 'WARN' : level === 'debug' ? 'DBG' : 'INF'} [${from?.toUpperCase()}] ${message}\n${isString(data) ? data : typeof data === 'object' ? JSON.stringify(data, null, 2) : data}`;
    switch (level) {
      case 'error':
        console.error(log_message);
        break;
      case 'warn':
        console.warn(log_message);
        break;
      case 'debug':
        if (!process.env.LOG_LEVEL || process.env.LOG_LEVEL === level) {
          console.debug(log_message);
        }
        break;
      default:
        console.log(log_message);
        break;
    }
  } catch (error) {}
};

module.exports = {
  log,
};