// import modules for building api
const express = require('express');
const bodyParser = require('body-parser');
// import config
const config = require('config-yml');
// import utils
const { log } = require('./utils');

// initial express server
const app = express();
// setup body parser
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// initial environment
const environment = process.env.ENVIRONMENT || config?.environment;

log('info', 'main', 'start service', { config: config?.[environment] });
// import cli routes
require('./routes/cli')(app);
// import log scraper
require('./services/scraper/log')();

// start service
app.listen(config?.port?.pm2 || 3333);