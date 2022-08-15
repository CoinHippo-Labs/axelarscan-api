const express = require('express');
const bodyParser = require('body-parser');
const config = require('config-yml');
const { log } = require('./utils');

const environment = process.env.ENVIRONMENT || config?.environment;

const {
	port,
} = { ...config?.[environment] };

// initial express server
const app = express();
// setup body parser
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

log(
  'info',
  'main',
  'start service',
  {
  	config: {
  		...config?.[environment],
  	},
  },
);

// import cli routes
require('./routes/cli')(app);
// start service
app.listen(port?.cli || 3333);
// import log scraper
require('./services/scraper/log')();