const {
  getAPI,
} = require('../../utils/config');
const {
  log,
} = require('../../utils');

const environment = process.env.ENVIRONMENT || 'testnet';

const service_name = 'api';

const getLatestEventBlock = async chain => {
  let output;

  const api = getAPI();

  if (api && chain) {
    const params = { method: 'getLatestEventBlock', chain };

    log(
      'info',
      service_name,
      'get latest event block',
      { ...params },
    );

    const response = await api.get('/', { params }).catch(error => { return { error: error?.response?.data }; });

    const {
      data,
      error,
    } = { ...response };

    if (data && !error) {
      output = data;
    }

    log(
      'debug',
      service_name,
      'latest event block',
      { output, error, params },
    );
  }

  return output;
};

const saveEvent = async (
  event,
  chain,
  contractAddress,
  env = environment,
) => {
  let output;

  const api = getAPI(undefined, env);

  if (api && event) {
    const params = {
      method: 'saveEvent',
      ...(chain ? { event, chain, contractAddress } : event),
    };

    log(
      'info',
      service_name,
      'save event',
      { ...params },
    );

    const retry_times = 3;

    for (let i = 0; i < retry_times; i++) {
      const response = await api.post('/', params).catch(error => { return { error: error?.response?.data }; });

      const {
        data,
        error,
      } = { ...response };

      if (data && !error) {
        output = data;
        break;
      }
    }

    log(
      'debug',
      service_name,
      'save event result',
      { output, error, params },
    );
  }

  return output;
};

module.exports = {
  getLatestEventBlock,
  saveEvent,
};