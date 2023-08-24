const { ZeroAddress } = require('ethers');
const _ = require('lodash');
const moment = require('moment');

const rpc = require('../../rpc');
const { getTimeSpent } = require('../../transfers/analytics/analyzing');
const { getTransaction, getBlockTime, normalizeLink, updateLink, updateSend } = require('../../transfers/utils');
const { read, write } = require('../../../services/index');
const { TRANSFER_COLLECTION, DEPOSIT_ADDRESS_COLLECTION, UNWRAP_COLLECTION, getChainKey, getAssetsList, getAssetData } = require('../../../utils/config');
const { getGranularity } = require('../../../utils/time');
const { equalsIgnoreCase, toArray, normalizeQuote } = require('../../../utils');

module.exports = async (lcd_response = {}) => {
  let updated = false;

  const { tx, tx_response } = { ...lcd_response };
  const { messages } = { ...tx?.body };
  const { txhash, code, timestamp, logs } = { ...tx_response };
  let { height } = { ...tx_response };
  height = Number(height);

  if (messages && logs) {
    updated = (await Promise.all(
      messages.map((m, i) =>
        new Promise(
          async resolve => {
            const { event_id, chain } = { ...m };
            let _updated;
            if (m['@type']?.includes('RetryFailedEventRequest') && event_id) {
              const created_at = moment(timestamp).utc().valueOf();
              const { events } = { ...logs[i] };
              const response = await rpc('/block_results', { height });
              const end_block_events = toArray(response?.end_block_events);
              const _events = end_block_events.filter(e => ['depositConfirmation', 'EVMEventCompleted', 'EVMEventFailed'].findIndex(s => e.type?.includes(s)) > -1 && toArray(e.attributes).findIndex(a => ['eventID', 'event_id'].includes(a.key) && equalsIgnoreCase(normalizeQuote(a.value), event_id)) > -1);
              for (const event of _events) {
                events.push(event);
              }

              const success = toArray(events).findIndex(e => e.type?.includes('EVMEventCompleted')) > -1;
              const failed = !success && toArray(events).findIndex(e => e.type?.includes('EVMEventFailed')) > -1;
              const { attributes } = { ...toArray(events).find(e => e.type?.includes('depositConfirmation')) };
              const { sourceChain, destinationChain, depositAddress, tokenAddress, txID, transferID, asset, amount } = { ...Object.fromEntries(toArray(attributes).map(a => [a.key, a.value])) };

              const sender_chain = getChainKey(sourceChain);
              const recipient_chain = getChainKey(destinationChain);
              const transaction_id = txID;
              const deposit_address = depositAddress;
              const transfer_id = transferID;

              if (txhash && transaction_id && transfer_id && success) {
                const vote_data = {
                  txhash,
                  height,
                  status: code ? 'failed' : 'success',
                  type: 'RetryFailedEvent',
                  created_at: getGranularity(created_at),
                  source_chain: sender_chain,
                  destination_chain: recipient_chain,
                  transaction_id,
                  deposit_address,
                  transfer_id,
                  denom: asset,
                  amount,
                  poll_id: null,
                  success,
                  failed,
                };

                try {
                  if (deposit_address) {
                    const { source_chain, destination_chain } = { ...vote_data };
                    let { denom, amount } = { ...vote_data };
                    let created_at = vote_data.created_at?.ms;
                    const transaction_data = await getTransaction(transaction_id, source_chain);
                    const { transaction, receipt } = { ...transaction_data };
                    const { blockNumber, from, to, input, data } = { ...transaction };
                    const { logs } = { ...receipt };

                    if (blockNumber) {
                      const block_timestamp = await getBlockTime(blockNumber, source_chain);
                      if (block_timestamp) {
                        created_at = block_timestamp * 1000;
                      }

                      const asset_data = getAssetsList().find(a => equalsIgnoreCase(to, a.addresses?.[source_chain]?.address));
                      let _amount;
                      if (!asset_data || !amount) {
                        _amount = _.head(
                          toArray(logs)
                            .filter(d => getAssetsList().findIndex(a => a.denom === getAssetData(denom)?.denom && equalsIgnoreCase(d.address, a.addresses?.[source_chain]?.address)) > -1)
                            .map(d => d.data)
                            .filter(d => d.length >= 64)
                            .map(d => d.substring(d.length - 64).replace('0x', '').replace(/^0+/, '') || ZeroAddress.replace('0x', ''))
                            .filter(d => {
                              try {
                                d = BigInt(`0x${d}`);
                                return true;
                              } catch (error) {
                                return false;
                              }
                            })
                        );
                      }
                      denom = asset_data?.denom || denom;
                      amount = amount || BigInt(`0x${_amount || data?.substring(10 + 64) || input?.substring(10 + 64) || '0'}`).toString();

                      let response = await read(
                        UNWRAP_COLLECTION,
                        {
                          bool: {
                            must: [
                              { match: { tx_hash: transaction_id } },
                              { match: { deposit_address_link: deposit_address } },
                              { match: { source_chain } },
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
                        txhash: transaction_id,
                        height: blockNumber,
                        status: 'success',
                        type: 'evm',
                        created_at: getGranularity(created_at),
                        source_chain,
                        destination_chain,
                        sender_address: from,
                        recipient_address: deposit_address,
                        token_address: tokenAddress,
                        denom,
                        amount,
                      };

                      response = await read(DEPOSIT_ADDRESS_COLLECTION, { match: { deposit_address } }, { size: 1 });
                      let link = normalizeLink(_.head(response?.data));
                      link = await updateLink(link, send);

                      response = await read(
                        TRANSFER_COLLECTION,
                        {
                          bool: {
                            must: [
                              { match: { 'send.txhash': transaction_id } },
                              { match: { 'send.recipient_address': deposit_address } },
                            ],
                          },
                        },
                        { size: 1 },
                      );
                      let transfer_data = _.head(response?.data);
                      const { vote } = { ...transfer_data };
                      transfer_data = {
                        ...transfer_data,
                        send,
                        link: link || undefined,
                        vote: vote ? vote.height < height ? vote_data : vote : vote_data,
                        transfer_id,
                        type: unwrap ? 'unwrap' : 'deposit_address',
                        unwrap: unwrap || undefined,
                      };
                      await updateSend(send, link, { ...transfer_data, time_spent: getTimeSpent(transfer_data) });
                    }
                  }
                } catch (error) {}
              }
            }
            resolve(_updated);
          }
        )
      )
    )).length > 0;
  }

  return updated;
};