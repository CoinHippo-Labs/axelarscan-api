const config = require('config-yml');
const {
  log,
} = require('./utils');

const environment =
  process.env.ENVIRONMENT ||
  config?.environment;

const {
  reindex,
} = { ...config?.[environment] };

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

// import block subscriber
require('./services/subscriber/block')();
// import tx subscriber
require('./services/subscriber/tx')();
if (reindex) {
  // import reindexer
  require('./services/reindexer')();
}