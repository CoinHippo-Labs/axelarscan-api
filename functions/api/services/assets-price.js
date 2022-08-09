const axios = require('axios');
const _ = require('lodash');
const moment = require('moment');
const config = require('config-yml');
const { crud } = require('./index');
const { assets } = require('../data');
const { equals_ignore_case } = require('../utils');

// initial environment
const environment = process.env.ENVIRONMENT || config?.environment;
// initial assets
const _assets = assets?.[environment];
// initial default currency
const currency = 'usd';
// initial stablecoin threshold
const stablecoin_threshold = 0.01;
// initial collection
const collection = 'assets';

module.exports = async (params = {}) => {
  // initial response
  let response;
  // initial current time
  const current_time = moment();

  // initial parameters
  const { chain, denom, timestamp } = { ...params };
  let { denoms } = { ...params };
  denoms = _.uniq((Array.isArray(denoms) ? denoms : (denoms || denom)?.split(',') || []).map(d => {
    if (typeof d === 'object') {
      return d;
    }
    return d?.trim().toLowerCase();
  }).filter(d => d));

  if (denoms.length > 0) {
    const price_timestamp = moment(Number(timestamp) || current_time.valueOf()).startOf('day').valueOf();
    const query = {
      bool: {
        must: [
          { match: { price_timestamp } },
        ],
        should: denoms.map(d => {
          return {
            match: { denoms: typeof d === 'object' ? d?.denom : d },
          };
        }),
      },
    };
    const response_cache = current_time.diff(moment(price_timestamp), 'hours') > 4 && await crud({
      collection,
      method: 'search',
      query,
      size: denoms.length,
    });
    const data = denoms.map(d => {
      const denom_data = typeof d === 'object' ? d : { denom: d };
      const _denom = denom_data?.denom || d;
      const _chain = _denom === 'uluna' && !['terra-2'].includes(chain) ? 'terra' : denom_data?.chain || chain;
      const asset_data = _assets?.find(a => equals_ignore_case(a?.id, _denom));
      const { coingecko_id, coingecko_ids, is_stablecoin } = { ...asset_data };
      const _d = {
        denom: _denom,
        coingecko_id: coingecko_ids?.[_chain] || coingecko_id,
        price: is_stablecoin ? 1 : undefined,
      };
      return _d;
    });
    response_cache?.data?.filter(a => a).forEach(a => {
      const data_index = data.findIndex(d => equals_ignore_case(d.denom, a?.denom));
      if (data_index > -1) {
        data[data_index] = { ...data[data_index], ...a };
      }
    });

    const updated_at_threshold = current_time.subtract(1, 'hours').valueOf();
    const to_update_data = data.filter(d => !d?.updated_at || d.updated_at < updated_at_threshold);
    const coingecko_ids = to_update_data.map(d => d?.coingecko_id).filter(id => id);
    if (coingecko_ids.length > 0 && config?.external_api?.endpoints?.coingecko) {
      const coingecko = axios.create({ baseURL: config.external_api.endpoints.coingecko });
      // initial assets data
      let assets_data;
      if (timestamp) {
        for (let i = 0; i < coingecko_ids.length; i++) {
          const coingecko_id = coingecko_ids[i];
          // request coingecko
          const _response = await coingecko.get(`/coins/${coingecko_id}/history`, {
            params: {
              id: coingecko_id,
              date: moment(Number(timestamp)).format('DD-MM-YYYY'),
              localization: 'false',
            }
          }).catch(error => { return { data: { error } }; });
          assets_data = _.concat(assets_data || [], [_response?.data]);
        }
      }
      else {
        // request coingecko
        const _response = await coingecko.get('/coins/markets', {
          params: {
            vs_currency: currency,
            ids: coingecko_ids.join(','),
            per_page: 250,
          }
        }).catch(error => { return { data: { error } }; });
        assets_data = _response?.data || [];
      }
      // update data from coingecko
      assets_data?.filter(a => a).map(a => {
        const asset = _assets?.find(_a => _a?.coingecko_id === a.id);
        let price = a.market_data?.current_price?.[currency] || a.current_price;
        price = asset?.is_stablecoin && Math.abs(price - 1) > stablecoin_threshold ? 1 : price;
        return {
          denom: to_update_data?.find(d => equals_ignore_case(d?.coingecko_id, a.id))?.denom,
          coingecko_id: a.id,
          price,
        };
      }).forEach(a => {
        const data_index = data.findIndex(d => equals_ignore_case(d.denom, a?.denom));
        if (data_index > -1) {
          data[data_index] = { ...data[data_index], ...a };
        }
      });
    }

    const to_update_cache = data.filter(d => (!d?.updated_at || d.updated_at < updated_at_threshold) && ('symbol' in d));
    to_update_cache.forEach(d => {
      d.updated_at = moment().valueOf();
      const price_timestamp = moment(Number(timestamp) || d.updated_at).startOf('day').valueOf();
      d.price_timestamp = price_timestamp;
      const id = `${d?.denom}_${price_timestamp}`;
      // save asset
      crud({
        collection,
        method: 'set',
        path: `/${collection}/_update/${id}`,
        ...d,
        id,
      });
    });
    response = data.map(d => {
      return {
        ...d,
        id: d.denom || d.id,
      };
    });
  }

  return response;
};