const axios = require('axios');
const _ = require('lodash');
const moment = require('moment');
const config = require('config-yml');
const {
  get,
  read,
  write,
} = require('../../index');
const rpc = require('../../rpc');
const assets_price = require('../../assets-price');
const {
  sleep,
  equals_ignore_case,
  to_json,
  get_granularity,
  normalize_original_chain,
  normalize_chain,
  vote_types,
} = require('../../../utils');

const environment = process.env.ENVIRONMENT || config?.environment;

const evm_chains_data = require('../../../data')?.chains?.[environment]?.evm || [];
const cosmos_chains_data = require('../../../data')?.chains?.[environment]?.cosmos || [];
const chains_data = _.concat(
  evm_chains_data,
  cosmos_chains_data,
);
const axelarnet = chains_data.find(c => c?.id === 'axelarnet');
const cosmos_non_axelarnet_chains_data = cosmos_chains_data.filter(c => c?.id !== axelarnet.id);

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
    tx_responses,
    txs,
  } = { ...lcd_response };

  if (tx_responses) {
    // Heartbeat
    try {
      const records = tx_responses
        .map((t, i) => {
          const {
            txhash,
            code,
            timestamp,
          } = { ...t };
          let {
            height,
          } = { ...t };
          const tx = txs?.[i];
          const {
            signatures,
          } = { ...tx };
          const {
            messages,
          } = { ...tx?.body };

          if (
            !code &&
            [
              'HeartBeatRequest',
            ].findIndex(s =>
              messages?.findIndex(m => m?.inner_message?.['@type']?.includes(s)) > -1
            ) > -1
          ) {
            height = Number(height);

            return {
              txhash,
              height,
              period_height: height - ((height % num_blocks_per_heartbeat) || num_blocks_per_heartbeat) + fraction_heartbeat_block,
              timestamp: moment(timestamp).utc().valueOf(),
              signatures,
              sender: _.head(messages.map(m => m?.sender)),
              key_ids: _.uniq(messages.flatMap(m => m?.inner_message?.key_ids || [])),
            };
          }

          return null;
        })
        .filter(t => t?.sender);

      if (records.length > 0) {
        for (const record of records) {
          const {
            sender,
            period_height,
          } = { ...record };

          write(
            'heartbeats',
            `${sender}_${period_height}`,
            record,
          );
        }

        await sleep(1 * 1000);
      }
    } catch (error) {}

    // Link
    try {
      const records = tx_responses
        .filter(t =>
          !t?.code &&
          [
            'LinkRequest',
          ].findIndex(s =>
            t?.tx?.body?.messages?.findIndex(m => m?.['@type']?.includes(s)) > -1
          ) > -1
        ).map(async t => {
          const {
            txhash,
            code,
            timestamp,
            tx,
            logs,
          } = { ...t };
          let {
            height,
          } = { ...t };
          const {
            messages,
          } = { ...tx?.body };

          height = Number(height);

          const event = _.head(logs?.flatMap(l => l?.events?.filter(e => equals_ignore_case(e?.type, 'link'))));
          const {
            attributes,
          } = { ...event };

          const created_at = moment(timestamp).utc().valueOf();
          let sender_chain = attributes?.find(a => a?.key === 'sourceChain')?.value;
          const deposit_address = attributes?.find(a => a?.key === 'depositAddress')?.value;

          const record = {
            ..._.head(messages),
            txhash,
            height,
            created_at: get_granularity(created_at),
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

          return {
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
          };
        });

      if (records.length > 0) {
        for (const record of records) {
          const {
            id,
          } = { ...record };

          write(
            'deposit_addresses',
            id,
            record,
          );
        }

        await sleep(1 * 1000);
      }
    } catch (error) {}

    // ConfirmTransferKey
    try {
      const records = tx_responses
        .filter(t =>
          !t?.code &&
          [
            'ConfirmTransferKey',
          ].findIndex(s =>
            t?.tx?.body?.messages?.findIndex(m => m?.['@type']?.includes(s)) > -1
          ) > -1
        ).flatMap(t => {
          const {
            timestamp,
            tx,
            logs,
          } = { ...t };
          let {
            height,
          } = { ...t };
          const {
            messages,
          } = { ...tx?.body };

          height = Number(height);

          const _records = [];

          if (messages) {
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
                  const record = {
                    height,
                    created_at: get_granularity(created_at),
                    sender_chain,
                    poll_id,
                    transaction_id,
                    participants,
                  };

                  _records.push(record);
                }
              }
            }
          }

          return _records;
        })
        .filter(t => t?.poll_id && t.transaction_id);

      if (records.length > 0) {
        for (const record of records) {
          const {
            height,
            created_at,
            sender_chain,
            poll_id,
            transaction_id,
            participants,
          } = { ...record };

          write(
            'evm_polls',
            poll_id,
            {
              id: poll_id,
              height,
              created_at,
              sender_chain,
              transaction_id,
              participants: participants ||
                undefined,
            },
          );
        }

        await sleep(1 * 1000);
      }
    } catch (error) {}

    // VoteConfirmDeposit & Vote
    try {
      const records = tx_responses
        .filter(t =>
          !t?.code &&
          vote_types.findIndex(s =>
            t?.tx?.body?.messages?.findIndex(m => _.last(m?.inner_message?.['@type']?.split('.'))?.replace('Request', '')?.includes(s)) > -1
          ) > -1
        ).flatMap(async t => {
          const {
            txhash,
            code,
            timestamp,
            tx,
            logs,
          } = { ...t };
          let {
            height,
          } = { ...t };
          const {
            messages,
          } = { ...tx?.body };

          height = Number(height);

          const _records = [];

          if (messages) {
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
                        transaction_id = vote_data.transaction_id || transaction_id;
                        transfer_id = vote_data.transfer_id || transfer_id;
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

                    _records.push(record);
                  }
                }
              }
            }
          }

          return _records;
        })
        .filter(t => t?.poll_id && t.voter);

      if (records.length > 0) {
        for (const record of records) {
          const {
            id,
            height,
            created_at,
            sender_chain,
            poll_id,
            transaction_id,
            transfer_id,
            voter,
            vote,
            confirmation,
            late,
            unconfirmed,
            participants,
          } = { ...record };

          if (confirmation || unconfirmed) {
            write(
              'evm_polls',
              poll_id,
              {
                id: poll_id,
                height,
                created_at,
                sender_chain,
                transaction_id,
                transfer_id,
                confirmation,
                participants: participants ||
                  undefined,
              },
            );
          }

          write(
            'evm_votes',
            `${poll_id}_${voter}`.toLowerCase(),
            {
              txhash: id,
              height,
              created_at,
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

        await sleep(1 * 1000);
      }
    } catch (error) {}

    // IBC Transfer
    try {
      const txHashes = tx_responses
        .filter(t =>
          !t?.code &&
          [
            'RouteIBCTransfersRequest',
            'MsgAcknowledgement',
          ].findIndex(s =>
            t?.tx?.body?.messages?.findIndex(m => m?.['@type']?.includes(s)) > -1
          ) > -1
        )
        .map(t => t.txhash);

      if (txHashes.length > 0 && endpoints?.api) {
        const api = axios.create({ baseURL: endpoints.api });

        for (const txhash of txHashes) {
          api.post(
            '',
            {
              module: 'lcd',
              path: `/cosmos/tx/v1beta1/txs/${txhash}`,
            },
          ).catch(error => { return { data: { error } }; });
        }

        await sleep(1 * 1000);
      }
    } catch (error) {}
  }

  response = lcd_response;

  return response;
};