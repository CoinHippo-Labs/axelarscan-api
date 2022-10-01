const axios = require('axios');
const _ = require('lodash');
const moment = require('moment');
const config = require('config-yml');
const index_tx = require('./tx');
const index_txs = require('./txs');
const index_block = require('./block');
const index_ibc_channels = require('./ibc/channels');
const index_batch = require('./batch');
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
  cache_timeout = 60,
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
      [
        '/cosmos/tx/v1beta1/txs',
        '/cosmos/base/tendermint/v1beta1/blocks',
        '/axelar/evm/v1beta1/batched_commands',
      ].findIndex(p => path.startsWith(p)) > -1
    ) {
      cache = false;
    }

    // always cache with minimum timeout
    if (
      cache_id &&
      !cache &&
      Object.keys({ ...params })
        .findIndex(k => k?.includes('pagination')) < 0
    ) {
      cache = true;
      cache_timeout = 5;
    }

    // set min / max cache timeout
    if (cache_timeout < 5) {
      cache_timeout = 5;
    }
    else if (cache_timeout > 300) {
      cache_timeout = 300;
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

      if (
        response_cache &&
        moment().diff(moment(updated_at * 1000), 'seconds', true) <= cache_timeout
      ) {
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

      let {
        data,
      } = { ..._response };
      const {
        error,
      } = { ...data };

      if (error) {
        if (path.startsWith('/cosmos/tx/v1beta1/txs')) {
          const {
            events,
          } = { ...params };

          const hash = _.last(
            path.split('/')
              .filter(s => s)
          );

          const height = typeof events === 'string' &&
            events.startsWith('tx.height=') &&
            Number(_.last(events.split('=')));

          if (
            hash &&
            hash !== 'txs' &&
            endpoints.cosmostation
          ) {
            const api = endpoints.cosmostation;

            const cosmostation = axios.create({ baseURL: api });
            const _path = `/tx/hash/${hash}`;

            const __response = await cosmostation.get(
              _path,
            ).catch(error => { return { data: { error } }; });

            const {
              tx,
            } = { ...__response?.data?.data };

            if (tx) {
              data = {
                url: `${api}${_path}`,
                tx_response: __response.data.data,
                tx,
              };
            }
          }
          else if (
            !isNaN(height) &&
            endpoints.mintscan?.api
          ) {
            const {
              api,
              chain_id,
            } = { ...endpoints.mintscan };

            const mintscan = axios.create({ baseURL: api });
            const _path = `/block/${chain_id}/${height}`;

            const __response = await mintscan.get(
              _path,
            ).catch(error => { return { data: { error } }; });

            const {
              txs,
            } = { ..._.head(__response?.data) };

            if (txs) {
              data = {
                url: `${api}${_path}`,
                tx_responses: txs.map(d => {
                  const {
                    data,
                  } = { ...d };

                  return {
                    ...data,
                  };
                }),
                txs: txs.map(d => {
                  const {
                    tx,
                  } = { ...d?.data };

                  return {
                    ...tx,
                  };
                }),
              };
            }
          }
        }
      }

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
      command_ids,
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
    else if (
      path.startsWith('/axelar/evm/v1beta1/batched_commands/') &&
      !path.endsWith('/') &&
      command_ids
    ) {
      response = await index_batch(
        path,
        response,
        created_at,
      );
    }

    response = {
      ...response,
      cache_hit,
    };
  }

  return response;
};