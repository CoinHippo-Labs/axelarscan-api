const _ = require('lodash');
const moment = require('moment');

const lcd = require('../../lcd');
const { write } = require('../../../services/index');
const { UNWRAP_COLLECTION, getChainKey } = require('../../../utils/config');

const method = 'saveUnwrap';
const fields = [
  {
    id: 'deposit_address',
    type: 'string',
    required: true,
    is_key: true,
  },
  {
    id: 'tx_hash',
    type: 'string',
    required: true,
    is_key: true,
  },
  {
    id: 'deposit_address_link',
    type: 'string',
    required: true,
  },
  {
    id: 'tx_hash_unwrap',
    type: 'string',
    required: true,
  },
  {
    id: 'destination_chain',
    type: 'string',
    normalize: s => getChainKey(s),
  },
];

module.exports = async (params = {}) => {
  if (!params.tx_hash && params.tx_hash_msg_update_client) {
    const { tx_hash_msg_update_client } = { ...params };
    let { tx_hash } = { ...params };
    const lcd_response = await lcd(`/cosmos/tx/v1beta1/txs/${tx_hash_msg_update_client}`, { index: true });
    const { tx_hashes, source_chain } = { ...lcd_response };
    tx_hash = _.head(tx_hashes);
    if (tx_hash) {
      params.tx_hash = tx_hash;
    }
    if (source_chain) {
      params.source_chain = source_chain;
    }
  }

  if (
    fields.findIndex(f => {
      const { id, type, required } = { ...f };
      const value = params[id];
      const is_type_valid = !type || typeof value === type;
      return !(required ? value && is_type_valid : value === undefined || is_type_valid);
    }) > -1
  ) {
    return {
      error: true,
      code: 400,
      message: 'parameters not valid',
      method,
      params,
    };
  }
  else if (fields.findIndex(f => f.is_key) < 0) {
    return {
      error: true,
      code: 500,
      message: 'wrong api configuration',
      method,
    };
  }
  else {
    const data = Object.fromEntries(
      fields.map(f => {
        const { id, normalize } = { ...f };
        const value = typeof normalize === 'function' ? normalize(params[id]) : params[id];
        return [id, value];
      })
    );
    const _id = fields.filter(f => f.is_key && params[f.id]).map(f => params[f.id].toLowerCase()).join('_');
    const response = await write(UNWRAP_COLLECTION, _id, { ...data, updated_at: moment().valueOf() }, true);
    const { result } = { ...response };
    return {
      error: false,
      code: 200,
      method,
      _id,
      data,
      result,
    };
  }
};