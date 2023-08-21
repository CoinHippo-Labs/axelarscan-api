const _ = require('lodash');
const moment = require('moment');

const getBroadcasters = require('./getBroadcasters');
const rpc = require('../rpc');
const { searchPolls } = require('../polls');
const { get, write } = require('../../services/index');
const { LCD_CACHE_COLLECTION, getChainData } = require('../../utils/config');
const { equalsIgnoreCase, toArray, toJson } = require('../../utils');

module.exports = async (params = {}, size = 100, max_page = 100, cache_age_seconds = 180) => {
  let output;

  let { fromBlock, toBlock } = { ...params };

  let cache;
  let cache_hit = false;
  const cache_id = !(fromBlock || toBlock) ? 'getValidatorsVotes' : undefined;

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
    if (!(fromBlock || toBlock)) {
      const status = await rpc('/status');
      const { latest_block_height } = { ...status };
      toBlock = toBlock || (Number(latest_block_height) - 10);
      fromBlock = fromBlock || (toBlock - 10000);
    }

    let polls;
    let voters;
    if (fromBlock <= toBlock) {
      const _params = { status: 'not_pending', fromBlock, toBlock, from: 0, size };
      const response = await searchPolls(_params);
      const { total } = { ...response };
      let { data } = { ...response };

      if (total > 0) {
        const offsets = [];
        if (total > size) {
          for (let i = 1; i <= max_page; i++) {
            const offset = i * size;
            if (offset <= total) {
              offsets.push(offset);
            }
            else {
              break;
            }
          }
        }

        data = toArray(
          _.concat(
            data,
            (await Promise.all(
              offsets.map(o =>
                new Promise(
                  async resolve => {
                    const response = await searchPolls({ ..._params, from: o });
                    resolve(toArray(response?.data));
                  }
                )
              )
            )).flatMap(d => d),
          )
        );

        polls = _.orderBy(_.uniqBy(data, 'id'), ['created_at.ms'], ['desc']);
        const broadcasters = polls.length > 0 ? await getBroadcasters() : {};
        const { prefix_address } = { ...getChainData('axelarnet') };

        voters = Object.fromEntries(
          Object.entries(
            _.groupBy(
              polls.flatMap(p => {
                const { sender_chain } = { ...p };
                let { participants } = { ...p };
                participants = toArray(participants).map(a => broadcasters[a.toLowerCase()]?.address || a);
                const addresses = Object.keys({ ...p }).filter(k => k.startsWith(`${prefix_address}1`));
                return _.concat(
                  Object.entries({ ...p })
                    .filter(([k, v]) => addresses.includes(k))
                    .map(([k, v]) => {
                      const { vote } = { ...v };
                      return {
                        address: k,
                        chain: sender_chain,
                        vote,
                      };
                    }),
                  participants
                    .filter(a => addresses.findIndex(_a => equalsIgnoreCase(a, _a)) < 0)
                    .map(a => {
                      return {
                        address: a,
                        chain: sender_chain,
                        vote: 'unsubmitted',
                      };
                    }),
                );
              }),
              'address',
            )
          )
          .map(([k, v]) => {
            const chains = Object.fromEntries(
              Object.entries(_.groupBy(v, 'chain')).map(([_k, _v]) => {
                return [
                  _k,
                  {
                    total: _v.filter(d => typeof d.vote === 'boolean').length,
                    total_polls: _v.length,
                    votes: _.countBy(_v, 'vote'),
                  },
                ];
              })
            );
            return [k, { chains, total: _.sumBy(Object.values(chains), 'total') }];
          })
        );
      }
    }

    output = {
      data: voters,
      total: toArray(polls).length,
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