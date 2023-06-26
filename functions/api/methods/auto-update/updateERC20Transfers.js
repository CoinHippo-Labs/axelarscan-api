const moment = require('moment');

const { searchERC20Transfers } = require('../transfers/erc20-transfer');
const { getTransaction, getBlockTime } = require('../transfers/utils');
const { recoverEvents } = require('../crawler');
const { write } = require('../../services/index');
const { TRANSFER_COLLECTION } = require('../../utils/config');
const { getGranularity } = require('../../utils/time');
const { toArray } = require('../../utils');

module.exports = async () => {
  const response = await searchERC20Transfers({ status: 'to_update' });
  const { data } = { ...response };
  await Promise.all(
    toArray(data).map(d =>
      new Promise(
        async resolve => {
          const { tx_hash, tx_hash_transfer, source_chain } = { ...d };
          if (tx_hash && tx_hash_transfer && source_chain) {
            const transaction_data = await getTransaction(tx_hash, source_chain);
            const { blockNumber } = { ...transaction_data?.transaction };
            if (blockNumber) {
              const block_timestamp = await getBlockTime(blockNumber, source_chain);
              await write(
                TRANSFER_COLLECTION,
                toArray([tx_hash_transfer, source_chain], 'lower').join('_'),
                {
                  type: 'erc20_transfer',
                  erc20_transfer: {
                    ...d,
                    txhash: tx_hash,
                    height: blockNumber,
                    type: 'evm',
                    created_at: getGranularity(moment(block_timestamp * 1000).utc()),
                  },
                },
                true,
              );
              await recoverEvents({ txHash: tx_hash_transfer, chain: source_chain });
            }
          }
          resolve();
        }
      )
    )
  );
  return;
};