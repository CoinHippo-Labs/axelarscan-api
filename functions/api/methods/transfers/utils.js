const { Contract, formatUnits, toBeHex } = require('ethers');
const axios = require('axios');
const _ = require('lodash');
const moment = require('moment');

const { generateId } = require('./analytics/preprocessing');
const { getTokensPrice } = require('../tokens');
const { write } = require('../../services/index');
const { getProvider } = require('../../utils/chain/evm');
const { TRANSFER_COLLECTION, DEPOSIT_ADDRESS_COLLECTION, TERRA_COLLAPSED_DATE, getChainsList, getChainKey, getChainData, getLCD, getAssetData } = require('../../utils/config');
const { toBigNumber, parseUnits } = require('../../utils/number');
const { equalsIgnoreCase, toArray, parseRequestError } = require('../../utils');

const IAxelarGateway = require('../../data/contracts/interfaces/IAxelarGateway.json');

const isCommandExecuted = async (commandId, chain) => {
  let output;
  if (commandId && chain) {
    const { endpoints, gateway_address } = { ...getChainData(chain, 'evm') };
    if (gateway_address) {
      for (const url of toArray(endpoints?.rpc)) {
        try {
          const rpc = axios.create({ baseURL: url });
          const response = await rpc.post('', { jsonrpc: '2.0', method: 'eth_call', params: [{ to: gateway_address, data: `0xd26ff210${commandId}` }, 'latest'], id: 0 }).catch(error => parseRequestError(error));
          const { data } = { ...response };
          const { result } = { ...data };
          switch (toBigNumber(result)) {
            case '1':
              output = true;
              break;
            case '0':
              output = false;
              break;
            default:
              break;
          }
          if (typeof output === 'boolean') {
            break;
          }
        } catch (error) {}
      }
      if (typeof output !== 'boolean') {
        try {
          const provider = getProvider(chain);
          if (provider) {
            const gateway = new Contract(gateway_address, IAxelarGateway.abi, provider);
            output = await gateway.isCommandExecuted(`0x${commandId}`);
          }
        } catch (error) {}
      }
    }
  }
  return output;
};

const getReceiptLogIndex = (receipt, logIndex) => {
  const { logs } = { ...receipt };
  return toArray(logs).findIndex(l => l?.logIndex === logIndex);
};

const setReceiptLogIndexToData = (data, logIndex) => {
  const { receipt } = { ...data };
  if (typeof logIndex === 'number' && Array.isArray(receipt?.logs)) {
    const _logIndex = getReceiptLogIndex(receipt, logIndex);
    if (_logIndex > -1) {
      data._logIndex = _logIndex;
    }
    else {
      delete data.transaction;
      delete data.receipt;
    }
  }
  return data;
};

