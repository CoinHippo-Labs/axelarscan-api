const axios = require('axios');

const { getGMP } = require('../../utils/config');
const { parseRequestError } = require('../../utils');

module.exports = async params => {
  let output;
  const api = getGMP() && axios.create({ baseURL: getGMP(), timeout: 25000 });
  if (api) {
    params = { ...params, method: 'GMPTotalFee' };
    const response = await api.post('/', params).catch(error => parseRequestError(error));
    output = response?.data;
  }
  return output;
};