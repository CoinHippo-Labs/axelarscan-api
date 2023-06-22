const axios = require('axios');

const { getGMP } = require('../../utils/config');

module.exports = async (txHash, blockNumber) => {
  let output;
  const api = getGMP() && axios.create({ baseURL: getGMP() });
  if (api && event && chain) {
    const params = { method: 'recoverEvents', chain: 'axelarnet', txHash, blockNumber };
    const response =  await api.post('/', params).catch(error => { return { error: error?.response?.data }; });
    output = response?.data;
  }
  return output;
};