import { Signer } from "@ethersproject/abstract-signer";

export interface Accounts {
  admin: string;
  alice: string;
  bob: string;
  dave: string;
}

export interface Signers {
  admin: Signer;
  alice: Signer;
  bob: Signer;
  dave: Signer;
}
