const { ENVIRONMENT, getAPI } = require('../../utils/config');
const { log, toArray, parseRequestError } = require('../../utils');

module.exports = async context => {
  const api = getAPI();
  if (api && ENVIRONMENT === 'mainnet') {
    const service_name = `${!context ? 'local_' : ''}axelarscan-axelar-crawler`;
    const method = 'updateTVL';
    const response = await api.get('/', { params: { method: 'getAssets' } }).catch(error => parseRequestError(error));
    const { data } = { ...response };
    for (const d of toArray(data)) {
      const { id } = { ...d };
      // log('info', service_name, `start ${method}`, { id });
      await api.get('/', { params: { method, id } }).catch(error => parseRequestError(error));
      // log('info', service_name, `end ${method}`, { id });
    }
  }
};