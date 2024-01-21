const _ = require('lodash');
const moment = require('moment');

const getBroadcasters = require('../getBroadcasters');
const searchUptimes = require('../searchUptimes');
const searchHeartbeats = require('../searchHeartbeats');
const rpc = require('../../rpc');
const lcd = require('../../lcd');
const { get, write } = require('../../../services/index');
const { LCD_CACHE_COLLECTION, getChainData } = require('../../../utils/config');
const { pubKeyToBech32 } = require('../../../utils/bech32');
const { getDelegatorAddress } = require('../../../utils/address');
const { numberFormatUnits } = require('../../../utils/number');
const { equalsIgnoreCase, toArray, toJson } = require('../../../utils');

const NUM_UPTIME_BLOCKS = 10000;

module.exports = async (params, cache_age_seconds = 60) => {
  let output;

  let { includes } = { ...params };
  let cache;
  let cache_hit = false;
  const cache_id = !includes ? 'getValidators' : undefined;

  // query cache
  if (cache_id) {
    cache = await get(LCD_CACHE_COLLECTION, cache_id);
    const { updated_at } = { ...cache };
    cache = toJson(cache?.response);
    if (cache && moment().diff(moment(updated_at * 1000), 'seconds', true) <= cache_age_seconds) {
      output = cache;
      cache_hit = true;
    }
  }

  if (!output) {
    includes = toArray(includes || ['uptimes', 'slash_infos', 'broadcasters', 'status']);
    const { prefix_address } = { ...getChainData('axelarnet') };

    let validators_data;
    let page_key = true;
    while (page_key) {
      const response = await lcd('/cosmos/staking/v1beta1/validators', { 'pagination.key': page_key && typeof page_key === 'string' ? page_key : undefined });
      const { validators, pagination } = { ...response };
      validators_data = _.orderBy(
        _.uniqBy(
          _.concat(
            toArray(validators_data),
            await Promise.all(
              toArray(validators).map(d =>
                new Promise(
                  async resolve => {
                    const { consensus_pubkey, operator_address, tokens, delegator_shares, min_self_delegation } = { ...d };
                    const { key } = { ...consensus_pubkey };

                    d.tokens = numberFormatUnits(tokens);
                    d.quadratic_voting_power = Math.floor(Math.sqrt(d.tokens));
                    d.delegator_shares = numberFormatUnits(delegator_shares);
                    d.min_self_delegation = numberFormatUnits(min_self_delegation);

                    if (key) {
                      d.consensus_address = pubKeyToBech32(key, `${prefix_address}valcons`);
                    }
                    if (operator_address) {
                      d.delegator_address = getDelegatorAddress(operator_address);
                    }

                    if (d.delegator_address) {
                      const response = await lcd(`/cosmos/staking/v1beta1/validators/${operator_address}/delegations/${d.delegator_address}`);
                      const { shares } = { ...response?.delegation_response?.delegation };
                      d.self_delegation = numberFormatUnits(shares);
                    }
                    resolve(d);
                  }
                )
              )
            ),
          ),
          'operator_address',
        ),
        ['description.moniker'], ['asc'],
      );
      page_key = pagination?.next_key;
    }

    if (toArray(validators_data).length > 0) {
      for (const include of includes) {
        switch (include) {
          case 'uptimes':
            try {
              const response = await rpc('/status');
              let { latest_block_height } = { ...response };
              latest_block_height = Number(latest_block_height);
              const _response = await searchUptimes({
                fromBlock: latest_block_height - NUM_UPTIME_BLOCKS,
                aggs: {
                  uptimes: {
                    terms: { field: 'validators.keyword', size: validators_data.length },
                  },
                },
                size: 0,
              });
              const { data, total } = { ..._response };
              if (data && total > 0) {
                validators_data = validators_data.map(d => {
                  const { consensus_address } = { ...d };
                  let uptime = (data[consensus_address] || 0) * 100 / (total || NUM_UPTIME_BLOCKS);
                  uptime = typeof uptime === 'number' ? uptime > 100 ? 100 : uptime < 0 ? 0 : uptime : undefined;
                  return { ...d, uptime };
                });
              }
            } catch (error) {}
            break;
          case 'slash_infos':
            try {
              page_key = true;
              while (page_key) {
                const response = await lcd('/cosmos/slashing/v1beta1/signing_infos', { 'pagination.key': page_key && typeof page_key === 'string' ? page_key : undefined });
                const { info, pagination } = { ...response };
                if (info) {
                  validators_data = validators_data.map(d => {
                    const { consensus_address } = { ...d };
                    const _info = toArray(info).find(i => equalsIgnoreCase(i.address, consensus_address));
                    if (_info) {
                      const { start_height, start_proxy_height, jailed_until, tombstoned, missed_blocks_counter } = { ..._info };
                      d = {
                        ...d,
                        start_height: Number(start_height),
                        start_proxy_height: Number(start_proxy_height || start_height),
                        jailed_until: jailed_until && moment(jailed_until).valueOf(),
                        tombstoned: typeof tombstoned === 'boolean' ? tombstoned : undefined,
                        missed_blocks_counter: Number(missed_blocks_counter),
                      };
                    }
                    return d;
                  });
                }
                page_key = pagination?.next_key;
              }
            } catch (error) {}
            break;
          case 'broadcasters':
            try {
              const response = await getBroadcasters();
              if (response) {
                validators_data = validators_data.map(d => {
                  const { operator_address, start_proxy_height } = { ...d };
                  const broadcaster = response[operator_address?.toLowerCase()];
                  if (broadcaster) {
                    const { address, height } = { ...broadcaster };
                    d = {
                      ...d,
                      broadcaster_address: address,
                      start_proxy_height: Number(height || start_proxy_height),
                    };
                  }
                  return d;
                });
              }
            } catch (error) {}
            break;
          case 'status':
            try {
              let { latest_block_height } = { ...await rpc('/status') };
              latest_block_height = Number(latest_block_height);
              const response = await searchHeartbeats({ fromBlock: latest_block_height - NUM_UPTIME_BLOCKS, aggs: { heartbeats: { terms: { field: 'sender.keyword', size: validators_data.length + 10 }, aggs: { period_height: { terms: { field: 'period_height', size: 1000 } } } } } });
              const { data } = { ...response };
              validators_data = validators_data.map(d => {
                const uptime = Number(data.find(_d => equalsIgnoreCase(_d.key, d.broadcaster_address))?.count) * 100 / 200;
                return { ...d, heartbeat_uptime: uptime > 100 ? 100 : uptime };
              });
            } catch (error) {}
            try {
              const response = await searchHeartbeats({ size: validators_data.length * 5 });
              const { data } = { ...response };
              if (toArray(data).length > 0) {
                validators_data = validators_data.map(d => {
                  const { broadcaster_address } = { ...d };
                  return {
                    ...d,
                    stale_heartbeats: toArray(data).findIndex(h => equalsIgnoreCase(h.sender, broadcaster_address)) < 0,
                  };
                });
              }
            } catch (error) {}
            break;
          default:
            break;
        }
      }
    }

    output = {
      data: validators_data,
      total: toArray(validators_data).length,
    };
  }

  if (output) {
    // cache
    if (cache_id && !cache_hit) {
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

  return output;
};