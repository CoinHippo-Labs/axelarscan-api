const moment = require('moment');

const getGranularity = timestamp => {
  const time = moment(timestamp).utc();
  return {
    ms: time.valueOf(),
    ...Object.fromEntries(['hour', 'day', 'week', 'month', 'quarter', 'year'].map(x => [x, moment(time).startOf(x).valueOf()])),
  };
};

module.exports = {
  getGranularity,
};