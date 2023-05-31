const { getAPI } = require('../../utils/config');
const { log, toArray } = require('../../utils');

module.exports = async context => {
  const api = getAPI();
  if (api && process.env.ENVIRONMENT === 'mainnet') {
    const service_name = `${!context ? 'local_' : ''}axelarscan-axelar-crawler`;
    const method = 'updateTVL';
    const response = await api.get('/', { params: { method: 'getAssets' } }).catch(error => { return { error: error?.response?.data }; });
    const { data } = { ...response }; 

    for (const d of data) {
      const { id } = { ...d };
      log('info', service_name, `start ${method}`, { id });
      await api.get('/', { params: { method, id } }).catch(error => { return { error: error?.response?.data }; });
      log('info', service_name, `end ${method}`, { id });
    }
  }
};