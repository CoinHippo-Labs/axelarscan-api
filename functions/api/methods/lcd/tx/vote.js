const {
  ZeroAddress,
} = require('ethers');
const _ = require('lodash');
const moment = require('moment');

const rpc = require('../../rpc');
const {
  saveGMP,
} = require('../../gmp');
const {
  generateId,
} = require('../../transfers/analytics/preprocessing');
const {
  getTimeSpent,
} = require('../../transfers/analytics/analyzing');
const {
  getTransaction,
  getBlockTime,
  normalizeLink,
  updateLink,
  updateSend,
} = require('../../transfers/utils');
const {
  get,
  read,
  write,
} = require('../../../services/index');
const {
  getProvider,
} = require('../../../utils/chain/evm');
const {
  POLL_COLLECTION,
  TRANSFER_COLLECTION,
  DEPOSIT_ADDRESS_COLLECTION,
  UNWRAP_COLLECTION,
  VOTE_TYPES,
  getChainsList,
  getChainKey,
  getChainData,
  getAssetsList,
  getAssetData,
} = require('../../../utils/config');
const {
  getGranularity,
} = require('../../../utils/time');
const {
  equalsIgnoreCase,
  toArray,
  toJson,
  toHex,
  normalizeQuote,
} = require('../../../utils');

