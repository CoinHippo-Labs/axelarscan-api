const moment = require('moment');

const getCirculatingSupply = require('./getCirculatingSupply');
const getTotalSupply = require('./getTotalSupply');
const { getTokensPrice, getExchangeRates } = require('../tokens');
const { CURRENCY, getAssetData } = require('../../utils/config');

const { denom, symbol, name, coingecko_id } = { ...getAssetData('uaxl') };

module.exports = async (params = {}) => {
  const { agent } = { ...params };

  const { data, updated_at } = { ...await getTokensPrice(symbol, moment(), CURRENCY, true) };
  const price = data?.[coingecko_id]?.[CURRENCY];
  const circulatingSupply = await getCirculatingSupply();
  const totalSupply = await getTotalSupply({ asset: denom });
  const updatedAt = updated_at || moment().valueOf();

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
        totalSupply,
        updatedAt,
      };
  }
};