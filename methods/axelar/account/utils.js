const _ = require('lodash');

const { getTokensPrice } = require('../../tokens');
const { getAssetData } = require('../../../utils/config');
const { toArray } = require('../../../utils/parser');
const { isNumber, formatUnits } = require('../../../utils/number');

const aggregate = async (data, assetsData, options) => Object.entries(_.groupBy(await Promise.all(toArray(data).filter(d => isNumber(d.amount)).map(d => new Promise(async resolve => {
  const { includesValue } = { ...options };
  const assetData = await getAssetData(d.denom, assetsData);
  const { denom, symbol, decimals } = { ...assetData };

  const amount = formatUnits(d.amount, decimals || 6);
  const { price } = { ...(includesValue ? (await getTokensPrice({ symbol: denom }))?.[denom] : undefined) };
  const value = isNumber(price) ? amount * price : undefined;
  resolve({ ...d, symbol, amount, price, value, asset_data: assetData });
}))), 'denom')).map(([k, v]) => { return { denom: k, ..._.head(v), amount: _.sumBy(v, 'amount'), value: _.sumBy(v, 'value') }; });

module.exports = {
  aggregate,
};