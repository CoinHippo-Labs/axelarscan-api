const { getAPI } = require('../../utils/config');
const { log, sleep, parseRequestError } = require('../../utils');

module.exports = async context => {
  const api = getAPI();
  if (api) {
    const service_name = `${!context ? 'local_' : ''}axelarscan-axelar-crawler`;
    const method = 'searchTransfers';
    while (!context || context.getRemainingTimeInMillis() > 300 * 1000) {
      // log('info', service_name, `start ${method}`);
      await api.get('/', { params: { method, status: 'to_fix_fee_terra' } }).catch(error => parseRequestError(error));
      // log('info', service_name, `end ${method}`);
      await sleep(0.5 * 1000);
    }
  }
};