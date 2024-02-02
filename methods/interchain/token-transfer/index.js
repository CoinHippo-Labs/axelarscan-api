const { getTokenTransferAPI } = require('../../../utils/config');
const { createInstance, request } = require('../../../utils/http');

const requestAPI = async (method, params) => await request(createInstance(`${getTokenTransferAPI()}/${method}`, { timeout: 30000 }), { params });

module.exports = {
  transfersStats: async params => await requestAPI('transfersStats', params),
  transfersChart: async params => await requestAPI('transfersChart', params),
  transfersCumulativeVolume: async params => await requestAPI('transfersCumulativeVolume', params),
  transfersTotalVolume: async params => await requestAPI('transfersTotalVolume', params),
  transfersTotalFee: async params => await requestAPI('transfersTotalFee', params),
  transfersTotalActiveUsers: async params => await requestAPI('transfersTotalActiveUsers', params),
  transfersTopUsers: async params => await requestAPI('transfersTopUsers', params),
  searchTransfers: async params => await requestAPI('searchTransfers', params),
  getTransfersDataMapping: async params => await requestAPI('getTransfersDataMapping', params),
  searchBatches: async params => await requestAPI('searchBatches', params),
};