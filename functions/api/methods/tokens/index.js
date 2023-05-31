const axios = require('axios');
const _ = require('lodash');
const moment = require('moment');

const { get, write } = require('../../services/index');
const { TOKEN_COLLECTION, CURRENCY, getAssetData, getTokens } = require('../../utils/config');
const { toArray } = require('../../utils');

// config
const tokens = getTokens();

const PRICE_ORACLE_API = process.env.PRICE_ORACLE_API || 'https://api.coingecko.com/api/v3/';
const COLLECTION = TOKEN_COLLECTION;

const getTokenConfig = symbol => {
  const token = tokens[symbol] || getAssetData(symbol);
  const { redirect } = { ...token };
  return redirect ? getTokenConfig(redirect) : token;
};

const getTokensPrice = async (symbols, timestamp = moment(), currency = CURRENCY) => {
  let tokens_data = toArray(toArray(symbols).map(s => getTokenConfig(s)));

  if (tokens_data.findIndex(t => t.coingecko_id) > -1) {
    const api = axios.create({ baseURL: PRICE_ORACLE_API, timeout: 5000 });

    // query historical price
    if (timestamp && moment().diff(moment(timestamp), 'hours') > 4) {
      for (let i = 0; i < tokens_data.length; i++) {
        const token_data = tokens_data[i];
        const { coingecko_id } = { ...token_data };

        if (coingecko_id) {
          const response = await api.get(
            `/coins/${coingecko_id}/history`,
            {
              params: {
                id: coingecko_id,
                date: moment(timestamp).format('DD-MM-YYYY'),
                localization: 'false',
              },
            },
          ).catch(error => { return { error: error?.response?.data }; });
          const { data, error } = { ...response };
          const { market_data } = { ...data };

          if (data && !error) {
            const { current_price } = { ...market_data };
            tokens_data[i] = {
              ...token_data,
              price: current_price?.[currency],
            };
          }
        }
      }
    }

    // query current price
    if (tokens_data.findIndex(t => typeof t.price !== 'number') > -1) {
      const ids = _.uniq(tokens_data.map(t => t.coingecko_id).filter(id => id));

      let response;
      let cache;
      const cache_id = toArray(ids, 'lower').join('_');

      // get price from cache
      try {
        cache = await get(COLLECTION, cache_id);
        const { data, updated_at } = { ...cache };
        if (data && updated_at && moment().diff(moment(updated_at), 'minutes', true) <= 5) {
          response = cache;
        }
      } catch (error) {}

      // get price from api when cache miss
      if (!response) {
        response = await api.get(
          '/simple/price',
          {
            params: {
              ids: ids.join(','),
              vs_currencies: currency,
            },
          },
        ).catch(error => { return { error: error?.response?.data }; });
        const { data, error } = { ...response };

        if (data && !error && tokens_data.findIndex(t => !data[t.coingecko_id]?.[currency]) < 0) {
          await write(COLLECTION, cache_id, { data, updated_at: moment().valueOf() });
        }
        else {
          response = cache;
        }
      }

      const { data } = { ...response };
      const { error } = { ...data };
      if (data && !error) {
        tokens_data = tokens_data.map(t => {
          const { coingecko_id, price } = { ...t };
          return {
            ...t,
            price: data[coingecko_id]?.[currency] || price,
          };
        });
      }
    }
  }

  // set default price if cannot get price
  const prices = tokens_data.map(t => {
    const { price, default_price } = { ...t };
    return {
      ...t,
      price: typeof price !== 'number' && typeof default_price?.[currency] === 'number' ? default_price[currency] : price,
    };
  }).map(t => t.price);
  return typeof symbols === 'string' && prices.length === 1 ? _.head(prices) : prices;
};

module.exports = {
  getTokenConfig,
  getTokensPrice,
};