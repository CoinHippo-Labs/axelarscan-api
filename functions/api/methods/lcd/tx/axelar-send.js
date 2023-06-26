const _ = require('lodash');
const moment = require('moment');

const { getTransaction, getBlockTime, normalizeLink, updateLink, updateSend } = require('../../transfers/utils');
const { read } = require('../../../services/index');
const { DEPOSIT_ADDRESS_COLLECTION, UNWRAP_COLLECTION } = require('../../../utils/config');
const { getGranularity } = require('../../../utils/time');
const { toArray } = require('../../../utils');

module.exports = async (lcd_response = {}) => {
  const { tx, tx_response } = { ...lcd_response };
  const { messages } = { ...tx?.body };
  const { txhash, code, height, timestamp } = { ...tx_response };

  const sender_address = toArray(messages).find(m => m.from_address)?.from_address;
  const recipient_address = toArray(messages).find(m => m.to_address)?.to_address;
  const amount_data = _.head(toArray(messages).find(m => m.amount)?.amount);

  if (txhash && !code && recipient_address?.length >= 65 && amount_data?.amount) {
    const response = await read(
      UNWRAP_COLLECTION,
      {
        bool: {
          must: [
            { match: { tx_hash: txhash } },
            { match: { deposit_address_link: recipient_address } },
            { match: { source_chain: 'axelarnet' } },
          ],
        },
      },
      { size: 1 },
    );
    let unwrap = _.head(response?.data);

    if (unwrap?.tx_hash_unwrap) {
      const { tx_hash_unwrap, destination_chain } = { ...unwrap };
      const transaction_data = await getTransaction(tx_hash_unwrap, destination_chain);
      const { blockNumber, from } = { ...transaction_data?.transaction };
      if (blockNumber) {
        const block_timestamp = await getBlockTime(blockNumber, destination_chain);
        unwrap = {
          ...unwrap,
          height: blockNumber,
          type: 'evm',
          created_at: getGranularity(moment(block_timestamp * 1000).utc()),
          sender_address: from,
        };
      }
    }

    const send = {
      txhash,
      height: Number(height),
      status: code ? 'failed' : 'success',
      type: 'axelar',
      created_at: getGranularity(moment(timestamp).utc()),
      source_chain: 'axelarnet',
      sender_address,
      recipient_address,
      denom: amount_data.denom,
      amount: amount_data.amount,
    };

    const _response = await read(DEPOSIT_ADDRESS_COLLECTION, { match: { deposit_address: recipient_address } }, { size: 1 });
    let link = normalizeLink(_.head(_response?.data));
    link = await updateLink(link, send);
    await updateSend(send, link, { type: unwrap ? 'unwrap' : 'deposit_address', unwrap: unwrap || undefined });
  }
};