import { ethers } from "hardhat";
import { BigNumber, Signer, ethers as Ethers, Contract, BigNumberish } from "ethers";

export function expandTo18Decimals(n: number): BigNumber {
  return ethers.BigNumber.from(n).mul(ethers.BigNumber.from(10).pow(18));
}

export function remove18Decimals(n: BigNumber): string {
  return n.toString().slice(0, -18);
}

export async function depositEther(
  wallet: Signer,
  contract: Contract,
  value: BigNumberish,
): Promise<Ethers.providers.TransactionResponse> {
  return wallet.sendTransaction({
    to: contract.address,
    value: value,
    gasLimit: 400000,
  });
}
