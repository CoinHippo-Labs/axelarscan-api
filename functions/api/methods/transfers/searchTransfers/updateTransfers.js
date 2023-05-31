const _ = require('lodash');
const moment = require('moment');

const addFieldsToResult = require('./addFieldsToResult'); 
const resolveTransfer = require('../resolveTransfer');
const { generateId } = require('../analytics/preprocessing');
const { getTimeSpent } = require('../analytics/analyzing');
const { normalizeLink, updateLink, updateSend } = require('../utils');
const { recoverEvents } = require('../../crawler');
const { write } = require('../../../services/index');
const { getChainsList, getChainData } = require('../../../utils/config');
const { toArray } = require('../../../utils');

module.exports = async (collection, data, params) => {
  let updated;

  if (collection) {
    const { txHash, status } = { ...params };
    if (txHash && toArray(data).length < 1) {
      updated = toArray(
        await Promise.all(
          getChainsList('evm')
            .filter(c => c.gateway_address)
            .map(c => c.id)
            .flatMap(c =>
              new Promise(
                async resolve => {
                  const { events } = { ...await recoverEvents({ txHash, chain: c }) };
                  resolve(events);
                }
              )
            )
        )
      ).length > 0;
    }
    else {
      updated = toArray(
        await Promise.all(
          toArray(data).map(d =>
            new Promise(
              async resolve => {
                const {
                  send,
                  link,
                  confirm,
                  vote,
                  command,
                  ibc_send,
                  axelar_transfer,
                  wrap,
                  unwrap,
                  erc20_transfer,
                  type,
                  time_spent,
                } = { ...d };
                const { txhash, height, created_at, denom, amount, fee } = { ...send };
                const { price } = { ...link };
                const { total } = { ...time_spent };

                let _updated;
                let wrote;

                const _id = generateId(d);
                if (_id) {
                  if (typeof height === 'string') {
                    d.send.height = Number(height);
                    _updated = true;
                  }
                  if ((wrap && type !== 'wrap') || (unwrap && type !== 'unwrap') || (erc20_transfer && type !== 'erc20_transfer')) {
                    d.type = wrap ? 'wrap' : unwrap ? 'unwrap' : erc20_transfer ? 'erc20_transfer' : type;
                    _updated = true;
                  }
                  if (!total && (command?.executed || ibc_send?.ack_txhash || unwrap)) {
                    d.time_spent = getTimeSpent(d);
                    _updated = true;
                  }
                  if (status === 'to_fix_value' && link && typeof price !== 'number') {
                    d.link = normalizeLink(link);
                    d.link = await updateLink(d.link, send);
                    d.send = await updateSend(d.send, d.link, d);
                    _updated = true;
                    wrote = true;
                  }
                  if (['uluna', 'uusd'].includes(denom) && moment('20220401', 'YYYYMMDD').utc().diff(moment(created_at?.ms), 'seconds') > 0 && fee > parseFloat((amount * 0.001).toFixed(6))) {
                    d.send = await updateSend(d.send, d.link, d, true);
                    _updated = true;
                    wrote = true;
                  }
                  if (
                    !(d.send.destination_chain && typeof d.send.amount === 'number' && typeof d.send.value === 'number' && typeof d.send.fee === 'number') ||
                    (getChainData(d.send.destination_chain, 'evm') && !d.send.insufficient_fee && (getChainData(d.send.source_chain, 'evm') ? vote?.success : confirm) && !command?.executed && !unwrap) ||
                    (d.send.destination_chain !== 'axelarnet' && getChainData(d.send.destination_chain, 'cosmos') && !d.send.insufficient_fee && (vote || confirm) && !(ibc_send?.failed_txhash || ibc_send?.ack_txhash || ibc_send?.recv_txhash)) ||
                    (d.send.destination_chain === 'axelarnet' && !d.send.insufficient_fee && !axelar_transfer) ||
                    (getChainData(d.send.source_chain, 'evm') ? vote?.success && !vote.transfer_id : !confirm) ||
                    (unwrap && !unwrap.tx_hash_unwrap) ||
                    (getChainData(d.send.source_chain, 'evm') && !d.send.insufficient_fee && !vote && (command || ibc_send || axelar_transfer))
                  ) {
                    _updated = !_.isEqual(_.head(addFieldsToResult(d)), _.head(await resolveTransfer({ txHash: txhash, sourceChain: d.send.source_chain })));
                    wrote = true;
                  }
                }
                if (_updated && !wrote) {
                  await write(collection, _id, d, true);
                }
                resolve(_updated);
              }
            )
          )
        )
      ).length > 0;
    }
  }

  return updated;
};