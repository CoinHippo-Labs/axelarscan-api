const _ = require('lodash');
const moment = require('moment');

const {
  normalizeLink,
  updateLink,
  updateSend,
} = require('../../transfers/utils');
const {
  getTokensPrice,
} = require('../../tokens');
const {
  get,
  read,
  write,
} = require('../../../services/index');
const {
  TRANSFER_COLLECTION,
  DEPOSIT_ADDRESS_COLLECTION,
  getChainsList,
  getChainKey,
  getChainData,
} = require('../../../utils/config');
const {
  getGranularity,
} = require('../../../utils/time');
const {
  equalsIgnoreCase,
  toArray,
} = require('../../../utils');

module.exports = async (
  lcd_response = {},
) => {
  const {
    tx,
    tx_response,
  } = { ...lcd_response };

  const {
    messages,
  } = { ...tx?.body };

  const {
    txhash,
    height,
    timestamp,
    logs,
  } = { ...tx_response };

  const {
    attributes,
  } = { ..._.head(toArray(logs).flatMap(l => toArray(l.events).filter(e => equalsIgnoreCase(e.type, 'link')))) };

  let sender_chain = toArray(attributes).find(a => a.key === 'sourceChain')?.value;
  const deposit_address = toArray(attributes).find(a => a.key === 'depositAddress')?.value;

  const data = {
    ..._.head(messages),
    txhash,
    height: Number(height),
    created_at: getGranularity(moment(timestamp).utc()),
    sender_chain,
    deposit_address,
  };

  const {
    sender,
    chain,
    recipient_addr,
    asset,
  } = { ...data };
  let {
    id,
    type,
    original_sender_chain,
    original_recipient_chain,
    recipient_chain,
    sender_address,
    recipient_address,
    denom,
    price,
  } = { ...data };

  sender_address = sender;
  recipient_address = recipient_addr;

  if (sender_address && equalsIgnoreCase(sender_chain, 'axelarnet')) {
    const {
      id,
    } = { ...getChainsList('cosmos').find(c => sender_address.startsWith(c.prefix_address)) };

    sender_chain = id || sender_chain;
  }

  id = deposit_address || txhash;
  type = _.head(toArray(data['@type'], 'normal', '.'))?.replace('/', '');

  if (sender_address?.startsWith(getChainData('axelarnet').prefix_address) && getChainData(sender_chain)) {
    const response =
      await read(
        TRANSFER_COLLECTION,
        {
          bool: {
            must: [
              { match: { 'send.source_chain': sender_chain } },
              { match: { 'send.recipient_address': deposit_address } },
            ],
          },
        },
        { size: 1 },
      );

    const {
      send,
      link,
    } = { ..._.head(response?.data) };

    if (send?.sender_address) {
      sender_address = send.sender_address;
    }
  }

  sender_chain = getChainKey(getChainsList('cosmos').filter(c => c.id !== 'axelarnet').find(c => sender_address?.startsWith(c.prefix_address))?.id || sender_chain || chain);
  original_sender_chain = getChainData(sender_chain)?.chain_name?.toLowerCase();

  if (!original_sender_chain?.startsWith(sender_chain)) {
    original_sender_chain = sender_chain;
  }
  
  recipient_chain = getChainKey(recipient_chain);
  original_recipient_chain = getChainData(recipient_chain)?.chain_name?.toLowerCase();

  if (!original_recipient_chain?.startsWith(recipient_chain)) {
    original_recipient_chain = recipient_chain;
  }

  denom = asset || denom;

  delete data['@type'];
  delete data.sender;
  delete data.chain;
  delete data.recipient_addr;

  if (typeof price !== 'number' && denom) {
    let response = await getTokensPrice(denom, moment(timestamp).utc());

    if (typeof response !== 'number') {
      response = await get(DEPOSIT_ADDRESS_COLLECTION, id)?.price;
    }

    if (typeof response === 'number') {
      price = response;
    }
  }

  let link = {
    ...data,
    id,
    type,
    original_sender_chain,
    original_recipient_chain,
    sender_chain,
    recipient_chain,
    sender_address,
    deposit_address,
    recipient_address,
    denom,
    price,
  };

  await write(DEPOSIT_ADDRESS_COLLECTION, id, link);

  const response =
    await read(
      TRANSFER_COLLECTION,
      {
        bool: {
          must: [
            { match: { 'send.source_chain': sender_chain } },
            { match: { 'send.recipient_address': deposit_address } },
          ],
          must_not: [
            { exists: { field: 'link' } },
          ],
        },
      },
      { size: 1 },
    );

  const transfer_data = _.head(response?.data);

  if (transfer_data) {
    const {
      send,
      unwrap,
      type,
    } = { ...transfer_data };

    link = normalizeLink(link);
    link = await updateLink(link, send);
    await updateSend(send, link, { type: unwrap ? 'unwrap' : type || 'deposit_address', unwrap: unwrap || undefined });
  }
};