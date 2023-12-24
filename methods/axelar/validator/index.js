const { getValidatorAPI } = require('../../../utils/config');
const { createInstance, request } = require('../../../utils/http');

const requestAPI = async params => await request(createInstance(getValidatorAPI(), { timeout: 30000 }), { params });

module.exports = {
  rpc: async params => await requestAPI({ ...params, method: 'rpc' }),
  lcd: async params => await requestAPI({ ...params, method: 'lcd' }),
};