const moment = require('moment');

const { recoverEvents } = require('../../crawler');
const { get, write } = require('../../../services/index');
const { ERC20_TRANSFER_COLLECTION, getChainKey } = require('../../../utils/config');

const method = 'saveERC20Transfer';
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
    id: 'tx_hash_transfer',
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
    const response = await write(ERC20_TRANSFER_COLLECTION, _id, { ...data, updated_at: moment().valueOf() }, true);
    const { result } = { ...response };
    if (data.tx_hash_transfer) {
      const { source_chain } = { ...await get(ERC20_TRANSFER_COLLECTION, _id) };
      if (source_chain) {
        await recoverEvents({ txHash: data.tx_hash_transfer, chain: source_chain });
      }
    }
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