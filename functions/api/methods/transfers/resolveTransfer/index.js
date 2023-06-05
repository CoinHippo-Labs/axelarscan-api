const { Contract, ZeroAddress, getAddress } = require('ethers');
const _ = require('lodash');
const moment = require('moment');

const { generateId } = require('../analytics/preprocessing');
const { getTimeSpent } = require('../analytics/analyzing');
const addFieldsToResult = require('../searchTransfers/addFieldsToResult'); 
const { getTransaction, getBlockTime, normalizeLink, updateLink, updateSend } = require('../utils');
const { searchTransactions } = require('../../axelar');
const indexTransaction = require('../../lcd/tx');
const { recoverEvents } = require('../../crawler');
const lcd = require('../../lcd');
const { get, read, write } = require('../../../services/index');
const { getProvider } = require('../../../utils/chain/evm');
const { getLCDs } = require('../../../utils/chain/cosmos');
const { POLL_COLLECTION, TRANSFER_COLLECTION, DEPOSIT_ADDRESS_COLLECTION, UNWRAP_COLLECTION, BATCH_COLLECTION, COMMAND_EVENT_COLLECTION, getChainsList, getChainData, getAssetsList, getAssetData } = require('../../../utils/config');
const { getGranularity } = require('../../../utils/time');
const { sleep, equalsIgnoreCase, toArray, includesStringList } = require('../../../utils');

const IAxelarGateway = require('../../../data/contracts/interfaces/IAxelarGateway.json');

