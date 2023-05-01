const {
  getAPI,
} = require('../../utils/config');
const {
  log,
} = require('../../utils');

const service_name = 'axelarscan-axelar-crawler';

module.exports = async () => {
  const api = getAPI();

  if (api) {
    const method = 'updateTVL';
    log('info', service_name, `start ${method}`);
    await api.get('/', { params: { method } }).catch(error => { return { error: error?.response?.data }; });
    log('info', service_name, `end ${method}`);
  }
};