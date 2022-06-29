// import config
const config = require('config-yml');
// import module for generate timestamp
const moment = require('moment');

const log = (level, from, message, data = {}) => {
  try {
    // generate log message
    const log_message = `${level === 'error' ? 'ERR' : level === 'warn' ? 'WARN' : level === 'debug' ? 'DBG' : 'INF'} [${from?.toUpperCase()}] ${message}\n${typeof data === 'string' ? data : typeof data === 'object' && data ? JSON.stringify(data, null, 2) : data}`;

    // normalize level
    level = level?.toLowerCase();

    switch (level) {
      case 'error':
        console.error(log_message);
        break;
      case 'warn':
        console.warn(log_message);
        break;
      case 'debug':
        if (config?.log_level === 'debug') {
          console.debug(log_message);
        }
        break;
      default:
        console.log(log_message);
        break;
    };
  } catch (error) {}
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const equals_ignore_case = (a, b) => (!a && !b) || a?.toLowerCase() === b?.toLowerCase();

const get_params = req => {
  // initial params
  const params = {
    ...req.query,
    ...req.body,
  };
  return params;
};

const to_json = s => {
  if (s) {
    if (typeof s === 'object') return s;
    try {
      return JSON.parse(s);
    } catch (error) {}
  }
  return null;
};

const to_hex = byte_array => {
  let string = '0x';
  byte_array.forEach(byte => string += ('0' + (byte & 0xFF).toString(16)).slice(-2));
  return string;
};

const get_granularity = time => {
  return time && {
    ms: moment(time).valueOf(),
    hour: moment(time).startOf('hour').valueOf(),
    day: moment(time).startOf('day').valueOf(),
    week: moment(time).startOf('week').valueOf(),
    month: moment(time).startOf('month').valueOf(),
    quarter: moment(time).startOf('quarter').valueOf(),
    year: moment(time).startOf('year').valueOf(),
  };
};

const normalize_original_chain = chain => {
  if (chain) {
    chain = chain.trim().toLowerCase();
  }
  return chain;
};

const normalize_chain = chain => {
  if (chain) {
    chain = chain.split('-').filter(c => isNaN(c)).join('').trim().toLowerCase();
  }
  return chain;
};

const transfer_actions = ['ConfirmDeposit', 'ConfirmERC20Deposit'];

const vote_types = ['VoteConfirmDeposit', 'Vote'];

// get transaction
const getTransaction = async (provider, tx_hash, chain) => {
  // initial output
  let output;

  if (provider && tx_hash) {
    // initial transaction
    output = {
      id: tx_hash,
      chain,
    };

    try {
      // get transaction
      output.transaction = await provider.getTransaction(tx_hash);
      // get receipt
      output.receipt = await provider.getTransactionReceipt(tx_hash);
    } catch (error) {}
  }

  return output;
};

// get block time
const getBlockTime = async (provider, block_number) => {
  // initial output
  let output;

  if (provider && block_number) {
    try {
      // get block
      const block = await provider.getBlock(block_number);
      if (block?.timestamp) {
        output = block.timestamp;
      }
    } catch (error) {}
  }

  return output;
};

module.exports = {
  log,
  sleep,
  equals_ignore_case,
  get_params,
  to_json,
  to_hex,
  get_granularity,
  normalize_original_chain,
  normalize_chain,
  transfer_actions,
  vote_types,
  getTransaction,
  getBlockTime,
};