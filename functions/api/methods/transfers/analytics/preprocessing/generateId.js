const _ = require('lodash');

const {
  toArray,
} = require('../../../../utils');

module.exports = (
  data,
  delimiter = '_',
) => {
  const {
    _id,
    send,
  } = { ...data };

  const {
    txhash,
    source_chain,
  } = { ...send };

  return _id ? _id : txhash && source_chain ? toArray([txhash, source_chain], 'lower').join(delimiter) : undefined;
};