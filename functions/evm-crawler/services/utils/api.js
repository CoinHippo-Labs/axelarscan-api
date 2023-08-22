const { ENVIRONMENT, getAPI } = require('../../utils/config');
const { log, parseRequestError } = require('../../utils');

const service_name = 'api';

const getLatestEventBlock = async chain => {
  let output;
  const api = getAPI();
  if (api && chain) {
    const params = { method: 'getLatestEventBlock', chain };
    log('info', service_name, 'get latest event block', { ...params });
    const response = await api.get('/', { params }).catch(error => parseRequestError(error));
    const { data, error } = { ...response };
    if (data && !error) {
      output = data;
    }
    log('debug', service_name, 'latest event block', { output, error, params });
  }
  return output;
};

const saveEvent = async (event, chain, contractAddress, env = ENVIRONMENT) => {
  let output;
  const api = getAPI(undefined, env);
  if (api && event) {
    const params = { method: 'saveEvent', ...(chain ? { event, chain, contractAddress } : event) };
    log('info', service_name, 'save event', { ...params });
    for (let i = 0; i < 3; i++) {
      const response = await api.post('/', params).catch(error => parseRequestError(error));
      const { data, error } = { ...response };
      if (data && !error) {
        output = data;
        break;
      }
      else if (error) {
        output = error;
      }
    }
    log('debug', service_name, 'save event result', { output, params });
  }
  return output;
};

module.exports = {
  getLatestEventBlock,
  saveEvent,
};