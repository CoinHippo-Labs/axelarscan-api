const { getValidatorAPI } = require('../../../utils/config');
const { createInstance, request } = require('../../../utils/http');

const requestAPI = async params => await request(createInstance(getValidatorAPI(), { timeout: 30000 }), { params });

module.exports = {
  rpc: async params => await requestAPI({ ...params, method: 'rpc' }),
  lcd: async params => await requestAPI({ ...params, method: 'lcd' }),
  searchBlocks: async params => await requestAPI({ ...params, method: 'searchBlocks' }),
  searchTransactions: async params => await requestAPI({ ...params, method: 'searchTransactions' }),
  searchUptimes: async params => await requestAPI({ ...params, method: 'searchUptimes' }),
  searchProposedBlocks: async params => await requestAPI({ ...params, method: 'searchProposedBlocks' }),
  searchHeartbeats: async params => await requestAPI({ ...params, method: 'searchHeartbeats' }),
  searchPolls: async params => await requestAPI({ ...params, method: 'searchPolls' }),
  getValidators: async params => await requestAPI({ ...params, method: 'getValidators' }),
  getValidatorsVotes: async params => await requestAPI({ ...params, method: 'getValidatorsVotes' }),
  getChainMaintainers: async params => await requestAPI({ ...params, method: 'getChainMaintainers' }),
};