const METHODS = require('../../methods');

module.exports = async () => {
  await Promise.all(['transfersStats', 'transfersChart', 'transfersCumulativeVolume', 'transfersTotalVolume', 'transfersTotalFee', 'transfersTotalActiveUsers', 'transfersTopUsers', 'transfersTopUsersByVolume', 'GMPStats', 'GMPStatsAVGTimes', 'GMPChart', 'GMPCumulativeVolume', 'GMPTotalVolume', 'GMPTotalFee', 'GMPTotalActiveUsers', 'GMPTopUsers', 'GMPTopITSUsers', 'GMPTopITSUsersByVolume', 'GMPTopITSAssets', 'GMPTopITSAssetsByVolume'].map(d => new Promise(async resolve => {
    switch (d) {
      case 'transfersTopUsers':
        resolve(await METHODS.transfersTopUsers({ size: 100 }));
        break;
      case 'transfersTopUsersByVolume':
        resolve(await METHODS.transfersTopUsers({ orderBy: 'volume', size: 100 }));
        break;
      case 'GMPStats':
        resolve(await METHODS.GMPStats({ forceCache: true }));
        break;
      case 'GMPTopUsers':
        resolve(await METHODS.GMPTopUsers({ size: 100 }));
        break;
      case 'GMPTopITSUsers':
        resolve(await METHODS.GMPTopUsers({ assetType: 'its', size: 100 }));
        break;
      case 'GMPTopITSUsersByVolume':
        resolve(await METHODS.GMPTopUsers({ assetType: 'its', orderBy: 'volume', size: 100 }));
        break;
      case 'GMPTopITSAssets':
        resolve(await METHODS.GMPTopITSAssets({ size: 100 }));
        break;
      case 'GMPTopITSAssetsByVolume':
        resolve(await METHODS.GMPTopITSAssets({ orderBy: 'volume', size: 100 }));
        break;
      default:
        resolve(await METHODS[d]());
        break;
    }
  })));
};