const getTransaction = async (txHash, chain, logIndex) => {
  let output;
  if (txHash && chain) {
    output = { chain };
    try {
      output = {
        ...output,
        ...Object.fromEntries(
          await Promise.all(
            ['transaction', 'receipt'].map(k =>
              new Promise(
                async resolve => {
                  let v;
                  switch (k) {
                    case 'transaction':
                      const chain_data = getChainData(chain, 'evm');
                      for (const url of toArray(chain_data?.endpoints?.rpc)) {
                        try {
                          const rpc = axios.create({ baseURL: url });
                          const response = await rpc.post('', { jsonrpc: '2.0', method: 'eth_getTransactionByHash', params: [txHash], id: 0 }).catch(error => parseRequestError(error));
                          const { data } = { ...response };
                          const { result } = { ...data };
                          if (result) {
                            v = Object.fromEntries(
                              Object.entries({ ...result }).map(([k, v]) => {
                                switch (k) {
                                  case 'chainId':
                                  case 'nonce':
                                  case 'blockNumber':
                                  case 'transactionIndex':
                                  case 'value':
                                  case 'type':
                                  case 'v':
                                    v = Number(toBigNumber(v));
                                    break;
                                  case 'gas':
                                  case 'maxFeePerGas':
                                  case 'maxPriorityFeePerGas':
                                    v = toBigNumber(v);
                                    break;
                                  default:
                                    break;
                                }
                                return [k, v];
                              })
                            );
                            break;
                          }
                        } catch (error) {}
                      }
                      if (!v) {
                        try {
                          const provider = getProvider(chain);
                          if (provider) {
                            const _v = await provider.getTransaction(txHash);
                            v = {
                              ..._v,
                              chainId: Number(_v.chainId),
                            };
                          }
                        } catch (error) {}
                      }
                      break;
                    case 'receipt':
                      const getTransactionReceipt = async () => {
                        let v;
                        const chain_data = getChainData(chain, 'evm');
                        for (const url of toArray(chain_data?.endpoints?.rpc)) {
                          try {
                            const rpc = axios.create({ baseURL: url });
                            const response = await rpc.post('', { jsonrpc: '2.0', method: 'eth_getTransactionReceipt', params: [txHash], id: 0 }).catch(error => parseRequestError(error));
                            const { data } = { ...response };
                            const { result } = { ...data };
                            if (result) {
                              v = Object.fromEntries(
                                Object.entries({ ...result }).map(([k, v]) => {
                                  switch (k) {
                                    case 'transactionIndex':
                                    case 'blockNumber':
                                    case 'status':
                                    case 'type':
                                      v = Number(toBigNumber(v));
                                      break;
                                    case 'cumulativeGasUsed':
                                    case 'gasUsed':
                                    case 'effectiveGasPrice':
                                    case 'l1GasUsed':
                                    case 'l1GasPrice':
                                    case 'l1Fee':
                                      v = toBigNumber(v);
                                      break;
                                    case 'logs':
                                      v = toArray(v).map(l => {
                                        return {
                                          ...Object.fromEntries(
                                            Object.entries({ ...l }).map(([_k, _v]) => {
                                              switch (_k) {
                                                case 'logIndex':
                                                case 'transactionIndex':
                                                case 'blockNumber':
                                                  _v = Number(toBigNumber(_v));
                                                  break;
                                                default:
                                                  break;
                                              }
                                              return [_k, _v];
                                            })
                                          ),
                                        };
                                      });
                                      break;
                                    default:
                                      break;
                                  }
                                  return [k, v];
                                })
                              );
                              break;
                            }
                          } catch (error) {}
                        }
                        return v;
                      };

                      v = await getTransactionReceipt();
                      if (!v) {
                        try {
                          switch (chain) {
                            case 'optimism':
                              break;
                            default:
                              const provider = getProvider(chain);
                              if (provider) {
                                const _v = await provider.getTransactionReceipt(txHash);
                                v = {
                                  ..._v,
                                  transactionHash: _v.transactionHash || _v.hash,
                                  transactionIndex: typeof _v.transactionIndex === 'number' ? _v.transactionIndex : _v.index,
                                  confirmations: await _v.confirmations(),
                                  logs: toArray(_v.logs).map(l => {
                                    delete l.provider;
                                    l.logIndex = typeof l.logIndex === 'number' ? l.logIndex : l.index;
                                    delete l.index;
                                    return { ...l };
                                  }),
                                };
                                delete v.index;
                              }
                              break;
                          }
                        } catch (error) {}
                      }
                      break;
                    default:
                      break;
                  }
                  resolve([k, v]);
                }
              )
            )
          )
        ),
      };
      output = setReceiptLogIndexToData(output, logIndex);
    } catch (error) {}
  }
  return output;
};

const setTransactionIdToData = data => {
  if (data) {
    const { transactionHash, transactionIndex, transaction, receipt } = { ...data };
    data.transactionHash = _.head(_.concat(transactionHash, receipt?.transactionHash, transaction?.hash).filter(h => typeof h === 'string'));
    data.transactionIndex = _.head(_.concat(transactionIndex, receipt?.transactionIndex, transaction?.transactionIndex).filter(i => typeof i === 'number'));
  }
  return data;
};