module.exports = async (params = {}) => {
  let output;

  const { txHash, sourceChain, recipientAddress, asset } = { ...params };
  let { depositAddress } = { ...params };

  if (txHash) {
    const query = {
      bool: {
        should: [
          { match: { 'send.txhash': txHash } },
          { match: { 'wrap.txhash': txHash } },
          { match: { 'wrap.tx_hash_wrap': txHash } },
          { match: { 'command.transactionHash': txHash } },
          { match: { 'unwrap.txhash': txHash } },
          { match: { 'unwrap.tx_hash_unwrap': txHash } },
          { match: { 'erc20_transfer.txhash': txHash } },
          { match: { 'erc20_transfer.tx_hash_transfer': txHash } },
        ],
        minimum_should_match: 1,
      },
    };
    let response = await read(TRANSFER_COLLECTION, query, { size: 1 });
    let transfer_data = _.head(response?.data);

    if (!transfer_data) {
      let created_at = moment().valueOf();

      if (txHash.startsWith('0x')) {
        const events = toArray(
          await Promise.all(
            getChainsList('evm')
              .filter(c => !sourceChain || toArray(sourceChain).findIndex(id => equalsIgnoreCase(id, c.id)) > -1)
              .map(c => new Promise(async resolve => resolve(await recoverEvents({ txHash, chain: c.id }))))
          ).flatMap(d => toArray(d.events))
        );

        if (events.length > 0) {
          await sleep(0.25 * 1000);
          response = await read(TRANSFER_COLLECTION, query, { size: 1 });
          transfer_data = _.head(response?.data);
        }
        else {
          transfer_data = _.head(
            toArray(
              await Promise.all(
                getChainsList('evm')
                  .filter(c => !sourceChain || toArray(sourceChain).findIndex(id => equalsIgnoreCase(id, c.id)) > -1)
                  .map(c =>
                    new Promise(
                      async resolve => {
                        const { id } = { ...c };
                        let exist = false;
                        let transfer_data;
                        const provider = getProvider(id);

                        if (provider) {
                          const transaction_data = await getTransaction(provider, txHash, id);
                          const { transaction, receipt } = { ...transaction_data };
                          const { blockNumber, from, to, input, data } = { ...transaction };
                          const { logs } = { ...receipt };

                          if (blockNumber) {
                            const block_timestamp = await getBlockTime(provider, blockNumber, id);
                            if (block_timestamp) {
                              created_at = block_timestamp * 1000;
                            }

                            const topics = _.reverse(_.cloneDeep(toArray(logs)).flatMap(l => toArray(l.topics))).filter(t => t.startsWith('0x000000000000000000000000')).map(t => t.replace('0x000000000000000000000000', '0x'));
                            const response = await read(
                              DEPOSIT_ADDRESS_COLLECTION,
                              {
                                bool: {
                                  should: topics.map(t => { return { match: { deposit_address: t } }; }),
                                  minimum_should_match: 1,
                                },
                              },
                              { size: 1 },
                            );
                            depositAddress = _.head(response?.data)?.deposit_address || depositAddress;

                            if (depositAddress) {
                              const asset_data = getAssetsList().find(a => equalsIgnoreCase(a.addresses?.[id]?.address, to));
                              let _amount;

                              if (!asset_data) {
                                _amount = _.head(
                                  toArray(logs)
                                    .filter(l => getAssetsList().findIndex(a => equalsIgnoreCase(l.address, a.addresses?.[id]?.address)) > -1)
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

                              const token_address = asset_data?.addresses?.[id]?.address;
                              const denom = asset_data?.denom;
                              const amount = BigInt(`0x${_amount || data?.substring(10 + 64) || input?.substring(10 + 64) || '0'}`).toString();

                              let response = await read(
                                UNWRAP_COLLECTION,
                                {
                                  bool: {
                                    must: [
                                      { match: { tx_hash: txHash } },
                                      { match: { deposit_address_link: depositAddress } },
                                      { match: { source_chain: id } },
                                    ],
                                  },
                                },
                                { size: 1 },
                              );

                              let unwrap = _.head(response?.data);
                              if (unwrap?.tx_hash_unwrap) {
                                const { tx_hash_unwrap, destination_chain } = { ...unwrap };
                                const provider = getProvider(destination_chain);

                                if (provider) {
                                  const transaction_data = await getTransaction(provider, tx_hash_unwrap, destination_chain);
                                  const { blockNumber, from } = { ...transaction_data?.transaction };

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
                                txhash: txHash,
                                height: blockNumber,
                                status: 'success',
                                type: 'evm',
                                created_at: getGranularity(created_at),
                                source_chain: id,
                                destination_chain,
                                sender_address: from,
                                recipient_address: depositAddress,
                                token_address,
                                denom,
                                amount,
                              };

                              response = await read(DEPOSIT_ADDRESS_COLLECTION, { match: { deposit_address: depositAddress } }, { size: 1 });
                              let link = normalizeLink(_.head(response?.data));
                              link = await updateLink(link, send);

                              const transfer_data = {
                                send,
                                link: link || undefined,
                                type: unwrap ? 'unwrap' : 'deposit_address',
                                unwrap: unwrap || undefined,
                              };
                              await updateSend(send, link, { ...transfer_data, time_spent: getTimeSpent(transfer_data) }, true);
                              exist = true;
                            }
                          }
                        }

                        if (exist) {
                          await sleep(0.25 * 1000);
                          const response = await read(TRANSFER_COLLECTION, query, { size: 1 });
                          transfer_data = _.head(response?.data);
                        }
                        resolve(transfer_data);
                      }
                    )
                  )
              )
            )
          );
        }
      }
      else {
        transfer_data = _.head(
          toArray(
            await Promise.all(
              getChainsList('cosmos')
                .filter(c => !sourceChain || toArray(sourceChain).findIndex(id => equalsIgnoreCase(id, c.id)) > -1)
                .map(c =>
                  new Promise(
                    async resolve => {
                      const { id } = { ...c };
                      let exist = false;
                      let transfer_data;
                      const lcd = getLCDs(id);

                      if (lcd) {
                        const response = await lcd.query(`/cosmos/tx/v1beta1/txs/${txHash}`);
                        const { tx, tx_response } = { ...response };
                        const { messages } = { ...tx?.body };
                        const { txhash, code, height, timestamp } = { ...tx_response };

                        if (messages) {
                          const sender_address = toArray(messages).find(m => m.sender)?.sender;
                          const recipient_address = toArray(messages).find(m => m.receiver)?.receiver;
                          const amount_data = toArray(messages).find(m => m.token)?.token;

                          if (txhash && !code && recipient_address?.length >= 65 && amount_data?.amount) {
                            const response = await read(
                              UNWRAP_COLLECTION,
                              {
                                bool: {
                                  must: [
                                    { match: { tx_hash: txhash } },
                                    { match: { deposit_address_link: recipient_address } },
                                    { match: { source_chain: id } },
                                  ],
                                },
                              },
                              { size: 1 },
                            );

                            let unwrap = _.head(response?.data);
                            if (unwrap?.tx_hash_unwrap) {
                              const { tx_hash_unwrap, destination_chain } = { ...unwrap };
                              const provider = getProvider(destination_chain);

                              if (provider) {
                                const transaction_data = await getTransaction(provider, tx_hash_unwrap, destination_chain);
                                const { blockNumber, from } = { ...transaction_data?.transaction };

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
                              txhash,
                              height: Number(height),
                              status: code ? 'failed' : 'success',
                              type: 'ibc',
                              created_at: getGranularity(moment(timestamp).utc()),
                              source_chain: id,
                              sender_address,
                              recipient_address,
                              denom: amount_data.denom,
                              amount: amount_data.amount,
                            };

                            const _response = await read(DEPOSIT_ADDRESS_COLLECTION, { match: { deposit_address: recipient_address } }, { size: 1 });
                            let link = normalizeLink(_.head(_response?.data));
                            link = await updateLink(link, send);
                            await updateSend(send, link, { type: unwrap ? 'unwrap' : 'deposit_address', unwrap: unwrap || undefined });
                            exist = true;
                          }
                        }
                      }

                      if (exist) {
                        await sleep(0.25 * 1000);
                        const response = await read(TRANSFER_COLLECTION, query, { size: 1 });
                        transfer_data = _.head(response?.data);
                      }
                      resolve(transfer_data);
                    }
                  )
                )
            )
          )
        );
      }
    }

    output = toArray(transfer_data);
  }
  else if (depositAddress || recipientAddress) {
    const response = await read(
      DEPOSIT_ADDRESS_COLLECTION,
      {
        bool: {
          must: [
            { match: { deposit_address: depositAddress } },
            { match: { recipient_address: recipientAddress } },
            { match: { asset } },
          ]
          .filter(m => toArray(Object.values(m.match)).length > 0),
        },
      },
      { size: 1000, sort: [{ height: 'desc' }] },
    );
    const links = toArray(response?.data);

    if (links.length > 0) {
      const response = await read(
        TRANSFER_COLLECTION,
        {
          bool: {
            should: _.uniq(toArray(links.map(l => l.deposit_address))).map(a => { return { match: { 'send.recipient_address': a } }; }),
            minimum_should_match: 1,
          },
        },
        { size: 100 },
      );
      output = toArray(response?.data).map(d => { return { ...d, link: links.find(l => equalsIgnoreCase(l.deposit_address, d.send?.recipient_address)) }; });
    }
  }

  output = await Promise.all(
    toArray(output).map(d =>
      new Promise(
        async resolve => {
          const {
            send,
            link,
            vote,
            command,
            ibc_send,
            axelar_transfer,
            wrap,
            unwrap,
            erc20_transfer,
            type,
          } = { ...d };
          const { txhash, source_chain, recipient_address } = { ...send };

          const _id = generateId(d);
          if (_id) {
            let _updated;
            let wrote;

            if (!unwrap?.tx_hash_unwrap && txhash.startsWith('0x') && recipient_address) {
              const response = await read(
                UNWRAP_COLLECTION,
                {
                  bool: {
                    must: [
                      { match: { tx_hash: txhash } },
                      { match: { deposit_address_link: recipient_address } },
                      { match: { source_chain } },
                    ],
                  },
                },
                { size: 1 },
              );

              d.unwrap = _.head(response?.data);
              if (d.unwrap?.tx_hash_unwrap) {
                const { tx_hash_unwrap, destination_chain } = { ...d.unwrap };
                const provider = getProvider(destination_chain);

                if (provider) {
                  const transaction_data = await getTransaction(provider, tx_hash_unwrap, destination_chain);
                  const { blockNumber, from } = { ...transaction_data?.transaction };

                  if (blockNumber) {
                    const block_timestamp = await getBlockTime(provider, blockNumber, destination_chain);
                    d.unwrap = {
                      ...d.unwrap,
                      height: blockNumber,
                      type: 'evm',
                      created_at: getGranularity(moment(block_timestamp * 1000).utc()),
                      sender_address: from,
                    };
                    _updated = true;
                  }
                }
              }
            }

            d.type = d.unwrap ? 'unwrap' : wrap ? 'wrap' : erc20_transfer ? 'erc20_transfer' : type || 'deposit_address';

            if (getChainData(source_chain, 'evm') && !vote && (command || ibc_send || axelar_transfer)) {
              const response = await read(
                POLL_COLLECTION,
                {
                  bool: {
                    must: [
                      { match: { transaction_id: txhash } },
                      { match: { sender_chain: source_chain } },
                    ],
                    should: [
                      { match: { confirmation: true } },
                      { match: { success: true } },
                    ],
                    minimum_should_match: 1,
                  },
                },
                { size: 1 },
              );

              const poll_data = _.head(response?.data);
              if (poll_data) {
                const vote_confirmation = _.head(Object.values(poll_data).filter(v => v?.confirmed));
                if (vote_confirmation) {
                  const {
                    id,
                    height,
                    created_at,
                    sender_chain,
                    recipient_chain,
                    transaction_id,
                    deposit_address,
                    transfer_id,
                    event,
                    confirmation,
                    success,
                    failed,
                    unconfirmed,
                    late,
                  } = { ...poll_data };
                  const { type } = { ...vote_confirmation };

                  d.vote = {
                    txhash: vote_confirmation.id,
                    height,
                    status: 'success',
                    type,
                    created_at,
                    source_chain: sender_chain,
                    destination_chain: recipient_chain,
                    poll_id: id,
                    transaction_id,
                    deposit_address,
                    transfer_id,
                    event,
                    confirmation,
                    success,
                    failed,
                    unconfirmed,
                    late,
                  };
                  _updated = true;
                }
              }
            }

            if (['unwrap', 'deposit_address', 'send_token'].includes(d.type)) {
              if (typeof link?.price !== 'number') {
                if (!link) {
                  const response = await read(DEPOSIT_ADDRESS_COLLECTION, { match: { deposit_address: recipient_address } }, { size: 1 });
                  d.link = normalizeLink(_.head(response?.data));
                }
                if (d.link) {
                  d.link = await updateLink(d.link, send);
                  d.send = await updateSend(send, d.link, { ...d, time_spent: getTimeSpent(d) }, true);
                  _updated = true;
                  wrote = true;
                }
              }
              else if (!(d.send.destination_chain && typeof d.send.amount === 'number' && typeof d.send.value === 'number' && typeof d.send.fee === 'number')) {
                d.link = await updateLink(d.link, send);
                d.send = await updateSend(send, d.link, { ...d, time_spent: getTimeSpent(d) }, true);
                _updated = true;
                wrote = true;
              }
            }

            if (_updated && !wrote) {
              await write(TRANSFER_COLLECTION, _id, d, true);
            }
          }
          resolve(d);
        }
      )
    )
  );

  output = await Promise.all(
    addFieldsToResult(output).map(d =>
      new Promise(
        async resolve => {
          const _id = generateId(d);
          if (_id) {
            let updated;
            if (['ibc_sent', 'batch_signed', 'voted'].includes(d.status) && !d.send?.insufficient_fee && d.vote?.txhash && d.vote.success && !(d.vote.transfer_id || d.confirm?.transfer_id)) {
              await lcd(`/cosmos/tx/v1beta1/txs/${d.vote.txhash}`, { index: true });
              updated = true;
            }
            else if (d.status === 'asset_sent' && !d.send?.insufficient_fee && d.send?.recipient_address) {
              let { recipient_address } = { ...d.send };
              recipient_address = recipient_address.startsWith('0x') ? getAddress(recipient_address) : recipient_address;
              if (!recipient_address.startsWith('0x')) {
                await lcd('/cosmos/tx/v1beta1/txs', { index: true, index_transfer: true, events: `message.sender='${recipient_address}'` });
                await lcd('/cosmos/tx/v1beta1/txs', { index: true, index_transfer: true, events: `transfer.sender='${recipient_address}'` });
              }
              await lcd('/cosmos/tx/v1beta1/txs', { index: true, index_transfer: true, events: `link.depositAddress='${recipient_address}'` });
              // await lcd('/cosmos/tx/v1beta1/txs', { index: true, index_transfer: true, events: `transfer.recipient='${recipient_address}'` });
              updated = true;
            }
            if (updated) {
              await sleep(0.25 * 1000);
              d = _.head(addFieldsToResult(await get(TRANSFER_COLLECTION, _id)));
            }

            if (getChainData(d.send.destination_chain, 'cosmos')) {
              const height = d.ibc_send?.height || d.vote?.height || d.confirm?.height;

              if (['ibc_sent', 'voted', 'deposit_confirmed'].includes(d.status) && height) {
                if (d.confirm?.txhash && !d.confirm.transfer_id) {
                  await lcd(`/cosmos/tx/v1beta1/txs/${d.confirm.txhash}`, { index: true });
                  await sleep(0.25 * 1000);
                  d = _.head(addFieldsToResult(await get(TRANSFER_COLLECTION, _id)));
                }

                if (!d.send?.insufficient_fee) {
                  await Promise.all(_.range(1, 1).map(i => new Promise(async resolve => resolve(await lcd('/cosmos/tx/v1beta1/txs', { index: true, index_transfer: true, events: `tx.height=${height + i}` })))));
                  await Promise.all(_.range(2, 7).map(i => new Promise(async resolve => {
                    let type;
                    switch (d.status) {
                      case 'ibc_sent':
                        type = ['MsgAcknowledgement', 'MsgTimeout'];
                        break;
                      case 'voted':
                        type = ['RouteIBCTransfersRequest', 'ExecutePendingTransfersRequest'];
                        break;
                      case 'deposit_confirmed':
                        type = getChainData(d.send.source_chain, 'evm') ? 'VoteRequest' : 'RouteIBCTransfersRequest';
                        break;
                      default:
                        break;
                    }

                    const fromBlock = height + i;
                    const toBlock = fromBlock;
                    const response = await searchTransactions({ type, fromBlock, toBlock, size: 100 });
                    const { data } = { ...response };
                    resolve(await Promise.all(toArray(data).map(d => new Promise(async resolve => resolve(await indexTransaction({ tx: d.tx, tx_response: d }, { index_transfer: true, from_indexer: true }))))));
                  })));
                  d = _.head(addFieldsToResult(await get(TRANSFER_COLLECTION, _id)));
                }
              }
            }
            else if (getChainData(d.send.destination_chain, 'evm')) {
              if (['batch_signed', 'voted', 'deposit_confirmed'].includes(d.status) && !d.send?.insufficient_fee) {
                const transfer_id = d.vote?.transfer_id || d.confirm?.transfer_id || d.transfer_id;
                if (transfer_id) {
                  const command_id = transfer_id.toString(16).padStart(64, '0');
                  const response = await read(
                    BATCH_COLLECTION,
                    {
                      bool: {
                        must: [
                          { match: { chain: d.send.destination_chain } },
                          { match: { command_ids: command_id } },
                          {
                            bool: {
                              should: [
                                { match: { status: 'BATCHED_COMMANDS_STATUS_SIGNING' } },
                                { match: { status: 'BATCHED_COMMANDS_STATUS_SIGNED' } },
                              ],
                              minimum_should_match: 1,
                            },
                          },
                        ],
                      },
                    },
                    { size: 1 },
                  );

                  const { batch_id, commands, created_at, status } = { ..._.head(response?.data) };
                  if (batch_id) {
                    let { executed, transactionHash, transactionIndex, logIndex, block_timestamp } = { ...toArray(commands).find(c => c.id === command_id) };
                    if (!transactionHash) {
                      const response = await read(
                        COMMAND_EVENT_COLLECTION,
                        {
                          bool: {
                            must: [
                              { match: { chain: d.send.destination_chain } },
                              { match: { command_id } },
                            ],
                          },
                        },
                        { size: 1 },
                      );

                      const command_event = _.head(response?.data);
                      if (command_event) {
                        transactionHash = command_event.transactionHash;
                        transactionIndex = command_event.transactionIndex;
                        logIndex = command_event.logIndex;
                        block_timestamp = command_event.block_timestamp;
                        if (transactionHash) {
                          executed = true;
                        }
                      }
                    }

                    executed = !!(executed || transactionHash);
                    if (!executed) {
                      try {
                        const { gateway_address } = { ...getChainData(d.send.destination_chain, 'evm') };
                        const provider = getProvider(d.send.destination_chain);
                        const gateway = gateway_address && new Contract(gateway_address, IAxelarGateway.abi, provider);
                        executed = await gateway.isCommandExecuted(`0x${command_id}`);
                      } catch (error) {}
                    }

                    if (status === 'BATCHED_COMMANDS_STATUS_SIGNED' || executed) {
                      d.command = {
                        ...d.command,
                        chain: d.send.destination_chain,
                        command_id,
                        transfer_id,
                        batch_id,
                        created_at,
                        executed,
                        transactionHash,
                        transactionIndex,
                        logIndex,
                        block_timestamp,
                      };
                      await write(TRANSFER_COLLECTION, _id, { ...d, time_spent: getTimeSpent(d) }, true);
                    }
                  }
                }
              }
            }
          }
          resolve(d);
        }
      )
    )
  );

  return output;
};