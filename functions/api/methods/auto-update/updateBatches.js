const moment = require('moment');

const { searchBatches } = require('../batches');

module.exports = async () => {
  await searchBatches({ status: 'unexecuted', fromTime: moment().subtract(1, 'hours').unix() });
  return;
};