const moment = require('moment');

const getCirculatingSupply = require('./getCirculatingSupply');
const getTotalSupply = require('./getTotalSupply');
const { getTokensPrice, getExchangeRates } = require('../tokens');
const { CURRENCY, getAssetData } = require('../../utils/config');

module.exports = async (params = {}) => {
  const { agent } = { ...params };
  let { symbol } = { ...params };
  symbol = symbol || 'AXL';

  const { denom, name, coingecko_id } = { ...getAssetData(symbol) };
  const { data, updated_at } = { ...await getTokensPrice(symbol, moment(), CURRENCY, true) };
  const price = data?.[coingecko_id]?.[CURRENCY];
  const supplyData = await getCirculatingSupply({ symbol, debug: true });
  const circulatingSupply = supplyData?.circulating_supply;
  const totalSupply = denom === 'uaxl' ? await getTotalSupply({ asset: denom }) : null;
  const updatedAt = supplyData?.updated_at || updated_at || moment().valueOf();

  switch (agent) {
    case 'upbit':
      const exchangeRates = (await getExchangeRates())?.data;
      return ['KRW', 'USD', 'IDR', 'SGD', 'THB'].map(currencyCode => {
        const currency = currencyCode.toLowerCase();
        const _price = price * (exchangeRates?.[currency] && currency !== CURRENCY ? exchangeRates[currency].value / exchangeRates[CURRENCY].value : 1);
        return {
          symbol,
          currencyCode,
          price: _price,
          marketCap: circulatingSupply * _price,
          circulatingSupply,
          maxSupply: totalSupply,
          provider: name,
          lastUpdatedTimestamp: updatedAt,
        };
      });
    default:
      return {
        symbol,
        name,
        price,
        marketCap: circulatingSupply * price,
        circulatingSupply,
        maxSupply: totalSupply,
        updatedAt,
      };
  }
};