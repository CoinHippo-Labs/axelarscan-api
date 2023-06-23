const axios = require('axios');
const moment = require('moment');

const { decodeEvents } = require('./utils');
const { getRPC, getLCD } = require('../../utils/config');
const { toArray, toJson, parseRequestError } = require('../../utils');

const NUM_BLOCKS_AVG_BLOCK_TIME = 100;

module.exports = async (path = '', params = {}) => {
  let output;
  const rpc = getRPC() && axios.create({ baseURL: getRPC(), timeout: 5000 });
  if (rpc) {
    const response = await rpc.get(path, { params }).catch(error => { return { data: { result: null, ...parseRequestError(error) } }; });
    let { data } = { ...response };
    const { result } = { ...data };
    if (result) {
      const { sync_info, height, txs_results, begin_block_events, end_block_events } = { ...result };
      switch (path) {
        case '/status':
          try {
            data = sync_info;
            const { latest_block_time } = { ...data };
            let { latest_block_height } = { ...data };
            if (params.avg_block_time && latest_block_height && NUM_BLOCKS_AVG_BLOCK_TIME) {
              const lcd = getLCD() && axios.create({ baseURL: getLCD(), timeout: 5000, headers: { 'Accept-Encoding': 'gzip' } });
              if (lcd) {
                latest_block_height = Number(latest_block_height);
                const response = await lcd.get(`/cosmos/base/tendermint/v1beta1/blocks/${latest_block_height - NUM_BLOCKS_AVG_BLOCK_TIME}`).catch(error => parseRequestError(error));
                const { time } = { ...response?.data?.block?.header };
                if (time) {
                  data.avg_block_time = moment(latest_block_time).diff(moment(time), 'seconds') / NUM_BLOCKS_AVG_BLOCK_TIME;
                }
              }
            }
          } catch (error) {}
          break;
        case '/block_results':
          try {
            data = {
              ...result,
              height: Number(height),
              txs_results: toArray(txs_results).map(t => {
                const { log, events } = { ...t };
                return {
                  ...t,
                  log: toJson(log) || log,
                  events: decodeEvents(events),
                };
              }),
              begin_block_events: decodeEvents(begin_block_events),
              end_block_events: decodeEvents(end_block_events),
            };
          } catch (error) {}
          break;
        default:
          break;
      }
    }
    output = data;
  }
  return output;
};