const getBlockTime = async (blockNumber, chain) => {
  let output;
  if (blockNumber && chain) {
    const chain_data = getChainData(chain, 'evm');
    for (const url of toArray(chain_data?.endpoints?.rpc)) {
      try {
        const rpc = axios.create({ baseURL: url });
        const response = await rpc.post('', { jsonrpc: '2.0', method: 'eth_getBlockByNumber', params: [toBeHex(blockNumber).replace('0x0', '0x'), false], id: 0 }).catch(error => parseRequestError(error));
        const { data } = { ...response };
        const { timestamp } = { ...data?.result };
        if (timestamp) {
          output = parseInt(toBigNumber(timestamp));
          break;
        }
      } catch (error) {}
    }
    if (!output) {
      try {
        const provider = getProvider(chain);
        if (provider) {
          const block = await provider.getBlock(blockNumber);
          const { timestamp } = { ...block };
          if (timestamp) {
            output = timestamp;
          }
        }
      } catch (error) {}  
    }
  }
  return output;
};

const setBlockNumberToData = data => {
  if (data) {
    const { blockNumber, transaction, receipt } = { ...data };
    data.blockNumber = blockNumber || receipt?.blockNumber || transaction?.blockNumber;
  }
  return data;
};

const normalizeLink = link => {
  if (link) {
    link = _.cloneDeep(link);
    const { original_sender_chain, original_recipient_chain, sender_chain, recipient_chain } = { ...link };
    link.original_source_chain = link.original_source_chain || original_sender_chain;
    link.original_destination_chain = link.original_destination_chain || original_recipient_chain;
    link.source_chain = link.source_chain || sender_chain;
    link.destination_chain = link.destination_chain || recipient_chain;
    delete link.original_sender_chain;
    delete link.original_recipient_chain;
    delete link.sender_chain;
    delete link.recipient_chain;
  }
  return link;
};

const updateLink = async (link, send) => {
  if (link) {
    link = normalizeLink(link);
    const { deposit_address, recipient_address, asset } = { ...link };
    let { original_source_chain, source_chain, original_destination_chain, destination_chain, sender_address, denom, price } = { ...link };

    let updated = false;
    if (send && !equalsIgnoreCase(sender_address, send.sender_address)) {
      sender_address = send.sender_address;
      link.sender_address = sender_address;
      updated = true;
    }

    if (sender_address && (equalsIgnoreCase(original_source_chain, 'axelarnet') || getChainData(original_source_chain, 'cosmos'))) {
      const { id } = { ...getChainsList('cosmos').find(c => sender_address.startsWith(c.prefix_address)) };
      if (id) {
        original_source_chain = getChainData(id)?.chain_name?.toLowerCase();
        updated = updated || link.original_source_chain !== original_source_chain;
        link.original_source_chain = original_source_chain;
      }
    }

    if (send && sender_address) {
      source_chain = getChainKey(getChainsList('cosmos').find(c => sender_address.startsWith(c.prefix_address))?.id || source_chain || send.source_chain);
      updated = updated || link.source_chain !== source_chain;
      link.source_chain = source_chain;
      if (!original_source_chain?.startsWith(source_chain)) {
        original_source_chain = source_chain;
        link.original_source_chain = original_source_chain;
        updated = true;
      }
    }

    if (!destination_chain && recipient_address) {
      destination_chain = getChainKey(getChainsList('cosmos').find(c => recipient_address.startsWith(c.prefix_address))?.id || send?.destination_chain);
      updated = updated || link.destination_chain !== destination_chain;
      link.destination_chain = destination_chain;
      if (!original_destination_chain?.startsWith(destination_chain)) {
        original_destination_chain = destination_chain;
        link.original_destination_chain = original_destination_chain;
        updated = true;
      }
    }

    denom = send?.denom || asset || denom;
    if ((typeof price !== 'number' || price <= 0 || !equalsIgnoreCase(link.denom, denom) || (['uluna', 'uusd'].includes(denom) && moment(send?.created_at?.ms).diff(moment(TERRA_COLLAPSED_DATE, 'YYYYMMDD').utc(), 'seconds') > 0 && price > 0.1)) && denom) {
      const response = await getTokensPrice(denom, moment(send?.created_at?.ms).utc());
      if (typeof response === 'number') {
        price = response;
        link.price = response;
        link.denom = denom;
        updated = true;
      }
    }

    if (link.denom?.startsWith('ibc/')) {
      link.denom = getAssetData(link.denom)?.denom || link.denom;
    }

    if (deposit_address && updated) {
      const _id = deposit_address;
      await write(DEPOSIT_ADDRESS_COLLECTION, _id, link);
    }
  }
  return link;
};

