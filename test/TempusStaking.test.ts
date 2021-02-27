import { expect, use } from "chai";
import { solidity } from "ethereum-waffle";
import { TWSStaking } from "../typechain/TWSStaking";
import { expandTo18Decimals } from "./shared/utilities";
import { TWSToken } from "../typechain/TWSToken";
import { IUniswapV2Router02 } from "../typechain/IUniswapV2Router02";
import { Signer } from "@ethersproject/abstract-signer";
import { Accounts, Signers } from "../types";
import { ethers, waffle } from "hardhat";
import WETH9 from "@uniswap/v2-periphery/build/WETH9.json";
import UniswapV2Factory from "@uniswap/v2-core/build/UniswapV2Factory.json";
import UniswapV2Router02 from "@uniswap/v2-periphery/build/UniswapV2Router02.json";
import TWSStakingArtifact from "../artifacts/contracts/TWSStaking.sol/TWSStaking.json";
import TWSTokenArtifact from "../artifacts/contracts/TWSToken.sol/TWSToken.json";

const { deployContract } = waffle;

use(solidity);

const overrides = {
  gasLimit: 9500000,
};

describe("TWSStake", () => {
  before(async function () {
    this.TWSToken = {} as TWSToken;
    this.TWSStaking = {} as TWSStaking;
    this.accounts = {} as Accounts;
    this.signers = {} as Signers;

    const signers: Signer[] = await ethers.getSigners();

    this.signers.admin = signers[0];
    this.accounts.admin = await signers[0].getAddress();

    this.signers.alice = signers[1];
    this.accounts.alice = await signers[1].getAddress();

    this.signers.bob = signers[2];
    this.accounts.bob = await signers[2].getAddress();
    console.log("🖋  Admin: ", this.accounts.admin);
    console.log("🖋  Alice: ", this.accounts.alice);
    console.log("🖋  Bob: ", this.accounts.bob);
  });

  beforeEach(async function () {
    // deploy uniswap contracts
    const WETH = await deployContract(this.signers.admin, WETH9);
    const factoryV2 = await deployContract(this.signers.admin, UniswapV2Factory, [this.accounts.admin], overrides);
    const router02 = (await deployContract(
      this.signers.admin,
      UniswapV2Router02,
      [factoryV2.address, WETH.address],
      overrides,
    )) as IUniswapV2Router02;

    // deploy token contract
    const supply = expandTo18Decimals(10000000);
    this.TWSToken = (await deployContract(this.signers.admin, TWSTokenArtifact, [
      supply,
      WETH.address,
      factoryV2.address,
    ])) as TWSToken;

    // add lqiuidity to uniswap
    const adminToken = this.TWSToken.connect(this.signers.admin);
    await adminToken.approve(router02.address, supply);
    const uniswapSupply = expandTo18Decimals(3190000);
    const router = router02.connect(this.signers.admin);
    await router.addLiquidityETH(
      this.TWSToken.address,
      uniswapSupply,
      uniswapSupply,
      expandTo18Decimals(100),
      this.accounts.admin,
      1740580834,
      { value: expandTo18Decimals(100) },
    );

    // Deploy staking contract
    const uniswapPool = await this.TWSToken.uniswapPool();
    this.TWSStaking = (await deployContract(
      this.signers.admin,
      TWSStakingArtifact,
      [this.TWSToken.address, uniswapPool],
      overrides,
    )) as TWSStaking;
    await this.TWSStaking.setAllowStaking(true);
    await this.TWSToken.approve(this.TWSStaking.address, supply);
    await this.TWSToken.setStakingContract(this.TWSStaking.address);

    await this.TWSToken.transfer(this.accounts.alice, expandTo18Decimals(10000));
    const token = this.TWSToken.connect(this.signers.alice);
    await token.approve(this.TWSStaking.address, supply);
    await this.TWSToken.setTaxEnabled(true);
  });

  describe("Staking", () => {
    it("Should submit users stake and emit event", async function () {
      const tokens = expandTo18Decimals(100);
      await expect(this.TWSStaking.stake(tokens, overrides))
        .to.emit(this.TWSStaking, "Stake")
        .withArgs(this.accounts.admin, tokens, tokens);
    });
    it("Should have the correct token stats after additional stake", async function () {
      const tokens = expandTo18Decimals(1000);
      const tokenStakedTime = tokens.mul(600).add(tokens.mul(2).mul(50));
      // Initial stake, wait 10 minutes
      await this.TWSStaking.stake(tokens, overrides);
      await ethers.provider.send("evm_increaseTime", [600]);
      // 2nd stake wait 50 seconds
      await this.TWSStaking.stake(tokens, overrides);
      await ethers.provider.send("evm_increaseTime", [50]);
      // 3rd stake
      await this.TWSStaking.stake(tokens, overrides);
      // stats
      const info = await this.TWSStaking.info(this.accounts.admin);
      const stakedTokens = info[0];
      const totalStakedTokenTime = info[1];
      const totalStakedTokensGlobal = info[4];
      const totalStakedTokenTimeGlobal = info[5];

      await expect(stakedTokens).to.eq(tokens.mul(3));
      await expect(totalStakedTokenTime).to.eq(tokenStakedTime);
      await expect(totalStakedTokensGlobal).to.eq(tokens.mul(3));
      await expect(totalStakedTokenTimeGlobal).to.eq(tokenStakedTime);
    });

    it("Should revert as minimum stake not met", async function () {
      const tokens = expandTo18Decimals(0);
      await expect(this.TWSStaking.stake(tokens)).to.be.revertedWith("minimum stake amount is 1");
    });
    it("Should revert as staker does not have enough balance", async function () {
      const tokens = expandTo18Decimals(1);
      const stakeWithOther = await this.TWSStaking.connect(this.signers.bob);
      await expect(stakeWithOther.stake(tokens)).to.be.revertedWith("amount is greater than senders balance");
    });
  });

  describe("Unstaking", () => {
    it("Should unstake user and emit event", async function () {
      const tokens = expandTo18Decimals(100);
      const tax = tokens.mul(7).div(100);
      await this.TWSStaking.stake(tokens, overrides);
      await expect(this.TWSStaking.unstake(overrides))
        .to.emit(this.TWSStaking, "Unstake")
        .withArgs(this.accounts.admin, tokens, tax);
    });

    it("Should update global stats correctly after unstake", async function () {
      // stake 1000 tokens, wait 600 seconds
      const ownerStake = expandTo18Decimals(1000);
      const tax = ownerStake.mul(7).div(100);
      await this.TWSStaking.stake(ownerStake);
      await ethers.provider.send("evm_increaseTime", [600]);

      // stake 10000 tokens, wait 1200 seconds
      const secondStake = expandTo18Decimals(10000);
      const otherWalletStake = this.TWSStaking.connect(this.signers.alice);
      await otherWalletStake.stake(secondStake);
      // 2400 seconds * 10000 tokens
      // time that will pass since this stake is 2400 seconds
      const tokenTimeSecondStake = secondStake.mul(2400);
      await ethers.provider.send("evm_increaseTime", [1200]);

      // stake 10000 tokens, wait 1200 seconds
      const thirdStake = expandTo18Decimals(10000);
      await this.TWSToken.transfer(this.accounts.bob, thirdStake.add(thirdStake));
      const tokenBob = this.TWSToken.connect(this.signers.bob);
      await tokenBob.approve(this.TWSStaking.address, thirdStake);
      const other2WalletStake = this.TWSStaking.connect(this.signers.bob);
      await other2WalletStake.stake(thirdStake);
      const tokenTimeThirdStake = secondStake.mul(1200); // 1200 seconds * 10000 tokens
      await ethers.provider.send("evm_increaseTime", [1200]);

      await this.TWSStaking.unstake(overrides);

      const info = await this.TWSStaking.info(this.accounts.admin);
      const stakedTokens = info[0];
      const totalStakedTokenTime = info[1];
      const lastAccountingTimestamp = info[2];
      const lastRewardClaimedTime = info[3];
      const totalStakedTokensGlobal = info[4];
      const totalStakedTokenTimeGlobal = info[5];
      const rewardPool = info[6];

      await expect(stakedTokens).to.eq(0, "stakedTokens");
      await expect(totalStakedTokenTime).to.eq(0, "totalStakedTokenTime");
      await expect(lastRewardClaimedTime).to.eq(0, "lastRewardClaimedTime");
      await expect(lastAccountingTimestamp).to.eq(0, "lastAccountingTimestamp");
      await expect(rewardPool).to.eq(tax);
      await expect(totalStakedTokensGlobal).to.eq(secondStake.add(thirdStake));
      await expect(totalStakedTokenTimeGlobal).to.eq(tokenTimeSecondStake.add(tokenTimeThirdStake));
    });
  });

  describe("Sanitise Pool", () => {
    it("Should sanitise pool and emit event", async function () {
      const BURN_RATE = 2;
      const USER_REWARD = 2;
      const POOL_REWARD = 48;

      const uniswapPoolBalance = await this.TWSToken.balanceOf(await this.TWSToken.uniswapPool());

      const burnAmount = uniswapPoolBalance.mul(BURN_RATE).div(100);
      const userReward = burnAmount.mul(USER_REWARD).div(100);
      const poolReward = burnAmount.mul(POOL_REWARD).div(100);
      const finalBurn = burnAmount.sub(userReward).sub(poolReward);

      const tokenSupply = expandTo18Decimals(10000000).sub(finalBurn);
      const uniswapBalance = uniswapPoolBalance.sub(burnAmount);

      await ethers.provider.send("evm_increaseTime", [21600]); // 6 hours

      await expect(this.TWSStaking.sanitisePool(overrides))
        .to.emit(this.TWSStaking, "SanitisePool")
        .withArgs(this.accounts.admin, finalBurn, userReward, poolReward, tokenSupply, uniswapBalance);
    });

    it("Should only allow 1 burn every 6 hours", async function () {
      await expect(this.TWSStaking.sanitisePool(overrides)).to.revertedWith("only 1 burn every 6 hours");
    });
  });

  describe("Claim Reward", () => {
    it("Should claim reward and emit event", async function () {
      await ethers.provider.send("evm_increaseTime", [21600]); // 6 hours
      await this.TWSStaking.sanitisePool(overrides);

      // stake 1000 tokens, wait 1200 seconds
      const ownerStake = expandTo18Decimals(1000);
      await this.TWSStaking.stake(ownerStake);
      await ethers.provider.send("evm_increaseTime", [1200]);

      // stake 10000 tokens, wait 600 seconds
      const secondStake = expandTo18Decimals(10000);
      const otherWalletStake = this.TWSStaking.connect(this.signers.alice);
      await otherWalletStake.stake(secondStake);
      await ethers.provider.send("evm_increaseTime", [600]);

      const burnAmount = await this.TWSStaking.getBurnAmount();
      const POOL_REWARD = burnAmount.mul(48).div(100);
      const ownerTokenTime = ownerStake.mul(1800);
      const otherTokenTime = secondStake.mul(600);
      const totalTokenTime = ownerTokenTime.add(otherTokenTime);

      const ownerShare = ownerTokenTime.mul(10000).div(totalTokenTime);

      const rewardAmount = POOL_REWARD.mul(ownerShare).div(10000);
      const rewardPool = POOL_REWARD.sub(rewardAmount);

      await expect(this.TWSStaking.claimReward(overrides))
        .to.emit(this.TWSStaking, "ClaimReward")
        .withArgs(this.accounts.admin, rewardAmount, rewardPool);

      const info = await this.TWSStaking.info(this.accounts.admin);
      const stakedTokens = info[0];
      // const totalStakedTokenTime = info[1];
      // const lastRewardClaimedTime = info[2];
      const totalStakedTokensGlobal = info[4];
      // const totalStakedTokenTimeGlobal = info[4];
      // const rewardPool = info[5];

      expect(totalStakedTokensGlobal).to.eq(ownerStake.add(secondStake).add(rewardAmount));
      expect(stakedTokens).to.eq(ownerStake.add(rewardAmount));
    });

    it("Should only only claim rewards if pool is bigger than 1e18", async function () {
      await expect(this.TWSStaking.claimReward(overrides)).to.revertedWith("reward pool is too small.");
    });

    it("Should not allow user to claim twice", async function () {
      const ownerStake = expandTo18Decimals(1000);
      await this.TWSStaking.stake(ownerStake);

      const secondStake = expandTo18Decimals(10000);
      await this.TWSToken.transfer(this.accounts.bob, secondStake.add(secondStake));
      const tokenBob = this.TWSToken.connect(this.signers.bob);
      await tokenBob.approve(this.TWSStaking.address, secondStake);
      const otherWalletStake = this.TWSStaking.connect(this.signers.bob);
      await otherWalletStake.stake(secondStake);

      await ethers.provider.send("evm_increaseTime", [21600]); // 6 hours
      await this.TWSStaking.sanitisePool(overrides);

      await this.TWSStaking.claimReward(overrides);

      await expect(this.TWSStaking.claimReward(overrides)).to.revertedWith("reward from this burn already claimed.");
    });

    it("Should only only allow users who are staked", async function () {
      const ownerStake = expandTo18Decimals(1000);
      await this.TWSStaking.stake(ownerStake);

      await ethers.provider.send("evm_increaseTime", [21600]); // 6 hours
      await this.TWSStaking.sanitisePool(overrides);

      const notStaked = this.TWSStaking.connect(this.signers.alice);
      await expect(notStaked.claimReward(overrides)).to.revertedWith("user is not staked.");
    });
  });
});
