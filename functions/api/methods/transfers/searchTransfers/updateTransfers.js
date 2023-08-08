const _ = require('lodash');
const moment = require('moment');

const addFieldsToResult = require('./addFieldsToResult'); 
const resolveTransfer = require('../resolveTransfer');
const { generateId } = require('../analytics/preprocessing');
const { getTimeSpent } = require('../analytics/analyzing');
const { normalizeLink, updateLink, updateSend } = require('../utils');
const { recoverEvents } = require('../../crawler');
const { write } = require('../../../services/index');
const { TERRA_COLLAPSED_DATE, getDeposits, getChainsList, getChainData } = require('../../../utils/config');
const { toArray, find } = require('../../../utils');

module.exports = async (collection, data, params) => {
  let updated;
  if (collection) {
    const { txHash, status, size } = { ...params };
    if (txHash && toArray(data).length < 1 && size !== 0) {
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
                const { txhash, height, created_at, recipient_address, denom, amount, fee } = { ...send };
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
                  else if (type !== 'send_token' && find(recipient_address, toArray(getDeposits()?.send_token?.addresses))) {
                    d.type = 'send_token';
                    _updated = true;
                  }
                  if (!total && (command?.executed || ibc_send?.ack_txhash || unwrap)) {
                    d.time_spent = getTimeSpent(d);
                    _updated = true;
                  }
                  if ((status === 'to_fix_value' && link && typeof price !== 'number') || (status === 'to_fix_fee_value' && link && typeof price === 'number') || (['uluna', 'uusd'].includes(denom) && moment(created_at?.ms).diff(moment(TERRA_COLLAPSED_DATE, 'YYYYMMDD').utc(), 'seconds') > 0)) {
                    d.link = normalizeLink(link);
                    d.link = await updateLink(d.link, send);
                    d.send = await updateSend(d.send, d.link, d);
                    _updated = true;
                    wrote = true;
                  }
                  if (['uluna', 'uusd'].includes(denom) && moment(TERRA_COLLAPSED_DATE, 'YYYYMMDD').utc().diff(moment(created_at?.ms), 'seconds') > 0 && fee > parseFloat((amount * 0.001).toFixed(6))) {
                    d.send = await updateSend(d.send, d.link, d, true);
                    _updated = true;
                    wrote = true;
                  }
                  if (
                    !(d.send.destination_chain && typeof d.send.amount === 'number' && typeof d.send.value === 'number' && typeof d.send.fee === 'number') ||
                    (getChainData(d.send.destination_chain, 'evm') && !d.send.insufficient_fee && (getChainData(d.send.source_chain, 'evm') ? vote?.success || vote?.status === 'success' : confirm) && !command?.executed && !unwrap && moment().diff(moment((getChainData(d.send.source_chain, 'evm') ? vote : confirm)?.created_at?.ms), 'minutes') > 1) ||
                    (d.send.destination_chain !== 'axelarnet' && getChainData(d.send.destination_chain, 'cosmos') && !d.send.insufficient_fee && (vote || confirm) && !(ibc_send?.failed_txhash || ibc_send?.ack_txhash || ibc_send?.recv_txhash) && moment().diff(moment((vote || confirm)?.created_at?.ms), 'minutes') > 1) ||
                    (d.send.destination_chain === 'axelarnet' && !d.send.insufficient_fee && !axelar_transfer) ||
                    (getChainData(d.send.source_chain, 'evm') ? (vote?.success || vote?.status === 'success') && !vote.transfer_id : !confirm) ||
                    (unwrap && !unwrap.tx_hash_unwrap && (!d.command?.created_at?.ms || moment().diff(moment(d.command.created_at.ms), 'minutes') > 5)) ||
                    (getChainData(d.send.source_chain, 'evm') && !d.send.insufficient_fee && !vote && (command || ibc_send || axelar_transfer || (['wrap', 'send_token'].includes(d.type) && (!d.send?.created_at?.ms || moment().diff(moment(d.send.created_at.ms), 'minutes') > 5)))) ||
                    (getChainData(d.send.source_chain, 'evm') && !d.send.insufficient_fee && !vote && confirm && moment().diff(moment(confirm.created_at?.ms), 'minutes') > 5)
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