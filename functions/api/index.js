exports.handler = async (event, context, callback) => {
  // import module for http request
  const axios = require('axios');
  // import ethersjs
  const {
    BigNumber,
    Contract,
    providers: { JsonRpcProvider },
  } = require('ethers');
  // import module for date time
  const moment = require('moment');
  // import lodash
  const _ = require('lodash');
  // import config
  const config = require('config-yml');
  // import index
  const { crud } = require('./services/index');
  // import utils
  const { sleep, get_params, to_json, to_hex, get_granularity, normalize_chain, transfer_actions } = require('./utils');
  // data
  const { chains, assets } = require('./data');
  // IAxelarGateway
  const IAxelarGateway = require('./data/contracts/interfaces/IAxelarGateway.json');

  // initial environment
  const environment = process.env.ENVIRONMENT || config?.environment;

  // parse function event to req
  const req = {
    body: (event.body && JSON.parse(event.body)) || {},
    query: event.queryStringParameters || {},
    params: event.pathParameters || {},
    method: event.requestContext?.http?.method,
    url: event.routeKey?.replace('ANY ', ''),
    headers: event.headers,
  };

  // initial response
  let response;
  // initial params
  const params = get_params(req);

  // handle api routes
  switch (req.url) {
    case '/':
      // initial module
      const _module = params.module?.trim().toLowerCase();
      delete params.module;

      // initial path
      let path = params.path || '';
      delete params.path;

      // initial cache
      let cache = typeof params.cache === 'boolean' ? params.cache : params.cache?.trim().toLowerCase() === 'true' ? true : false;
      delete params.cache;
      const cache_timeout = params.cache_timeout ? Number(params.cache_timeout) : undefined;
      delete params.cache_timeout;

      // initial no index
      const no_index = typeof params.no_index === 'boolean' ? params.no_index : params.no_index?.trim().toLowerCase() === 'true' ? true : false;
      delete params.no_index;

      // initial lcd
      const lcd = axios.create({ baseURL: config?.[environment]?.endpoints?.lcd });

      // initial variables
      let res, response_cache, cache_id, cache_hit;

      // run each module
      switch (_module) {
        case 'rpc':
          if (config?.[environment]?.endpoints?.rpc) {
            const rpc = axios.create({ baseURL: config[environment].endpoints.rpc });
            // request rpc
            res = await rpc.get(path, { params })
              .catch(error => { return { data: { results: null, error } }; });

            // custom response
            if (path === '/status' && res?.data?.result) {
              res.data = res.data.result.sync_info;
              if (res.data.latest_block_height) {
                const latest_block_height = Number(res.data.latest_block_height);
                const num_blocks_avg_block_time = config[environment].num_blocks_avg_block_time || 100;
                const latest_n_block_height = latest_block_height - num_blocks_avg_block_time;

                // request lcd
                const response_block = await lcd.get(`/cosmos/base/tendermint/v1beta1/blocks/${latest_n_block_height}`)
                  .catch(error => { return { data: { error } }; });

                if (response_block?.data?.block?.header?.time) {
                  res.data.avg_block_time = moment(res.data.latest_block_time).diff(moment(response_block.data.block.header.time), 'seconds') / num_blocks_avg_block_time;
                }
              }
            }
            else if (path === '/dump_consensus_state' && res?.data?.result) {
              res.data = res.data.result.round_state;
            }
          }
          break;
        case 'lcd':
          // set id
          cache_id = path.split('/').join('_').toLowerCase();
          if (!cache) {
            if (Object.keys(params).length < 1) {
              cache = true;
            }
          }
          if (!cache_id || path.startsWith('/cosmos/tx/v1beta1/txs') || path.startsWith('/cosmos/base/tendermint/v1beta1/blocks')) {
            cache = false;
          }
          // get from cache
          if (cache) {
            response_cache = await crud({ index: 'cosmos', method: 'get', id: cache_id });
            response_cache = to_json(response_cache?.response);
            if (response_cache && moment().diff(moment(response_cache.updated_at * 1000), 'minutes', true) <= (cache_timeout || 1)) {
              res = { data: response_cache };
              cache_hit = true;
            }
          }
          // cache miss
          if (!res) {
            // request lcd
            res = await lcd.get(path, { params })
              .catch(error => { return { data: { error } }; });
          }
          // check cache
          if (res?.data) {
            // save
            if (cache && !cache_hit) {
              await crud({ index: 'cosmos', method: 'set', id: cache_id, response: JSON.stringify(res.data), updated_at: moment().unix() });
            }
          }
          else if (response_cache) {
            res = { data: response_cache };
          }
          // process
          const evm_chains = chains?.[environment]?.evm || [];
          const chains_rpc = Object.fromEntries(evm_chains.map(c => [c?.id, _.head(c?.provider_params?.[0]?.rpcUrls)]) || []);
          const cosmos_chains = chains?.[environment]?.cosmos?.filter(c => c?.id !== 'axelarnet') || [];
          const _assets = assets?.[environment] || [];
          const num_blocks_per_heartbeat = config?.[environment]?.num_blocks_per_heartbeat || 50;
          const fraction_heartbeat_block = config?.[environment]?.fraction_heartbeat_block || 1;
          if (path.startsWith('/cosmos/tx/v1beta1/txs/') && !path.endsWith('/') && res?.data?.tx_response?.txhash) {
            if (res.data.tx_response.logs?.findIndex(l => l?.events?.findIndex(e => e?.type === 'depositConfirmation' && e.attributes?.findIndex(a => a?.key === 'module' && a.value === 'evm') > -1) > -1) > -1) {
              const logIndex = res.data.tx_response.logs.findIndex(l => l?.events?.findIndex(e => e?.type === 'depositConfirmation' && e.attributes?.findIndex(a => a?.key === 'module' && a.value === 'evm') > -1) > -1);
              const log = res.data.tx_response.logs[logIndex];
              const eventIndex = log?.events?.findIndex(e => e?.type === 'depositConfirmation' && e.attributes?.findIndex(a => a?.key === 'module' && a.value === 'evm') > -1);
              const event = log.events[eventIndex];
              if (event?.attributes?.findIndex(a => a?.key === 'chain') > -1) {
                if (event?.attributes?.findIndex(a => a?.key === 'tokenAddress' && a.value) > -1 && event.attributes.findIndex(a => a?.key === 'amount' && a.value?.split('').findIndex(c => isNaN(c)) < 0) > -1) {
                  const tokenAddress = event.attributes.find(a => a?.key === 'tokenAddress' && a.value).value;
                  if (tokenAddress) {
                    const attrIndex = event.attributes.findIndex(a => a?.key === 'amount' && a.value?.split('').findIndex(c => isNaN(c)) < 0);
                    const attr = event.attributes[attrIndex];
                    if (attr?.value) {
                      const denom = _assets?.find(a => a?.contracts?.findIndex(c => c?.contract_address?.toLowerCase() === tokenAddress.toLowerCase()) > -1)?.id;
                      if (denom) {
                        try {
                          attr.value = `${attr.value}${denom}`;
                          event.attributes[attrIndex] = attr;
                          log.events[eventIndex] = event;
                          res.data.tx_response.logs[logIndex] = log;
                          res.data.tx_response.raw_log = JSON.stringify(res.data.tx_response.logs);
                        } catch (error) {}
                      }
                    }
                  }
                }
              }
            }

            const data = _.cloneDeep(res.data.tx_response);
            delete data.data;
            delete data.raw_log;
            delete data.events;
            data.timestamp = moment(data.timestamp).valueOf();
            if (data.tx?.body?.messages?.findIndex(m => m?.['@type']?.includes('ConfirmDepositRequest')) > -1) {
              const byteArrayFields = ['tx_id', 'burner_address', 'burn_address'];
              for (let i = 0; i < data.tx.body.messages.length; i++) {
                const message = data.tx.body.messages[i];
                if (typeof message.amount === 'string') {
                  const event = _.head(data.logs.flatMap(l => l?.events?.filter(e => e?.type === 'depositConfirmation')));
                  const amount_denom = event?.attributes?.find(a => a?.key === 'amount' && a.value)?.value;
                  const amount = amount_denom?.substring(0, amount_denom?.split('').findIndex(c => isNaN(c)) > -1 ? amount_denom.split('').findIndex(c => isNaN(c)) : undefined) || message.amount;
                  const denom = (amount_denom?.split('').findIndex(c => isNaN(c)) > -1 ? amount_denom.substring(amount_denom.split('').findIndex(c => isNaN(c))) : undefined) || message.denom;
                  message.amount = [{ amount, denom }];
                }
                for (let j = 0; j < byteArrayFields.length; j++) {
                  const field = byteArrayFields[j];
                  if (Array.isArray(message[field])) {
                    message[field] = to_hex(message[field]);
                  }
                }
              }
            }
            else if (data.tx?.body?.messages?.findIndex(m => m?.['@type']?.includes('LinkRequest')) > -1) {
              for (let i = 0; i < data.tx.body.messages.length; i++) {
                const message = data.tx.body.messages[i];
                message.denom = message.asset;
                delete message.asset;
                data.tx.body.messages[i] = message;
              }
            }
            else if (data.tx?.body?.messages?.findIndex(m => m?.['@type']?.includes('VoteRequest')) > -1) {
              const byteArrayFields = ['tx_id', 'to'];
              for (let i = 0; i < data.tx.body.messages.length; i++) {
                const message = data.tx.body.messages[i];
                if (message?.inner_message?.vote?.results) {
                  const results = message.inner_message.vote.results;
                  for (let j = 0; j < results.length; j++) {
                    const result = results[j];
                    for (let k = 0; k < byteArrayFields.length; k++) {
                      const field = byteArrayFields[k];
                      if (Array.isArray(result?.[field])) {
                        result[field] = to_hex(result[field]);
                      }
                      else if (Array.isArray(result?.transfer?.[field])) {
                        result.transfer[field] = to_hex(result.transfer[field]);
                      }
                      results[j] = result;
                      message.inner_message.vote.results = results;
                    }
                  }
                }
                data.tx.body.messages[i] = message;
              }
            }
            const addressFields = ['signer', 'sender', 'recipient', 'spender', 'receiver', 'depositAddress', 'voter'];
            let addresses = [], types = [];
            if (data.tx?.body?.messages) {
              addresses = _.uniq(_.concat(addresses, data.tx.body.messages.flatMap(m => _.concat(addressFields.map(f => m[f]), addressFields.map(f => m.inner_message?.[f])))).filter(a => typeof a === 'string' && a.startsWith('axelar')));
            }
            if (data.logs) {
              addresses = _.uniq(_.concat(addresses, data.logs.flatMap(l => l?.events?.flatMap(e => e?.attributes?.filter(a => addressFields.includes(a.key)).map(a => a.value) || []) || [])).filter(a => typeof a === 'string' && a.startsWith('axelar')));
            }
            data.addresses = addresses;
            if (data.tx?.body?.messages) {
              types = _.uniq(_.concat(types, data.tx.body.messages.flatMap(m => [_.last(m?.['@type']?.split('.')), _.last(m?.inner_message?.['@type']?.split('.'))])).filter(t => t));
            }
            data.types = types;
            await crud({ index: 'txs', method: 'set', id: data.txhash, ...data });

            if (!res.data.tx_response.code) {
              // Heartbeat
              if (res.data.tx?.body?.messages?.findIndex(m => m?.inner_message?.['@type']?.includes('HeartBeatRequest')) > -1) {
                const tx = {
                  txhash: res.data.tx_response.txhash,
                  height: Number(res.data.tx_response.height),
                  timestamp: moment(res.data.tx_response.timestamp).valueOf(),
                  height_group: Number(res.data.tx_response.height) - (Number(res.data.tx_response.height) % num_blocks_per_heartbeat) + fraction_heartbeat_block,
                  signatures: res.data.tx.signatures,
                  sender: _.head(res.data.tx.body?.messages?.map(m => m?.sender) || []),
                  key_ids: _.uniq(res.data.tx.body?.messages?.flatMap(m => m?.inner_message?.key_ids || []) || []),
                };
                if (tx.sender) {
                  await crud({ index: 'heartbeats', method: 'set', id: `${tx.sender}_${tx.height_group}`, ...tx });
                }
              }
              // Link
              else if (res.data.tx?.body?.messages?.findIndex(m => m?.['@type']?.includes('LinkRequest')) > -1) {
                const event = _.head(res.data.tx_response?.logs?.flatMap(l => l?.events?.filter(e => e?.type === 'link')));
                const sender_chain = event?.attributes?.find(a => a?.key === 'sourceChain' && a.value)?.value;
                const deposit_address = event?.attributes?.find(a => a?.key === 'depositAddress' && a.value)?.value;
                const tx = {
                  ...res.data.tx.body.messages[0],
                  txhash: res.data.tx_response?.txhash,
                  height: Number(res.data.tx_response?.height),
                  sender_chain,
                  deposit_address,
                };
                tx.type = tx['@type']?.split('.')[0]?.replace('/', '');
                delete tx['@type'];
                tx.sender_address = tx.sender?.toLowerCase();
                delete tx.sender;
                tx.sender_chain = normalize_chain(cosmos_chains.find(c => tx.sender_address?.startsWith(c?.prefix_address))?.id || tx.sender_chain || tx.chain || 'axelarnet');
                delete tx.chain;
                tx.recipient_address = tx.recipient_addr?.toLowerCase();
                delete tx.recipient_addr;
                tx.recipient_chain = normalize_chain(tx.recipient_chain);
                await crud({ index: 'linked_addresses', method: 'set', id: tx.deposit_address?.toLowerCase() || tx.txhash, ...tx });
              }
              // MsgSend
              else if (res.data.tx?.body?.messages?.findIndex(m => _.last(m?.['@type']?.split('.')) === 'MsgSend') > -1) {
                const type = 'axelarnet_transfer';
                const height = Number(res.data.tx_response.height);
                const created_at = moment(res.data.tx_response.timestamp).utc();
                const sender_address = res.data.tx.body.messages.find(m => m?.from_address)?.from_address?.toLowerCase();
                const recipient_address = res.data.tx.body.messages.find(m => m?.to_address)?.to_address?.toLowerCase();
                const amount_denom = res.data.tx.body.messages.find(m => m?.amount)?.amount?.[0];
                const amount = Number(amount_denom?.amount);
                const denom = amount_denom?.denom;
                const tx = {
                  id: res.data.tx_response.txhash?.toLowerCase(),
                  type,
                  status_code: res.data.tx_response.code,
                  status: res.data.tx_response.code ? 'failed' : 'success',
                  height,
                  created_at: get_granularity(created_at),
                  sender_address,
                  recipient_address,
                  amount,
                  denom,
                };
                if (tx.recipient_address?.length >= 65 && tx.id && tx.amount > 0) {
                  const query = {
                    match: {
                      deposit_address: tx.recipient_address,
                    },
                  };
                  const response_linked = await crud({ index: 'linked_addresses', method: 'search', query, size: 1 });
                  const linked = response_linked?.data?.[0];
                  if (linked) {
                    tx.sender_chain = linked.sender_chain;
                    tx.recipient_chain = linked.recipient_chain;
                    tx.denom = tx.denom || linked.asset;
                  }
                  await crud({ index: 'crosschain_txs', method: 'set', path: `/crosschain_txs/_update/${tx.id}`, id: tx.id, send: tx });
                }
              }
              // MsgRecvPacket -> MsgTransfer
              else if (res.data.tx_response && res.data.tx?.body?.messages?.findIndex(m => _.last(m?.['@type']?.split('.')) === 'MsgRecvPacket') > -1) {
                const event_recv_packets = res.data.tx_response.logs.map(l => {
                  return {
                    ...l?.events?.find(e => e?.type === 'recv_packet'),
                    height: Number(res.data.tx.body.messages.find(m => _.last(m?.['@type']?.split('.')) === 'MsgRecvPacket')?.proof_height?.revision_height || '0') - 1,
                  };
                });
                for (let i = 0; i < event_recv_packets.length; i++) {
                  const event_recv_packet = event_recv_packets[i];
                  const packet_data = to_json(event_recv_packet?.attributes?.find(a => a?.key === 'packet_data' && a.value)?.value);
                  const packet_data_hex = event_recv_packet?.attributes?.find(a => a?.key === 'packet_data_hex' && a.value)?.value;
                  const packet_sequence = event_recv_packet?.attributes?.find(a => a?.key === 'packet_sequence' && a.value)?.value;
                  const _height = event_recv_packet?.height;
                  if (_height && packet_data_hex && packet_data && typeof packet_data === 'object') {
                    for (let j = 0; j < cosmos_chains.length; j++) {
                      const chain = cosmos_chains[j];
                      if (chain?.endpoints?.lcd && packet_data.sender?.startsWith(chain.prefix_address)) {
                        // initial lcd
                        const lcd = axios.create({ baseURL: chain.endpoints.lcd });
                        // request lcd
                        const response_txs = await lcd.get(`/cosmos/tx/v1beta1/txs?limit=5&events=${encodeURIComponent(`send_packet.packet_data_hex='${packet_data_hex}'`)}&events=tx.height=${_height}`)
                          .catch(error => { return { data: { error } }; });
                        const transactionIndex = response_txs?.data?.tx_responses?.findIndex(t => {
                          const event_send_packet = _.head(t?.logs.flatMap(l => l?.events?.filter(e => e?.type === 'send_packet')));
                          const _packet_sequence = event_send_packet?.attributes?.find(a => a?.key === 'packet_sequence' && a.value)?.value;
                          return packet_sequence === _packet_sequence;
                        });
                        if (transactionIndex > -1) {
                          const tx = {
                            ...response_txs.data.tx_responses[transactionIndex],
                            tx: {
                              ...response_txs.data.txs?.[transactionIndex],
                            },
                          };
                          if (tx.tx.body?.messages) {
                            const type = 'ibc_transfer';
                            const height = Number(tx.height);
                            const created_at = moment(tx.timestamp).utc();
                            const sender_address = tx.tx.body.messages.find(m => m?.sender)?.sender?.toLowerCase();
                            const recipient_address = tx.tx.body.messages.find(m => m?.receiver)?.receiver?.toLowerCase();
                            const amount_denom = tx.tx.body.messages.find(m => m?.token)?.token;
                            const amount = Number(amount_denom?.amount);
                            const denom = amount_denom?.denom;
                            const tx_send = {
                              id: tx.txhash?.toLowerCase(),
                              type,
                              status_code: tx.code,
                              status: tx.code ? 'failed' : 'success',
                              height,
                              created_at: get_granularity(created_at),
                              sender_chain: chain.id,
                              sender_address,
                              recipient_address,
                              amount,
                              denom,
                            };
                            if (tx_send.recipient_address?.length >= 65 && tx_send.id && tx_send.amount > 0) {
                              const query = {
                                match: {
                                  deposit_address: tx_send.recipient_address,
                                },
                              };
                              const response_linked = await crud({ index: 'linked_addresses', method: 'search', query, size: 1 });
                              const linked = response_linked?.data?.[0];
                              if (linked) {
                                tx_send.recipient_chain = linked.recipient_chain;
                                tx_send.denom = tx_send.denom || linked.asset;
                              }
                              await crud({ index: 'crosschain_txs', method: 'set', path: `/crosschain_txs/_update/${tx_send.id}`, id: tx_send.id, send: tx_send });
                              break;
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
              // ConfirmDeposit / ConfirmERC20Deposit
              else if (res.data.tx_response && res.data.tx?.body?.messages?.findIndex(m => transfer_actions?.includes(_.last(m?.['@type']?.split('.'))?.replace('Request', ''))) > -1) {
                const event_message = _.head(res.data.tx_response.logs.flatMap(l => l?.events?.filter(e => e?.type === 'message')));
                const type = event_message?.attributes?.find(a => a?.key === 'action' && transfer_actions?.includes(a.value))?.value || _.last(res.data.tx.body.messages.find(m => transfer_actions?.includes(_.last(m?.['@type']?.split('.'))?.replace('Request', '')))?.['@type']?.split('.'))?.replace('Request', '');
                const height = Number(res.data.tx_response.height);
                const created_at = moment(res.data.tx_response.timestamp).utc();
                const user = res.data.tx.body.messages.find(m => m?.sender)?.sender?.toLowerCase();
                const event = _.head(res.data.tx_response.logs.flatMap(l => l?.events?.filter(e => e?.type === 'depositConfirmation')));
                const __module = event?.attributes?.find(a => a?.key === 'module' && a.value)?.value || (type === 'ConfirmDeposit' ? 'axelarnet' : 'evm');
                const sender_chain = normalize_chain(res.data.tx.body.messages.find(m => m?.chain)?.chain || event?.attributes?.find(a => ['sourceChain', 'chain'].includes(a?.key) && a.value)?.value || __module);
                const recipient_chain = normalize_chain(event?.attributes?.find(a => ['destinationChain'].includes(a?.key) && a.value)?.value);
                const amount_denom = event?.attributes?.find(a => a?.key === 'amount' && a.value)?.value;
                const amount = Number(res.data.tx.body.messages.find(m => m?.amount)?.amount || amount_denom?.substring(0, amount_denom?.split('').findIndex(c => isNaN(c)) > -1 ? amount_denom.split('').findIndex(c => isNaN(c)) : undefined));
                const denom = res.data.tx.body.messages.find(m => m?.denom)?.denom || (amount_denom?.split('').findIndex(c => isNaN(c)) > -1 ? amount_denom.substring(amount_denom.split('').findIndex(c => isNaN(c))) : undefined);
                const token_address = event?.attributes?.find(a => a?.key === 'tokenAddress' && a.value)?.value?.toLowerCase();
                const deposit_address = res.data.tx.body.messages.find(m => m?.deposit_address)?.deposit_address?.toLowerCase() || event?.attributes?.find(a => a?.key === 'depositAddress' && a.value)?.value?.toLowerCase();
                const transfer_id = Number(event?.attributes?.find(a => a?.key === 'transferID' && a.value)?.value);
                const poll_id = to_json(event?.attributes?.find(a => a?.key === 'poll' && a.value)?.value)?.id?.toLowerCase();
                const transaction_id = event?.attributes?.find(a => a?.key === 'txID' && a.value)?.value?.toLowerCase() || poll_id?.split('_')[0];
                const tx = {
                  id: res.data.tx_response.txhash?.toLowerCase(),
                  type,
                  status_code: res.data.tx_response.code,
                  status: res.data.tx_response.code ? 'failed' : 'success',
                  height,
                  created_at: get_granularity(created_at),
                  user,
                  module: __module,
                  sender_chain,
                  recipient_chain,
                  amount,
                  denom,
                  token_address,
                  deposit_address,
                  transfer_id,
                  poll_id,
                  transaction_id,
                };
                if (!tx.status_code && (tx.transfer_id || tx.poll_id) && tx.id/* && tx.amount > 0*/) {
                  if (tx.type === 'ConfirmDeposit') {
                    let signed, send_gateway;
                    let query = {
                      bool: {
                        must: [
                          { match: { deposit_address: tx.deposit_address } },
                        ],
                      },
                    };
                    const response_linked = !tx.recipient_chain && await crud({ index: 'linked_addresses', method: 'search', query, size: 1 });
                    const linked = response_linked?.data?.[0];
                    if (linked?.recipient_chain || tx.recipient_chain) {
                      const recipient_chain = linked?.recipient_chain || tx.recipient_chain;
                      const command_id = tx.transfer_id.toString(16).padStart(64, '0');
                      query = {
                        bool: {
                          must: [
                            { match: { chain: recipient_chain } },
                            { match: { status: 'BATCHED_COMMANDS_STATUS_SIGNED' } },
                            { match: { command_ids: command_id } },
                          ],
                        },
                      };
                      const response_batch = await crud({ index: 'batches', method: 'search', query, size: 1 });
                      const batch = response_batch?.data?.[0];
                      if (batch) {
                        signed = {
                          chain: recipient_chain,
                          batch_id: batch.batch_id,
                          command_id,
                          transfer_id: tx.transfer_id,
                        };
                        const provider = new JsonRpcProvider(chains_rpc[recipient_chain]);
                        const gateway_address = evm_chains?.find(c => c?.id === recipient_chain)?.gateway_address;
                        const gateway = gateway_address && new Contract(gateway_address, IAxelarGateway.abi, provider);
                        if (gateway) {
                          try {
                            const executed = await gateway.isCommandExecuted(`0x${command_id}`);
                            if (executed) {
                              send_gateway = signed;
                            }
                          } catch (error) {}
                        }
                      }
                    }

                    query = {
                      bool: {
                        must: [
                          { match: { 'send.status_code': 0 } },
                          { match: { 'send.recipient_address': tx.deposit_address } },
                          { range: { 'send.created_at.ms': { lte: tx.created_at.ms } } },
                        ],
                        should: [
                          { range: { 'confirm_deposit.created_at.ms': { gt: tx.created_at.ms } } },
                          { bool: {
                            must_not: [
                              { exists: { field: 'confirm_deposit' } },
                            ],
                          } },
                        ],
                      },
                    };
                    let response_txs = await crud({ index: 'crosschain_txs', method: 'search', query, size: 100 });
                    if (response_txs?.data?.length > 0) {
                      const txs = response_txs.data.filter(tx => tx?.send?.id);
                      const ids = txs.map(tx => tx.send.id);
                      for (let i = 0; i < ids.length; i++) {
                        const id = ids[i];
                        const _tx = txs[i];
                        const tx_send = _tx.send;
                        const params = { index: 'crosschain_txs', method: 'update', path: `/crosschain_txs/_update/${id}`, id, ...tx, confirm_deposit: tx };
                        if (signed) {
                          params.signed = signed;
                        }
                        if (send_gateway) {
                          params.send_gateway = send_gateway;
                        }
                        if (tx_send) {
                          tx_send.sender_chain = cosmos_chains.find(c => tx_send.sender_address?.startsWith(c?.prefix_address))?.id || tx.sender_chain;
                          tx_send.recipient_chain = tx_send.recipient_chain || tx.recipient_chain;
                          params.send = tx_send;
                        }
                        await crud(params);
                      }
                    }
                    else if (signed) {
                      query = {
                        bool: {
                          must: [
                            { match: { 'send.recipient_address': tx.deposit_address } },
                            { match: { 'confirm_deposit.transfer_id': tx.transfer_id } },
                          ],
                        },
                      };
                      response_txs = await crud({ index: 'crosschain_txs', method: 'search', query, size: 100 });
                      if (response_txs?.data?.length > 0) {
                        const txs = response_txs.data.filter(tx => tx?.send?.id);
                        const ids = txs.map(tx => tx.send.id);
                        for (let i = 0; i < ids.length; i++) {
                          const id = ids[i];
                          const tx = txs[i];
                          const tx_send = tx.send;
                          const params = { index: 'crosschain_txs', method: 'update', path: `/crosschain_txs/_update/${id}`, id, ...tx, signed };
                          if (send_gateway) {
                            params.send_gateway = send_gateway;
                          }
                          if (tx_send) {
                            tx_send.sender_chain = cosmos_chains.find(c => tx_send.sender_address?.startsWith(c?.prefix_address))?.id || tx.sender_chain;
                            tx_send.recipient_chain = tx_send.recipient_chain || tx.recipient_chain;
                            params.send = tx_send;
                          }
                          await crud(params);
                        }
                      }
                    }
                  }
                  else if (tx.type === 'ConfirmERC20Deposit') {
                    try {
                      const provider = new JsonRpcProvider(chains_rpc[tx.sender_chain]);
                      const transaction_id = tx.transaction_id?.toLowerCase();
                      if (transaction_id) {
                        const transaction = await provider.getTransaction(transaction_id);
                        const height = transaction?.blockNumber;
                        if (height) {
                          tx.amount = BigNumber.from(`0x${transaction.data?.substring(10 + 64) || transaction.input?.substring(10 + 64) || '0'}`).toNumber() || tx.amount;
                          if (transaction.to?.toLowerCase() === tx.token_address?.toLowerCase() || _assets?.findIndex(a => a?.contracts?.findIndex(c => c?.contract_address?.toLowerCase() === transaction.to?.toLowerCase()) > -1) > -1) {
                            tx.denom = _assets?.find(a => a?.contracts?.findIndex(c => c?.contract_address?.toLowerCase() === transaction.to.toLowerCase()) > -1)?.id || tx.denom;
                            const tx_send = {
                              id: transaction_id,
                              type: 'evm_transfer',
                              status_code: 0,
                              status: 'success',
                              height,
                              created_at: get_granularity(created_at),
                              sender_address: transaction.from?.toLowerCase(),
                              recipient_address: tx.deposit_address,
                              sender_chain: tx.sender_chain,
                              recipient_chain: tx.recipient_chain,
                              amount: tx.amount,
                              denom: tx.denom,
                            };
                            const query = {
                              match: {
                                deposit_address: tx.deposit_address,
                              },
                            };
                            const response_linked = await crud({ index: 'linked_addresses', method: 'search', query, size: 1 });
                            const linked = response_linked?.data?.[0];
                            if (linked) {
                              tx_send.sender_chain = linked.sender_chain || tx_send.sender_chain;
                              tx_send.recipient_chain = linked.recipient_chain || tx_send.recipient_chain;
                              tx_send.denom = tx_send.denom || linked.asset;
                            }
                            await crud({ index: 'crosschain_txs', method: 'set', path: `/crosschain_txs/_update/${transaction_id}`, id: transaction_id, send: tx_send, confirm_deposit: tx });
                          }
                        }
                      }
                    } catch (error) {}
                  }
                }
              }
              // VoteConfirmDeposit
              if (res.data.tx_response && res.data.tx?.body?.messages?.findIndex(m => _.last(m?.inner_message?.['@type']?.split('.'))?.replace('Request', '') === 'VoteConfirmDeposit') > -1) {
                const messages = res.data.tx.body.messages;
                for (let i = 0; i < messages.length; i++) {
                  const message = messages[i];
                  const type = _.last(message?.inner_message?.['@type']?.split('.'))?.replace('Request', '');
                  if (type === 'VoteConfirmDeposit') {
                    const height = Number(res.data.tx_response.height);
                    const created_at = moment(res.data.tx_response.timestamp).utc();
                    const event = res.data.tx_response.logs?.[i]?.events?.find(e => e?.type === 'depositConfirmation');
                    const __module = event?.attributes?.find(a => a?.key === 'module' && a.value)?.value || 'evm';
                    const sender_chain = normalize_chain(message?.inner_message?.chain || event?.attributes?.find(a => ['sourceChain', 'chain'].includes(a?.key) && a.value)?.value || __module);
                    const recipient_chain = normalize_chain(event?.attributes?.find(a => ['destinationChain'].includes(a?.key) && a.value)?.value);
                    const transfer_id = Number(event?.attributes?.find(a => a?.key === 'transferID' && a.value)?.value);
                    const poll_id = to_json(message?.inner_message?.poll_key || event?.attributes?.find(a => a?.key === 'poll' && a.value)?.value)?.id?.toLowerCase();
                    const transaction_id = event?.attributes?.find(a => a?.key === 'txID' && a.value)?.value?.toLowerCase() || poll_id?.split('_')[0];
                    const deposit_address = event?.attributes?.find(a => a?.key === 'depositAddress' && a.value)?.value?.toLowerCase() || poll_id?.split('_')[1];
                    const confirmed = message?.inner_message?.confirmed || false;
                    const vote_confirmed = res.data.tx_response.logs?.findIndex(l => l?.events?.findIndex(e => e?.type === 'depositConfirmation' && e.attributes?.findIndex(a => a?.key === 'action' && a.value === 'confirm') > -1) > -1) > -1;
                    const poll_initial = res.data.tx_response.logs?.findIndex(l => l?.log?.startsWith('not enough votes')) > -1;
                    const tx = {
                      id: res.data.tx_response.txhash?.toLowerCase(),
                      type,
                      status_code: res.data.tx_response.code,
                      status: res.data.tx_response.code ? 'failed' : 'success',
                      height,
                      created_at: get_granularity(created_at),
                      module: __module,
                      sender_chain,
                      recipient_chain,
                      deposit_address,
                      transfer_id,
                      poll_id,
                      transaction_id,
                      confirmed,
                      voter: message?.inner_message?.sender,
                      vote_confirmed,
                      poll_initial,
                    };
                    if (!tx.status_code && tx.poll_id && tx.confirmed && tx.id && tx.vote_confirmed) {
                      try {
                        const provider = new JsonRpcProvider(chains_rpc[tx.sender_chain]);
                        const transaction_id = tx.transaction_id?.toLowerCase();
                        if (transaction_id) {
                          const transaction = await provider.getTransaction(transaction_id);
                          const height = transaction?.blockNumber;
                          if (height) {
                            tx.amount = BigNumber.from(`0x${transaction.data?.substring(10 + 64) || transaction.input?.substring(10 + 64) || '0'}`).toNumber() || Number(_.last(tx.poll_id?.split('_')));
                            if (transaction.to?.toLowerCase() === tx.token_address?.toLowerCase() || _assets?.findIndex(a => a?.contracts?.findIndex(c => c?.contract_address?.toLowerCase() === transaction.to?.toLowerCase()) > -1) > -1) {
                              tx.denom = _assets?.find(a => a?.contracts?.findIndex(c => c?.contract_address?.toLowerCase() === transaction.to.toLowerCase()) > -1)?.id || tx.denom;
                              const tx_send = {
                                id: transaction_id,
                                type: 'evm_transfer',
                                status_code: 0,
                                status: 'success',
                                height,
                                created_at: tx.created_at,
                                sender_address: transaction.from?.toLowerCase(),
                                recipient_address: tx.deposit_address,
                                sender_chain: tx.sender_chain,
                                recipient_chain: tx.recipient_chain,
                                amount: tx.amount,
                                denom: tx.denom,
                              };
                              const query = {
                                match: {
                                  deposit_address: tx.deposit_address,
                                },
                              };
                              const response_linked = await crud({ index: 'linked_addresses', method: 'search', query, size: 1 });
                              const linked = response_linked?.data?.[0];
                              if (linked) {
                                tx_send.sender_chain = linked.sender_chain || tx_send.sender_chain;
                                tx_send.recipient_chain = linked.recipient_chain || tx_send.recipient_chain;
                                tx_send.denom = tx_send.denom || linked.asset;
                              }
                              await sleep(0.5 * 1000);
                              const response_txs = await crud({ index: 'crosschain_txs', method: 'search', query: { match: { 'send.id': transaction_id } }, size: 1 });
                              const tx_confirm_deposit = response_txs?.data?.[0]?.confirm_deposit;
                              const params = { index: 'crosschain_txs', method: 'set', path: `/crosschain_txs/_update/${transaction_id}`, id: transaction_id, send: tx_send, vote_confirm_deposit: tx };
                              if (tx_confirm_deposit) {
                                params.confirm_deposit = tx_confirm_deposit;
                              }
                              await crud(params);
                            }
                          }
                        }
                      } catch (error) {}
                    }
                    if (!tx.status_code && tx.poll_id && tx.voter) {
                      const vote = {
                        id: `${tx.poll_id}_${tx.voter}`,
                        txhash: tx.id,
                        height: tx.height,
                        created_at: tx.created_at,
                        sender: tx.voter,
                        sender_chain: tx.sender_chain,
                        module: tx.module,
                        poll_id: tx.poll_id,
                        transaction_id: tx.transaction_id,
                        confirmed: tx.confirmed,
                        vote_confirmed: tx.vote_confirmed,
                        poll_initial: tx.poll_initial,
                      };
                      if (vote.poll_initial) {
                        vote.poll_start_height = vote.height;
                      }
                      await crud({ index: 'evm_votes', method: 'set', path: `/evm_votes/_update/${vote.id}`, ...vote });
                    }
                  }
                }
              }
              // Vote
              else if (res.data.tx_response && res.data.tx?.body?.messages?.findIndex(m => _.last(m?.inner_message?.['@type']?.split('.'))?.replace('Request', '') === 'Vote') > -1) {
                const messages = res.data.tx.body.messages;
                for (let i = 0; i < messages.length; i++) {
                  const message = messages[i];
                  const type = _.last(message?.inner_message?.['@type']?.split('.'))?.replace('Request', '');
                  if (type === 'Vote') {
                    const height = Number(res.data.tx_response.height);
                    const created_at = moment(res.data.tx_response.timestamp).utc();
                    const event = res.data.tx_response.logs?.[i]?.events?.find(e => e?.type === 'vote');
                    const confirmed_event = res.data.tx_response.logs?.[i]?.events?.find(e => e?.type === 'depositConfirmation');
                    const __module = message?.inner_message?.poll_key?.module || event?.attributes?.find(a => a?.key === 'module' && a.value)?.value || 'evm';
                    const sender_chain = normalize_chain(message?.inner_message?.vote?.results?.[0]?.chain);
                    const recipient_chain = normalize_chain(confirmed_event?.attributes?.find(a => a?.key === 'destinationChain' && a.value)?.value);
                    const transfer_id = confirmed_event?.attributes?.find(a => a?.key === 'transferID' && a.value)?.value;
                    const poll_id = to_json(message?.inner_message?.poll_key || event?.attributes?.find(a => a?.key === 'poll' && a.value)?.value)?.id?.toLowerCase();
                    const transaction_id = confirmed_event?.attributes?.find(a => a?.key === 'txID' && a.value)?.value || poll_id?.split('_')[0];
                    const deposit_address = confirmed_event?.attributes?.find(a => a?.key === 'depositAddress' && a.value)?.value || poll_id?.split('_')[1];
                    const confirmed = message?.inner_message?.vote?.results?.length > 0;
                    const vote_confirmed = !!confirmed_event;
                    const poll_initial = res.data.tx_response.logs?.findIndex(l => l?.log?.startsWith('not enough votes')) > -1;
                    const tx = {
                      id: res.data.tx_response.txhash?.toLowerCase(),
                      type,
                      status_code: res.data.tx_response.code,
                      status: res.data.tx_response.code ? 'failed' : 'success',
                      height,
                      created_at: get_granularity(created_at),
                      module: __module,
                      sender_chain,
                      recipient_chain,
                      deposit_address,
                      transfer_id,
                      poll_id,
                      transaction_id,
                      confirmed,
                      voter: message?.inner_message?.sender,
                      vote_confirmed,
                      poll_initial,
                    };
                    if (!tx.status_code && tx.deposit_address && !tx.sender_chain) {
                      const query = {
                        bool: {
                          must: [
                            { match: { deposit_address: tx.deposit_address } },
                          ],
                        },
                      };
                      const response_linked = await crud({ index: 'linked_addresses', method: 'search', query, size: 1 });
                      const linked = response_linked?.data?.[0];
                      if (linked?.sender_chain) {
                        tx.sender_chain = linked.sender_chain;
                      }
                    }
                    if (!tx.status_code && tx.poll_id && tx.confirmed && tx.id && tx.vote_confirmed) {
                      try {
                        const provider = new JsonRpcProvider(chains_rpc[tx.sender_chain]);
                        const transaction_id = tx.transaction_id?.toLowerCase();
                        if (transaction_id) {
                          const transaction = await provider.getTransaction(transaction_id);
                          const height = transaction?.blockNumber;
                          if (height) {
                            tx.amount = BigNumber.from(`0x${transaction.data?.substring(10 + 64) || transaction.input?.substring(10 + 64) || '0'}`).toNumber() || Number(_.last(tx.poll_id?.split('_')));
                            if (transaction.to?.toLowerCase() === tx.token_address?.toLowerCase() || _assets?.findIndex(a => a?.contracts?.findIndex(c => c?.contract_address?.toLowerCase() === transaction.to?.toLowerCase()) > -1) > -1) {
                              tx.denom = _assets?.find(a => a?.contracts?.findIndex(c => c?.contract_address?.toLowerCase() === transaction.to.toLowerCase()) > -1)?.id || tx.denom;
                              const tx_send = {
                                id: transaction_id,
                                type: 'evm_transfer',
                                status_code: 0,
                                status: 'success',
                                height,
                                created_at: tx.created_at,
                                sender_address: transaction.from?.toLowerCase(),
                                recipient_address: tx.deposit_address,
                                sender_chain: tx.sender_chain,
                                recipient_chain: tx.recipient_chain,
                                amount: tx.amount,
                                denom: tx.denom,
                              };
                              const query = {
                                match: {
                                  deposit_address: tx.deposit_address,
                                },
                              };
                              const response_linked = await crud({ index: 'linked_addresses', method: 'search', query, size: 1 });
                              const linked = response_linked?.data?.[0];
                              if (linked) {
                                tx_send.sender_chain = linked.sender_chain || tx_send.sender_chain;
                                tx_send.recipient_chain = linked.recipient_chain || tx_send.recipient_chain;
                                tx_send.denom = tx_send.denom || linked.asset;
                              }
                              await sleep(0.5 * 1000);
                              const response_txs = await crud({ index: 'crosschain_txs', method: 'search', query: { match: { 'send.id': transaction_id } }, size: 1 });
                              const tx_confirm_deposit = response_txs?.data?.[0]?.confirm_deposit;
                              const params = { index: 'crosschain_txs', method: 'set', path: `/crosschain_txs/_update/${transaction_id}`, id: transaction_id, send: tx_send, vote_confirm_deposit: tx };
                              if (tx_confirm_deposit) {
                                params.confirm_deposit = tx_confirm_deposit;
                              }
                              await crud(params);
                            }
                          }
                        }
                      } catch (error) {}
                    }
                    if (!tx.status_code && tx.poll_id && tx.voter) {
                      const vote = {
                        id: `${tx.poll_id}_${tx.voter}`,
                        txhash: tx.id,
                        height: tx.height,
                        created_at: tx.created_at,
                        sender: tx.voter,
                        sender_chain: tx.sender_chain,
                        module: tx.module,
                        poll_id: tx.poll_id,
                        transaction_id: tx.transaction_id,
                        confirmed: tx.confirmed,
                        vote_confirmed: tx.vote_confirmed,
                        poll_initial: tx.poll_initial,
                      };
                      if (vote.poll_initial) {
                        vote.poll_start_height = vote.height;
                      }
                      await crud({ index: 'evm_votes', method: 'set', path: `/evm_votes/_update/${vote.id}`, ...vote });
                    }
                  }
                }
              }
            }
          }
          else if (path.startsWith('/cosmos/tx/v1beta1/txs') && !path.endsWith('/') && res?.data?.tx_responses?.length > 0) {
            for (let i = 0; i < res.data.tx_responses.length; i++) {
              const tx = res.data.tx_responses[i];
              if (tx?.logs?.findIndex(l => l?.events?.findIndex(e => e?.type === 'depositConfirmation' && e.attributes?.findIndex(a => a?.key === 'module' && a.value === 'evm') > -1) > -1) > -1) {
                const logIndex = tx.logs.findIndex(l => l?.events?.findIndex(e => e?.type === 'depositConfirmation' && e.attributes?.findIndex(a => a?.key === 'module' && a.value === 'evm') > -1) > -1);
                const log = tx.logs[logIndex];
                const eventIndex = log?.events?.findIndex(e => e?.type === 'depositConfirmation' && e.attributes?.findIndex(a => a?.key === 'module' && a.value === 'evm') > -1);
                const event = log.events[eventIndex];
                if (event?.attributes?.findIndex(a => a?.key === 'chain') > -1) {
                  if (event?.attributes?.findIndex(a => a?.key === 'tokenAddress' && a.value) > -1 && event.attributes.findIndex(a => a?.key === 'amount' && a.value?.split('').findIndex(c => isNaN(c)) < 0) > -1) {
                    const tokenAddress = event.attributes.find(a => a?.key === 'tokenAddress' && a.value).value;
                    if (tokenAddress) {
                      const attrIndex = event.attributes.findIndex(a => a?.key === 'amount' && a.value?.split('').findIndex(c => isNaN(c)) < 0);
                      const attr = event.attributes[attrIndex];
                      if (attr?.value) {
                        const denom = _assets?.find(a => a?.contracts?.findIndex(c => c?.contract_address?.toLowerCase() === tokenAddress.toLowerCase()) > -1)?.id;
                        if (denom) {
                          try {
                            attr.value = `${attr.value}${denom}`;
                            event.attributes[attrIndex] = attr;
                            log.events[eventIndex] = event;
                            tx.logs[logIndex] = log;
                            tx.raw_log = JSON.stringify(tx.logs);
                          } catch (error) {}
                        }
                      }
                    }
                  }
                }
              }
              res.data.tx_responses[i] = { ...tx };
            }

            if (!no_index) {
              // Heartbeat
              let txs = res.data.tx_responses.map((tx, i) => {
                if (tx && !tx.code && res.data.txs?.[i]?.body?.messages?.findIndex(m => m?.inner_message?.['@type']?.includes('HeartBeatRequest')) > -1) {
                  return {
                    txhash: tx.txhash,
                    height: Number(tx.height),
                    timestamp: moment(tx.timestamp).valueOf(),
                    height_group: Number(tx.height) - (Number(tx.height) % num_blocks_per_heartbeat) + fraction_heartbeat_block,
                    signatures: res.data.txs?.[i]?.signatures,
                    sender: _.head(res.data.txs?.[i]?.body?.messages?.map(m => m?.sender) || []),
                    key_ids: _.uniq(res.data.txs?.[i]?.body?.messages?.flatMap(m => m?.inner_message?.key_ids || []) || []),
                  };
                }
                else {
                  return null;
                }
              }).filter(tx => tx?.sender);
              if (txs.length > 0) {
                for (let i = 0; i < txs.length; i++) {
                  crud({ index: 'heartbeats', method: 'set', id: `${txs[i].sender}_${txs[i].height_group}`, ...txs[i] });
                }
              }

              // Link
              txs = res.data.tx_responses.filter(tx => !tx?.code && tx?.tx?.body?.messages?.findIndex(m => m?.['@type']?.includes('LinkRequest')) > -1).map(tx => {
                const event = _.head(tx.logs?.flatMap(l => l?.events?.filter(e => e?.type === 'link')));
                const sender_chain = event?.attributes?.find(a => a?.key === 'sourceChain' && a.value)?.value;
                const deposit_address = event?.attributes?.find(a => a?.key === 'depositAddress' && a.value)?.value;
                const _tx = {
                  ...tx.tx.body.messages[0],
                  txhash: tx.txhash,
                  height: Number(tx.height),
                  sender_chain,
                  deposit_address,
                };
                _tx.type = _tx['@type']?.split('.')[0]?.replace('/', '');
                delete _tx['@type'];
                _tx.sender_address = _tx.sender?.toLowerCase();
                delete _tx.sender;
                _tx.sender_chain = normalize_chain(cosmos_chains.find(c => _tx.sender_address?.startsWith(c?.prefix_address))?.id || _tx.sender_chain || _tx.chain || 'axelarnet');
                delete _tx.chain;
                _tx.recipient_address = _tx.recipient_addr?.toLowerCase();
                delete _tx.recipient_addr;
                _tx.recipient_chain = normalize_chain(_tx.recipient_chain);
                return _tx;
              }).filter(tx => tx);
              if (txs.length > 0) {
                for (let i = 0; i < txs.length; i++) {
                  crud({ index: 'linked_addresses', method: 'set', id: txs[i]?.deposit_address?.toLowerCase() || txs[i]?.txhash, ...txs[i] });
                }
              }

              // MsgSend
              txs = res.data.tx_responses.filter(_tx => _tx && _tx.tx?.body?.messages?.findIndex(m => _.last(m?.['@type']?.split('.')) === 'MsgSend') > -1).map(_tx => {
                const type = 'axelarnet_transfer';
                const height = Number(_tx.height);
                const created_at = moment(_tx.timestamp).utc();
                const sender_address = _tx.tx.body.messages.find(m => m?.from_address)?.from_address?.toLowerCase();
                const recipient_address = _tx.tx.body.messages.find(m => m?.to_address)?.to_address?.toLowerCase();
                const amount_denom = _tx.tx.body.messages.find(m => m?.amount)?.amount?.[0];
                const amount = Number(amount_denom?.amount);
                const denom = amount_denom?.denom;
                const tx = {
                  id: _tx.txhash?.toLowerCase(),
                  type,
                  status_code: _tx.code,
                  status: _tx.code ? 'failed' : 'success',
                  height,
                  created_at: get_granularity(created_at),
                  sender_address,
                  recipient_address,
                  amount,
                  denom,
                };
                return tx;
              }).filter(tx => !tx.status_code && tx.recipient_address?.length >= 65 && tx.id && tx.amount > 0);
              if (txs.length > 0) {
                const query = {
                  bool: {
                    should: txs.map(tx => {
                      return {
                        match: {
                          deposit_address: tx.recipient_address,
                        },
                      };
                    }),
                  },
                };
                const response_linked = await crud({ index: 'linked_addresses', method: 'search', query, size: txs.length });
                const linked_list = response_linked?.data?.filter(l => l);
                for (let i = 0; i < txs.length; i++) {
                  const linked = linked_list?.find(l => l?.deposit_address?.toLowerCase() === txs[i]?.recipient_address?.toLowerCase());
                  if (linked) {
                    txs[i].sender_chain = linked.sender_chain;
                    txs[i].recipient_chain = linked.recipient_chain;
                    txs[i].denom = txs[i].denom || linked.asset;
                  }
                  crud({ index: 'crosschain_txs', method: 'set', path: `/crosschain_txs/_update/${txs[i].id}`, id: txs[i].id, send: txs[i] });
                }
              }

              // MsgRecvPacket -> MsgTransfer
              txs = res.data.tx_responses.filter(_tx => _tx && _tx.tx?.body?.messages?.findIndex(m => _.last(m?.['@type']?.split('.')) === 'MsgRecvPacket') > -1).map(async _tx => {
                const event_recv_packets = _tx.logs.map(l => {
                  return {
                    ...l?.events?.find(e => e?.type === 'recv_packet'),
                    height: Number(_tx.tx.body.messages.find(m => _.last(m?.['@type']?.split('.')) === 'MsgRecvPacket')?.proof_height?.revision_height || '0') - 1,
                  };
                });
                const _txs = [];
                for (let i = 0; i < event_recv_packets.length; i++) {
                  const event_recv_packet = event_recv_packets[i];
                  const packet_data = to_json(event_recv_packet?.attributes?.find(a => a?.key === 'packet_data' && a.value)?.value);
                  const packet_data_hex = event_recv_packet?.attributes?.find(a => a?.key === 'packet_data_hex' && a.value)?.value;
                  const packet_sequence = event_recv_packet?.attributes?.find(a => a?.key === 'packet_sequence' && a.value)?.value;
                  const _height = event_recv_packet?.height;
                  if (_height && packet_data_hex && packet_data && typeof packet_data === 'object') {
                    for (let j = 0; j < cosmos_chains.length; j++) {
                      const chain = cosmos_chains[j];
                      if (chain?.endpoints?.lcd && packet_data.sender?.startsWith(chain.prefix_address)) {
                        // initial lcd
                        const lcd = axios.create({ baseURL: chain.endpoints.lcd });
                        // request lcd
                        const response_txs = await lcd.get(`/cosmos/tx/v1beta1/txs?limit=5&events=${encodeURIComponent(`send_packet.packet_data_hex='${packet_data_hex}'`)}&events=tx.height=${_height}`)
                          .catch(error => { return { data: { error } }; });
                        const transactionIndex = response_txs?.data?.tx_responses?.findIndex(t => {
                          const event_send_packet = _.head(t?.logs.flatMap(l => l?.events?.filter(e => e?.type === 'send_packet')));
                          const _packet_sequence = event_send_packet?.attributes?.find(a => a?.key === 'packet_sequence' && a.value)?.value;
                          return packet_sequence === _packet_sequence;
                        });
                        if (transactionIndex > -1) {
                          const tx = {
                            ...response_txs.data.tx_responses[transactionIndex],
                            tx: {
                              ...response_txs.data.txs?.[transactionIndex],
                            },
                          };
                          if (tx.tx.body?.messages) {
                            const type = 'ibc_transfer';
                            const height = Number(tx.height);
                            const created_at = moment(tx.timestamp).utc();
                            const sender_address = tx.tx.body.messages.find(m => m?.sender)?.sender?.toLowerCase();
                            const recipient_address = tx.tx.body.messages.find(m => m?.receiver)?.receiver?.toLowerCase();
                            const amount_denom = tx.tx.body.messages.find(m => m?.token)?.token;
                            const amount = Number(amount_denom?.amount);
                            const denom = amount_denom?.denom;
                            const tx_send = {
                              id: tx.txhash?.toLowerCase(),
                              type,
                              status_code: tx.code,
                              status: tx.code ? 'failed' : 'success',
                              height,
                              created_at: get_granularity(created_at),
                              sender_chain: chain.id,
                              sender_address,
                              recipient_address,
                              amount,
                              denom,
                            };
                            _txs.push(tx_send);
                            break;
                          }
                        }
                      }
                    }
                  }
                }
                return _txs;
              }).flatMap(_txs => _txs).filter(tx => !tx.status_code && tx?.recipient_address?.length >= 65 && tx.id && tx.amount > 0);
              if (txs.length > 0) {
                const query = {
                  bool: {
                    should: txs.map(tx => {
                      return {
                        match: {
                          deposit_address: tx.recipient_address,
                        },
                      };
                    }),
                  },
                };
                const response_linked = await crud({ index: 'linked_addresses', method: 'search', query, size: txs.length });
                const linked_list = response_linked?.data?.filter(l => l);
                for (let i = 0; i < txs.length; i++) {
                  const linked = linked_list?.find(l => l?.deposit_address?.toLowerCase() === txs[i]?.recipient_address?.toLowerCase());
                  if (linked) {
                    txs[i].recipient_chain = linked.recipient_chain;
                    txs[i].denom = txs[i].denom || linked.asset;
                  }
                  crud({ index: 'crosschain_txs', method: 'set', path: `/crosschain_txs/_update/${txs[i].id}`, id: txs[i].id, send: txs[i] });
                }
              }

              // ConfirmDeposit / ConfirmERC20Deposit
              txs = res.data.tx_responses.filter(_tx => _tx && _tx.tx?.body?.messages?.findIndex(m => transfer_actions?.includes(_.last(m?.['@type']?.split('.'))?.replace('Request', ''))) > -1).map(_tx => {
                const event_message = _.head(_tx.logs.flatMap(l => l?.events?.filter(e => e?.type === 'message')));
                const type = event_message?.attributes?.find(a => a?.key === 'action' && transfer_actions?.includes(a.value))?.value || _.last(_tx.tx.body.messages.find(m => transfer_actions?.includes(_.last(m?.['@type']?.split('.'))?.replace('Request', '')))?.['@type']?.split('.'))?.replace('Request', '');
                const height = Number(_tx.height);
                const created_at = moment(_tx.timestamp).utc();
                const user = _tx.tx.body.messages.find(m => m?.sender)?.sender?.toLowerCase();
                const event = _.head(_tx.logs.flatMap(l => l?.events?.filter(e => e?.type === 'depositConfirmation')));
                const __module = event?.attributes?.find(a => a?.key === 'module' && a.value)?.value || (type === 'ConfirmDeposit' ? 'axelarnet' : 'evm');
                const sender_chain = _tx.tx.body.messages.find(m => m?.chain)?.chain?.split('-').filter(s => isNaN(s)).join('').toLowerCase() || event?.attributes?.find(a => ['sourceChain', 'chain'].includes(a?.key) && a.value)?.value?.split('-').filter(s => isNaN(s)).join('').toLowerCase() || __module;
                const recipient_chain = event?.attributes?.find(a => ['destinationChain'].includes(a?.key) && a.value)?.value?.split('-').filter(s => isNaN(s)).join('').toLowerCase();
                const amount_denom = event?.attributes?.find(a => a?.key === 'amount' && a.value)?.value;
                const amount = Number(_tx.tx.body.messages.find(m => m?.amount)?.amount || amount_denom?.substring(0, amount_denom?.split('').findIndex(c => isNaN(c)) > -1 ? amount_denom.split('').findIndex(c => isNaN(c)) : undefined));
                const denom = _tx.tx.body.messages.find(m => m?.denom)?.denom || (amount_denom?.split('').findIndex(c => isNaN(c)) > -1 ? amount_denom.substring(amount_denom.split('').findIndex(c => isNaN(c))) : undefined);
                const token_address = event?.attributes?.find(a => a?.key === 'tokenAddress' && a.value)?.value?.toLowerCase();
                const deposit_address = _tx.tx.body.messages.find(m => m?.deposit_address)?.deposit_address?.toLowerCase() || event?.attributes?.find(a => a?.key === 'depositAddress' && a.value)?.value?.toLowerCase();
                const transfer_id = Number(event?.attributes?.find(a => a?.key === 'transferID' && a.value)?.value);
                const poll_id = convertToJson(event?.attributes?.find(a => a?.key === 'poll' && a.value)?.value)?.id?.toLowerCase();
                const transaction_id = event?.attributes?.find(a => a?.key === 'txID' && a.value)?.value?.toLowerCase() || poll_id?.split('_')[0];
                const tx = {
                  id: _tx.txhash?.toLowerCase(),
                  type,
                  status_code: _tx.code,
                  status: _tx.code ? 'failed' : 'success',
                  height,
                  created_at: {
                    ms: moment(created_at).valueOf(),
                    hour: moment(created_at).startOf('hour').valueOf(),
                    day: moment(created_at).startOf('day').valueOf(),
                    week: moment(created_at).startOf('week').valueOf(),
                    month: moment(created_at).startOf('month').valueOf(),
                    quarter: moment(created_at).startOf('quarter').valueOf(),
                    year: moment(created_at).startOf('year').valueOf(),
                  },
                  user,
                  module: __module,
                  sender_chain,
                  recipient_chain,
                  amount,
                  denom,
                  token_address,
                  deposit_address,
                  transfer_id,
                  poll_id,
                  transaction_id,
                };
                return tx;
              }).filter(tx => !tx.status_code && (tx.transfer_id || tx.poll_id) && tx.id/* && tx.amount > 0*/);
              if (txs.length > 0) {
                const query = {
                  bool: {
                    should: txs.map(tx => {
                      return {
                        match: {
                          deposit_address: tx.recipient_address,
                        },
                      };
                    }),
                  },
                };
                const response_linked = await crud({ index: 'linked_addresses', method: 'search', query, size: txs.length });
                const linked_list = response_linked?.data?.filter(l => l);
                for (let i = 0; i < txs.length; i++) {
                  if (txs[i].type === 'ConfirmDeposit') {
                    let signed, send_gateway;
                    const linked = linked_list?.find(l => l?.deposit_address?.toLowerCase() === txs[i]?.deposit_address?.toLowerCase());
                    if (linked?.recipient_chain) {
                      const recipient_chain = linked.recipient_chain || txs[i].recipient_chain;
                      const command_id = txs[i].transfer_id.toString(16).padStart(64, '0');
                      const query = {
                        bool: {
                          must: [
                            { match: { chain: recipient_chain } },
                            { match: { status: 'BATCHED_COMMANDS_STATUS_SIGNED' } },
                            { match: { command_ids: command_id } },
                          ],
                        },
                      };
                      const response_batch = await crud({ index: 'batches', method: 'search', query, size: 1 });
                      const batch = response_batch?.data?.[0];
                      if (batch) {
                        signed = {
                          chain: recipient_chain,
                          batch_id: batch.batch_id,
                          command_id,
                          transfer_id: txs[i].transfer_id,
                        };
                        const provider = new JsonRpcProvider(chains_rpc[recipient_chain]);
                        const gateway_address = evm_chains?.find(c => c?.id === recipient_chain)?.gateway_address;
                        const gateway = gateway_address && new Contract(gateway_address, IAxelarGateway.abi, provider);
                        if (gateway) {
                          try {
                            const executed = await gateway.isCommandExecuted(`0x${command_id}`);
                            if (executed) {
                              send_gateway = signed;
                            }
                          } catch (error) {}
                        }
                      }
                    }

                    let query = {
                      bool: {
                        must: [
                          { match: { 'send.status_code': 0 } },
                          { match: { 'send.recipient_address': txs[i].deposit_address } },
                          { range: { 'send.created_at.ms': { lte: txs[i].created_at.ms } } },
                        ],
                        should: [
                          { range: { 'confirm_deposit.created_at.ms': { gt: txs[i].created_at.ms } } },
                          { bool: {
                            must_not: [
                              { exists: { field: 'confirm_deposit' } },
                            ],
                          } },
                        ],
                      },
                    };
                    let response_txs = await crud({ index: 'crosschain_txs', method: 'search', query, size: 100 });
                    if (response_txs?.data?.length > 0) {
                      const _txs = response_txs.data.filter(tx => tx?.send?.id);
                      const ids = _txs.map(tx => tx.send.id);
                      for (let j = 0; j < ids.length; j++) {
                        const id = ids[j];
                        const _tx = _txs[j];
                        const tx_send = _tx.send;
                        const params = { index: 'crosschain_txs', method: 'update', path: `/crosschain_txs/_update/${id}`, id, ...tx, confirm_deposit: txs[i] };
                        if (signed) {
                          params.signed = signed;
                        }
                        if (send_gateway) {
                          params.send_gateway = send_gateway;
                        }
                        if (tx_send) {
                          tx_send.sender_chain = cosmos_chains.find(c => tx_send.sender_address?.startsWith(c?.prefix_address))?.id || txs[i].sender_chain;
                          tx_send.recipient_chain = tx_send.recipient_chain || txs[i].recipient_chain;
                          params.send = tx_send;
                        }
                        crud(params);
                      }
                    }
                    else if (signed) {
                      query = {
                        bool: {
                          must: [
                            { match: { 'send.recipient_address': txs[i].deposit_address } },
                            { match: { 'confirm_deposit.transfer_id': txs[i].transfer_id } },
                          ],
                        },
                      };
                      response_txs = await crud({ index: 'crosschain_txs', method: 'search', query, size: 100 });
                      if (response_txs?.data?.length > 0) {
                        const _txs = response_txs.data.filter(tx => tx?.send?.id);
                        const ids = _txs.map(tx => tx.send.id);
                        for (let i = 0; i < ids.length; i++) {
                          const id = ids[i];
                          const tx = _txs[i];
                          const tx_send = tx.send;
                          const params = { index: 'crosschain_txs', method: 'update', path: `/crosschain_txs/_update/${id}`, id, ...tx, signed };
                          if (send_gateway) {
                            params.send_gateway = send_gateway;
                          }
                          if (tx_send) {
                            tx_send.sender_chain = cosmos_chains.find(c => tx_send.sender_address?.startsWith(c?.prefix_address))?.id || txs[i].sender_chain;
                            tx_send.recipient_chain = tx_send.recipient_chain || txs[i].recipient_chain;
                            params.send = tx_send;
                          }
                          crud(params);
                        }
                      }
                    }
                  }
                  else if (txs[i].type === 'ConfirmERC20Deposit') {
                    try {
                      const provider = new JsonRpcProvider(chains_rpc[txs[i].sender_chain]);
                      const transaction_id = txs[i].transaction_id?.toLowerCase();
                      if (transaction_id) {
                        const transaction = await provider.getTransaction(transaction_id);
                        const height = transaction?.blockNumber;
                        if (height) {
                          txs[i].amount = BigNumber.from(`0x${transaction.data?.substring(10 + 64) || transaction.input?.substring(10 + 64) || '0'}`).toNumber() || txs[i].amount;
                          if (transaction.to?.toLowerCase() === txs[i].token_address?.toLowerCase() || _assets?.findIndex(a => a?.contracts?.findIndex(c => c?.contract_address?.toLowerCase() === transaction.to?.toLowerCase()) > -1) > -1) {
                            txs[i].denom = _assets?.find(a => a?.contracts?.findIndex(c => c?.contract_address?.toLowerCase() === transaction.to.toLowerCase()) > -1)?.id || txs[i].denom;
                            const tx_send = {
                              id: transaction_id,
                              type: 'evm_transfer',
                              status_code: 0,
                              status: 'success',
                              height,
                              created_at: get_granularity(txs[i].created_at),
                              sender_address: transaction.from?.toLowerCase(),
                              recipient_address: txs[i].deposit_address,
                              sender_chain: txs[i].sender_chain,
                              recipient_chain: txs[i].recipient_chain,
                              amount: txs[i].amount,
                              denom: txs[i].denom,
                            };
                            const query = {
                              match: {
                                deposit_address: tx.deposit_address,
                              },
                            };
                            const linked = linked_list?.find(l => l?.deposit_address?.toLowerCase() === txs[i]?.deposit_address?.toLowerCase());
                            if (linked) {
                              tx_send.sender_chain = linked.sender_chain || tx_send.sender_chain;
                              tx_send.recipient_chain = linked.recipient_chain || tx_send.recipient_chain;
                              tx_send.denom = tx_send.denom || linked.asset;
                            }
                            crud({ index: 'crosschain_txs', method: 'set', path: `/crosschain_txs/_update/${transaction_id}`, id: transaction_id, send: tx_send, confirm_deposit: txs[i] });
                          }
                        }
                      }     
                    } catch (error) {}
                  }
                }
              }

              // VoteConfirmDeposit
              txs = res.data.tx_responses.filter(_tx => _tx && _tx.tx?.body?.messages?.findIndex(m => _.last(m?.inner_message?.['@type']?.split('.'))?.replace('Request', '') === 'VoteConfirmDeposit') > -1).map(_tx => {
                const _txs = [];
                const messages = _tx.tx.body.messages;
                for (let i = 0; i < messages.length; i++) {
                  const message = messages[i];
                  const type = _.last(message?.inner_message?.['@type']?.split('.'))?.replace('Request', '');
                  if (type === 'VoteConfirmDeposit') {
                    const height = Number(_tx.height);
                    const created_at = moment(_tx.timestamp).utc();
                    const event = _tx.logs?.[i]?.events?.find(e => e?.type === 'depositConfirmation');
                    const __module = event?.attributes?.find(a => a?.key === 'module' && a.value)?.value || (type === 'ConfirmDeposit' ? 'axelarnet' : 'evm');
                    const sender_chain = normalize_chain(message?.inner_message?.chain || event?.attributes?.find(a => ['sourceChain', 'chain'].includes(a?.key) && a.value)?.value || __module);
                    const recipient_chain = normalize_chain(event?.attributes?.find(a => ['destinationChain'].includes(a?.key) && a.value)?.value);
                    const transfer_id = Number(event?.attributes?.find(a => a?.key === 'transferID' && a.value)?.value);
                    const poll_id = to_json(message?.inner_message?.poll_key || event?.attributes?.find(a => a?.key === 'poll' && a.value)?.value)?.id?.toLowerCase();
                    const transaction_id = event?.attributes?.find(a => a?.key === 'txID' && a.value)?.value?.toLowerCase() || poll_id?.split('_')[0];
                    const deposit_address = event?.attributes?.find(a => a?.key === 'depositAddress' && a.value)?.value?.toLowerCase() || poll_id?.split('_')[1];
                    const confirmed = message?.inner_message?.confirmed || false;
                    const vote_confirmed = _tx.logs?.findIndex(l => l?.events?.findIndex(e => e?.type === 'depositConfirmation' && e.attributes?.findIndex(a => a?.key === 'action' && a.value === 'confirm') > -1) > -1) > -1;
                    const poll_initial = _tx.logs?.findIndex(l => l?.log?.startsWith('not enough votes')) > -1;
                    const tx = {
                      id: _tx.txhash?.toLowerCase(),
                      type,
                      status_code: _tx.code,
                      status: _tx.code ? 'failed' : 'success',
                      height,
                      created_at: get_granularity(created_at),
                      module: __module,
                      sender_chain,
                      recipient_chain,
                      deposit_address,
                      transfer_id,
                      poll_id,
                      transaction_id,
                      confirmed,
                      voter: message?.inner_message?.sender,
                      vote_confirmed,
                      poll_initial,
                    };
                    _txs.push(tx);
                  }
                }
                return _txs;
              }).flatMap(tx => tx).filter(tx => !tx.status_code && tx.poll_id && tx.id);
              if (txs.length > 0) {
                await sleep(1 * 1000);
                for (let i = 0; i < txs.length; i++) {
                  try {
                    if (txs[i].confirmed && txs[i].vote_confirmed) {
                      const provider = new JsonRpcProvider(chains_rpc[txs[i].sender_chain]);
                      const transaction_id = txs[i].transaction_id?.toLowerCase();
                      if (transaction_id) {
                        const transaction = await provider.getTransaction(transaction_id);
                        const height = transaction?.blockNumber;
                        if (height) {
                          txs[i].amount = BigNumber.from(`0x${transaction.data?.substring(10 + 64) || transaction.input?.substring(10 + 64) || '0'}`).toNumber() || Number(_.last(txs[i].poll_id?.split('_')));
                          if (transaction.to?.toLowerCase() === txs[i].token_address?.toLowerCase() || _assets?.findIndex(a => a?.contracts?.findIndex(c => c?.contract_address?.toLowerCase() === transaction.to?.toLowerCase()) > -1) > -1) {
                            txs[i].denom = _assets?.find(a => a?.contracts?.findIndex(c => c?.contract_address?.toLowerCase() === transaction.to.toLowerCase()) > -1)?.id || txs[i].denom;
                            const tx_send = {
                              id: transaction_id,
                              type: 'evm_transfer',
                              status_code: 0,
                              status: 'success',
                              height,
                              created_at: txs[i].created_at,
                              sender_address: transaction.from?.toLowerCase(),
                              recipient_address: txs[i].deposit_address,
                              sender_chain: txs[i].sender_chain,
                              recipient_chain: txs[i].recipient_chain,
                              amount: txs[i].amount,
                              denom: txs[i].denom,
                            };
                            const query = {
                              match: {
                                deposit_address: txs[i].deposit_address,
                              },
                            };
                            const response_linked = await crud({ index: 'linked_addresses', method: 'search', query, size: 1 });
                            const linked = response_linked?.data?.[0];
                            if (linked) {
                              tx_send.sender_chain = linked.sender_chain || tx_send.sender_chain;
                              tx_send.recipient_chain = linked.recipient_chain || tx_send.recipient_chain;
                              tx_send.denom = tx_send.denom || linked.asset;
                            }
                            crud({ index: 'crosschain_txs', method: 'set', path: `/crosschain_txs/_update/${transaction_id}`, id: transaction_id, send: tx_send, vote_confirm_deposit: txs[i] });
                          }
                        }
                      }
                    }
                  } catch (error) {}
                }
                for (let i = 0; i < txs.length; i++) {
                  const tx = txs[i];
                  if (tx.voter) {
                    const vote = {
                      id: `${tx.poll_id}_${tx.voter}`,
                      txhash: tx.id,
                      height: tx.height,
                      created_at: tx.created_at,
                      sender: tx.voter,
                      sender_chain: tx.sender_chain,
                      module: tx.module,
                      poll_id: tx.poll_id,
                      transaction_id: tx.transaction_id,
                      confirmed: tx.confirmed,
                      vote_confirmed: tx.vote_confirmed,
                      poll_initial: tx.poll_initial,
                    };
                    if (vote.poll_initial) {
                      vote.poll_start_height = vote.height;
                    }
                    await crud({ index: 'evm_votes', method: 'set', path: `/evm_votes/_update/${vote.id}`, ...vote });
                  }
                }
              }

              // Vote
              txs = res.data.tx_responses.filter(_tx => _tx && _tx.tx?.body?.messages?.findIndex(m => _.last(m?.inner_message?.['@type']?.split('.'))?.replace('Request', '') === 'Vote') > -1).map(async _tx => {
                const _txs = [];
                const messages = _tx.tx.body.messages;
                for (let i = 0; i < messages.length; i++) {
                  const message = messages[i];
                  const type = _.last(message?.inner_message?.['@type']?.split('.'))?.replace('Request', '');
                  if (type === 'Vote') {
                    const height = Number(_tx.height);
                    const created_at = moment(_tx.timestamp).utc();
                    const event = _tx.logs?.[i]?.events?.find(e => e?.type === 'vote');
                    const confirmed_event = _tx.logs?.[i]?.events?.find(e => e?.type === 'depositConfirmation');
                    const __module = 'evm';
                    const sender_chain = normalize_chain(message?.inner_message?.vote?.results?.[0]?.chain);
                    const recipient_chain = normalize_chain(confirmed_event?.attributes?.find(a => a?.key === 'destinationChain' && a.value)?.value);
                    const transfer_id = confirmed_event?.attributes?.find(a => a?.key === 'transferID' && a.value)?.value;
                    const poll_id = to_json(message?.inner_message?.poll_key || event?.attributes?.find(a => a?.key === 'poll' && a.value)?.value)?.id?.toLowerCase();
                    const transaction_id = confirmed_event?.attributes?.find(a => a?.key === 'txID' && a.value)?.value || poll_id?.split('_')[0];
                    const deposit_address = confirmed_event?.attributes?.find(a => a?.key === 'depositAddress' && a.value)?.value || poll_id?.split('_')[1];
                    const confirmed = message?.inner_message?.vote?.results?.length > 0;
                    const vote_confirmed = !!confirmed_event;
                    const poll_initial = _tx.logs?.findIndex(l => l?.log?.startsWith('not enough votes')) > -1;
                    const tx = {
                      id: _tx.txhash?.toLowerCase(),
                      type,
                      status_code: _tx.code,
                      status: _tx.code ? 'failed' : 'success',
                      height,
                      created_at: get_granularity(created_at),
                      module: __module,
                      sender_chain,
                      recipient_chain,
                      deposit_address,
                      transfer_id,
                      poll_id,
                      transaction_id,
                      confirmed,
                      voter: message?.inner_message?.sender,
                      vote_confirmed,
                      poll_initial,
                    };
                    if (!tx.status_code && tx.deposit_address && !tx.sender_chain) {
                      const query = {
                        bool: {
                          must: [
                            { match: { deposit_address: tx.deposit_address } },
                          ],
                        },
                      };
                      const response_linked = await crud({ index: 'linked_addresses', method: 'search', query, size: 1 });
                      const linked = response_linked?.data?.[0];
                      if (linked?.sender_chain) {
                        tx.sender_chain = linked.sender_chain;
                      }
                    }
                    _txs.push(tx);
                  }
                }
                return _txs;
              }).flatMap(tx => tx).filter(tx => !tx.status_code && tx.poll_id && tx.id);
              if (txs.length > 0) {
                await sleep(1 * 1000);
                for (let i = 0; i < txs.length; i++) {
                  try {
                    if (txs[i].confirmed && txs[i].vote_confirmed) {
                      const provider = new JsonRpcProvider(chains_rpc[txs[i].sender_chain]);
                      const transaction_id = txs[i].transaction_id?.toLowerCase();
                      if (transaction_id) {
                        const transaction = await provider.getTransaction(transaction_id);
                        const height = transaction?.blockNumber;
                        if (height) {
                          txs[i].amount = BigNumber.from(`0x${transaction.data?.substring(10 + 64) || transaction.input?.substring(10 + 64) || '0'}`).toNumber() || Number(_.last(txs[i].poll_id?.split('_')));
                          if (transaction.to?.toLowerCase() === txs[i].token_address?.toLowerCase() || _assets?.findIndex(a => a?.contracts?.findIndex(c => c?.contract_address?.toLowerCase() === transaction.to?.toLowerCase()) > -1) > -1) {
                            txs[i].denom = _assets?.find(a => a?.contracts?.findIndex(c => c?.contract_address?.toLowerCase() === transaction.to.toLowerCase()) > -1)?.id || txs[i].denom;
                            const tx_send = {
                              id: transaction_id,
                              type: 'evm_transfer',
                              status_code: 0,
                              status: 'success',
                              height,
                              created_at: txs[i].created_at,
                              sender_address: transaction.from?.toLowerCase(),
                              recipient_address: txs[i].deposit_address,
                              sender_chain: txs[i].sender_chain,
                              recipient_chain: txs[i].recipient_chain,
                              amount: txs[i].amount,
                              denom: txs[i].denom,
                            };
                            const query = {
                              match: {
                                deposit_address: txs[i].deposit_address,
                              },
                            };
                            const response_linked = await crud({ index: 'linked_addresses', method: 'search', query, size: 1 });
                            const linked = response_linked?.data?.[0];
                            if (linked) {
                              tx_send.sender_chain = linked.sender_chain || tx_send.sender_chain;
                              tx_send.recipient_chain = linked.recipient_chain || tx_send.recipient_chain;
                              tx_send.denom = tx_send.denom || linked.asset;
                            }
                            crud({ index: 'crosschain_txs', method: 'set', path: `/crosschain_txs/_update/${transaction_id}`, id: transaction_id, send: tx_send, vote_confirm_deposit: txs[i] });
                          }
                        }
                      }
                    }
                  } catch (error) {}
                }
                for (let i = 0; i < txs.length; i++) {
                  const tx = txs[i];
                  if (tx.voter) {
                    const vote = {
                      id: `${tx.poll_id}_${tx.voter}`,
                      txhash: tx.id,
                      height: tx.height,
                      created_at: tx.created_at,
                      sender: tx.voter,
                      sender_chain: tx.sender_chain,
                      module: tx.module,
                      poll_id: tx.poll_id,
                      transaction_id: tx.transaction_id,
                      confirmed: tx.confirmed,
                      vote_confirmed: tx.vote_confirmed,
                      poll_initial: tx.poll_initial,
                    };
                    if (vote.poll_initial) {
                      vote.poll_start_height = vote.height;
                    }
                    await crud({ index: 'evm_votes', method: 'set', path: `/evm_votes/_update/${vote.id}`, ...vote });
                  }
                }
              }
            }
          }
          else if (path.startsWith('/cosmos/base/tendermint/v1beta1/blocks/') && !path.endsWith('/') && res?.data?.block?.header?.height) {
            await crud({ index: 'blocks', method: 'set', id: res.data.block.header.height, ...res.data.block.header, hash: res.data.block_id?.hash, txs: res.data.block.data?.txs?.length });
            if (res.data.block.last_commit?.height && res.data.block.last_commit.signatures) {
              await crud({ index: 'uptimes', method: 'set', id: res.data.block.last_commit.height, height: Number(res.data.block.last_commit.height), timestamp: moment(_.head(res.data.block.last_commit.signatures)?.timestamp).valueOf(), validators: res.data.block.last_commit.signatures.map(s => s?.validator_address) });
            }
          }
          res.data.cache_hit = cache_hit;
          break;
        case 'cli':
          if (config?.[environment]?.endpoints?.cli) {
            const cli = axios.create({ baseURL: config[environment].endpoints.cli });
            // set id
            cache_id = params.cmd;
            // get from cache
            if (cache && cache_id?.startsWith('axelard')) {
              response_cache = await crud({ index: 'axelard', method: 'get', id: cache_id });
              if (response_cache && moment().diff(moment(response_cache.updated_at * 1000), 'minutes', true) <= (cache_timeout || 15)) {
                res = { data: response_cache };
                cache_hit = true;
              }
            }
            // cache miss
            if (!res) {
              // request cli
              res = await cli.get(path, { params })
                .catch(error => { return { data: { error } }; });
            }
            // check cache
            if (res?.data?.stdout) {
              // process
              if (params.cmd?.startsWith('axelard q snapshot proxy ')) {
                res.data.type = 'proxy';
              }
              else if ((params.cmd?.startsWith('axelard q evm batched-commands ') || params.cmd?.startsWith('axelard q evm latest-batched-commands ')) && params.cmd?.endsWith(' -oj')) {
                const chain = params.cmd.split(' ')[4]?.toLowerCase();
                const output = to_json(res.data.stdout);
                if (output) {
                  const commands = [];
                  if (output.command_ids) {
                    for (let i = 0; i < output.command_ids.length; i++) {
                      const command_id = output.command_ids[i];
                      if (command_id) {
                        const cmd = `axelard q evm command ${chain} ${command_id} -oj`;
                        // request cli
                        const response_cmd = await cli.get(path, { params: { cmd, cache: true, cache_timeout: 1 } })
                          .catch(error => { return { data: { error } }; });
                        commands.push(to_json(response_cmd?.data?.stdout));
                        // sleep before next cmd
                        await sleep(0.5 * 1000);
                      }
                    }
                  }
                  output.batch_id = output.id;
                  output.chain = chain;
                  output.commands = commands.filter(c => c);
                  let created_at;
                  if (params.created_at) {
                    created_at = moment(Number(params.created_at) * 1000).utc();
                  }
                  else {
                    const response_batch = await crud({ index: 'batches', method: 'search', query: { match_phrase: { 'batch_id': output.batch_id } }, size: 1 });
                    if (!response_batch?.data?.[0]?.created_at?.ms) {
                      created_at = moment().utc();
                    }
                    else {
                      created_at = moment(response_batch.data[0].created_at.ms).utc();
                    }
                  }
                  if (created_at) {
                    output.created_at = get_granularity(created_at);
                  }

                  if (['BATCHED_COMMANDS_STATUS_SIGNED'].includes(output.status) && output.command_ids) {
                    const evm_chains = chains?.[environment]?.evm || [];
                    const chains_rpc = Object.fromEntries(evm_chains.map(c => [c?.id, _.head(c?.provider_params?.[0]?.rpcUrls)]) || []);
                    const provider = new JsonRpcProvider(chains_rpc[chain]);
                    const gateway_address = evm_chains?.find(c => c?.id === chain)?.gateway_address;
                    const gateway = gateway_address && new Contract(gateway_address, IAxelarGateway.abi, provider);
                    if (gateway) {
                      const cosmos_chains = chains?.[environment]?.cosmos?.filter(c => c?.id !== 'axelarnet') || [];
                      const command_ids = output.command_ids.filter(c => parseInt(c, 16) >= 1);
                      let send_gateway;
                      for (let i = 0; i < command_ids.length; i++) {
                        const command_id = command_ids[i];
                        const transfer_id = parseInt(command_id, 16);
                        const query = {
                          bool: {
                            should: [
                              { match: { 'confirm_deposit.transfer_id': transfer_id } },
                              { match: { 'vote_confirm_deposit.transfer_id': transfer_id } },
                            ],
                            minimum_should_match: '50%',
                          },
                        };
                        const response_txs = await crud({ index: 'crosschain_txs', method: 'search', query, size: 100 });
                        if (response_txs?.data?.length > 0) {
                          const signed = {
                            chain,
                            batch_id: output.batch_id,
                            command_id,
                            transfer_id,
                          };
                          if (!send_gateway) {
                            try {
                              const executed = await gateway.isCommandExecuted(`0x${command_id}`);
                              if (executed) {
                                send_gateway = signed;
                              }
                            } catch (error) {}
                          }
                          const txs = response_txs.data.filter(tx => tx?.send?.id);
                          const ids = txs.map(tx => tx.send.id);
                          for (let j = 0; j < ids.length; j++) {
                            const id = ids[j];
                            const tx = txs[j];
                            const tx_send = tx?.send;
                            const params = { index: 'crosschain_txs', method: 'set', path: `/crosschain_txs/_update/${id}`, id, ...tx, signed, send_gateway };
                            if (tx_send) {
                              tx_send.sender_chain = normalize_chain(cosmos_chains.find(c => tx_send.sender_address?.startsWith(c?.prefix_address))?.id || tx_send.sender_chain);
                              params.send = tx_send;
                            }
                            await crud(params);
                          }
                        }
                      }
                    }
                  }

                  await crud({ index: 'batches', method: 'set', path: `/batches/_update/${output.id}`, ...output });
                  res.data.stdout = JSON.stringify(output);
                }
              }
              // save
              if (cache && !cache_hit && cache_id?.startsWith('axelard')) {
                await crud({ index: 'axelard', method: 'set', id: cache_id, ...res.data, updated_at: moment().unix() });
              }
            }
            else if (response_cache) {
              res = { data: response_cache };
            }
            res.data.cache_hit = cache_hit;
          }
          break;
        case 'index':
          res = { data: await crud(params) };
          break;
        case 'prometheus':
          if (config?.[environment]?.endpoints?.prometheus) {
            path = path || '/api/v1/query';
            const prometheus = axios.create({ baseURL: config[environment].endpoints.prometheus });
            // request prometheus
            res = await prometheus.get(path, { params })
              .catch(error => { return { data: { status: 'error', error } }; });
          }
          break;
        case 'coingecko':
          if (config?.external_api?.endpoints?.coingecko) {
            const coingecko = axios.create({ baseURL: config.external_api.endpoints.coingecko });
            // request coingecko
            res = await coingecko.get(path, { params })
              .catch(error => { return { data: { error } }; });
          }
          break;
        case 'ens':
          if (config?.external_api?.endpoints?.ens) {
            const ens = axios.create({ baseURL: config.external_api.endpoints.ens });
            // request ens
            res = await ens.get(path, { params })
              .catch(error => { return { data: { error } }; });
          }
          break;
        case 'data':
          let data = { chains: chains?.[environment], assets: assets?.[environment] };
          if (data[params.collection]) {
            data = data[params.collection];
          }
          res = { data };
          break;
        default:
          break;
      };

      // set response
      if (res?.data) {
        response = res.data;
        // remove error config
        if (response.error?.config) {
          delete response.error.config;
        }
      }
      break;
    case '/crosschain/{function}':
      // seperate each function
      switch (req.params.function?.toLowerCase()) {
        case 'transactions':
          const { txHash, sourceChain, destinationAddress, depositAddress, asset } = { ...params };
          if (txHash) {
            let query = {
              match: {
                'send.id': txHash,
              }
            };
            const response_txs = await crud({ index: 'crosschain_txs', method: 'search', query, size: 1 });
            let tx = response_txs?.data?.[0];
            if (!tx && depositAddress) {
              const created_at = moment().utc();
              const evm_chains = chains?.[environment]?.evm || [];
              const cosmos_chains = chains?.[environment]?.cosmos?.filter(c => c?.id !== 'axelarnet') || [];
              const _assets = assets?.[environment] || [];

              if (txHash.startsWith('0x')) {
                if (evm_chains.length > 0) {
                  const chains_rpc = Object.fromEntries(evm_chains.map(c => [c?.id, _.head(c?.provider_params?.[0]?.rpcUrls)]) || []);
                  for (let i = 0; i < evm_chains.length; i++) {
                    const chain = evm_chains[i];
                    if (!sourceChain || chain?.id === sourceChain.toLowerCase()) {
                      const provider = new JsonRpcProvider(chains_rpc[chain.id]);
                      const transaction = await provider.getTransaction(txHash);
                      const height = transaction?.blockNumber;
                      if (height) {
                        const tx_send = {
                          id: txHash.toLowerCase(),
                          type: 'evm_transfer',
                          status_code: 0,
                          status: 'success',
                          height,
                          created_at: get_granularity(created_at),
                          sender_address: transaction.from?.toLowerCase(),
                          recipient_address: depositAddress?.toLowerCase(),
                          sender_chain: chain.id,
                        };
                        tx_send.amount = BigNumber.from(`0x${transaction.data?.substring(10 + 64) || transaction.input?.substring(10 + 64) || '0'}`).toNumber();
                        tx_send.denom = _assets?.find(a => a?.contracts?.findIndex(c => c?.contract_address?.toLowerCase() === transaction.to.toLowerCase()) > -1)?.id;

                        // get linked address
                        query = {
                          match: {
                            deposit_address: tx_send.recipient_address,
                          },
                        };
                        const response_linked = await crud({ index: 'linked_addresses', method: 'search', query, size: 1 });
                        const linked = response_linked?.data?.[0];
                        if (linked) {
                          tx_send.recipient_chain = linked.recipient_chain || tx_send.recipient_chain;
                          tx_send.denom = tx_send.denom || linked.asset;
                          await crud({ index: 'crosschain_txs', method: 'set', path: `/crosschain_txs/_update/${tx_send.id}`, id: tx_send.id, send: tx_send });
                        }
                        tx = { send: tx_send, linked };
                      }
                    }
                  }
                }
              }
              else if (cosmos_chains.length > 0) {
                for (let i = 0; i < cosmos_chains.length; i++) {
                  const chain = cosmos_chains[i];
                  if ((!sourceChain || chain?.id === sourceChain.toLowerCase()) && chain?.endpoints?.lcd) {
                    // initial lcd
                    const lcd = axios.create({ baseURL: chain.endpoints.lcd });
                    // request lcd
                    const response_tx = await lcd.get(`/cosmos/tx/v1beta1/txs/${txHash}`)
                      .catch(error => { return { data: { error } }; });
                    const transaction = response_tx?.data?.tx_response;
                    if (transaction.tx?.body?.messages) {
                      const type = 'ibc_transfer';
                      const height = Number(transaction.height);
                      const created_at = moment(transaction.timestamp).utc();
                      const sender_address = transaction.tx.body.messages.find(m => m?.sender)?.sender?.toLowerCase();
                      const recipient_address = transaction.tx.body.messages.find(m => m?.receiver)?.receiver?.toLowerCase();
                      const amount_denom = transaction.tx.body.messages.find(m => m?.token)?.token;
                      const amount = Number(amount_denom?.amount);
                      const denom = amount_denom?.denom;
                      const tx_send = {
                        id: transaction.txhash?.toLowerCase(),
                        type,
                        status_code: transaction.code,
                        status: transaction.code ? 'failed' : 'success',
                        height,
                        created_at: get_granularity(created_at),
                        sender_chain: chain.id,
                        sender_address,
                        recipient_address,
                        amount,
                        denom,
                      };
                      if (tx_send.recipient_address?.length >= 65 && tx_send.id && tx_send.amount > 0) {
                        const query = {
                          match: {
                            deposit_address: tx_send.recipient_address,
                          },
                        };
                        const response_linked = await crud({ index: 'linked_addresses', method: 'search', query, size: 1 });
                        const linked = response_linked?.data?.[0];
                        if (linked) {
                          tx_send.recipient_chain = normalize_chain(linked.recipient_chain);
                          tx_send.denom = tx_send.denom || linked.asset;
                          await crud({ index: 'crosschain_txs', method: 'set', path: `/crosschain_txs/_update/${tx_send.id}`, id: tx_send.id, send: tx_send });
                        }
                        tx = { send: tx_send, linked };
                      }
                      break;
                    }
                  }
                }
              }
            }
            else if (tx) {
              const query = {
                match: {
                  deposit_address: tx.send?.recipient_address || depositAddress,
                },
              };
              const response_linked = await crud({ index: 'linked_addresses', method: 'search', query, size: 1 });
              const linked = response_linked?.data?.[0];
              tx = { ...tx, linked };
            }
            response = [tx].filter(t => t);
          }
          else if (destinationAddress || depositAddress) {
            let query = {
              bool: {
                must: [
                  { match: { deposit_address: depositAddress } },
                  { match: { recipient_address: destinationAddress } },
                  { match: { asset } },
                ].filter(m => Object.values(m.match).filter(v => v).length > 0),
              },
            };
            const response_linked = await crud({ index: 'linked_addresses', method: 'search', query, sort: [{ height: 'desc' }], size: 1000 });
            const linked_list = response_linked?.data || [];
            const should = [];
            for (let i = 0; i < linked_list.length; i++) {
              const linked = linked_list[i];
              if (linked?.deposit_address) {
                if (should.findIndex(s => s?.match?.['send.recipient_address'] === linked.deposit_address.toLowerCase()) < 0) {
                  should.push({ match: { 'send.recipient_address': linked.deposit_address.toLowerCase() } });
                }
              }
            }
            let txs;
            if (should.length > 0) {
              query = {
                bool: {
                  should,
                },
              };
              const response_txs = await crud({ index: 'crosschain_txs', method: 'search', query, size: 1000 });
              txs = response_txs?.data?.filter(tx => tx).map(tx => {
                return {
                  ...tx,
                  linked: linked_list.find(l => l?.deposit_address?.toLowerCase() === tx?.send?.recipient_address?.toLowerCase()),
                };
              });
              if (!(txs?.length > 0)) {
                txs = linked_list?.map(l => { return { linked: l } }) || [];
              }
            }
            response = txs || [];
          }
          break;
        default:
          break;
      };
      break;
    default:
      if (!req.url) {
        await require('./services/archiver')();
      }
      break;
  };

  // return response
  return response;
};