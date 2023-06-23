const axios = require('axios');

const { getGMP } = require('../../utils/config');
const { log } = require('../../utils');

const service_name = 'gmp';

module.exports = async (txHash, blockNumber) => {
  let output;
  const api = getGMP() && axios.create({ baseURL: getGMP() });
  if (api && event && chain) {
    const params = { method: 'recoverEvents', chain: 'axelarnet', txHash, blockNumber };
    log('info', service_name, 'recoverEvents', { params });
    const response =  await api.post('/', params).catch(error => { return { error: error?.response?.data }; });
    output = response?.data;
    log('debug', service_name, 'recoverEvents', { output, params });
  }
  return output;
};