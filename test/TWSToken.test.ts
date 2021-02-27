import { expect, use } from "chai";
import { solidity } from "ethereum-waffle";
import { expandTo18Decimals } from "./shared/utilities";
import UniswapV2Factory from "@uniswap/v2-core/build/UniswapV2Factory.json";
import WETH9 from "@uniswap/v2-periphery/build/WETH9.json";
import TWSTokenArtifact from "../artifacts/contracts/TWSToken.sol/TWSToken.json";
import { TWSToken } from "../typechain/TWSToken";
import { Signer } from "@ethersproject/abstract-signer";
import { Accounts, Signers } from "../types";
import { ethers, waffle } from "hardhat";

const { deployContract } = waffle;

use(solidity);

const overrides = {
  gasLimit: 9500000,
};

describe("TWSToken", () => {
  const supply = expandTo18Decimals(10000000);

  before(async function () {
    this.TWSToken = {} as TWSToken;
    this.accounts = {} as Accounts;
    this.signers = {} as Signers;

    const signers: Signer[] = await ethers.getSigners();

    this.signers.admin = signers[0];
    this.accounts.admin = await signers[0].getAddress();

    this.signers.alice = signers[1];
    this.accounts.alice = await signers[1].getAddress();

    this.signers.bob = signers[2];
    this.accounts.bob = await signers[2].getAddress();
  });

  beforeEach(async function () {
    const WETH = await deployContract(this.signers.admin, WETH9);
    const factoryV2 = await deployContract(this.signers.admin, UniswapV2Factory, [await this.accounts.admin]);
    const supply = expandTo18Decimals(10000000);
    this.TWSToken = (await deployContract(this.signers.admin, TWSTokenArtifact, [
      supply,
      WETH.address,
      factoryV2.address,
    ])) as TWSToken;
  });

  describe("Transfer", () => {
    it("Can not transfer from empty account", async function () {
      const tokenFromOtherWallet = this.TWSToken.connect(this.signers.alice);
      await expect(tokenFromOtherWallet.transfer(this.accounts.alice, 1)).to.be.reverted;
    });

    it("Can not transfer above the supply", async function () {
      await expect(this.TWSToken.transfer(this.accounts.alice, supply.add(10000))).to.be.reverted;
    });

    it("Transfer emits event", async function () {
      await expect(this.TWSToken.transfer(this.accounts.alice, 7))
        .to.emit(this.TWSToken, "Transfer")
        .withArgs(this.accounts.admin, this.accounts.alice, 7);
    });

    it("Transfer adds amount to destination account", async function () {
      const amt = expandTo18Decimals(7000);
      await this.TWSToken.transfer(this.accounts.alice, amt);
      expect(await this.TWSToken.balanceOf(this.accounts.alice)).to.equal(amt);
    });

    it("Transfer adds amount minus tax to destination account", async function () {
      const amt = expandTo18Decimals(7000);
      const tax = amt.div(100);
      await this.TWSToken.setTaxEnabled(true);
      await expect(this.TWSToken.transfer(this.accounts.alice, amt))
        .to.emit(this.TWSToken, "Transfer")
        .withArgs(this.accounts.admin, this.accounts.alice, amt.sub(tax));
      expect(await this.TWSToken.balanceOf(this.accounts.alice)).to.equal(amt.sub(tax));
    });

    it("TransferFrom adds amount minus tax to destination account", async function () {
      const amt = expandTo18Decimals(7000);
      await this.TWSToken.transfer(this.accounts.alice, amt);

      const tokenFromOtherWallet = this.TWSToken.connect(this.signers.alice);
      await tokenFromOtherWallet.approve(this.accounts.admin, expandTo18Decimals(7000));

      const tax = amt.div(100);
      await this.TWSToken.setTaxEnabled(true);

      // expect(await this.TWSToken.balanceOf(this.accounts.alice)).to.equal(amt.sub(tax));
      await expect(this.TWSToken.transferFrom(this.accounts.alice, this.accounts.admin, amt))
        .to.emit(this.TWSToken, "Transfer")
        .withArgs(this.accounts.alice, this.accounts.admin, amt.sub(tax));
    });

    it("Transfer does not have tax if sent to staking address", async function () {
      const amt = expandTo18Decimals(7000);
      await this.TWSToken.setTaxEnabled(true);
      await this.TWSToken.setStakingContract(this.accounts.alice);
      await expect(this.TWSToken.transfer(this.accounts.alice, amt))
        .to.emit(this.TWSToken, "Transfer")
        .withArgs(this.accounts.admin, this.accounts.alice, amt);
      expect(await this.TWSToken.balanceOf(this.accounts.alice)).to.equal(amt);
    });

    it("Transfer does not have tax if sent from staking address", async function () {
      const amt = expandTo18Decimals(7000);
      await this.TWSToken.transfer(this.accounts.alice, amt);
      await this.TWSToken.setTaxEnabled(true);
      await this.TWSToken.setStakingContract(this.accounts.alice);

      const tokenFromOtherWallet = this.TWSToken.connect(this.signers.alice);

      await expect(tokenFromOtherWallet.transfer(this.accounts.bob, amt))
        .to.emit(this.TWSToken, "Transfer")
        .withArgs(this.accounts.alice, this.accounts.bob, amt);
      expect(await this.TWSToken.balanceOf(this.accounts.bob)).to.equal(amt);
    });

    it("TransferFrom does not have tax if sent to staking address", async function () {
      const amt = expandTo18Decimals(7000);
      await this.TWSToken.setTaxEnabled(true);
      await this.TWSToken.setStakingContract(this.accounts.bob);
      await this.TWSToken.approve(this.accounts.alice, supply);

      const tokenFromOtherWallet = this.TWSToken.connect(this.signers.alice);

      await expect(tokenFromOtherWallet.transferFrom(this.accounts.admin, this.accounts.bob, amt, overrides))
        .to.emit(this.TWSToken, "Transfer")
        .withArgs(this.accounts.admin, this.accounts.bob, amt);
      expect(await this.TWSToken.balanceOf(this.accounts.bob)).to.equal(amt);
    });
  });

  describe("Staking Specific functions", () => {
    it("Only owner can set staking contract to a new address", async function () {
      await this.TWSToken.setStakingContract(this.accounts.alice);
      expect(await this.TWSToken.stakingContract()).to.equal(this.accounts.alice);
    });

    it("Burn will fail if not staking address", async function () {
      await expect(this.TWSToken.burn(expandTo18Decimals(10))).to.be.revertedWith(
        "caller is not the staking contract.",
      );
    });

    it("Burn will succeed", async function () {
      await this.TWSToken.setStakingContract(this.accounts.admin);
      const uniswapPool = await this.TWSToken.uniswapPool();
      await this.TWSToken.transfer(uniswapPool, expandTo18Decimals(10));
      await expect(this.TWSToken.burn(expandTo18Decimals(10)))
        .to.emit(this.TWSToken, "Transfer")
        .withArgs(uniswapPool, "0x0000000000000000000000000000000000000000", expandTo18Decimals(10));
    });

    it("Transfer reward will fail if not staking address", async function () {
      await expect(this.TWSToken.transferReward(this.accounts.alice, expandTo18Decimals(10))).to.be.revertedWith(
        "caller is not the staking contract.",
      );
    });

    it("Transfer reward will succeed", async function () {
      await this.TWSToken.setStakingContract(this.accounts.admin);
      const uniswapPool = await this.TWSToken.uniswapPool();
      await this.TWSToken.transfer(uniswapPool, expandTo18Decimals(10));
      await expect(this.TWSToken.transferReward(this.accounts.alice, expandTo18Decimals(10)))
        .to.emit(this.TWSToken, "Transfer")
        .withArgs(uniswapPool, this.accounts.alice, expandTo18Decimals(10));
    });
  });

  describe("Constructor", () => {
    it("Assigns initial balance", async function () {
      expect(await this.TWSToken.balanceOf(this.accounts.admin)).to.equal(supply);
    });

    it("tax is disabled", async function () {
      expect(await this.TWSToken.taxEnabled()).to.equal(false);
    });
  });
});
