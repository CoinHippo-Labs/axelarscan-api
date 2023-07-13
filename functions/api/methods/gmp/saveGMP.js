const axios = require('axios');

const { getGMP } = require('../../utils/config');
const { log, parseRequestError } = require('../../utils');

const service_name = 'gmp';

module.exports = async (event, chain) => {
  let output;
  const api = getGMP() && axios.create({ baseURL: getGMP() });
  if (api && event && chain) {
    const params = { method: 'saveGMP', ...(typeof event === 'object' ? event : { event }), chain };
    log('info', service_name, 'saveGMP', { params });
    const response =  await api.post('/', params).catch(error => parseRequestError(error));
    output = response?.data;
    log('debug', service_name, 'saveGMP', { output, params });
  }
  return output;
};