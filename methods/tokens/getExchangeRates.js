const moment = require('moment');

const { get, write } = require('../../services/indexer');
const { EXCHANGE_RATE_COLLECTION, PRICE_ORACLE_API } = require('../../utils/config');
const { request } = require('../../utils/http');
const { timeDiff } = require('../../utils/time');

module.exports = async () => {
  const cacheId = 'rates';
  let cache;
  // get rates from cache
  cache = await get(EXCHANGE_RATE_COLLECTION, cacheId);
  const { data, updated_at } = { ...cache };
  if (data && timeDiff(updated_at) < 300) return data;

  // get rates from api when cache miss
  let response = await request(PRICE_ORACLE_API, { path: '/exchange_rates' });
  const { error } = { ...response };
  if (response?.rates && !error) {
    response = response.rates;
    await write(EXCHANGE_RATE_COLLECTION, cacheId, { data: response, updated_at: moment().valueOf() });
  }
  else response = Object.keys({ ...data }).length > 0 ? data : response?.rates;
  return response;
};