const _ = require('lodash');
const moment = require('moment');
const config = require('config-yml');
const {
  get,
  write,
} = require('../../index');
const {
  capitalize,
  equals_ignore_case,
  to_json,
  to_hex,
  transfer_actions,
  vote_types,
} = require('../../../utils');

const environment =
  process.env.ENVIRONMENT ||
  config?.environment;

const evm_chains_data =
  require('../../../data')?.chains?.[environment]?.evm ||
  [];
const cosmos_chains_data =
  require('../../../data')?.chains?.[environment]?.cosmos ||
  [];
const chains_data =
  _.concat(
    evm_chains_data,
    cosmos_chains_data,
  );
const axelarnet =
  chains_data
    .find(c =>
      c?.id === 'axelarnet'
    );
const assets_data =
  require('../../../data')?.assets?.[environment] ||
  [];

module.exports = async (
  lcd_response = {},
  queue_index_count = -1,
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
    const log_index = (logs || [])
      .findIndex(l =>
        (l?.events || [])
          .findIndex(e =>
            [
              'depositConfirmation',
              'eventConfirmation',
            ].findIndex(s =>
              equals_ignore_case(
                e?.type,
                s,
              )
            ) > -1
          ) > -1
      );

    if (log_index > -1) {
      const log = logs?.[log_index];

      const {
        events,
      } = { ...log };

      const event_index = events
        .findIndex(e =>
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

      const event = events[event_index];

      const {
        attributes,
      } = { ...event };

      const chain = (attributes || [])
        .find(a =>
          a?.key === 'chain'
        )?.value;

      const token_address = (attributes || [])
        .find(a =>
          a?.key === 'tokenAddress'
        )?.value;

      if (
        chain &&
        token_address
      ) {
        const chain_data = evm_chains_data
          .find(c =>
            equals_ignore_case(
              c?.id,
              chain,
            )
          );

        const {
          chain_id,
        } = { ...chain_data };

        const asset_data = assets_data
          .find(a =>
            (a?.contracts || [])
              .findIndex(c =>
                c?.chain_id === chain_id &&
                equals_ignore_case(
                  c?.contract_address,
                  token_address,
                )
              ) > -1
          );

        const {
          id,
        } = { ...asset_data };

        if (id) {
          tx_response.denom = id;
        }
      }

      const amount_index = (attributes || [])
        .findIndex(a =>
          a?.key === 'amount'
        );

      if (amount_index > -1) {
        const attribute = attributes[amount_index];

        const {
          value,
        } = { ...attribute };

        const _value =
          value
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
          messages
            .findIndex(m =>
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
          messages
            .findIndex(m =>
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
            const event =
              _.head(
                logs
                  .flatMap(l =>
                    (l?.events || [])
                      .filter(e =>
                        [
                          'depositConfirmation',
                          'eventConfirmation',
                        ].findIndex(s =>
                          equals_ignore_case(
                            e?.type,
                            s,
                          ) ||
                          e?.type?.includes(s)
                        ) > -1
                      )
                  )
              );

            const {
              attributes,
            } = { ...event };

            const amount = (attributes || [])
              .find(a =>
                a?.key === 'amount'
              )?.value;

            const denom =
              transaction_data.denom ||
              message.denom;

            message.amount =
              [
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
          messages
            .findIndex(m =>
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
            'token_address',
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

                  if (Array.isArray(event.token_deployed?.[field])) {
                    event.token_deployed[field] = to_hex(event.token_deployed[field]);
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

                  if (Array.isArray(event.token_deployed?.[field])) {
                    event.token_deployed[field] = to_hex(event.token_deployed[field]);
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
      addresses =
        _.uniq(
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
          .map(a =>
            to_json(a) ||
            to_hex(
              typeof a === 'string' ?
                a
                  .split('"')
                  .join('') :
                a
            )
          )
          .filter(a =>
            typeof a === 'string' &&
            a.startsWith(axelarnet.prefix_address)
          )
        );
    }

    if (messages) {
      addresses =
        _.uniq(
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
          .map(a =>
            to_json(a) ||
            to_hex(
              typeof a === 'string' ?
                a
                  .split('"')
                  .join('') :
                a
            )
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
      types =
        _.uniq(
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
      types =
        _.uniq(
          _.concat(
            types,
            logs
              .flatMap(l =>
                (l?.events || [])
                  .filter(e =>
                    equals_ignore_case(
                      e?.type,
                      'message',
                    )
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
      types =
        _.uniq(
          _.concat(
            types,
            messages
              .flatMap(m => m?.['@type']),
          )
          .filter(t => t)
        );
    }

    types =
      _.uniq(
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

    if (queue_index_count < 0) {
      await write(
        'txs',
        txhash,
        transaction_data,
      );
    }
    /*************************
     * end index transaction *
     *************************/

    /* start index validator metrics & transfers */
    if (
      !code &&
      tx_response &&
      messages
    ) {
      let updated;

      // Heartbeat
      if (
        [
          'HeartBeatRequest',
        ].findIndex(s =>
          messages
            .findIndex(m =>
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
          messages
            .findIndex(m =>
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
          messages
            .findIndex(m =>
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
          messages
            .findIndex(m =>
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
          messages
            .findIndex(m =>
              m?.['@type']?.includes(s)
            ) > -1
        ) > -1
      ) {
        const _response =
          await require('./ibc-send')(
            lcd_response,
          );

        logs =
          _response?.logs ||
          logs;

        updated = _response?.updated;
      }
      // MsgAcknowledgement
      if (
        [
          'MsgAcknowledgement',
        ].findIndex(s =>
          messages
            .findIndex(m =>
              m?.['@type']?.includes(s)
            ) > -1
        ) > -1
      ) {
        updated =
          await require('./ibc-acknowledgement')(
            lcd_response,
          );
      }
      // MsgTimeout
      if (
        [
          'MsgTimeout',
        ].findIndex(s =>
          messages
            .findIndex(m =>
              m?.['@type']?.includes(s)
            ) > -1
        ) > -1
      ) {
        updated =
          await require('./ibc-failed')(
            lcd_response,
          );
      }
      // ExecutePendingTransfers
      if (
        [
          'ExecutePendingTransfersRequest',
        ].findIndex(s =>
          messages
            .findIndex(m =>
              m?.['@type']?.includes(s)
            ) > -1
        ) > -1
      ) {
        updated =
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
          messages
            .findIndex(m =>
              m?.['@type']?.includes(s)
            ) > -1
        ) > -1
      ) {
        updated =
          await require('./confirm')(
            lcd_response,
          );
      }
      // ConfirmDeposit & ConfirmERC20Deposit
      if (
        transfer_actions
          .findIndex(s =>
            messages
              .findIndex(m =>
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
        vote_types
          .findIndex(s =>
            messages
              .findIndex(m =>
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
        updated =
          await require('./vote')(
            lcd_response,
          );
      }

      lcd_response.tx_response.raw_log = JSON.stringify(logs);

      // update index queue
      if (
        updated &&
        txhash
      ) {
        let count;

        if (queue_index_count > -1) {
          count = queue_index_count;
        }
        else {
          const queue_data =
            await get(
              'txs_index_queue',
              txhash,
            );

          count = queue_data?.count;
        }

        await write(
          'txs_index_queue',
          txhash,
          {
            txhash,
            updated_at:
              moment()
                .valueOf(),
            count:
              (
                count ||
                0
              ) + 1,
          },
          typeof count === 'number',
        );
      }
    }
    /* end index validator metrics & transfers */
  }

  response = lcd_response;

  return response;
};