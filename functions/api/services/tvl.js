const {
  BigNumber,
  Contract,
  constants: { AddressZero },
  utils: { formatUnits },
} = require('ethers');

const getContractSupply = async (contract_data, provider) => {
  let supply;
  const {
    contract_address,
  } = { ...contract_data };
  const decimals = contract_data?.decimals || 18;

  if (contract_address && provider) {
    try {
      const contract = new Contract(contract_address, ['function totalSupply() view returns (uint256)'], provider);
      supply = await contract.totalSupply();
    } catch (error) {}
  }
  return Number(formatUnits(BigNumber.from((supply || 0).toString()), decimals));
};

const getBalance = async (address, contract_data, provider) => {
  let balance;
  const {
    contract_address,
  } = { ...contract_data };
  const decimals = contract_data?.decimals || 18;

  if (address && contract_address && provider) {
    try {
      if (contract_address === AddressZero) {
        balance = await provider.getBalance(address);
      }
      else {
        const contract = new Contract(contract_address, ['function balanceOf(address owner) view returns (uint256)'], provider);
        balance = await contract.balanceOf(address);
      }
    } catch (error) {}
  }
  return Number(formatUnits(BigNumber.from((balance || 0).toString()), decimals));
};

module.exports = {
  getContractSupply,
  getBalance,
};