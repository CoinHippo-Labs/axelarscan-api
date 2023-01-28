const _ = require('lodash');
const moment = require('moment');
const config = require('config-yml');
const {
  get,
  read,
  write,
} = require('../../index');
const rpc = require('../../rpc');
const {
  saveGMP,
} = require('../../gmp');
const {
  equals_ignore_case,
  to_json,
  to_hex,
  get_granularity,
  normalize_chain,
  vote_types,
} = require('../../../utils');

const environment =
  process.env.ENVIRONMENT ||
  config?.environment;

const evm_chains_data =
  require('../../../data')?.chains?.[environment]?.evm ||
  [];

module.exports = async (
  lcd_response = {},
) => {
  const {
    tx_responses,
  } = { ...lcd_response };

  try {
    const _tx_responses =
      tx_responses
        .filter(t =>
          !t?.code &&
          vote_types
            .findIndex(s =>
              (t?.tx?.body?.messages || [])
                .findIndex(m =>
                  (
                    _.last(
                      (m?.inner_message?.['@type'] || '')
                        .split('.')
                    ) ||
                    ''
                  )
                  .replace(
                    'Request',
                    '',
                  )
                  .includes(s)
                ) > -1
            ) > -1
        )
        .filter(t => {
          const {
            tx,
            logs,
          } = { ...t };
          const {
            messages,
          } = { ...tx?.body };

          let valid = false;

          for (let i = 0; i < messages.length; i++) {
            const message = messages[i];

            const {
              inner_message,
            } = { ...message };

            const {
              events,
            } = { ...logs?.[i] };

            const event = (events || [])
              .find(e =>
                [
                  'depositConfirmation',
                  'eventConfirmation',
                ].findIndex(s =>
                  equals_ignore_case(
                    e?.type,
                    s,
                  )
                ) > -1
              );

            const vote_event = (events || [])
              .find(e =>
                e?.type?.includes('vote')
              );

            const {
              attributes,
            } = { ...event };

            const poll_id =
              inner_message.poll_id ||
              to_json(
                inner_message.poll_key ||
                (attributes || [])
                  .find(a =>
                    a?.key === 'poll'
                  )?.value ||
                (vote_event?.attributes || [])
                  .find(a =>
                    a?.key === 'poll'
                  )?.value
              )?.id;

            if (poll_id) {
              valid = true;
              break;
            }
          }

          return valid;
        });

    let records = [];

    const polls_data = {};
    const end_block_events_data = {};

    for (const t of _tx_responses) {
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
        let end_block_events = end_block_events_data[height];

        for (let i = 0; i < messages.length; i++) {
          const message = messages[i];

          const {
            inner_message,
          } = { ...message };

          if (inner_message) {
            const type =
              (
                _.last(
                  (inner_message['@type'] || '')
                    .split('.')
                ) ||
                ''
              )
              .replace(
                'Request',
                '',
              );

            if (vote_types.includes(type)) {
              const created_at =
                moment(timestamp)
                  .utc()
                  .valueOf();

              const {
                events,
              } = { ...logs?.[i] };

              const event = (events || [])
                .find(e =>
                  [
                    'depositConfirmation',
                    'eventConfirmation',
                  ].findIndex(s =>
                    equals_ignore_case(
                      e?.type,
                      s,
                    )
                  ) > -1
                );

              const vote_event = (events || [])
                .find(e =>
                  e?.type?.includes('vote')
                );

              const {
                attributes,
              } = { ...event };

              const poll_id =
                inner_message.poll_id ||
                to_json(
                  inner_message.poll_key ||
                  (attributes || [])
                    .find(a =>
                      a?.key === 'poll'
                    )?.value ||
                  (vote_event?.attributes || [])
                    .find(a =>
                      a?.key === 'poll'
                    )?.value
                )?.id;

              if (poll_id) {
                let recipient_chain =
                  normalize_chain(
                    (attributes || [])
                      .find(a =>
                        [
                          'destinationChain',
                        ].includes(a?.key)
                      )?.value
                  );

                const voter = inner_message.sender;

                const unconfirmed =
                  (logs || [])
                    .findIndex(l =>
                      l?.log?.includes('not enough votes')
                    ) > -1 &&
                  (events || [])
                    .findIndex(e =>
                      [
                        'EVMEventConfirmed',
                      ].findIndex(s =>
                        e?.type?.includes(s)
                      ) > -1
                    ) < 0;

                const failed =
                  (logs || [])
                    .findIndex(l =>
                      l?.log?.includes('failed') &&
                      !l.log.includes('already confirmed')
                    ) > -1 ||
                  (events || [])
                    .findIndex(e =>
                      [
                        'EVMEventFailed',
                      ].findIndex(s =>
                        e?.type?.includes(s)
                      ) > -1
                    ) > -1;

                if (
                  !unconfirmed &&
                  !failed &&
                  attributes
                ) {
                  if (!end_block_events) {
                    const _response =
                      await rpc(
                        '/block_results',
                        {
                          height,
                        },
                      );

                    end_block_events =
                      _response?.end_block_events ||
                      [];

                    end_block_events_data[height] = end_block_events;
                  }

                  const completed_events =
                    end_block_events
                      .filter(e =>
                        [
                          'EVMEventCompleted',
                        ].findIndex(s =>
                          e?.type?.includes(s)
                        ) > -1 &&
                        (e.attributes || [])
                          .findIndex(a =>
                            [
                              'eventID',
                              'event_id',
                            ].findIndex(k =>
                              k === a?.key
                            ) > -1 &&
                            equals_ignore_case(
                              (a.value || '')
                                .split('"')
                                .join(''),
                              attributes
                                .find(_a =>
                                  [
                                    'eventID',
                                    'event_id',
                                  ].findIndex(k =>
                                    k === _a?.key
                                  ) > -1
                                )?.value,
                            )
                          ) > -1
                      );

                  for (const e of completed_events) {
                    events.push(e);
                  }
                }

                const success =
                  (events || [])
                    .findIndex(e =>
                      [
                        'EVMEventCompleted',
                      ].findIndex(s =>
                        e?.type?.includes(s)
                      ) > -1
                    ) > -1 ||
                  (logs || [])
                    .findIndex(l =>
                      l?.log?.includes('already confirmed')
                    ) > -1;

                let sender_chain,
                  vote = true,
                  confirmation,
                  late,
                  transaction_id,
                  deposit_address,
                  transfer_id,
                  event_name,
                  participants,
                  confirmation_events;

                switch (type) {
                  case 'VoteConfirmDeposit':
                    sender_chain =
                      normalize_chain(
                        inner_message.chain ||
                        (attributes || [])
                          .find(a =>
                            [
                              'sourceChain',
                              'chain',
                            ].includes(a?.key)
                          )?.value
                      );

                    vote =
                      inner_message.confirmed ||
                      false;

                    confirmation =
                      (attributes || [])
                        .findIndex(a =>
                          a?.key === 'action' &&
                          a.value === 'confirm'
                        ) > -1;

                    break;
                  case 'Vote':
                    sender_chain =
                      normalize_chain(
                        inner_message.vote?.chain ||
                        _.head(
                          inner_message.vote?.results
                        )?.chain ||
                        inner_message.vote?.result?.chain ||
                        evm_chains_data
                          .find(c =>
                            poll_id?.startsWith(`${c?.id}_`)
                          )?.id
                      );

                    const vote_events =
                      inner_message.vote?.events ||
                      inner_message.vote?.results ||
                      inner_message.vote?.result?.events;

                    recipient_chain =
                      normalize_chain(
                        recipient_chain ||
                        (
                          Array.isArray(vote_events) ?
                            _.head(
                              vote_events
                                .flatMap(e =>
                                  Object.values(e)
                                    .filter(v =>
                                      typeof v === 'object' &&
                                      v?.destination_chain
                                    )
                                    .map(v => v.destination_chain)
                                )
                                .filter(c => c)
                            ) :
                            undefined
                        )
                      );

                    vote =
                      (
                        Array.isArray(vote_events) ?
                          vote_events :
                          Object.keys({ ...vote_events })
                      )
                      .length > 0;

                    const has_status_on_vote_events =
                      Array.isArray(vote_events) &&
                      vote_events
                        .findIndex(e =>
                          e?.status
                        ) > -1;

                    confirmation =
                      !!event ||
                      (events || [])
                        .findIndex(e =>
                          [
                            'EVMEventConfirmed',
                          ].findIndex(s =>
                            e?.type?.includes(s)
                          ) > -1
                        ) > -1 ||
                      (
                        vote_event &&
                        has_status_on_vote_events &&
                        vote_events
                          .findIndex(e =>
                            [
                              'STATUS_COMPLETED',
                            ].includes(e?.status)
                          ) > -1
                      );

                    late =
                      !vote_event &&
                      (logs || [])
                        .findIndex(l =>
                          l?.log?.includes('failed') &&
                          l.log.includes('already confirmed')
                        ) > -1 &&
                      (
                        (
                          !vote &&
                          Array.isArray(vote_events)
                        ) ||
                        (
                          has_status_on_vote_events &&
                          vote_events
                            .findIndex(e =>
                              [
                                'STATUS_UNSPECIFIED',
                                'STATUS_COMPLETED',
                              ].includes(e?.status)
                            ) > -1
                        )
                      );

                    event_name =
                      _.head(
                        Object.entries({
                          ...(vote_events || [])
                            .find(e =>
                              Object.values({ ...e })
                                .findIndex(v =>
                                  typeof v === 'object' &&
                                  !Array.isArray(v)
                                ) > -1
                            ),
                        })
                        .filter(([k, v]) =>
                          typeof v === 'object' &&
                          !Array.isArray(v)
                        )
                        .map(([k, v]) => k)
                      );

                    const poll_data =
                      polls_data[poll_id] ||
                      await get(
                        'evm_polls',
                        poll_id,
                      );

                    if (poll_data) {
                      sender_chain =
                        poll_data.sender_chain ||
                        sender_chain;
                      poll_data.sender_chain = sender_chain;

                      transaction_id = poll_data.transaction_id;
                      deposit_address = poll_data.deposit_address;
                      transfer_id = poll_data.transfer_id;
                      participants = poll_data.participants;
                      confirmation_events = poll_data.confirmation_events;

                      polls_data[poll_id] = poll_data;
                    }

                    break;
                  default:
                    break;
                }

                deposit_address =
                  to_hex(
                    deposit_address ||
                    _.head(
                      inner_message.vote?.events
                    )?.transfer?.to ||
                    (attributes || [])
                      .find(a =>
                        a?.key === 'depositAddress'
                      )?.value ||
                    (poll_id || '')
                      .replace(
                        `${sender_chain}_`,
                        '',
                      )
                      .split('_')[1]
                  );

                transaction_id =
                  to_hex(
                    transaction_id ||
                    _.head(
                      inner_message.vote?.events
                    )?.tx_id ||
                    (attributes || [])
                      .find(a =>
                        a?.key === 'txID'
                      )?.value ||
                    _.head(
                      (poll_id || '')
                        .replace(
                          `${sender_chain}_`,
                          ''
                        )
                        .split('_')
                    )
                  );

                if (transaction_id === poll_id) {
                  transaction_id = null;
                }

                transfer_id =
                  transfer_id ||
                  Number(
                    (attributes || [])
                      .find(a =>
                        a?.key === 'transferID'
                      )?.value
                  );

                if (
                  (
                    equals_ignore_case(
                      event_name,
                      'transfer',
                    ) ||
                    deposit_address
                  ) &&
                  (
                    !deposit_address ||
                    !transaction_id ||
                    !transfer_id ||
                    !participants
                  )
                ) {
                  // cross-chain transfers
                  try {
                    const _response =
                      await read(
                        'cross_chain_transfers',
                        {
                          bool: {
                            must: [
                              { match: { 'confirm.poll_id': poll_id } },
                            ],
                            must_not: [
                              { match: { 'confirm.transaction_id': poll_id } },
                            ],
                          },
                        },
                        {
                          size: 1,
                        },
                      );

                    const data =
                      _.head(
                        _response?.data
                      );

                    const {
                      send,
                      link,
                      confirm,
                      vote,
                    } = { ...data };

                    if (!deposit_address) {
                      deposit_address =
                        to_hex(
                          vote?.deposit_address ||
                          confirm?.deposit_address ||
                          send?.recipient_address ||
                          link?.deposit_address
                        );

                      if (
                        deposit_address &&
                        polls_data[poll_id]
                      ) {
                        polls_data[poll_id].deposit_address = deposit_address;
                      }
                    }

                    if (!transaction_id) {
                      transaction_id =
                        to_hex(
                          vote?.transaction_id ||
                          confirm?.transaction_id ||
                          send?.txhash
                        );

                      if (
                        transaction_id &&
                        polls_data[poll_id]
                      ) {
                        polls_data[poll_id].transaction_id = transaction_id;
                      }
                    }

                    if (!transfer_id) {
                      transfer_id =
                        vote?.transfer_id ||
                        confirm?.transfer_id ||
                        data?.transfer_id;

                      if (
                        transfer_id &&
                        polls_data[poll_id]
                      ) {
                        polls_data[poll_id].transfer_id = transfer_id;
                      }
                    }

                    if (!participants) {
                      participants = confirm?.participants;

                      if (
                        participants &&
                        polls_data[poll_id]
                      ) {
                        polls_data[poll_id].participants = participants;
                      }
                    }
                  } catch (error) {}
                }

                if (
                  !sender_chain ||
                  !transaction_id ||
                  !participants
                ) {
                  if (poll_id) {
                    const _response =
                      polls_data[poll_id] ||
                      await get(
                        'evm_polls',
                        poll_id,
                      );

                    if (_response) {
                      sender_chain =
                        _response.sender_chain ||
                        sender_chain;

                      transaction_id =
                        _response.transaction_id ||
                        transaction_id;

                      participants =
                        _response.participants ||
                        participants;

                      if (polls_data[poll_id]) {
                        if (sender_chain) {
                          polls_data[poll_id].sender_chain = sender_chain;
                        }

                        if (transaction_id) {
                          polls_data[poll_id].transaction_id = transaction_id;
                        }

                        if (participants) {
                          polls_data[poll_id].participants = participants;
                        }
                      }
                    }
                  }

                  if (
                    !sender_chain &&
                    deposit_address
                  ) {
                    const _response =
                      await read(
                        'deposit_addresses',
                        {
                          match: { deposit_address },
                        },
                        {
                          size: 1,
                        },
                      );

                    sender_chain =
                      _.head(
                        _response?.data
                      )?.sender_chain;

                    if (
                      sender_chain &&
                      polls_data[poll_id]
                    ) {
                      polls_data[poll_id].sender_chain = sender_chain;
                    }
                  }
                }

                if (
                  !transaction_id ||
                  !transfer_id ||
                  !confirmation_events ||  
                  confirmation_events
                    .findIndex(e =>
                      e?.type
                    ) < 0
                ) {
                  if (!end_block_events) {
                    const _response =
                      await rpc(
                        '/block_results',
                        {
                          height,
                        },
                      );

                    end_block_events =
                      _response?.end_block_events ||
                      [];

                    end_block_events_data[height] = end_block_events;
                  }

                  confirmation_events =
                    end_block_events
                      .filter(e =>
                        [
                          'depositConfirmation',
                          'eventConfirmation',
                          'transferKeyConfirmation',
                          'tokenConfirmation',
                          'TokenSent',
                          'ContractCall',
                        ].findIndex(s =>
                          e?.type?.includes(s)
                        ) > -1 &&
                        (e.attributes || [])
                          .findIndex(a =>
                            [
                              'eventID',
                              'event_id',
                            ].findIndex(k =>
                              k === a?.key
                            ) > -1 &&
                            equals_ignore_case(
                              (a.value || '')
                                .split('"')
                                .join(''),
                              (attributes || [])
                                .find(_a =>
                                  [
                                    'eventID',
                                    'event_id',
                                  ].findIndex(k =>
                                    k === _a?.key
                                  ) > -1
                                )?.value,
                            )
                          ) > -1
                      )
                      .map(e => {
                        const {
                          attributes,
                        } = { ...e };
                        let {
                          type,
                        } = { ...e };

                        type = type ?
                          _.last(
                            type
                              .split('.')
                          ) :
                          undefined;

                        return {
                          type,
                          ...Object.fromEntries(
                            attributes
                              .map(a => {
                                const {
                                  key,
                                  value,
                                } = { ...a };

                                return [
                                  key,
                                  value,
                                ];
                              })
                          ),
                        };
                      });

                  const _chain =
                    _.head(
                      confirmation_events
                        .map(e =>
                          e.chain
                        )
                        .filter(c => c)
                    );

                  const _transaction_id =
                    _.head(
                      confirmation_events
                        .map(e =>
                          e.txID ||
                          e.tx_id
                        )
                        .filter(id => id)
                        .map(id =>
                          to_hex(
                            typeof id === 'string' ?
                              id
                                .split('"')
                                .join('') :
                              id
                          )
                        )
                    );

                  const _transfer_id =
                    _.head(
                      confirmation_events
                        .map(e =>
                          e.transferID ||
                          e.transfer_id
                        )
                        .filter(id => id)
                        .map(id =>
                          Number(
                            typeof id === 'string' ?
                              id
                                .split('"')
                                .join('') :
                              id
                          )
                        )
                    );

                  if (
                    equals_ignore_case(
                      transaction_id,
                      _transaction_id,
                    ) ||
                    confirmation_events.length > 0
                  ) {
                    if (
                      (
                        !confirmation &&
                        !unconfirmed &&
                        !failed &&
                        !transfer_id &&
                        _transfer_id
                      ) ||
                      success
                    ) {
                      confirmation = true;
                    }

                    sender_chain =
                      sender_chain ||
                      _chain;

                    if (
                      sender_chain &&
                      polls_data[poll_id]
                    ) {
                      polls_data[poll_id].sender_chain = sender_chain;
                    }

                    transfer_id =
                      _transfer_id ||
                      transfer_id;

                    if (
                      transfer_id &&
                      polls_data[poll_id]
                    ) {
                      polls_data[poll_id].transfer_id = transfer_id;
                    }
                  }
                }

                transaction_id = to_hex(transaction_id);

                if (
                  transaction_id &&
                  polls_data[poll_id]
                ) {
                  polls_data[poll_id].transaction_id = transaction_id;
                }

                const record = {
                  txhash,
                  height,
                  status:
                    code ?
                      'failed' :
                      'success',
                  type,
                  created_at: get_granularity(created_at),
                  sender_chain,
                  recipient_chain,
                  poll_id,
                  transaction_id,
                  deposit_address,
                  transfer_id,
                  event: event_name,
                  voter,
                  vote,
                  confirmation,
                  success,
                  failed,
                  unconfirmed,
                  late,
                  confirmation_events,
                };

                _records.push(record);
              }
            }
          }
        }
      }

      records =
        _.concat(
          records,
          _records,
        );
    }

    records =
      records
        .filter(t =>
          t?.poll_id &&
          t.voter
        );

    for (let i = 0; i < records.length; i++) {
      const record = records[i];

      const {
        txhash,
        height,
        type,
        created_at,
        sender_chain,
        recipient_chain,
        poll_id,
        transaction_id,
        deposit_address,
        transfer_id,
        event,
        voter,
        vote,
        confirmation,
        success,
        failed,
        unconfirmed,
        late,
        participants,
        confirmation_events,
      } = { ...record };
      const {
        ms,
      } = { ...created_at };

      const data = {
        id: poll_id,
        height,
        created_at,
        sender_chain,
        recipient_chain,
        transaction_id,
        deposit_address,
        transfer_id,
        event:
          event ||
          undefined,
        confirmation:
          confirmation ||
          undefined,
        success:
          success ||
          confirmation ||
          undefined,
        failed:
          success ||
          confirmation ?
            false :
            failed ||
            undefined,
        participants:
          participants ||
          undefined,
        confirmation_events:
          confirmation_events?.length > 0 ?
            confirmation_events :
            undefined,
        [voter.toLowerCase()]: {
          id: txhash,
          height,
          type,
          created_at: ms,
          voter,
          vote,
          confirmed:
            confirmation &&
            !unconfirmed,
          late,
        },
      };

      if (i <= records.length - 3) {
        await write(
          'evm_polls',
          poll_id,
          data,
          true,
        );
      }
      else {
        write(
          'evm_polls',
          poll_id,
          data,
          true,
        );
      }

      if (
        txhash &&
        transaction_id &&
        vote &&
        (
          confirmation ||
          !unconfirmed ||
          success
        ) &&
        !late &&
        !failed
      ) {
        switch (event) {
          case 'contract_call':
          case 'contract_call_with_token':
            try {
              await saveGMP(
                {
                  event: 'confirm',
                  sourceTransactionHash: transaction_id,
                  poll_id,
                  blockNumber: height,
                  block_timestamp: ms / 1000,
                  source_chain: sender_chain,
                  destination_chain: recipient_chain,
                  transactionHash: transaction_id,
                  confirmation_txhash: txhash,
                  transfer_id,
                },
                sender_chain,
              );
            } catch (error) {}
            break;
          default:
            break;
        }
      }
    }
  } catch (error) {}
};