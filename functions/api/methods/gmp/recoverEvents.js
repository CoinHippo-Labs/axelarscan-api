const axios = require('axios');

const { getGMP } = require('../../utils/config');
const { log, parseRequestError } = require('../../utils');

const service_name = 'gmp';

module.exports = async (txHash, blockNumber) => {
  let output;
  const api = getGMP() && axios.create({ baseURL: getGMP(), timeout: 25000 });
  if (api) {
    const params = { method: 'recoverEvents', chain: 'axelarnet', txHash, blockNumber };
    log('info', service_name, 'recoverEvents', { params });
    const response = await api.post('/', params).catch(error => parseRequestError(error));
    output = response?.data;
    // log('debug', service_name, 'recoverEvents', { output, params });
  }
  return output;
};