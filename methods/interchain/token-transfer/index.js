const { getTokenTransferAPI } = require('../../../utils/config');
const { createInstance, request } = require('../../../utils/http');

const requestAPI = async params => await request(createInstance(getTokenTransferAPI(), { timeout: 30000 }), { params });

module.exports = {
  transfersChart: async params => await requestAPI({ ...params, method: 'transfersChart' }),
  transfersTotalVolume: async params => await requestAPI({ ...params, method: 'transfersTotalVolume' }),
  transfersTotalFee: async params => await requestAPI({ ...params, method: 'transfersTotalFee' }),
  transfersTotalActiveUsers: async params => await requestAPI({ ...params, method: 'transfersTotalActiveUsers' }),
  transfersStats: async params => await requestAPI({ ...params, method: 'transfersStats' }),
  transfersCumulativeVolume: async params => await requestAPI({ ...params, method: 'transfersCumulativeVolume' }),
  transfersTopUsers: async params => await requestAPI({ ...params, method: 'transfersTopUsers' }),
  searchTransfers: async params => await requestAPI({ ...params, method: 'searchTransfers' }),
  getTransfersDataMapping: async params => await requestAPI({ ...params, method: 'getTransfersDataMapping' }),
};