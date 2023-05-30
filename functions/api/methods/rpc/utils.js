const { base64ToString } = require('../../utils/base64');
const { toArray } = require('../../utils');

const decodeEvents = events => toArray(events).map(e => {
  const { attributes } = { ...e };
  return {
    ...e,
    attributes: toArray(attributes).map(a => {
      const { key, value } = { ...a };
      return {
        ...a,
        key: base64ToString(key),
        value: base64ToString(value),
      };
    }),
  };
});

module.exports = {
  decodeEvents,
};