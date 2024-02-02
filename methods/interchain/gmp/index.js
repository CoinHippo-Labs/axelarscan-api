const { getGMPAPI } = require('../../../utils/config');
const { createInstance, request } = require('../../../utils/http');

const requestAPI = async (method, params) => await request(createInstance(`${getGMPAPI()}/${method}`, { timeout: 30000 }), { params });

module.exports = {
  GMPStats: async params => await requestAPI('GMPStats', params),
  GMPStatsAVGTimes: async params => await requestAPI('GMPStats', { ...params, avg_times: true }),
  GMPChart: async params => await requestAPI('GMPChart', params),
  GMPCumulativeVolume: async params => await requestAPI('GMPCumulativeVolume', params),
  GMPTotalVolume: async params => await requestAPI('GMPTotalVolume', params),
  GMPTotalFee: async params => await requestAPI('GMPTotalFee', params),
  GMPTotalActiveUsers: async params => await requestAPI('GMPTotalActiveUsers', params),
  GMPTopUsers: async params => await requestAPI('GMPTopUsers', params),
  searchGMP: async params => await requestAPI('searchGMP', params),
  getGMPDataMapping: async params => await requestAPI('getGMPDataMapping', params),
};