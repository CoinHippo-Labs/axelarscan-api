const { Contract } = require('ethers');

const { onEmit, sync } = require('./subscribe');
const { GATEWAY_EVENTS } = require('../../utils/config');

module.exports = (chains_data = [], context) => {
  chains_data.forEach(c => {
    const { provider, gateway } = { ...c };
    const { address, abi } = { ...gateway };

    if (provider && address) {
      const contract = new Contract(address, abi, provider);
      // events to subscribe
      const events_name = GATEWAY_EVENTS;
      const filters = [contract.filters.TokenSent(), contract.filters.Executed()];

      // listen to events emitted from contract
      contract.on(
        filters,
        e => {
          const { event } = { ...e };
          if (events_name.includes(event)) {
            onEmit(c, e);
          }
        },
      );

      // sync events from latest subscribed block
      sync(c, filters);
    }
  });
};