module.exports = async (
  lcd_response = {},
) => {
  let updated = false;

  const {
    tx,
    tx_response,
  } = { ...lcd_response };

  const {
    messages,
  } = { ...tx?.body };

  const {
    txhash,
    code,
    timestamp,
    logs,
  } = { ...tx_response };
  let {
    height,
  } = { ...tx_response };

  height = Number(height);

  if (messages && logs) {
    updated =
      (await Promise.all(
        messages.map((m, i) =>
          new Promise(
            async resolve => {
              const {
                inner_message,
              } = { ...m };

              let _updated;

              if (inner_message) {
                const type = _.last(toArray(inner_message['@type'], 'normal', '.'))?.replace('Request', '');

                if (VOTE_TYPES.includes(type)) {
                  const created_at = moment(timestamp).utc().valueOf();

                  const {
                    events,
                  } = { ...logs[i] };

                  const event = toArray(events).find(e => ['depositConfirmation', 'eventConfirmation'].findIndex(s => equalsIgnoreCase(e.type, s)) > -1);

                  const {
                    attributes,
                  } = { ...event };

                  const vote_event = toArray(events).find(e => e.type?.includes('vote'));
                  const poll_id = inner_message.poll_id || toJson(inner_message.poll_key || toArray(attributes).find(a => a.key === 'poll')?.value || toArray(vote_event?.attributes).find(a => a.key === 'poll')?.value)?.id;

                  if (poll_id) {
                    let recipient_chain = getChainKey(toArray(attributes).find(a => a.key === 'destinationChain')?.value);
                    const voter = inner_message.sender;
                    const unconfirmed = toArray(logs).findIndex(l => l.log?.includes('not enough votes')) > -1 && toArray(events).findIndex(e => e.type?.includes('EVMEventConfirmed')) < 0;
                    const failed = toArray(logs).findIndex(l => l.log?.includes('failed') && !l.log.includes('already confirmed')) > -1 || toArray(events).findIndex(e => e.type?.includes('EVMEventFailed')) > -1;
                    let end_block_events;
                    if (!unconfirmed && !failed && attributes) {
                      const response = await rpc('/block_results', { height });
                      end_block_events = toArray(response?.end_block_events);
                      const completed_events = end_block_events.filter(e => e.type?.includes('EVMEventCompleted') && toArray(e.attributes).findIndex(a => ['eventID', 'event_id'].includes(a.key) && equalsIgnoreCase(normalizeQuote(a.value), attributes.find(a => ['eventID', 'event_id'].includes(a.key))?.value)) > -1);

                      for (const event of completed_events) {
                        events.push(event);
                      }
                    }
                    const success = toArray(events).findIndex(e => e.type?.includes('EVMEventCompleted')) > -1 || toArray(logs).findIndex(l => l.log?.includes('already confirmed')) > -1;

                    let poll_data;
                    let sender_chain;
                    let vote = true;
                    let confirmation;
                    let late;
                    let transaction_id;
                    let deposit_address;
                    let transfer_id;
                    let event_name;
                    let participants;
                    let confirmation_events;

                    switch (type) {
                      case 'VoteConfirmDeposit':
                        sender_chain = getChainKey(inner_message.chain || toArray(attributes).find(a => ['chain', 'sourceChain'].includes(a.key))?.value);
                        vote = inner_message.confirmed || false;
                        confirmation = toArray(attributes).findIndex(a => a.key === 'action' && a.value === 'confirm') > -1;
                        break;
                      case 'Vote':
                        sender_chain = getChainKey(inner_message.vote?.chain || _.head(inner_message.vote?.results)?.chain || inner_message.vote?.result?.chain || getChainsList('evm').find(c => poll_id.startsWith(`${c.id}_`))?.id);
                        const vote_events = inner_message.vote?.events || inner_message.vote?.results || inner_message.vote?.result?.events;
                        recipient_chain = getChainKey(recipient_chain || _.head(toArray(toArray(vote_events).flatMap(e => Object.values(e).map(v => v?.destination_chain)))));
                        vote = (Array.isArray(vote_events) ? vote_events : Object.keys({ ...vote_events })).length > 0;
                        const has_status = Array.isArray(vote_events) && toArray(vote_events).findIndex(e => e.status) > -1;
                        confirmation = !!event || toArray(events).findIndex(e => e.type?.includes('EVMEventConfirmed')) > -1 || (vote_event && has_status && toArray(vote_events).findIndex(e => e.status === 'STATUS_COMPLETED') > -1);
                        late = !vote_event && toArray(logs).findIndex(l => l.log?.includes('failed') && l.log.includes('already confirmed')) > -1 && ((!vote && Array.isArray(vote_events)) || (has_status && toArray(vote_events).findIndex(e => ['STATUS_UNSPECIFIED', 'STATUS_COMPLETED'].includes(e.status)) > -1));
                        event_name = _.head(Object.entries({ ...toArray(vote_events).find(e => Object.values(e).findIndex(v => typeof v === 'object' && !Array.isArray(v)) > -1) }).filter(([k, v]) => typeof v === 'object' && !Array.isArray(v)).map(([k, v]) => k));
                        poll_data = await get(POLL_COLLECTION, poll_id);

                        if (poll_data) {
                          sender_chain = poll_data.sender_chain || sender_chain;
                          poll_data.sender_chain = sender_chain;
                          transaction_id = poll_data.transaction_id;
                          deposit_address = poll_data.deposit_address;
                          transfer_id = poll_data.transfer_id;
                          participants = poll_data.participants;
                          confirmation_events = poll_data.confirmation_events;
                        }
                        break;
                      default:
                        break;
                    }

                    deposit_address = toHex(deposit_address || _.head(inner_message.vote?.events)?.transfer?.to || toArray(attributes).find(a => a.key === 'depositAddress')?.value || toArray(poll_id.replace(`${sender_chain}_`, ''), 'normal', '_')[1]);
                    transaction_id = toHex(transaction_id || _.head(inner_message.vote?.events)?.tx_id || toArray(attributes).find(a => a.key === 'txID')?.value || _.head(toArray(poll_id.replace(`${sender_chain}_`, ''), 'normal', '_')));
                    transaction_id = transaction_id === poll_id ? null : transaction_id;
                    transfer_id = transfer_id || Number(toArray(attributes).find(a => a.key === 'transferID')?.value);

                    if ((equalsIgnoreCase(event_name, 'transfer') || deposit_address) && !(deposit_address && transaction_id && transfer_id && participants)) {
                      const response =
                        await read(
                          TRANSFER_COLLECTION,
                          {
                            bool: {
                              must: [
                                { match: { 'confirm.poll_id': poll_id } },
                              ],
                              must_not: [
                                { match: { 'confirm.transaction_id': poll_id } },
                              ],
                            },
                          },
                          { size: 1 },
                        );

                      const {
                        send,
                        link,
                        confirm,
                        vote,
                      } = { ..._.head(response?.data) };

                      if (!deposit_address) {
                        deposit_address = toHex(vote?.deposit_address || confirm?.deposit_address || send?.recipient_address || link?.deposit_address);
                      }
                      if (!transaction_id) {
                        transaction_id = toHex(vote?.transaction_id || confirm?.transaction_id || send?.txhash);
                      }
                      if (!transfer_id) {
                        transfer_id = vote?.transfer_id || confirm?.transfer_id || data?.transfer_id;
                      }
                      if (!participants) {
                        participants = confirm?.participants;
                      }
                    }

                    if (!(sender_chain && transaction_id && participants)) {
                      const response = poll_data || await get(POLL_COLLECTION, poll_id);

                      if (response) {
                        sender_chain = response.sender_chain || sender_chain;
                        transaction_id = response.transaction_id || transaction_id;
                        participants = response.participants || participants;
                      }

                      if (!sender_chain && deposit_address) {
                        const response = await read(DEPOSIT_ADDRESS_COLLECTION, { match: { deposit_address } }, { size: 1 });
                        sender_chain = _.head(response?.data)?.sender_chain;
                      }
                    }

                    if (!(transaction_id && transfer_id && toArray(confirmation_events).findIndex(e => e.type) > -1)) {
                      if (!end_block_events) {
                        const response = await rpc('/block_results', { height });
                        end_block_events = toArray(response?.end_block_events);
                      }

                      confirmation_events =
                        end_block_events
                          .filter(e =>
                            [
                              'depositConfirmation',
                              'eventConfirmation',
                              'transferKeyConfirmation',
                              'tokenConfirmation',
                              'TokenSent',
                              'ContractCall',
                            ]
                            .findIndex(s => e.type?.includes(s)) > -1 &&
                            toArray(e.attributes).findIndex(a => ['eventID', 'event_id'].includes(a.key) && equalsIgnoreCase(normalizeQuote(a.value), toArray(attributes).find(a => ['eventID', 'event_id'].includes(a.key))?.value)) > -1
                          )
                          .map(e => {
                            const {
                              attributes,
                            } = { ...e };
                            let {
                              type,
                            } = { ...e };

                            type = _.last(toArray(type, 'normal', '.'));

                            return {
                              type,
                              ...Object.fromEntries(
                                toArray(attributes)
                                  .map(a => {
                                    const {
                                      key,
                                      value,
                                    } = { ...a };

                                    return [key, toJson(value) || (typeof value === 'string' ? normalizeQuote(value) : value)];
                                  })
                              ),
                            };
                          });

                      const _chain = _.head(toArray(confirmation_events.map(e => e.chain)));
                      const _transaction_id = _.head(toArray(confirmation_events.map(e => e.txID || e.tx_id)).map(id => toHex(typeof id === 'string' ? normalizeQuote(id) : id)));
                      const _transfer_id = _.head(toArray(confirmation_events.map(e => e.transferID || e.transfer_id)).map(id => Number(typeof id === 'string' ? normalizeQuote(id) : id)));

                      if (equalsIgnoreCase(transaction_id, _transaction_id) || confirmation_events.length > 0) {
                        if ((!confirmation && !unconfirmed && !failed && !transfer_id && _transfer_id) || success) {
                          confirmation = true;
                        }
                        sender_chain = sender_chain || _chain;
                        transfer_id = _transfer_id || transfer_id;
                      }
                    }

                    transaction_id = toHex(transaction_id);

                    if (voter) {
                      await write(
                        POLL_COLLECTION,
                        poll_id,
                        {
                          id: poll_id,
                          height,
                          created_at: getGranularity(created_at),
                          sender_chain,
                          recipient_chain,
                          transaction_id,
                          deposit_address,
                          transfer_id,
                          event: event_name || undefined,
                          confirmation: confirmation || undefined,
                          success: success || confirmation || undefined,
                          failed: success || confirmation ? false : failed || undefined,
                          participants: participants || undefined,
                          confirmation_events: toArray(confirmation_events).length > 0 ? toArray(confirmation_events) : undefined,
                          [voter.toLowerCase()]: {
                            id: txhash,
                            type,
                            height,
                            created_at,
                            voter,
                            vote,
                            confirmed: confirmation && !unconfirmed,
                            late,
                          },
                        },
                        true,
                      );

                      _updated = true;
                    }

                    if (txhash && transaction_id && vote && (confirmation || !unconfirmed || success) && !late && !failed) {
                      const vote_data = {
                        txhash,
                        height,
                        status: code ? 'failed' : 'success',
                        type,
                        created_at: getGranularity(created_at),
                        source_chain: sender_chain,
                        destination_chain: recipient_chain,
                        poll_id,
                        transaction_id,
                        deposit_address,
                        transfer_id,
                        event: event_name,
                        confirmation,
                        success,
                        failed,
                        unconfirmed,
                        late,
                      };

                      switch (event_name) {
                        case 'token_sent':
                          try {
                            const response = await read(TRANSFER_COLLECTION, { match: { 'send.txhash': transaction_id } }, { size: 1 });
                            const transfer_data = _.head(response?.data);
                            const _id = generateId(transfer_data);

                            if (_id) {
                              const {
                                vote,
                              } = { ...transfer_data };

                              await write(
                                TRANSFER_COLLECTION,
                                _id,
                                {
                                  ...transfer_data,
                                  vote: vote ? (vote.height < height && !equalsIgnoreCase(vote.poll_id, poll_id)) || (!vote.transfer_id && transfer_id) ? vote_data : vote : vote_data,
                                },
                                true,
                              );
                            }
                          } catch (error) {}
                          break;
                        case 'contract_call':
                        case 'contract_call_with_token':
                          try {
                            if (confirmation) {
                              await saveGMP(
                                {
                                  event: 'confirm',
                                  sourceTransactionHash: transaction_id,
                                  poll_id,
                                  blockNumber: height,
                                  block_timestamp: created_at / 1000,
                                  source_chain: sender_chain,
                                  destination_chain: recipient_chain,
                                  transactionHash: transaction_id,
                                  confirmation_txhash: txhash,
                                  transfer_id,
                                },
                                sender_chain,
                              );
                            }
                          } catch (error) {}
                          break;
                        default:
                          try {
                            if (deposit_address) {
                              const {
                                source_chain,
                                destination_chain,
                              } = { ...vote_data }
                              let {
                                denom,
                                amount,
                              } = { ...vote_data };

                              let created_at = vote_data.created_at?.ms;
                              const provider = getProvider(source_chain);

                              if (provider) {
                                const transaction_data = await getTransaction(provider, transaction_id, source_chain);

                                const {
                                  transaction,
                                  receipt,
                                } = { ...transaction_data };

                                const {
                                  blockNumber,
                                  from,
                                  to,
                                  input,
                                  data,
                                } = { ...transaction };

                                const {
                                  logs,
                                } = { ...receipt };

                                 if (blockNumber) {
                                  const block_timestamp = await getBlockTime(provider, blockNumber, source_chain);

                                  if (block_timestamp) {
                                    created_at = block_timestamp * 1000;
                                  }

                                  const asset_data = getAssetsList().find(a => equalsIgnoreCase(to, a.addresses?.[source_chain]?.address));
                                  let _amount;

                                  if (!asset_data || !amount) {
                                    _amount =
                                      _.head(
                                        toArray(logs)
                                          .filter(l => getAssetsList().findIndex(a => a.denom === getAssetData(denom)?.denom && equalsIgnoreCase(l.address, a.addresses?.[source_chain]?.address)) > -1)
                                          .map(l => l.data)
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

                                  let response =
                                    await read(
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
                                    const {
                                      tx_hash_unwrap,
                                      destination_chain,
                                    } = { ...unwrap };

                                    const provider = getProvider(destination_chain);

                                    if (provider) {
                                      const transaction_data = await getTransaction(provider, tx_hash_unwrap, destination_chain);

                                      const {
                                        blockNumber,
                                        from,
                                      } = { ...transaction_data?.transaction };

                                      if (blockNumber) {
                                        const block_timestamp = await getBlockTime(provider, blockNumber, destination_chain);

                                        unwrap = {
                                          ...unwrap,
                                          height: blockNumber,
                                          type: 'evm',
                                          created_at: getGranularity(moment(block_timestamp * 1000).utc()),
                                          sender_address: from,
                                        };
                                      }
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
                                    token_address,
                                    denom,
                                    amount,
                                  };

                                  response = await read(DEPOSIT_ADDRESS_COLLECTION, { match: { deposit_address } }, { size: 1 });
                                  let link = normalizeLink(_.head(response?.data));
                                  link = await updateLink(link, send);

                                  response =
                                    await read(
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

                                  const {
                                    vote,
                                  } = { ...transfer_data };

                                  transfer_data = {
                                    ...transfer_data,
                                    send,
                                    link: link || undefined,
                                    vote: vote ? vote.height < height && !equalsIgnoreCase(vote.poll_id, poll_id) ? vote_data : vote : vote_data,
                                    type: unwrap ? 'unwrap' : 'deposit_address',
                                    unwrap: unwrap || undefined,
                                  };

                                  await updateSend(send, link, { ...transfer_data, time_spent: getTimeSpent(transfer_data) });
                                }
                              }
                            }
                          } catch (error) {}
                          break;
                      }
                    }
                  }
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