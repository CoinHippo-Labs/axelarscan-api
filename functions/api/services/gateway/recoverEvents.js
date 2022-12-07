const {
  Contract,
} = require('ethers');
const config = require('config-yml');
const gateway_subscriber = require('./subscribe');
const {
  sleep,
  getTransaction,
  getProvider,
} = require('../../utils');
const IAxelarGateway = require('../../data/contracts/interfaces/IAxelarGateway.json');

module.exports = async (
  chains_config = {},
  contracts_config = {},
  chain,
  txHash,
  blockNumber,
  toBlockNumber,
) => {
  let output;

  const environment =
    process.env.ENVIRONMENT ||
    config?.environment;

  const indexer_url = process.env.INDEXER_URL;

  // normalize
  chain = chain?.toLowerCase();

  // setup chain config
  let chain_config = {
    ...chains_config[chain],
  };

  // contracts configuration
  const {
    gateway_contracts,
  } = { ...contracts_config };

  if (
    !(
      chain &&
      (
        txHash ||
        blockNumber
      )
    )
  ) {
    output = {
      error: true,
      code: 400,
      message: 'parameters not valid',
    };
  }
  else if (!chains_config[chain]) {
    output = {
      error: true,
      code: 400,
      message: 'chain not valid',
    };
  }
  else if (
    !(
      environment &&
      indexer_url &&
      chain_config.endpoints?.rpc
    )
  ) {
    output = {
      error: true,
      code: 500,
      message: 'wrong api configuration',
    };
  }
  else {
    // initial provider
    const provider =
      getProvider(
        chain,
      );

    // get block number (if not exists) from transaction hash
    if (!blockNumber) {
      const response =
        await getTransaction(
          provider,
          txHash,
          chain,
        );

      const {
        transaction,
        receipt,
      } = { ...response };

      blockNumber =
        receipt?.blockNumber ||
        transaction?.blockNumber;
    }

    if (blockNumber) {
      // initial chain config
      chain_config = {
        ...chain_config,
        id: chain,
        provider,
        gateway: {
          ...gateway_contracts?.[chain],
          abi: IAxelarGateway.abi,
        },
      };

      const {
        gateway,
      } = { ...chain_config };

      // initial contracts
      const gateway_contract =
        new Contract(
          gateway?.address,
          gateway?.abi,
          provider,
        );

      // initial filters
      const gateway_filters =
        [
          gateway_contract.filters.TokenSent(),
          gateway_contract.filters.Executed(),
        ];

      toBlockNumber =
        toBlockNumber ||
        (
          blockNumber + 1
        );

      // initial blockchain query filters options data
      const options = {
        fromBlock: blockNumber,
        toBlock: toBlockNumber,
      };

      // get past events from contracts
      gateway_subscriber
        .getPastEvents(
          chain_config,
          gateway_filters,
          options,
        );

      await sleep(5 * 1000);

      output = {
        code: 200,
        message: 'already run at the specific block',
        method: 'recoverEvents',
        params: {
          chain,
          txHash,
          blockNumber,
          toBlockNumber,
        },
      };
    }
    else {
      output = {
        error: true,
        code: 404,
        message: 'blockNumber not found',
        method: 'recoverEvents',
        params: {
          chain,
          txHash,
          blockNumber,
          toBlockNumber,
        },
      };
    }
  }

  return output;
};