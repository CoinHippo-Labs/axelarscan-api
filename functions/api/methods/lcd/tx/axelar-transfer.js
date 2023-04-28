const {
  formatUnits,
} = require('ethers');
const _ = require('lodash');
const moment = require('moment');

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
  getChainData,
} = require('../../../utils/config');
const {
  getGranularity,
} = require('../../../utils/time');
const {
  equalsIgnoreCase,
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
    height,
    timestamp,
    logs,
  } = { ...tx_response };

  const events =
    toArray(logs)
      .map(l => {
        const {
          events,
        } = { ...l };

        const e = toArray(events).find(e => equalsIgnoreCase(_.last(toArray(e.type, 'normal', '.')), 'AxelarTransferCompleted'));

        const {
          attributes,
        } = { ...e };

        const id = normalizeQuote(toArray(attributes).find(a => a.key === 'id')?.value);

        if (id) {
          attributes.push({ key: 'transfer_id', value: id });

          return {
            ...e,
            attributes,
          };
        }

        return null;
      })
      .filter(e => e)
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

  for (const event of events) {
    const {
      recipient,
      asset,
      transfer_id,
    } = { ...event };

    const {
      denom,
      amount,
    } = { ...toJson(asset) };

    const response =
      await read(
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
          },
        },
        { size: 1, sort: [{ 'send.created_at.ms': 'desc' }] },
      );

    let transfer_data = _.head(response?.data);
    const _id = generateId(transfer_data);

    if (_id) {
      transfer_data = {
        ...transfer_data,
        axelar_transfer: {
          txhash,
          height: Number(height),
          status: code ? 'failed' : 'success',
          type: 'axelar',
          created_at: getGranularity(moment(timestamp).utc()),
          destination_chain: 'axelarnet',
          recipient_address: recipient,
          denom,
          amount: Number(formatUnits(amount || '0', 6)),
          transfer_id,
        },
      };

      await write(TRANSFER_COLLECTION, _id, { ...transfer_data, time_spent: getTimeSpent(transfer_data) }, true);
      updated = true;
    }
  }

  return updated;
};