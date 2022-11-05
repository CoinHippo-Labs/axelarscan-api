const _ = require('lodash');
const {
  to_json,
} = require('../../../utils');

module.exports = async (
  events = [],
) => {
  let response;

  events = events
    .filter(e =>
      e?.type &&
      e.attributes?.length > 0
    );

  for (const event of events) {
    const {
      type,
      attributes,
    } = { ...event };

    const _type =
      _.last(
        (type || '')
          .split('.')
          .filter(s => s)
      );

    const data = [];
    let _data = {};

    for (let i = 0; i < attributes.length; i++) {
      const {
        key,
        value,
      } = { ...attributes[i] };

      const is_new_record = key in _data;

      if (is_new_record) {
        data.push(_data);

        _data = {};
      }

      _data[key] =
        to_json(value) ||
        value;

      if (i === attributes.length - 1) {
        data.push(_data);
      }
    }

    switch (_type) {
      case 'IBCTransferSent':
        break;
      default:
        break;
    }
  }

  response = events;

  return response;
};