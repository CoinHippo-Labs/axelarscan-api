const _ = require('lodash');
const moment = require('moment');

const getTotalSupply = require('./getTotalSupply');
const { getTVL } = require('../tvl');
const { getAssetData, getSupplyConfig } = require('../../utils/config');
const { toBoolean } = require('../../utils/string');
const { toFixed } = require('../../utils/number');
const { timeDiff } = require('../../utils/time');

const { max_supply, initial_unlocked_percent, community_sale, community_programs, company_operations, backers, team } = { ...getSupplyConfig() };

const calculateVesting = (config, assetData) => {
  const { total_unlock_percent, vesting_period, vesting_start, vesting_until } = { ...config };
  const { decimals } = { ...assetData };
  const total = parseFloat(toFixed(max_supply * total_unlock_percent / 100, decimals));
  const current = moment().valueOf();
  const vestingStart = moment(vesting_start, 'YYYY-MM-DD').startOf('day').valueOf();
  const vestingUntil = moment(vesting_until, 'YYYY-MM-DD').startOf('day').valueOf();
  return { total, unlocked: current >= vestingUntil ? total : current <= vestingStart ? 0 : parseFloat(toFixed(total * timeDiff(vestingStart, `${vesting_period}s`) / timeDiff(vestingStart, `${vesting_period}s`, vestingUntil), decimals)), config };
};

module.exports = async params => {
  let { symbol, debug } = { ...params };
  symbol = symbol || 'AXL';
  debug = toBoolean(debug, false);

  const assetData = await getAssetData(symbol);
  const { denom, decimals } = { ...assetData };

  let circulating_supply;
  switch (symbol) {
    case 'AXL':
      const totalSupply = await getTotalSupply({ asset: denom });
      const inflationRewards = totalSupply > max_supply ? parseFloat(toFixed(totalSupply - max_supply, decimals)) : 0;
      const initialUnlocked = parseFloat(toFixed(max_supply * initial_unlocked_percent / 100, decimals));

      const communitySale = calculateVesting(community_sale, assetData);
      const communityPrograms = calculateVesting(community_programs, assetData);
      const companyOperations = calculateVesting(company_operations, assetData);
      const _backers = calculateVesting(backers, assetData);
      const _team = calculateVesting(team, assetData);

      circulating_supply = inflationRewards + initialUnlocked + communitySale?.unlocked + communityPrograms?.unlocked + companyOperations?.unlocked + _backers?.unlocked + _team?.unlocked;
      return !debug ? circulating_supply : { circulating_supply, inflation_rewards: inflationRewards, initial_unlocked: initialUnlocked, community_sale: communitySale, community_programs: communityPrograms, company_operations: companyOperations, backers: _backers, team: _team };
    default:
      if (denom) {
        const response = await getTVL({ asset: denom });
        const { total, total_on_evm, total_on_cosmos } = { ..._.head(response?.data) };
        const isNative = !symbol?.startsWith('axl');

        circulating_supply = isNative ? total : total_on_evm + total_on_cosmos;
        return !debug ? circulating_supply : { symbol, circulating_supply, ...(isNative ? { total } : { total_on_evm, total_on_cosmos }), ...response };
      }
      return;
  }
};