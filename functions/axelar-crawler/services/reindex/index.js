const _ = require('lodash');

const { getAPI, getReindex } = require('../../utils/config');
const { log, toArray } = require('../../utils');

const { enable, start_block, end_block, num_processes } = { ...getReindex() };
const MAX_TRANSACTIONS_ASYNC_INDEX = 25;

module.exports = context => {
  const api = getAPI(15000);
  if (api) {
    const service_name = `${!context ? 'local_' : ''}axelarscan-axelar-crawler-reindex`;
    const indexTransaction = txhash => api.get('/', { params: { index: true, method: 'lcd', path: `/cosmos/tx/v1beta1/txs/${txhash}` } }).catch(error => { return { error: error?.response?.data }; });
    const index = async i => {
      for (let height = start_block; height < end_block; height++) {
        if (height % num_processes === i) {
          log('info', service_name, 'get block', { height, start_block, end_block, i });
          await api.get('/', { params: { index: true, method: 'lcd', path: `/cosmos/base/tendermint/v1beta1/blocks/${height}` } }).catch(error => { return { error: error?.response?.data }; });

          // get transactions of each block
          let next_key = true;
          while (next_key) {
            const response = await api.get('/', { params: { method: 'lcd', path: '/cosmos/tx/v1beta1/txs', events: `tx.height=${height}`, 'pagination.key': typeof next_key === 'string' && next_key ? next_key : undefined } }).catch(error => { return { error: error?.response?.data }; });
            const { data } = { ...response };
            const { tx_responses, pagination } = { ...data };
            for (const tx_response of toArray(tx_responses)) {
              const { txhash } = { ...tx_response };
              if (txhash) {
                log('info', service_name, 'get tx', { txhash, height });
                if (toArray(tx_responses).length < MAX_TRANSACTIONS_ASYNC_INDEX) {
                  indexTransaction(txhash);
                }
                else {
                  await indexTransaction(txhash);
                }
              }
            }
            next_key = pagination?.next_key;
          }
        }
      }
    };
    if (enable && start_block && end_block && start_block <= end_block && num_processes) {
      _.range(0, num_processes).forEach(i => index(i));
    }
  }
};