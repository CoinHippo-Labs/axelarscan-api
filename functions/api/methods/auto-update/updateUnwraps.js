const _ = require('lodash');
const moment = require('moment');

const {
  searchUnwraps,
} = require('../transfers/unwrap');
const {
  getTransaction,
  getBlockTime,
} = require('../transfers/utils');
const {
  read,
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
  const response = await searchUnwraps({ status: 'to_update' });

  const {
    data,
  } = { ...response };

  await Promise.all(
    toArray(data).map(d =>
      new Promise(
        async resolve => {
          const {
            deposit_address_link,
            tx_hash_unwrap,
            source_chain,
            destination_chain,
          } = { ...d };

          if (deposit_address_link && tx_hash_unwrap && source_chain && destination_chain) {
            const provider = getProvider(destination_chain);

            if (provider) {
              const response =
                await read(
                  TRANSFER_COLLECTION,
                  {
                    bool: {
                      must: [
                        { exists: { field: 'send.txhash' } },
                        { match: { 'send.recipient_address': deposit_address_link } },
                        { match: { 'send.source_chain': source_chain } },
                      ],
                      must_not: [
                        { exists: { field: 'unwrap' } },
                      ],
                    },
                  },
                  { size: 1 },
                );

              const {
                txhash,
              } = { ..._.head(response?.data)?.send };

              if (txhash) {
                const transaction_data = await getTransaction(provider, tx_hash_unwrap, destination_chain);

                const {
                  blockNumber,
                } = { ...transaction_data?.transaction };

                if (blockNumber) {
                  const block_timestamp = await getBlockTime(provider, blockNumber, destination_chain);

                  await write(
                    TRANSFER_COLLECTION,
                    toArray([txhash, source_chain], 'lower').join('_'),
                    {
                      type: 'unwrap',
                      unwrap: {
                        ...d,
                        txhash: tx_hash_unwrap,
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
          }

          resolve();
        }
      )
    )
  );

  return;
};