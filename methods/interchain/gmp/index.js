const { getGMPAPI } = require('../../../utils/config');
const { createInstance, request } = require('../../../utils/http');

const requestAPI = async params => await request(createInstance(getGMPAPI(), { timeout: 30000 }), { params });

module.exports = {
  GMPStats: async params => await requestAPI({ ...params, method: 'GMPStats' }),
  GMPStatsAVGTimes: async params => await requestAPI({ ...params, method: 'GMPStats', avg_times: true }),
  GMPChart: async params => await requestAPI({ ...params, method: 'GMPChart' }),
  GMPCumulativeVolume: async params => await requestAPI({ ...params, method: 'GMPCumulativeVolume' }),
  GMPTotalVolume: async params => await requestAPI({ ...params, method: 'GMPTotalVolume' }),
  GMPTotalFee: async params => await requestAPI({ ...params, method: 'GMPTotalFee' }),
  GMPTotalActiveUsers: async params => await requestAPI({ ...params, method: 'GMPTotalActiveUsers' }),
  GMPTopUsers: async params => await requestAPI({ ...params, method: 'GMPTopUsers' }),
  searchGMP: async params => await requestAPI({ ...params, method: 'searchGMP' }),
  getGMPDataMapping: async params => await requestAPI({ ...params, method: 'getGMPDataMapping' }),
};