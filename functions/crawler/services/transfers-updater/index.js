const fixValues = require('./fix-values');
const fixTerraToTerraClassic = require('./fix-terra-to-terra-classic');
const fixTerraClassicToTerra = require('./fix-terra-classic-to-terra');

const environment = process.env.ENVIRONMENT;

module.exports = async () => {
  fixValues();

  if (environment === 'mainnet') {
    fixTerraToTerraClassic();
    fixTerraClassicToTerra();
  }
};