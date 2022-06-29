exports.handler = async (event, context, callback) => {
  // import utils
  const { sleep } = require('./utils');
  // import subscriber
  require('./services/subscriber')();
  // hold function
  while (context.getRemainingTimeInMillis() > 2 * 1000) {
    await sleep(1 * 1000);
  }
};