const {
  providers: { FallbackProvider, JsonRpcProvider },
} = require('ethers');
const _ = require('lodash');
const moment = require('moment');
const config = require('config-yml');

const environment =
  process.env.ENVIRONMENT ||
  config?.environment;

const {
  log_level,
} = { ...config };

const evm_chains_data =
  require('../data')?.chains?.[environment]?.evm ||
  [];
const cosmos_chains_data =
  require('../data')?.chains?.[environment]?.cosmos ||
  [];
const chains_data =
  _.concat(
    evm_chains_data,
    cosmos_chains_data,
  );

const log = (
  level = 'info',
  from,
  message,
  data = {},
) => {
  try {
    // normalize level
    level = level.toLowerCase();

    // generate log message
    const log_message = `${level === 'error' ?
      'ERR' :
      level === 'warn' ?
        'WARN' :
        level === 'debug' ?
          'DBG' :
          'INF'
    } [${from?.toUpperCase()}] ${message}\n${typeof data === 'string' ?
      data :
      typeof data === 'object' ?
        JSON.stringify(
          data,
          null,
          2,
        ) :
        data
    }`;

    switch (level) {
      case 'error':
        console.error(log_message);
        break;
      case 'warn':
        console.warn(log_message);
        break;
      case 'debug':
        if (
          log_level === 'debug' ||
          process.env.LOG_LEVEL === 'debug'
        ) {
          console.debug(log_message);
        }
        break;
      default:
        console.log(log_message);
        break;
    }
  } catch (error) {}
};

const sleep = ms =>
  new Promise(resolve =>
    setTimeout(
      resolve,
      ms,
    )
  );

const equals_ignore_case = (
  a,
  b,
) =>
  (!a && !b) ||
  a?.toLowerCase() === b?.toLowerCase();

const capitalize = s =>
  typeof s !== 'string' ?
    '' :
    s
      .trim()
      .split('-')
      .join(' ')
      .split('_')
      .join(' ')
      .split(' ')
      .map(c => c.trim())
      .filter(c => c)
      .map(c =>
        `${
          c.substr(
            0,
            1,
          )
          .toUpperCase()
        }${
          c.substr(1)
        }`
      )
      .join(' ');

const get_params = req => {
  return {
    ...req.query,
    ...req.body,
  };
};

const to_json = s => {
  if (s) {
    if (typeof s === 'object') {
      return s;
    }

    try {
      return JSON.parse(s);
    } catch (error) {}
  }

  return null;
};

const to_hex = byte_array => {
  let string = '0x';

  if (
    typeof byte_array === 'string' &&
    byte_array.startsWith('[') &&
    byte_array.endsWith(']')
  ) {
    byte_array = to_json(byte_array);
  }

  if (Array.isArray(byte_array)) {
    byte_array
      .forEach(byte =>
        string += (
          '0' +
          (byte & 0xFF)
            .toString(16)
        )
        .slice(-2)
      );
  }
  else {
    string = byte_array;
  }

  return string;
};

const decode_base64 = s => {
  if (!s) {
    return '';
  }

  const buffer =
    new Buffer(
      s,
      'base64',
    );

  return buffer.toString();
};

const get_granularity = time => {
  return time &&
    {
      ms: moment(time)
        .valueOf(),
      hour: moment(time)
        .startOf('hour')
        .valueOf(),
      day: moment(time)
        .startOf('day')
        .valueOf(),
      week: moment(time)
        .startOf('week')
        .valueOf(),
      month: moment(time)
        .startOf('month')
        .valueOf(),
      quarter: moment(time)
        .startOf('quarter')
        .valueOf(),
      year: moment(time)
        .startOf('year')
        .valueOf(),
    };
};

const normalize_original_chain = chain => {
  if (chain) {
    chain = chain
      .trim()
      .toLowerCase()
      .split('"')
      .join('');
  }

  return chain;
};

const normalize_chain = chain => {
  const regex = /^[0-9.\b]+$/;

  if (chain) {
    chain = chain
      .trim()
      .toLowerCase()
      .split('"')
      .join('');

    if (
      chains_data
        .findIndex(c =>
          equals_ignore_case(
            c?.id,
            chain,
          )
        ) < 0
    ) {
      chain = chain
        .split('-')
        .filter(c =>
          !regex.test(c)
        )
        .join('');
    }
  }

  return chain;
};

const transfer_actions =
  [
    'ConfirmDeposit',
    'ConfirmERC20Deposit',
  ];

const vote_types =
  [
    'VoteConfirmDeposit',
    'Vote',
  ];

const getTransaction = async (
  provider,
  tx_hash,
  chain,
) => {
  let output;

  if (
    provider &&
    tx_hash
  ) {
    output = {
      id: tx_hash,
      chain,
    };

    try {
      // get transaction
      output.transaction =
        await provider
          .getTransaction(
            tx_hash,
          );

      // get receipt
      output.receipt =
        await provider
          .getTransactionReceipt(
            tx_hash,
          );
    } catch (error) {}
  }

  return output;
};

const getBlockTime = async (
  provider,
  block_number,
) => {
  let output;

  if (
    provider &&
    block_number
  ) {
    try {
      // get block
      const block =
        await provider
          .getBlock(
            block_number,
          );

      const {
        timestamp,
      } = { ...block };

      if (timestamp) {
        output = timestamp;
      }
    } catch (error) {}
  }

  return output;
};

const getProvider = (
  chain_data,
  _rpcs,
) => {
  const {
    provider_params,
  } = { ...chain_data };
  const {
    rpcUrls,
  } = { ..._.head(provider_params) };

  /* start normalize rpcs */
  let rpcs =
    _rpcs ||
    rpcUrls;
  if (!Array.isArray(rpcs)) {
    rpcs = [rpcs];
  }
  rpcs = rpcs
    .filter(url => url);
  /* end normalize rpcs */

  const provider = rpcs.length > 0 ?
    rpcs.length === 1 ?
      new JsonRpcProvider(rpcs[0]) :
      new FallbackProvider(
        rpcs
          .map((url, i) => {
            return {
              provider: new JsonRpcProvider(url),
              priority: i + 1,
              stallTimeout: 1000,
            };
          }),
        rpcs.length / 3,
      ) :
    null;

  return provider;
};

module.exports = {
  log,
  sleep,
  equals_ignore_case,
  capitalize,
  get_params,
  to_json,
  to_hex,
  decode_base64,
  get_granularity,
  normalize_original_chain,
  normalize_chain,
  transfer_actions,
  vote_types,
  getTransaction,
  getBlockTime,
  getProvider,
};