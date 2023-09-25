const _ = require('lodash');
const moment = require('moment');

const { generateId } = require('../../transfers/analytics/preprocessing');
const { getTimeSpent } = require('../../transfers/analytics/analyzing');
const { read, write } = require('../../../services/index');
const { getLCDs } = require('../../../utils/chain/cosmos');
const { TRANSFER_COLLECTION, getChainData } = require('../../../utils/config');
const { getGranularity } = require('../../../utils/time');
const { equalsIgnoreCase, toArray, toJson, normalizeQuote } = require('../../../utils');

module.exports = async (lcd_response = {}) => {
  let updated = false;

  const { tx, tx_response } = { ...lcd_response };
  const { messages } = { ...tx?.body };
  const { txhash, code, logs } = { ...tx_response };
  const height = Number(toArray(messages).find(m => equalsIgnoreCase(_.last(toArray(m['@type'], 'normal', '.')), 'MsgAcknowledgement'))?.proof_height?.revision_height || '0') - 1;

  if (height) {
    const events = toArray(logs)
      .map(l => {
        const { events } = { ...l };
        const e = toArray(events).find(e => equalsIgnoreCase(e.type, 'acknowledge_packet'));
        const _e = toArray(events).find(e => equalsIgnoreCase(_.last(toArray(e.type, 'normal', '.')), 'IBCTransferCompleted'));
        const id = normalizeQuote(toArray(_e?.attributes).find(a => a.key === 'id')?.value);
        if (id) {
          const { attributes } = { ...e };
          if (toArray(attributes).findIndex(a => a.key === 'packet_sequence') > -1) {
            attributes.push({ key: 'transfer_id', value: id });
            return { ...e, attributes };
          }
        }
        return null;
      })
      .filter(e => e)
      .map(e => {
        const { attributes } = { ...e };
        return {
          id: txhash,
          height,
          ...Object.fromEntries(
            toArray(attributes)
              .filter(a => a.key && a.value)
              .map(a => {
                const { key, value } = { ...a };
                return [key, toJson(value) || (typeof value === 'string' ? normalizeQuote(value) : value)];
              })
          ),
        };
      });

    for (const event of events) {
      const {
        id,
        height,
        transfer_id,
        packet_timeout_height,
        packet_sequence,
        packet_src_channel,
        packet_dst_channel,
        packet_connection,
      } = { ...event };

      const response = await read(
        TRANSFER_COLLECTION,
        {
          bool: {
            must: [
              { match: { 'ibc_send.packet.packet_timeout_height': packet_timeout_height } },
              { match: { 'ibc_send.packet.packet_sequence': packet_sequence } },
              { match: { 'ibc_send.packet.packet_src_channel': packet_src_channel } },
              { match: { 'ibc_send.packet.packet_dst_channel': packet_dst_channel } },
            ],
            should: transfer_id ?
              [
                {
                  bool: {
                    should: [
                      { match: { 'confirm.transfer_id': transfer_id } },
                      { match: { 'vote.transfer_id': transfer_id } },
                      { match: { 'ibc_send.transfer_id': transfer_id } },
                      { match: { transfer_id } },
                    ],
                    minimum_should_match: 1,
                  },
                },
              ] :
              [
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
        { size: 1, sort: [{ 'send.created_at.ms': 'desc' }] },
      );
      let transfer_data = _.head(response?.data);
      const _id = generateId(transfer_data);

      if (_id) {
        const { send, link } = { ...transfer_data };
        let { ibc_send } = { ...transfer_data };
        ibc_send = {
          ...ibc_send,
          ack_txhash: !code ? id : null,
          failed_txhash: !code ? transfer_id ? null : undefined : id,
        };
        transfer_data = { ...transfer_data, ibc_send };

        await write(TRANSFER_COLLECTION, _id, { ...transfer_data, time_spent: getTimeSpent(transfer_data) }, true);
        updated = true;

        let { destination_chain } = { ...send };
        const { packet_data_hex, packet_sequence } = { ...ibc_send?.packet };
        destination_chain = destination_chain || link?.destination_chain;

        if (!code && height && destination_chain && packet_data_hex) {
          const chain_data = getChainData(destination_chain, 'cosmos');
          const chain = chain_data?.id;
          const lcd = getLCDs(chain);

          if (chain !== 'axelarnet' && lcd) {
            let response = await lcd.query(`/cosmos/tx/v1beta1/txs?limit=5&events=recv_packet.packet_sequence=${packet_sequence}&events=tx.height=${height}`);
            let { txs, tx_responses } = { ...response };
            if (toArray(tx_responses).length < 1) {
              response = await lcd.query(`/cosmos/tx/v1beta1/txs?limit=5&events=${encodeURIComponent(`recv_packet.packet_data_hex='${packet_data_hex}'`)}&events=tx.height=${height}`);
              if (response) {
                txs = response.txs;
                tx_responses = response.tx_responses;
              }
            }
            if (toArray(tx_responses).length < 1) {
              response = await lcd.query(`/cosmos/tx/v1beta1/txs?limit=5&events=tx.height=${height}`);
              if (response) {
                txs = response.txs;
                tx_responses = response.tx_responses;
              }
            }

            const transaction_data = toArray(tx_responses).find(d => {
              const { attributes } = { ..._.head(toArray(d.logs).flatMap(l => toArray(l.events).filter(e => equalsIgnoreCase(e.type, 'recv_packet')))) };
              return packet_sequence === toArray(attributes).find(a => a.key === 'packet_sequence')?.value;
            });
            const { txhash, timestamp, logs } = { ...transaction_data };

            if (txhash) {
              const { attributes } = { ..._.head(toArray(logs).flatMap(l => toArray(l.events).filter(e => equalsIgnoreCase(e.type, 'write_acknowledgement')))) };
              const packet_ack = toArray(attributes).find(a => a.key === 'packet_ack')?.value;
              const { result, error } = { ...toJson(packet_ack) };
              const failed = !['AQ==', 'MQ=='].includes(result) || !!error;

              ibc_send = {
                ...ibc_send,
                ack_txhash: failed ? null : id,
                recv_txhash: txhash,
                received_at: failed ? undefined : getGranularity(moment(timestamp).utc()),
                failed_txhash: failed ? id : undefined,
              };
              transfer_data = { ...transfer_data, ibc_send };
              await write(TRANSFER_COLLECTION, _id, { ...transfer_data, time_spent: getTimeSpent(transfer_data) }, true);
            }
          }
        }
      }
    }
  }

  return updated;
};