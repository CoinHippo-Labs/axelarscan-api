const {
  Contract,
} = require('ethers');

const gatewaySubscriber = require('./gateway/subscribe');
const {
  getTransaction,
} = require('../../transfers/utils');
const {
  getChainData,
  getContracts,
  GATEWAY_EVENTS,
} = require('../../../utils/config');
const {
  getProvider,
} = require('../../../utils/chain/evm');
const {
  sleep,
} = require('../../../utils');

const IAxelarGateway = require('../../../data/contracts/interfaces/IAxelarGateway.json');

const contracts = getContracts();

module.exports = async params => {
  let output;

  const method = 'recoverEvents';

  const {
    txHash,
    toBlockNumber,
  } = { ...params };
  let {
    blockNumber,
    chain,
  } = { ...params };

  // normalize
  chain = chain?.toLowerCase();

  if (!(chain && (txHash || blockNumber))) {
    output = {
      error: true,
      code: 400,
      message: 'parameters not valid',
    };
  }
  else {
    let chain_data = getChainData(chain, 'evm');

    if (chain_data) {
      if (!chain_data.endpoints?.rpc) {
        output = {
          error: true,
          code: 500,
          message: 'wrong api configuration',
        };
      }
      else {
        const provider = getProvider(chain);

        // get block number by transaction hash
        if (!blockNumber) {
          const response = await getTransaction(provider, txHash, chain);

          const {
            transaction,
            receipt,
          } = { ...response };

          blockNumber = receipt?.blockNumber || transaction?.blockNumber;
        }

        if (blockNumber) {
          const {
            gateway_contracts,
          } = { ...contracts };

          // set chain data
          chain_data = {
            ...chain_data,
            id: chain,
            provider,
            gateway: {
              ...gateway_contracts?.[chain],
              abi: IAxelarGateway.abi,
            },
          };

          // contracts
          const gateway = new Contract(chain_data.gateway.address, chain_data.gateway.abi, provider);

          // filters
          const gateway_filters = GATEWAY_EVENTS;

          // filter options
          const options = {
            fromBlock: blockNumber,
            toBlock: toBlockNumber || (blockNumber + 1),
          };

          if (txHash) {
            const events = toArray(await Promise.all(gateway_filters.flatMap(e => new Promise(async resolve => resolve(await gatewaySubscriber.getPastEvents(chain_data, e, options))))));

            output = {
              code: 200,
              message: 'events recovered at the specific block',
              method,
              params,
              events,
            };
          }
          else {
            gateway_filters.forEach(e => gatewaySubscriber.getPastEvents(chain_data, e, options));
            await sleep(5 * 1000);

            output = {
              code: 200,
              message: 'already run at the specific block',
              method,
              params,
            };
          }
        }
        else {
          output = {
            error: true,
            code: 404,
            message: 'blockNumber not found',
            method,
            params,
          };
        }
      }
    }
  }

  return output;
};