exports.handler = async (
  event,
  context,
  callback,
) => {
  const {
    BigNumber,
    Contract,
    providers: { FallbackProvider, JsonRpcProvider },
    utils: { formatUnits, parseUnits },
  } = require('ethers');
  const axios = require('axios');
  const _ = require('lodash');
  const moment = require('moment');
  const config = require('config-yml');
  const rpc = require('./services/rpc');
  const {
    crud,
    get,
    read,
    write,
  } = require('./services/index');
  const assets_price = require('./services/assets-price');
  const coingecko = require('./services/coingecko');
  const ens = require('./services/ens');
  const {
    searchTransfers,
    searchTransfersStats,
    getTransfersStatus,
  } = require('./services/transfers');
  const tvl = require('./services/tvl');
  const {
    saveEvent,
    getLatestEventBlock,
    searchTokenSent,
  } = require('./services/gateway');
  const {
    log,
    sleep,
    equals_ignore_case,
    get_params,
    to_json,
    to_hex,
    get_granularity,
    normalize_original_chain,
    normalize_chain,
    transfer_actions,
    vote_types,
    getTransaction,
    getBlockTime,
  } = require('./utils');
  const IAxelarGateway = require('./data/contracts/interfaces/IAxelarGateway.json');
  const IBurnableMintableCappedERC20 = require('./data/contracts/interfaces/IBurnableMintableCappedERC20.json');

  const environment = process.env.ENVIRONMENT || config?.environment;

  const evm_chains_data = require('./data')?.chains?.[environment]?.evm || [];
  const cosmos_chains_data = require('./data')?.chains?.[environment]?.cosmos || [];
  const chains_data = _.concat(
    evm_chains_data,
    cosmos_chains_data,
  );
  const axelarnet = chains_data.find(c => c?.id === 'axelarnet');
  const cosmos_non_axelarnet_chains_data = cosmos_chains_data.filter(c => c?.id !== axelarnet.id);
  const assets_data = require('./data')?.assets?.[environment] || [];

  const {
    endpoints,
    num_blocks_per_heartbeat,
    fraction_heartbeat_block,
  } = { ...config?.[environment] };

  // parse function event to req
  const req = {
    body: {
      ...(event.body && JSON.parse(event.body)),
    },
    query: {
      ...event.queryStringParameters,
    },
    params: {
      ...event.pathParameters,
    },
    method: event.requestContext?.http?.method,
    url: event.routeKey?.replace('ANY ', ''),
    headers: event.headers,
  };
  const params = get_params(req);

  const chains_rpc = Object.fromEntries(evm_chains_data.map(c => [c?.id, c?.provider_params?.[0]?.rpcUrls || []]));

  let response;

  switch (req.url) {
    case '/':
      const {
        collection,
      } = { ...params };
      let {
        path,
        cache,
        cache_timeout,
        no_index,
      } = { ...params };

      const _module = params.module?.trim().toLowerCase();
      path = path || '';
      cache = typeof cache === 'boolean' ?
        cache :
        typeof cache === 'string' && equals_ignore_case(cache, 'true');
      cache_timeout = !isNaN(cache_timeout) ?
        Number(cache_timeout) :
        undefined;
      no_index = typeof no_index === 'boolean' ?
        no_index :
        typeof no_index === 'string' && equals_ignore_case(no_index, 'true');

      delete params.module;
      delete params.path;
      delete params.cache;
      delete params.cache_timeout;
      delete params.no_index;

      // initial lcd
      const lcd = axios.create({ baseURL: endpoints?.lcd });
      // initial cli
      const cli = axios.create({ baseURL: endpoints?.cli });
      // initial api
      const api = axios.create({ baseURL: endpoints?.api });

      let res,
        response_cache,
        cache_id,
        cache_hit;

      switch (_module) {
        case 'rpc':
          try {
            response = await rpc(
              path,
              params,
            );
          } catch (error) {
            response = {
              error: true,
              code: 400,
              message: error?.message,
            };
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
            response_cache = await get(
              'cosmos',
              cache_id,
            );
            response_cache = to_json(response_cache?.response);
            if (response_cache && moment().diff(moment(response_cache.updated_at * 1000), 'minutes', true) <= (cache_timeout || 1)) {
              res = {
                data: response_cache,
              };
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
              await write(
                'cosmos',
                cache_id,
                {
                  response: JSON.stringify(res.data),
                  updated_at: moment().unix(),
                },
              );
            }
          }
          else if (response_cache) {
            res = {
              data: response_cache,
            };
          }
          if (path.startsWith('/cosmos/tx/v1beta1/txs/') && !path.endsWith('/') && res?.data?.tx_response?.txhash) {
            const {
              tx_response,
              tx,
            } = { ...res.data };
            // custom evm deposit confirmation
            const log_index = tx_response.logs?.findIndex(l => l?.events?.findIndex(e => e?.type === 'depositConfirmation') > -1);
            const deposit_confirmation_log = tx_response.logs?.[log_index];
            if (deposit_confirmation_log) {
              const event_index = deposit_confirmation_log?.events?.findIndex(e => e?.type === 'depositConfirmation');
              const event = deposit_confirmation_log?.events?.[event_index];
              const chain = event?.attributes?.find(a => a?.key === 'chain' && a.value)?.value;
              const token_address = event?.attributes?.find(a => a?.key === 'tokenAddress' && a.value)?.value;
              if (chain && token_address) {
                const chain_data = evm_chains_data.find(c => equals_ignore_case(c?.id, chain));
                const denom = assets_data.find(a => a?.contracts?.findIndex(c => c?.chain_id === chain_data?.chain_id && equals_ignore_case(c?.contract_address, token_address)) > -1)?.id;
                if (denom) {
                  tx_response.denom = denom;
                }
              }
              const amount_index = event?.attributes?.findIndex(a => a?.key === 'amount' && a.value);
              if (amount_index > -1) {
                const attribute = event.attributes[amount_index];
                const amount_splited = attribute.value.split('');
                let amount = '';
                for (const c of amount_splited) {
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
            const {
              logs,
            } = { ...data };
            const {
              messages,
            } = { ...tx?.body };
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
                  for (const field of byte_array_fields) {
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
                  if (message?.inner_message?.vote?.events) {
                    const events = message.inner_message.vote.events;
                    for (let j = 0; j < events.length; j++) {
                      const event = events[j];
                      if (event) {
                        for (let k = 0; k < byte_array_fields.length; k++) {
                          const field = byte_array_fields[k];
                          if (Array.isArray(event[field])) {
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
                          events[j] = event;
                          message.inner_message.vote.events = events;
                        }
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
              addresses = _.uniq(_.concat(addresses, logs.flatMap(l => l?.events?.flatMap(e => e?.attributes?.filter(a => address_fields.includes(a.key)).map(a => a.value) || []) || [])).filter(a => typeof a === 'string' && a.startsWith(axelarnet.prefix_address)));
            }
            if (messages) {
              addresses = _.uniq(_.concat(addresses, messages.flatMap(m => _.concat(address_fields.map(f => m[f]), address_fields.map(f => m.inner_message?.[f])))).filter(a => typeof a === 'string' && a.startsWith(axelarnet.prefix_address)));
              types = _.uniq(_.concat(types, messages.flatMap(m => [_.last(m?.['@type']?.split('.')), _.last(m?.inner_message?.['@type']?.split('.'))])).filter(t => t));
            }
            data.addresses = addresses;
            data.types = types;
            await write(
              'txs',
              data.txhash,
              {
                ...data,
              },
            );

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
                  await write(
                    'heartbeats',
                    `${record.sender}_${record.period_height}`,
                    {
                      ...record,
                    },
                  );
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
                if (equals_ignore_case(sender_chain, axelarnet.id)) {
                  const chain_data = cosmos_non_axelarnet_chains_data.find(c => record.sender_address?.startsWith(c?.prefix_address));
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
                record.sender_chain = normalize_chain(cosmos_non_axelarnet_chains_data.find(c => record.sender_address?.startsWith(c?.prefix_address))?.id || record.sender_chain || record.chain);
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
                    const _response = await get(
                      'deposit_addresses',
                      record.id,
                    );
                    if (_response?.price) {
                      record.price = _response.price;
                    }
                  }
                }
                await write(
                  'deposit_addresses',
                  record.id,
                  {
                    ...record,
                  },
                );
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
                  sender_chain: axelarnet.id,
                  sender_address: messages.find(m => m?.from_address)?.from_address,
                  recipient_address: messages.find(m => m?.to_address)?.to_address,
                  amount: amount_denom?.amount,
                  denom: amount_denom?.denom,
                };
                if (record.recipient_address?.length >= 65 && record.id && record.amount) {
                  const _response = await read(
                    'deposit_addresses',
                    {
                      match: {
                        deposit_address: record.recipient_address,
                      },
                    },
                    {
                      size: 1,
                    },
                  );
                  const link = _response?.data?.[0];
                  if (link && !link.price) {
                    const prices_data = await assets_price({
                      chain: link.original_sender_chain,
                      denom: link.asset || link.denom,
                      timestamp: record.created_at?.ms,
                    });
                    if (prices_data?.[0]?.price) {
                      link.price = prices_data[0].price;
                      await write(
                        'deposit_addresses',
                        link.id,
                        {
                          ...link,
                        },
                      );
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
                    const asset_data = assets_data.find(a => equals_ignore_case(a?.id, record.denom) || a?.ibc?.findIndex(i => i?.chain_id === axelarnet.id && equals_ignore_case(i?.ibc_denom, record.denom)) > -1);
                    if (asset_data) {
                      const decimals = asset_data?.ibc?.find(i => i?.chain_id === axelarnet.id)?.decimals || asset_data?.decimals || 6;
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
                  const data = {
                    source: record,
                  };
                  if (link) {
                    data.link = link;
                  }
                  await write(
                    'transfers',
                    _id,
                    data,
                  );
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
                for (const event_recv_packet of event_recv_packets) {
                  const packet_data = to_json(event_recv_packet?.attributes?.find(a => a?.key === 'packet_data' && a.value)?.value);
                  const packet_data_hex = event_recv_packet?.attributes?.find(a => a?.key === 'packet_data_hex' && a.value)?.value;
                  const packet_sequence = event_recv_packet?.attributes?.find(a => a?.key === 'packet_sequence' && a.value)?.value;
                  const _height = event_recv_packet?.height;
                  if (_height && packet_data_hex && packet_data && typeof packet_data === 'object') {
                    for (const chain_data of cosmos_chains) {
                      if (chain_data?.endpoints?.lcd && packet_data.sender?.startsWith(chain_data.prefix_address)) {
                        let found = false;
                        const lcds = _.concat([chain_data.endpoints.lcd], chain_data.endpoints.lcds || []);
                        for (const lcd of lcds) {
                          // initial lcd
                          const _lcd = axios.create({ baseURL: lcd });
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
                                const _response = await read(
                                  'deposit_addresses',
                                  {
                                    match: {
                                      deposit_address: record.recipient_address,
                                    },
                                  },
                                  {
                                    size: 1,
                                  },
                                );
                                const link = _response?.data?.[0];
                                if (link && !link.price) {
                                  const prices_data = await assets_price({
                                    chain: link.original_sender_chain,
                                    denom: link.asset || link.denom,
                                    timestamp: record.created_at?.ms,
                                  });
                                  if (prices_data?.[0]?.price) {
                                    link.price = prices_data[0].price;
                                    await write(
                                      'deposit_addresses',
                                      link.id,
                                      {
                                        ...link,
                                      },
                                    );
                                  }
                                }
                                if (link) {
                                  record.recipient_chain = link.recipient_chain;
                                  record.denom = record.denom || link.asset;
                                }
                                if (equals_ignore_case(link?.original_sender_chain, axelarnet.id)) {
                                  const chain_data = cosmos_non_axelarnet_chains_data.find(c => record.sender_address?.startsWith(c?.prefix_address));
                                  if (chain_data) {
                                    link.original_sender_chain = _.last(Object.keys({ ...chain_data.overrides })) || chain_data.id;
                                  }
                                }
                                record.original_sender_chain = link?.original_sender_chain || normalize_original_chain(record.sender_chain || link?.sender_chain);
                                record.original_recipient_chain = link?.original_recipient_chain || normalize_original_chain(record.recipient_chain || link?.recipient_chain);
                                if (record.denom) {
                                  const asset_data = assets_data.find(a => equals_ignore_case(a?.id, record.denom) || a?.ibc?.findIndex(i => i?.chain_id === chain_data.id && equals_ignore_case(i?.ibc_denom, record.denom)) > -1);
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
                                const data = {
                                  source: record,
                                };
                                if (link) {
                                  data.link = link;
                                }
                                await write(
                                  'transfers',
                                  _id,
                                  data,
                                );
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
                  const {
                    packet_data,
                  } = { ...e };
                  const {
                    sender,
                    receiver,
                    amount,
                    denom,
                  } = { ...packet_data };
                  const created_at = moment(tx_response.timestamp).utc();
                  const asset_data = assets_data.find(a => equals_ignore_case(a?.id, denom) || a?.ibc?.findIndex(i => i?.chain_id === axelarnet.id && equals_ignore_case(i?.ibc_denom, denom)) > -1);
                  const decimals = asset_data?.ibc?.find(i => i?.chain_id === axelarnet.id)?.decimals || asset_data?.decimals || 6;
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
                for (const record of event_send_packets) {
                  let response = await read(
                    'transfers',
                    {
                      bool: {
                        must: [
                          { match: { 'ibc_send.id': record.id } },
                          { match: { 'ibc_send.recipient_address': record.recipient_address } },
                          { match: { 'ibc_send.denom': record.denom } },
                        ],
                      },
                    },
                    {
                      size: 1,
                    },
                  );
                  if (response?.data?.filter(d => typeof d?.source?.amount_received === 'number').length < 1) {
                    response = await read(
                      'transfers',
                      {
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
                      },
                      {
                        size: 1,
                        sort: [{ 'source.created_at.ms': 'asc' }],
                      },
                    );
                    if (response?.data?.length > 0) {
                      const {
                        source,
                      } = { ...response.data[0] };
                      const {
                        id,
                        recipient_address,
                      } = { ...source };
                      const _id = `${id}_${recipient_address}`.toLowerCase();
                      await write(
                        'transfers',
                        _id,
                        {
                          ibc_send: record,
                        },
                      );
                    }
                  }
                  else {
                    const data = response.data[0];
                    if (!_.isEqual(data.ibc_send, record)) {
                      const {
                        source,
                      } = { ...data };
                      const {
                        id,
                        recipient_address,
                      } = { ...source };
                      const _id = `${id}_${recipient_address}`.toLowerCase();
                      await write(
                        'transfers',
                        _id,
                        {
                          ibc_send: record,
                        },
                      );
                    }
                  }
                }
              }
              // MsgAcknowledgement -> ibc_ack
              else if (messages.findIndex(m => _.last(m?.['@type']?.split('.')) === 'MsgAcknowledgement') > -1) {
                const event_ack_packets = logs.map(l => l?.events?.find(e => e?.type === 'acknowledge_packet')).filter(e => e?.attributes?.length > 0).map(e => {
                  const {
                    attributes,
                  } = { ...e };
                  return Object.fromEntries(attributes.filter(a => a?.key && a.value).map(a => [a.key, a.value]));
                }).filter(e => e.packet_sequence).map(e => {
                  return {
                    ...e,
                    id: tx_response.txhash,
                    height: Number(messages.find(m => _.last(m?.['@type']?.split('.')) === 'MsgAcknowledgement')?.proof_height?.revision_height || '0') - 1,
                  };
                });
                for (const record of event_ack_packets) {
                  const response = await read(
                    'transfers',
                    {
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
                    },
                    {
                      size: 1,
                      sort: [{ 'source.created_at.ms': 'asc' }],
                    },
                  );
                  if (response?.data?.length > 0) {
                    const {
                      source,
                      link,
                      ibc_send,
                    } = { ...response.data[0] };
                    const {
                      id,
                      recipient_address,
                    } = { ...source };
                    const _id = `${id}_${recipient_address}`.toLowerCase();
                    await write(
                      'transfers',
                      _id,
                      {
                        ibc_send: {
                          ...ibc_send,
                          ack_txhash: record.id,
                        },
                      },
                    );
                    if (record.height && ibc_send?.packet?.packet_data_hex && (source?.recipient_chain || link?.recipient_chain)) {
                      const recipient_chain = source?.recipient_chain || link?.recipient_chain;
                      const chain_data = cosmos_non_axelarnet_chains_data.find(c => equals_ignore_case(c?.id, recipient_chain));
                      if (chain_data?.endpoints?.lcd) {
                        const lcds = _.concat([chain_data.endpoints.lcd], chain_data.endpoints.lcds || []);
                        for (const lcd of lcds) {
                          const _lcd = axios.create({ baseURL: lcd });
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
                              await write(
                                'transfers',
                                _id,
                                {
                                  ibc_send: {
                                    ...ibc_send,
                                    ack_txhash: record.id,
                                    recv_txhash: txHash,
                                  },
                                },
                              );
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
                const event = _.head(logs.flatMap(l => l?.events?.filter(e => e?.type === 'depositConfirmation' || e?.type?.includes('ConfirmDeposit'))));
                const poll_id = to_json(event?.attributes?.find(a => a?.key === 'participants' && a.value)?.value)?.poll_id || to_json(event?.attributes?.find(a => a?.key === 'poll' && a.value)?.value)?.id;
                const type = event_message?.attributes?.find(a => a?.key === 'action' && transfer_actions?.includes(a.value))?.value || _.last(messages.find(m => transfer_actions?.includes(_.last(m?.['@type']?.split('.'))?.replace('Request', '')))?.['@type']?.split('.'))?.replace('Request', '');
                let token_address = event?.attributes?.find(a => ['token_address', 'tokenAddress'].includes(a?.key) && a.value)?.value;
                if (token_address?.startsWith('[') && token_address.endsWith(']')) {
                  token_address = to_hex(to_json(token_address));
                }
                let deposit_address = messages.find(m => m?.deposit_address)?.deposit_address || event?.attributes?.find(a => ['deposit_address', 'depositAddress'].includes(a?.key) && a.value)?.value;
                if (deposit_address?.startsWith('[') && deposit_address.endsWith(']')) {
                  deposit_address = to_hex(to_json(deposit_address));
                }
                let transaction_id = event?.attributes?.find(a => ['tx_id', 'txID'].includes(a?.key) && a.value)?.value || poll_id?.split('_')[0];
                if (transaction_id?.startsWith('[') && transaction_id.endsWith(']')) {
                  transaction_id = to_hex(to_json(transaction_id));
                }
                const participants = to_json(event?.attributes?.find(a => a?.key === 'participants' && a.value)?.value)?.participants;
                const record = {
                  id: tx_response.txhash,
                  type,
                  status_code: tx_response.code,
                  status: tx_response.code ? 'failed' : 'success',
                  height: Number(tx_response.height),
                  created_at: get_granularity(created_at),
                  user: messages.find(m => m?.sender)?.sender,
                  module: event?.attributes?.find(a => a?.key === 'module' && a.value)?.value || (type === 'ConfirmDeposit' ? axelarnet.id : 'evm'),
                  sender_chain: normalize_chain(messages.find(m => m?.chain)?.chain || event?.attributes?.find(a => ['sourceChain', 'chain'].includes(a?.key) && a.value)?.value),
                  recipient_chain: normalize_chain(event?.attributes?.find(a => ['destinationChain'].includes(a?.key) && a.value)?.value),
                  amount: event?.attributes?.find(a => a?.key === 'amount' && a.value)?.value,
                  denom: tx_response.denom || messages.find(m => m?.denom)?.denom,
                  token_address,
                  deposit_address,
                  transfer_id: Number(event?.attributes?.find(a => a?.key === 'transferID' && a.value)?.value),
                  poll_id,
                  transaction_id,
                  participants,
                };
                if (!record.status_code && record.id && (record.transfer_id || record.poll_id)) {
                  switch (record.type) {
                    case 'ConfirmDeposit':
                      try {
                        let sign_batch;
                        let _response = !record.recipient_chain &&
                          await read(
                            'deposit_addresses',
                            {
                              bool: {
                                must: [
                                  { match: { deposit_address: record.deposit_address } },
                                ],
                              },
                            },
                            {
                              size: 1,
                            },
                          );
                        const link = _response?.data?.[0];
                        const recipient_chain = link?.recipient_chain || record.recipient_chain;
                        if (recipient_chain) {
                          const command_id = record.transfer_id.toString(16).padStart(64, '0');
                          _response = await read(
                            'batches',
                            {
                              bool: {
                                must: [
                                  { match: { chain: recipient_chain } },
                                  { match: { status: 'BATCHED_COMMANDS_STATUS_SIGNED' } },
                                  { match: { command_ids: command_id } },
                                ],
                              },
                            },
                            {
                              size: 1,
                            },
                          );
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
                            const gateway_address = evm_chains_data.find(c => c?.id === recipient_chain)?.gateway_address;
                            const gateway = gateway_address && new Contract(gateway_address, IAxelarGateway.abi, provider);
                            if (gateway) {
                              try {
                                sign_batch.executed = await gateway.isCommandExecuted(`0x${command_id}`);
                              } catch (error) {}
                            }
                          }
                        }
                        _response = await read(
                          'transfers',
                          {
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
                          },
                          {
                            size: 100,
                          },
                        );
                        if (_response?.data?.length > 0) {
                          const transfers = _response.data.filter(t => t?.source?.id);
                          const ids = transfers.map(t => t.source.id);
                          for (let i = 0; i < ids.length; i++) {
                            const id = ids[i];
                            const transfer = transfers[i];
                            const transfer_source = transfer.source;
                            const _id = `${transfer_source.id}_${transfer_source.recipient_address}`.toLowerCase();
                            const data = {
                              confirm_deposit: record,
                            };
                            if (sign_batch) {
                              data.sign_batch = sign_batch;
                            }
                            if (transfer_source) {
                              transfer_source.sender_chain = normalize_chain(cosmos_non_axelarnet_chains_data.find(c => transfer_source.sender_address?.startsWith(c?.prefix_address))?.id || record.sender_chain);
                              transfer_source.recipient_chain = transfer_source.recipient_chain || record.recipient_chain;
                              transfer_source.original_sender_chain = link?.original_sender_chain || normalize_original_chain(transfer_source.sender_chain || link?.sender_chain);
                              transfer_source.original_recipient_chain = link?.original_recipient_chain || normalize_original_chain(transfer_source.recipient_chain || link?.recipient_chain);
                              data.source = transfer_source;
                            }
                            await write(
                              'transfers',
                              _id,
                              data,
                            );
                          }
                        }
                        else if (sign_batch) {
                          _response = await read(
                            'transfers',
                            {
                              bool: {
                                must: [
                                  { match: { 'source.recipient_address': record.deposit_address } },
                                  { match: { 'confirm_deposit.transfer_id': record.transfer_id } },
                                ],
                              },
                            },
                            {
                              size: 100,
                            },
                          );
                          if (_response?.data?.length > 0) {
                            const transfers = _response.data.filter(t => t?.source?.id);
                            const ids = transfers.map(t => t.source.id);
                            for (let i = 0; i < ids.length; i++) {
                              const id = ids[i];
                              const transfer = transfers[i];
                              const transfer_source = transfer.source;
                              const _id = `${transfer_source.id}_${transfer_source.recipient_address}`.toLowerCase();
                              const data = {
                                sign_batch,
                              };
                              if (transfer_source) {
                                transfer_source.sender_chain = normalize_chain(cosmos_non_axelarnet_chains_data.find(c => transfer_source.sender_address?.startsWith(c?.prefix_address))?.id || record.sender_chain);
                                transfer_source.recipient_chain = transfer_source.recipient_chain || record.recipient_chain;
                                transfer_source.original_sender_chain = link?.original_sender_chain || normalize_original_chain(transfer_source.sender_chain || link?.sender_chain);
                                transfer_source.original_recipient_chain = link?.original_recipient_chain || normalize_original_chain(transfer_source.recipient_chain || link?.recipient_chain);
                                data.source = transfer_source;
                              }
                              await write(
                                'transfers',
                                _id,
                                data,
                              );
                            }
                          }
                        }
                      } catch (error) {}
                      break;
                    case 'ConfirmERC20Deposit':
                      try {
                        const chain_data = evm_chains_data.find(c => equals_ignore_case(c?.id, record.sender_chain));
                        const rpcs = chains_rpc[record.sender_chain];
                        const provider = rpcs.length === 1 ? new JsonRpcProvider(rpcs[0]) : new FallbackProvider(rpcs.map((url, i) => {
                          return {
                            provider: new JsonRpcProvider(url),
                            priority: i + 1,
                            stallTimeout: 1000,
                          };
                        }));
                        const {
                          transaction_id,
                          deposit_address,
                          sender_chain,
                          recipient_chain,
                          token_address,
                          amount,
                          denom,
                        } = { ...record };
                        if (transaction_id) {
                          const transaction = await provider.getTransaction(transaction_id);
                          const height = transaction?.blockNumber;
                          if (height) {
                            record.amount = BigNumber.from(`0x${transaction.data?.substring(10 + 64) || transaction.input?.substring(10 + 64) || '0'}`).toString() || amount;
                            if (equals_ignore_case(transaction.to, token_address) || assets_data?.findIndex(a => a?.contracts?.findIndex(c => c?.chain_id === chain_data?.chain_id && equals_ignore_case(c?.contract_address, transaction.to)) > -1) > -1) {
                              const block_timestamp = await getBlockTime(provider, height);
                              if (block_timestamp) {
                                created_at = block_timestamp * 1000;
                              }
                              record.denom = assets_data?.find(a => a?.contracts?.findIndex(c => c?.chain_id === chain_data?.chain_id && equals_ignore_case(c?.contract_address, transaction.to)) > -1)?.id || denom;
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
                              const _response = await read(
                                'deposit_addresses',
                                {
                                  match: {
                                    deposit_address,
                                  },
                                },
                                {
                                  size: 1,
                                },
                              );
                              const link = _response?.data?.[0];
                              if (link && !link.price) {
                                const prices_data = await assets_price({
                                  chain: link.original_sender_chain,
                                  denom: link.asset || link.denom,
                                  timestamp: transfer_source.created_at?.ms,
                                });
                                if (prices_data?.[0]?.price) {
                                  link.price = prices_data[0].price;
                                  await write(
                                    'deposit_addresses',
                                    link.id,
                                    {
                                      ...link,
                                    },
                                  );
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
                                const asset_data = assets_data.find(a => equals_ignore_case(a?.id, transfer_source.denom));
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
                              const data = {
                                source: transfer_source,
                                confirm_deposit: record,
                              };
                              if (link) {
                                data.link = link;
                              }
                              await write(
                                'transfers',
                                _id,
                                data,
                              );
                            }
                          }
                        }
                      } catch (error) {}
                      break;
                    default:
                      break;
                  }
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
                    const event_vote = logs?.[i]?.events?.find(e => e?.type?.includes('vote'));
                    const poll_id = message?.inner_message?.poll_id || to_json(message?.inner_message?.poll_key || event?.attributes?.find(a => a?.key === 'poll' && a.value)?.value || event_vote?.attributes?.find(a => a?.key === 'poll' && a.value)?.value)?.id;
                    let sender_chain, transaction_id, deposit_address, vote, confirmation, late;
                    switch (type) {
                      case 'VoteConfirmDeposit':
                        sender_chain = normalize_chain(message?.inner_message?.chain || event?.attributes?.find(a => ['sourceChain', 'chain'].includes(a?.key) && a.value)?.value);
                        vote = message?.inner_message?.confirmed || false;
                        confirmation = event?.attributes?.findIndex(a => a?.key === 'action' && a.value === 'confirm') > -1;
                        break;
                      case 'Vote':
                        sender_chain = normalize_chain(message?.inner_message?.vote?.chain || message?.inner_message?.vote?.results?.[0]?.chain || message?.inner_message?.vote?.result?.chain || evm_chains_data.find(c => poll_id?.startsWith(`${c?.id}_`))?.id);
                        const vote_results = message?.inner_message?.vote?.events || message?.inner_message?.vote?.results || message?.inner_message?.vote?.result?.events;
                        vote = (Array.isArray(vote_results) ? vote_results : Object.keys({ ...vote_results })).length > 0;
                        const vote_has_enum_status = Array.isArray(vote_results) && vote_results.findIndex(v => v?.status) > -1;
                        confirmation = !!event || (event_vote && vote_has_enum_status && vote_results.findIndex(v => ['STATUS_COMPLETED'].includes(v?.status)) > -1);
                        late = !event_vote && ((!vote && Array.isArray(vote_results)) || (vote_has_enum_status && vote_results.findIndex(v => ['STATUS_UNSPECIFIED', 'STATUS_COMPLETED'].includes(v?.status)) > -1));
                        break;
                      default:
                        break;
                    }
                    transaction_id = message?.inner_message?.vote?.events?.[0]?.tx_id || event?.attributes?.find(a => a?.key === 'txID' && a.value)?.value || poll_id?.replace(`${sender_chain}_`, '').split('_')[0];
                    if (transaction_id === poll_id) {
                      transaction_id = null;
                    }
                    deposit_address = message?.inner_message?.vote?.events?.[0]?.transfer?.to || event?.attributes?.find(a => a?.key === 'depositAddress' && a.value)?.value || poll_id?.replace(`${sender_chain}_`, '').split('_')[1];
                    let participants;
                    let _response = await read(
                      'transfers',
                      {
                        bool: {
                          must: [
                            { match: { 'confirm_deposit.poll_id': poll_id } },
                            { exists: { field: 'confirm_deposit.transaction_id' } },
                          ],
                          must_not: [
                            { match: { 'confirm_deposit.transaction_id': poll_id } },
                          ],
                        },
                      },
                      {
                        size: 1,
                      },
                    );
                    if (_response?.data?.[0]?.confirm_deposit) {
                      const {
                        confirm_deposit,
                      } = { ..._response.data[0] };
                      if (!transaction_id) {
                        transaction_id = confirm_deposit.transaction_id;
                      }
                      if (!deposit_address) {
                        deposit_address = confirm_deposit.deposit_address;
                      }
                      participants = confirm_deposit.participants;
                    }
                    if (!transaction_id) {
                      _response = await read(
                        'evm_votes',
                        {
                          bool: {
                            must: [
                              { match: { poll_id } },
                              { exists: { field: 'transaction_id' } },
                            ],
                            must_not: [
                              { match: { transaction_id: poll_id } },
                            ],
                          },
                        },
                        {
                          size: 1,
                        },
                      );
                      transaction_id = _response?.data?.[0]?.transaction_id;
                    }
                    const record = {
                      id: tx_response.txhash,
                      type,
                      status_code: tx_response.code,
                      status: tx_response.code ? 'failed' : 'success',
                      height: Number(tx_response.height),
                      created_at: get_granularity(created_at),
                      sender_chain,
                      recipient_chain: normalize_chain(event?.attributes?.find(a => ['destinationChain'].includes(a?.key) && a.value)?.value),
                      deposit_address,
                      transfer_id: Number(event?.attributes?.find(a => a?.key === 'transferID' && a.value)?.value),
                      poll_id,
                      transaction_id,
                      voter: message?.inner_message?.sender,
                      vote,
                      confirmation,
                      late,
                      unconfirmed: logs?.findIndex(l => l?.log?.startsWith('not enough votes')) > -1,
                    };
                    if (!record.status_code) {
                      if (!record.sender_chain && record.deposit_address) {
                        const _response = await read(
                          'deposit_addresses',
                          {
                            bool: {
                              must: [
                                { match: { deposit_address: record.deposit_address } },
                              ],
                            },
                          },
                          {
                            size: 1,
                          },
                        );
                        const link = _response?.data?.[0];
                        if (link?.sender_chain) {
                          record.sender_chain = link.sender_chain;
                        }
                      }
                      if (!record.sender_chain && record.poll_id) {
                        const _response = await get(
                          'evm_polls',
                          record.poll_id,
                        );
                        const poll = _response;
                        if (poll?.sender_chain) {
                          record.sender_chain = poll.sender_chain;
                        }
                      }
                      if (record.poll_id) {
                        if (record.id && record.vote && (record.confirmation || !record.unconfirmed)) {
                          try {
                            const chain_data = evm_chains_data.find(c => equals_ignore_case(c?.id, record.sender_chain));
                            const rpcs = chains_rpc[record.sender_chain];
                            const provider = rpcs.length === 1 ? new JsonRpcProvider(rpcs[0]) : new FallbackProvider(rpcs.map((url, i) => {
                              return {
                                provider: new JsonRpcProvider(url),
                                priority: i + 1,
                                stallTimeout: 1000,
                              };
                            }));
                            const {
                              sender_chain,
                              recipient_chain,
                              deposit_address,
                              transaction_id,
                              poll_id,
                            } = { ...record };
                            let {
                              created_at,
                            } = { ...record };
                            if (transaction_id) {
                              const transaction = await provider.getTransaction(transaction_id);
                              const height = transaction?.blockNumber;
                              if (height) {
                                record.amount = BigNumber.from(`0x${transaction.data?.substring(10 + 64) || transaction.input?.substring(10 + 64) || '0'}`).toString() || _.last(poll_id?.split('_'));
                                const denom = assets_data.find(a => a?.contracts?.findIndex(c => c?.chain_id === chain_data?.chain_id && equals_ignore_case(c?.contract_address, transaction.to)) > -1)?.id;
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
                                  let _response = await read(
                                    'deposit_addresses',
                                    {
                                      match: {
                                        deposit_address,
                                      },
                                    },
                                    {
                                      size: 1,
                                    },
                                  );
                                  const link = _response?.data?.[0];
                                  if (link && !link.price) {
                                    const prices_data = await assets_price({
                                      chain: link.original_sender_chain,
                                      denom: link.asset || link.denom,
                                      timestamp: transfer_source.created_at?.ms,
                                    });
                                    if (prices_data?.[0]?.price) {
                                      link.price = prices_data[0].price;
                                      await write(
                                        'deposit_addresses',
                                        link.id,
                                        {
                                          ...link,
                                        },
                                      );
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
                                    const asset_data = assets_data.find(a => equals_ignore_case(a?.id, transfer_source.denom));
                                    if (asset_data) {
                                      const decimals = asset_data?.contracts?.find(c => c?.chain_id === chain_data?.chain_id)?.decimals || asset_data?.decimals || 6;
                                      transfer_source.amount = Number(formatUnits(BigNumber.from(transfer_source.amount).toString(), decimals));
                                    }
                                  }
                                  if (link?.price && typeof transfer_source.amount === 'number') {
                                    transfer_source.value = transfer_source.amount * link.price;
                                  }
                                  await sleep(0.5 * 1000);
                                  _response = await read(
                                    'transfers',
                                    {
                                      bool: {
                                        must: [
                                          { match: { 'source.id': transaction_id } },
                                          { match: { 'source.recipient_address': deposit_address } },
                                        ],
                                      },
                                    },
                                    {
                                      size: 1,
                                    },
                                  );
                                  const transfer_confirm_deposit = _response?.data?.[0]?.confirm_deposit;
                                  const _id = `${transfer_source.id}_${transfer_source.recipient_address}`.toLowerCase();
                                  const data = {
                                    source: transfer_source,
                                    vote: record,
                                  };
                                  if (transfer_confirm_deposit) {
                                    data.confirm_deposit = transfer_confirm_deposit;
                                  }
                                  if (link) {
                                    data.link = link;
                                  }
                                  await write(
                                    'transfers',
                                    _id,
                                    data,
                                  );
                                }
                              }
                            }
                          } catch (error) {}
                        }
                        if (record.voter) {
                          const {
                            id,
                            height,
                            created_at,
                            sender_chain,
                            poll_id,
                            transaction_id,
                            voter,
                            vote,
                            confirmation,
                            late,
                            unconfirmed,
                          } = { ...record };
                          if (confirmation || unconfirmed) {
                            const poll_record = {
                              id: poll_id,
                              height,
                              created_at,
                              sender_chain,
                              transaction_id,
                              confirmation,
                            };
                            if (participants) {
                              poll_record.participants = participants;
                            }
                            await write(
                              'evm_polls',
                              poll_record.id,
                              poll_record,
                            );
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
                          await write(
                            'evm_votes',
                            vote_record.id,
                            vote_record,
                          );
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
                const {
                  messages,
                } = { ...tx?.body };
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
                for (const record of records) {
                  write(
                    'heartbeats',
                    `${record.sender}_${record.period_height}`,
                    record,
                  );
                }
              }
              // Link
              records = tx_responses.filter(t => !t?.code && t?.tx?.body?.messages?.findIndex(m => m?.['@type']?.includes('LinkRequest')) > -1).map(t => {
                const {
                  logs,
                } = { ...t };
                const {
                  messages,
                } = { ...t?.tx?.body };
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
                if (equals_ignore_case(sender_chain, axelarnet.id)) {
                  const chain_data = cosmos_non_axelarnet_chains_data.find(c => record.sender_address?.startsWith(c?.prefix_address));
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
                record.sender_chain = normalize_chain(cosmos_non_axelarnet_chains_data.find(c => record.sender_address?.startsWith(c?.prefix_address))?.id || record.sender_chain || record.chain);
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
                      const _response = await get(
                        'deposit_addresses',
                        id,
                      );
                      if (_response?.price) {
                        record.price = _response.price;
                      }
                    }
                  }
                  write(
                    'deposit_addresses',
                    id,
                    record,
                  );
                }
              }
              // VoteConfirmDeposit & Vote
              records = tx_responses.filter(t => !t?.code && t.tx?.body?.messages?.findIndex(m => vote_types.includes(_.last(m?.inner_message?.['@type']?.split('.'))?.replace('Request', ''))) > -1).map(async t => {
                const {
                  logs,
                } = { ...t };
                const {
                  messages,
                } = { ...t?.tx?.body };
                const _records = [];
                for (let i = 0; i < messages.length; i++) {
                  const message = messages[i];
                  const type = _.last(message?.inner_message?.['@type']?.split('.'))?.replace('Request', '');
                  if (vote_types.includes(type)) {
                    const created_at = moment(t.timestamp).utc();
                    const event = logs?.[i]?.events?.find(e => e?.type === 'depositConfirmation');
                    const event_vote = logs?.[i]?.events?.find(e => e?.type?.includes('vote'));
                    const poll_id = message?.inner_message?.poll_id || to_json(message?.inner_message?.poll_key || event?.attributes?.find(a => a?.key === 'poll' && a.value)?.value || event_vote?.attributes?.find(a => a?.key === 'poll' && a.value)?.value)?.id;
                    let sender_chain, transaction_id, deposit_address, vote, confirmation, late;
                    switch (type) {
                      case 'VoteConfirmDeposit':
                        sender_chain = normalize_chain(message?.inner_message?.chain || event?.attributes?.find(a => ['sourceChain', 'chain'].includes(a?.key) && a.value)?.value);
                        vote = message?.inner_message?.confirmed || false;
                        confirmation = event?.attributes?.findIndex(a => a?.key === 'action' && a.value === 'confirm') > -1;
                        break;
                      case 'Vote':
                        sender_chain = normalize_chain(message?.inner_message?.vote?.chain || message?.inner_message?.vote?.results?.[0]?.chain || message?.inner_message?.vote?.result?.chain || evm_chains_data.find(c => poll_id?.startsWith(`${c?.id}_`))?.id);
                        const vote_results = message?.inner_message?.vote?.events || message?.inner_message?.vote?.results || message?.inner_message?.vote?.result?.events;
                        vote = (Array.isArray(vote_results) ? vote_results : Object.keys({ ...vote_results })).length > 0;
                        const vote_has_enum_status = Array.isArray(vote_results) && vote_results.findIndex(v => v?.status) > -1;
                        confirmation = !!event || (event_vote && vote_has_enum_status && vote_results.findIndex(v => ['STATUS_COMPLETED'].includes(v?.status)) > -1);
                        late = !event_vote && ((!vote && Array.isArray(vote_results)) || (vote_has_enum_status && vote_results.findIndex(v => ['STATUS_UNSPECIFIED', 'STATUS_COMPLETED'].includes(v?.status)) > -1));
                        break;
                      default:
                        break;
                    }
                    transaction_id = message?.inner_message?.vote?.events?.[0]?.tx_id || event?.attributes?.find(a => a?.key === 'txID' && a.value)?.value || poll_id?.replace(`${sender_chain}_`, '').split('_')[0];
                    if (transaction_id === poll_id) {
                      transaction_id = null;
                    }
                    deposit_address = message?.inner_message?.vote?.events?.[0]?.transfer?.to || event?.attributes?.find(a => a?.key === 'depositAddress' && a.value)?.value || poll_id?.replace(`${sender_chain}_`, '').split('_')[1];
                    let participants;
                    let _response = await read(
                      'transfers',
                      {
                        bool: {
                          must: [
                            { match: { 'confirm_deposit.poll_id': poll_id } },
                            { exists: { field: 'confirm_deposit.transaction_id' } },
                          ],
                          must_not: [
                            { match: { 'confirm_deposit.transaction_id': poll_id } },
                          ],
                        },
                      },
                      {
                        size: 1,
                      },
                    );
                    if (_response?.data?.[0]?.confirm_deposit) {
                      const {
                        confirm_deposit,
                      } = { ..._response.data[0] };
                      if (!transaction_id) {
                        transaction_id = confirm_deposit.transaction_id;
                      }
                      if (!deposit_address) {
                        deposit_address = confirm_deposit.deposit_address;
                      }
                      participants = confirm_deposit.participants;
                    }
                    if (!transaction_id) {
                      _response = await read(
                        'evm_votes',
                        {
                          bool: {
                            must: [
                              { match: { poll_id } },
                              { exists: { field: 'transaction_id' } },
                            ],
                            must_not: [
                              { match: { transaction_id: poll_id } },
                            ],
                          },
                        },
                        {
                          size: 1,
                        },
                      );
                      transaction_id = _response?.data?.[0]?.transaction_id;
                    }
                    const record = {
                      id: t.txhash,
                      type,
                      status_code: t.code,
                      status: t.code ? 'failed' : 'success',
                      height: Number(t.height),
                      created_at: get_granularity(created_at),
                      sender_chain,
                      recipient_chain: normalize_chain(event?.attributes?.find(a => ['destinationChain'].includes(a?.key) && a.value)?.value),
                      deposit_address,
                      transfer_id: Number(event?.attributes?.find(a => a?.key === 'transferID' && a.value)?.value),
                      poll_id,
                      transaction_id,
                      voter: message?.inner_message?.sender,
                      vote,
                      confirmation,
                      late,
                      unconfirmed: logs?.findIndex(l => l?.log?.startsWith('not enough votes')) > -1,
                      participants,
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
                    participants,
                  } = { ...record };
                  let {
                    sender_chain,
                  } = { ...record };
                  if (!status_code) {
                    if (!sender_chain && deposit_address) {
                      const _response = await read(
                        'deposit_addresses',
                        {
                          bool: {
                            must: [
                              { match: { deposit_address } },
                            ],
                          },
                        },
                        {
                          size: 1,
                        },
                      );
                      const link = _response?.data?.[0];
                      if (link?.sender_chain) {
                        sender_chain = link.sender_chain;
                      }
                    }
                    if (!sender_chain && poll_id) {
                      const _response = await get(
                        'evm_polls',
                        poll_id,
                      );
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
                    if (participants) {
                      poll_record.participants = participants;
                    }
                    write(
                      'evm_polls',
                      poll_record.id,
                      poll_record,
                    );
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
                  write(
                    'evm_votes',
                    vote_record.id,
                    vote_record,
                  );
                }
              }
              // RouteIBCTransfersRequest
              records = tx_responses.filter(t => !t?.code && t.tx?.body?.messages?.findIndex(m => m?.['@type']?.includes('RouteIBCTransfersRequest')) > -1).map(t => t.txhash);
              if (records.length > 0) {
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
            const {
              block,
              block_id,
            } = { ...res.data };
            await write(
              'blocks',
              block.header.height,
              {
                ...block.header,
                hash: block_id?.hash,
                num_txs: block.data?.txs?.length,
              },
            );
            const {
              last_commit,
            } = { ...block };
            if (last_commit?.height && last_commit.signatures) {
              await write(
                'uptimes',
                last_commit.height,
                {
                  height: Number(last_commit.height),
                  timestamp: moment(_.head(last_commit.signatures)?.timestamp).valueOf(),
                  validators: last_commit.signatures.map(s => s?.validator_address),
                },
              );
            }
          }
          else if (path === '/ibc/core/channel/v1/channels' && res?.data?.channels) {
            let all_channels = [];
            let {
              channels,
              pagination,
            } = { ...res.data };
            let {
              next_key,
            } = { ...pagination };
            all_channels = _.uniqBy(_.concat(all_channels, channels), 'channel_id');

            while (next_key) {
              const _res = await lcd.get(path, {
                params: {
                  'pagination.key': next_key,
                },
              }).catch(error => { return { data: { error } }; });
              channels = _res?.data?.channels;
              pagination = _res?.data?.pagination;
              next_key = pagination?.next_key;

              if (channels) {
                all_channels = _.uniqBy(_.concat(all_channels, channels), 'channel_id');
              }              
            }

            const _response = await read(
              'ibc_channels',
              {
                match_all: {},
              },
              {
                size: 1000,
              },
            );
            const {
              data,
            } = { ..._response };

            all_channels = all_channels.map(c => {
              const {
                channel_id,
              } = { ...c };
              return {
                ...(data?.find(_c => _c?.channel_id === channel_id)),
                ...c,
              };
            });

            for (const channel of all_channels) {
              const {
                channel_id,
                port_id,
                updated_at,
              } = { ...channel };
              let {
                chain_id,
                escrow_address,
              } = { ...channel };

              if (!chain_id || !escrow_address || moment().diff(moment((updated_at || 0) * 1000), 'minutes', true) > 240) {
                let _res = await lcd.get(`/ibc/core/channel/v1/channels/${channel_id}/ports/${port_id}/client_state`)
                  .catch(error => { return { data: { error } }; });
                const {
                  client_state,
                } = { ..._res?.data?.identified_client_state };
                chain_id = client_state?.chain_id || chain_id;

                if (chain_id) {
                  _res = await cli.get('', {
                    params: {
                      cmd: `axelard q ibc-transfer escrow-address ${port_id} ${channel_id} -oj`,
                    },
                  }).catch(error => { return { data: { error } }; });
                  const {
                    stdout,
                  } = { ..._res?.data };
                  escrow_address = stdout?.trim() || escrow_address;

                  await write(
                    'ibc_channels',
                    channel_id,
                    {
                      ...channel,
                      chain_id,
                      escrow_address,
                      updated_at: moment().unix(),
                    },
                  );
                }
              }
            }
          }
          res.data.cache_hit = cache_hit;
          break;
        case 'cli':
          if (endpoints?.cli) {
            // set id
            cache_id = params.cmd;
            // get from cache
            if (cache && cache_id?.startsWith('axelard')) {
              response_cache = await get(
                'axelard',
                cache_id,
              );
              if (response_cache && moment().diff(moment(response_cache.updated_at * 1000), 'minutes', true) <= (cache_timeout || 15)) {
                res = {
                  data: response_cache,
                };
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
                const rpcs = chains_rpc[chain];
                const provider = rpcs.length === 1 ? new JsonRpcProvider(rpcs[0]) : new FallbackProvider(rpcs.map((url, i) => {
                  return {
                    provider: new JsonRpcProvider(url),
                    priority: i + 1,
                    stallTimeout: 1000,
                  };
                }));
                const chain_data = evm_chains_data.find(c => equals_ignore_case(c?.id, chain));
                const gateway_address = chain_data?.gateway_address;
                const gateway = gateway_address && new Contract(gateway_address, IAxelarGateway.abi, provider);
                const output = to_json(res.data.stdout);
                if (output) {
                  // get data from index
                  const _response = await read(
                    'batches',
                    {
                      match_phrase: {
                        batch_id: output.batch_id,
                      },
                    },
                    {
                      size: 1,
                    },
                  );
                  const _commands = _response?.data?.[0]?.commands;

                  const commands = [];
                  if (output.command_ids) {
                    for (const command_id of output.command_ids) {
                      if (command_id) {
                        let command = _commands?.find(c => equals_ignore_case(c?.id, command_id));
                        if (!command) {
                          const cmd = `axelard q evm command ${chain} ${command_id} -oj`;
                          // request cli
                          const _response = await cli.get(path, {
                            params: {
                              cmd,
                              cache: true,
                              cache_timeout: 1,
                            }
                          }).catch(error => { return { data: { error } }; });
                          command = to_json(_response?.data?.stdout);
                          // sleep before next cmd
                          // await sleep(0.05 * 1000);
                        }
                        if (command) {
                          const {
                            salt,
                          } = { ...command.params };
                          if (!command.executed) {
                            try {
                              command.executed = await gateway.isCommandExecuted(`0x${command_id}`);
                            } catch (error) {}
                          }
                          if (!command.deposit_address && salt && (output.command_ids.length < 15 || _commands?.filter(c => c?.salt && !c.deposit_address).length < 15 || Math.random(0, 1) < 0.3)) {
                            try {
                              const asset_data = assets_data.find(a => a?.contracts?.findIndex(c => c?.chain_id === chain_data?.chain_id && !c?.is_native) > -1);
                              const contract_data = asset_data?.contracts?.find(c => c?.chain_id === chain_data?.chain_id);
                              const {
                                contract_address,
                              } = { ...contract_data };
                              const erc20 = contract_address && new Contract(contract_address, IBurnableMintableCappedERC20.abi, provider);
                              if (erc20) {
                                command.deposit_address = await erc20.depositAddress(salt);
                              }
                            } catch (error) {}
                          }
                        }
                        commands.push(command);
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
                    const _response = await read(
                      'batches',
                      {
                        match_phrase: {
                          batch_id: output.batch_id,
                        },
                      },
                      {
                        size: 1,
                      },
                    );
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
                      for (const command_id of command_ids) {
                        const transfer_id = parseInt(command_id, 16);
                        sign_batch.command_id = command_id;
                        sign_batch.transfer_id = transfer_id;
                        const _response = await read(
                          'transfers',
                          {
                            bool: {
                              should: [
                                { match: { 'confirm_deposit.transfer_id': transfer_id } },
                                { match: { 'vote.transfer_id': transfer_id } },
                                { match: { transfer_id } },
                              ],
                              minimum_should_match: 1,
                            },
                          },
                          {
                            size: 100,
                          },
                        );
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
                          for (let i = 0; i < ids.length; i++) {
                            const id = ids[i];
                            const transfer = transfers[i];
                            const transfer_source = transfer?.source;
                            const _id = `${transfer_source.id}_${transfer_source.recipient_address}`.toLowerCase();
                            const data = {
                              ...transfer,
                              sign_batch,
                            };
                            if (transfer_source) {
                              transfer_source.sender_chain = normalize_chain(cosmos_non_axelarnet_chains_data.find(c => transfer_source.sender_address?.startsWith(c?.prefix_address))?.id || transfer_source.sender_chain);
                              data.source = transfer_source;
                            }
                            await write(
                              'transfers',
                              _id,
                              data,
                            );
                          }
                        }
                      }
                    }
                  }
                  await write(
                    'batches',
                    output.id,
                    output,
                  );
                  res.data.stdout = JSON.stringify(output);
                }
              }
              // save
              if (cache && !cache_hit && cache_id?.startsWith('axelard')) {
                await write(
                  'axelard',
                  cache_id,
                  {
                    ...res.data,
                    updated_at: moment().unix(),
                  },
                );
              }
            }
            else if (response_cache) {
              res = { data: response_cache };
            }
            res.data.cache_hit = cache_hit;
          }
          break;
        case 'index':
          try {
            response = await crud(params);
          } catch (error) {
            response = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'assets':
          try {
            response = await assets_price(params);
          } catch (error) {
            response = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'coingecko':
          try {
            response = await coingecko(
              path,
              params,
            );
          } catch (error) {
            response = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'ens':
          try {
            response = await ens(
              path,
              params,
            );
          } catch (error) {
            response = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'data':
          switch (collection) {
            case 'chains':
              response = require('./data')?.chains?.[environment];
              break;
            case 'evm_chains':
              response = evm_chains_data;
              break;
            case 'cosmos_chains':
              response = cosmos_chains_data;
              break;
            case 'assets':
              response = assets_data;
              break;
          };
          break;
        default:
          break;
      }

      if (!response && res?.data) {
        response = res.data;
      }
      break;
    case '/cross-chain/{function}':
      switch (req.params.function?.toLowerCase()) {
        case 'transfers':
          try {
            response = await searchTransfers(params);
          } catch (error) {
            response = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'transfers-status':
          try {
            response = await getTransfersStatus(params);
          } catch (error) {
            response = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
          break;
        case 'transfers-stats':
          try {
            response = await searchTransfersStats(params);
          } catch (error) {
            response = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'chains':
          response = {
            ...require('./data')?.chains?.[environment],
          };
          break;
        case 'assets':
          response = assets_data
            .map(a => Object.fromEntries(
              Object.entries({ ...a })
                .filter(([k, v]) => !['coingecko_id'].includes(k))
              )
            );
          break;
        case 'tvl':
          try {
            response = await tvl(params);
          } catch (error) {
            response = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        default:
          break;
      }
      break;
    case '/{function}':
      switch (req.params.function?.toLowerCase()) {
        case 'evm-votes':
          try {
            response = await require('./services/evm-votes')(params);
          } catch (error) {
            response = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'heartbeats':
          try {
            response = await require('./services/heartbeats')(params);
          } catch (error) {
            response = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        default:
          break;
      }
      break;
    // internal
    case '/gateway/{function}':
      switch (req.params.function?.toLowerCase()) {
        case 'save-event':
          try {
            response = await saveEvent(params);
          } catch (error) {
            response = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'latest-event-block':
          try {
            response = await getLatestEventBlock(params);
          } catch (error) {
            response = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        case 'token-sent':
          try {
            response = await searchTokenSent(params);
          } catch (error) {
            response = {
              error: true,
              code: 400,
              message: error?.message,
            };
          }
          break;
        default:
          break;
      }
      break;
    default:
      if (!req.url) {
        await require('./services/archiver')();
      }
      break;
  }

  if (response?.error?.config) {
    delete response.error.config;
  }

  return response;
};