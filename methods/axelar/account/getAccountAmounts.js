const getBalances = require('./getBalances');
const getDelegations = require('./getDelegations');
const getRedelegations = require('./getRedelegations');
const getUnbondings = require('./getUnbondings');
const getRewards = require('./getRewards');
const getCommissions = require('./getCommissions');
const { getAssetsList } = require('../../../utils/config');

module.exports = async params => {
  const { address } = { ...params };
  if (!address?.startsWith('axelar')) return;

  params = { ...params, assetsData: await getAssetsList() };
  return Object.fromEntries(await Promise.all(['balances', 'delegations', 'redelegations', 'unbondings', 'rewards', 'commissions'].map(k => new Promise(async resolve => {
    let v;
    switch (k) {
      case 'balances':
        v = await getBalances(params);
        break;
      case 'delegations':
        v = await getDelegations(params);
        break;
      case 'redelegations':
        v = await getRedelegations(params);
        break;
      case 'unbondings':
        v = await getUnbondings(params);
        break;
      case 'rewards':
        v = await getRewards(params);
        break;
      case 'commissions':
        v = await getCommissions(params);
        break;
      default:
        break;
    }
    resolve([k, v]);
  }))));
};