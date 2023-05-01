const {
  getAPI,
} = require('../../utils/config');
const {
  log,
  sleep,
} = require('../../utils');

const service_name = 'axelarscan-axelar-crawler';

module.exports = async context => {
  const api = getAPI();

  if (api) {
    const method = 'updateERC20Transfers';
    while (!context || context.getRemainingTimeInMillis() > 20 * 1000) {
      log('info', service_name, `start ${method}`);
      await api.get('/', { params: { method } }).catch(error => { return { error: error?.response?.data }; });
      log('info', service_name, `end ${method}`);
      await sleep(3 * 1000);
    }
  }
};