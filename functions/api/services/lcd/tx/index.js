const {
  BigNumber,
  Contract,
  utils: { formatUnits, parseUnits },
} = require('ethers');
const axios = require('axios');
const _ = require('lodash');
const moment = require('moment');
const config = require('config-yml');
const {
  get,
  read,
  write,
} = require('../../index');
const {
  saveTimeSpent,
} = require('../../transfers/utils');
const rpc = require('../../rpc');
const assets_price = require('../../assets-price');
const {
  sleep,
  capitalize,
  equals_ignore_case,
  to_json,
  to_hex,
  get_granularity,
  normalize_original_chain,
  normalize_chain,
  transfer_actions,
  vote_types,
  getBlockTime,
  getProvider,
} = require('../../../utils');
const IAxelarGateway = require('../../../data/contracts/interfaces/IAxelarGateway.json');

const environment = process.env.ENVIRONMENT || config?.environment;

const evm_chains_data = require('../../../data')?.chains?.[environment]?.evm || [];
const cosmos_chains_data = require('../../../data')?.chains?.[environment]?.cosmos || [];
const chains_data = _.concat(
  evm_chains_data,
  cosmos_chains_data,
);
const axelarnet = chains_data.find(c => c?.id === 'axelarnet');
const cosmos_non_axelarnet_chains_data = cosmos_chains_data.filter(c => c?.id !== axelarnet.id);
const assets_data = require('../../../data')?.assets?.[environment] || [];

const {
  endpoints,
  num_blocks_per_heartbeat,
  fraction_heartbeat_block,
} = { ...config?.[environment] };

