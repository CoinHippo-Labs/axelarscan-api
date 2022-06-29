// import ethers.js
const { Contract } = require('ethers');
// import config
const config = require('config-yml');
// import api
const { getLatestEventBlock, saveEvent } = require('../api');
// import utils
const { log, sleep } = require('../../../utils');

// service name
const service_name = 'gateway-subscriber';

// initial environment
const environment = process.env.ENVIRONMENT;
// initial number of block per query
const num_query_block = config?.[environment]?.past_events_block_per_request || 100;

// initial events
const events_name = ['TokenSent'];

// subscribe contract
const subscribe = async (chain_config, data, _environment) => {
  if (chain_config && data) {
    try {
      const { id, gateway } = { ...chain_config };
      const chain = id;
      // set id
      data.id = `${data.transactionHash}_${data.transactionIndex}_${data.logIndex}`;
      // construct returnValues from arguments
      if (data?.args && gateway?.abi) {
        const abi = gateway.abi;
        if (abi?.findIndex(a => a?.name === data.event && a?.inputs) > -1) {
          const returnValues = {};
          const inputs = abi.find(a => a?.name === data.event).inputs || [];
          inputs.forEach((input, i) => {
            if (input?.name) {
              returnValues[input.name] = data.args[i];
            }
          });
          data.returnValues = returnValues;
          delete data.args;
        }
      }
      // normalize
      try {
        data = JSON.parse(JSON.stringify(data));
      } catch (error) {}
      if (events_name.includes(data.event)) {
        log('info', service_name, `event emitted: ${data.event}`, { chain, ...data });
        // save event
        await saveEvent(data, chain, gateway?.address, _environment);
      }
    } catch (error) {
      log('error', service_name, 'general', { error: { ...error } });
    }
  }
};

// get past events
const getPastEvents = async (chain_config, filters, options) => {
  if (chain_config && filters && options) {
    const { id, gateway, provider } = { ...chain_config };
    const chain = id;

    // initial contract
    const contract = new Contract(gateway?.address, gateway?.abi, provider);

    log('info', service_name, 'get past gateway events', { chain, contract_address: contract.address, options });
    const events = await contract.queryFilter(filters, options.fromBlock, options.toBlock)
      .catch(error => { return { error }; });
    if (!events?.error) {
      if (events) {
        for (let i = 0; i < events.length; i++) {
          const event = events[i];
          await subscribe(chain_config, event, options.environment);
        }
      }
      return;
    }
    else {
      log('warn', service_name, 'get past gateway events', { chain, contract_address: contract.address, options, error: { message: events.error.message } });
      await sleep(3 * 1000);
      return await getPastEvents(chain_config, filters, options);
    }
  }
  return;
};

// sync events
const sync = async (chain_config, filters) => {
  if (chain_config) {
    const { id, provider } = { ...chain_config };
    const chain = id;

    // get latest block
    let latest_events_block, latest_block;
    try {
      const latest_event_block = await getLatestEventBlock(chain);
      latest_events_block = latest_event_block?.latest?.gateway_block - num_query_block;
      latest_block = await provider.getBlockNumber();
    } catch (error) {}

    // initial events options for get past events
    const options = latest_events_block ?
      { fromBlock: latest_events_block, toBlock: latest_block } :
      latest_block ?
        { fromBlock: latest_block - num_query_block, toBlock: latest_block } :
        { fromBlock: latest_block };

    let synced = false;
    while (!synced) {
      // check synced and set options
      if (typeof latest_block !== 'number' || typeof options.fromBlock !== 'number') {
        synced = true;
      }
      else if (latest_block - options.fromBlock >= num_query_block) {
        options.fromBlock = options.fromBlock + (options.toBlock === latest_block ? 0 : num_query_block);
        options.toBlock = options.fromBlock + num_query_block - 1;
        if (options.toBlock > latest_block) {
          options.toBlock = latest_block;
        }
      }
      else {
        options.fromBlock = options.toBlock === latest_block ? options.fromBlock : options.toBlock;
        options.toBlock = latest_block;
        synced = true;
      }
      // get past events
      await getPastEvents(chain_config, filters, options);

      // update latest block
      if (!synced) {
        try {
          latest_block = await provider.getBlockNumber();
        } catch (error) {}
      }
    }
  }
};

module.exports = {
  subscribe,
  getPastEvents,
  sync,
};