// import config
const config = require('config-yml');
// import utils
const { log } = require('./utils');

// initial environment
const environment = process.env.ENVIRONMENT || config?.environment;

log('info', 'main', 'start service', { config: config?.[environment] });
// import log scraper
require('./services/scraper/log')();