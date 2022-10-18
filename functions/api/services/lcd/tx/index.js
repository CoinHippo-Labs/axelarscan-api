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

const environment = process.env.ENVIRONMENT ||
  config?.environment;

const evm_chains_data = require('../../../data')?.chains?.[environment]?.evm ||
  [];
const cosmos_chains_data = require('../../../data')?.chains?.[environment]?.cosmos ||
  [];
const chains_data = _.concat(
  evm_chains_data,
  cosmos_chains_data,
);
const axelarnet = chains_data.find(c => c?.id === 'axelarnet');
const assets_data = require('../../../data')?.assets?.[environment] ||
  [];

const {
  endpoints,
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
    } = { ...tx_response };
    let {
      height,
      logs,
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
    const log_index = logs?.findIndex(l =>
      l?.events?.findIndex(e =>
        [
          'depositConfirmation',
          'eventConfirmation',
        ].findIndex(s =>
          equals_ignore_case(e?.type, s)
        ) > -1
      ) > -1
    );

    if (log_index > -1) {
      const log = logs?.[log_index];

      const {
        events,
      } = { ...log };

      const event_index = events.findIndex(e =>
        [
          'depositConfirmation',
          'eventConfirmation',
        ].findIndex(s =>
          equals_ignore_case(e?.type, s)
        ) > -1
      );

      const event = events[event_index];

      const {
        attributes,
      } = { ...event };

      const chain =
        attributes?.find(a =>
          a?.key === 'chain'
        )?.value;

      const token_address =
        attributes?.find(a =>
          a?.key === 'tokenAddress'
        )?.value;

      if (
        chain &&
        token_address
      ) {
        const chain_data = evm_chains_data.find(c =>
          equals_ignore_case(c?.id, chain)
        );

        const {
          chain_id,
        } = { ...chain_data };

        const asset_data = assets_data.find(a =>
          a?.contracts?.findIndex(c =>
            c?.chain_id === chain_id &&
            equals_ignore_case(c?.contract_address, token_address)
          ) > -1
        );

        const {
          id,
        } = { ...asset_data };

        if (id) {
          tx_response.denom = id;
        }
      }

      const amount_index =
        attributes?.findIndex(a =>
          a?.key === 'amount'
        );

      if (amount_index > -1) {
        const attr = attributes[amount_index];

        const {
          value,
        } = { ...attr };

        const _value = value
          .split('');

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

    transaction_data.timestamp =
      moment(timestamp)
        .utc()
        .valueOf();

    /* start convert byte array to hex */
    if (messages) {
      if (
        [
          'LinkRequest',
        ].findIndex(s =>
          messages.findIndex(m =>
            m?.['@type']?.includes(s)
          ) > -1
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
          messages.findIndex(m =>
            m?.['@type']?.includes(s)
          ) > -1
        ) > -1
      ) {
        const fields =
          [
            'tx_id',
            'burner_address',
            'burn_address',
            'address',
          ];

        for (let i = 0; i < messages.length; i++) {
          const message = messages[i];

          if (typeof message?.amount === 'string') {
            const event = _.head(
              logs.flatMap(l =>
                (l?.events || [])
                  .filter(e =>
                    [
                      'depositConfirmation',
                      'eventConfirmation',
                    ].findIndex(s =>
                      equals_ignore_case(e?.type, s) ||
                      e?.type?.includes(s)
                    ) > -1
                  )
              )
            );

            const {
              attributes,
            } = { ...event };

            const amount =
              attributes?.find(a =>
                a?.key === 'amount'
              )?.value;

            const denom =
              transaction_data.denom ||
              message.denom;

            message.amount = [
              {
                amount,
                denom,
              },
            ];
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
          messages.findIndex(m =>
            m?.['@type']?.includes(s) ||
            m?.inner_message?.['@type']?.includes(s)
          ) > -1
        ) > -1
      ) {
        const fields =
          [
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

    const address_fields =
      [
        'voter',
        'delegator_address',
        'signer',
        'sender',
        'recipient',
        'spender',
        'receiver',
        'depositAddress',
      ];

    if (logs) {
      addresses = _.uniq(
        _.concat(
          addresses,
          logs
            .flatMap(l =>
              (l?.events || [])
                .flatMap(e =>
                  (e?.attributes || [])
                    .filter(a =>
                      address_fields.includes(a?.key)
                    )
                    .map(a => a.value)
                )
            ),
        )
        .filter(a =>
          typeof a === 'string' &&
          a.startsWith(axelarnet.prefix_address)
        )
      );
    }

    if (messages) {
      addresses = _.uniq(
        _.concat(
          addresses,
          messages
            .flatMap(m =>
              _.concat(
                address_fields
                  .map(f => m[f]),
                address_fields
                  .map(f => m.inner_message?.[f]),
              )
            ),
        )
        .filter(a =>
          typeof a === 'string' &&
          a.startsWith(axelarnet.prefix_address)
        )
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
          messages
            .flatMap(m =>
              m?.inner_message?.['@type']
            ),
        )
        .filter(t => t)
      );
    }

    // message action
    if (logs) {
      types = _.uniq(
        _.concat(
          types,
          logs
            .flatMap(l =>
              (l?.events || [])
                .filter(e =>
                  equals_ignore_case(e?.type, 'message')
                )
                .flatMap(e =>
                  (e.attributes || [])
                    .filter(a =>
                      a?.key === 'action'
                    )
                    .map(a => a.value)
                )
            ),
        )
        .filter(t => t)
      );
    }

    // message type
    if (messages) {
      types = _.uniq(
        _.concat(
          types,
          messages
            .flatMap(m => m?.['@type']),
        )
        .filter(t => t)
      );
    }

    types = _.uniq(
      types
        .map(t =>
          capitalize(
            _.last(
              t.split('.')
            )
          )
        )
    );

    types = types
      .filter(t =>
        !types.includes(`${t}Request`)
      );

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
          messages.findIndex(m =>
            m?.inner_message?.['@type']?.includes(s)
          ) > -1
        ) > -1
      ) {
        await require('./heartbeat')(
          lcd_response,
        );
      }
      // Link
      if (
        [
          'LinkRequest',
        ].findIndex(s =>
          messages.findIndex(m =>
            m?.['@type']?.includes(s)
          ) > -1
        ) > -1
      ) {
        await require('./link')(
          lcd_response,
        );
      }
      // MsgSend
      if (
        [
          'MsgSend',
        ].findIndex(s =>
          messages.findIndex(m =>
            m?.['@type']?.includes(s)
          ) > -1
        ) > -1
      ) {
        await require('./axelar-send')(
          lcd_response,
        );
      }
      // MsgRecvPacket
      if (
        [
          'MsgRecvPacket',
        ].findIndex(s =>
          messages.findIndex(m =>
            m?.['@type']?.includes(s)
          ) > -1
        ) > -1
      ) {
        await require('./cosmos-send')(
          lcd_response,
        );
      }
      // RouteIBCTransfers
      if (
        [
          'RouteIBCTransfersRequest',
        ].findIndex(s =>
          messages.findIndex(m =>
            m?.['@type']?.includes(s)
          ) > -1
        ) > -1
      ) {
        logs = await require('./ibc-send')(
          lcd_response,
        );
      }
      // MsgAcknowledgement
      if (
        [
          'MsgAcknowledgement',
        ].findIndex(s =>
          messages.findIndex(m =>
            m?.['@type']?.includes(s)
          ) > -1
        ) > -1
      ) {
        await require('./ibc-acknowledgement')(
          lcd_response,
        );
      }
      // MsgTimeout
      if (
        [
          'MsgTimeout',
        ].findIndex(s =>
          messages.findIndex(m =>
            m?.['@type']?.includes(s)
          ) > -1
        ) > -1
      ) {
        await require('./ibc-failed')(
          lcd_response,
        );
      }
      // ExecutePendingTransfers
      if (
        [
          'ExecutePendingTransfersRequest',
        ].findIndex(s =>
          messages.findIndex(m =>
            m?.['@type']?.includes(s)
          ) > -1
        ) > -1
      ) {
        await require('./axelar-transfer')(
          lcd_response,
        );
      }   
      // ConfirmTransferKey & ConfirmGatewayTx
      if (
        [
          'ConfirmTransferKey',
          'ConfirmGatewayTx',
        ].findIndex(s =>
          messages.findIndex(m =>
            m?.['@type']?.includes(s)
          ) > -1
        ) > -1
      ) {
        await require('./confirm')(
          lcd_response,
        );
      }
      // ConfirmDeposit & ConfirmERC20Deposit
      if (
        transfer_actions.findIndex(s =>
          messages.findIndex(m =>
            _.last(
              (m?.['@type'] || '')
                .split('.')
            )
            .replace(
              'Request',
              '',
            )
            .includes(s)
          ) > -1
        ) > -1
      ) {
        await require('./confirm-deposit')(
          lcd_response,
        );
      }
      // VoteConfirmDeposit & Vote
      if (
        vote_types.findIndex(s =>
          messages.findIndex(m =>
            _.last(
              (m?.inner_message?.['@type'] || '')
                .split('.')
            )
            .replace(
              'Request',
              '',
            )
            .includes(s)
          ) > -1
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

                let end_block_events;

                if (
                  !unconfirmed &&
                  !failed &&
                  attributes
                ) {
                  const _response = await rpc(
                    '/block_results',
                    {
                      height,
                    },
                  );

                  end_block_events = _response?.end_block_events ||
                    [];

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

                    const poll_data = await get(
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
                };

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

                    let _amount;

                    if (!asset_data) {
                      const receipt = await provider.getTransactionReceipt(transaction_id);
                      const {
                        logs,
                      } = { ...receipt };

                      _amount = _.head(
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
                              d = BigNumber.from(`0x${d}`);
                              return true;
                            } catch (error) {
                              return false;
                            }
                          })
                      );
                    }

                    if (
                      blockNumber/* &&
                      asset_data*/
                    ) {
                      amount = BigNumber.from(`0x${transaction.data?.substring(10 + 64) || input?.substring(10 + 64) || _amount || '0'}`).toString() ||
                        (
                          poll_id?.includes('_') &&
                          _.last(poll_id.split('_'))
                        ) ||
                        amount;
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
                        } = { ...link };
                        let {
                          denom,
                        } = { ...link };

                        let updated = false;

                        if (!equals_ignore_case(sender_address, from)) {
                          link.sender_address = from;
                          updated = true;
                        }

                        denom = source.denom ||
                          asset ||
                          denom;

                        if (
                          !price ||
                          price <= 0 ||
                          !equals_ignore_case(link.denom, denom)
                        ) {
                          const __response = await assets_price(
                            {
                              chain: original_sender_chain,
                              denom,
                              timestamp: created_at,
                            },
                          );

                          const _price = _.head(__response)?.price;
                          if (_price) {
                            price = _price;
                            link.price = price;
                            link.denom = denom;
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

                      if (
                        source.denom &&
                        typeof amount === 'string'
                      ) {
                        const asset_data = assets_data.find(a => equals_ignore_case(a?.id, source.denom));

                        const {
                          contracts,
                        } = { ...asset_data };
                        let {
                          decimals,
                        } = { ...asset_data };

                        decimals = contracts?.find(c => c?.chain_id === chain_id)?.decimals ||
                          decimals ||
                          18;

                        if (asset_data) {
                          amount = Number(
                            formatUnits(
                              BigNumber.from(amount).toString(),
                              decimals,
                            )
                          );

                          if (
                            !source.fee &&
                            endpoints?.lcd
                          ) {
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
                                  decimals,
                                )
                              );
                            }
                          }
                        }
                      }

                      if (
                        typeof amount === 'number' &&
                        typeof source.fee === 'number'
                      ) {
                        if (amount < source.fee) {
                          source.insufficient_fee = true;
                        }
                        else {
                          source.insufficient_fee = false;
                          source.amount_received = amount - source.fee;
                        }
                      }

                      if (
                        price > 0 &&
                        typeof amount === 'number'
                      ) {
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

                      if (recipient_address) {
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
                            vote: transfer_data?.vote ?
                              transfer_data.vote.height < height &&
                              !equals_ignore_case(transfer_data.vote.poll_id, poll_id) ?
                                record :
                                transfer_data.vote :
                              record,
                          },
                        );

                        await saveTimeSpent(
                          _id,
                        );
                      }
                    }
                  } catch (error) {}
                }

                if (voter) {
                  await write(
                    'evm_polls',
                    poll_id,
                    {
                      id: poll_id,
                      height,
                      created_at: record.created_at,
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
                      event: event_name ||
                        undefined,
                      participants: participants ||
                        undefined,
                      confirmation_events: confirmation_events?.length > 0 ?
                        confirmation_events :
                        undefined,
                      [voter.toLowerCase()]: {
                        id: txhash,
                        type,
                        height,
                        created_at,
                        voter,
                        vote,
                        confirmed: confirmation &&
                          !unconfirmed,
                        late,
                      },
                    },
                  );

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