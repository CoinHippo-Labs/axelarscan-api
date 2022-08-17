const axios = require('axios');
const moment = require('moment');
const config = require('config-yml');
const index_tx = require('./tx');
const index_txs = require('./txs');
const index_block = require('./block');
const index_ibc_channels = require('./ibc/channels');
const {
  get,
  write,
} = require('../index');
const {
  to_json,
} = require('../../utils');

const environment = process.env.ENVIRONMENT || config?.environment;

const {
  endpoints,
} = { ...config?.[environment] };

module.exports = async (
  path = '',
  params = {},
  cache = false,
  cache_timeout = 1,
  no_index = false,
) => {
  let response,
    cache_hit = false;

  if (endpoints?.lcd) {
    const lcd = axios.create({ baseURL: endpoints.lcd });

    const {
      cmd,
    } = { ...params };
    let {
      created_at,
    } = { ...params };

    const cache_id = path
      .split('/')
      .filter(p => p)
      .join('_')
      .toLowerCase();
    let response_cache;

    if (!cache) {
      if (Object.keys(params).length < 1) {
        cache = true;
      }
    }

    if (!cache_id ||
      path.startsWith('/cosmos/tx/v1beta1/txs') ||
      path.startsWith('/cosmos/base/tendermint/v1beta1/blocks')
    ) {
      cache = false;
    }

    // get from cache
    if (cache) {
      response_cache = await get(
        'cosmos',
        cache_id,
      );

      const {
        updated_at,
      } = { ...response_cache };

      response_cache = to_json(response_cache?.response);

      if (response_cache && moment().diff(moment(updated_at * 1000), 'minutes', true) <= cache_timeout) {
        response = response_cache;
        cache_hit = true;
      }
    }

    // cache miss
    if (!response) {
      const _response = await lcd.get(
        path,
        { params },
      ).catch(error => { return { data: { error } }; });

      const {
        data,
      } = { ..._response };

      response = data;
    }

    if (response) {
      // save cache
      if (cache && !cache_hit) {
        await write(
          'cosmos',
          cache_id,
          {
            response: JSON.stringify(response),
            updated_at: moment().unix(),
          },
        );
      }
    }
    else if (response_cache) {
      response = response_cache;
    }

    const {
      tx_response,
      tx_responses,
      block,
      channels,
    } = { ...response };

    if (
      path.startsWith('/cosmos/tx/v1beta1/txs/') &&
      !path.endsWith('/') &&
      tx_response?.txhash
    ) {
      response = await index_tx(response);
    }
    else if (
      path.startsWith('/cosmos/tx/v1beta1/txs') &&
      !path.endsWith('/') &&
      tx_responses?.length > 0
    ) {
      if (!no_index) {
        response = await index_txs(response);
      }
    }
    else if (
      path.startsWith('/cosmos/base/tendermint/v1beta1/blocks/') &&
      !path.endsWith('/') &&
      block?.header?.height
    ) {
      response = await index_block(response);
    }
    else if (
      path === '/ibc/core/channel/v1/channels' &&
      channels
    ) {
      response = await index_ibc_channels(
        path,
        response,
      );
    }

    response = {
      ...response,
      cache_hit,
    };
  }

  return response;
};