const moment = require('moment');

const {
  searchERC20Transfers,
} = require('../transfers/erc20-transfer');
const {
  getTransaction,
  getBlockTime,
} = require('../transfers/utils');
const {
  write,
} = require('../../services/index');
const {
  getProvider,
} = require('../../utils/chain/evm');
const {
  TRANSFER_COLLECTION,
} = require('../../utils/config');
const {
  getGranularity,
} = require('../../utils/time');
const {
  toArray,
} = require('../../utils');

module.exports = async () => {
  const response = await searchERC20Transfers({ status: 'to_update' });

  const {
    data,
  } = { ...response };

  await Promise.all(
    toArray(data)
      .map(d =>
        new Promise(
          async resolve => {
            const {
              tx_hash,
              tx_hash_transfer,
              source_chain,
            } = { ...d };

            if (tx_hash && tx_hash_transfer && source_chain) {
              const provider = getProvider(source_chain);

              if (provider) {
                const transaction_data = await getTransaction(provider, tx_hash, source_chain);

                const {
                  blockNumber,
                } = { ...transaction_data?.transaction };

                if (blockNumber) {
                  const block_timestamp = await getBlockTime(provider, blockNumber, source_chain);

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
                }
              }
            }

            resolve();
          }
        )
      )
  );

  return;
};