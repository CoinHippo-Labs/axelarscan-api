const axios = require('axios');
const _ = require('lodash');
const moment = require('moment');

const indexTransaction = require('./tx');
const indexTransactions = require('./txs');
const {
  saveBlock,
  saveUptime,
  addBlockEvents,
} = require('./block');
const {
  saveBatch,
  updateTransfer,
} = require('./batch');
const {
  saveIBCChannels,
} = require('./ibc');
const {
  get,
  write,
} = require('../../services/index');
const {
  LCD_CACHE_COLLECTION,
  getEndpoints,
  getLCD,
} = require('../../utils/config');
const {
  toArray,
  toJson,
} = require('../../utils');

const endpoints = getEndpoints();

module.exports = async (
  path = '',
  params = {},
  cache_age_seconds = 10,
) => {
  let output;

  const lcd = getLCD() && axios.create({ baseURL: getLCD(), timeout: 5000, headers: { 'Accept-Encoding': 'gzip' } });

  if (lcd) {
    let cache;
    let cache_hit = false;
    const cache_id = toArray(path, 'lower', '/').join('_');

    // query cache
    if (cache_id && Object.keys({ ...params }).findIndex(k => ['pagination', 'events', 'subspace'].findIndex(s => k.includes(s)) > -1) < 0) {
      cache = await get(LCD_CACHE_COLLECTION, cache_id);

      const {
        updated_at,
      } = { ...cache };

      cache = toJson(cache?.response);

      if (cache && moment().diff(moment(updated_at * 1000), 'seconds', true) <= cache_age_seconds) {
        output = cache;
        cache_hit = true;
      }
    }

    // cache miss
    if (!output) {
      const response = await lcd.get(path, { params }).catch(error => { return { error: error?.response?.data }; });

      const {
        error,
      } = { ...response };
      let {
        data,
      } = { ...response };

      // fallback
      if (error) {
        if (path.startsWith('/cosmos/tx/v1beta1/txs')) {
          const {
            events,
          } = { ...params };

          const height = typeof events === 'string' && events.startsWith('tx.height=') && Number(_.last(toArray(events, 'normal', '=')));

          if (typeof height === 'number' && !isNaN(height)) {
            const {
              api,
              chain_id,
            } = { ...endpoints?.mintscan };

            const mintscan = api && axios.create({ baseURL: api, timeout: 5000 });

            if (mintscan) {
              const path = `/block/${chain_id}/${height}`;
              const response = await mintscan.get(path).catch(error => { return { error: error?.response?.data }; });

              const {
                txs,
              } = { ..._.head(response?.data) };

              if (txs) {
                data = {
                  url: `${api}${path}`,
                  tx_responses: toArray(txs).map(d => { return { ...d.data }; }),
                  txs: toArray(txs).map(d => { return { ...d.data?.tx }; }),
                };
              }
            }
          }
        }
      }

      output = data;
    }

    if (output) {
      // cache
      if (!cache_hit) {
        await write(
          LCD_CACHE_COLLECTION,
          cache_id,
          {
            response: JSON.stringify(output),
            updated_at: moment().unix(),
          },
        );
      }
    }
    else if (cache) {
      output = cache;
    }

    const {
      index,
      created_at,
    } = { ...params };

    const {
      tx_response,
      tx_responses,
      block,
      channels,
      command_ids,
    } = { ...output };

    if (path.startsWith('/cosmos/tx/v1beta1/txs/') && !path.endsWith('/') && tx_response?.txhash) {
      if (index) {
        output = await indexTransaction(output);
      }
    }
    else if (path.startsWith('/cosmos/tx/v1beta1/txs') && !path.endsWith('/') && toArray(tx_responses).length > 0) {
      if (index) {
        output = await indexTransactions(output, params);
      }
    }
    else if (path.startsWith('/cosmos/base/tendermint/v1beta1/blocks/') && !path.endsWith('/') && block?.header?.height) {
      if (index) {
        output = await saveBlock(output);
        output = await saveUptime(output);
      }

      output = await addBlockEvents(output);
    }
    else if (path.startsWith('/axelar/evm/v1beta1/batched_commands/') && !path.endsWith('/') && command_ids) {
      if (index) {
        output = await saveBatch(path, output);
        output = await updateTransfer(output, created_at);
      }
    }
    else if (path === '/ibc/core/channel/v1/channels' && channels) {
      output = await saveIBCChannels(path, output);
    }

    if (!index) {
      output = {
        ...output,
        cache_hit,
      };
    }
  }

  return output;
};