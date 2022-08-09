const {
  BigNumber,
  Contract,
  constants: { AddressZero },
  utils: { formatUnits },
} = require('ethers');
const {
  to_json,
} = require('../utils');

const getContractSupply = async (
  contract_data,
  provider,
) => {
  let supply;
  const {
    contract_address,
    decimals,
  } = { ...contract_data };

  if (contract_address && provider) {
    try {
      const contract = new Contract(contract_address, ['function totalSupply() view returns (uint256)'], provider);
      supply = await contract.totalSupply();
    } catch (error) {}
  }
  return Number(formatUnits(BigNumber.from((supply || 0).toString()), decimals || 18));
};

const getEVMBalance = async (
  address,
  contract_data,
  provider,
) => {
  let balance;
  const {
    contract_address,
    decimals,
  } = { ...contract_data };

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
  return Number(formatUnits(BigNumber.from((balance || 0).toString()), decimals || 18));
};

const getCosmosBalance = async (
  address,
  denom_data,
  lcd,
) => {
  let balance;
  const {
    base_denom,
    denom,
    decimals,
  } = { ...denom_data };
  const denoms = [base_denom, denom].filter(d => d);

  if (address && denoms.length > 0 && lcd) {
    try {
      for (const denom of denoms) {
        const response = await lcd.get(`/cosmos/bank/v1beta1/balances/${address}/by_denom`, {
          params: {
            denom,
          },
        }).catch(error => { return { data: { error } }; });
        const {
          amount,
        } = { ...response?.data?.balance };
        balance = amount;
        if (balance && balance !== '0') {
          break;
        }
      }
    } catch (error) {}
  }
  return Number(formatUnits(BigNumber.from((balance || 0).toString()), decimals || 6));
};

const getCosmosSupply = async (
  denom_data,
  cli,
) => {
  let supply;
  const {
    base_denom,
    denom,
    decimals,
  } = { ...denom_data };
  const denoms = [base_denom, denom].filter(d => d);

  if (denoms.length > 0 && cli) {
    try {
      for (const denom of denoms) {
        const response = await cli.get('', {
          params: {
            cmd: `axelard q bank total --denom ${denom} -oj`,
          },
        }).catch(error => { return { data: { error } }; });
        const output = to_json(response?.data?.stdout);
        const {
          amount,
        } = { ...output };
        supply = amount;
        if (supply && supply !== '0') {
          break;
        }
      }
    } catch (error) {}
  }
  return Number(formatUnits(BigNumber.from((supply || 0).toString()), decimals || 6));
};

module.exports = {
  getContractSupply,
  getEVMBalance,
  getCosmosBalance,
  getCosmosSupply,
};