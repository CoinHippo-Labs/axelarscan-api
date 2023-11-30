const { ENVIRONMENT, getAPI, getGMPAPI } = require('../../utils/config');
const { log, sleep, toArray, parseRequestError } = require('../../utils');

module.exports = async context => {
  const api = getAPI();
  const gmp_api = getGMPAPI();
  if (api && gmp_api && ENVIRONMENT === 'mainnet') {
    const service_name = `${!context ? 'local_' : ''}axelarscan-axelar-crawler`;
    const methods = ['transfersChart', 'transfersCumulativeVolume', 'transfersStats', 'transfersTopUsers', 'transfersTotalActiveUsers', 'transfersTotalFee', 'transfersTotalVolume', 'GMPChart', 'GMPCumulativeVolume', 'GMPStats', 'GMPTopUsers', 'GMPTotalActiveUsers', 'GMPTotalFee', 'GMPTotalVolume', 'GMPStatsAVGTimes'];
    while (!context || context.getRemainingTimeInMillis() > 30 * 1000) {
      await Promise.all(
        toArray(
          methods.map(m =>
            new Promise(
              async resolve => {
                const _api = m.startsWith('GMP') ? gmp_api : api;
                const params = {};
                switch (m) {
                  case 'GMPStatsAVGTimes':
                    params.avg_times = true;
                    break;
                  case 'transfersChart':
                  case 'GMPChart':
                    params.granularity = 'month';
                    break;
                  case 'transfersTopUsersByVolume':
                    params.orderBy = 'volume';
                    break;
                  default:
                    break;
                }
                // log('info', service_name, `start ${method}`, params);
                await _api.get('/', { params: { method: m, ...params } }).catch(error => parseRequestError(error));
                // log('info', service_name, `end ${method}`, params);
              }
            )
          )
        )
      );
      await sleep(2 * 60 * 1000);
    }
  }
};