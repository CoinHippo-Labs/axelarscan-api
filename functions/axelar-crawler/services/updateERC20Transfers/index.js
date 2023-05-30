const { getAPI } = require('../../utils/config');
const { log, sleep } = require('../../utils');

module.exports = async context => {
  const api = getAPI();
  if (api) {
    const service_name = `${!context ? 'local_' : ''}axelarscan-axelar-crawler`;
    const method = 'updateERC20Transfers';
    while (!context || context.getRemainingTimeInMillis() > 300 * 1000) {
      log('info', service_name, `start ${method}`);
      await api.get('/', { params: { method } }).catch(error => { return { error: error?.response?.data }; });
      log('info', service_name, `end ${method}`);
      await sleep(3 * 1000);
    }
  }
};