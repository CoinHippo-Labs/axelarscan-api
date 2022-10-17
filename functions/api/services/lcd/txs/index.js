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
  sleep,
  equals_ignore_case,
  to_json,
  to_hex,
  get_granularity,
  normalize_chain,
  vote_types,
} = require('../../../utils');

const environment = process.env.ENVIRONMENT ||
  config?.environment;

const evm_chains_data = require('../../../data')?.chains?.[environment]?.evm ||
  [];

module.exports = async (
  lcd_response = {},
) => {
  let response;

  const {
    tx_responses,
    txs,
  } = { ...lcd_response };

  if (tx_responses) {
    await require('./heartbeat')(
      lcd_response,
    );

    await require('./link')(
      lcd_response,
    );

    await require('./ibc-axelar-transfer')(
      lcd_response,
    );

    await require('./confirm')(
      lcd_response,
    );

    // VoteConfirmDeposit & Vote
    try {
      const _tx_responses = tx_responses
        .filter(t =>
          !t?.code &&
          vote_types.findIndex(s =>
            t?.tx?.body?.messages?.findIndex(m => _.last(m?.inner_message?.['@type']?.split('.'))?.replace('Request', '')?.includes(s)) > -1
          ) > -1
        );

      let records = [];

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
          let end_block_events;
          const polls_data = {};

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

                const event = events?.find(e =>
                  [
                    'depositConfirmation',
                    'eventConfirmation',
                  ].findIndex(s => equals_ignore_case(e?.type, s)) > -1
                );
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
                  const unconfirmed = logs?.findIndex(l => l?.log?.includes('not enough votes')) > -1 &&
                    events?.findIndex(e =>
                      [
                        'EVMEventConfirmed',
                      ].findIndex(s => e?.type?.includes(s)) > -1
                    ) < 0;
                  const failed =
                    (
                      logs?.findIndex(l => l?.log?.includes('failed')) > -1 ||
                      events?.findIndex(e =>
                        [
                          'EVMEventFailed',
                        ].findIndex(s => e?.type?.includes(s)) > -1
                      ) > -1
                    );

                  if (
                    !unconfirmed &&
                    !failed &&
                    attributes
                  ) {
                    if (!end_block_events) {
                      const _response = await rpc(
                        '/block_results',
                        {
                          height,
                        },
                      );

                      end_block_events = _response?.end_block_events ||
                        [];
                    }

                    const completed_events = end_block_events
                      .filter(e =>
                        [
                          'EVMEventCompleted',
                        ].findIndex(s => e?.type?.includes(s)) > -1 &&
                        e.attributes?.findIndex(a =>
                          [
                            'eventID',
                            'event_id',
                          ].findIndex(k => k === a?.key) > -1 &&
                          equals_ignore_case(
                            (a.value || '')
                              .split('"')
                              .join(''),
                            attributes?.find(_a =>
                              [
                                'eventID',
                                'event_id',
                              ].findIndex(k => k === _a?.key) > -1
                            )?.value,
                          )
                        ) > -1
                      );

                    for (const e of completed_events) {
                      events.push(e);
                    }
                  }

                  const success =
                    events?.findIndex(e =>
                      [
                        'EVMEventCompleted',
                      ].findIndex(s => e?.type?.includes(s)) > -1
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
                        events?.findIndex(e =>
                          [
                            'EVMEventConfirmed',
                          ].findIndex(s => e?.type?.includes(s)) > -1
                        ) > -1 ||
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
                          (
                            !vote &&
                            Array.isArray(vote_events)
                          ) ||
                          (
                            has_status_on_vote_events &&
                            vote_events.findIndex(e =>
                              [
                                'STATUS_UNSPECIFIED',
                                'STATUS_COMPLETED',
                              ].includes(e?.status)
                            ) > -1
                          )
                        );

                      event_name = _.head(
                        Object.entries({
                          ...vote_events?.find(e =>
                            Object.values({ ...e })
                              .filter(v =>
                                typeof v === 'object' &&
                                !Array.isArray(v)
                              )
                          ),
                        })
                        .filter(([k, v]) =>
                          typeof v === 'object' &&
                          !Array.isArray(v)
                        )
                        .map(([k, v]) => k)
                      );

                      const poll_data = polls_data[poll_id] ||
                        await get(
                          'evm_polls',
                          poll_id,
                        );

                      if (poll_data) {
                        sender_chain = poll_data.sender_chain;
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

                  transaction_id = transaction_id ||
                    _.head(inner_message.vote?.events)?.tx_id ||
                    attributes?.find(a => a?.key === 'txID')?.value ||
                    poll_id?.replace(`${sender_chain}_`, '').split('_')[0];

                  transaction_id = Array.isArray(transaction_id) ?
                    to_hex(transaction_id) :
                    transaction_id;

                  if (transaction_id === poll_id) {
                    transaction_id = null;
                  }

                  deposit_address = deposit_address ||
                    _.head(inner_message.vote?.events)?.transfer?.to ||
                    attributes?.find(a => a?.key === 'depositAddress')?.value ||
                    poll_id?.replace(`${sender_chain}_`, '').split('_')[1];

                  deposit_address = Array.isArray(deposit_address) ?
                    to_hex(deposit_address) :
                    deposit_address;

                  transfer_id = transfer_id ||
                    Number(
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

                      transaction_id = Array.isArray(transaction_id) ?
                        to_hex(transaction_id) :
                        transaction_id;
                    }
                    if (!deposit_address) {
                      deposit_address = transfer_data?.vote?.deposit_address ||
                        confirm_deposit?.deposit_address ||
                        transfer_data?.source?.recipient_address ||
                        transfer_data?.link?.deposit_address;

                      deposit_address = Array.isArray(deposit_address) ?
                        to_hex(deposit_address) :
                        deposit_address;
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

                    if (
                      !sender_chain &&
                      deposit_address
                    ) {
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
                    !transfer_id ||
                    !(confirmation_events?.findIndex(e => e?.type) > -1)
                  ) {
                    if (!end_block_events) {
                      const _response = await rpc(
                        '/block_results',
                        {
                          height,
                        },
                      );

                      end_block_events = _response?.end_block_events ||
                        [];
                    }

                    confirmation_events = end_block_events
                      .filter(e =>
                        [
                          'depositConfirmation',
                          'eventConfirmation',
                          'transferKeyConfirmation',
                          'TokenSent',
                          'ContractCall',
                        ].findIndex(s => e?.type?.includes(s)) > -1 &&
                        e.attributes?.findIndex(a =>
                          [
                            'eventID',
                            'event_id',
                          ].findIndex(k => k === a?.key) > -1 &&
                          equals_ignore_case(
                            (a.value || '')
                              .split('"')
                              .join(''),
                            attributes?.find(_a =>
                              [
                                'eventID',
                                'event_id',
                              ].findIndex(k => k === _a?.key) > -1
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

                    const _transaction_id = _.head(
                      confirmation_events
                        .map(e => e.txID)
                    );
                    const _transfer_id = _.head(
                      confirmation_events
                        .map(e => Number(e.transferID))
                    );

                    if (equals_ignore_case(transaction_id, _transaction_id)) {
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

                      transfer_id = _transfer_id ||
                        transfer_id;
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
                  }

                  transaction_id = Array.isArray(transaction_id) ?
                    to_hex(transaction_id) :
                    transaction_id;

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
                    failed,
                    success,
                    event: event_name,
                    confirmation_events,
                  };

                  _records.push(record);
                }
              }
            }
          }
        }

        records = _.concat(
          records,
          _records,
        );
      }

      records = records
        .filter(t =>
          t?.poll_id &&
          t.voter
        );

      if (records.length > 0) {
        for (const record of records) {
          const {
            id,
            type,
            height,
            created_at,
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
            failed,
            success,
            event,
            participants,
            confirmation_events,
          } = { ...record };

          write(
            'evm_polls',
            poll_id,
            {
              id: poll_id,
              height,
              created_at,
              sender_chain,
              recipient_chain,
              transaction_id,
              deposit_address,
              transfer_id,
              confirmation: confirmation ||
                undefined,
              failed: failed ||
                undefined,
              success: success ||
                undefined,
              event: event ||
                undefined,
              participants: participants ||
                undefined,
              confirmation_events: confirmation_events?.length > 0 ?
                confirmation_events :
                undefined,
              [voter.toLowerCase()]: {
                id,
                type,
                height,
                created_at: created_at?.ms,
                voter,
                vote,
                confirmed: confirmation &&
                  !unconfirmed,
                late,
              },
            },
            true,
          );

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

        await sleep(2 * 1000);
      }
    } catch (error) {}
  }

  response = lcd_response;

  return response;
};