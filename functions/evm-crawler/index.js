exports.handler = async (event, context, callback) => {
  require('./services')(context);

  if (context) {
    // hold lambda function to not exit before timeout
    const { sleep } = require('./utils');
    while (context.getRemainingTimeInMillis() > 2 * 1000) {
      await sleep(1 * 1000);
    }
  }
};