import { Accounts, Signers } from "./";
import { TWSToken } from "../typechain/TWSToken";
import { TWSStaking } from "../typechain/TWSStaking";

declare module "mocha" {
  export interface Context {
    accounts: Accounts;
    TWSToken: TWSToken;
    TWSStaking: TWSStaking;
    signers: Signers;
  }
}
