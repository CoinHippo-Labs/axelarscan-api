const _ = require('lodash');
const moment = require('moment');

const { recoverEvents } = require('../gmp');
const { write } = require('../../../services/index');
const { TX_COLLECTION, CONFIRM_TYPES, VOTE_TYPES, getChainKey, getChainData, getAssetsList } = require('../../../utils/config');
const { equalsIgnoreCase, toArray, capitalize, toJson, toHex, normalizeQuote } = require('../../../utils');

module.exports = async (lcd_response = {}, params = {}) => {
  const { tx, tx_response } = { ...lcd_response };
  const { index_transfer, index_poll, from_indexer } = { ...params };

  if (tx_response) {
    const { messages } = { ...tx?.body };
    const { txhash, code, timestamp } = { ...tx_response };
    let { height, logs } = { ...tx_response };
    height = Number(height);
    tx_response.height = height;

    /***************************
     * start index transaction *
     ***************************/
    if (!from_indexer) {
      /* start custom evm deposit confirmation */
      const log_index = toArray(logs).findIndex(l => toArray(l.events).findIndex(e => ['depositConfirmation', 'eventConfirmation'].findIndex(s => equalsIgnoreCase(e.type, s)) > -1) > -1);
      if (log_index > -1) {
        const { events } = { ...logs[log_index] };
        const event_index = toArray(events).findIndex(e => ['depositConfirmation', 'eventConfirmation'].findIndex(s => equalsIgnoreCase(e.type, s)) > -1);
        const { attributes } = { ...events[event_index] };

        const chain = toArray(attributes).find(a => a.key === 'chain')?.value;
        const token_address = toArray(attributes).find(a => a.key === 'tokenAddress')?.value;
        if (chain && token_address) {
          const { denom } = { ...getAssetsList().find(a => equalsIgnoreCase(a.addresses?.[getChainKey(chain)]?.address, token_address)) };
          tx_response.denom = denom;
        }

        const amount_index = toArray(attributes).findIndex(a => a.key === 'amount');
        if (amount_index > -1) {
          const { value } = { ...attributes[amount_index] };
          let amount = '';
          for (const c of value.split('')) {
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

      const transaction_data = _.cloneDeep(tx_response);
      delete transaction_data.data;
      delete transaction_data.raw_log;
      delete transaction_data.events;
      transaction_data.timestamp = moment(timestamp).utc().valueOf();

      // convert some fields before insert to indexer
      if (messages) {
        if (['LinkRequest'].findIndex(s => toArray(messages).findIndex(m => m['@type']?.includes(s)) > -1) > -1) {
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
          ]
          .findIndex(s => toArray(messages).findIndex(m => m['@type']?.includes(s)) > -1) > -1
        ) {
          const fields = ['tx_id', 'burner_address', 'burn_address', 'address'];
          for (let i = 0; i < messages.length; i++) {
            const message = messages[i];
            if (typeof message?.amount === 'string') {
              const { attributes } = { ..._.head(toArray(logs).flatMap(l => toArray(l.events).filter(e => ['depositConfirmation', 'eventConfirmation'].findIndex(s => equalsIgnoreCase(e.type, s) || e.type?.includes(s)) > -1))) };
              const amount = toArray(attributes).find(a => a.key === 'amount')?.value;
              const denom = transaction_data.denom || message.denom;
              message.amount = [{ amount, denom }];
            }

            for (const field of fields) {
              if (Array.isArray(message[field])) {
                message[field] = toHex(message[field]);
              }
            }
            messages[i] = message;
          }
        }

        tx.body.messages = messages;
        transaction_data.tx = tx;
        tx_response.tx = tx;
        lcd_response.tx = tx;
        lcd_response.tx_response = tx_response;
      }

      if (transaction_data.tx?.body) {
        const { messages } = { ...transaction_data.tx.body };
        if (messages) {
          for (let i = 0; i < messages.length; i++) {
            const message = messages[i];
            if (message) {
              const fields = ['limit', 'chain'];
              for (const field of fields) {
                if (message[field] && typeof message[field] === 'object') {
                  message[field] = message[field].toString();   
                }
              }
              messages[i] = message;
            }
          }
          transaction_data.tx.body.messages = messages;
        }
      }

      /* start add addresses field */
      let addresses = [];
      const address_fields = ['voter', 'delegator_address', 'signer', 'sender', 'recipient', 'spender', 'receiver', 'depositAddress'];
      const { prefix_address } = { ...getChainData('axelarnet') };

      if (logs) {
        addresses = _.uniq(
          _.concat(
            addresses,
            toArray(logs).flatMap(l => toArray(l.events).flatMap(e => toArray(e.attributes).filter(a => address_fields.includes(a.key)).map(a => a.value))),
          )
          .map(a => toJson(a) || toHex(typeof a === 'string' ? normalizeQuote(a) : a))
          .filter(a => typeof a === 'string' && a.startsWith(prefix_address))
        );
      }

      if (messages) {
        addresses = _.uniq(
          _.concat(
            addresses,
            toArray(messages).flatMap(m => _.concat(address_fields.map(f => m[f]), address_fields.map(f => m.inner_message?.[f]))),
          )
          .map(a => toJson(a) || toHex(typeof a === 'string' ? normalizeQuote(a) : a))
          .filter(a => typeof a === 'string' && a.startsWith(prefix_address))
        );
      }
      transaction_data.addresses = addresses;
      /* end add addresses field */

      /* start add message types field */
      let types = [];
      // inner message type
      if (messages) {
        types = _.uniq(toArray(_.concat(types, toArray(messages).flatMap(m => m.inner_message?.['@type']))));
      }
      // message action
      if (logs) {
        types = _.uniq(toArray(_.concat(types, toArray(logs).flatMap(l => toArray(l.events).filter(e => equalsIgnoreCase(e.type, 'message')).flatMap(e => toArray(e.attributes).filter(a => a.key === 'action').map(a => a.value))))));
      }
      // message type
      if (messages) {
        types = _.uniq(toArray(_.concat(types, toArray(messages).flatMap(m => m['@type']))));
      }
      types = _.uniq(toArray(types.map(t => capitalize(_.last(toArray(t, 'normal', '.'))))));
      types = types.filter(t => !types.includes(`${t}Request`));
      transaction_data.types = types;
      /* end add message types field */

      if (!index_transfer && !index_poll) {
        await write(TX_COLLECTION, txhash, transaction_data, false, false);
      }
    }
    /*************************
     * end index transaction *
     *************************/

    /* start convert bytearray to hex */
    if (messages) {
      if (['VoteRequest'].findIndex(s => toArray(messages).findIndex(m => m['@type']?.includes(s) || m.inner_message?.['@type']?.includes(s)) > -1) > -1) {
        const fields = ['tx_id', 'to', 'sender', 'payload_hash', 'pre_operators', 'new_operators', 'token_address'];
        const event_fields = ['transfer', 'contract_call', 'contract_call_with_token', 'token_sent', 'multisig_operatorship_transferred', 'token_deployed'];

        for (let i = 0; i < messages.length; i++) {
          const message = messages[i];
          const { results, result, events } = { ...message?.inner_message?.vote };

          if (results) {
            for (let j = 0; j < results.length; j++) {
              const result = results[j];
              if (result) {
                for (const field of fields) {
                  if (Array.isArray(result[field])) {
                    result[field] = toHex(result[field]);
                  }
                  for (const event_field of event_fields) {
                    if (Array.isArray(result[event_field]?.[field])) {
                      result[event_field][field] = toHex(result[event_field][field]);
                    }
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
                    event[field] = toHex(event[field]);
                  }
                  for (const event_field of event_fields) {
                    if (Array.isArray(event[event_field]?.[field])) {
                      event[event_field][field] = toHex(event[event_field][field]);
                    }
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
                    event[field] = toHex(event[field]);
                  }
                  for (const event_field of event_fields) {
                    if (Array.isArray(event[event_field]?.[field])) {
                      event[event_field][field] = toHex(event[event_field][field]);
                    }
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
      tx_response.tx = tx;
      lcd_response.tx = tx;
      lcd_response.tx_response = tx_response;
    }
    /* end convert bytearray to hex */

    /* start index validator metrics & transfers */
    if (!code && tx_response && messages) {
      let updated;
      // Heartbeat
      if (toArray(messages).findIndex(m => m.inner_message?.['@type']?.includes('HeartBeatRequest')) > -1) {
        if (!index_transfer) {
          await require('./heartbeat')(lcd_response);
        }
      }
      // Link
      if (toArray(messages).findIndex(m => m['@type']?.includes('LinkRequest')) > -1) {
        if (!index_transfer) {
          await require('./link')(lcd_response);
        }
      }
      // MsgSend
      if (toArray(messages).findIndex(m => m['@type']?.includes('MsgSend')) > -1) {
        if (!index_poll) {
          await require('./axelar-send')(lcd_response);
        }
      }
      // MsgRecvPacket
      if (toArray(messages).findIndex(m => m['@type']?.includes('MsgRecvPacket')) > -1) {
        if (!index_poll) {
          lcd_response = await require('./cosmos-send')(lcd_response);
        }
      }
      // RouteIBCTransfers
      if (toArray(messages).findIndex(m => m['@type']?.includes('RouteIBCTransfersRequest')) > -1) {
        if (!index_poll) {
          const response = await require('./ibc-send')(lcd_response);
          logs = response?.logs || logs;
          updated = response?.updated;
        }
      }
      // MsgAcknowledgement
      if (toArray(messages).findIndex(m => m['@type']?.includes('MsgAcknowledgement')) > -1) {
        if (!index_poll) {
          updated = await require('./ibc-acknowledgement')(lcd_response);
        }
      }
      // MsgTimeout
      if (toArray(messages).findIndex(m => m['@type']?.includes('MsgTimeout')) > -1) {
        if (!index_poll) {
          updated = await require('./ibc-failed')(lcd_response);
        }
      }
      // ExecutePendingTransfers
      if (toArray(messages).findIndex(m => m['@type']?.includes('ExecutePendingTransfersRequest')) > -1) {
        if (!index_poll) {
          updated = await require('./axelar-transfer')(lcd_response);
        }
      }   
      // ConfirmTransferKey & ConfirmGatewayTx
      if (['ConfirmTransferKey', 'ConfirmGatewayTx'].findIndex(s => toArray(messages).findIndex(m => m['@type']?.includes(s)) > -1) > -1) {
        if (!index_transfer) {
          updated = await require('./confirm')(lcd_response);
        }
      }
      // ConfirmDeposit & ConfirmERC20Deposit
      if (CONFIRM_TYPES.findIndex(s => toArray(messages).findIndex(m => _.last(toArray(m['@type'], 'normal', '.'))?.replace('Request', '').includes(s)) > -1) > -1) {
        if (!index_poll) {
          await require('./confirm-deposit')(lcd_response);
        }
      }
      // VoteConfirmDeposit & Vote
      if (VOTE_TYPES.findIndex(s => toArray(messages).findIndex(m => _.last(toArray(m.inner_message?.['@type'], 'normal', '.'))?.replace('Request', '').includes(s)) > -1) > -1) {
        updated = await require('./vote')(lcd_response);
      }
      // SignCommands
      if (toArray(messages).findIndex(m => m['@type']?.includes('SignCommands')) > -1) {
        if (!index_poll) {
          await require('./batch')(lcd_response);
        }
      }
      // Cosmos GMP
      if (
        toArray(logs).filter(l => toArray(l.events).findIndex(e => ['ContractCallWithToken', 'ContractCall'].findIndex(event => e.type?.includes(`${event}Submitted`)) > -1) > -1).length > 0 ||
        toArray(messages).findIndex(m => m['@type']?.includes('RouteMessage')) > -1
      ) {
        await recoverEvents(txhash, height);
      }
      lcd_response.tx_response.raw_log = JSON.stringify(logs);
    }
    /* end index validator metrics & transfers */
  }

  return lcd_response;
};