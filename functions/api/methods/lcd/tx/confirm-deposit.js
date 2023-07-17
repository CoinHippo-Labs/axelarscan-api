const { Contract, ZeroAddress } = require('ethers');
const _ = require('lodash');
const moment = require('moment');

const { getTimeSpent } = require('../../transfers/analytics/analyzing');
const { getTransaction, getBlockTime, normalizeLink, updateLink, updateSend } = require('../../transfers/utils');
const { get, read, write } = require('../../../services/index');
const { getProvider } = require('../../../utils/chain/evm');
const { POLL_COLLECTION, TRANSFER_COLLECTION, DEPOSIT_ADDRESS_COLLECTION, UNWRAP_COLLECTION, BATCH_COLLECTION, COMMAND_EVENT_COLLECTION, CONFIRM_TYPES, getChainsList, getChainKey, getChainData, getAssetsList, getAssetData } = require('../../../utils/config');
const { getGranularity } = require('../../../utils/time');
const { equalsIgnoreCase, toArray, toJson, toHex, normalizeQuote } = require('../../../utils');

const IAxelarGateway = require('../../../data/contracts/interfaces/IAxelarGateway.json');

module.exports = async (lcd_response = {}) => {
  const { tx, tx_response } = { ...lcd_response };
  const { messages } = { ...tx?.body };
  const { txhash, code, timestamp, logs } = { ...tx_response };
  let { height } = { ...tx_response };
  height = Number(height);
  const message = _.head(toArray(logs).flatMap(l => toArray(l.events).filter(e => equalsIgnoreCase(e.type, 'message'))));
  const { attributes } = { ..._.head(toArray(logs).flatMap(l => toArray(l.events).filter(e => ['depositConfirmation', 'eventConfirmation', 'ConfirmDeposit'].findIndex(s => e.type?.includes(s)) > -1))) };

  const type = toArray(message?.attributes).find(a => a.key === 'action' && CONFIRM_TYPES.includes(a.value))?.value || _.head(toArray(messages).map(m => _.last(toArray(m['@type'], 'normal', '.'))?.replace('Request', '')).filter(s => CONFIRM_TYPES.includes(s)));
  let created_at = moment(timestamp).utc().valueOf();
  const deposit_address = toHex(toArray(messages).find(m => m.deposit_address)?.deposit_address || toArray(attributes).find(a => ['deposit_address', 'depositAddress'].includes(a.key))?.value);
  const token_address = toHex(toArray(attributes).find(a => ['token_address', 'tokenAddress'].includes(a.key))?.value);
  const asset = normalizeQuote(toArray(attributes).find(a => a.key === 'asset')?.value);
  const poll_id = toJson(toArray(attributes).find(a => a.key === 'participants')?.value)?.poll_id || toJson(toArray(attributes).find(a => a.key === 'poll')?.value)?.id;
  let transfer_id = toArray(attributes).find(a => a.key === 'transferID')?.value;
  let transaction_id = toHex(toArray(attributes).find(a => ['tx_id', 'txID'].includes(a.key))?.value || _.head(toArray(poll_id, 'normal', '_')));
  transaction_id = transaction_id === poll_id ? null : transaction_id;
  const { participants } = { ...toJson(toArray(attributes).find(a => a.key === 'participants')?.value) };

  if (txhash && !code) {
    if (poll_id && !(transfer_id && transaction_id)) {
      const response = await get(POLL_COLLECTION, poll_id);
      if (response) {
        transfer_id = response.transfer_id || transfer_id;
        transaction_id = response.transaction_id || transaction_id;
      }
    }

    const source_chain = getChainKey(toArray(messages).find(m => m.chain)?.chain || toArray(attributes).find(a => ['chain', 'sourceChain'].includes(a.key))?.value);
    let destination_chain = getChainKey(toArray(attributes).find(a => a.key === 'destinationChain')?.value);

    if (poll_id || transfer_id) {
      const confirm = {
        txhash,
        height,
        status: code ? 'failed' : 'success',
        type,
        created_at: getGranularity(created_at),
        source_chain,
        destination_chain,
        deposit_address,
        token_address,
        denom: tx_response.denom || toArray(messages).find(m => m.denom)?.denom || asset,
        amount: toArray(attributes).find(a => a.key === 'amount')?.value,
        poll_id,
        transfer_id,
        transaction_id,
        participants,
      };

      switch (type) {
        case 'ConfirmDeposit':
          try {
            if (!destination_chain && deposit_address) {
              const response = await read(DEPOSIT_ADDRESS_COLLECTION, { match: { deposit_address } }, { size: 1 });
              const link = normalizeLink(_.head(response?.data));
              destination_chain = getChainKey(link?.destination_chain || destination_chain);
            }

            let command;
            if (destination_chain && transfer_id) {
              const command_id = Number(transfer_id).toString(16).padStart(64, '0');
              const response = await read(
                BATCH_COLLECTION,
                {
                  bool: {
                    must: [
                      { match: { chain: destination_chain } },
                      { match: { command_ids: command_id } },
                    ],
                    should: [
                      { match: { status: 'BATCHED_COMMANDS_STATUS_SIGNING' } },
                      { match: { status: 'BATCHED_COMMANDS_STATUS_SIGNED' } },
                    ],
                    minimum_should_match: 1,
                  },
                },
                { size: 1 },
              );
              const { batch_id, commands, created_at } = { ..._.head(response?.data) };

              if (batch_id) {
                let { executed, transactionHash, transactionIndex, logIndex, blockNumber, block_timestamp } = { ...toArray(commands).find(c => c.id === command_id) };
                if (!transactionHash) {
                  const response = await read(
                    COMMAND_EVENT_COLLECTION,
                    {
                      bool: {
                        must: [
                          { match: { chain: destination_chain } },
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
                    blockNumber = command_event.blockNumber;
                    block_timestamp = command_event.block_timestamp;
                    if (transactionHash) {
                      executed = true;
                    }
                  }
                }
                executed = !!(executed || transactionHash);
                if (!executed) {
                  try {
                    const { gateway_address } = { ...getChainData(destination_chain, 'evm') };
                    const provider = getProvider(destination_chain);
                    const gateway = gateway_address && new Contract(gateway_address, IAxelarGateway.abi, provider);
                    executed = await gateway.isCommandExecuted(`0x${command_id}`);
                  } catch (error) {}
                }
                command = {
                  chain: destination_chain,
                  command_id,
                  transfer_id,
                  batch_id,
                  created_at,
                  executed,
                  transactionHash,
                  transactionIndex,
                  logIndex,
                  blockNumber,
                  block_timestamp,
                };
              }
            }

            const response = await read(
              TRANSFER_COLLECTION,
              {
                bool: {
                  must: [
                    { exists: { field: 'send.txhash' } },
                    { match: { 'send.status': 'success' } },
                    { range: { 'send.created_at.ms': { lte: created_at } } },
                    { match: { 'send.recipient_address': deposit_address } },
                  ],
                  should: [
                    { range: { 'confirm.created_at.ms': { gt: created_at } } },
                    {
                      bool: {
                        must_not: [
                          { exists: { field: 'confirm' } },
                        ],
                      },
                    },
                  ],
                  minimum_should_match: 1,
                },
              },
              { size: 25 },
            );
            let { data } = { ...response };

            if (toArray(data).length < 1) {
              const response = await read(
                TRANSFER_COLLECTION,
                {
                  bool: {
                    must: [
                      { exists: { field: 'send.txhash' } },
                      { match: { 'send.status': 'success' } },
                      { match: { 'send.recipient_address': deposit_address } },
                    ],
                    should: [
                      { match: { 'confirm.transfer_id': transfer_id } },
                      { match: { 'vote.transfer_id': transfer_id } },
                      { match: { transfer_id } },
                    ],
                    minimum_should_match: 1,
                  },
                },
                { size: 25 },
              );
              data = toArray(response?.data);
            }

            for (let d of toArray(data)) {
              const { send } = { ...d };
              let { link } = { ...d };
              const { txhash, sender_address, recipient_address } = { ...send };
              let { source_chain } = { ...send };

              source_chain = getChainKey(getChainsList('cosmos').filter(c => c.id !== 'axelarnet').find(c => sender_address?.startsWith(c.prefix_address))?.id || source_chain || confirm.source_chain);
              send.source_chain = source_chain;
              send.destination_chain = destination_chain;

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

              link = await updateLink(link, send);
              d = {
                ...d,
                send,
                link,
                confirm,
                command: command || undefined,
                type: unwrap ? 'unwrap' : 'deposit_address',
                unwrap: unwrap || undefined,
              };
              await updateSend(send, link, { ...d, time_spent: getTimeSpent(d) }, true);
            }
          } catch (error) {}
          break;
        case 'ConfirmERC20Deposit':
          try {
            const { source_chain, destination_chain, deposit_address, token_address, transaction_id } = { ...confirm };
            let { denom, amount } = { ...confirm };

            if (transaction_id) {
              const transaction_data = await getTransaction(transaction_id, source_chain);
              const { transaction, receipt } = { ...transaction_data };
              const { blockNumber, from, to, input, data } = { ...transaction };
              const { logs } = { ...receipt };

              if (blockNumber) {
                const block_timestamp = await getBlockTime(blockNumber, source_chain);
                if (block_timestamp) {
                  created_at = block_timestamp * 1000;
                }

                const asset_data = getAssetsList().find(a => toArray([to, token_address]).findIndex(_a => equalsIgnoreCase(_a, a.addresses?.[source_chain]?.address)) > -1);
                let _amount;
                if (!asset_data || !amount) {
                  _amount = _.head(
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
                  token_address,
                  denom,
                  amount,
                };

                response = await read(DEPOSIT_ADDRESS_COLLECTION, { match: { deposit_address } }, { size: 1 });
                let link = normalizeLink(_.head(response?.data));
                link = await updateLink(link, send);
                const transfer_data = {
                  send,
                  link: link || undefined,
                  confirm,
                  type: unwrap ? 'unwrap' : 'deposit_address',
                  unwrap: unwrap || undefined,
                };
                await updateSend(send, link, { ...transfer_data, time_spent: getTimeSpent(transfer_data) });
              }
            }
          } catch (error) {}
          break;
        default:
          break;
      }
    }

    if (poll_id && transaction_id) {
      await write(
        POLL_COLLECTION,
        poll_id,
        {
          id: poll_id,
          height,
          created_at: getGranularity(created_at),
          initiated_txhash: txhash,
          sender_chain: source_chain,
          transaction_id,
          participants: participants || undefined,
        },
        true,
      );
    }
  }
};