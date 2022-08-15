const { Contract } = require('ethers');
const {
  onEmit,
  sync,
} = require('./subscribe');

module.exports.subscribeGateway = (chains_config = []) => {
  chains_config.forEach(c => {
    // chain configuration
    const {
      provider,
      gateway,
    } = { ...c };

    // contract parameters
    const {
      address,
      abi,
    } = { ...gateway };

    if (provider && address) {
      // initial gateway contract
      const contract = new Contract(address, abi, provider);

      // events to subscribe
      const events_name = [
        'TokenSent',
      ];
      const filters = [
        contract.filters.TokenSent(),
      ];

      // listen to events emitted from contract
      contract.on(filters, e => {
        const {
          event,
        } = { ...e };

        if (events_name.includes(event)) {
          onEmit(c, e);
        }
      });

      // sync events from latest subscribed block
      sync(c, filters);
    }
  });
};