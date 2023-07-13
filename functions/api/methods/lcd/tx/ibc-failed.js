const _ = require('lodash');

const { generateId } = require('../../transfers/analytics/preprocessing');
const { getTimeSpent } = require('../../transfers/analytics/analyzing');
const { read, write } = require('../../../services/index');
const { TRANSFER_COLLECTION } = require('../../../utils/config');
const { equalsIgnoreCase, toArray, toJson, normalizeQuote } = require('../../../utils');

module.exports = async (lcd_response = {}) => {
  let updated = false;

  const { tx_response } = { ...lcd_response };
  const { txhash, logs } = { ...tx_response };

  const events =
    toArray(logs)
      .map(l => {
        const { events } = { ...l };
        const e = toArray(events).find(e => equalsIgnoreCase(_.last(toArray(e.type, 'normal', '.')), 'IBCTransferFailed'));
        const { attributes } = { ...e };
        const id = normalizeQuote(toArray(attributes).find(a => a.key === 'id')?.value);
        if (id) {
          attributes.push({ key: 'transfer_id', value: id });
          return { ...e, attributes };
        }
        return null;
      })
      .filter(e => e)
      .map(e => {
        const { attributes } = { ...e };
        return (
          Object.fromEntries(
            toArray(attributes)
              .filter(a => a.key && a.value)
              .map(a => {
                const { key, value } = { ...a };
                return [key, toJson(value) || (typeof value === 'string' ? normalizeQuote(value) : value)];
              })
          )
        );
      });

  for (const event of events) {
    const { transfer_id } = { ...event };
    const response = await read(
      TRANSFER_COLLECTION,
      {
        bool: {
          must: [
            { exists: { field: 'send.txhash' } },
            { match: { 'send.status': 'success' } },
          ],
          should: [
            { match: { 'confirm.transfer_id': transfer_id } },
            { match: { 'vote.transfer_id': transfer_id } },
            { match: { transfer_id } },
          ],
          minimum_should_match: 1,
          must_not: [
            { exists: { field: 'ibc_send.ack_txhash' } },
          ],
        },
      },
      { size: 1, sort: [{ 'send.created_at.ms': 'desc' }] },
    );
    let transfer_data = _.head(response?.data);
    const _id = generateId(transfer_data);

    if (_id) {
      const { ibc_send } = { ...transfer_data };
      transfer_data = {
        ...transfer_data,
        ibc_send: {
          ...ibc_send,
          failed_txhash: txhash,
        },
      };
      await write(TRANSFER_COLLECTION, _id, { ...transfer_data, time_spent: getTimeSpent(transfer_data) }, true);
      updated = true;
    }
  }

  return updated;
};