module.exports = async (
  lcd_response = {},
) => {
  let response;

  const {
    tx_response,
    tx,
  } = { ...lcd_response };

  if (tx_response) {
    const {
      txhash,
      code,
      timestamp,
      logs,
    } = { ...tx_response };
    let {
      height,
    } = { ...tx_response };
    const {
      signatures,
    } = { ...tx };
    const {
      messages,
    } = { ...tx?.body };

    // normalize
    height = Number(height);
    tx_response.height = height;

    /* start custom evm deposit confirmation */
    const log_index = logs?.findIndex(l => l?.events?.findIndex(e => equals_ignore_case(e?.type, 'depositConfirmation')) > -1);
    if (log_index > -1) {
      const log = logs?.[log_index];
      const {
        events,
      } = { ...log };

      const event_index = events.findIndex(e => equals_ignore_case(e?.type, 'depositConfirmation'));
      const event = events[event_index];

      const {
        attributes,
      } = { ...event };

      const chain = attributes?.find(a => a?.key === 'chain')?.value;
      const token_address = attributes?.find(a => a?.key === 'tokenAddress')?.value;

      if (chain && token_address) {
        const chain_data = evm_chains_data.find(c => equals_ignore_case(c?.id, chain));
        const {
          chain_id,
        } = { ...chain_data };

        const asset_data = assets_data.find(a => a?.contracts?.findIndex(c => c?.chain_id === chain_id && equals_ignore_case(c?.contract_address, token_address)) > -1);
        const {
          id,
        } = { ...asset_data };

        if (id) {
          tx_response.denom = id;
        }
      }

      const amount_index = attributes?.findIndex(a => a?.key === 'amount');
      if (amount_index > -1) {
        let attr = attributes[amount_index];
        const {
          value,
        } = { ...attr };

        const _value = value.split('');
        let amount = '';

        for (const c of _value) {
          if (!isNaN(c)) {
            amount = `${amount}${c}`;
          }
          else {
            break;
          }
        }

        logs[log_index].events[event_index].attributes[amount_index].value = amount;
        tx_response.logs = logs;
        tx_response.raw_log = JSON.stringify(logs);
      }

      lcd_response.tx_response = tx_response;
    }
    /* end custom evm deposit confirmation */

    /***************************
     * start index transaction *
     ***************************/
    const transaction_data = _.cloneDeep(tx_response);

    delete transaction_data.data;
    delete transaction_data.raw_log;
    delete transaction_data.events;

    transaction_data.timestamp = moment(timestamp).utc().valueOf();

    /* start convert byte array to hex */
    if (messages) {
      if (
        [
          'LinkRequest',
        ].findIndex(s =>
          messages.findIndex(m => m?.['@type']?.includes(s)) > -1
        ) > -1
      ) {
        for (let i = 0; i < messages.length; i++) {
          const message = messages[i];

          message.denom = message.asset;
          delete message.asset;

          messages[i] = message;
        }
      }
      else if (
        [
          'ConfirmDepositRequest',
          'ConfirmGatewayTxRequest',
          'ConfirmTransferKeyRequest',
          'ConfirmTokenRequest',
          'CreateDeployTokenRequest',
        ].findIndex(s =>
          messages.findIndex(m => m?.['@type']?.includes(s)) > -1
        ) > -1
      ) {
        const fields = [
          'tx_id',
          'burner_address',
          'burn_address',
          'address',
        ];

        for (let i = 0; i < messages.length; i++) {
          const message = messages[i];

          if (typeof message?.amount === 'string') {
            const event = _.head(logs.flatMap(l => l?.events?.filter(e => equals_ignore_case(e?.type, 'depositConfirmation'))));
            const {
              attributes,
            } = { ...event };

            const amount = attributes?.find(a => a?.key === 'amount')?.value;
            const denom = transaction_data.denom || message.denom;

            message.amount = [{
              amount,
              denom,
            }];
          }

          for (const field of fields) {
            if (Array.isArray(message[field])) {
              message[field] = to_hex(message[field]);
            }
          }

          messages[i] = message;
        }
      }
      else if (
        [
          'VoteRequest',
        ].findIndex(s =>
          messages.findIndex(m => m?.['@type']?.includes(s) || m?.inner_message?.['@type']?.includes(s)) > -1
        ) > -1
      ) {
        const fields = [
          'tx_id',
          'to',
          'sender',
          'payload_hash',
          'pre_operators',
          'new_operators',
        ];

        for (let i = 0; i < messages.length; i++) {
          const message = messages[i];

          const {
            results,
            result,
            events,
          } = { ...message?.inner_message?.vote };

          if (results) {
            for (let j = 0; j < results.length; j++) {
              const result = results[j];

              if (result) {
                for (const field of fields) {
                  if (Array.isArray(result[field])) {
                    result[field] = to_hex(result[field]);
                  }
                  if (Array.isArray(result.transfer?.[field])) {
                    result.transfer[field] = to_hex(result.transfer[field]);
                  }
                }
              }

              results[j] = result;
            }

            message.inner_message.vote.results = results;
          }

          if (result?.events) {
            for (let j = 0; j < result.events.length; j++) {
              const event = result.events[j];

              if (event) {
                for (const field of fields) {
                  if (Array.isArray(event[field])) {
                    event[field] = to_hex(event[field]);
                  }
                  if (Array.isArray(event.transfer?.[field])) {
                    event.transfer[field] = to_hex(event.transfer[field]);
                  }
                  if (Array.isArray(event.contract_call?.[field])) {
                    event.contract_call[field] = to_hex(event.contract_call[field]);
                  }
                  if (Array.isArray(event.contract_call_with_token?.[field])) {
                    event.contract_call_with_token[field] = to_hex(event.contract_call_with_token[field]);
                  }
                  if (Array.isArray(event.token_sent?.[field])) {
                    event.token_sent[field] = to_hex(event.token_sent[field]);
                  }
                  if (Array.isArray(event.multisig_operatorship_transferred?.[field])) {
                    event.multisig_operatorship_transferred[field] = to_hex(event.multisig_operatorship_transferred[field]);
                  }
                }
              }

              result.events[j] = event;
            }

            message.inner_message.vote.result = result;
          }

          if (events) {
            for (let j = 0; j < events.length; j++) {
              const event = events[j];

              if (event) {
                for (const field of fields) {
                  if (Array.isArray(event[field])) {
                    event[field] = to_hex(event[field]);
                  }
                  if (Array.isArray(event.transfer?.[field])) {
                    event.transfer[field] = to_hex(event.transfer[field]);
                  }
                  if (Array.isArray(event.contract_call?.[field])) {
                    event.contract_call[field] = to_hex(event.contract_call[field]);
                  }
                  if (Array.isArray(event.contract_call_with_token?.[field])) {
                    event.contract_call_with_token[field] = to_hex(event.contract_call_with_token[field]);
                  }
                  if (Array.isArray(event.token_sent?.[field])) {
                    event.token_sent[field] = to_hex(event.token_sent[field]);
                  }
                  if (Array.isArray(event.multisig_operatorship_transferred?.[field])) {
                    event.multisig_operatorship_transferred[field] = to_hex(event.multisig_operatorship_transferred[field]);
                  }
                }
              }

              events[j] = event;
            }

            message.inner_message.vote.events = events;
          }

          messages[i] = message;
        }
      }

      tx.body.messages = messages;
      transaction_data.tx = tx;
    }
    /* end convert byte array to hex */

    tx_response.tx = tx;
    lcd_response.tx_response = tx_response;
    lcd_response.tx = tx;

    /* start add addresses field */
    let addresses = [];

    const address_fields = [
      'signer',
      'sender',
      'recipient',
      'spender',
      'receiver',
      'depositAddress',
      'voter',
      'delegator_address',
    ];

    if (logs) {
      addresses = _.uniq(
        _.concat(
          addresses,
          logs.flatMap(l =>
            l?.events?.flatMap(e =>
              e?.attributes?.filter(a => address_fields.includes(a?.key))
                .map(a => a.value) || []
            ) || []
          ),
        ).filter(a => typeof a === 'string' && a.startsWith(axelarnet.prefix_address))
      );
    }

    if (messages) {
      addresses = _.uniq(
        _.concat(
          addresses,
          messages.flatMap(m =>
            _.concat(
              address_fields.map(f => m[f]),
              address_fields.map(f => m.inner_message?.[f]),
            )
          ),
        ).filter(a => typeof a === 'string' && a.startsWith(axelarnet.prefix_address))
      );
    }

    transaction_data.addresses = addresses;
    /* end add addresses field */

    /* start add message types field */
    let types = [];

    // inner message type
    if (messages) {
      types = _.uniq(
        _.concat(
          types,
          messages.flatMap(m => m?.inner_message?.['@type']),
        ).filter(t => t)
      );
    }

    // message action
    if (logs) {
      types = _.uniq(
        _.concat(
          types,
          logs.flatMap(l =>
            l?.events?.filter(e => equals_ignore_case(e?.type, 'message'))
              .flatMap(e =>
                e.attributes?.filter(a => a?.key === 'action')
                  .map(a => a.value) || []
              ) || []
          ),
        ).filter(t => t)
      );
    }

    // message type
    if (messages) {
      types = _.uniq(
        _.concat(
          types,
          messages.flatMap(m => m?.['@type']),
        ).filter(t => t)
      );
    }

    types = _.uniq(
      types.map(t => capitalize(
        _.last(t.split('.'))
      ))
    );
    types = types.filter(t => !types.includes(`${t}Request`));

    transaction_data.types = types;
    /* end add message types field */

    await write(
      'txs',
      txhash,
      transaction_data,
    );
    /*************************
     * end index transaction *
     *************************/

    /* start index validator metrics & transfers */
    if (
      !code &&
      tx_response &&
      messages
    ) {
      // Heartbeat
      if (
        [
          'HeartBeatRequest',
        ].findIndex(s =>
          messages.findIndex(m => m?.inner_message?.['@type']?.includes(s)) > -1
        ) > -1
      ) {
        const record = {
          txhash,
          height,
          period_height: height - ((height % num_blocks_per_heartbeat) || num_blocks_per_heartbeat) + fraction_heartbeat_block,
          timestamp: moment(timestamp).utc().valueOf(),
          signatures,
          sender: _.head(messages.map(m => m?.sender)),
          key_ids: _.uniq(messages.flatMap(m => m?.inner_message?.key_ids || [])),
        };

        const {
          sender,
          period_height,
        } = { ...record };

        if (sender) {
          await write(
            'heartbeats',
            `${sender}_${period_height}`,
            record,
          );
        }
      }
      // Link
      else if (
        [
          'LinkRequest',
        ].findIndex(s =>
          messages.findIndex(m => m?.['@type']?.includes(s)) > -1
        ) > -1
      ) {
        const event = _.head(logs?.flatMap(l => l?.events?.filter(e => equals_ignore_case(e?.type, 'link'))));
        const {
          attributes,
        } = { ...event };

        let sender_chain = attributes?.find(a => a?.key === 'sourceChain')?.value;
        const deposit_address = attributes?.find(a => a?.key === 'depositAddress')?.value;

        const record = {
          ..._.head(messages),
          txhash,
          height,
          sender_chain,
          deposit_address,
        };

        const {
          sender,
          chain,
          recipient_addr,
          asset,
          denom,
        } = { ...record };
        let {
          id,
          type,
          original_sender_chain,
          original_recipient_chain,
          sender_address,
          recipient_address,
          recipient_chain,
          price,
        } = { ...record };

        if (equals_ignore_case(sender_chain, axelarnet.id)) {
          const chain_data = cosmos_non_axelarnet_chains_data.find(c => sender_address?.startsWith(c?.prefix_address));
          const {
            id,
            overrides,
          } = { ...chain_data };

          sender_chain = _.last(Object.keys({ ...overrides })) ||
            id ||
            sender_chain;
        }

        id = deposit_address || txhash;
        type = record['@type']?.split('.')[0]?.replace('/', '');
        original_sender_chain = normalize_original_chain(sender_chain);
        original_recipient_chain = normalize_original_chain(recipient_chain);
        sender_address = sender;

        if (
          sender_address?.startsWith(axelarnet.prefix_address) &&
          (
            evm_chains_data.findIndex(c => equals_ignore_case(c?.id, sender_chain)) > -1 ||
            cosmos_chains_data.findIndex(c => equals_ignore_case(c?.id, sender_chain)) > -1
          )
        ) {
          const _response = await read(
            'transfers',
            {
              bool: {
                must: [
                  { match: { 'source.recipient_address': deposit_address } },
                  { match: { 'source.sender_chain': sender_chain } },
                ],
              },
            },
            {
              size: 1,
            },
          );

          const {
            source,
          } = { ..._.head(_response?.data) };

          if (source?.sender_address) {
            sender_address = source.sender_address;
          }
        }

        sender_chain = normalize_chain(
          cosmos_non_axelarnet_chains_data.find(c => sender_address?.startsWith(c?.prefix_address))?.id ||
          sender_chain ||
          chain
        );
        if (!original_sender_chain?.startsWith(sender_chain)) {
          original_sender_chain = sender_chain;
        }
        recipient_address = recipient_addr;
        recipient_chain = normalize_chain(recipient_chain);

        delete record['@type'];
        delete record.sender;
        delete record.chain;
        delete record.recipient_addr;

        if (
          typeof price !== 'number' &&
          (asset || denom)
        ) {
          let _response = await assets_price({
            chain: original_sender_chain,
            denom: asset || denom,
            timestamp: moment(timestamp).utc().valueOf(),
          });

          let _price = _.head(_response)?.price;
          if (_price) {
            price = _price;
          }
          else {
            _response = await get(
              'deposit_addresses',
              id,
            );

            _price = _.head(_response)?.price;
            if (_price) {
              price = _price;
            }
          }
        }

        await write(
          'deposit_addresses',
          id,
          {
            ...record,
            id,
            type,
            original_sender_chain,
            original_recipient_chain,
            sender_chain,
            recipient_chain,
            sender_address,
            deposit_address,
            recipient_address,
            price,
          },
        );
      }
      // MsgSend
      else if (
        [
          'MsgSend',
        ].findIndex(s =>
          messages.findIndex(m => m?.['@type']?.includes(s)) > -1
        ) > -1
      ) {
        const created_at = moment(timestamp).utc().valueOf();
        const amount_data = _.head(messages.find(m => m?.amount)?.amount);

        const record = {
          id: txhash,
          type: 'axelarnet_transfer',
          status_code: code,
          status: code ?
            'failed' :
            'success',
          height,
          created_at: get_granularity(created_at),
          sender_chain: axelarnet.id,
          sender_address: messages.find(m => m?.from_address)?.from_address,
          recipient_address: messages.find(m => m?.to_address)?.to_address,
          amount: amount_data?.amount,
          denom: amount_data?.denom,
        };

        const {
          recipient_address,
        } = { ...record };
        let {
          amount,
        } = { ...record };

        if (recipient_address?.length >= 65 && txhash && amount) {
          const _response = await read(
            'deposit_addresses',
            {
              match: { deposit_address: recipient_address },
            },
            {
              size: 1,
            },
          );

          const link = _.head(_response?.data);
          const {
            id,
            original_sender_chain,
            original_recipient_chain,
            sender_chain,
            recipient_chain,
            asset,
            denom,
          } = { ...link };
          let {
            price,
          } = { ...link };

          if (link && !price) {
            const __response = await assets_price({
              chain: original_sender_chain,
              denom: asset || denom,
              timestamp: created_at,
            });

            const _price = _.head(__response)?.price;
            if (_price) {
              price = _price;
              link.price = price;

              await write(
                'deposit_addresses',
                id,
                link,
              );
            }
          }

          record.original_sender_chain = original_sender_chain ||
            normalize_original_chain(
              record.sender_chain ||
              sender_chain
            );
          record.original_recipient_chain = original_recipient_chain ||
            normalize_original_chain(
              record.recipient_chain ||
              recipient_chain
            );

          if (link) {
            record.sender_chain = sender_chain ||
              record.sender_chain;
            record.recipient_chain = recipient_chain ||
              record.recipient_chain;
            record.denom = record.denom ||
              asset;
          }

          if (record.denom) {
            const asset_data = assets_data.find(a =>
              equals_ignore_case(a?.id, record.denom) ||
              a?.ibc?.findIndex(i => i?.chain_id === record.sender_chain && equals_ignore_case(i?.ibc_denom, record.denom)) > -1
            );

            if (asset_data) {
              const {
                ibc,
              } = { ...asset_data };
              let {
                decimals,
              } = { ...asset_data };

              decimals = ibc?.find(i => i?.chain_id === record.sender_chain)?.decimals || decimals || 6;

              if (!record.fee && endpoints?.lcd) {
                const lcd = axios.create({ baseURL: endpoints.lcd });

                const __response = await lcd.get(
                  '/axelar/nexus/v1beta1/transfer_fee',
                  {
                    params: {
                      source_chain: record.original_sender_chain,
                      destination_chain: record.original_recipient_chain,
                      amount: `${parseUnits((amount || 0).toString(), decimals).toString()}${asset_data.id}`,
                    },
                  },
                ).catch(error => { return { data: { error } }; });

                const {
                  fee,
                } = { ...__response?.data };

                if (fee?.amount) {
                  record.fee = Number(
                    formatUnits(
                      BigNumber.from(fee.amount).toString(),
                      decimals
                    )
                  );
                }
              }

              if (typeof amount === 'string') {
                amount = Number(
                  formatUnits(
                    BigNumber.from(amount).toString(),
                    decimals
                  )
                );
              }

              if (typeof amount === 'number' && typeof record.fee === 'number') {
                if (amount < record.fee) {
                  record.insufficient_fee = true;
                }
                else {
                  record.amount_received = amount - record.fee;
                }
              }

              record.denom = asset_data.id ||
                record.denom;
            }
          }

          if (price && typeof amount === 'number') {
            record.value = amount * price;
          }

          await write(
            'transfers',
            `${txhash}_${recipient_address}`.toLowerCase(),
            {
              source: {
                ...record,
                amount,
              },
              link: link ||
                undefined,
            },
          );
        }
      }
      // MsgRecvPacket -> MsgTransfer
      else if (
        [
          'MsgRecvPacket',
        ].findIndex(s =>
          messages.findIndex(m => m?.['@type']?.includes(s)) > -1
        ) > -1
      ) {
        const {
          chain_id,
        } = { ...messages.find(m => m?.['@type']?.includes('MsgUpdateClient'))?.header?.signer_header?.header };

        const recv_packets = (logs || [])
          .map(l => {
            const {
              events,
            } = { ...l };

            return {
              ...events?.find(e => equals_ignore_case(e?.type, 'recv_packet')),
              height: Number(
                messages.find(m => _.last(m?.['@type']?.split('.')) === 'MsgRecvPacket')?.proof_height?.revision_height ||
                '0'
              ) - 1,
            };
          })
          .filter(e => e.height > 0 && e.attributes?.length > 0)
          .map(e => {
            let {
              attributes,
            } = { ...e };

            attributes = attributes
              .filter(a => a?.key && a.value);

            const packet_data = to_json(attributes.find(a => a?.key === 'packet_data')?.value);
            const packet_data_hex = attributes.find(a => a?.key === 'packet_data_hex')?.value;
            const packet_sequence = attributes.find(a => a?.key === 'packet_sequence')?.value;

            return {
              ...e,
              packet_data,
              packet_data_hex,
              packet_sequence,
            };
          })
          .filter(e => e.packet_data && typeof e.packet_data === 'object');

        for (const record of recv_packets) {
          const {
            height,
            packet_data,
            packet_data_hex,
            packet_sequence,
          } = { ...record };

          for (const chain_data of cosmos_chains_data) {
            const {
              prefix_address,
            } = { ...chain_data };

            if (packet_data.sender?.startsWith(prefix_address)) {
              let found = false;

              const _lcds = _.concat(
                [chain_data?.endpoints?.lcd],
                chain_data?.endpoints?.lcds || [],
              ).filter(l => l);

              for (const _lcd of _lcds) {
                const lcd = axios.create({ baseURL: _lcd });

                let _response = await lcd.get(
                  `/cosmos/tx/v1beta1/txs?limit=5&events=${encodeURIComponent(`send_packet.packet_data_hex='${packet_data_hex}'`)}&events=tx.height=${height}`,
                ).catch(error => { return { data: { error } }; });

                let {
                  tx_responses,
                  txs,
                } = { ..._response?.data };

                if (tx_responses?.length < 1) {
                  _response = await lcd.get(
                    `/cosmos/tx/v1beta1/txs?limit=5&events=send_packet.packet_sequence=${packet_sequence}&events=tx.height=${height}`,
                  ).catch(error => { return { data: { error } }; });

                  if (_response?.data) {
                    tx_responses = _response.data.tx_responses;
                    txs = _response.data.txs;
                  }
                }

                const index = tx_responses?.findIndex(t => {
                  const send_packet = _.head(
                    t?.logs?.flatMap(l => l?.events?.filter(e => equals_ignore_case(e?.type, 'send_packet')))
                  );
                  const {
                    attributes,
                  } = { ...send_packet };

                  return packet_sequence === attributes?.find(a => a?.key === 'packet_sequence')?.value;
                });

                if (index > -1) {
                  const _data = {
                    ...tx_responses[index],
                    tx: {
                      ...txs?.[index],
                    },
                  };

                  const {
                    txhash,
                    code,
                    height,
                    timestamp,
                  } = { ..._data };
                  const {
                    messages,
                  } = { ..._data.tx.body };

                  if (messages) {
                    const created_at = moment(timestamp).utc().valueOf();
                    const amount_data = messages.find(m => m?.token)?.token;

                    const _record = {
                      id: txhash,
                      type: 'ibc_transfer',
                      status_code: code,
                      status: code ?
                        'failed' :
                        'success',
                      height,
                      created_at: get_granularity(created_at),
                      sender_chain: chain_data.id,
                      sender_address: messages.find(m => m?.sender)?.sender,
                      recipient_address: messages.find(m => m?.receiver)?.receiver,
                      amount: amount_data?.amount,
                      denom: amount_data?.denom,
                    };

                    const {
                      sender_address,
                      recipient_address,
                    } = { ..._record };
                    let {
                      amount,
                    } = { ..._record };

                    if (
                      recipient_address?.length >= 65 &&
                      txhash &&
                      amount
                    ) {
                      const _response = await read(
                        'deposit_addresses',
                        {
                          match: { deposit_address: recipient_address },
                        },
                        {
                          size: 1,
                        },
                      );

                      const link = _.head(_response?.data);
                      const {
                        id,
                        original_recipient_chain,
                        sender_chain,
                        recipient_chain,
                        asset,
                        denom,
                      } = { ...link };
                      let {
                        original_sender_chain,
                        price,
                      } = { ...link };

                      if (link) {
                        _record.recipient_chain = recipient_chain;
                        _record.denom = _record.denom ||
                          asset;
                      }

                      let link_updated = false;

                      if (
                        equals_ignore_case(original_sender_chain, axelarnet.id) ||
                        cosmos_non_axelarnet_chains_data.findIndex(c => c?.overrides?.[original_sender_chain]) > -1
                      ) {
                        const chain_data = cosmos_non_axelarnet_chains_data.find(c => sender_address?.startsWith(c?.prefix_address));
                        const {
                          overrides,
                        } = { ...chain_data };

                        if (chain_data) {
                          original_sender_chain = Object.values({ ...overrides }).find(o => o?.prefix_chain_ids?.findIndex(p => chain_id?.startsWith(p)) > -1 || o?.endpoints?.lcd === _lcd || o?.endpoints?.lcds?.includes(_lcd))?.id ||
                            _.last(Object.keys({ ...overrides })) ||
                            chain_data.id;

                          if (link) {
                            link_updated = link.original_sender_chain !== original_sender_chain;
                            link.original_sender_chain = original_sender_chain;
                          }
                        }
                      }

                      if (link && !price) {
                        const __response = await assets_price({
                          chain: original_sender_chain,
                          denom: asset || denom,
                          timestamp: created_at,
                        });

                        const _price = _.head(__response)?.price;
                        if (_price) {
                          price = _price;
                          link.price = price;
                          link_updated = true;
                        }
                      }

                      if (link_updated) {
                        await write(
                          'deposit_addresses',
                          id,
                          link,
                        );
                      }

                      _record.original_sender_chain = original_sender_chain ||
                        normalize_original_chain(
                          _record.sender_chain ||
                          sender_chain
                        );
                      _record.original_recipient_chain = original_recipient_chain ||
                        normalize_original_chain(
                          _record.recipient_chain ||
                          recipient_chain
                        );

                      if (_record.denom) {
                        const asset_data = assets_data.find(a =>
                          equals_ignore_case(a?.id, _record.denom) ||
                          a?.ibc?.findIndex(i => i?.chain_id === _record.sender_chain && equals_ignore_case(i?.ibc_denom, _record.denom)) > -1);

                        if (asset_data) {
                          const {
                            ibc,
                          } = { ...asset_data };
                          let {
                            decimals,
                          } = { ...asset_data };

                          decimals = ibc?.find(i => i?.chain_id === _record.sender_chain)?.decimals || decimals || 6;

                          if (!_record.fee && endpoints?.lcd) {
                            const lcd = axios.create({ baseURL: endpoints.lcd });

                            const __response = await lcd.get(
                              '/axelar/nexus/v1beta1/transfer_fee',
                              {
                                params: {
                                  source_chain: _record.original_sender_chain,
                                  destination_chain: _record.original_recipient_chain,
                                  amount: `${parseUnits((amount || 0).toString(), decimals).toString()}${asset_data.id}`,
                                },
                              },
                            ).catch(error => { return { data: { error } }; });

                            const {
                              fee,
                            } = { ...__response?.data };

                            if (fee?.amount) {
                              _record.fee = Number(
                                formatUnits(
                                  BigNumber.from(fee.amount).toString(),
                                  decimals
                                )
                              );
                            }
                          }

                          if (typeof amount === 'string') {
                            amount = Number(
                              formatUnits(
                                BigNumber.from(amount).toString(),
                                decimals
                              )
                            );
                          }

                          if (typeof amount === 'number' && typeof _record.fee === 'number') {
                            if (amount < _record.fee) {
                              _record.insufficient_fee = true;
                            }
                            else {
                              _record.amount_received = amount - _record.fee;
                            }
                          }

                          _record.denom = asset_data.id ||
                            _record.denom;
                        }
                      }

                      if (price && typeof amount === 'number') {
                        _record.value = amount * price;
                      }

                      await write(
                        'transfers',
                        `${txhash}_${recipient_address}`.toLowerCase(),
                        {
                          source: {
                            ..._record,
                            amount,
                          },
                          link: link ||
                            undefined,
                        },
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
      // RouteIBCTransfersRequest -> ibc_send
      else if (
        [
          'RouteIBCTransfersRequest',
        ].findIndex(s =>
          messages.findIndex(m => m?.['@type']?.includes(s)) > -1
        ) > -1
      ) {
        if (
          logs?.length > 0 &&
          logs.findIndex(l => l?.events?.findIndex(e => equals_ignore_case(e?.type, 'send_packet')) > -1) < 0 &&
          height
        ) {
          const _response = await rpc(
            '/block_results',
            {
              height,
            },
          );

          const {
            end_block_events,
          } = { ..._response };

          const events = end_block_events?.filter(e =>
            equals_ignore_case(e?.type, 'send_packet') &&
            e.attributes?.length > 0
          );

          for (const event of events) {
            const {
              attributes,
            } = { ...event };

            const packet_data = to_json(attributes?.find(a => a?.key === 'packet_data')?.value);

            const {
              sender,
            } = { ...packet_data };

            if (sender &&
              logs.findIndex(l =>
                l?.events?.findIndex(e =>
                  e?.attributes?.findIndex(a =>
                    [
                      'minter',
                      'receiver',
                    ].includes(a?.key) &&
                    equals_ignore_case(a.value, sender)
                  ) > -1  ||
                  (
                    e?.attributes?.findIndex(a => a?.value === 'RouteIBCTransfers') > -1 &&
                    events.length === 1
                  )
                ) > -1
              ) > -1
            ) {
              logs[0] = {
                ..._.head(logs),
                events: _.concat(
                  _.head(logs).events,
                  event,
                ).filter(e => e),
              };
            }
          }
        }

        const send_packets = (logs || [])
          .flatMap(l => l?.events?.filter(e => equals_ignore_case(e?.type, 'send_packet')))
          .filter(e => e?.attributes?.length > 0)
          .flatMap(e => {
            let {
              attributes,
            } = { ...e };

            attributes = attributes
              .filter(a => a?.key && a.value);

            const events = [];
            let event;

            attributes.forEach((a, i) => {
              const {
                key,
                value,
              } = { ...a };

              if (
                ['packet_data'].includes(key) ||
                i === attributes.length - 1
              ) {
                if (event) {
                  events.push(event);
                }
                event = {};
              }

              event = {
                ...event,
                [key]: ['packet_data'].includes(key) ?
                  to_json(value) :
                  value,
              };
            });

            return events;
          })
          .filter(e => e.packet_data?.amount)
          .map(e => {
            const {
              packet_data,
            } = { ...e };
            const {
              sender,
              receiver,
              amount,
              denom,
            } = { ...packet_data };

            const created_at = moment(timestamp).utc().valueOf();
            const asset_data = assets_data.find(a =>
              equals_ignore_case(a?.id, denom) ||
              a?.ibc?.findIndex(i => i?.chain_id === axelarnet.id && equals_ignore_case(i?.ibc_denom, denom)) > -1
            );
            const {
              ibc,
            } = { ...asset_data };
            let {
              decimals,
            } = { ...asset_data };

            decimals = ibc?.find(i => i?.chain_id === axelarnet.id)?.decimals || decimals || 6;

            const record = {
              id: txhash,
              type: 'RouteIBCTransfersRequest',
              status_code: code,
              status: code ?
                'failed' :
                'success',
              height,
              created_at: get_granularity(created_at),
              sender_address: sender,
              recipient_address: receiver,
              amount: Number(
                formatUnits(
                  BigNumber.from(amount).toString(),
                  decimals
                )
              ),
              denom,
              packet: e,
            };

            return record;
          });

        for (const record of send_packets) {
          const {
            id,
            created_at,
            recipient_address,
            amount,
            denom,
          } = { ...record };
          const {
            ms,
          } = { ...created_at };

          let _response = await read(
            'transfers',
            {
              bool: {
                must: [
                  { match: { 'ibc_send.id': id } },
                  { match: { 'ibc_send.recipient_address': recipient_address } },
                  { match: { 'ibc_send.denom': denom } },
                ],
              },
            },
            {
              size: 1,
            },
          );

          if (_response?.data?.filter(d => typeof d?.source?.amount_received === 'number').length < 1) {
            _response = await read(
              'transfers',
              {
                bool: {
                  must: [
                    { match: { 'source.status_code': 0 } },
                    { match: { 'link.recipient_address': recipient_address } },
                    { range: { 'source.created_at.ms': { lte: ms, gte: moment(ms).subtract(24, 'hours').valueOf() } } },
                    { range: { 'source.amount': { gte: Math.floor(amount) } } },
                    {
                      bool: {
                        should: [
                          { match: { 'source.amount_received': amount } },
                          {
                            bool: {
                              must: [
                                { range: { 'source.amount': { lte: Math.ceil(amount * 2) } } },
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
                    { match: { 'source.denom': denom } },
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
                sort: [{ 'source.created_at.ms': 'desc' }],
              },
            );

            if (_response?.data?.length > 0) {
              const {
                source,
              } = { ..._.head(_response.data) };
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
                true,
              );

              await saveTimeSpent(
                _id,
              );
            }
          }
          else {
            const data = _.head(_response?.data);
            const {
              source,
              ibc_send,
            } = { ...data };
            const {
              id,
              recipient_address,
            } = { ...source };

            if (
              data &&
              !_.isEqual(ibc_send, record)
            ) {
              const _id = `${id}_${recipient_address}`.toLowerCase();

              await write(
                'transfers',
                _id,
                {
                  ibc_send: record,
                },
                true,
              );

              await saveTimeSpent(
                _id,
              );
            }
          }
        }
      }
      // MsgAcknowledgement -> ibc_ack
      else if (
        [
          'MsgAcknowledgement',
        ].findIndex(s =>
          messages.findIndex(m => m?.['@type']?.includes(s)) > -1
        ) > -1
      ) {
        const ack_packets = logs?.map(l => l?.events?.find(e => equals_ignore_case(e?.type, 'acknowledge_packet')))
          .filter(e => e?.attributes?.length > 0)
          .map(e => {
            const {
              attributes,
            } = { ...e };

            return Object.fromEntries(
              attributes
                .filter(a => a?.key && a.value)
                .map(a =>
                  [
                    a.key,
                    a.value,
                  ]
                )
            );
          })
          .filter(e => e.packet_sequence)
          .map(e => {
            return {
              ...e,
              id: txhash,
              height: Number(
                messages.find(m => _.last(m?.['@type']?.split('.')) === 'MsgAcknowledgement')?.proof_height?.revision_height ||
                '0'
              ) - 1,
            };
          }) || [];

        for (const record of ack_packets) {
          const {
            id,
            height,
            packet_timeout_height,
            packet_sequence,
            packet_src_channel,
            packet_dst_channel,
            packet_connection,
          } = { ...record };

          const _response = await read(
            'transfers',
            {
              bool: {
                must: [
                  { match: { 'ibc_send.packet.packet_timeout_height': packet_timeout_height } },
                  { match: { 'ibc_send.packet.packet_sequence': packet_sequence } },
                  { match: { 'ibc_send.packet.packet_src_channel': packet_src_channel } },
                  { match: { 'ibc_send.packet.packet_dst_channel': packet_dst_channel } },
                  // { match: { 'ibc_send.packet.packet_connection': packet_connection } },
                ],
                should: [
                  { match: { 'ibc_send.ack_txhash': id } },
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
              sort: [{ 'source.created_at.ms': 'desc' }],
            },
          );

          if (_response?.data?.length > 0) {
            const {
              source,
              link,
              ibc_send,
            } = { ..._.head(_response.data) };
            const {
              id,
              recipient_address,
            } = { ...source };
            let {
              recipient_chain,
            } = { ...source };
            const {
              packet_data_hex,
              packet_sequence,
            } = { ...ibc_send?.packet };

            recipient_chain = recipient_chain ||
              link?.recipient_chain;

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
              true,
            );

            await saveTimeSpent(
              _id,
            );

            if (height && packet_data_hex && recipient_chain) {
              const chain_data = cosmos_non_axelarnet_chains_data.find(c => equals_ignore_case(c?.id, recipient_chain));

              const _lcds = _.concat(
                [chain_data?.endpoints?.lcd],
                chain_data?.endpoints?.lcds || [],
              ).filter(l => l);

              for (const _lcd of _lcds) {
                const lcd = axios.create({ baseURL: _lcd });

                let __response = await lcd.get(
                  `/cosmos/tx/v1beta1/txs?limit=5&events=${encodeURIComponent(`recv_packet.packet_data_hex='${packet_data_hex}'`)}&events=tx.height=${height}`,
                ).catch(error => { return { data: { error } }; });

                let {
                  tx_responses,
                  txs,
                } = { ...__response?.data };

                if (tx_responses?.length < 1) {
                  __response = await lcd.get(
                    `/cosmos/tx/v1beta1/txs?limit=5&events=recv_packet.packet_sequence=${packet_sequence}&events=tx.height=${height}`,
                  ).catch(error => { return { data: { error } }; });

                  if (__response?.data) {
                    tx_responses = __response.data.tx_responses;
                    txs = __response.data.txs;
                  }
                }

                const index = tx_responses?.findIndex(t => {
                  const recv_packet = _.head(
                    t?.logs?.flatMap(l => l?.events?.filter(e => equals_ignore_case(e?.type, 'recv_packet')))
                  );
                  const {
                    attributes,
                  } = { ...recv_packet };

                  return packet_sequence === attributes?.find(a => a?.key === 'packet_sequence')?.value;
                });

                if (index > -1) {
                  const {
                    txhash,
                    timestamp,
                  } = { ...tx_responses[index] };

                  if (txhash) {
                    const received_at = moment(timestamp).utc().valueOf();

                    const _id = `${id}_${recipient_address}`.toLowerCase();

                    await write(
                      'transfers',
                      _id,
                      {
                        ibc_send: {
                          ...ibc_send,
                          ack_txhash: record.id,
                          recv_txhash: txhash,
                          received_at: get_granularity(received_at),
                        },
                      },
                      true,
                    );

                    await saveTimeSpent(
                      _id,
                    );
                  }

                  break;
                }
              }
            }
          }
        }
      }
      // ConfirmDeposit & ConfirmERC20Deposit
      else if (
        transfer_actions.findIndex(s =>
          messages.findIndex(m => _.last(m?.['@type']?.split('.'))?.replace('Request', '')?.includes(s)) > -1
        ) > -1
      ) {
        const message = _.head(logs?.flatMap(l => l?.events?.filter(e => equals_ignore_case(e?.type, 'message'))));
        const event = _.head(logs?.flatMap(l => l?.events?.filter(e => equals_ignore_case(e?.type, 'depositConfirmation') || e?.type?.includes('ConfirmDeposit'))));

        const {
          attributes,
        } = { ...event };

        const type = message?.attributes?.find(a => a?.key === 'action' && transfer_actions.includes(a.value))?.value ||
          _.last(messages.find(m => transfer_actions.includes(_.last(m?.['@type']?.split('.'))?.replace('Request', '')))?.['@type']?.split('.'))?.replace('Request', '');
        const poll_id = to_json(attributes?.find(a => a?.key === 'participants')?.value)?.poll_id ||
          to_json(attributes?.find(a => a?.key === 'poll')?.value)?.id;

        let created_at = moment(timestamp).utc().valueOf();

        let token_address = attributes?.find(a =>
          [
            'token_address',
            'tokenAddress',
          ].includes(a?.key)
        )?.value;
        if (token_address?.startsWith('[') && token_address.endsWith(']')) {
          token_address = to_hex(to_json(token_address));
        }

        let deposit_address = messages.find(m => m?.deposit_address)?.deposit_address ||
          attributes?.find(a =>
            [
              'deposit_address',
              'depositAddress',
            ].includes(a?.key)
          )?.value;
        if (deposit_address?.startsWith('[') && deposit_address.endsWith(']')) {
          deposit_address = to_hex(to_json(deposit_address));
        }

        let transaction_id = attributes?.find(a =>
          [
            'tx_id',
            'txID',
          ].includes(a?.key)
        )?.value ||
          poll_id?.split('_')[0];
        if (transaction_id?.startsWith('[') && transaction_id.endsWith(']')) {
          transaction_id = to_hex(to_json(transaction_id));
        }

        const {
          participants,
        } = { ...to_json(attributes?.find(a => a?.key === 'participants')?.value) };

        const record = {
          id: txhash,
          type,
          status_code: code,
          status: code ?
            'failed' :
            'success',
          height,
          created_at: get_granularity(created_at),
          user: messages.find(m => m?.sender)?.sender,
          module: attributes?.find(a => a?.key === 'module')?.value ||
            (type === 'ConfirmDeposit' ?
              axelarnet.id :
              'evm'
            ),
          sender_chain: normalize_chain(
            messages.find(m => m?.chain)?.chain ||
            attributes?.find(a =>
              [
                'sourceChain',
                'chain',
              ].includes(a?.key)
            )?.value
          ),
          recipient_chain: normalize_chain(
            attributes?.find(a =>
              [
                'destinationChain',
              ].includes(a?.key)
            )?.value
          ),
          amount: attributes?.find(a => a?.key === 'amount')?.value,
          denom: tx_response.denom ||
            messages.find(m => m?.denom)?.denom,
          token_address,
          deposit_address,
          transfer_id: Number(
            attributes?.find(a => a?.key === 'transferID')?.value
          ),
          poll_id,
          transaction_id,
          participants,
        };

        const {
          id,
          status_code,
          transfer_id,
        } = { ...record };
        let {
          recipient_chain,
        } = { ...record };

        if (
          id &&
          !status_code &&
          (transfer_id || poll_id)
        ) {
          switch (type) {
            case 'ConfirmDeposit':
              try {
                let sign_batch;

                let _response = !recipient_chain &&
                  await read(
                    'deposit_addresses',
                    {
                      match: { deposit_address },
                    },
                    {
                      size: 1,
                    },
                  );

                const link = _.head(_response?.data);

                recipient_chain = normalize_chain(
                  link?.recipient_chain ||
                  recipient_chain
                );

                if (recipient_chain) {
                  const command_id = transfer_id
                    .toString(16)
                    .padStart(64, '0');

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

                  const batch = _.head(_response?.data);

                  if (batch) {
                    const {
                      batch_id,
                      commands,
                      created_at,
                    } = { ...batch };

                    const command = commands?.find(c => c?.id === command_id);

                    let {
                      executed,
                      transactionHash,
                      transactionIndex,
                      logIndex,
                      block_timestamp,
                    } = { ...command };

                    if (!executed) {
                      const chain_data = evm_chains_data.find(c => equals_ignore_case(c?.id, recipient_chain));
                      const provider = getProvider(chain_data);
                      const {
                        chain_id,
                        gateway_address,
                      } = { ...chain_data };

                      const gateway_contract = gateway_address &&
                        new Contract(
                          gateway_address,
                          IAxelarGateway.abi,
                          provider,
                        );

                      try {
                        if (gateway_contract) {
                          executed = await gateway_contract.isCommandExecuted(`0x${command_id}`);
                        }
                      } catch (error) {}
                    }

                    if (!transactionHash) {
                      const __response = await read(
                        'command_events',
                        {
                          bool: {
                            must: [
                              { match: { chain: recipient_chain } },
                              { match: { command_id } },
                            ],
                          },
                        },
                        {
                          size: 1,
                        },
                      );

                      const command_event = _.head(__response?.data);

                      if (command_event) {
                        transactionHash = command_event.transactionHash;
                        transactionIndex = command_event.transactionIndex;
                        logIndex = command_event.logIndex;
                        block_timestamp = command_event.block_timestamp;
                      }
                    }

                    sign_batch = {
                      chain: recipient_chain,
                      batch_id,
                      created_at,
                      command_id,
                      transfer_id,
                      executed,
                      transactionHash,
                      transactionIndex,
                      logIndex,
                      block_timestamp,
                    };
                  }
                }

                _response = await read(
                  'transfers',
                  {
                    bool: {
                      must: [
                        { match: { 'source.status_code': 0 } },
                        { match: { 'source.recipient_address': deposit_address } },
                        { range: { 'source.created_at.ms': { lte: created_at } } },
                      ],
                      should: [
                        { range: { 'confirm_deposit.created_at.ms': { gt: created_at } } },
                        { bool: {
                          must_not: [
                            { exists: { field: 'confirm_deposit' } },
                          ],
                        } },
                      ],
                      minimum_should_match: 1,
                    },
                  },
                  {
                    size: 100,
                  },
                );

                let transfers_data = _response?.data
                  .filter(t => t?.source?.id) || [];

                if (transfers_data.length < 1 && sign_batch) {
                  _response = await read(
                    'transfers',
                    {
                      bool: {
                        must: [
                          { match: { 'source.recipient_address': deposit_address } },
                          { match: { 'confirm_deposit.transfer_id': transfer_id } },
                        ],
                      },
                    },
                    {
                      size: 100,
                    },
                  );

                  transfers_data = (_response?.data || [])
                    .filter(t => t?.source?.id);
                }

                for (const transfer_data of transfers_data) {
                  const {
                    source,
                  } = { ...transfer_data };
                  const {
                    id,
                    sender_address,
                    recipient_address,
                  } = { ...source };
                  let {
                    sender_chain,
                  } = { ...source };

                  sender_chain = normalize_chain(
                    cosmos_non_axelarnet_chains_data.find(c => sender_address?.startsWith(c?.prefix_address))?.id ||
                      sender_chain ||
                      record.sender_chain
                  );
                  if (
                    link?.original_sender_chain &&
                    !link.original_sender_chain?.startsWith(sender_chain)
                  ) {
                    link.original_sender_chain = sender_chain;

                    await write(
                      'deposit_addresses',
                      link.id,
                      link,
                    );
                  }

                  const _id = `${id}_${recipient_address}`.toLowerCase();

                  await write(
                    'transfers',
                    _id,
                    {
                      ...transfer_data,
                      confirm_deposit: record,
                      sign_batch: sign_batch ||
                        undefined,
                      source: {
                        ...source,
                        original_sender_chain: link?.original_sender_chain ||
                          sender_chain,
                        original_recipient_chain: link?.original_recipient_chain ||
                          recipient_chain,
                        sender_chain,
                        recipient_chain,
                      },
                    },
                  );

                  await saveTimeSpent(
                    _id,
                  );
                }
              } catch (error) {}
              break;
            case 'ConfirmERC20Deposit':
              try {
                const {
                  sender_chain,
                  recipient_chain,
                  token_address,
                  deposit_address,
                  transaction_id,
                } = { ...record };
                let {
                  amount,
                  denom,
                } = { ...record };

                if (transaction_id) {
                  const chain_data = evm_chains_data.find(c => equals_ignore_case(c?.id, sender_chain));
                  const provider = getProvider(chain_data);
                  const {
                    chain_id,
                  } = { ...chain_data };

                  const transaction = await provider.getTransaction(transaction_id);
                  const {
                    blockNumber,
                    from,
                    to,
                    input,
                  } = { ...transaction };

                  const asset_data = assets_data.find(a => a?.contracts?.findIndex(c => c?.chain_id === chain_id && equals_ignore_case(c?.contract_address, to)) > -1);

                  if (
                    blockNumber &&
                    (
                      equals_ignore_case(to, token_address) ||
                      asset_data
                    )
                  ) {
                    amount = BigNumber.from(`0x${transaction.data?.substring(10 + 64) || input?.substring(10 + 64) || '0'}`).toString() || amount;
                    denom = asset_data?.id ||
                      denom;

                    const block_timestamp = await getBlockTime(
                      provider,
                      blockNumber,
                    );

                    if (block_timestamp) {
                      created_at = block_timestamp * 1000;
                    }

                    const source = {
                      id: transaction_id,
                      type: 'evm_transfer',
                      status_code: 0,
                      status: 'success',
                      height: blockNumber,
                      created_at: get_granularity(created_at),
                      sender_chain,
                      recipient_chain,
                      sender_address: from,
                      recipient_address: deposit_address,
                      amount,
                      denom,
                    };

                    const __response = await read(
                      'deposit_addresses',
                      {
                        match: { deposit_address },
                      },
                      {
                        size: 1,
                      },
                    );

                    const link = _.head(__response?.data);
                    let {
                      price,
                    } = { ...link };

                    if (link) {
                      const {
                        id,
                        original_sender_chain,
                        original_recipient_chain,
                        sender_chain,
                        recipient_chain,
                        sender_address,
                        asset,
                        denom,
                      } = { ...link };

                      let updated = false;

                      if (!equals_ignore_case(sender_address, from)) {
                        link.sender_address = from;
                        updated = true;
                      }

                      if (!price) {
                        const ___response = await assets_price({
                          chain: original_sender_chain,
                          denom: asset || denom,
                          timestamp: created_at,
                        });

                        const _price = _.head(___response)?.price;
                        if (_price) {
                          price = _price;
                          link.price = price;
                          updated = true;
                        }
                      }

                      if (updated) {
                        await write(
                          'deposit_addresses',
                          id,
                          link,
                        );
                      }

                      source.sender_chain = sender_chain ||
                        source.sender_chain;
                      source.recipient_chain = recipient_chain ||
                        source.recipient_chain;
                      source.denom = source.denom ||
                        asset;

                      source.original_sender_chain = original_sender_chain ||
                        normalize_original_chain(
                          source.sender_chain ||
                          sender_chain
                        );
                      source.original_recipient_chain = original_recipient_chain ||
                        normalize_original_chain(
                          source.recipient_chain ||
                          recipient_chain
                        );
                    }
                    else {
                      source.original_sender_chain = normalize_original_chain(source.sender_chain);
                      source.original_recipient_chain = normalize_original_chain(source.recipient_chain);
                    }

                    if (source.denom && typeof amount === 'string') {
                      const asset_data = assets_data.find(a => equals_ignore_case(a?.id, source.denom));

                      const {
                        contracts,
                      } = { ...asset_data };
                      let {
                        decimals,
                      } = { ...asset_data };

                      decimals = contracts?.find(c => c?.chain_id === chain_id)?.decimals || decimals || 18;

                      if (asset_data) {
                        amount = Number(
                          formatUnits(
                            BigNumber.from(amount).toString(),
                            decimals
                          )
                        );

                        if (!source.fee && endpoints?.lcd) {
                          const lcd = axios.create({ baseURL: endpoints.lcd });

                          const ___response = await lcd.get(
                            '/axelar/nexus/v1beta1/transfer_fee',
                            {
                              params: {
                                source_chain: source.original_sender_chain,
                                destination_chain: source.original_recipient_chain,
                                amount: `${parseUnits((amount || 0).toString(), decimals).toString()}${asset_data.id}`,
                              },
                            },
                          ).catch(error => { return { data: { error } }; });

                          const {
                            fee,
                          } = { ...___response?.data };

                          if (fee?.amount) {
                            source.fee = Number(
                              formatUnits(
                                BigNumber.from(fee.amount).toString(),
                                decimals
                              )
                            );
                          }
                        }
                      }
                    }

                    if (typeof amount === 'number' && typeof source.fee === 'number') {
                      if (amount < source.fee) {
                        source.insufficient_fee = true;
                      }
                      else {
                        source.amount_received = amount - source.fee;
                      }
                    }

                    if (price && typeof amount === 'number') {
                      source.value = amount * price;
                    }

                    const {
                      id,
                      recipient_address,
                    } = { ...source };

                    const _id = `${id}_${recipient_address}`.toLowerCase();

                    await write(
                      'transfers',
                      _id,
                      {
                        source: {
                          ...source,
                          amount,
                        },
                        link: link ||
                          undefined,
                        confirm_deposit: record,
                      },
                    );

                    await saveTimeSpent(
                      _id,
                    );
                  }
                }
              } catch (error) {}
              break;
            default:
              break;
          }
        }
      }
      // ConfirmTransferKey
      else if (
        [
          'ConfirmTransferKey',
        ].findIndex(s =>
          messages.findIndex(m => m?.['@type']?.includes(s)) > -1
        ) > -1
      ) {
        for (let i = 0; i < messages.length; i++) {
          const message = messages[i];

          if (message) {
            const created_at = moment(timestamp).utc().valueOf();

            const {
              events,
            } = { ...logs?.[i] };

            const event = events?.find(e => e?.type?.includes('ConfirmKeyTransferStarted'));

            const {
              attributes,
            } = { ...event };

            const {
              poll_id,
              participants,
            } = { ...to_json(attributes?.find(a => a?.key === 'participants')?.value) };

            const sender_chain = normalize_chain(message.chain);
            const transaction_id = message.tx_id;

            if (poll_id && transaction_id) {
              await write(
                'evm_polls',
                poll_id,
                {
                  id: poll_id,
                  height,
                  created_at: get_granularity(created_at),
                  sender_chain,
                  transaction_id,
                  participants: participants ||
                    undefined,
                },
              );
            }
          }
        }
      }

      // VoteConfirmDeposit & Vote
      if (
        vote_types.findIndex(s =>
          messages.findIndex(m => _.last(m?.inner_message?.['@type']?.split('.'))?.replace('Request', '')?.includes(s)) > -1
        ) > -1
      ) {
        for (let i = 0; i < messages.length; i++) {
          const message = messages[i];
          const {
            inner_message,
          } = { ...message };

          if (inner_message) {
            const type = _.last(inner_message['@type']?.split('.'))?.replace('Request', '');

            if (vote_types.includes(type)) {
              const created_at = moment(timestamp).utc().valueOf();

              const {
                events,
              } = { ...logs?.[i] };

              const event = events?.find(e => equals_ignore_case(e?.type, 'depositConfirmation'));
              const vote_event = events?.find(e => e?.type?.includes('vote'));

              const {
                attributes,
              } = { ...event };

              const poll_id = inner_message.poll_id ||
                to_json(
                  inner_message.poll_key ||
                  attributes?.find(a => a?.key === 'poll')?.value ||
                  vote_event?.attributes?.find(a => a?.key === 'poll')?.value
                )?.id;

              if (poll_id) {
                const recipient_chain = normalize_chain(
                  attributes?.find(a =>
                    [
                      'destinationChain',
                    ].includes(a?.key)
                  )?.value
                );
                const voter = inner_message.sender;
                const unconfirmed = logs?.findIndex(l => l?.log?.includes('not enough votes')) > -1;

                let sender_chain,
                  vote,
                  confirmation,
                  late,
                  transaction_id,
                  deposit_address,
                  transfer_id,
                  participants;

                switch (type) {
                  case 'VoteConfirmDeposit':
                    sender_chain = normalize_chain(
                      inner_message.chain ||
                      attributes?.find(a =>
                        [
                          'sourceChain',
                          'chain',
                        ].includes(a?.key)
                      )?.value
                    );

                    vote = inner_message.confirmed ||
                      false;

                    confirmation = attributes?.findIndex(a =>
                      a?.key === 'action' &&
                      a.value === 'confirm'
                    ) > -1;
                    break;
                  case 'Vote':
                    sender_chain = normalize_chain(
                      inner_message.vote?.chain ||
                      _.head(inner_message.vote?.results)?.chain ||
                      inner_message.vote?.result?.chain ||
                      evm_chains_data.find(c => poll_id?.startsWith(`${c?.id}_`))?.id
                    );

                    const vote_events = inner_message.vote?.events ||
                      inner_message.vote?.results ||
                      inner_message.vote?.result?.events;

                    vote = (
                      Array.isArray(vote_events) ?
                        vote_events :
                        Object.keys({ ...vote_events })
                    ).length > 0;

                    const has_status_on_vote_events = Array.isArray(vote_events) &&
                      vote_events.findIndex(e => e?.status) > -1;

                    confirmation = !!event ||
                      (
                        vote_event &&
                        has_status_on_vote_events &&
                        vote_events.findIndex(e =>
                          [
                            'STATUS_COMPLETED',
                          ].includes(e?.status)
                        ) > -1
                      );

                    late = !vote_event &&
                      (
                        (!vote && Array.isArray(vote_events)) ||
                        (
                          has_status_on_vote_events && vote_events.findIndex(e =>
                            [
                              'STATUS_UNSPECIFIED',
                              'STATUS_COMPLETED',
                            ].includes(e?.status)
                          ) > -1
                        )
                      );
                    break;
                  default:
                    break;
                }

                transaction_id = _.head(inner_message.vote?.events)?.tx_id ||
                  attributes?.find(a => a?.key === 'txID')?.value ||
                  poll_id?.replace(`${sender_chain}_`, '').split('_')[0];
                if (transaction_id === poll_id) {
                  transaction_id = null;
                }

                deposit_address = _.head(inner_message.vote?.events)?.transfer?.to ||
                  attributes?.find(a => a?.key === 'depositAddress')?.value ||
                  poll_id?.replace(`${sender_chain}_`, '').split('_')[1];

                transfer_id = Number(
                  attributes?.find(a => a?.key === 'transferID')?.value
                );

                if (
                  !transaction_id ||
                  !deposit_address ||
                  !transfer_id ||
                  !participants
                ) {
                  const _response = await read(
                    'transfers',
                    {
                      bool: {
                        must: [
                          { match: { 'confirm_deposit.poll_id': poll_id } },
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

                  const transfer_data = _.head(_response?.data);
                  const {
                    confirm_deposit,
                  } = { ...transfer_data };

                  if (!transaction_id) {
                    transaction_id = transfer_data?.vote?.transaction_id ||
                      confirm_deposit?.transaction_id ||
                      transfer_data?.source?.id;
                  }
                  if (!deposit_address) {
                    deposit_address = transfer_data?.vote?.deposit_address ||
                      confirm_deposit?.deposit_address ||
                      transfer_data?.source?.recipient_address ||
                      transfer_data?.link?.deposit_address;
                  }
                  if (!transfer_id) {
                    transfer_id = transfer_data?.vote?.transfer_id ||
                      confirm_deposit?.transfer_id ||
                      transfer_data?.transfer_id;
                  }
                  if (!participants) {
                    participants = confirm_deposit?.participants;
                  }
                }

                if (
                  !sender_chain ||
                  !transaction_id ||
                  !participants
                ) {
                  if (poll_id) {
                    const _response = await get(
                      'evm_polls',
                      poll_id,
                    );

                    if (_response) {
                      sender_chain = _response.sender_chain ||
                        sender_chain;
                      transaction_id = _response.transaction_id ||
                        transaction_id;
                      participants = _response.participants ||
                        participants;
                    }
                  }

                  if (!sender_chain && deposit_address) {
                    const _response = await read(
                      'deposit_addresses',
                      {
                        match: { deposit_address },
                      },
                      {
                        size: 1,
                      },
                    );

                    sender_chain = _.head(_response?.data)?.sender_chain;
                  }
                }

                if (
                  !transaction_id ||
                  !transfer_id
                ) {
                  const _response = await read(
                    'evm_votes',
                    {
                      bool: {
                        must: [
                          { match: { poll_id } },
                        ],
                        should: [
                          { exists: { field: 'transaction_id' } },
                          { exists: { field: 'transfer_id' } },
                        ],
                        minimum_should_match: 1,
                        must_not: [
                          { match: { transaction_id: poll_id } },
                        ],
                      },
                    },
                    {
                      size: 1,
                    },
                  );

                  const vote_data = _.head(_response?.data);

                  if (vote_data) {
                    transaction_id = vote_data.transaction_id ||
                      transaction_id;
                    transfer_id = vote_data.transfer_id ||
                      transfer_id;
                  }

                  if (
                    !transaction_id ||
                    !transfer_id
                  ) {
                    const __response = await rpc(
                      '/block_results',
                      {
                        height,
                      },
                    );

                    let {
                      end_block_events,
                    } = { ...__response };

                    end_block_events = end_block_events?.filter(e =>
                      equals_ignore_case(e?.type, 'depositConfirmation') &&
                      e.attributes?.length > 0
                    )
                    .map(e => {
                      const {
                        attributes,
                      } = { ...e };

                      return Object.fromEntries(
                        attributes.map(a => {
                          const {
                            key,
                            value,
                          } = { ...a };

                          return [
                            key,
                            value,
                          ];
                        })
                      );
                    }) || [];

                    const _transaction_id = _.head(end_block_events.map(e => e.txID));
                    const _transfer_id = _.head(end_block_events.map(e => Number(e.transferID)));

                    if (equals_ignore_case(transaction_id, _transaction_id)) {
                      if (!confirmation && !unconfirmed && !transfer_id && _transfer_id) {
                        confirmation = true;
                      }

                      transfer_id = _transfer_id ||
                        transfer_id;
                    }
                  }
                }

                const record = {
                  id: txhash,
                  type,
                  status_code: code,
                  status: code ?
                    'failed' :
                    'success',
                  height,
                  created_at: get_granularity(created_at),
                  sender_chain,
                  recipient_chain,
                  poll_id,
                  transaction_id,
                  deposit_address,
                  transfer_id,
                  voter,
                  vote,
                  confirmation,
                  late,
                  unconfirmed,
                };

                if (
                  txhash &&
                  transaction_id &&
                  vote &&
                  (
                    confirmation ||
                    !unconfirmed
                  ) &&
                  !late
                ) {
                  let {
                    amount,
                    denom,
                  } = { ...record };

                  let created_at = record.created_at.ms;

                  const chain_data = evm_chains_data.find(c => equals_ignore_case(c?.id, sender_chain));
                  const provider = getProvider(chain_data);
                  const {
                    chain_id,
                  } = { ...chain_data };

                  try {
                    const transaction = await provider.getTransaction(transaction_id);
                    const {
                      blockNumber,
                      from,
                      to,
                      input,
                    } = { ...transaction };

                    const asset_data = assets_data.find(a => a?.contracts?.findIndex(c => c?.chain_id === chain_id && equals_ignore_case(c?.contract_address, to)) > -1);

                    if (
                      blockNumber &&
                      asset_data
                    ) {
                      amount = BigNumber.from(`0x${transaction.data?.substring(10 + 64) || input?.substring(10 + 64) || '0'}`).toString() ||
                        (
                          poll_id?.includes('_') &&
                          _.last(poll_id.split('_'))
                        ) ||
                        amount;
                      denom = asset_data.id ||
                        denom;

                      const block_timestamp = await getBlockTime(
                        provider,
                        blockNumber,
                      );

                      if (block_timestamp) {
                        created_at = block_timestamp * 1000;
                      }

                      const source = {
                        id: transaction_id,
                        type: 'evm_transfer',
                        status_code: 0,
                        status: 'success',
                        height: blockNumber,
                        created_at: get_granularity(created_at),
                        sender_chain,
                        recipient_chain,
                        sender_address: from,
                        recipient_address: deposit_address,
                        amount,
                        denom,
                      };

                      const _response = await read(
                        'deposit_addresses',
                        {
                          match: { deposit_address },
                        },
                        {
                          size: 1,
                        },
                      );

                      const link = _.head(_response?.data);
                      let {
                        price,
                      } = { ...link };

                      if (link) {
                        const {
                          id,
                          original_sender_chain,
                          original_recipient_chain,
                          sender_chain,
                          recipient_chain,
                          sender_address,
                          asset,
                          denom,
                        } = { ...link };

                        let updated = false;

                        if (!equals_ignore_case(sender_address, from)) {
                          link.sender_address = from;
                          updated = true;
                        }

                        if (!price) {
                          const __response = await assets_price({
                            chain: original_sender_chain,
                            denom: asset || denom,
                            timestamp: created_at,
                          });

                          const _price = _.head(__response)?.price;
                          if (_price) {
                            price = _price;
                            link.price = price;
                            updated = true;
                          }
                        }

                        if (updated) {
                          await write(
                            'deposit_addresses',
                            id,
                            link,
                          );
                        }

                        source.sender_chain = sender_chain ||
                          source.sender_chain;
                        source.recipient_chain = recipient_chain ||
                          source.recipient_chain;
                        source.denom = source.denom ||
                          asset;

                        source.original_sender_chain = original_sender_chain ||
                          normalize_original_chain(
                            source.sender_chain ||
                            sender_chain
                          );
                        source.original_recipient_chain = original_recipient_chain ||
                          normalize_original_chain(
                            source.recipient_chain ||
                            recipient_chain
                          );
                      }
                      else {
                        source.original_sender_chain = normalize_original_chain(source.sender_chain);
                        source.original_recipient_chain = normalize_original_chain(source.recipient_chain);
                      }

                      if (source.denom && typeof amount === 'string') {
                        const asset_data = assets_data.find(a => equals_ignore_case(a?.id, source.denom));

                        const {
                          contracts,
                        } = { ...asset_data };
                        let {
                          decimals,
                        } = { ...asset_data };

                        decimals = contracts?.find(c => c?.chain_id === chain_id)?.decimals || decimals || 18;

                        if (asset_data) {
                          amount = Number(
                            formatUnits(
                              BigNumber.from(amount).toString(),
                              decimals
                            )
                          );

                          if (!source.fee && endpoints?.lcd) {
                            const lcd = axios.create({ baseURL: endpoints.lcd });

                            const __response = await lcd.get(
                              '/axelar/nexus/v1beta1/transfer_fee',
                              {
                                params: {
                                  source_chain: source.original_sender_chain,
                                  destination_chain: source.original_recipient_chain,
                                  amount: `${parseUnits((amount || 0).toString(), decimals).toString()}${asset_data.id}`,
                                },
                              },
                            ).catch(error => { return { data: { error } }; });

                            const {
                              fee,
                            } = { ...__response?.data };

                            if (fee?.amount) {
                              source.fee = Number(
                                formatUnits(
                                  BigNumber.from(fee.amount).toString(),
                                  decimals
                                )
                              );
                            }
                          }
                        }
                      }

                      if (typeof amount === 'number' && typeof source.fee === 'number') {
                        if (amount < source.fee) {
                          source.insufficient_fee = true;
                        }
                        else {
                          source.amount_received = amount - source.fee;
                        }
                      }

                      if (price && typeof amount === 'number') {
                        source.value = amount * price;
                      }

                      await sleep(0.5 * 1000);

                      const __response = await read(
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

                      const transfer_data = _.head(__response?.data);
                      const {
                        confirm_deposit,
                      } = { ...transfer_data };

                      const {
                        id,
                        recipient_address,
                      } = { ...source };

                      const _id = `${id}_${recipient_address}`.toLowerCase();

                      await write(
                        'transfers',
                        _id,
                        {
                          source: {
                            ...source,
                            amount,
                          },
                          link: link ||
                            undefined,
                          confirm_deposit: confirm_deposit ||
                            undefined,
                          vote: transfer_data?.vote && transfer_data.vote.height < height ?
                            transfer_data.vote :
                            record,
                        },
                      );

                      await saveTimeSpent(
                        _id,
                      );
                    }
                  } catch (error) {}
                }

                if (voter) {
                  if (confirmation || unconfirmed) {
                    await write(
                      'evm_polls',
                      poll_id,
                      {
                        id: poll_id,
                        height,
                        created_at: record.created_at,
                        sender_chain,
                        transaction_id,
                        transfer_id,
                        confirmation,
                        participants: participants ||
                          undefined,
                      },
                    );
                  }

                  await write(
                    'evm_votes',
                    `${poll_id}_${voter}`.toLowerCase(),
                    {
                      txhash,
                      height,
                      created_at: record.created_at,
                      sender_chain,
                      poll_id,
                      transaction_id,
                      transfer_id,
                      voter,
                      vote,
                      confirmation,
                      late,
                      unconfirmed,
                    },
                  );
                }
              }
            }
          }
        }
      }

      lcd_response.tx_response.raw_log = JSON.stringify(logs);
    }
    /* end index validator metrics & transfers */
  }

  response = lcd_response;

  return response;
};