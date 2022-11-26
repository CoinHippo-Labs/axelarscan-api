exports.handler = async (
  event,
  context,
  callback,
) => {
  // run subscriber
  require('./services/subscriber')();

  // run poll updater
  require('./services/polls-updater')();

  // run wrap & unwrap updater
  require('./services/wrap-unwrap-updater')();

  // hold lambda function to not exit before timeout
  const {
    sleep,
  } = require('./utils');

  while (context.getRemainingTimeInMillis() > 2 * 1000) {
    await sleep(1 * 1000);
  }
};