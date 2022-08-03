exports.handler = async (event, context, callback) => {
  // import module for http request
  const axios = require('axios');
  // import ethers.js
  const {
    BigNumber,
    Contract,
    providers: { FallbackProvider, JsonRpcProvider },
    utils: { formatUnits },
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
  // import tvl
  const {
    getContractSupply,
    getBalance,
  } = require('./services/tvl');
  // import utils
  const { log, sleep, equals_ignore_case, get_params, to_json, to_hex, get_granularity, normalize_original_chain, normalize_chain, transfer_actions, vote_types, getTransaction, getBlockTime } = require('./utils');
  // data
  const { chains, assets } = require('./data');
  // IAxelarGateway
  const IAxelarGateway = require('./data/contracts/interfaces/IAxelarGateway.json');
  // IBurnableMintableCappedERC20
  const IBurnableMintableCappedERC20 = require('./data/contracts/interfaces/IBurnableMintableCappedERC20.json');

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
              else if (messages.findIndex(m => m?.['@type']?.includes('ConfirmDepositRequest')) > -1 || messages.findIndex(m => m?.['@type']?.includes('ConfirmTransferKeyRequest')) > -1) {
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
              else if (messages.findIndex(m => m?.['@type']?.includes('VoteRequest') || m?.inner_message?.['@type']?.includes('VoteRequest')) > -1) {
                const byte_array_fields = ['tx_id', 'to', 'sender', 'payload_hash', 'pre_operators', 'new_operators'];
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
                      for (let k = 0; k < byte_array_fields.length; k++) {
                        const field = byte_array_fields[k];
                        if (Array.isArray(event?.[field])) {
                          event[field] = to_hex(event[field]);
                        }
                        else if (Array.isArray(event.transfer?.[field])) {
                          event.transfer[field] = to_hex(event.transfer[field]);
                        }
                        else if (Array.isArray(event?.contract_call?.[field])) {
                          event.contract_call[field] = to_hex(event.contract_call[field]);
                        }
                        else if (Array.isArray(event?.contract_call_with_token?.[field])) {
                          event.contract_call_with_token[field] = to_hex(event.contract_call_with_token[field]);
                        }
                        else if (Array.isArray(event?.multisig_operatorship_transferred?.[field])) {
                          event.multisig_operatorship_transferred[field] = to_hex(event.multisig_operatorship_transferred[field]);
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
            res.data.tx_response.tx = res.data.tx;

            // index addresses & message type
            const address_fields = ['signer', 'sender', 'recipient', 'spender', 'receiver', 'depositAddress', 'voter', 'delegator_address'];
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
                if (equals_ignore_case(sender_chain, 'axelarnet')) {
                  const chain_data = cosmos_chains.find(c => record.sender_address?.startsWith(c?.prefix_address));
                  if (chain_data) {
                    record.sender_chain = _.last(Object.keys({ ...chain_data.overrides })) || chain_data.id;
                  }
                }
                record.original_sender_chain = normalize_original_chain(record.sender_chain);
                record.original_recipient_chain = normalize_original_chain(record.recipient_chain);
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
                    chain: record.original_sender_chain,
                    denom: record.asset || record.denom,
                    timestamp: created_at.valueOf(),
                  });
                  if (prices_data?.[0]?.price) {
                    record.price = prices_data[0].price;
                  }
                  else {
                    const _response = await crud({
                      collection: 'deposit_addresses',
                      method: 'get',
                      id: record.id,
                    });
                    if (_response?.price) {
                      record.price = _response.price;
                    }
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
                  sender_chain: 'axelarnet',
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
                  if (link && !link.price) {
                    const prices_data = await assets_price({
                      chain: link.original_sender_chain,
                      denom: link.asset || link.denom,
                      timestamp: record.created_at?.ms,
                    });
                    if (prices_data?.[0]?.price) {
                      link.price = prices_data[0].price;
                      await crud({
                        collection: 'deposit_addresses',
                        method: 'set',
                        path: `/deposit_addresses/_update/${link.id}`,
                        ...link,
                      });
                    }
                  }
                  if (link) {
                    record.sender_chain = link.sender_chain || record.sender_chain;
                    record.recipient_chain = link.recipient_chain || record.recipient_chain;
                    record.denom = record.denom || link.asset;
                  }
                  record.original_sender_chain = link?.original_sender_chain || normalize_original_chain(record.sender_chain || link?.sender_chain);
                  record.original_recipient_chain = link?.original_recipient_chain || normalize_original_chain(record.recipient_chain || link?.recipient_chain);
                  if (record.denom) {
                    const asset_data = _assets.find(a => equals_ignore_case(a?.id, record.denom) || a?.ibc?.findIndex(i => i?.chain_id === 'axelarnet' && equals_ignore_case(i?.ibc_denom, record.denom)) > -1);
                    if (asset_data) {
                      const decimals = asset_data?.ibc?.find(i => i?.chain_id === 'axelarnet')?.decimals || asset_data?.decimals || 6;
                      const response_fee = await lcd.get('/axelar/nexus/v1beta1/transfer_fee', {
                        params: {
                          source_chain: record.original_sender_chain,
                          destination_chain: record.original_recipient_chain,
                          amount: `${record.amount}${asset_data.id}`,
                        },
                      }).catch(error => { return { data: { error } }; });
                      if (response_fee?.data?.fee?.amount) {
                        record.fee = Number(formatUnits(BigNumber.from(response_fee.data.fee.amount).toString(), decimals));
                      }
                      record.amount = Number(formatUnits(BigNumber.from(record.amount).toString(), decimals));
                      if (record.fee) {
                        if (record.amount < record.fee) {
                          record.insufficient_fee = true;
                        }
                        else {
                          record.amount_received = record.amount - record.fee;
                        }
                      }
                      record.denom = asset_data?.id || record.denom;
                    }
                  }
                  if (link?.price && typeof record.amount === 'number') {
                    record.value = record.amount * link.price;
                  }
                  const _id = `${record.id}_${record.recipient_address}`.toLowerCase();
                  const params = {
                    collection: 'transfers',
                    method: 'set',
                    path: `/transfers/_update/${_id}`,
                    id: _id,
                    source: record,
                  };
                  if (link) {
                    params.link = link;
                  }
                  await crud(params);
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
                        let found = false;
                        const lcds = _.concat([chain_data.endpoints.lcd], chain_data.endpoints.lcds || []);
                        for (let k = 0; k < lcds.length; k++) {
                          // initial lcd
                          const _lcd = axios.create({ baseURL: lcds[k] });
                          // request lcd
                          const _response = await _lcd.get(`/cosmos/tx/v1beta1/txs?limit=5&events=${encodeURIComponent(`send_packet.packet_data_hex='${packet_data_hex}'`)}&events=tx.height=${_height}`)
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
                                if (link && !link.price) {
                                  const prices_data = await assets_price({
                                    chain: link.original_sender_chain,
                                    denom: link.asset || link.denom,
                                    timestamp: record.created_at?.ms,
                                  });
                                  if (prices_data?.[0]?.price) {
                                    link.price = prices_data[0].price;
                                    await crud({
                                      collection: 'deposit_addresses',
                                      method: 'set',
                                      path: `/deposit_addresses/_update/${link.id}`,
                                      ...link,
                                    });
                                  }
                                }
                                if (link) {
                                  record.recipient_chain = link.recipient_chain;
                                  record.denom = record.denom || link.asset;
                                }
                                if (equals_ignore_case(link?.original_sender_chain, 'axelarnet')) {
                                  const chain_data = cosmos_chains.find(c => record.sender_address?.startsWith(c?.prefix_address));
                                  if (chain_data) {
                                    link.original_sender_chain = _.last(Object.keys({ ...chain_data.overrides })) || chain_data.id;
                                  }
                                }
                                record.original_sender_chain = link?.original_sender_chain || normalize_original_chain(record.sender_chain || link?.sender_chain);
                                record.original_recipient_chain = link?.original_recipient_chain || normalize_original_chain(record.recipient_chain || link?.recipient_chain);
                                if (record.denom) {
                                  const asset_data = _assets.find(a => equals_ignore_case(a?.id, record.denom) || a?.ibc?.findIndex(i => i?.chain_id === chain_data.id && equals_ignore_case(i?.ibc_denom, record.denom)) > -1);
                                  if (asset_data) {
                                    const decimals = asset_data?.ibc?.find(i => i?.chain_id === chain_data.id)?.decimals || asset_data?.decimals || 6;
                                    const response_fee = await lcd.get('/axelar/nexus/v1beta1/transfer_fee', {
                                      params: {
                                        source_chain: record.original_sender_chain,
                                        destination_chain: record.original_recipient_chain,
                                        amount: `${record.amount}${asset_data.id}`,
                                      },
                                    }).catch(error => { return { data: { error } }; });
                                    if (response_fee?.data?.fee?.amount) {
                                      record.fee = Number(formatUnits(BigNumber.from(response_fee.data.fee.amount).toString(), decimals));
                                    }
                                    record.amount = Number(formatUnits(BigNumber.from(record.amount).toString(), decimals));
                                    if (record.fee) {
                                      if (record.amount < record.fee) {
                                        record.insufficient_fee = true;
                                      }
                                      else {
                                        record.amount_received = record.amount - record.fee;
                                      }
                                    }
                                    record.denom = asset_data?.id || record.denom;
                                  }
                                }
                                if (link?.price && typeof record.amount === 'number') {
                                  record.value = record.amount * link.price;
                                }
                                const _id = `${record.id}_${record.recipient_address}`.toLowerCase();
                                const params = {
                                  collection: 'transfers',
                                  method: 'set',
                                  path: `/transfers/_update/${_id}`,
                                  id: _id,
                                  source: record,
                                };
                                if (link) {
                                  params.link = link;
                                }
                                await crud(params);
                                found = true;
                                break;
                              }
                            }
                          }
                        }
                        if (found) {
                          break;
                        }
                      }
                    }
                  }
                }
              }
              // RouteIBCTransfersRequest -> ibc_send
              else if (messages.findIndex(m => _.last(m?.['@type']?.split('.')) === 'RouteIBCTransfersRequest') > -1) {
                const event_send_packets = logs.map(l => l?.events?.find(e => e?.type === 'send_packet')).filter(e => e?.attributes?.length > 0).flatMap(e => {
                  let {
                    attributes,
                  } = { ...e };
                  attributes = attributes.filter(a => a?.key && a.value);
                  const events = [];
                  let event;
                  attributes.forEach((a, i) => {
                    if (['packet_data'].includes(a.key) || i === attributes.length - 1) {
                      if (event) {
                        events.push(event);
                      }
                      event = {};
                    }
                    event = {
                      ...event,
                      [a.key]: ['packet_data'].includes(a.key) ? to_json(a.value) : a.value,
                    };
                  });
                  return events;
                }).filter(e => e.packet_data?.amount).map(e => {
                  const { packet_data } = { ...e };
                  const { sender, receiver, amount, denom } = { ...packet_data };
                  const created_at = moment(tx_response.timestamp).utc();
                  const asset_data = _assets.find(a => equals_ignore_case(a?.id, denom) || a?.ibc?.findIndex(i => i?.chain_id === 'axelarnet' && equals_ignore_case(i?.ibc_denom, denom)) > -1);
                  const decimals = asset_data?.ibc?.find(i => i?.chain_id === 'axelarnet')?.decimals || asset_data?.decimals || 6;
                  const record = {
                    id: tx_response.txhash,
                    type: 'RouteIBCTransfersRequest',
                    status_code: tx_response.code,
                    status: tx_response.code ? 'failed' : 'success',
                    height: Number(tx_response.height),
                    created_at: get_granularity(created_at),
                    sender_address: sender,
                    recipient_address: receiver,
                    amount: Number(formatUnits(BigNumber.from(amount).toString(), decimals)),
                    denom,
                    packet: e,
                  };
                  return record;
                });
                for (let i = 0; i < event_send_packets.length; i++) {
                  const record = event_send_packets[i];
                  let query = {
                    bool: {
                      must: [
                        { match: { 'ibc_send.id': record.id } },
                        { match: { 'ibc_send.recipient_address': record.recipient_address } },
                        { match: { 'ibc_send.denom': record.denom } },
                      ],
                    },
                  };
                  let response = await crud({
                    collection: 'transfers',
                    method: 'search',
                    query,
                    size: 1,
                  });
                  if (response?.data?.filter(d => typeof d?.source?.amount_received === 'number').length < 1) {
                    query = {
                      bool: {
                        must: [
                          { match: { 'source.status_code': 0 } },
                          { match: { 'link.recipient_address': record.recipient_address } },
                          { range: { 'source.created_at.ms': { lte: record.created_at.ms, gte: moment(record.created_at.ms).subtract(24, 'hours').valueOf() } } },
                          { range: { 'source.amount': { gte: Math.floor(record.amount) } } },
                          {
                            bool: {
                              should: [
                                { match: { 'source.amount_received': record.amount } },
                                {
                                  bool: {
                                    must: [
                                      { range: { 'source.amount': { lte: Math.ceil(record.amount * 2) } } },
                                    ],
                                    must_not: [
                                      { exists: { field: 'source.amount_received' } },
                                    ],
                                  },
                                },
                              ],
                              minimum_should_match: 1,
                            },
                          },
                          { match: { 'source.denom': record.denom } },
                        ],
                        should: [
                          { exists: { field: 'confirm_deposit' } },
                          { exists: { field: 'vote' } },
                        ],
                        minimum_should_match: 1,
                        must_not: [
                          { exists: { field: 'ibc_send' } },
                        ],
                      },
                    };
                    response = await crud({
                      collection: 'transfers',
                      method: 'search',
                      query,
                      sort: [{ 'source.created_at.ms': 'asc' }],
                      size: 1,
                    });
                    if (response?.data?.length > 0) {
                      const { source } = { ...response.data[0] };
                      const { id, recipient_address } = { ...source };
                      const _id = `${id}_${recipient_address}`.toLowerCase();
                      const params = {
                        collection: 'transfers',
                        method: 'set',
                        path: `/transfers/_update/${_id}`,
                        id: _id,
                        ibc_send: record,
                      };
                      await crud(params);
                    }
                  }
                  else {
                    const data = response.data[0];
                    if (!_.isEqual(data.ibc_send, record)) {
                      const { source } = { ...data };
                      const { id, recipient_address } = { ...source };
                      const _id = `${id}_${recipient_address}`.toLowerCase();
                      const params = {
                        collection: 'transfers',
                        method: 'set',
                        path: `/transfers/_update/${_id}`,
                        id: _id,
                        ibc_send: record,
                      };
                      await crud(params);
                    }
                  }
                }
              }
              // MsgAcknowledgement -> ibc_ack
              else if (messages.findIndex(m => _.last(m?.['@type']?.split('.')) === 'MsgAcknowledgement') > -1) {
                const event_ack_packets = logs.map(l => l?.events?.find(e => e?.type === 'acknowledge_packet')).filter(e => e?.attributes?.length > 0).map(e => {
                  const { attributes } = { ...e };
                  return Object.fromEntries(attributes.filter(a => a?.key && a.value).map(a => [a.key, a.value]));
                }).filter(e => e.packet_sequence).map(e => {
                  return {
                    ...e,
                    id: tx_response.txhash,
                    height: Number(messages.find(m => _.last(m?.['@type']?.split('.')) === 'MsgAcknowledgement')?.proof_height?.revision_height || '0') - 1,
                  };
                });
                for (let i = 0; i < event_ack_packets.length; i++) {
                  const record = event_ack_packets[i];
                  const query = {
                    bool: {
                      must: [
                        { match: { 'ibc_send.packet.packet_timeout_height': record.packet_timeout_height } },
                        { match: { 'ibc_send.packet.packet_sequence': record.packet_sequence } },
                        { match: { 'ibc_send.packet.packet_src_channel': record.packet_src_channel } },
                        { match: { 'ibc_send.packet.packet_dst_channel': record.packet_dst_channel } },
                        { match: { 'ibc_send.packet.packet_connection': record.packet_connection } },
                      ],
                      should: [
                        { match: { 'ibc_send.ack_txhash': record.id } },
                        {
                          bool: {
                            must_not: [
                              { exists: { field: 'ibc_send.ack_txhash' } },
                            ],
                          },
                        },
                      ],
                      minimum_should_match: 1,
                    },
                  };
                  const response = await crud({
                    collection: 'transfers',
                    method: 'search',
                    query,
                    sort: [{ 'source.created_at.ms': 'asc' }],
                    size: 1,
                  });
                  if (response?.data?.length > 0) {
                    const { source, link, ibc_send } = { ...response.data[0] };
                    const { id, recipient_address } = { ...source };
                    const _id = `${id}_${recipient_address}`.toLowerCase();
                    const params = {
                      collection: 'transfers',
                      method: 'set',
                      path: `/transfers/_update/${_id}`,
                      id: _id,
                      ibc_send: {
                        ...ibc_send,
                        ack_txhash: record.id,
                      },
                    };
                    await crud(params);
                    if (record.height && ibc_send?.packet?.packet_data_hex && (source?.recipient_chain || link?.recipient_chain)) {
                      const recipient_chain = source?.recipient_chain || link?.recipient_chain;
                      const chain_data = cosmos_chains.find(c => equals_ignore_case(c?.id, recipient_chain));
                      if (chain_data?.endpoints?.lcd) {
                        const lcds = _.concat([chain_data.endpoints.lcd], chain_data.endpoints.lcds || []);
                        for (let k = 0; k < lcds.length; k++) {
                          // initial lcd
                          const _lcd = axios.create({ baseURL: lcds[k] });
                          // request lcd
                          const _response = await _lcd.get(`/cosmos/tx/v1beta1/txs?limit=5&events=${encodeURIComponent(`recv_packet.packet_data_hex='${ibc_send.packet.packet_data_hex}'`)}&events=tx.height=${record.height}`)
                            .catch(error => { return { data: { error } }; });
                          const tx_index = _response?.data?.tx_responses?.findIndex(t => {
                            const event_recv_packet = _.head(t?.logs.flatMap(l => l?.events?.filter(e => e?.type === 'recv_packet')));
                            const _packet_sequence = event_recv_packet?.attributes?.find(a => a?.key === 'packet_sequence' && a.value)?.value;
                            return ibc_send.packet.packet_sequence === _packet_sequence;
                          });
                          if (tx_index > -1) {
                            const txHash = _response.data.tx_responses[tx_index].txhash;
                            if (txHash) {
                              const params = {
                                collection: 'transfers',
                                method: 'set',
                                path: `/transfers/_update/${_id}`,
                                id: _id,
                                ibc_send: {
                                  ...ibc_send,
                                  ack_txhash: record.id,
                                  recv_txhash: txHash,
                                },
                              };
                              const x = await crud(params);
                            }
                            break;
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
                let created_at = moment(tx_response.timestamp).utc();
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
                            const _id = `${transfer_source.id}_${transfer_source.recipient_address}`.toLowerCase();
                            const params = {
                              collection: 'transfers',
                              method: 'set',
                              path: `/transfers/_update/${_id}`,
                              id: _id,
                              confirm_deposit: record,
                            };
                            if (sign_batch) {
                              params.sign_batch = sign_batch;
                            }
                            if (transfer_source) {
                              transfer_source.sender_chain = normalize_chain(cosmos_chains.find(c => transfer_source.sender_address?.startsWith(c?.prefix_address))?.id || record.sender_chain);
                              transfer_source.recipient_chain = transfer_source.recipient_chain || record.recipient_chain;
                              transfer_source.original_sender_chain = link?.original_sender_chain || normalize_original_chain(transfer_source.sender_chain || link?.sender_chain);
                              transfer_source.original_recipient_chain = link?.original_recipient_chain || normalize_original_chain(transfer_source.recipient_chain || link?.recipient_chain);
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
                              const _id = `${transfer_source.id}_${transfer_source.recipient_address}`.toLowerCase();
                              const params = {
                                collection: 'transfers',
                                method: 'set',
                                path: `/transfers/_update/${_id}`,
                                id: _id,
                                sign_batch,
                              };
                              if (transfer_source) {
                                transfer_source.sender_chain = normalize_chain(cosmos_chains.find(c => transfer_source.sender_address?.startsWith(c?.prefix_address))?.id || record.sender_chain);
                                transfer_source.recipient_chain = transfer_source.recipient_chain || record.recipient_chain;
                                transfer_source.original_sender_chain = link?.original_sender_chain || normalize_original_chain(transfer_source.sender_chain || link?.sender_chain);
                                transfer_source.original_recipient_chain = link?.original_recipient_chain || normalize_original_chain(transfer_source.recipient_chain || link?.recipient_chain);
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
                              const block_timestamp = await getBlockTime(provider, height);
                              if (block_timestamp) {
                                created_at = block_timestamp * 1000;
                              }
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
                              if (link && !link.price) {
                                const prices_data = await assets_price({
                                  chain: link.original_sender_chain,
                                  denom: link.asset || link.denom,
                                  timestamp: transfer_source.created_at?.ms,
                                });
                                if (prices_data?.[0]?.price) {
                                  link.price = prices_data[0].price;
                                  await crud({
                                    collection: 'deposit_addresses',
                                    method: 'set',
                                    path: `/deposit_addresses/_update/${link.id}`,
                                    ...link,
                                  });
                                }
                              }
                              if (link) {
                                transfer_source.sender_chain = link.sender_chain || transfer_source.sender_chain;
                                transfer_source.recipient_chain = link.recipient_chain || transfer_source.recipient_chain;
                                transfer_source.denom = transfer_source.denom || link.asset;
                              }
                              transfer_source.original_sender_chain = link?.original_sender_chain || normalize_original_chain(transfer_source.sender_chain || link?.sender_chain);
                              transfer_source.original_recipient_chain = link?.original_recipient_chain || normalize_original_chain(transfer_source.recipient_chain || link?.recipient_chain);
                              if (transfer_source.denom && typeof transfer_source.amount === 'string') {
                                const asset_data = _assets.find(a => equals_ignore_case(a?.id, transfer_source.denom));
                                if (asset_data) {
                                  const decimals = asset_data?.contracts?.find(c => c?.chain_id === chain_data?.chain_id)?.decimals || asset_data?.decimals || 6;
                                  const response_fee = await lcd.get('/axelar/nexus/v1beta1/transfer_fee', {
                                    params: {
                                      source_chain: transfer_source.original_sender_chain,
                                      destination_chain: transfer_source.original_recipient_chain,
                                      amount: `${transfer_source.amount}${asset_data.id}`,
                                    },
                                  }).catch(error => { return { data: { error } }; });
                                  if (response_fee?.data?.fee?.amount) {
                                    transfer_source.fee = Number(formatUnits(BigNumber.from(response_fee.data.fee.amount).toString(), decimals));
                                  }
                                  transfer_source.amount = Number(formatUnits(BigNumber.from(transfer_source.amount).toString(), decimals));
                                  if (transfer_source.fee) {
                                    if (transfer_source.amount < transfer_source.fee) {
                                      transfer_source.insufficient_fee = true;
                                    }
                                    else {
                                      transfer_source.amount_received = transfer_source.amount - transfer_source.fee;
                                    }
                                  }
                                }
                              }
                              if (link?.price && typeof transfer_source.amount === 'number') {
                                transfer_source.value = transfer_source.amount * link.price;
                              }
                              const _id = `${transfer_source.id}_${transfer_source.recipient_address}`.toLowerCase();
                              const params = {
                                collection: 'transfers',
                                method: 'set',
                                path: `/transfers/_update/${_id}`,
                                id: _id,
                                source: transfer_source,
                                confirm_deposit: record,
                              };
                              if (link) {
                                params.link = link;
                              }
                              await crud(params);
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
                    let sender_chain, vote, confirmation, late;
                    switch (type) {
                      case 'VoteConfirmDeposit':
                        sender_chain = normalize_chain(message?.inner_message?.chain || event?.attributes?.find(a => ['sourceChain', 'chain'].includes(a?.key) && a.value)?.value);
                        vote = message?.inner_message?.confirmed || false;
                        confirmation = event?.attributes?.findIndex(a => a?.key === 'action' && a.value === 'confirm') > -1;
                        break;
                      case 'Vote':
                        sender_chain = normalize_chain(message?.inner_message?.vote?.results?.[0]?.chain || message?.inner_message?.vote?.result?.chain || evm_chains.find(c => poll_id?.startsWith(`${c?.id}_`))?.id);
                        const vote_results = message?.inner_message?.vote?.results || message?.inner_message?.vote?.result?.events;
                        vote = (Array.isArray(vote_results) ? vote_results : Object.keys({ ...vote_results })).length > 0;
                        const vote_has_enum_status = Array.isArray(vote_results) && vote_results.findIndex(v => v?.status) > -1;
                        confirmation = !!event || (event_vote && vote_has_enum_status && vote_results.findIndex(v => ['STATUS_COMPLETED'].includes(v?.status)) > -1);
                        late = !event_vote && ((!vote && Array.isArray(vote_results)) || (vote_has_enum_status && vote_results.findIndex(v => ['STATUS_UNSPECIFIED', 'STATUS_COMPLETED'].includes(v?.status)) > -1));
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
                      late,
                      unconfirmed: logs?.findIndex(l => l?.log?.startsWith('not enough votes')) > -1,
                    };
                    if (!record.status_code) {
                      if (!record.sender_chain && record.deposit_address) {
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
                      if (!record.sender_chain && record.poll_id) {
                        const _response = await crud({
                          collection: 'evm_polls',
                          method: 'get',
                          id: record.poll_id,
                        });
                        const poll = _response;
                        if (poll?.sender_chain) {
                          record.sender_chain = poll.sender_chain;
                        }
                      }
                      if (record.poll_id) {
                        if (record.id && record.vote && (record.confirmation || !record.unconfirmed)) {
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
                            const { sender_chain, recipient_chain, deposit_address, transaction_id, poll_id } = { ...record };
                            let { created_at } = { ...record };
                            if (transaction_id) {
                              const transaction = await provider.getTransaction(transaction_id);
                              const height = transaction?.blockNumber;
                              if (height) {
                                record.amount = BigNumber.from(`0x${transaction.data?.substring(10 + 64) || transaction.input?.substring(10 + 64) || '0'}`).toString() || _.last(poll_id?.split('_'));
                                const denom = _assets?.find(a => a?.contracts?.findIndex(c => c?.chain_id === chain_data?.chain_id && equals_ignore_case(c?.contract_address, transaction.to)) > -1)?.id;
                                if (denom) {
                                  const block_timestamp = await getBlockTime(provider, height);
                                  if (block_timestamp) {
                                    created_at = get_granularity(block_timestamp * 1000);
                                  }
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
                                  if (link && !link.price) {
                                    const prices_data = await assets_price({
                                      chain: link.original_sender_chain,
                                      denom: link.asset || link.denom,
                                      timestamp: transfer_source.created_at?.ms,
                                    });
                                    if (prices_data?.[0]?.price) {
                                      link.price = prices_data[0].price;
                                      await crud({
                                        collection: 'deposit_addresses',
                                        method: 'set',
                                        path: `/deposit_addresses/_update/${link.id}`,
                                        ...link,
                                      });
                                    }
                                  }
                                  if (link) {
                                    transfer_source.sender_chain = link.sender_chain || transfer_source.sender_chain;
                                    transfer_source.recipient_chain = link.recipient_chain || transfer_source.recipient_chain;
                                    transfer_source.denom = transfer_source.denom || link.asset;
                                  }
                                  transfer_source.original_sender_chain = link?.original_sender_chain || normalize_original_chain(transfer_source.sender_chain || link?.sender_chain);
                                  transfer_source.original_recipient_chain = link?.original_recipient_chain || normalize_original_chain(transfer_source.recipient_chain || link?.recipient_chain);
                                  if (transfer_source.denom && typeof transfer_source.amount === 'string') {
                                    const asset_data = _assets.find(a => equals_ignore_case(a?.id, transfer_source.denom));
                                    if (asset_data) {
                                      const decimals = asset_data?.contracts?.find(c => c?.chain_id === chain_data?.chain_id)?.decimals || asset_data?.decimals || 6;
                                      transfer_source.amount = Number(formatUnits(BigNumber.from(transfer_source.amount).toString(), decimals));
                                    }
                                  }
                                  if (link?.price && typeof transfer_source.amount === 'number') {
                                    transfer_source.value = transfer_source.amount * link.price;
                                  }
                                  await sleep(0.5 * 1000);
                                  _response = await crud({
                                    collection: 'transfers',
                                    method: 'search',
                                    query: {
                                      bool: {
                                        must: [
                                          { match: { 'source.id': transaction_id } },
                                          { match: { 'source.recipient_address': deposit_address } },
                                        ],
                                      },
                                    },
                                    size: 1,
                                  });
                                  const transfer_confirm_deposit = _response?.data?.[0]?.confirm_deposit;
                                  const _id = `${transfer_source.id}_${transfer_source.recipient_address}`.toLowerCase();
                                  const params = {
                                    collection: 'transfers',
                                    method: 'set',
                                    path: `/transfers/_update/${_id}`,
                                    id: _id,
                                    source: transfer_source,
                                    vote: record,
                                  };
                                  if (transfer_confirm_deposit) {
                                    params.confirm_deposit = transfer_confirm_deposit;
                                  }
                                  if (link) {
                                    params.link = link;
                                  }
                                  await crud(params);
                                }
                              }
                            }
                          } catch (error) {}
                        }
                        if (record.voter) {
                          const { id, height, created_at, sender_chain, poll_id, transaction_id, voter, vote, confirmation, late, unconfirmed } = { ...record };
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
                            late,
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
              const {
                tx_responses,
                txs,
              } = { ...res.data };
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
              records = tx_responses.filter(t => !t?.code && t?.tx?.body?.messages?.findIndex(m => m?.['@type']?.includes('LinkRequest')) > -1).map(t => {
                const { logs } = { ...t };
                const { messages } = { ...t?.tx?.body };
                const event = _.head(logs?.flatMap(l => l?.events?.filter(e => e?.type === 'link')));
                const sender_chain = event?.attributes?.find(a => a?.key === 'sourceChain' && a.value)?.value;
                const deposit_address = event?.attributes?.find(a => a?.key === 'depositAddress' && a.value)?.value;
                const record = {
                  ...messages[0],
                  txhash: t.txhash,
                  height: Number(t.height),
                  created_at: get_granularity(moment(t.timestamp).utc()),
                  sender_chain,
                  deposit_address,
                };
                if (equals_ignore_case(sender_chain, 'axelarnet')) {
                  const chain_data = cosmos_chains.find(c => record.sender_address?.startsWith(c?.prefix_address));
                  if (chain_data) {
                    sender_chain = _.last(Object.keys({ ...chain_data.overrides })) || chain_data.id;
                  }
                }
                record.original_sender_chain = normalize_original_chain(record.sender_chain);
                record.original_recipient_chain = normalize_original_chain(record.recipient_chain);
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
                return record;
              });
              if (records.length > 0) {
                for (const record of records) {
                  const {
                    id,
                    created_at,
                    original_sender_chain,
                    asset,
                    denom,
                  } = { ...record };
                  if (asset || denom) {
                    const prices_data = await assets_price({
                      chain: original_sender_chain,
                      denom: asset || denom,
                      timestamp: created_at?.ms,
                    });
                    if (prices_data?.[0]?.price) {
                      record.price = prices_data[0].price;
                    }
                    else {
                      const _response = await crud({
                        collection: 'deposit_addresses',
                        method: 'get',
                        id,
                      });
                      if (_response?.price) {
                        record.price = _response.price;
                      }
                    }
                  }
                  crud({
                    collection: 'deposit_addresses',
                    method: 'set',
                    ...record,
                  });
                }
              }
              // VoteConfirmDeposit & Vote
              records = tx_responses.filter(t => !t?.code && t.tx?.body?.messages?.findIndex(m => vote_types.includes(_.last(m?.inner_message?.['@type']?.split('.'))?.replace('Request', ''))) > -1).map(t => {
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
                    let sender_chain, vote, confirmation, late;
                    switch (type) {
                      case 'VoteConfirmDeposit':
                        sender_chain = normalize_chain(message?.inner_message?.chain || event?.attributes?.find(a => ['sourceChain', 'chain'].includes(a?.key) && a.value)?.value);
                        vote = message?.inner_message?.confirmed || false;
                        confirmation = event?.attributes?.findIndex(a => a?.key === 'action' && a.value === 'confirm') > -1;
                        break;
                      case 'Vote':
                        sender_chain = normalize_chain(message?.inner_message?.vote?.results?.[0]?.chain || message?.inner_message?.vote?.result?.chain || evm_chains.find(c => poll_id?.startsWith(`${c?.id}_`))?.id);
                        const vote_results = message?.inner_message?.vote?.results || message?.inner_message?.vote?.result?.events;
                        vote = (Array.isArray(vote_results) ? vote_results : Object.keys({ ...vote_results })).length > 0;
                        const vote_has_enum_status = Array.isArray(vote_results) && vote_results.findIndex(v => v?.status) > -1;
                        confirmation = !!event || (event_vote && vote_has_enum_status && vote_results.findIndex(v => ['STATUS_COMPLETED'].includes(v?.status)) > -1);
                        late = !event_vote && ((!vote && Array.isArray(vote_results)) || (vote_has_enum_status && vote_results.findIndex(v => ['STATUS_UNSPECIFIED', 'STATUS_COMPLETED'].includes(v?.status)) > -1));
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
                      late,
                      unconfirmed: logs?.findIndex(l => l?.log?.startsWith('not enough votes')) > -1,
                    };
                    _records.push(record);
                  }
                }
                return _records;
              }).flatMap(r => r).filter(r => r?.poll_id && r.voter);
              if (records.length > 0) {
                await sleep(1 * 1000);
                for (const record of records) {
                  const {
                    id,
                    status_code,
                    height,
                    created_at,
                    deposit_address,
                    poll_id,
                    transaction_id,
                    voter,
                    vote,
                    confirmation,
                    late,
                    unconfirmed,
                  } = { ...record };
                  let {
                    sender_chain,
                  } = { ...record };
                  if (!status_code) {
                    if (!sender_chain && deposit_address) {
                      const query = {
                        bool: {
                          must: [
                            { match: { deposit_address } },
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
                        sender_chain = link.sender_chain;
                      }
                    }
                    if (!sender_chain && poll_id) {
                      const _response = await crud({
                        collection: 'evm_polls',
                        method: 'get',
                        id: poll_id,
                      });
                      const poll = _response;
                      if (poll?.sender_chain) {
                        sender_chain = poll.sender_chain;
                      }
                    }
                  }
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
                    late,
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
              // RouteIBCTransfersRequest
              records = tx_responses.filter(t => !t?.code && t.tx?.body?.messages?.findIndex(m => m?.['@type']?.includes('RouteIBCTransfersRequest')) > -1).map(t => t.txhash);
              if (records.length > 0) {
                // initial api
                const api = axios.create({ baseURL: config[environment].endpoints.api });
                for (const hash of records) {
                  api.post('', {
                    module: 'lcd',
                    path: `/cosmos/tx/v1beta1/txs/${hash}`,
                  }).catch(error => { return { data: { error } }; });
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
                const evm_chains = chains?.[environment]?.evm || [];
                const cosmos_chains = chains?.[environment]?.cosmos?.filter(c => c?.id !== 'axelarnet') || [];
                const _assets = assets?.[environment] || [];
                const chain = params.cmd.split(' ')[4]?.toLowerCase();
                const chains_rpc = Object.fromEntries(evm_chains.map(c => [c?.id, c?.provider_params?.[0]?.rpcUrls || []]));
                const rpcs = chains_rpc[chain];
                const provider = rpcs.length === 1 ? new JsonRpcProvider(rpcs[0]) : new FallbackProvider(rpcs.map((url, i) => {
                  return {
                    provider: new JsonRpcProvider(url),
                    priority: i + 1,
                    stallTimeout: 1000,
                  };
                }));
                const chain_data = evm_chains?.find(c => equals_ignore_case(c?.id, chain));
                const gateway_address = chain_data?.gateway_address;
                const gateway = gateway_address && new Contract(gateway_address, IAxelarGateway.abi, provider);
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
                        const command = to_json(_response?.data?.stdout);
                        if (command) {
                          const { salt } = { ...command.params };
                          if (gateway) {
                            try {
                              command.executed = await gateway.isCommandExecuted(`0x${command_id}`);
                            } catch (error) {}
                          }
                          if (salt) {
                            try {
                              const asset_data = _assets.find(a => a?.contracts?.findIndex(c => c?.chain_id === chain_data?.chain_id && !c?.is_native) > -1);
                              const contract_data = asset_data?.contracts?.find(c => c?.chain_id === chain_data?.chain_id);
                              const { contract_address } = { ...contract_data };
                              const erc20 = contract_address && new Contract(contract_address, IBurnableMintableCappedERC20.abi, provider);
                              if (erc20) {
                                command.deposit_address = await erc20.depositAddress(salt);
                              }
                            } catch (error) {}
                          }
                        }
                        commands.push(command);
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
                    if (gateway) {
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
                              { match: { transfer_id } },
                            ],
                            minimum_should_match: 1,
                          },
                        };
                        const _response = await crud({
                          collection: 'transfers',
                          method: 'search',
                          query,
                          size: 100,
                        });
                        if (_response?.data?.length > 0) {
                          let executed = !!_response.data[0].sign_batch?.executed || output.commands.find(c => c?.id === command_id)?.executed;
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
                            const _id = `${transfer_source.id}_${transfer_source.recipient_address}`.toLowerCase();
                            const params = {
                              collection: 'transfers',
                              method: 'set',
                              path: `/transfers/_update/${_id}`,
                              id: _id,
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
      }

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
      try {
        const evm_chains_data = chains?.[environment]?.evm || [];
        const cosmos_chains_data = chains?.[environment]?.cosmos || [];
        const assets_data = assets?.[environment] || [];

        let _response, data;
        const {
          txHash,
          confirmed,
          state,
          sourceChain,
          destinationChain,
          asset,
          depositAddress,
          senderAddress,
          recipientAddress,
          from,
          size,
          sort,
        } = { ...params };
        let {
          query,
          fromTime,
          toTime,
        } = { ...params };
        switch (req.params.function?.toLowerCase()) {
          case 'transfers':
            const must = [], should = [], must_not = [];
            if (txHash) {
              must.push({ match: { 'source.id': txHash } });
            }
            if (confirmed) {
              switch (confirmed) {
                case 'confirmed':
                  should.push({ exists: { field: 'confirm_deposit' } });
                  should.push({ exists: { field: 'vote' } });
                  break;
                case 'unconfirmed':
                  must_not.push({ exists: { field: 'confirm_deposit' } });
                  must_not.push({ exists: { field: 'vote' } });
                  break;
                default:
                  break;
              }
            }
            if (state) {
              switch (state) {
                case 'completed':
                  should.push({
                    bool: {
                      must: [
                        { exists: { field: 'sign_batch' } },
                      ],
                      should: evm_chains_data?.map(c => {
                        return { match: { 'source.recipient_chain': c?.id } };
                      }) || [],
                      minimum_should_match: 1,
                    },
                  });
                  should.push({
                    bool: {
                      must: [
                        { exists: { field: 'ibc_send' } },
                      ],
                      should: cosmos_chains_data?.map(c => {
                        return { match: { 'source.recipient_chain': c?.id } };
                      }) || [],
                      minimum_should_match: 1,
                    },
                  });
                  should.push({
                    bool: {
                      must: [
                        { match: { 'source.recipient_chain': 'axelarnet' } },
                      ],
                      should: [
                        { exists: { field: 'confirm_deposit' } },
                        { exists: { field: 'vote' } },
                      ],
                      minimum_should_match: 1,
                    },
                  });
                  break
                case 'pending':
                  must_not.push({
                    bool: {
                      should: [
                        {
                          bool: {
                            must: [
                              { exists: { field: 'sign_batch' } },
                            ],
                            should: evm_chains_data?.map(c => {
                              return { match: { 'source.recipient_chain': c?.id } };
                            }) || [],
                            minimum_should_match: 1,
                          },
                        },
                        {
                          bool: {
                            must: [
                              { exists: { field: 'ibc_send' } },
                            ],
                            should: cosmos_chains_data?.map(c => {
                              return { match: { 'source.recipient_chain': c?.id } };
                            }) || [],
                            minimum_should_match: 1,
                          },
                        },
                        {
                          bool: {
                            must: [
                              { match: { 'source.recipient_chain': 'axelarnet' } },
                            ],
                            should: [
                              { exists: { field: 'confirm_deposit' } },
                              { exists: { field: 'vote' } },
                            ],
                            minimum_should_match: 1,
                          },
                        },
                      ],
                    },
                  });
                  break;
                default:
                  break;
              }
            }
            if (sourceChain) {
              must.push({ match: { 'source.sender_chain': sourceChain } });
            }
            if (destinationChain) {
              must.push({ match: { 'source.recipient_chain': destinationChain } });
            }
            if (asset) {
              must.push({ match_phrase: { 'source.denom': asset } });
            }
            if (depositAddress) {
              must.push({ match: { 'source.recipient_address': depositAddress } });
            }
            if (senderAddress) {
              must.push({ match: { 'source.sender_address': senderAddress } });
            }
            if (recipientAddress) {
              must.push({ match: { 'link.recipient_address': recipientAddress } });
            }
            if (fromTime) {
              fromTime = Number(fromTime) * 1000;
              toTime = toTime ? Number(toTime) * 1000 : moment().valueOf();
              must.push({ range: { 'source.created_at.ms': { gte: fromTime, lte: toTime } } });
            }
            if (!query) {
              query = {
                bool: {
                  must,
                  should,
                  must_not,
                  minimum_should_match: should.length > 0 ? 1 : 0,
                },
              };
            }
            const _params = {
              collection: 'transfers',
              method: 'search',
              query,
              from: typeof from === 'number' ? from : 0,
              size: typeof size === 'number' ? size : 100,
              sort: sort || [{ 'source.created_at.ms': 'desc' }],
              track_total_hits: true,
            };
            const __params = _.cloneDeep(_params);
            _response = await crud(_params);
            if (Array.isArray(_response?.data)) {
              const _transfers = _response.data.filter(d => d?.source?.id && (
                !(d.source.recipient_chain && typeof d.source.amount === 'number' && typeof d.source.value === 'number') ||
                cosmos_chains_data.filter(c => !['axelarnet'].includes(c?.id)).findIndex(c => equals_ignore_case(c?.id, d.source.recipient_chain)) > -1 && (d.vote || d.confirm_deposit)
              ));
              if (_transfers.length > 0) {
                try {
                  // initial api
                  const api = axios.create({ baseURL: config[environment].endpoints.api });
                  for (const transfer of _transfers) {
                    api.post('/cross-chain/transfers-status', {
                      txHash: transfer.source.id,
                      sourceChain: transfer.source.sender_chain,
                    }).catch(error => { return { data: { error } }; });
                  }
                  await sleep(5 * 1000);
                  _response = await crud(__params);
                } catch (error) {}
              }
            }
            if (Array.isArray(_response?.data)) {
              _response.data = _response.data.map(d => {
                const {
                  source,
                  link,
                  confirm_deposit,
                  vote,
                  sign_batch,
                  ibc_send,
                } = { ...d };
                const {
                  amount,
                  value,
                } = { ...source };
                let {
                  price,
                } = { ...link };
                if (typeof price !== 'number' && typeof amount === 'number' && typeof value === 'number') {
                  price = value / amount;
                }
                return {
                  ...d,
                  link: link && {
                    ...link,
                    price,
                  },
                  status: ibc_send ?
                    'ibc_sent' :
                    sign_batch?.executed ?
                      'executed' :
                       sign_batch ?
                        'sign_batch' :
                        vote ?
                          'voted' :
                          confirm_deposit ?
                            'deposit_confirmed' :
                            'asset_sent',
                };
              });
            }
            response = _response;
            break;
          case 'transfers-status':
            if (txHash) {
              query = {
                match: {
                  'source.id': txHash,
                },
              };
              _response = await crud({
                collection: 'transfers',
                method: 'search',
                query,
                size: 1,
              });
              let transfer = _response?.data?.[0];
              if (!transfer && depositAddress) {
                let created_at = moment().utc();
                const evm_chains = chains?.[environment]?.evm || [];
                const cosmos_chains = chains?.[environment]?.cosmos?.filter(c => c?.id !== 'axelarnet') || [];
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
                              denom: assets_data?.find(a => a?.contracts?.findIndex(c => equals_ignore_case(c?.contract_address, transaction.to)) > -1)?.id,
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
                            if (link && !link.price) {
                              const prices_data = await assets_price({
                                chain: link.original_sender_chain,
                                denom: link.asset || link.denom,
                                timestamp: transfer_source.created_at?.ms,
                              });
                              if (prices_data?.[0]?.price) {
                                link.price = prices_data[0].price;
                                await crud({
                                  collection: 'deposit_addresses',
                                  method: 'set',
                                  path: `/deposit_addresses/_update/${link.id}`,
                                  ...link,
                                });
                              }
                            }
                            transfer_source.original_sender_chain = link?.original_sender_chain || normalize_original_chain(transfer_source.sender_chain || link?.sender_chain);
                            transfer_source.original_recipient_chain = link?.original_recipient_chain || normalize_original_chain(transfer_source.recipient_chain || link?.recipient_chain);
                            if (link) {
                              transfer_source.recipient_chain = normalize_chain(link.recipient_chain || transfer_source.recipient_chain);
                              transfer_source.denom = transfer_source.denom || link.asset;
                              if (transfer_source.denom && typeof transfer_source.amount === 'string') {
                                const asset_data = assets_data.find(a => equals_ignore_case(a?.id, transfer_source.denom));
                                if (asset_data) {
                                  const decimals = asset_data?.contracts?.find(c => c?.chain_id === chain_data?.chain_id)?.decimals || asset_data?.decimals || 6;
                                  transfer_source.amount = Number(formatUnits(BigNumber.from(transfer_source.amount).toString(), decimals));
                                }
                              }
                              if (link?.price && typeof transfer_source.amount === 'number') {
                                transfer_source.value = transfer_source.amount * link.price;
                              }
                              const _id = `${transfer_source.id}_${transfer_source.recipient_address}`.toLowerCase();
                              await crud({
                                collection: 'transfers',
                                method: 'set',
                                path: `/transfers/_update/${_id}`,
                                id: _id,
                                source: transfer_source,
                                link,
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
                      let found = false;
                      const lcds = _.concat([chain_data.endpoints.lcd], chain_data.endpoints.lcds || []);
                      for (let j = 0; j < lcds.length; j++) {
                        // initial lcd
                        const _lcd = axios.create({ baseURL: lcds[j] });
                        try {
                          // request lcd
                          _response = await _lcd.get(`/cosmos/tx/v1beta1/txs/${txHash}`)
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
                              if (link && !link.price) {
                                const prices_data = await assets_price({
                                  chain: link.original_sender_chain,
                                  denom: link.asset || link.denom,
                                  timestamp: transfer_source.created_at?.ms,
                                });
                                if (prices_data?.[0]?.price) {
                                  link.price = prices_data[0].price;
                                  await crud({
                                    collection: 'deposit_addresses',
                                    method: 'set',
                                    path: `/deposit_addresses/_update/${link.id}`,
                                    ...link,
                                  });
                                }
                              }
                              if (equals_ignore_case(link?.original_sender_chain, 'axelarnet')) {
                                const chain_data = cosmos_chains.find(c => record.sender_address?.startsWith(c?.prefix_address));
                                if (chain_data) {
                                  link.original_sender_chain = _.last(Object.keys({ ...chain_data.overrides })) || chain_data.id;
                                }
                              }
                              transfer_source.original_sender_chain = link?.original_sender_chain || normalize_original_chain(transfer_source.sender_chain || link?.sender_chain);
                              transfer_source.original_recipient_chain = link?.original_recipient_chain || normalize_original_chain(transfer_source.recipient_chain || link?.recipient_chain);
                              if (link) {
                                transfer_source.recipient_chain = normalize_chain(link.recipient_chain);
                                transfer_source.denom = transfer_source.denom || link.asset;
                                if (transfer_source.denom && typeof transfer_source.amount === 'string') {
                                  const asset_data = assets_data.find(a => equals_ignore_case(a?.id, transfer_source.denom) || a?.ibc?.findIndex(i => i?.chain_id === chain_data.id && equals_ignore_case(i?.ibc_denom, record.denom)) > -1);
                                  if (asset_data) {
                                    const decimals = asset_data?.ibc?.find(i => i?.chain_id === chain_data?.id)?.decimals || asset_data?.decimals || 6;
                                    transfer_source.amount = Number(formatUnits(BigNumber.from(transfer_source.amount).toString(), decimals));
                                    transfer_source.denom = asset_data?.id || transfer_source.denom;
                                  }
                                }
                                if (link?.price && typeof transfer_source.amount === 'number') {
                                  transfer_source.value = transfer_source.amount * link.price;
                                }
                                const _id = `${transfer_source.id}_${transfer_source.recipient_address}`.toLowerCase();
                                await crud({
                                  collection: 'transfers',
                                  method: 'set',
                                  path: `/transfers/_update/${_id}`,
                                  id: _id,
                                  source: transfer_source,
                                  link,
                                });
                              }
                              transfer = {
                                source: transfer_source,
                                link,
                              };
                            }
                            found = true;
                            break;
                          }
                        } catch (error) {}
                      }
                      if (found) {
                        break;
                      }
                    }
                  }
                }
              }
              else if (transfer) {
                const evm_chains = chains?.[environment]?.evm || [];
                const cosmos_chains = chains?.[environment]?.cosmos || [];
                query = {
                  match: {
                    deposit_address: transfer.source?.recipient_address || depositAddress,
                  },
                };
                _response = await crud({
                  collection: 'deposit_addresses',
                  method: 'search',
                  query,
                  size: 1,
                });
                let link = _response?.data?.[0];
                if (transfer.source && link) {
                  transfer.source.sender_chain = link.sender_chain || transfer.source.sender_chain;
                  transfer.source.recipient_chain = link.recipient_chain || transfer.source.recipient_chain;
                  transfer.source.denom = transfer.source.denom || link.asset;
                }
                transfer.source.original_sender_chain = link?.original_sender_chain || normalize_original_chain(transfer.source.sender_chain || link?.sender_chain);
                transfer.source.original_recipient_chain = link?.original_recipient_chain || normalize_original_chain(transfer.source.recipient_chain || link?.recipient_chain);
                if (transfer.source?.denom && typeof transfer.source.amount === 'string') {
                  const chain_data = evm_chains?.find(c => equals_ignore_case(c?.id, transfer.source.sender_chain)) || cosmos_chains?.find(c => equals_ignore_case(c?.id, transfer.source.sender_chain));
                  const asset_data = assets_data.find(a => equals_ignore_case(a?.id, transfer.source.denom) || a?.ibc?.findIndex(i => i?.chain_id === chain_data?.id && equals_ignore_case(i?.ibc_denom, transfer.source.denom)) > -1);
                  if (chain_data && asset_data) {
                    const decimals = asset_data?.contracts?.find(c => c?.chain_id === chain_data?.chain_id)?.decimals || asset_data?.ibc?.find(i => i?.chain_id === chain_data?.id)?.decimals || asset_data?.decimals || 6;
                    transfer.source.amount = Number(formatUnits(BigNumber.from(transfer.source.amount).toString(), decimals));
                    transfer.source.denom = asset_data?.id || transfer.source.denom;
                  }
                }
                if (link?.txhash && typeof link.price !== 'number' && config?.[environment]?.endpoints?.api) {
                  // initial api
                  const api = axios.create({ baseURL: config[environment].endpoints.api });
                  await api.post('', {
                    module: 'lcd',
                    path: `/cosmos/tx/v1beta1/txs/${link.txhash}`,
                  }).catch(error => { return { data: { error } }; });
                  await sleep(0.5 * 1000);
                  _response = await crud({
                    collection: 'deposit_addresses',
                    method: 'search',
                    query,
                    size: 1,
                  });
                  link = _response?.data?.[0];
                }
                let price;
                if (!link && (transfer.source?.asset || transfer.source?.denom)) {
                  const created_at = moment(transfer.source.created_at?.ms).utc();
                  const prices_data = await assets_price({
                    chain: transfer.source.original_sender_chain,
                    denom: transfer.source.asset || transfer.source.denom,
                    timestamp: created_at.valueOf(),
                  });
                  if (prices_data?.[0]?.price) {
                    price = prices_data[0].price;
                  }
                }
                if ((link?.price || price) && typeof transfer.source?.amount === 'number') {
                  transfer.source.value = transfer.source.amount * (link?.price || price);
                  const _id = `${transfer.source.id}_${transfer.source.recipient_address}`.toLowerCase();
                  await crud({
                    collection: 'transfers',
                    method: 'set',
                    path: `/transfers/_update/${_id}`,
                    id: _id,
                    source: transfer.source,
                  });
                }
                transfer = {
                  ...transfer,
                  link,
                };
              }
              response = [transfer].filter(t => t);
            }
            else if (recipientAddress || depositAddress) {
              query = {
                bool: {
                  must: [
                    { match: { deposit_address: depositAddress } },
                    { match: { recipient_address: recipientAddress } },
                    { match: { asset } },
                  ].filter(m => Object.values(m.match).filter(v => v).length > 0),
                },
              };
              _response = await crud({
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
                  transfers = links?.map(l => {
                    return {
                      link: l,
                    };
                  });
                }
              }
              response = transfers || [];
            }
            if (Array.isArray(response)) {
              response = response.map(d => {
                const {
                  source,
                  link,
                  confirm_deposit,
                  vote,
                  sign_batch,
                  ibc_send,
                } = { ...d };
                const {
                  amount,
                  value,
                } = { ...source };
                let {
                  price,
                } = { ...link };
                if (typeof price !== 'number' && typeof amount === 'number' && typeof value === 'number') {
                  price = value / amount;
                }
                return {
                  ...d,
                  link: link && {
                    ...link,
                    price,
                  },
                  status: ibc_send ?
                    'ibc_sent' :
                    sign_batch?.executed ?
                      'executed' :
                       sign_batch ?
                        'sign_batch' :
                        vote ?
                          'voted' :
                          confirm_deposit ?
                            'deposit_confirmed' :
                            'asset_sent',
                };
              });
              for (const d of response) {
                const {
                  source,
                  confirm_deposit,
                  vote,
                  status,
                } = { ...d };
                const {
                  recipient_chain,
                } = { ...source };
                if (cosmos_chains_data.filter(c => !['axelarnet'].includes(c?.id)).findIndex(c => equals_ignore_case(c?.id, recipient_chain)) > -1 && ['voted', 'deposit_confirmed'].includes(status)) {
                  const height = vote?.height || confirm_deposit?.height;
                  if (height) {
                    // initial api
                    const api = axios.create({ baseURL: config[environment].endpoints.api });
                    for (let i = 1; i < 4; i++) {
                      api.post('', {
                        module: 'lcd',
                        path: '/cosmos/tx/v1beta1/txs',
                        events: `tx.height=${height + i}`,
                      }).catch(error => { return { data: { error } }; });
                    }
                  }
                }
              }
            }
            break;
          case 'transfers-stats':
            if (!query) {
              if (fromTime) {
                fromTime = Number(fromTime) * 1000;
                toTime = toTime ? Number(toTime) * 1000 : moment().valueOf();
                query = {
                  bool: {
                    must: [
                      { range: { 'source.created_at.ms': { gte: fromTime, lte: toTime } } },
                    ],
                  },
                };
              }
            }
            _response = await crud({
              collection: 'transfers',
              method: 'search',
              query,
              aggs: {
                source_chains: {
                  terms: { field: 'source.sender_chain.keyword', size: 1000 },
                  aggs: {
                    destination_chains: {
                      terms: { field: 'source.recipient_chain.keyword', size: 1000 },
                      aggs: {
                        assets: {
                          terms: { field: 'source.denom.keyword', size: 1000 },
                          aggs: {
                            volume: {
                              sum: { field: 'source.value' },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
              size: 0,
            });
            if (_response?.aggs?.source_chains?.buckets) {
              response = {
                data: _.orderBy(_response.aggs.source_chains.buckets.flatMap(s => (
                  s.destination_chains?.buckets?.flatMap(d => (
                    d.assets?.buckets?.map(a => {
                      return {
                        id: `${s.key}_${d.key}_${a.key}`,
                        source_chain: s.key,
                        destination_chain: d.key,
                        asset: a.key,
                        num_txs: a.doc_count,
                        volume: a.volume?.value,
                      };
                    }) || [{
                      id: `${s.key}_${d.key}`,
                      source_chain: s.key,
                      destination_chain: d.key,
                      num_txs: d.doc_count,
                      volume: d.volume?.value,
                    }]
                  )) || [{
                    id: `${s.key}`,
                    source_chain: s.key,
                    num_txs: s.doc_count,
                    volume: s.volume?.value,
                  }]
                )), ['volume', 'num_txs'], ['desc', 'desc']),
                total: _response.total,
              };
            }
            else {
              response = _response;
            }
            break;
          case 'chains':
            response = { ...chains?.[environment] };
            break;
          case 'assets':
            response = assets_data?.map(a => Object.fromEntries(Object.entries({ ...a }).filter(([k, v]) => !['coingecko_id'].includes(k))));
            break;
          case 'tvl':
            let _assets = params.assets || asset;
            _assets = Array.isArray(_assets) ? _assets : (_assets?.split(',') || []);
            if (_assets.length < 1) {
              _assets = assets_data.map(a => a?.id);
            }
            else {
              _assets = _assets.map(a => {
                const asset_data = assets_data.find(_a => equals_ignore_case(_a?.id, a) || equals_ignore_case(_a?.symbol, a) || _a?.contracts?.findIndex(c => equals_ignore_case(c?.symbol, a)) > -1 || _a?.ibc?.findIndex(i => equals_ignore_case(i?.symbol, a)) > -1);
                return asset_data?.id || a;
              });
              _assets = _assets.filter(a => assets_data.findIndex(_a => _a?.id === a) > -1);
            }

            const providers = Object.fromEntries(evm_chains_data.map(c => {
              const {
                id,
                provider_params,
              } = { ...c };

              const rpcs = provider_params?.[0]?.rpcUrls?.filter(url => url) || [];
              const provider = rpcs.length === 1 ?
                new JsonRpcProvider(rpcs[0]) :
                new FallbackProvider(rpcs.map((url, i) => {
                  return {
                    provider: new JsonRpcProvider(url),
                    priority: i + 1,
                    stallTimeout: 1000,
                  };
                }));
              return [id, provider];
            }));

            data = [];
            for (const asset of _assets) {
              const asset_data = assets_data.find(a => a?.id === asset);
              const {
                contracts,
              } = { ...asset_data };

              // get tvl from rpc
              const tvl = await evm_chains_data.reduce(async (acc, c) => {
                const {
                  id,
                  chain_id,
                  gateway_address,
                } = { ...c };
                const provider = providers[id];

                const contract_data = contracts?.find(_c => _c?.chain_id === chain_id);
                const {
                  is_native,
                } = { ...contract_data };

                let result;
                if (contract_data && provider) {
                  const supply = !is_native ? await getContractSupply(contract_data, provider) : 0;
                  const balance = await getBalance(gateway_address, contract_data, provider);
                  result = {
                    supply,
                    gateway_balance: balance,
                    total: supply + balance,
                  };
                }

                return {
                  ...await acc,
                  [`${id}`]: result,
                };
              }, {});

              // query price
              const prices_data = await assets_price({
                denom: asset,
              });
              const price = prices_data?.[0]?.price;

              data.push({
                asset,
                price,
                tvl,
                total: _.sum(Object.values(tvl).map(t => {
                  const {
                    gateway_balance,
                    total,
                  } = { ...t };
                  return contracts?.findIndex(c => c?.is_native) > -1 ?
                    gateway_balance :
                    total;
                })),
              });
            }
            response = data;
            break;
          default:
            break;
        }
      } catch (error) {}
      break;
    case '/transfer/{pollId}':
      try {
        let { pollId } = { ...req.params };
        pollId = pollId.toLowerCase();
        let { transferId } = { ...params };
        if (typeof transferId === 'number' || !isNaN(transferId)) {
          transferId = Number(transferId);
        }

        log('debug', req.url, 'save transfer id', { pollId, transferId });
        if (typeof transferId === 'number') {
          let _response = await crud({
            collection: 'transfers',
            method: 'get',
            id: pollId,
          });
          const transfer = _response;
          if (transfer) {
            await crud({
              collection: 'transfers',
              method: 'set',
              path: `/transfers/_update/${pollId}`,
              id: pollId,
              transfer_id: transferId,
            });
            await sleep(0.5 * 1000);
            response = {
              code: 200,
              message: 'save transferId successful',
            };

            if (config?.[environment]?.endpoints?.api) {
              const command_id = transferId.toString(16).padStart(64, '0');
              _response = await crud({
                collection: 'batches',
                method: 'search',
                query: {
                  match: { command_ids: command_id },
                },
              });
              const batches = _response?.data;
              if (Array.isArray(batches)) {
                // initial api
                const api = axios.create({ baseURL: config[environment].endpoints.api });
                for (const batch of batches) {
                  const {
                    chain,
                    batch_id,
                  } = { ...batch };
                  if (chain && batch_id) {
                    await api.post('', {
                      module: 'cli',
                      cmd: `axelard q evm batched-commands ${chain} ${batch_id} -oj`,
                    }).catch(error => { return { data: { error } }; });
                  }
                }
              }
            }
          }
          else {
            response = {
              error: true,
              code: 404,
              message: 'transfer not found',
            };
          }
        }
        else {
          response = {
            error: true,
            code: 400,
            message: 'transferId is not a number',
          };
        }
        log('debug', req.url, 'save transfer id output', { ...response });
      } catch (error) {}
      break;
    case '/evm-votes':
      try {
        const { chain, txHash, pollId, transactionId, voter, vote, from, size, sort } = { ...params };
        let { query, fromTime, toTime } = { ...params };
        const must = [], should = [], must_not = [];
        if (chain) {
          must.push({ match: { sender_chain: chain } });
        }
        if (txHash) {
          must.push({ match: { txhash: txHash } });
        }
        if (pollId) {
          must.push({ match_phrase: { poll_id: pollId } });
        }
        if (transactionId) {
          must.push({ match: { transaction_id: transactionId } });
        }
        if (voter) {
          must.push({ match: { voter } });
        }
        if (vote) {
          switch (vote) {
            case 'yes':
            case 'no':
              must.push({ match: { vote: vote === 'yes' } });
              break;
            default:
              break;
          }
        }
        if (fromTime && toTime) {
          fromTime = Number(fromTime) * 1000;
          toTime = Number(toTime) * 1000;
          must.push({ range: { 'created_at.ms': { gte: fromTime, lte: toTime } } });
        }
        if (!query) {
          query = {
            bool: {
              must,
              should,
              must_not,
              minimum_should_match: should.length > 0 ? 1 : 0,
            },
          };
        }
        const _response = await crud({
          collection: 'evm_votes',
          method: 'search',
          query,
          from: typeof from === 'number' ? from : 0,
          size: typeof size === 'number' ? size : 100,
          sort: sort || [{ 'created_at.ms': 'desc' }],
          track_total_hits: true,
        });
        response = _response;
      } catch (error) {}
      break;
    case '/heartbeats':
      try {
        const { sender, fromBlock, toBlock, from, size, sort } = { ...params };
        let { query } = { ...params };
        const must = [], should = [], must_not = [];
        if (sender) {
          must.push({ match: { sender } });
        }
        if (fromBlock || toBlock) {
          const range = {};
          if (fromBlock) {
            range.gte = fromBlock;
          }
          if (toBlock) {
            range.lte = toBlock;
          }
          must.push({ range: { height: range } });
        }
        if (!query) {
          query = {
            bool: {
              must,
              should,
              must_not,
              minimum_should_match: should.length > 0 ? 1 : 0,
            },
          };
        }
        const _response = await crud({
          collection: 'heartbeats',
          method: 'search',
          query,
          from: typeof from === 'number' ? from : 0,
          size: typeof size === 'number' ? size : 200,
          sort: sort || [{ period_height: 'desc' }],
          track_total_hits: true,
        });
        response = _response;
      } catch (error) {}
      break;
    case '/gateway/{function}':
      try {
        let _params, _response;
        const { txHash, sourceChain, destinationChain, asset, senderAddress, recipientAddress, fromTime, toTime, from, size, sort } = { ...params };
        const { contractAddress } = { ...params };
        let { query, event, chain } = { ...params };
        if (chain) {
          chain = chain.toLowerCase();
        }
        switch (req.params.function?.toLowerCase()) {
          case 'save-events':
            if (!(event && chain && contractAddress)) {
              response = {
                error: true,
                code: 400,
                message: 'parameters not valid',
              };
            }
            else if (!(config?.[environment]?.gateway?.chains?.[chain]?.endpoints?.rpc && equals_ignore_case(config[environment].gateway.contracts?.[chain]?.address, contractAddress))) {
              response = {
                error: true,
                code: 500,
                message: 'wrong api configuration',
              };
            }
            else {
              try {
                const { gateway } = { ...config[environment] };
                // initial provider
                const rpcs = gateway.chains[chain].endpoints.rpc;
                const provider = rpcs.length > 1 ? new FallbackProvider(rpcs.map((url, i) => {
                  return {
                    provider: new JsonRpcProvider(url),
                    priority: i + 1,
                    stallTimeout: 1000,
                  };
                })) : new JsonRpcProvider(rpcs[0]);
                // initial event name
                const event_name = event.event;
                // initial variables
                let id = event._id || `${event.transactionHash}_${event.transactionIndex}_${event.logIndex}`;
                event.id = id;
                event.chain = chain;
                event.contract_address = contractAddress;

                // save each event
                switch (event_name) {
                  case 'TokenSent':
                    event = {
                      ...(await getTransaction(provider, event.transactionHash, chain)),
                      block_timestamp: await getBlockTime(provider, event.blockNumber),
                      ...event,
                    };
                    _params = {
                      method: 'set',
                      collection: 'token_sent_events',
                      id,
                      path: `/token_sent_events/_update/${id}`,
                      update_only: true,
                      event,
                    };
                    _response = await crud(_params);
                    response = {
                      response: _response,
                      data: {
                        event,
                      },
                    };
                    break;
                  default:
                    break;
                }
              } catch (error) {
                response = {
                  error: true,
                  code: 400,
                  message: error?.message,
                };
              }
            }
            break;
          case 'latest-event-block':
            if (!(chain)) {
              response = {
                error: true,
                code: 400,
                message: 'parameters not valid',
              };
            }
            else {
              try {
                // token sent
                _params = {
                  method: 'query',
                  collection: 'token_sent_events',
                  query: {
                    bool: {
                      must: [
                        { match: { 'event.chain': chain } },
                        { exists: { field: 'event.blockNumber' } },
                      ],
                    },
                  },
                  use_raw_data: true,
                  size: 1,
                  sort: [{ 'event.blockNumber': 'desc' }],
                };
                _response = await crud(_params);
                if (_response?.data?.[0]?.event?.blockNumber) {
                  response = {
                    ...response,
                    latest: {
                      ...response?.latest,
                      token_sent_block: _response.data[0].event.blockNumber,
                    },
                  };
                }

                // finalize
                response = {
                  chain,
                  ...response,
                  latest: {
                    ...response?.latest,
                    gateway_block: response?.latest?.token_sent_block,
                  },
                };
              } catch (error) {
                response = {
                  error: true,
                  code: 400,
                  message: error?.message,
                };
              }
            }
            break;
          case 'token-sent':
            const must = [], should = [], must_not = [];
            if (txHash) {
              must.push({ match: { 'event.transactionHash': txHash } });
            }
            if (sourceChain) {
              must.push({ match: { 'event.chain': sourceChain } });
            }
            if (destinationChain) {
              must.push({ match: { 'event.returnValues.destinationChain': destinationChain } });
            }
            if (asset) {
              must.push({ match: { 'event.returnValues.asset': asset } });
            }
            if (senderAddress) {
              should.push({ match: { 'event.transaction.from': senderAddress } });
              should.push({ match: { 'event.receipt.from': senderAddress } });
            }
            if (recipientAddress) {
              must.push({ match: { 'event.returnValues.destinationAddress': recipientAddress } });
            }
            if (fromTime && toTime) {
              must.push({ range: { 'event.block_timestamp': { gte: fromTime, lte:toTime } } });
            }
            if (!query) {
              query = {
                bool: {
                  must,
                  should,
                  must_not,
                  minimum_should_match: should.length > 0 ? 1 : 0,
                },
              };
            }
            _response = await crud({
              collection: 'token_sent_events',
              method: 'search',
              query,
              from: typeof from === 'number' ? from : 0,
              size: typeof size === 'number' ? size : 100,
              sort: sort || [{ 'event.block_timestamp': 'desc' }],
            });
            response = _response;
            break;
          default:
            break;
        }
      } catch (error) {}
      break;
    default:
      if (!req.url) {
        await require('./services/archiver')();
      }
      break;
  }

  // return response
  return response;
};