const updateSend = async (send, link, data, update_only = false) => {
  if (send) {
    send.source_chain = link?.source_chain || send.source_chain;
    send.destination_chain = link?.destination_chain || send.destination_chain;
    send.original_source_chain = link?.original_source_chain || getChainData(send.source_chain || link?.source_chain)?.chain_name?.toLowerCase();
    send.original_destination_chain = link?.original_destination_chain || getChainData(send.destination_chain || link?.destination_chain)?.chain_name?.toLowerCase();

    if (link) {
      send.destination_chain = getChainKey(link.destination_chain || send.destination_chain);
      send.denom = send.denom || link.asset || link.denom;

      if (send.denom) {
        const { id, chain_id } = { ...getChainData(send.source_chain) };
        const asset_data = getAssetData(send.denom);
        const { addresses } = { ...asset_data };
        let { decimals } = { ...asset_data };
        decimals = decimals || (send.denom.includes('-wei') ? 18 : 6);

        // custom decimals for non-axelar wrap assets
        let _decimals = decimals;
        if (send.token_address && !equalsIgnoreCase(addresses?.[id]?.address, send.token_address)) {
          if ((['uusd'].includes(send.denom) && [137].includes(chain_id)) || (['uusdc'].includes(send.denom) && [3, 250].includes(chain_id))) {
            _decimals = 18;
          }
        }

        if (asset_data) {
          send.denom = asset_data.denom || send.denom;
          if (typeof send.amount === 'string') {
            _decimals === 18 ? _decimals : send.amount.length > 18 ? 18 : _decimals;
            send.amount = Number(formatUnits(send.amount, _decimals));
          }
          if (['uluna', 'uusd'].includes(send.denom) && moment(TERRA_COLLAPSED_DATE, 'YYYYMMDD').utc().diff(moment(send.created_at?.ms), 'seconds') > 0) {
            send.fee = parseFloat((send.amount * 0.001).toFixed(6));
          }
          if (typeof send.fee !== 'number') {
            const lcd = getLCD() && axios.create({ baseURL: getLCD(), timeout: 5000, headers: { 'Accept-Encoding': 'gzip' } });
            if (lcd) {
              const response = await lcd.get(
                '/axelar/nexus/v1beta1/transfer_fee',
                {
                  params: {
                    source_chain: send.original_source_chain,
                    destination_chain: send.original_destination_chain,
                    amount: `${parseUnits(send.amount, decimals)}${_.head(asset_data.denoms) || send.denom}`,
                  },
                },
              ).catch(error => parseRequestError(error));
              const { amount } = { ...response?.data?.fee };
              if (amount) {
                send.fee = Number(formatUnits(amount, decimals));
              }
            }
          }
        }
      }

      if (typeof send.amount === 'number' && typeof link.price === 'number') {
        send.value = send.amount * link.price;
      }
      if (typeof send.fee === 'number' && typeof link.price === 'number') {
        send.fee_value = send.fee * link.price;
      }
      if (typeof send.amount === 'number' && typeof send.fee === 'number') {
        if (send.amount <= send.fee) {
          send.insufficient_fee = true;
        }
        else {
          send.insufficient_fee = false;
          send.amount_received = send.amount - send.fee;
        }
        if (send.insufficient_fee && (data?.ibc_send || data?.command || data?.axelar_transfer || data?.unwrap?.tx_hash_unwrap || data?.vote)) {
          send.insufficient_fee = false;
        }
      }
    }

    if (send.denom?.startsWith('ibc/')) {
      send.denom = getAssetData(send.denom)?.denom || send.denom;
    }

    const _id = data?.id || generateId({ send });
    if (_id) {
      const { sender_address } = { ...send };
      const { prefix_address } = { ...getChainData(send.source_chain) };
      if (!prefix_address || sender_address?.startsWith(prefix_address)) {
        await write(TRANSFER_COLLECTION, _id, { ...data, send, link: link || undefined }, update_only);
      };
    }
  }
  return send;
};

module.exports = {
  isCommandExecuted,
  getReceiptLogIndex,
  setReceiptLogIndexToData,
  getTransaction,
  setTransactionIdToData,
  getBlockTime,
  setBlockNumberToData,
  normalizeLink,
  updateLink,
  updateSend,
};