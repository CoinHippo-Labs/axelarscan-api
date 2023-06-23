const { Contract } = require('ethers');

const { saveEvent } = require('../../../events');
const { GATEWAY_EVENTS } = require('../../../../utils/config');
const { log, sleep } = require('../../../../utils');

const service_name = 'gateway-subscriber';

const onEmit = async (chain_data, data, _event) => {
  if (chain_data && data) {
    try {
      const { id, gateway } = { ...chain_data };
      const chain = id;
      const { address, abi } = { ...gateway };

      // event attributes
      const { transactionHash, transactionIndex, index, args } = { ...data };
      let { logIndex, event } = { ...data };
      logIndex = typeof logIndex === 'number' ? logIndex : index;
      data.logIndex = logIndex;
      if (typeof index === 'number') {
        delete data.index;
      }
      event = event || _event;
      data.event = event;
      // set event id from transaction hash with index
      data.id = `${transactionHash}_${transactionIndex}_${logIndex}`;

      // construct returnValues from arguments
      const returnValues = {};
      if (args && abi) {
        const { inputs } = { ...abi.find(a => a?.name === event) };
        if (inputs) {
          inputs.forEach((input, i) => {
            const { name } = { ...input };
            if (name) {
              returnValues[name] = args[i];
            }
          });
        }
        data.returnValues = returnValues;
        delete data.args;
      }

      // normalize
      try {
        data = JSON.parse(JSON.stringify(data));
        data.logIndex = logIndex;
        data.event = event;
        data.returnValues = returnValues;
      } catch (error) {}

      // returnValues attributes
      const { payloadHash } = { ...data.returnValues };
      if (GATEWAY_EVENTS.includes(event)) {
        log('info', service_name, `event emitted: ${event}`, { chain, ...data });
        await saveEvent({ event: data, chain, contractAddress: address });
      }
    } catch (error) {
      log('error', service_name, 'general', { error: error?.message });
    }
  }
};

const getPastEvents = async (chain_data, filters, options, retry_time = 0) => {
  if (chain_data && filters && options) {
    const { id, provider, gateway } = { ...chain_data };
    const chain = id;
    const { address, abi } = { ...gateway };

    if (address) {
      const contract = new Contract(address, abi, provider);
      const { fromBlock, toBlock } = { ...options };
      log('info', service_name, 'get past gateway events', { chain, contract_address: address, filters, options, retry_time });

      // query events
      const events = await contract.queryFilter(filters, fromBlock, toBlock).catch(error => { return { error }; });
      if (!events?.error) {
        if (events) {
          await Promise.all(events.map(event => new Promise(async resolve => resolve(await onEmit(chain_data, event, filters)))));
        }
        return events;
      }
      else {
        const { message } = { ...events.error };
        log('warn', service_name, 'get past gateway events', { chain, contract_address: address, filters, options, retry_time, error: message });
        if (retry_time < 3) {
          await sleep(1.5 * 1000);
          return await getPastEvents(chain_data, filters, options, retry_time + 1);
        }
      }
    }
  }
  return;
};

module.exports = {
  onEmit,
  getPastEvents,
};