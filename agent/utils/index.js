// import config
const config = require('config-yml');
// import module for generate timestamp
const moment = require('moment');

const log = (level, from, message, data) => {
  // terminal colors
  const LIGHT_BLUE = '\033[0;94m',
    LIGHT_YELLOW = '\033[0;93m',
    GRAY = '\033[0;90m',
    CYAN = '\033[0;36m',
    YELLOW = '\033[0;33m',
    GREEN = '\033[0;32m',
    RED = '\033[0;31m',
    NO_COLOR = '\033[0m';

  // generate log message
  const log_message = `${GRAY}${moment().format('YYYY-MM-DDTHH:mm:ssZ')}${NO_COLOR} ${level === 'error' ? `${RED}ERR` : level === 'warn' ? `${YELLOW}WARN` : level === 'debug' ? `${GREEN}DBG` : `${GREEN}INF`}${NO_COLOR} ${LIGHT_BLUE}[${from?.toUpperCase()}]${NO_COLOR} ${LIGHT_YELLOW}${message}${NO_COLOR} ${typeof data === 'string' ? data : typeof data === 'object' && data ? Object.entries(data).map(([k, v]) => `${CYAN}${k}=${NO_COLOR}${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ') : data}`;

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

module.exports = {
  log,
  sleep,
};