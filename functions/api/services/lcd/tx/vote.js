const {
  BigNumber,
} = require('ethers');
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
  update_link,
  update_source,
  normalize_link,
  _update_link,
  _update_send,
} = require('../../transfers/utils');
const rpc = require('../../rpc');
const {
  sleep,
  equals_ignore_case,
  to_json,
  to_hex,
  get_granularity,
  normalize_chain,
  vote_types,
  getTransaction,
  getBlockTime,
  getProvider,
} = require('../../../utils');

const environment =
  process.env.ENVIRONMENT ||
  config?.environment;

const evm_chains_data =
  require('../../../data')?.chains?.[environment]?.evm ||
  [];
const assets_data =
  require('../../../data')?.assets?.[environment] ||
  [];

module.exports = async (
  lcd_response = {},
) => {
  let updated = false;

  const {
    tx_response,
    tx,
  } = { ...lcd_response };

  try {
    const {
      txhash,
      code,
      height,
      timestamp,
      logs,
    } = { ...tx_response };
    const {
      messages,
    } = { ...tx?.body };

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

            let end_block_events;

            if (
              !unconfirmed &&
              !failed &&
              attributes
            ) {
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

            let poll_data;

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

                poll_data =
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
              // transfer
              const _response =
                await read(
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

              const data = _.head(_response?.data);

              const {
                confirm_deposit,
              } = { ...data };

              if (!deposit_address) {
                deposit_address =
                  to_hex(
                    data?.vote?.deposit_address ||
                    confirm_deposit?.deposit_address ||
                    data?.source?.recipient_address ||
                    data?.link?.deposit_address
                  );
              }

              if (!transaction_id) {
                transaction_id =
                  to_hex(
                    data?.vote?.transaction_id ||
                    confirm_deposit?.transaction_id ||
                    data?.source?.id
                  );
              }

              if (!transfer_id) {
                transfer_id =
                  data?.vote?.transfer_id ||
                  confirm_deposit?.transfer_id ||
                  data?.transfer_id;
              }

              if (!participants) {
                participants = confirm_deposit?.participants;
              }

              // cross-chain transfer
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
                }

                if (!transaction_id) {
                  transaction_id =
                    to_hex(
                      vote?.transaction_id ||
                      confirm?.transaction_id ||
                      send?.txhash
                    );
                }

                if (!transfer_id) {
                  transfer_id =
                    vote?.transfer_id ||
                    confirm?.transfer_id ||
                    data?.transfer_id;
                }

                if (!participants) {
                  participants = confirm?.participants;
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
                  poll_data ||
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

                    type =
                      type ?
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
                              to_json(value) ||
                              (typeof value === 'string' ?
                                value
                                  .split('"')
                                  .join('') :
                                value
                              ),
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

                transfer_id =
                  _transfer_id ||
                  transfer_id;
              }
            }

            transaction_id = to_hex(transaction_id);

            if (voter) {
              await write(
                'evm_polls',
                poll_id,
                {
                  id: poll_id,
                  height,
                  created_at: get_granularity(created_at),
                  sender_chain,
                  recipient_chain,
                  transaction_id,
                  deposit_address,
                  transfer_id,
                  event:
                    event_name ||
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
                    type,
                    height,
                    created_at,
                    voter,
                    vote,
                    confirmed:
                      confirmation &&
                      !unconfirmed,
                    late,
                  },
                },
                true,
              );

              updated = true;
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
              // transfer
              try {
                const record = {
                  id: txhash,
                  type,
                  status_code: code,
                  status:
                    code ?
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
                };

                switch (event_name) {
                  case 'token_sent':
                    try {
                      const _response =
                        await read(
                          'token_sent_events',
                          {
                            match: { 'event.transactionHash': transaction_id },
                          },
                          {
                            size: 1,
                          },
                        );

                      const data = _.head(_response?.data);

                      const {
                        id,
                      } = { ...data?.event };

                      if (id) {
                        await write(
                          'token_sent_events',
                          id,
                          {
                            vote:
                              data.vote ?
                                (
                                  data.vote.height < height &&
                                  !equals_ignore_case(
                                    data.vote.poll_id,
                                    poll_id,
                                  )
                                ) ||
                                (
                                  !data.vote.transfer_id &&
                                  transfer_id
                                ) ?
                                  record :
                                  data.vote :
                                record,
                          },
                          true,
                        );
                      }
                    } catch (error) {}
                    break;
                  default:
                    if (deposit_address) {
                      try {
                        let {
                          amount,
                          denom,
                        } = { ...record };
                        const {
                          ms,
                        } = { ...record.created_at };

                        let created_at = ms;

                        const chain_data = evm_chains_data
                          .find(c =>
                            equals_ignore_case(
                              c?.id,
                              sender_chain,
                            )
                          );

                        const provider = getProvider(chain_data);

                        const {
                          chain_id,
                        } = { ...chain_data };

                        const transaction =
                          await provider
                            .getTransaction(
                              transaction_id,
                            );

                        const {
                          blockNumber,
                          from,
                          to,
                          input,
                        } = { ...transaction };

                        if (blockNumber) {
                          const asset_data = assets_data
                            .find(a =>
                              (a?.contracts || [])
                                .findIndex(c =>
                                  c?.chain_id === chain_id &&
                                  equals_ignore_case(
                                    c?.contract_address,
                                    to,
                                  )
                                ) > -1
                            );

                          let _amount;

                          if (!asset_data) {
                            const receipt =
                              await provider
                                .getTransactionReceipt(
                                  transaction_id,
                                );

                            const {
                              logs,
                            } = { ...receipt };

                            _amount =
                              _.head(
                                (logs || [])
                                  .map(l => l?.data)
                                  .filter(d => d?.length >= 64)
                                  .map(d =>
                                    d.substring(
                                      d.length - 64,
                                    )
                                    .replace(
                                      '0x',
                                      '',
                                    )
                                    .replace(
                                      /^0+/,
                                      '',
                                    )
                                  )
                                  .filter(d => {
                                    try {
                                      d =
                                        BigNumber.from(
                                          `0x${d}`
                                        );

                                      return true;
                                    } catch (error) {
                                      return false;
                                    }
                                  })
                              );
                          }

                          amount =
                            BigNumber.from(
                              `0x${
                                (transaction.data || '')
                                  .substring(
                                    10 + 64,
                                  ) ||
                                (input || '')
                                  .substring(
                                    10 + 64,
                                  ) ||
                                _amount ||
                                '0'
                              }`
                            )
                            .toString() ||
                            amount;

                          denom =
                            asset_data?.id ||
                            denom;

                          const block_timestamp =
                            await getBlockTime(
                              provider,
                              blockNumber,
                            );

                          if (block_timestamp) {
                            created_at = block_timestamp * 1000;
                          }

                          let source = {
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

                          let link = _.head(_response?.data);

                          link =
                            await update_link(
                              link,
                              source,
                            );

                          source =
                            await update_source(
                              source,
                              link,
                            );

                          try {
                            await sleep(0.5 * 1000);

                            const _response =
                              await read(
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

                            const data = _.head(_response?.data);

                            const {
                              confirm_deposit,
                            } = { ...data };

                            const {
                              id,
                              recipient_address,
                            } = { ...source };

                            if (recipient_address) {
                              const _id = `${id}_${recipient_address}`.toLowerCase();

                              const {
                                amount,
                              } = { ...source };

                              await write(
                                'transfers',
                                _id,
                                {
                                  source: {
                                    ...source,
                                    amount,
                                  },
                                  link:
                                    link ||
                                    undefined,
                                  confirm_deposit:
                                    confirm_deposit ||
                                    undefined,
                                  vote:
                                    data?.vote ?
                                      data.vote.height < height &&
                                      !equals_ignore_case(
                                        data.vote.poll_id,
                                        poll_id
                                      ) ?
                                        record :
                                        data.vote :
                                      record,
                                },
                              );

                              await saveTimeSpent(
                                _id,
                              );
                            }
                          } catch (error) {}
                        }
                      } catch (error) {}
                    }
                    break;
                }
              } catch (error) {}

              // cross-chain transfer
              try {
                const record = {
                  txhash,
                  height,
                  status:
                    code ?
                      'failed' :
                      'success',
                  type,
                  created_at: get_granularity(created_at),
                  source_chain: sender_chain,
                  destination_chain: recipient_chain,
                  poll_id,
                  transaction_id,
                  deposit_address,
                  transfer_id,
                  event: event_name,
                  confirmation,
                  success,
                  failed,
                  unconfirmed,
                  late,
                };

                switch (event_name) {
                  case 'token_sent':
                    try {
                      const _response =
                        await read(
                          'cross_chain_transfers',
                          {
                            match: { 'send.txhash': transaction_id },
                          },
                          {
                            size: 1,
                          },
                        );

                      const {
                        send,
                        vote,
                      } = {
                        ...(
                          _.head(
                            _response?.data
                          )
                        ),
                      };

                      if (
                        send?.txhash &&
                        send.source_chain
                      ) {
                        const {
                          txhash,
                          source_chain,
                        } = { ...send };

                        const _id = `${txhash}_${source_chain}`.toLowerCase();

                        await write(
                          'cross_chain_transfers',
                          _id,
                          {
                            vote:
                              vote ?
                                (
                                  vote.height < height &&
                                  !equals_ignore_case(
                                    vote.poll_id,
                                    poll_id,
                                  )
                                ) ||
                                (
                                  !vote.transfer_id &&
                                  transfer_id
                                ) ?
                                  record :
                                  vote :
                                record,
                          },
                          true,
                        );
                      }
                    } catch (error) {}
                    break;
                  default:
                    if (deposit_address) {
                      try {
                        const {
                          source_chain,
                          destination_chain,
                        } = { ...record }
                        let {
                          amount,
                          denom,
                        } = { ...record };
                        const {
                          ms,
                        } = { ...record.created_at };

                        let created_at = ms;

                        const chain_data = evm_chains_data
                          .find(c =>
                            equals_ignore_case(
                              c?.id,
                              source_chain,
                            )
                          );

                        const {
                          chain_id,
                        } = { ...chain_data };

                        if (chain_id) {
                          const provider = getProvider(chain_data);

                          const transaction =
                            await provider
                              .getTransaction(
                                transaction_id,
                              );

                          const {
                            blockNumber,
                            from,
                            to,
                            input,
                          } = { ...transaction };

                          if (blockNumber) {
                            let _amount;

                            const asset_data = assets_data
                              .find(a =>
                                (a?.contracts || [])
                                  .findIndex(c =>
                                    c?.chain_id === chain_id &&
                                    equals_ignore_case(
                                      c?.contract_address,
                                      to,
                                    )
                                  ) > -1
                              );

                            if (!asset_data) {
                              const receipt =
                                await provider
                                  .getTransactionReceipt(
                                    transaction_id,
                                  );

                              const {
                                logs,
                              } = { ...receipt };

                              _amount =
                                _.head(
                                  (logs || [])
                                    .map(l => l?.data)
                                    .filter(d => d?.length >= 64)
                                    .map(d =>
                                      d.substring(
                                        d.length - 64,
                                      )
                                      .replace(
                                        '0x',
                                        '',
                                      )
                                      .replace(
                                        /^0+/,
                                        '',
                                      )
                                    )
                                    .filter(d => {
                                      try {
                                        d =
                                          BigNumber.from(
                                            `0x${d}`
                                          );

                                        return true;
                                      } catch (error) {
                                        return false;
                                      }
                                    })
                                );
                            }

                            amount =
                              BigNumber.from(
                                `0x${
                                  (transaction.data || '')
                                    .substring(
                                      10 + 64,
                                    ) ||
                                  (input || '')
                                    .substring(
                                      10 + 64,
                                    ) ||
                                  _amount ||
                                  '0'
                                }`
                              )
                              .toString() ||
                              amount;

                            denom =
                              asset_data?.id ||
                              denom;

                            const block_timestamp =
                              await getBlockTime(
                                provider,
                                blockNumber,
                              );

                            if (block_timestamp) {
                              created_at = block_timestamp * 1000;
                            }

                            let send = {
                              txhash: transaction_id,
                              height: blockNumber,
                              status: 'success',
                              type: 'evm',
                              created_at: get_granularity(created_at),
                              source_chain,
                              destination_chain,
                              sender_address: from,
                              recipient_address: deposit_address,
                              denom,
                              amount,
                            };

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

                            let link =
                              normalize_link(
                                _.head(
                                  _response?.data
                                ),
                              );

                            link =
                              await _update_link(
                                link,
                                send,
                              );

                            send =
                              await _update_send(
                                send,
                                link,
                              );

                            try {
                              await sleep(0.5 * 1000);

                              const _response =
                                await read(
                                  'cross_chain_transfers',
                                  {
                                    bool: {
                                      must: [
                                        { match: { 'send.txhash': transaction_id } },
                                        { match: { 'send.recipient_address': deposit_address } },
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
                                confirm,
                                vote,
                              } = { ...data };

                              if (
                                send?.txhash &&
                                send.source_chain
                              ) {
                                const {
                                  txhash,
                                  source_chain,
                                  recipient_address,
                                } = { ...send };

                                const _response =
                                  await read(
                                    'unwraps',
                                    {
                                      bool: {
                                        must: [
                                          { match: { deposit_address_link: recipient_address } },
                                          { match: { source_chain } },
                                        ],
                                      },
                                    },
                                    {
                                      size: 1,
                                    },
                                  );

                                let unwrap =
                                  _.head(
                                    _response?.data
                                  );

                                if (unwrap) {
                                  const {
                                    tx_hash_unwrap,
                                    destination_chain,
                                  } = { ...unwrap };

                                  const chain_data = evm_chains_data
                                    .find(c =>
                                      equals_ignore_case(
                                        c?.id,
                                        destination_chain,
                                      )
                                    );

                                  if (
                                    tx_hash_unwrap &&
                                    chain_data
                                  ) {
                                    const provider = getProvider(chain_data);

                                    const data =
                                      await getTransaction(
                                        provider,
                                        tx_hash_unwrap,
                                        destination_chain,
                                      );

                                    const {
                                      blockNumber,
                                      from,
                                    } = { ...data?.transaction };

                                    if (blockNumber) {
                                      const block_timestamp =
                                        await getBlockTime(
                                          provider,
                                          blockNumber,
                                        );

                                      unwrap = {
                                        ...unwrap,
                                        txhash: tx_hash_unwrap,
                                        height: blockNumber,
                                        type: 'evm',
                                        created_at:
                                          get_granularity(
                                            moment(
                                              block_timestamp * 1000
                                            )
                                            .utc()
                                          ),
                                        sender_address: from,
                                      };
                                    }
                                  }
                                }

                                const type =
                                  unwrap ?
                                    'unwrap' :
                                    'deposit_address';

                                const _id = `${txhash}_${source_chain}`.toLowerCase();

                                await write(
                                  'cross_chain_transfers',
                                  _id,
                                  {
                                    type,
                                    send,
                                    link:
                                      link ||
                                      undefined,
                                    confirm:
                                      confirm ||
                                      undefined,
                                    vote:
                                      vote ?
                                        vote.height < height &&
                                        !equals_ignore_case(
                                          vote.poll_id,
                                          poll_id
                                        ) ?
                                          record :
                                          vote :
                                        record,
                                    unwrap:
                                      unwrap ||
                                      undefined,
                                  },
                                );

                                await save_time_spent(
                                  _id,
                                );
                              }
                            } catch (error) {}
                          }
                        }
                      } catch (error) {}
                    }
                    break;
                }
              } catch (error) {}
            }
          }
        }
      }
    }
  } catch (error) {}

  return updated;
};