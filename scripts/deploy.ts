import { ethers } from "hardhat";
import { ContractFactory } from "ethers";
// import TWSTokenArtifact from "../artifacts/contracts/TWSToken.sol/TWSToken.json";
import { TWSToken } from "../typechain/TWSToken";
import { TWSStaking } from "../typechain/TWSStaking";
// import { BigNumber } from "ethers";

async function main(): Promise<void> {
  const uniswapFactory = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";
  const WETH_Ropsten = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

  const overrides = { gasPrice: 155000000000, gasLimit: 3000000 };

  const supply = ethers.utils.parseEther("10000000");

  const tokenFactory: ContractFactory = await ethers.getContractFactory("TWSToken");
  const token: TWSToken = (await tokenFactory.deploy(
    supply.toString(),
    WETH_Ropsten,
    uniswapFactory,
    overrides,
  )) as TWSToken;
  console.log("Token deploy tx: ", token.deployTransaction.hash);
  await token.deployed();
  console.log("token deployed to: ", token.address);

  const stakingFactory: ContractFactory = await ethers.getContractFactory("TWSStaking");
  const uniswapPool = await token.uniswapPool();
  const staking: TWSStaking = (await stakingFactory.deploy(token.address, uniswapPool, overrides)) as TWSStaking;
  console.log("Staking deploy tx: ", staking.deployTransaction.hash);
  await staking.deployed();
  console.log("Staking deployed to: ", staking.address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error: Error) => {
    console.error(error);
    process.exit(1);
  });
