const {
  toBeHex,
} = require('ethers');
const axios = require('axios');
const _ = require('lodash');

const {
  getChainData,
} = require('../../utils/config');
const {
  toBigNumber,
} = require('../../utils/number');
const {
  toArray,
} = require('../../utils');

const getReceiptLogIndex = (
  receipt,
  logIndex,
) => {
  const {
    logs,
  } = { ...receipt };

  return toArray(logs).findIndex(l => l?.logIndex === logIndex);
};

const setReceiptLogIndexToData = (
  data,
  logIndex,
) => {
  const {
    receipt,
  } = { ...data };

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

const getTransaction = async (
  provider,
  txHash,
  chain,
  logIndex,
) => {
  let output;

  if (provider && txHash) {
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
                      try {
                        const _v = await provider.getTransaction(txHash);

                        v = {
                          ..._v,
                          chainId: Number(_v.chainId),
                        };
                      } catch (error) {
                        const chain_data = getChainData(chain, 'evm');

                        for (const url of toArray(chain_data?.endpoints?.rpc)) {
                          try {
                            const rpc = axios.create({ baseURL: url });
                            const response = await rpc.post('', { jsonrpc: '2.0', method: 'eth_getTransactionByHash', params: [txHash], id: 0 }).catch(error => { return { data: { error: error?.response?.data } }; });

                            const {
                              data,
                            } = { ...response };

                            const {
                              result,
                            } = { ...data };

                            if (result) {
                              v =
                                Object.fromEntries(
                                  Object.entries({ ...result })
                                    .map(([k, v]) => {
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
                      }
                      break;
                    case 'receipt':
                      try {
                        const _v = await provider.getTransactionReceipt(txHash);

                        v = {
                          ..._v,
                          transactionIndex: typeof _v.transactionIndex === 'number' ? _v.transactionIndex : _v.index,
                          confirmations: await _v.confirmations(),
                          logs:
                            toArray(_v.logs)
                              .map(l => {
                                delete l.provider;
                                l.logIndex = typeof l.logIndex === 'number' ? l.logIndex : l.index;
                                delete l.index;

                                return {
                                  ...l,
                                };
                              }),
                        };

                        delete v.index;
                      } catch (error) {
                        const chain_data = getChainData(chain, 'evm');

                        for (const url of toArray(chain_data?.endpoints?.rpc)) {
                          try {
                            const rpc = axios.create({ baseURL: url });
                            const response = await rpc.post('', { jsonrpc: '2.0', method: 'eth_getTransactionReceipt', params: [txHash], id: 0 }).catch(error => { return { data: { error: error?.response?.data } }; });

                            const {
                              data,
                            } = { ...response };

                            const {
                              result,
                            } = { ...data };

                            if (result) {
                              v =
                                Object.fromEntries(
                                  Object.entries({ ...result })
                                    .map(([k, v]) => {
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
                                          v = toBigNumber(v);
                                          break;
                                        case 'logs':
                                          v =
                                            toArray(v)
                                              .map(l => {
                                                return {
                                                  ...Object.fromEntries(
                                                    Object.entries({ ...l })
                                                      .map(([_k, _v]) => {
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
    const {
      transactionHash,
      transactionIndex,
      transaction,
      receipt,
    } = { ...data };

    data.transactionHash = _.head(_.concat(transactionHash, receipt?.transactionHash, transaction?.hash).filter(h => typeof h === 'string'));
    data.transactionIndex = _.head(_.concat(transactionIndex, receipt?.transactionIndex, transaction?.transactionIndex).filter(i => typeof i === 'number'));
  }

  return data;
};

const getBlockTime = async (
  provider,
  blockNumber,
  chain,
) => {
  let output;

  if (provider && blockNumber) {
    try {
      const block = await provider.getBlock(blockNumber);

      const {
        timestamp,
      } = { ...block };

      if (timestamp) {
        output = timestamp;
      }
    } catch (error) {
      const chain_data = getChainData(chain, 'evm');

      for (const url of toArray(chain_data?.endpoints?.rpc)) {
        try {
          const rpc = axios.create({ baseURL: url });
          const response = await rpc.post('', { jsonrpc: '2.0', method: 'eth_getBlockByNumber', params: [toBeHex(blockNumber), false], id: 0 }).catch(error => { return { data: { error: error?.response?.data } }; });

          const {
            data,
          } = { ...response };

          const {
            timestamp,
          } = { ...data?.result };

          if (timestamp) {
            output = parseInt(toBigNumber(timestamp));
            break;
          }
        } catch (error) {}
      }
    }
  }

  return output;
};

const setBlockNumberToData = data => {
  if (data) {
    const {
      blockNumber,
      transaction,
      receipt,
    } = { ...data };

    data.blockNumber = blockNumber || receipt?.blockNumber || transaction?.blockNumber;
  }

  return data;
};

module.exports = {
  getReceiptLogIndex,
  setReceiptLogIndexToData,
  getTransaction,
  setTransactionIdToData,
  getBlockTime,
  setBlockNumberToData,
};