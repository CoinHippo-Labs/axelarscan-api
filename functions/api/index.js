exports.handler = async (event, context, callback) => {
  // import module for http request
  const axios = require('axios');
  // import ethers.js
  const {
    BigNumber,
    Contract,
    providers: { FallbackProvider, JsonRpcProvider },
    utils,
  } = require('ethers');
  // import module for date time
  const moment = require('moment');
  // import lodash
  const _ = require('lodash');
  // import config
  const config = require('config-yml');
  // import index
  const { crud } = require('./services/index');
  // import asset price
  const assets_price = require('./services/assets');
  // import utils
  const { sleep, equals_ignore_case, get_params, to_json, to_hex, get_granularity, normalize_chain, transfer_actions, vote_types, getBlockTime } = require('./utils');
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
          if (!cache_id ||
            path.startsWith('/cosmos/tx/v1beta1/txs') ||
            path.startsWith('/cosmos/base/tendermint/v1beta1/blocks')
          ) {
            cache = false;
          }
          // get from cache
          if (cache) {
            response_cache = await crud({
              collection: 'cosmos',
              method: 'get',
              id: cache_id,
            });
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
              await crud({
                collection: 'cosmos',
                method: 'set',
                id: cache_id,
                response: JSON.stringify(res.data),
                updated_at: moment().unix(),
              });
            }
          }
          else if (response_cache) {
            res = { data: response_cache };
          }
          // process
          const evm_chains = chains?.[environment]?.evm || [];
          const chains_rpc = Object.fromEntries(evm_chains.map(c => [c?.id, c?.provider_params?.[0]?.rpcUrls || []]));
          const cosmos_chains = chains?.[environment]?.cosmos?.filter(c => c?.id !== 'axelarnet') || [];
          const _assets = assets?.[environment] || [];
          const num_blocks_per_heartbeat = config?.[environment]?.num_blocks_per_heartbeat || 50;
          const fraction_heartbeat_block = config?.[environment]?.fraction_heartbeat_block || 1;
          if (path.startsWith('/cosmos/tx/v1beta1/txs/') && !path.endsWith('/') && res?.data?.tx_response?.txhash) {
            const { tx_response, tx } = { ...res.data };
            // custom evm deposit confirmation
            const log_index = tx_response.logs?.findIndex(l => l?.events?.findIndex(e => e?.type === 'depositConfirmation') > -1);
            const deposit_confirmation_log = tx_response.logs?.[log_index];
            if (deposit_confirmation_log) {
              const event_index = deposit_confirmation_log?.events?.findIndex(e => e?.type === 'depositConfirmation');
              const event = deposit_confirmation_log?.events?.[event_index];
              const chain = event?.attributes?.find(a => a?.key === 'chain' && a.value)?.value;
              const token_address = event?.attributes?.find(a => a?.key === 'tokenAddress' && a.value)?.value;
              if (chain && token_address) {
                const chain_data = evm_chains?.find(c => equals_ignore_case(c?.id, chain));
                const denom = _assets?.find(a => a?.contracts?.findIndex(c => c?.chain_id === chain_data?.chain_id && equals_ignore_case(c?.contract_address, token_address)) > -1)?.id;
                if (denom) {
                  tx_response.denom = denom;
                }
              }
              const amount_index = event?.attributes?.findIndex(a => a?.key === 'amount' && a.value);
              if (amount_index > -1) {
                const attribute = event.attributes[amount_index];
                const amount_splited = attribute.value.split('');
                let amount = '';
                for (let i = 0; i < amount_splited.length; i++) {
                  const c = amount_splited[i];
                  if (!isNaN(c)) {
                    amount = `${amount}${c}`;
                  }
                  else {
                    break;
                  }
                }
                attribute.value = amount;
                event.attributes[amount_index] = attribute;
                deposit_confirmation_log.events[event_index] = event;
                tx_response.logs[log_index] = deposit_confirmation_log;
                tx_response.raw_log = JSON.stringify(tx_response.logs);
              }
              res.data.tx_response = tx_response;
            }

            // index transaction
            const data = _.cloneDeep(tx_response);
            delete data.data;
            delete data.raw_log;
            delete data.events;
            data.timestamp = moment(data.timestamp).valueOf();
            const { logs } = { ...data };
            const { messages } = { ...tx?.body };
            // byte array to hex
            if (messages) {
              if (messages.findIndex(m => m?.['@type']?.includes('LinkRequest')) > -1) {
                for (let i = 0; i < messages.length; i++) {
                  const message = messages[i];
                  message.denom = message.asset;
                  delete message.asset;
                  messages[i] = message;
                }
              }
              else if (messages.findIndex(m => m?.['@type']?.includes('ConfirmDepositRequest')) > -1) {
                const byte_array_fields = ['tx_id', 'burner_address', 'burn_address'];
                for (let i = 0; i < messages.length; i++) {
                  const message = messages[i];
                  if (typeof message?.amount === 'string') {
                    const event = _.head(logs.flatMap(l => l?.events?.filter(e => e?.type === 'depositConfirmation')));
                    const amount = event?.attributes?.find(a => a?.key === 'amount' && a.value)?.value;
                    const denom = data.denom || message.denom;
                    message.amount = [{ amount, denom }];
                  }
                  for (let j = 0; j < byte_array_fields.length; j++) {
                    const field = byte_array_fields[j];
                    if (Array.isArray(message[field])) {
                      message[field] = to_hex(message[field]);
                    }
                  }
                  messages[i] = message;
                  res.data.tx.body.messages[i] = message;
                }
              }
              else if (messages.findIndex(m => m?.['@type']?.includes('VoteRequest')) > -1) {
                const byte_array_fields = ['tx_id', 'to', 'sender', 'payload_hash'];
                for (let i = 0; i < messages.length; i++) {
                  const message = messages[i];
                  if (message?.inner_message?.vote?.results) {
                    const results = message.inner_message.vote.results;
                    for (let j = 0; j < results.length; j++) {
                      const result = results[j];
                      if (result) {
                        for (let k = 0; k < byte_array_fields.length; k++) {
                          const field = byte_array_fields[k];
                          if (Array.isArray(result[field])) {
                            result[field] = to_hex(result[field]);
                          }
                          else if (Array.isArray(result.transfer?.[field])) {
                            result.transfer[field] = to_hex(result.transfer[field]);
                          }
                          results[j] = result;
                          message.inner_message.vote.results = results;
                        }
                      }
                    }
                  }
                  if (message?.inner_message?.vote?.result?.events) {
                    const result = message.inner_message.vote.result;
                    for (let j = 0; j < result.events.length; j++) {
                      const event = result.events[j];
                      for (let k = 0; k < byteArrayFields.length; k++) {
                        const field = byteArrayFields[k];
                        if (Array.isArray(event?.[field])) {
                          event[field] = to_hex(event[field]);
                        }
                        else if (Array.isArray(event?.contract_call?.[field])) {
                          event.contract_call[field] = to_hex(event.contract_call[field]);
                        }
                        else if (Array.isArray(event?.contract_call_with_token?.[field])) {
                          event.contract_call_with_token[field] = to_hex(event.contract_call_with_token[field]);
                        }
                        result.events[j] = event;
                        message.inner_message.vote.result = result;
                      }
                    }
                  }
                  messages[i] = message;
                  res.data.tx.body.messages[i] = message;
                }
              }
              data.tx.body.messages = messages;
            }
            // index addresses & message type
            const address_fields = ['signer', 'sender', 'recipient', 'spender', 'receiver', 'depositAddress', 'voter'];
            let addresses = [], types = [];
            if (logs) {
              addresses = _.uniq(_.concat(addresses, logs.flatMap(l => l?.events?.flatMap(e => e?.attributes?.filter(a => address_fields.includes(a.key)).map(a => a.value) || []) || [])).filter(a => typeof a === 'string' && a.startsWith('axelar')));
            }
            if (messages) {
              addresses = _.uniq(_.concat(addresses, messages.flatMap(m => _.concat(address_fields.map(f => m[f]), address_fields.map(f => m.inner_message?.[f])))).filter(a => typeof a === 'string' && a.startsWith('axelar')));
              types = _.uniq(_.concat(types, messages.flatMap(m => [_.last(m?.['@type']?.split('.')), _.last(m?.inner_message?.['@type']?.split('.'))])).filter(t => t));
            }
            data.addresses = addresses;
            data.types = types;
            await crud({
              collection: 'txs',
              method: 'set',
              id: data.txhash,
              ...data,
            });

            // index metrics & transfers
            if (tx_response && messages && !tx_response.code) {
              // Heartbeat
              if (messages.findIndex(m => m?.inner_message?.['@type']?.includes('HeartBeatRequest')) > -1) {
                const record = {
                  txhash: tx_response.txhash,
                  height: Number(tx_response.height),
                  timestamp: moment(tx_response.timestamp).valueOf(),
                  signatures: tx.signatures,
                  sender: _.head(messages.map(m => m?.sender)),
                  key_ids: _.uniq(messages.flatMap(m => m?.inner_message?.key_ids || [])),
                };
                record.period_height = record.height - (record.height % num_blocks_per_heartbeat) + fraction_heartbeat_block;
                if (record.sender) {
                  await crud({
                    collection: 'heartbeats',
                    method: 'set',
                    id: `${record.sender}_${record.period_height}`,
                    ...record,
                  });
                }
              }
              // Link
              else if (messages.findIndex(m => m?.['@type']?.includes('LinkRequest')) > -1) {
                const event = _.head(logs?.flatMap(l => l?.events?.filter(e => e?.type === 'link')));
                const sender_chain = event?.attributes?.find(a => a?.key === 'sourceChain' && a.value)?.value;
                const deposit_address = event?.attributes?.find(a => a?.key === 'depositAddress' && a.value)?.value;
                const record = {
                  ...messages[0],
                  txhash: tx_response.txhash,
                  height: Number(tx_response.height),
                  sender_chain,
                  deposit_address,
                };
                record.id = record.deposit_address || record.txhash;
                record.type = record['@type']?.split('.')[0]?.replace('/', '');
                delete record['@type'];
                record.sender_address = record.sender;
                delete record.sender;
                record.sender_chain = normalize_chain(cosmos_chains.find(c => record.sender_address?.startsWith(c?.prefix_address))?.id || record.sender_chain || record.chain);
                delete record.chain;
                record.recipient_address = record.recipient_addr;
                delete record.recipient_addr;
                record.recipient_chain = normalize_chain(record.recipient_chain);
                if (record.asset || record.denom) {
                  const created_at = moment(tx_response.timestamp).utc();
                  const prices_data = await assets_price({
                    denom: record.asset || record.denom,
                    timestamp: created_at,
                  });
                  if (prices_data?.[0]?.price) {
                    record.price = prices_data[0].price;
                  }
                }
                await crud({
                  collection: 'deposit_addresses',
                  method: 'set',
                  path: `/deposit_addresses/_update/${record.id}`,
                  ...record,
                });
              }
              // MsgSend
              else if (messages.findIndex(m => _.last(m?.['@type']?.split('.')) === 'MsgSend') > -1) {
                const created_at = moment(tx_response.timestamp).utc();
                const amount_denom = messages.find(m => m?.amount)?.amount?.[0];
                const record = {
                  id: tx_response.txhash,
                  type: 'axelarnet_transfer',
                  status_code: tx_response.code,
                  status: tx_response.code ? 'failed' : 'success',
                  height: Number(tx_response.height),
                  created_at: get_granularity(created_at),
                  sender_address: messages.find(m => m?.from_address)?.from_address,
                  recipient_address: messages.find(m => m?.to_address)?.to_address,
                  amount: amount_denom?.amount,
                  denom: amount_denom?.denom,
                };
                if (record.recipient_address?.length >= 65 && record.id && record.amount) {
                  const query = {
                    match: {
                      deposit_address: record.recipient_address,
                    },
                  };
                  const _response = await crud({
                    collection: 'deposit_addresses',
                    method: 'search',
                    query,
                    size: 1,
                  });
                  const link = _response?.data?.[0];
                  if (link) {
                    record.sender_chain = link.sender_chain;
                    record.recipient_chain = link.recipient_chain;
                    record.denom = record.denom || link.asset;
                  }
                  if (record.denom) {
                    const asset_data = _assets.find(a => equals_ignore_case(a?.id, record.denom));
                    const decimals = asset_data?.ibc?.find(i => i?.chain_id === 'axelarnet')?.decimals || asset_data?.decimals;
                    record.amount = Number(utils.formatUnits(BigNumber.from(record.amount).toString(), decimals));
                  }
                  if (link?.price && typeof record.amount === 'number') {
                    record.value = record.amount * link.price;
                  }
                  await crud({
                    collection: 'transfers',
                    method: 'set',
                    path: `/transfers/_update/${record.id}`,
                    id: record.id,
                    source: record,
                  });
                }
              }
              // MsgRecvPacket -> MsgTransfer
              else if (messages.findIndex(m => _.last(m?.['@type']?.split('.')) === 'MsgRecvPacket') > -1) {
                const event_recv_packets = logs.map(l => {
                  return {
                    ...l?.events?.find(e => e?.type === 'recv_packet'),
                    height: Number(messages.find(m => _.last(m?.['@type']?.split('.')) === 'MsgRecvPacket')?.proof_height?.revision_height || '0') - 1,
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
                      const chain_data = cosmos_chains[j];
                      if (chain_data?.endpoints?.lcd && packet_data.sender?.startsWith(chain_data.prefix_address)) {
                        // initial lcd
                        const lcd = axios.create({ baseURL: chain_data.endpoints.lcd });
                        // request lcd
                        const _response = await lcd.get(`/cosmos/tx/v1beta1/txs?limit=5&events=${encodeURIComponent(`send_packet.packet_data_hex='${packet_data_hex}'`)}&events=tx.height=${_height}`)
                          .catch(error => { return { data: { error } }; });
                        const tx_index = _response?.data?.tx_responses?.findIndex(t => {
                          const event_send_packet = _.head(t?.logs.flatMap(l => l?.events?.filter(e => e?.type === 'send_packet')));
                          const _packet_sequence = event_send_packet?.attributes?.find(a => a?.key === 'packet_sequence' && a.value)?.value;
                          return packet_sequence === _packet_sequence;
                        });
                        if (tx_index > -1) {
                          const transaction = {
                            ..._response.data.tx_responses[tx_index],
                            tx: {
                              ..._response.data.txs?.[tx_index],
                            },
                          };
                          const _messages = transaction.tx.body?.messages;
                          if (_messages) {
                            const created_at = moment(transaction.timestamp).utc();
                            const amount_denom = _messages.find(m => m?.token)?.token;
                            const record = {
                              id: transaction.txhash,
                              type: 'ibc_transfer',
                              status_code: transaction.code,
                              status: transaction.code ? 'failed' : 'success',
                              height: Number(transaction.height),
                              created_at: get_granularity(created_at),
                              sender_chain: chain_data.id,
                              sender_address: _messages.find(m => m?.sender)?.sender,
                              recipient_address: _messages.find(m => m?.receiver)?.receiver,
                              amount: amount_denom?.amount,
                              denom: amount_denom?.denom,
                            };
                            if (record.recipient_address?.length >= 65 && record.id && record.amount) {
                              const query = {
                                match: {
                                  deposit_address: record.recipient_address,
                                },
                              };
                              const _response = await crud({
                                collection: 'deposit_addresses',
                                method: 'search',
                                query,
                                size: 1,
                              });
                              const link = _response?.data?.[0];
                              if (link) {
                                record.recipient_chain = link.recipient_chain;
                                record.denom = record.denom || link.asset;
                              }
                              if (record.denom) {
                                const asset_data = _assets.find(a => equals_ignore_case(a?.id, record.denom));
                                const decimals = asset_data?.ibc?.find(i => i?.chain_id === chain_data.id)?.decimals || asset_data?.decimals;
                                record.amount = Number(utils.formatUnits(BigNumber.from(record.amount).toString(), decimals));
                              }
                              if (link?.price && typeof record.amount === 'number') {
                                record.value = record.amount * link.price;
                              }
                              await crud({
                                collection: 'transfers',
                                method: 'set',
                                path: `/transfers/_update/${record.id}`,
                                id: record.id,
                                source: record,
                              });
                              break;
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
              // ConfirmDeposit & ConfirmERC20Deposit
              else if (messages.findIndex(m => transfer_actions?.includes(_.last(m?.['@type']?.split('.'))?.replace('Request', ''))) > -1) {
                const event_message = _.head(logs.flatMap(l => l?.events?.filter(e => e?.type === 'message')));
                const created_at = moment(tx_response.timestamp).utc();
                const event = _.head(logs.flatMap(l => l?.events?.filter(e => e?.type === 'depositConfirmation')));
                const poll_id = to_json(event?.attributes?.find(a => a?.key === 'poll' && a.value)?.value)?.id;
                const record = {
                  id: tx_response.txhash,
                  type: event_message?.attributes?.find(a => a?.key === 'action' && transfer_actions?.includes(a.value))?.value || _.last(messages.find(m => transfer_actions?.includes(_.last(m?.['@type']?.split('.'))?.replace('Request', '')))?.['@type']?.split('.'))?.replace('Request', ''),
                  status_code: tx_response.code,
                  status: tx_response.code ? 'failed' : 'success',
                  height: Number(tx_response.height),
                  created_at: get_granularity(created_at),
                  user: messages.find(m => m?.sender)?.sender,
                  module: event?.attributes?.find(a => a?.key === 'module' && a.value)?.value || (type === 'ConfirmDeposit' ? 'axelarnet' : 'evm'),
                  sender_chain: normalize_chain(messages.find(m => m?.chain)?.chain || event?.attributes?.find(a => ['sourceChain', 'chain'].includes(a?.key) && a.value)?.value),
                  recipient_chain: normalize_chain(event?.attributes?.find(a => ['destinationChain'].includes(a?.key) && a.value)?.value),
                  amount: event?.attributes?.find(a => a?.key === 'amount' && a.value)?.value,
                  denom: tx_response.denom || messages.find(m => m?.denom)?.denom,
                  token_address: event?.attributes?.find(a => a?.key === 'tokenAddress' && a.value)?.value,
                  deposit_address: messages.find(m => m?.deposit_address)?.deposit_address || event?.attributes?.find(a => a?.key === 'depositAddress' && a.value)?.value,
                  transfer_id: Number(event?.attributes?.find(a => a?.key === 'transferID' && a.value)?.value),
                  poll_id,
                  transaction_id: event?.attributes?.find(a => a?.key === 'txID' && a.value)?.value || poll_id?.split('_')[0],
                };
                if (!record.status_code && record.id && (record.transfer_id || record.poll_id)) {
                  switch (record.type) {
                    case 'ConfirmDeposit':
                      try {
                        let sign_batch, query = {
                          bool: {
                            must: [
                              { match: { deposit_address: record.deposit_address } },
                            ],
                          },
                        };
                        let _response = !record.recipient_chain && await crud({
                          collection: 'deposit_addresses',
                          method: 'search',
                          query,
                          size: 1,
                        });
                        const link = _response?.data?.[0];
                        const recipient_chain = link?.recipient_chain || record.recipient_chain;
                        if (recipient_chain) {
                          const command_id = record.transfer_id.toString(16).padStart(64, '0');
                          query = {
                            bool: {
                              must: [
                                { match: { chain: recipient_chain } },
                                { match: { status: 'BATCHED_COMMANDS_STATUS_SIGNED' } },
                                { match: { command_ids: command_id } },
                              ],
                            },
                          };
                          _response = await crud({
                            collection: 'batches',
                            method: 'search',
                            query,
                            size: 1,
                          });
                          const batch = _response?.data?.[0];
                          if (batch) {
                            sign_batch = {
                              chain: recipient_chain,
                              batch_id: batch.batch_id,
                              command_id,
                              transfer_id: record.transfer_id,
                            };
                            const rpcs = chains_rpc[recipient_chain];
                            const provider = rpcs.length === 1 ? new JsonRpcProvider(rpcs[0]) : new FallbackProvider(rpcs.map((url, i) => {
                              return {
                                provider: new JsonRpcProvider(url),
                                priority: i + 1,
                                stallTimeout: 1000,
                              };
                            }));
                            const gateway_address = evm_chains?.find(c => c?.id === recipient_chain)?.gateway_address;
                            const gateway = gateway_address && new Contract(gateway_address, IAxelarGateway.abi, provider);
                            if (gateway) {
                              try {
                                sign_batch.executed = await gateway.isCommandExecuted(`0x${command_id}`);
                              } catch (error) {}
                            }
                          }
                        }
                        // query transfers
                        query = {
                          bool: {
                            must: [
                              { match: { 'source.status_code': 0 } },
                              { match: { 'source.recipient_address': record.deposit_address } },
                              { range: { 'source.created_at.ms': { lte: record.created_at.ms } } },
                            ],
                            should: [
                              { range: { 'confirm_deposit.created_at.ms': { gt: record.created_at.ms } } },
                              { bool: {
                                must_not: [
                                  { exists: { field: 'confirm_deposit' } },
                                ],
                              } },
                            ],
                          },
                        };
                        _response = await crud({
                          collection: 'transfers',
                          method: 'search',
                          query,
                          size: 100,
                        });
                        if (_response?.data?.length > 0) {
                          const transfers = _response.data.filter(t => t?.source?.id);
                          const ids = transfers.map(t => t.source.id);
                          for (let i = 0; i < ids.length; i++) {
                            const id = ids[i];
                            const transfer = transfers[i];
                            const transfer_source = transfer.source;
                            const params = {
                              index: 'transfers',
                              method: 'set',
                              path: `/transfers/_update/${id}`,
                              id,
                              confirm_deposit: record,
                            };
                            if (sign_batch) {
                              params.sign_batch = sign_batch;
                            }
                            if (transfer_source) {
                              transfer_source.sender_chain = normalize_chain(cosmos_chains.find(c => transfer_source.sender_address?.startsWith(c?.prefix_address))?.id || record.sender_chain);
                              transfer_source.recipient_chain = transfer_source.recipient_chain || record.recipient_chain;
                              params.source = transfer_source;
                            }
                            await crud(params);
                          }
                        }
                        else if (sign_batch) {
                          query = {
                            bool: {
                              must: [
                                { match: { 'source.recipient_address': record.deposit_address } },
                                { match: { 'confirm_deposit.transfer_id': record.transfer_id } },
                              ],
                            },
                          };
                          _response = await crud({
                            collection: 'transfers',
                            method: 'search',
                            query,
                            size: 100,
                          });
                          if (_response?.data?.length > 0) {
                            const transfers = _response.data.filter(t => t?.source?.id);
                            const ids = transfers.map(t => t.source.id);
                            for (let i = 0; i < ids.length; i++) {
                              const id = ids[i];
                              const transfer = transfers[i];
                              const transfer_source = transfer.source;
                              const params = {
                                index: 'transfers',
                                method: 'set',
                                path: `/transfers/_update/${id}`,
                                id,
                                sign_batch,
                              };
                              if (transfer_source) {
                                transfer_source.sender_chain = normalize_chain(cosmos_chains.find(c => transfer_source.sender_address?.startsWith(c?.prefix_address))?.id || record.sender_chain);
                                transfer_source.recipient_chain = transfer_source.recipient_chain || record.recipient_chain;
                                params.source = transfer_source;
                              }
                              await crud(params);
                            }
                          }
                        }
                      } catch (error) {}
                      break;
                    case 'ConfirmERC20Deposit':
                      try {
                        const chain_data = evm_chains?.find(c => equals_ignore_case(c?.id, record.sender_chain));
                        const rpcs = chains_rpc[record.sender_chain];
                        const provider = rpcs.length === 1 ? new JsonRpcProvider(rpcs[0]) : new FallbackProvider(rpcs.map((url, i) => {
                          return {
                            provider: new JsonRpcProvider(url),
                            priority: i + 1,
                            stallTimeout: 1000,
                          };
                        }));
                        const { transaction_id, deposit_address, sender_chain, recipient_chain, token_address, amount, denom } = { ...record };
                        if (transaction_id) {
                          const transaction = await provider.getTransaction(transaction_id);
                          const height = transaction?.blockNumber;
                          if (height) {
                            record.amount = BigNumber.from(`0x${transaction.data?.substring(10 + 64) || transaction.input?.substring(10 + 64) || '0'}`).toString() || amount;
                            if (equals_ignore_case(transaction.to, token_address) || _assets?.findIndex(a => a?.contracts?.findIndex(c => c?.chain_id === chain_data?.chain_id && equals_ignore_case(c?.contract_address, transaction.to)) > -1) > -1) {
                              record.denom = _assets?.find(a => a?.contracts?.findIndex(c => c?.chain_id === chain_data?.chain_id && equals_ignore_case(c?.contract_address, transaction.to)) > -1)?.id || denom;
                              const transfer_source = {
                                id: transaction_id,
                                type: 'evm_transfer',
                                status_code: 0,
                                status: 'success',
                                height,
                                created_at: get_granularity(created_at),
                                sender_address: transaction.from,
                                recipient_address: deposit_address,
                                sender_chain,
                                recipient_chain,
                                amount: record.amount,
                                denom: record.denom,
                              };
                              const query = {
                                match: {
                                  deposit_address,
                                },
                              };
                              const _response = await crud({
                                collection: 'deposit_addresses',
                                method: 'search',
                                query,
                                size: 1,
                              });
                              const link = _response?.data?.[0];
                              if (link) {
                                transfer_source.sender_chain = link.sender_chain || transfer_source.sender_chain;
                                transfer_source.recipient_chain = link.recipient_chain || transfer_source.recipient_chain;
                                transfer_source.denom = transfer_source.denom || link.asset;
                              }
                              if (transfer_source.denom) {
                                const asset_data = _assets.find(a => equals_ignore_case(a?.id, transfer_source.denom));
                                const decimals = asset_data?.contracts?.find(c => c?.chain_id === chain_data?.chain_id)?.decimals || asset_data?.decimals;
                                transfer_source.amount = Number(utils.formatUnits(BigNumber.from(transfer_source.amount).toString(), decimals));
                              }
                              if (link?.price && typeof transfer_source.amount === 'number') {
                                transfer_source.value = transfer_source.amount * link.price;
                              }
                              await crud({
                                collection: 'transfers',
                                method: 'set',
                                path: `/transfers/_update/${transaction_id}`,
                                id: transaction_id,
                                source: transfer_source,
                                confirm_deposit: record,
                              });
                            }
                          }
                        }
                      } catch (error) {}
                      break;
                    default:
                      break;
                  };
                }
              }
              // VoteConfirmDeposit & Vote
              if (messages.findIndex(m => vote_types.includes(_.last(m?.inner_message?.['@type']?.split('.'))?.replace('Request', ''))) > -1) {
                for (let i = 0; i < messages.length; i++) {
                  const message = messages[i];
                  const type = _.last(message?.inner_message?.['@type']?.split('.'))?.replace('Request', '');
                  if (vote_types.includes(type)) {
                    const created_at = moment(tx_response.timestamp).utc();
                    const event = logs?.[i]?.events?.find(e => e?.type === 'depositConfirmation');
                    const event_vote = logs?.[i]?.events?.find(e => e?.type === 'vote');
                    const poll_id = to_json(message?.inner_message?.poll_key || event?.attributes?.find(a => a?.key === 'poll' && a.value)?.value || event_vote?.attributes?.find(a => a?.key === 'poll' && a.value)?.value)?.id;
                    let sender_chain, vote, confirmation;
                    switch (type) {
                      case 'VoteConfirmDeposit':
                        sender_chain = normalize_chain(message?.inner_message?.chain || event?.attributes?.find(a => ['sourceChain', 'chain'].includes(a?.key) && a.value)?.value);
                        vote = message?.inner_message?.confirmed || false;
                        confirmation = event?.attributes?.findIndex(a => a?.key === 'action' && a.value === 'confirm') > -1;
                        break;
                      case 'Vote':
                        sender_chain = normalize_chain(message?.inner_message?.vote?.results?.[0]?.chain || message?.inner_message?.vote?.result?.chain || evm_chains.find(c => poll_id?.startsWith(`${c?.id}_`))?.id);
                        const vote_results = message?.inner_message?.vote?.results || message?.inner_message?.vote?.result;
                        vote = (Array.isArray(vote_results) ? vote_results : Object.keys({ ...vote_results })).length > 0;
                        confirmation = !!event;
                        break;
                      default:
                        break;
                    };
                    const record = {
                      id: tx_response.txhash,
                      type,
                      status_code: tx_response.code,
                      status: tx_response.code ? 'failed' : 'success',
                      height: Number(tx_response.height),
                      created_at: get_granularity(created_at),
                      sender_chain,
                      recipient_chain: normalize_chain(event?.attributes?.find(a => ['destinationChain'].includes(a?.key) && a.value)?.value),
                      deposit_address: event?.attributes?.find(a => a?.key === 'depositAddress' && a.value)?.value || poll_id?.replace(`${sender_chain}_`, '').split('_')[1],
                      transfer_id: Number(event?.attributes?.find(a => a?.key === 'transferID' && a.value)?.value),
                      poll_id,
                      transaction_id: event?.attributes?.find(a => a?.key === 'txID' && a.value)?.value || poll_id?.replace(`${sender_chain}_`, '').split('_')[0],
                      voter: message?.inner_message?.sender,
                      vote,
                      confirmation,
                      unconfirmed: logs?.findIndex(l => l?.log?.startsWith('not enough votes')) > -1,
                    };
                    if (!record.status_code) {
                      if (record.deposit_address && !record.sender_chain) {
                        const query = {
                          bool: {
                            must: [
                              { match: { deposit_address: record.deposit_address } },
                            ],
                          },
                        };
                        const _response = await crud({
                          collection: 'deposit_addresses',
                          method: 'search',
                          query,
                          size: 1,
                        });
                        const link = _response?.data?.[0];
                        if (link?.sender_chain) {
                          record.sender_chain = link.sender_chain;
                        }
                      }
                      if (record.poll_id) {
                        if (record.id && record.vote && record.confirmation) {
                          try {
                            const chain_data = evm_chains?.find(c => equals_ignore_case(c?.id, record.sender_chain));
                            const rpcs = chains_rpc[record.sender_chain];
                            const provider = rpcs.length === 1 ? new JsonRpcProvider(rpcs[0]) : new FallbackProvider(rpcs.map((url, i) => {
                              return {
                                provider: new JsonRpcProvider(url),
                                priority: i + 1,
                                stallTimeout: 1000,
                              };
                            }));
                            const { created_at, sender_chain, recipient_chain, deposit_address, transaction_id, poll_id } = { ...record };
                            if (transaction_id) {
                              const transaction = await provider.getTransaction(transaction_id);
                              const height = transaction?.blockNumber;
                              if (height) {
                                record.amount = BigNumber.from(`0x${transaction.data?.substring(10 + 64) || transaction.input?.substring(10 + 64) || '0'}`).toString() || _.last(poll_id?.split('_'));
                                const denom = _assets?.find(a => a?.contracts?.findIndex(c => c?.chain_id === chain_data?.chain_id && equals_ignore_case(c?.contract_address, transaction.to)) > -1)?.id;
                                if (denom) {
                                  record.denom = denom;
                                  const transfer_source = {
                                    id: transaction_id,
                                    type: 'evm_transfer',
                                    status_code: 0,
                                    status: 'success',
                                    height,
                                    created_at,
                                    sender_address: transaction.from,
                                    recipient_address: deposit_address,
                                    sender_chain,
                                    recipient_chain,
                                    amount: record.amount,
                                    denom: record.denom,
                                  };
                                  const query = {
                                    match: {
                                      deposit_address,
                                    },
                                  };
                                  let _response = await crud({
                                    collection: 'deposit_addresses',
                                    method: 'search',
                                    query,
                                    size: 1,
                                  });
                                  const link = _response?.data?.[0];
                                  if (link) {
                                    transfer_source.sender_chain = link.sender_chain || transfer_source.sender_chain;
                                    transfer_source.recipient_chain = link.recipient_chain || transfer_source.recipient_chain;
                                    transfer_source.denom = transfer_source.denom || link.asset;
                                  }
                                  if (transfer_source.denom) {
                                    const asset_data = _assets.find(a => equals_ignore_case(a?.id, transfer_source.denom));
                                    const decimals = asset_data?.contracts?.find(c => c?.chain_id === chain_data?.chain_id)?.decimals || asset_data?.decimals;
                                    transfer_source.amount = Number(utils.formatUnits(BigNumber.from(transfer_source.amount).toString(), decimals));
                                  }
                                  if (link?.price && typeof transfer_source.amount === 'number') {
                                    transfer_source.value = transfer_source.amount * link.price;
                                  }
                                  await sleep(0.5 * 1000);
                                  _response = await crud({
                                    collection: 'transfers',
                                    method: 'search',
                                    query: { match: { 'source.id': transaction_id } },
                                    size: 1,
                                  });
                                  const transfer_confirm_deposit = _response?.data?.[0]?.confirm_deposit;
                                  const params = {
                                    index: 'transfers',
                                    method: 'set',
                                    path: `/transfers/_update/${transaction_id}`,
                                    id: transaction_id,
                                    source: transfer_source,
                                    vote: record,
                                  };
                                  if (transfer_confirm_deposit) {
                                    params.confirm_deposit = transfer_confirm_deposit;
                                  }
                                  await crud(params);
                                }
                              }
                            }
                          } catch (error) {}
                        }
                        if (record.voter) {
                          const { id, height, created_at, sender_chain, poll_id, transaction_id, voter, vote, confirmation, unconfirmed } = { ...record };
                          if (confirmation || unconfirmed) {
                            const poll_record = {
                              id: poll_id,
                              height,
                              created_at,
                              sender_chain,
                              transaction_id,
                              confirmation,
                            };
                            await crud({
                              collection: 'evm_polls',
                              method: 'set',
                              path: `/evm_polls/_update/${poll_record.id}`,
                              ...poll_record,
                            });
                          }
                          const vote_record = {
                            id: `${poll_id}_${voter}`,
                            txhash: id,
                            height,
                            created_at,
                            voter,
                            sender_chain,
                            poll_id,
                            transaction_id,
                            vote,
                            confirmation,
                            unconfirmed,
                          };
                          await crud({
                            collection: 'evm_votes',
                            method: 'set',
                            path: `/evm_votes/_update/${vote_record.id}`,
                            ...vote_record,
                          });
                        }
                      }
                    }
                  }
                }
              }
            }
          }
          else if (path.startsWith('/cosmos/tx/v1beta1/txs') && !path.endsWith('/') && res?.data?.tx_responses?.length > 0) {
            if (!no_index) {
              const { tx_responses, txs } = { ...res.data };
              // Heartbeat
              let records = tx_responses.map((t, i) => {
                const tx = txs?.[i];
                const { messages } = { ...tx?.body };
                if (t && !t.code && messages?.findIndex(m => m?.inner_message?.['@type']?.includes('HeartBeatRequest')) > -1) {
                  const height = Number(t.height);
                  return {
                    txhash: t.txhash,
                    height,
                    timestamp: moment(t.timestamp).valueOf(),
                    period_height: height - (height % num_blocks_per_heartbeat) + fraction_heartbeat_block,
                    signatures: tx.signatures,
                    sender: _.head(messages.map(m => m?.sender)),
                    key_ids: _.uniq(messages.flatMap(m => m?.inner_message?.key_ids || [])),
                  };
                }
                return null;
              }).filter(r => r?.sender);
              if (records.length > 0) {
                for (let i = 0; i < records.length; i++) {
                  const record = records[i];
                  crud({
                    collection: 'heartbeats',
                    method: 'set',
                    id: `${record.sender}_${record.period_height}`,
                    ...record,
                  });
                }
              }
              // Link
              records = tx_responses.filter(t => !t?.code && t?.tx?.body?.messages?.findIndex(m => m?.['@type']?.includes('LinkRequest')) > -1).map(async t => {
                const { logs } = { ...t };
                const { messages } = { ...t?.tx?.body };
                const event = _.head(logs?.flatMap(l => l?.events?.filter(e => e?.type === 'link')));
                const sender_chain = event?.attributes?.find(a => a?.key === 'sourceChain' && a.value)?.value;
                const deposit_address = event?.attributes?.find(a => a?.key === 'depositAddress' && a.value)?.value;
                const record = {
                  ...messages[0],
                  txhash: t.txhash,
                  height: Number(t.height),
                  sender_chain,
                  deposit_address,
                };
                record.id = record.deposit_address || record.txhash;
                record.type = record['@type']?.split('.')[0]?.replace('/', '');
                delete record['@type'];
                record.sender_address = record.sender;
                delete record.sender;
                record.sender_chain = normalize_chain(cosmos_chains.find(c => record.sender_address?.startsWith(c?.prefix_address))?.id || record.sender_chain || record.chain);
                delete record.chain;
                record.recipient_address = record.recipient_addr;
                delete record.recipient_addr;
                record.recipient_chain = normalize_chain(record.recipient_chain);
                if (record.asset || record.denom) {
                  const created_at = moment(t.timestamp).utc();
                  const prices_data = await assets_price({
                    denom: record.asset || record.denom,
                    timestamp: created_at,
                  });
                  if (prices_data?.[0]?.price) {
                    record.price = prices_data[0].price;
                  }
                }
                return record;
              });
              if (records.length > 0) {
                for (let i = 0; i < records.length; i++) {
                  const record = records[i];
                  crud({
                    collection: 'deposit_addresses',
                    method: 'set',
                    ...record,
                  });
                }
              }
              // VoteConfirmDeposit & Vote
              records = tx_responses.filter(t => !t?.code && t.tx?.body?.messages?.findIndex(m => vote_types.includes(_.last(m?.inner_message?.['@type']?.split('.'))?.replace('Request', ''))) > -1).map(async t => {
                const { logs } = { ...t };
                const { messages } = { ...t?.tx?.body };
                const _records = [];
                for (let i = 0; i < messages.length; i++) {
                  const message = messages[i];
                  const type = _.last(message?.inner_message?.['@type']?.split('.'))?.replace('Request', '');
                  if (vote_types.includes(type)) {
                    const created_at = moment(t.timestamp).utc();
                    const event = logs?.[i]?.events?.find(e => e?.type === 'depositConfirmation');
                    const event_vote = logs?.[i]?.events?.find(e => e?.type === 'vote');
                    const poll_id = to_json(message?.inner_message?.poll_key || event?.attributes?.find(a => a?.key === 'poll' && a.value)?.value || event_vote?.attributes?.find(a => a?.key === 'poll' && a.value)?.value)?.id;
                    let sender_chain, vote, confirmation;
                    switch (type) {
                      case 'VoteConfirmDeposit':
                        sender_chain = normalize_chain(message?.inner_message?.chain || event?.attributes?.find(a => ['sourceChain', 'chain'].includes(a?.key) && a.value)?.value);
                        vote = message?.inner_message?.confirmed || false;
                        confirmation = event?.attributes?.findIndex(a => a?.key === 'action' && a.value === 'confirm') > -1;
                        break;
                      case 'Vote':
                        sender_chain = normalize_chain(message?.inner_message?.vote?.results?.[0]?.chain || message?.inner_message?.vote?.result?.chain || evm_chains.find(c => poll_id?.startsWith(`${c?.id}_`))?.id);
                        const vote_results = message?.inner_message?.vote?.results || message?.inner_message?.vote?.result;
                        vote = (Array.isArray(vote_results) ? vote_results : Object.keys({ ...vote_results })).length > 0;
                        confirmation = !!event;
                        break;
                      default:
                        break;
                    };
                    const record = {
                      id: t.txhash,
                      type,
                      status_code: t.code,
                      status: t.code ? 'failed' : 'success',
                      height: Number(t.height),
                      created_at: get_granularity(created_at),
                      sender_chain,
                      recipient_chain: normalize_chain(event?.attributes?.find(a => ['destinationChain'].includes(a?.key) && a.value)?.value),
                      deposit_address: event?.attributes?.find(a => a?.key === 'depositAddress' && a.value)?.value || poll_id?.replace(`${sender_chain}_`, '').split('_')[1],
                      transfer_id: Number(event?.attributes?.find(a => a?.key === 'transferID' && a.value)?.value),
                      poll_id,
                      transaction_id: event?.attributes?.find(a => a?.key === 'txID' && a.value)?.value || poll_id?.replace(`${sender_chain}_`, '').split('_')[0],
                      voter: message?.inner_message?.sender,
                      vote,
                      confirmation,
                      unconfirmed: logs?.findIndex(l => l?.log?.startsWith('not enough votes')) > -1,
                    };
                    if (!record.status_code) {
                      if (record.deposit_address && !record.sender_chain) {
                        const query = {
                          bool: {
                            must: [
                              { match: { deposit_address: record.deposit_address } },
                            ],
                          },
                        };
                        const _response = await crud({
                          collection: 'deposit_addresses',
                          method: 'search',
                          query,
                          size: 1,
                        });
                        const link = _response?.data?.[0];
                        if (link?.sender_chain) {
                          record.sender_chain = link.sender_chain;
                        }
                      }
                    }
                    _records.push(record);
                  }
                }
                return _records;
              }).flatMap(r => r).filter(r => r?.poll_id && r.voter);
              if (records.length > 0) {
                await sleep(1 * 1000);
                for (let i = 0; i < records.length; i++) {
                  const record = records[i];
                  const { id, height, created_at, sender_chain, poll_id, transaction_id, voter, vote, confirmation, unconfirmed } = { ...record };
                  if (confirmation || unconfirmed) {
                    const poll_record = {
                      id: poll_id,
                      height,
                      created_at,
                      sender_chain,
                      transaction_id,
                      confirmation,
                    };
                    crud({
                      collection: 'evm_polls',
                      method: 'set',
                      path: `/evm_polls/_update/${poll_record.id}`,
                      ...poll_record,
                    });
                  }
                  const vote_record = {
                    id: `${poll_id}_${voter}`,
                    txhash: id,
                    height,
                    created_at,
                    voter,
                    sender_chain,
                    poll_id,
                    transaction_id,
                    vote,
                    confirmation,
                    unconfirmed,
                  };
                  crud({
                    collection: 'evm_votes',
                    method: 'set',
                    path: `/evm_votes/_update/${vote_record.id}`,
                    ...vote_record,
                  });
                }
              }
            }
          }
          else if (path.startsWith('/cosmos/base/tendermint/v1beta1/blocks/') && !path.endsWith('/') && res?.data?.block?.header?.height) {
            const { block, block_id } = { ...res.data };
            await crud({
              collection: 'blocks',
              method: 'set',
              id: block.header.height,
              ...block.header,
              hash: block_id?.hash,
              num_txs: block.data?.txs?.length,
            });
            const { last_commit } = { ...block };
            if (last_commit?.height && last_commit.signatures) {
              await crud({
                collection: 'uptimes',
                method: 'set',
                id: last_commit.height,
                height: Number(last_commit.height),
                timestamp: moment(_.head(last_commit.signatures)?.timestamp).valueOf(),
                validators: last_commit.signatures.map(s => s?.validator_address),
              });
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
              response_cache = await crud({
                collection: 'axelard',
                method: 'get',
                id: cache_id,
              });
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
                        const _response = await cli.get(path, {
                          params: {
                            cmd,
                            cache: true,
                            cache_timeout: 1,
                          }
                        }).catch(error => { return { data: { error } }; });
                        commands.push(to_json(_response?.data?.stdout));
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
                    const _response = await crud({
                      collection: 'batches',
                      method: 'search',
                      query: { match_phrase: { 'batch_id': output.batch_id } },
                      size: 1,
                    });
                    if (!_response?.data?.[0]?.created_at?.ms) {
                      created_at = moment().utc();
                    }
                    else {
                      created_at = moment(_response.data[0].created_at.ms).utc();
                    }
                  }
                  if (created_at) {
                    output.created_at = get_granularity(created_at);
                  }
                  if (['BATCHED_COMMANDS_STATUS_SIGNED'].includes(output.status) && output.command_ids) {
                    const evm_chains = chains?.[environment]?.evm || [];
                    const chains_rpc = Object.fromEntries(evm_chains.map(c => [c?.id, c?.provider_params?.[0]?.rpcUrls || []]));
                    const rpcs = chains_rpc[chain];
                    const provider = rpcs.length === 1 ? new JsonRpcProvider(rpcs[0]) : new FallbackProvider(rpcs.map((url, i) => {
                      return {
                        provider: new JsonRpcProvider(url),
                        priority: i + 1,
                        stallTimeout: 1000,
                      };
                    }));
                    const gateway_address = evm_chains?.find(c => c?.id === chain)?.gateway_address;
                    const gateway = gateway_address && new Contract(gateway_address, IAxelarGateway.abi, provider);
                    if (gateway) {
                      const cosmos_chains = chains?.[environment]?.cosmos?.filter(c => c?.id !== 'axelarnet') || [];
                      const command_ids = output.command_ids.filter(c => parseInt(c, 16) >= 1);
                      const sign_batch = {
                        chain,
                        batch_id: output.batch_id,
                      };
                      for (let i = 0; i < command_ids.length; i++) {
                        const command_id = command_ids[i];
                        const transfer_id = parseInt(command_id, 16);
                        sign_batch.command_id = command_id;
                        sign_batch.transfer_id = transfer_id;
                        const query = {
                          bool: {
                            should: [
                              { match: { 'confirm_deposit.transfer_id': transfer_id } },
                              { match: { 'vote.transfer_id': transfer_id } },
                            ],
                            minimum_should_match: '50%',
                          },
                        };
                        const _response = await crud({
                          collection: 'transfers',
                          method: 'search',
                          query,
                          size: 100,
                        });
                        if (_response?.data?.length > 0) {
                          let executed = !!_response.data[0].sign_batch?.executed;
                          if (!executed) {
                            try {
                              executed = await gateway.isCommandExecuted(`0x${command_id}`);
                            } catch (error) {}
                          }
                          sign_batch.executed = executed;
                          const transfers = _response.data.filter(t => t?.source?.id);
                          const ids = transfers.map(t => t.source.id);
                          for (let j = 0; j < ids.length; j++) {
                            const id = ids[j];
                            const transfer = transfers[j];
                            const transfer_source = transfer?.source;
                            const params = {
                              collection: 'transfers',
                              method: 'set',
                              path: `/transfers/_update/${id}`,
                              id,
                              ...transfer,
                              sign_batch,
                            };
                            if (transfer_source) {
                              transfer_source.sender_chain = normalize_chain(cosmos_chains.find(c => transfer_source.sender_address?.startsWith(c?.prefix_address))?.id || transfer_source.sender_chain);
                              params.source = transfer_source;
                            }
                            await crud(params);
                          }
                        }
                      }
                    }
                  }
                  await crud({
                    collection: 'batches',
                    method: 'set',
                    path: `/batches/_update/${output.id}`,
                    ...output,
                  });
                  res.data.stdout = JSON.stringify(output);
                }
              }
              // save
              if (cache && !cache_hit && cache_id?.startsWith('axelard')) {
                await crud({
                  collection: 'axelard',
                  method: 'set',
                  id: cache_id,
                  ...res.data,
                  updated_at: moment().unix(),
                });
              }
            }
            else if (response_cache) {
              res = { data: response_cache };
            }
            res.data.cache_hit = cache_hit;
          }
          break;
        case 'assets':
          res = { data: await assets_price(params) };
          break;
        case 'index':
          res = { data: await crud(params) };
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
    case '/cross-chain/{function}':
      // seperate each function
      switch (req.params.function?.toLowerCase()) {
        case 'transfers':
          const { txHash, sourceChain, destinationAddress, depositAddress, asset } = { ...params };
          if (txHash) {
            let query = {
              match: {
                'source.id': txHash,
              },
            };
            let _response = await crud({
              collection: 'transfers',
              method: 'search',
              query,
              size: 1,
            });
            let transfer = response?.data?.[0];
            if (!transfer && depositAddress) {
              let created_at = moment().utc();
              const evm_chains = chains?.[environment]?.evm || [];
              const cosmos_chains = chains?.[environment]?.cosmos?.filter(c => c?.id !== 'axelarnet') || [];
              const _assets = assets?.[environment] || [];
              if (txHash.startsWith('0x')) {
                if (evm_chains.length > 0) {
                  const chains_rpc = Object.fromEntries(evm_chains.map(c => [c?.id, c?.provider_params?.[0]?.rpcUrls || []]));
                  for (let i = 0; i < evm_chains.length; i++) {
                    const chain_data = evm_chains[i];
                    if (!sourceChain || equals_ignore_case(chain_data?.id, sourceChain)) {
                      const rpcs = chains_rpc[chain_data.id];
                      const provider = rpcs.length === 1 ? new JsonRpcProvider(rpcs[0]) : new FallbackProvider(rpcs.map((url, i) => {
                        return {
                          provider: new JsonRpcProvider(url),
                          priority: i + 1,
                          stallTimeout: 1000,
                        };
                      }));
                      try {
                        // request rpc
                        const transaction = await provider.getTransaction(txHash);
                        const height = transaction?.blockNumber;
                        if (height) {
                          const block_timestamp = await getBlockTime(provider, height);
                          if (block_timestamp) {
                            created_at = block_timestamp * 1000;
                          }
                          const transfer_source = {
                            id: txHash,
                            type: 'evm_transfer',
                            status_code: 0,
                            status: 'success',
                            height,
                            created_at: get_granularity(created_at),
                            sender_chain: chain_data.id,
                            sender_address: transaction.from,
                            recipient_address: depositAddress,
                            amount: BigNumber.from(`0x${transaction.data?.substring(10 + 64) || transaction.input?.substring(10 + 64) || '0'}`).toString(),
                            denom: _assets?.find(a => a?.contracts?.findIndex(c => equals_ignore_case(c?.contract_address, transaction.to)) > -1)?.id,
                          };
                          // get link
                          query = {
                            match: {
                              deposit_address: transfer_source.recipient_address,
                            },
                          };
                          _response = await crud({
                            collection: 'deposit_addresses',
                            method: 'search',
                            query,
                            size: 1,
                          });
                          const link = _response?.data?.[0];
                          if (link) {
                            transfer_source.recipient_chain = normalize_chain(link.recipient_chain || transfer_source.recipient_chain);
                            transfer_source.denom = transfer_source.denom || link.asset;
                            if (transfer_source.denom) {
                              const asset_data = _assets.find(a => equals_ignore_case(a?.id, transfer_source.denom));
                              const decimals = asset_data?.contracts?.find(c => c?.chain_id === chain_data?.chain_id)?.decimals || asset_data?.decimals;
                              transfer_source.amount = Number(utils.formatUnits(BigNumber.from(transfer_source.amount).toString(), decimals));
                            }
                            if (link?.price && typeof transfer_source.amount === 'number') {
                              transfer_source.value = transfer_source.amount * link.price;
                            }
                            await crud({
                              collection: 'transfers',
                              method: 'set',
                              path: `/transfers/_update/${transfer_source.id}`,
                              id: transfer_source.id,
                              source: transfer_source,
                            });
                          }
                          transfer = {
                            source: transfer_source,
                            link,
                          };
                          break;
                        }
                      } catch (error) {}
                    }
                  }
                }
              }
              else if (cosmos_chains.length > 0) {
                for (let i = 0; i < cosmos_chains.length; i++) {
                  const chain_data = cosmos_chains[i];
                  if ((!sourceChain || equals_ignore_case(chain_data?.id, sourceChain)) && chain_data?.endpoints?.lcd) {
                    // initial lcd
                    const lcd = axios.create({ baseURL: chain_data.endpoints.lcd });
                    try {
                      // request lcd
                      let _response = await lcd.get(`/cosmos/tx/v1beta1/txs/${txHash}`)
                        .catch(error => { return { data: { error } }; });
                      const transaction = _response?.data?.tx_response;
                      if (transaction.tx?.body?.messages) {
                        const created_at = moment(transaction.timestamp).utc();
                        const amount_denom = transaction.tx.body.messages.find(m => m?.token)?.token;
                        const transfer_source = {
                          id: transaction.txhash,
                          type: 'ibc_transfer',
                          status_code: transaction.code,
                          status: transaction.code ? 'failed' : 'success',
                          height: Number(transaction.height),
                          created_at: get_granularity(created_at),
                          sender_chain: chain_data.id,
                          sender_address: transaction.tx.body.messages.find(m => m?.sender)?.sender,
                          recipient_address: transaction.tx.body.messages.find(m => m?.receiver)?.receiver,
                          amount: amount_denom?.amount,
                          denom: amount_denom?.denom,
                        };
                        if (transfer_source.recipient_address?.length >= 65 && transfer_source.id && transfer_source.amount) {
                          const query = {
                            match: {
                              deposit_address: transfer_source.recipient_address,
                            },
                          };
                          _response = await crud({
                            collection: 'deposit_addresses',
                            method: 'search',
                            query,
                            size: 1,
                          });
                          const link = _response?.data?.[0];
                          if (link) {
                            transfer_source.recipient_chain = normalize_chain(link.recipient_chain);
                            transfer_source.denom = transfer_source.denom || link.asset;
                            if (transfer_source.denom) {
                              const asset_data = _assets.find(a => equals_ignore_case(a?.id, transfer_source.denom));
                              const decimals = asset_data?.ibc?.find(i => i?.chain_id === chain_data?.id)?.decimals || asset_data?.decimals;
                              transfer_source.amount = Number(utils.formatUnits(BigNumber.from(transfer_source.amount).toString(), decimals));
                            }
                            if (link?.price && typeof transfer_source.amount === 'number') {
                              transfer_source.value = transfer_source.amount * link.price;
                            }
                            await crud({
                              collection: 'transfers',
                              method: 'set',
                              path: `/transfers/_update/${transfer_source.id}`,
                              id: transfer_source.id,
                              source: transfer_source,
                            });
                          }
                          transfer = {
                            source: transfer_source,
                            link,
                          };
                        }
                        break;
                      }
                    } catch (error) {}
                  }
                }
              }
            }
            else if (transfer) {
              const query = {
                match: {
                  deposit_address: transfer.source?.recipient_address || depositAddress,
                },
              };
              const _response = await crud({
                collection: 'deposit_addresses',
                method: 'search',
                query,
                size: 1,
              });
              const link = _response?.data?.[0];
              transfer = {
                ...transfer,
                link,
              };
            }
            response = [transfer].filter(t => t);
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
            let _response = await crud({
              collection: 'deposit_addresses',
              method: 'search',
              query,
              sort: [{ height: 'desc' }],
              size: 1000,
            });
            const links = _response?.data || [];
            const should = [];
            for (let i = 0; i < links.length; i++) {
              const link = links[i];
              if (link?.deposit_address && should.findIndex(s => equals_ignore_case(s?.match?.['source.recipient_address'], link.deposit_address)) < 0) {
                should.push({ match: { 'source.recipient_address': link.deposit_address } });
              }
            }
            let transfers;
            if (should.length > 0) {
              query = {
                bool: {
                  should,
                },
              };
              _response = await crud({
                collection: 'transfers',
                method: 'search',
                query,
                size: 1000,
              });
              transfers = _response?.data?.filter(t => t).map(t => {
                return {
                  ...t,
                  link: links.find(l => equals_ignore_case(l?.deposit_address, t?.source?.recipient_address)),
                };
              });
              if (!(transfers?.length > 0)) {
                transfers = links?.map(l => { return { link: l } });
              }
            }
            response = transfers || [];
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