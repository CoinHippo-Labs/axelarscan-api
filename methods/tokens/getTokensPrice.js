const _ = require('lodash');
const moment = require('moment');

const { get, write } = require('../../services/indexer');
const { TOKEN_PRICE_COLLECTION, PRICE_ORACLE_API, CURRENCY, getAssetsList, getAssetData, getITSAssetsList, getITSAssetData, getTokens } = require('../../utils/config');
const { request } = require('../../utils/http');
const { toArray } = require('../../utils/parser');
const { equalsIgnoreCase, lastString } = require('../../utils/string');
const { isNumber, toNumber } = require('../../utils/number');
const { timeDiff } = require('../../utils/time');

const tokens = getTokens();

const getTokenConfig = async (symbol, additionalAssetsData, notGetAssetConfig = false) => {
  const tokenData = tokens[symbol] || _.last(Object.entries(tokens).find(([k, v]) => equalsIgnoreCase(k, lastString(symbol, '/')))) || (!notGetAssetConfig ? await getAssetData(symbol, additionalAssetsData) || await getITSAssetData(symbol, additionalAssetsData) : undefined);
  const { redirect } = { ...tokenData };
  return { ...(redirect ? await getTokenConfig(redirect, additionalAssetsData, notGetAssetConfig) : tokenData) };
};

module.exports = async ({ symbols, symbol, timestamp = moment(), currency = CURRENCY, debug = false }) => {
  symbols = _.uniq(toArray(_.concat(symbols, symbol)));
  const assetsData = toArray(await Promise.all(toArray(symbols).map(s => new Promise(async resolve => resolve(Object.keys(await getTokenConfig(s, undefined, true)).length === 0))))).length > 0 ? toArray(_.concat(await Promise.all([0, 1].map(i => new Promise(async resolve => resolve(i === 0 ? await getAssetsList() : await getITSAssetsList())))))).flatMap(d => d) : undefined;

  let updatedAt;
  let tokensData = await Promise.all(toArray(symbols).map(s => new Promise(async resolve => resolve({ symbol: s, ...await getTokenConfig(s, assetsData) }))));
  if (tokensData.findIndex(d => d.coingecko_id) > -1) {
    // query historical price
    if (timeDiff(timestamp, 'hours') > 4) {
      for (let i = 0; i < tokensData.length; i++) {
        const tokenData = tokensData[i];
        const { coingecko_id } = { ...tokenData };
        if (coingecko_id) {
          const { market_data } = { ...await request(PRICE_ORACLE_API, { path: `/coins/${coingecko_id}/history`, params: { id: coingecko_id, date: moment(timestamp).format('DD-MM-YYYY'), localization: 'false' } }) };
          if (market_data?.current_price) tokensData[i] = { ...tokenData, price: market_data.current_price[currency] };
        }
      }
    }

    // query current price
    if (tokensData.findIndex(d => !isNumber(d.price)) > -1) {
      const ids = _.uniq(toArray(tokensData.map(d => d.coingecko_id)));
      const cacheId = toArray(ids, { toCase: 'lower' }).join('_');

      let response;
      // get price from cache
      const { data, updated_at } = { ...await get(TOKEN_PRICE_COLLECTION, cacheId) };
      if (data && timeDiff(updated_at) < 300) {
        response = data;
        updatedAt = updated_at;
      }
      // get from api when cache missed
      else {
        response = await request(PRICE_ORACLE_API, { path: '/simple/price', params: { ids: ids.join(','), vs_currencies: currency } });
        if (response && tokensData.findIndex(d => !response[d.coingecko_id]?.[currency]) < 0) await write(TOKEN_PRICE_COLLECTION, cacheId, { data: response, updated_at: moment().valueOf() });
        else if (Object.keys({ ...data }).length > 0) {
          response = data;
          updatedAt = updated_at;
        }
      }

      if (response && !response.error) tokensData = tokensData.map(d => { return { ...d, price: response[d.coingecko_id]?.[currency] || d.price }; });
    }
  }
  // set default price if cannot get price
  tokensData = tokensData.map(d => { return { ...d, price: !isNumber(d.price) && isNumber(d.default_price?.[currency]) ? toNumber(d.default_price[currency]) : d.price }; });
  const tokensMap = Object.fromEntries(tokensData.map(d => [d.symbol, d]));
  return debug ? { data: tokensMap, updated_at: updatedAt } : tokensMap;
};