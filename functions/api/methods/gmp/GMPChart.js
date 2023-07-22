const axios = require('axios');

const { getGMP } = require('../../utils/config');
const { parseRequestError } = require('../../utils');

module.exports = async params => {
  let output;
  const api = getGMP() && axios.create({ baseURL: getGMP() });
  if (api) {
    params = { ...params, method: 'GMPChart' };
    const response = await api.post('/', params).catch(error => parseRequestError(error));
    output = response?.data;
  }
  return output;
};