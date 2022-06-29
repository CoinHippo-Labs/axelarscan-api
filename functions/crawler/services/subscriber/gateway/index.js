// import ethers.js
const { Contract } = require('ethers');
// import subscribe function
const { subscribe, sync } = require('./subscribe');

// run
module.exports.subscribeGateway = chains_config => {
  chains_config?.forEach(c => {
    if (c?.gateway?.address && c.provider) {
      // initial gateway contract
      const contract = new Contract(c.gateway.address, c.gateway.abi, c.provider);
      // initial events
      const events_name = ['TokenSent'];
      const filters = [
        contract.filters.TokenSent(),
      ];
      contract.on(filters, e => {
        if (events_name.includes(e?.event)) {
          subscribe(c, e);
        }
      });
      sync(c, filters);
    }
  });
};