const _ = require('lodash');
const moment = require('moment');

const getTotalSupply = require('./getTotalSupply');
const { getTVL } = require('../tvl');
const { getAssetData, getSupply } = require('../../utils/config');
const { equalsIgnoreCase, fixDecimals } = require('../../utils');

const supply = getSupply();
const { max_supply, initial_unlocked_percent } = { ...supply };

const calculateVesting = (config, asset_data) => {
  const { total_unlock_percent, vesting_period, vesting_start, vesting_until } = { ...config };
  const { decimals } = { ...(asset_data || getAssetData('uaxl')) };
  const total = fixDecimals(max_supply * total_unlock_percent / 100, decimals);
  const current_time = moment();
  const vesting_start_time = moment(vesting_start, 'YYYY-MM-DD').startOf('day');
  const vesting_until_time = moment(vesting_until, 'YYYY-MM-DD').startOf('day');
  return {
    total,
    unlocked: current_time.valueOf() >= vesting_until_time.valueOf() ? total : current_time.valueOf() <= vesting_start_time.valueOf() ? 0 : fixDecimals(total * current_time.diff(vesting_start_time, `${vesting_period}s`) / vesting_until_time.diff(vesting_start_time, `${vesting_period}s`), decimals),
    config,
  };
};

module.exports = async (params = {}) => {
  let { symbol, debug } = { ...params };
  symbol = symbol || 'AXL';
  debug = typeof debug === 'boolean' ? debug : equalsIgnoreCase(debug, 'true');
  const { denom, decimals } = { ...getAssetData(symbol) };

  let circulating_supply;
  switch (symbol) {
    case 'AXL':
      const total_supply = await getTotalSupply({ asset: denom });
      const inflation_rewards = typeof total_supply === 'number' && total_supply > max_supply ? fixDecimals(total_supply - max_supply, decimals) : 0;
      const initial_unlocked = fixDecimals(max_supply * initial_unlocked_percent / 100, decimals);

      const community_sale = calculateVesting(supply?.community_sale);
      const community_programs = calculateVesting(supply?.community_programs);
      const company_operations = calculateVesting(supply?.company_operations);
      const backers = calculateVesting(supply?.backers);
      const team = calculateVesting(supply?.team);

      circulating_supply = inflation_rewards + initial_unlocked + community_sale?.unlocked + community_programs?.unlocked + company_operations?.unlocked + backers?.unlocked + team?.unlocked;
      return debug ?
        {
          circulating_supply,
          inflation_rewards,
          initial_unlocked,
          community_sale,
          community_programs,
          company_operations,
          backers,
          team,
        } :
        circulating_supply;
    default:
      if (denom) {
        const tvl_data = await getTVL({ asset: denom });
        const { data } = { ...tvl_data };
        const { total, total_on_evm, total_on_cosmos } = { ..._.head(data) };
        const isNative = !symbol?.startsWith('axl');
        circulating_supply = isNative ? total : total_on_evm + total_on_cosmos;
        return debug ?
          {
            symbol,
            circulating_supply,
            ...(isNative ? { total } : { total_on_evm, total_on_cosmos }),
            ...tvl_data,
          } :
          circulating_supply;
      }
      return;
  }
};