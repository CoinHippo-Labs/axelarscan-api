const {
  getAPI,
} = require('../../utils/config');
const {
  log,
} = require('../../utils');

module.exports = async context => {
  const api = getAPI();

  if (api) {
    const service_name = `${!context ? 'local_' : ''}axelarscan-axelar-crawler`;
    const method = 'archive';

    log('info', service_name, `start ${method}`);
    await api.get('/', { params: { method } }).catch(error => { return { error: error?.response?.data }; });
    log('info', service_name, `end ${method}`);
  }
};