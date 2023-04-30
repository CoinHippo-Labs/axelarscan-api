const {
  formatUnits,
} = require('ethers');
const _ = require('lodash');
const moment = require('moment');

const rpc = require('../../rpc');
const {
  generateId,
} = require('../../transfers/analytics/preprocessing');
const {
  getTimeSpent,
} = require('../../transfers/analytics/analyzing');
const {
  read,
  write,
} = require('../../../services/index');
const {
  TRANSFER_COLLECTION,
  getAssetData,
} = require('../../../utils/config');
const {
  getGranularity,
} = require('../../../utils/time');
const {
  equalsIgnoreCase,
  toArray,
  toJson,
  normalizeQuote,
} = require('../../../utils');

module.exports = async (
  lcd_response = {},
) => {
  let updated = false;

  const {
    tx_response,
  } = { ...lcd_response };

  const {
    txhash,
    code,
    timestamp,
    logs,
  } = { ...tx_response };
  let {
    height,
  } = { ...tx_response };

  height = Number(height);

  let transfer_events;

  if (height && toArray(logs).length > 0) {
    const response = await rpc('/block_results', { height });

    const {
      end_block_events,
    } = { ...response };

    if (toArray(logs).findIndex(l => toArray(l.events).findIndex(e => equalsIgnoreCase(e.type, 'send_packet')) > -1) < 0) {
      const events = toArray(end_block_events).filter(e => equalsIgnoreCase(e.type, 'send_packet') && toArray(e.attributes).length > 0);

      for (const event of events) {
        const {
          attributes,
        } = { ...event };

        const {
          sender,
        } = { ...toJson(toArray(attributes).find(a => a.key === 'packet_data')?.value) };

        if (sender && toArray(logs).findIndex(l => toArray(l.events).findIndex(e => toArray(e.attributes).findIndex(a => ['minter', 'receiver'].includes(a.key) && equalsIgnoreCase(a.value,  sender)) > -1 || (toArray(e.attributes).findIndex(a => a.value === 'RouteIBCTransfers') > -1 && events.length === 1)) > -1) > -1) {
          logs[0] = {
            ..._.head(logs),
            events: toArray(_.concat(_.head(logs).events, event)),
          };
        }
      }
    }

    transfer_events =
      toArray(end_block_events)
        .filter(e => equalsIgnoreCase(_.last(toArray(e.type, 'normal', '.')), 'IBCTransferSent') && toArray(e.attributes).length > 0)
        .map(e => {
          const {
            attributes,
          } = { ...e };

          return (
            Object.fromEntries(
              toArray(attributes)
                .filter(a => a.key && a.value)
                .map(a => {
                  const {
                    key,
                    value,
                  } = { ...a };

                  return [key, toJson(value) || (typeof value === 'string' ? normalizeQuote(value) : value)];
                })
            )
          );
        });
  }

  const events =
    toArray(logs)
      .flatMap(l => toArray(l.events).filter(e => equalsIgnoreCase(e.type, 'send_packet')))
      .filter(e => toArray(e.attributes).length > 0)
      .flatMap(e => {
        let {
          attributes,
        } = { ...e };

        attributes = toArray(attributes).filter(a => a.key && a.value);

        const events = [];
        let event;

        attributes.forEach((a, i) => {
          const {
            key,
            value,
          } = { ...a };

          if (key === 'packet_data' || i === attributes.length - 1) {
            if (event) {
              events.push(event);
            }
            event = {};
          }

          event = {
            ...event,
            [key]: key === 'packet_data' ? toJson(value) : value,
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
          denom,
          amount,
        } = { ...packet_data };

        const {
          decimals,
        } = { ...getAssetData(denom) };

        return {
          id: txhash,
          height,
          status: code ? 'failed' : 'success',
          status_code: code,
          type: 'RouteIBCTransfersRequest',
          created_at: getGranularity(moment(timestamp).utc()),
          sender_address: sender,
          recipient_address: receiver,
          denom,
          amount: Number(formatUnits(amount, decimals || 6)),
          transfer_id: toArray(transfer_events).find(e => equalsIgnoreCase(normalizeQuote(e.recipient || e.receipient), receiver) && equalsIgnoreCase(e.asset?.denom, denom) && equalsIgnoreCase(e.asset?.amount, amount))?.id,
          packet: e,
        };
      });

  for (const event of events) {
    const {
      id,
      height,
      status,
      type,
      created_at,
      sender_address,
      recipient_address,
      denom,
      amount,
      transfer_id,
      packet,
    } = { ...event };

    const {
      ms,
    } = { ...created_at };

    const ibc_send = {
      txhash: id,
      height,
      status,
      type,
      created_at,
      sender_address,
      recipient_address,
      denom,
      amount,
      transfer_id,
      packet,
    };

    const response =
      await read(
        TRANSFER_COLLECTION,
        {
          bool: {
            must:
              transfer_id ?
                [
                  {
                    bool: {
                      should: [
                        { match: { 'confirm.transfer_id': transfer_id } },
                        { match: { 'vote.transfer_id': transfer_id } },
                        { match: { transfer_id } },
                      ],
                      minimum_should_match: 1,
                    },
                  },
                ] :
                [
                  { match: { 'ibc_send.txhash': id } },
                  { match: { 'ibc_send.recipient_address': recipient_address } },
                  { match: { 'ibc_send.denom': denom } },
                ],
          },
        },
        { size: 1 },
      );

    let {
      data,
    } = { ...response };

    if (toArray(data).filter(d => typeof d.send?.amount_received === 'number').length < 1) {
      const response =
        await read(
          TRANSFER_COLLECTION,
          {
            bool: {
              must: [
                { match: { 'send.status': 'success' } },
                { match: { 'link.recipient_address': recipient_address } },
                { range: { 'send.created_at.ms': { lte: ms, gte: moment(ms).subtract(24 * 7, 'hours').valueOf() } } },
                { match: { 'send.denom': denom } },
                { range: { 'send.amount': { gte: Math.floor(amount) } } },
                {
                  bool: {
                    should: [
                      { match: { 'send.amount_received': amount } },
                      {
                        bool: {
                          must: [
                            { range: { 'send.amount': { lte: Math.ceil(amount * 1.2) } } },
                          ],
                          must_not: [
                            { exists: { field: 'send.amount_received' } },
                          ],
                        },
                      },
                    ],
                    minimum_should_match: 1,
                  },
                },
              ],
              should: [
                { exists: { field: 'confirm' } },
                { exists: { field: 'vote' } },
              ],
              minimum_should_match: 1,
              must_not: [
                { exists: { field: 'ibc_send' } },
              ],
            },
          },
          { size: 1, sort: [{ 'send.created_at.ms': 'desc' }] },
        );

      data = response?.data;
    }

    let transfer_data = _.head(data);
    const _id = generateId(transfer_data);

    if (_id && !_.isEqual(transfer_data.ibc_send, ibc_send)) {
      transfer_data = {
        ...transfer_data,
        ibc_send,
      };

      await write(TRANSFER_COLLECTION, _id, { ...transfer_data, time_spent: getTimeSpent(transfer_data) }, true);
      updated = true;
    }
  }

  return {
    logs,
    updated,
  };
};